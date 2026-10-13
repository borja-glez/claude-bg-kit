// forge:route's choices (spec §5.3): the options for a coding request and the recommended one, and .forge/route.json,
// the route a session chose while superpowers designs or plans and forge builds (the prompt hook reminds it).
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { forgeDir } from './ledger.js';
import { TASK_ID } from '../lib/decisions.js';
import type { PathName } from './triage.js';
import type { Prefs } from './prefs.js';
import type { SpPlanEntry, SpSpec } from './superpowers.js';

export const ROUTE_OPTIONS = ['forge', 'superpowers', 'superpowers-design', 'superpowers-plan', 'none'] as const;
export type RouteOption = (typeof ROUTE_OPTIONS)[number];
export const ROUTE_STAGES = ['designing', 'planning', 'handed-off', 'done'] as const;
export type RouteStage = (typeof ROUTE_STAGES)[number];
/** A route half done is reminded this long after its last change. */
export const ROUTE_REMINDER_MS = 24 * 3600_000;

export interface Recommendation { option: RouteOption; why: string; spec?: string; plan?: string }
export interface RouteOutput {
  workflow: Prefs['workflow']; autonomy: Prefs['autonomy']; sources: Prefs['sources'];
  superpowers: { installed: boolean; version: string | null };
  specs: string[]; plans: { path: string; tasks: number; done: number }[];
  options: RouteOption[]; recommended: Recommendation;
}

/** The options and the recommendation: a plan the request asks to carry out, then a spec to build from, then Large
 *  with superpowers, else forge. Without superpowers: forge or no forge. */
export function routeOptions(i: { path: PathName; prefs: Prefs; superpowers: { installed: boolean; version: string | null }; specs: SpSpec[]; plans: SpPlanEntry[]; runPlan: boolean }): RouteOutput {
  const base = {
    workflow: i.prefs.workflow, autonomy: i.prefs.autonomy, sources: i.prefs.sources, superpowers: i.superpowers,
    specs: i.specs.map(s => s.path), plans: i.plans.map(p => ({ path: p.path, tasks: p.tasks, done: p.done })),
  };
  if (!i.superpowers.installed) {
    return { ...base, options: ['forge', 'none'], recommended: { option: 'forge', why: 'superpowers is not installed: forge triages, implements and reviews it' } };
  }
  let recommended: Recommendation;
  if (i.runPlan && i.plans.length) recommended = { option: 'superpowers-plan', why: 'an unfinished superpowers plan to carry out: forge executes and reviews each task', plan: i.plans[0].path };
  else if (i.specs.length) recommended = { option: 'superpowers-design', why: 'a recent superpowers spec not imported yet: forge builds from it', spec: i.specs[0].path };
  else if (i.path === 'large') recommended = { option: 'superpowers-design', why: 'large and ambiguous: brainstorming clarifies intent, forge builds and reviews' };
  else recommended = { option: 'forge', why: 'forge triages, implements and reviews it' };
  return { ...base, options: ['forge', 'superpowers', 'superpowers-design', 'superpowers-plan'], recommended };
}

export interface RouteDoc { task: string; chosen: RouteOption; by: 'user' | 'auto'; stage: RouteStage; ts: string; spec?: string; plan?: string }
export const routeFile = (root: string) => path.join(root, '.forge', 'route.json');
// A path that reaches the model's context through the reminder: no control characters, quotes or angle brackets.
const SAFE_PATH = /^[A-Za-z0-9_./\\: -]{1,300}$/;
export const isRoutePath = (s: unknown): s is string => typeof s === 'string' && SAFE_PATH.test(s);

export function normalizeRoute(x: unknown): RouteDoc | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const task = typeof o.task === 'string' && TASK_ID.test(o.task) ? o.task : null;
  const chosen = (ROUTE_OPTIONS as readonly unknown[]).includes(o.chosen) ? o.chosen as RouteOption : null;
  const by = o.by === 'user' || o.by === 'auto' ? o.by : null;
  const stage = (ROUTE_STAGES as readonly unknown[]).includes(o.stage) ? o.stage as RouteStage : null;
  const ts = typeof o.ts === 'string' && Number.isFinite(Date.parse(o.ts)) ? o.ts : null;
  if (!task || !chosen || !by || !stage || !ts) return null;
  return { task, chosen, by, stage, ts, ...(isRoutePath(o.spec) ? { spec: o.spec } : {}), ...(isRoutePath(o.plan) ? { plan: o.plan } : {}) };
}

export function readRoute(root: string): RouteDoc | null {
  try { return normalizeRoute(JSON.parse(readFileSync(routeFile(root), 'utf8'))); } catch { return null; }
}

export function writeRoute(root: string, doc: RouteDoc): void {
  forgeDir(root);
  const file = routeFile(root);
  const tmp = `${file}.${process.pid}.tmp`;
  try { writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n'); renameSync(tmp, file); } finally { rmSync(tmp, { force: true }); }
}

/** Where a route starts: superpowers designs (or plans) first, unless that spec (or plan) already exists. */
export function firstStage(chosen: RouteOption, has: { spec?: string; plan?: string }): RouteStage {
  if (chosen === 'superpowers-design' && !has.spec) return 'designing';
  if (chosen === 'superpowers-plan' && !has.plan) return 'designing';
  return 'handed-off';
}
