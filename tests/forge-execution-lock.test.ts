import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { executionFile, executionLock, readExecution, LOCK_STALE_MS, LOCK_WAIT_MS } from '../src/forge/execution.js';
import type { ExecutionState } from '../src/lib/execution-state.js';
import { seedExecution } from './helpers/execution.js';
import { useTempDirs } from './helpers/tmp.js';

const tmp = useTempDirs();

// The writer each child process runs: the real updateExecution and the real CLI, bundled from the sources (there is no
// TypeScript runner here). `update <root> <key> <n>` adds n tasks <key>0…, each a copy of the task `seed`, one
// updateExecution at a time; `stop <root>` runs `forge swarm stop` and exits with its code.
const WRITER = `
import { updateExecution } from '../src/forge/execution.js';
import { run } from '../src/forge/cli/run.js';
const [mode, root, key, n] = process.argv.slice(2);
if (mode === 'stop') {
  const r = run(['swarm', 'stop'], { cwd: root, now: () => new Date(), env: {} });
  process.stderr.write(r.stderr);
  process.exit(r.code);
}
for (let i = 0; i < Number(n); i++) {
  updateExecution(root, cur => cur && { ...cur, tasks: { ...cur.tasks, [key + i]: { ...cur.tasks.seed, branch: 'task/' + key + i } } });
}
`;
let writer: string;
beforeAll(async () => {
  writer = path.join(tmp('forge-lock-writer-'), 'writer.cjs');
  await build({
    stdin: { contents: WRITER, resolveDir: fileURLToPath(new URL('.', import.meta.url)), sourcefile: 'writer.ts', loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', target: 'node20', outfile: writer, logLevel: 'silent',
  });
}, 60_000);

const T = '2026-10-12T12:00:00.000Z';
const execution = (): ExecutionState => ({
  runId: 'r1', kind: 'plan', mode: 'subagents', parallel: 3, project: 'shop', base: 'main', branch: 'forge/run-shop', mergeOnFinish: false,
  coordinator: 'main', hookSession: null, active: true, stopReason: null, stallReason: null, startedAt: T, lastStepAt: null,
  lastBlockStep: null, sleepUntil: null, closedAt: null, closedBy: null,
  tasks: { seed: { status: 'running', stage: 'implement', round: 0, worktree: '', branch: 'task/seed', executor: 'subagents', attempts: 0, agent: null, startedAt: T, stageSince: T, updatedAt: T, detail: null } },
} as ExecutionState);
const child = (...args: string[]) => new Promise<{ code: number | null; stderr: string; ms: number }>(resolve => {
  const t0 = Date.now();
  const c = spawn(process.execPath, [writer, ...args], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let stderr = '';
  c.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
  c.on('close', code => resolve({ code, stderr, ms: Date.now() - t0 }));
});
const setup = () => {
  const root = tmp('forge-lock-');
  seedExecution(root, execution());
  expect(readExecution(root)?.tasks.seed).toBeDefined();
  return root;
};
// A pid that existed and is gone: its process already exited.
const deadPid = () => spawnSync(process.execPath, ['-e', '']).pid!;

describe('execution.json with real processes (I-15)', () => {
  it('two processes write 50 updates each at the same time, with their own keys, and all 100 are there', async () => {
    const root = setup();
    const [a, b] = await Promise.all([child('update', root, 'A', '50'), child('update', root, 'B', '50')]);
    expect([a.code, b.code, a.stderr, b.stderr]).toEqual([0, 0, '', '']);
    const keys = Object.keys(readExecution(root)!.tasks).filter(k => k !== 'seed').sort();
    expect(keys).toHaveLength(100);
    expect(keys).toEqual([...Array.from({ length: 50 }, (_, i) => `A${i}`), ...Array.from({ length: 50 }, (_, i) => `B${i}`)].sort());
  }, 60_000);
  it('a lock left by a dead pid, or held for more than 30 s, is taken over at once', async () => {
    const root = setup();
    writeFileSync(executionLock(root), JSON.stringify({ pid: deadPid(), at: new Date().toISOString() }));
    const dead = await child('update', root, 'D', '1');
    expect(dead.code).toBe(0);
    expect(dead.ms).toBeLessThan(LOCK_WAIT_MS / 2);
    writeFileSync(executionLock(root), JSON.stringify({ pid: process.pid, at: new Date(Date.now() - LOCK_STALE_MS - 1000).toISOString() }));
    const old = await child('update', root, 'O', '1');
    expect(old.code).toBe(0);
    expect(old.ms).toBeLessThan(LOCK_WAIT_MS / 2);
    expect(Object.keys(readExecution(root)!.tasks)).toEqual(expect.arrayContaining(['D0', 'O0']));
  }, 60_000);
  it('a live lock makes a real forge swarm stop exit 2 with its pid after 10 s of retries, and writes nothing', async () => {
    const root = setup();
    const before = readFileSync(executionFile(root), 'utf8');
    writeFileSync(executionLock(root), JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    const r = await child('stop', root);
    expect(r.code).toBe(2);
    expect(r.stderr).toBe(`execution.json is locked by ${process.pid}\n`);
    expect(r.ms).toBeGreaterThanOrEqual(LOCK_WAIT_MS - 500);
    expect(readFileSync(executionFile(root), 'utf8')).toBe(before);
  }, 60_000);
});
