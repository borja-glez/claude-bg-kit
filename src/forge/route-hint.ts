// forge's routing hint (UserPromptSubmit, `hook route-prompt`): whether a prompt asks to build code (a feature, a fix,
// a refactor, a new project) and so is worth the one-line hint to invoke forge:route. Heuristics on the prompt's words
// only (scripts/route-eval calibrates them); the hook in route-hooks.ts decides when to say it.

// Coding verbs in Spanish and English (scripts/route-eval calibrates the list). w8 fix round 1: «haz que», «mejora»,
// «soluciona», «actualiza», improve, solve, update and "make … work" too.
const VERBS = [
  'crea', 'crear', 'añade', 'añadir', 'agrega', 'agregar', 'implementa', 'implementar', 'arregla', 'arreglar', 'corrige', 'corregir',
  'refactoriza', 'refactorizar', 'monta', 'montar', 'construye', 'construir', 'migra', 'migrar', 'cambia', 'cambiar', 'desarrolla', 'desarrollar',
  'mejora', 'mejorar', 'soluciona', 'solucionar', 'actualiza', 'actualizar',
  'build', 'builds', 'add', 'adds', 'implement', 'implements', 'fix', 'fixes', 'refactor', 'create', 'creates', 'migrate', 'change', 'develop',
  'improve', 'improves', 'solve', 'solves', 'update', 'updates',
  'haz\\s+que', 'make(?:\\s+\\S+){1,5}?\\s+work',
];
const NB = '(?<![\\p{L}\\p{N}_])';
const NE = '(?![\\p{L}\\p{N}_])';
const VERB = new RegExp(`${NB}(?:${VERBS.join('|')})${NE}`, 'iu');
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
const IMPERATIVE = new RegExp(`^(?:${VERBS.join('|')})${NE}`, 'iu');

