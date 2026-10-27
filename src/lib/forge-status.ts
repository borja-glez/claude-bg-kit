// forge's current task, kept in .forge/status.json: forge updates it on each ledger append, lens reads it.
// Pure, so both the forge CLI and the lens mod bundle it.
import { isSafeId } from './execution-state.js';

/** K4-05: the findings of a verdict by severity (wave 1 logs the counts in each verdict event). */
export type Findings = { critical: number; important: number; minor: number };

export type ForgeStatus = {
  ts: string; task: string; path: string; phase: string; agent: string | null;
  validators: { name: string; ok: boolean; cached?: true }[];
  // K4-05: `round` is the review (reviews.n) that gave it, null in an older ledger; `findings` its counts by severity.
  // `score` is kept for older readers: no view draws it.
  verdict: { action: string; score: number | null; round: number | null; findings: Findings | null } | null;
  round: number | null; cap: number | null;
  // The brief in progress (Medium and Large) and the briefs whose verdict accepted them.
  brief: number | null; accepted: number[];
  // The verify plan of the current task (from verify-plan) and its result (from verdict), null before any plan.
  verify: { planned: boolean; surfaces: string[]; result: string | null; passed: number | null; total: number | null; evidence: string | null; reason: string | null; skipped: string[]; launched: boolean } | null;
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
  // C5: who reviews the brief in progress (phase review, wave 1), emptied by the next phase implement; and the review
  // count, n of max, of the last verdict or round event that says it. Empty / null in an older status.
  reviewers: string[]; reviews: { n: number; max: number } | null;
  // The task runs in auto mode; absent otherwise.
  autonomy?: 'auto';
};

const CLIP = 80;
const MAX_VALIDATORS = 10;
const MAX_ACCEPTED = 200;
const MAX_STAGES = 20;
const MAX_TS = 40;
const MAX_REVIEWERS = 6;
const MAX_SKIPPED = 10;
const MAX_REVIEWS = 20;
const MAX_FINDINGS = 999;

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

const EMPTY_VERIFY: NonNullable<ForgeStatus['verify']> = { planned: false, surfaces: [], result: null, passed: null, total: null, evidence: null, reason: null, skipped: [], launched: false };
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
    .filter((r): r is { validator: string; ok?: unknown; cached?: unknown } => isObj(r) && str(r.validator))
    .slice(0, MAX_VALIDATORS)
    // C6: a result taken from the validation cache says so.
    .map(r => ({ name: cleanText(r.validator), ok: r.ok === true, ...(r.cached === true ? { cached: true as const } : {}) }));

