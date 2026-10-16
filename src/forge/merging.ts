// D-07: .forge/execution/merging.json, the one merge attempt of `swarm integrate` or `swarm merge` in flight in this
// checkout. An attempt takes it with 'wx' as soon as it has read HEAD, so two attempts never both hold it (phase
// `baseline`); it turns to phase `merge` right before `git merge --no-ff --no-commit`, and goes after the commit or the
// rollback. A process that dies in its merge phase leaves it with MERGE_HEAD: the next attempt in that same worktree
// aborts that merge, and only that one.
import { closeSync, constants, copyFileSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import path from 'node:path';
import { SLOT_MAX_WAIT_MS } from './jobs.js';
import { pidAlive } from './pid.js';

export type MergingPhase = 'baseline' | 'merge';
export interface MergingDoc {
  task: string | null; pre: string; ref: string; pid: number; startedAt: string;
  /** When it stops counting as alive whatever its pid says: the bound of what its attempt has left (mergingStaleAt). */
  staleAt: string;
  /** The worktree it merges in, as git gives it (`rev-parse --show-toplevel` and its prefix). */
  dir: string;
  /** baseline: before `git merge`, nothing of its own to undo; merge: from `git merge` to the commit or the rollback. */
  phase: MergingPhase;
}
export const mergingFile = (main: string) => path.join(main, '.forge', 'execution', 'merging.json');
/** A marker that cannot be read is being written (between its open and its write) while this young: it stands. */
export const MERGING_UNREADABLE_MS = 30_000;
/** What a stamp adds to its bound for git, the tree cache and the execution lock. */
export const MERGING_MARGIN_SEC = 600;
/** defaultExec kills a command's wrapper this long after its timeout. */
const EXEC_GRACE_SEC = 15;

/**
 * The staleAt of a stamp: now plus the longest the attempt can take until its next stamp, from the code's own limits.
 * An install (runInstall) is one command; a validator run waits at most SLOT_MAX_WAIT_MS for its slot and runs each
 * validator at most twice (its retry); every command ends by its timeout plus EXEC_GRACE_SEC.
 */
export function mergingStaleAt(now: Date, timeoutSec: number, left: { installs: number; validators?: number }): string {
  const command = timeoutSec + EXEC_GRACE_SEC;
  const run = left.validators === undefined ? 0 : SLOT_MAX_WAIT_MS / 1000 + 2 * left.validators * command;
  return new Date(now.getTime() + (left.installs * command + run + MERGING_MARGIN_SEC) * 1000).toISOString();
}

/** The marker in `text`, or null when it cannot be trusted (then a MERGE_HEAD is someone else's). */
export function parseMerging(text: string): MergingDoc | null {
  try {
    const o = JSON.parse(text) as Record<string, unknown>;
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
    if (typeof o.pre !== 'string' || !/^[0-9a-f]{7,64}$/.test(o.pre) || typeof o.ref !== 'string' || typeof o.dir !== 'string' || !o.dir) return null;
    if (typeof o.pid !== 'number' || !Number.isInteger(o.pid) || o.pid <= 0) return null;
    if (typeof o.startedAt !== 'string' || typeof o.staleAt !== 'string' || !Number.isFinite(Date.parse(o.staleAt))) return null;
    if (o.phase !== 'baseline' && o.phase !== 'merge') return null;
    return { task: typeof o.task === 'string' ? o.task : null, pre: o.pre, ref: o.ref, pid: o.pid, startedAt: o.startedAt, staleAt: o.staleAt, dir: o.dir, phase: o.phase };
  } catch { return null; }
}

/** The marker as it is now: its text (to tell later whether it changed), its doc (null when untrusted) and its mtime. */
export interface MergingRead { text: string; doc: MergingDoc | null; mtimeMs: number }
export function readMergingFile(main: string): MergingRead | null {
  const file = mergingFile(main);
  let text: string;
  try { text = readFileSync(file, 'utf8'); } catch { return null; }
  let mtimeMs = 0;
  try { mtimeMs = statSync(file).mtimeMs; } catch { /* gone since: as old as can be */ }
  return { text, doc: parseMerging(text), mtimeMs };
}
export const readMerging = (main: string): MergingDoc | null => readMergingFile(main)?.doc ?? null;

// The markers this process holds now: a marker with this process's own pid stands only while it is one of them (a pid
// reused from a process that died is not this attempt's).
const held = new Set<string>();
const holdKey = (m: MergingDoc) => `${m.pid}|${m.startedAt}|${m.dir}|${m.pre}|${m.ref}`;

/** A merge in flight: an attempt that lives (this process's only while it holds it), before its staleAt. */
export function mergingLive(m: MergingDoc | null, now: number, alive: (pid: number) => boolean = pidAlive): boolean {
  if (!m || !(Date.parse(m.staleAt) > now)) return false;
  return m.pid === process.pid ? held.has(holdKey(m)) : alive(m.pid);
}

/** Whether a marker read stands: a live attempt's, or one still being written. */
export function mergingStands(r: MergingRead, now: number, alive: (pid: number) => boolean = pidAlive): boolean {
  return r.doc ? mergingLive(r.doc, now, alive) : now - r.mtimeMs < MERGING_UNREADABLE_MS;
}

/** The marker of an attempt in flight in this checkout, wherever it merges; null when there is none. */
export function mergeInFlight(main: string, now: number, alive: (pid: number) => boolean = pidAlive): MergingRead | null {
  const r = readMergingFile(main);
  return r && mergingStands(r, now, alive) ? r : null;
}

/**
 * Removes the marker only while it still reads `text`. It is moved aside and checked there, so a marker written
 * meanwhile is put back, never deleted (unless a newer one already took the place): of two processes removing the
 * same leftover, one removes it and the other finds the place empty or someone else's.
 */
export function removeMergingIf(main: string, text: string): boolean {
  const file = mergingFile(main);
  const aside = `${file}.${process.pid}.gone`;
  try { renameSync(file, aside); } catch { return false; }
  let moved: string | null = null;
  try { moved = readFileSync(aside, 'utf8'); } catch { moved = null; }
  if (moved === text) { rmSync(aside, { force: true }); return true; }
  try { copyFileSync(aside, file, constants.COPYFILE_EXCL); } catch { /* a newer marker took the place: that one stands */ }
  rmSync(aside, { force: true });
  return false;
}

/** The marker this process took: `stamp` rewrites its phase and staleAt while it is still the one it wrote last
 *  (false when it is not its own any more); `release` removes it, only then. */
export interface MergingHold { doc: () => MergingDoc; stamp: (phase: MergingPhase, staleAt: string) => boolean; release: () => void }

function holding(main: string, first: MergingDoc, firstText: string): MergingHold {
  let doc = first;
  let text = firstText;
  held.add(holdKey(doc));
  return {
    doc: () => doc,
    stamp: (phase, staleAt) => {
      if (readMergingFile(main)?.text !== text) return false;
      const next = { ...doc, phase, staleAt };
      const nextText = JSON.stringify(next) + '\n';
      const file = mergingFile(main);
      const tmp = `${file}.${process.pid}.tmp`;
      try { writeFileSync(tmp, nextText); renameSync(tmp, file); } catch { return false; } finally { rmSync(tmp, { force: true }); }
      doc = next; text = nextText;
      return true;
    },
    release: () => { held.delete(holdKey(doc)); removeMergingIf(main, text); },
  };
}

/** Creates the marker only when there is none ('wx'): its text, or null when one is there. */
function create(main: string, m: MergingDoc): string | null {
  const file = mergingFile(main);
  mkdirSync(path.dirname(file), { recursive: true });
  const text = JSON.stringify(m) + '\n';
  let fd: number;
  try { fd = openSync(file, 'wx'); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') return null; throw e; }
  try { writeSync(fd, text); } catch (e) { closeSync(fd); rmSync(file, { force: true }); throw e; }
  closeSync(fd);
  return text;
}

/**
 * Takes the marker for `m`. One that stands (a live attempt's, or one being written) is not taken: `{ busy }` with
 * its doc (null when it cannot be read yet). One left behind (its process died, or past its staleAt) is removed, only
 * while it is still what was read, and the take is tried once more. Throws when the file cannot be written.
 */
export function takeMerging(main: string, m: MergingDoc, now: number, alive: (pid: number) => boolean = pidAlive): { hold: MergingHold } | { busy: MergingDoc | null } {
  for (let tries = 0; tries < 2; tries++) {
    const text = create(main, m);
    if (text !== null) return { hold: holding(main, m, text) };
    const r = readMergingFile(main);
    if (!r) continue;
    if (mergingStands(r, now, alive)) return { busy: r.doc };
    removeMergingIf(main, r.text);
  }
  return { busy: readMerging(main) };
}
