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
  { zone: 'auth', text: [/\b(auth\w*|login|logout|passwords?|passwd|tokens?|jwt|oauth|sessions?|permissions?|crypto|secrets?)\b/i, es('autentic|contraseñ|permis|secret', 'sesi[oó]n|sesiones')], path: /(^|\/)(auth|security|crypto)(\/|\.)/i },
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
const LARGE = [/\b(architecture|redesign|rewrite|subsystem|new (project|app|service|system)|from scratch|migrat(e|ion) (to|from))\b/i,
  es('arquitect|rediseñ|reescrib|reescritur|subsistem', 'desde cero|(?:nuev[oa]|otr[oa]) (?:proyecto|aplicaci[oó]n|app|servicio|sistema)|migr(?:ar|aci[oó]n) (?:a|al|desde)')];

// A rename spreads past the file it names: never Trivial.
const RENAME = [/\brenam/i, /(?<![\p{L}\p{N}_])renombr/iu];

// Mechanical work (spec §4.3): rename, move, bump, regenerate, typos, translations, fixtures, changelog, a given patch.
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
export function isMechanical(text: string): boolean {
  const t = String(text).slice(0, MAX_TEXT);
  return MECHANICAL.some(re => re.test(t));
}

export type ImplRole = 'mech' | 'impl-light' | 'impl' | 'impl-heavy';
/** Who implements a task of this size: `self` = the session itself (Trivial alone); `role` null with self false = Large (design first). */
export interface Implementer { role: ImplRole | null; self: boolean; why: string }

/** Model by size (spec §2): Trivial alone is the session's; Small is always delegated; in a batch a Trivial goes to mech. */
export function implementerFor(r: Pick<TriageResult, 'path' | 'sensitive'>, text: string, opts: { batch?: boolean } = {}): Implementer {
  switch (r.path) {
    case 'trivial':
      return opts.batch ? { role: 'mech', self: false, why: 'trivial in a batch: delegated, the session runs several at once' }
        : { role: null, self: true, why: 'trivial: the session does it' };
    case 'small':
      return isMechanical(text) ? { role: 'mech', self: false, why: 'small and mechanical: always delegated to mech' }
        : { role: 'impl-light', self: false, why: 'small and bounded: always delegated to impl-light' };
    case 'medium':
      return r.sensitive.length ? { role: 'impl-heavy', self: false, why: `medium on a sensitive zone (${r.sensitive.join(', ')})` }
        : { role: 'impl', self: false, why: 'medium' };
    default:
      return { role: null, self: false, why: 'large: design and plan first' };
  }
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
  [/^sensitive zone: (.+)$/, 'zona sensible: $1'],
  [/^zones match no tracked file \(new files\?\)$/, 'las zonas no casan con ningún fichero versionado (¿ficheros nuevos?)'],
  [/^superpowers plan: the Medium path, its tasks in order$/, 'plan de superpowers: camino Medium, sus tareas en orden'],
  [/^ratchet: kept (\w+) from an earlier triage of this task$/, 'se mantiene $1 de un triage anterior de esta tarea'],
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
      line = es ? `Large: ${why}; primero diseño y plan. Puedes corregirlo.` : `Large: ${why}; design and plan first. You can correct it.`;
  }
  if (!a.fresh.length) return line;
  const list = a.fresh.map(n => `${n} (\`${a.catalog.find(v => v.name === n)?.cmd ?? ''}\`)`).join(', ');
  return `${line}\n${es ? 'Validadores nuevos' : 'New validators'}: ${list}.`;
}

// Quoted spans («…», "…", “…”), unbounded so that a long quote never pairs a closing mark with the next opening one.
const QUOTED = /«([^«»]*)»|"([^"]*)"|“([^“”]*)”/g;
const MAX_QUOTED = 3;
const quotedLiterals = (text: string) => [...text.matchAll(QUOTED)].map(m => (m[1] ?? m[2] ?? m[3]).trim())
  .filter(q => q.length >= 4 && q.length <= 60).slice(0, MAX_QUOTED);

// A one-line copy change: change verb, then a UI-text noun, then to/as, then a quoted value.
const B = '(?<![\\p{L}\\p{N}_])';
const E = '(?![\\p{L}\\p{N}_])';
const COPY = new RegExp(`${B}(?:change|set|update|replace|cambia|pon|actualiza|sustituye|reemplaza)${E}.*?`
  + `${B}(?:title|text|label|heading|placeholder|tooltip|message|copy|caption|t[ií]tulo|texto|etiqueta|encabezado|mensaje|leyenda|r[oó]tulo)(?:s|es)?${E}.*?`
  + `${B}(?:to|as|a|por|como)\\s+[«"“]`, 'iu');
