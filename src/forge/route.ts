// forge:route's choices: the options for a coding request and the recommended one, and .forge/route/<session>.json,
// the route a session chose while superpowers designs or plans and forge builds (the prompt hook reminds it).
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { forgeDir } from './ledger.js';
import { TASK_ID } from '../lib/decisions.js';
import { isSafeId } from '../lib/execution-state.js';
import type { PathName } from './triage.js';
import type { Prefs } from './prefs.js';
import type { SpNamed, SpPlanEntry, SpPool, SpSpec } from './superpowers.js';

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

/** T8: case, accents and Unicode forms count for nothing when a request names a plan or a spec. */
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}+/gu, '').normalize('NFC').toLowerCase();
// What follows a folder's path in a request: the file it names, up to a space, a quote or a bracket.
const NAMED_FILE = /[^\s"'`<>()[\]{},;|*]*/y;
const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}-/;
// A letter or a digit: what never touches a whole phrase at either end.
const WORD_CHAR = /[\p{L}\p{N}]/u;
/** Whether `t` holds `n` as a whole phrase: no letter or digit right before or after it. */
function holdsWhole(t: string, n: string): boolean {
  for (let at = t.indexOf(n); at >= 0; at = t.indexOf(n, at + 1)) {
    if (!WORD_CHAR.test(t[at - 1] ?? '') && !WORD_CHAR.test(t[at + n.length] ?? '')) return true;
  }
  return false;
}

/** I2: whether a request's recommendation can use the pools (every pending plan and spec, and the rest of their folders):
 *  with --run-plan or --build-spec, or a docs/superpowers/ path in its text. Else forge route reads only the offered ones. */
export const needsPools = (o: { runPlan: boolean; buildSpec: boolean; text: string }): boolean =>
  o.runPlan || o.buildSpec || o.text.replace(/\\/g, '/').toLowerCase().includes('docs/superpowers/');

/**
 * K1-07, I2: the plan or the spec a request names, else the first (the most recent with work left). `entries` are every
 * pending one, newest first (not only the SP_MAX offered); `others`, the rest of their folder (done, cited, handed off,
 * declined or older than the window), are named only so that naming one never recommends another.
 * - A path into their folder (`docs/superpowers/plans/<file>`) decides alone: the entry with that file, else none.
 * - Else the longest name the text holds (T8: `cart-totals-v2` over `cart-totals`), among the entries and the others,
 *   6 characters or more (a short word names nothing). An entry: its path, its file name with or without `.md` and the
 *   date, or its title. One of the others: its path, its file name, or its stem with the date; its stem without the date
 *   and its title only when they have several words and the text holds them whole, so a common word («Refactor») never
 *   takes a pending plan's place. An entry's: that entry; one of the others': none.
 * - Nothing named: the first.
 */
export function namedOrFirst<T extends { path: string; title: string }>(entries: readonly T[], text: string, others: readonly SpNamed[] = []): T | undefined {
  const t = fold(text).replace(/\\/g, '/');
  const fileOf = (p: string) => fold(p).split('/').pop() ?? '';
  const stemOf = (p: string) => fileOf(p).replace(/\.md$/, '');
  const named = new Set<string>();
  for (const dir of new Set([...entries, ...others].map(e => fold(e.path).split('/').slice(0, -1).join('/')).filter(Boolean))) {
    // Each search starts where the last file ended, so a long request is read once per folder.
    for (let at = t.indexOf(`${dir}/`); at >= 0;) {
      NAMED_FILE.lastIndex = at + dir.length + 1;
      const file = NAMED_FILE.exec(t)?.[0] ?? '';
      // Without the punctuation that ends a sentence («… cart-totals.md.»).
      let end = file.length;
      while (end > 0 && '.:!?'.includes(file[end - 1])) end--;
      if (end) named.add(file.slice(0, end));
      at = t.indexOf(`${dir}/`, at + dir.length + 1 + file.length);
    }
  }
  if (named.size) return entries.find(e => named.has(fileOf(e.path)) || named.has(stemOf(e.path)));
  const longest = (e: SpNamed, offered: boolean) => {
    const stem = stemOf(e.path);
    const exact = [fold(e.path), fileOf(e.path), ...(DATE_PREFIX.test(stem) ? [stem] : [])];
    const loose = [stem.replace(DATE_PREFIX, ''), fold(e.title ?? '')];
    const held = [...exact, ...loose].filter(n => n.length >= 6 && t.includes(n)
      && (offered || exact.includes(n) || (/[\s_-]/.test(n.trim()) && holdsWhole(t, n))));
    return held.reduce((m, n) => Math.max(m, n.length), 0);
  };
  // Ties go to the entries, the most recent first.
  let best: { entry: T | undefined; length: number } = { entry: undefined, length: 0 };
  for (const e of entries) { const n = longest(e, true); if (n > best.length) best = { entry: e, length: n }; }
  for (const o of others) { const n = longest(o, false); if (n > best.length) best = { entry: undefined, length: n }; }
  return best.length ? best.entry : entries[0];
}

/** The options and the recommendation: a plan the request asks to carry out, then a spec it asks to build (K1-07: the one
 *  it names, else the most recent; I2: none when it names one that is not pending), else forge, Large included (K1-06:
 *  forge designs it with waypoint). Without superpowers: forge or no forge. A recent spec or plan the request does not
 *  ask for is only listed: it may be about another task. `pools`: what the request is matched against, every pending
 *  spec and plan and the rest of their folders (I2; `specs` and `plans`, the offered ones, when absent). */
