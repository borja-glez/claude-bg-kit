import type { SwarmCommand } from './context.js';
import { readEvents } from '../../ledger.js';
import { readExecution } from '../../execution.js';
import { UNBOUND_WARNING } from '../../hook.js';
import { isSafeId, type ExecutionState } from '../../../lib/execution-state.js';
import { mainCheckout } from '../../local.js';
import { readWorkDir, workDir, workRel } from '../../task-ref.js';
import { gitRun, predictMerge, type MergePrediction } from '../../merge-predict.js';
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

/**
 * A3: what would conflict, before anyone integrates. Each accepted task's branch against the run branch, and (in a plan
 * run) the run branch against its base; an ephemeral run has no base to merge into (merge null). It touches no
 * checkout: git merge-tree writes objects, not files. With a Git older than 2.38 (no merge-tree --write-tree) every
 * prediction comes out unverified.
 */
function predictionsOf(main: string, e: ExecutionState): { merge: MergePrediction | null; tasks: Record<string, MergePrediction> } {
  const run = gitRun(main);
  const accepted = Object.entries(e.tasks).filter(([, t]) => t.status === 'accepted');
  return {
    merge: e.kind === 'plan' ? predictMerge(run, e.base, e.branch) : null,
    // An ephemeral run's branch is its base (swarm start sets it so): its tasks are predicted against the branch they integrate into.
    tasks: Object.fromEntries(accepted.map(([id, t]) => [id, predictMerge(run, e.branch, t.branch)])),
  };
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
    ...(state && !state.closedAt ? { predicted: predictionsOf(main, state) } : {}),
    // J-15: meta/run as the roadmap takes it, built by the CLI; carry 10: once the run ended, the writes that free the
    // coordinator's tasks it left running or stopped.
    publish: state ? { run: runDocOf(main, state), ...(!state.active ? { release: releaseWrites(state, openTasks(state)) } : {}) } : null,
  });
};
