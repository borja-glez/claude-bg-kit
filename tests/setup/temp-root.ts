// I-01: one temp root per test run. Before vitest starts its workers, TEMP, TMP and TMPDIR point at
// os.tmpdir()/bgkit-vitest-<pid>-<stamp>: the workers inherit them, so every temp entry of the run lands there, the
// tests' own and those of the CLIs and the git the tests start (os.tmpdir() reads TEMP on Windows, TMPDIR elsewhere).
// The teardown removes it. A run cut short (Ctrl+C, a timeout) leaves it behind: scripts/clean-temp.mjs counts it.
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const KEYS = ['TEMP', 'TMP', 'TMPDIR'] as const;

/** yyyymmddHHMMss in local time: the run root's name says when it started. */
export function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export default function setup(): () => void {
  const saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]])) as Record<(typeof KEYS)[number], string | undefined>;
  const root = path.join(tmpdir(), `bgkit-vitest-${process.pid}-${stamp(new Date())}`);
  mkdirSync(root, { recursive: true });
  for (const k of KEYS) process.env[k] = root;
  process.env.BGKIT_TEMP_ROOT = root;
  return () => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    delete process.env.BGKIT_TEMP_ROOT;
    try { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
    catch (e) { console.warn(`bgkit: could not remove the test temp root ${root}: ${(e as Error).message}`); }
  };
}
