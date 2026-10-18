// .forge/local.yaml: what forge knows about this machine (surface permissions, validators already announced, drafts
// already proposed, workflow, autonomy, the trust in the config's commands), and .forge/learned.jsonl: the lines `surfaces learn` appended to a surface.
// Both live in the main checkout, so every worktree of the repository shares them (outside git: the directory itself).
// .forge/.gitignore keeps them out of git; committing one anyway is the committer's call. local.yaml is read leniently,
// written atomically, unknown keys kept.
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
/** I-03: the person's answer about the commands of .forge/config.yaml (src/forge/trust.ts): the last answer with its hash
 *  and its commands (to show what changed next time), and every set of commands allowed so far. */
export interface CommandsTrust { state: 'allowed' | 'denied'; hash: string; list: { name: string; cmd: string }[]; at: string; allowed: string[] }

/** A git object id (sha1 or sha256): what a stored blob or commit must be before it reaches git. */
export const OBJECT_ID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
export interface LocalState {
  surfaces: Record<string, SurfacePermission>; known: string[]; proposed: string[];
  workflow?: Workflow; autonomy?: Autonomy; commands?: CommandsTrust; commandsAsked?: string[];
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

export const localFile = (root: string) => path.join(mainCheckout(root), '.forge', 'local.yaml');

const names = (x: unknown): string[] =>
  Array.isArray(x) ? [...new Set(x.filter((s): s is string => typeof s === 'string' && NAME.test(s)))] : [];

const HASH = /^[0-9a-f]{64}$/;
/** I-03: a commands record as written; anything malformed counts as no answer (forge asks again). */
function commandsTrustOf(x: unknown): CommandsTrust | undefined {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  const o = x as Record<string, unknown>;
  if ((o.state !== 'allowed' && o.state !== 'denied') || typeof o.hash !== 'string' || !HASH.test(o.hash)) return undefined;
  const list = (Array.isArray(o.list) ? o.list : [])
    .filter((c): c is { name: string; cmd: string } => !!c && typeof c === 'object' && typeof (c as { name?: unknown }).name === 'string' && typeof (c as { cmd?: unknown }).cmd === 'string')
    .slice(0, 100).map(c => ({ name: c.name.slice(0, 200), cmd: c.cmd.slice(0, 4000) }));
  const allowed = [...new Set((Array.isArray(o.allowed) ? o.allowed : []).filter((h): h is string => typeof h === 'string' && HASH.test(h)))];
  if (o.state === 'allowed' && !allowed.includes(o.hash)) allowed.push(o.hash);
  return { state: o.state, hash: o.hash, list, at: typeof o.at === 'string' ? o.at : '', allowed: allowed.slice(-20) };
}

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
  const { workflow, autonomy, commands, commandsAsked, ...rest } = o;
  return {
    ...rest, surfaces, known: names(o.known), proposed: names(o.proposed),
    ...((WORKFLOWS as readonly unknown[]).includes(workflow) ? { workflow: workflow as Workflow } : {}),
    ...((AUTONOMIES as readonly unknown[]).includes(autonomy) ? { autonomy: autonomy as Autonomy } : {}),
    ...(commandsTrustOf(commands) ? { commands: commandsTrustOf(commands) } : {}),
    ...(Array.isArray(commandsAsked) && commandsAsked.some(h => typeof h === 'string' && HASH.test(h))
      ? { commandsAsked: commandsAsked.filter((h): h is string => typeof h === 'string' && HASH.test(h)).slice(-20) } : {}),
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

/** The recorded digests per surface; a missing file or a bad line counts as nothing recorded. */
export function readLearned(root: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  let text = '';
  try { text = readFileSync(learnedFile(root), 'utf8'); } catch { return out; }
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
