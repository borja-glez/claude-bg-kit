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
}

/** A language code as `--locale` takes it: es, en, pt-BR, zh_Hant… */
export const LOCALE = /^[a-z]{2,3}([-_][A-Za-z0-9]{2,8})?$/;
export const isLocale = (x: unknown): x is string => typeof x === 'string' && LOCALE.test(x);

const isCount = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0;
const isPositiveInt = (x: unknown): x is number => isCount(x) && x > 0;
const isPositive = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0;

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
  return run;
}
