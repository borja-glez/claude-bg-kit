import { stopReason, endRun, type RunState, type StopContext } from './run.js';

import { LEASE_MINUTES } from '../lib/coordination.js';
import type { ExecutionState } from '../lib/execution-state.js';

export interface HookContext extends StopContext { ledgerEvents: number; swarmSleeping?: boolean }

export const executionBlockReason = (running: number, parallel: number): string =>
  `forge execution is active (${running}/${parallel} running). Step it as /forge:run's Execution section describes; to end it run /forge:stop.`;
export const executionEndedReason = (reason: string): string =>
  `the forge execution ended (${reason}): report it as /forge:run's Execution section says (step 7), then stop.`;

/**
 * An active execution whose hookSession is still unbound, bound to this session; anything else unchanged. A bound
 * hookSession is never rebound.
 */
export function bindHookSession(e: ExecutionState | null, session: unknown): ExecutionState | null {
  if (!e || !e.active || e.hookSession !== null || typeof session !== 'string' || !session) return e;
  return { ...e, hookSession: session };
}

/**
 * The Stop hook's decision for an execution's coordinator. It binds to the first session that stops while it is
 * unbound (blocked or not: the returned exec carries the binding) and leaves the others alone. It never blocks while
 * the coordinator sleeps, nor while an agent of a task is running: that agent's return wakes the session, so a block
 * would only add a turn (and fight a /goal evaluator). With stop_hook_active it blocks again only after a new step.
 */
export function decideExecutionStop(input: { stop_hook_active?: boolean; session_id?: unknown }, exec: ExecutionState | null, ctx: { now: Date; stopFile: boolean }):
  { block: false; exec: ExecutionState | null } | { block: true; reason: string; exec: ExecutionState; ended?: string } {
  if (!exec || !exec.active) return { block: false, exec };
  const session = typeof input.session_id === 'string' && input.session_id ? input.session_id : null;
  if (exec.hookSession !== null && session !== exec.hookSession) return { block: false, exec };
  const e = bindHookSession(exec, session) as ExecutionState;
  const hookSession = e.hookSession;
  if (ctx.stopFile) {
    const ended: ExecutionState = { ...e, active: false, stopReason: 'stopped', sleepUntil: null, hookSession };
    return { block: true, reason: executionEndedReason('stopped'), ended: 'stopped', exec: ended };
  }
  const now = ctx.now.getTime();
  const until = e.sleepUntil ? Date.parse(e.sleepUntil) : NaN;
  if (Number.isFinite(until) && until > now) return { block: false, exec: e };
  const agentRunning = Object.values(e.tasks).some(t => t.status === 'running' && !!t.agent && now - Date.parse(t.updatedAt) < LEASE_MINUTES * 60000);
  if (agentRunning) return { block: false, exec: e };
  if (input.stop_hook_active === true && e.lastStepAt === e.lastBlockStep) return { block: false, exec: e };
  const running = Object.values(e.tasks).filter(t => t.status === 'running').length;
  return { block: true, reason: executionBlockReason(running, e.parallel), exec: { ...e, hookSession, lastBlockStep: e.lastStepAt } };
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
  `the forge infinite run ended (${reason}): do step 4 of /forge:infinite (turn off meta/infinite and report), then stop.`;

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
