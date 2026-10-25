import { parse } from 'yaml';
import * as z from 'zod';
import { PHASE_GOAL_MAX, TRACK_COLORS, type Plan } from './types.js';
import { PLAN_ID_RE as SEG, isPlanId, realDate } from './ids.js';
import { historyOf } from './plan-history.js';

/** The plan's rule for task, track and phase ids (src/lib/ids.ts, free of yaml and zod for the page). */
export { isPlanId };

// I-13: the schemas are built on first use, inside a function, so a module that imports only what needs no zod (isPlanId,
// checkReferences: the band's mod, through execution-state.ts) leaves zod out of its bundle (zod has no side effects).
function planSchemas() {
  const id = z.string()
    .regex(SEG, 'invalid id (allowed: letters, digits, _ - .; max 64)')
    .refine(s => s !== '.' && s !== '..', 'invalid id');

  const TaskSchema = z.object({
    id,
    title: z.string().min(1),
    track: id,
    phase: id,
    category: z.string().optional(),
    includes: z.string().optional(),
    done_when: z.string().min(1),
    verification: z.string().optional(),
    depends_on: z.array(id).default([]),
    zones: z.array(z.string().min(1)).default([]),
    estimate_min: z.number().positive().optional(),
    delicate: z.boolean().optional(),
    // G-25, K3-08: the section of the design the task comes from (a heading's slug, or _intro).
    design_ref: z.string().regex(/^[a-z0-9-]{1,80}$|^_intro$/, 'design_ref must be a section slug of the design').optional(),
    // A7: the failure modes no test covers, one line each, which the brief hands to the implementer and the reviewers.
    review_focus: z.array(z.string().trim().min(1).max(300).regex(/^[^\r\n]*$/, 'one line each')).min(1).max(6).optional(),
  });

  const PlanSchema = z.object({
    project: id,
    locale: z.string().min(1).default('en'),
    version: z.string().min(1),
    design_version: z.number().int().positive().optional(),
    artifacts: z.object({ roadmap: z.string().url().optional(), design: z.string().url().optional() }).default({}),
    versions: z.array(z.object({ id, phases: z.array(id), target: z.string().refine(realDate, 'target must be a date (YYYY-MM-DD)').optional() })).default([]),
    tracks: z.array(z.object({ id, name: z.string().min(1), color: z.enum(TRACK_COLORS) })).min(1),
    phases: z.array(z.object({
      id,
      name: z.string().min(1),
      plan_status: z.enum(['committed', 'provisional']).default('committed'),
      goal: z.string().max(PHASE_GOAL_MAX).optional(),
    })).min(1),
    tasks: z.array(TaskSchema).min(1),
    // T6B3-RETIRED-IDS: the tasks `waypoint replan` retired, whose ids are never minted again. The history (what replan
    // changed and why) is read apart by historyOf, leniently; the roadmap's documents leave both out.
    retired: z.array(id).optional(),
  });
  return { TaskSchema, PlanSchema };
}
let planBuilt: ReturnType<typeof planSchemas> | undefined;
const schemas = () => (planBuilt ??= planSchemas());

export class PlanError extends Error {
  constructor(public issues: string[]) {
    super(`Invalid plan:\n- ${issues.join('\n- ')}`);
    this.name = 'PlanError';
  }
}

export function parsePlan(text: string): Plan {
  let raw: unknown;
  try { raw = parse(text); } catch (e) { throw new PlanError([`YAML: ${(e as Error).message}`]); }
  const r = schemas().PlanSchema.safeParse(raw);
  if (!r.success) throw new PlanError(r.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`));
  // T6B3-HISTORY-LENIENT: never a reason to refuse the plan.
  const history = historyOf((raw as { history?: unknown }).history);
  const plan = (history ? { ...r.data, history } : r.data) as Plan;
  const issues = checkReferences(plan);
  if (issues.length) throw new PlanError(issues);
  return plan;
}

function dupes(ids: string[]): string[] {
  const seen = new Set<string>();
  const out = new Set<string>();
  for (const i of ids) (seen.has(i) ? out : seen).add(i);
  return [...out];
}

export function checkReferences(plan: Plan): string[] {
  const issues: string[] = [];
  const lists = [['track', plan.tracks], ['phase', plan.phases], ['task', plan.tasks], ['version', plan.versions]] as const;
  for (const [kind, list] of lists) for (const d of dupes(list.map(x => x.id))) issues.push(`duplicate ${kind} id: ${d}`);
  const tracks = new Set(plan.tracks.map(t => t.id));
  const phases = new Set(plan.phases.map(p => p.id));
  const tasks = new Set(plan.tasks.map(t => t.id));
  for (const t of plan.tasks) {
    if (!tracks.has(t.track)) issues.push(`task ${t.id}: unknown track ${t.track}`);
    if (!phases.has(t.phase)) issues.push(`task ${t.id}: unknown phase ${t.phase}`);
    for (const d of t.depends_on) if (!tasks.has(d)) issues.push(`task ${t.id}: unknown dependency ${d}`);
  }
  for (const v of plan.versions) for (const p of v.phases) if (!phases.has(p)) issues.push(`version ${v.id}: unknown phase ${p}`);
  // T6B3-RETIRED-IDS: a task may not take a retired id, or sync would give it the retired task's state.
  for (const id of plan.retired ?? []) if (tasks.has(id)) issues.push(`task ${id}: the id is retired (a replan took that task out): give the task a new id`);
  const cycle = findCycle(plan);
  if (cycle) issues.push(`dependency cycle: ${cycle.join(' -> ')}`);
  return issues;
}

function findCycle(plan: Plan): string[] | null {
  const deps = new Map(plan.tasks.map(t => [t.id, t.depends_on]));
  const mark = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const visit = (n: string): string[] | null => {
    if (mark.get(n) === 2) return null;
    if (mark.get(n) === 1) return [...stack.slice(stack.indexOf(n)), n];
    mark.set(n, 1);
    stack.push(n);
    for (const d of deps.get(n) ?? []) {
      const c = visit(d);
      if (c) return c;
    }
    stack.pop();
    mark.set(n, 2);
    return null;
  };
  for (const t of plan.tasks) {
    const c = visit(t.id);
    if (c) return c;
  }
  return null;
}
