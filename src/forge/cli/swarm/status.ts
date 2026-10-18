import type { SwarmCommand } from './context.js';
import { readEvents } from '../../ledger.js';
import { readExecution } from '../../execution.js';
import { UNBOUND_WARNING } from '../../hook.js';
import { isSafeId, type ExecutionState } from '../../../lib/execution-state.js';
import { mainCheckout } from '../../local.js';
import { readWorkDir, workDir, workRel } from '../../task-ref.js';
import { runDocOf } from '../../run-doc.js';
import { boundLiveness, releaseWrites, openTasks } from './shared.js';

/**
 * D-08: each task's work folder, relative to the main checkout, as `swarm status` prints it (`work`): the project's
 * folder, or the older .forge/work/<T> of a task an earlier version started there (readWorkDir). The skills read <WORK>
 * from it where no other output gave it (a resumed or closing coordinator), never rebuilding it by hand.
 */
function tasksWork(main: string, e: ExecutionState): Record<string, string> {
  const ids = Object.keys(e.tasks).filter(isSafeId);
  if (!ids.length) return {};
  const events = readEvents(main);
  const project = e.kind === 'plan' ? e.project : null;
  return Object.fromEntries(ids.map(task => {
    const ref = { project, task };
    return [task, readWorkDir(main, ref, events) === workDir(main, ref) ? workRel(ref) : workRel({ project: null, task })];
  }));
}

export const subcommand: SwarmCommand = (rest, ctx) => {
  const { io, json, now } = ctx;
  // K2-01: the execution of the main checkout, from any worktree.
  const main = mainCheckout(io.cwd);
  const state = readExecution(main);
  // §4.6: an active execution that no session drives (forge 0.15 left it unbound) says so.
  const unbound = !!state?.active && state.hookSession === null;
  // Final review 1: the Claude session bound to a run that is not closed, and how alive it is judged as if the run
  // were active, so /forge:run --resume leaves an ended run to a coordinator still on it.
  const coordinator = state && !state.closedAt ? { hookSession: state.hookSession, liveness: boundLiveness(main, { ...state, active: true }, now.getTime()) } : null;
  return json({
    present: state !== null, state, ...(state ? { work: tasksWork(main, state) } : {}), ...(coordinator ? { coordinator } : {}),
    ...(unbound ? { unbound: true, warning: UNBOUND_WARNING } : {}),
    // J-15: meta/run as the roadmap takes it, built by the CLI; carry 10: once the run ended, the writes that free the
    // coordinator's tasks it left running or stopped.
    publish: state ? { run: runDocOf(main, state), ...(!state.active ? { release: releaseWrites(state, openTasks(state)) } : {}) } : null,
  });
};
