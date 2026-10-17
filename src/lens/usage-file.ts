// The per-session usage file (<main checkout>/.forge/usage/<session>.json) and the run's sum over every session.
import { newUsage, type UsageLoop, type UsageState } from './usage.js';
import { isSafeId } from '../lib/execution-state.js';

export const USAGE_FILE_MAX = 256 * 1024;
export const USAGE_FILES_MAX = 200;
const USAGE_LOOPS_MAX = 201; // 200 loops plus the overflow one

/** E-07: what a session had spent when it first saw the run it works for: the run counts only what came after. */
export interface RunBaseline { runKey: string; costUsd: number; tokens: number; activeMs: number }

/** A file's or a state's totals: dollars and tokens over its loops. */
export function totalsOf(loops: Record<string, UsageLoop>): { costUsd: number; tokens: number } {
  let costUsd = 0;
  let tokens = 0;
  for (const l of Object.values(loops)) { costUsd += l.costUsd; tokens += l.input + l.output + l.cacheRead + l.cacheWrite; }
  return { costUsd, tokens };
}
export interface UsageFile {
  v: 1; session: string; label: string; worktree: string; startedAt: string; updatedAt: string; costUsd: number | null;
  loops: Record<string, UsageLoop>; tracking: { waypoint: number; forge: number }; activeMs?: number; trackingReread?: number;
  // E-07: the run this session works for (its coordinator or a member), null for none; absent in an older file, and in
  // one written before its session read its band (I2).
  runKey?: string | null; runBaseline?: RunBaseline | null;
}
type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x);
const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0);
const str = (x: unknown) => (typeof x === 'string' && x ? x : null);
const iso = (x: unknown) => (typeof x === 'string' && !Number.isNaN(Date.parse(x)) ? x : null);

/**
 * The file of a session's state. `runKey` undefined (I2: its band was not read yet, so whether it works for a run is
 * unknown) writes no key at all: a reader takes it as an older file, counted whole and marking the run's sum partial.
 */