// w8 FR2: the hint is for requests to build. A request is read clause by clause (a sentence, or what «y», "and",
// "then"… join), and gets the hint when one clause has a coding verb and is none of these: a git operation, a typo, a
// rename or a translation, a text that is not code (an email, a summary, a meeting, a README…), an issue or ticket for
// a tracker, a single value changed, a debug print added, an artifact built, or a request for information. Every
// pattern is bounded. Fix round 1: of a long prompt, its head and its tail are read (a request after a pasted log).
const re = (...alts: string[]) => new RegExp(alts.join('|'), 'iu');
const HEAD = 2000;
const TAIL = 2000;
const CLAUSE_BREAK = /[.;!?]+(?=\s|$)|[¿\n]|,?\s+(?:y\s+luego|y\s+después|and\s+then|y|e|and|then|luego|después|despues)\s+/iu;
// The lead of a clause: a greeting, a courtesy, «me», «¿puedes…», before its verb.
const LEAD = '^\\s*(?:(?:hola|oye|hi|hello|hey|please|por\\s+favor|puedes|podr[ií]as|can\\s+you|could\\s+you|would\\s+you|me)[,\\s]+){0,3}';
// What a commit word names when it is code: a hook, the hash shown in a footer, a message linter…
const COMMIT_CODE = '(?:hooks?|hash(?:es)?|sha|ids?|messages?|msgs?|linter|lint|info|date|author|count|history|log)';
const GIT_OP = re(
  // a commit to make («crea un commit», «añade … a un commit nuevo»), never a commit hook, hash or message linter
  `${NB}(?:crea|crear|haz|hacer|create|make|do|añade|añadir|add|agrega|agregar|mete|meter|put)${NE}(?:\\s+\\S+){0,4}?\\s+commits?${NE}(?!\\s*-?\\s*${COMMIT_CODE}${NE})`,
  `${NB}commit(?:ea|ear|eo)?\\s+(?:the|these|this|those|all|my|your|our|it|them|everything|los|las|estos|estas|esto|eso|todo|el|la|lo)${NE}`, `${NB}commite(?:a|ar|o|ad)${NE}`,
  `${NB}(?:crea|crear|abre|abrir|haz|hacer|prepara|preparar|create|open|make|raise|submit|send|manda|mandar|update|actualiza|actualizar|edit|edita|editar)${NE}(?:\\s+\\S+){0,3}?\\s+(?:PRs?|pull\\s+requests?|merge\\s+requests?|MRs?)${NE}`,
  `${NB}(?:haz|hacer|do|make)\\s+(?:un\\s+|el\\s+|a\\s+)?push${NE}`, `${NB}pushe(?:a|ar|o|ad)\\p{L}*`,
  `${NB}push\\s+(?:it|them|this|that|everything|all|the\\s+(?:changes|branch|commits?|tags?)|los\\s+cambios|la\\s+rama|el\\s+commit|los\\s+commits|to\\s+(?:origin|the\\s+remote|github|gitlab|main|master)|a\\s+(?:origin|main|master|github|gitlab)|al\\s+remoto)${NE}`,
  `${NB}git\\s+(?:push|commit|merge|rebase|tag|cherry-pick|stash|checkout|switch|branch)${NE}`,
  `${NB}merge(?:a|ar|ea|ear)?(?:\\s+\\S+){0,3}?\\s+(?:branch|rama|PR|pull\\s+request)${NE}`, `${NB}merge(?:a|ar|ea|ear)?\\s+\\S+\\s+(?:into|in|onto|en|a|con)\\s+(?:main|master|develop|dev|trunk)${NE}`,
  `${NB}(?:haz|hacer|do)\\s+(?:el\\s+|un\\s+|a\\s+)?(?:merge|rebase|squash|cherry-?pick)${NE}`, `${NB}fusiona\\p{L}*\\s+(?:la\\s+|las\\s+|esta\\s+)?ramas?${NE}`,
  // a rebase, squash or cherry-pick of branches or commits, or one that opens the clause; never the rebase of a discount
  `${NB}(?:rebase|squash|cherry-?pick)\\p{L}*(?:\\s+\\S+){0,3}?\\s+(?:branch|rama|onto|sobre|contra|commits?|main|master)${NE}`, `${LEAD}(?:rebase|squash|cherry-?pick)\\p{L}*${NE}`,
  `${NB}tag(?:ea|uea)?(?:\\s+\\S+){0,2}?\\s+v?\\d+\\.\\d+`, `${NB}etiqueta\\s+(?:la\\s+)?versi[oó]n${NE}`,
  `${NB}(?:crea|crear|create|make|haz|abre|open)\\s+(?:a\\s+|an\\s+|una\\s+|the\\s+|la\\s+)?(?:new\\s+|nueva\\s+)?(?:git\\s+)?(?:branch|rama)${NE}(?!\\s+(?:selector|picker|dropdown|switcher|list|lista|protection|de\\s+l[oó]gica)${NE})`,
  `${NB}(?:update|actualiza|actualizar)\\s+(?:the\\s+|la\\s+|this\\s+|esta\\s+|my\\s+|mi\\s+)?(?:branch|rama)${NE}`,
);
// In a request with a git operation, the conflicts are the merge's or the rebase's.
const CONFLICTS = re(`${NB}(?:conflicts?|conflictos?)${NE}`);
// A rename option, button or menu is a feature: only renaming itself is mechanical.
const MECHANICAL = re(`${NB}(?:typos?|erratas?|spelling|misspell\\p{L}*|ortograf\\p{L}*)${NE}`,
  `(?<!(?:opci[oó]n|bot[oó]n|funci[oó]n|men[uú]|acci[oó]n)\\s+(?:de|para)\\s+)${NB}(?:renam|renombr)\\p{L}*${NE}(?!\\s+(?:options?|buttons?|features?|actions?|dialogs?|modals?|menus?|commands?|endpoints?|support)${NE})`,
  `${NB}(?:change|cambia|cambiar)\\s+(?:the\\s+|el\\s+)?(?:name|nombre)\\s+(?:of|de|del)${NE}`);
