// forge's routing hooks (spec §5.2). SessionStart (`hook route-session`) puts the routing rule in the session's context;
// UserPromptSubmit (`hook route-prompt`) reminds a route half done, else hints at forge:route for coding work. Both fail
// open (any error prints nothing), stay silent where forge already drives the session or the user chose superpowers
// (or off) in local.yaml, and run no git beyond mainCheckout.
import path from 'node:path';
import { loadConfig } from './config.js';
import { readExecution } from './execution.js';
import { readStatus } from './ledger.js';
import { mainCheckout, readLocal } from './local.js';
import { memberForHook } from './members.js';
import { resolvePrefs } from './prefs.js';
import { listRoutes, readRoute, ROUTE_REMINDER_MS, type RouteDoc } from './route.js';
import { parseRun, readRunText } from './run.js';
import { claudeConfigDir, locateSuperpowers } from './superpowers.js';
import type { Io } from './cli/run.js';

/** The rule SessionStart puts in a new session (English: it speaks to the model). Calibrated by scripts/route-eval. */
export function routingRule(superpowers: boolean): string {
  const others = superpowers
    ? 'any other process skill — superpowers:brainstorming, writing-plans,\nsystematic-debugging and test-driven-development included'
    : 'any other process skill';
  return [
    '<FORGE-ROUTING>',
    'forge routing rule. Before you answer a request to write or change code (a feature, a fix,',
    'a refactor, a new project) that is more than a trivial edit, invoke the forge:route skill',
    `FIRST, before ${others}. forge:route triages the request`,
    'and decides (or asks the user once) whether forge, superpowers or a mix handles it; it steps',
    'aside for trivial and small work. Skip it only when the user already named the method',
    '("con forge", "sin forge", "with superpowers") or typed a slash command. Subagents ignore this.',
    '</FORGE-ROUTING>',
  ].join('\n');
}

export const ROUTE_HINT = 'forge: this looks like coding work. If it is more than a trivial edit, invoke forge:route first, before any other skill.';

