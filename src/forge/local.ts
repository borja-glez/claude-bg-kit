// What forge knows about this machine and this person, all under the git common dir (<common>/forge/, shared by every
// worktree of the repository), where no commit can write (git refuses tracked paths under .git):
// - local.yaml: validators already announced, drafts already proposed, workflow, autonomy; read leniently, written
//   atomically, unknown keys kept;
// - surfaces.json: the surface permissions;
// - learned.jsonl: the lines `surfaces learn` appended to a surface.
// A .forge/local.yaml in the working tree (where forge ≤ 0.12 kept all this) is never read nor written: a commit can
// ship one under any name. Outside a git repository there is no personal state: nothing is kept, allowed or excused.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { AUTONOMIES, NAME, WORKFLOWS, type Autonomy, type Workflow } from './config.js';
import { endsMidLine } from './ledger.js';
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

// null when git fails (not a repository, git missing, an error).
function git(cwd: string, args: string[]): string | null {
  try { return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }); } catch { return null; }
}

/** The main checkout when `root` is a linked git worktree (its common dir is `<main>/.git`), else `root` itself,
 *  also when git is unavailable. */
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

// <common>/forge/<name>, or null outside git.
const stateFile = (root: string, name: string): string | null => {
  const common = gitCommonDir(root);
  return common ? path.join(common, 'forge', name) : null;
};

function writeAtomic(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

/** <common>/forge/local.yaml, or null outside git. */
export const localFile = (root: string) => stateFile(root, 'local.yaml');

const names = (x: unknown): string[] =>
  Array.isArray(x) ? [...new Set(x.filter((s): s is string => typeof s === 'string' && NAME.test(s)))] : [];

function readAt(file: string | null): LocalState {
  let raw: unknown = null;
  if (file) { try { raw = parse(readFileSync(file, 'utf8')); } catch { raw = null; } }
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  // workflow and autonomy (spec §5.4): a value that is not one of theirs is ignored, so config.yaml or `ask` decides.
  const { workflow, autonomy, ...rest } = o;
  return {
    ...rest, known: names(o.known), proposed: names(o.proposed),
    ...((WORKFLOWS as readonly unknown[]).includes(workflow) ? { workflow: workflow as Workflow } : {}),
    ...((AUTONOMIES as readonly unknown[]).includes(autonomy) ? { autonomy: autonomy as Autonomy } : {}),
  };
}

/** local.yaml; empty when missing, unreadable, or outside git. */
export const readLocal = (root: string): LocalState => readAt(localFile(root));

/** Writes local.yaml; false outside git, where nothing is kept. */
export function writeLocal(root: string, s: LocalState): boolean {
  const file = localFile(root);
  if (!file) return false;
  writeAtomic(file, stringify(s));
  return true;
}

/** fn applied to local.yaml and written back (outside git: computed, not kept). */
export function updateLocal(root: string, fn: (s: LocalState) => LocalState): LocalState {
  const file = localFile(root);
  const next = fn(readAt(file));
  if (file) writeAtomic(file, stringify(next));
  return next;
}

/** <common>/forge/surfaces.json: the surface permissions, or null outside git. */
export const permissionsFile = (root: string) => stateFile(root, 'surfaces.json');

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

const readPermissionsAt = (file: string): Record<string, SurfacePermission> => {
  try { return parsePermissions(JSON.parse(readFileSync(file, 'utf8'))); } catch { return {}; }
};

/** The surface permissions of this repository; none outside git. */
export function readPermissions(root: string): Record<string, SurfacePermission> {
  const file = permissionsFile(root);
  return file && existsSync(file) ? readPermissionsAt(file) : {};
}

/** Sets (null: removes) one surface's permission; false outside git, where none can be kept. */
export function setPermission(root: string, name: string, perm: SurfacePermission | null): boolean {
  const file = permissionsFile(root);
  if (!file) return false;
  const next = { ...readPermissionsAt(file) };
  if (perm) next[name] = perm;
  else delete next[name];
  writeAtomic(file, `${JSON.stringify(next, null, 2)}\n`);
  return true;
}

/** <common>/forge/learned.jsonl: one `{surface, digest, ts}` per line `surfaces learn` appended to a surface (see
 *  permissionHash), only ever appended to; null outside git. */
export const learnedFile = (root: string) => stateFile(root, 'learned.jsonl');

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
