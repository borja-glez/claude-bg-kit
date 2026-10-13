// What forge knows about this machine, in two places:
// - .forge/local.yaml in the main checkout: validators already announced, drafts already proposed, workflow, autonomy.
//   Ignored by git; read leniently, written atomically, unknown keys kept. A commit can still ship one (git add -f), so
//   it is ignored entirely when git tracks it (under any case), when it or .forge is a symbolic link, or when git cannot
//   say inside a work tree (fail closed).
// - forge's trust state under the git common dir (<common>/forge/, shared by every worktree), where no commit can
//   write (git refuses tracked paths under .git): the surface permissions (surfaces.json) and the lines `surfaces learn`
//   recorded (learned.jsonl). Outside a git repository there is none: nothing is allowed, nothing excused.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { AUTONOMIES, NAME, WORKFLOWS, type Autonomy, type Workflow } from './config.js';
import { endsMidLine, forgeDir } from './ledger.js';
import { lineDigest } from './surfaces.js';

// A permission is tied to the surface's content (its permissionHash, see surfaces.ts): a changed surface asks again.
// An allowance also keeps the git blob of the file as allowed and the commit then (when git was there), so a changed
// surface can be shown as a diff.
export interface SurfacePermission { state: 'allowed' | 'denied'; hash: string | null; blob?: string; commit?: string }

/** A git object id (sha1 or sha256): what a stored blob or commit must be before it reaches git. */
export const OBJECT_ID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
export interface LocalState {
  known: string[]; proposed: string[];
  workflow?: Workflow; autonomy?: Autonomy;
  [key: string]: unknown;
}
/** Why .forge/local.yaml was ignored. */
export type LocalWarning = 'tracked' | 'symlink' | 'git';

// null when git fails (not a repository, git missing, an error).
function git(cwd: string, args: string[]): string | null {
  try { return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }); } catch { return null; }
}

/** The main checkout when `root` is a linked git worktree (its common dir is `<main>/.git`), else `root` itself,
 *  also when git is unavailable. One local.yaml serves every worktree of the repository. */
export function mainCheckout(root: string): string {
  const out = git(root, ['rev-parse', '--git-dir', '--git-common-dir']);
  if (out === null) return root;
  const [gitDir, common] = out.split(/\r?\n/).map(l => l.trim());
  if (!gitDir || !common) return root;
  const commonDir = path.resolve(root, common);
  if (path.resolve(root, gitDir) === commonDir || path.basename(commonDir) !== '.git') return root;
  return path.dirname(commonDir);
}

/** The repository's git common dir (`.git` of the main checkout, shared by its worktrees), or null outside git. */
export function gitCommonDir(root: string): string | null {
  const out = git(root, ['rev-parse', '--git-common-dir'])?.trim();
  if (!out) return null;
  const dir = path.resolve(root, out);
  try { return statSync(dir).isDirectory() ? dir : null; } catch { return null; }
}

export const localFile = (root: string) => path.join(mainCheckout(root), '.forge', 'local.yaml');

const lexists = (f: string) => { try { lstatSync(f); return true; } catch { return false; } };
const isLink = (f: string) => { try { return lstatSync(f).isSymbolicLink(); } catch { return false; } };

// Whether `dir` is inside a git work tree as far as the disk says (a .git here or above), whatever git answers.
function underGit(dir: string): boolean {
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    if (lexists(path.join(d, '.git'))) return true;
    if (path.dirname(d) === d) return false;
  }
}

// Why the main checkout's .forge/local.yaml cannot be trusted, or null. Git's pathspec is matched ignoring case
// (`.forge/LOCAL.yaml` is the same file on Windows and macOS), and a tracked .forge itself (a symlink) counts too.
function distrust(main: string): LocalWarning | null {
  if (isLink(path.join(main, '.forge')) || isLink(path.join(main, '.forge', 'local.yaml'))) return 'symlink';
  if (!underGit(main)) return null;
  const out = git(main, ['ls-files', '-z', '--', ':(icase).forge']);
  if (out === null) return 'git';
  return out.split('\0').some(p => ['.forge', '.forge/local.yaml'].includes(p.toLowerCase())) ? 'tracked' : null;
}

