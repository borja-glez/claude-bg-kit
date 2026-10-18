import type { SwarmCommand } from './context.js';
import { UsageError } from '../errors.js';
import { appendEvent } from '../../ledger.js';
import { claudeSessionId, noClaudeSession } from '../../../lib/claude-session.js';
import { readMember, isMemberId } from '../../members.js';
import { boundLiveness } from './shared.js';

export const subcommand: SwarmCommand = (rest, ctx) => {
  const { io, flag, json, now, iso, current, update } = ctx;
  const hook = claudeSessionId(flag('hook-session'), io.env ?? process.env);
  if (!hook) throw new UsageError(noClaudeSession('swarm takeover', '--hook-session'));
  const session = flag('session');
  if (!session) throw new UsageError('swarm takeover: --session is required');
  if (!isMemberId(session)) throw new UsageError(`swarm takeover: --session ${session.slice(0, 130)} is not a valid session id (letters, digits, _ - .; max 120)`);
  const e = current();
  if (!e.active) throw new UsageError('swarm takeover: the execution is not active');
  // --session is the waypoint SID that becomes the coordinator; --hook-session is Claude's id of this session, bound
  // at once, so its Stop hook steps the execution from now on (C1).
  // The same Claude session: already bound (its waypoint SID may have changed).
  if (hook === e.hookSession) {
    if (e.coordinator !== session) update(cur => cur && { ...cur, coordinator: session });
    return json({ took: 'already', runId: e.runId });
  }
  // The coordinator's SID from another Claude session (a resume, a /clear): it rebinds only once the bound one
  // stopped (wave 0 handoff); while it lives, this one joins as a manual member.
  if (session === e.coordinator) {
    const alive = e.hookSession === null ? 'stopped' : boundLiveness(io.cwd, e, now.getTime());
    if (alive !== 'stopped') return json({ took: false, previous: e.hookSession, liveness: alive, joinAs: 'manual' });
    update(cur => cur && { ...cur, hookSession: hook });
    return json({ took: 'already', runId: e.runId });
  }
  // A run member keeps its role: it would otherwise coordinate the task it executes.
  if (readMember(io.cwd, session)?.runId === e.runId) throw new UsageError(`swarm takeover: ${session} is a member of the execution ${e.runId}; a run member cannot take over the coordinator`);
  const previous = e.hookSession ?? e.coordinator;
  // The run band's rule decides (boundLiveness); --db is still accepted, but the roadmap lease no longer counts.
  const liveness = boundLiveness(io.cwd, e, now.getTime());
  if (liveness !== 'stopped') return json({ took: false, previous, liveness, joinAs: 'manual' });
  update(cur => cur && { ...cur, coordinator: session, hookSession: hook, sleepUntil: null });
  // The user asked this session to go on: their decision, recorded in the decision format (by: user).
  appendEvent(io.cwd, { ts: iso, kind: 'decision', point: 'takeover', what: 'takeover', chosen: session, why: `the coordinator ${previous} stopped`, by: 'user', weight: 'minor', previous, session, runId: e.runId });
  return json({ took: true, previous, runId: e.runId, running: Object.entries(e.tasks).filter(([, t]) => t.status === 'running').map(([id]) => id) });
};
