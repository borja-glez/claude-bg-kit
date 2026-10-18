import type { SwarmCommand } from './context.js';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { UsageError } from '../errors.js';
import { appendPhase } from '../../ledger.js';
import { writePublicTask, executionTaskFile } from '../../execution.js';
import { LEASE_MINUTES } from '../../../lib/coordination.js';
import { STAGES, isSafeId, type ExecTask } from '../../../lib/execution-state.js';
import type { Stage } from '../../../lib/types.js';
import { publishFor, startedEvent } from '../../roadmap-sources.js';

export const subcommand: SwarmCommand = (rest, ctx) => {
  const { io, flag, has, json, ok, now, iso, current, notEnded, update, taskArg } = ctx;
  const task = taskArg();
  const e = current();
  const prev = e.tasks[task];
  if (!prev) throw new UsageError(`swarm task: ${task} is not part of this execution`);
  if (has('drop')) {
    // A claim race lost to another session: forget the task so the next tick sees that session's claim.
    update(cur => { if (!cur) return null; const { [task]: _dropped, ...tasks } = cur.tasks; return { ...cur, tasks }; });
    rmSync(executionTaskFile(io.cwd, task), { force: true });
    return ok();
  }
  notEnded(e);
  const stageArg = flag('stage') as Stage | undefined;
  if (stageArg !== undefined && !STAGES.includes(stageArg)) throw new UsageError(`swarm task: --stage must be one of ${STAGES.join('|')}`);
  const statusArg = flag('status') as ExecTask['status'] | undefined;
  // Carry 2: a claim starts a task, as swarm report's does: it cannot go with a status that says the task is not running.
  if (has('claim') && (statusArg ?? prev.status) !== 'running') throw new UsageError('swarm task: --claim starts a task and goes only with --status running');
  let detailArg: string | null | undefined;
  if (flag('detail-file')) {
    try { detailArg = readFileSync(path.resolve(io.cwd, flag('detail-file')!), 'utf8').trim().slice(0, 500) || null; } catch { throw new UsageError('swarm task: cannot read --detail-file'); }
  }
  const roundArg = has('round') ? Number(flag('round')) : undefined;
  if (roundArg !== undefined && (!Number.isInteger(roundArg) || roundArg < 0 || roundArg > 99)) throw new UsageError('swarm task: --round must be an integer from 0 to 99');
  const agentArg = has('no-agent') ? null : flag('agent');
  // Only the fields given here change; the rest keep what the task holds when the lock is taken (I-15).
  const build = (base: ExecTask): ExecTask => {
    const stage = stageArg ?? base.stage;
    const status = statusArg ?? base.status;
    // K2-02: a task forge stop stopped never runs again in this execution (a new swarm start makes a new one).
    if (base.status === 'stopped' && status !== 'stopped') throw new UsageError(`swarm task: ${task} is stopped (forge stop) and stays stopped`);
    if (!['running', 'accepted', 'blocked'].includes(status) && status !== base.status) throw new UsageError('swarm task: --status must be running, accepted or blocked');
    const stageSince = base.stage !== stage ? iso : base.stageSince;
    // Blocked now (it was not): the task's time ends here. Back to running: the next finish writes it again.
    const finishedAt = status === 'blocked' && base.status !== 'blocked' ? iso : status === 'running' && base.finishedAt ? null : base.finishedAt;
    return {
      ...base, stage, status, round: roundArg ?? base.round, agent: agentArg === undefined ? base.agent : agentArg,
      detail: detailArg === undefined ? base.detail : detailArg, updatedAt: iso, stageSince, ...(finishedAt !== undefined ? { finishedAt } : {}),
    };
  };
  let base = prev;
  let next = build(prev);
  update(cur => {
    if (!cur) return null;
    notEnded(cur);
    base = cur.tasks[task] ?? prev;
    next = build(base);
    return { ...cur, tasks: { ...cur.tasks, [task]: next } };
  });
  const lease = flag('lease') && !Number.isNaN(Date.parse(flag('lease')!)) ? flag('lease')! : new Date(now.getTime() + LEASE_MINUTES * 60000).toISOString();
  writePublicTask(io.cwd, { task, runId: e.runId, stage: next.stage, status: next.status, agent: next.agent, round: next.round, since: next.stageSince, updatedAt: iso, leaseUntil: lease, by: e.coordinator, mode: base.executor });
  if (base.stage !== next.stage) appendPhase(io.cwd, { ts: iso, kind: 'phase', task, phase: next.stage, ...(e.kind === 'plan' && isSafeId(e.project) ? { project: e.project } : {}) });
  // J-15: the state/T write of this stage, built by the CLI; --claim adds the claim of a task the coordinator starts.
  // A loose task of an ephemeral run has no state/T.
  const claimed = has('claim') && e.kind === 'plan' ? { status: 'in_progress', owner: e.coordinator, claimedAt: iso, startedAt: iso } : null;
  const pub = e.kind === 'plan' ? publishFor(io, task, { project: e.project, ...(claimed ? { extra: claimed } : {}) }) : { publish: null };
  return json({ ...next, ...pub, ...(claimed ? { event: startedEvent(e.coordinator, task, now, io.rand) } : {}) });
};
