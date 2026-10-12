export { normalizeNote } from '../lib/notes.js';
import type { Commit, EventDoc, InfiniteDoc, MessageDoc, MetaDoc, PhaseDoc, PlanTask, PlanTrack, SessionDoc, TaskState } from '../lib/types.js';

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
  return s;
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
  return { ...(o as unknown as SessionDoc), name: str(o.name), heartbeatAt: typeof o.heartbeatAt === 'string' ? o.heartbeatAt : '', currentTask: optStr(o.currentTask), track: optStr(o.track) ?? null, agentName: optStr(o.agentName), branch: optStr(o.branch), worktree: optStr(o.worktree), busyUntil: optStr(o.busyUntil) };
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

const isoOrNull = (v: unknown): string | null => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null);

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
