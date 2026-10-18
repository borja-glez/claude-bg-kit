// I-01: the temp directories of a test file. `const tmp = useTempDirs();` gives `tmp(prefix)`: a fresh directory
// bgkit-<prefix><6 characters> under the run's temp root (tests/setup/temp-root.ts). An afterAll of the file (or of the
// describe that called useTempDirs) removes every one it made, so the run root stays small while the suite runs: forge
// runs the suite several times per brief. The only mkdtempSync of tests/ is here (tests/temp-hygiene.test.ts).
import { afterAll } from 'vitest';
import { mkdtempSync, rmSync, type RmOptions } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Removes a directory and what it holds. On Windows a child process (git, a hung validator) may still hold a file
 *  (EBUSY): rm retries, and a directory that still resists is warned about, never thrown. */
export function removeDir(dir: string, rm: (dir: string, opts: RmOptions) => void = rmSync): boolean {
  try {
    rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    return true;
  } catch (e) {
    console.warn(`bgkit: could not remove ${dir}: ${(e as Error).message}`);
    return false;
  }
}

export function useTempDirs(): (prefix: string) => string {
  const made: string[] = [];
  afterAll(() => { for (const d of made.splice(0)) removeDir(d); });
  return (prefix: string) => {
    const dir = mkdtempSync(path.join(tmpdir(), `bgkit-${prefix}`));
    made.push(dir);
    return dir;
  };
}
