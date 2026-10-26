import type { Command } from '../context.js';
import { loadConfig, agentFor, ROLES, type Role } from '../../config.js';
import { appendEvent, readEvents } from '../../ledger.js';
import { executionHolding } from '../../execution.js';
import { baseOf, eventsOf, isTask, resolveProject } from '../../task-ref.js';
import { isSafeId } from '../../../lib/execution-state.js';
import { UsageError } from '../errors.js';

/** A brief id, `<id>-<n>`. */
const BRIEF = /^.+-\d{1,4}$/;

/**
 * Round 2: a naming outweighs the triage in the deviation check, so `--task` must be a brief forge knows: its task has a
 * triage or a phase in the ledger (that brief's, or the task's), and, when an active execution runs the task, the task is
 * running at stage implement or validate (where a fresh implementer is named). Otherwise a UsageError that says what to do.
 */
function knownBrief(cwd: string, brief: string): void {
  const id = baseOf(brief);
  const ledger = readEvents(cwd);
  const project = resolveProject({ task: id, events: ledger });
  const known = eventsOf(ledger, { project, task: id }).some(e => (e.kind === 'triage' || e.kind === 'phase') && (isTask(e, id) || isTask(e, brief)));
  if (!known) throw new UsageError(`agents: --task ${brief}: forge has no triage or phase of ${id}; run FORGE triage --task ${id} first`);
  const e = executionHolding(cwd, { project, task: id });
  const t = e?.active ? e.tasks[id] : undefined;
  if (t && !(t.status === 'running' && (t.stage === 'implement' || t.stage === 'validate'))) {
    const where = `${id} is ${t.status} at stage ${t.stage} in the execution`;
    throw new UsageError(`agents: --task ${brief}: ${where}; a fresh implementer is named while it runs at implement or validate (check it with forge swarm status)`);
  }
}

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
    knownBrief(io.cwd, task);
    appendEvent(io.cwd, { ts: ts(), kind: 'agent', task, agent, role, by: 'agents' });
  }
  return json({ profile, role, agent, ...(task ? { task } : {}) });
};
