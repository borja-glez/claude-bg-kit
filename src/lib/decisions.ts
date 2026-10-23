// forge's decisions: the `decision` events of the ledger (what forge decided in place of the user, or what the user
// answered) and .forge/decisions.json, the small summary lens and the waypoint band read. Pure (no node:*, no zod):
// the forge CLI, lens, the waypoint mod and the roadmap page all bundle it.

export const DECISION_POINTS = ['route', 'triage', 'design-apply', 'design-approve', 'plan-confirm', 'mode', 'ruling', 'safe-path', 'takeover', 'revert', 'blocked', 'trust', 'other'] as const;
export type DecisionPoint = (typeof DECISION_POINTS)[number];
export const DECISION_BY = ['auto', 'unattended', 'user'] as const;
export type DecisionBy = (typeof DECISION_BY)[number];
export type DecisionWeight = 'major' | 'minor';
/** Points that change the scope of the work or skip a person's gate: lens and the band name the last one. */
export const MAJOR_POINTS: readonly DecisionPoint[] = ['route', 'design-approve', 'plan-confirm', 'mode'];
export const LIMITS = { what: 200, chosen: 200, alternative: 200, alternatives: 10, why: 500, revert: 500, safePath: 200, reason: 300, whyNot: 300, tradeoffs: 300 } as const;
/** lens and the band read no decisions.json above this, and show none older than the window. */
export const DECISIONS_MAX = 16 * 1024;
export const DECISIONS_WINDOW_MS = 24 * 3600_000;
const LAST_MAX = 5;
/** A summary dated further ahead than this (a wrong clock) would never go stale: it is not shown. */
const FUTURE_SKEW_MS = 5 * 60_000;
const SHORT = 80;

export const SHA = /^[0-9a-f]{7,40}$/i;
export const PROJECT_ID = /^[A-Za-z0-9_.-]{1,64}$/;
export const TASK_ID = /^[A-Za-z0-9_.:-]{1,120}$/;
export const RUN_ID = /^[A-Za-z0-9_.-]{1,120}$/;
export const BRANCH = /^[A-Za-z0-9_./][A-Za-z0-9_\-./]{0,199}$/;
/** K2-19: at most this many commits in a git-revert's `shas`. */
export const UNDO_SHAS_MAX = 50;

// shas (K2-19): exactly the commits the decision made, each in base..head; a revert undoes those and nothing else.
export type DecisionUndo =
  | { type: 'git-revert'; base: string; head: string; cwd?: string; shas?: string[] }
  | { type: 'design-reopen'; project: string }
  | { type: 'plan-edit'; project: string; tasks: string[] }
  | { type: 'branch-discard'; branch: string }
  | { type: 'none'; reason: string };

/** An option not taken: why not, and what it would have gained and lost. A plain text is `{ option }`. */
export interface Alternative { option: string; whyNot?: string; tradeoffs?: string }

export interface Decision {
  ts: string; point: DecisionPoint; what: string; chosen: string; alternatives: Alternative[]; tradeoffs: string | null; why: string;
  by: DecisionBy; weight: DecisionWeight; revert: string | null; undo: DecisionUndo | null;
  task: string | null; runId: string | null; safePath: string | null; revertOf: number | null;
}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x);
const str = (x: unknown): x is string => typeof x === 'string';
const oneOf = <T extends string>(list: readonly T[], x: unknown): T | null => (str(x) && (list as readonly string[]).includes(x) ? (x as T) : null);
const notDots = (s: string) => s !== '.' && s !== '..';

const cp = (n: number) => String.fromCharCode(n);
// C0, DEL and C1 controls and the bidi overrides (U+202A to U+202E, U+2066 to U+2069), built from code points so the
// source never holds an invisible character.
// eslint-disable-next-line no-control-regex
const UNSAFE = new RegExp(`[\\x00-\\x1f\\x7f-\\x9f${cp(0x202a)}-${cp(0x202e)}${cp(0x2066)}-${cp(0x2069)}]`, 'g');
/** One line: C0, DEL and C1 controls and bidi overrides become spaces, whitespace collapses, clipped to `max`. */
/** One line without control or bidi characters, at most `max` code points (carry 6: a clip never splits a surrogate pair). */
export const clean = (s: string, max: number): string => {
  const t = s.replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : Array.from(t).slice(0, max).join('');
};
const text = (x: unknown, max: number): string | null => (str(x) ? clean(x, max) || null : null);
const ident = (x: unknown, re: RegExp): string | null => (str(x) && re.test(x) && notDots(x) ? x : null);

