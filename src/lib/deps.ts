import type { PlanTask, PlanView, States, TaskStatus } from './types.js';

export const statusOf = (states: States, id: string): TaskStatus => states[id]?.status ?? 'free';

export function isUnlocked(task: PlanTask, states: States): boolean {
  return task.depends_on.every(d => statusOf(states, d) === 'done');
}

/** free, or blocked with every non-external blocker done. */
export function isAvailable(task: PlanTask, states: States): boolean {
  const st = states[task.id];
  const status = statusOf(states, task.id);
  if (status === 'free') return true;
  if (status !== 'blocked') return false;
  const by = st?.blockedBy ?? [];
  return by.length > 0 && !by.includes('external') && by.every(b => statusOf(states, b) === 'done');
}

export function availableTasks(plan: PlanView, states: States, opts: { track?: string } = {}): PlanTask[] {
  const order = new Map(plan.phases.map((p, i) => [p.id, i]));
  return plan.tasks
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => isAvailable(t, states) && isUnlocked(t, states) && (!opts.track || t.track === opts.track))
    .sort((a, b) => (order.get(a.t.phase)! - order.get(b.t.phase)!) || a.i - b.i)
    .map(x => x.t);
}

export function nextTask(plan: PlanView, states: States, opts: { sessionId: string; track?: string }): { task: PlanTask | null; resumed: boolean } {
  const own = plan.tasks.find(t => states[t.id]?.owner === opts.sessionId && ['claimed', 'in_progress'].includes(statusOf(states, t.id)));
  if (own) return { task: own, resumed: true };
  return { task: availableTasks(plan, states, opts)[0] ?? null, resumed: false };
}

export function unlockedBy(plan: PlanView, states: States, doneId: string): string[] {
  const after: States = { ...states, [doneId]: { ...(states[doneId] ?? {}), status: 'done' } };
  return plan.tasks
    .filter(t => t.depends_on.includes(doneId) && ['free', 'blocked'].includes(statusOf(states, t.id)) && isUnlocked(t, after))
    .map(t => t.id);
}

/** The commit shas a task recorded when it was done. */
export const commitShas = (states: States, id: string): string[] =>
  (Array.isArray(states[id]?.commits) ? states[id]!.commits! : []).map(c => c?.sha).filter((s): s is string => typeof s === 'string' && !!s);

/**
 * The first dependency of `task` in another track whose commits are not all in `integrated` (the shas already in
 * the base branch), or null. A done task without recorded commits counts as integrated.
 */
export function notIntegratedDep(plan: PlanView, states: States, task: PlanTask, integrated: ReadonlySet<string>): string | null {
  return task.depends_on.find(d => {
    const dep = plan.tasks.find(t => t.id === d);
    return !!dep && dep.track !== task.track && !commitShas(states, d).every(s => integrated.has(s));
  }) ?? null;
}
