// The infinite run's state, kept in .forge/run.json. Pure, so both the forge CLI and the lens mod bundle it.

export interface RunState {
  mode: 'infinite'; active: boolean; startedAt: string;
  budget: { cycles?: number; hours?: number }; cycle: number;
  noProgress: number;                 // consecutive cycles without progress
  lastError: string | null; repeatedError: boolean;
  lastBlockEvents: number | null;     // ledger event count at the last block
  stoppedReason?: string; queueMax: number;   // default 10
  sessionId: string | null;           // Claude's id of the session the run is bound to, set by infinite start (null in a run started by forge 0.15)
  blocksSinceCycle: number;           // Stop-hook blocks since the last cycle was recorded (0 when absent in older files)
  locale?: string;                    // the language the person writes in (infinite start --locale); absent when unknown
  autonomous?: AutonomousRun;         // 6b: present only in an autonomous run; written by infinite start --profile, read and validated here
  explore?: { rounds: number; dry: number };  // 6b-3: the exploration rounds (cycle --explore) and how many in a row passed nothing
  saturation?: SaturationReport | null;       // 6b-3: the last report, once `dry` reached SATURATION_ROUNDS; null below it
}

/** 6b-3: what keeps an autonomous run from being saturated. `inputs`: an input of the report is missing, unreadable or stale. */
export const SATURATION_BLOCKING = ['rounds', 'pending-tasks', 'validators', 'findings', 'defects', 'proposals', 'inputs'] as const;
export type SaturationBlocking = (typeof SATURATION_BLOCKING)[number];
/** 6b-3 M-10: the id lists of a report, each kept to SATURATION_LIST_MAX ids, with its full length in `counts`. */
export const SATURATION_LISTS = [
  'pendingTasks', 'validatorsFailed', 'openDefects', 'openProposals', 'parked', 'waitsOwner', 'unowned', 'blockedTasks', 'unplaced', 'orphanFindings',
] as const;
export type SaturationList = (typeof SATURATION_LISTS)[number];
export const SATURATION_LIST_MAX = 20;
/** 6b-3 L-10: the inputs of `FORGE cycle` a report can name as missing. */
export const SATURATION_INPUTS = ['--plan', '--db', '--validate'] as const;
export type SaturationInput = (typeof SATURATION_INPUTS)[number];

/**
 * 6b-3, spec «Parada por saturación»: why the run is or is not saturated, with its evidence. `saturated` is `blocking` empty.
 * `waiting` is listed apart and never blocks (spec: what waits for the person does not keep the run going): parked ideas,
 * open questions, blocked actions, deferred findings, the proposals that wait for the owner's mark and the approvals without
 * it (L-18), the plan's tasks blocked for the person and those that wait only on them, the approvals the run could not place
 * (fix 1, T6B3-SAT-WAITING), and the tasks the plan no longer has that kept open findings (information only). `missing`
 * (L-10) names the inputs the report lacked; what needs them is not computed.
 */
export interface SaturationReport {
  saturated: boolean; at: string; rounds: number; blocking: SaturationBlocking[];
  evidence: { pendingTasks: string[]; validatorsFailed: string[]; openFindings: number; openDefects: string[]; openProposals: string[] };
  waiting: {
    parked: string[]; questions: number; blocked: number; deferred: number; waitsOwner: string[]; unowned: string[];
    blockedTasks: string[]; unplaced: string[]; orphanFindings: string[];
  };
  counts: Record<SaturationList, number>;
  missing?: SaturationInput[];
}

export const PROFILES = ['spike', 'product'] as const;
export type Profile = (typeof PROFILES)[number];
/** The name of an autonomous run: lowercase words joined by single hyphens, 40 characters at most (no `--`, no trailing `-`). */
export const AUTONOMOUS_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_AUTONOMOUS_NAME = 40;
/** M-5: a name AUTONOMOUS_NAME takes, of 40 characters at most: the one check of prepare, start and the block parseRun reads. */
export const isAutonomousName = (x: unknown): x is string => typeof x === 'string' && x.length <= MAX_AUTONOMOUS_NAME && AUTONOMOUS_NAME.test(x);

/** The autonomous run's identity: its worktree and branch, and the branches it must never touch. */
export interface AutonomousRun {
  profile: Profile; name: string; runId: string; worktree: string; branch: string; startBranch: string; protectedBranches: string[];
}

