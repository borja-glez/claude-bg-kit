// 6b-3 B-2, M-8, T6B3-RETIRED-IDS: what of a re-plan would override the person or a done task. `FORGE proposals replan-check`
// runs it before every `waypoint replan --check` and every `waypoint replan`, so the CLI, not the phase review's agent, holds
// it. A re-plan never retires, moves, or changes the title or the done_when of:
// - a task of the person's: one a proposal of theirs became (a `(proposal <id>)` line of its `includes`, or a proposal whose
//   taskId names it) that is a person's idea, or holds a mark that is not the run's own (forge:auto, forge:policy). Failing
//   closed, a proposal this checkout does not have, or one that holds no mark, is not the run's either;
// - a done task (the roadmap's state): its phase would close at once, and its id and its state must stay together.
// What changes nothing (a move to the phase it is in, the title it has) overrides no one. Reads only: it never writes.
import type { Plan, PlanTask } from '../lib/types.js';
import type { ReplanOp } from '../lib/replan.js';
import { readEvents } from './ledger.js';
import { loadApprovals, loadProposals } from './proposals.js';
import { personsIdea } from './judge.js';
import { proposalsOfIncludes } from './to-task.js';

/** The marks a run writes itself: an autonomous profile's (`proposals judge`) and the policy's. Any other is the owner's. */
const RUN_MARKS: readonly string[] = ['forge:auto', 'forge:policy'];

/** The task `op` would retire, move, or edit the title or done_when of, and what it would do; null for every other operation,
 *  and for one that leaves the task as `tasks` has it. */
function changeOf(op: ReplanOp, tasks: ReadonlyMap<string, PlanTask>): { task: string; what: string } | null {
  switch (op.op) {
    case 'retire': return { task: op.task, what: `retire ${op.task}` };
    case 'move': return tasks.get(op.task)?.phase === op.phase ? null : { task: op.task, what: `move ${op.task} to ${op.phase}` };
    case 'edit': {
      const t = tasks.get(op.task);
      const fields = (['title', 'done_when'] as const).filter(k => op[k] !== undefined && op[k] !== t?.[k]);
      return fields.length ? { task: op.task, what: `edit ${op.task} ${fields.join(', ')}` } : null;
    }
    default: return null;
  }
}

/**
 * Each operation of `ops` that would override the person or a done task, as `ops[<i>] <what it would do>: <why not>`; empty
 * when none does. `root` is the checkout whose proposals, marks and ledger say where each task came from (the run's
 * worktree), `plan` the plan the operations apply to, `done` the tasks the roadmap's state says are done.
 */
export function replanRefusals(root: string, plan: Plan, ops: readonly ReplanOp[], done: ReadonlySet<string>): string[] {
  const proposals = loadProposals(root);
  const byId = new Map(proposals.map(p => [p.id, p]));
  const marks = loadApprovals(root);
  const events = readEvents(root).filter(e => e.kind === 'proposal');
  const tasks = new Map(plan.tasks.map(t => [t.id, t]));
  /** Why `task` is the person's, by the first proposal it came from that is not the run's own; null when none is. */
  const personOf = (task: string): string | null => {
    const from = [...proposalsOfIncludes(tasks.get(task)?.includes), ...proposals.filter(p => p.taskId === task).map(p => p.id)];
    for (const id of new Set(from)) {
      const found = byId.get(id);
      if (!found) return `its proposal ${id} is not in this checkout, so who decided it is not known`;
      const { id: _id, ...doc } = found;
      if (personsIdea(events, id, doc)) return `its proposal ${id} is a person's idea (source: user)`;
      const mark = marks[id];
      if (!mark) return `its proposal ${id} holds no mark, so who decided it is not known`;
      if (!RUN_MARKS.includes(mark.by)) return `its proposal ${id} holds the owner's mark (by ${mark.by})`;
    }
    return null;
  };
  const out: string[] = [];
  ops.forEach((op, i) => {
    const change = changeOf(op, tasks);
    if (!change) return;
    const why = [done.has(change.task) ? `${change.task} is done` : null, personOf(change.task)].filter((w): w is string => w !== null);
    if (why.length) out.push(`ops[${i}] ${change.what}: ${why.join('; ')}`);
  });
  return out;
}
