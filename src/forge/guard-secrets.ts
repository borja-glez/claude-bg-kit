// w7 A4, guard B: a forge agent never reads or writes the credentials of the machine (~/.ssh, ~/.aws, ~/.config/gh,
// ~/.netrc, ~/.git-credentials, ~/.kube), and a .env is closed to it too (decision 2): only forge-verify and
// forge-verify-heavy read the repository's own .env, to start the app, and none of them writes it.
// The rule acts only when the call carries an agent_type that starts with forge: the person's session and every other
// agent pass, and for them it reads nothing of the context. It judges Read, Edit, Write, NotebookEdit, Grep and Glob by
// the paths they name; Bash and PowerShell by the words of each command the guard's splitter finds.
// Its limit: it recognises patterns, it is no sandbox. A search rooted in a repository folder that holds a .env, without
// naming it, is not judged, and neither is a path spelled through what only the disk knows (a link, a junction, an 8.3 name).
// Pure: it reads no file and starts no process.
import os from 'node:os';
import path from 'node:path';
import { bashSegments, segmentPath } from './autonomy-shared.js';
import { writeInfo } from './autonomy-parse.js';
import { commandName, type Segment, type Word } from './shell-words.js';
import { confinedIn, FILE_TOOLS, guardPath, isInside, SHELL_TOOLS, targetPaths, type GuardCtx, type GuardInput, type GuardRule, type GuardVerdict } from './guard.js';

export const SECRETS_RULE_ID = 'secrets';
/** Relative to the home folder; compared with isInside. */
export const SECRET_PATHS: readonly string[] = ['.ssh', '.aws', '.config/gh', '.netrc', '.git-credentials', '.kube'];
export const DOTENV_TEMPLATES: readonly string[] = ['.env.example', '.env.sample', '.env.template', '.env.dist'];
export const VERIFY_AGENTS: readonly string[] = ['forge-verify', 'forge-verify-heavy'];
export const READ_TOOLS: readonly string[] = ['Read', 'Grep', 'Glob'];

/** A forge agent: agent_type is a string that starts with 'forge' (forge:forge-impl, or forge-impl loaded without its prefix). */
export function isForgeAgent(agentType: unknown): agentType is string {
  return typeof agentType === 'string' && agentType.startsWith('forge');
}

/** A VERIFY_AGENTS name, bare or after 'forge:'. */
export function isVerifyAgent(agentType: unknown): boolean {
  if (typeof agentType !== 'string') return false;
  return VERIFY_AGENTS.includes(agentType.startsWith('forge:') ? agentType.slice('forge:'.length) : agentType);
}

/** '.env' or '.env.<x>' that is not one of the committed templates, folded to lower case on every platform. */
export function isDotenvName(name: string): boolean {
  const n = name.toLowerCase();
  return (n === '.env' || n.startsWith('.env.')) && !DOTENV_TEMPLATES.includes(n);
}