const roundOf = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_REVIEWS ? v : null);
/** K4-05: the review count of a verdict or round event (wave 1), n of max, each an integer from 1 to 20; else null. */
const reviewsOf = (x: unknown): ForgeStatus['reviews'] => {
  if (!isObj(x)) return null;
  const n = roundOf(x.n), max = roundOf(x.max);
  return n !== null && max !== null ? { n, max } : null;
};
const countOf = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_FINDINGS ? v : null);
/** K4-05: the counts by severity of a verdict, or null when any of the three is missing or out of range. */
const findingsOf = (x: Record<string, unknown>): Findings | null => {
  const critical = countOf(x.critical), important = countOf(x.important), minor = countOf(x.minor);
  return critical !== null && important !== null && minor !== null ? { critical, important, minor } : null;
};
/** C4: a reviewer as phase review names it: a name, or the spawn entry the CLI logs (its role or agent, a twin left out). roadmap-doc reads them too. */
const reviewerName = (r: unknown): string | null => {
  if (str(r)) return cleanText(r) || null;
  if (!isObj(r) || r.twin === true) return null;
  const v = str(r.role) ? r.role : str(r.agent) ? r.agent : null;
  return v ? cleanText(v.replace(/^(?:forge:)?(?:forge-)?review-/, '')) || null : null;
};
export const reviewersOf = (x: unknown): string[] =>
  [...new Set((Array.isArray(x) ? x : []).map(reviewerName).filter((s): s is string => !!s))].slice(0, MAX_REVIEWERS);

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
    // A safe id (up to 120) is kept whole, so the status's task matches its key; any other is clipped.
    const task = isSafeId(e.task) ? e.task : cleanText(e.task);
    // A fresh triage from the CLI (it carries `reasons`; a ratchet logged by the session does not) starts a new run of
    // the task: nothing of an earlier run under the same id is kept.
    const fresh = e.kind === 'triage' && Array.isArray(e.reasons);
    const same = !!prev && prev.task === task && !fresh;
    const base: ForgeStatus = same
      ? prev!
      : {
        ts, task, path: '', phase: '', agent: null, validators: [], verdict: null, round: null, cap: null, brief: null, accepted: [], verify: null,
        taskStartedAt: ts, stageSince: ts, stages: {}, doneAt: null, lastAt: tsText(ts), session: null, runId: null, project: null,
        reviewers: [], reviews: null,
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
      // C4: phase review names its reviewers (wave 1); the next phase implement starts an attempt without them.
      if (phase.toLowerCase() === 'review' && Array.isArray(e.reviewers)) next.reviewers = reviewersOf(e.reviewers);
      if (phase.toLowerCase() === 'implement') next.reviewers = [];
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
      // K2-05: a verification agent launched means the verification is under way, before any result.
      const verify = isVerifyAgent(agent) ? { ...(prev.verify ?? EMPTY_VERIFY), launched: true } : prev.verify;
      if (!prev.doneAt) return { ...prev, agent, verify };
      // An agent launched after the task closed (a verification, say) is work in progress again; the gap is no stage.
      // A done phase moves to the agent's stage, so nothing reads the task as done; the accept was the finished run's.
      // K2-02: a stopped phase, final like done, moves the same way: no stage reads as stopped while an agent works.
      const closed = prev.phase.toLowerCase() === 'done' || prev.phase.toLowerCase() === 'stopped';
      const phase = !closed ? prev.phase
        : isVerifyAgent(agent) ? 'verify' : isLight(prev.path) ? '' : lastStage(prev.stages);
      return { ...prev, agent, verify, phase, verdict: null, doneAt: null, stageSince: ts };
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
      // K4-05: the review that gave the verdict and its findings by severity (wave 1); none in an older ledger.
      const reviews = reviewsOf(e.reviews);
      const verdict = { action: cleanText(e.action), score: num(e.score), round: reviews?.n ?? null, findings: findingsOf(e) };
      const counted = reviews ? { ...cur, reviews } : cur;
      // A verdict accepting the task itself (not one of its briefs) finishes it.
      if (n === null && e.action === 'accept' && !cur.doneAt) {
        return { ...counted, accepted, verdict, stages: closeStage(cur, ts), stageSince: ts, doneAt: ts };
      }
      return { ...counted, accepted, verdict };
    }
    case 'round': {
      const reviews = reviewsOf(e.reviews);
      return { ...cur, round: num(e.round), cap: num(e.cap), ...(reviews ? { reviews } : {}) };
    }
    case 'verify': {
      const v = { ...(cur.verify ?? EMPTY_VERIFY) };
      if (typeof e.planned === 'boolean') {
        v.planned = e.planned;
        v.surfaces = (Array.isArray(e.surfaces) ? e.surfaces : []).filter(str).slice(0, MAX_VALIDATORS).map(cleanText);
        v.result = null; v.passed = null; v.total = null; v.evidence = null; v.reason = null; v.skipped = []; v.launched = false;
      }
      if (!str(e.result)) return { ...cur, verify: v };
      v.result = cleanText(e.result); v.passed = num(e.passed); v.total = num(e.total); v.evidence = pathText(e.evidence); v.reason = str(e.reason) ? cleanText(e.reason) : null;
      // The verification is over: its agent is gone, and a light task (no verdict to come) is finished.
      const next = { ...cur, verify: v, ...(isVerifyAgent(cur.agent) ? { agent: null } : {}) };
      return isLight(cur.path) ? finish(next, ts) : next;
    }
    case 'verify-skip': {
      // K2-05: a surface the session chose not to verify; when every planned surface is skipped, the verification is
      // over as skipped (with the last reason given), and a light task (no verdict to come) is finished.
      if (!str(e.surface)) return prev;
      const v = { ...(cur.verify ?? EMPTY_VERIFY) };
      const surface = cleanText(e.surface);
      if (surface && !v.skipped.includes(surface) && v.skipped.length < MAX_SKIPPED) v.skipped = [...v.skipped, surface];
      if (str(e.reason)) v.reason = cleanText(e.reason);
      if (!v.planned || v.surfaces.length === 0 || !v.surfaces.every(s => v.skipped.includes(s))) return { ...cur, verify: v };
      v.result = 'skipped';
      const next = { ...cur, verify: v };
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
    verdict = { action: cleanText(x.verdict.action), score: num(x.verdict.score), round: roundOf(x.verdict.round), findings: isObj(x.verdict.findings) ? findingsOf(x.verdict.findings) : null };
  }
  return {
    ts: x.ts, task: isSafeId(x.task) ? x.task : cleanText(x.task), path: cleanText(x.path), phase: cleanText(x.phase),
    agent: str(x.agent) ? cleanText(x.agent) : null,
    validators: (x.validators as unknown[])
      .filter((v): v is { name: string; ok: unknown } => isObj(v) && str(v.name))
      .slice(0, MAX_VALIDATORS)
      .map(v => ({ name: cleanText(v.name), ok: v.ok === true, ...((v as { cached?: unknown }).cached === true ? { cached: true as const } : {}) })),
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
      skipped: (Array.isArray(x.verify.skipped) ? x.verify.skipped : []).filter(str).slice(0, MAX_SKIPPED).map(cleanText), launched: x.verify.launched === true,
    } : null,
    // Absent in a status written before timings existed: no times are shown.
    taskStartedAt: tsText(x.taskStartedAt), stageSince: tsText(x.stageSince), stages: stagesOf(x.stages), doneAt: tsText(x.doneAt),
    lastAt: tsText(x.lastAt),
    // Absent in a status written before C4: who, which run and which project are unknown.
    session: isSafeId(x.session) ? x.session : null, runId: isSafeId(x.runId) ? x.runId : null, project: isSafeId(x.project) ? x.project : null,
    reviewers: (Array.isArray(x.reviewers) ? x.reviewers : []).filter(str).map(cleanText).filter(Boolean).slice(0, MAX_REVIEWERS), reviews: reviewsOf(x.reviews),
    ...(x.autonomy === 'auto' ? { autonomy: 'auto' as const } : {}),
  };
}

