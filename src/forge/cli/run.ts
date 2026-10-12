import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, statSync, lstatSync, readFileSync, readdirSync, openSync, closeSync, fstatSync, readSync, rmSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { appendEvent, readEvents, forgeDir, LEDGER_KINDS, type LedgerKind } from '../ledger.js';
import { parseRun, startRun, recordCycle, stopReason, endRun, readRunText, saveRun, stopFile, type RunState, type StopContext } from '../run.js';
import { decideStop, decideExecutionStop, bindHookSession } from '../hook.js';
import { readExecution, saveExecution } from '../execution.js';
import { planLocale, replyIn } from '../../lib/locale.js';
import { triage, zonesFromPaths, PATH_ORDER, type PathName } from '../triage.js';
import { parsePlan, PlanError } from '../../lib/plan.js';
import { renderBrief, taskText } from '../brief.js';
import { loadConfig, agentFor, ROLES, ConfigError, NAME } from '../config.js';
import { parseReview, parseVerifyFile, verifyReview, weightsFor, synthesize, type ReviewerName, type Action, type FailingValidator } from '../verdict.js';
import { decideRound } from '../loop.js';
import { PROPOSAL_ID, proposalId, saveProposal, loadProposals, decideLocal, decideDoc, mirrorProposal } from '../proposals.js';
import { normalizeProposal, isActionable, PROPOSAL_STATUSES, type Decision } from '../../lib/proposals.js';
import { autoApprovable, similarRejected, similarOpen } from '../policy.js';
import { proposalToTask } from '../to-task.js';
import { parseDocument } from 'yaml';
import { UsageError } from './errors.js';
import { swarmCommand } from './swarm.js';
import { detectValidators, selectValidators, runValidators, markPreexisting, blocking, globMatch, onPath, type RepoReader, type Scope } from '../validators.js';
import { checkTools, missingTools } from '../tools.js';
import { verifyPlan, cleanupPids, killTarget } from '../verify.js';
import { readLocal, updateLocal } from '../local.js';
import { hookLive } from '../live.js';
import { readSurfaces, detectDrafts, appendLearned, surfaceFile, surfaceHash } from '../surfaces.js';

export interface ExecResult { code: number; output: string; ms: number; timedOut: boolean }
export interface Io { cwd: string; workdir?: string; now: () => Date; exec?: (cmd: string, timeoutSec: number) => ExecResult; git?: (args: string[]) => string | null; scriptPath?: string; rand?: () => number; stdin?: string; sleep?: (ms: number) => void }
type Result = { code: number; stdout: string; stderr: string };

const USAGE = 'usage: forge <triage|brief|validate|verdict|round|log|agents|last|proposals|surfaces|tools|local|verify-plan|verify-cleanup|waypoint-cli|infinite|cycle|swarm|stop|hook> ...';
const MAX_OUTPUT = 4 * 1024 * 1024;
const MAX_GIT_OUTPUT = 256 * 1024 * 1024;

// Reads at most the last MAX_OUTPUT bytes of a file, flagging truncation.
function readTail(fd: number): string {
  const size = fstatSync(fd).size;
  const len = Math.min(size, MAX_OUTPUT);
  const buf = Buffer.alloc(len);
  let off = 0;
  while (off < len) {
    const n = readSync(fd, buf, off, len - off, size - len + off);
    if (n <= 0) break;
    off += n;
  }
  const text = buf.subarray(0, off).toString('utf8');
  return size > MAX_OUTPUT ? `[output truncated]\n${text}` : text;
}

const TIMEOUT_EXIT = 124;

// Runs inside a separate node process: argv = [cmd, timeoutMs, logPath] (passed after `--`, so a command
// that starts with a dash is never read as a node option). It spawns the command through
// the shell with stdio on the log file and, on its own timer, kills the whole process tree while the
// root is still alive (taskkill /T on Windows, the process group elsewhere), drops a `<log>.timeout`
// marker and exits 124. Otherwise it exits with the command's code.
const WRAPPER_SOURCE = `
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const [cmd, ms, log] = process.argv.slice(1);
const win = process.platform === 'win32';
const fd = fs.openSync(log, 'a');
let timedOut = false;
const child = spawn(cmd, { shell: true, stdio: ['ignore', fd, fd], detached: !win, windowsHide: true });
const timer = setTimeout(() => {
  timedOut = true;
  try { fs.writeFileSync(log + '.timeout', ''); } catch {}
  try {
    if (win) execFileSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore', windowsHide: true });
    else process.kill(-child.pid, 'SIGKILL');
  } catch {}
  process.exit(${TIMEOUT_EXIT});
}, Number(ms));
child.on('error', e => { clearTimeout(timer); try { fs.writeSync(fd, 'spawn error: ' + e.message + require('os').EOL); } catch {} process.exit(127); });
child.on('exit', code => { clearTimeout(timer); if (!timedOut) process.exit(code === null ? 1 : code); });
`;

// The command runs under a small node wrapper that owns the timeout and kills the whole tree, so
// timed-out validators leave no orphans. Output goes to a temp file, not pipes, so nothing that
// escapes can keep us blocked on open pipes; only the last MAX_OUTPUT bytes are read back.
export function defaultExec(cwd: string) {
  return (cmd: string, timeoutSec: number): ExecResult => {
    const t0 = Date.now();
    const timeoutMs = timeoutSec * 1000;
    let dir: string | undefined;
    let fd: number | undefined;
    try {
      dir = mkdtempSync(path.join(tmpdir(), 'forge-exec-'));
      const file = path.join(dir, 'out.log');
      fd = openSync(file, 'w+');
      const r = spawnSync(process.execPath, ['-e', WRAPPER_SOURCE, '--', cmd, String(timeoutMs), file], {
        cwd, windowsHide: true, timeout: timeoutMs + 15000, stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8', maxBuffer: 64 * 1024,
      });
      const err = r.error as NodeJS.ErrnoException | undefined;
      const timedOut = err?.code === 'ETIMEDOUT' || (r.status === TIMEOUT_EXIT && existsSync(`${file}.timeout`));
      let output = readTail(fd);
      if (r.stderr) output += `${output && !output.endsWith('\n') ? '\n' : ''}${r.stderr}`;
      if (err && !timedOut) output += `${output && !output.endsWith('\n') ? '\n' : ''}${err.message}\n`;
      return { code: r.status ?? 1, output, ms: Date.now() - t0, timedOut };
    } catch (e) {
      return { code: 1, output: `forge: could not run the command: ${(e as Error).message}\n`, ms: Date.now() - t0, timedOut: false };
    } finally {
      if (fd !== undefined) { try { closeSync(fd); } catch { /* ignore */ } }
      if (dir !== undefined) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } }
    }
  };
}