// A typo that breaks something is a bug to fix.
const BREAKS = re(`${NB}(?:breaks?|broken|rompe|roto|rota|falla|fallan|fails?|failing|rechaza|rechazan|rejects?|crash\\p{L}*|no\\s+funciona|doesn'?t\\s+work|does\\s+not\\s+work)${NE}`);
const TRANSLATION = re(`${NB}(?:translat|tradu[cz])\\p{L}*`);
// A translation that is code: i18n support, languages, dynamic texts loaded from an API.
const TRANSLATION_CODE = re(`${NB}(?:i18n|l10n|internacionaliz\\p{L}*|internationali[sz]\\p{L}*|soporte|support|idiomas|languages|locales?|apis?`
  + `|din[aá]mic\\p{L}*|dynamic\\p{L}*|carg\\p{L}*|loads?|loaded|loading)${NE}`);
// A text that is not code: README, CHANGELOG and docs always; an email, a summary, a meeting, a plan… when it is
// written about (a determiner before it), its clause is not led by a fix or by a verb of code (implement, build…), and
// the request names no code once those texts are taken out (a file, a component, a feature, an export, a weekly send…).
const NOTES = re(`${NB}(?:readme|changelog|release\\s+notes|notas\\s+de\\s+(?:la\\s+)?versi[oó]n|documentaci[oó]n|documentation|wiki)${NE}`,
  `${NB}(?:docs?\\s+(?:folder|directory|site|page)|(?:the|la|las|los)\\s+docs)${NE}`);
const PROSE_NOUNS = 'correos?|e-?mails?|mails?|resumen|res[uú]menes|summary|summaries|actas?|minutes|reuni[oó]n|reuniones|meetings?|tono|tone|cartas?|letters?'
  + '|art[ií]culos?|articles?|posts?|informes?|reports?|documentos?|documents?|presentaci[oó]n|presentations?|diapositivas|slides|newsletters?|propuestas?'
  + '|proposals?|ensayos?|essays?|discursos?|speech(?:es)?|notas|notes|plan|planes|spreadsheets?|hojas?\\s+de\\s+c[aá]lculo|tweets?|budget|presupuestos?';
const PROSE_SRC = `${NB}(?:el|la|los|las|un|una|unos|unas|este|esta|estos|estas|ese|esa|al|del|mi|tu|su|nuestro|nuestra|the|a|an|this|that|these|those|my|your|our)\\s+(?:${PROSE_NOUNS})${NE}`;
const PROSE = new RegExp(PROSE_SRC, 'iu');
const PROSE_ALL = new RegExp(PROSE_SRC, 'giu');
const CODE = re(`${NB}(?:endpoints?|apis?|funci[oó]n|funciones|functions?|m[eé]todos?|methods?|clases?|class(?:es)?|componentes?|components?|m[oó]dulos?|modules?|servicios?|services?`
  + `|bot[oó]n|botones|buttons?|formularios?|forms?|p[aá]ginas?|pages?|pantallas?|screens?|vistas?|views?|rutas?|routes?|tests?|scripts?|hooks?|bugs?|c[oó]digo|code|apps?|aplicaci[oó]n`
  + `|cli|comandos?|commands?|campos?|fields?|tablas?|tables?|database|query|queries|consultas?|backend|frontend|servidor|server|handlers?|controlador|controllers?|validaci[oó]n|validation`
  + `|login|plantillas?|templates?|esquemas?|schemas?|css|html|sql|plugins?|widgets?`
  // fix round 1: features and what a product does with a text
  + `|features?|funcionalidad(?:es)?|flows?|flujos?|dashboards?|panel(?:es)?|exports?|exportaci[oó]n|exportar|schedulers?|programador|reports?|informes?|signup|sign-up`
  + `|semanal(?:es)?|mensual(?:es)?|diari[oa]s?|weekly|monthly|daily|autom[aá]tic[oa]s?|automatic(?:ally)?|scheduled|programad[oa]s?)${NE}`,
  `${NB}(?:que\\s+se\\s+env[ií]an?|(?:is|are|gets?)\\s+sent)${NE}`,
  `[\\w-]+\\.(?:[cm]?[jt]sx?|py|java|kt|go|rs|rb|php|cs|s?css|html|vue|svelte|json|ya?ml|sql|sh)${NE}`);
