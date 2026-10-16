// The seats of a project in a checkout and their bindings (C3), on disk. `.waypoint/<p>/` is the checkout's seat and
// `.waypoint/<p>/seats/<sid>/` an extra one (main-2…); each holds its session.json, bound.json, pending-commits.jsonl,
// queue.jsonl, stop-ack, seen.json and last-head.json. Node only: waypoint's CLI and hooks use it, and the band reads
// the same files through $.fs (wave 2b).
// M6: the pid rule (pidAlive, and through it boundLive, settleBinding, leftSeatOf and secondSeatOf) is Node-only. The
// band reads the raw bindings and cannot apply it: a binding whose process died stays live there until its lease ends
// (5 minutes), while the hooks, which settle what they read, already see it ended.
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { BOUND_MAX_BYTES, BOUND_REREAD_MS, CACHE_DOCS_MAX, MAX_SEATS, parseBound, SESSION_MAX_BYTES, type BoundDoc } from './bound.js';
import { isSafeId } from './execution-state.js';
import { bindingLive, PREVIOUS_OFFER_MS } from './viewer-role.js';
import { pidAlive } from './pid.js';

export { pidAlive };
export interface Seat { dir: string; sid: string; checkout: boolean; bound: BoundDoc | null }
export const boundFile = (seatDir: string): string => path.join(seatDir, 'bound.json');
export const seatsDir = (wpDir: string): string => path.join(wpDir, 'seats');
export const lastHeadFile = (seatDir: string): string => path.join(seatDir, 'last-head.json');
/** At most this many worktrees are remembered in one last-head.json. */
const HEADS_MAX = 50;
const SHA = /^[0-9a-f]{7,64}$/;
/** Windows refuses a rename onto a file another process renames or opens at that same instant (EPERM, EACCES, EBUSY);
 *  that clears quickly, so the rename is tried again after 1 ms, up to this many times. */
const RENAME_TRIES = 50;
const RENAME_BUSY = new Set(['EPERM', 'EACCES', 'EBUSY']);
const pause = (ms: number): void => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
const pause1ms = (): void => pause(1);

function readText(file: string, max: number): string | null {
  try { return statSync(file).size > max ? null : readFileSync(file, 'utf8'); } catch { return null; }
}
/**
 * A bound.json's binding. The band renews one with $.fs.write, which is not atomic: a reader may find the file empty or
 * half written for an instant. A text that is empty or does not parse is read once more after BOUND_REREAD_MS; one
 * still broken is no binding (spec §4.10). A missing file is none at once. The band reads it the same way.
 */
function readBound(file: string, now?: number): BoundDoc | null {
  const text = readText(file, BOUND_MAX_BYTES);
  const b = parseBound(text, now);
  if (b || text === null) return b;
  pause(BOUND_REREAD_MS);
  return parseBound(readText(file, BOUND_MAX_BYTES), now);
}
/** A reader sees the old text or the new one, never a part: the text goes to a temporary file that is renamed in. */
export function writeAtomic(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, text);
    for (let i = 1; ; i++) {
      try { renameSync(tmp, file); return; } catch (e) {
        if (i >= RENAME_TRIES || !RENAME_BUSY.has(String((e as NodeJS.ErrnoException).code))) throw e;
        pause1ms();
      }
    }
  } finally { rmSync(tmp, { force: true }); }
}

/** A seat's binding: null when it has none, it does not read (twice, see readBound), or it names another seat. */
export function readBinding(seatDir: string, sid: string, now?: number): BoundDoc | null {
  const b = readBound(boundFile(seatDir), now);
  return b && b.sid === sid ? b : null;
}
/** Atomic (a temporary file and a rename), as every writer of a seat does. */
export function writeBinding(file: string, doc: BoundDoc): void {
  writeAtomic(file, `${JSON.stringify(doc, null, 2)}\n`);
}

/** The checkout seat's id as written: the sessionId of its session.json (not read over SESSION_MAX_BYTES, as the band
 *  does), else the sid of its bound.json; null with neither. */
