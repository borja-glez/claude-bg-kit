import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readExecution, executionFile, writePublicTask, executionTaskFile, runBranch, taskBranch, runWorktree, taskWorktree, updateExecution, executionLock, LOCK_STALE_MS, createIfAbsent,
  writeAtomic, executionLockState, peekExecution,
} from '../src/forge/execution.js';
import { run } from '../src/forge/cli/run.js';
import type { ExecutionState } from '../src/lib/execution-state.js';
import { useTempDirs } from './helpers/tmp.js';
import { seedExecution } from './helpers/execution.js';
const tmp = useTempDirs();

let root: string;
beforeEach(() => { root = tmp('forge-exec-'); mkdirSync(path.join(root, '.forge')); });
const T = '2026-10-12T12:00:00.000Z';

describe('execution store', () => {
  it('names branches and worktrees', () => {
    expect(runBranch('shop')).toBe('forge/run-shop');
    expect(taskBranch('T004')).toBe('task/T004');
    expect(runWorktree(root)).toBe(path.join(root, '.claude', 'worktrees', 'run'));
    expect(taskWorktree(root, 'T004')).toBe(path.join(root, '.claude', 'worktrees', 'task-T004'));
  });
  it('is null without a file and round-trips a saved state', () => {
    expect(readExecution(root)).toBeNull();
    const e = { runId: 'r1', kind: 'plan', mode: 'subagents', parallel: 3, project: 'shop', base: 'main', branch: 'forge/run-shop', mergeOnFinish: false, coordinator: 'main', hookSession: null, active: true, stopReason: null, stallReason: null, startedAt: T, lastStepAt: null, lastBlockStep: null, sleepUntil: null, tasks: {} } as const;
    seedExecution(root, { ...e, tasks: {} });
    expect(readExecution(root)).toEqual({ ...e, tasks: {}, closedAt: null, closedBy: null });
  });
  it('migrates an active swarm.json once: stopped, renamed, never relaunched', () => {
    writeFileSync(path.join(root, '.forge', 'swarm.json'), JSON.stringify({
      active: true, parallel: 5, mergeAuthorized: false, project: 'shop', base: 'main', coordinator: 'main', hookSession: null,
      startedAt: T, lastTickAt: T, lastBlockTick: null, sleepUntil: null, stopReason: null, stallReason: null, notice: null, fronts: {},
    }));
    const e = readExecution(root)!;
    expect(e).toMatchObject({ active: false, stopReason: 'migrated', project: 'shop' });
    expect(existsSync(path.join(root, '.forge', 'swarm.json'))).toBe(false);
    expect(existsSync(path.join(root, '.forge', 'swarm.json.migrated'))).toBe(true);
    expect(existsSync(executionFile(root))).toBe(true);
    expect(readExecution(root)).toEqual(e);
  });
  it('writes the public state of a task for lens', () => {
    writePublicTask(root, { task: 'T1', runId: 'r1', stage: 'review', status: 'running', agent: 'forge-review-correctness', round: 2, since: T, updatedAt: T, leaseUntil: T, by: 'main', mode: 'subagents' });
    expect(JSON.parse(readFileSync(executionTaskFile(root, 'T1'), 'utf8'))).toMatchObject({ task: 'T1', stage: 'review', round: 2 });
  });
});

describe('writeAtomic (FW5c)', () => {
  const failing = (code: string, times: number) => {
    const calls: string[] = [];
    const rename = (from: string, to: string) => {
      calls.push(to);
      if (calls.length <= times) throw Object.assign(new Error(`${code}: rename`), { code });
      renameSync(from, to);
    };
    return { rename, calls };
  };
  it('tries a rename that Windows refuses for a moment (EPERM, EBUSY, EACCES) again, and lands the file', () => {
    for (const code of ['EPERM', 'EBUSY', 'EACCES']) {
      const file = path.join(root, '.forge', `${code}.json`);
      const { rename, calls } = failing(code, 2);
      writeAtomic(file, `{"code":"${code}"}\n`, rename);
      expect(calls, code).toHaveLength(3);
      expect(readFileSync(file, 'utf8')).toBe(`{"code":"${code}"}\n`);
    }
    expect(readdirSync(path.join(root, '.forge')).filter(n => n.endsWith('.tmp'))).toEqual([]);
  });
  it('throws when the rename keeps failing, or fails for another reason at once, and leaves no temporary file', () => {
    const file = path.join(root, '.forge', 'x.json');
    const always = failing('EBUSY', Infinity);
    expect(() => writeAtomic(file, '{}\n', always.rename)).toThrow(/EBUSY/);
    expect(always.calls.length).toBeGreaterThan(1);
    const other = failing('ENOSPC', Infinity);
    expect(() => writeAtomic(file, '{}\n', other.rename)).toThrow(/ENOSPC/);
    expect(other.calls).toHaveLength(1);
    expect(existsSync(file)).toBe(false);
    expect(readdirSync(path.join(root, '.forge'))).toEqual([]);
  });
});