const FIX_LED = new RegExp(`${LEAD}(?:arregla|arreglar|corrige|corregir|repara|reparar|soluciona|solucionar|fix|repair|solve)${NE}`, 'iu');
const CODE_LED = new RegExp(`${LEAD}(?:implementa|implementar|implement|build|construye|construir|desarrolla|desarrollar|develop|refactoriza|refactorizar|refactor|migra|migrar|migrate)${NE}`, 'iu');
// An issue or a ticket for a tracker is not code.
const TRACKER_ITEM = re(`${NB}(?:issues?|tickets?|incidencias?)${NE}`);
const TRACKER = re(`${NB}(?:github|gitlab|jira|linear|trello|youtrack|tracker|backlog)${NE}`);
// One value changed: «cambia el color del botón a azul», "change the timeout from 30 to 60". Fix round 1: only when the
// clause ends in the new value (a quoted text, a number, or one word), and never with a purpose («para que…», "so that").
const TWEAK = new RegExp(`${LEAD}(?:cambia|cambiar|change|actualiza|actualizar|update)\\s+(?:the\\s+|el\\s+|la\\s+|los\\s+|las\\s+)?(?:\\S+\\s+){0,2}?`
  + `(?:colou?rs?|colores|texto|text|t[ií]tulo|title|etiqueta|label|timeout|valor|value|tama[nñ]o|size|margen|margin|padding|fuente|font|icono|icon|puerto|port|l[ií]mite|limit`
  + `|versi[oó]n|version|delay|retraso|intervalo|interval)${NE}`, 'iu');
const NEW_VALUE_END = /\s(?:to|a|al|por|from)\s+(\S+(?:\s+\S+){0,2})\s*$/iu;
const PURPOSE = re(`${NB}(?:para\\s+que|so\\s+(?:that|it)|in\\s+order\\s+to|de\\s+(?:forma|modo|manera)\\s+que|seg[uú]n|depending|cuando|when|if|si)${NE}`);
// Fix round 1: a debug print only as the object of add or put («add a console.log…», «pon un print…»), never a bare
// "to debug" nor logging, which is a feature.
const DEBUG = new RegExp(`${LEAD}(?:add|put|insert|añade|añadir|agrega|agregar|pon|poner|mete|meter|inserta|insertar)\\s+`
  + `(?:(?:a|an|some|the|un|una|unos|unas|el|los|algunos|alg[uú]n|a\\s+couple\\s+of|un\\s+par\\s+de)\\s+)?`
  + `(?:console\\.(?:log|debug|warn|error|info)(?:\\(\\))?|print(?:ln|f)?(?:\\(\\))?(?:\\s+statements?)?|prints|debug\\s+(?:logs?|prints?|statements?|lines?)|log\\s+lines?|trazas?`
  + `|l[ií]neas?\\s+de\\s+log)(?![\\p{L}\\p{N}_])`, 'iu');
const ONE_LOG = new RegExp(`${LEAD}(?:add|put|añade|añadir|agrega|agregar|pon|poner|mete|meter)\\s+(?:a|an|un)\\s+log${NE}`, 'iu');
// Fix round 1: an artifact built, and nothing else in the clause («build the docker image», «… locally»).
const ARTIFACT = new RegExp(`${LEAD}(?:build|rebuild|compile|compila|compilar|construye|construir|genera|generar|generate)\\s+(?:the|la|el|las|los)\\s+`
  + `(?:docker\\s+|production\\s+|release\\s+)?(?:images?|imagen(?:es)?|containers?|contenedor(?:es)?|bundles?|binar(?:y|ies)|binarios?|apks?|jars?|wheels?|artifacts?|artefactos?)`
  + `(?:\\s+(?:docker|de\\s+docker|de\\s+producci[oó]n))?(?:\\s+(?:locally|again|now|for\\s+(?:production|prod)|en\\s+local|otra\\s+vez|de\\s+nuevo|ahora|para\\s+producci[oó]n))*\\s*$`, 'iu');
