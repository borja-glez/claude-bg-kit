import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, statSync, lstatSync, realpathSync, readFileSync, readdirSync, openSync, closeSync, fstatSync, readSync, rmSync, mkdtempSync, writeFileSync, mkdirSync, renameSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { appendEvent, readEvents, forgeDir, withEventContext, LEDGER_KINDS, type EventContext, type LedgerKind, type LedgerEvent } from '../ledger.js';
import { parseRun, startRun, recordCycle, stopReason, endRun, readRunText, saveRun, stopFile, type RunState, type StopContext } from '../run.js';
import { decideStop, decideExecutionStop, UNBOUND_WARNING } from '../hook.js';
import { readExecution, updateExecution, runWorktree, executionTaskFile, writePublicTask, executionHolding, eventsSince } from '../execution.js';
import { planLocale, replyIn, sessionReply } from '../../lib/locale.js';
import { isLocale } from '../../lib/forge-run.js';
import { isSafeId, normalizePublicTask, type PublicTask } from '../../lib/execution-state.js';
import { samePath } from '../../lib/worktree.js';
import { parseStatus, parseSnapshot, treeCheck, type TreeSnapshot } from '../tree.js';
import { triage, implementerFor, zonesFromPaths, announce, announceReview, isBookkeeping, parseNumstat, diffPath, isPerfTask, reviewFor, PATH_ORDER, ZONE_ORDER, type PathName, type AnnounceLocale, type TriageResult } from '../triage.js';
import { parsePlan, PlanError, isPlanId } from '../../lib/plan.js';
import { renderBrief, taskText, tddLine, parsePrior, priorSection, type PriorCommit } from '../brief.js';
import { renderThreatModel } from '../threat-model.js';
import { loadConfig, configValue, agentFor, ROLES, ConfigError, NAME, WORKFLOWS, AUTONOMIES, type Profile, type Workflow } from '../config.js';
import { resolvePrefs, isWorkflow, isAutonomy } from '../prefs.js';
import { parseReview, parseVerifyFile, verifyReview, weightsFor, synthesize, type ReviewerName, type FailingValidator, type VerifyFile } from '../verdict.js';
import { PROPOSAL_ID, proposalId, saveProposal, loadProposals, loadProposal, decideDoc, mirrorProposal, saveApproval, loadApproval, loadApprovals, removeApproval, type DecideError } from '../proposals.js';
import { normalizeProposal, isActionable, canDecide, markMatches, normalizeApproval, ownerCheck, ownerApproved, proposalDigest, PROPOSAL_STATUSES, type Decision, type ProposalDoc, type ApprovalDoc } from '../../lib/proposals.js';
import { PAGE_RULES } from '../../lib/publish.js';
import { autoApprovable, similarRejected, similarOpen } from '../policy.js';
import { proposalToTask, proposalOfIncludes, proposalsOfIncludes } from '../to-task.js';
import type { PlanTask } from '../../lib/types.js';
import { parseDocument } from 'yaml';
import { claudeSessionId, noClaudeSession } from '../../lib/claude-session.js';
import { UsageError } from './errors.js';
import { swarmCommand, releaseWrites, restoringRegenerated, runSetup } from './swarm.js';
import { reviewCommand } from './review.js';
import { roadmapCommand } from './roadmap.js';
import { readKeptAssets, runHolding } from '../roadmap-sources.js';
import { infinitePublish } from '../infinite-doc.js';
import type { fitForgeDoc } from '../../lib/roadmap-doc.js';
import { swarmStep } from './step.js';
import { runWithCache, cacheGit, checkoutPrefix } from '../validate-cache.js';
import { roundDecision } from '../round.js';
import { keepEvidence } from '../evidence-copy.js';
import { baseOf, eventsOf, isTask, projectOf, projectOfDir, readWorkDir, resolveProject, workRel } from '../task-ref.js';
import { computeStats, renderStats, type PlanStates } from '../stats.js';
import { detectValidators, selectValidators, runValidators, markPreexisting, blocking, globMatch, onPath, runOptions, validateEvent, planAffected, type ExecMany, type RepoReader, type Scope, type Validator, type ValidatorResult } from '../validators.js';
import { checkTools, mcpInventory, toolGaps } from '../tools.js';
import { verifyPlan, cleanupPids, killTarget, askFor, capLines, relabelDiff, type PlanSurface } from '../verify.js';
import { readLocal, updateLocal, mainCheckout, readLearned, recordLearned, OBJECT_ID, type SurfacePermission } from '../local.js';
import { memberForHook, allMembersOf, memberFile } from '../members.js';
import { hookLive } from '../live.js';
import { hookRoute } from '../route-hooks.js';
import { liveJobs, noSlot, slotFor, withJob, writeJsonAtomic, type Slot } from '../jobs.js';
import { sleepSync } from '../pid.js';
import { readSurfaces, detectDrafts, appendLearned, surfaceFile, permissionHash, hashMatches, LEARNED_HEADINGS, type Surface } from '../surfaces.js';
import { addDecision, allDecisions, listDecisions, renderDecisionsMd, decisionNoteId, decisionWrites, NOTE_ID, DecisionInputError } from '../decisions.js';
import { normalizeNote } from '../../lib/notes.js';
import { TASK_ID, decisionScope, scopeFileName } from '../../lib/decisions.js';
import { claudeConfigDir, claudeJsonDir, locateSuperpowersFor, spLedgerDone, spPlans, spSkillPath, spSpecs } from '../superpowers.js';
import { ROUTE_OPTIONS, ROUTE_STAGES, firstStage, isRoutePath, isRouteSession, pruneRoutes, readRoute, routeAsk, routeOptions, writeRoute, type RouteDoc, type RouteOption, type RouteStage } from '../route.js';
import { checkSpTask, markDone, parseSpPlan, renderSpBrief, SpPlanError } from '../../lib/sp-plan.js';

export interface ExecResult { code: number; output: string; ms: number; timedOut: boolean }
export interface Io { cwd: string; workdir?: string; now: () => Date; exec?: (cmd: string, timeoutSec: number) => ExecResult; execMany?: ExecMany; git?: (args: string[]) => string | null; scriptPath?: string; rand?: () => number; stdin?: string; sleep?: (ms: number) => void; env?: Record<string, string | undefined>; slot?: Slot; roadmapFit?: typeof fitForgeDoc }
type Result = { code: number; stdout: string; stderr: string };

const USAGE = 'usage: forge <triage|brief|validate|stats|verdict|round|review-prep|review-close|prep|shadow|log|decision|agents|last|proposals|surfaces|tools|local|prefs|route|verify-plan|verify-result|verify-cleanup|verify-close|waypoint-cli|sp-path|sp-specs|sp-plans|sp-plan|tdd|tree|config|infinite|cycle|swarm|setup|stop|hook|roadmap-doc|roadmap-run> ...';
const MAX_OUTPUT = 4 * 1024 * 1024;
const MAX_GIT_OUTPUT = 256 * 1024 * 1024;
const MAX_WHY = 200;

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

// Runs inside one node process for a whole batch (execMany): argv = [specFile] (after `--`). The spec holds the commands,
// each with its log file, the timeout in ms, how many run at once and the file for the results. Each command runs
// through the shell with stdio on its log and its own timer, which kills its whole process tree as WRAPPER_SOURCE does
// (taskkill /T on Windows, the process group elsewhere) and records the timeout exit code with timedOut. When every
// command has ended it writes [{code, ms, timedOut}] in the commands' order and exits 0.
const MANY_WRAPPER_SOURCE = `
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const spec = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
const win = process.platform === 'win32';
const results = new Array(spec.cmds.length);
let next = 0, running = 0, done = 0;
const finish = () => { fs.writeFileSync(spec.out, JSON.stringify(results)); process.exit(0); };
const start = () => {
  while (running < spec.concurrency && next < spec.cmds.length) {
    const i = next++;
    running++;
    const t0 = Date.now();
    const fd = fs.openSync(spec.cmds[i].log, 'a');
    let timedOut = false, settled = false, timer = null;
    const settle = code => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { fs.closeSync(fd); } catch {}
      results[i] = { code, ms: Date.now() - t0, timedOut };
      running--; done++;
      if (done === spec.cmds.length) finish(); else start();
    };
    let child;
    try { child = spawn(spec.cmds[i].cmd, { shell: true, stdio: ['ignore', fd, fd], detached: !win, windowsHide: true }); }
    catch (e) { try { fs.writeSync(fd, 'spawn error: ' + e.message + require('os').EOL); } catch {} settle(127); continue; }
    timer = setTimeout(() => {
      timedOut = true;
      try {
        if (win) execFileSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore', windowsHide: true });
        else process.kill(-child.pid, 'SIGKILL');
      } catch {}
      settle(${TIMEOUT_EXIT});
    }, spec.timeoutMs);
    child.on('error', e => { try { fs.writeSync(fd, 'spawn error: ' + e.message + require('os').EOL); } catch {} settle(127); });
    child.on('exit', code => settle(code === null ? 1 : code));
  }
};
if (!spec.cmds.length) finish(); else start();
`;