export const weightOf = (point: DecisionPoint): DecisionWeight => (MAJOR_POINTS.includes(point) ? 'major' : 'minor');

/** An alternative from untrusted JSON, plain text or an object: null when it has no usable option. Shared by the ledger reader and the note normalizer. */
export function normalizeAlternative(x: unknown): Alternative | null {
  if (str(x)) {
    const option = clean(x, LIMITS.alternative);
    return option ? { option } : null;
  }
  if (!isObj(x)) return null;
  const option = text(x.option, LIMITS.alternative);
  if (!option) return null;
  const whyNot = text(x.whyNot, LIMITS.whyNot);
  const tradeoffs = text(x.tradeoffs, LIMITS.tradeoffs);
  return { option, ...(whyNot ? { whyNot } : {}), ...(tradeoffs ? { tradeoffs } : {}) };
}

/** The structured way to undo a decision, from untrusted JSON: null when its kind is unknown or an id is unsafe. */
export function normalizeUndo(x: unknown): DecisionUndo | null {
  if (!isObj(x)) return null;
  switch (x.type) {
    case 'git-revert': {
      const base = str(x.base) && SHA.test(x.base) ? x.base : null;
      const head = str(x.head) && SHA.test(x.head) ? x.head : null;
      if (!base || !head) return null;
      const cwd = text(x.cwd, 500);
      // Stored shas that are all invalid collapse to none: the revert then falls back to the range, which step 2 lists first.
      const shas = Array.isArray(x.shas) ? [...new Set(x.shas.filter((s): s is string => str(s) && SHA.test(s)))].slice(0, UNDO_SHAS_MAX) : [];
      return { type: 'git-revert', base, head, ...(cwd ? { cwd } : {}), ...(shas.length ? { shas } : {}) };
    }
    case 'design-reopen': {
      const project = ident(x.project, PROJECT_ID);
      return project ? { type: 'design-reopen', project } : null;
    }
    case 'plan-edit': {
      const project = ident(x.project, PROJECT_ID);
      const tasks = Array.isArray(x.tasks) ? x.tasks.map(t => ident(t, TASK_ID)).filter((t): t is string => t !== null).slice(0, 50) : [];
      return project && tasks.length ? { type: 'plan-edit', project, tasks } : null;
    }
    case 'branch-discard': {
      const branch = str(x.branch) && BRANCH.test(x.branch) && !x.branch.includes('..') ? x.branch : null;
      return branch ? { type: 'branch-discard', branch } : null;
    }
    case 'none': {
      const reason = text(x.reason, LIMITS.reason);
      return reason ? { type: 'none', reason } : null;
    }
    default:
      return null;
  }
}

/**
 * A ledger `decision` event as a Decision, or null without a ts or a usable `what`. Events written before forge 0.10
 * read as follows: no `point` → `safe-path` with a `safePath`, `takeover` for the swarm's takeover, else `other`; a
 * `by` that is not auto|unattended|user → `user` for a takeover (the old one wrote a session id there), else
 * `unattended`; no `chosen` → the
 * `safePath`, else the `what`.
 */
export function normalizeDecision(x: unknown): Decision | null {
  if (!isObj(x)) return null;
  const ts = str(x.ts) && x.ts ? x.ts : null;
  const what = text(x.what, LIMITS.what);
  if (!ts || !what) return null;
  const safePath = text(x.safePath, LIMITS.safePath);
  const point = oneOf(DECISION_POINTS, x.point) ?? (safePath ? 'safe-path' : what === 'takeover' ? 'takeover' : 'other');
  const alternatives = Array.isArray(x.alternatives)
    ? x.alternatives.map(normalizeAlternative).filter((a): a is Alternative => a !== null).slice(0, LIMITS.alternatives)
    : [];
  return {
    ts, point, what,
    chosen: text(x.chosen, LIMITS.chosen) ?? safePath ?? what,
    alternatives,
    tradeoffs: text(x.tradeoffs, LIMITS.tradeoffs),
    why: text(x.why, LIMITS.why) ?? '',
    // The old takeover wrote a session id in `by`: the user asked that session to go on, so it is the user's decision.
    by: oneOf(DECISION_BY, x.by) ?? (point === 'takeover' ? 'user' : 'unattended'),
    weight: x.weight === 'major' || x.weight === 'minor' ? x.weight : weightOf(point),
    revert: text(x.revert, LIMITS.revert),
    undo: normalizeUndo(x.undo),
    task: ident(x.task, TASK_ID),
    runId: ident(x.runId, RUN_ID),
    safePath,
    revertOf: typeof x.revertOf === 'number' && Number.isInteger(x.revertOf) && x.revertOf > 0 ? x.revertOf : null,
  };
}

