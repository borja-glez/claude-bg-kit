// I-12: the helpers of src/forge/cli that more than one command uses. Each command lives in commands/<name>.ts.
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { appendEvent, readEvents, type LedgerEvent } from '../ledger.js';
import { readRunText, stopFile, type RunState, type StopContext } from '../run.js';
import { readExecution } from '../execution.js';
import { planLocale, sessionReply } from '../../lib/locale.js';
import { samePath } from '../../lib/worktree.js';
import {
  triage, implementerFor, zonesFromPaths, announce, announceReview, isBookkeeping, parseNumstat, diffPath, isPerfTask, reviewFor,
  PATH_ORDER, ZONE_ORDER, type PathName, type AnnounceLocale, type TriageResult,
} from '../triage.js';
import { parsePlan, PlanError } from '../../lib/plan.js';
import { taskText, tddLine } from '../brief.js';
import { loadConfig, agentFor } from '../config.js';
import type { VerifyFile } from '../verdict.js';
import { loadProposals, loadApprovals } from '../proposals.js';
import { isActionable, markMatches, ownerCheck, type ApprovalDoc } from '../../lib/proposals.js';
import { PAGE_RULES } from '../../lib/publish.js';
import { UsageError } from './errors.js';
import { keepEvidence } from '../evidence-copy.js';
import { eventsOf, isTask } from '../task-ref.js';
import { detectValidators, globMatch } from '../validators.js';
import { mcpInventory } from '../tools.js';
import { defaultProcDeps, stopEvidence, type EvidenceCleanup, type ProcDeps } from '../verify-proc.js';
import { releaseEnv } from '../verify-env.js';
import { readLocal, mainCheckout, readLearned, recordLearned, surfacePermissions, OBJECT_ID, type SurfacePermission } from '../local.js';
import { appendLearned, LEARNED_GUARD, filterNotes, learnedNotes, type NoteSkip, surfaceFile, permissionHash, hashMatches, type Surface } from '../surfaces.js';
import { askFor, capLines, relabelDiff, type PlanSurface } from '../verify.js';
import { claudeConfigDir, claudeJsonDir, locateSuperpowersFor, spLedgerDone, spSkillPath, SP_WINDOW_MS } from '../superpowers.js';
import { listRoutes } from '../route.js';
import { markDone, parseSpPlan, SpPlanError } from '../../lib/sp-plan.js';
import type { Io } from './run.js';
import { defaultGit, repoReader } from './exec.js';

