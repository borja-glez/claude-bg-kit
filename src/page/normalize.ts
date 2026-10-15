export { normalizeNote } from '../lib/notes.js';
import { isPlanId } from '../lib/ids.js';
import { LOOSE_MAX_TASKS, LOOSE_STATUSES, STAGES, type LooseRunTask, type LooseStatus, type Commit, type EventDoc, type InfiniteDoc, type MessageDoc, type MetaDoc, type PhaseDoc, type PlanTask, type PlanTrack, type RunDoc, type SessionDoc, type Stage, type TaskExec, type TaskState } from '../lib/types.js';

// Documents in the shared db are untrusted and may be malformed: coerce them into the shapes the renderer expects.
type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (v: unknown): string => String(v ?? '');
const optStr = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strs = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === 'string');

/** H-04: what a normalizer dropped or coerced, listed by `?debug=1`. `doc` is the document (`state/T019`). */
export interface Drop { doc: string; field: string; action: 'dropped' | 'coerced'; detail: string }
/** Called once per field a normalizer drops or coerces. Without one, the normalizers cost what they did. */
export type Report = (field: string, action: Drop['action'], detail: string) => void;
/** The type of a value, for a report's detail. */
const kindOf = (v: unknown): string => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
/** The items of `list` that `keep` accepts; each refused one is reported as dropped under `field[i]`. */
function keepAll<T>(list: unknown[], keep: (v: unknown) => v is T, field: string, report?: Report): T[] {
  const out: T[] = [];
  list.forEach((v, i) => { if (keep(v)) out.push(v); else report?.(`${field}[${i}]`, 'dropped', kindOf(v)); });
  return out;
}

export function normalizeMeta(x: unknown, report?: Report): MetaDoc | null {
  if (!isObj(x)) return null;
  const mt = isObj(x.metrics) ? x.metrics : {};
  const metrics: MetaDoc['metrics'] = { ...mt };
  const lc = mt.lastCommit;
  if (isObj(lc) && typeof lc.sha === 'string' && typeof lc.ts === 'string') metrics.lastCommit = { sha: lc.sha, ts: lc.ts };
  else { delete metrics.lastCommit; if (lc !== undefined) report?.('metrics.lastCommit', 'dropped', kindOf(lc)); }
  return {
    name: str(x.name),
    locale: str(x.locale),
    version: str(x.version),
    planHash: str(x.planHash),
    tracks: keepAll(arr(x.tracks), (t): t is PlanTrack => isObj(t) && typeof t.id === 'string' && typeof t.name === 'string', 'tracks', report),
    versions: arr(x.versions).filter(isObj) as unknown as MetaDoc['versions'],
    phaseOrder: arr(x.phaseOrder) as string[],
    metrics,
    syncedAt: str(x.syncedAt),
  };
}

function normalizeTask(t: Obj): PlanTask {
  return { ...(t as unknown as PlanTask), id: t.id as string, title: t.title as string, depends_on: strs(t.depends_on), zones: strs(t.zones), done_when: typeof t.done_when === 'string' ? t.done_when : '', track: str(t.track), phase: str(t.phase) };
}

export function normalizePhase(x: unknown, report?: Report): PhaseDoc | null {
  if (!isObj(x) || typeof x.id !== 'string') return null;
  return {
    ...(x as unknown as PhaseDoc),
    id: x.id,
    name: str(x.name),
    order: typeof x.order === 'number' && Number.isFinite(x.order) ? x.order : 0,
    tasks: keepAll(arr(x.tasks), (t): t is Obj => isObj(t) && typeof t.id === 'string' && typeof t.title === 'string', 'tasks', report).map(normalizeTask),
  };
}

