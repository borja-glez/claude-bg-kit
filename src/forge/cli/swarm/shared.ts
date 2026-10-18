// I-12: the helpers more than one swarm subcommand uses. Each subcommand lives in <name>.ts of this folder.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { UsageError } from '../errors.js';
import type { Io } from '../run.js';
import { loadConfig } from '../../config.js';
import { isLocale } from '../../../lib/forge-run.js';
import { readEvents } from '../../ledger.js';
import { updateExecution, taskBranch, taskWorktree, taskBase, type LockDeps } from '../../execution.js';
import type { Liveness } from '../../../lib/coordination.js';
import { planLocale } from '../../../lib/locale.js';
import { coordinatorLiveness } from '../../../lib/execution-view.js';
import { coordinatorInputs } from '../../live.js';
import { launchCommand, launchRun } from '../../../lib/launcher.js';
import type { ExecutionState } from '../../../lib/execution-state.js';
import { parsePlan, PlanError } from '../../../lib/plan.js';
import { readDocs } from '../../../lib/read-docs.js';
import { sessionDoc, stateDoc } from '../../../page/normalize.js';
import { excludeWorktrees } from '../../../lib/git-info.js';
import { parseLooseTasks, type LooseTask } from '../../loose.js';
import { loadTrustedConfig } from '../../trust.js';
import { PRIOR_MAX, type PriorCommit } from '../../brief.js';
import { attribute, isTask } from '../../task-ref.js';
import { cleanText } from '../../../lib/forge-status.js';
import type { SwarmDeps } from './context.js';
import { type SetupResult, runSetup } from './setup.js';

export const ID = /^[A-Za-z0-9_\-.~:@+]{1,80}$/;

/** The worktree that has `branch` checked out, from `git worktree list --porcelain`; null when none. */
export function worktreeHolding(porcelain: string | null, branch: string): string | null {
  let at: string | null = null;
  for (const line of (porcelain ?? '').split(/\r?\n/)) {
    if (line.startsWith('worktree ')) at = line.slice('worktree '.length).trim();
    else if (line === `branch refs/heads/${branch}`) return at;
  }
  return null;
}

export function loadPlanArg(io: Io, planArg: string | undefined, sub: string) {
  if (!planArg) throw new UsageError(`swarm ${sub}: --plan is required`);
  try { return parsePlan(readFileSync(path.resolve(io.cwd, planArg), 'utf8')); } catch (e) {
    throw new UsageError(e instanceof PlanError ? `${planArg}: ${e.issues.join('; ')}` : `swarm ${sub}: cannot read ${planArg}`);
  }
}

/** D-08: a plan run's tasks are the pairs (its project, T), and its triages stamp the plan's `project`: a plan of another
 *  project would log them under that one, and the run would find none of their events. The run's project counts: such a
 *  plan is refused (exit 2), never followed. */
export function checkPlanProject(sub: string, planArg: string, planProject: string, project: string): void {
  if (planProject === project) return;
  throw new UsageError(`swarm ${sub}: the plan says project "${planProject}" but the run is "${project}": fix the project of ${planArg} or start the run with --project ${planProject}`);
}

/** The loose tasks of an ephemeral run, from the JSON file `--tasks` names. */
export function loadTasksArg(io: Io, file: string | undefined, sub: string): LooseTask[] {
  if (!file) throw new UsageError(`swarm ${sub}: --tasks is required for an ephemeral run`);
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(path.resolve(io.cwd, file), 'utf8')); } catch { throw new UsageError(`swarm ${sub}: cannot read ${file}`); }
  const r = parseLooseTasks(raw);
  if ('error' in r) throw new UsageError(`swarm ${sub}: ${r.error}`);
  return r.tasks;
}

/**
 * The worktree `task-<T>` of the main checkout on `task/<T>` (created from `runBranch` when the branch is new), with
 * swarm.setup run when it is created. Shared by the coordinator's `swarm worktree` and a member's `--member`.
 * D-02: `base` is where the task left the run branch, so an earlier attempt's commits are in its diff, and `prior` lists them
 * (the newest PRIOR_MAX; `priorTotal` says how many there are when there are more). Final review 7: `task/<T>` is keyed by
 * the bare id, so in a plan run (`project`) a branch that already holds commits above the run branch is taken up only when
 * the ledger holds a phase implement of this plan's `<T>`, or of a `<T>` that names no project (before 2c); another
 * project's run left it otherwise, and it is refused before anything is created.
 */