/** The sentence an output that reads local.yaml adds when it was ignored. */
export function localWarningText(w: LocalWarning, es: boolean): string {
  if (w === 'tracked') {
    return es ? 'Se ignora .forge/local.yaml: git lo sigue, así que pudo escribirlo un commit. Sácalo de git (git rm --cached) para volver a usarlo.'
      : '.forge/local.yaml is ignored: git tracks it, so a commit could have written it. Untrack it (git rm --cached) to use it again.';
  }
  if (w === 'symlink') return es ? 'Se ignora .forge/local.yaml: el fichero o .forge es un enlace simbólico.' : '.forge/local.yaml is ignored: it or .forge is a symbolic link.';
  return es ? 'Se ignora .forge/local.yaml: git no pudo decir si lo sigue.' : '.forge/local.yaml is ignored: git could not tell whether it tracks it.';
}

// The parsed local.yaml of the main checkout (null when missing, unreadable or not a mapping), unless it is ignored.
function rawLocal(main: string): { raw: Record<string, unknown> | null; warning: LocalWarning | null } {
  const file = path.join(main, '.forge', 'local.yaml');
  if (!lexists(file)) return { raw: null, warning: null };
  const warning = distrust(main);
  if (warning) return { raw: null, warning };
  let raw: unknown = null;
  try { raw = parse(readFileSync(file, 'utf8')); } catch { raw = null; }
  return { raw: raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null, warning: null };
}

const names = (x: unknown): string[] =>
  Array.isArray(x) ? [...new Set(x.filter((s): s is string => typeof s === 'string' && NAME.test(s)))] : [];

// The surfaces key of an old local.yaml is not part of the state: it is only imported once (readPermissions).
function toState(o: Record<string, unknown>): LocalState {
  // workflow and autonomy (spec §5.4): a value that is not one of theirs is ignored, so config.yaml or `ask` decides.
  const { workflow, autonomy, surfaces: _legacy, ...rest } = o;
  return {
    ...rest, known: names(o.known), proposed: names(o.proposed),
    ...((WORKFLOWS as readonly unknown[]).includes(workflow) ? { workflow: workflow as Workflow } : {}),
    ...((AUTONOMIES as readonly unknown[]).includes(autonomy) ? { autonomy: autonomy as Autonomy } : {}),
  };
}

/** local.yaml and why it was ignored (an empty state then). */
export function readLocalChecked(root: string): { local: LocalState; warning: LocalWarning | null } {
  const { raw, warning } = rawLocal(mainCheckout(root));
  return { local: toState(raw ?? {}), warning };
}

export const readLocal = (root: string): LocalState => readLocalChecked(root).local;

function write(main: string, s: LocalState): void {
  // An old local.yaml's allowances move to the trust store before its surfaces key goes.
  readPermissions(main);
  forgeDir(main);
  const file = path.join(main, '.forge', 'local.yaml');
  const { surfaces: _legacy, ...rest } = s;
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, stringify(rest));
  renameSync(tmp, file);
}

/** Writes local.yaml; one that is ignored (rawLocal) is never written over. */
export function writeLocal(root: string, s: LocalState): void {
  const main = mainCheckout(root);
  if (lexists(path.join(main, '.forge', 'local.yaml')) && distrust(main)) return;
  write(main, s);
}

/** fn applied to local.yaml and written back, unless the file is ignored: then nothing is written. */
export function updateLocal(root: string, fn: (s: LocalState) => LocalState): LocalState {
  const main = mainCheckout(root);
  const { raw, warning } = rawLocal(main);
  const next = fn(toState(raw ?? {}));
  if (!warning) write(main, next);
  return next;
}

// ---- trust state, under the git common dir ----

