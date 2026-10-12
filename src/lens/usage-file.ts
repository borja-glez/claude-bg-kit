// The per-session usage file (<main checkout>/.forge/usage/<session>.json) and the run's sum over every session.
import { newUsage, type UsageLoop, type UsageState } from './usage.js';

export const USAGE_FILE_MAX = 256 * 1024;
export const USAGE_FILES_MAX = 200;
const USAGE_LOOPS_MAX = 201; // 200 loops plus the overflow one
export interface UsageFile {
  v: 1; session: string; label: string; worktree: string; startedAt: string; updatedAt: string; costUsd: number | null;
  loops: Record<string, UsageLoop>; tracking: { waypoint: number; forge: number };
}
type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x);
const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0);
const str = (x: unknown) => (typeof x === 'string' && x ? x : null);
const iso = (x: unknown) => (typeof x === 'string' && !Number.isNaN(Date.parse(x)) ? x : null);

export function toUsageFile(s: UsageState, meta: { session: string; label: string; worktree: string; now: number; costUsd: number | null }): UsageFile {
  return {
    v: 1, session: meta.session, label: meta.label, worktree: meta.worktree,
    startedAt: new Date(s.startedAt).toISOString(), updatedAt: new Date(meta.now).toISOString(),
    costUsd: meta.costUsd, loops: s.loops, tracking: s.tracking,
  };
}

function parseLoop(x: unknown): UsageLoop | null {
  if (!isObj(x)) return null;
  return {
    kind: str(x.kind) ?? 'unknown', description: str(x.description), model: str(x.model), effort: str(x.effort),
    steps: num(x.steps), input: num(x.input), output: num(x.output), cacheRead: num(x.cacheRead), cacheWrite: num(x.cacheWrite),
    costUsd: num(x.costUsd), unpriced: num(x.unpriced),
  };
}

export function parseUsageFile(text: string | undefined): UsageFile | null {
  if (typeof text !== 'string' || text.length > USAGE_FILE_MAX) return null;
  let x: unknown;
  try { x = JSON.parse(text); } catch { return null; }
  if (!isObj(x) || x.v !== 1) return null;
  const session = str(x.session);
  const startedAt = iso(x.startedAt);
  const updatedAt = iso(x.updatedAt);
  if (!session || !startedAt || !updatedAt || !isObj(x.loops)) return null;
  const loops: Record<string, UsageLoop> = {};
  for (const [id, l] of Object.entries(x.loops).slice(0, USAGE_LOOPS_MAX)) { const p = parseLoop(l); if (p) loops[id] = p; }
  const t = isObj(x.tracking) ? x.tracking : {};
  return {
    v: 1, session, label: str(x.label) ?? session, worktree: str(x.worktree) ?? '', startedAt, updatedAt,
    costUsd: typeof x.costUsd === 'number' && Number.isFinite(x.costUsd) ? x.costUsd : null,
    loops, tracking: { waypoint: num(t.waypoint), forge: num(t.forge) },
  };
}

/** The main checkout of a session root: `<repo>` for a worktree whose .git file says `gitdir: <repo>/.git/worktrees/<x>`. */
export function mainCheckoutFrom(root: string, gitFileText: string | null): string {
  const m = gitFileText ? /^gitdir:\s*(.+?)[\\/]\.git[\\/]worktrees[\\/][^\\/\r\n]+\s*$/m.exec(gitFileText) : null;
  const dir = m ? m[1] : null;
  return dir && (/^[A-Za-z]:/.test(dir) || dir.startsWith('/')) ? dir : root;
}

/** A run file as read: its text and its mtime (null when unknown). */
export interface RunSource { text?: string; mtimeMs: number | null }
/** A run file touched within this window still counts once it is no longer active. */
export const RUN_RECENT_MS = 12 * 3600_000;

const parsed = (text: string | undefined): Obj | null => {
  if (!text) return null;
  try { const x = JSON.parse(text); return isObj(x) ? x : null; } catch { return null; }
};
const startOf = (x: Obj | null): number | null => {
  const t = x ? Date.parse(String(x.startedAt)) : NaN;
  return Number.isFinite(t) ? t : null;
};
const recent = (src: RunSource, now: number) => src.mtimeMs !== null && Number.isFinite(now) && now - src.mtimeMs <= RUN_RECENT_MS;

/**
 * The current run's start: the swarm's, else the infinite run's, else the newest Large run's (base files). A swarm or
 * infinite run counts while its `active` is true or its file was touched within 12 hours; a Large run, by its mtime.
 * null when none counts: the run is over and the card shows this session only.
 */
export function runStartedAt(src: { swarm?: RunSource; run?: RunSource; largeRuns: RunSource[] }, now: number): number | null {
  for (const s of [src.swarm, src.run]) {
    if (!s) continue;
    const x = parsed(s.text);
    if (!x || (x.active !== true && !recent(s, now))) continue;
    const t = startOf(x);
    if (t !== null) return t;
  }
  const large = src.largeRuns.filter(s => recent(s, now)).map(s => startOf(parsed(s.text))).filter((t): t is number => t !== null);
  return large.length ? Math.max(...large) : null;
}

/** Every session of the run summed, loops keyed `<session>/<loop>`; the own session counts from its live state. */
export function mergeForRun(files: UsageFile[], own: { session: string; state: UsageState }, since: number): UsageState {
  const out = newUsage(since);
  const add = (session: string, loops: Record<string, UsageLoop>, tracking: { waypoint: number; forge: number }) => {
    for (const [id, l] of Object.entries(loops)) out.loops[`${session}/${id}`] = { ...l };
    out.tracking.waypoint += tracking.waypoint;
    out.tracking.forge += tracking.forge;
  };
  for (const f of files) {
    if (f.session === own.session || Date.parse(f.updatedAt) < since) continue;
    add(f.session, f.loops, f.tracking);
  }
  add(own.session, own.state.loops, own.state.tracking);
  return out;
}

/** A resumed session's own file added into its live state: counts summed per loop, labels kept where the state has them. */
export function seedUsage(s: UsageState, file: UsageFile): void {
  for (const [id, l] of Object.entries(file.loops)) {
    const cur = s.loops[id];
    if (!cur) { s.loops[id] = { ...l }; continue; }
    if (cur.kind === 'unknown') cur.kind = l.kind;
    cur.description ??= l.description;
    cur.model ??= l.model;
    cur.effort ??= l.effort;
    cur.steps += l.steps;
    cur.input += l.input;
    cur.output += l.output;
    cur.cacheRead += l.cacheRead;
    cur.cacheWrite += l.cacheWrite;
    cur.costUsd += l.costUsd;
    cur.unpriced += l.unpriced;
  }
  s.tracking.waypoint += file.tracking.waypoint;
  s.tracking.forge += file.tracking.forge;
}
