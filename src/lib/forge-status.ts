// forge's current task, kept in .forge/status.json: forge updates it on each ledger append, lens reads it.
// Pure, so both the forge CLI and the lens mod bundle it.
import { isSafeId } from './execution-state.js';

export type ForgeStatus = {
  ts: string; task: string; path: string; phase: string; agent: string | null;
  validators: { name: string; ok: boolean }[];
  verdict: { action: string; score: number | null } | null;
  round: number | null; cap: number | null;
  // The brief in progress (Medium and Large) and the briefs whose verdict accepted them.
  brief: number | null; accepted: number[];
  // The verify plan of the current task (from verify-plan) and its result (from verdict), null before any plan.
  verify: { planned: boolean; surfaces: string[]; result: string | null; passed: number | null; total: number | null; evidence: string | null; reason: string | null } | null;
  // When the current task started (its triage, or its first phase when no triage was seen), when the current stage
  // started, the seconds of each closed stage keyed by phase name (lowercase; 'triage' before the first phase),
  // and when the task finished (phase done, or a verdict accepting the task itself). null / {} in an older status.
  taskStartedAt: string | null; stageSince: string | null; stages: Record<string, number>; doneAt: string | null;
  // The ts of the task's latest event of any kind (lens's safety net for a light task the session never closed); null
  // in an older status.
  lastAt: string | null;
  // C4, D4: Claude's session of the task's latest event, the run of the latest event that names one, and the task's plan
  // project (its triage's, or one an event names); null in an older status and for a loose task.
  session: string | null; runId: string | null; project: string | null;
  // The task runs in auto mode (spec §5.5); absent otherwise.
  autonomy?: 'auto';
};

const CLIP = 80;
const MAX_VALIDATORS = 10;
const MAX_ACCEPTED = 200;
const MAX_STAGES = 20;
const MAX_TS = 40;

// Only ISO timestamps count for durations (a short string like '1' would parse as some year in V8).
const isoMs = (s: string | null): number => (s !== null && /^\d{4}-\d{2}-\d{2}T/.test(s) ? Date.parse(s) : NaN);
const tsText = (x: unknown): string | null => (str(x) && x.length <= MAX_TS ? x : null);
const stageKey = (phase: string): string => (phase ? phase.toLowerCase() : 'triage');

// The current stage closed at `ts`: its whole seconds added under its phase name. Unchanged when either time is not
// ISO, the end is before the start, or a new name would pass MAX_STAGES.
function closeStage(s: ForgeStatus, ts: string): Record<string, number> {
  const from = isoMs(s.stageSince);
  const to = isoMs(ts);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return s.stages;
  const key = stageKey(s.phase);
  const known = Object.hasOwn(s.stages, key);
  if (!known && Object.keys(s.stages).length >= MAX_STAGES) return s.stages;
  // Null-prototype, so a phase named `constructor` or `__proto__` is an ordinary key.
  const out: Record<string, number> = Object.assign(Object.create(null) as Record<string, number>, s.stages);
  out[key] = (known ? s.stages[key]! : 0) + Math.round((to - from) / 1000);
  return out;
}

function stagesOf(x: unknown): Record<string, number> {
  const out: Record<string, number> = Object.create(null) as Record<string, number>;
  if (!isObj(x)) return out;
  for (const [k, v] of Object.entries(x)) {
    if (Object.keys(out).length >= MAX_STAGES) break;
    const key = cleanText(k).toLowerCase();
    if (!key || typeof v !== 'number' || !Number.isFinite(v) || v < 0) continue;
    out[key] = Math.round(v);
  }
  return out;
}

const str = (x: unknown): x is string => typeof x === 'string';
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

const cp = (n: number) => String.fromCharCode(n);
// The bidi overrides and isolates (U+202A to U+202E, U+2066 to U+2069) built from code points, so the source never
// holds an invisible character.
// eslint-disable-next-line no-control-regex
const UNSAFE = new RegExp(`[\\x00-\\x1f\\x7f-\\x9f${cp(0x202a)}-${cp(0x202e)}${cp(0x2066)}-${cp(0x2069)}]`, 'g');
/** C0, DEL and C1 control characters and bidi overrides/isolates removed, then clipped to 80. */
export const cleanText = (s: string): string => s.replace(UNSAFE, '').slice(0, CLIP);

