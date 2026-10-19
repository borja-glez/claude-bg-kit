export type PathName = 'trivial' | 'small' | 'medium' | 'large';
export const PATH_ORDER: PathName[] = ['trivial', 'small', 'medium', 'large'];
export type Zone = 'auth' | 'data' | 'public-api' | 'deps' | 'ci';
// gitOk: git answered `ls-files`. When it did not, files and commits are unknown, not empty.
export interface RepoFacts { files: string[]; commits: number; gitOk: boolean; grep: (word: string) => string[] }
export interface TriageResult { path: PathName; files: string[]; sensitive: Zone[]; greenfield: boolean; validators: string[]; reasons: string[] }

const MAX_FILES = 200;
const MAX_PER_SYMBOL = 50;
const MAX_SYMBOLS = 20;
const MAX_TEXT = 20_000;
const COPY_REASON = 'one quoted text change: the session finds the file';

// Spanish words: Unicode-aware boundaries via lookarounds (\b only knows ASCII letters). `stems`
// may continue with more letters (autentic -> autenticación); `words` must end at a boundary.
const es = (stems: string, words: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}_])(?:(?:${stems})\\p{L}*|(?:${words})(?![\\p{L}\\p{N}_]))`, 'iu');
const ZONES: { zone: Zone; text: RegExp[]; path: RegExp }[] = [
  // «session»/«sesión» alone usually names a Claude Code session: it counts only next to an authentication word.
  { zone: 'auth', text: [/\b(auth\w*|login|logout|passwords?|passwd|tokens?|jwt|oauth|session (tokens?|cookies?|ids?|hijack\w*|fixation)|login sessions?|permissions?|crypto|secrets?)\b/i,
    es('autentic|contraseñ|permis|secret', 'sesi[oó]n(?:es)? (?:del?|de los) usuarios?|(?:inici|cerr|cierr)\\p{L}* (?:de )?sesi[oó]n|(?:cookies?|tokens?) de sesi[oó]n')], path: /(^|\/)(auth|security|crypto)(\/|\.)/i },
  { zone: 'data', text: [/\b(migrations?|schema|database|sql|prisma|orm)\b/i, es('migraci', 'bases? de datos|esquemas?')], path: /(^|\/)(migrations?|db|schema)(\/|\.)|\.sql$/i },
  { zone: 'public-api', text: [/\b(public api|endpoints?|openapi|swagger|graphql)\b/i, es('endpoint', 'apis? p[uú]blicas?')], path: /(^|\/)(api|routes)\//i },
  { zone: 'deps', text: [/\b(dependenc(y|ies)|upgrade|npm install|pip install)\b/i, es('dependencia', 'actualizar? dependencias')], path: /(^|\/)(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|requirements[^/]*\.txt|pyproject\.toml|Cargo\.(toml|lock)|go\.(mod|sum))$/i },
  { zone: 'ci', text: [/\b(ci|pipelines?|workflows?|deploy\w*|release)\b/i, es('despliegue', 'integraci[oó]n continua')], path: /(^|\/)(\.github\/workflows|\.gitlab-ci|\.circleci)/i },
];
export const ZONE_ORDER: Zone[] = ZONES.map(z => z.zone);
// Zones whose path pattern matches any of the given paths or globs, in table order.
export function zonesFromPaths(paths: string[]): Zone[] {
  return ZONES.filter(z => paths.some(p => z.path.test(p))).map(z => z.zone);
}
/** K2-16: the zones a text names by its words. Unlike the triage it reads the mentions too: a proposal names what it touches. */
export function zonesFromText(text: string): Zone[] {
  const t = String(text).slice(0, MAX_TEXT);
  return ZONES.filter(z => z.text.some(re => re.test(t))).map(z => z.zone);
}
/** K4-06: the sensitive zones of a real diff: the paths it changes (deleted and renamed files included) and the zone
 *  words of its added lines, read in chunks of MAX_TEXT (zonesFromText's limit), in table order. */
export function diffZones(names: string[], patch: string): Zone[] {
  const found = new Set<Zone>(zonesFromPaths(names));
  let chunk = '';
  const read = () => { for (const z of zonesFromText(chunk)) found.add(z); chunk = ''; };
  for (const l of patch.split('\n')) {
    if (!l.startsWith('+') || /^\+\+\+ (?:b\/|\/dev\/null)/.test(l)) continue;
    if (chunk.length + l.length > MAX_TEXT) read();
    chunk += `${l.slice(1, MAX_TEXT)}\n`;
  }
  read();
  return ZONE_ORDER.filter(z => found.has(z));
}
const LARGE = [/\b(architecture|redesign|rewrite|subsystem|new (project|app|service|system)|from scratch|migrat(e|ion) (to|from))\b/i,
  es('arquitect|rediseñ|reescrib|reescritur|subsistem', 'desde cero|(?:nuev[oa]|otr[oa]) (?:proyecto|aplicaci[oó]n|app|servicio|sistema)|migr(?:ar|aci[oó]n) (?:a|al|desde)')];

// A rename spreads past the file it names: never Trivial.
const RENAME = [/\brenam/i, /(?<![\p{L}\p{N}_])renombr/iu];

// Mechanical work: rename, move, bump, regenerate, typos, translations, fixtures, changelog, a given patch.
// move / typo / patch only count in mechanical-only phrasings: a bare one appears in prose about real logic changes.
const MECHANICAL = [
  /\b(renam\w*|bump\w*|regenerat\w*|translat\w*|fixtures?|changelog)\b/i,
  /\bapply(?:ing)?\s+(?:the|this|that|these|a|an|given)?\s*patch(?:es)?\b/i,
  /\bmov(?:e|es|ed|ing)\s+(?:the\s+)?(?:files?|folders?|directory|directories|dirs?)\b|\bmov(?:e|es|ed|ing)\s+\S*[\w-]\.\w+\s+to\b|\bmov(?:e|es|ed|ing)\s+\S*\/\S*\s+to\b/i,
  /\b(?:fix(?:es|ing)?|correct\w*)\s+(?:the\s+|a\s+|some\s+)?typos?\b|\btypos?\s+fix/i,
  es('renombr|regener|traduc', 'errata|erratas|fixtures?|changelog|sube la versi[oó]n'),
  /(?<![\p{L}\p{N}_])aplic(?:a|ar|ando)\s+(?:el|este|ese|un|los|estos)\s+parches?(?![\p{L}\p{N}_])/iu,
  /(?<![\p{L}\p{N}_])(?:mueve|mover|muevo)\s+(?:los?\s+|las?\s+)?(?:archivos?|carpetas?|directorios?|\S*[\w-]\.\w+\s+a\b|\S*\/\S*\s+a\b)/iu,
];
// Mentions: words the task names without asking for them. A quoted or backticked span, a compound identifier
// (review-perf, src/auth/x.ts, swarm.member), a --flag, a reviewer's name or a prohibition («No toques los bundles: los
// regenera T018.») says nothing about what the task is: the word checks never read them.
const NB = '(?<![\\p{L}\\p{N}_])';
const NE = '(?![\\p{L}\\p{N}_])';
const SPANS = /«[^«»]*»|"[^"]*"|“[^“”]*”|`[^`]*`/gu;
// To the end of its sentence: a dot ends it only before whitespace or the end (a path's dots do not).
const PROHIBITION = new RegExp(`${NB}(?:no\\s+(?:toques|cambies|edites|modifiques|regeneres|actualices|muevas|renombres|borres)`
  + `|sin\\s+(?:tocar|cambiar)|(?:do\\s+not|don['’]t|never)\\s+(?:touch|change|edit|modify|regenerate|update|move|rename|delete)`
  + `|without\\s+(?:touching|changing))${NE}(?:(?!,\\s*(?:pero|y\\s+luego|but|and\\s+then)${NE})(?:[^.;!?\\n]|\\.(?!\\s|$)))*`, 'giu');
const REVIEWER = new RegExp(`${NB}(?:(?:revisor|revisores|revisión|reviewer|reviewers|review)\\s+(?:(?:de|of)\\s+)?(?:perf|security|seguridad|correctness)`
  + `|(?:perf|security|correctness)\\s+(?:reviewer|reviewers|review))${NE}`, 'giu');
const FLAG = /(?<![\p{L}\p{N}_-])--[\p{L}\p{N}][\p{L}\p{N}_-]*/gu;
const COMPOUND = new RegExp(`${NB}[\\p{L}\\p{N}]+(?:[-_./][\\p{L}\\p{N}]+)+`, 'gu');
const blank = (s: string) => ' '.repeat(s.length);
/**
 * The text without its mentions, same length. A compound identifier keeps its separators with every letter or digit
 * turned into `x` (`src/a.ts` → `xxx/x.xx`): the shape of a path still reads as one («move src/a.ts to …»).
 */
export function stripMentions(text: string): string {
  return String(text).replace(SPANS, blank).replace(PROHIBITION, blank).replace(REVIEWER, blank).replace(FLAG, blank)
    .replace(COMPOUND, m => m.replace(/[\p{L}\p{N}]/gu, 'x'));
}
// The task's head: its first sentence with some content (up to `.`, `!`, `?` or `:` before whitespace or the end, or a
// line break), after the method and courtesy that may open it («Con forge:», "please"). One or two words before a colon
// («Refactor: rewrite …», «Rename fooBar: it is confusing») read together with the sentence after them. A word later in the text describes
// something else («… que el validador regeneró»).
function head(text: string): string {
  const t = text.replace(METHOD, '').replace(COURTESY, '');
  const parts = [...t.matchAll(/([\s\S]*?)([.!?:](?=\s|$)|\r?\n|$)/gu)].filter(m => m[0]).map(m => ({ s: m[1], end: m[2] }));
  const full = parts.filter(p => /[\p{L}\p{N}]/u.test(p.s));
  if (!full.length) return '';
  const label = full[0].end === ':' && full[0].s.trim().split(/\s+/).length <= 2 && full.length > 1;
  return label ? `${full[0].s} ${full[1].s}` : full[0].s;
}
/** Mechanical: the head of the text, its mentions removed, reads as mechanical work. */
export function isMechanical(text: string): boolean {
  const t = head(stripMentions(String(text).slice(0, MAX_TEXT)));
  return MECHANICAL.some(re => re.test(t));
}

export type ImplRole = 'mech' | 'impl-light' | 'impl' | 'impl-high' | 'impl-heavy';
/** Who implements a task of this size: `self` = the session itself (Trivial alone); `role` null with self false = Large (design first). */
export interface Implementer { role: ImplRole | null; self: boolean; why: string }

/** Model by size: Trivial alone is the session's; Small is always delegated; in a batch a Trivial goes to mech. */
// A plan task (`plan`): the coordinator never edits task code, so a Trivial goes to mech; a Large one was already
// designed and planned, so it goes to impl as a Medium one does, and to impl-high only on a sensitive zone.
// impl-heavy (xhigh) is kept for the last attempt of a review loop (`nextImplementer` in loop.ts).
export function implementerFor(r: Pick<TriageResult, 'path' | 'sensitive'>, text: string, opts: { batch?: boolean; plan?: boolean; delicate?: boolean } = {}): Implementer {
  // J-14: a delicate task (marked in its plan, or called so with --delicate) gets impl-high: any plan task, and a loose
  // task the session delegates anyway (Small and Medium; a Trivial one stays the session's, a Large one plans first).
  if (opts.delicate && (opts.plan || r.path === 'small' || r.path === 'medium')) {
    return { role: 'impl-high', self: false, why: opts.plan ? 'delicate plan task' : 'delicate task' };
  }
  switch (r.path) {
    case 'trivial':
      if (opts.plan) return { role: 'mech', self: false, why: 'trivial plan task: delegated to mech, the coordinator never edits task code' };
      return opts.batch ? { role: 'mech', self: false, why: 'trivial in a batch: delegated, the session runs several at once' }
        : { role: null, self: true, why: 'trivial: the session does it' };
    case 'small':
      return isMechanical(text) ? { role: 'mech', self: false, why: 'small and mechanical: always delegated to mech' }
        : { role: 'impl-light', self: false, why: 'small and bounded: always delegated to impl-light' };
    case 'medium':
      return r.sensitive.length ? { role: 'impl-high', self: false, why: `medium on a sensitive zone (${r.sensitive.join(', ')})` }
        : { role: 'impl', self: false, why: 'medium' };
    default:
      if (!opts.plan) return { role: null, self: false, why: 'large: design and plan first' };
      return r.sensitive.length ? { role: 'impl-high', self: false, why: `large plan task on a sensitive zone (${r.sensitive.join(', ')}): impl-high` }
        : { role: 'impl', self: false, why: 'large plan task: impl, as a medium one (the plan may need to split it)' };
  }
}

// The design, the plan and forge's own notes: neither a symbol hit there nor a change to them sizes a task.
export const isBookkeeping = (path: string): boolean => /^(docs\/waypoint|docs\/superpowers|\.forge|\.waypoint)\//.test(path);

/** `git diff --numstat --no-renames`: the changed files in git's order and their added plus deleted lines (a binary counts 0). */
export function parseNumstat(text: string): { files: string[]; lines: number } {
  const files: string[] = [];
  let lines = 0;
  for (const row of String(text).split('\n')) {
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(row.replace(/\r$/, ''));
    if (!m || isBookkeeping(m[3])) continue;
    files.push(m[3]);
    if (m[1] !== '-') lines += Number(m[1]);
    if (m[2] !== '-') lines += Number(m[2]);
  }
  return { files, lines };
}

export const DIFF_MEDIUM_LINES = 200;
/** The size of an implemented task, from its real diff: a sensitive zone it touches lifts it to Medium. */
export function diffPath(stat: { files: string[]; lines: number }): { path: PathName; sensitive: Zone[]; reasons: string[] } {
  const n = stat.files.length;
  let path: PathName = n === 0 ? 'trivial' : n > 10 ? 'large' : n > 3 || stat.lines > DIFF_MEDIUM_LINES ? 'medium' : 'small';
  const sensitive = zonesFromPaths(stat.files);
  const reasons = [`diff: ${n} file(s), ${stat.lines} line(s)`];
  if (sensitive.length) {
    if (PATH_ORDER.indexOf(path) < PATH_ORDER.indexOf('medium')) path = 'medium';
    reasons.push(`diff touches a sensitive zone: ${sensitive.join(', ')}`);
  }
  return { path, sensitive, reasons };
}

const PERF = [/\b(perf|performance|latency|throughput|benchmarks?|optimi[sz](e|es|ed|ing|ation|ations)|speed\s?up|faster|memory (usage|leaks?))\b/i,
  es('rendimient|optimiz|latenci', 'más rápid[oa]s?|fugas? de memoria|uso de memoria|cuello de botella')];
/** Performance work: the text, its mentions removed (a plan task passes its title alone). */
export function isPerfTask(text: string): boolean {
  const t = stripMentions(String(text).slice(0, MAX_TEXT));
  return PERF.some(re => re.test(t));
}

export type ReviewRole = 'review-correctness' | 'review-security' | 'review-perf';
export type ReviewEffort = 'medium' | 'high' | 'xhigh';
export interface ReviewPlan { light: boolean; reviewers: { role: ReviewRole; model: 'sonnet' | null; effort: ReviewEffort }[]; flags: ('--sensitive' | '--perf')[] }
/** `delicate`: the task was marked delicate; `final`: Large's final review; `profile`: the configured one (quality lifts every reviewer). */
export interface ReviewOptions { delicate?: boolean; final?: boolean; profile?: 'balanced' | 'economy' | 'quality' }
/**
 * Who reviews a task of this size: below Medium one light correctness review (sonnet, medium), else correctness plus
 * security and perf as they apply, each on the agent's own model with its effort by risk. The table is provisional
 * until the shadow test: correctness high (xhigh when sensitive, delicate or Large's final review), security high
 * (xhigh on auth), perf medium; the quality profile puts them all on xhigh.
 */
export function reviewFor(path: PathName, sensitive: Zone[], perf: boolean, opts: ReviewOptions = {}): ReviewPlan {
  // Below Medium: the light correctness review, plus review-perf when performance was asked for.
  if (path === 'trivial' || path === 'small') return { light: true,
    reviewers: [{ role: 'review-correctness', model: 'sonnet', effort: 'medium' }, ...(perf ? [{ role: 'review-perf' as const, model: null, effort: 'medium' as const }] : [])],
    flags: perf ? ['--perf'] : [] };
  const roles: ReviewRole[] = ['review-correctness', ...(sensitive.length ? ['review-security' as const] : []), ...(perf ? ['review-perf' as const] : [])];
  const effort = (role: ReviewRole): ReviewEffort => {
    if (opts.profile === 'quality') return 'xhigh';
    if (role === 'review-perf') return 'medium';
    if (role === 'review-security') return sensitive.includes('auth') ? 'xhigh' : 'high';
    return sensitive.length || opts.delicate || (opts.final && path === 'large') ? 'xhigh' : 'high';
  };
  return { light: false, reviewers: roles.map(role => ({ role, model: null, effort: effort(role) })),
    flags: [...(sensitive.length ? ['--sensitive' as const] : []), ...(perf ? ['--perf' as const] : [])] };
}

export type AnnounceLocale = 'es' | 'en';
// Spanish for the fixed reason texts of triage and the CLI; an unknown reason passes through.
const REASONS_ES: [RegExp, string][] = [
  [/^git unavailable$/, 'git no responde'],
  [/^greenfield repository$/, 'repositorio nuevo'],
  [/^architecture-scale wording$/, 'la tarea habla de arquitectura'],
  [/^(\d+) files located$/, '$1 ficheros'],
  [/^(\d+) file\(s\) located$/, '$1 fichero(s)'],
  [/^no files located: the session should judge the scope$/, 'no localizo ficheros: decide la sesión'],
  [/^one named file, short task$/, 'un fichero nombrado, tarea corta'],
  [/^one file, short task$/, 'un fichero, tarea corta'],
  [/^one quoted text change: the session finds the file$/, 'un cambio de texto entre comillas'],
  [/^quoted text found in (\d+) file\(s\)$/, 'texto entre comillas en $1 fichero(s)'],
  [/^sensitive zone: (.+)$/, 'zona sensible: $1'],
  [/^zones match no tracked file \(new files\?\)$/, 'las zonas no casan con ningún fichero versionado (¿ficheros nuevos?)'],
  [/^superpowers plan: the Medium path, its tasks in order$/, 'plan de superpowers: camino Medium, sus tareas en orden'],
  [/^ratchet: kept (\w+) from an earlier triage of this task$/, 'se mantiene $1 de un triage anterior de esta tarea'],
  [/^diff: (\d+) file\(s\), (\d+) line\(s\)$/, 'diff: $1 fichero(s), $2 línea(s)'],
  [/^diff touches a sensitive zone: (.+)$/, 'el diff toca una zona sensible: $1'],
];
const reasonEs = (r: string) => {
  const hit = REASONS_ES.find(([re]) => re.test(r));
  return hit ? r.replace(hit[0], hit[1]) : r;
};

export interface AnnounceInput {
  path: PathName; reasons: string[]; implementer: { self: boolean; agent: string | null };
  // The `why` of the latest raise logged for this task: it replaces the CLI reasons.
  why?: string | null;
  fresh: string[]; catalog: { name: string; cmd: string }[];
}

/** The line the session prints before acting on a triage, plus a line for validators it has not seen yet. */
export function announce(a: AnnounceInput, locale: AnnounceLocale): string {
  const es = locale === 'es';
  const why = a.why || (es ? a.reasons.map(reasonEs) : a.reasons).join('; ');
  const agent = a.implementer.agent;
  const self = a.implementer.self || !agent;
  let line: string;
  switch (a.path) {
    case 'trivial':
    case 'small': {
      const name = a.path === 'trivial' ? 'Trivial' : 'Small';
      line = self ? (es ? `${name}: ${why}; lo hago yo. Puedes corregirlo.` : `${name}: ${why}; I do it myself. You can correct it.`)
        : (es ? `${name} → ${agent}: ${why}. Puedes corregirlo.` : `${name} → ${agent}: ${why}. You can correct it.`);
      break;
    }
    case 'medium':
      line = es ? `Medium → ${agent}: ${why}. Antes de lanzarlo te enseño un plan corto; puedes corregirlo.`
        : `Medium → ${agent}: ${why}. I show you a short plan before launching it; you can correct it.`;
      break;
    default:
      // A plan task names its implementer (impl, impl-high on a sensitive zone); a task that is not one is designed and planned first.
      line = agent ? (es ? `Large → ${agent}: ${why}. Puedes corregirlo.` : `Large → ${agent}: ${why}. You can correct it.`)
        : es ? `Large: ${why}; primero diseño y plan. Puedes corregirlo.` : `Large: ${why}; design and plan first. You can correct it.`;
  }
  if (!a.fresh.length) return line;
  const list = a.fresh.map(n => `${n} (\`${a.catalog.find(v => v.name === n)?.cmd ?? ''}\`)`).join(', ');
  return `${line}\n${es ? 'Validadores nuevos' : 'New validators'}: ${list}.`;
}

/** The line the session prints once a plan task is implemented: its real size and who reviews it. */
export function announceReview(a: { path: PathName; files: number; lines: number; review: ReviewPlan }, locale: AnnounceLocale): string {
  const spanish = locale === 'es';
  const name = a.path[0].toUpperCase() + a.path.slice(1);
  const names = a.review.reviewers.map(r => r.role.replace(/^review-/, ''));
  const and = spanish ? ' y ' : ' and ';
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')}${and}${names.at(-1)}` : names.join('');
  const perf = a.review.reviewers.some(r => r.role === 'review-perf') ? `${and}perf` : '';
  if (spanish) return `Tamaño real: ${a.files} fichero(s), ${a.lines} línea(s) → ${name}: `
    + (a.review.light ? `una revisión ligera (correctness en sonnet)${perf}.` : `revisan ${list}.`);
  return `Real size: ${a.files} file(s), ${a.lines} line(s) → ${name}: ` + (a.review.light ? `one light review (correctness on sonnet)${perf}.` : `reviewed by ${list}.`);
}

// Quoted spans («…», "…", “…”), unbounded so that a long quote never pairs a closing mark with the next opening one.
const QUOTED = /«([^«»]*)»|"([^"]*)"|“([^“”]*)”/g;
const MAX_QUOTED = 3;
const quotedLiterals = (text: string) => [...text.matchAll(QUOTED)].map(m => (m[1] ?? m[2] ?? m[3]).trim())
  .filter(q => q.length >= 4 && q.length <= 60).slice(0, MAX_QUOTED);

