// Whether a process lives, and a wait that does not spin: for the files forge leaves while it works (execution.lock,
// .forge/jobs/, merging.json).

/** True when a process with this pid exists: signal 0 checks without touching it, and EPERM means it exists under
 *  another user. A pid that is not a positive integer is never alive. */
export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}

/** Blocks the process for ms without spinning. */
export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