const EMPTY_VERIFY: NonNullable<ForgeStatus['verify']> = { planned: false, surfaces: [], result: null, passed: null, total: null, evidence: null, reason: null };
const pathText = (x: unknown) => (str(x) ? x.replace(/[\x00-\x1f\x7f-\x9f]/g, '').slice(0, 200) : null);

// The brief number of `<task>-<n>`, or null for the task itself.
const briefOf = (task: string, t: unknown): number | null =>
  str(t) && t.startsWith(`${task}-`) && /^\d+$/.test(t.slice(task.length + 1)) ? Number(t.slice(task.length + 1)) : null;
const briefNum = (x: unknown): number | null => (typeof x === 'number' && Number.isInteger(x) && x > 0 && x < 10_000 ? x : null);

// The task itself or one of its briefs, `<task>-<n>`.
const ownedBy = (task: string, t: unknown): boolean =>
  str(t) && (t === task || (t.startsWith(`${task}-`) && /^\d+$/.test(t.slice(task.length + 1))));

const validatorsOf = (results: unknown): ForgeStatus['validators'] =>
  (Array.isArray(results) ? results : [])
    .filter((r): r is { validator: string; ok?: unknown } => isObj(r) && str(r.validator))
    .slice(0, MAX_VALIDATORS)
    .map(r => ({ name: cleanText(r.validator), ok: r.ok === true }));

// The Trivial and Small paths log no review verdict: a passing validate (Trivial) or a verify result finishes them.
const isLight = (path: string): boolean => path === 'trivial' || path === 'small';
// forge-verify and forge-verify-heavy.
const isVerifyAgent = (agent: string | null): boolean => !!agent && agent.startsWith('forge-verify');

// The last stage closed before done (stages keep the order their names first closed in), '' when there is none.
const lastStage = (stages: Record<string, number>): string =>
  Object.keys(stages).filter(k => k !== 'done' && k !== 'stopped' && k !== 'triage').at(-1) ?? '';
const PATHS = ['trivial', 'small', 'medium', 'large'];

// The task finished at `ts`: its stage closed. Unchanged when it already was.
const finish = (s: ForgeStatus, ts: string): ForgeStatus => (s.doneAt ? s : { ...s, stages: closeStage(s, ts), stageSince: ts, doneAt: ts });

/**
 * Applies one ledger event to the status: a triage or phase event with a task makes that task current (keeping what is
 * known of it when it already was); agent, validate, verdict, round and verify events of the current task or its briefs
 * fill it in. Anything else leaves the status as it was. Every event of the task moves its lastAt.
 */
export function deriveStatus(prev: ForgeStatus | null, event: unknown): ForgeStatus | null {
  const next = applyEvent(prev, event);
  if (!next || !isObj(event) || !str(event.ts) || !str(event.kind)) return next;
  // An event that changed nothing still counts when it is of the task (any kind, e.g. a decision).
  if (next === prev && !ownedBy(next.task, event.task)) return next;
  const lastAt = tsText(event.ts);
  // C4: who wrote the task's latest event, the run of the latest one that names it, and the project its triage or an
  // event names (an event without one never drops it).
  const session = isSafeId(event.session) ? event.session : null;
  const runId = isSafeId(event.runId) ? event.runId : next.runId;
  const project = isSafeId(event.project) ? event.project : next.project;
  if (lastAt === next.lastAt && session === next.session && runId === next.runId && project === next.project) return next;
  return { ...next, lastAt, session, runId, project };
}

