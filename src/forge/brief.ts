import type { Plan, PlanTask } from '../lib/types.js';

export function taskText(task: PlanTask): string {
  return [task.title, task.includes, task.done_when].filter((s): s is string => !!s && !!s.trim()).map(s => s.trim()).join('. ');
}

// The brief an implementer works from: the plan task's fields verbatim, plus where the plan and design live.
export function renderBrief(plan: Plan, task: PlanTask, opts: { planPath: string; designPath: string | null }): string {
  const lines = [
    `# ${task.id}: ${task.title}`,
    '',
    `Project: ${plan.project} · Track: ${task.track} · Phase: ${task.phase}`,
    ...(task.includes ? [`Includes: ${task.includes}`] : []),
    `Done when: ${task.done_when}`,
    ...(task.verification ? [`Verification: ${task.verification}`] : []),
    `Commit title prefix: ${task.id}: `,
    `Zones: ${task.zones.length ? task.zones.join(', ') : '(none listed)'}`,
    ...(task.depends_on.length ? [`Depends on: ${task.depends_on.join(', ')}`] : []),
    ...(task.estimate_min ? [`Estimate: ${task.estimate_min} min`] : []),
    '',
    `Plan: ${opts.planPath}`,
    ...(opts.designPath ? [`Design: ${opts.designPath}`] : []),
    '',
    'Stay inside the zones where possible; the task is done only when "Done when" holds and the validators pass.',
  ];
  return lines.join('\n') + '\n';
}