describe('updateExecution and execution.lock (I-15)', () => {
  const e = (over: Partial<ExecutionState> = {}): ExecutionState => ({
    runId: 'r1', kind: 'plan', mode: 'subagents', parallel: 3, project: 'shop', base: 'main', branch: 'forge/run-shop', mergeOnFinish: false,
    coordinator: 'main', hookSession: null, active: true, stopReason: null, stallReason: null, startedAt: T, lastStepAt: null,
    lastBlockStep: null, sleepUntil: null, tasks: {}, ...over,
  });
  const now = () => new Date(T);
  const lock = (o: unknown) => writeFileSync(executionLock(root), typeof o === 'string' ? o : JSON.stringify(o));
  // A pid that existed and is gone: its process already exited.
  const deadPid = () => spawnSync(process.execPath, ['-e', '']).pid!;

  it('executionLockState reads the lock without taking it; peekExecution never migrates swarm.json', () => {
    expect(executionLockState(root, new Date())).toEqual({ held: false });
    mkdirSync(path.join(root, '.forge'), { recursive: true });
    const lockFile = path.join(root, '.forge', 'execution.lock');
    writeFileSync(lockFile, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    expect(executionLockState(root, new Date())).toMatchObject({ held: true, pid: process.pid, stale: false });
    writeFileSync(lockFile, JSON.stringify({ pid: deadPid(), at: new Date(Date.now() - 60_000).toISOString() }));
    expect(executionLockState(root, new Date())).toMatchObject({ held: true, stale: true });
    expect(readFileSync(lockFile, 'utf8')).toContain('"pid"'); // still there: nothing was taken
    writeFileSync(path.join(root, '.forge', 'swarm.json'), JSON.stringify({ project: 'shop', tasks: {}, active: false }));
    expect(peekExecution(root)).toMatchObject({ exec: null, migratable: true });
    expect(existsSync(path.join(root, '.forge', 'execution.json'))).toBe(false);
  });

  it('reads the execution as it is now, writes what fn returns and releases the lock', () => {
    seedExecution(root, e());
    expect(updateExecution(root, cur => cur && { ...cur, parallel: 2 }, { now })?.parallel).toBe(2);
    expect(readExecution(root)?.parallel).toBe(2);
    expect(existsSync(executionLock(root))).toBe(false);
    expect(updateExecution(root, () => null, { now })).toBeNull();
    expect(readExecution(root)?.parallel).toBe(2);
  });
  it('releases the lock when fn throws', () => {
    seedExecution(root, e());
    expect(() => updateExecution(root, () => { throw new Error('boom'); }, { now })).toThrow('boom');
    expect(existsSync(executionLock(root))).toBe(false);
  });
  it('waits for a lock a live process holds and goes on once it is released', () => {
    seedExecution(root, e());
    lock({ pid: process.pid, at: T });
    let waits = 0;
    const sleep = () => { waits++; if (waits === 3) rmSync(executionLock(root)); };
    updateExecution(root, cur => cur && { ...cur, parallel: 1 }, { now, sleep });
    expect(waits).toBe(3);
    expect(readExecution(root)?.parallel).toBe(1);
  });
  it('takes over a lock whose pid died, one older than 30 s and one left empty that long (Review Focus 1)', () => {
    seedExecution(root, e());
    let waits = 0;
    const sleep = () => { waits++; };
    lock({ pid: deadPid(), at: T });
    updateExecution(root, cur => cur, { now, sleep });
    lock({ pid: process.pid, at: new Date(Date.parse(T) - LOCK_STALE_MS).toISOString() });
    updateExecution(root, cur => cur, { now, sleep });
    lock('');
    updateExecution(root, cur => cur, { now: () => new Date(Date.now() + LOCK_STALE_MS + 1000), sleep });
    expect(waits).toBe(0);
    expect(existsSync(executionLock(root))).toBe(false);
  });
  it('gives up after 10 s of a live lock with a usage error that names its pid; the CLI exits 2 and writes nothing', () => {
    seedExecution(root, e());
    const before = readFileSync(executionFile(root), 'utf8');
    lock({ pid: process.pid, at: T });
    let waits = 0;
    expect(() => updateExecution(root, cur => cur && { ...cur, parallel: 1 }, { now, sleep: () => { waits++; } })).toThrow(`execution.json is locked by ${process.pid}`);
    expect(waits).toBe(200);
    expect(run(['swarm', 'stop'], { cwd: root, now, sleep: () => undefined, env: {} })).toMatchObject({ code: 2, stderr: `execution.json is locked by ${process.pid}\n` });
    expect(readFileSync(executionFile(root), 'utf8')).toBe(before);
  });
  it('a stale lock that changed since it was read is not removed: the new holder keeps it and the caller waits for it', () => {
    seedExecution(root, e());
    lock({ pid: 999_999_991, at: T });
    const fresher = JSON.stringify({ pid: 999_999_992, at: T });
    let waits = 0;
    // Between the read and the takeover another process took the lock over (alive() is asked in between).
    const alive = (pid: number) => { if (pid === 999_999_991) { lock(fresher); return false; } return true; };
    const sleep = () => { waits++; expect(readFileSync(executionLock(root), 'utf8')).toBe(fresher); rmSync(executionLock(root)); };
    updateExecution(root, cur => cur && { ...cur, parallel: 1 }, { now, sleep, alive });
    expect(waits).toBe(1);
    expect(readExecution(root)?.parallel).toBe(1);
  });
  it('a takeover is serialized by execution.lock.takeover: while another process holds it the lock is not removed; one left behind 30 s is cleared', () => {
    seedExecution(root, e());
    const gate = `${executionLock(root)}.takeover`;
    lock({ pid: 999_999_991, at: T });
    writeFileSync(gate, JSON.stringify({ pid: 999_999_993, at: T }));
    let waits = 0;
    const sleep = () => { waits++; expect(existsSync(executionLock(root))).toBe(true); if (waits === 2) rmSync(gate); };
    updateExecution(root, cur => cur && { ...cur, parallel: 1 }, { now, sleep, alive: () => false });
    expect(waits).toBe(2);
    expect(existsSync(gate)).toBe(false);
    lock({ pid: 999_999_991, at: T });
    writeFileSync(gate, JSON.stringify({ pid: 999_999_993, at: new Date(Date.parse(T) - LOCK_STALE_MS - 1000).toISOString() }));
    updateExecution(root, cur => cur, { now, sleep: () => { throw new Error('no wait'); }, alive: () => false });
    expect(existsSync(gate)).toBe(false);
    expect(existsSync(executionLock(root))).toBe(false);
  });
  it('releases only its own lock: one another process took over meanwhile stays', () => {
    seedExecution(root, e());
    const other = JSON.stringify({ pid: 999_999_994, at: T });
    updateExecution(root, cur => { lock(other); return cur; }, { now });
    expect(readFileSync(executionLock(root), 'utf8')).toBe(other);
  });
  it('waitMs bounds the wait for a live lock (the Stop hook waits about 2 s)', () => {
    seedExecution(root, e());
    lock({ pid: process.pid, at: T });
    let waits = 0;
    expect(() => updateExecution(root, cur => cur, { now, sleep: () => { waits++; }, waitMs: 2000 })).toThrow(`execution.json is locked by ${process.pid}`);
    expect(waits).toBe(40);
  });
  it('the one-time swarm.json migration never overwrites an execution.json written meanwhile', () => {
    expect(createIfAbsent(executionFile(root), '{"a":1}\n')).toBe(true);
    expect(createIfAbsent(executionFile(root), '{"b":2}\n')).toBe(false);
    expect(readFileSync(executionFile(root), 'utf8')).toBe('{"a":1}\n');
    expect(readdirSync(path.join(root, '.forge')).filter(f => f.includes('.tmp'))).toEqual([]);
  });
  it('the raw writer of execution.json is private to src/forge/execution.ts: not exported, and no other file of src/ or tests/ names it (I-15)', async () => {
    const name = 'save' + 'Execution';
    expect(Object.keys(await import('../src/forge/execution.js'))).not.toContain(name);
    const repo = fileURLToPath(new URL('..', import.meta.url));
    const walk = (dir: string): string[] => readdirSync(dir).flatMap(n => {
      const p = path.join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
    const own = path.join(repo, 'src', 'forge', 'execution.ts');
    const named = ['src', 'tests'].flatMap(d => walk(path.join(repo, d)))
      .filter(f => /\.(ts|tsx|mts|mjs)$/.test(f) && f !== own && readFileSync(f, 'utf8').includes(name))
      .map(f => path.relative(repo, f).split(path.sep).join('/'));
    expect(named).toEqual([]);
  });
});
