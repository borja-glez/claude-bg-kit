// .forge/local.yaml: what forge knows about this machine (surface permissions, validators already announced,
// drafts already proposed). Ignored by git; read leniently, written atomically, unknown keys kept.
import { execFileSync } from 'node:child_process';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { AUTONOMIES, NAME, WORKFLOWS, type Autonomy, type Workflow } from './config.js';
import { forgeDir } from './ledger.js';

// A permission is tied to the surface's content (its hash, see surfaces.ts): a changed surface asks again.
export interface SurfacePermission { state: 'allowed' | 'denied'; hash: string | null }
export interface LocalState {
  surfaces: Record<string, SurfacePermission>; known: string[]; proposed: string[];
  workflow?: Workflow; autonomy?: Autonomy;
  [key: string]: unknown;
}

/** The main checkout when `root` is a linked git worktree (its common dir is `<main>/.git`), else `root` itself,
 *  also when git is unavailable. One local.yaml serves every worktree of the repository. */
export function mainCheckout(root: string): string {
  try {
    const [gitDir, common] = execFileSync('git', ['rev-parse', '--git-dir', '--git-common-dir'], { cwd: root, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
      .split(/\r?\n/).map(l => l.trim());
    if (!gitDir || !common) return root;
    const commonDir = path.resolve(root, common);
    if (path.resolve(root, gitDir) === commonDir || path.basename(commonDir) !== '.git') return root;
    return path.dirname(commonDir);
  } catch { return root; }
}

export const localFile = (root: string) => path.join(mainCheckout(root), '.forge', 'local.yaml');

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
      if (p.state === 'allowed' || p.state === 'denied') surfaces[k] = { state: p.state, hash: typeof p.hash === 'string' ? p.hash : null };
    }
  }
  // workflow and autonomy (spec §5.4): a value that is not one of theirs is ignored, so config.yaml or `ask` decides.
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
