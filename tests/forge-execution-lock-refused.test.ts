// I-15: on Windows, creating .forge/execution.lock while another process removes it (its release, or a stale takeover)
// fails with EPERM, not EEXIST: the name is delete-pending until the remove completes. node:fs is mocked in this file
// only, so the 'wx' create of the lock can be refused the way that race refuses it.
import { describe, it, expect, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { executionFile, executionLock, readExecution, updateExecution, LOCK_RETRY_MS } from '../src/forge/execution.js';
import type { ExecutionState } from '../src/lib/execution-state.js';
import { seedExecution } from './helpers/execution.js';
import { useTempDirs } from './helpers/tmp.js';

// The setup file loads trust.ts, which (6b-2) imports execution.ts through autonomous.ts: drop that cached copy so this
// file's own import of it meets the node:fs mock below (vitest does not mock a module a setup file imported).
vi.hoisted(() => { vi.resetModules(); });
const refuse = vi.hoisted(() => ({ left: 0, code: 'EPERM', calls: 0 }));
vi.mock('node:fs', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs')>();
  const openSync = ((file: import('node:fs').PathLike, flags?: import('node:fs').OpenMode, mode?: import('node:fs').Mode) => {
    if (flags === 'wx' && String(file).endsWith('execution.lock')) {
      refuse.calls++;
      if (refuse.left > 0) {
        refuse.left--;
        throw Object.assign(new Error(`${refuse.code}: operation not permitted, open '${String(file)}'`), { code: refuse.code, syscall: 'open' });
      }
    }
    return fs.openSync(file, flags ?? 'r', mode);
  }) as typeof fs.openSync;
  return { ...fs, openSync, default: { ...fs, openSync } };
});

const tmp = useTempDirs();
const T = '2026-10-12T12:00:00.000Z';
const execution = (): ExecutionState => ({
  runId: 'r1', kind: 'plan', mode: 'subagents', parallel: 3, project: 'shop', base: 'main', branch: 'forge/run-shop', mergeOnFinish: false,
  coordinator: 'main', hookSession: null, active: true, stopReason: null, stallReason: null, startedAt: T, lastStepAt: null,
  lastBlockStep: null, sleepUntil: null, closedAt: null, closedBy: null, tasks: {},
});
const now = () => new Date(T);
const seeded = () => {
  const root = tmp('forge-lock-refused-');
  Object.assign(refuse, { left: 0, code: 'EPERM', calls: 0 });
  seedExecution(root, execution());
  return root;
};

describe('a create of execution.lock refused while another process removes it (I-15)', () => {
  it('EPERM, EACCES or EBUSY is a busy lock: waited for like one that exists, and the update lands', () => {
    for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
      const root = seeded();
      Object.assign(refuse, { left: 2, code, calls: 0 });
      const waits: number[] = [];
      expect(updateExecution(root, cur => cur && { ...cur, parallel: 1 }, { now, sleep: ms => { waits.push(ms); } })?.parallel, code).toBe(1);
      expect(refuse.calls, code).toBe(3);
      expect(waits, code).toEqual([LOCK_RETRY_MS, LOCK_RETRY_MS]);
      expect(readExecution(root)?.parallel, code).toBe(1);
      expect(existsSync(executionLock(root)), code).toBe(false);
    }
  });
  it('a refusal that lasts the whole wait throws as it is, never as a lock someone holds, and writes nothing', () => {
    const root = seeded();
    const before = readFileSync(executionFile(root), 'utf8');
    Object.assign(refuse, { left: Infinity, code: 'EACCES', calls: 0 });
    let waits = 0;
    expect(() => updateExecution(root, cur => cur && { ...cur, parallel: 1 }, { now, sleep: () => { waits++; } })).toThrow(/^EACCES/);
    expect(waits).toBe(200);
    expect(readFileSync(executionFile(root), 'utf8')).toBe(before);
  });
  it('any other error of the create throws at once', () => {
    const root = seeded();
    Object.assign(refuse, { left: 1, code: 'ENOSPC', calls: 0 });
    let waits = 0;
    expect(() => updateExecution(root, cur => cur, { now, sleep: () => { waits++; } })).toThrow(/ENOSPC/);
    expect(waits).toBe(0);
  });
});