export function addTaskWorktree(deps: SwarmDeps, main: string, task: string, runBranch: string,
  project: string | null): { worktree: string; branch: string; base: string | null; setup: SetupResult; resumed: boolean; prior: PriorCommit[]; priorTotal?: number } {
  loadTrustedConfig(main); // I-03: before any worktree exists, so a retry after the answer still sets it up
  const dir = taskWorktree(main, task);
  const branch = taskBranch(task);
  const g = (args: string[]) => deps.git(['-C', main, ...args]);
  let setup: SetupResult = null;
  const exists = g(['rev-parse', '--verify', '-q', `refs/heads/${branch}`]) !== null;
  if (exists && project !== null && Number(g(['rev-list', '--count', `${runBranch}..refs/heads/${branch}`])?.trim() || 0) > 0) {
    const events = readEvents(main);
    const owner = attribute(events);
    const implemented = events.filter(e => e.kind === 'phase' && e.phase === 'implement' && isTask(e, task)).map(owner);
    if (!implemented.some(p => p === project || p === null)) {
      throw new UsageError(`swarm worktree: ${branch} holds commits that are not this plan's ${task} (another project's run): integrate, rename or remove that branch first`);
    }
  }
  let existed = existsSync(dir);
  if (!existed) {
    excludeWorktrees(g);
    // A branch that outlived its worktree also brings the earlier attempt.
    existed = exists;
    const added = exists ? g(['worktree', 'add', dir, branch]) : g(['worktree', 'add', '-b', branch, dir, runBranch]);
    if (added === null) throw new UsageError(`swarm worktree: cannot add ${dir} for ${branch}`);
    setup = runSetup(deps, dir, main);
  }
  const at = deps.at(dir).git;
  const head = at(['rev-parse', 'HEAD'])?.trim() || null;
  const base = taskBase(at, runBranch) ?? head;
  let prior: PriorCommit[] = [];
  let total = 0;
  if (existed && base && head && base !== head) {
    const log = at(['log', '--reverse', `--max-count=${PRIOR_MAX}`, '--format=%H%x09%s', `${base}..HEAD`]) ?? '';
    // A commit title is the project's text: without controls nor bidi characters, as the brief prints it (parsePrior).
    prior = log.split(/\r?\n/).filter(Boolean).map(l => { const [sha, ...title] = l.split('\t'); return { sha, title: cleanText(title.join('\t')) }; })
      .filter(p => /^[0-9a-f]{7,64}$/.test(p.sha));
    if (prior.length >= PRIOR_MAX) total = Number(at(['rev-list', '--count', `${base}..HEAD`])?.trim() || 0);
  }
  return { worktree: dir, branch, base, setup, resumed: prior.length > 0, prior, ...(total > prior.length ? { priorTotal: total } : {}) };
}

/** A-19: the plan path a member's prompt carries inside double quotes of a shell command: no quote, $, backtick or ;. */
const PLAN_PATH = /^[\w./\\:~@+ -]+$/;

/** A-19: refuses, before anything is written, a --plan that cannot go into a member's launch. */
export function checkPlanPath(sub: string, planPath: string | undefined): void {
  if (planPath !== undefined && !PLAN_PATH.test(planPath)) {
    throw new UsageError(`swarm ${sub}: the plan path may only use letters, digits, spaces and _ . / \\ : ~ @ + -`);
  }
}

/** How the coordinator starts the session of a sessions-mode member: what it runs (`run`) and its parts. */
export interface MemberLaunch { worktree: string; branch: string; name: string; prompt: string; command: string; run: string; note?: string }

/**
 * A-19: the launch of the session of a sessions-mode member of task <T>: in the task worktree (`swarm worktree <T>`
 * creates it and runs its setup) on task/<T>, with /forge:member and the member's effort and model from swarm.member.
 * forge composes it, never waypoint. The caller checked planPath with checkPlanPath. An old swarm.launcher herdr reads
 * as bg, and the note says so (I-18).
 */
export function memberLaunch(root: string, planPath: string, task: string, e: ExecutionState): MemberLaunch {
  const { swarm } = loadConfig(root);
  const worktree = taskWorktree(root, task);
  const name = `wp-${e.project}-${task}`;
  const prompt = `/forge:member --plan ${planPath} --task ${task} — run member of ${e.coordinator}: work only ${task}, then stop`;
  const spec = { name, prompt, worktree, effort: swarm.member.effort, ...(swarm.member.model ? { model: swarm.member.model } : {}) };
  return {
    worktree, branch: taskBranch(task), name, prompt, command: launchCommand(spec), run: launchRun(spec),
    ...(swarm.launcher === 'herdr' ? { note: 'swarm.launcher herdr was removed: the member starts with bg' } : {}),
  };
}

/**
 * How alive the Claude session bound to `e` is, by the run band's rule (coordinatorGone, through coordinatorLiveness),
 * so a takeover or a resume from another session goes ahead exactly when the band offers [Resume]: its own signal
 * (.forge/live/<hookSession>.json) ended, or, while its conversation is not open (no live binding of its own in any
 * project, settled by its pid: a crashed one has none), no step, signal, agent or background job of its session
 * (.forge/jobs/, which only this side can read) for LIVE_STOPPED_MINUTES. The roadmap lease does not count: the band
 * cannot read it. Its inputs are gathered by coordinatorInputs (live.ts), shared with the live hook, so the hook tells
 * another session the run lost its coordinator exactly when this rule lets it go on.
 */