// Later tasks hand these to git: no leading `-` (an option), no whitespace, no control character.
const isBranchName = (x: unknown): x is string => typeof x === 'string' && x !== '' && !x.includes('..') && !x.startsWith('-') && !/[\s\u0000-\u001f\u007f]/.test(x);
const isAbsolutePath = (x: unknown): x is string => typeof x === 'string' && /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(x);

/** The seven fields of an autonomous block, or null when it does not hold together. Other fields are ignored (L6), so a
 *  later plan's field never makes an older bundle lose the run. */
function autonomousOf(x: unknown): AutonomousRun | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const a = x as Record<string, unknown>;
  if (!PROFILES.includes(a.profile as Profile)) return null;
  const profile = a.profile as Profile;
  if (!isAutonomousName(a.name)) return null;
  const runId = `${profile}-${a.name}`;
  if (a.runId !== runId || a.branch !== `forge/${runId}` || !isAbsolutePath(a.worktree) || !isBranchName(a.startBranch)) return null;
  const pb = a.protectedBranches;
  if (!Array.isArray(pb) || pb.length < 1 || pb.length > 10 || !pb.every(isBranchName)) return null;
  return { profile, name: a.name, runId, worktree: a.worktree, branch: a.branch, startBranch: a.startBranch, protectedBranches: [...pb] };
}

/** A language code as `--locale` takes it: es, en, pt-BR, zh_Hant… */
export const LOCALE = /^[a-z]{2,3}([-_][A-Za-z0-9]{2,8})?$/;
export const isLocale = (x: unknown): x is string => typeof x === 'string' && LOCALE.test(x);

const isCount = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0;
const isPositiveInt = (x: unknown): x is number => isCount(x) && x > 0;
const isPositive = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0;
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/** The explore counts, or null unless both are counts and the dry rounds are some of the rounds. */
function exploreOf(x: unknown): RunState['explore'] | null {
  if (!isObj(x) || !isCount(x.rounds) || !isCount(x.dry) || x.dry > x.rounds) return null;
  return { rounds: x.rounds, dry: x.dry };
}

// An id of a report's list: a task, a proposal, a validator's name; one line of at most 80 code points, with no C0, DEL, C1
// or bidi control. Built from code points, so this file holds none of them.
const cp = (n: number) => String.fromCharCode(n);
const REPORT_ID = new RegExp(`^[^${cp(0)}-${cp(0x1f)}${cp(0x7f)}-${cp(0x9f)}${cp(0x202a)}-${cp(0x202e)}${cp(0x2066)}-${cp(0x2069)}]{1,80}$`, 'u');
const idList = (x: unknown): x is string[] =>
  Array.isArray(x) && x.length <= SATURATION_LIST_MAX && x.every(v => typeof v === 'string' && REPORT_ID.test(v));
const oneOf = <T extends string>(list: readonly T[], x: unknown): x is T => typeof x === 'string' && (list as readonly string[]).includes(x);

/** 6b-3: a saturation report, or null unless every field reads: `saturated` agrees with `blocking`, each list holds at most
 *  SATURATION_LIST_MAX ids and its count is at least that many (M-10). Other fields are ignored. */
