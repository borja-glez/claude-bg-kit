// forge's routing hooks. SessionStart (`hook route-session`) puts the routing rule in the session's context;
// UserPromptSubmit (`hook route-prompt`) reminds a route half done, else hints at forge:route for coding work. Both fail
// open (any error prints nothing), stay silent outside a git repository, where forge already drives the session or the
// user chose superpowers (or off: local.yaml, config.yaml or FORGE_WORKFLOW), and run no git beyond mainCheckout's.
// After a compaction (`source: compact`), route-session tells a session the forge task or the infinite run it has in
// progress.
import path from 'node:path';
import { loadConfig, type ForgeConfig } from './config.js';
import { readExecution } from './execution.js';
import { readStatuses } from './ledger.js';
import { readLocal, repoCheckout } from './local.js';
import { memberForHook } from './members.js';
import { isSafeId } from '../lib/execution-state.js';
import type { ForgeStatus } from '../lib/forge-status.js';
import { planLocale, sessionReply } from '../lib/locale.js';
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

// Coding verbs in Spanish and English (scripts/route-eval calibrates the list).
const VERBS = [
  'crea', 'crear', 'añade', 'añadir', 'agrega', 'agregar', 'implementa', 'implementar', 'arregla', 'arreglar', 'corrige', 'corregir',
  'refactoriza', 'refactorizar', 'monta', 'montar', 'construye', 'construir', 'migra', 'migrar', 'cambia', 'cambiar', 'desarrolla', 'desarrollar',
  'build', 'builds', 'add', 'adds', 'implement', 'implements', 'fix', 'fixes', 'refactor', 'create', 'creates', 'migrate', 'change', 'develop',
];
const VERB = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${VERBS.join('|')})(?![\\p{L}\\p{N}_])`, 'iu');
const METHOD = /(?<![\p{L}\p{N}_])(?:forge|superpowers)(?![\p{L}\p{N}_])/iu;

// K1-03: what is not a request to change code. A message from an agent or the harness (it opens with a tag), a question
// (¿…, …?) that is not a polite request, and a prompt that opens with an interrogative. «Como» without its accent opens a
// request («Como usuario, quiero…»), so the Spanish interrogatives need theirs.
// Only the tags of the harness and of agents; a prompt that opens with JSX or HTML («<Button> add a state…») is a request.
const TAGGED = /^<(?:teammate-message|agent-message|task-notification|system-reminder|command-|local-command-|user-prompt-submit-hook)/i;
// A polite request, after a short lead («hola,», «please»). Every pattern is anchored and has no nested quantifier.
const POLITE = /^(?:(?:hola|oye|hi|hello|please|por favor)[,\s]+){0,3}¿?\s*(?:me\s+)?(?:puedes|podrías|podrias|puede|podría|podria|podéis|podeis|podemos|can you|could you|would you|will you|can we|could we)(?![\p{L}\p{N}_])/iu;
const INTERROGATIVE = /^¿?\s*(?:qué|cómo|por qué|what|how|why)(?![\p{L}\p{N}_])/iu;
// A first clause that opens with a coding verb is an order, whatever follows it («…, ¿vale?», «…. ¿Por qué falla?»).
const IMPERATIVE = new RegExp(`^(?:${VERBS.join('|')})(?![\\p{L}\\p{N}_])`, 'iu');

// w8 FR2: the hint is for requests to build (a feature, a fix, a refactor, a new project). A request is read clause by
// clause (a sentence, or what «y», "and", "then"… join), and gets the hint when one clause has a coding verb and is
// none of these: a git operation, a typo, a rename or a translation, a text that is not code (an email, a summary, a
// meeting, a README…), a single value changed, a debug print, an artifact built, or a request for information. Every
// pattern is bounded; only the first HINT_TEXT characters are read clause by clause.
const NB = '(?<![\\p{L}\\p{N}_])';
const NE = '(?![\\p{L}\\p{N}_])';
const re = (...alts: string[]) => new RegExp(alts.join('|'), 'iu');
const HINT_TEXT = 4000;
const CLAUSE_BREAK = /[.;!?]+(?=\s|$)|[¿\n]|,?\s+(?:y\s+luego|y\s+después|and\s+then|y|e|and|then|luego|después|despues)\s+/iu;
// The lead of a clause: a greeting, a courtesy, «me», «¿puedes…», before its verb.
const LEAD = '^\\s*(?:(?:hola|oye|hi|hello|hey|please|por\\s+favor|puedes|podr[ií]as|can\\s+you|could\\s+you|would\\s+you|me)[,\\s]+){0,3}';
const GIT_OP = re(
  // a commit to make («crea un commit», «añade … a un commit nuevo»), never a commit hook
  `${NB}(?:crea|crear|haz|hacer|create|make|do|añade|añadir|add|agrega|agregar|mete|meter|put)${NE}(?:\\s+\\S+){0,4}?\\s+commits?${NE}(?!\\s*-?\\s*hooks?${NE})`,
  `${NB}commit(?:ea|ear|eo)?\\s+(?:the|these|this|those|all|my|your|our|it|them|everything|los|las|estos|estas|esto|eso|todo|el|la|lo)${NE}`, `${NB}commite(?:a|ar|o|ad)${NE}`,
  `${NB}(?:crea|crear|abre|abrir|haz|hacer|prepara|preparar|create|open|make|raise|submit|send|manda|mandar)${NE}(?:\\s+\\S+){0,3}?\\s+(?:PRs?|pull\\s+requests?|merge\\s+requests?|MRs?)${NE}`,
  `${NB}(?:haz|hacer|do|make)\\s+(?:un\\s+|el\\s+|a\\s+)?push${NE}`, `${NB}pushe(?:a|ar|o|ad)\\p{L}*`,
  `${NB}push\\s+(?:it|them|this|that|everything|all|the\\s+(?:changes|branch|commits?|tags?)|los\\s+cambios|la\\s+rama|el\\s+commit|los\\s+commits|to\\s+(?:origin|the\\s+remote|github|gitlab|main|master)|a\\s+(?:origin|main|master|github|gitlab)|al\\s+remoto)${NE}`,
  `${NB}git\\s+(?:push|commit|merge|rebase|tag|cherry-pick|stash|checkout|switch|branch)${NE}`,
  `${NB}merge(?:a|ar|ea|ear)?(?:\\s+\\S+){0,3}?\\s+(?:branch|rama|PR|pull\\s+request)${NE}`, `${NB}merge(?:a|ar|ea|ear)?\\s+\\S+\\s+(?:into|in|onto|en|a|con)\\s+(?:main|master|develop|dev|trunk)${NE}`,
  `${NB}(?:haz|hacer|do)\\s+(?:el\\s+|un\\s+|a\\s+)?merge${NE}`, `${NB}fusiona\\p{L}*\\s+(?:la\\s+|las\\s+|esta\\s+)?ramas?${NE}`,
  `${NB}(?:rebase|squash|cherry-?pick)\\p{L}*`,
  `${NB}tag(?:ea|uea)?(?:\\s+\\S+){0,2}?\\s+v?\\d+\\.\\d+`, `${NB}etiqueta\\s+(?:la\\s+)?versi[oó]n${NE}`,
  `${NB}(?:crea|crear|create|make|haz|abre|open)\\s+(?:a\\s+|an\\s+|una\\s+|the\\s+|la\\s+)?(?:new\\s+|nueva\\s+)?(?:git\\s+)?(?:branch|rama)${NE}`,
);
// In a request with a git operation, the conflicts are the merge's or the rebase's.
const CONFLICTS = re(`${NB}(?:conflicts?|conflictos?)${NE}`);
const MECHANICAL = re(`${NB}(?:typos?|erratas?|spelling|misspell\\p{L}*|ortograf\\p{L}*)${NE}`, `${NB}(?:renam|renombr)\\p{L}*`,
  `${NB}(?:change|cambia|cambiar)\\s+(?:the\\s+|el\\s+)?(?:name|nombre)\\s+(?:of|de|del)${NE}`);
const TRANSLATION = re(`${NB}(?:translat|tradu[cz])\\p{L}*`);
const I18N = re(`${NB}(?:i18n|l10n|internacionaliz\\p{L}*|internationali[sz]\\p{L}*|soporte|support|idiomas|languages|locales?)${NE}`);
// A text that is not code: README and CHANGELOG always; an email, a summary, a meeting… when it is written about (a
// determiner before it), no clause opens with a fix, and the request names no code (a file, a component, a service…).
const NOTES = re(`${NB}(?:readme|changelog|release\\s+notes|notas\\s+de\\s+(?:la\\s+)?versi[oó]n)${NE}`);
const PROSE = re(`${NB}(?:el|la|los|las|un|una|unos|unas|este|esta|estos|estas|ese|esa|al|del|mi|tu|su|nuestro|nuestra|the|a|an|this|that|these|those|my|your|our)\\s+`
  + `(?:correos?|e-?mails?|mails?|resumen|res[uú]menes|summary|summaries|actas?|minutes|reuni[oó]n|reuniones|meetings?|tono|tone|cartas?|letters?|art[ií]culos?|articles?|posts?`
  + `|informes?|reports?|documentos?|documents?|presentaci[oó]n|presentations?|diapositivas|slides|newsletters?|propuestas?|proposals?|ensayos?|essays?|discursos?|speech(?:es)?|notas|notes)${NE}`);
const CODE = re(`${NB}(?:endpoints?|apis?|funci[oó]n|funciones|functions?|m[eé]todos?|methods?|clases?|class(?:es)?|componentes?|components?|m[oó]dulos?|modules?|servicios?|services?`
  + `|bot[oó]n|botones|buttons?|formularios?|forms?|p[aá]ginas?|pages?|pantallas?|screens?|vistas?|views?|rutas?|routes?|tests?|scripts?|hooks?|bugs?|c[oó]digo|code|apps?|aplicaci[oó]n`
  + `|cli|comandos?|commands?|campos?|fields?|tablas?|tables?|database|query|queries|consultas?|backend|frontend|servidor|server|handlers?|controlador|controllers?|validaci[oó]n|validation`
  + `|login|plantillas?|templates?|esquemas?|schemas?|css|html|sql|plugins?|widgets?)${NE}`, `[\\w-]+\\.(?:[cm]?[jt]sx?|py|java|kt|go|rs|rb|php|cs|s?css|html|vue|svelte|json|ya?ml|sql|sh)${NE}`);
const FIX_LED = new RegExp(`${LEAD}(?:arregla|arreglar|corrige|corregir|repara|reparar|soluciona|solucionar|fix|repair|solve)${NE}`, 'iu');
// One value changed: «cambia el color del botón a azul», "change the timeout from 30 to 60".
const TWEAK = new RegExp(`${LEAD}(?:cambia|cambiar|change)\\s+(?:the\\s+|el\\s+|la\\s+|los\\s+|las\\s+)?(?:\\S+\\s+){0,2}?`
  + `(?:colou?rs?|colores|texto|text|t[ií]tulo|title|etiqueta|label|timeout|valor|value|tama[nñ]o|size|margen|margin|padding|fuente|font|icono|icon|puerto|port|l[ií]mite|limit`
  + `|versi[oó]n|version|delay|retraso|intervalo|interval)${NE}[^\\n]*?\\s(?:to|a|al|por|from)\\s`, 'iu');
const DEBUG = re(`${NB}console\\.(?:log|debug|warn|error|info)${NE}`, `${NB}print(?:ln|f)?\\s*\\(`, `${NB}print\\s+statements?${NE}`,
  `${NB}(?:para\\s+(?:poder\\s+)?depurar|to\\s+debug|so\\s+(?:that\\s+)?I\\s+can\\s+debug)${NE}`);
const ARTIFACT = re(`${NB}(?:build|rebuild|compile|compila|compilar|construye|construir|genera|generar|generate)\\s+(?:the|la|el|las|los)\\s+(?:docker\\s+|production\\s+|release\\s+)?`
  + `(?:images?|imagen(?:es)?|containers?|contenedor(?:es)?|bundles?|binar(?:y|ies)|binarios?|apks?|jars?|wheels?|artifacts?|artefactos?)${NE}`);
const INFO = new RegExp(`${LEAD}(?:expl[ií]ca(?:me)?|explicar|explain|describe|descr[ií]beme|describir|dime|decir(?:me)?|tell\\s+me|cu[eé]ntame|contar(?:me)?|res[uú]me(?:me)?|resumir|summari[sz]e`
  + `|mu[eé]strame|mostrar(?:me)?|show\\s+me|ens[eé][ñn]ame|enseñar(?:me)?|revisa|revisar|review|analiza|analizar|analy[sz]e|compara|comparar|compare|eval[uú]a|evaluar|evaluate`
  + `|investiga|investigar|investigate|averigua|averiguar)${NE}`, 'iu');

/** w8 FR2: one clause of a request asks to build: a coding verb, and none of the requests the hint leaves out. */
function builds(clause: string, gitInRequest: boolean, namesCode: boolean): boolean {
  if (!VERB.test(clause) || GIT_OP.test(clause) || (gitInRequest && CONFLICTS.test(clause))) return false;
  if (MECHANICAL.test(clause) || (TRANSLATION.test(clause) && !I18N.test(clause)) || NOTES.test(clause)) return false;
  if (PROSE.test(clause) && !namesCode && !FIX_LED.test(clause)) return false;
  return !TWEAK.test(clause) && !DEBUG.test(clause) && !ARTIFACT.test(clause) && !INFO.test(clause);
}

/** A prompt worth the routing hint: not a slash command nor a tagged message, not a question (a polite request still
 *  counts) nor an interrogative, six words or more, a coding verb, no method named, and a clause that asks to build. */
export function looksLikeCoding(prompt: string): boolean {
  const p = prompt.trim();
  if (!p || p.startsWith('/') || TAGGED.test(p)) return false;
  if (INTERROGATIVE.test(p)) return false;
  const asks = p.startsWith('¿') || p.endsWith('?') || p.includes('¿');
  if (asks && !POLITE.test(p) && !IMPERATIVE.test(p.split(/[¿.!?]/, 1)[0].trim())) return false;
  if (p.split(/\s+/).length < 6 || !VERB.test(p) || METHOD.test(p)) return false;
  const text = p.slice(0, HINT_TEXT);
  const clauses = text.split(CLAUSE_BREAK).map(c => (c ?? '').trim()).filter(Boolean);
  const git = clauses.some(c => GIT_OP.test(c));
  const namesCode = CODE.test(text);
  return clauses.some(c => builds(c, git, namesCode));
}

/** K1-03: route-prompt's hint, unless FORGE_ROUTE_HINT=off (route-eval) or `route.hint: off` in .forge/config.yaml. */
export function hintOn(env: Record<string, string | undefined>, config: ForgeConfig): boolean {
  return env.FORGE_ROUTE_HINT !== 'off' && config.route?.hint !== 'off';
}

/** A route changed in the last 24 hours (and not in the future). */
function fresh(r: RouteDoc, now: number): boolean {
  const t = Date.parse(r.ts);
  return Number.isFinite(t) && now - t <= ROUTE_REMINDER_MS && t - now <= 5 * 60_000;
}

/** The reminder of a route half done (superpowers designs or plans, forge builds), for 24 hours after its last change. It
 *  covers whatever brainstorming ends with: a spec, a plan or no file. The spec and plan hand-offs close the route
 *  themselves; a plain forge:run does not, so the hand-over without a file names the command that does. */
export function routeReminder(r: RouteDoc | null, now: number): string | null {
  if (!r || (r.stage !== 'designing' && r.stage !== 'planning') || !fresh(r, now)) return null;
  if (r.chosen !== 'superpowers-design' && r.chosen !== 'superpowers-plan') return null;
  // Without a session (never so in the hooks, whose routes all have one) the command takes the environment's id.
  const close = `FORGE route stage --stage handed-off${r.session ? ` --session ${r.session}` : ''}`;
  // w8 FR6: it rides on every message of the person while the route is half done, the one that approves the spec
  // included, and wins over the next step a superpowers skill names by naming the person's choice and the rule of
  // using-superpowers that puts the user's instructions above its skills (brainstorming 7.0.0's gate names writing-plans).
  const who = r.by === 'auto' ? "the user's auto mode chose" : 'the user chose';
  const choice = r.chosen === 'superpowers-design' ? '«superpowers designs, forge builds»' : '«superpowers plans, forge executes»';
  const lead = `forge: ${who} ${choice} for task ${r.task} ("${r.chosen}"). using-superpowers puts the user's instructions above its skills, so this choice wins over the next step a superpowers skill names`;
  if (r.chosen === 'superpowers-design') {
    return `${lead}: brainstorming's "invoke superpowers:writing-plans and no other skill" gives way to it. When the spec is written and approved, hand off with forge:run --from-spec ${r.spec ?? '<the spec path>'} instead of writing-plans. If brainstorming ends without a spec (a quick task, a small change agreed in the chat, the questions skipped), do not build it: write the decisions to .forge/work/${r.task}/task.txt, run ${close} and invoke forge:run`;
  }
  return `${lead}. When the plan is written, hand off with forge:run --superpowers-plan ${r.plan ?? '<the plan path>'} instead of subagent-driven-development or executing-plans. If brainstorming ends without a spec or a plan (a quick task, a small change agreed in the chat, the questions skipped), do not build it: write the decisions to .forge/work/${r.task}/task.txt, run ${close} and invoke forge:run`;
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
// has a forge task of its own open (K1-12: one of its statuses names this session, is not done and moved in the last 24 h).
// forge writes status.json where its commands run: the session's directory, which is the main checkout's top level
// unless the session started in a subdirectory, so both are read. The infinite run is the main checkout's (K2-01:
// infinite start saves it there), else one an older forge left where the session runs: runRootOf's rule.
function forgeDrives(io: Io, main: string, sid: string | null): boolean {
  if (!sid) return false;
  const exec = readExecution(main);
  if (exec?.active && (exec.hookSession === sid || memberForHook(main, sid, exec.runId))) return true;
  const run = parseRun(readRunText(main)) ?? parseRun(readRunText(io.cwd));
  if (run?.active && run.sessionId === sid) return true;
  return openTasks(io, main, sid).length > 0;
}

/**
 * K1-12's rule: this session's forge tasks not done and moved in the last OPEN_TASK_MS, read in io.cwd and the main
 * checkout, newest first (lastAt, else ts). K1-12 with C5: the alias is the task that changed last, of any session, so
 * every status of the folder is read; M6: but not a file untouched for longer than an open task lasts, which is skipped
 * by its mtime unread.
 */
export function openTasks(io: Io, main: string, sid: string): ForgeStatus[] {
  const now = io.now().getTime();
  const at = (st: ForgeStatus) => Date.parse(st.lastAt ?? st.ts);
  return [...new Set([io.cwd, main])]
    .flatMap(dir => Object.values(readStatuses(dir, { maxAgeMs: OPEN_TASK_MS, now })))
    .filter(st => st.session === sid && st.doneAt === null && Number.isFinite(at(st)) && now - at(st) < OPEN_TASK_MS)
    .sort((a, b) => at(b) - at(a));
}

export const COMPACT_RUN = 'invoke forge:run again before the next step';
export const COMPACT_INFINITE = 'invoke forge:infinite again before the next step';

/**
 * w7 A2: what a session that just compacted has in progress (English: the model reads it), or null. The infinite run
 * of the session first (the main checkout's, else the one an older forge left where the session runs); the coordinator
 * or member of an active execution without it gets null, hook live answers it. Else its newest open forge task. Every
 * value a crafted status could carry is checked before it reaches the model's context.
 */
export function compactText(io: Io, main: string, sid: string): string | null {
  const found = parseRun(readRunText(main)) ?? parseRun(readRunText(io.cwd));
  const infinite = found?.active && found.sessionId === sid ? found : null;
  if (!infinite) {
    const exec = readExecution(main);
    if (exec?.active && (exec.hookSession === sid || memberForHook(main, sid, exec.runId))) return null;
  }
  const st = openTasks(io, main, sid).find(s => isSafeId(s.task) && ['trivial', 'small', 'medium', 'large'].includes(s.path)) ?? null;
  if (!infinite && !st) return null;
  let parts = '';
  if (st) {
    const list = [`path ${st.path}`];
    if (/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(st.phase)) list.push(`phase ${st.phase}`);
    if (st.brief !== null) list.push(`brief ${st.brief}`);
    if (st.round !== null) list.push(st.cap !== null ? `round ${st.round} of ${st.cap}` : `round ${st.round}`);
    parts = list.join(', ');
  }
  const text = infinite
    ? `forge: this session runs the forge infinite mode (cycle ${infinite.cycle})${st ? `, on the forge task ${st.task} (${parts})` : ''}. After the compaction, ${COMPACT_INFINITE}, and go on from where the cycle is.`
    : `forge: this session has the forge task ${st!.task} open (${parts}). After the compaction, ${COMPACT_RUN}, and go on from where the task is.`;
  return text + (sessionReply(infinite, null, () => planLocale(main, st?.project ?? null)) ?? '');
}

export function hookRoute(io: Io, which: 'session' | 'prompt'): string {
  try {
    const input: unknown = JSON.parse(io.stdin ?? '');
    if (!input || typeof input !== 'object' || Array.isArray(input)) return '';
    const o = input as { session_id?: unknown; prompt?: unknown; source?: unknown };
    const sid = typeof o.session_id === 'string' && o.session_id ? o.session_id : null;
    // K1-09: in a task or run worktree of forge, forge drives whatever happens: no rule and no hint.
    if (inForgeWorktree(io.cwd)) return '';
    const repo = repoCheckout(io.cwd);
    const main = repo ?? io.cwd;
    // w7 A2: after a compaction the session is told the forge task or infinite run it has in progress; neither the
    // workflow nor a broken config below silences it.
    if (which === 'session' && o.source === 'compact' && sid) {
      const recall = compactText(io, main, sid);
      if (recall) return JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: recall } });
    }
    // w8 FR2: outside a git repository there is nothing for forge to build on (forge:run needs one): no rule, no hint
    // and no reminder.
    if (!repo) return '';
    // With workflow: superpowers forge is optional again, as before routing existed; with off it stays out. The config is
    // read once, here, for the workflow and the hint; an invalid one throws, and the hook says nothing (fail open). w8
    // FR1: below local.yaml and config.yaml, the person's FORGE_WORKFLOW decides it for every project.
    const config = loadConfig(io.cwd);
    const workflow = resolvePrefs({}, readLocal(io.cwd), config, io.env ?? process.env).workflow;
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
    // K1-03: the hint can be turned off; a route half done is reminded anyway.
    const text = reminder ?? (typeof o.prompt === 'string' && looksLikeCoding(o.prompt) && hintOn(io.env ?? process.env, config) ? ROUTE_HINT : null);
    return text ? JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: text } }) : '';
  } catch { return ''; }
}
