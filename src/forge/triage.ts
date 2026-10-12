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

// Path-like tokens: something/with/slashes or name.ext.
const PATH_TOKEN = /[\w.\-/]*[\w-]\.[A-Za-z0-9]{1,8}\b|[\w.-]+\/[\w.\-/]+/g;
// Symbols worth a grep: camelCase, PascalCase with an inner capital, snake_case, or `backticked`.
const isSymbol = (w: string) => w.length >= 4 && (/[a-z][A-Z]/.test(w) || /^[A-Za-z]+_[A-Za-z0-9_]+$/.test(w));

export function triage(task: string, repo: RepoFacts, validators: string[], extra?: { files: string[]; zones: Zone[] }): TriageResult {
  const reasons: string[] = [];
  // Capped so that the regexes below stay fast on pasted logs or huge specs.
  const text = String(task).slice(0, MAX_TEXT);
  const files = new Set<string>(extra?.files);

  for (const tok of text.match(PATH_TOKEN) ?? []) {
    const t = tok.replace(/^\.\//, '');
    for (const f of repo.files) if (f === t || f.endsWith(`/${t}`)) files.add(f);
  }
  const words = new Set([...text.matchAll(/`([^`]+)`/g)].map(m => m[1].trim()).filter(w => /^[\w.$]{3,}$/.test(w)));
  for (const w of text.split(/[^A-Za-z0-9_]+/)) if (isSymbol(w)) words.add(w);
  for (const w of [...words].slice(0, MAX_SYMBOLS)) for (const f of repo.grep(w).slice(0, MAX_PER_SYMBOL)) files.add(f);

  const located = [...files].sort().slice(0, MAX_FILES);
  const sensitive = ZONES.filter(z => z.text.some(re => re.test(text)) || extra?.zones.includes(z.zone) || located.some(f => z.path.test(f))).map(z => z.zone);
  // Greenfield only when git answered: a failed git call says nothing about the repository.
  const greenfield = repo.gitOk && (repo.commits === 0 || repo.files.length < 5);
  if (!repo.gitOk) reasons.push('git unavailable');
  const wordCount = text.trim().split(/\s+/).length;

  let path: PathName;
  if (greenfield) { path = 'large'; reasons.push('greenfield repository'); }
  else if (LARGE.some(re => re.test(text))) { path = 'large'; reasons.push('architecture-scale wording'); }
  else if (located.length > 10) { path = 'large'; reasons.push(`${located.length} files located`); }
  else if (located.length > 3) { path = 'medium'; reasons.push(`${located.length} files located`); }
  else if (located.length === 0) { path = 'small'; reasons.push('no files located: the session should judge the scope'); }
  else if (located.length === 1 && wordCount <= 25) { path = 'trivial'; reasons.push('one file, short task'); }
  else { path = 'small'; reasons.push(`${located.length} file(s) located`); }

  if (sensitive.length && PATH_ORDER.indexOf(path) < PATH_ORDER.indexOf('medium')) {
    path = 'medium';
    reasons.push(`sensitive zone: ${sensitive.join(', ')}`);
  }
  return { path, files: located, sensitive, greenfield, validators, reasons };
}