/** A decision's scope: its execution, else its task without a brief suffix `-<n>` (n of 1 to 3 digits). */
export function decisionScope(d: Pick<Decision, 'runId' | 'task'>): string | null {
  if (d.runId) return d.runId;
  return d.task ? d.task.replace(/-\d{1,3}$/, '') : null;
}

/** A scope as a file name: anything outside [A-Za-z0-9_.-] becomes '-' (a `:` would be an NTFS stream). */
export function scopeFileName(scope: string): string {
  const s = scope.replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 120);
  return s && notDots(s) ? s : 'forge';
}

type Entry = { n: number; point: DecisionPoint; what: string; chosen: string; ts: string };
export interface DecisionsDoc {
  ts: string; scope: string; count: number; autonomy: 'auto' | 'unattended';
  last: (Entry & { weight: DecisionWeight })[];
  lastMajor: Entry | null;
}

/** The summary after decision number `n`: a person's own answer leaves it as it was; another scope starts it over. */
export function nextDecisionsDoc(prev: DecisionsDoc | null, d: Decision, n: number): DecisionsDoc | null {
  if (d.by === 'user') return prev;
  const scope = decisionScope(d) ?? 'forge';
  const base = prev && prev.scope === scope ? prev : null;
  const entry: Entry = { n, point: d.point, what: clean(d.what, SHORT), chosen: clean(d.chosen, SHORT), ts: d.ts };
  return {
    ts: d.ts, scope, count: (base?.count ?? 0) + 1, autonomy: d.by,
    last: [...(base?.last ?? []), { ...entry, weight: d.weight }].slice(-LAST_MAX),
    lastMajor: d.weight === 'major' ? entry : base?.lastMajor ?? null,
  };
}

const posInt = (x: unknown): number | null => (typeof x === 'number' && Number.isInteger(x) && x > 0 ? x : null);

function entryOf(x: unknown): Entry | null {
  if (!isObj(x)) return null;
  const n = posInt(x.n);
  const ts = str(x.ts) && x.ts ? x.ts : null;
  const point = oneOf(DECISION_POINTS, x.point);
  const what = text(x.what, SHORT);
  const chosen = text(x.chosen, SHORT);
  return n && ts && point && what && chosen ? { n, point, what, chosen, ts } : null;
}

/** A stored decisions.json, or null when any required field is missing or wrong. */
export function normalizeDecisionsDoc(x: unknown): DecisionsDoc | null {
  if (!isObj(x)) return null;
  const ts = str(x.ts) && x.ts ? x.ts : null;
  const scope = text(x.scope, 120);
  const count = typeof x.count === 'number' && Number.isInteger(x.count) && x.count >= 0 ? x.count : null;
  const autonomy = x.autonomy === 'auto' || x.autonomy === 'unattended' ? x.autonomy : null;
  if (!ts || !scope || count === null || !autonomy) return null;
  const last: DecisionsDoc['last'] = [];
  for (const e of Array.isArray(x.last) ? x.last : []) {
    const entry = entryOf(e);
    if (entry && isObj(e)) last.push({ ...entry, weight: e.weight === 'major' ? 'major' : 'minor' });
  }
  return { ts, scope, count, autonomy, last: last.slice(-LAST_MAX), lastMajor: entryOf(x.lastMajor) };
}

export interface DecisionsSummary { count: number; autonomy: 'auto' | 'unattended'; lastMajor: string | null }

/** What lens and the band show: null when the text is missing, oversized or invalid, has no decision, or is older than a day. */
export function decisionsSummary(text: string | undefined, now: number): DecisionsSummary | null {
  if (typeof text !== 'string' || text.length > DECISIONS_MAX) return null;
  let doc: DecisionsDoc | null;
  try { doc = normalizeDecisionsDoc(JSON.parse(text)); } catch { return null; }
  if (!doc || doc.count < 1) return null;
  const t = Date.parse(doc.ts);
  if (!Number.isFinite(t) || !Number.isFinite(now) || now - t > DECISIONS_WINDOW_MS || t - now > FUTURE_SKEW_MS) return null;
  return { count: doc.count, autonomy: doc.autonomy, lastMajor: doc.lastMajor?.what ?? null };
}
