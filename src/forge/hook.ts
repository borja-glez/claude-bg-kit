import { stopReason, endRun, type RunState, type StopContext } from './run.js';

import { swarmLive, type SwarmState } from '../lib/swarm-state.js';

export interface HookContext extends StopContext { ledgerEvents: number; swarmSleeping?: boolean }

export const swarmBlockReason = (live: number, parallel: number): string =>
  `forge swarm is active (${live}/${parallel} slots). Run the next swarm tick as /forge:run's Swarm section describes; to end it run /forge:stop.`;
export const swarmEndedReason = (reason: string): string =>
  `the forge swarm ended (${reason}): report it as /forge:run's Swarm section says (step 7), then stop`;

/**
 * The Stop hook's decision for a swarm coordinator. It binds to the first session it blocks (hookSession) and leaves
 * every other session alone. It never blocks while the coordinator sleeps (sleepUntil in the future): the background
 * `swarm sleep` wakes it. With stop_hook_active it blocks again only after a new tick, so a turn without a tick
 * cannot loop. The stop file ends the swarm with one last block to report.
 */
export function decideSwarmStop(input: { stop_hook_active?: boolean; session_id?: unknown }, swarm: SwarmState | null, ctx: { now: Date; stopFile: boolean }):
  { block: false; swarm: SwarmState | null } | { block: true; reason: string; swarm: SwarmState; ended?: string } {
  if (!swarm || !swarm.active) return { block: false, swarm };
  const session = typeof input.session_id === 'string' && input.session_id ? input.session_id : null;
  if (swarm.hookSession !== null && session !== swarm.hookSession) return { block: false, swarm };
  const hookSession = swarm.hookSession ?? session;
  if (ctx.stopFile) {
    const ended: SwarmState = { ...swarm, active: false, stopReason: 'stopped', sleepUntil: null, hookSession };
    return { block: true, reason: swarmEndedReason('stopped'), ended: 'stopped', swarm: ended };
  }
  const until = swarm.sleepUntil ? Date.parse(swarm.sleepUntil) : NaN;
  if (Number.isFinite(until) && until > ctx.now.getTime()) return { block: false, swarm };
  if (input.stop_hook_active === true && swarm.lastTickAt === swarm.lastBlockTick) return { block: false, swarm };
  return { block: true, reason: swarmBlockReason(swarmLive(swarm), swarm.parallel), swarm: { ...swarm, hookSession, lastBlockTick: swarm.lastTickAt } };
}

const hhmm = (d: Date) => d.toISOString().slice(11, 16);

function blockReason(run: RunState): string {
  const parts: string[] = [];
  parts.push(run.budget.cycles !== undefined ? `cycle ${run.cycle + 1} of ${run.budget.cycles}` : `cycle ${run.cycle + 1}`);
  if (run.budget.hours !== undefined) parts.push(`until ${hhmm(new Date(Date.parse(run.startedAt) + run.budget.hours * 3600_000))} UTC`);
  return `forge infinite mode is active (${parts.join(' / ')}). Run the next cycle as /forge:infinite describes; to end the run create .forge/stop or run /forge:stop.`;
}

/** The one-time block that tells the bound session to close the run it just ended. */
export const endedReason = (reason: string): string =>
  `the forge infinite run ended (${reason}): do step 4 of /forge:infinite (turn off meta/infinite and report), then stop`;

/**
 * The Stop hook's decision. An inactive run (or none) never blocks. A run is bound to one session (on its first
 * block, or up front): a hook call from any other session, or without a session id, is left alone. When a stop
 * reason first appears, the run is marked inactive and the session is blocked once to close it (`ended` holds the
 * reason). Otherwise it blocks; with stop_hook_active it blocks again only when the ledger grew since the last
 * block, so a cycle that records nothing cannot loop. Each block counts toward blocksSinceCycle.
 */
export function decideStop(input: { stop_hook_active?: boolean; session_id?: unknown }, run: RunState | null, ctx: HookContext):
  { block: false; run: RunState | null } | { block: true; reason: string; run: RunState; ended?: string } {
  if (!run || !run.active) return { block: false, run };
  const session = typeof input.session_id === 'string' && input.session_id ? input.session_id : null;
  if (run.sessionId !== null && session !== run.sessionId) return { block: false, run };
  // A sleeping swarm wakes itself from its background `swarm sleep`; a block now would start a cycle with nothing to do.
  if (ctx.swarmSleeping) return { block: false, run };
  const sessionId = run.sessionId ?? session;
  const reason = stopReason(run, ctx);
  if (reason) return { block: true, reason: endedReason(reason), ended: reason, run: { ...endRun(run, reason), lastBlockEvents: ctx.ledgerEvents, sessionId } };
  if (input.stop_hook_active === true && ctx.ledgerEvents === run.lastBlockEvents) return { block: false, run };
  return { block: true, reason: blockReason(run), run: { ...run, lastBlockEvents: ctx.ledgerEvents, sessionId, blocksSinceCycle: run.blocksSinceCycle + 1 } };
}
