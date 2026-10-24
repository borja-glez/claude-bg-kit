// w7 A4, guard B: a forge agent never reads or writes the credentials of the machine (~/.ssh, ~/.aws, ~/.config/gh,
// ~/.netrc, ~/.git-credentials, ~/.kube), and a .env is closed to it too (decision 2): only forge-verify and
// forge-verify-heavy read the repository's own .env, to start the app, and none of them writes it.
// The rule acts only when the call carries an agent_type that starts with forge: the person's session and every other
// agent pass, and for them it reads nothing of the context. It judges Read, Edit, Write, NotebookEdit, Grep and Glob by
// the paths they name; Bash and PowerShell come with Task 2.
// Its limit: it recognises patterns, it is no sandbox. A search rooted in a repository folder that holds a .env, without
// naming it, is not judged, and neither is a path spelled through what only the disk knows (a link, a junction, an 8.3 name).
// Pure: it reads no file and starts no process.
import os from 'node:os';
import path from 'node:path';
import { confinedIn, guardPath, isInside, targetPaths, type GuardCtx, type GuardInput, type GuardRule, type GuardVerdict } from './guard.js';

export const SECRETS_RULE_ID = 'secrets';
/** Relative to the home folder; compared with isInside. */
export const SECRET_PATHS: readonly string[] = ['.ssh', '.aws', '.config/gh', '.netrc', '.git-credentials', '.kube'];
export const DOTENV_TEMPLATES: readonly string[] = ['.env.example', '.env.sample', '.env.template', '.env.dist'];
export const VERIFY_AGENTS: readonly string[] = ['forge-verify', 'forge-verify-heavy'];
export const READ_TOOLS: readonly string[] = ['Read', 'Grep', 'Glob'];

const WRITE_TOOLS: readonly string[] = ['Edit', 'Write', 'NotebookEdit'];

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
function searchItems(input: GuardInput, ctx: GuardCtx): Item[] {
  const base = (input.cwd ?? ctx.main).replace(/\\/g, '/');
  const given = asString(input.tool_input.path)?.replace(/\\/g, '/') ?? '.';
  const isGlob = input.tool_name === 'Glob';
  const pattern = asString(isGlob ? input.tool_input.pattern : input.tool_input.glob)?.replace(/\\/g, '/') ?? null;
  let folder = '';
  if (isGlob && pattern !== null) {
    const wild = pattern.search(WILDCARD);
    folder = wild === -1 ? pattern : pattern.slice(0, pattern.slice(0, wild).lastIndexOf('/') + 1);
  }
  const root = path.resolve(base, given, folder);
  const last = pattern === null ? '' : pattern.slice(pattern.lastIndexOf('/') + 1);
  return [{ p: root, search: true, dotenv: targetsDotenv(path.basename(root)) ||targetsDotenv(last) }];
}

export const secretsRule: GuardRule = {
  id: SECRETS_RULE_ID,
  check(input, ctx) {
    if (!isForgeAgent(input.agent_type)) return null;
    const write = WRITE_TOOLS.includes(input.tool_name);
    let items: Item[];
    if (input.tool_name === 'Read' || write) {
      items = targetPaths(input, ctx).map(p => ({ p, search: false, dotenv: isDotenvName(path.basename(guardPath(p))) }));
    } else if (input.tool_name === 'Grep' || input.tool_name === 'Glob') {
      items = searchItems(input, ctx);
    } else return null;
    const home = ctx.home ?? os.homedir();
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
