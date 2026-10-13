// forge's routing hooks (spec §5.2). SessionStart (`hook route-session`) puts the routing rule in the session's context;
// UserPromptSubmit (`hook route-prompt`) reminds a route half done, else hints at forge:route for coding work. Both fail
// open (any error prints nothing), stay silent where forge already drives the session or the user chose superpowers,
// and run no git beyond mainCheckout.
import { loadConfig } from './config.js';
import { readExecution } from './execution.js';
import { mainCheckout, readLocal } from './local.js';
import { memberForHook } from './members.js';
import { resolvePrefs } from './prefs.js';
import { readRoute, ROUTE_REMINDER_MS, type RouteDoc } from './route.js';
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

/** The reminder of a route half done (superpowers designs or plans, forge builds), for 24 hours after its last change. */
export function routeReminder(r: RouteDoc | null, now: number): string | null {
  if (!r || (r.stage !== 'designing' && r.stage !== 'planning')) return null;
  const t = Date.parse(r.ts);
  if (!Number.isFinite(t) || now - t > ROUTE_REMINDER_MS || t - now > 5 * 60_000) return null;
  if (r.chosen === 'superpowers-design') {
    return `forge: the user routed task ${r.task} as "${r.chosen}". When the spec is written and approved, hand off with forge:run --from-spec ${r.spec ?? '<the spec path>'} instead of writing-plans`;
  }
  if (r.chosen === 'superpowers-plan') {
    return `forge: the user routed task ${r.task} as "${r.chosen}". When the plan is written, hand off with forge:run --superpowers-plan ${r.plan ?? '<the plan path>'} instead of subagent-driven-development or executing-plans`;
  }
  return null;
}

// forge already drives this session: it coordinates or is a member of an active execution, or runs the infinite mode.
function forgeDrives(io: Io, main: string, sid: string | null): boolean {
  if (!sid) return false;
  const exec = readExecution(main);
  if (exec?.active && (exec.hookSession === sid || memberForHook(main, sid, exec.runId))) return true;
  const run = parseRun(readRunText(io.cwd));
  return !!run?.active && run.sessionId === sid;
}

export function hookRoute(io: Io, which: 'session' | 'prompt'): string {
  try {
    const input: unknown = JSON.parse(io.stdin ?? '');
    if (!input || typeof input !== 'object' || Array.isArray(input)) return '';
    const o = input as { session_id?: unknown; prompt?: unknown };
    const sid = typeof o.session_id === 'string' && o.session_id ? o.session_id : null;
    const main = mainCheckout(io.cwd);
    // With workflow: superpowers forge is optional again, as before routing existed.
    if (resolvePrefs({}, readLocal(io.cwd), loadConfig(io.cwd)).workflow === 'superpowers' || forgeDrives(io, main, sid)) return '';
    if (which === 'session') {
      const sp = locateSuperpowers({ configDir: claudeConfigDir(io.env ?? process.env), projectDir: main });
      return JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: routingRule(sp.installed) } });
    }
    const text = routeReminder(readRoute(io.cwd), io.now().getTime())
      ?? (typeof o.prompt === 'string' && looksLikeCoding(o.prompt) ? ROUTE_HINT : null);
    return text ? JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: text } }) : '';
  } catch { return ''; }
}
