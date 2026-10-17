// G-08 (wave 4): meta/infinite as the roadmap takes it, built by the CLI (infinite start, cycle, infinite status), with
// the session that drives the run and the lease the page reads its liveness from. No skill composes meta/infinite.
import { readExecution } from './execution.js';
import { readEvents } from './ledger.js';
import { claudeBindings } from '../lib/bound-fs.js';
import { bindingLive } from '../lib/bound.js';
import { LEASE_CAP_MINUTES, LEASE_MINUTES } from '../lib/coordination.js';
import { cleanText } from '../lib/batches.js';
import { isSafeId } from '../lib/execution-state.js';
import type { RunState } from '../lib/forge-run.js';
import type { InfiniteDoc } from '../lib/types.js';

/** The coordinator's lease is LEASE_MINUTES at least, or the expected sleep plus this margin. */
export const INFINITE_SLEEP_MARGIN_MIN = 5;

/** The waypoint seat bound to Claude's session `claude` in the main checkout (any project of it): of its live bindings
 *  (not ended, lease running, pid alive as the hooks settle it) the one renewed last, as the mod's ownSeat picks it;
 *  null when none. */
export function seatOf(main: string, claude: string, now: number, alive?: (pid: number) => boolean): string | null {
  const live = claudeBindings(main, claude, now, alive).filter(b => !b.endedAt && bindingLive(b, now));
  return live.sort((a, b) => Date.parse(b.seenAt) - Date.parse(a.seenAt))[0]?.sid ?? null;
}

/** meta/infinite: the run's own fields, why it stopped once inactive, and its coordinator with a lease past the expected sleep. */
export function infiniteDocOf(run: RunState, o: { now: Date; sid: string | null; sleepUntil: string | null; lastCycleAt: string | null }): InfiniteDoc {
  const t = o.now.getTime();
  const sleep = o.sleepUntil ? Date.parse(o.sleepUntil) - t : NaN;
  // Carry 4: never past LEASE_CAP_MINUTES, whatever sleep the execution claims.
  const ms = Math.min(LEASE_CAP_MINUTES * 60_000, Math.max(LEASE_MINUTES * 60_000, Number.isFinite(sleep) && sleep > 0 ? sleep + INFINITE_SLEEP_MARGIN_MIN * 60_000 : 0));
  // A run forge 0.15 started has no session: no coordinator, and the page draws the pill as before.
  const coordinator = run.sessionId && isSafeId(run.sessionId)
    ? { sid: o.sid, claude: run.sessionId, seenAt: o.now.toISOString(), leaseUntil: new Date(t + ms).toISOString() }
    : null;
  // Carry 4: the stop reason as one clean line (it is the run's own text, but the page reads it as untrusted).
  const stopReason = run.active ? null : cleanText(run.stoppedReason ?? '', 80) || null;
  return {
    active: run.active, cycle: run.cycle, budget: run.budget, startedAt: run.startedAt, lastCycleAt: o.lastCycleAt,
    coordinator, stopReason,
  };
}

/** G-08: meta/infinite of `run`, read from the main checkout: the coordinator's seat, the sleep of an active execution, the last cycle. */
export function infinitePublish(main: string, run: RunState, now: Date): InfiniteDoc {
  const exec = readExecution(main);
  const lastCycleAt = readEvents(main).filter(e => e.kind === 'cycle' && typeof e.cycle === 'number' && e.ts >= run.startedAt).at(-1)?.ts ?? null;
  return infiniteDocOf(run, {
    now, sid: run.sessionId ? seatOf(main, run.sessionId, now.getTime()) : null,
    sleepUntil: exec?.active ? exec.sleepUntil : null, lastCycleAt,
  });
}