function applyEvent(prev: ForgeStatus | null, event: unknown): ForgeStatus | null {
  if (!isObj(event) || !str(event.ts) || !str(event.kind)) return prev;
  const e = event;
  const ts: string = event.ts;
  if ((e.kind === 'triage' || e.kind === 'phase') && str(e.task) && e.task) {
    const task = cleanText(e.task);
    // A fresh triage from the CLI (it carries `reasons`; a ratchet logged by the session does not) starts a new run of
    // the task: nothing of an earlier run under the same id is kept.
    const fresh = e.kind === 'triage' && Array.isArray(e.reasons);
    const same = !!prev && prev.task === task && !fresh;
    const base: ForgeStatus = same
      ? prev!
      : {
        ts, task, path: '', phase: '', agent: null, validators: [], verdict: null, round: null, cap: null, brief: null, accepted: [], verify: null,
        taskStartedAt: ts, stageSince: ts, stages: {}, doneAt: null, lastAt: tsText(ts), session: null, runId: null, project: null,
      };
    const next: ForgeStatus = { ...base, ts };
    if (e.kind === 'triage' && str(e.path)) {
      next.path = cleanText(e.path);
      // A ratchet that raises a finished task's path (Trivial closed by its validate, say) reopens it: more work is due.
      if (same && base.doneAt && PATHS.indexOf(next.path) > PATHS.indexOf(base.path)) { next.doneAt = null; next.stageSince = ts; }
    }
    // A fresh triage says whether the task runs in auto mode; a ratchet (no `reasons`) keeps what the task had.
    if (fresh && e.autonomy === 'auto') next.autonomy = 'auto';
    if (e.kind === 'phase' && str(e.phase)) {
      const phase = cleanText(e.phase);
      // K2-02: forge stop ends a task with the phase stopped, final like done.
      const done = phase.toLowerCase() === 'done' || phase.toLowerCase() === 'stopped';
      // A repeated done keeps the first; any other phase after done reopens the task (that gap is no stage).
      if (!(done && base.doneAt)) {
        if (same && !base.doneAt) next.stages = closeStage(base, ts);
        next.stageSince = ts;
        next.doneAt = done ? ts : null;
      }
      // A finished task has no agent at work.
      if (done) next.agent = null;
      next.phase = phase;
    }
    if (e.kind === 'phase' && briefNum(e.brief) !== null) next.brief = briefNum(e.brief);
    return next;
  }
  if (!prev || !ownedBy(prev.task, e.task)) return prev;
  const n = briefOf(prev.task, e.task);
  const cur = n !== null ? { ...prev, brief: n } : prev;
  switch (e.kind) {
    case 'agent': {
      if (!str(e.agent)) return prev;
      const agent = cleanText(e.agent);
      if (!prev.doneAt) return { ...prev, agent };
      // An agent launched after the task closed (a verification, say) is work in progress again; the gap is no stage.
      // A done phase moves to the agent's stage, so nothing reads the task as done; the accept was the finished run's.
      // K2-02: a stopped phase, final like done, moves the same way: no stage reads as stopped while an agent works.
      const closed = prev.phase.toLowerCase() === 'done' || prev.phase.toLowerCase() === 'stopped';
      const phase = !closed ? prev.phase
        : isVerifyAgent(agent) ? 'verify' : isLight(prev.path) ? '' : lastStage(prev.stages);
      return { ...prev, agent, phase, verdict: null, doneAt: null, stageSince: ts };
    }
    case 'validate': {
      const next = { ...cur, validators: validatorsOf(e.results) };
      // Trivial logs only its triage and its validate: a passing one of the task itself (not a base-commit run) ends it.
      return n === null && cur.path === 'trivial' && e.ok === true && e.baseline !== true ? finish(next, ts) : next;
    }
    case 'verdict': {
      if (!str(e.action)) return prev;
      const accepted = n !== null && e.action === 'accept' && !cur.accepted.includes(n)
        ? [...cur.accepted, n].sort((a, b) => a - b).slice(-MAX_ACCEPTED) : cur.accepted;
      const verdict = { action: cleanText(e.action), score: num(e.score) };
      // A verdict accepting the task itself (not one of its briefs) finishes it.
      if (n === null && e.action === 'accept' && !cur.doneAt) {
        return { ...cur, accepted, verdict, stages: closeStage(cur, ts), stageSince: ts, doneAt: ts };
      }
      return { ...cur, accepted, verdict };
    }
    case 'round': return { ...cur, round: num(e.round), cap: num(e.cap) };
    case 'verify': {
      const v = { ...(cur.verify ?? EMPTY_VERIFY) };
      if (typeof e.planned === 'boolean') {
        v.planned = e.planned;
        v.surfaces = (Array.isArray(e.surfaces) ? e.surfaces : []).filter(str).slice(0, MAX_VALIDATORS).map(cleanText);
        v.result = null; v.passed = null; v.total = null; v.evidence = null; v.reason = null;
      }
      if (!str(e.result)) return { ...cur, verify: v };
      v.result = cleanText(e.result); v.passed = num(e.passed); v.total = num(e.total); v.evidence = pathText(e.evidence); v.reason = str(e.reason) ? cleanText(e.reason) : null;
      // The verification is over: its agent is gone, and a light task (no verdict to come) is finished.
      const next = { ...cur, verify: v, ...(isVerifyAgent(cur.agent) ? { agent: null } : {}) };
      return isLight(cur.path) ? finish(next, ts) : next;
    }
    default: return prev;
  }
}