export function toUsageFile(s: UsageState, meta: { session: string; label: string; worktree: string; now: number; costUsd: number | null; runKey?: string | null; runBaseline?: RunBaseline | null }): UsageFile {
  return {
    v: 1, session: meta.session, label: meta.label, worktree: meta.worktree,
    startedAt: new Date(s.startedAt).toISOString(), updatedAt: new Date(meta.now).toISOString(),
    costUsd: meta.costUsd, loops: s.loops, tracking: { waypoint: s.tracking.waypoint, forge: s.tracking.forge }, activeMs: s.activeMs, trackingReread: s.tracking.reread,
    ...(meta.runKey !== undefined ? { runKey: meta.runKey } : {}), runBaseline: meta.runBaseline ?? null,
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

// A baseline with a safe run key and three finite amounts, else none (the file then counts whole, E-07).
function baselineOf(x: unknown): RunBaseline | null {
  if (!isObj(x) || !isSafeId(x.runKey)) return null;
  const amount = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
  const costUsd = amount(x.costUsd), tokens = amount(x.tokens), activeMs = amount(x.activeMs);
  return costUsd !== null && tokens !== null && activeMs !== null ? { runKey: x.runKey, costUsd, tokens, activeMs } : null;
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
    ...('runKey' in x ? { runKey: isSafeId(x.runKey) ? x.runKey : null } : {}),
    ...('runBaseline' in x ? { runBaseline: baselineOf(x.runBaseline) } : {}),
    ...(typeof x.activeMs === 'number' && Number.isFinite(x.activeMs) && x.activeMs >= 0 ? { activeMs: x.activeMs } : {}),
    ...(typeof x.trackingReread === 'number' && Number.isFinite(x.trackingReread) && x.trackingReread >= 0 ? { trackingReread: x.trackingReread } : {}),
  };
}

// From lib/main-checkout.ts (lib/worktree.ts re-exports it too, but imports node:path, which the mod bundle cannot).
export { mainCheckoutFrom } from '../lib/main-checkout.js';

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
 * The current run's start: the execution's (.forge/execution.json), else the infinite run's, else the newest Large
 * run's (base files). An execution or infinite run counts while its `active` is true or its file was touched within
 * 12 hours; a Large run, by its mtime. null when none counts: the run is over and the card shows this session only.
 */
export function runStartedAt(src: { execution?: RunSource; run?: RunSource; largeRuns: RunSource[] }, now: number): number | null {
  for (const s of [src.execution, src.run]) {
    if (!s) continue;
    const x = parsed(s.text);
    if (!x || (x.active !== true && !recent(s, now))) continue;
    const t = startOf(x);
    if (t !== null) return t;
  }
  const large = src.largeRuns.filter(s => recent(s, now)).map(s => startOf(parsed(s.text))).filter((t): t is number => t !== null);
  return large.length ? Math.max(...large) : null;
}

/**
 * Every session of the run summed, loops keyed `<session>/<loop>`; the own session counts from its live state. E-07:
 * with the run's key, only that run's files count, each from its baseline (what it had spent when it first saw the run):
 * its loops scaled by what is left of its totals, an approximation by totals and not by loop. A file of an older lens
 * (no runKey) counts whole and makes the sum partial, as does a baseline missing or above its totals; a file of another
 * run is left out. Without a key (the infinite mode, a Large run without an execution), every file counts as before.
 */
export function mergeForRun(files: UsageFile[], own: { session: string; state: UsageState; baseline?: RunBaseline | null }, since: number, runKey: string | null = null): UsageState {
  const out = newUsage(since);
  // Adds one session from its baseline when it holds; says whether it did.
  const add = (session: string, loops: Record<string, UsageLoop>, tracking: { waypoint: number; forge: number }, reread: number, activeMs: number | undefined, baseline: RunBaseline | null): boolean => {
    const t = totalsOf(loops);
    const ok = !!baseline && baseline.costUsd <= t.costUsd + 1e-9 && baseline.tokens <= t.tokens && (activeMs === undefined || baseline.activeMs <= activeMs);
    const cf = ok && t.costUsd > 0 ? 1 - baseline!.costUsd / t.costUsd : 1;
    const tf = ok && t.tokens > 0 ? 1 - baseline!.tokens / t.tokens : 1;
    for (const [id, l] of Object.entries(loops)) {
      out.loops[`${session}/${id}`] = { ...l, input: l.input * tf, output: l.output * tf, cacheRead: l.cacheRead * tf, cacheWrite: l.cacheWrite * tf, costUsd: l.costUsd * cf };
    }
    out.tracking.waypoint += tracking.waypoint * tf;
    out.tracking.forge += tracking.forge * tf;
    out.tracking.reread += reread * tf;
    // A file written before activeMs existed counts 0 and makes the run's active time a lower bound.
    if (activeMs === undefined) out.activePartial = true;
    else out.activeMs += Math.max(0, activeMs - (ok ? baseline!.activeMs : 0));
    return ok;
  };
  for (const f of files) {
    if (f.session === own.session || Date.parse(f.updatedAt) < since) continue;
    if (runKey !== null && f.runKey !== undefined && f.runKey !== runKey) continue;
    const ok = add(f.session, f.loops, f.tracking, f.trackingReread ?? 0, f.activeMs, runKey !== null && f.runKey === runKey ? f.runBaseline ?? null : null);
    if (runKey !== null && !ok) out.runPartial = true;
  }
  const ownBaseline = runKey !== null && own.baseline?.runKey === runKey ? own.baseline : null;
  const ownOk = add(own.session, own.state.loops, own.state.tracking, own.state.tracking.reread, own.state.activeMs, ownBaseline);
  if (runKey !== null && !ownOk) out.runPartial = true;
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
  s.tracking.reread += file.trackingReread ?? 0;
  s.activeMs += file.activeMs ?? 0;
}
