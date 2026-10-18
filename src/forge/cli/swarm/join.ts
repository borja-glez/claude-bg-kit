import type { SwarmCommand } from './context.js';
import { UsageError } from '../errors.js';
import { claudeSessionId } from '../../../lib/claude-session.js';
import { isPlanId } from '../../../lib/plan.js';
import { readMember, writeMember } from '../../members.js';

export const subcommand: SwarmCommand = (rest, ctx) => {
  const { io, flag, json, iso, memberCtx } = ctx;
  const { main, e, session } = memberCtx(false);
  if (session === e.coordinator || session === e.hookSession) throw new UsageError(`swarm join: ${session} coordinates this execution`);
  const role = flag('role');
  if (role !== 'executor' && role !== 'manual') throw new UsageError('swarm join: --role must be executor or manual');
  const task = flag('task') ?? null;
  if (task !== null && !isPlanId(task)) throw new UsageError('swarm join: --task is not a task id');
  if (role === 'executor' && !task) throw new UsageError('swarm join: an executor needs --task');
  // Claude's own session id, the one its hooks receive: the hooks find the member by it (C1: the flag, else
  // CLAUDE_CODE_SESSION_ID). A flag without a value, or an unsubstituted `${CLAUDE_SESSION_ID}`, counts as absent.
  const given = flag('hook-session');
  const id = claudeSessionId(given, io.env ?? process.env);
  // A rejoin without one keeps the hook id this member recorded in the same run.
  const before = readMember(main, session);
  const hookSession = id ?? (before?.runId === e.runId ? before.hookSession : null);
  // No usable id does not stop the join: the member works without its own live signal, and the output says why.
  const warning = id !== null ? null
    : given ? `--hook-session ${given.slice(0, 130)} is not a usable session id (letters, digits, _ - .; max 120): joined without a live signal`
      : hookSession === null ? 'no Claude session id (--hook-session or CLAUDE_CODE_SESSION_ID): joined without a live signal' : null;
  if (hookSession !== null && hookSession === e.hookSession) throw new UsageError(`swarm join: ${hookSession} coordinates this execution`);
  writeMember(main, { sessionId: session, role, runId: e.runId, task, name: flag('name') ?? null, since: iso, hookSession });
  return json({ runId: e.runId, role, task, coordinator: e.coordinator, branch: e.branch, mode: e.mode, project: e.project, ...(warning ? { warning } : {}) });
};
