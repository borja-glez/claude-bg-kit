// Plan 6b-1, Task 1 (B2, H6, M9): a command line split into the simple commands the autonomy guard judges, each word
// read the way its own shell reads it. Bash drops an unquoted `\` (`rm -rf .\./.\./x` deletes ../../x), PowerShell keeps
// it and escapes with the backtick, cmd keeps it and escapes with `^`: reading the three alike lets a delete outside pass.
// The commands a segment runs inside (bash -c, cmd /c, pwsh -Command and -EncodedCommand, eval, iex, $(…), <(…),
// backticks, script blocks, rebase -x) are split in their own dialect and added after it; wrappers (nohup, env, timeout,
// xargs, find -exec, Start-Process…) are dropped so that argv[0] is the command that runs.
// A word holding what only the running shell knows (a variable, a substitution, an unclosed quote) is `dynamic`, never a
// guess: the rules deny on an unknown target. Pure: it reads no file and starts no process.
import os from 'node:os';
import path from 'node:path';

export type Dialect = 'bash' | 'powershell' | 'cmd';
/** A word as its shell hands it to the command: `dynamic` when the hook cannot know it, `glob` when it is a pattern. */
export interface Word { text: string; dynamic: boolean; glob: boolean }
export type Separator = '&&' | '||' | ';' | '|' | '&' | '\n';
/**
 * One simple command. `cwd`: where it runs (null when an earlier cd does not resolve); `after`: the separator before it
 * (null for the first and for those a nested command adds); `dialect`: the shell that reads it; `dynamicArgs`: it gets
 * arguments the hook does not see (xargs, find -exec). Every redirection that writes is `>` (overwrite) or `>>` (append).
 */
export interface Segment {
  argv: Word[];
  env: Record<string, Word>;
  redirects: { op: '>' | '>>' | '<'; target: Word }[];
  cwd: string | null;
  after: Separator | null;
  dialect: Dialect;
  dynamicArgs: boolean;
}

/** T4-SINKS: the devices a write lands in without touching a file (plus /dev/fd/<n>); `$null` only in powershell. */
export const NULL_SINKS: readonly string[] = ['/dev/null', '/dev/stdout', '/dev/stderr', '/dev/tty', 'NUL', 'nul', 'CON', 'con', '$null'];

/** Whether a word's text is a null sink or a standard stream in its dialect (never a file target). */
export function isNullSink(text: string, d: Dialect): boolean {
  if (/^\/dev\/fd\/\d+$/.test(text)) return true;
  if (text === '$null') return d === 'powershell';
  return NULL_SINKS.some(x => (d === 'bash' ? x === text : x.toLowerCase() === text.toLowerCase()));
}

/** H6: the name of a command for comparing: its basename, without a leading `\` or an .exe/.cmd/.bat/.ps1 extension, lower-cased. */
export function commandName(w: Word): string {
  const base = w.text.slice(Math.max(w.text.lastIndexOf('/'), w.text.lastIndexOf('\\')) + 1);
  return base.replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase();
}

/**
 * M9: the absolute path a word names in its shell, or null when it cannot be known. PowerShell and cmd read `\` as a
 * separator on every platform; a drive letter is absolute on win32 and unknown elsewhere; Git Bash on win32 maps `/x/…`
 * and `/cygdrive/x/…` to `X:\…` and `/tmp` to the temp folder, and any other `/…` is unknown; `~` is unknown.
 */
export function shellPath(text: string, cwd: string, dialect: Dialect, platform: NodeJS.Platform = process.platform): string | null {
  const win = platform === 'win32', lib = win ? path.win32 : path.posix;
  if (!text || text.startsWith('~')) return null;
  const t = dialect === 'bash' ? text : text.replace(/\\/g, '/');
  if (dialect === 'bash' && win && t.startsWith('/')) {
    const drive = /^\/(?:cygdrive\/)?([A-Za-z])(?=\/|$)(.*)$/.exec(t);
    if (drive) return lib.resolve(`${drive[1].toUpperCase()}:\\${drive[2]}`);
    return t === '/tmp' || t.startsWith('/tmp/') ? lib.join(os.tmpdir(), t.slice(4)) : null;
  }
  const drive = /^[A-Za-z]:/.test(t);
  if (drive && (!win || !/^[A-Za-z]:[\\/]/.test(t))) return null;
  // A colon past the drive is an NTFS stream or a PowerShell provider path: unknown.
  if ((win || dialect !== 'bash') && t.slice(drive ? 2 : 0).includes(':')) return null;
  return lib.resolve(cwd, t);
}

/** The simple commands of a command line run in `cwd` by the shell of `dialect`. */
export function shellSegments(command: string, cwd: string, dialect: Dialect): Segment[] {
  return parse(command, cwd, dialect, null, 0);
}

// ---- words as lexed -------------------------------------------------------------------------------------------------

type Op = '>' | '>>' | '<';
/** A command text met inside another, to split in its own dialect; taint marks (`d`) the characters the hook cannot know. */
interface Nest { text: string; dialect: Dialect; taint: string | null }
/** A word: mask holds per character u (unquoted), q (quoted or escaped) or d (an expansion the hook does not resolve). */
interface Raw { text: string; mask: string; dyn: boolean; glob: boolean; comma: boolean; nests: Nest[] }
type Tok = { k: 'word'; w: Raw } | { k: 'sep'; op: Separator } | { k: 'redir'; op: Op | 'skip' } | { k: 'open'; sub: boolean }
  | { k: 'close' } | { k: 'nest'; nests: Nest[] };

const isDyn = (w: Raw): boolean => w.dyn || w.mask.includes('d');
const plain = (w: Raw): boolean => !w.dyn && !/[^u]/.test(w.mask);
const pub = (w: Raw): Word => ({ text: w.text, dynamic: isDyn(w), glob: w.glob });
const nameOf = (w: Raw): string => commandName(pub(w));
const cut = (w: Raw, a: number, b?: number): Raw => ({ ...w, text: w.text.slice(a, b), mask: w.mask.slice(a, b) });
const isSink = (w: Raw, d: Dialect): boolean => !isDyn(w) && isNullSink(w.text, d);

