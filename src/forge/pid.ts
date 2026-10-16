// Whether a process lives, and a wait that does not spin: for the files forge leaves while it works (execution.lock,
// .forge/jobs/, merging.json).
import { constants, copyFileSync, readFileSync, renameSync, rmSync } from 'node:fs';

/**
 * Removes `file` only while it still reads `text`. It is moved aside and checked there, so a file written meanwhile is
 * put back, never deleted (unless a newer one already took the place): of two processes removing the same leftover,
 * one removes it and the other finds the place empty or someone else's.
 */
export function removeFileIf(file: string, text: string): boolean {
  const aside = `${file}.${process.pid}.gone`;
  try { renameSync(file, aside); } catch { return false; }
  let moved: string | null = null;
  try { moved = readFileSync(aside, 'utf8'); } catch { moved = null; }
  if (moved === text) { rmSync(aside, { force: true }); return true; }
  try { copyFileSync(aside, file, constants.COPYFILE_EXCL); } catch { /* a newer file took the place: that one stands */ }
  rmSync(aside, { force: true });
  return false;
}

/** The one liveness rule, shared with waypoint's bindings (which cannot import src/forge). */
export { pidAlive } from '../lib/pid.js';

/** Blocks the process for ms without spinning. */
export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