export function normalizeState(x: unknown, report?: Report): TaskState {
  const o: Obj = isObj(x) ? x : {};
  const s = { ...o } as unknown as TaskState & Obj;
  s.commits = keepAll(arr(o.commits), (c): c is Obj => isObj(c) && typeof c.sha === 'string' && typeof c.title === 'string', 'commits', report) as unknown as Commit[];
  if (!('commits' in o) || o.commits === undefined) delete s.commits;
  s.blockedBy = Array.isArray(o.blockedBy) ? strs(o.blockedBy) : undefined;
  for (const k of ['claimedAt', 'startedAt', 'doneAt'] as const) s[k] = optStr(o[k]);
  const forge = normalizeForge(o.forge, report);
  if (forge) s.forge = forge; else delete s.forge;
  const evidence = normalizeEvidence(o.evidence, report);
  if (evidence) s.evidence = evidence; else delete s.evidence;
  const exec = normalizeExec(o.exec, report);
  if (exec) s.exec = exec; else delete s.exec;
  return s;
}

/** The exec block of a task state: kept only whole and well-typed (it drives the orphan mark). */
const isoOrNull = (v: unknown): string | null => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null);

/** state/T.exec: dropped (and reported) when a field is missing or mistyped, or since/leaseUntil is not a date. */
function normalizeExec(x: unknown, report?: Report): TaskExec | undefined {
  if (x === undefined) return undefined;
  const drop = (why: string): undefined => { report?.('exec', 'dropped', why); return undefined; };
  if (!isObj(x)) return drop(kindOf(x));
  if (typeof x.runId !== 'string') return drop('no runId');
  if (typeof x.by !== 'string') return drop('no by');
  const since = isoOrNull(x.since), leaseUntil = isoOrNull(x.leaseUntil);
  if (!since || !leaseUntil) return drop('since or leaseUntil is not a date');
  if (!(STAGES as readonly unknown[]).includes(x.stage)) return drop(`stage ${String(x.stage).slice(0, 20)}`);
  if (x.mode !== 'subagents' && x.mode !== 'sessions' && x.mode !== 'manual') return drop(`mode ${String(x.mode).slice(0, 20)}`);
  const e: TaskExec = { runId: x.runId, mode: x.mode, by: x.by, stage: x.stage as Stage, since, leaseUntil };
  if (typeof x.agent === 'string' || x.agent === null) e.agent = x.agent;
  if (typeof x.round === 'number' && Number.isInteger(x.round)) e.round = x.round;
  return e;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The forge block of a task state: kept only with string path and phase; other fields dropped when mistyped. */
function normalizeForge(x: unknown, report?: Report): TaskState['forge'] | undefined {
  if (x === undefined) return undefined;
  if (!isObj(x) || typeof x.path !== 'string' || typeof x.phase !== 'string') { report?.('forge', 'dropped', isObj(x) ? 'no path or phase' : kindOf(x)); return undefined; }
  const f: NonNullable<TaskState['forge']> = { path: x.path, phase: x.phase };
  if (typeof x.agent === 'string') f.agent = x.agent;
  if (Array.isArray(x.validators)) {
    const vals: { name: string; ok: boolean | null }[] = [];
    x.validators.forEach((v, i) => {
      // H-04: forge writes a validator that has no result yet as its bare name.
      if (typeof v === 'string' && v) { vals.push({ name: v.slice(0, 80), ok: null }); report?.(`forge.validators[${i}]`, 'coerced', 'string'); }
      else if (isObj(v) && typeof v.name === 'string' && (typeof v.ok === 'boolean' || v.ok === null)) vals.push({ name: v.name, ok: v.ok as boolean | null });
      else report?.(`forge.validators[${i}]`, 'dropped', kindOf(v));
    });
    f.validators = vals;
  }
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
export function normalizeRun(x: unknown, report?: Report): RunDoc | null {
  if (!isObj(x)) { report?.('run', 'dropped', kindOf(x)); return null; }
  const mode = x.mode === 'subagents' || x.mode === 'sessions' ? x.mode : null;
  if (!mode || typeof x.runId !== 'string' || typeof x.branch !== 'string' || typeof x.coordinator !== 'string') {
    report?.('run', 'dropped', 'no mode, runId, branch or coordinator');
    return null;
  }
  const parallel = typeof x.parallel === 'number' && Number.isInteger(x.parallel) ? Math.min(10, Math.max(1, x.parallel)) : 1;
  const slots = keepAll(Array.isArray(x.slots) ? x.slots : [], (s): s is Obj => isObj(s) && typeof s.task === 'string' && typeof s.stage === 'string' && (STAGES as readonly unknown[]).includes(s.stage) && typeof s.by === 'string' && !!isoOrNull(s.since), 'slots', report)
    .slice(0, 10).map(s => ({ task: s.task as string, stage: s.stage as Stage, agent: typeof s.agent === 'string' ? s.agent : null, by: s.by as string, since: s.since as string }));
  const kind = x.kind === 'ephemeral' ? 'ephemeral' : 'plan';
  return { runId: x.runId, mode, parallel, branch: x.branch, mergeOnFinish: x.mergeOnFinish === true, active: x.active === true,
    stopReason: typeof x.stopReason === 'string' ? x.stopReason : null, coordinator: x.coordinator, slots,
    kind, loose: kind === 'ephemeral' ? normalizeLoose(x.loose, report) : [] };
}

/** meta/run.loose: valid ids (the plan's rule), no repeats, a title, a known status; stage and agent or null. At most LOOSE_MAX_TASKS. */
function normalizeLoose(x: unknown, report?: Report): LooseRunTask[] {
  const out: LooseRunTask[] = [];
  for (const [i, t] of arr(x).entries()) {
    if (out.length >= LOOSE_MAX_TASKS) break;
    if (!isObj(t) || typeof t.id !== 'string' || !isPlanId(t.id) || out.some(o => o.id === t.id)) { report?.(`loose[${i}]`, 'dropped', isObj(t) ? 'bad or repeated id' : kindOf(t)); continue; }
    const title = typeof t.title === 'string' ? t.title.trim().slice(0, 200) : '';
    if (!title || !(LOOSE_STATUSES as readonly unknown[]).includes(t.status)) { report?.(`loose[${i}]`, 'dropped', 'no title or status'); continue; }
    out.push({
      id: t.id, title, status: t.status as LooseStatus,
      stage: (STAGES as readonly unknown[]).includes(t.stage) ? (t.stage as Stage) : null,
      agent: typeof t.agent === 'string' && t.agent ? t.agent.slice(0, 80) : null,
      // Published by the skill from finishedAt − startedAt; at most 30 days.
      ...(typeof t.seconds === 'number' && Number.isFinite(t.seconds) && t.seconds >= 0 && t.seconds <= 30 * 86400 ? { seconds: Math.round(t.seconds) } : {}),
    });
  }
  return out;
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

function normalizeEvidence(x: unknown, report?: Report): TaskState['evidence'] | undefined {
  if (x === undefined) return undefined;
  if (!isObj(x) || (x.result !== 'pass' && x.result !== 'fail' && x.result !== 'blocked')) { report?.('evidence', 'dropped', isObj(x) ? `result ${String(x.result).slice(0, 20)}` : kindOf(x)); return undefined; }
  const e: NonNullable<TaskState['evidence']> = {
    surfaces: strs(x.surfaces), result: x.result,
    passed: finite(x.passed) ? x.passed : 0, total: finite(x.total) ? x.total : 0,
    shots: arr(x.shots).flatMap((v, i) => {
      if (!isObj(v) || typeof v.ok !== 'boolean') { report?.(`evidence.shots[${i}]`, 'dropped', kindOf(v)); return []; }
      // G-03: forge may write a numbered check as a number.
      let check: string;
      if (typeof v.check === 'string') check = v.check;
      else if (finite(v.check)) { check = String(v.check); report?.(`evidence.shots[${i}].check`, 'coerced', 'number'); }
      else { report?.(`evidence.shots[${i}]`, 'dropped', 'no check'); return []; }
      const shot: NonNullable<TaskState['evidence']>['shots'][number] = { surface: str(v.surface), check, ok: v.ok };
      const url = safeUrl(v.url);
      if (url) shot.url = url;
      if (typeof v.id === 'string') shot.id = v.id;
      if (typeof v.expected === 'string') shot.expected = v.expected;
      if (typeof v.observed === 'string') shot.observed = v.observed;
      return [shot];
    }).slice(0, 30),
  };
  if (typeof x.local === 'string') e.local = x.local;
  if (x.pending === true) e.pending = true;
  if (typeof x.reason === 'string') e.reason = x.reason;
  return e;
}
