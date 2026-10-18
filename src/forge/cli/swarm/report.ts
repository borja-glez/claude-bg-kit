import type { SwarmCommand } from './context.js';
import { readFileSync } from 'node:fs';
import { UsageError } from '../errors.js';
import { writePublicTask, executionTaskFile } from '../../execution.js';
import { LEASE_MINUTES } from '../../../lib/coordination.js';
import { STAGES, normalizePublicTask, type ExecTask, type PublicTask } from '../../../lib/execution-state.js';
import type { Stage } from '../../../lib/types.js';
import { writeMember } from '../../members.js';
import { publishFor, startedEvent } from '../../roadmap-sources.js';

export const subcommand: SwarmCommand = (rest, ctx) => {
  const { io, flag, has, json, now, iso, taskArg, memberCtx } = ctx;
  const task = taskArg();
  const { main, e, session, m } = memberCtx(true);
  const member = m!;
  if (member.role === 'executor' && member.task !== task) throw new UsageError(`swarm report: ${session} executes ${member.task}, not ${task}`);
  const stage = flag('stage') as Stage | undefined;
  if (!stage || !STAGES.includes(stage)) throw new UsageError(`swarm report: --stage must be one of ${STAGES.join('|')}`);
  const status = (flag('status') ?? 'running') as ExecTask['status'];
  if (!['running', 'accepted', 'blocked'].includes(status)) throw new UsageError('swarm report: --status must be running, accepted or blocked');
  const round = has('round') ? Number(flag('round')) : 0;
  if (!Number.isInteger(round) || round < 0 || round > 99) throw new UsageError('swarm report: --round must be an integer from 0 to 99');
  // A claim starts a task: it cannot go with a status that says the task is not running.
  if (has('claim') && status !== 'running') throw new UsageError('swarm report: --claim starts a task and goes only with --status running');
  let prev: PublicTask | null = null;
  try { prev = normalizePublicTask(JSON.parse(readFileSync(executionTaskFile(main, task), 'utf8'))); } catch { prev = null; }
  // Another session still holding the task's lease owns its public file: never overwrite it.
  if (prev && prev.runId === e.runId && prev.by !== session && Date.parse(prev.leaseUntil) > now.getTime()) {
    throw new UsageError(`swarm report: ${task} is reported by ${prev.by} until ${prev.leaseUntil}`);
  }
  if (member.role === 'manual' && member.task !== task) writeMember(main, { ...member, task });
  const since = prev && prev.by === session && prev.stage === stage && prev.runId === e.runId ? prev.since : iso;
  const lease = flag('lease') && !Number.isNaN(Date.parse(flag('lease')!)) ? flag('lease')! : new Date(now.getTime() + LEASE_MINUTES * 60000).toISOString();
  const p: PublicTask = { task, runId: e.runId, stage, status, agent: has('no-agent') ? null : (flag('agent') ?? null), round, since, updatedAt: iso,
    leaseUntil: lease, by: session, mode: member.role === 'executor' ? 'sessions' : 'manual' };
  writePublicTask(main, p);
  // J-15: the state/T write of this report, built by the CLI; --claim adds the member's claim of its task.
  const claimed = has('claim') ? { status: 'in_progress', owner: session, claimedAt: iso, startedAt: iso } : null;
  return json({
    ...p, ...publishFor(io, task, { project: e.project, ...(claimed ? { extra: claimed } : {}) }),
    ...(claimed ? { event: startedEvent(session, task, now, io.rand) } : {}),
  });
};