// A batch of commands in one spawnSync of MANY_WRAPPER_SOURCE (C-12): the CLI stays synchronous, and each command keeps
// its own log, code and timeout. The batch's own timeout is the per-command one times the waves, plus 15 s.
export function defaultExecMany(cwd: string): ExecMany {
  return (cmds: string[], timeoutSec: number, concurrency: number): ExecResult[] => {
    const t0 = Date.now();
    let dir: string | undefined;
    try {
      dir = mkdtempSync(path.join(tmpdir(), 'forge-many-'));
      const logs = cmds.map((_, i) => path.join(dir!, `${i}.log`));
      for (const l of logs) writeFileSync(l, '');
      const out = path.join(dir, 'out.json');
      const spec = path.join(dir, 'spec.json');
      const width = Math.max(1, Math.min(Math.floor(concurrency) || 1, cmds.length || 1));
      writeFileSync(spec, JSON.stringify({ cmds: cmds.map((cmd, i) => ({ cmd, log: logs[i] })), timeoutMs: timeoutSec * 1000, concurrency: width, out }));
      const r = spawnSync(process.execPath, ['-e', MANY_WRAPPER_SOURCE, '--', spec], {
        cwd, windowsHide: true, timeout: timeoutSec * 1000 * Math.ceil(cmds.length / width) + 15000, stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8', maxBuffer: 64 * 1024,
      });
      let rows: unknown = null;
      try { rows = JSON.parse(readFileSync(out, 'utf8')); } catch { rows = null; }
      const err = r.error as NodeJS.ErrnoException | undefined;
      return cmds.map((_, i) => {
        let output = '';
        let fd: number | undefined;
        try { fd = openSync(logs[i], 'r'); output = readTail(fd); } catch { output = ''; } finally { if (fd !== undefined) { try { closeSync(fd); } catch { /* ignore */ } } }
        const row = Array.isArray(rows) ? rows[i] as { code?: unknown; ms?: unknown; timedOut?: unknown } | null : null;
        if (row && typeof row.code === 'number') return { code: row.code, output, ms: typeof row.ms === 'number' ? row.ms : Date.now() - t0, timedOut: row.timedOut === true };
        // The batch itself died (its own timeout, a crash): a command without a result fails and says why.
        const why = err ? err.message : (r.stderr || 'the batch of validators ended early').trim();
        return { code: 1, output: `${output}${output && !output.endsWith('\n') ? '\n' : ''}forge: ${why}\n`, ms: Date.now() - t0, timedOut: err?.code === 'ETIMEDOUT' };
      });
    } catch (e) {
      return cmds.map(() => ({ code: 1, output: `forge: could not run the commands: ${(e as Error).message}\n`, ms: Date.now() - t0, timedOut: false }));
    } finally {
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

/** Why `proposals decide` refused, naming who decided and when, or what blocks the reopen. */
function decideRefusal(id: string, doc: ProposalDoc, error: DecideError): string {
  if (doc.status === 'done') return `${id} is done and cannot be reopened`;
  switch (error) {
    case 'decided': {
      const who = `${doc.status}${doc.decidedBy ? ` by ${doc.decidedBy}` : ''}${doc.decidedAt ? ` at ${doc.decidedAt}` : ''}`;
      return `${id} is already decided (${who}); use --reopen after the person confirms`;
    }
    case 'done': return `${id} is done and cannot be reopened`;
    case 'tasked': return `${id} has task ${doc.taskId}; drop the task from the plan (and the taskId) before reopening it`;
    case 'same': return `${id} is already ${doc.status}`;
    case 'discuss': return '--reopen takes approve or reject, not discuss';
    case 'open': return `${id} is ${doc.status}, not decided: decide it without --reopen`;
  }
}

/**
 * The tasks of --plan (a usage error when it cannot be read or parsed), else of every docs/waypoint/<project>/plan.yaml
 * (an unreadable or broken one is skipped).
 */
function planTasksFor(cwd: string, planArg: string | undefined): PlanTask[] {
  if (planArg) {
    let text: string;
    try { text = readFileSync(path.resolve(cwd, planArg), 'utf8'); } catch { throw new UsageError(`cannot read plan ${planArg}`); }
    try { return parsePlan(text).tasks; } catch (e) {
      if (e instanceof PlanError) throw new UsageError(`${planArg}: ${e.issues.join('; ')}`);
      throw new UsageError(`${planArg}: not a valid plan`);
    }
  }
  const docs = path.join(cwd, 'docs', 'waypoint');
  let projects: string[];
  try { projects = readdirSync(docs); } catch { return []; }
  return projects.flatMap(p => { try { return parsePlan(readFileSync(path.join(docs, p, 'plan.yaml'), 'utf8')).tasks; } catch { return []; } });
}

/** Each docs/waypoint/<p>/plan.yaml of `main` with its roadmap states cached in .waypoint/<p>/dbcache/state (FORGE stats).
 *  An unreadable plan is skipped; a corrupt state doc counts as none. */
function planStates(main: string): PlanStates[] {
  const docs = path.join(main, 'docs', 'waypoint');
  let projects: string[];
  try { projects = readdirSync(docs); } catch { return []; }
  const out: PlanStates[] = [];
  for (const p of projects) {
    let tasks: PlanTask[];
    try { tasks = parsePlan(readFileSync(path.join(docs, p, 'plan.yaml'), 'utf8')).tasks; } catch { continue; }
    const dir = path.join(main, '.waypoint', p, 'dbcache', 'state');
    const states: Record<string, unknown> = {};
    let names: string[] = [];
    try { names = readdirSync(dir).filter(f => f.endsWith('.json')); } catch { names = []; }
    for (const f of names) { try { states[f.slice(0, -5)] = JSON.parse(readFileSync(path.join(dir, f), 'utf8')); } catch { /* skipped */ } }
    out.push({ project: p, tasks, states });
  }
  return out;
}

/**
 * The task that holds a proposal in the plans: one made from it (its `includes` ends with the proposal marker), or
 * the task `taskId` names while a plan still has it. A taskId whose task was dropped holds nothing.
 */
function heldTask(tasks: PlanTask[], id: string, taskId: string | undefined): string | undefined {
  return tasks.find(t => proposalOfIncludes(t.includes) === id)?.id ?? (taskId !== undefined && tasks.some(t => t.id === taskId) ? taskId : undefined);
}

// A superpowers plan with the tasks its own executors recorded as complete counted as done (they never tick the boxes).
const spPlanDone = (text: string, abs: string, dir: string) => markDone(parseSpPlan(text), spLedgerDone([dir, mainCheckout(dir)], abs));

// The number of a `### Task N` of a superpowers plan, from --task.
function spTaskNumber(v: string | undefined): number {
  if (v === undefined || !/^\d{1,4}$/.test(v) || Number(v) < 1) throw new UsageError('--task must be the number of a task of the superpowers plan');
  return Number(v);
}

export { roundDecision };

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

// superpowers as installed for this repository: for the checkout itself or for its main checkout (which holds the project
// settings and is a worktree's projectPath), as mcpOf reads the MCP servers.
const superpowersOf = (io: Io, dir: string) => locateSuperpowersFor(claudeConfigDir(io.env ?? process.env), [dir, mainCheckout(dir)]);

// The MCP servers Claude Code has for this repository, as the checkout itself and as its main checkout (where Claude
// Code keeps a worktree's project entry).
function mcpOf(io: Io, dir: string): Set<string> {
  const env = io.env ?? process.env;
  const out = new Set<string>();
  for (const projectDir of new Set([path.resolve(dir), path.resolve(mainCheckout(dir))])) {
    for (const n of mcpInventory({ configDir: claudeConfigDir(env), homeDir: claudeJsonDir(env), projectDir })) out.add(n);
  }
  return out;
}

// The blob (written to the object store of `dir`'s repository) of a surface file with its line endings made LF, as the
// permission hash sees it, so a CRLF checkout diffs as the lines that changed. No clean filter runs: --stdin with
// --no-filters, never what a .gitattributes from a commit picks; nor a replace ref (--no-replace-objects).
function surfaceBlob(dir: string, file: string): string | null {
  try {
    const text = Buffer.from(readFileSync(path.join(dir, file)).toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
    const id = execFileSync('git', ['--no-replace-objects', 'hash-object', '-w', '--no-filters', '--stdin'], { cwd: dir, input: text, encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true }).trim();
    return OBJECT_ID.test(id) ? id : null;
  } catch { return null; }
}

// The whole diff of a surface whose question shows it capped, in <root>/.forge/work/surfaces/<name>-<hash 16>.diff
// (written to a new file, then renamed into place): its absolute path, or null when it cannot be written or a
// directory on the way is a link (a commit can ship .forge/work as one, to make forge write elsewhere).
function writeFullDiff(root: string, name: string, hash: string, diff: string): string | null {
  let dir = root;
  for (const part of ['.forge', 'work', 'surfaces']) {
    dir = path.join(dir, part);
    try { if (lstatSync(dir).isSymbolicLink()) return null; } catch { /* missing: made below */ }
  }
  const file = path.join(dir, `${name}-${hash.slice(0, 16)}.diff`);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(tmp, diff, { flag: 'wx' });
    renameSync(tmp, file);
    return file;
  } catch {
    try { rmSync(tmp, { force: true }); } catch { /* leave it */ }
    return null;
  }
}

// What the question about a surface that is not allowed shows: for a changed one, the diff from the blob allowed to the
// file now (its header naming the file, capped; null without a stored blob, when git cannot, or when nothing differs)
// and the commits since the allowance (the last 3 of the file when its commit is unknown), then the question with its
// three answers. A capped diff says so (diffTruncated) and leaves the whole one in diffFile (null when it could not be
// written), so a line pushed past the cap is still shown. Every git call ignores replace refs, which anyone who can
// write the repository's refs could use to show another content than the one allowed. `dir`: where the surface was
// read; `work`: the caller's directory, which holds forge's own files.
function surfaceQuestion(p: PlanSurface, s: Surface, perm: SurfacePermission | undefined, git: (args: string[]) => string | null, dir: string, work: string, es: boolean): PlanSurface {
  if (p.permission === 'allowed') return p;
  if (p.permission === 'ask') return { ...p, ask: askFor(s, 'ask', es) };
  const lines = (out: string | null) => (out ?? '').split('\n').map(l => l.trim()).filter(Boolean);
  let diff: string | null = null;
  let cut: Pick<PlanSurface, 'diffTruncated' | 'diffFile'> = {};
  if (perm?.blob) {
    const now = surfaceBlob(dir, s.file);
    const d = now ? git(['--no-replace-objects', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--src-prefix=a/', '--dst-prefix=b/', perm.blob, now]) : null;
    if (d && now) {
      const full = relabelDiff(d, perm.blob, now, s.file);
      diff = capLines(full, 120, es);
      if (diff !== full) cut = { diffTruncated: true, diffFile: writeFullDiff(work, s.name, p.hash, full) };
    }
  }
  const since = perm?.commit ? git(['--no-replace-objects', 'log', '--oneline', '-n', '10', `${perm.commit}..HEAD`, '--', s.file]) : null;
  const commits = lines(since ?? git(['--no-replace-objects', 'log', '--oneline', '-n', '3', '--', s.file]));
  return { ...p, diff, ...cut, commits, ask: askFor(s, 'changed', es) };
}

// The time git last committed a file of the repository (sp-specs and sp-plans), in ms; null when it does not track it.
const committedAt = (io: Io, dir: string) => {
  const git = io.git ?? defaultGit(dir);
  return (rel: string): number | null => {
    const s = Number((git(['log', '-1', '--format=%ct', '--', rel]) ?? '').trim());
    return Number.isInteger(s) && s > 0 ? s * 1000 : null;
  };
};
const declinedSpecs = (s: Record<string, unknown>): string[] =>
  Array.isArray(s.declinedSpecs) ? s.declinedSpecs.filter((x): x is string => typeof x === 'string').slice(0, 200) : [];

// tdd: superpowers: the line implementer briefs carry, null when off or when superpowers or its TDD skill is missing.
function tddFor(io: Io, dir: string) {
  const { tdd } = loadConfig(dir);
  const sp = superpowersOf(io, dir);
  const skill = spSkillPath(sp, 'test-driven-development');
  return { tdd, installed: sp.installed, version: sp.version, skill, line: tdd === 'superpowers' && skill ? tddLine(skill) : null };
}

// The TDD line of a brief: an invalid config or a missing superpowers leaves it out (the brief never fails on it), and
// superpowers is looked for only with tdd: superpowers.
function briefTdd(io: Io, dir: string): string | null {
  try { return loadConfig(dir).tdd === 'superpowers' ? tddFor(io, dir).line : null; } catch { return null; }
}

// K4-02: the threat model section a plan task's brief carries, from the config of the code's checkout (none on any error).
function briefThreatModel(dir: string): string | null {
  try { const tm = loadConfig(dir).threatModel; return tm ? renderThreatModel(tm) : null; } catch { return null; }
}

/** The status each proposal's latest decision event in this checkout's ledger left it in, and when: decide, confirm, a reopen
 *  (its `to`) and the policy's auto-approval; a policy that declined decided nothing. A pid with no such event is absent. */
function lastDecisions(root: string): Record<string, { status: string; ts: string }> {
  const out: Record<string, { status: string; ts: string }> = {};
  for (const e of readEvents(root)) {
    if (e.kind !== 'proposal' || typeof e.id !== 'string') continue;
    const status = e.action === 'reopen' ? e.to : e.action === 'decide' || e.action === 'confirm' || (e.action === 'policy' && e.status === 'auto_approved') ? e.status : undefined;
    if (typeof status === 'string') out[e.id] = { status, ts: e.ts };
  }
  return out;
}

/** Carry 12: the rules of the roadmap page the last `proposals pull --approvals` read (meta/page.rules), kept in .forge/. */
const approvalsPageFile = (root: string) => path.join(root, '.forge', 'approvals-page.json');
function pulledRules(root: string): number {
  try { const r = (JSON.parse(readFileSync(approvalsPageFile(root), 'utf8')) as { rules?: unknown }).rules; return typeof r === 'number' ? r : 0; } catch { return 0; }
}

/**
 * The latest decision of this checkout that a mark must agree with (ownerCheck's `last`), or undefined when none binds it.
 * Carry 12: an owner's mark newer than that decision (its decidedAt later than the event) is the owner's own later
 * decision, taken on the page or in another checkout, and counts by itself; only on a roadmap with the owner rule
 * (meta/page.rules ≥ PAGE_RULES at the last pull), where only the owner writes approvals/ and so decidedAt is the owner's.
 * Re-review m1: and only a decidedAt at most MARK_SKEW_MS ahead of this machine's clock (`now`): a mark dated in the
 * future (a forged one, or a skewed clock) never outranks a local decision.
 */
const MARK_SKEW_MS = 10 * 60_000;
function bindingDecision(last: { status: string; ts: string } | undefined, mark: ApprovalDoc | null | undefined, ownerRule: boolean, now: number): string | undefined {
  if (!last) return undefined;
  const at = mark ? Date.parse(mark.decidedAt) : NaN;
  if (ownerRule && Number.isFinite(at) && at > Date.parse(last.ts) && at <= now + MARK_SKEW_MS) return undefined;
  return last.status;
}

// What the stop conditions need from the repository: the stop file and the proposal mirror.
// Approved work still pending = every approved/auto_approved proposal not yet done, with or without a task.
function stopContext(cwd: string, now: Date): StopContext {
  const proposals = loadProposals(cwd);
  const marks = loadApprovals(cwd);
  const last = lastDecisions(cwd);
  const ownerRule = pulledRules(cwd) >= PAGE_RULES;
  return {
    now,
    stopFile: existsSync(stopFile(cwd)),
    // Wave 4: approved work counts only with the owner's mark (with or without a task, as before); one without a task also
    // needs the mark to be of its present text: an edited one never becomes a task, so it does not hold the queue open.
    approvedPending: proposals.filter(p => p.taskId === undefined ? ownerCheck(p.id, p, marks[p.id], bindingDecision(last[p.id], marks[p.id], ownerRule, now.getTime())) === 'ok' : markMatches(p, marks[p.id])).length,
    pendingProposals: proposals.filter(p => p.status === 'proposed' || p.status === 'discussing').length,
  };
}

/** Wave 4: approved proposals without a task that lack the roadmap owner's mark, or whose text changed since the mark: they
 *  never become tasks. The reason says which of the two. */
function unownedReasons(root: string, now: Date): Record<string, 'no-mark' | 'edited'> {
  const marks = loadApprovals(root);
  const last = lastDecisions(root);
  const ownerRule = pulledRules(root) >= PAGE_RULES;
  const out: Record<string, 'no-mark' | 'edited'> = {};
  for (const p of loadProposals(root)) {
    if (!isActionable(p) || p.taskId !== undefined) continue;
    const c = ownerCheck(p.id, p, marks[p.id], bindingDecision(last[p.id], marks[p.id], ownerRule, now.getTime()));
    if (c !== 'ok') out[p.id] = c;
  }
  return out;
}
const unownedOf = (root: string, now: Date): number => Object.keys(unownedReasons(root, now)).length;

/**
 * K2-01: the directory of the infinite run: the main checkout, wherever forge runs from; this directory only when it
 * alone holds a run.json (a run an older forge started in a worktree).
 */
function runRootOf(cwd: string): string {
  const main = mainCheckout(cwd);
  if (samePath(main, cwd)) return main;
  return readRunText(main) === null && readRunText(cwd) !== null ? cwd : main;
}

/** How long the Stop hook waits for execution.lock: a hook must not hold the session (the CLI waits LOCK_WAIT_MS). */
const HOOK_LOCK_WAIT_MS = 2000;

// The Stop hook: fail-open (any error prints nothing); prints a block or nothing. An active infinite run decides first
// (an execution runs inside its cycles); otherwise an active execution decides.
function hookStop(io: Io): string {
  try {
    const input: unknown = JSON.parse(io.stdin ?? '');
    if (!input || typeof input !== 'object' || Array.isArray(input)) return '';
    const hookInput = input as { stop_hook_active?: boolean; session_id?: unknown };
    const main = mainCheckout(io.cwd);
    // The execution is bound when it starts (C1): the hook only reads it.
    const exec = readExecution(main);
    // A registered member of this run is never blocked on the execution's behalf.
    const sid = typeof hookInput.session_id === 'string' ? hookInput.session_id : null;
    // Members are found by the hook id they recorded at join (Claude's session_id, not their waypoint SID).
    const member = exec?.active && sid ? memberForHook(main, sid, exec.runId) : null;
    if (member) { hookLive(io, 'Stop'); return ''; }
    hookLive(io, 'Stop');
    const sleeping = !!exec?.active && !!exec.sleepUntil && Date.parse(exec.sleepUntil) > io.now().getTime();
    const runRoot = runRootOf(io.cwd);
    const run = parseRun(readRunText(runRoot));
    if (run?.active) {
      const d = decideStop(hookInput, run, { ...stopContext(runRoot, io.now()), ledgerEvents: readEvents(runRoot).length, swarmSleeping: sleeping });
      if (!d.block) return '';
      saveRun(runRoot, d.run);
      if (d.ended) appendEvent(runRoot, { ts: io.now().toISOString(), kind: 'cycle', action: 'stopped', reason: d.ended });
      return JSON.stringify({ decision: 'block', reason: d.reason + (sessionReply(d.run, exec?.active ? exec : null, () => planLocale(runRoot, exec?.project)) ?? replyIn(null)) }) + '\n';
    }
    // C-03: a job this session launched in the background (prep, review-prep, integrate, step) wakes it when it ends;
    // a member's job, with another session, does not.
    const jobs = sid ? liveJobs(main, io.now()).filter(j => j.session === null || j.session === sid) : [];
    // D-15: the public lease of each running task of this run (.forge/execution/<T>.json), which the skill sets for the
    // budget of the agent it dispatches.
    const leases: Record<string, string> = {};
    for (const [id, t] of Object.entries(exec?.active ? exec.tasks : {})) {
      if (t.status !== 'running') continue;
      try {
        const p = normalizePublicTask(JSON.parse(readFileSync(executionTaskFile(main, id), 'utf8')));
        if (p && p.task === id && p.runId === exec!.runId) leases[id] = p.leaseUntil;
      } catch { /* no public file: the default lease */ }
    }
    const d = decideExecutionStop(hookInput, exec, { now: io.now(), stopFile: existsSync(stopFile(main)), jobs, leases });
    if (!d.block) return '';
    // Under the lock, only what the hook decided: a swarm step or an integrate that wrote meanwhile is kept (I-15). A
    // hook never keeps the session waiting: a lock a live process holds for HOOK_LOCK_WAIT_MS lets it stop as if no
    // block were needed (that process is a step or an integrate of this run, and its end wakes the session).
    try {
      updateExecution(main, cur => (cur && cur.runId === d.exec.runId
        ? { ...cur, lastBlockStep: d.exec.lastBlockStep, ...(d.ended ? { active: false, stopReason: d.exec.stopReason, sleepUntil: null } : {}) }
        : null), { now: io.now, sleep: io.sleep, waitMs: HOOK_LOCK_WAIT_MS });
    } catch (e) { if (e instanceof UsageError) return ''; throw e; }
    // Only an active run speaks for the person: here none is (it decides above).
    return JSON.stringify({ decision: 'block', reason: d.reason + (sessionReply(null, d.exec, () => planLocale(main, d.exec.project)) ?? replyIn(null)) }) + '\n';
  } catch { return ''; }
}

// The `reply` of the cycle and infinite status JSON: the sentence that tells the session which language to answer in
// (the run's, else the active execution's, else the plan's); null when none is known.
function runReply(cwd: string, run: RunState | null): string | null {
  const main = mainCheckout(cwd);
  const exec = readExecution(main);
  const active = exec?.active ? exec : null;
  return sessionReply(run, active, () => planLocale(cwd, active?.project))?.trim() ?? null;
}

// Logs the verify event of a verification (verdict and verify-result share it): its result (`invalid` when verify.json
// did not parse), the checks passed of the total, and the evidence folder that goes with a `reviews-<n>-<k>` dir.
function logVerifyResult(cwd: string, at: string, task: string, dir: string, verifyFile: VerifyFile | null): { result: string; passed: number; total: number } {
  const rel = path.relative(cwd, dir).split(path.sep).join('/');
  const evidence = rel.replace(/reviews-(\d+-\d+)$/, 'evidence/$1');
  const out = { result: verifyFile?.result ?? 'invalid', passed: verifyFile ? verifyFile.checks.filter(c => c.ok).length : 0, total: verifyFile ? verifyFile.checks.length : 0 };
  // K2-04: from a forge task worktree, verify.json and the evidence are copied to the main checkout first.
  const { skipped } = keepEvidence(cwd, dir);
  appendEvent(cwd, { ts: at, kind: 'verify', task, ...out, ...(evidence !== rel ? { evidence } : {}), ...(verifyFile?.reason ? { reason: verifyFile.reason } : {}),
    ...(skipped.length ? { evidenceSkipped: skipped } : {}) });
  return out;
}

/** A screenshot above this is converted to JPEG before it is uploaded to the roadmap. */
const SHOT_MAX_BYTES = 2 * 1024 * 1024;

/**
 * `surfaces learn` of one surface: appends the notes under the Learned/Aprendido heading of `<dir>/.forge/verify/<name>.md`
 * (the code checked) and, when the surface is allowed as it is now, records them in the main checkout, so they never ask
 * for its permission again. A missing file or a symlink is a reason, not a write.
 */
function learnSurface(io: Io, dir: string, name: string, notes: string[], heading: string): { count: number } | { reason: string } {
  const file = path.join(dir, surfaceFile(name));
  if (!existsSync(file)) return { reason: `${surfaceFile(name)} does not exist` };
  if (lstatSync(file).isSymbolicLink()) return { reason: `${surfaceFile(name)} is a symlink` };
  const before = readFileSync(file, 'utf8');
  // Only a surface allowed as it is now records what it appends (and local.yaml is never touched), so learning on a
  // changed or never allowed surface cannot make it allowed: its new lines are just more unknown text.
  const cur = readLocal(io.cwd).surfaces[name];
  const allowed = cur?.state === 'allowed' && hashMatches(cur.hash, permissionHash(before, readLearned(io.cwd).get(name)));
  const at = io.now().toISOString();
  const r = appendLearned(before, at.slice(0, 10), notes, heading);
  writeFileSync(file, r.text);
  if (allowed) recordLearned(io.cwd, name, r.added, at);
  return { count: r.count };
}

/** `verify-cleanup` of an evidence dir: stops the processes its pids.json lists (deletes no files). */
function cleanupEvidence(dir: string): { killed: number[]; gone: number[] } {
  let pids: number[] = [];
  try { const raw = JSON.parse(readFileSync(path.join(dir, 'pids.json'), 'utf8')); if (Array.isArray(raw)) pids = raw.filter((p): p is number => Number.isInteger(p)); } catch { pids = []; }
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
  return cleanupPids(pids, kill);
}

/** What a triage computes (K1-01): everything `forge triage` prints, before anything is written. */
interface TriageCore {
  task: string | undefined; project: string | null; result: TriageResult; names: string[]; fresh: string[];
  diff: { base: string; stat: { files: string[]; lines: number }; path: PathName } | null;
  auto: { autonomy?: 'auto' }; review: Record<string, unknown>; output: Record<string, unknown>;
}

/**
 * The triage of a task without side effects (K1-01): it reads the ledger (the ratchet), the plan, the config,
 * local.yaml and git, and writes nothing. `forge triage` then records the validators it knows in local.yaml and the
 * `triage` event; `forge route --text-file` uses it as a probe.
 */
function triageCore(io: Io, args: string[]): TriageCore {
  const repoDir = io.workdir ?? io.cwd;
  const flag = (name: string) => {
    const i = args.indexOf(`--${name}`);
    const v = i >= 0 ? args[i + 1] : undefined;
    return v === undefined || v.startsWith('--') ? undefined : v;
  };
  const has = (name: string) => args.includes(`--${name}`);
  const textArgs = [...args];
  for (const f of ['--task', '--text-file', '--plan', '--superpowers-plan', '--autonomy', '--locale', '--base']) {
    const i = textArgs.indexOf(f);
    if (i >= 0) textArgs.splice(i, 2);
  }
  let task = textArgs.filter(a => !a.startsWith('--')).join(' ').trim();
  if (flag('text-file') !== undefined) {
    try { task = readFileSync(path.resolve(io.cwd, flag('text-file')!), 'utf8').trim(); } catch { throw new UsageError('triage: cannot read --text-file'); }
  }
  if (has('plan') && flag('plan') === undefined) throw new UsageError('triage: --plan needs a plan file');
  const plannedDoc = flag('plan') !== undefined ? planTask(io.cwd, flag('plan'), flag('task')) : null;
  const planned = plannedDoc?.task ?? null;
  if (planned) task = taskText(planned);
  if (has('superpowers-plan') && flag('superpowers-plan') === undefined) throw new UsageError('triage: --superpowers-plan needs a plan file');
  // A superpowers plan: its title, goal and pending tasks are the text, the files those tasks list are its files.
  let spFiles: string[] | null = null;
  if (flag('superpowers-plan') !== undefined) {
    const file = flag('superpowers-plan')!;
    let sp;
    try { sp = spPlanDone(readFileSync(path.resolve(io.cwd, file), 'utf8'), path.resolve(io.cwd, file), repoDir); } catch (e) {
      throw new UsageError(e instanceof SpPlanError ? `triage: ${file}: ${e.message}` : `triage: cannot read ${file}`);
    }
    const pending = sp.tasks.filter(t => !t.done);
    task = [sp.plan.title, sp.plan.goal, ...pending.map(t => t.title)].filter(Boolean).join('. ');
    spFiles = [...new Set(pending.flatMap(t => t.files))];
  }
  const autonomy = flag('autonomy');
  if (has('autonomy') && autonomy !== 'auto' && autonomy !== 'ask') throw new UsageError('triage: --autonomy must be auto or ask');
  const auto = autonomy === 'auto' ? { autonomy: 'auto' as const } : {};
  const localeArg = flag('locale');
  if (has('locale') && localeArg !== 'es' && localeArg !== 'en') throw new UsageError('triage: --locale must be es or en');
  if (!task) throw new UsageError('triage: the task text is required');
  // --base <sha>: the task is implemented, its real diff from base sizes it again (`flag` would take `-x` for a value).
  let base: string | null = null;
  if (has('base')) {
    const v = args[args.indexOf('--base') + 1];
    if (!v || v.startsWith('-')) throw new UsageError('triage: --base needs a commit');
    if (!flag('task')) throw new UsageError('triage: --base needs --task');
    base = v;
  }
  const git = io.git ?? defaultGit(io.cwd);
  const lines = (out: string | null) => (out ?? '').split('\n').map(s => s.trim()).filter(Boolean);
  const listed = git(['-c', 'core.quotePath=false', 'ls-files']);
  // rev-list fails on a repository without commits: that is 0 commits, not a git failure.
  const commits = Number.parseInt((git(['rev-list', '--count', 'HEAD']) ?? '').trim(), 10) || 0;
  // The design, the plan and forge's own notes name every symbol of a planned task: a hit there says nothing
  // about the code the task touches, so the symbol search leaves them out (a task can still name them as paths).
  const grep = (w: string) => lines(git(['-c', 'core.quotePath=false', 'grep', '-l', '-I', '--fixed-strings', '-w', '-e', w])).filter(f => !isBookkeeping(f));
  const tracked = lines(listed);
  const zoneFiles = planned ? tracked.filter(f => planned.zones.some(z => globMatch(z, f))) : [];
  const extra = planned ? { files: zoneFiles, zones: zonesFromPaths(planned.zones) }
    : spFiles ? { files: tracked.filter(f => spFiles!.includes(f)), zones: zonesFromPaths(spFiles) } : undefined;
  const catalog = detectValidators(repoReader(repoDir), loadConfig(repoDir)).map(v => ({ name: v.name, cmd: v.cmd, kind: v.kind, source: v.source }));
  const names = catalog.map(v => v.name);
  // A plan task was already designed and planned: a young repository does not make it Large.
  // Its zones come from its paths and its title, its Large wording, perf and mechanical character only from its title.
  const result = triage(task, { files: tracked, commits, gitOk: listed !== null, grep }, names, extra,
    { ignoreGreenfield: planned !== null, ...(planned ? { plan: { title: planned.title } } : {}) });
  const wordText = planned ? planned.title : task;
  if (planned?.zones.length && !zoneFiles.length) result.reasons.push('zones match no tracked file (new files?)');
  // A superpowers plan runs on the Medium path, one task after another: its tasks build on each other.
  if (spFiles) { result.path = 'medium'; result.reasons.push('superpowers plan: the Medium path, its tasks in order'); }
  // The real diff alone sizes an implemented task: the text's estimate sets no floor, only a sensitive zone
  // (its text, its plan zones or its diff) keeps it at Medium.
  let diff: TriageCore['diff'] = null;
  if (base !== null) {
    const out = git(['-c', 'core.quotePath=false', 'diff', '--numstat', '--no-renames', `${base}..HEAD`]);
    if (out === null) throw new UsageError(`triage: cannot diff ${base}..HEAD`);
    const stat = parseNumstat(out);
    const d = diffPath(stat);
    result.sensitive = ZONE_ORDER.filter(z => result.sensitive.includes(z) || d.sensitive.includes(z));
    result.path = d.path;
    result.reasons = [...d.reasons];
    if (result.sensitive.length && PATH_ORDER.indexOf(result.path) < PATH_ORDER.indexOf('medium')) {
      result.path = 'medium';
      result.reasons.push(`sensitive zone: ${result.sensitive.join(', ')}`);
    }
    diff = { base, stat, path: d.path };
  }
  // The ratchet: a repeated triage of the same task never lowers the path it already reached. With --base only the
  // earlier --base sizings count, and a task only counts the triages of its own project (D-08: ids repeat between plans;
  // `log --kind triage` stamps a raise with it; a loose task's are those of no project).
  // A raise the session logged with a `why` explains the path better than the CLI reasons: the announcement uses it.
  const project = plannedDoc ? plannedDoc.plan.project : null;
  let raiseWhy: string | null = null;
  const id = flag('task');
  if (id) {
    const rank = (p: unknown) => PATH_ORDER.indexOf(p as PathName);
    const logged = eventsOf(readEvents(io.cwd), { project, task: id }).filter(e => e.kind === 'triage' && isTask(e, id) && rank(e.path) >= 0
      && (base === null || e.diff !== undefined));
    const prior = logged.reduce<PathName | null>((max, e) => (max === null || rank(e.path) > rank(max) ? e.path as PathName : max), null);
    if (prior && rank(prior) > rank(result.path)) {
      result.path = prior;
      result.reasons.push(`ratchet: kept ${prior} from an earlier triage of this task`);
    }
    // The latest raise to the path kept that says why (later triages of the same path log none).
    if (prior && prior === result.path) {
      const raise = logged.filter(e => e.path === prior && typeof e.why === 'string' && e.why).at(-1);
      raiseWhy = raise ? raise.why as string : null;
    }
  }
  // J-14: the plan's `delicate`, or --delicate for a task the person calls delicate.
  const delicate = planned?.delicate === true || has('delicate');
  const impl = implementerFor(result, wordText, { batch: has('batch'), plan: planned !== null, delicate });
  const profile = loadConfig(repoDir).profile;
  const implementer = { ...impl, agent: impl.role ? agentFor(impl.role, profile) : null };
  const known = readLocal(io.cwd).known;
  const fresh = names.filter(n => !known.includes(n));
  // Who reviews, by the size reached and the configured profile: printed always and logged for review-prep.
  const reviewPlan = reviewFor(result.path, result.sensitive, isPerfTask(wordText), { delicate, profile });
  const review = { ...reviewPlan, reviewers: reviewPlan.reviewers.map(r => ({ ...r, agent: agentFor(r.role, profile) })) };
  // Output only, like `implementer`: the exact line the session prints, and whether a short plan comes first.
  // The locale: the flag, else the plan passed with --plan, else the plan under docs/waypoint, else English.
  const locale = localeArg ?? ((plannedDoc?.plan.locale ?? planLocale(io.cwd))?.toLowerCase().split(/[-_]/)[0] === 'es' ? 'es' : 'en');
  let line = announce({ path: result.path, reasons: result.reasons, implementer, why: raiseWhy, fresh, catalog }, locale as AnnounceLocale);
  let gate: 'plan' | null = result.path === 'medium' ? 'plan' : null;
  // After the implementation: who reviews it, by its real size. No short plan comes first any more.
  let reviewed = {};
  if (diff) {
    // The new-validators line `announce` appends, kept after the review line.
    const bare = announce({ path: result.path, reasons: result.reasons, implementer, why: raiseWhy, fresh: [], catalog }, locale as AnnounceLocale);
    line = announceReview({ path: result.path, files: diff.stat.files.length, lines: diff.stat.lines, review: reviewPlan }, locale as AnnounceLocale)
      + line.slice(bare.length);
    gate = null;
    reviewed = { diff: { base: diff.base, files: diff.stat.files, lines: diff.stat.lines, path: diff.path } };
  }
  return {
    task: flag('task'), project, result, names, fresh, diff, auto, review,
    output: { ...result, catalog, new: fresh, implementer, announce: line, gate, ...auto, ...reviewed, review },
  };
}

/**
 * K1-01: a probe leaves nothing behind. When .forge/ holds only work/<task>/task.txt (the request the skill wrote for
 * it) and no .gitignore, that file and its empty directories go; anything else there, or a text file elsewhere, stays.
 * True once the task file is gone (the skill writes it again for forge:run), even when a directory then stays.
 */
export function cleanProbe(cwd: string, task: string, textFile: string, rmdir: (dir: string) => void = rmdirSync): boolean {
  const dir = path.join(cwd, '.forge');
  const file = path.join(dir, 'work', task, 'task.txt');
  if (!samePath(path.resolve(cwd, textFile), file)) return false;
  try {
    // A .forge/ that is a link (to a shared directory) is not one the probe made.
    if (!lstatSync(dir).isDirectory()) return false;
    const entries: string[] = [];
    const walk = (d: string, rel: string): void => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        entries.push(e.isDirectory() ? `${r}/` : r);
        if (e.isDirectory()) walk(path.join(d, e.name), r);
      }
    };
    walk(dir, '');
    if (entries.sort().join('\n') !== ['work/', `work/${task}/`, `work/${task}/task.txt`].join('\n')) return false;
    rmSync(file);
  } catch { return false; }
  try { for (const d of [path.join(dir, 'work', task), path.join(dir, 'work'), dir]) rmdir(d); } catch { /* an empty directory stays: nothing of the person's */ }
  return true;
}

/** C-03: the commands that run as a job with --out, and the task each works on. */
function jobOf(argv: string[]): { cmd: string; task: string | null } | null {
  const [cmd, sub, third] = argv;
  const value = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    const v = i >= 0 ? argv[i + 1] : undefined;
    return v !== undefined && !v.startsWith('--') ? v : null;
  };
  if (cmd === 'prep' || cmd === 'review-prep' || cmd === 'validate') return { cmd, task: value('task') };
  if (cmd === 'swarm' && sub === 'integrate') return { cmd: 'integrate', task: third !== undefined && !third.startsWith('--') ? third : null };
  if (cmd === 'swarm' && sub === 'step') return { cmd: 'step', task: null };
  return null;
}

/**
 * The forge CLI. `--out <file>` on prep, review-prep, validate, swarm integrate and swarm step (C-03): the command runs
 * as a job of .forge/jobs/ (the coordinator launched it with run_in_background and its end wakes it), waits for a
 * validation slot before its validators (swarm.validateJobs) and writes its JSON to the file atomically, with
 * `waitedMs` when it is an object; one that failed writes `{error, code}`. Any other command runs as it is.
 */
function runOrJob(argv: string[], io: Io): Result {
  const job = argv.includes('--out') ? jobOf(argv) : null;
  if (!job) return runCommand(argv, io);
  const at = argv.indexOf('--out');
  const file = argv[at + 1];
  if (file === undefined || file.startsWith('--')) return { code: 2, stdout: '', stderr: `${job.cmd}: --out needs a file\n` };
  const outFile = path.resolve(io.cwd, file);
  const main = mainCheckout(io.cwd);
  let max = 2;
  try { max = loadConfig(main).swarm.validateJobs; } catch { max = 2; }
  const spec = { cmd: job.cmd, task: job.task, out: file.replace(/\\/g, '/'), session: claudeSessionId(null, io.env ?? process.env), startedAt: io.now().toISOString() };
  return withJob(main, spec, j => {
    const slots = slotFor(main, j, max, { now: io.now, sleep: io.sleep ?? sleepSync });
    const r = runCommand([...argv.slice(0, at), ...argv.slice(at + 2)], { ...io, slot: slots.slot });
    let parsed: unknown;
    try { parsed = JSON.parse(r.stdout); } catch { parsed = undefined; }
    const value = parsed === undefined ? { error: (r.stderr || r.stdout).trim() || `exit ${r.code}`, code: r.code }
      : parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { ...(parsed as Record<string, unknown>), waitedMs: slots.waited() } : parsed;
    try { writeJsonAtomic(outFile, value); } catch (e) { return { ...r, stderr: `${r.stderr}forge: could not write ${file}: ${(e as Error).message}\n` }; }
    return parsed !== undefined && value !== parsed ? { ...r, stdout: JSON.stringify(value, null, 2) + '\n' } : r;
  });
}

/** C4: the context the events of one command are stamped with: Claude's session from io.env (a test passes {}) and, for a
 *  command with --task, the project its --project or its --dir (.forge/work/<project>/<T>) names. */
function eventContextOf(argv: string[], io: Io): EventContext {
  const value = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    const v = i >= 0 ? argv[i + 1] : undefined;
    return v !== undefined && !v.startsWith('--') ? v : undefined;
  };
  const task = value('task'), flagged = value('project'), dir = value('dir');
  const project = !task ? undefined : flagged !== undefined ? (isSafeId(flagged) ? flagged : undefined) : dir ? projectOfDir(dir, task) ?? undefined : undefined;
  return { env: io.env ?? {}, ...(project !== undefined ? { project } : {}) };
}

/** The forge CLI (see runOrJob): every event a command appends carries its session, run and project (C4). A command a
 *  swarm step runs (its deps.cli) that names no project keeps the step's (withEventContext). */
export function run(argv: string[], io: Io): Result {
  return withEventContext(eventContextOf(argv, io), () => runOrJob(argv, io));
}

function runCommand(argv: string[], io: Io): Result {
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
    io = { ...io, workdir: abs, git: defaultGit(abs), exec: defaultExec(abs), execMany: defaultExecMany(abs) };
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
    // D-08: a --project names a work folder and reaches every event of the command: a safe id only (swarm has its own rules).
    if (cmd !== 'swarm' && has('project') && !isSafeId(flag('project'))) throw new UsageError(`${cmd}: --project must use letters, digits, _ - . (at most 120)`);
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
        // A raise logged by the session may say why; the next triage of the task announces it.
        if (kind === 'triage' && data.why !== undefined) {
          // One line without a trailing stop: the announcement adds its own.
          const why = typeof data.why === 'string' ? data.why.replace(/\s+/g, ' ').trim().replace(/[\s.;:,]+$/, '').trim() : null;
          if (why === null || why.length > MAX_WHY) throw new UsageError(`log: a triage why must be a string of at most ${MAX_WHY} characters`);
          data = { ...data, why };
        }
        const task = flag('task');
        // A plan task's triage only counts the events of its plan's project (ids repeat between plans): a raise without
        // one takes the active plan execution's project when the task is one of its tasks (started, or in its plan
        // docs/waypoint/<project>/plan.yaml, an unreadable plan counting as none), else the project of the task's
        // latest triage, none when that triage was of a loose task (D-08).
        if (kind === 'triage' && task && data.project === undefined) {
          const main = mainCheckout(io.cwd);
          const exec = readExecution(main);
          const inPlan = (project: string) => {
            if (!isSafeId(project)) return false;
            try { return parsePlan(readFileSync(path.join(main, 'docs', 'waypoint', project, 'plan.yaml'), 'utf8')).tasks.some(t => t.id === task); } catch { return false; }
          };
          const project = exec?.active && exec.kind === 'plan' && (Object.hasOwn(exec.tasks, task) || inPlan(exec.project)) ? exec.project
            : projectOf(readEvents(io.cwd), task);
          if (project) data = { ...data, project };
        }
        appendEvent(io.cwd, { ...data, ts: ts(), kind: kind as LedgerKind, ...(task ? { task } : {}) });
        return ok('ok');
      }
      case 'brief': {
        // D-02: the earlier attempt of a task resumed on its branch (the `prior` swarm worktree printed).
        let prior: PriorCommit[] | null = null;
        let priorTotal: number | null = null;
        if (has('prior-file')) {
          const f = flag('prior-file');
          if (!f) throw new UsageError('brief: --prior-file needs a file');
          let raw: unknown;
          try { raw = JSON.parse(readFileSync(path.resolve(io.cwd, f), 'utf8')); } catch { throw new UsageError(`brief: cannot read ${f}`); }
          prior = parsePrior(raw);
          if (!prior) throw new UsageError(`brief: ${f} is not the prior list swarm worktree prints ([{sha, title}])`);
          // Carry 3: an attempt longer than the list (`priorTotal` of swarm worktree) says how many commits it has.
          if (has('prior-total')) {
            const n = Number(flag('prior-total'));
            if (!Number.isInteger(n) || n < prior.length) throw new UsageError('brief: --prior-total must be the whole number of commits swarm worktree printed as priorTotal');
            priorTotal = n;
          }
          // Without a plan (a loose task's brief is written by hand), only the section, to append to it.
          if (!has('plan') && !has('superpowers-plan')) {
            const task = flag('task');
            if (!task || !isPlanId(task)) throw new UsageError('brief: --prior-file without --plan needs --task <id>');
            return { code: 0, stdout: prior.length ? priorSection(task, prior, priorTotal) : '', stderr: '' };
          }
          // A superpowers plan's brief has no task branch of its own: never drop the section silently.
          if (has('superpowers-plan')) throw new UsageError('brief: --prior-file goes with --plan, or alone with --task <id>');
        }
        if (has('superpowers-plan')) {
          const file = flag('superpowers-plan');
          if (!file) throw new UsageError('brief: --superpowers-plan needs a plan file');
          const n = spTaskNumber(flag('task'));
          let text: string;
          try { text = readFileSync(path.resolve(io.cwd, file), 'utf8'); } catch { throw new UsageError(`brief: cannot read ${file}`); }
          try { return ok(renderSpBrief(text, n, { planPath: file.replace(/\\/g, '/'), tdd: briefTdd(io, repoDir) })); } catch (e) {
            if (e instanceof SpPlanError) throw new UsageError(`brief: ${file}: ${e.message}`);
            throw e;
          }
        }
        const { plan, task } = planTask(io.cwd, flag('plan'), flag('task'));
        const design = flag('design') ?? path.join(path.dirname(flag('plan')!), 'design.md');
        const designPath = existsSync(path.resolve(io.cwd, design)) ? design.replace(/\\/g, '/') : null;
        return ok(renderBrief(plan, task, { planPath: flag('plan')!.replace(/\\/g, '/'), designPath, tdd: briefTdd(io, repoDir), threatModel: briefThreatModel(repoDir), prior, priorTotal }));
      }
      case 'triage': {
        const t = triageCore(io, args);
        // `known` mirrors what exists now: new names are added, vanished ones dropped silently.
        const known = readLocal(io.cwd).known;
        if (t.fresh.length || known.some(n => !t.names.includes(n))) updateLocal(io.cwd, s => ({ ...s, known: t.names }));
        appendEvent(io.cwd, { ts: ts(), kind: 'triage', ...(t.task ? { task: t.task } : {}), ...(t.project !== null ? { project: t.project } : {}), ...t.result, ...t.auto,
          ...(t.diff ? { diff: { base: t.diff.base, files: t.diff.stat.files.length, lines: t.diff.stat.lines } } : {}), review: t.review });
        // forgeDir has just created .forge/.gitignore and no step commits it: say so while git lists it as untracked and
        // not ignored (a repository that ignores .forge/ has opted out). Asked after the writes, which may have made it.
        const git = io.git ?? defaultGit(io.cwd);
        const untracked = (git(['ls-files', '--others', '--exclude-standard', '--', '.forge/.gitignore']) ?? '').trim() ? { untracked: ['.forge/.gitignore'] } : {};
        // D-08: the task's work folder, by project for a plan task (.forge/work/<project>/<id>).
        const work = t.task && isSafeId(t.task) ? { work: workRel({ project: t.project, task: t.task }) } : {};
        return json({ ...t.output, ...work, ...untracked });
      }
      case 'validate': {
        const config = loadConfig(repoDir);
        const all = detectValidators(repoReader(repoDir), config);
        const p = flag('path');
        if (p !== undefined && !(PATH_ORDER as readonly string[]).includes(p)) throw new UsageError(`validate: --path must be one of ${PATH_ORDER.join('|')}`);
        // --out belongs to run() (C-03), which takes one when the command comes first. One that reaches here (a flag before
        // the command, a second --out) would be ignored and its file never written.
        if (has('out')) throw new UsageError('validate: --out is taken once, with the command first: forge validate … --out <file> (--cwd after validate)');
        // --affected a,b names the files; bare (or followed by another flag) it takes those changed since --base (HEAD by
        // default; uncommitted changes included) and the untracked ones, read with -z so git quotes no name. Both relative
        // to the code's directory, as the validators see them (--relative: a project in a subdirectory).
        const affectedFiles = (): string[] => {
          const given = flag('affected');
          if (given !== undefined) return given.split(',').map(s => s.trim()).filter(Boolean);
          const git = io.git ?? defaultGit(repoDir);
          const base = flag('base') ?? 'HEAD';
          if (base.startsWith('-')) throw new UsageError('validate: --base must be a commit');
          const changed = git(['diff', '--name-only', '-z', '--relative', base, '--']);
          if (changed === null) throw new UsageError(`validate --affected: cannot diff against ${base}`);
          const others = git(['ls-files', '-z', '--others', '--exclude-standard']) ?? '';
          return [...new Set([...changed.split('\0'), ...others.split('\0')].filter(Boolean))];
        };
        let scope: Scope;
        if (has('final')) scope = { mode: 'final' };
        else if (!has('all') && has('affected')) scope = { mode: 'affected', files: affectedFiles() };
        else if (p === 'trivial' || p === 'small') scope = { mode: 'small' };
        else {
          const base = flag('base');
          const diff = base ? (io.git ?? defaultGit(io.cwd))(['diff', '--name-only', `${base}..HEAD`]) : null;
          scope = { mode: 'heavy', changed: diff === null ? null : diff.split('\n').map(s => s.trim()).filter(Boolean) };
        }
        const list = selectValidators(all, scope);
        // --affected (C-02): a test validator runs only the tests related to the files (its affectedCmd); in full when a
        // path cannot go into a shell or there are too many; not at all (skipped: not-affected) when nothing relates.
        const plan = scope.mode === 'affected' ? planAffected(list, scope.files, process.platform, repoReader(repoDir).exists)
          : { run: list, skipped: new Map<string, ValidatorResult>(), notes: [] as string[] };
        const opts = runOptions(config, readEvents(io.cwd), io.now(), io.execMany);
        // --cwd the run worktree of this checkout (forge's own): what the validators regenerated there is put back.
        // Any other checkout: only the files the config's `generated` names (nothing when it names none).
        const restored: string[] = [];
        const inRun = io.workdir !== undefined && samePath(io.workdir, runWorktree(io.cwd));
        const restoreAt = { git: io.git ?? defaultGit(repoDir) };
        const runList = (misses: Validator[]) => {
          // C-03: with --out the validators wait for a slot (swarm.validateJobs); a list the cache answered whole does not.
          const go = () => (misses.length ? (io.slot ?? noSlot) : noSlot)(() => runValidators(misses, io.exec ?? defaultExec(io.cwd), config.validatorTimeoutSec, opts));
          return inRun ? restoringRegenerated(restoreAt, go, restored) : config.generated.length ? restoringRegenerated(restoreAt, go, restored, config.generated) : go();
        };
        // The tree cache (C6): an --affected pass and --no-cache never touch it; --final writes it but never reads it.
        // Its git runs at the root of the checkout being validated, never at a subdirectory: a change outside it counts;
        // the subdirectory the validators run in is part of the key (dir).
        const useCache = config.validate.cache && !has('no-cache') && scope.mode !== 'affected';
        const t0 = Date.now();
        const ran = runWithCache(plan.run, runList, {
          main: mainCheckout(io.cwd), git: useCache ? cacheGit(restoreAt.git) : restoreAt.git, dir: useCache ? checkoutPrefix(restoreAt.git) : null,
          repo: repoReader(repoDir), generated: config.generated,
          read: useCache && scope.mode !== 'final', write: useCache, now: io.now,
        });
        let k = 0;
        let results = list.map(v => plan.skipped.get(v.name) ?? ran[k++]);
        const durationMs = Date.now() - t0;
        if (has('baseline')) {
          if (flag('baseline') === undefined) throw new UsageError('validate: --baseline needs the JSON a validate run printed on the base commit');
          let baseline: unknown;
          try { baseline = JSON.parse(readFileSync(path.resolve(io.cwd, flag('baseline')!), 'utf8')); } catch { throw new UsageError('validate: --baseline must be the JSON written by forge validate'); }
          results = markPreexisting(results, baseline);
        }
        const allOk = results.every(r => !blocking(r));
        appendEvent(io.cwd, validateEvent(ts(), flag('task'), results, durationMs, scope.mode, has('base-run') ? { baseline: true } : {}));
        const out = json(results, allOk ? 0 : 1);
        if (!list.length) out.stderr = all.length ? 'no validators cover the affected paths\n' : 'no validators detected: add tests or list validators in .forge/config.yaml\n';
        out.stderr += plan.notes.map(n => `${n}\n`).join('');
        if (restored.length) out.stderr += `restored ${restored.length} tracked file(s) the validators regenerated: ${restored.join(', ')}\n`;
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
          // D-08: the last validation of this task of its project (--project, the folder --dir names, or the ledger's).
          const ledger = readEvents(io.cwd);
          const mine = eventsOf(ledger, { project: resolveProject({ flag: flag('project'), dir: dirArg, task, events: ledger }), task });
          const lastValidate = [...mine].reverse().find(e => e.kind === 'validate' && isTask(e, task) && e.baseline !== true);
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
        if (verifyFile !== undefined) logVerifyResult(io.cwd, ts(), task, dir, verifyFile);
        // invalid and incomplete (a draft with "complete": false) name the reviewers to respawn once.
        return json({ ...result, invalid: result.reviewers.filter(r => r.invalid).map(r => r.name), incomplete: result.reviewers.filter(r => r.incomplete).map(r => r.name) });
      }
      case 'verify-result': {
        // A verification outside a verdict (Small and Trivial have no review): its result logged as verdict logs it.
        const task = flag('task');
        const dirArg = flag('dir');
        if (!task || !dirArg) throw new UsageError('verify-result: --task and --dir are required');
        const dir = path.resolve(io.cwd, dirArg);
        const verifyPath = path.join(dir, 'verify.json');
        if (!existsSync(verifyPath)) throw new UsageError(`verify-result: no verify.json in ${dirArg}`);
        const verifyFile = parseVerifyFile(readFileSync(verifyPath, 'utf8'));
        if (!verifyFile) throw new UsageError(`verify-result: ${dirArg}/verify.json is not a usable verify result (result pass|fail|blocked, checks, a reason when blocked)`);
        return json({ task, ...logVerifyResult(io.cwd, ts(), task, dir, verifyFile) });
      }
      case 'verify-cleanup': {
        const dir = flag('dir');
        if (!dir) throw new UsageError('verify-cleanup: --dir is required');
        return json(cleanupEvidence(path.resolve(io.cwd, dir)));
      }
      case 'verify-close': {
        // Measure 10: what `## After the verdict` did in about ten steps, in one call. The skill keeps the upload of the
        // shots and the `update state/T` with their urls, and shows the proposals to the person.
        const task = flag('task'), dirArg = flag('dir'), evArg = flag('evidence');
        if (!task || !dirArg || !evArg) throw new UsageError('verify-close: --task, --dir and --evidence are required');
        const loc = flag('locale');
        if (has('locale') && loc !== 'es' && loc !== 'en') throw new UsageError('verify-close: --locale must be es|en');
        const es = (loc ?? planLocale(io.cwd)) === 'es';
        const dir = path.resolve(io.cwd, dirArg);
        const evidence = path.resolve(io.cwd, evArg);
        const verifyPath = path.join(dir, 'verify.json');
        const v = parseVerifyFile(existsSync(verifyPath) ? readFileSync(verifyPath, 'utf8') : null);
        if (!v) throw new UsageError(`verify-close: ${dirArg}/verify.json is not a usable verify result (result pass|fail|blocked, checks, a reason when blocked)`);
        // 1. The learned notes of each surface, into the code checked (--cwd), as `surfaces learn` adds them.
        const notes = new Map<string, string[]>();
        for (const l of v.learned) notes.set(l.surface, [...(notes.get(l.surface) ?? []), l.note]);
        const learned: Record<string, number> = {};
        const skipped: { surface: string; reason: string }[] = [];
        const commit: string[] = [];
        for (const [name, list] of notes) {
          if (!NAME.test(name)) { skipped.push({ surface: name.slice(0, 80), reason: 'not a surface name' }); continue; }
          const r = learnSurface(io, repoDir, name, list, es ? 'Aprendido' : 'Learned');
          if ('reason' in r) { skipped.push({ surface: name, reason: r.reason }); continue; }
          learned[name] = r.count;
          commit.push(surfaceFile(name));
        }
        // 2. The processes the verify agent left running.
        const cleanup = cleanupEvidence(evidence);
        // 3. The result, once: closing again (or after review-close or verify-result logged it) adds no event.
        const passed = v.checks.filter(c => c.ok).length, total = v.checks.length;
        // The `evidence` field logVerifyResult writes: only for a `reviews-<n>-<k>` dir.
        const relDir = path.relative(io.cwd, dir).split(path.sep).join('/');
        const evRel = relDir.replace(/reviews-(\d+-\d+)$/, 'evidence/$1');
        const evField = evRel !== relDir ? evRel : undefined;
        const ledger = readEvents(io.cwd);
        const last = eventsOf(ledger, { project: resolveProject({ flag: flag('project'), dir: dirArg, task, events: ledger }), task })
          .filter(e => e.kind === 'verify' && isTask(e, task) && typeof e.result === 'string').at(-1);
        if (!last || last.result !== v.result || last.passed !== passed || last.total !== total || last.evidence !== evField) logVerifyResult(io.cwd, ts(), task, dir, v);
        // 4. Where the evidence goes, read now (the person may have changed it).
        let mode: 'upload' | 'local' = 'upload';
        try { mode = loadConfig(mainCheckout(io.cwd)).evidence; } catch { mode = 'upload'; }
        // 5. This pass's screenshots (inside the evidence dir only, by real path) and the asset ids of the previous pass.
        let realEvidence: string;
        try { realEvidence = realpathSync(evidence); } catch { realEvidence = evidence; }
        const inside = (f: string) => { const r = path.relative(realEvidence, f); return r !== '' && !r.startsWith('..') && !path.isAbsolute(r); };
        const shots = v.checks.filter(c => c.shot).flatMap(c => {
          const file = path.resolve(evidence, c.shot!);
          let real: string, bytes: number;
          try { real = realpathSync(file); bytes = statSync(real).size; } catch { return []; }
          if (!inside(real)) return [];
          return [{ file: path.relative(io.cwd, file).split(path.sep).join('/'), surface: c.surface, check: c.name, ok: c.ok, expected: c.expected, observed: c.observed, bytes, oversize: bytes > SHOT_MAX_BYTES }];
        });
        let previous: string[] = [];
        const db = flag('db');
        if (db) {
          const base = task.replace(/-\d+$/, '');
          let published: string[] = [];
          try {
            const st = JSON.parse(readFileSync(path.resolve(io.cwd, db, 'state', `${base}.json`), 'utf8')) as { evidence?: { shots?: { id?: unknown }[] } };
            published = (st.evidence?.shots ?? []).map(s => s?.id).filter((x): x is string => typeof x === 'string' && x.length > 0);
          } catch { published = []; }
          // M5: only the assets this checkout knows no screenshot of the task links any more: those its kept uploads hold for
          // another run or another brief (the evidence keeps every round of the brief in progress). An id it does not know,
          // or any id without a readable kept list, cannot be judged here and stays.
          const main = mainCheckout(io.cwd);
          const project = resolveProject({ flag: flag('project'), dir: dirArg, task, events: ledger });
          const runId = runHolding(main, base, project);
          const brief = Number(/-(\d+)$/.exec(task)?.[1] ?? NaN);
          const kept = readKeptAssets(main, { project, task: base }, ledger) ?? [];
          const linked = (a: { runId: string | null; round: string }) => a.runId === runId && Number(a.round.split('-')[0]) === brief;
          const live = new Set(kept.filter(linked).map(a => a.id));
          const stale = new Set(kept.filter(a => !linked(a)).map(a => a.id));
          previous = published.filter(id => stale.has(id) && !live.has(id));
        }
        const big = shots.filter(s => s.oversize).length;
        const learnedText = Object.entries(learned).map(([n, k]) => `${n} (${k})`).join(', ');
        const say = es
          ? `Verificación ${v.result}: ${passed}/${total} comprobaciones${learnedText ? `; aprendido en ${learnedText}` : ''}${shots.length ? `; ${shots.length} captura(s)${big ? ` (${big} de más de 2 MB)` : ''}` : ''}.`
          : `Verification ${v.result}: ${passed}/${total} checks${learnedText ? `; learned in ${learnedText}` : ''}${shots.length ? `; ${shots.length} screenshot(s)${big ? ` (${big} over 2 MB)` : ''}` : ''}.`;
        return json({
          task, result: v.result, passed, total, learned, ...(skipped.length ? { skipped } : {}), proposals: v.proposals, cleanup,
          evidence: { mode, dir: path.relative(io.cwd, evidence).split(path.sep).join('/'), shots, previous }, commit, say,
        });
      }
      case 'round': {
        const task = flag('task');
        const p = flag('path');
        if (!task || (p !== 'medium' && p !== 'large')) throw new UsageError('round: --task and --path medium|large are required');
        const ledger = readEvents(io.cwd);
        const project = resolveProject({ flag: flag('project'), task, events: ledger });
        // Carry 3: in an execution, only its own verdicts count.
        const d = roundDecision(ledger, task, p, loadConfig(repoDir).profile, project, executionHolding(io.cwd, { project, task: baseOf(task) })?.startedAt ?? null);
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
        // §4.1: the owner's mark of a decision, as approvals/<pid> takes it (only the roadmap's owner can write it).
        const approvalOf = (id: string, status: ApprovalDoc['status'], at: string, p: Parameters<typeof proposalDigest>[1], by: ApprovalDoc['by'] = 'forge:decide') =>
          ({ op: 'set' as const, collection: 'approvals', doc_id: id, data: { status, decidedAt: at, by, digest: proposalDigest(id, p) } });
        switch (sub) {
          case 'add': {
            const file = subFlag('file');
            if (!file) throw new UsageError('proposals add: --file is required');
            let raw: unknown;
            try { raw = JSON.parse(readText(file, '--file')); } catch (e) { if (e instanceof UsageError) throw e; throw new UsageError('proposals add: --file must be a JSON object'); }
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new UsageError('proposals add: --file must be a JSON object');
            const o = raw as Record<string, unknown>;
            const doc = normalizeProposal({ ...o, ts: typeof o.ts === 'string' ? o.ts : ts(), status: 'proposed', decidedBy: undefined, decidedAt: undefined, reason: undefined, taskId: undefined, history: undefined, author: subFlag('author') ?? o.author ?? 'session' });
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
            appendEvent(io.cwd, { ts: ts(), kind: 'proposal', action: 'add', id, digest: proposalDigest(id, doc), ...(revises ? { revises } : {}) });
            return json({ id, doc });
          }
          case 'list': {
            const status = subFlag('status');
            if (status !== undefined && !(PROPOSAL_STATUSES as readonly string[]).includes(status)) throw new UsageError(`proposals list: --status must be one of ${PROPOSAL_STATUSES.join('|')}`);
            const all = loadProposals(io.cwd).filter(p => status === undefined || p.status === status);
            all.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : a.id < b.id ? 1 : -1));
            const reasons = unownedReasons(io.cwd, io.now());
            return json({ proposals: all, unowned: Object.keys(reasons).length, unownedReasons: reasons });
          }
          case 'decide': {
            const [id, action] = rest;
            if (!id || !PROPOSAL_ID.test(id)) throw new UsageError('proposals decide: a proposal id (p + 14 digits + 4 letters/digits) is required');
            if (action !== 'approve' && action !== 'reject' && action !== 'discuss' && action !== 'confirm') throw new UsageError('proposals decide: action must be approve|reject|discuss|confirm');
            const rf = subFlag('reason-file');
            const reason = rf !== undefined ? readText(rf, '--reason-file').trim() : undefined;
            const by = subFlag('by') ?? 'user';
            const at = ts();
            const from = subFlag('from');
            const reopen = has('reopen');
            let base: ReturnType<typeof normalizeProposal>;
            if (from !== undefined) {
              // Roadmap path: validate against the db doc only; nothing is written or logged until
              // the roadmap update succeeds and the skill runs `proposals save`.
              try { base = normalizeProposal(JSON.parse(readText(from, '--from'))); } catch (e) { if (e instanceof UsageError) throw e; base = null; }
              if (!base) throw new UsageError('proposals decide: --from must be a valid proposal doc');
            } else {
              base = loadProposal(io.cwd, id);
              if (!base) throw new UsageError(`proposals decide: ${id} not found`);
            }
            // §4.1: confirm marks the decision the proposal already has (one taken on a page that wrote no mark, or before wave 4).
            if (action === 'confirm') {
              const status = base.status;
              if (status !== 'approved' && status !== 'auto_approved' && status !== 'rejected') throw new UsageError(`proposals decide: ${id} is ${status}: only a decided proposal is confirmed`);
              const approval = approvalOf(id, status, at, base);
              // The latest decision of this checkout: a reopen before it no longer voids the mark it makes. On the roadmap path
              // it is logged only once the mark landed (M3): the skill logs the `event` printed here.
              const event = { action: 'confirm', id, status };
              if (from !== undefined) return json({ id, status, approval, event });
              saveApproval(io.cwd, id, approval.data);
              appendEvent(io.cwd, { ts: at, kind: 'proposal', ...event });
              return json({ id, status, approval });
            }
            // A reopen also refuses while the proposal has a task: in the db doc, or in a plan (a task made from it, or
            // the local mirror's taskId, which to-task sets before the roadmap does, while a plan still has that task).
            const held = reopen ? base.taskId ?? heldTask(planTasksFor(io.cwd, subFlag('plan')), id, loadProposal(io.cwd, id)?.taskId) : undefined;
            const checked = held !== undefined ? { ...base, taskId: held } : base;
            const r = decideDoc(checked, action as Decision, by, at, reason || undefined, { reopen });
            if (!r.ok) throw new UsageError(`proposals decide: ${decideRefusal(id, checked, r.error)}`);
            const mark = r.doc.status === 'approved' || r.doc.status === 'rejected' ? approvalOf(id, r.doc.status, at, r.doc) : null;
            // M1: a mark this checkout holds for the pid (one an editor left in place by setting the status back, say) goes
            // first, as a reopened decision's does: the skill pins the delete to the version it lists, and the new mark, if
            // any, is then a create. Read before the local path below replaces it.
            const marked = loadApproval(io.cwd, id) !== null;
            const event = reopen ? { action: 'reopen', id, from: base.status, to: r.doc.status } : { action: 'decide', id, status: r.doc.status };
            if (from === undefined) {
              saveProposal(io.cwd, id, r.doc);
              if (mark) saveApproval(io.cwd, id, mark.data); else removeApproval(io.cwd, id);
              appendEvent(io.cwd, { ts: at, kind: 'proposal', ...event });
            }
            // M3: on the roadmap path the decision is logged only once the roadmap took it: the skill logs this `event`.
            const logLater = from !== undefined ? { event } : {};
            const approvalDelete = reopen || marked ? { approvalDelete: { op: 'delete' as const, collection: 'approvals', doc_id: id } } : {};
            if (!reopen) return json({ id, status: r.doc.status, write: writeOf(r.doc, by, at), approval: mark, ...approvalDelete, ...logLater });
            // The skill sends `write` pinned to the version it read; a stale reason is deleted.
            const write: Record<string, unknown> = { ...writeOf(r.doc, by, at), history: r.doc.history };
            if (!r.doc.reason && base.reason) write.reason = { __delete__: true };
            // The decision reopened no longer stands: its mark in the roadmap goes. Without it an editor who sets the status
            // back finds the old mark.
            return json({ id, status: r.doc.status, previous: base.status, write, approval: mark, ...approvalDelete, ...logLater });
          }
          case 'save': {
            const from = subFlag('from');
            if (!from) throw new UsageError('proposals save: --from is required');
            const id = subFlag('id') ?? path.basename(from).replace(/(\.db)?\.json$/, '');
            if (!PROPOSAL_ID.test(id)) throw new UsageError('proposals save: a proposal id (p + 14 digits + 4 letters/digits) is required (--id, or a <id>.json / <id>.db.json file name)');
            let doc: ReturnType<typeof normalizeProposal>;
            try { doc = normalizeProposal(JSON.parse(readText(from, '--from'))); } catch (e) { if (e instanceof UsageError) throw e; doc = null; }
            if (!doc) throw new UsageError('proposals save: --from must be a valid proposal doc');
            const { previous, previousDoc } = mirrorProposal(io.cwd, id, doc, taskId => heldTask(planTasksFor(io.cwd, subFlag('plan')), id, taskId) === taskId);
            // M3: save only mirrors. Whoever wrote the status (an editor, say), it is no decision of this checkout's owner: only
            // decide, confirm, a reopen and the policy log one (the roadmap path logs the `event` decide prints, once it landed).
            // A decided proposal that changes status is a reopen; one made by hand (not through `decide --reopen`) carries no
            // new history entry for the decision it replaced. Moving to done is the normal lifecycle, never a reopen.
            const reopened = (previous ?? 'proposed') !== doc.status && previousDoc !== null && !canDecide(previousDoc.status) && doc.status !== 'done';
            // Tracked: a history entry the mirror lacks that records the mirror's own decision (status, who, when).
            const known = new Set((previousDoc?.history ?? []).map(e => JSON.stringify(e)));
            const tracked = previousDoc !== null && (doc.history ?? []).some(e => !known.has(JSON.stringify(e))
              && e.status === previousDoc.status && e.decidedBy === previousDoc.decidedBy && e.decidedAt === previousDoc.decidedAt);
            const stderr = reopened && !tracked ? `proposals save: ${id} went from ${previousDoc.status} to ${doc.status} with no new history entry: the change was not made through proposals decide --reopen\n` : '';
            return { ...json({ id, status: doc.status, previous }), stderr };
          }
          case 'pull': {
            const dir = subFlag('dir');
            if (!dir) throw new UsageError('proposals pull: --dir is required');
            const abs = path.resolve(io.cwd, dir);
            let names: string[] = [];
            if (existsSync(abs)) {
              try { names = readdirSync(abs); } catch { throw new UsageError(`proposals pull: cannot read ${dir}`); }
            }
            // §4.1: the roadmap's marks replace the local ones. Without the owner rule (meta/page.rules under 2: a roadmap
            // published before wave 4, where approvals/ inherits write: admin) no mark counts and every local one goes.
            // Read before anything is written: a folder that cannot be read leaves the mirror as it was.
            const withMarks = has('approvals');
            const db: Record<string, ApprovalDoc> = {};
            let rules = 0;
            let page: unknown = null;
            if (withMarks) {
              const marksDir = subFlag('approvals');
              if (!marksDir) throw new UsageError('proposals pull: --approvals needs the listed approvals folder');
              const pageFile = subFlag('page');
              if (!pageFile) throw new UsageError('proposals pull: --approvals needs --page (the listed meta/page.json)');
              page = (() => { try { return JSON.parse(readFileSync(path.resolve(io.cwd, pageFile), 'utf8')) as unknown; } catch { return null; } })();
              rules = page && typeof page === 'object' && typeof (page as { rules?: unknown }).rules === 'number' ? (page as { rules: number }).rules : 0;
              const marksAbs = path.resolve(io.cwd, marksDir);
              if (rules >= PAGE_RULES && existsSync(marksAbs)) {
                let marks: string[];
                try { marks = readdirSync(marksAbs).sort(); } catch { throw new UsageError(`proposals pull: cannot read ${marksDir}`); }
                for (const name of marks) {
                  const id = name.endsWith('.json') ? name.slice(0, -5) : '';
                  if (!PROPOSAL_ID.test(id)) continue;
                  let a: ApprovalDoc | null = null;
                  try { a = normalizeApproval(JSON.parse(readFileSync(path.join(marksAbs, name), 'utf8'))); } catch { a = null; }
                  if (a) db[id] = a;
                }
              }
            }
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
            if (!withMarks) return ok(String(n));
            // Carry 12: the rules this pull read decide whether a newer owner mark may outrank an older local decision.
            forgeDir(io.cwd);
            writeFileSync(approvalsPageFile(io.cwd), JSON.stringify({ rules }) + '\n');
            let removed = 0;
            for (const id of Object.keys(loadApprovals(io.cwd))) if (!db[id]) { removeApproval(io.cwd, id); removed++; }
            for (const [id, a] of Object.entries(db)) saveApproval(io.cwd, id, a);
            const count = Object.keys(db).length;
            // The owner rule is known here only from meta/page.rules, which an editor can also write on a roadmap that lacks it.
            // Said once per checkout and roadmap: the marker lives in .forge/. Carry 10: one source for the key, the page's
            // own id (meta/page.roadmap, the plan's project), and --roadmap only for a page that has none.
            const pageRoadmap = page && typeof page === 'object' && typeof (page as { roadmap?: unknown }).roadmap === 'string' ? (page as { roadmap: string }).roadmap : '';
            const roadmap = pageRoadmap || (subFlag('roadmap') ?? '');
            const markerFile = path.join(io.cwd, '.forge', 'approvals-warned.json');
            const warnedFor = (() => { try { return (JSON.parse(readFileSync(markerFile, 'utf8')) as { roadmap?: unknown }).roadmap; } catch { return undefined; } })();
            const warning = count > 0 && warnedFor !== roadmap ? 'proposals pull: approvals are owner-only once the roadmap is republished with this version; until then an editor could write them\n' : '';
            if (warning) { forgeDir(io.cwd); writeFileSync(markerFile, JSON.stringify({ roadmap }) + '\n'); }
            return { ...json({ proposals: n, approvals: count, removed, rules, ownerRule: rules >= PAGE_RULES }), stderr: warning };
          }
          case 'policy': {
            const id = rest[0];
            if (!id || !PROPOSAL_ID.test(id)) throw new UsageError('proposals policy: a proposal id is required');
            const found = loadProposals(io.cwd).find(p => p.id === id);
            if (!found) throw new UsageError(`proposals policy: ${id} not found`);
            const { id: _id, ...doc } = found;
            // An owner's mark already decided this one (a non-owner reset its status): the policy does not overwrite it.
            // Origin: only a proposal this checkout added (its ledger `add` event carries the digest of the text it added) is auto-approved;
            // one an editor wrote on the page and a pull saved, or whose text changed since, is left to the owner.
            // The policy speaks once and first: a pid already decided, reopened or converted, and a v2 (--revises), are left to the owner.
            const events = readEvents(io.cwd).filter(e => e.kind === 'proposal' && e.id === id);
            const decided = doc.status !== 'proposed' || loadApproval(io.cwd, id) !== null
              || events.some(e => e.action === 'decide' || e.action === 'reopen' || e.action === 'to-task');
            const forgeMade = events.some(e => e.action === 'add' && e.digest === proposalDigest(id, doc) && !e.revises);
            // Carry 5: a refusal says why, so the infinite skill and the person can tell them apart: already decided (or
            // marked, or converted), not this checkout's own text, or its signals.
            const reason = decided ? 'decided' : !forgeMade ? 'origin' : !autoApprovable(doc) ? 'signals' : null;
            if (reason) {
              appendEvent(io.cwd, { ts: ts(), kind: 'proposal', action: 'policy', id, status: doc.status });
              return json({ id, status: doc.status, write: null, approval: null, reason });
            }
            const at = ts();
            saveProposal(io.cwd, id, { ...doc, status: 'auto_approved', decidedBy: 'forge:policy', decidedAt: at });
            const approval = approvalOf(id, 'auto_approved', at, doc, 'forge:policy');
            saveApproval(io.cwd, id, approval.data);
            appendEvent(io.cwd, { ts: at, kind: 'proposal', action: 'policy', id, status: 'auto_approved' });
            return json({ id, status: 'auto_approved', write: { status: 'auto_approved', decidedBy: 'forge:policy', decidedAt: at }, approval });
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
            // §4.1: only the roadmap owner's approvals become tasks: the mark must agree with the proposal and with its text.
            // A decision this checkout reopened since stops counting, even if its mark is still in the roadmap, unless the
            // owner decided again after it (carry 12).
            const mark = loadApproval(io.cwd, id);
            const lastStatus = bindingDecision(lastDecisions(io.cwd)[id], mark, pulledRules(io.cwd) >= PAGE_RULES, io.now().getTime());
            const check = ownerCheck(id, found, mark, lastStatus);
            if (check === 'no-mark') throw new UsageError(`proposals to-task: ${id} has no mark of the roadmap's owner (approvals/${id}); only the owner's approvals become tasks`);
            if (!ownerApproved(id, found, mark, lastStatus)) throw new UsageError(`proposals to-task: ${id} was edited after the owner's approval; it needs a new approval`);
            // A mark is spent once: a proposal that already became a task (the ledger, which a pull never touches, or the plan)
            // is not turned into another by a copy that lost its taskId.
            const spent = readEvents(io.cwd).find(e => e.kind === 'proposal' && e.action === 'to-task' && e.id === id);
            const text = readText(planArg, '--plan');
            let plan;
            try { plan = parsePlan(text); } catch (e) {
              if (e instanceof PlanError) throw new UsageError(`${planArg}: ${e.issues.join('; ')}`);
              throw e;
            }
            const became = plan.tasks.find(t => proposalsOfIncludes(t.includes).includes(id))?.id ?? (spent ? String(spent.taskId ?? '?') : undefined);
            if (became !== undefined) throw new UsageError(`proposals to-task: proposal ${id} already became ${became}: a new approval of a new proposal is needed`);
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
          const surfaces = readSurfaces(io.cwd, readLearned(io.cwd));
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
          // Only the headings permissionHash knows: another one would make the notes unknown text.
          const heading = flag('heading') ?? 'Learned';
          if (!(LEARNED_HEADINGS as readonly string[]).includes(heading)) throw new UsageError(`surfaces learn: --heading must be ${LEARNED_HEADINGS.join('|')}`);
          const r = learnSurface(io, io.cwd, name, notes as string[], heading);
          if ('reason' in r) throw new UsageError(`surfaces learn: ${r.reason}`);
          return json({ name, count: r.count });
        }
        throw new UsageError('usage: forge surfaces [learn --name N --notes-file F [--heading H] | proposed --name N]');
      }
      case 'setup': {
        // J-17: the dependencies of a directory (--cwd: a worktree) installed as swarm installs a task worktree's:
        // swarm.setup of the main checkout's config, else the install command of the directory's lockfile.
        const main = mainCheckout(io.cwd);
        const defaults = (dir: string) => ({ git: defaultGit(dir), exec: defaultExec(dir), repo: repoReader(dir) });
        const setup = runSetup({
          git: io.git ?? defaultGit(repoDir), exec: io.exec ?? defaultExec(repoDir), repo: repoReader(repoDir),
          at: dir => (samePath(dir, repoDir) ? { git: io.git ?? defaultGit(dir), exec: io.exec ?? defaultExec(dir), repo: repoReader(dir) } : defaults(dir)),
        }, repoDir, main);
        return json({ setup });
      }
      case 'tools': {
        // The surfaces of the code checked (--cwd: a task's worktree).
        const all = readSurfaces(repoDir);
        const one = flag('surface');
        const picked = one === undefined ? all : all.filter(s => s.name === one);
        if (one !== undefined && !picked.length) throw new UsageError(`tools: no surface ${one} in .forge/verify/`);
        const names = picked.flatMap(s => s.tools);
        return json(checkTools(names, { onPath, inventory: names.length ? mcpOf(io, repoDir) : new Set(), exec: io.exec ?? defaultExec(io.cwd) }));
      }
      case 'verify-plan': {
        const task = flag('task'), p = flag('path'), base = flag('base');
        if (!task || !p || !base) throw new UsageError('verify-plan: --task, --path and --base are required');
        if (!(PATH_ORDER as readonly string[]).includes(p)) throw new UsageError(`verify-plan: --path must be one of ${PATH_ORDER.join('|')}`);
        const loc = flag('locale');
        if (has('locale') && loc !== 'es' && loc !== 'en') throw new UsageError('verify-plan: --locale must be es|en');
        // I2: --dir <review dir> (reviews-<n>-<round>): swarm step waits there for the verify agent of the surfaces it chose.
        const dirArg = flag('dir');
        const roundDir = dirArg === undefined ? null : path.resolve(io.cwd, dirArg);
        const roundOf = roundDir ? /^reviews-(\d+)-(\d+)$/.exec(path.basename(roundDir)) : null;
        if (has('dir') && !roundOf) throw new UsageError('verify-plan: --dir must be a review dir, .forge/work/<project>/<T>/reviews-<n>-<round> (a loose task: .forge/work/<id>/reviews-<n>-<round>)');
        const es = (loc ?? planLocale(io.cwd)) === 'es';
        const git = io.git ?? defaultGit(io.cwd);
        const diff = git(['diff', '--name-only', `${base}..HEAD`]);
        // The surfaces of the code checked (--cwd: a task's worktree), the permissions of this machine.
        const surfaces = readSurfaces(repoDir, readLearned(io.cwd));
        const local = readLocal(io.cwd);
        let inventory: Set<string> | null = null;
        const plan = verifyPlan({
          path: p, asked: has('asked'),
          changed: diff === null ? null : diff.split('\n').map(s => s.trim()).filter(Boolean),
          surfaces, drafts: detectDrafts(repoReader(repoDir)), local,
          tools: s => (s.tools.length ? toolGaps(s.tools, { onPath, inventory: inventory ??= mcpOf(io, repoDir) }) : { missing: [], unknown: [] }),
        });
        appendEvent(io.cwd, { ts: ts(), kind: 'verify', task, planned: plan.eligible, surfaces: plan.surfaces.filter(s => s.permission === 'allowed').map(s => s.name) });
        if (roundDir && roundOf) {
          // verify-pending.json: the surfaces it can verify (allowed now) and what a verify agent needs to be spawned
          // again. A surface the coordinator decides not to verify is logged as a verify-skip; with none, no marker.
          const pending = path.join(roundDir, 'verify-pending.json');
          const chosen = plan.surfaces.filter(s => s.permission === 'allowed');
          const rel = (f: string) => path.relative(io.cwd, f).split(path.sep).join('/');
          const work = path.dirname(roundDir);
          const [, n, round] = roundOf;
          if (plan.eligible && chosen.length) {
            mkdirSync(roundDir, { recursive: true });
            writeFileSync(pending, JSON.stringify({
              task, at: ts(), surfaces: chosen.map(s => ({ name: s.name, file: surfaceFile(s.name), missing: s.missing, unknown: s.unknown })),
              brief: rel(path.join(work, `brief-${n}.md`)), diff: rel(path.join(work, `diff-${n}.patch`)), dir: rel(roundDir), evidence: rel(path.join(work, 'evidence', `${n}-${round}`)),
            }, null, 2) + '\n');
          } else rmSync(pending, { force: true });
        }
        return json({ ...plan, surfaces: plan.surfaces.map(ps => surfaceQuestion(ps, surfaces.find(s => s.name === ps.name)!, local.surfaces[ps.name], git, repoDir, io.cwd, es)) });
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
        if (sub === 'set' && (key === 'workflow' || key === 'autonomy')) {
          if (value === 'none') {
            updateLocal(io.cwd, s => { const next = { ...s }; delete next[key]; return next; });
            return ok('ok');
          }
          if (key === 'workflow' ? !isWorkflow(value) : !isAutonomy(value)) throw new UsageError(`local set: ${key} must be one of ${(key === 'workflow' ? WORKFLOWS : AUTONOMIES).join('|')}|none`);
          updateLocal(io.cwd, s => ({ ...s, [key]: value }));
          return ok('ok');
        }
        if (sub === 'set') {
          const m = /^surfaces\.(.+)$/.exec(key ?? '');
          if (!m || !NAME.test(m[1])) throw new UsageError('local set: the path must be surfaces.<name>');
          if (value !== 'allowed' && value !== 'denied' && value !== 'none') throw new UsageError('local set: the value must be allowed|denied|none');
          // An allowance is tied to what the surface says now (in the code checked, --cwd): a later edit of the file asks
          // again (verify-plan: changed). --expect: the hash verify-plan showed, so a file changed since the question is
          // never allowed. It keeps the file's blob and the commit, so a later change can be shown as a diff.
          const expected = flag('expect');
          if (has('expect') && !expected) throw new UsageError('local set: --expect needs the hash verify-plan gave');
          const surface = readSurfaces(repoDir, readLearned(io.cwd)).find(x => x.name === m[1]);
          if (value === 'allowed' && !surface) throw new UsageError(`local set: .forge/verify/${m[1]}.md does not exist`);
          if (value === 'allowed' && expected !== undefined && expected !== surface!.hash) {
            throw new UsageError(`local set: .forge/verify/${m[1]}.md changed since verify-plan showed it: run verify-plan again`);
          }
          let perm: SurfacePermission = { state: 'denied', hash: null };
          if (value === 'allowed') {
            const blob = surfaceBlob(repoDir, surface!.file);
            const commit = (io.git ?? defaultGit(repoDir))(['rev-parse', 'HEAD'])?.trim();
            perm = { state: 'allowed', hash: surface!.hash, ...(blob ? { blob } : {}), ...(commit && OBJECT_ID.test(commit) ? { commit } : {}) };
          }
          updateLocal(io.cwd, s => {
            const surfaces = { ...s.surfaces };
            if (value === 'none') delete surfaces[m[1]];
            else surfaces[m[1]] = perm;
            return { ...s, surfaces };
          });
          return ok('ok');
        }
        throw new UsageError('usage: forge local get [surfaces.<name>] | set surfaces.<name> allowed [--expect <hash>]|denied|none | set workflow <w>|none | set autonomy ask|auto|none');
      }
      case 'prefs': {
        const wf = flag('workflow');
        const au = flag('autonomy');
        if (wf !== undefined && !isWorkflow(wf)) throw new UsageError(`prefs: --workflow must be one of ${WORKFLOWS.join('|')}`);
        if (au !== undefined && !isAutonomy(au)) throw new UsageError(`prefs: --autonomy must be one of ${AUTONOMIES.join('|')}`);
        return json(resolvePrefs({ ...(wf ? { workflow: wf } : {}), ...(au ? { autonomy: au } : {}) }, readLocal(io.cwd), loadConfig(repoDir)));
      }
      case 'roadmap-doc':
      case 'roadmap-run':
        // C7 (wave 4): the roadmap documents the CLI builds; their own exit codes (2, and 3 for a block that does not fit).
        return roadmapCommand(cmd, args, io);
      case 'swarm':
        return swarmCommand(args, io, {
          git: io.git ?? defaultGit(io.cwd), exec: io.exec ?? defaultExec(io.cwd), execMany: io.execMany, repo: repoReader(repoDir),
          at: dir => ({ git: defaultGit(dir), exec: defaultExec(dir), execMany: defaultExecMany(dir), repo: repoReader(dir) }),
        }, { step: rest => swarmStep(rest, io, { cli: argv => run(argv, io), gitAt: dir => defaultGit(dir) }) });
      case 'review-prep':
      case 'review-close':
      case 'prep':
      case 'shadow':
        return reviewCommand(cmd, args, {
          cwd: io.cwd, repoDir, now: io.now, git: io.git ?? defaultGit(repoDir), exec: io.exec ?? defaultExec(repoDir), execMany: io.execMany, repo: repoReader(repoDir),
          self: io.scriptPath ?? process.argv[1],
          slot: io.slot,
        });
      case 'hook': {
        const which = args[0];
        const out = which === 'stop' ? hookStop(io) : which === 'live' ? hookLive(io)
          : which === 'route-session' ? hookRoute(io, 'session') : which === 'route-prompt' ? hookRoute(io, 'prompt') : '';
        return { code: 0, stdout: out, stderr: '' };
      }
      case 'tree': {
        // The work tree of the code (--cwd) against the snapshot kept with forge's state (the caller's directory).
        const sub = args[0];
        const task = flag('task');
        const usage = 'usage: forge tree snapshot --task <id> [--force] [--cwd <dir>] | check --task <id> --base <sha> [--cwd <dir>] (the same --cwd as the snapshot; --base is the task\'s own base)';
        if ((sub !== 'snapshot' && sub !== 'check') || !task) throw new UsageError(usage);
        if (!isSafeId(task)) throw new UsageError(`tree ${sub}: --task must use letters, digits, _ - . (at most 120)`);
        const git = io.git ?? defaultGit(repoDir);
        const top = git(['rev-parse', '--show-toplevel'])?.trim();
        if (!top) throw new UsageError(`tree ${sub}: ${repoDir} is not a git work tree`);
        const treeRoot = path.resolve(top);
        // D-08: the task's work folder: its project's, or the older one the ledger still gives it.
        const ledger = readEvents(io.cwd);
        const file = path.join(readWorkDir(io.cwd, { project: resolveProject({ flag: flag('project'), task, events: ledger }), task }, ledger), 'tree-start.json');
        let text: string | null = null;
        try { text = readFileSync(file, 'utf8'); } catch { text = null; }
        const stored = parseSnapshot(text);
        if (sub === 'snapshot') {
          // The first snapshot stands: a later one would absorb the files the person created in between.
          if (stored && !has('force')) return ok(`${file} (already taken at ${stored.at}; --force replaces it)`);
          // .forge/ first, so the .gitignore forgeDir may create is in the snapshot, never a file that "appeared".
          forgeDir(io.cwd);
          const status = git(['status', '--porcelain', '-z', '-uall']);
          if (status === null) throw new UsageError(`tree snapshot: git status failed in ${repoDir}`);
          const head = git(['rev-parse', '--verify', '-q', 'HEAD'])?.trim() || null;
          const snap: TreeSnapshot = { task, root: treeRoot, at: ts(), head, ...parseStatus(status) };
          mkdirSync(path.dirname(file), { recursive: true });
          writeFileSync(file, JSON.stringify(snap, null, 2) + '\n');
          return ok(file);
        }
        const base = flag('base');
        if (!base) throw new UsageError(usage);
        if (base.startsWith('-') || git(['rev-parse', '--verify', '-q', `${base}^{commit}`]) === null) throw new UsageError(`tree check: --base ${base} is not a commit`);
        const status = git(['status', '--porcelain', '-z', '-uall']);
        if (status === null) throw new UsageError(`tree check: git status failed in ${repoDir}`);
        // The task's files: what its commits added or changed (a path it deleted is not its file).
        const diff = git(['diff', '--name-only', '-z', '--diff-filter=d', `${base}..HEAD`]);
        if (diff === null) throw new UsageError(`tree check: cannot diff ${base}..HEAD`);
        // A snapshot of another tree or another task is no baseline: everything is listed (fail safe).
        const snapshot = stored && stored.task === task && samePath(stored.root, treeRoot) ? stored : null;
        const out = treeCheck(snapshot, parseStatus(status), diff.split('\0').filter(Boolean));
        if (snapshot?.head && git(['merge-base', '--is-ancestor', base, snapshot.head]) === null) {
          out.warning = `--base ${base} is not an ancestor of the snapshot's head ${snapshot.head}: task may list commits that are not the task's`;
        }
        return json(out);
      }
      case 'config': {
        // The config of the main checkout, whatever --cwd says: a config the person writes by hand is untracked and
        // exists only there.
        const [sub, key] = args;
        if (sub !== 'get' || !key || key.startsWith('--')) throw new UsageError('usage: forge config get <key> (reads .forge/config.yaml of the main checkout, defaults applied; --cwd does not change it)');
        const value = configValue(loadConfig(mainCheckout(io.cwd)), key);
        if (value === undefined) throw new UsageError(`config get: ${key} is not a config key`);
        return ok(typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : JSON.stringify(value));
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
          const locale = flag('locale');
          if (has('locale') && !isLocale(locale)) throw new UsageError('infinite start: --locale must be a language code (es, en, pt-BR…)');
          if (cycles === undefined && hours === undefined) throw new UsageError('infinite start: a budget is required (--cycles N and/or --hours H)');
          // C1, K5-03: the run is bound to the session that starts it; only that session's Stop hook chains its cycles.
          const session = claudeSessionId(flag('session'), io.env ?? process.env);
          if (!session) throw new UsageError(noClaudeSession('infinite start', '--session'));
          // An active run blocks a new one only while nothing stops it and a session drives it: a run whose stop reason
          // is already due (e.g. its session died after a budget ran out or a stop was asked), or one left without a
          // session by forge 0.15 (no Stop hook chains its cycles any more), is replaced.
          // K2-01: the run lives in the main checkout, whichever worktree starts it; an older run left in this
          // directory still counts as the active one.
          const runRoot = runRootOf(io.cwd);
          const current = parseRun(readRunText(runRoot));
          if (current?.active && current.sessionId !== null && stopReason(current, stopContext(runRoot, io.now())) === null) throw new UsageError('infinite start: a run is already active (forge stop, or forge infinite status)');
          const main = mainCheckout(io.cwd);
          forgeDir(main);
          rmSync(stopFile(main), { force: true });
          const run: RunState = startRun(io.now(), { ...(cycles !== undefined ? { cycles } : {}), ...(hours !== undefined ? { hours } : {}) }, queueMax, session, locale ?? null);
          saveRun(main, run);
          return json({ ...run, publish: { infinite: infinitePublish(main, run, io.now()) } });
        }
        if (sub === 'status') {
          const runRoot = runRootOf(io.cwd);
          const text = readRunText(runRoot);
          const run = parseRun(text);
          const reason = run?.active ? stopReason(run, stopContext(runRoot, io.now())) : null;
          // §4.6: an active run no session drives (one forge 0.15 started) says so.
          const unbound = !!run?.active && run.sessionId === null;
          // G-08: meta/infinite as the roadmap takes it, for the skill to send as it is.
          const publish = run ? { infinite: infinitePublish(mainCheckout(io.cwd), run, io.now()) } : null;
          return json({ present: text !== null, valid: run !== null, run, stopReason: reason, reply: runReply(runRoot, run), ...(unbound ? { unbound: true, warning: UNBOUND_WARNING } : {}), unowned: unownedOf(runRoot, io.now()), publish });
        }
        throw new UsageError('usage: forge infinite <start --cycles N|--hours H [--queue-max N] [--session ID] [--locale CODE]|status>');
      }
      case 'cycle': {
        const progress = flag('progress');
        if (progress !== 'yes' && progress !== 'no') throw new UsageError('cycle: --progress yes|no is required');
        let error: string | undefined;
        if (flag('error-file') !== undefined) {
          try { error = readFileSync(path.resolve(io.cwd, flag('error-file')!), 'utf8'); } catch { throw new UsageError('cycle: cannot read --error-file'); }
        }
        const runRoot = runRootOf(io.cwd);
        const current = parseRun(readRunText(runRoot));
        if (!current?.active) throw new UsageError('cycle: no active run (forge infinite start)');
        const next = recordCycle(current, { progress: progress === 'yes', ...(error !== undefined ? { error } : {}) });
        saveRun(runRoot, next);
        appendEvent(runRoot, { ts: ts(), kind: 'cycle', cycle: next.cycle, progress: progress === 'yes', ...(next.lastError ? { error: next.lastError } : {}) });
        return json({ ...next, reply: runReply(runRoot, next), publish: { infinite: infinitePublish(mainCheckout(io.cwd), next, io.now()) } });
      }
      case 'stop': {
        // K2-01: forge's run and execution are the main checkout's, wherever this runs from.
        const main = mainCheckout(io.cwd);
        const runRoot = runRootOf(io.cwd);
        const at = ts();
        // The stop file stays so the bound session, if alive, exits cleanly; the run is closed here so a dead
        // session never keeps it active.
        for (const dir of samePath(main, runRoot) ? [main] : [main, runRoot]) { forgeDir(dir); writeFileSync(stopFile(dir), `${at}\n`); }
        const current = parseRun(readRunText(runRoot));
        if (current?.active) {
          saveRun(runRoot, endRun(current, 'stopped'));
          appendEvent(runRoot, { ts: at, kind: 'cycle', action: 'stopped', reason: 'stopped' });
        }
        // K2-02: an active execution stops for real. Its running tasks become stopped, keeping executor, branch and
        // worktree for swarm close; their public files expire now; their forge status ends with the phase stopped;
        // its members are listed and their files removed. forge stop never closes it: /forge:stop runs swarm close.
        let stopped: string[] = [];
        const after = readExecution(main)?.active ? updateExecution(main, cur => {
          if (!cur?.active) return null;
          stopped = Object.entries(cur.tasks).filter(([, t]) => t.status === 'running').map(([id]) => id);
          const tasks = { ...cur.tasks };
          for (const id of stopped) tasks[id] = { ...tasks[id], status: 'stopped', agent: null, detail: 'stopped by forge stop', updatedAt: at };
          return { ...cur, tasks, active: false, stopReason: 'stopped', sleepUntil: null };
        }, { now: io.now, sleep: io.sleep }) : null;
        let release: { task: string; write: { op: 'update'; collection: 'state'; doc_id: string; data: Record<string, unknown> } }[] = [];
        let members: { sessionId: string; name: string | null; role: string; task: string | null }[] = [];
        // The Claude sessions of this run: the coordinator's (the execution's hook session), its members' and the
        // infinite run's.
        const own = new Set<string>();
        const ofRun = after ?? readExecution(main);
        if (ofRun?.hookSession) own.add(ofRun.hookSession);
        if (current?.sessionId) own.add(current.sessionId);
        if (after) {
          for (const id of stopped) {
            let p: PublicTask | null = null;
            try { p = normalizePublicTask(JSON.parse(readFileSync(executionTaskFile(main, id), 'utf8'))); } catch { p = null; }
            if (p && p.task === id && p.runId === after.runId) writePublicTask(main, { ...p, status: 'stopped', agent: null, updatedAt: at, leaseUntil: at });
            // C4: the execution is no longer active, so the stamp would not name its run: the phase names it, and the
            // project of a plan run's task.
            appendEvent(main, { ts: at, kind: 'phase', task: id, phase: 'stopped', runId: after.runId, ...(after.kind === 'plan' && isSafeId(after.project) ? { project: after.project } : {}) });
          }
          // Every member of the run, not only those the role readers see: each is messaged, its file goes, its jobs are named.
          const listed = allMembersOf(main, after.runId);
          members = listed.map(m => ({ sessionId: m.sessionId, name: m.name, role: m.role, task: m.task }));
          for (const m of listed) { if (m.hookSession) own.add(m.hookSession); rmSync(memberFile(main, m.sessionId), { force: true }); }
          // A-23: the coordinator's own tasks go back to free on the roadmap (releaseWrites, the same writes swarm close prints).
          release = releaseWrites(after, stopped);
        }
        // forge stop kills nothing: a background job of this run (a swarm step, an integrate, a validate…: one of its
        // sessions', or one with no session) still running finishes its current step. They are named so the person knows
        // what is still at work; another conversation's jobs are not this run's.
        const running = liveJobs(main, io.now()).filter(j => j.session === null || own.has(j.session)).map(j => ({ name: j.name, task: j.task }));
        return json({ main, run: { stopped: !!current?.active }, execution: after ? { runId: after.runId, stopped } : null, release, members, running });
      }
      case 'waypoint-cli': {
        const found = findWaypointCli(io.scriptPath ?? process.argv[1] ?? '');
        if (!found) throw new UsageError('waypoint-cli: waypoint.cjs not found next to this forge install; is the waypoint plugin installed?');
        return ok(found);
      }
      case 'sp-path': {
        const skill = args[0];
        if (!skill || skill.startsWith('--')) throw new UsageError('sp-path: the name of a superpowers skill is required');
        return json(spSkillPath(superpowersOf(io, repoDir), skill));
      }
      case 'sp-specs': {
        if (has('decline')) {
          const rel = (flag('decline') ?? '').replace(/\\/g, '/');
          if (!/^docs\/superpowers\/specs\/[^/]+\.md$/.test(rel)) throw new UsageError('sp-specs: --decline needs a docs/superpowers/specs/<file>.md path');
          updateLocal(io.cwd, s => ({ ...s, declinedSpecs: [...new Set([...declinedSpecs(s), rel])] }));
          return json({ declined: rel });
        }
        return json(spSpecs(repoDir, io.now().getTime(), { committedAt: committedAt(io, repoDir), declined: declinedSpecs(readLocal(io.cwd)) }));
      }
      case 'sp-plans':
        return json(spPlans(repoDir, io.now().getTime(), { committedAt: committedAt(io, repoDir) }));
      case 'route': {
        const [sub] = args;
        const paths = (cmdName: string) => {
          const spec = flag('spec');
          const plan = flag('plan');
          for (const [name, v] of [['spec', spec], ['plan', plan]] as const) if (v !== undefined && !isRoutePath(v)) throw new UsageError(`${cmdName}: --${name} is not a plain path`);
          return { ...(spec ? { spec } : {}), ...(plan ? { plan } : {}) };
        };
        // Carry 8: --session's value, null when it has none or an empty one (C1: the environment's id is used then); one
        // that is not a plain session id exits 2, since it would name the route's file.
        const routeSessionFlag = (cmdName: string): string | null => {
          const v = flag('session');
          if (v === undefined || v.trim() === '') return null;
          if (!isRouteSession(v)) throw new UsageError(`${cmdName}: --session is not a plain session id`);
          return v;
        };
        if (sub === 'set') {
          const task = flag('task');
          const chosen = flag('chosen');
          const by = flag('by');
          if (!task || !TASK_ID.test(task)) throw new UsageError('route set: --task <id> is required');
          if (!(ROUTE_OPTIONS as readonly (string | undefined)[]).includes(chosen)) throw new UsageError(`route set: --chosen must be one of ${ROUTE_OPTIONS.join('|')}`);
          if (by !== 'user' && by !== 'auto') throw new UsageError('route set: --by must be user or auto');
          const files = paths('route set');
          // K1-04, K1-05 (C1): the route is this Claude session's, in .forge/route/<session>.json of the main checkout. It is
          // read with the other inputs, before anything is written; only none, which writes no route, goes without one. A
          // --session without a value, or an empty one (`--session ""`: an empty substitution), counts as absent, as in C1:
          // the environment's id is used.
          const given = routeSessionFlag('route set');
          const session = claudeSessionId(given, io.env ?? process.env);
          if (!session && chosen !== 'none') throw new UsageError(noClaudeSession('route set', '--session'));
          // K1-08: «remember it» keeps the choice as the project's workflow in local.yaml (`off` for none); none without it
          // writes nothing at all: no route file and no decision.
          const remembered: Workflow | null = has('remember') ? (chosen === 'none' ? 'off' : chosen as Workflow) : null;
          // Every input is read before anything is written: a --why-file that cannot be read leaves local.yaml alone.
          let why = by === 'user' ? 'the user chose it' : 'the recommended option for this request';
          if (flag('why-file') !== undefined) {
            try { why = readFileSync(path.resolve(io.cwd, flag('why-file')!), 'utf8').trim() || why; } catch { throw new UsageError('route set: cannot read --why-file'); }
          }
          if (remembered) updateLocal(io.cwd, s => ({ ...s, workflow: remembered }));
          if (chosen === 'none') return json({ written: false, ...(remembered ? { remembered } : {}) });
          // Not none: the session was required above.
          const owner = session!;
          const doc: RouteDoc = { task, chosen: chosen as RouteOption, by, stage: firstStage(chosen as RouteOption, files), ts: ts(), ...files, session: owner };
          const root = mainCheckout(io.cwd);
          writeRoute(root, doc);
          // Routes nobody wrote for a week are neither reminded nor carried: they go, never this session's own.
          pruneRoutes(root, owner, io.now().getTime());
          // The route is a decision like any other: by the user when asked, by auto mode otherwise.
          const exec = readExecution(root);
          const { n } = addDecision(root, {
            point: 'route', what: `route of ${task}`, chosen: doc.chosen, why, by,
            undo: { type: 'none', reason: 'the route only chose who does the work: start the task again to choose another' },
          }, { ts: ts(), task, runId: exec?.active ? exec.runId : null });
          return json({ ...doc, decision: n, ...(remembered ? { remembered } : {}) });
        }
        if (sub === 'stage') {
          const stage = flag('stage');
          if (!(ROUTE_STAGES as readonly (string | undefined)[]).includes(stage)) throw new UsageError(`route stage: --stage must be one of ${ROUTE_STAGES.join('|')}`);
          const files = paths('route stage');
          const session = claudeSessionId(routeSessionFlag('route stage'), io.env ?? process.env);
          if (!session) throw new UsageError(noClaudeSession('route stage', '--session'));
          // K1-04: only this session's route moves; another session's is never touched.
          const main = mainCheckout(io.cwd);
          const cur = readRoute(main, session);
          if (!cur || (flag('task') !== undefined && flag('task') !== cur.task)) return json({ updated: false });
          const next: RouteDoc = { ...cur, stage: stage as RouteStage, ts: ts(), ...files };
          writeRoute(main, next);
          return json({ updated: true, ...next });
        }
        if (sub !== undefined && !sub.startsWith('--')) {
          throw new UsageError('usage: forge route --task id (--path p | --text-file f [--path p]) [--locale es|en] [--workflow w] [--autonomy a] [--run-plan] [--build-spec] | set --task id --chosen o --by user|auto [--spec f] [--plan f] [--why-file f] [--session s] [--remember] | stage --stage s [--task id] [--spec f] [--plan f] [--session s]');
        }
        const task = flag('task');
        if (!task || !TASK_ID.test(task)) throw new UsageError('route: --task <id> is required');
        const loc = flag('locale');
        if (has('locale') && loc !== 'es' && loc !== 'en') throw new UsageError('route: --locale must be es or en');
        if (has('text-file') && flag('text-file') === undefined) throw new UsageError('route: --text-file needs a file');
        // K1-01: with the request's text, a triage that writes nothing (no ledger, status.json nor local.yaml) gives the path.
        const textFile = flag('text-file');
        const inputs = () => {
          const probed = textFile !== undefined ? triageCore(io, ['--task', task, '--text-file', textFile, ...(loc ? ['--locale', loc] : [])]) : null;
          const p = flag('path') ?? probed?.result.path;
          if (!p || !(PATH_ORDER as readonly string[]).includes(p)) throw new UsageError(`route: --path must be one of ${PATH_ORDER.join('|')}`);
          const wf = flag('workflow');
          const au = flag('autonomy');
          if (wf !== undefined && !isWorkflow(wf)) throw new UsageError(`route: --workflow must be one of ${WORKFLOWS.join('|')}`);
          if (au !== undefined && !isAutonomy(au)) throw new UsageError(`route: --autonomy must be one of ${AUTONOMIES.join('|')}`);
          return { probed, p, wf, au };
        };
        let got: ReturnType<typeof inputs>;
        // A probe that exits 2 (an empty text, a bad --path, --workflow or --autonomy) leaves nothing behind either.
        try { got = inputs(); } catch (e) { if (textFile !== undefined && e instanceof UsageError) cleanProbe(io.cwd, task, textFile); throw e; }
        const { probed, p, wf, au } = got;
        const prefs = resolvePrefs({ ...(wf ? { workflow: wf } : {}), ...(au ? { autonomy: au } : {}) }, readLocal(io.cwd), loadConfig(repoDir));
        const sp = superpowersOf(io, repoDir);
        const now = io.now().getTime();
        const specs = sp.installed ? spSpecs(repoDir, now, { committedAt: committedAt(io, repoDir), declined: declinedSpecs(readLocal(io.cwd)) }) : [];
        const plans = sp.installed ? spPlans(repoDir, now, { committedAt: committedAt(io, repoDir) }) : [];
        const options = routeOptions({ path: p as PathName, prefs, superpowers: { installed: sp.installed, version: sp.version }, specs, plans, runPlan: has('run-plan'), buildSpec: has('build-spec') });
        if (!probed) return json(options);
        // A raised --path only chooses here; forge:run triages again and records the path it follows.
        const effective = PATH_ORDER.indexOf(p as PathName) > PATH_ORDER.indexOf(probed.result.path) ? p as PathName : probed.result.path;
        const stepAside = PATH_ORDER.indexOf(effective) <= PATH_ORDER.indexOf('small') && prefs.workflow !== 'forge';
        const askLocale: 'es' | 'en' = loc === 'es' || loc === 'en' ? loc : (planLocale(io.cwd) ?? '').toLowerCase().split(/[-_]/)[0] === 'es' ? 'es' : 'en';
        const cleaned = cleanProbe(io.cwd, task, textFile!);
        // A workflow pinned to a superpowers option that is not installed cannot be applied: the person is asked
        // (route/SKILL.md «say so and ask as below»), as when nothing is pinned.
        const unavailable = prefs.workflow.startsWith('superpowers') && !sp.installed;
        return json({
          ...options, probe: { path: probed.result.path, reasons: probed.result.reasons, sensitive: probed.result.sensitive, files: probed.result.files, announce: probed.output.announce },
          stepAside, ask: (prefs.workflow !== 'ask' && !unavailable) || prefs.autonomy === 'auto' ? null : routeAsk(options, askLocale), cleaned,
        });
      }
      case 'tdd':
        return json(tddFor(io, repoDir));
      case 'sp-plan': {
        const [sub, file] = args;
        if ((sub !== 'tasks' && sub !== 'check') || !file || file.startsWith('--')) throw new UsageError('usage: forge sp-plan tasks <plan.md> | check <plan.md> --task N');
        const abs = path.resolve(io.cwd, file);
        let text: string;
        try { text = readFileSync(abs, 'utf8'); } catch { throw new UsageError(`sp-plan: cannot read ${file}`); }
        try {
          if (sub === 'tasks') { const { plan, tasks } = spPlanDone(text, abs, repoDir); return json({ plan, tasks }); }
          const n = spTaskNumber(flag('task'));
          const r = checkSpTask(text, n);
          if (r.checked) writeFileSync(abs, r.text);
          return json({ task: n, checked: r.checked });
        } catch (e) {
          if (e instanceof SpPlanError) throw new UsageError(`sp-plan: ${file}: ${e.message}`);
          throw e;
        }
      }
      case 'agents': {
        const { profile } = loadConfig(io.cwd);
        return json({ profile, agents: Object.fromEntries(ROLES.map(r => [r, agentFor(r, profile)])) });
      }
      case 'decision': {
        const [sub, arg] = args;
        // One record per repository: a run member in its task worktree writes and reads the main checkout's ledger,
        // where the coordinator's reports, lens, the band and /forge:decisions look.
        const root = mainCheckout(io.cwd);
        if (sub === 'add') {
          const file = flag('data-file');
          if (!file) throw new UsageError('decision add: --data-file is required');
          let raw: unknown;
          try { raw = JSON.parse(readFileSync(path.resolve(io.cwd, file), 'utf8')); } catch { throw new UsageError('decision add: --data-file must be a JSON object'); }
          if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new UsageError('decision add: --data-file must be a JSON object');
          // H-17: `--session` (this session's waypoint id) makes it print the roadmap writes; `resolves` (the question note
          // the decision answers) is not part of the decision itself.
          const session = flag('session');
          if (has('session') && (!session || !/^[A-Za-z0-9_\-.~:@+]{1,80}$/.test(session))) throw new UsageError('decision add: --session needs the waypoint session id');
          const { resolves, ...decision } = raw as Record<string, unknown>;
          if (resolves !== undefined && (typeof resolves !== 'string' || !NOTE_ID.test(resolves))) throw new UsageError('decision add: resolves must be the id of a note');
          // Carry 6: only --session prints the update that closes the question; without it nothing would close it.
          if (resolves !== undefined && !session) throw new UsageError('decision add: resolves needs --session, which prints the update that closes the question');
          const task = flag('task');
          if (task !== undefined && (!TASK_ID.test(task) || task === '.' || task === '..')) throw new UsageError(`decision add: invalid --task ${task}`);
          // Carry 6: with --db (the listed cache), a question someone already answered is not answered again.
          const dbArg = flag('db');
          if (has('db') && !dbArg) throw new UsageError('decision add: --db needs the listed cache directory');
          let resolvesRefused: string | null = null;
          if (typeof resolves === 'string' && dbArg) {
            try {
              const q = normalizeNote(JSON.parse(readFileSync(path.resolve(io.cwd, dbArg, 'notes', `${resolves}.json`), 'utf8')));
              if (q?.answer) resolvesRefused = `${resolves} is already answered${q.answeredBy ? ` by ${q.answeredBy}` : ''}: it is left as it is`;
            } catch { /* not listed: nothing to judge */ }
          }
          // An active execution names the run the decision belongs to (its scope), unless the data names one.
          const exec = readExecution(root);
          try {
            const { n, event } = addDecision(root, decision, { ts: ts(), ...(task ? { task } : {}), runId: exec?.active ? exec.runId : null });
            const closes = typeof resolves === 'string' && !resolvesRefused ? resolves : null;
            const publish = session ? decisionWrites({ event, session, eid: decisionNoteId(event, session), resolves: closes }) : null;
            return json({ n, ...event, ...(publish ? { publish } : {}), ...(resolvesRefused ? { resolvesRefused } : {}) });
          } catch (e) {
            if (e instanceof DecisionInputError) throw new UsageError(`decision add: ${e.message}`);
            throw e;
          }
        }
        if (sub === 'list') {
          const since = flag('since');
          if (since !== undefined && !Number.isFinite(Date.parse(since))) throw new UsageError(`decision list: --since must be a date, got ${since}`);
          // Carry 4: --task is that task of its project (--project, else the ledger's), never another plan's of the same id.
          return json(listDecisions(root, { task: flag('task'), ...(flag('project') !== undefined ? { project: flag('project') } : {}), run: flag('run'), since, all: has('all'), auto: has('auto') }));
        }
        if (sub === 'show') {
          const n = Number(arg);
          if (!Number.isInteger(n) || n < 1) throw new UsageError('decision show: <n> must be a positive integer');
          const d = allDecisions(root).find(x => x.n === n);
          if (!d) throw new UsageError(`decision show: there is no decision ${n}`);
          return json(d);
        }
        if (sub === 'md') {
          const scope = flag('scope');
          if (!scope) throw new UsageError('decision md: --scope is required');
          const outFlag = flag('out');
          // The file is project content (it goes to git with the work): by default under the code's directory.
          const out = outFlag !== undefined ? path.resolve(io.cwd, outFlag) : path.join(repoDir, 'docs', 'forge', 'decisions', `${scopeFileName(scope)}.md`);
          if (!out.endsWith('.md')) throw new UsageError('decision md: --out must be a .md file');
          const list = allDecisions(root).filter(d => d.by !== 'user' && (decisionScope(d) ?? 'forge') === scope);
          if (!list.length) return json({ written: false, scope, count: 0 });
          mkdirSync(path.dirname(out), { recursive: true });
          writeFileSync(out, renderDecisionsMd(list, scope, flag('locale') ?? 'en'));
          return json({ written: true, scope, count: list.length, path: out });
        }
        throw new UsageError('usage: forge decision add --data-file f [--task id] [--session SID] | list [--task id] [--run id] [--since iso] [--all] [--auto] | show <n> | md --scope s [--out f] [--locale es|en]');
      }
      case 'stats': {
        // C-09: the clock of the accepted briefs of the main checkout's ledger (where every worktree's forge writes).
        if (has('days') && has('since')) throw new UsageError('stats: use --days or --since, not both');
        let from: number | null = null;
        if (has('days')) {
          const d = Number(flag('days'));
          if (!Number.isInteger(d) || d < 1 || d > 3650) throw new UsageError('stats: --days must be a whole number of days from 1 to 3650');
          from = io.now().getTime() - d * 86400000;
        }
        if (has('since')) {
          const t = Date.parse(flag('since') ?? '');
          if (Number.isNaN(t)) throw new UsageError('stats: --since must be an ISO date');
          from = t;
        }
        const locale = flag('locale') ?? 'en';
        if (locale !== 'es' && locale !== 'en') throw new UsageError('stats: --locale must be es or en');
        const main = mainCheckout(io.cwd);
        const s = computeStats({ events: readEvents(main), plans: planStates(main), from });
        return has('json') ? json(s) : ok(renderStats(s, locale));
      }
      case 'last': {
        const task = flag('task');
        if (!task) throw new UsageError('last: --task is required');
        const ledger = readEvents(io.cwd);
        const project = resolveProject({ flag: flag('project'), task, events: ledger });
        const events = eventsOf(ledger, { project, task }).filter(e => isTask(e, task));
        const lastOf = (kind: LedgerKind, from: readonly LedgerEvent[] = events) => [...from].reverse().find(e => e.kind === kind);
        // R3 (M3): a new execution of the plan task reviews in the same round folders: its verdict and round are only
        // its own (as review-prep and roundDecision count them), never an earlier run's on the same `dir`.
        const own = eventsSince(events, executionHolding(io.cwd, { project, task: baseOf(task) })?.startedAt ?? null);
        return json({
          task,
          path: lastOf('triage')?.path ?? null,
          phase: lastOf('phase') ?? null,
          verdict: lastOf('verdict', own) ?? null,
          round: lastOf('round', own) ?? null,
          events: events.length,
          // Whether the task runs in auto mode: its last fresh triage (a ratchet logged by the session carries none).
          autonomy: [...events].reverse().find(e => e.kind === 'triage' && Array.isArray(e.reasons))?.autonomy === 'auto' ? 'auto' : null,
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