const B = '(?<![\\p{L}\\p{N}_])';
const E = '(?![\\p{L}\\p{N}_])';
// A short courtesy may open or close the task, and so may the method it names («Con forge:», "with forge").
const METHOD = /^\s*(?:(?:hazlo\s+)?con forge|with forge|f[oó]rjame(?:\s+esto)?|forge it|forge)\s*[:,]\s*/iu;
const METHOD_END = /[\s,]*(?:con forge|with forge)[\s.!?…]*$/iu;
const COURTESY = /^\s*(?:please|can you|could you|por favor|puedes)(?![\p{L}\p{N}_])[\s,]*/iu;
const COURTESY_END = /[\s,]*(?:please|por favor|gracias)[\s.!?…]*$/iu;
const VERB_EN = 'change|set|update|replace';
const VERB_ES = 'cambia|pon|actualiza|sustituye|reemplaza';
const STARTS_WITH_VERB = new RegExp(`^(?:${VERB_EN}|${VERB_ES})${E}`, 'iu');
// A one-line copy change: the change verb, a UI-text noun within four words, at most a short of/in phrase, then
// to/as (a/por/como in Spanish) and the quoted value. Each language's verbs take its own prepositions.
const copyRe = (verbs: string, nouns: string, of: string, to: string) => new RegExp(
  `^(?:${verbs})${E}(?:\\s+\\S+){0,4}?\\s+(?:${nouns})(?:s|es)?${E}(?:\\s+(?:${of})(?:\\s+\\S+){1,4}?)?\\s+(?:${to})\\s+[«"“]`, 'iu');