/** Strict reader for status.json (a shared, untrusted file): null unless every field has its type. */
export function normalizeStatus(x: unknown): ForgeStatus | null {
  if (!isObj(x) || !str(x.ts) || !str(x.task) || !x.task || !str(x.path) || !str(x.phase)) return null;
  if (x.agent !== null && !str(x.agent)) return null;
  if (!Array.isArray(x.validators)) return null;
  let verdict: ForgeStatus['verdict'] = null;
  if (x.verdict !== null) {
    if (!isObj(x.verdict) || !str(x.verdict.action)) return null;
    verdict = { action: cleanText(x.verdict.action), score: num(x.verdict.score) };
  }
  return {
    ts: x.ts, task: cleanText(x.task), path: cleanText(x.path), phase: cleanText(x.phase),
    agent: str(x.agent) ? cleanText(x.agent) : null,
    validators: (x.validators as unknown[])
      .filter((v): v is { name: string; ok: unknown } => isObj(v) && str(v.name))
      .slice(0, MAX_VALIDATORS)
      .map(v => ({ name: cleanText(v.name), ok: v.ok === true })),
    verdict, round: num(x.round), cap: num(x.cap),
    // Absent in a status written before these fields existed.
    brief: briefNum(x.brief),
    accepted: Array.isArray(x.accepted) ? [...new Set(x.accepted.map(briefNum).filter((v): v is number => v !== null))].sort((a, b) => a - b).slice(-MAX_ACCEPTED) : [],
    // Absent in a status written before the verify plan existed.
    verify: isObj(x.verify) && typeof x.verify.planned === 'boolean' ? {
      planned: x.verify.planned,
      surfaces: (Array.isArray(x.verify.surfaces) ? x.verify.surfaces : []).filter(str).slice(0, MAX_VALIDATORS).map(cleanText),
      result: str(x.verify.result) ? cleanText(x.verify.result) : null,
      passed: num(x.verify.passed), total: num(x.verify.total),
      evidence: pathText(x.verify.evidence), reason: str(x.verify.reason) ? cleanText(x.verify.reason) : null,
    } : null,
    // Absent in a status written before timings existed: no times are shown.
    taskStartedAt: tsText(x.taskStartedAt), stageSince: tsText(x.stageSince), stages: stagesOf(x.stages), doneAt: tsText(x.doneAt),
    lastAt: tsText(x.lastAt),
    // Absent in a status written before C4: who, which run and which project are unknown.
    session: isSafeId(x.session) ? x.session : null, runId: isSafeId(x.runId) ? x.runId : null, project: isSafeId(x.project) ? x.project : null,
    ...(x.autonomy === 'auto' ? { autonomy: 'auto' as const } : {}),
  };
}
