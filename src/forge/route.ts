// forge:route's choices (spec §5.3): the options for a coding request and the recommended one, and .forge/route/<session>.json,
// the route a session chose while superpowers designs or plans and forge builds (the prompt hook reminds it).
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { forgeDir } from './ledger.js';
import { TASK_ID } from '../lib/decisions.js';
import { isSafeId } from '../lib/execution-state.js';
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

/** The options and the recommendation: a plan the request asks to carry out, then a spec it asks to build, then Large
 *  with superpowers (forge in auto mode: brainstorming would ask), else forge. Without superpowers: forge or no forge.
 *  A recent spec or plan the request does not ask for is only listed: it may be about another task. */
export function routeOptions(i: { path: PathName; prefs: Prefs; superpowers: { installed: boolean; version: string | null }; specs: SpSpec[]; plans: SpPlanEntry[]; runPlan: boolean; buildSpec: boolean }): RouteOutput {
  const base = {
    workflow: i.prefs.workflow, autonomy: i.prefs.autonomy, sources: i.prefs.sources, superpowers: i.superpowers,
    specs: i.specs.map(s => s.path), plans: i.plans.map(p => ({ path: p.path, tasks: p.tasks, done: p.done })),
  };
  if (!i.superpowers.installed) {
    return { ...base, options: ['forge', 'none'], recommended: { option: 'forge', why: 'superpowers is not installed: forge triages, implements and reviews it' } };
  }
  let recommended: Recommendation;
  if (i.runPlan && i.plans.length) recommended = { option: 'superpowers-plan', why: 'an unfinished superpowers plan to carry out: forge executes and reviews each task', plan: i.plans[0].path };
  else if (i.buildSpec && i.specs.length) recommended = { option: 'superpowers-design', why: 'a recent superpowers spec not imported yet: forge builds from it', spec: i.specs[0].path };
  else if (i.path === 'large' && i.prefs.autonomy === 'auto') recommended = { option: 'forge', why: 'large, in auto mode: forge designs, critiques and approves it without asking' };
  else if (i.path === 'large') recommended = { option: 'superpowers-design', why: 'large and ambiguous: brainstorming clarifies intent, forge builds and reviews' };
  else recommended = { option: 'forge', why: 'forge triages, implements and reviews it' };
  return { ...base, options: ['forge', 'superpowers', 'superpowers-design', 'superpowers-plan'], recommended };
}

/** K1-08: the one question forge:route asks, in two parts: the method (the recommended one first) and whether to keep it. */
export interface RouteAsk {
  question: string;
  options: { label: string; option: RouteOption; recommended: boolean }[];
  remember: { question: string; options: { label: string; remember: boolean }[] };
}

const OPTION_LABELS: Record<RouteOption, { es: string; en: string }> = {
  forge: { es: 'forge', en: 'forge' },
  superpowers: { es: 'superpowers', en: 'superpowers' },
  'superpowers-design': { es: 'superpowers diseña, forge construye', en: 'superpowers designs, forge builds' },
  'superpowers-plan': { es: 'superpowers planifica, forge ejecuta', en: 'superpowers plans, forge carries it out' },
  none: { es: 'sin forge', en: 'without forge' },
};

export function routeAsk(r: Pick<RouteOutput, 'options' | 'recommended'>, locale: 'es' | 'en'): RouteAsk {
  const rec = r.recommended.option;
  const order = [rec, ...r.options.filter(o => o !== rec)];
  const mark = locale === 'es' ? ' (Recomendado)' : ' (Recommended)';
  return {
    question: locale === 'es' ? '¿Cómo hacemos esta tarea?' : 'How should this task be done?',
    options: order.map(o => ({ label: `${OPTION_LABELS[o][locale]}${o === rec ? mark : ''}`, option: o, recommended: o === rec })),
    remember: {
      question: locale === 'es' ? '¿Lo recuerdo para este proyecto?' : 'Remember it for this project?',
      options: locale === 'es'
        ? [{ label: 'Sí, no vuelvas a preguntar', remember: true }, { label: 'No, pregúntame cada vez', remember: false }]
        : [{ label: 'Yes, do not ask again', remember: true }, { label: 'No, ask me every time', remember: false }],
    },
  };
}

/** K1-13: how the conversation that chose a route ended (its SessionEnd `reason`). */
export const ROUTE_END_REASONS = ['clear', 'resume', 'logout', 'prompt_input_exit', 'other'] as const;
export type RouteEndReason = (typeof ROUTE_END_REASONS)[number];

/**
 * `session`: Claude's id of the session that chose the route; its file is .forge/route/<session>.json and only that
 * session is reminded of it (K1-04). `endedAt`/`endReason`: when and how that conversation ended (forge's live hook).
 */