const COPY = [
  copyRe(VERB_EN, 'title|text|label|heading|placeholder|tooltip|message|copy|caption', 'of|in|on', 'to|as'),
  copyRe(VERB_ES, 't[ií]tulo|texto|etiqueta|encabezado|mensaje|leyenda|r[oó]tulo', 'de|del|en', 'a|por|como'),
];
// Words that widen a copy change past one place or make it conditional (checked outside the quotes).
const WIDE = new RegExp(`${B}(?:and|also|then|plus|every|all|everywhere|when|if|unless|only|so|y|además|luego|también|todas?|todos?|cada|cuando|si|solo|sólo|para que)${E}`, 'iu');
// A second clause outside the quotes: a stop, or a comma, followed by more words.
const CLAUSE_BREAK = /[;.!?,]\s*[\p{L}\p{N}]/u;
const MAX_COPY_WORDS = 20;
// The copy rules only read short tasks: it also keeps the lazy scans of COPY cheap.
const MAX_COPY_TEXT = 1000;

/**
 * The guards of a one-place text change: a change verb first (after a courtesy), one clause that ends with the quoted
 * value, no widening or conditional word outside the quotes, at most 20 words outside them, no rename.
 * Returns the text without its courtesies when they hold, else null.
 */
function copyGuards(task: string): string | null {
  if (task.length > MAX_COPY_TEXT || RENAME.some(re => re.test(task))) return null;
  const text = task.replace(METHOD, '').replace(METHOD_END, '').replace(COURTESY, '').replace(COURTESY_END, '').trim();
  if (!STARTS_WITH_VERB.test(text)) return null;
  const last = [...text.matchAll(QUOTED)].at(-1);
  // The quoted value ends the task: words after it ("… to "strict" mode") make it something else.
  if (!last || !/^[\s.!?…]*$/u.test(text.slice(last.index! + last[0].length))) return null;
  const outside = text.replace(QUOTED, ' ');
  const words = outside.split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w));
  return words.length <= MAX_COPY_WORDS && !WIDE.test(outside) && !CLAUSE_BREAK.test(outside) ? text : null;
}
function isCopyChange(task: string): boolean {
  const text = copyGuards(task);
  return text !== null && COPY.some(re => re.test(text));
}