export function routeOptions(i: {
  path: PathName; prefs: Prefs; superpowers: { installed: boolean; version: string | null }; specs: SpSpec[]; plans: SpPlanEntry[];
  runPlan: boolean; buildSpec: boolean; text?: string; pools?: { specs: SpPool<SpSpec>; plans: SpPool<SpPlanEntry> };
}): RouteOutput {
  const base = {
    workflow: i.prefs.workflow, autonomy: i.prefs.autonomy, sources: i.prefs.sources, superpowers: i.superpowers,
    specs: i.specs.map(s => s.path), plans: i.plans.map(p => ({ path: p.path, tasks: p.tasks, done: p.done })),
  };
  if (!i.superpowers.installed) {
    return { ...base, options: ['forge', 'none'], recommended: { option: 'forge', why: 'superpowers is not installed: forge triages, implements and reviews it' } };
  }
  const plan = namedOrFirst(i.pools?.plans.pending ?? i.plans, i.text ?? '', i.pools?.plans.others);
  const spec = namedOrFirst(i.pools?.specs.pending ?? i.specs, i.text ?? '', i.pools?.specs.others);
  let recommended: Recommendation;
  // The why names the plan or the spec, so the person can tell at the question whether it is the one they meant.
  if (i.runPlan && plan) {
    recommended = { option: 'superpowers-plan', why: `the unfinished superpowers plan ${plan.path} to carry out: forge executes and reviews each task`, plan: plan.path };
  } else if (i.buildSpec && spec) {
    recommended = { option: 'superpowers-design', why: `the recent superpowers spec ${spec.path}, not imported yet: forge builds from it`, spec: spec.path };
  } else if (i.path === 'large' && i.prefs.autonomy === 'auto') recommended = { option: 'forge', why: 'large, in auto mode: forge designs, critiques and approves it without asking' };
  else if (i.path === 'large') recommended = { option: 'forge', why: 'large: forge designs it with waypoint, critiques, plans and builds' };
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

/** route set removes the route files nobody wrote for this long: past ROUTE_REMINDER_MS a route is neither reminded nor carried. */
export const ROUTE_PRUNE_MS = 7 * 24 * 3600_000;
// At most this many names of .forge/route/ are looked at (one stat each) per call, so a folder of thousands of files stays
// cheap; route set's pruning keeps the folder to the routes of the last week, well under it.
const ROUTE_SCAN = 500;

/** The files of .forge/route/ (ROUTE_SCAN names at most) with their mtime. */
function routeEntries(root: string): { name: string; mtime: number }[] {
  let names: string[];
  try { names = readdirSync(routeDir(root)).slice(0, ROUTE_SCAN); } catch { return []; }
  return names.flatMap(name => {
    try {
      const st = statSync(path.join(routeDir(root), name));
      return st.isFile() ? [{ name, mtime: st.mtimeMs }] : [];
    } catch { return []; }
  });
}

/** The 50 routes written last, newest first: what route-session reads after /clear or in a fork (K1-13). */
export function listRoutes(root: string): RouteDoc[] {
  const newest = routeEntries(root).filter(e => e.name.endsWith('.json')).sort((a, b) => b.mtime - a.mtime).slice(0, 50);
  return newest.flatMap(({ name }) => {
    try {
      const doc = normalizeRoute(JSON.parse(readFileSync(path.join(routeDir(root), name), 'utf8')));
      return doc && `${doc.session}.json` === name ? [doc] : [];
    } catch { return []; }
  });
}

/** Removes the route files (and leftover temporary files) not written for ROUTE_PRUNE_MS; never `keep`'s own route. */
export function pruneRoutes(root: string, keep: string, now: number): void {
  for (const { name, mtime } of routeEntries(root)) {
    if (name === `${keep}.json` || now - mtime <= ROUTE_PRUNE_MS) continue;
    try { rmSync(path.join(routeDir(root), name), { force: true }); } catch { /* the next route set tries again */ }
  }
}

/** K1-13: the conversation of `session` ended (SessionEnd): its route records when and why; the latest end wins. */
export function endRoute(root: string, session: string, reason: RouteEndReason, at: string): void {
  const doc = readRoute(root, session);
  if (doc) writeRoute(root, { ...doc, endedAt: at, endReason: reason });
}

/** K1-13: the conversation of `session` started again (a SessionStart of the same id, e.g. claude --resume): its route
 *  is no longer ended. A route without an end is left as it was. */
export function reopenRoute(root: string, session: string): void {
  const doc = readRoute(root, session);
  if (!doc || (doc.endedAt === undefined && doc.endReason === undefined)) return;
  const live: RouteDoc = { ...doc };
  delete live.endedAt;
  delete live.endReason;
  writeRoute(root, live);
}

/** Where a route starts: superpowers designs (or plans) first, unless that spec (or plan) already exists. */
export function firstStage(chosen: RouteOption, has: { spec?: string; plan?: string }): RouteStage {
  if (chosen === 'superpowers-design' && !has.spec) return 'designing';
  if (chosen === 'superpowers-plan' && !has.plan) return 'designing';
  return 'handed-off';
}