/** C5: where forge writes the task statuses of `root` (ledgerRoot on disk): `main` for a task worktree of it, else `root`. */
export function statusRootOf(root: string, main: string): string {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');
  const r = norm(root);
  const name = r.split('/').pop() ?? '';
  return name.startsWith('task-') && r.toLowerCase() === `${norm(main)}/.claude/worktrees/${name}`.toLowerCase() ? main : root;
}

/** C5: the statuses of a checkout by key, `<project>__<T>` or `<T>`. */
export type StatusMap = Record<string, ForgeStatus>;

/** C5: the file key of a task's status: `<project>__<T>` for a plan task, `<T>` for a loose one; null when a part, or the whole key, is not a safe id. */
export function statusKey(task: string, project: string | null): string | null {
  if (!isSafeId(task)) return null;
  if (project === null) return task;
  if (!isSafeId(project)) return null;
  const key = `${project}__${task}`;
  return isSafeId(key) ? key : null;
}

const BRIEF_ID = /^(.+)-(\d{1,4})$/;
// The latest move of a status (its lastAt, else its ts), for picking among several; -Infinity when not ISO.
const movedAt = (s: ForgeStatus): number => {
  const t = isoMs(s.lastAt ?? s.ts);
  return Number.isFinite(t) ? t : -Infinity;
};

/**
 * C5: which task an event belongs to. A triage goes to its own id; any other event to a status of its id when one
 * exists, else to <T> of a brief id <T>-<n> with a status of <T> (carrying n), else its own id. The project is the
 * event's own (C4, a safe id), else, for anything but a triage (a triage without one is a loose task), that of the
 * existing status of the task, the newest when several. Null for an event without ts, kind or task, or an unsafe key.
 */
export function routeEvent(map: StatusMap, event: unknown): { key: string; task: string; brief: number | null } | null {
  if (!isObj(event) || !str(event.ts) || !str(event.kind) || !str(event.task) || !event.task) return null;
  const id = event.task;
  const states = Object.values(map);
  const own = isSafeId(event.project) ? event.project : null;
  // With a project of its own, only a status of that project counts; without one, any status of the id.
  const has = (t: string) => (own === null ? states.some(s => s.task === t) : Object.hasOwn(map, statusKey(t, own) ?? ''));
  let task = id;
  let brief: number | null = null;
  if (event.kind !== 'triage' && !has(id)) {
    const m = BRIEF_ID.exec(id);
    if (m && has(m[1])) { task = m[1]; brief = Number(m[2]); }
  }
  const existing = states.filter(s => s.task === task).sort((a, b) => movedAt(b) - movedAt(a))[0];
  const project = own ?? (event.kind === 'triage' ? null : existing?.project ?? null);
  const key = statusKey(task, project);
  return key ? { key, task, brief } : null;
}

/**
 * C5: one event applied to the status of its task alone, so it never resets another task. A phase of a brief <T>-<n>
 * of a known task moves <T> with brief n. `changed` is the key whose status changed, or null.
 */
export function deriveStatuses(map: StatusMap, event: unknown): { map: StatusMap; changed: string | null } {
  const r = routeEvent(map, event);
  if (!r) return { map, changed: null };
  const e = event as Record<string, unknown>;
  const routed = r.brief !== null && e.kind === 'phase' ? { ...e, task: r.task, brief: briefNum(e.brief) ?? r.brief } : event;
  const prev = map[r.key] ?? null;
  const next = deriveStatus(prev, routed);
  if (!next || next === prev) return { map, changed: null };
  return { map: { ...map, [r.key]: next }, changed: r.key };
}