const trustFile = (root: string, name: string): string | null => {
  const common = gitCommonDir(root);
  return common ? path.join(common, 'forge', name) : null;
};

/** <common>/forge/surfaces.json: the surface permissions, or null outside git. */
export const permissionsFile = (root: string) => trustFile(root, 'surfaces.json');

function parsePermissions(x: unknown): Record<string, SurfacePermission> {
  const out: Record<string, SurfacePermission> = {};
  if (!x || typeof x !== 'object' || Array.isArray(x)) return out;
  for (const [k, v] of Object.entries(x)) {
    if (!NAME.test(k) || !v || typeof v !== 'object' || Array.isArray(v)) continue;
    const p = v as Record<string, unknown>;
    if (p.state !== 'allowed' && p.state !== 'denied') continue;
    out[k] = {
      state: p.state, hash: typeof p.hash === 'string' ? p.hash : null,
      ...(typeof p.blob === 'string' && OBJECT_ID.test(p.blob) ? { blob: p.blob } : {}),
      ...(typeof p.commit === 'string' && OBJECT_ID.test(p.commit) ? { commit: p.commit } : {}),
    };
  }
  return out;
}

function writeJson(file: string, v: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(v, null, 2)}\n`);
  renameSync(tmp, file);
}

function readPermissionsAt(root: string, file: string): Record<string, SurfacePermission> {
  // Once: the allowances forge ≤ 0.12 kept in local.yaml, when that file is trusted, become the store.
  if (!existsSync(file)) {
    const legacy = parsePermissions(rawLocal(mainCheckout(root)).raw?.surfaces);
    if (Object.keys(legacy).length) writeJson(file, legacy);
  }
  try { return parsePermissions(JSON.parse(readFileSync(file, 'utf8'))); } catch { return {}; }
}

/** The surface permissions of this repository; none outside git. */
export function readPermissions(root: string): Record<string, SurfacePermission> {
  const file = permissionsFile(root);
  return file ? readPermissionsAt(root, file) : {};
}

/** Sets (null: removes) one surface's permission; false outside git, where none can be kept. */
export function setPermission(root: string, name: string, perm: SurfacePermission | null): boolean {
  const file = permissionsFile(root);
  if (!file) return false;
  const next = { ...readPermissionsAt(root, file) };
  if (perm) next[name] = perm;
  else delete next[name];
  writeJson(file, next);
  return true;
}

/** <common>/forge/learned.jsonl: one `{surface, digest, ts}` per line `surfaces learn` appended to a surface (see
 *  permissionHash), only ever appended to; null outside git. */
export const learnedFile = (root: string) => trustFile(root, 'learned.jsonl');

/** Records the lines appended to a surface, one appendFileSync per line (never read-modify-write), so parallel tasks
 *  never lose each other's records. Outside git nothing is recorded. */
export function recordLearned(root: string, surface: string, lines: string[], ts: string): void {
  const file = learnedFile(root);
  if (!lines.length || !file) return;
  mkdirSync(path.dirname(file), { recursive: true });
  // A line left half-written by a crash must not swallow the next record.
  let lead = endsMidLine(file) ? '\n' : '';
  for (const l of lines) {
    appendFileSync(file, `${lead}${JSON.stringify({ surface, digest: lineDigest(l), ts })}\n`);
    lead = '';
  }
}

/** The recorded digests per surface; outside git, a missing file or a bad line counts as nothing recorded. */
export function readLearned(root: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const file = learnedFile(root);
  let text = '';
  try { text = file ? readFileSync(file, 'utf8') : ''; } catch { return out; }
  for (const line of text.split('\n')) {
    let r: unknown;
    try { r = JSON.parse(line); } catch { continue; }
    if (!r || typeof r !== 'object') continue;
    const { surface, digest } = r as Record<string, unknown>;
    if (typeof surface !== 'string' || !NAME.test(surface) || typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) continue;
    const set = out.get(surface) ?? new Set<string>();
    set.add(digest);
    out.set(surface, set);
  }
  return out;
}
