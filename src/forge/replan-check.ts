// 6b-3 B-2, M-8, T6B3-RETIRED-IDS: what of a re-plan would override the person or a done task. `FORGE proposals replan-check`
// runs it before every `waypoint replan --check` and every `waypoint replan`, so the CLI, not the phase review's agent, holds
// it, and `FORGE infinite phase` lists the tasks it holds for that agent (T6B3-REPLAN-HELD). A re-plan never retires, moves,
// or changes the title or the done_when of:
// - a task of the person's: one a proposal became (a `(proposal <id>)` line of its `includes`, or a proposal whose taskId
//   names it) that is a person's idea, or that a person's note was merged into (T6B3-REPLAN-MERGED), or holds a mark that is
//   not the run's own (forge:auto, forge:policy), or a run's mark that no longer matches it (T6B3-REPLAN-MARK-OK: reopened or
//   edited since). Failing closed, a proposal this checkout does not have, or one that holds no mark, is not the run's either;
// - a done task (the roadmap's state): its phase would close at once, and its id and its state must stay together;
// - (final fix F-M3) a task blocked for the person (`blocked` by `external`): a question the run asked waits on it.
// Nor does it move a task into a phase already reviewed (final fix F-M4): that phase never closes again, so the task would
// escape the phase review. What changes nothing (a move to the phase it is in, the title it has) overrides no one. Reads only:
// it never writes. T6B3-RETIRE-HELD: `proposals retire` asks the same per-proposal rule (notRunsOwn) before it rejects a
// retired task's proposal.
import type { Plan, PlanTask } from '../lib/types.js';
import type { ReplanOp } from '../lib/replan.js';
import { ownerCheck } from '../lib/proposals.js';
import { clean } from '../lib/decisions.js';
import { readEvents } from './ledger.js';
import { loadApprovals, loadProposals } from './proposals.js';
import { personsIdea } from './judge.js';
import { IDEA_MERGED } from './ideas.js';
import { proposalsOfIncludes } from './to-task.js';
import type { TaskFacts } from './phases.js';

/** The marks a run writes itself: an autonomous profile's (`proposals judge`) and the policy's. Any other is the owner's. */
const RUN_MARKS: readonly string[] = ['forge:auto', 'forge:policy'];
/** Final fix T5-a: a merged note's origin in a reason, one clean line of at most this many code points (a `note:<id>` is 30). */
const FROM_MAX = 80;

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
 * T6B3-RETIRE-HELD: why proposal `id` of `root` is not the run's own to change or decide, or null when it is. Read once from the
 * proposals (`proposals`, when the caller has them loaded), the marks and the proposal events of `root`; fails closed. It is not
 * the run's when this checkout does not have it, it is a person's idea, a person's note was merged into it (T6B3-REPLAN-MERGED),
 * it holds no mark or one that is not the run's own (RUN_MARKS), or the run's mark no longer matches it (T6B3-REPLAN-MARK-OK:
 * reopened or edited since). The reason reads after the proposal («<id> holds the owner's mark …»). heldBy and
 * `proposals retire` both ask it, so a re-plan and the rejection of a retired task's proposal never disagree.
 */
export function notRunsOwn(root: string, proposals = loadProposals(root)): (id: string) => string | null {
  const byId = new Map(proposals.map(p => [p.id, p]));
  const marks = loadApprovals(root);
  const events = readEvents(root).filter(e => e.kind === 'proposal');
  // T6B3-REPLAN-MERGED: a person's note that said what an open proposal says joined it (`proposals add --from-note`). The ledger
  // is a file someone could edit: its origin is cleaned and clipped (T5-a).
  const merged = new Map(events.filter(e => e.action === IDEA_MERGED && typeof e.id === 'string')
    .map(e => [e.id as string, clean(String(e.from ?? ''), FROM_MAX) || 'a note']));
  return id => {
    const found = byId.get(id);
    if (!found) return 'is not in this checkout, so who decided it is not known';
    const { id: _id, ...doc } = found;
    if (personsIdea(events, id, doc)) return "is a person's idea (source: user)";
    if (merged.has(id)) return `holds a person's idea merged into it (${merged.get(id)})`;
    const mark = marks[id];
    if (!mark) return 'holds no mark, so who decided it is not known';
    if (!RUN_MARKS.includes(mark.by)) return `holds the owner's mark (by ${mark.by})`;
    // T6B3-REPLAN-MARK-OK: the run's mark counts while it agrees with the proposal and is of its present text.
    if (ownerCheck(id, doc, mark) !== 'ok') return "holds a run's mark that no longer matches it (reopened or edited since)";
    return null;
  };
}

/**
 * Why a re-plan may not retire, move, or change the title or done_when of a task: a function of the task's id that gives the
 * reasons (`<task> is done`, `<task> waits for the person`, `its proposal <id> …`), or null when it may. `root` is the checkout
 * whose proposals, marks and ledger say where each task came from (the run's worktree), `plan` the plan, `facts` what the
 * roadmap's state says: the tasks done and (final fix F-M3) those blocked for the person. replanRefusals and heldTasks both ask
 * it, so the CLI's refusal and the phase review's list never disagree.
 */
export function heldBy(root: string, plan: Plan, facts: TaskFacts): (task: string) => string | null {
  const proposals = loadProposals(root);
  const notOwn = notRunsOwn(root, proposals);
  const tasks = new Map(plan.tasks.map(t => [t.id, t]));
  /** Why `task` is the person's, by the first proposal it came from that is not the run's own; null when none is. */
  const personOf = (task: string): string | null => {
    const from = [...proposalsOfIncludes(tasks.get(task)?.includes), ...proposals.filter(p => p.taskId === task).map(p => p.id)];
    for (const id of new Set(from)) {
      const why = notOwn(id);
      if (why) return `its proposal ${id} ${why}`;
    }
    return null;
  };
  return task => {
    const why = [facts.done.has(task) ? `${task} is done` : null, facts.forPerson.has(task) ? `${task} waits for the person` : null, personOf(task)]
      .filter((w): w is string => w !== null);
    return why.length ? why.join('; ') : null;
  };
}

/** T6B3-REPLAN-HELD: the tasks of `plan`, in its order, that a re-plan may not retire, move, or change the title or done_when
 *  of, each with why (heldBy): what `FORGE infinite phase` prints for the phase review. */
export function heldTasks(root: string, plan: Plan, facts: TaskFacts): { task: string; reason: string }[] {
  const why = heldBy(root, plan, facts);
  return plan.tasks.flatMap(t => {
    const reason = why(t.id);
    return reason ? [{ task: t.id, reason }] : [];
  });
}

/** Each operation of `ops` that would override the person or a held task (heldBy), or (final fix F-M4) move a task into one of
 *  the `reviewed` phases, as `ops[<i>] <what it would do>: <why not>`; empty when none does. */
export function replanRefusals(root: string, plan: Plan, ops: readonly ReplanOp[], facts: TaskFacts, reviewed: readonly string[]): string[] {
  const why = heldBy(root, plan, facts);
  const tasks = new Map(plan.tasks.map(t => [t.id, t]));
  const out: string[] = [];
  ops.forEach((op, i) => {
    const change = changeOf(op, tasks);
    const into = change && op.op === 'move' && reviewed.includes(op.phase) ? `${op.phase} was already reviewed` : null;
    const reason = [change ? why(change.task) : null, into].filter((w): w is string => w !== null).join('; ');
    if (change && reason) out.push(`ops[${i}] ${change.what}: ${reason}`);
  });
  return out;
}
