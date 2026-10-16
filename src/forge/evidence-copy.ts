// K2-04: a member's verification evidence reaches the main checkout. Files under one directory are copied to the same
// relative paths under another, never through a link nor outside either one, up to a size cap per call.
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { samePath } from '../lib/worktree.js';
import { ledgerRoot } from './ledger.js';

/** What one call copies at most (spec §4.7). */
export const EVIDENCE_COPY_MAX = 50 * 1024 * 1024;
const MAX_FILES = 5000;

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

/** The files under `rel` (a file or a folder relative to `from`), in path order and with `/`; none through a link or outside `from`. */
function filesUnder(from: string, rel: string): string[] {
  const out: string[] = [];
  const start = safeRel(rel);
  if (!start || !noLink(from, start)) return out;
  const walk = (r: string) => {
    if (out.length >= MAX_FILES) return;
    const abs = path.join(from, r);
    let st;
    try { st = lstatSync(abs); } catch { return; }
    if (st.isSymbolicLink()) return;
    if (st.isFile()) { out.push(r); return; }
    if (!st.isDirectory()) return;
    let names: string[] = [];
    try { names = readdirSync(abs).sort(); } catch { return; }
    for (const n of names) walk(`${r}/${n}`);
  };
  walk(start);
  return out;
}

export interface Copied { copied: string[]; bytes: number; skipped: string[] }

/**
 * Copies files and folders (`rels`, relative to `from`) to the same relative paths under `to`, in path order, until
 * `max` bytes; what does not fit, or cannot be copied (a link or a junction on its way under `to` among them), is named
 * in `skipped`. With `missingOnly`, a file `to` already has is left as it is.
 */
export function copyTree(from: string, to: string, rels: readonly string[], opts: { max?: number; missingOnly?: boolean } = {}): Copied {
  const max = opts.max ?? EVIDENCE_COPY_MAX;
  const out: Copied = { copied: [], bytes: 0, skipped: [] };
  for (const rel of [...new Set(rels.flatMap(r => filesUnder(from, r)))]) {
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

/** Every verify.json and evidence/ file under a task worktree's .forge/work: what swarm cleanup copies before removing it. */
export function evidenceOf(worktree: string): string[] {
  return filesUnder(worktree, '.forge/work').filter(f => /(^|\/)verify\.json$/.test(f) || /\/evidence\//.test(f));
}