// Path-like tokens: something/with/slashes or name.ext.
const PATH_TOKEN = /[\w.\-/]*[\w-]\.[A-Za-z0-9]{1,8}\b|[\w.-]+\/[\w.\-/]+/g;
// Symbols worth a grep: camelCase, PascalCase with an inner capital, snake_case, or `backticked`.
const isSymbol = (w: string) => w.length >= 4 && (/[a-z][A-Z]/.test(w) || /^[A-Za-z]+_[A-Za-z0-9_]+$/.test(w));

// `ignoreGreenfield`: a plan task was already designed and planned, so a young repository does not make it Large.
// `plan`: a plan task takes its zones from paths (its plan zones, the files located) and from its title, and its Large
// wording from its title; file location and sizing still read the whole text.
export function triage(task: string, repo: RepoFacts, validators: string[], extra?: { files: string[]; zones: Zone[] },
  opts: { ignoreGreenfield?: boolean; plan?: { title: string } } = {}): TriageResult {
  const reasons: string[] = [];
  // Capped so that the regexes below stay fast on pasted logs or huge specs.
  const text = String(task).slice(0, MAX_TEXT);
  // The word checks read the text without its mentions; Large wording reads only the head (a plan task's title).
  const plain = stripMentions(text);
  const headText = opts.plan ? stripMentions(String(opts.plan.title).slice(0, MAX_TEXT)) : head(plain);
  const files = new Set<string>(extra?.files);
  const named = new Set<string>();

  for (const tok of text.match(PATH_TOKEN) ?? []) {
    const t = tok.replace(/^\.\//, '');
    for (const f of repo.files) if (f === t || f.endsWith(`/${t}`)) { files.add(f); named.add(f); }
  }
  const words = new Set([...text.matchAll(/`([^`]+)`/g)].map(m => m[1].trim()).filter(w => /^[\w.$]{3,}$/.test(w)));
  for (const w of text.split(/[^A-Za-z0-9_]+/)) if (isSymbol(w)) words.add(w);
  for (const w of [...words].slice(0, MAX_SYMBOLS)) for (const f of repo.grep(w).slice(0, MAX_PER_SYMBOL)) files.add(f);
  // A quoted old value (a title, a label) locates the file of a copy change: only a literal found in exactly one file
  // counts, and never toward the size (a new value is often a common word that sits in many files).
  const quoteFiles = new Set<string>();
  for (const q of quotedLiterals(text)) {
    const hits = repo.grep(q);
    if (hits.length === 1) quoteFiles.add(hits[0]);
  }

  const located = [...new Set([...files, ...quoteFiles])].sort().slice(0, MAX_FILES);
  // A plan task's words give a zone only through its title (headText); its includes and done_when never do.
  const zoneText = opts.plan ? headText : plain;
  const sensitive = ZONES.filter(z => z.text.some(re => re.test(zoneText)) || extra?.zones.includes(z.zone) || located.some(f => z.path.test(f))).map(z => z.zone);
  // Greenfield only when git answered: a failed git call says nothing about the repository.
  const greenfield = repo.gitOk && (repo.commits === 0 || repo.files.length < 5);
  if (!repo.gitOk) reasons.push('git unavailable');
  const wordCount = text.trim().split(/\s+/).length;
  // Files the task names set its size; where its symbols also appear (tests, callers) does not lift it.
  // Files found only through a quoted literal are left out: the copy rule alone may use them.
  const sized = named.size ? named.size : Math.min(files.size, MAX_FILES);

  let path: PathName;
  if (greenfield && !opts.ignoreGreenfield) { path = 'large'; reasons.push('greenfield repository'); }
  else if (LARGE.some(re => re.test(headText))) { path = 'large'; reasons.push('architecture-scale wording'); }
  else if (sized > 10) { path = 'large'; reasons.push(`${sized} files located`); }
  else if (sized > 3) { path = 'medium'; reasons.push(`${sized} files located`); }
  else if (sized === 0 && isCopyChange(text)) { path = 'trivial'; reasons.push(COPY_REASON); }
  // A quoted old value found in one file locates a short change: Trivial under the copy guards.
  else if (sized === 0 && quoteFiles.size === 1 && copyGuards(text) !== null) { path = 'trivial'; reasons.push('one file, short task'); }
  else if (sized === 0 && quoteFiles.size) { path = 'small'; reasons.push(`quoted text found in ${quoteFiles.size} file(s)`); }
  else if (sized === 0) { path = 'small'; reasons.push('no files located: the session should judge the scope'); }
  else if (sized === 1 && wordCount <= 25 && !RENAME.some(re => re.test(text))) { path = 'trivial'; reasons.push(named.size ? 'one named file, short task' : 'one file, short task'); }
  else { path = 'small'; reasons.push(`${sized} file(s) located`); }

  if (sensitive.length && PATH_ORDER.indexOf(path) < PATH_ORDER.indexOf('medium')) {
    path = 'medium';
    reasons.push(`sensitive zone: ${sensitive.join(', ')}`);
  }
  return { path, files: located, sensitive, greenfield, validators, reasons };
}
