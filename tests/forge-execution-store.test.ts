import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readExecution, saveExecution, executionFile, writePublicTask, executionTaskFile, runBranch, taskBranch, runWorktree, taskWorktree } from '../src/forge/execution.js';

let root: string;
beforeEach(() => { root = mkdtempSync(path.join(tmpdir(), 'forge-exec-')); mkdirSync(path.join(root, '.forge')); });
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
    saveExecution(root, { ...e, tasks: {} });
    expect(readExecution(root)).toEqual({ ...e, tasks: {} });
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
