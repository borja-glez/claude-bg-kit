import { parse } from 'yaml';
import { z } from 'zod';
import { TRACK_COLORS, type Plan } from './types.js';

const SEG = /^[A-Za-z0-9_.-]{1,64}$/;
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
});

const PlanSchema = z.object({
  project: id,
  locale: z.string().min(1).default('en'),
  version: z.string().min(1),
  artifacts: z.object({ roadmap: z.string().url().optional(), design: z.string().url().optional() }).default({}),
  versions: z.array(z.object({ id, phases: z.array(id) })).default([]),
  tracks: z.array(z.object({ id, name: z.string().min(1), color: z.enum(TRACK_COLORS) })).min(1),
  phases: z.array(z.object({
    id,
    name: z.string().min(1),
    plan_status: z.enum(['committed', 'provisional']).default('committed'),
  })).min(1),
  tasks: z.array(TaskSchema).min(1),
});

export class PlanError extends Error {
  constructor(public issues: string[]) {
    super(`Invalid plan:\n- ${issues.join('\n- ')}`);
    this.name = 'PlanError';
  }
}

export function parsePlan(text: string): Plan {
  let raw: unknown;
  try { raw = parse(text); } catch (e) { throw new PlanError([`YAML: ${(e as Error).message}`]); }
  const r = PlanSchema.safeParse(raw);
  if (!r.success) throw new PlanError(r.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`));
  const plan = r.data as Plan;
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