// Words that widen a copy change past one place (checked outside the quotes).
const WIDE = new RegExp(`${B}(?:and|also|then|plus|every|all|everywhere|y|además|luego|también|todas?|todos?|cada)${E}`, 'iu');
const MAX_COPY_WORDS = 20;
// The copy rule only reads short tasks: it also keeps the two lazy scans of COPY cheap.
const MAX_COPY_TEXT = 1000;
function isCopyChange(text: string): boolean {
  if (text.length > MAX_COPY_TEXT || RENAME.some(re => re.test(text))) return false;
  const outside = text.replace(QUOTED, ' ');
  const words = outside.split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w));
  return words.length <= MAX_COPY_WORDS && !WIDE.test(outside) && COPY.test(text);
}

// Path-like tokens: something/with/slashes or name.ext.
const PATH_TOKEN = /[\w.\-/]*[\w-]\.[A-Za-z0-9]{1,8}\b|[\w.-]+\/[\w.\-/]+/g;
// Symbols worth a grep: camelCase, PascalCase with an inner capital, snake_case, or `backticked`.
const isSymbol = (w: string) => w.length >= 4 && (/[a-z][A-Z]/.test(w) || /^[A-Za-z]+_[A-Za-z0-9_]+$/.test(w));

export function triage(task: string, repo: RepoFacts, validators: string[], extra?: { files: string[]; zones: Zone[] }): TriageResult {
  const reasons: string[] = [];
  // Capped so that the regexes below stay fast on pasted logs or huge specs.
  const text = String(task).slice(0, MAX_TEXT);
  const files = new Set<string>(extra?.files);
  const named = new Set<string>();

  for (const tok of text.match(PATH_TOKEN) ?? []) {
    const t = tok.replace(/^\.\//, '');
    for (const f of repo.files) if (f === t || f.endsWith(`/${t}`)) { files.add(f); named.add(f); }
  }
  const words = new Set([...text.matchAll(/`([^`]+)`/g)].map(m => m[1].trim()).filter(w => /^[\w.$]{3,}$/.test(w)));
  for (const w of text.split(/[^A-Za-z0-9_]+/)) if (isSymbol(w)) words.add(w);
  for (const w of [...words].slice(0, MAX_SYMBOLS)) for (const f of repo.grep(w).slice(0, MAX_PER_SYMBOL)) files.add(f);
  // A quoted old value (a title, a label) locates the file that holds it.
  for (const q of quotedLiterals(text)) for (const f of repo.grep(q).slice(0, MAX_PER_SYMBOL)) files.add(f);

  const located = [...files].sort().slice(0, MAX_FILES);
  const sensitive = ZONES.filter(z => z.text.some(re => re.test(text)) || extra?.zones.includes(z.zone) || located.some(f => z.path.test(f))).map(z => z.zone);
  // Greenfield only when git answered: a failed git call says nothing about the repository.
  const greenfield = repo.gitOk && (repo.commits === 0 || repo.files.length < 5);
  if (!repo.gitOk) reasons.push('git unavailable');
  const wordCount = text.trim().split(/\s+/).length;
  // Files the task names set its size; where its symbols also appear (tests, callers) does not lift it.
  const sized = named.size ? named.size : located.length;

  let path: PathName;
  if (greenfield) { path = 'large'; reasons.push('greenfield repository'); }
  else if (LARGE.some(re => re.test(text))) { path = 'large'; reasons.push('architecture-scale wording'); }
  else if (sized > 10) { path = 'large'; reasons.push(`${sized} files located`); }
  else if (sized > 3) { path = 'medium'; reasons.push(`${sized} files located`); }
  else if (sized === 0 && isCopyChange(text)) { path = 'trivial'; reasons.push(COPY_REASON); }
  else if (sized === 0) { path = 'small'; reasons.push('no files located: the session should judge the scope'); }
  else if (sized === 1 && wordCount <= 25 && !RENAME.some(re => re.test(text))) { path = 'trivial'; reasons.push(named.size ? 'one named file, short task' : 'one file, short task'); }
  else { path = 'small'; reasons.push(`${sized} file(s) located`); }

  if (sensitive.length && PATH_ORDER.indexOf(path) < PATH_ORDER.indexOf('medium')) {
    path = 'medium';
    reasons.push(`sensitive zone: ${sensitive.join(', ')}`);
  }
  return { path, files: located, sensitive, greenfield, validators, reasons };
}
