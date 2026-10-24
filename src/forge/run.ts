import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { forgeDir } from './ledger.js';
import { parseRun, type RunState } from '../lib/forge-run.js';
import { clean } from '../lib/decisions.js';

export { parseRun, type RunState };

export interface StopContext { now: Date; stopFile: boolean; approvedPending: number; pendingProposals: number }

export const DEFAULT_QUEUE_MAX = 10;
export const NO_PROGRESS_LIMIT = 3;
export const NO_CYCLE_BLOCKS = 2;
/** 6b-3 N-2: the stored error is one clean line of at most this many code points, so run.json, with a full saturation report,
 *  stays within the 16 KiB lens reads (an error of control characters would otherwise grow six times in its JSON). */
const MAX_ERROR = 1000;

export function startRun(now: Date, budget: RunState['budget'], queueMax = DEFAULT_QUEUE_MAX, sessionId: string | null = null, locale: string | null = null): RunState {
  return {
    mode: 'infinite', active: true, startedAt: now.toISOString(),
    budget: { ...(budget.cycles !== undefined ? { cycles: budget.cycles } : {}), ...(budget.hours !== undefined ? { hours: budget.hours } : {}) },
    cycle: 0, noProgress: 0, lastError: null, repeatedError: false, lastBlockEvents: null, queueMax, sessionId, blocksSinceCycle: 0,
    ...(locale ? { locale } : {}),
  };
}

export function recordCycle(run: RunState, result: { progress: boolean; error?: string }): RunState {
  const error = clean(result.error ?? '', MAX_ERROR) || null;
  return {
    ...run,
    cycle: run.cycle + 1,
    noProgress: result.progress ? 0 : run.noProgress + 1,
    lastError: error,
    repeatedError: error !== null && error === run.lastError,
    blocksSinceCycle: 0,
  };
}

/** 6b-3: one more exploration round (cycle --explore): `dry` counts the rounds in a row that passed nothing. */
export function recordExplore(run: RunState, passed: number): RunState {
  const prev = run.explore ?? { rounds: 0, dry: 0 };
  return { ...run, explore: { rounds: prev.rounds + 1, dry: passed > 0 ? 0 : prev.dry + 1 } };
}

export function stopReason(run: RunState, ctx: StopContext): string | null {
  if (ctx.stopFile) return 'stop-file';
  if (run.budget.cycles !== undefined && run.cycle >= run.budget.cycles) return 'budget-cycles';
  if (run.budget.hours !== undefined && ctx.now.getTime() - Date.parse(run.startedAt) >= run.budget.hours * 3600_000) return 'budget-hours';
  // 6b-3: an autonomous run whose last exploration rounds found nothing left (cycle --explore's report).
  if (run.autonomous && run.saturation?.saturated === true) return 'saturated';
  if (run.noProgress >= NO_PROGRESS_LIMIT) return 'no-progress';
  if (run.repeatedError) return 'repeated-error';
  if (run.blocksSinceCycle >= NO_CYCLE_BLOCKS) return 'no-cycle';
  if (ctx.approvedPending === 0 && ctx.pendingProposals >= run.queueMax) return 'queue-full';
  return null;
}

/** The run marked inactive with its reason. */
export const endRun = (run: RunState, reason: string): RunState => ({ ...run, active: false, stoppedReason: reason });

export const runFile = (root: string) => path.join(root, '.forge', 'run.json');
export const stopFile = (root: string) => path.join(root, '.forge', 'stop');

/** The raw run.json text, or null when there is none (or it cannot be read). */
export function readRunText(root: string): string | null {
  const file = runFile(root);
  if (!existsSync(file)) return null;
  try { return readFileSync(file, 'utf8'); } catch { return null; }
}

export function saveRun(root: string, run: RunState): void {
  forgeDir(root);
  const file = runFile(root);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(run, null, 2) + '\n');
    renameSync(tmp, file);
  } finally { rmSync(tmp, { force: true }); }
}