const WILDCARD = /[*?[{]/;

/**
 * Whether the last segment of a path or glob pattern targets a .env: a dotenv name, or a literal part before the first
 * wildcard that is `.env` or starts with `.env.` (`.env*`, `.env.*`, `.env.local`).
 */
export function targetsDotenv(lastSegment: string): boolean {
  if (lastSegment === '') return false;
  const at = lastSegment.search(WILDCARD);
  if (at === -1) return isDotenvName(path.basename(guardPath(lastSegment)));
  const literal = lastSegment.slice(0, at).toLowerCase();
  return literal === '.env' || literal.startsWith('.env.');
}

/**
 * Claude Code's expandPath, which the hook must redo for a Grep/Glob `path`: Claude Code rewrites only file_path and
 * notebook_path before the hook (backfillObservableInput), so a Grep/Glob `path` reaches the hook raw. Trim the text;
 * `~` and `~/<x>` (also `~\<x>` on win32) become the home folder, and on win32 a Git Bash `/x/...` becomes `X:/...`.
 * The text is returned unchanged when none of these applies, so a win32 `\\?\`/stream spelling is left for guardPath.
 * `platform` is for tests.
 */
export function expandHome(p: string, home: string, platform: NodeJS.Platform = process.platform): string {
  const t = p.trim();
  if (t === '~') return home;
  if (t.startsWith('~/') || t.startsWith('~\\')) return path.join(home, t.slice(2));
  if (platform === 'win32') {
    const m = /^\/([A-Za-z])\//.exec(t);
    if (m) return `${m[1].toUpperCase()}:/${t.slice(3)}`;
  }
  return p;
}

/** '~/<entry>' (forward slashes on every platform) of the SECRET_PATHS entry p is in, else null. */
export function secretOf(p: string, home: string): string | null {
  for (const entry of SECRET_PATHS) if (isInside(p, path.join(home, ...entry.split('/')))) return '~/' + entry;
  return null;
}

/** Whether a search rooted at p is an ancestor of (or is) a SECRET_PATHS entry: home, above it, or ~/.config (holds ~/.config/gh). */
function reachesSecrets(p: string, home: string): boolean {
  return SECRET_PATHS.some(entry => isInside(path.join(home, ...entry.split('/')), p));
}

const CREDS = (what: string) => `forge guard · secrets: ${what} holds this machine's credentials, which a forge agent never reads or writes. `
  + "Instead: work with the repository's files; if the task needs a credential, say so in your report";
const SEARCH = (base: string) => `forge guard · secrets: a search of ${base} reaches this machine's credentials folders. Instead: search inside the repository`;
const DOTENV = (p: string) => `forge guard · secrets: ${p} holds secrets; only forge-verify reads the repository's .env, to start the app. `
  + 'Instead: read .env.example, or name the variable you need in your report';
const VERIFY_WRITES = (p: string) => `forge guard · secrets: ${p} is the repository's .env; forge-verify reads it and never writes it. Instead: report the value the app needs`;
const OUTSIDE = (p: string, main: string) => `forge guard · secrets: ${p} is a .env outside this repository (${main}). Instead: read the repository's own .env`;
const HIDDEN = "forge guard · secrets: a .env whose folder the hook cannot see. Instead: name the repository's .env by its path, without variables";

const deny = (reason: string): GuardVerdict => ({ decision: 'deny', rule: SECRETS_RULE_ID, reason });

/**
 * The verdict for a .env at p (the file, or the folder a search starts in; null when the hook cannot see the folder):
 * a non-verify forge agent never; verify reads the repository's own and writes none.
 */
export function dotenvVerdict(p: string | null, input: GuardInput, ctx: GuardCtx, write: boolean): GuardVerdict | null {
  if (!isVerifyAgent(input.agent_type)) return deny(DOTENV(p ?? 'a .env'));
  if (write) return deny(VERIFY_WRITES(p ?? 'a .env'));
  if (p === null) return deny(HIDDEN);
  return confinedIn(p, ctx.main) ? null : deny(OUTSIDE(p, ctx.main));
}

interface Item { p: string; search: boolean; dotenv: boolean }

const asString = (x: unknown): string | null => (typeof x === 'string' && x !== '' ? x : null);

// What a Grep or Glob call reaches: its root folder (the path of the call, or the cwd; in Glob joined to the literal
// folder part of the pattern before the first wildcard) and the file pattern (Glob's pattern, Grep's glob; never Grep's
// pattern, which is the text it looks for).
function searchItems(input: GuardInput, ctx: GuardCtx, home: string): Item[] {
  const base = (input.cwd ?? ctx.main).replace(/\\/g, '/');
  const given = expandHome(asString(input.tool_input.path) ?? '.', home).replace(/\\/g, '/');
  const isGlob = input.tool_name === 'Glob';
  const pattern = asString(isGlob ? input.tool_input.pattern : input.tool_input.glob)?.replace(/\\/g, '/') ?? null;
  let folder = '';
  if (isGlob && pattern !== null) {
    const wild = pattern.search(WILDCARD);
    folder = wild === -1 ? pattern : pattern.slice(0, pattern.slice(0, wild).lastIndexOf('/') + 1);
  }
  const root = path.resolve(base, given, expandHome(folder, home).replace(/\\/g, '/'));
  const last = pattern === null ? '' : pattern.slice(pattern.lastIndexOf('/') + 1);
  return [{ p: root, search: true, dotenv: targetsDotenv(path.basename(root)) || targetsDotenv(last) }];
}

// ---- Bash and PowerShell ---------------------------------------------------------------------------------------------

const HOME_SPELLING = /^(?:~|\$\{?HOME\}?|\$\{?env:(?:HOME|USERPROFILE)\}?|%(?:USERPROFILE|HOME)%|%HOMEDRIVE%%HOMEPATH%)(?=$|[\\/])/i;
/** Commands whose arguments are text, not paths (their redirections still are). */
const NO_PATH_ARGS: readonly string[] = ['echo', 'printf', 'write-output', 'write-host', 'write'];
/** Commands whose pattern word is text, not a path. */
const PATTERN_COMMANDS: readonly string[] = ['grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'findstr', 'select-string', 'sls'];
const URL = /^[a-z][a-z0-9+.-]+:\/\//i;
/** PowerShell options whose next word is their value, never the pattern. */
const PS_VALUE_OPTION = /^-(?:path|literalpath|include|exclude|encoding|context|culture)$/i;
/** PowerShell's glued form -Name:value; group 1 is the value. */
const PS_GLUED = /^-[a-z][a-z0-9-]*:(.+)$/i;
/** Per-command options whose value is the next word; the value is judged as a path, never taken as the pattern. */
const VALUE_OPTIONS: Record<string, readonly string[]> = {
  grep: ['-m', '-A', '-B', '-C', '-d', '-D', '--max-count', '--context', '--include', '--exclude', '--exclude-dir', '--label'],
  rg: ['-g', '--glob', '--iglob', '-t', '--type', '-T', '--type-not', '-m', '-A', '-B', '-C', '-M', '-j', '-E', '--encoding', '-d', '--max-depth', '-r', '--replace', '--sort'],
};
VALUE_OPTIONS.egrep = VALUE_OPTIONS.grep;
VALUE_OPTIONS.fgrep = VALUE_OPTIONS.grep;
VALUE_OPTIONS.ag = VALUE_OPTIONS.grep;
VALUE_OPTIONS.ack = VALUE_OPTIONS.grep;
/** Commands whose -f/--file reads the patterns from a file: no operand is the pattern, and the file stays judged as a path. */
const FILE_PATTERN_COMMANDS: readonly string[] = ['grep', 'egrep', 'fgrep', 'rg'];

/** text with its leading spelling of the home folder (~, $HOME, $env:USERPROFILE, %USERPROFILE%…) replaced by home; else text as it is. */
export function homeSpelled(text: string, home: string): string {
  const m = HOME_SPELLING.exec(text);
  return m ? home + text.slice(m[0].length) : text;
}

/**
 * The words of a grep-like segment that are the text it looks for (judged as text, not a path): the word after
 * -e/--regexp/-pattern or attached to them, findstr's /c: glued search string, or else the first operand. A value-taking
 * option (grep/rg/ag/ack's own list, or a PowerShell option) consumes its next word, and that word stays judged as a
 * path; -f/--file and findstr /g: read the patterns from a file, so no operand is the pattern and the file stays a path.
 */
function patternWords(seg: Segment, name: string): Set<Word> {
  const out = new Set<Word>();
  if (!PATTERN_COMMANDS.includes(name)) return out;
  const args = seg.argv.slice(1);
  const valueOpts = VALUE_OPTIONS[name] ?? [];
  let explicit = false;
  let firstOperand: Word | null = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const t = a.text;
    if (t === '-e' || t === '--regexp' || /^-pattern$/i.test(t)) { explicit = true; if (args[i + 1]) out.add(args[++i]); continue; }
    if (/^--regexp=/.test(t) || /^-e[^-]/.test(t) || /^-pattern:/i.test(t)) { explicit = true; out.add(a); continue; }
    if (name === 'findstr' && /^\/[cg]:/i.test(t)) { explicit = true; continue; }
    if (FILE_PATTERN_COMMANDS.includes(name) && (t === '-f' || t === '--file')) { explicit = true; if (args[i + 1]) i++; continue; }
    if (FILE_PATTERN_COMMANDS.includes(name) && /^--file=/.test(t)) { explicit = true; continue; }
    if (valueOpts.includes(t) || PS_VALUE_OPTION.test(t)) { if (args[i + 1]) i++; continue; }
    if (t.startsWith('-') || (name === 'findstr' && t.startsWith('/'))) continue;
    if (firstOperand === null) firstOperand = a;
  }
  if (!explicit && firstOperand !== null) out.add(firstOperand);
  return out;
}

const lastSegment = (t: string): string => t.slice(Math.max(t.lastIndexOf('/'), t.lastIndexOf('\\')) + 1);

function segmentVerdict(seg: Segment, input: GuardInput, ctx: GuardCtx, home: string): GuardVerdict | null {
  if (!seg.argv.length) return null;
  const name = commandName(seg.argv[0]);
  const skip = patternWords(seg, name);
  const words: Word[] = [
    ...(NO_PATH_ARGS.includes(name) ? seg.argv.slice(0, 1) : seg.argv).filter(w => !skip.has(w)),
    ...seg.redirects.map(r => r.target),
    ...Object.values(seg.env),
  ];
  const writes = new Set<string>();
  const addWrite = (t: string): void => { writes.add(t); const eq = t.indexOf('='); if (eq >= 0) writes.add(t.slice(eq + 1)); };
  for (const w of writeInfo(seg).targets) addWrite(w.text);
  for (const r of seg.redirects) if (r.op !== '<') addWrite(r.target.text);
  const searching = PATTERN_COMMANDS.includes(name) || name === 'find';
  for (const w of words) {
    if (URL.test(w.text)) continue;
    const eq = w.text.indexOf('=');
    const glued = PS_GLUED.exec(w.text)?.[1];
    const texts = eq >= 0 ? [w.text, w.text.slice(eq + 1)] : [w.text];
    if (glued !== undefined) texts.push(glued);
    for (const text of texts) {
      if (text === '' || URL.test(text)) continue;
      const t = homeSpelled(text, home);
      const dynamic = w.dynamic && (t === text || /[$`%]/.test(t));
      const p = segmentPath({ text: t, dynamic, glob: w.glob }, seg);
      const wild = /[*?[]/.test(t);
      if (p !== null) {
        const secret = secretOf(p, home);
        if (secret !== null) return deny(CREDS(secret));
        if (searching && reachesSecrets(p, home)) return deny(SEARCH(p));
        if (wild ? targetsDotenv(lastSegment(t)) : isDotenvName(path.basename(guardPath(p)))) {
          const v = dotenvVerdict(p, input, ctx, writes.has(text));
          if (v !== null) return v;
        }
      } else {
        const last = lastSegment(t);
        if (wild ? targetsDotenv(last) : isDotenvName(last)) {
          const v = dotenvVerdict(null, input, ctx, writes.has(text));
          if (v !== null) return v;
        }
      }
    }
  }
  return null;
}

export const secretsRule: GuardRule = {
  id: SECRETS_RULE_ID,
  check(input, ctx) {
    if (!isForgeAgent(input.agent_type)) return null;
    const home = ctx.home ?? os.homedir();
    const write = FILE_TOOLS.includes(input.tool_name);
    let items: Item[];
    if (input.tool_name === 'Read' || write) {
      // Expand ~ and the Git Bash /x/ spelling here too, so the rule does not rely on Claude Code rewriting file_path first.
      const tool_input = { ...input.tool_input };
      for (const f of ['file_path', 'notebook_path']) {
        const v = tool_input[f];
        if (typeof v === 'string' && v !== '') tool_input[f] = expandHome(v, home);
      }
      items = targetPaths({ ...input, tool_input }, ctx).map(p => ({ p, search: false, dotenv: isDotenvName(path.basename(guardPath(p))) }));
    } else if (input.tool_name === 'Grep' || input.tool_name === 'Glob') {
      items = searchItems(input, ctx, home);
    } else if (SHELL_TOOLS.includes(input.tool_name)) {
      for (const seg of bashSegments(input, ctx) ?? []) {
        const v = segmentVerdict(seg, input, ctx, home);
        if (v !== null) return v;
      }
      return null;
    } else return null;
    for (const { p, search, dotenv } of items) {
      const secret = secretOf(p, home);
      if (secret !== null) return deny(CREDS(secret));
      if (search && reachesSecrets(p, home)) return deny(SEARCH(p));
      if (dotenv) {
        const v = dotenvVerdict(p, input, ctx, write);
        if (v !== null) return v;
      }
    }
    return null;
  },
};