// Coding verbs in Spanish and English (spec §5.2; scripts/route-eval calibrates the list).
const VERBS = [
  'crea', 'crear', 'añade', 'añadir', 'agrega', 'agregar', 'implementa', 'implementar', 'arregla', 'arreglar', 'corrige', 'corregir',
  'refactoriza', 'refactorizar', 'monta', 'montar', 'construye', 'construir', 'migra', 'migrar', 'cambia', 'cambiar', 'desarrolla', 'desarrollar',
  'build', 'builds', 'add', 'adds', 'implement', 'implements', 'fix', 'fixes', 'refactor', 'create', 'creates', 'migrate', 'change', 'develop',
];
const VERB = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${VERBS.join('|')})(?![\\p{L}\\p{N}_])`, 'iu');
const METHOD = /(?<![\p{L}\p{N}_])(?:forge|superpowers)(?![\p{L}\p{N}_])/iu;

/** A prompt worth the routing hint: not a slash command, six words or more, a coding verb, and no method named. */
export function looksLikeCoding(prompt: string): boolean {
  const p = prompt.trim();
  return !!p && !p.startsWith('/') && p.split(/\s+/).length >= 6 && VERB.test(p) && !METHOD.test(p);
}

/** A route changed in the last 24 hours (and not in the future). */
function fresh(r: RouteDoc, now: number): boolean {
  const t = Date.parse(r.ts);
  return Number.isFinite(t) && now - t <= ROUTE_REMINDER_MS && t - now <= 5 * 60_000;
}

/** The reminder of a route half done (superpowers designs or plans, forge builds), for 24 hours after its last change. */
export function routeReminder(r: RouteDoc | null, now: number): string | null {
  if (!r || (r.stage !== 'designing' && r.stage !== 'planning') || !fresh(r, now)) return null;
  if (r.chosen === 'superpowers-design') {
    return `forge: the user routed task ${r.task} as "${r.chosen}". When the spec is written and approved, hand off with forge:run --from-spec ${r.spec ?? '<the spec path>'} instead of writing-plans`;
  }
  if (r.chosen === 'superpowers-plan') {
    return `forge: the user routed task ${r.task} as "${r.chosen}". When the plan is written, hand off with forge:run --superpowers-plan ${r.plan ?? '<the plan path>'} instead of subagent-driven-development or executing-plans`;
  }
  return null;
}

/** K1-12: a forge task of this session counts as open this long after its last event. */
export const OPEN_TASK_MS = 24 * 3600_000;
/**
 * K1-13: after /clear, the earlier conversation's half-done route is named when it ended this recently. One /clear fires
 * its SessionEnd and the new SessionStart back to back, so a narrow window is enough, and it keeps a /clear in another
 * conversation from carrying this conversation's route (K1-04).
 */
export const CLEAR_CARRY_MS = 2 * 60_000;

/** K1-09: a task worktree or the run worktree of forge (`.claude/worktrees/task-*`, `run`): forge drives whatever happens there. */
export const inForgeWorktree = (cwd: string): boolean => /[\\/]\.claude[\\/]worktrees[\\/](?:task-[^\\/]+|run)(?:[\\/]|$)/.test(path.resolve(cwd));

/**
 * K1-13: the line route-session adds after the rule. After /clear, the half-done route the earlier conversation ended by
 * /clear in the last 2 minutes (the newest end when several did); in a fork, the only half-done route of a conversation
 * still open. A reminder, never a copy: the route stays that session's, so the line names it and the command that closes
 * it once handed off.
 */
export function carriedRoute(routes: readonly RouteDoc[], source: string, sid: string | null, now: number): string | null {
  const half = (r: RouteDoc) => r.session !== sid && routeReminder(r, now) !== null;
  const close = (r: RouteDoc) => `${routeReminder(r, now)}. Once handed off, close that route with FORGE route stage --stage handed-off --session ${r.session}`;
  if (source === 'clear') {
    const endedAt = (r: RouteDoc) => Date.parse(r.endedAt ?? '');
    const r = routes.filter(x => half(x) && x.endReason === 'clear' && now - endedAt(x) <= CLEAR_CARRY_MS && endedAt(x) - now <= 5 * 60_000)
      .sort((a, b) => endedAt(b) - endedAt(a))[0];
    return r ? `forge: before /clear this conversation routed task ${r.task} as "${r.chosen}" and it is half done (${r.stage}). ${close(r)}` : null;
  }
  if (source === 'fork') {
    const open = routes.filter(x => half(x) && !x.endedAt);
    return open.length === 1 ? `forge: the original conversation routed task ${open[0].task} as "${open[0].chosen}" and it is half done (${open[0].stage}). ${close(open[0])}` : null;
  }
  return null;
}

// forge already drives this session: it coordinates or is a member of an active execution, runs the infinite mode, or
// has a forge task of its own open (K1-12: its status.json names this session, is not done and moved in the last 24 h).
// forge writes status.json where its commands run: the session's directory, which is the main checkout's top level
// unless the session started in a subdirectory, so both are read. The infinite run is the main checkout's (K2-01:
// infinite start saves it there), else one an older forge left where the session runs: runRootOf's rule.
function forgeDrives(io: Io, main: string, sid: string | null): boolean {
  if (!sid) return false;
  const exec = readExecution(main);
  if (exec?.active && (exec.hookSession === sid || memberForHook(main, sid, exec.runId))) return true;
  const run = parseRun(readRunText(main)) ?? parseRun(readRunText(io.cwd));
  if (run?.active && run.sessionId === sid) return true;
  return [...new Set([io.cwd, main])].some(dir => {
    const st = readStatus(dir);
    const last = st ? Date.parse(st.lastAt ?? st.ts) : NaN;
    return !!st && st.session === sid && st.doneAt === null && Number.isFinite(last) && io.now().getTime() - last < OPEN_TASK_MS;
  });
}

export function hookRoute(io: Io, which: 'session' | 'prompt'): string {
  try {
    const input: unknown = JSON.parse(io.stdin ?? '');
    if (!input || typeof input !== 'object' || Array.isArray(input)) return '';
    const o = input as { session_id?: unknown; prompt?: unknown; source?: unknown };
    const sid = typeof o.session_id === 'string' && o.session_id ? o.session_id : null;
    // K1-09: in a task or run worktree of forge, forge drives whatever happens: no rule and no hint.
    if (inForgeWorktree(io.cwd)) return '';
    const main = mainCheckout(io.cwd);
    // With workflow: superpowers forge is optional again, as before routing existed; with off it stays out.
    const workflow = resolvePrefs({}, readLocal(io.cwd), loadConfig(io.cwd)).workflow;
    if (workflow === 'superpowers' || workflow === 'off' || forgeDrives(io, main, sid)) return '';
    if (which === 'session') {
      const sp = locateSuperpowers({ configDir: claudeConfigDir(io.env ?? process.env), projectDir: main });
      // K1-13: after /clear or in a fork, the route the earlier conversation left half done follows the rule.
      const carried = typeof o.source === 'string' ? carriedRoute(listRoutes(main), o.source, sid, io.now().getTime()) : null;
      return JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: routingRule(sp.installed) + (carried ? `\n${carried}` : '') } });
    }
    const now = io.now().getTime();
    // K1-04: a route is its session's own file; another session's route neither reminds nor silences this one.
    const own = readRoute(main, sid);
    const reminder = routeReminder(own, now);
    // A session that routed its request recently gets no hint on its follow-up prompts until the route is done.
    if (!reminder && own && own.stage !== 'done' && fresh(own, now)) return '';
    const text = reminder ?? (typeof o.prompt === 'string' && looksLikeCoding(o.prompt) ? ROUTE_HINT : null);
    return text ? JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: text } }) : '';
  } catch { return ''; }
}
