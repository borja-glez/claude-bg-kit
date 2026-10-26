// D-03, D-18: what forge swarm cleanup may remove (only forge's own worktrees and branches, and only once integrated into
// the branch of the main checkout) and the state of the executions that ended (K5-08).
import { readdirSync, readFileSync, rmSync, rmdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { samePath } from '../lib/worktree.js';
import { LIVE_MAX_AGE_HOURS, isSafeId, normalizeLive, normalizePublicTask } from '../lib/execution-state.js';
import { normalizeMember } from '../lib/member-doc.js';
import { lockFileState, removeStaleGate, removeStaleLock, staleGate } from './execution.js';
import { pidAlive } from './pid.js';
import { LIVE_LOCK_STALE_MS } from './live.js';

export interface ForgeWorktree { path: string; name: string; branch: string | null }

/** forge's worktrees of `main` in `git worktree list --porcelain`: `.claude/worktrees/task-*` and `run`, with their branch. */
export function forgeWorktrees(porcelain: string, main: string): ForgeWorktree[] {
  const home = path.join(main, '.claude', 'worktrees');
  const out: ForgeWorktree[] = [];
  for (const block of porcelain.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/);
    const at = lines.find(l => l.startsWith('worktree '))?.slice('worktree '.length).trim();
    if (!at) continue;
    const name = path.basename(at);
    if (!samePath(path.dirname(at), home) || !(/^task-.+/.test(name) || name === 'run')) continue;
    const ref = lines.find(l => l.startsWith('branch '))?.slice('branch '.length).trim() ?? '';
    out.push({ path: path.resolve(at), name, branch: ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : null });
  }
  return out;
}

/** A branch forge makes: task/<T> or forge/run-<project>. */
export const isForgeBranch = (b: string) => /^task\/.+/.test(b) || /^forge\/run-.+/.test(b);

/** forge's branches in `git for-each-ref --format=%(refname) refs/heads/task refs/heads/forge`: task/* and forge/run-*. */
export function forgeBranches(refs: string): string[] {
  return refs.split(/\r?\n/).map(l => l.trim()).filter(l => l.startsWith('refs/heads/')).map(l => l.slice('refs/heads/'.length))
    .filter(isForgeBranch);
}

/** D-18: the old baselines of .forge/execution/baseline/ (wave 1 stopped writing them) go after this long. */
export const BASELINE_MAX_AGE_MS = 7 * 24 * 3600_000;
/** What a removed task's work folder no longer needs; its briefs, reviews, verify.json, evidence and handover stay. */
const DISPOSABLE = /^(?:diff-.*\.patch|fix-.*\.patch|validators-.*\.json|baseline-.*\.json)$/;
const MAX_FILES = 2000;

export interface Pruned { files: string[]; bytes: number }

// `remove`: how the file goes when a plain remove would not do (a lock goes through its takeover gate); false: it stays.
function dropper(dryRun: boolean): { drop: (file: string, remove?: () => boolean) => void; out: Pruned } {
  const out: Pruned = { files: [], bytes: 0 };
  const drop = (file: string, remove?: () => boolean) => {
    try {
      const st = statSync(file);
      if (!st.isFile()) return;
      if (!dryRun) {
        if (remove) { if (!remove()) return; } else rmSync(file, { force: true });
      }
      out.files.push(file);
      out.bytes += st.size;
    } catch { /* gone already */ }
  };
  return { drop, out };
}

/** Every *.json of `dir` that parses, with its file. */
function jsonDocs(dir: string): { file: string; doc: unknown }[] {
  let names: string[] = [];
  try { names = readdirSync(dir).filter(n => n.endsWith('.json')).slice(0, MAX_FILES); } catch { return []; }
  return names.flatMap(n => {
    const file = path.join(dir, n);
    try { return [{ file, doc: JSON.parse(readFileSync(file, 'utf8')) as unknown }]; } catch { return []; }
  });
}

/**
 * The state of the executions other than `keep` (null: none is kept): .forge/execution/<T>.json, .forge/members/*.json and
 * .forge/live/*.json of another runId, and the question notes of its unattended runs (.forge/execution/asked/<runId>/). With `stale`, also live signals that ended or are older than LIVE_MAX_AGE_HOURS,
 * and .forge/execution/baseline/ files older than 7 days (the folder goes when it empties). A file that does not read as
 * its kind (merging.json, a corrupt one) stays. With `dryRun` nothing is removed.
 */
