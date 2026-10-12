export { normalizeNote } from '../lib/notes.js';
import { STAGES, type Commit, type EventDoc, type InfiniteDoc, type MessageDoc, type MetaDoc, type PhaseDoc, type PlanTask, type PlanTrack, type RunDoc, type SessionDoc, type Stage, type TaskExec, type TaskState } from '../lib/types.js';

// Documents in the shared db are untrusted and may be malformed: coerce them into the shapes the renderer expects.
type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (v: unknown): string => String(v ?? '');
const optStr = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strs = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === 'string');

export function normalizeMeta(x: unknown): MetaDoc | null {
  if (!isObj(x)) return null;
  const mt = isObj(x.metrics) ? x.metrics : {};
  const metrics: MetaDoc['metrics'] = { ...mt };
  const lc = mt.lastCommit;
  if (isObj(lc) && typeof lc.sha === 'string' && typeof lc.ts === 'string') metrics.lastCommit = { sha: lc.sha, ts: lc.ts };
  else delete metrics.lastCommit;
  return {
    name: str(x.name),
    locale: str(x.locale),
    version: str(x.version),
    planHash: str(x.planHash),
    tracks: arr(x.tracks).filter((t): t is PlanTrack => isObj(t) && typeof t.id === 'string' && typeof t.name === 'string'),
    versions: arr(x.versions).filter(isObj) as unknown as MetaDoc['versions'],
    phaseOrder: arr(x.phaseOrder) as string[],
    metrics,
    syncedAt: str(x.syncedAt),
  };
}

function normalizeTask(t: Obj): PlanTask {
  return { ...(t as unknown as PlanTask), id: t.id as string, title: t.title as string, depends_on: strs(t.depends_on), zones: strs(t.zones), done_when: typeof t.done_when === 'string' ? t.done_when : '', track: str(t.track), phase: str(t.phase) };
}

export function normalizePhase(x: unknown): PhaseDoc | null {
  if (!isObj(x) || typeof x.id !== 'string') return null;
  return {
    ...(x as unknown as PhaseDoc),
    id: x.id,
    name: str(x.name),
    order: typeof x.order === 'number' && Number.isFinite(x.order) ? x.order : 0,
    tasks: arr(x.tasks).filter((t): t is Obj => isObj(t) && typeof t.id === 'string' && typeof t.title === 'string').map(normalizeTask),
  };
}

export function normalizeState(x: unknown): TaskState {
  const o: Obj = isObj(x) ? x : {};
  const s = { ...o } as unknown as TaskState & Obj;
  s.commits = arr(o.commits).filter((c): c is Obj => isObj(c) && typeof c.sha === 'string' && typeof c.title === 'string') as unknown as Commit[];
  if (!('commits' in o) || o.commits === undefined) delete s.commits;
  s.blockedBy = Array.isArray(o.blockedBy) ? strs(o.blockedBy) : undefined;
  for (const k of ['claimedAt', 'startedAt', 'doneAt'] as const) s[k] = optStr(o[k]);
  const forge = normalizeForge(o.forge);
  if (forge) s.forge = forge; else delete s.forge;
  const evidence = normalizeEvidence(o.evidence);
  if (evidence) s.evidence = evidence; else delete s.evidence;
  const exec = normalizeExec(o.exec);
  if (exec) s.exec = exec; else delete s.exec;
  return s;
}

/** The exec block of a task state: kept only whole and well-typed (it drives the orphan mark). */
const isoOrNull = (v: unknown): string | null => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null);

