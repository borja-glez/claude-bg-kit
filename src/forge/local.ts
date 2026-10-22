// .forge/local.yaml: what forge knows about this machine (surface permissions, validators already announced, drafts
// already proposed, workflow, autonomy), and .forge/learned.jsonl: the lines `surfaces learn` appended to a surface.
// Both live in the main checkout, so every worktree of the repository shares them (outside git: the directory itself).
// .forge/.gitignore keeps them out of git; one committed anyway grants no surface (localTracked). local.yaml is read
// leniently, written atomically, unknown keys kept.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
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
  surfaces: Record<string, SurfacePermission>; known: string[]; proposed: string[];
  workflow?: Workflow; autonomy?: Autonomy;
  [key: string]: unknown;
}

/** The main checkout when `root` is a linked git worktree (its common dir is `<main>/.git`), else the top level of
 *  `root`'s checkout (`root` itself at the top, and also when git is unavailable). K2-01: from a subdirectory it is
 *  still the top level, so nothing of forge's lands in that subdirectory. One local.yaml serves every worktree. */
export function mainCheckout(root: string): string {
  try {
    const [gitDir, common, top, cdup] = execFileSync('git', ['rev-parse', '--git-dir', '--git-common-dir', '--show-toplevel', '--show-cdup'], { cwd: root, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
      .split(/\r?\n/).map(l => l.trim());
    if (!gitDir || !common) return root;
    const commonDir = path.resolve(root, common);
    // At the top (no way up) it is `root` as given: git prints the top level resolved (forward slashes, symlinks followed).
    if (path.resolve(root, gitDir) === commonDir || path.basename(commonDir) !== '.git') return cdup && top ? path.resolve(top) : root;
    return path.dirname(commonDir);
  } catch { return root; }
}

/** The directory a hook works from: the session's project (CLAUDE_PROJECT_DIR), else the hook input's cwd, else the
 *  process's own. One rule for every hook that reads its input's cwd. */
export function hookRoot(io: { cwd: string; env?: Record<string, string | undefined> }, input: { cwd?: unknown }): string {
  const projectDir = io.env?.CLAUDE_PROJECT_DIR?.trim();
  return projectDir || (typeof input.cwd === 'string' && input.cwd ? input.cwd : io.cwd);
}

export const localFile = (root: string) => path.join(mainCheckout(root), '.forge', 'local.yaml');

/** The environment of a git call whose error is read: git speaks English, so «not a git repository» can be told apart. */
export const gitEnv = (): NodeJS.ProcessEnv => ({ ...process.env, LC_ALL: 'C', LANGUAGE: 'C' });

/** Why a git call that threw gave no answer: `no-repo` when git says the directory is in no repository, `git-failed`
 *  when it refused to run there, timed out, is missing or failed otherwise. */
export const gitFailure = (e: unknown): 'no-repo' | 'git-failed' =>
  (/not a git repository/i.test(String((e as { stderr?: unknown } | null)?.stderr ?? '')) ? 'no-repo' : 'git-failed');

/** The files git lists under `.forge` in `cwd` (NUL-separated), or why it could not list them. Tests pass their own. */
export type ForgeListing = (cwd: string) => { out: string } | { fail: 'no-repo' | 'git-failed' };
const lsForge: ForgeListing = cwd => {
  try {
    return { out: execFileSync('git', ['ls-files', '-z', '--', ':(top,icase).forge'], {
      cwd, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: gitEnv(),
    }) };
  } catch (e) { return { fail: gitFailure(e) }; }
};

/**
 * Whether git tracks forge's file `.forge/<name>` in the main checkout of `root` (in any letter case), or `.forge` itself
 * as a link or a submodule: then a repository ships it, and what it says is the repository's, not the person's.
 * `unknown` when git could not say (it refused to run there, timed out or failed), which counts as tracked; `untracked`
 * outside a repository, where a copy without git (a ZIP) is the directory's own: the known limit. The same rule keeps
 * the trust in the commands outside every checkout (trust.ts).
 */
export function trackedState(root: string, name: 'local.yaml' | 'learned.jsonl', ls: ForgeListing = lsForge): 'tracked' | 'untracked' | 'unknown' {
  const r = ls(mainCheckout(root));
  if ('fail' in r) return r.fail === 'no-repo' ? 'untracked' : 'unknown';
  return r.out.split('\0').some(f => { const l = f.toLowerCase(); return l === '.forge' || l === `.forge/${name}`; }) ? 'tracked' : 'untracked';
}

/** Whether `.forge/<name>` may be the repository's: tracked, or git could not say (fail closed). */
export const localTracked = (root: string, name: 'local.yaml' | 'learned.jsonl', ls?: ForgeListing): boolean => trackedState(root, name, ls) !== 'untracked';

/** The surface permissions that grant: those of local.yaml, none while git tracks it or cannot say (a repository could
 *  ship an «allowed» one). `s`: local.yaml as already read. */
export function surfacePermissions(root: string, s: Pick<LocalState, 'surfaces'> = readLocal(root), ls?: ForgeListing): LocalState['surfaces'] {
  return Object.keys(s.surfaces).length && localTracked(root, 'local.yaml', ls) ? {} : s.surfaces;
}

const names = (x: unknown): string[] =>
  Array.isArray(x) ? [...new Set(x.filter((s): s is string => typeof s === 'string' && NAME.test(s)))] : [];

export function readLocal(root: string): LocalState {
  let raw: unknown = null;
  try { raw = parse(readFileSync(localFile(root), 'utf8')); } catch { raw = null; }
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const surfaces: LocalState['surfaces'] = {};
  if (o.surfaces && typeof o.surfaces === 'object' && !Array.isArray(o.surfaces)) {
    for (const [k, v] of Object.entries(o.surfaces)) {
      if (!NAME.test(k) || !v || typeof v !== 'object' || Array.isArray(v)) continue;
      const p = v as Record<string, unknown>;
      if (p.state === 'allowed' || p.state === 'denied') {
        surfaces[k] = {
          state: p.state, hash: typeof p.hash === 'string' ? p.hash : null,
          ...(typeof p.blob === 'string' && OBJECT_ID.test(p.blob) ? { blob: p.blob } : {}),
          ...(typeof p.commit === 'string' && OBJECT_ID.test(p.commit) ? { commit: p.commit } : {}),
        };
      }
    }
  }
  // workflow and autonomy: a value that is not one of theirs is ignored, so config.yaml or `ask` decides.
  const { workflow, autonomy, ...rest } = o;
  return {
    ...rest, surfaces, known: names(o.known), proposed: names(o.proposed),
    ...((WORKFLOWS as readonly unknown[]).includes(workflow) ? { workflow: workflow as Workflow } : {}),
    ...((AUTONOMIES as readonly unknown[]).includes(autonomy) ? { autonomy: autonomy as Autonomy } : {}),
  };
}

export function writeLocal(root: string, s: LocalState): void {
  forgeDir(mainCheckout(root));
  const file = localFile(root);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, stringify(s));
  renameSync(tmp, file);
}

export function updateLocal(root: string, fn: (s: LocalState) => LocalState): LocalState {
  const next = fn(readLocal(root));
  writeLocal(root, next);
  return next;
}

/** .forge/learned.jsonl in the main checkout: one `{surface, digest, ts}` per line `surfaces learn` appended to a surface
 *  (see permissionHash), only ever appended to. */
export const learnedFile = (root: string) => path.join(mainCheckout(root), '.forge', 'learned.jsonl');

/** Records the lines appended to a surface, one appendFileSync per line (never read-modify-write), so parallel tasks
 *  never lose each other's records. */
export function recordLearned(root: string, surface: string, lines: string[], ts: string): void {
  if (!lines.length) return;
  const main = mainCheckout(root);
  forgeDir(main);
  const file = path.join(main, '.forge', 'learned.jsonl');
  // A line left half-written by a crash must not swallow the next record.
  let lead = endsMidLine(file) ? '\n' : '';
  for (const l of lines) {
    appendFileSync(file, `${lead}${JSON.stringify({ surface, digest: lineDigest(l), ts })}\n`);
    lead = '';
  }
}

/** The recorded digests per surface; a missing file or a bad line counts as nothing recorded, and so does a file git
 *  tracks or cannot say about (a repository could ship digests that take its own lines out of a surface the person
 *  allowed). */
export function readLearned(root: string, ls?: ForgeListing): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  let text = '';
  try { text = readFileSync(learnedFile(root), 'utf8'); } catch { return out; }
  if (text.trim() && localTracked(root, 'learned.jsonl', ls)) return out;
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