function saturationReportOf(x: unknown): SaturationReport | null {
  if (!isObj(x)) return null;
  const { saturated, at, rounds, blocking, evidence: e, waiting: w, counts: c, missing } = x;
  if (typeof saturated !== 'boolean' || typeof at !== 'string' || !at || at.length > 64 || !isCount(rounds)) return null;
  if (!Array.isArray(blocking) || !blocking.every(b => oneOf(SATURATION_BLOCKING, b)) || new Set(blocking).size !== blocking.length) return null;
  if (saturated !== (blocking.length === 0) || !isObj(e) || !isObj(w) || !isObj(c)) return null;
  if (!isCount(e.openFindings) || !isCount(w.questions) || !isCount(w.blocked) || !isCount(w.deferred)) return null;
  const lists: Record<SaturationList, unknown> = {
    pendingTasks: e.pendingTasks, validatorsFailed: e.validatorsFailed, openDefects: e.openDefects, openProposals: e.openProposals,
    parked: w.parked, waitsOwner: w.waitsOwner, unowned: w.unowned, blockedTasks: w.blockedTasks, unplaced: w.unplaced, orphanFindings: w.orphanFindings,
  };
  const counts = {} as Record<SaturationList, number>;
  for (const k of SATURATION_LISTS) {
    const list = lists[k];
    const n = c[k];
    if (!idList(list) || !isCount(n) || n < list.length) return null;
    counts[k] = n;
  }
  if (missing !== undefined && !(Array.isArray(missing) && missing.length && missing.every(m => oneOf(SATURATION_INPUTS, m)))) return null;
  const ids = (k: SaturationList) => [...(lists[k] as string[])];
  return {
    saturated, at, rounds, blocking: [...blocking] as SaturationBlocking[],
    evidence: { pendingTasks: ids('pendingTasks'), validatorsFailed: ids('validatorsFailed'), openFindings: e.openFindings, openDefects: ids('openDefects'), openProposals: ids('openProposals') },
    waiting: {
      parked: ids('parked'), questions: w.questions, blocked: w.blocked, deferred: w.deferred, waitsOwner: ids('waitsOwner'), unowned: ids('unowned'),
      blockedTasks: ids('blockedTasks'), unplaced: ids('unplaced'), orphanFindings: ids('orphanFindings'),
    },
    counts,
    ...(missing !== undefined ? { missing: [...missing] as SaturationInput[] } : {}),
  };
}

/** null when absent or invalid (bad JSON, missing fields, wrong types, non-positive budget); never throws. */
export function parseRun(text: string | null): RunState | null {
  if (text === null) return null;
  let o: Record<string, unknown>;
  try {
    const x = JSON.parse(text);
    if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
    o = x as Record<string, unknown>;
  } catch { return null; }
  if (o.mode !== 'infinite' || typeof o.active !== 'boolean' || typeof o.repeatedError !== 'boolean') return null;
  if (typeof o.startedAt !== 'string' || Number.isNaN(Date.parse(o.startedAt))) return null;
  if (!isCount(o.cycle) || !isCount(o.noProgress) || !isPositiveInt(o.queueMax)) return null;
  if (o.lastError !== null && typeof o.lastError !== 'string') return null;
  if (o.lastBlockEvents !== null && !isCount(o.lastBlockEvents)) return null;
  if (o.stoppedReason !== undefined && typeof o.stoppedReason !== 'string') return null;
  if (o.sessionId !== null && (typeof o.sessionId !== 'string' || !o.sessionId)) return null;
  if (o.blocksSinceCycle !== undefined && !isCount(o.blocksSinceCycle)) return null;
  // A block that is present and does not hold together invalidates the whole run: a guard must not read half an identity.
  const autonomous = o.autonomous === undefined ? undefined : autonomousOf(o.autonomous);
  if (autonomous === null) return null;
  const b = o.budget;
  if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
  const { cycles, hours } = b as Record<string, unknown>;
  if (cycles !== undefined && !isPositiveInt(cycles)) return null;
  if (hours !== undefined && !isPositive(hours)) return null;
  const run: RunState = {
    mode: 'infinite', active: o.active, startedAt: o.startedAt,
    budget: { ...(cycles !== undefined ? { cycles } : {}), ...(hours !== undefined ? { hours } : {}) },
    cycle: o.cycle, noProgress: o.noProgress, lastError: o.lastError as string | null, repeatedError: o.repeatedError,
    lastBlockEvents: o.lastBlockEvents as number | null, queueMax: o.queueMax, sessionId: o.sessionId as string | null,
    blocksSinceCycle: (o.blocksSinceCycle as number | undefined) ?? 0,
  };
  if (o.stoppedReason !== undefined) run.stoppedReason = o.stoppedReason as string;
  // An invalid locale is dropped, never the run: older run.json files have none.
  if (isLocale(o.locale)) run.locale = o.locale;
  if (autonomous) run.autonomous = autonomous;
  // 6b-3: kept only when they read; one that does not is dropped, never the run (a dropped report is no saturation).
  const explore = exploreOf(o.explore);
  if (explore) run.explore = explore;
  if (o.saturation === null) run.saturation = null;
  else {
    const saturation = saturationReportOf(o.saturation);
    if (saturation) run.saturation = saturation;
  }
  return run;
}