export function checkoutSid(wpDir: string, now?: number): string | null {
  try {
    const s = JSON.parse(readText(path.join(wpDir, 'session.json'), SESSION_MAX_BYTES) ?? '') as { sessionId?: unknown } | null;
    if (typeof s?.sessionId === 'string' && s.sessionId) return s.sessionId;
  } catch { /* no session.json: the binding may name the seat */ }
  return readBound(boundFile(wpDir), now)?.sid ?? null;
}

/** The checkout's seat (when its id is a safe one) and up to MAX_SEATS extra seats, each with its binding. */
export function readSeats(wpDir: string, now?: number): Seat[] {
  const out: Seat[] = [];
  const own = checkoutSid(wpDir, now);
  if (own && isSafeId(own)) out.push({ dir: wpDir, sid: own, checkout: true, bound: readBinding(wpDir, own, now) });
  let names: string[] = [];
  try {
    names = readdirSync(seatsDir(wpDir), { withFileTypes: true })
      .filter(d => d.isDirectory() && isSafeId(d.name) && d.name !== own).map(d => d.name).sort().slice(0, MAX_SEATS);
  } catch { names = []; }
  for (const n of names) {
    const dir = path.join(seatsDir(wpDir), n);
    out.push({ dir, sid: n, checkout: false, bound: readBinding(dir, n, now) });
  }
  return out;
}
export const readBindings = (wpDir: string, now?: number): BoundDoc[] => readSeats(wpDir, now).flatMap(s => (s.bound ? [s.bound] : []));

/** The largest pid there can be (a signed 32-bit integer). */
const PID_MAX = 2147483647;
/** The pid a binding records: CLAUDE_PID of the environment when it is a positive integer no larger than PID_MAX. */
export const pidFromEnv = (env?: Readonly<Record<string, string | undefined>>): number | null => {
  const v = env?.CLAUDE_PID;
  return v !== undefined && /^[1-9]\d{0,9}$/.test(v) && Number(v) <= PID_MAX ? Number(v) : null;
};
/** A binding is live by its lease and, when it recorded a pid, while that process exists (the pid only shortens it). */
export function boundLive(b: BoundDoc, now: number, alive: (pid: number) => boolean = pidAlive): boolean {
  return bindingLive(b, now) && (b.pid === null || alive(b.pid));
}
/** A binding as the hooks read it: one live by its lease whose process is gone counts as ended at its last renewal.
 *  This view is never written back. */
export function settleBinding(b: BoundDoc, now: number, alive: (pid: number) => boolean = pidAlive): BoundDoc {
  return bindingLive(b, now) && b.pid !== null && !alive(b.pid) ? { ...b, endedAt: b.seenAt } : b;
}

/** Each seat's task in progress, from the state cache (`dbcache/state`, the first CACHE_DOCS_MAX files by name, as the
 *  band reads them): SID → its task `claimed` or `in_progress`. */
export function openTasksOf(wpDir: string): Record<string, string> {
  const out = Object.create(null) as Record<string, string>;
  const dir = path.join(wpDir, 'dbcache', 'state');
  let names: string[] = [];
  try { names = readdirSync(dir).filter(f => f.endsWith('.json')).sort().slice(0, CACHE_DOCS_MAX); } catch { return out; }
  for (const f of names) {
    try {
      const st = JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as { status?: unknown; owner?: unknown } | null;
      if ((st?.status === 'claimed' || st?.status === 'in_progress') && typeof st.owner === 'string' && !(st.owner in out)) out[st.owner] = f.slice(0, -5);
    } catch { /* a broken cache file is no task */ }
  }
  return out;
}

/** The seat --second-seat takes: the first main-N (N ≥ 2) that is free, already `claude`'s, or ended (or lapsed)
 *  without a task in progress; null when all MAX_SEATS are held. */
export function secondSeatOf(wpDir: string, claude: string, open: Readonly<Record<string, string>>, now: number, alive: (pid: number) => boolean = pidAlive): string | null {
  const own = checkoutSid(wpDir, now);
  for (let n = 2; n <= MAX_SEATS + 1; n++) {
    const sid = `main-${n}`;
    if (sid === own) continue;
    const b = readBinding(path.join(seatsDir(wpDir), sid), sid, now);
    if (!b || b.claude === claude || (!boundLive(b, now, alive) && !open[sid])) return sid;
  }
  return null;
}

