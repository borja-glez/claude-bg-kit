import type { SwarmCommand } from './context.js';
import { UsageError } from '../errors.js';
import { writePublicTask } from '../../execution.js';
import { LEASE_MINUTES } from '../../../lib/coordination.js';
import { clearEnded } from '../../live.js';
import type { ExecutionState, ExecTask } from '../../../lib/execution-state.js';
import { claudeSessionId } from '../../../lib/claude-session.js';
import { workRel } from '../../task-ref.js';
import { worktreeHolding, addTaskWorktree, boundLiveness, boundElsewhere } from './shared.js';

export const subcommand: SwarmCommand = (rest, ctx) => {
  const { io, deps, flag, has, json, ok, now, iso, current, notEnded, update, taskArg } = ctx;
  const task = taskArg();
  const e = current();
  const t = e.tasks[task];
  if (e.closedAt) throw new UsageError(`swarm retry: the execution ${e.runId} is closed; start a new one`);
  // K2-02: a stopped run moves no task (an integrate that ended in conflict after forge stop wakes its coordinator).
  notEnded(e);
  // Checked on the read above and again under the lock, on the task as it is then: a write that landed since is
  // kept, and a task no longer in that state is left alone (I-15). Only an execution still stalled then is revived.
  const revived = (x: ExecutionState) => !x.active && x.stopReason === 'stalled';
  // Final review 1: swarm start's rule, before anything moves. Reviving a stalled run from another Claude session
  // while its bound one may still step it (finishing it, or waiting on the person) leaves two sessions on it. The
  // coordinator's own retry (its conflict path) passes its own id; one back from /clear has an ended signal (the live
  // hook writes it at the SessionEnd of the bound session, R4). R5: checked on the read and again under the lock, on
  // the run as it is then, so one a tick stalled meanwhile is gated too.
  const hook = claudeSessionId(flag('hook-session'), io.env ?? process.env);
  const gate = (x: ExecutionState): void => {
    if (!revived(x) || !x.hookSession || hook === x.hookSession) return;
    const liveness = boundLiveness(io.cwd, { ...x, active: true }, now.getTime());
    if (liveness !== 'stopped') throw new UsageError(boundElsewhere('retry', x.runId, x.hookSession, liveness));
  };
  gate(e);
  // R7 (I2): the run this retry revives, under the lock. The bound session reviving its own run is on it again: an
  // ended signal it left (a SessionEnd before its claude --resume) is cleared, so another session stays gated.
  let woke: ExecutionState | null = null;
  const revive = (cur: ExecutionState) => {
    if (!revived(cur)) return {};
    woke = cur;
    return { active: true, stopReason: null, stallReason: null };
  };
  const clearOwnEnded = () => {
    const w = woke as ExecutionState | null;
    if (w && hook && hook === w.hookSession) clearEnded(io.cwd, w, hook, now);
  };
  if (has('adopt')) {
    const adoptable = (x: ExecTask | undefined): x is ExecTask => !!x && x.status === 'conflict' && x.executor !== 'subagents';
    const notAdoptable = (x: ExecTask | undefined) =>
      new UsageError(`swarm retry: --adopt takes a member's task in conflict (${task} is ${x ? `${x.status}, ${x.executor}` : 'not in this execution'})`);
    if (!adoptable(t)) throw notAdoptable(t);
    if (deps.git(['rev-parse', '--verify', '-q', `refs/heads/${t.branch}`]) === null) throw new UsageError(`swarm retry: ${t.branch} does not exist`);
    // The fix round runs where the branch already is (a member's task-<T>, or the manual session's own worktree).
    const holder = worktreeHolding(deps.git(['worktree', 'list', '--porcelain']), t.branch);
    // Taking over a session's own worktree must not trample its uncommitted edits.
    if (holder !== null) {
      const status = deps.at(holder).git(['status', '--porcelain']);
      if (status === null) throw new UsageError(`swarm retry: could not read the worktree status of ${t.branch} (${holder}); check it by hand before --adopt`);
      if (status.trim() !== '') {
        throw new UsageError(`swarm retry: the worktree of ${t.branch} (${holder}) has uncommitted changes; commit or discard them before --adopt`);
      }
    }
    const worktree = holder ?? addTaskWorktree(deps, io.cwd, task, e.branch, e.kind === 'plan' ? e.project : null).worktree;
    let adopted = t;
    update(cur => {
      if (!cur) return null;
      notEnded(cur);
      gate(cur);
      const base = cur.tasks[task] ?? t;
      if (!adoptable(base)) throw notAdoptable(base);
      adopted = base;
      return {
        ...cur, ...revive(cur),
        tasks: { ...cur.tasks, [task]: { ...base, status: 'running', stage: 'implement', executor: 'subagents', worktree, attempts: base.attempts + 1, nudgedAt: null, finishedAt: iso, updatedAt: iso, stageSince: iso } },
      };
    });
    clearOwnEnded();
    writePublicTask(io.cwd, { task, runId: e.runId, stage: 'implement', status: 'running', agent: null, round: adopted.round, since: iso, updatedAt: iso, leaseUntil: new Date(now.getTime() + LEASE_MINUTES * 60000).toISOString(), by: e.coordinator, mode: 'subagents' });
    // D-08: `work`, the task's work folder in the main checkout, where the coordinator writes its brief.
    return json({ task, adopted: true, previous: adopted.executor, worktree, branch: t.branch, work: workRel({ project: e.project, task }) });
  }
  const retryable = (x: ExecTask | undefined): x is ExecTask => !!x && (x.status === 'conflict' || x.status === 'blocked');
  if (!retryable(t)) throw new UsageError(`swarm retry: ${task} is not in conflict or blocked`);
  update(cur => {
    if (!cur) return null;
    notEnded(cur);
    gate(cur);
    const base = cur.tasks[task] ?? t;
    if (!retryable(base)) throw new UsageError(`swarm retry: ${task} is not in conflict or blocked`);
    return {
      ...cur, ...revive(cur),
      tasks: { ...cur.tasks, [task]: { ...base, status: 'running', stage: 'implement', attempts: base.attempts + 1, detail: null, finishedAt: null, updatedAt: iso, stageSince: iso } },
    };
  });
  clearOwnEnded();
  return ok();
};
