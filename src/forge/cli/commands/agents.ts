import type { Command } from '../context.js';
import { loadConfig, agentFor, ROLES, type Role } from '../../config.js';
import { appendEvent } from '../../ledger.js';
import { isSafeId } from '../../../lib/execution-state.js';
import { UsageError } from '../errors.js';

/** A brief id, `<id>-<n>`. */
const BRIEF = /^.+-\d{1,4}$/;

/**
 * `FORGE agents`: the agent of every role on the config's profile. `--role R` prints the one of R; with `--task <id>-<n>`
 * it also records it as the implementer forge names for that brief (`agent` event, `by: "agents"`), which the deviation
 * check reads (FX1 I1): the fresh `impl` an ephemeral Trivial or Small task gets after two rounds, which no review-close
 * prints.
 */
export const command: Command = (_args, ctx) => {
  const { io, flag, has, json, ts } = ctx;
  const { profile } = loadConfig(io.cwd);
  if (!has('role')) {
    if (has('task')) throw new UsageError('agents: --task goes with --role <role>');
    return json({ profile, agents: Object.fromEntries(ROLES.map(r => [r, agentFor(r, profile)])) });
  }
  const role = flag('role');
  if (!role || !(ROLES as readonly string[]).includes(role)) throw new UsageError(`agents: --role must be one of ${ROLES.join('|')}`);
  const agent = agentFor(role as Role, profile);
  const task = flag('task');
  if (has('task')) {
    if (!task || !isSafeId(task) || !BRIEF.test(task)) throw new UsageError('agents: --task needs a brief id, <id>-<n>');
    appendEvent(io.cwd, { ts: ts(), kind: 'agent', task, agent, role, by: 'agents' });
  }
  return json({ profile, role, agent, ...(task ? { task } : {}) });
};
