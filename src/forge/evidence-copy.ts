// K2-04: a member's verification evidence reaches the main checkout. Files under one directory are copied to the same
// relative paths under another, never through a link nor outside either one, up to a size cap per call.
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { samePath } from '../lib/worktree.js';
import { ledgerRoot } from './ledger.js';

/** What one call copies at most. */
export const EVIDENCE_COPY_MAX = 50 * 1024 * 1024;
/** The files one walk lists at most: past it the walk stops, and says so (`truncated`). */
export const EVIDENCE_FILES_MAX = 5000;

/** `rel` as a path under a directory, with `/`: null when it is empty, absolute, names a drive or has a `..` part. */
function safeRel(rel: string): string | null {
  if (!rel || path.isAbsolute(rel) || path.win32.isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) return null;
  const parts = rel.split(/[\\/]+/).filter(p => p && p !== '.');
  return parts.length && !parts.includes('..') ? parts.join('/') : null;
}

/** True when no part of `rel` under `base` is a link or a junction (lstat says so of both); a part not there yet is none. */
function noLink(base: string, rel: string): boolean {
  let at = base;
  for (const part of rel.split('/')) {
    at = path.join(at, part);
    try { if (lstatSync(at).isSymbolicLink()) return false; } catch { return true; }
  }
  return true;
}

/**
 * The files under `rel` (a file or a folder relative to `from`), in path order and with `/`; none through a link or
 * outside `from`. The walk stops at `max` files: `truncated` says that some were left unwalked.
 */
function filesUnder(from: string, rel: string, max = EVIDENCE_FILES_MAX): { files: string[]; truncated: boolean } {
  const files: string[] = [];
  let truncated = false;
  const start = safeRel(rel);
  if (!start || !noLink(from, start)) return { files, truncated };
  const walk = (r: string) => {
    if (truncated) return;
    const abs = path.join(from, r);
    let st;
    try { st = lstatSync(abs); } catch { return; }
    if (st.isSymbolicLink()) return;
    if (st.isFile()) {
      if (files.length >= max) truncated = true;
      else files.push(r);
      return;
    }
    if (!st.isDirectory()) return;
    let names: string[] = [];
    try { names = readdirSync(abs).sort(); } catch { return; }
    for (const n of names) walk(`${r}/${n}`);
  };
  walk(start);
  return { files, truncated };
}

export interface Copied { copied: string[]; bytes: number; skipped: string[] }

/**
 * Copies files and folders (`rels`, relative to `from`) to the same relative paths under `to`, in path order, until
 * `max` bytes; what does not fit, or cannot be copied (a link or a junction on its way under `to` among them), is named
 * in `skipped`. With `missingOnly`, a file `to` already has is left as it is. Carry 5: a folder whose walk stopped at
 * `maxFiles` files is named in `skipped` too, as `<folder>/`: the files past that point were neither walked nor copied.
 */
export function copyTree(from: string, to: string, rels: readonly string[], opts: { max?: number; missingOnly?: boolean; maxFiles?: number } = {}): Copied {
  const max = opts.max ?? EVIDENCE_COPY_MAX;
  const out: Copied = { copied: [], bytes: 0, skipped: [] };
  const walks = rels.map(r => ({ rel: r, ...filesUnder(from, r, opts.maxFiles) }));
  for (const rel of [...new Set(walks.flatMap(w => w.files))]) {
    const dest = path.join(to, rel);
    if (opts.missingOnly && existsSync(dest)) continue;
    let size: number;
    try { size = lstatSync(path.join(from, rel)).size; } catch { continue; }
    if (out.bytes + size > max || !noLink(to, rel)) { out.skipped.push(rel); continue; }
    try {
      mkdirSync(path.dirname(dest), { recursive: true });
      copyFileSync(path.join(from, rel), dest);
      out.copied.push(rel);
      out.bytes += size;
    } catch { out.skipped.push(rel); }
  }
  for (const w of walks) if (w.truncated) out.skipped.push(`${safeRel(w.rel)}/`);
  return out;
}

/**
 * The verification files the main checkout keeps when it ran in one of forge's task worktrees (D-10: its ledger is the
 * main one): the review dir's verify.json and its evidence folder (`reviews-<n>-<k>` → `evidence/<n>-<k>`), at the same
 * relative paths. From anywhere else nothing is copied.
 */
export function keepEvidence(cwd: string, reviewDir: string, max = EVIDENCE_COPY_MAX): { skipped: string[] } {
  const main = ledgerRoot(cwd);
  if (samePath(main, cwd)) return { skipped: [] };
  const rel = safeRel(path.relative(cwd, path.resolve(cwd, reviewDir)));
  if (!rel) return { skipped: [] };
  const evidence = rel.replace(/reviews-(\d+-\d+)$/, 'evidence/$1');
  return { skipped: copyTree(cwd, main, [`${rel}/verify.json`, ...(evidence !== rel ? [evidence] : [])], { max }).skipped };
}

/** How deep under .forge/work a review or evidence folder sits: `<project>/<T>/reviews-*`, or `<T>/…` of an older forge. */
const WORK_DEPTH = 3;

/**
 * What swarm cleanup copies from a task worktree before removing it, as keepEvidence copied it there: each `reviews-*`
 * folder's verify.json and every file of an `evidence` folder under its .forge/work, in path order. Final review 3: only
 * folders are walked to find them, WORK_DEPTH levels down, so no other file counts against the cap. R1 (M1): the rounds
 * prep set aside in a task's `earlier-<runId>/` are walked as the task's own, so cleanup copies them to the main checkout
 * too. `truncated` when the walk stopped at `max` files (or EVIDENCE_FILES_MAX folders): what lies past it was not checked.
 */
export function evidenceOf(worktree: string, max = EVIDENCE_FILES_MAX): { files: string[]; truncated: boolean } {
  const files: string[] = [];
  let truncated = false;
  let folders = 0;
  const isFolder = (rel: string) => { try { const st = lstatSync(path.join(worktree, rel)); return st.isDirectory() && !st.isSymbolicLink(); } catch { return false; } };
  const folderNames = (rel: string): string[] => {
    try { return readdirSync(path.join(worktree, rel), { withFileTypes: true }).filter(d => !d.isFile()).map(d => d.name).sort(); } catch { return []; }
  };
  /** Takes a review or evidence folder's files; false for any other folder. */
  const take = (child: string, name: string): boolean => {
    if (name === 'evidence') {
      const under = filesUnder(worktree, child, max - files.length);
      files.push(...under.files);
      truncated = under.truncated;
      return true;
    }
    if (!name.startsWith('reviews-')) return false;
    const verify = `${child}/verify.json`;
    let isFile = false;
    try { isFile = lstatSync(path.join(worktree, verify)).isFile(); } catch { isFile = false; }
    if (!isFile) return true;
    if (files.length >= max) truncated = true;
    else files.push(verify);
    return true;
  };
  const visit = (rel: string, depth: number) => {
    if (truncated) return;
    if (++folders > EVIDENCE_FILES_MAX) { truncated = true; return; }
    for (const name of folderNames(rel)) {
      const child = `${rel}/${name}`;
      if (truncated || !isFolder(child)) continue;
      if (name.startsWith('earlier-')) {
        for (const inner of folderNames(child)) if (!truncated && isFolder(`${child}/${inner}`)) take(`${child}/${inner}`, inner);
      } else if (!take(child, name) && depth < WORK_DEPTH) visit(child, depth + 1);
    }
  };
  if (noLink(worktree, '.forge/work') && isFolder('.forge/work')) visit('.forge/work', 1);
  return { files, truncated };
}