// PowerShell takes the typographic quotes as quotes too.
const SQ = "'‘’‚‛", DQ = '"“”„';
const PS_ESC: Record<string, string> = { n: '\n', t: '\t', r: '\r', '0': '\0', a: '\x07', b: '\b', f: '\f', v: '\v', e: '\x1b' };
const VAR = /[A-Za-z_]\w*|[0-9@*#?$!-]/y;
const PSVAR = /(?:[A-Za-z_]\w*:)?\w+|[?$^]/y;
const CMDVAR = /%[^%\s]+%|%~[A-Za-z$:]*\d|%[\d*]|%%?[A-Za-z]|![^!\s]+!/y;
const DUP = /(?:\d+|-)(?=[\s;|&<>()]|$)/y;
const MAX_LEVEL = 64;
const FOR_CMD = /\(\s*(['`])([^\n]*?)\1\s*\)/y;
const HERE = /[ \t]*\r?\n/y;

/**
 * The tokens of `s` from `start` in dialect `d`, up to the unquoted `stop` that closes a substitution (`end` is its
 * index, or s.length when it never closes). Quotes, escapes, expansions and heredocs are read here; brace lists later.
 */
function lex(s: string, start: number, d: Dialect, stop: ')' | '}' | null, taint: string | null, level = 0): { toks: Tok[]; end: number } {
  // Past MAX_LEVEL nested substitutions the rest is read as one that never closes: dynamic, and split again one level up.
  if (level > MAX_LEVEL) return { toks: [], end: s.length };
  const toks: Tok[] = [], docs: { delim: string; strip: boolean; expand: boolean }[] = [];
  let w = null as Raw | null, from = 0, depth = 0, cases = 0, i = start;
  const nest = (a: number, b: number): Nest => ({ text: s.slice(a, b), dialect: d, taint: taint?.slice(a, b) ?? null });
  const word = (): Raw => {
    if (!w) { w = { text: '', mask: '', dyn: false, glob: false, comma: false, nests: [] }; from = i; }
    return w;
  };
  const add = (t: string, m: 'u' | 'q' | 'd') => { const x = word(); x.text += t; x.mask += m.repeat(t.length); };
  const dyn = (a: number, b: number, nests: Nest[] = [], open = false) => {
    add(s.slice(a, b), 'd');
    const x = word(); x.nests.push(...nests); if (open) x.dyn = true;
  };
  const end = () => {
    if (w) {
      if (taint?.slice(from, i).includes('d')) w.dyn = true;
      if (d === 'bash' && plain(w)) cases = Math.max(0, cases + (w.text === 'case' ? 1 : w.text === 'esac' ? -1 : 0));
      toks.push({ k: 'word', w });
    }
    w = null;
  };
  const push = (t: Tok) => { end(); toks.push(t); };
  // A substitution read to its close and split later: bash $(…) <(…) >(…), PowerShell $(…) @(…) (…) {…} @{…}.
  const group = (at: number, a: number, close: ')' | '}'): number => {
    const e = lex(s, a, d, close, taint, level + 1).end;
    dyn(at, Math.min(e + 1, s.length), [nest(a, e)], e >= s.length);
    return e + 1;
  };
  const braceEnd = (j: number): number => {
    for (let k = 0; j < s.length; j++) {
      if (s[j] === '\\') j++;
      else if (s[j] === '{') k++;
      else if (s[j] === '}' && k-- === 0) return j;
    }
    return s.length;
  };
  const tick = (at: number): { e: number; n: Nest } => {
    let j = at + 1;
    while (j < s.length && s[j] !== '`') j += s[j] === '\\' ? 2 : 1;
    const text = s.slice(at + 1, Math.min(j, s.length)).replace(/\\([\\`$])/g, '$1');
    return { e: j, n: { text, dialect: 'bash', taint: taint?.slice(at, j).includes('d') ? 'd'.repeat(text.length) : null } };
  };
  // The substitutions inside a text that is not split itself: a ${…}, an unquoted heredoc, a PowerShell @"…"@.
  const subs = (a: number, b: number): Nest[] => {
    const out: Nest[] = [];
    for (let j = a; j < b; j++) {
      if (s[j] === (d === 'bash' ? '\\' : '`')) j++;
      else if (s[j] === '$' && s[j + 1] === '(') { const e = lex(s, j + 2, d, ')', taint, level + 1).end; out.push(nest(j + 2, Math.min(e, b))); j = e; }
      else if (d === 'bash' && s[j] === '$' && s[j + 1] === '{') { const e = braceEnd(j + 2); out.push(...subs(j + 2, Math.min(e, b))); j = e; }
      else if (d === 'bash' && s[j] === '`') { const t = tick(j); out.push(t.n); j = t.e; }
    }
    return out;
  };
  const bashDollar = (at: number, inDq: boolean): number => {
    const n = s[at + 1];
    if (n === '(') return group(at, at + 2, ')');
    if (n === '{') { const e = braceEnd(at + 2); dyn(at, Math.min(e + 1, s.length), subs(at + 2, e), e >= s.length); return e + 1; }
    if (n === "'" && !inDq) {
      let j = at + 2;
      while (j < s.length && s[j] !== "'") j += s[j] === '\\' ? 2 : 1;
      dyn(at, Math.min(j + 1, s.length), [], j >= s.length);
      return j + 1;
    }
    if (n === '"' && !inDq) return at + 1; // $"…" reads as "…"
    VAR.lastIndex = at + 1;
    if (VAR.test(s)) { const e = VAR.lastIndex; dyn(at, e); return e; }
    add('$', inDq ? 'q' : 'u');
    return at + 1;
  };
  const backtick = (at: number): number => { const t = tick(at); dyn(at, Math.min(t.e + 1, s.length), [t.n], t.e >= s.length); return t.e + 1; };
  const bashDq = (at: number): number => {
    word();
    for (let j = at + 1; j < s.length;) {
      const c = s[j];
      if (c === '"') return j + 1;
      if (c === '\\' && '$`"\\\n'.includes(s[j + 1] ?? 'x')) { if (s[j + 1] !== '\n') add(s[j + 1], 'q'); j += 2; }
      else if (c === '$') j = bashDollar(j, true);
      else if (c === '`') j = backtick(j);
      else { add(c, 'q'); j++; }
    }
    word().dyn = true;
    return s.length;
  };
  const heredoc = (j: number): number => {
    const strip = s[j] === '-';
    if (strip) j++;
    while (s[j] === ' ' || s[j] === '\t') j++;
    let delim = '', quoted = false;
    while (j < s.length && !/[\s;|&<>()]/.test(s[j])) {
      const c = s[j];
      if (c === "'" || c === '"') { const e = s.indexOf(c, j + 1), k = e < 0 ? s.length : e; delim += s.slice(j + 1, k); quoted = true; j = k + 1; }
      else if (c === '\\') { delim += s[j + 1] ?? ''; quoted = true; j += 2; }
      else { delim += c; j++; }
    }
    docs.push({ delim, strip, expand: !quoted });
    return Math.min(j, s.length);
  };
  // At a newline: the bodies of the pending heredocs are input, not commands; an unquoted one still runs its $(…).
  const bodies = (j: number): number => {
    for (const h of docs.splice(0)) {
      let k = j, bodyEnd = s.length;
      while (k < s.length) {
        const nl = s.indexOf('\n', k), e = nl < 0 ? s.length : nl, raw = s.slice(k, e);
        const line = h.strip ? raw.replace(/^\t+/, '') : raw;
        if (line === h.delim) { bodyEnd = k; k = e + 1; break; }
        if (stop && line.startsWith(h.delim + stop)) { bodyEnd = k; k += raw.length - line.length + h.delim.length; break; }
        k = e + 1;
      }
      if (h.expand) { const ns = subs(j, bodyEnd); if (ns.length) toks.push({ k: 'nest', nests: ns }); }
      j = Math.min(k, s.length);
    }
    return j;
  };
  const redirect = (at: number): number => {
    const c = s[at], n = s[at + 1];
    if (d === 'bash' && n === '(') return group(at, at + 2, ')');
    // `2>`, PowerShell `*>`: the digits before the operator name a descriptor, not a word.
    if (w && plain(w) && (/^\d+$/.test(w.text) || (d === 'powershell' && w.text === '*'))) w = null;
    else end();
    let op: Op = c === '<' ? '<' : '>', len = 1;
    if (c === '<' && d === 'bash' && n === '<') {
      if (s[at + 2] === '<') { toks.push({ k: 'redir', op: 'skip' }); return at + 3; }
      return heredoc(at + 2);
    }
    if (c === '<' && d === 'bash' && n === '>') { op = '>'; len = 2; }
    if (c === '>' && n === '>') { op = '>>'; len = 2; }
    if (c === '>' && n === '|' && d === 'bash') len = 2;
    if (n === '&') { DUP.lastIndex = at + 2; if (DUP.test(s)) return DUP.lastIndex; len = 2; }
    toks.push({ k: 'redir', op });
    return at + len;
  };
  const psSq = (at: number): number => {
    word();
    for (let j = at + 1; j < s.length; j++) {
      if (!SQ.includes(s[j])) { add(s[j], 'q'); continue; }
      if (!SQ.includes(s[j + 1] ?? 'x')) return j + 1;
      add("'", 'q'); j++;
    }
    word().dyn = true;
    return s.length;
  };
  const psDollar = (at: number, inDq: boolean): number => {
    const n = s[at + 1];
    if (n === '(') return group(at, at + 2, ')');
    if (n === '{') { const e = s.indexOf('}', at + 2), k = e < 0 ? s.length : e + 1; dyn(at, k, [], e < 0); return k; }
    PSVAR.lastIndex = at + 1;
    if (PSVAR.test(s)) {
      const e = PSVAR.lastIndex;
      if (/^\$(null|true|false)$/i.test(s.slice(at, e))) add(s.slice(at, e), 'q'); else dyn(at, e);
      return e;
    }
    add('$', inDq ? 'q' : 'u');
    return at + 1;
  };
  const psDq = (at: number): number => {
    word();
    for (let j = at + 1; j < s.length;) {
      const c = s[j];
      if (DQ.includes(c)) { if (!DQ.includes(s[j + 1] ?? 'x')) return j + 1; add('"', 'q'); j += 2; }
      else if (c === '`' && j + 1 < s.length) { add(PS_ESC[s[j + 1]] ?? s[j + 1], 'q'); j += 2; }
      else if (c === '$') j = psDollar(j, true);
      else { add(c, 'q'); j++; }
    }
    word().dyn = true;
    return s.length;
  };
  // @'…'@ and @"…"@: the opener ends its line, the closer starts one. -1 when `at` does not open one.
  const hereString = (at: number): number => {
    HERE.lastIndex = at + 2;
    if (!HERE.test(s)) return -1;
    const a = HERE.lastIndex, lit = SQ.includes(s[at + 1]), e = s.indexOf(`\n${lit ? "'" : '"'}@`, a - 1), b = e < 0 ? s.length : e;
    if (lit || !s.slice(a, b).includes('$')) add(s.slice(a, Math.max(a, b)), 'q');
    else dyn(a, b, subs(a, b));
    if (e < 0) word().dyn = true;
    return e < 0 ? s.length : e + 3;
  };
  const cmdVar = (at: number, m: 'u' | 'q'): number => {
    CMDVAR.lastIndex = at;
    if (CMDVAR.test(s)) { const e = CMDVAR.lastIndex; dyn(at, e); return e; }
    add(s[at], m);
    return at + 1;
  };
  const cmdDq = (at: number): number => {
    word();
    for (let j = at + 1; j < s.length;) {
      if (s[j] === '"') return j + 1;
      if (s[j] === '%' || s[j] === '!') j = cmdVar(j, 'q'); else { add(s[j], 'q'); j++; }
    }
    word().dyn = true;
    return s.length;
  };

  while (i < s.length) {
    const c = s[i], n = s[i + 1];
    if (c === ')' && d === 'bash') end(); // an `esac` right before it closes its case first
    if (c === ')' && d !== 'powershell' && depth > 0) { push({ k: 'close' }); depth--; i++; continue; }
    if (c === ')' && d === 'bash' && cases > 0) { push({ k: 'sep', op: ';' }); i++; continue; } // a case pattern
    if (c === stop) { end(); return { toks, end: i }; }
    if (c === ')' && d === 'bash') { push({ k: 'sep', op: ';' }); i++; continue; }
    if (c === '\n') { end(); i = bodies(i + 1); toks.push({ k: 'sep', op: '\n' }); continue; }
    if (c === ' ' || c === '\t' || c === '\r' || (d === 'cmd' && (c === ',' || c === ';'))) { end(); i++; continue; }
    if (d === 'powershell' && c === ',') {
      const last = toks[toks.length - 1];
      if (w) w.comma = true; else if (last?.k === 'word') last.w.comma = true;
      end(); i++; continue;
    }
    if (d === 'bash' && c === '\\') { if (n !== '\n') add(n ?? '\\', n === undefined ? 'u' : 'q'); i += 2; continue; }
    if ((d === 'powershell' && c === '`') || (d === 'cmd' && c === '^')) {
      if (n === '\r' && s[i + 2] === '\n') { i += 3; continue; }
      if (n !== '\n' && n !== undefined) add(n, 'q');
      i += 2; continue;
    }
    if (!w && d !== 'cmd' && (c === '#' || (d === 'powershell' && c === '<' && n === '#'))) {
      if (c === '<') { const e = s.indexOf('#>', i + 2); i = e < 0 ? s.length : e + 2; }
      else while (i < s.length && s[i] !== '\n') i++;
      continue;
    }
    if (d === 'bash') {
      if (c === "'") {
        const e = s.indexOf("'", i + 1);
        add(s.slice(i + 1, e < 0 ? s.length : e), 'q');
        if (e < 0) word().dyn = true;
        i = e < 0 ? s.length : e + 1; continue;
      }
      if (c === '"') { i = bashDq(i); continue; }
      if (c === '$') { i = bashDollar(i, false); continue; }
      if (c === '`') { i = backtick(i); continue; }
      if (c === '(' && w && /[!@*+?]$/.test(w.text) && w.mask.endsWith('u')) { // an extglob pattern
        const e = lex(s, i + 1, 'bash', ')', null, level + 1).end;
        add(s.slice(i, e + 1), 'u'); word().glob = true;
        if (e >= s.length) word().dyn = true;
        i = e + 1; continue;
      }
      if (c === '(') { push({ k: 'open', sub: true }); depth++; i++; continue; }
    } else if (d === 'powershell') {
      if (SQ.includes(c)) { i = psSq(i); continue; }
      if (DQ.includes(c)) { i = psDq(i); continue; }
      if (c === '$') { i = psDollar(i, false); continue; }
      if (c === '@' && (n === '(' || n === '{')) { i = group(i, i + 2, n === '(' ? ')' : '}'); continue; }
      if (c === '@' && !w && n !== undefined && (SQ + DQ).includes(n)) { const e = hereString(i); if (e > 0) { i = e; continue; } }
      if (c === '@' && /[A-Za-z_]/.test(n ?? '')) { PSVAR.lastIndex = i + 1; PSVAR.test(s); const e = PSVAR.lastIndex; dyn(i, e); i = e; continue; }
      if (c === '(' || c === '{') { i = group(i, i + 1, c === '(' ? ')' : '}'); continue; }
    } else {
      if (c === '"') { i = cmdDq(i); continue; }
      if (c === '%' || c === '!') { i = cmdVar(i, 'u'); continue; }
      if (c === '(' && !w) {
        // for /f … in ('command') or (`command`): the quoted text is a command cmd runs.
        FOR_CMD.lastIndex = i;
        const r = FOR_CMD.exec(s);
        if (r) {
          const a = i + r[0].indexOf(r[1]) + 1;
          push({ k: 'open', sub: false });
          toks.push({ k: 'nest', nests: [nest(a, a + r[2].length)] }, { k: 'close' });
          i = FOR_CMD.lastIndex; continue;
        }
        push({ k: 'open', sub: false }); depth++; i++; continue;
      }
    }
    if ((c === '&' && n === '&') || (c === '|' && n === '|')) { push({ k: 'sep', op: c === '&' ? '&&' : '||' }); i += 2; continue; }
    if (c === '|') { push({ k: 'sep', op: '|' }); i += d === 'bash' && n === '&' ? 2 : 1; continue; }
    if (c === ';') { push({ k: 'sep', op: ';' }); i++; continue; }
    if (c === '&' && d === 'bash' && n === '>') {
      const app = s[i + 2] === '>';
      push({ k: 'redir', op: app ? '>>' : '>' });
      i += app ? 3 : 2; continue;
    }
    if (c === '&') {
      // PowerShell's call operator at the start of a segment is not a separator.
      const last = toks[toks.length - 1];
      if (!(d === 'powershell' && !w && (!last || last.k === 'sep'))) push({ k: 'sep', op: '&' });
      i++; continue;
    }
    if (c === '>' || c === '<') { i = redirect(i); continue; }
    add(c, 'u'); i++;
  }
  end();
  return { toks, end: i };
}

// ---- brace lists and patterns -----------------------------------------------------------------------------------------

const MAX_WORDS = 256;
const RANGE = /\{(?:-?\d+\.\.-?\d+|[A-Za-z]\.\.[A-Za-z])(?:\.\.-?\d+)?\}/g;

/** Bash's brace expansion of the unquoted `{a,b}` lists of a word (with their masks); null past MAX_WORDS words. */
function braces(t: string, m: string): [string, string][] | null {
  for (let i = 0; i < t.length; i++) {
    if (t[i] !== '{' || m[i] !== 'u') continue;
    const cuts = [i];
    for (let j = i + 1, depth = 0; j < t.length; j++) {
      if (m[j] !== 'u') continue;
      if (t[j] === '{') depth++;
      else if (t[j] === ',' && !depth) cuts.push(j);
      else if (t[j] === '}' && depth) depth--;
      else if (t[j] === '}') {
        if (cuts.length === 1) break; // {x} or a range: no list here
        cuts.push(j);
        const post = braces(t.slice(j + 1), m.slice(j + 1)), out: [string, string][] = [];
        if (!post) return null;
        for (let k = 0; k + 1 < cuts.length; k++) {
          const alts = braces(t.slice(cuts[k] + 1, cuts[k + 1]), m.slice(cuts[k] + 1, cuts[k + 1]));
          if (!alts) return null;
          for (const [a, am] of alts) for (const [p, pm] of post) {
            if (out.length >= MAX_WORDS) return null;
            out.push([t.slice(0, i) + a + p, m.slice(0, i) + am + pm]);
          }
        }
        return out;
      }
    }
  }
  return [[t, m]];
}

/** A pattern: in bash an unquoted `*`, `?`, `[` or `{x..y}`; PowerShell's cmdlets and cmd's builtins expand their own. */
function isGlob(t: string, m: string, d: Dialect): boolean {
  if (d !== 'bash') return (d === 'cmd' ? /[*?]/ : /[*?[]/).test(t);
  for (let k = 0; k < t.length; k++) if (m[k] === 'u' && '*?['.includes(t[k])) return true;
  for (const r of t.matchAll(RANGE)) if (!/[^u]/.test(m.slice(r.index, r.index + r[0].length))) return true;
  return false;
}

/** The words a lexed word becomes: bash expands its brace lists (one word each; past MAX_WORDS it stays one dynamic word). */
function expand(r: Raw, d: Dialect): Raw[] {
  const alts = d === 'bash' ? braces(r.text, r.mask) : [[r.text, r.mask] as [string, string]];
  if (!alts) return [{ ...r, dyn: true }];
  return alts.map(([text, mask]) => ({ ...r, text, mask, glob: r.glob || isGlob(text, mask, d) }));
}

/** The words of a text as `d` splits it (a dynamic word cannot be split: it stays as it is). */
function wordsIn(v: Raw, d: Dialect): Raw[] {
  return isDyn(v) ? [v] : lex(v.text, 0, d, null, null).toks.flatMap(t => (t.k === 'word' ? expand(t.w, d) : []));
}

/** Words joined into the command text a nested shell reads, keeping which characters the hook cannot know. */
function joined(ws: Raw[], quote: boolean): { text: string; taint: string | null } {
  const parts = ws.map(w => {
    const q = quote && ws.length > 1 && /\s/.test(w.text) ? '"' : '', edge = q ? '.' : '';
    return { text: q + w.text + q, taint: edge + (w.dyn ? 'd'.repeat(w.text.length) : w.mask.replace(/[^d]/g, '.')) + edge };
  });
  const taint = parts.map(p => p.taint).join('.');
  return { text: parts.map(p => p.text).join(' '), taint: taint.includes('d') ? taint : null };
}

function decode(w: Raw): string | null {
  if (isDyn(w) || !/^[A-Za-z0-9+/]+={0,2}$/.test(w.text) || w.text.length % 4) return null;
  const b = Buffer.from(w.text, 'base64');
  return b.length % 2 || b.toString('base64') !== w.text ? null : b.toString('utf16le');
}

function skipOpts(ws: Raw[], valued: readonly string[], positional = 0): Raw[] {
  let i = 0;
  while (i < ws.length && /^-./.test(ws[i].text)) {
    if (ws[i].text === '--') { i++; break; }
    i += valued.includes(ws[i].text) ? 2 : 1;
  }
  return ws.slice(i + positional);
}

// ---- segments ---------------------------------------------------------------------------------------------------------

const MAX_DEPTH = 16;
/** H6: wrappers dropped from the front of a segment, with their options that take a value and the words before the command. */
const WRAPPERS = new Map<string, [readonly string[], number]>([
  ['nohup', [[], 0]], ['time', [[], 0]], ['exec', [['-a'], 0]], ['command', [[], 0]], ['builtin', [[], 0]], ['doas', [['-u', '-C'], 0]],
  ['sudo', [['-u', '-g', '-C', '-D', '-h', '-p', '-r', '-t', '-U', '-T'], 0]], ['gsudo', [[], 0]],
  ['chronic', [[], 0]], ['busybox', [[], 0]], ['timeout', [['-s', '--signal', '-k', '--kill-after'], 1]], ['nice', [['-n', '--adjustment'], 0]],
  ['ionice', [['-c', '--class', '-n', '--classdata', '-p', '--pid', '-P', '--pgid', '-u', '--uid'], 0]],
  ['stdbuf', [['-i', '-o', '-e', '--input', '--output', '--error'], 0]], ['watch', [['-n', '--interval', '-q', '--equexit'], 0]],
  ['wsl', [['-d', '--distribution', '-u', '--user', '--cd', '--shell-type'], 0]],
]);
/** Reserved words that open or close a compound command: what follows them is the command. */
const KEYWORDS: Record<Dialect, ReadonlySet<string>> = {
  bash: new Set(['!', '{', '}', 'if', 'then', 'elif', 'else', 'do', 'while', 'until', 'fi', 'done', 'esac', 'function']),
  powershell: new Set(),
  cmd: new Set(['else', 'do']),
};
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish']);
const CD = new Set(['cd', 'chdir', 'pushd', 'set-location', 'sl', 'push-location']);
const POPD = new Set(['popd', 'pop-location']);
/** git's global options that take a value (shared with the autonomy git rule, Task 4). */
export const GIT_VALUED: readonly string[] = ['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env', '--exec-path', '--attr-source'];
const XARGS_VALUED = ['-a', '-d', '-E', '-I', '-J', '-L', '-n', '-P', '-s', '--arg-file', '--delimiter', '--eof', '--max-lines',
  '--max-args', '--max-procs', '--max-chars', '--process-slot-var'];
const PWSH_VALUED = ['executionpolicy', 'ep', 'windowstyle', 'inputformat', 'outputformat', 'version', 'configurationname',
  'custompipename', 'settingsfile', 'psconsolefile'];
// cmd reads `rd/s/q`, `cd..` and `cd\` as the builtin and its arguments.
const CMD_GLUED = /^(cd|chdir|rd|rmdir|del|erase|md|mkdir|copy|move|ren|rename|type|dir|pushd|start|mklink)[\\/.]/i;

interface RawSeg { words: Raw[]; redirs: { op: Op; target: Raw }[]; nests: Nest[] }

const blank = (cwd: string | null, dialect: Dialect, after: Separator | null = null): Segment =>
  ({ argv: [], env: {}, redirects: [], cwd, after, dialect, dynamicArgs: false });

function parse(text: string, cwd: string | null, d: Dialect, taint: string | null, depth: number): Segment[] {
  if (depth > MAX_DEPTH) return [{ ...blank(cwd, d), argv: [{ text, dynamic: true, glob: false }] }];
  const out: Segment[] = [], saved: [boolean, string | null][] = [];
  let raw: RawSeg = { words: [], redirs: [], nests: [] }, after: Separator | null = null, redir: Op | 'skip' | null = null;
  const empty = () => !raw.words.length && !raw.redirs.length && !raw.nests.length;
  const flush = (next: Separator | null) => {
    if (!empty()) {
      const r = build(raw, cwd, d, after, next, depth);
      out.push(...r.segs); cwd = r.cwd; after = null;
    }
    raw = { words: [], redirs: [], nests: [] }; redir = null;
  };
  for (const t of lex(text, 0, d, null, taint).toks) {
    if (t.k === 'word') {
      if (redir === 'skip') raw.nests.push(...t.w.nests); // a here-string is input, not a file
      else if (redir) raw.redirs.push({ op: redir, target: t.w });
      else raw.words.push(t.w);
      redir = null;
    } else if (t.k === 'redir') redir = t.op;
    else if (t.k === 'nest') raw.nests.push(...t.nests);
    else if (t.k === 'sep') {
      // A newline after && || | continues the command list.
      if (!empty()) { flush(t.op); after = t.op; }
      else if (out.length && !(t.op === '\n' && (after === '&&' || after === '||' || after === '|'))) after = t.op;
      redir = null;
    } else if (t.k === 'open') { flush(null); saved.push([t.sub, cwd]); }
    else { flush(null); const top = saved.pop(); if (top?.[0]) cwd = top[1]; } // a subshell's cd stays inside it
  }
  flush(null);
  return out;
}

/** One lexed segment: the segment, then those it runs inside; and the cwd of the segments after it. */
function build(raw: RawSeg, cwd: string | null, d: Dialect, after: Separator | null, next: Separator | null, depth: number):
  { segs: Segment[]; cwd: string | null } {
  const seg = blank(cwd, d, after), nests = [...raw.nests], words: Raw[] = [];
  for (const w of raw.words) { nests.push(...w.nests); words.push(...expand(w, d)); }
  for (const { op, target } of raw.redirs) {
    nests.push(...target.nests);
    const ws = expand(target, d), t = ws.length === 1 ? ws[0] : { ...ws[0], dyn: true };
    if (!isSink(t, d)) seg.redirects.push({ op, target: pub(t) });
  }
  const more = command(seg, words, depth);
  // A segment left with nothing (a `fi`, a `done`, a bare wrapper) is not reported.
  const segs = seg.argv.length || seg.redirects.length || Object.keys(seg.env).length || seg.dynamicArgs ? [seg, ...more] : more;
  for (const n of nests) segs.push(...parse(n.text, seg.cwd, n.dialect, n.taint, depth + 1));
  const name = seg.argv.length ? commandName(seg.argv[0]) : '';
  // A cd in a pipeline, or in the background (bash, PowerShell), runs apart: where the next segment runs is not known.
  const apart = after === '|' || next === '|' || (next === '&' && d !== 'cmd');
  if (POPD.has(name)) cwd = null;
  else if (CD.has(name)) cwd = apart ? null : cdTarget(seg.argv.slice(1), cwd, d);
  return { segs, cwd };
}

function cdTarget(args: Word[], cwd: string | null, d: Dialect): string | null {
  const rest = args.filter(w => !(d === 'cmd' ? /^\/d$/i.test(w.text) : d === 'powershell' ? w.text.startsWith('-') && w.text.length > 1
    : /^-[LPe@]+$|^--$/.test(w.text)));
  const target = d === 'cmd' && rest.length > 1
    ? { text: rest.map(w => w.text).join(' '), dynamic: rest.some(w => w.dynamic), glob: rest.some(w => w.glob) }
    : rest.length === 1 ? rest[0] : null;
  if (cwd === null || !target || target.dynamic || target.glob || target.text === '-' || target.text === '+') return null;
  return shellPath(target.text, cwd, d);
}

/** Fills seg's argv and env from its words, wrappers dropped (H6); returns the segments it runs besides. */
function command(seg: Segment, ws: Raw[], depth: number): Segment[] {
  const d = seg.dialect, more: Segment[] = [];
  const sub = (words: Raw[], dialect: Dialect, quote = false, cwd = seg.cwd) => {
    const j = joined(words, quote);
    if (words.length) more.push(...parse(j.text, cwd, dialect, j.taint, depth + 1));
  };
  const run = (words: Raw[], cwd: string | null, dynamicArgs: boolean) => {
    const s = blank(cwd, d);
    s.dynamicArgs = dynamicArgs;
    more.push(s, ...command(s, words, depth));
  };
  for (let guard = 0; ws.length && guard < 64; guard++) {
    const w = ws[0], name = nameOf(w), eq = /^([A-Za-z_]\w*)=/.exec(w.text);
    if (eq && !/[^u]/.test(w.mask.slice(0, eq[0].length))) {
      Object.defineProperty(seg.env, eq[1], { value: pub(cut(w, eq[0].length)), enumerable: true, writable: true, configurable: true });
      ws = ws.slice(1); continue;
    }
    if (plain(w) && KEYWORDS[d].has(d === 'bash' ? w.text : name)) { ws = ws.slice(w.text === 'function' ? 2 : 1); continue; }
    if (d === 'powershell' && plain(w) && w.text === '.') { ws = ws.slice(1); continue; } // dot-sourcing
    if (d === 'cmd' && w.text.startsWith('@')) { ws = w.text.length > 1 ? [cut(w, 1), ...ws.slice(1)] : ws.slice(1); continue; }
    const glued = d === 'cmd' ? CMD_GLUED.exec(w.text) : null;
    if (glued) {
      const at = [0, glued[1].length];
      if (w.text[at[1]] === '/') for (let k = at[1] + 1; k < w.text.length; k++) if (w.text[k] === '/') at.push(k);
      ws = [...at.map((a, k) => cut(w, a, at[k + 1])), ...ws.slice(1)]; continue;
    }
    if (d === 'cmd' && name === 'if') {
      let r = ws.slice(1);
      while (r.length && /^(\/i|not)$/i.test(r[0].text)) r = r.slice(1);
      const a = r[0]?.text.toLowerCase() ?? '', b = r[1]?.text.toLowerCase() ?? '';
      if (/^(exist|defined|errorlevel|cmdextversion)$/.test(a)) r = r.slice(2);
      else if (/^(==|equ|neq|lss|leq|gtr|geq)$/.test(b)) r = r.slice(3);
      else if (a.endsWith('==') || b.startsWith('==')) r = r.slice(2);
      else if (a.includes('==')) r = r.slice(1);
      ws = r; continue;
    }
    if (d === 'cmd' && name === 'start') {
      let i = ws.length > 2 && !/[^q]/.test(ws[1].mask) ? 2 : 1; // a quoted title comes first
      for (; i < ws.length && ws[i].text.startsWith('/'); i++) if (/^\/d/i.test(ws[i].text)) { seg.cwd = null; if (ws[i].text.length === 2) i++; }
      ws = ws.slice(i); continue;
    }
    const wrap = WRAPPERS.get(name);
    if (wrap) {
      ws = skipOpts(ws.slice(1), wrap[0], wrap[1]);
      // watch and wsl hand their words to a shell: one word is a whole command line.
      if ((name === 'watch' && ws.length === 1) || (name === 'wsl' && (ws.length === 1 || d !== 'bash'))) sub(ws, 'bash');
      continue;
    }
    if (name === 'env') {
      let i = 1;
      while (i < ws.length && /^-/.test(ws[i].text)) {
        const t = ws[i].text, split = /^(?:-S|--split-string=?)(.*)$/.exec(t);
        if (t === '--') { i++; break; }
        if (/^(-C|--chdir)/.test(t)) seg.cwd = null;
        if (split) {
          const v = split[1] ? cut(ws[i], t.length - split[1].length) : ws[i + 1];
          ws = [...ws.slice(0, i), ...(v ? wordsIn(v, 'bash') : []), ...ws.slice(i + (split[1] ? 1 : 2))];
          break;
        }
        i += /^(-[uC]|--unset|--chdir)$/.test(t) ? 2 : 1;
      }
      ws = ws.slice(i); continue;
    }
    if ((name === 'pnpm' || name === 'yarn') && ws[1]?.text === 'exec') { ws = skipOpts(ws.slice(2), []); continue; }
    if (name === 'xargs') {
      seg.dynamicArgs = true;
      let i = 1, rep: string | null = null;
      for (; i < ws.length && /^-./.test(ws[i].text); i++) {
        const t = ws[i].text, r = /^(?:-[IJ]|-i|--replace=?)(.*)$/.exec(t);
        if (t === '--') { i++; break; }
        if (r) rep = r[1] || (/^-[IJ]$/.test(t) ? ws[i + 1]?.text ?? null : '{}');
        if (XARGS_VALUED.includes(t)) i++;
      }
      ws = ws.slice(i).map(x => (rep && x.text.includes(rep) ? { ...x, dyn: true } : x));
      continue;
    }
    if (d === 'powershell' && (name === 'start-process' || name === 'saps' || name === 'start')) {
      let file: Raw | undefined, pos = 0;
      const args: Raw[] = [];
      for (let i = 1; i < ws.length; i++) {
        // `-Name value` or `-Name:value`: the value glued after the colon is read as the next word would be.
        const w = ws[i], g = /^-([a-z][\w-]*):/i.exec(w.text), at = g ? g[0].length : w.text.length;
        const p = (g ? g[1] : w.text.slice(1)).toLowerCase(), glued = g && w.text.length > at ? cut(w, at) : null;
        const param = /^-[a-z]/i.test(w.text) && !/[^u]/.test(w.mask.slice(0, at)) && (g !== null || !w.dyn);
        const val = (): Raw | undefined => glued ?? ws[++i];
        // An argument and the array items a comma joins to it.
        const take = (k: number, first: Raw | undefined = ws[k]): Raw[] => {
          const out: Raw[] = [];
          for (let x = first; x; x = ws[++k]) { out.push(x); if (!ws[k].comma) break; }
          i = k;
          return out;
        };
        if (!param) { if (pos++ === 0) file = w; else args.push(...take(i)); }
        else if ('filepath'.startsWith(p) || p === 'path' || p === 'pspath') file = val();
        else if ('argumentlist'.startsWith(p) || p === 'args') args.push(...(glued ? take(i, glued) : take(i + 1)));
        else if (p.length > 1 && 'workingdirectory'.startsWith(p)) { const v = val(); seg.cwd = v && !isDyn(v) && seg.cwd !== null ? shellPath(v.text, seg.cwd, d) : null; }
        else if (/^(redirectstandard(output|error|input)|rs[oei])$/.test(p)) {
          const v = val();
          if (v && !isSink(v, d)) seg.redirects.push({ op: /input|rsi/.test(p) ? '<' : '>', target: pub(v) });
        } else if (['verb', 'windowstyle', 'credential', 'environment'].some(x => x.startsWith(p))) val();
      }
      ws = file ? [file, ...args.flatMap(a => wordsIn(a, 'powershell'))] : [];
      continue;
    }
    break;
  }

  // find … -exec|-execdir|-ok|-okdir <cmd> … ;|+ runs <cmd> on what it finds: arguments the hook does not see.
  const execAt = () => (ws.length && nameOf(ws[0]) === 'find' ? ws.findIndex((x, j) => j > 0 && /^-(exec|execdir|ok|okdir)$/.test(x.text)) : -1);
  for (let k = execAt(); k > 0; k = execAt()) {
    let e = ws.findIndex((x, j) => j > k && (x.text === ';' || x.text === '+'));
    if (e < 0) e = ws.length;
    const inner = ws.slice(k + 1, e).filter(x => x.text !== '{}').map(x => (x.text.includes('{}') ? { ...x, dyn: true } : x));
    run(inner, /dir$/.test(ws[k].text) ? null : seg.cwd, true);
    ws = [...ws.slice(0, k), ...ws.slice(e + 1)];
  }

  // The commands a segment runs inside, each split in the dialect that reads it.
  const n0 = ws.length ? nameOf(ws[0]) : '', args = ws.slice(1);
  if (SHELLS.has(n0)) {
    let c = false, i = 0;
    for (; i < args.length && /^[-+]./.test(args[i].text); i++) {
      const t = args[i].text;
      if (t === '--') { i++; break; }
      if (/^-[A-Za-z]*c[A-Za-z]*$/.test(t)) c = true;
      if (/^[-+][oO]$/.test(t) || t === '--rcfile' || t === '--init-file') i++;
    }
    if (c && args[i]) sub([args[i]], 'bash');
  } else if (n0 === 'eval' && d === 'bash') sub(args, 'bash');
  else if (d === 'powershell' && (n0 === 'iex' || n0 === 'invoke-expression')) {
    sub(args.flatMap(x => { // -Command is dropped; a value glued after `-Command:` is kept
      const m = /^-([a-z]*)(:?)/i.exec(x.text);
      if (!m || !'command'.startsWith(m[1].toLowerCase())) return [x];
      return m[2] && x.text.length > m[0].length ? [cut(x, m[0].length)] : [];
    }), 'powershell');
  } else if (n0 === 'npx' || (n0 === 'npm' && /^(exec|x)$/.test(args[0]?.text ?? ''))) {
    args.forEach((x, k) => {
      if ((x.text === '-c' || x.text === '--call') && args[k + 1]) sub([args[k + 1]], 'bash');
      else if (x.text.startsWith('--call=')) sub([cut(x, 7)], 'bash');
    });
  } else if (n0 === 'git') {
    let i = 0;
    while (i < args.length && args[i].text.startsWith('-')) i += GIT_VALUED.includes(args[i].text) ? 2 : 1;
    const sc = args[i]?.text, rest = args.slice(i + 1);
    if (sc === 'rebase') {
      rest.forEach((x, k) => {
        if ((x.text === '-x' || x.text === '--exec') && rest[k + 1]) sub([rest[k + 1]], 'bash');
        else if (/^(-x|--exec=)./.test(x.text)) sub([cut(x, x.text.startsWith('-x') ? 2 : 7)], 'bash');
      });
    } else if (sc === 'bisect' && rest[0]?.text === 'run') run(rest.slice(1), seg.cwd, false);
    else if (sc === 'submodule') { const f = rest.findIndex(x => x.text === 'foreach'); if (f >= 0) sub(skipOpts(rest.slice(f + 1), []), 'bash'); }
  } else if (n0 === 'tar' || n0 === 'sort' || n0 === 'rsync') {
    // T4-NESTED-CMD: the command these options run is split and judged like rebase -x (tar -I/--use-compress-program/--to-command, sort --compress-program, rsync -e/--rsh/--rsync-path).
    const opts = n0 === 'tar' ? ['-I', '--use-compress-program', '--to-command'] : n0 === 'sort' ? ['--compress-program'] : ['-e', '--rsh', '--rsync-path'];
    args.forEach((x, k) => {
      if (opts.includes(x.text)) { if (args[k + 1]) sub([args[k + 1]], 'bash'); return; }
      const long = opts.find(o => o.startsWith('--') && x.text.startsWith(o + '='));
      if (long) sub([cut(x, long.length + 1)], 'bash');
      else if (n0 === 'tar' && /^-I./.test(x.text)) sub([cut(x, 2)], 'bash');
    });
  } else if (n0 === 'cmd') {
    for (let i = 0; i < args.length; i++) {
      const t = args[i].text;
      if (/^\/[ck]/i.test(t)) { sub(t.length > 2 ? [cut(args[i], 2), ...args.slice(i + 1)] : args.slice(i + 1), 'cmd', true); break; }
      if (!t.startsWith('/')) break;
    }
  } else if (n0 === 'pwsh' || n0 === 'powershell') {
    // -Command and -EncodedCommand come after any other option; a positional is read as a command (Windows PowerShell does).
    let cwd = seg.cwd;
    for (let i = 0; i < args.length; i++) {
      // `-Name value` or `-Name:value`: the value glued after the colon is read as the next word would be.
      const w = args[i], t = w.text, g = /^[-/][A-Za-z][\w-]*:/.exec(t), at = g ? g[0].length : t.length;
      const p = t.slice(1, g ? at - 1 : undefined).toLowerCase(), glued = g && t.length > at ? cut(w, at) : null, v = glued ?? args[i + 1];
      if (!/^-|^\/[A-Za-z]+(:.*)?$/.test(t) || w.mask.slice(0, at).includes('d') || (w.dyn && !glued)) {
        sub(args.slice(i), 'powershell', false, cwd); break;
      }
      if (p === 'e' || p === 'ec' || (p.length > 1 && 'encodedcommand'.startsWith(p))) {
        const code = v ? decode(v) : null;
        if (v && code === null) (glued ? w : v).dyn = true;
        if (code) more.push(...parse(code, cwd, 'powershell', null, depth + 1));
        break;
      }
      if ('command'.startsWith(p)) { sub(glued ? [glued, ...args.slice(i + 1)] : args.slice(i + 1), 'powershell', false, cwd); break; }
      if ('file'.startsWith(p)) break;
      if ((p.length > 1 && 'workingdirectory'.startsWith(p)) || p === 'wd') {
        cwd = v && !isDyn(v) && cwd !== null ? shellPath(v.text, cwd, 'powershell') : null;
        if (!glued) i++;
      } else if (!glued && PWSH_VALUED.some(x => x.startsWith(p)) && v && !v.text.startsWith('-')) i++;
    }
  }
  seg.argv = ws.map(pub);
  return more;
}
