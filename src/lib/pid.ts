// Whether a process lives: the one rule for waypoint's bindings (src/lib/bound-fs.ts) and for the files forge leaves
// while it works (src/forge/pid.ts re-exports it). Node only, through `process`; no import of src/forge.

/** True when a process with this pid exists: signal 0 checks without touching it, and EPERM means it exists under
 *  another user. A pid that is not a positive integer is never alive. */
export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}
