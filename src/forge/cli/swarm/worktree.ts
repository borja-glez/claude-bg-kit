import type { SwarmCommand } from './context.js';
import { UsageError } from '../errors.js';
import type { ExecTask } from '../../../lib/execution-state.js';
import { workRel } from '../../task-ref.js';
import { addTaskWorktree } from './shared.js';
import { taskBranchOf } from '../../execution.js';

export const subcommand: SwarmCommand = (rest, ctx) => {
  const { io, deps, has, json, iso, current, notEnded, update, taskArg, memberCtx } = ctx;
  if (has('member')) {
    // A member gets its task worktree in the main checkout; execution.json stays the coordinator's.
    const task = taskArg();
    const { main, e, session, m } = memberCtx(true);
    if (m!.role === 'executor' && m!.task !== task) throw new UsageError(`swarm worktree: ${session} executes ${m!.task}, not ${task}`);
    return json({ ...addTaskWorktree(deps, main, task, e.branch, e.project, taskBranchOf(e, task)), work: workRel({ project: e.project, task }) });
  }
  const task = taskArg();
  const e = notEnded(current());
  // Final review 7: a plan run's project, which no other plan's leftover task branch may pass for; an ephemeral run has none.
  const added = addTaskWorktree(deps, io.cwd, task, e.branch, e.kind === 'plan' ? e.project : null, taskBranchOf(e, task));
  const { worktree: dir, branch } = added;
  const t: ExecTask = e.tasks[task] ?? { status: 'running', stage: 'brief', round: 0, worktree: dir, branch, executor: e.mode, attempts: 0, agent: null,
    startedAt: iso, stageSince: iso, updatedAt: iso, detail: null };
  update(cur => cur && { ...notEnded(cur), tasks: { ...cur.tasks, [task]: { ...(cur.tasks[task] ?? t), worktree: dir, branch, updatedAt: iso } } });
  return json({ ...added, work: workRel({ project: e.kind === 'plan' ? e.project : null, task }) });
};