const INFO = new RegExp(`${LEAD}(?:expl[ií]ca(?:me)?|explicar|explain|describe|descr[ií]beme|describir|dime|decir(?:me)?|tell\\s+me|cu[eé]ntame|contar(?:me)?|res[uú]me(?:me)?|resumir|summari[sz]e`
  + `|mu[eé]strame|mostrar(?:me)?|show\\s+me|ens[eé][ñn]ame|enseñar(?:me)?|revisa|revisar|review|analiza|analizar|analy[sz]e|compara|comparar|compare|eval[uú]a|evaluar|evaluate`
  + `|investiga|investigar|investigate|averigua|averiguar|dame|give\\s+me|sugiere|sugi[eé]reme|suggest|prop[oó]n(?:me)?|propose)${NE}`, 'iu');

/** A value change that ends in its new value: quoted, a number, or one word, and with no purpose. */
function tweaks(clause: string): boolean {
  if (!TWEAK.test(clause) || PURPOSE.test(clause)) return false;
  const value = NEW_VALUE_END.exec(clause)?.[1];
  return value !== undefined && (/^["«“'].*["»”']$/u.test(value) || /\d/.test(value) || !/\s/.test(value));
}

/** w8 FR2: one clause of a request asks to build: a coding verb, and none of the requests the hint leaves out. */
function builds(clause: string, gitInRequest: boolean, namesCode: boolean): boolean {
  if (!VERB.test(clause) || GIT_OP.test(clause) || (gitInRequest && CONFLICTS.test(clause))) return false;
  if ((MECHANICAL.test(clause) && !BREAKS.test(clause)) || (TRANSLATION.test(clause) && !TRANSLATION_CODE.test(clause)) || NOTES.test(clause)) return false;
  if (TRACKER_ITEM.test(clause) && TRACKER.test(clause)) return false;
  if (PROSE.test(clause) && !namesCode && !FIX_LED.test(clause) && !CODE_LED.test(clause)) return false;
  return !tweaks(clause) && !DEBUG.test(clause) && !ONE_LOG.test(clause) && !ARTIFACT.test(clause) && !INFO.test(clause);
}

/** A prompt worth the routing hint: not a slash command nor a tagged message, not a question (a polite request still
 *  counts) nor an interrogative, six words or more (four with a code noun: «arregla el bug del login»), a coding verb,
 *  no method named, and a clause that asks to build. */
export function looksLikeCoding(prompt: string): boolean {
  const p = prompt.trim();
  if (!p || p.startsWith('/') || TAGGED.test(p)) return false;
  if (INTERROGATIVE.test(p)) return false;
  const asks = p.startsWith('¿') || p.endsWith('?') || p.includes('¿');
  if (asks && !POLITE.test(p) && !IMPERATIVE.test(p.split(/[¿.!?]/, 1)[0].trim())) return false;
  if (!VERB.test(p) || METHOD.test(p)) return false;
  const text = p.length <= HEAD + TAIL ? p : `${p.slice(0, HEAD)}\n${p.slice(-TAIL)}`;
  const words = p.split(/\s+/).length;
  if (words < 4 || (words < 6 && !CODE.test(text))) return false;
  const clauses = text.split(CLAUSE_BREAK).map(c => (c ?? '').trim()).filter(Boolean);
  const git = clauses.some(c => GIT_OP.test(c));
  const namesCode = CODE.test(text.replace(PROSE_ALL, ' '));
  return clauses.some(c => builds(c, git, namesCode));
}
