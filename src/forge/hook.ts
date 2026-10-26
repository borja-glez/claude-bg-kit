import { stopReason, endRun, type RunState, type StopContext } from './run.js';

import { LEASE_CAP_MINUTES, LEASE_MINUTES } from '../lib/coordination.js';
import type { ExecutionState } from '../lib/execution-state.js';
import type { JobDoc } from './jobs.js';

export interface HookContext extends StopContext { ledgerEvents: number; swarmSleeping?: boolean }

export const executionBlockReason = (running: number, parallel: number): string =>
  `forge execution is active (${running}/${parallel} running). Step it as /forge:run's Execution section describes; to end it run /forge:stop.`;
export const executionEndedReason = (reason: string): string =>
  `the forge execution ended (${reason}): report it as /forge:run's Execution section says (step 7), then stop.`;
/** §4.6: what swarm status and infinite status add when an active run has no session bound to drive it. */
export const UNBOUND_WARNING = 'no session is bound to it: run /forge:run --resume (or /forge:infinite) in the session that should drive it';

/**
 * The Stop hook's decision for an execution's coordinator. The execution is bound when it starts (`swarm start` or
 * `swarm takeover` with --hook-session, C1): an unbound one, from forge 0.15, blocks no session, and no other session
 * is ever blocked or bound here. It never blocks while the coordinator sleeps, while an agent of a task is running,
 * nor while a job of the session runs in the background (C-03): the agent's return or the job's end wakes the session,
 * so a block would only add a turn (and fight a /goal evaluator). With stop_hook_active it blocks again only after a
 * new step.
 * D-15: an agent lives while its task's public lease runs (`leases`, set for its budget), at most LEASE_CAP_MINUTES after its last report.
 */
export function decideExecutionStop(input: { stop_hook_active?: boolean; session_id?: unknown }, exec: ExecutionState | null, ctx: { now: Date; stopFile: boolean; jobs: readonly JobDoc[]; leases?: Readonly<Record<string, string>> }):
  { block: false; exec: ExecutionState | null } | { block: true; reason: string; exec: ExecutionState; ended?: string } {
  if (!exec || !exec.active) return { block: false, exec };
  const session = typeof input.session_id === 'string' && input.session_id ? input.session_id : null;
  if (exec.hookSession === null || session !== exec.hookSession) return { block: false, exec };
  if (ctx.stopFile) {
    const ended: ExecutionState = { ...exec, active: false, stopReason: 'stopped', sleepUntil: null };
    return { block: true, reason: executionEndedReason('stopped'), ended: 'stopped', exec: ended };
  }
  const now = ctx.now.getTime();
  const until = exec.sleepUntil ? Date.parse(exec.sleepUntil) : NaN;
  if (Number.isFinite(until) && until > now) return { block: false, exec };
  // D-15: an agent of a running task lives while its task's public lease runs (the skill sets it for the agent's
  // budget), never more than LEASE_CAP_MINUTES after the task's last report; without a lease, LEASE_MINUTES after it.
  const agentRunning = Object.entries(exec.tasks).some(([id, t]) => {
    if (t.status !== 'running' || !t.agent) return false;
    const updated = Date.parse(t.updatedAt);
    if (!Number.isFinite(updated)) return false;
    const lease = Date.parse(ctx.leases?.[id] ?? '');
    return now < Math.min(Number.isFinite(lease) ? lease : updated + LEASE_MINUTES * 60000, updated + LEASE_CAP_MINUTES * 60000);
  });
  if (agentRunning) return { block: false, exec };
  if (ctx.jobs.length) return { block: false, exec };
  if (input.stop_hook_active === true && exec.lastStepAt === exec.lastBlockStep) return { block: false, exec };
  const running = Object.values(exec.tasks).filter(t => t.status === 'running').length;
  return { block: true, reason: executionBlockReason(running, exec.parallel), exec: { ...exec, lastBlockStep: exec.lastStepAt } };
}

const hhmm = (d: Date) => d.toISOString().slice(11, 16);

function blockReason(run: RunState): string {
  const parts: string[] = [];
  parts.push(run.budget.cycles !== undefined ? `cycle ${run.cycle + 1} of ${run.budget.cycles}` : `cycle ${run.cycle + 1}`);
  if (run.budget.hours !== undefined) parts.push(`until ${hhmm(new Date(Date.parse(run.startedAt) + run.budget.hours * 3600_000))} UTC`);
  // FX2: what the last cycle counted of the cap.
  const usd = run.budget.usd;
  if (usd !== undefined) {
    const c = run.cost;
    parts.push(!c ? `cap $${usd}` : c.usd === null ? `cap $${usd}, cost unknown` : `$${c.usd.toFixed(2)}${c.partial ? ' or more' : ''} of $${usd} spent`);
  }
  return `forge infinite mode is active (${parts.join(' / ')}). Run the next cycle as /forge:infinite describes; to end the run create .forge/stop or run /forge:stop.`;
}

/** The one-time block that tells the bound session to close the run it just ended. */
export const endedReason = (reason: string): string =>
  `the forge infinite run ended (${reason}): do step 4 of /forge:infinite (turn off meta/infinite and report), then stop.`;

/**
 * The Stop hook's decision. An inactive run (or none) never blocks. A run is bound to one session when it starts
 * (`infinite start --session`, or CLAUDE_CODE_SESSION_ID; C1): a hook call from any other session, without a session
 * id, or for a run without a session (one started by forge 0.15), is left alone and nothing is bound. When a stop
 * reason first appears, the run is marked inactive and the session is blocked once to close it (`ended` holds the
 * reason). Otherwise it blocks; with stop_hook_active it blocks again only when the ledger grew since the last block,
 * so a cycle that records nothing cannot loop. Each block counts toward blocksSinceCycle.
 */
export function decideStop(input: { stop_hook_active?: boolean; session_id?: unknown }, run: RunState | null, ctx: HookContext):
  { block: false; run: RunState | null } | { block: true; reason: string; run: RunState; ended?: string } {
  if (!run || !run.active) return { block: false, run };
  const session = typeof input.session_id === 'string' && input.session_id ? input.session_id : null;
  if (run.sessionId === null || session !== run.sessionId) return { block: false, run };
  // A sleeping swarm wakes itself from its background `swarm sleep`; a block now would start a cycle with nothing to do.
  if (ctx.swarmSleeping) return { block: false, run };
  const reason = stopReason(run, ctx);
  if (reason) return { block: true, reason: endedReason(reason), ended: reason, run: { ...endRun(run, reason), lastBlockEvents: ctx.ledgerEvents } };
  if (input.stop_hook_active === true && ctx.ledgerEvents === run.lastBlockEvents) return { block: false, run };
  return { block: true, reason: blockReason(run), run: { ...run, lastBlockEvents: ctx.ledgerEvents, blocksSinceCycle: run.blocksSinceCycle + 1 } };
}