export function boundLiveness(root: string, e: ExecutionState, now: number): Liveness {
  const { signal, activity } = coordinatorInputs(root, e, now);
  return coordinatorLiveness(e, signal, now, activity);
}

/** Why `swarm <sub>` refuses a run whose bound Claude session (`hookSession`, of `liveness`) may still step it, and how to go on. */
export function boundElsewhere(sub: string, runId: string, hookSession: string, liveness: Liveness): string {
  return `swarm ${sub}: the execution ${runId} is bound to another Claude session (${hookSession}, ${liveness}): if that conversation is still open, go on from it; ` +
    `if it was closed or crashed, \`claude --resume ${hookSession}\` to go on at once; otherwise wait about 12 min from its last step, then run /forge:run --resume again`;
}

/** What `tick` and `next` schedule from: the plan, the roadmap listings and the done commits already on the run branch. */
export function readTickInput(io: Io, deps: SwarmDeps, e: ExecutionState, planArg: string | undefined, db: string | undefined, sub: string) {
  const plan = loadPlanArg(io, planArg, sub);
  if (!db) throw new UsageError(`swarm ${sub}: --plan and --db are required`);
  const stateDir = path.resolve(io.cwd, db, 'state');
  const sessionsDir = path.resolve(io.cwd, db, 'sessions');
  // Missing listings would make every task look free: refuse instead.
  if (!existsSync(stateDir) || !existsSync(sessionsDir)) throw new UsageError(`swarm ${sub}: --db must hold the state and sessions listings`);
  const states = readDocs(stateDir, stateDoc).docs;
  const sessions = readDocs(sessionsDir, sessionDoc).docs;
  const integrated: string[] = [];
  for (const t of plan.tasks) {
    if (states[t.id]?.status !== 'done') continue;
    for (const c of states[t.id]?.commits ?? []) {
      if (typeof c?.sha === 'string' && ID.test(c.sha) && deps.git(['merge-base', '--is-ancestor', c.sha, e.branch]) !== null) integrated.push(c.sha);
    }
  }
  return { plan, states, sessions, integrated };
}

/** --locale es|en; null when not given. */
export function localeArg(rest: string[], sub: string): 'es' | 'en' | null {
  const i = rest.indexOf('--locale');
  if (i < 0) return null;
  const v = rest[i + 1];
  if (v !== 'es' && v !== 'en') throw new UsageError(`swarm ${sub}: --locale must be es or en`);
  return v;
}

/** `start --locale`: the language the person writes in, any language code (es, pt, pt-BR…); null when not given. */
export function personLocaleArg(rest: string[]): string | null {
  const i = rest.indexOf('--locale');
  if (i < 0) return null;
  const v = rest[i + 1];
  if (!isLocale(v)) throw new UsageError('swarm start: --locale must be a language code (es, en, pt-BR…)');
  return v;
}

export const isSpanish = (locale: string | null | undefined) => (locale ?? '').toLowerCase().split(/[-_]/)[0] === 'es';
/** Spanish when the given locale's primary subtag is es, or without one when the plan's locale is Spanish; else English. */
export const spanish = (given: string | null, root: string, project: string) =>
  given ? isSpanish(given) : isSpanish(planLocale(root, project));

/**
 * A-23, carry 10: the roadmap writes that give an ended plan run's coordinator tasks back (free, without owner, claim,
 * start or exec), printed by forge stop, swarm close and the status of an ended run, so no skill composes them. A
 * member's task stays with its session, and a loose task has no state/T. No if_version: the skill pins each write.
 */
export function releaseWrites(e: ExecutionState, ids: readonly string[]): { task: string; write: { op: 'update'; collection: 'state'; doc_id: string; data: Record<string, unknown> } }[] {
  if (e.kind !== 'plan') return [];
  const del = { __delete__: true };
  return ids.filter(id => Object.hasOwn(e.tasks, id) && e.tasks[id].executor === 'subagents')
    .map(id => ({ task: id, write: { op: 'update' as const, collection: 'state' as const, doc_id: id, data: { status: 'free', owner: del, claimedAt: del, startedAt: del, exec: del } } }));
}
/** The tasks an ended run leaves to release: running, or stopped by forge stop (K2-02). */
export const openTasks = (e: ExecutionState): string[] => Object.entries(e.tasks).filter(([, t]) => t.status === 'running' || t.status === 'stopped').map(([id]) => id);

/** C2: closes the execution of `root` when it is inactive and still open; true when it did. */
export function closeEnded(root: string, at: string, by: 'merge' | 'close', deps: LockDeps): boolean {
  let closed = false;
  updateExecution(root, cur => {
    if (!cur || cur.active || cur.closedAt) return null;
    closed = true;
    return { ...cur, closedAt: at, closedBy: by };
  }, deps);
  return closed;
}
