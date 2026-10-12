// forge's current task, kept in .forge/status.json: forge updates it on each ledger append, lens reads it.
// Pure, so both the forge CLI and the lens mod bundle it.

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

/** C0, DEL and C1 control characters and bidi overrides/isolates removed, then clipped to 80. */
export const cleanText = (s: string): string => s.replace(/[\x00-\x1f\x7f-\x9f‪-‮⁦-⁩]/g, '').slice(0, CLIP);

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

/**
 * Applies one ledger event to the status: a triage or phase event with a task makes that task current (keeping what is
 * known of it when it already was); agent, validate, verdict and round events of the current task or its briefs fill
 * it in. Anything else leaves the status as it was.
 */
export function deriveStatus(prev: ForgeStatus | null, event: unknown): ForgeStatus | null {
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
        taskStartedAt: ts, stageSince: ts, stages: {}, doneAt: null,
      };
    const next: ForgeStatus = { ...base, ts };
    if (e.kind === 'triage' && str(e.path)) next.path = cleanText(e.path);
    if (e.kind === 'phase' && str(e.phase)) {
      const phase = cleanText(e.phase);
      const done = phase.toLowerCase() === 'done';
      // A repeated done keeps the first; any other phase after done reopens the task (that gap is no stage).
      if (!(done && base.doneAt)) {
        if (same && !base.doneAt) next.stages = closeStage(base, ts);
        next.stageSince = ts;
        next.doneAt = done ? ts : null;
      }
      next.phase = phase;
    }
    if (e.kind === 'phase' && briefNum(e.brief) !== null) next.brief = briefNum(e.brief);
    return next;
  }
  if (!prev || !ownedBy(prev.task, e.task)) return prev;
  const n = briefOf(prev.task, e.task);
  const cur = n !== null ? { ...prev, brief: n } : prev;
  switch (e.kind) {
    case 'agent': return str(e.agent) ? { ...prev, agent: cleanText(e.agent) } : prev;
    case 'validate': return { ...cur, validators: validatorsOf(e.results) };
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
      if (str(e.result)) { v.result = cleanText(e.result); v.passed = num(e.passed); v.total = num(e.total); v.evidence = pathText(e.evidence); v.reason = str(e.reason) ? cleanText(e.reason) : null; }
      return { ...cur, verify: v };
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
  };
}