// null when git fails (not a repository, git missing, output too large, or a non-zero exit such as
// `git grep` finding nothing).
export function defaultGit(cwd: string) {
  return (args: string[]): string | null => {
    try { return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: MAX_GIT_OUTPUT, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }); }
    catch { return null; }
  };
}

export const repoReader = (root: string): RepoReader => ({
  exists: rel => existsSync(path.join(root, rel)),
  read: rel => { try { return readFileSync(path.join(root, rel), 'utf8'); } catch { return null; } },
  list: dir => { try { return readdirSync(path.join(root, dir ?? '')); } catch { return []; } },
});

// The plan and one task of it; a usage error (exit 2) for a missing file, a broken plan or an unknown task.
function planTask(cwd: string, planArg: string | undefined, id: string | undefined) {
  if (!planArg || !id) throw new UsageError('--plan and --task are required');
  let text: string;
  try { text = readFileSync(path.resolve(cwd, planArg), 'utf8'); } catch { throw new UsageError(`cannot read plan ${planArg}`); }
  let plan;
  try { plan = parsePlan(text); } catch (e) {
    if (e instanceof PlanError) throw new UsageError(`${planArg}: ${e.issues.join('; ')}`);
    throw e;
  }
  const task = plan.tasks.find(t => t.id === id);
  if (!task) throw new UsageError(`task ${id} is not in ${planArg}`);
  return { plan, task };
}

// Finds waypoint's CLI from the running forge.cjs: dev layout (plugins/forge, plugins/waypoint) or
// cache layout (<marketplace>/forge/<ver>, <marketplace>/waypoint/<ver>); the highest version wins.
// Caveat: after a downgrade a stale higher-version directory left in the cache could be picked.
export function findWaypointCli(scriptPath: string): string | null {
  const forgeRoot = path.resolve(path.dirname(scriptPath), '..');
  const dev = path.join(forgeRoot, '..', 'waypoint', 'dist', 'waypoint.cjs');
  if (existsSync(dev)) return path.resolve(dev);
  const base = path.join(forgeRoot, '..', '..', 'waypoint');
  let versions: string[] = [];
  try { versions = readdirSync(base); } catch { return null; }
  const key = (v: string) => v.split(/[.+-]/).map(n => (/^\d+$/.test(n) ? Number(n) : 0));
  const cmp = (a: string, b: string) => { const x = key(a), y = key(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d) return d; } return 0; };
  for (const v of versions.sort((a, b) => cmp(b, a))) {
    const f = path.join(base, v, 'dist', 'waypoint.cjs');
    if (existsSync(f)) return path.resolve(f);
  }
  return null;
}

// What the stop conditions need from the repository: the stop file and the proposal mirror.
// Approved work still pending = every approved/auto_approved proposal not yet done, with or without a task.
function stopContext(cwd: string, now: Date): StopContext {
  const proposals = loadProposals(cwd);
  return {
    now,
    stopFile: existsSync(stopFile(cwd)),
    approvedPending: proposals.filter(isActionable).length,
    pendingProposals: proposals.filter(p => p.status === 'proposed' || p.status === 'discussing').length,
  };
}

// The Stop hook: fail-open (any error prints nothing); prints a block or nothing. An active infinite run decides first
// (an execution runs inside its cycles); otherwise an active execution decides.
function hookStop(io: Io): string {
  try {
    const input: unknown = JSON.parse(io.stdin ?? '');
    if (!input || typeof input !== 'object' || Array.isArray(input)) return '';
    const hookInput = input as { stop_hook_active?: boolean; session_id?: unknown };
    // An unbound active execution binds to the first session that stops, saved before the signal is written.
    const read = readExecution(io.cwd);
    const exec = bindHookSession(read, hookInput.session_id);
    if (exec && exec !== read) saveExecution(io.cwd, exec);
    hookLive(io, 'Stop');
    const sleeping = !!exec?.active && !!exec.sleepUntil && Date.parse(exec.sleepUntil) > io.now().getTime();
    const run = parseRun(readRunText(io.cwd));
    if (run?.active) {
      const d = decideStop(hookInput, run, { ...stopContext(io.cwd, io.now()), ledgerEvents: readEvents(io.cwd).length, swarmSleeping: sleeping });
      if (!d.block) return '';
      saveRun(io.cwd, d.run);
      if (d.ended) appendEvent(io.cwd, { ts: io.now().toISOString(), kind: 'cycle', action: 'stopped', reason: d.ended });
      return JSON.stringify({ decision: 'block', reason: d.reason + replyIn(planLocale(io.cwd, exec?.project)) }) + '\n';
    }
    const d = decideExecutionStop(hookInput, exec, { now: io.now(), stopFile: existsSync(stopFile(io.cwd)) });
    if (!d.block) return '';
    saveExecution(io.cwd, d.exec);
    return JSON.stringify({ decision: 'block', reason: d.reason + replyIn(planLocale(io.cwd, d.exec.project)) }) + '\n';
  } catch { return ''; }
}