/** state/T.exec: dropped when a field is missing or mistyped, or since/leaseUntil is not a date. */
function normalizeExec(x: unknown): TaskExec | undefined {
  if (!isObj(x) || typeof x.runId !== 'string' || typeof x.by !== 'string') return undefined;
  const since = isoOrNull(x.since), leaseUntil = isoOrNull(x.leaseUntil);
  if (!since || !leaseUntil) return undefined;
  if (!(STAGES as readonly unknown[]).includes(x.stage)) return undefined;
  if (x.mode !== 'subagents' && x.mode !== 'sessions' && x.mode !== 'manual') return undefined;
  const e: TaskExec = { runId: x.runId, mode: x.mode, by: x.by, stage: x.stage as Stage, since, leaseUntil };
  if (typeof x.agent === 'string' || x.agent === null) e.agent = x.agent;
  if (typeof x.round === 'number' && Number.isInteger(x.round)) e.round = x.round;
  return e;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The forge block of a task state: kept only with string path and phase; other fields dropped when mistyped. */
function normalizeForge(x: unknown): TaskState['forge'] | undefined {
  if (!isObj(x) || typeof x.path !== 'string' || typeof x.phase !== 'string') return undefined;
  const f: NonNullable<TaskState['forge']> = { path: x.path, phase: x.phase };
  if (typeof x.agent === 'string') f.agent = x.agent;
  if (Array.isArray(x.validators)) f.validators = x.validators.filter((v): v is { name: string; ok: boolean } => isObj(v) && typeof v.name === 'string' && typeof v.ok === 'boolean').map(v => ({ name: v.name, ok: v.ok }));
  if (isObj(x.verdict) && typeof x.verdict.action === 'string') f.verdict = { action: x.verdict.action, score: finite(x.verdict.score) ? x.verdict.score : null };
  if (finite(x.round)) f.round = x.round;
  if (finite(x.cap)) f.cap = x.cap;
  return f;
}

export function normalizeSession(x: unknown): SessionDoc {
  const o: Obj = isObj(x) ? x : {};
  return { ...(o as unknown as SessionDoc), name: str(o.name), heartbeatAt: typeof o.heartbeatAt === 'string' ? o.heartbeatAt : '', currentTask: optStr(o.currentTask), track: optStr(o.track) ?? null, agentName: optStr(o.agentName), branch: optStr(o.branch), worktree: optStr(o.worktree), busyUntil: optStr(o.busyUntil),
    role: o.role === 'coordinator' || o.role === 'executor' || o.role === 'manual' ? o.role : undefined, runId: optStr(o.runId), leaseUntil: optStr(o.leaseUntil) };
}

export function normalizeEvent(x: unknown): EventDoc {
  const o: Obj = isObj(x) ? x : {};
  return { ...(o as unknown as EventDoc), ts: typeof o.ts === 'string' ? o.ts : '', type: (typeof o.type === 'string' ? o.type : '') as EventDoc['type'], sessionId: typeof o.sessionId === 'string' ? o.sessionId : '', text: o.text == null ? undefined : str(o.text), taskId: optStr(o.taskId) };
}

export function normalizeMessage(x: unknown): MessageDoc | null {
  if (!isObj(x)) return null;
  return {
    ts: str(x.ts),
    from: str(x.from),
    to: str(x.to),
    type: str(x.type) as MessageDoc['type'],
    taskId: optStr(x.taskId),
    text: str(x.text),
    status: x.status === 'resolved' ? 'resolved' : 'open',
    replyTo: optStr(x.replyTo),
  };
}

/** meta/run: the execution published by forge's coordinator; null when it is not a well-formed run. */
export function normalizeRun(x: unknown): RunDoc | null {
  if (!isObj(x)) return null;
  const mode = x.mode === 'subagents' || x.mode === 'sessions' ? x.mode : null;
  if (!mode || typeof x.runId !== 'string' || typeof x.branch !== 'string' || typeof x.coordinator !== 'string') return null;
  const parallel = typeof x.parallel === 'number' && Number.isInteger(x.parallel) ? Math.min(10, Math.max(1, x.parallel)) : 1;
  const slots = (Array.isArray(x.slots) ? x.slots : []).filter(isObj)
    .filter(s => typeof s.task === 'string' && typeof s.stage === 'string' && (STAGES as readonly unknown[]).includes(s.stage) && typeof s.by === 'string' && isoOrNull(s.since))
    .slice(0, 10).map(s => ({ task: s.task as string, stage: s.stage as Stage, agent: typeof s.agent === 'string' ? s.agent : null, by: s.by as string, since: s.since as string }));
  return { runId: x.runId, mode, parallel, branch: x.branch, mergeOnFinish: x.mergeOnFinish === true, active: x.active === true,
    stopReason: typeof x.stopReason === 'string' ? x.stopReason : null, coordinator: x.coordinator, slots };
}

/** meta/infinite: active only when exactly true, cycle a non-negative integer (else 0), budget kept only when positive. */
export function normalizeInfinite(x: unknown): InfiniteDoc | null {
  if (!isObj(x)) return null;
  const b: Obj = isObj(x.budget) ? x.budget : {};
  const budget: InfiniteDoc['budget'] = {};
  if (typeof b.cycles === 'number' && Number.isInteger(b.cycles) && b.cycles > 0) budget.cycles = b.cycles;
  if (finite(b.hours) && b.hours > 0) budget.hours = b.hours;
  return {
    active: x.active === true,
    cycle: typeof x.cycle === 'number' && Number.isInteger(x.cycle) && x.cycle >= 0 ? x.cycle : 0,
    budget,
    startedAt: isoOrNull(x.startedAt) ?? '',
    lastCycleAt: isoOrNull(x.lastCycleAt),
  };
}

// Asset urls from the roadmap's own store: the artifact asset host (https://claude.ai/), or the /_blob/<id> path every
// view serves. Anything else is dropped.
const safeUrl = (u: unknown): string | undefined => (typeof u === 'string' && (u.startsWith('https://claude.ai/') || /^\/_blob\/[\w-]+$/.test(u)) ? u : undefined);

function normalizeEvidence(x: unknown): TaskState['evidence'] | undefined {
  if (!isObj(x) || (x.result !== 'pass' && x.result !== 'fail' && x.result !== 'blocked')) return undefined;
  const e: NonNullable<TaskState['evidence']> = {
    surfaces: strs(x.surfaces), result: x.result,
    passed: finite(x.passed) ? x.passed : 0, total: finite(x.total) ? x.total : 0,
    shots: arr(x.shots).filter((v): v is Obj => isObj(v) && typeof v.check === 'string' && typeof v.ok === 'boolean').slice(0, 30).map(v => {
      const shot: NonNullable<TaskState['evidence']>['shots'][number] = { surface: str(v.surface), check: v.check as string, ok: v.ok as boolean };
      const url = safeUrl(v.url);
      if (url) shot.url = url;
      if (typeof v.id === 'string') shot.id = v.id;
      if (typeof v.expected === 'string') shot.expected = v.expected;
      if (typeof v.observed === 'string') shot.observed = v.observed;
      return shot;
    }),
  };
  if (typeof x.local === 'string') e.local = x.local;
  if (x.pending === true) e.pending = true;
  if (typeof x.reason === 'string') e.reason = x.reason;
  return e;
}
