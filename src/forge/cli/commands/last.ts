import type { Command } from '../context.js';
import { readEvents, type LedgerKind, type LedgerEvent } from '../../ledger.js';
import { executionHolding, eventsSince } from '../../execution.js';
import { UsageError } from '../errors.js';
import { baseOf, eventsOf, isTask, resolveProject } from '../../task-ref.js';
import { deviationsOf, sinceLastTriage } from '../../deviation.js';

export const command: Command = (args, ctx) => {
  const { io, flag, json } = ctx;
  const task = flag('task');
  if (!task) throw new UsageError('last: --task is required');
  const ledger = readEvents(io.cwd);
  const project = resolveProject({ flag: flag('project'), task, events: ledger });
  const all = eventsOf(ledger, { project, task });
  const events = all.filter(e => isTask(e, task));
  const lastOf = (kind: LedgerKind, from: readonly LedgerEvent[] = events) => [...from].reverse().find(e => e.kind === kind);
  // R3 (M3): a new execution of the plan task reviews in the same round folders: its verdict and round are only
  // its own (as review-prep and roundDecision count them), never an earlier run's on the same `dir`.
  const own = eventsSince(events, executionHolding(io.cwd, { project, task: baseOf(task) })?.startedAt ?? null);
  return json({
    task,
    path: lastOf('triage')?.path ?? null,
    phase: lastOf('phase') ?? null,
    verdict: lastOf('verdict', own) ?? null,
    round: lastOf('round', own) ?? null,
    events: events.length,
    // Whether the task runs in auto mode: its last fresh triage (a ratchet logged by the session carries none).
    autonomy: [...events].reverse().find(e => e.kind === 'triage' && Array.isArray(e.reasons))?.autonomy === 'auto' ? 'auto' : null,
    // FX1: the implementers of this run of the task (from its last triage) that were not the ones forge named, for the
    // report that closes it.
    deviations: deviationsOf(sinceLastTriage(eventsSince(all, executionHolding(io.cwd, { project, task: baseOf(task) })?.startedAt ?? null), task)),
  });
};