/** I3: the seat an earlier conversation left with a task in progress (its binding not live, still offered for
 *  PREVIOUS_OFFER_MS, and a task open), the newest by its end or last renewal; null without one. */
export function leftSeatOf(seats: readonly Seat[], open: Readonly<Record<string, string>>, now: number, alive: (pid: number) => boolean = pidAlive): Seat | null {
  let best: Seat | null = null;
  let bestAt = -Infinity;
  for (const s of seats) {
    if (!s.bound || !open[s.sid] || boundLive(s.bound, now, alive)) continue;
    const at = Date.parse(settleBinding(s.bound, now, alive).endedAt ?? s.bound.seenAt);
    if (Number.isFinite(at) && at + PREVIOUS_OFFER_MS > now && at > bestAt) { best = s; bestAt = at; }
  }
  return best;
}

/**
 * last-head.json: the base post-commit compares HEAD with, per conversation and worktree (A-17), and per worktree the
 * newest commit of each of this seat's recordings (C2: what another seat on the same worktree must not take).
 */
export interface LastHead { session: string; heads: Record<string, string>; recorded?: Record<string, string[]> }
/** At most this many recordings are remembered per worktree, for this many worktrees. */
const RECORDED_MAX = 20;
const RECORDED_TOPS = 10;
/** The top level (resolved) and HEAD of the worktree `cwd`; null outside a repository or before its first commit. */
export function headOf(cwd: string): { top: string; head: string } | null {
  try {
    const [top, head] = execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split(/\r?\n/).map(l => l.trim());
    return top && head && SHA.test(head) ? { top: path.resolve(top), head } : null;
  } catch { return null; }
}
export function readLastHead(seatDir: string): LastHead | null {
  const text = readText(lastHeadFile(seatDir), 64 * 1024);
  if (text === null) return null;
  try {
    const o = JSON.parse(text) as { session?: unknown; heads?: unknown; recorded?: unknown } | null;
    if (!o || !isSafeId(o.session) || !o.heads || typeof o.heads !== 'object' || Array.isArray(o.heads)) return null;
    const heads: Record<string, string> = {};
    for (const [k, v] of Object.entries(o.heads as Record<string, unknown>).slice(-HEADS_MAX)) if (typeof v === 'string' && SHA.test(v)) heads[k] = v;
    const recorded: Record<string, string[]> = {};
    if (o.recorded && typeof o.recorded === 'object' && !Array.isArray(o.recorded)) {
      for (const [k, v] of Object.entries(o.recorded as Record<string, unknown>).slice(-RECORDED_TOPS)) {
        if (Array.isArray(v)) recorded[k] = v.filter((s): s is string => typeof s === 'string' && SHA.test(s)).slice(-RECORDED_MAX);
      }
    }
    return { session: o.session, heads, recorded };
  } catch { return null; }
}
export function writeLastHead(seatDir: string, doc: LastHead): void {
  const recorded = Object.fromEntries(Object.entries(doc.recorded ?? {}).filter(([, v]) => v.length).slice(-RECORDED_TOPS).map(([k, v]) => [k, v.slice(-RECORDED_MAX)]));
  const out = { session: doc.session, heads: Object.fromEntries(Object.entries(doc.heads).slice(-HEADS_MAX)), ...(Object.keys(recorded).length ? { recorded } : {}) };
  writeAtomic(lastHeadFile(seatDir), `${JSON.stringify(out)}\n`);
}
/** HEAD of the worktree `cwd` becomes the base of `session` there; another conversation's file starts over. */
export function recordBase(seatDir: string, session: string, cwd: string): void {
  const at = headOf(cwd);
  if (!at) return;
  const lh = readLastHead(seatDir);
  const mine = lh && lh.session === session ? lh : null;
  const heads = mine?.heads ?? {};
  if (heads[at.top] !== at.head) writeLastHead(seatDir, { session, heads: { ...heads, [at.top]: at.head }, recorded: mine?.recorded });
}