// The plan and one task of it; a usage error (exit 2) for a missing file, a broken plan or an unknown task.
export function planTask(cwd: string, planArg: string | undefined, id: string | undefined) {
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

// A superpowers plan with the tasks its own executors recorded as complete counted as done (they never tick the boxes).
export const spPlanDone = (text: string, abs: string, dir: string) => markDone(parseSpPlan(text), spLedgerDone([dir, mainCheckout(dir)], abs));

// The number of a `### Task N` of a superpowers plan, from --task.
export function spTaskNumber(v: string | undefined): number {
  if (v === undefined || !/^\d{1,4}$/.test(v) || Number(v) < 1) throw new UsageError('--task must be the number of a task of the superpowers plan');
  return Number(v);
}

// superpowers as installed for this repository: for the checkout itself or for its main checkout (which holds the project
// settings and is a worktree's projectPath), as mcpOf reads the MCP servers.
export const superpowersOf = (io: Io, dir: string) => locateSuperpowersFor(claudeConfigDir(io.env ?? process.env), [dir, mainCheckout(dir)]);

// The MCP servers Claude Code has for this repository, as the checkout itself and as its main checkout (where Claude
// Code keeps a worktree's project entry).
export function mcpOf(io: Io, dir: string): Set<string> {
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
export function surfaceBlob(dir: string, file: string): string | null {
  try {
    const text = Buffer.from(readFileSync(path.join(dir, file)).toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
    const id = execFileSync('git', ['--no-replace-objects', 'hash-object', '-w', '--no-filters', '--stdin'],
      { cwd: dir, input: text, encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true }).trim();
    return OBJECT_ID.test(id) ? id : null;
  } catch { return null; }
}

// The whole diff of a surface whose question shows it capped, in <root>/.forge/work/surfaces/<name>-<hash 16>.diff
// (written to a new file, then renamed into place): its absolute path, or null when it cannot be written or a
// directory on the way is a link (a commit can ship .forge/work as one, to make forge write elsewhere).
export function writeFullDiff(root: string, name: string, hash: string, diff: string): string | null {
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
export function surfaceQuestion(p: PlanSurface, s: Surface, perm: SurfacePermission | undefined, git: (args: string[]) => string | null, dir: string, work: string, es: boolean): PlanSurface {
  if (p.permission === 'allowed' || p.permission === 'skipped') return p;
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
export const committedAt = (io: Io, dir: string) => {
  const git = io.git ?? defaultGit(dir);
  return (rel: string): number | null => {
    const s = Number((git(['log', '-1', '--format=%ct', '--', rel]) ?? '').trim());
    return Number.isInteger(s) && s > 0 ? s * 1000 : null;
  };
};
export const declinedSpecs = (s: Record<string, unknown>): string[] =>
  Array.isArray(s.declinedSpecs) ? s.declinedSpecs.filter((x): x is string => typeof x === 'string').slice(0, 200) : [];

// tdd: superpowers: the line implementer briefs carry, null when off or when superpowers or its TDD skill is missing.
export function tddFor(io: Io, dir: string) {
  const { tdd } = loadConfig(dir);
  const sp = superpowersOf(io, dir);
  const skill = spSkillPath(sp, 'test-driven-development');
  return { tdd, installed: sp.installed, version: sp.version, skill, line: tdd === 'superpowers' && skill ? tddLine(skill) : null };
}

/** The status each proposal's latest decision event in this checkout's ledger left it in, and when: decide, confirm, a reopen
 *  (its `to`) and the policy's auto-approval; a policy that declined decided nothing. A pid with no such event is absent. */
export function lastDecisions(root: string): Record<string, { status: string; ts: string }> {
  const out: Record<string, { status: string; ts: string }> = {};
  for (const e of readEvents(root)) {
    if (e.kind !== 'proposal' || typeof e.id !== 'string') continue;
    const status = e.action === 'reopen' ? e.to : e.action === 'decide' || e.action === 'confirm' || (e.action === 'policy' && e.status === 'auto_approved') ? e.status : undefined;
    if (typeof status === 'string') out[e.id] = { status, ts: e.ts };
  }
  return out;
}

/** Carry 12: the rules of the roadmap page the last `proposals pull --approvals` read (meta/page.rules), kept in .forge/. */
export const approvalsPageFile = (root: string) => path.join(root, '.forge', 'approvals-page.json');
export function pulledRules(root: string): number {
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
export const MARK_SKEW_MS = 10 * 60_000;
export function bindingDecision(last: { status: string; ts: string } | undefined, mark: ApprovalDoc | null | undefined, ownerRule: boolean, now: number): string | undefined {
  if (!last) return undefined;
  const at = mark ? Date.parse(mark.decidedAt) : NaN;
  if (ownerRule && Number.isFinite(at) && at > Date.parse(last.ts) && at <= now + MARK_SKEW_MS) return undefined;
  return last.status;
}

/** D3: where a proposal stands against the roadmap owner's rule. `no-rule`: a mark that no decision of this checkout backs, on
 *  a roadmap without the owner rule, so an editor could have written it. */
export type OwnerStanding = 'ok' | 'no-mark' | 'edited' | 'no-rule';
export interface OwnerCtx { last: Record<string, { status: string; ts: string }>; ownerRule: boolean; now: number }
export function ownerCtx(root: string, now: Date): OwnerCtx {
  return { last: lastDecisions(root), ownerRule: pulledRules(root) >= PAGE_RULES, now: now.getTime() };
}
/** The one rule that to-task, the stop conditions and `unownedReasons` share. */
export function ownerStanding(pid: string, p: Parameters<typeof ownerCheck>[1], mark: ApprovalDoc | null | undefined, ctx: OwnerCtx): OwnerStanding {
  const c = ownerCheck(pid, p, mark, bindingDecision(ctx.last[pid], mark, ctx.ownerRule, ctx.now));
  return c !== 'no-mark' && !ctx.ownerRule && ctx.last[pid] === undefined ? 'no-rule' : c;
}

// What the stop conditions need from the repository: the stop file and the proposal mirror.
// Approved work still pending = every approved/auto_approved proposal not yet done, with or without a task.
export function stopContext(cwd: string, now: Date): StopContext {
  const proposals = loadProposals(cwd);
  const marks = loadApprovals(cwd);
  const octx = ownerCtx(cwd, now);
  return {
    now,
    stopFile: existsSync(stopFile(cwd)),
    // Wave 4: approved work counts only with the owner's mark (with or without a task, as before); one without a task also
    // needs the mark to be of its present text: an edited one never becomes a task, so it does not hold the queue open.
    approvedPending: proposals.filter(p => p.taskId === undefined
      ? ownerStanding(p.id, p, marks[p.id], octx) === 'ok'
      : markMatches(p, marks[p.id])).length,
    pendingProposals: proposals.filter(p => p.status === 'proposed' || p.status === 'discussing').length,
  };
}

/** Wave 4: approved proposals without a task that lack the roadmap owner's mark, whose text changed since the mark, or whose
 *  lone mark counts for nothing on a roadmap without the owner rule (D3): they never become tasks. The reason says which. */
export function unownedReasons(root: string, now: Date): Record<string, Exclude<OwnerStanding, 'ok'>> {
  const marks = loadApprovals(root);
  const octx = ownerCtx(root, now);
  const out: Record<string, Exclude<OwnerStanding, 'ok'>> = {};
  for (const p of loadProposals(root)) {
    if (!isActionable(p) || p.taskId !== undefined) continue;
    const c = ownerStanding(p.id, p, marks[p.id], octx);
    if (c !== 'ok') out[p.id] = c;
  }
  return out;
}
export const unownedOf = (root: string, now: Date): number => Object.keys(unownedReasons(root, now)).length;

/**
 * K2-01: the directory of the infinite run: the main checkout, wherever forge runs from; this directory only when it
 * alone holds a run.json (a run an older forge started in a worktree).
 */
export function runRootOf(cwd: string): string {
  const main = mainCheckout(cwd);
  if (samePath(main, cwd)) return main;
  return readRunText(main) === null && readRunText(cwd) !== null ? cwd : main;
}

// The `reply` of the cycle and infinite status JSON: the sentence that tells the session which language to answer in
// (the run's, else the active execution's, else the plan's); null when none is known.
export function runReply(cwd: string, run: RunState | null): string | null {
  const main = mainCheckout(cwd);
  const exec = readExecution(main);
  const active = exec?.active ? exec : null;
  return sessionReply(run, active, () => planLocale(cwd, active?.project))?.trim() ?? null;
}

// Logs the verify event of a verification (verdict and verify-result share it): its result (`invalid` when verify.json
// did not parse), the checks passed of the total, and the evidence folder that goes with a `reviews-<n>-<k>` dir.
export function logVerifyResult(cwd: string, at: string, task: string, dir: string, verifyFile: VerifyFile | null): { result: string; passed: number; total: number } {
  const rel = path.relative(cwd, dir).split(path.sep).join('/');
  const evidence = rel.replace(/reviews-(\d+-\d+)$/, 'evidence/$1');
  const out = { result: verifyFile?.result ?? 'invalid', passed: verifyFile ? verifyFile.checks.filter(c => c.ok).length : 0, total: verifyFile ? verifyFile.checks.length : 0 };
  // K2-04: from a forge task worktree, verify.json and the evidence are copied to the main checkout first.
  const { skipped } = keepEvidence(cwd, dir);
  appendEvent(cwd, { ts: at, kind: 'verify', task, ...out, ...(evidence !== rel ? { evidence } : {}), ...(verifyFile?.reason ? { reason: verifyFile.reason } : {}),
    ...(skipped.length ? { evidenceSkipped: skipped } : {}) });
  return out;
}

/**
 * `surfaces learn` of one surface (K2-06, K2-11): appends to `<dir>/.forge/verify/<name>.md` (the code checked: the
 * worktree of --cwd) the notes filterNotes keeps, under its Learned/Aprendido heading, and, when the surface is allowed as
 * it is now, records them in the main checkout, so they never ask for its permission again. `added`: how many it
 * appended; `count`: the notes the section holds; `keep`: the notes that passed the filter. A missing file or a symlink is a
 * reason, not a write. With `write` false it filters the same and writes nothing (D4: /forge:review does not touch the branch).
 */
export function learnSurface(io: Io, dir: string, name: string, notes: string[], heading: string, task: string | null = null, write = true):
  { count: number; added: number; keep: string[]; skipped: { note: string; why: NoteSkip }[] } | { reason: string } {
  const file = path.join(dir, surfaceFile(name));
  if (!existsSync(file)) return { reason: `${surfaceFile(name)} does not exist` };
  if (lstatSync(file).isSymbolicLink()) return { reason: `${surfaceFile(name)} is a symlink` };
  const before = readFileSync(file, 'utf8');
  const have = learnedNotes(before);
  const { keep, skipped } = filterNotes(notes, have, task);
  if (!keep.length) return { count: have.length, added: 0, keep: [], skipped };
  if (!write) return { count: have.length + keep.length, added: keep.length, keep, skipped };
  // Only a surface allowed as it is now records what it appends (and local.yaml is never touched), so learning on a
  // changed or never allowed surface cannot make it allowed: its new lines are just more unknown text.
  const cur = surfacePermissions(io.cwd)[name];
  const allowed = cur?.state === 'allowed' && hashMatches(cur.hash, permissionHash(before, readLearned(io.cwd).get(name)));
  const at = io.now().toISOString();
  const r = appendLearned(before, at.slice(0, 10), keep, heading, LEARNED_GUARD[heading === 'Aprendido' ? 'Aprendido' : 'Learned']);
  writeFileSync(file, r.text);
  if (allowed) recordLearned(io.cwd, name, r.added, at);
  return { count: r.count, added: keep.length, keep, skipped };
}

/**
 * `verify-cleanup` of an evidence dir (K2-03, K2-20): stops the processes recorded in its logs/<n>.pid.json (verify-spawn
 * writes one per spawn) and its pids.json (the older list) that are still the ones recorded. It deletes a record once each
 * of its entries is stopped, gone or reused, rewrites pids.json without those (keeping the date of its last write), keeps
 * what is unknown, and leaves alone a record in logs/ verify-spawn did not write (`skipped`). It deletes no file of the
 * project. It also frees the port and the browser profile verify-env reserved for the dir (K2-07); `cwd` is forge's own
 * directory, whose main checkout holds the reservations.
 */
export function cleanupEvidence(dir: string, cwd: string, deps: ProcDeps = defaultProcDeps()): EvidenceCleanup & { released: number[] } {
  return { ...stopEvidence(dir, deps), released: releaseEnv(mainCheckout(cwd), dir) };
}

/**
 * I2: the verify agent a review round waits for, as an entry like a reviewer's (its file is verify.json): verify-plan --dir
 * wrote verify-pending.json in the round dir when it chose surfaces, with what a respawned verify agent needs. A surface
 * the coordinator then chose not to verify is logged as a verify-skip of <T>-<n> (references/verify.md). Undefined without
 * a usable marker; null once every surface it names was skipped. `events`: the brief's, of its project.
 */
export function pendingVerify(roundDir: string, events: readonly LedgerEvent[], taskN: string): Record<string, unknown> | null | undefined {
  let m: unknown;
  try { m = JSON.parse(readFileSync(path.join(roundDir, 'verify-pending.json'), 'utf8')); } catch { return undefined; }
  if (!m || typeof m !== 'object' || Array.isArray(m) || typeof (m as { at?: unknown }).at !== 'string') return undefined;
  const { at, task: _task, ...rest } = m as Record<string, unknown> & { at: string };
  const skipped = new Set(events
    .filter(e => e.kind === 'verify-skip' && isTask(e, taskN) && typeof e.ts === 'string' && e.ts >= at && typeof e.surface === 'string')
    .map(e => String(e.surface)));
  const surfaces = (Array.isArray(rest.surfaces) ? rest.surfaces : [])
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object' && typeof (s as { name?: unknown }).name === 'string' && !skipped.has((s as { name: string }).name));
  return surfaces.length ? { role: 'verify', ...rest, surfaces } : null;
}

/** K2-09, M1: whether review-close or verdict waits for the round's verify.json: verify-env.json says a verify agent was
 *  spawned, and the round's verify-pending.json, when there is one, still names a surface no verify-skip took since. */
export function verifyAwaited(roundDir: string, events: readonly LedgerEvent[], taskN: string): boolean {
  return existsSync(path.join(roundDir, 'verify-env.json')) && !existsSync(path.join(roundDir, 'verify.json')) && pendingVerify(roundDir, events, taskN) !== null;
}

/** What a triage computes (K1-01): everything `forge triage` prints, before anything is written. */
export interface TriageCore {
  task: string | undefined; project: string | null; result: TriageResult; names: string[]; fresh: string[];
  diff: { base: string; stat: { files: string[]; lines: number }; path: PathName } | null;
  auto: { autonomy?: 'auto' }; review: Record<string, unknown>; output: Record<string, unknown>;
  /** The language of the announcement: --locale, else the plan's. */
  locale: AnnounceLocale;
}

/**
 * The triage of a task without side effects (K1-01): it reads the ledger (the ratchet), the plan, the config,
 * local.yaml and git, and writes nothing. `forge triage` then records the validators it knows in local.yaml and the
 * `triage` event; `forge route --text-file` uses it as a probe.
 */
export function triageCore(io: Io, args: string[]): TriageCore {
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
    locale: locale as AnnounceLocale,
  };
}

/** K1-07: the specs a route of this checkout handed off or finished. sp-specs reads only these (T7: no git log). */
export const routedSpecs = (io: Io): string[] =>
  listRoutes(mainCheckout(io.cwd)).flatMap(r => (r.spec && (r.stage === 'handed-off' || r.stage === 'done') ? [r.spec] : []));

/**
 * K1-07: what sp-plans and route read besides docs/superpowers: the main checkout (its SDD ledger and forge's sp-done
 * record), the subjects of the commits of the last 14 days on this branch and on the main checkout's branch, and the
 * specs a route of this checkout handed off or finished (routedSpecs).
 */
export function spContext(io: Io, dir: string, now: number): { main: string; subjects: string[]; routed: string[] } {
  const main = mainCheckout(dir);
  const since = `--since=${new Date(now - SP_WINDOW_MS).toISOString()}`;
  const subjectsOf = (git: (args: string[]) => string | null) =>
    (git(['log', since, '-n', '500', '--format=%s', 'HEAD']) ?? '').split('\n').map(s => s.trim()).filter(Boolean);
  const subjects = [...new Set([...subjectsOf(io.git ?? defaultGit(dir)), ...(samePath(main, dir) ? [] : subjectsOf(defaultGit(main)))])];
  return { main, subjects, routed: routedSpecs(io) };
}
