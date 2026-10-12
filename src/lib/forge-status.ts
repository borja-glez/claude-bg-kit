// forge's current task, kept in .forge/status.json: forge updates it on each ledger append, lens reads it.
// Pure, so both the forge CLI and the lens mod bundle it.

export type ForgeStatus = {
  ts: string; task: string; path: string; phase: string; agent: string | null;
  validators: { name: string; ok: boolean }[];
  verdict: { action: string; score: number | null } | null;
  round: number | null; cap: number | null;
  // The brief in progress (Medium and Large) and the briefs whose verdict accepted them.
  brief: number | null; accepted: number[];
};

const CLIP = 80;
const MAX_VALIDATORS = 10;
const MAX_ACCEPTED = 200;

const str = (x: unknown): x is string => typeof x === 'string';
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/** C0, DEL and C1 control characters and bidi overrides/isolates removed, then clipped to 80. */
export const cleanText = (s: string): string => s.replace(/[\x00-\x1f\x7f-\x9f‪-‮⁦-⁩]/g, '').slice(0, CLIP);

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
    const base: ForgeStatus = prev && prev.task === task && !fresh
      ? prev
      : { ts, task, path: '', phase: '', agent: null, validators: [], verdict: null, round: null, cap: null, brief: null, accepted: [] };
    const next: ForgeStatus = { ...base, ts };
    if (e.kind === 'triage' && str(e.path)) next.path = cleanText(e.path);
    if (e.kind === 'phase' && str(e.phase)) next.phase = cleanText(e.phase);
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
      return { ...cur, accepted, verdict: { action: cleanText(e.action), score: num(e.score) } };
    }
    case 'round': return { ...cur, round: num(e.round), cap: num(e.cap) };
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
  };
}