export function pruneRunState(main: string, keep: string | null, opts: { now: number; stale: boolean; dryRun: boolean }): Pruned {
  const { drop, out } = dropper(opts.dryRun);
  const forge = path.join(main, '.forge');
  for (const { file, doc } of jsonDocs(path.join(forge, 'execution'))) {
    const p = normalizePublicTask(doc);
    if (p && `${p.task}.json` === path.basename(file) && p.runId !== keep) drop(file);
  }
  for (const { file, doc } of jsonDocs(path.join(forge, 'members'))) {
    const m = normalizeMember(doc);
    if (m && `${m.sessionId}.json` === path.basename(file) && m.runId !== keep) drop(file);
  }
  for (const { file, doc } of jsonDocs(path.join(forge, 'live'))) {
    const d = normalizeLive(doc);
    if (!d) continue;
    const t = Date.parse(d.ts);
    const stale = opts.stale && (d.ended || !Number.isFinite(t) || opts.now - t > LIVE_MAX_AGE_HOURS * 3600_000);
    if (d.runId !== keep || stale) drop(file);
  }
  // FC2: the lock of a live signal that a process killed in its hook left (its pid gone, or past LIVE_LOCK_STALE_MS),
  // removed through its takeover gate as a hook takes it over (never while another process does); then the takeover
  // gates left behind. The next hook takes a stale lock over anyway: this only tidies the folder.
  const lockDeps = { now: () => new Date(opts.now), staleMs: LIVE_LOCK_STALE_MS };
  const liveNames = (end: string) => { try { return readdirSync(path.join(forge, 'live')).filter(n => n.endsWith(end)).slice(0, MAX_FILES); } catch { return []; } };
  for (const n of liveNames('.json.lock')) {
    const file = path.join(forge, 'live', n);
    const s = lockFileState(file, new Date(opts.now), pidAlive, LIVE_LOCK_STALE_MS);
    if (s.held && s.stale) drop(file, () => removeStaleLock(file, lockDeps));
  }
  for (const n of liveNames('.json.lock.takeover')) {
    const gate = path.join(forge, 'live', n);
    if (staleGate(gate, lockDeps)) drop(gate, () => removeStaleGate(gate, lockDeps));
  }
  // The question notes an unattended run left (.forge/execution/asked/<runId>/<surface>.json) go with the run.
  const asked = path.join(forge, 'execution', 'asked');
  let runs: string[] = [];
  try { runs = readdirSync(asked).slice(0, MAX_FILES); } catch { runs = []; }
  for (const id of runs.filter(n => isSafeId(n) && n !== keep)) {
    const dir = path.join(asked, id);
    let files: string[] = [];
    try { files = readdirSync(dir).slice(0, MAX_FILES); } catch { continue; }
    for (const n of files) drop(path.join(dir, n));
    if (!opts.dryRun) { try { rmdirSync(dir); } catch { /* not a folder, or not empty */ } }
  }
  if (opts.stale) {
    const base = path.join(forge, 'execution', 'baseline');
    let names: string[] = [];
    try { names = readdirSync(base).slice(0, MAX_FILES); } catch { names = []; }
    for (const n of names) {
      const file = path.join(base, n);
      try { const st = statSync(file); if (st.isFile() && opts.now - st.mtimeMs > BASELINE_MAX_AGE_MS) drop(file); } catch { /* gone */ }
    }
    if (!opts.dryRun) { try { if (!readdirSync(base).length) rmdirSync(base); } catch { /* none, or not empty */ } }
  }
  return out;
}

/** D-18: the diffs and validator runs in the work folders of `tasks` (.forge/work/<T> and .forge/work/<project>/<T>). */
export function pruneWork(main: string, tasks: readonly string[], dryRun: boolean): Pruned {
  const { drop, out } = dropper(dryRun);
  const work = path.join(main, '.forge', 'work');
  let projects: string[] = [];
  try { projects = readdirSync(work, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch { return out; }
  for (const t of tasks) {
    for (const dir of [path.join(work, t), ...projects.map(p => path.join(work, p, t))]) {
      let names: string[] = [];
      try { names = readdirSync(dir); } catch { continue; }
      for (const n of names) if (DISPOSABLE.test(n)) drop(path.join(dir, n));
    }
  }
  return out;
}