export interface RouteDoc {
  task: string; chosen: RouteOption; by: 'user' | 'auto'; stage: RouteStage; ts: string; spec?: string; plan?: string; session?: string;
  endedAt?: string; endReason?: RouteEndReason;
}
/** K1-04: each session's route, in the main checkout. */
export const routeDir = (root: string) => path.join(root, '.forge', 'route');
export const routeFile = (root: string, session: string) => path.join(routeDir(root), `${session}.json`);
/** The single route file of forge 0.19: read only by the session it names, then moved to its own file (K1-05). */
export const legacyRouteFile = (root: string) => path.join(root, '.forge', 'route.json');
// A path that reaches the model's context through the reminder: no control characters, quotes or angle brackets.
const SAFE_PATH = /^[A-Za-z0-9_./\\: -]{1,300}$/;
export const isRoutePath = (s: unknown): s is string => typeof s === 'string' && SAFE_PATH.test(s);
/** A session id that names a route file: C1's rule. */
export const isRouteSession = (s: unknown): s is string => isSafeId(s);

export function normalizeRoute(x: unknown): RouteDoc | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const task = typeof o.task === 'string' && TASK_ID.test(o.task) ? o.task : null;
  const chosen = (ROUTE_OPTIONS as readonly unknown[]).includes(o.chosen) ? o.chosen as RouteOption : null;
  const by = o.by === 'user' || o.by === 'auto' ? o.by : null;
  const stage = (ROUTE_STAGES as readonly unknown[]).includes(o.stage) ? o.stage as RouteStage : null;
  const ts = typeof o.ts === 'string' && Number.isFinite(Date.parse(o.ts)) ? o.ts : null;
  if (!task || !chosen || !by || !stage || !ts) return null;
  return {
    task, chosen, by, stage, ts, ...(isRoutePath(o.spec) ? { spec: o.spec } : {}), ...(isRoutePath(o.plan) ? { plan: o.plan } : {}),
    ...(isRouteSession(o.session) ? { session: o.session } : {}),
    ...(typeof o.endedAt === 'string' && Number.isFinite(Date.parse(o.endedAt)) ? { endedAt: o.endedAt } : {}),
    ...((ROUTE_END_REASONS as readonly unknown[]).includes(o.endReason) ? { endReason: o.endReason as RouteEndReason } : {}),
  };
}

/**
 * This session's route (K1-04): its own file; else an older .forge/route.json that names this session, which moves to
 * that file (K1-05: one without a session counts for nobody). Null without a safe session id.
 */
export function readRoute(root: string, session: string | null | undefined): RouteDoc | null {
  if (!isRouteSession(session)) return null;
  try {
    const doc = normalizeRoute(JSON.parse(readFileSync(routeFile(root, session), 'utf8')));
    if (doc?.session === session) return doc;
  } catch { /* none yet, or corrupt */ }
  try {
    const old = normalizeRoute(JSON.parse(readFileSync(legacyRouteFile(root), 'utf8')));
    if (old?.session !== session) return null;
    writeRoute(root, old);
    rmSync(legacyRouteFile(root), { force: true });
    return old;
  } catch { return null; }
}

/** Writes a route to its session's file; a route without a safe session names no file and is refused. */
export function writeRoute(root: string, doc: RouteDoc): void {
  if (!isRouteSession(doc.session)) throw new Error('a route needs the Claude session that chose it');
  forgeDir(root);
  const file = routeFile(root, doc.session);
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try { writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n'); renameSync(tmp, file); } finally { rmSync(tmp, { force: true }); }
}

/** Every session's route (50 at most): what route-session reads after /clear or in a fork (K1-13). */
export function listRoutes(root: string): RouteDoc[] {
  let names: string[] = [];
  try { names = readdirSync(routeDir(root)).filter(n => n.endsWith('.json')).slice(0, 50); } catch { return []; }
  return names.flatMap(n => {
    try {
      const doc = normalizeRoute(JSON.parse(readFileSync(path.join(routeDir(root), n), 'utf8')));
      return doc && `${doc.session}.json` === n ? [doc] : [];
    } catch { return []; }
  });
}

/** K1-13: the conversation of `session` ended (SessionEnd): its route records when and why, once. */
export function endRoute(root: string, session: string, reason: RouteEndReason, at: string): void {
  const doc = readRoute(root, session);
  if (doc && !doc.endedAt) writeRoute(root, { ...doc, endedAt: at, endReason: reason });
}

/** Where a route starts: superpowers designs (or plans) first, unless that spec (or plan) already exists. */
export function firstStage(chosen: RouteOption, has: { spec?: string; plan?: string }): RouteStage {
  if (chosen === 'superpowers-design' && !has.spec) return 'designing';
  if (chosen === 'superpowers-plan' && !has.plan) return 'designing';
  return 'handed-off';
}