export function run(argv: string[], io: Io): Result {
  // --cwd <dir>: the code lives there (validators, git and the project's files), so a coordinator never has to cd
  // into a worktree (a cd outside a subshell sticks). forge's own state (ledger, .forge/work, the execution) and
  // every file flag stay with the caller's directory.
  const cwdAt = argv.indexOf('--cwd');
  if (cwdAt >= 0) {
    const dir = argv[cwdAt + 1];
    if (!dir || dir.startsWith('--')) return { code: 2, stdout: '', stderr: 'forge: --cwd needs a directory\n' };
    const abs = path.resolve(io.cwd, dir);
    if (!existsSync(abs)) return { code: 2, stdout: '', stderr: `forge: --cwd ${abs} does not exist\n` };
    if (!statSync(abs).isDirectory()) return { code: 2, stdout: '', stderr: `forge: --cwd ${abs} is not a directory\n` };
    argv = [...argv.slice(0, cwdAt), ...argv.slice(cwdAt + 2)];
    io = { ...io, workdir: abs, git: defaultGit(abs), exec: defaultExec(abs) };
  }
  const repoDir = io.workdir ?? io.cwd;
  const [cmd, ...args] = argv;
  const flag = (name: string) => {
    const i = args.indexOf(`--${name}`);
    const v = i >= 0 ? args[i + 1] : undefined;
    return v === undefined || v.startsWith('--') ? undefined : v;
  };
  const has = (name: string) => args.includes(`--${name}`);
  const ok = (out: string): Result => ({ code: 0, stdout: out.endsWith('\n') ? out : `${out}\n`, stderr: '' });
  const json = (v: unknown, code = 0): Result => ({ code, stdout: JSON.stringify(v, null, 2) + '\n', stderr: '' });
  const ts = () => io.now().toISOString();
  try {
    switch (cmd) {
      case 'log': {
        const kind = flag('kind');
        if (!kind || !(LEDGER_KINDS as readonly string[]).includes(kind)) throw new UsageError(`log: --kind must be one of ${LEDGER_KINDS.join('|')}`);
        let data: Record<string, unknown> = {};
        if (flag('data') !== undefined && flag('data-file') !== undefined) throw new UsageError('log: use --data or --data-file, not both');
        if (flag('data') !== undefined || flag('data-file') !== undefined) {
          const label = flag('data-file') !== undefined ? '--data-file' : '--data';
          let parsed: unknown;
          try {
            const raw = flag('data-file') !== undefined ? readFileSync(path.resolve(io.cwd, flag('data-file')!), 'utf8') : flag('data')!;
            parsed = JSON.parse(raw);
          } catch { throw new UsageError(`log: ${label} must be a JSON object`); }
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new UsageError(`log: ${label} must be a JSON object`);
          data = parsed as Record<string, unknown>;
        }
        const task = flag('task');
        appendEvent(io.cwd, { ...data, ts: ts(), kind: kind as LedgerKind, ...(task ? { task } : {}) });
        return ok('ok');
      }
      case 'brief': {
        const { plan, task } = planTask(io.cwd, flag('plan'), flag('task'));
        const design = flag('design') ?? path.join(path.dirname(flag('plan')!), 'design.md');
        const designPath = existsSync(path.resolve(io.cwd, design)) ? design.replace(/\\/g, '/') : null;
        return ok(renderBrief(plan, task, { planPath: flag('plan')!.replace(/\\/g, '/'), designPath }));
      }
      case 'triage': {
        const textArgs = [...args];
        for (const f of ['--task', '--text-file', '--plan']) {
          const i = textArgs.indexOf(f);
          if (i >= 0) textArgs.splice(i, 2);
        }
        let task = textArgs.filter(a => !a.startsWith('--')).join(' ').trim();
        if (flag('text-file') !== undefined) {
          try { task = readFileSync(path.resolve(io.cwd, flag('text-file')!), 'utf8').trim(); } catch { throw new UsageError('triage: cannot read --text-file'); }
        }
        if (has('plan') && flag('plan') === undefined) throw new UsageError('triage: --plan needs a plan file');
        const planned = flag('plan') !== undefined ? planTask(io.cwd, flag('plan'), flag('task')).task : null;
        if (planned) task = taskText(planned);
        if (!task) throw new UsageError('triage: the task text is required');
        const git = io.git ?? defaultGit(io.cwd);
        const lines = (out: string | null) => (out ?? '').split('\n').map(s => s.trim()).filter(Boolean);
        const listed = git(['-c', 'core.quotePath=false', 'ls-files']);
        // rev-list fails on a repository without commits: that is 0 commits, not a git failure.
        const commits = Number.parseInt((git(['rev-list', '--count', 'HEAD']) ?? '').trim(), 10) || 0;
        // The design, the plan and forge's own notes name every symbol of a planned task: a hit there says nothing
        // about the code the task touches, so the symbol search leaves them out (a task can still name them as paths).
        const bookkeeping = (f: string) => /^(docs\/waypoint|docs\/superpowers|\.forge|\.waypoint)\//.test(f);
        const grep = (w: string) => lines(git(['-c', 'core.quotePath=false', 'grep', '-l', '-I', '--fixed-strings', '-w', '-e', w])).filter(f => !bookkeeping(f));
        const tracked = lines(listed);
        const zoneFiles = planned ? tracked.filter(f => planned.zones.some(z => globMatch(z, f))) : [];
        const extra = planned ? { files: zoneFiles, zones: zonesFromPaths(planned.zones) } : undefined;
        const catalog = detectValidators(repoReader(repoDir), loadConfig(repoDir)).map(v => ({ name: v.name, cmd: v.cmd, kind: v.kind, source: v.source }));
        const names = catalog.map(v => v.name);
        const result = triage(task, { files: tracked, commits, gitOk: listed !== null, grep }, names, extra);
        if (planned?.zones.length && !zoneFiles.length) result.reasons.push('zones match no tracked file (new files?)');
        // The ratchet: a repeated triage of the same task never lowers the path it already reached.
        if (flag('task')) {
          const rank = (p: unknown) => PATH_ORDER.indexOf(p as PathName);
          const prior = readEvents(io.cwd).filter(e => e.kind === 'triage' && e.task === flag('task') && rank(e.path) >= 0)
            .reduce<PathName | null>((max, e) => (max === null || rank(e.path) > rank(max) ? e.path as PathName : max), null);
          if (prior && rank(prior) > rank(result.path)) {
            result.path = prior;
            result.reasons.push(`ratchet: kept ${prior} from an earlier triage of this task`);
          }
        }
        const known = readLocal(io.cwd).known;
        const fresh = names.filter(n => !known.includes(n));
        // `known` mirrors what exists now: new names are added, vanished ones dropped silently.
        if (fresh.length || known.some(n => !names.includes(n))) updateLocal(io.cwd, s => ({ ...s, known: names }));
        appendEvent(io.cwd, { ts: ts(), kind: 'triage', ...(flag('task') ? { task: flag('task') } : {}), ...result });
        return json({ ...result, catalog, new: fresh });
      }
      case 'validate': {
        const config = loadConfig(repoDir);
        const all = detectValidators(repoReader(repoDir), config);
        const p = flag('path');
        if (p !== undefined && !(PATH_ORDER as readonly string[]).includes(p)) throw new UsageError(`validate: --path must be one of ${PATH_ORDER.join('|')}`);
        let scope: Scope;
        if (has('final')) scope = { mode: 'final' };
        else if (!has('all') && flag('affected') !== undefined) scope = { mode: 'affected', files: flag('affected')!.split(',').map(s => s.trim()).filter(Boolean) };
        else if (p === 'trivial' || p === 'small') scope = { mode: 'small' };
        else {
          const base = flag('base');
          const diff = base ? (io.git ?? defaultGit(io.cwd))(['diff', '--name-only', `${base}..HEAD`]) : null;
          scope = { mode: 'heavy', changed: diff === null ? null : diff.split('\n').map(s => s.trim()).filter(Boolean) };
        }
        const list = selectValidators(all, scope);
        let results = runValidators(list, io.exec ?? defaultExec(io.cwd), config.validatorTimeoutSec);
        if (has('baseline')) {
          if (flag('baseline') === undefined) throw new UsageError('validate: --baseline needs the JSON a validate run printed on the base commit');
          let baseline: unknown;
          try { baseline = JSON.parse(readFileSync(path.resolve(io.cwd, flag('baseline')!), 'utf8')); } catch { throw new UsageError('validate: --baseline must be the JSON written by forge validate'); }
          results = markPreexisting(results, baseline);
        }
        const allOk = results.every(r => !blocking(r));
        appendEvent(io.cwd, { ts: ts(), kind: 'validate', ...(flag('task') ? { task: flag('task') } : {}), ...(has('base-run') ? { baseline: true } : {}), ok: allOk, results: results.map(r => ({ validator: r.validator, ok: r.ok, flaky: r.flaky, ...(r.skipped ? { skipped: r.skipped } : {}), ...(r.preexisting ? { preexisting: true } : {}), ...(r.ok ? {} : { failures: r.failures }) })) });
        const out = json(results, allOk ? 0 : 1);
        if (!list.length) out.stderr = all.length ? 'no validators cover the affected paths\n' : 'no validators detected: add tests or list validators in .forge/config.yaml\n';
        return out;
      }
      case 'verdict': {
        const task = flag('task');
        const dirArg = flag('dir');
        if (!task || !dirArg) throw new UsageError('verdict: --task and --dir are required');
        const dir = path.resolve(io.cwd, dirArg);
        const reviews: Partial<Record<ReviewerName, ReturnType<typeof parseReview>>> = {};
        for (const name of ['correctness', 'security', 'perf'] as const) {
          const file = path.join(dir, `${name}.json`);
          if (existsSync(file)) reviews[name] = parseReview(readFileSync(file, 'utf8'));
        }
        const verifyPath = path.join(dir, 'verify.json');
        const verifyFile = existsSync(verifyPath) ? parseVerifyFile(readFileSync(verifyPath, 'utf8')) : undefined;
        if (verifyFile !== undefined) reviews.verify = verifyReview(verifyFile);
        if (!Object.keys(reviews).length) throw new UsageError(`no reviews found in ${dirArg}`);
        let validatorsOk: boolean;
        let failing: FailingValidator[] = [];
        let preexisting: string[] = [];
        let recorded = true;
        if (flag('validators')) {
          let results: unknown;
          try { results = JSON.parse(readFileSync(path.resolve(io.cwd, flag('validators')!), 'utf8')); } catch { throw new UsageError('verdict: --validators must be the JSON written by forge validate'); }
          const arr = Array.isArray(results) ? results as { validator?: unknown; ok?: unknown; failures?: unknown; preexisting?: unknown }[] : [];
          validatorsOk = Array.isArray(results) && arr.every(r => r && typeof r === 'object' && !blocking(r));
          failing = arr.filter(r => r && typeof r === 'object' && blocking(r)).map(r => ({ validator: String(r.validator ?? ''), failures: Array.isArray(r.failures) ? r.failures.map(String) : [] }));
          preexisting = arr.filter(r => r && typeof r === 'object' && r.ok !== true && r.preexisting === true).map(r => String(r.validator ?? ''));
        } else {
          const lastValidate = [...readEvents(io.cwd)].reverse().find(e => e.kind === 'validate' && e.task === task && e.baseline !== true);
          recorded = lastValidate !== undefined;
          validatorsOk = lastValidate?.ok === true;
          const rs = Array.isArray(lastValidate?.results) ? lastValidate!.results as { validator?: unknown; ok?: unknown; failures?: unknown; preexisting?: unknown }[] : [];
          failing = rs.filter(r => r && blocking(r)).map(r => ({ validator: String(r.validator ?? ''), failures: Array.isArray(r.failures) ? r.failures.map(String) : [] }));
          preexisting = rs.filter(r => r && r.ok !== true && r.preexisting === true).map(r => String(r.validator ?? ''));
        }
        const result = synthesize(reviews, weightsFor({ sensitive: has('sensitive'), perf: has('perf') }), validatorsOk, failing);
        if (!recorded) result.reasons.push('no validation recorded');
        if (preexisting.length) result.reasons.push(`already failing on the base commit, not counted: ${preexisting.join(', ')}`);
        // dir lets `round` count a re-run verdict on the same review dir once.
        appendEvent(io.cwd, { ts: ts(), kind: 'verdict', task, dir: path.relative(io.cwd, dir).split(path.sep).join('/') || '.', action: result.action, score: result.score, signature: result.signature,
          critical: result.critical.length, important: result.important.length, minor: result.minor.length });
        if (verifyFile !== undefined) {
          const rel = path.relative(io.cwd, dir).split(path.sep).join('/');
          const evidence = rel.replace(/reviews-(\d+-\d+)$/, 'evidence/$1');
          appendEvent(io.cwd, { ts: ts(), kind: 'verify', task, result: verifyFile?.result ?? 'invalid',
            passed: verifyFile ? verifyFile.checks.filter(c => c.ok).length : 0, total: verifyFile ? verifyFile.checks.length : 0,
            ...(evidence !== rel ? { evidence } : {}), ...(verifyFile?.reason ? { reason: verifyFile.reason } : {}) });
        }
        return json(result);
      }
      case 'verify-cleanup': {
        const dir = flag('dir');
        if (!dir) throw new UsageError('verify-cleanup: --dir is required');
        let pids: number[] = [];
        try { const raw = JSON.parse(readFileSync(path.resolve(io.cwd, dir, 'pids.json'), 'utf8')); if (Array.isArray(raw)) pids = raw.filter((p): p is number => Number.isInteger(p)); } catch { pids = []; }
        const pgid = (pid: number): number | null => {
          try { const n = Number(execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()); return Number.isInteger(n) && n > 0 ? n : null; } catch { return null; }
        };
        const kill = (pid: number) => {
          try {
            if (process.platform === 'win32') execFileSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true });
            else process.kill(killTarget(pid, pgid(pid)), 'SIGTERM');
            return true;
          } catch {
            try { process.kill(pid, 'SIGTERM'); return true; } catch { return false; }
          }
        };
        return json(cleanupPids(pids, kill));
      }
      case 'round': {
        const task = flag('task');
        const p = flag('path');
        if (!task || (p !== 'medium' && p !== 'large')) throw new UsageError('round: --task and --path medium|large are required');
        const verdicts = readEvents(io.cwd)
          .filter(e => e.kind === 'verdict' && e.task === task && (e.action === 'accept' || e.action === 'fix' || e.action === 'redo'));
        // Only the last verdict per review dir counts: re-running a verdict (e.g. when resuming) is not a new round.
        const lastPerDir = new Map<string, number>();
        verdicts.forEach((e, i) => { if (typeof e.dir === 'string') lastPerDir.set(e.dir, i); });
        const history = verdicts
          .filter((e, i) => typeof e.dir !== 'string' || lastPerDir.get(e.dir) === i)
          .map(e => ({ action: e.action as Action, score: typeof e.score === 'number' ? e.score : null, signature: String(e.signature ?? '') }));
        const d = decideRound(history, p);
        appendEvent(io.cwd, { ts: ts(), kind: 'round', task, ...d });
        return json(d);
      }
      case 'proposals': {
        const [sub, ...rest] = args;
        const subFlag = (name: string) => {
          const i = rest.indexOf(`--${name}`);
          const v = i >= 0 ? rest[i + 1] : undefined;
          return v === undefined || v.startsWith('--') ? undefined : v;
        };
        const writeOf = (d: { status: string; reason?: string }, by: string, at: string) => {
          const w: Record<string, string> = { status: d.status, decidedBy: by, decidedAt: at };
          if (d.reason) w.reason = d.reason;
          return w;
        };
        const readText = (f: string, what: string) => { try { return readFileSync(path.resolve(io.cwd, f), 'utf8'); } catch { throw new UsageError(`proposals: cannot read ${what}`); } };
        switch (sub) {
          case 'add': {
            const file = subFlag('file');
            if (!file) throw new UsageError('proposals add: --file is required');
            let raw: unknown;
            try { raw = JSON.parse(readText(file, '--file')); } catch (e) { if (e instanceof UsageError) throw e; throw new UsageError('proposals add: --file must be a JSON object'); }
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new UsageError('proposals add: --file must be a JSON object');
            const o = raw as Record<string, unknown>;
            const doc = normalizeProposal({ ...o, ts: typeof o.ts === 'string' ? o.ts : ts(), status: 'proposed', decidedBy: undefined, decidedAt: undefined, reason: undefined, taskId: undefined, author: subFlag('author') ?? o.author ?? 'session' });
            if (!doc) throw new UsageError('proposals add: invalid proposal (category, risk, title and source are required and must be valid)');
            if (doc.source === 'scout' && (!doc.pillar?.trim() || !doc.evidence?.trim())) throw new UsageError('proposals add: a scout proposal needs a pillar and evidence');
            // Anti-repetition: a hit means the evidence adds nothing new to a rejected proposal.
            const existing = loadProposals(io.cwd);
            const hit = similarRejected(doc, existing.filter(p => p.status === 'rejected'));
            if (hit) return { code: 3, stdout: '', stderr: `proposals add: similar to rejected proposal ${hit} and without new evidence\n` };
            // Nor a repeat of one still open (pending or being done), whatever its evidence; a v2 names the
            // proposal it revises with --revises, and only that one is exempt.
            const revises = subFlag('revises');
            if (has('revises') && (!revises || !PROPOSAL_ID.test(revises))) throw new UsageError('proposals add: --revises needs a proposal id');
            const open = similarOpen(doc, existing.filter(p => p.id !== revises));
            if (open) return { code: 3, stdout: '', stderr: `proposals add: similar to open proposal ${open}\n` };
            const id = proposalId(io.now(), io.rand ?? Math.random);
            saveProposal(io.cwd, id, doc);
            appendEvent(io.cwd, { ts: ts(), kind: 'proposal', action: 'add', id });
            return json({ id, doc });
          }
          case 'list': {
            const status = subFlag('status');
            if (status !== undefined && !(PROPOSAL_STATUSES as readonly string[]).includes(status)) throw new UsageError(`proposals list: --status must be one of ${PROPOSAL_STATUSES.join('|')}`);
            const all = loadProposals(io.cwd).filter(p => status === undefined || p.status === status);
            all.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : a.id < b.id ? 1 : -1));
            return json(all);
          }
          case 'decide': {
            const [id, action] = rest;
            if (!id || !PROPOSAL_ID.test(id)) throw new UsageError('proposals decide: a proposal id (p + 14 digits + 4 letters/digits) is required');
            if (action !== 'approve' && action !== 'reject' && action !== 'discuss') throw new UsageError('proposals decide: action must be approve|reject|discuss');
            const rf = subFlag('reason-file');
            const reason = rf !== undefined ? readText(rf, '--reason-file').trim() : undefined;
            const by = subFlag('by') ?? 'user';
            const at = ts();
            const from = subFlag('from');
            if (from !== undefined) {
              // Roadmap path: validate against the db doc only; nothing is written or logged until
              // the roadmap update succeeds and the skill runs `proposals save`.
              let base: ReturnType<typeof normalizeProposal>;
              try { base = normalizeProposal(JSON.parse(readText(from, '--from'))); } catch (e) { if (e instanceof UsageError) throw e; base = null; }
              if (!base) throw new UsageError('proposals decide: --from must be a valid proposal doc');
              const r = decideDoc(base, action as Decision, by, at, reason || undefined);
              if (!r.ok) throw new UsageError(`proposals decide: ${id} is already decided`);
              return json({ id, status: r.doc.status, write: writeOf(r.doc, by, at) });
            }
            const r = decideLocal(io.cwd, id, action as Decision, by, at, reason || undefined);
            if (!r.ok) throw new UsageError(r.error === 'missing' ? `proposals decide: ${id} not found` : `proposals decide: ${id} is already decided`);
            appendEvent(io.cwd, { ts: at, kind: 'proposal', action: 'decide', id, status: r.doc.status });
            return json({ id, status: r.doc.status, write: writeOf(r.doc, by, at) });
          }
          case 'save': {
            const from = subFlag('from');
            if (!from) throw new UsageError('proposals save: --from is required');
            const id = subFlag('id') ?? path.basename(from).replace(/(\.db)?\.json$/, '');
            if (!PROPOSAL_ID.test(id)) throw new UsageError('proposals save: a proposal id (p + 14 digits + 4 letters/digits) is required (--id, or a <id>.json / <id>.db.json file name)');
            let doc: ReturnType<typeof normalizeProposal>;
            try { doc = normalizeProposal(JSON.parse(readText(from, '--from'))); } catch (e) { if (e instanceof UsageError) throw e; doc = null; }
            if (!doc) throw new UsageError('proposals save: --from must be a valid proposal doc');
            const { previous } = mirrorProposal(io.cwd, id, doc);
            const logged = (previous ?? 'proposed') !== doc.status;
            if (logged) appendEvent(io.cwd, { ts: ts(), kind: 'proposal', action: 'decide', id, status: doc.status });
            return json({ id, status: doc.status, previous, logged });
          }
          case 'pull': {
            const dir = subFlag('dir');
            if (!dir) throw new UsageError('proposals pull: --dir is required');
            const abs = path.resolve(io.cwd, dir);
            let names: string[];
            if (!existsSync(abs)) return ok('0');
            try { names = readdirSync(abs); } catch { throw new UsageError(`proposals pull: cannot read ${dir}`); }
            let n = 0;
            for (const name of names.sort()) {
              if (!name.endsWith('.json')) continue;
              const id = name.slice(0, -5);
              if (!PROPOSAL_ID.test(id)) continue;
              let doc;
              try { doc = normalizeProposal(JSON.parse(readFileSync(path.join(abs, name), 'utf8'))); } catch { continue; }
              if (!doc) continue;
              saveProposal(io.cwd, id, doc);
              n++;
            }
            return ok(String(n));
          }
          case 'policy': {
            const id = rest[0];
            if (!id || !PROPOSAL_ID.test(id)) throw new UsageError('proposals policy: a proposal id is required');
            const found = loadProposals(io.cwd).find(p => p.id === id);
            if (!found) throw new UsageError(`proposals policy: ${id} not found`);
            const { id: _id, ...doc } = found;
            if (doc.status !== 'proposed' || !autoApprovable(doc)) {
              appendEvent(io.cwd, { ts: ts(), kind: 'proposal', action: 'policy', id, status: doc.status });
              return json({ id, status: doc.status, write: null });
            }
            const at = ts();
            saveProposal(io.cwd, id, { ...doc, status: 'auto_approved', decidedBy: 'forge:policy', decidedAt: at });
            appendEvent(io.cwd, { ts: at, kind: 'proposal', action: 'policy', id, status: 'auto_approved' });
            return json({ id, status: 'auto_approved', write: { status: 'auto_approved', decidedBy: 'forge:policy', decidedAt: at } });
          }
          case 'to-task': {
            const id = rest[0];
            if (!id || !PROPOSAL_ID.test(id)) throw new UsageError('proposals to-task: a proposal id is required');
            const planArg = subFlag('plan');
            if (!planArg) throw new UsageError('proposals to-task: --plan is required');
            const found = loadProposals(io.cwd).find(p => p.id === id);
            if (!found) throw new UsageError(`proposals to-task: ${id} not found`);
            if (!isActionable(found)) throw new UsageError(`proposals to-task: ${id} is not approved`);
            if (found.taskId !== undefined) throw new UsageError(`proposals to-task: ${id} already has task ${found.taskId}`);
            const text = readText(planArg, '--plan');
            let plan;
            try { plan = parsePlan(text); } catch (e) {
              if (e instanceof PlanError) throw new UsageError(`${planArg}: ${e.issues.join('; ')}`);
              throw e;
            }
            const { task, phase } = proposalToTask(plan, found, { track: subFlag('track') });
            // The Document API keeps comments and order; values are nodes, never spliced into text.
            const ydoc = parseDocument(text);
            if (phase) ydoc.addIn(['phases'], ydoc.createNode(phase));
            ydoc.addIn(['tasks'], ydoc.createNode(task));
            const next = String(ydoc);
            try { parsePlan(next); } catch (e) {
              if (e instanceof PlanError) throw new UsageError(`proposals to-task: the resulting plan is invalid: ${e.issues.join('; ')}`);
              throw e;
            }
            writeFileSync(path.resolve(io.cwd, planArg), next);
            const { id: _id, ...doc } = found;
            saveProposal(io.cwd, id, { ...doc, taskId: task.id });
            appendEvent(io.cwd, { ts: ts(), kind: 'proposal', action: 'to-task', id, taskId: task.id });
            return json({ id, taskId: task.id, write: { taskId: task.id } });
          }
          default:
            throw new UsageError('usage: forge proposals <add|list|decide|save|pull|policy|to-task> ...');
        }
      }
      case 'surfaces': {
        const [sub] = args;
        if (sub === undefined || sub.startsWith('--')) {
          const surfaces = readSurfaces(io.cwd);
          const local = readLocal(io.cwd);
          const drafts = detectDrafts(repoReader(repoDir)).filter(d => !surfaces.some(s => s.name === d.name) && !local.proposed.includes(d.name));
          return json({ surfaces, drafts });
        }
        const name = flag('name');
        if (!name || !NAME.test(name)) throw new UsageError(`surfaces ${sub}: --name must match ${NAME}`);
        if (sub === 'proposed') { updateLocal(io.cwd, s => ({ ...s, proposed: [...new Set([...s.proposed, name])] })); return ok('ok'); }
        if (sub === 'learn') {
          const file = path.join(io.cwd, surfaceFile(name));
          if (!existsSync(file)) throw new UsageError(`surfaces learn: ${surfaceFile(name)} does not exist`);
          if (lstatSync(file).isSymbolicLink()) throw new UsageError(`surfaces learn: ${surfaceFile(name)} is a symlink`);
          let notes: unknown;
          try { notes = JSON.parse(readFileSync(path.resolve(io.cwd, flag('notes-file') ?? ''), 'utf8')); } catch { throw new UsageError('surfaces learn: --notes-file must be a JSON array of strings'); }
          if (!Array.isArray(notes) || !notes.every(n => typeof n === 'string' && n.trim())) throw new UsageError('surfaces learn: --notes-file must be a JSON array of strings');
          const before = readFileSync(file, 'utf8');
          const r = appendLearned(before, ts().slice(0, 10), notes as string[], flag('heading') ?? 'Learned');
          writeFileSync(file, r.text);
          const cur = readLocal(io.cwd).surfaces[name];
          if (cur && cur.state === 'allowed' && cur.hash === surfaceHash(before)) updateLocal(io.cwd, s => ({ ...s, surfaces: { ...s.surfaces, [name]: { ...cur, hash: surfaceHash(r.text) } } }));
          return json({ name, count: r.count });
        }
        throw new UsageError('usage: forge surfaces [learn --name N --notes-file F [--heading H] | proposed --name N]');
      }
      case 'tools': {
        const all = readSurfaces(io.cwd);
        const one = flag('surface');
        const picked = one === undefined ? all : all.filter(s => s.name === one);
        if (one !== undefined && !picked.length) throw new UsageError(`tools: no surface ${one} in .forge/verify/`);
        return json(checkTools(picked.flatMap(s => s.tools), { onPath, exec: io.exec ?? defaultExec(io.cwd) }));
      }
      case 'verify-plan': {
        const task = flag('task'), p = flag('path'), base = flag('base');
        if (!task || !p || !base) throw new UsageError('verify-plan: --task, --path and --base are required');
        if (!(PATH_ORDER as readonly string[]).includes(p)) throw new UsageError(`verify-plan: --path must be one of ${PATH_ORDER.join('|')}`);
        const diff = (io.git ?? defaultGit(io.cwd))(['diff', '--name-only', `${base}..HEAD`]);
        const plan = verifyPlan({
          path: p, asked: has('asked'),
          changed: diff === null ? null : diff.split('\n').map(s => s.trim()).filter(Boolean),
          surfaces: readSurfaces(io.cwd), drafts: detectDrafts(repoReader(repoDir)), local: readLocal(io.cwd),
          missing: s => missingTools(s.tools, onPath),
        });
        appendEvent(io.cwd, { ts: ts(), kind: 'verify', task, planned: plan.eligible, surfaces: plan.surfaces.filter(s => s.permission === 'allowed').map(s => s.name) });
        return json(plan);
      }
      case 'local': {
        const [sub, key, value] = args;
        if (sub === 'get') {
          const s = readLocal(io.cwd);
          if (key === undefined) return json(s);
          const m = /^surfaces\.(.+)$/.exec(key);
          if (!m) throw new UsageError('local get: the path must be surfaces.<name>');
          return json(s.surfaces[m[1]] ?? null);
        }
        if (sub === 'set') {
          const m = /^surfaces\.(.+)$/.exec(key ?? '');
          if (!m || !NAME.test(m[1])) throw new UsageError('local set: the path must be surfaces.<name>');
          if (value !== 'allowed' && value !== 'denied' && value !== 'none') throw new UsageError('local set: the value must be allowed|denied|none');
          // An allowance is tied to what the surface says now: a later edit of the file asks again (verify-plan: changed).
          const surface = readSurfaces(io.cwd).find(x => x.name === m[1]);
          if (value === 'allowed' && !surface) throw new UsageError(`local set: .forge/verify/${m[1]}.md does not exist`);
          updateLocal(io.cwd, s => {
            const surfaces = { ...s.surfaces };
            if (value === 'none') delete surfaces[m[1]];
            else surfaces[m[1]] = { state: value, hash: value === 'allowed' ? surface!.hash : null };
            return { ...s, surfaces };
          });
          return ok('ok');
        }
        throw new UsageError('usage: forge local get [surfaces.<name>] | set surfaces.<name> allowed|denied|none');
      }
      case 'swarm':
        return swarmCommand(args, io, {
          git: io.git ?? defaultGit(io.cwd), exec: io.exec ?? defaultExec(io.cwd), repo: repoReader(repoDir),
          at: dir => ({ git: defaultGit(dir), exec: defaultExec(dir), repo: repoReader(dir) }),
        });
      case 'hook': {
        return { code: 0, stdout: args[0] === 'stop' ? hookStop(io) : args[0] === 'live' ? hookLive(io) : '', stderr: '' };
      }
      case 'infinite': {
        const sub = args[0];
        if (sub === 'start') {
          const num = (name: string, valid: (n: number) => boolean, what: string) => {
            if (!has(name)) return undefined;
            const v = flag(name);
            const n = v !== undefined && /^\d+(\.\d+)?$/.test(v) ? Number(v) : NaN;
            if (!valid(n)) throw new UsageError(`infinite start: --${name} must be ${what}`);
            return n;
          };
          const posInt = (n: number) => Number.isInteger(n) && n > 0;
          const cycles = num('cycles', posInt, 'a positive integer');
          const hours = num('hours', n => Number.isFinite(n) && n > 0, 'a positive number');
          const queueMax = num('queue-max', posInt, 'a positive integer');
          const session = flag('session');
          if (has('session') && !session) throw new UsageError('infinite start: --session needs a session id');
          if (cycles === undefined && hours === undefined) throw new UsageError('infinite start: a budget is required (--cycles N and/or --hours H)');
          // An active run blocks a new one only while nothing stops it: a run whose stop reason is already due
          // (e.g. its session died after a budget ran out or a stop was asked) is replaced.
          const current = parseRun(readRunText(io.cwd));
          if (current?.active && stopReason(current, stopContext(io.cwd, io.now())) === null) throw new UsageError('infinite start: a run is already active (forge stop, or forge infinite status)');
          forgeDir(io.cwd);
          rmSync(stopFile(io.cwd), { force: true });
          const run: RunState = startRun(io.now(), { ...(cycles !== undefined ? { cycles } : {}), ...(hours !== undefined ? { hours } : {}) }, queueMax, session ?? null);
          saveRun(io.cwd, run);
          return json(run);
        }
        if (sub === 'status') {
          const text = readRunText(io.cwd);
          const run = parseRun(text);
          const reason = run?.active ? stopReason(run, stopContext(io.cwd, io.now())) : null;
          return json({ present: text !== null, valid: run !== null, run, stopReason: reason });
        }
        throw new UsageError('usage: forge infinite <start --cycles N|--hours H [--queue-max N] [--session ID]|status>');
      }
      case 'cycle': {
        const progress = flag('progress');
        if (progress !== 'yes' && progress !== 'no') throw new UsageError('cycle: --progress yes|no is required');
        let error: string | undefined;
        if (flag('error-file') !== undefined) {
          try { error = readFileSync(path.resolve(io.cwd, flag('error-file')!), 'utf8'); } catch { throw new UsageError('cycle: cannot read --error-file'); }
        }
        const current = parseRun(readRunText(io.cwd));
        if (!current?.active) throw new UsageError('cycle: no active run (forge infinite start)');
        const next = recordCycle(current, { progress: progress === 'yes', ...(error !== undefined ? { error } : {}) });
        saveRun(io.cwd, next);
        appendEvent(io.cwd, { ts: ts(), kind: 'cycle', cycle: next.cycle, progress: progress === 'yes', ...(next.lastError ? { error: next.lastError } : {}) });
        return json(next);
      }
      case 'stop': {
        forgeDir(io.cwd);
        // The stop file stays so the bound session, if alive, exits cleanly; the run is closed here so a dead
        // session never keeps it active.
        writeFileSync(stopFile(io.cwd), `${ts()}\n`);
        const current = parseRun(readRunText(io.cwd));
        if (current?.active) {
          saveRun(io.cwd, endRun(current, 'stopped'));
          appendEvent(io.cwd, { ts: ts(), kind: 'cycle', action: 'stopped', reason: 'stopped' });
        }
        const exec = readExecution(io.cwd);
        if (exec?.active) saveExecution(io.cwd, { ...exec, active: false, stopReason: 'stopped', sleepUntil: null });
        return ok('ok');
      }
      case 'waypoint-cli': {
        const found = findWaypointCli(io.scriptPath ?? process.argv[1] ?? '');
        if (!found) throw new UsageError('waypoint-cli: waypoint.cjs not found next to this forge install; is the waypoint plugin installed?');
        return ok(found);
      }
      case 'agents': {
        const { profile } = loadConfig(io.cwd);
        return json({ profile, agents: Object.fromEntries(ROLES.map(r => [r, agentFor(r, profile)])) });
      }
      case 'last': {
        const task = flag('task');
        if (!task) throw new UsageError('last: --task is required');
        const events = readEvents(io.cwd).filter(e => e.task === task);
        const lastOf = (kind: LedgerKind) => [...events].reverse().find(e => e.kind === kind);
        return json({
          task,
          path: lastOf('triage')?.path ?? null,
          phase: lastOf('phase') ?? null,
          verdict: lastOf('verdict') ?? null,
          round: lastOf('round') ?? null,
          events: events.length,
        });
      }
      default:
        return { code: 2, stdout: '', stderr: `${USAGE}\n` };
    }
  } catch (e) {
    if (e instanceof UsageError || e instanceof ConfigError) return { code: 2, stdout: '', stderr: `${e.message}\n` };
    return { code: 1, stdout: '', stderr: `forge: ${(e as Error).message}\n` };
  }
}
