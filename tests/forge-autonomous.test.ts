import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { startRun, saveRun, runFile, endRun, parseRun, readRunText } from '../src/forge/run.js';
import { run } from '../src/forge/cli/run.js';
import { runWorktree, taskWorktree, executionFile } from '../src/forge/execution.js';
import { writeMember } from '../src/forge/members.js';
import { runTmp } from '../src/forge/resources.js';
import { autonomousFor, autonomousRun, INVALID_RUN } from '../src/forge/autonomous.js';
import type { ExecutionState } from '../src/lib/execution-state.js';
import { seedExecution } from './helpers/execution.js';
import { useTempDirs } from './helpers/tmp.js';

const tmp = useTempDirs();
const T0 = new Date('2026-10-22T10:00:00.000Z');
let main: string, wt: string;
const auto = () => ({ profile: 'spike' as const, name: 'x', runId: 'spike-x', worktree: wt, branch: 'forge/spike-x', startBranch: 'main', protectedBranches: ['main'] });
const ex = (over: Partial<ExecutionState> = {}): ExecutionState => ({
  runId: 'x-2026-10-22T100000000Z', kind: 'plan', mode: 'subagents', parallel: 3, project: 'x', base: 'forge/spike-x', branch: 'forge/run-x', mergeOnFinish: true,
  coordinator: 'main', hookSession: 'coord-1', active: true, stopReason: null, stallReason: null, startedAt: T0.toISOString(),
  lastStepAt: null, lastBlockStep: null, sleepUntil: null, tasks: {}, ...over,
});
const task = (id: string) => ({ status: 'running' as const, stage: 'implement' as const, round: 1, worktree: taskWorktree(main, id), branch: `task/${id}`, executor: 'subagents' as const,
  attempts: 0, agent: null, startedAt: T0.toISOString(), stageSince: T0.toISOString(), updatedAt: T0.toISOString(), detail: null });
beforeEach(() => {
  main = tmp('auto-');
  wt = path.join(main, '.claude', 'worktrees', 'spike-x');
  mkdirSync(wt, { recursive: true });
  mkdirSync(path.join(main, '.forge'), { recursive: true });
});

describe('autonomousFor', () => {
  it('is null without run.json or with a run that is not autonomous', () => {
    expect(autonomousFor(main, { session_id: 'coord-1' })).toBeNull();
    saveRun(main, startRun(T0, { hours: 1 }, 10, 'coord-1'));
    expect(autonomousFor(main, { session_id: 'coord-1' })).toBeNull();
  });
  it('an inactive autonomous run keeps its sessions by id, not by cwd, and autonomousRun gives only an active one (H2)', () => {
    saveRun(main, { ...startRun(T0, { hours: 1 }, 10, 'coord-1'), active: false, autonomous: auto() });
    expect(autonomousFor(main, { session_id: 'coord-1' })).not.toBeNull();
    expect(autonomousFor(main, { session_id: 'x', cwd: path.join(wt, 'src') })).toBeNull();
    expect(autonomousRun(main)).toBeNull();
  });
  it('finds the coordinator by its session id, with the worktree, the run\'s temp folder and the scratchpad as roots', () => {
    saveRun(main, { ...startRun(T0, { hours: 1 }, 10, 'coord-1'), autonomous: auto() });
    const scratch = path.join(main, 'scratch');
    const a = autonomousFor(main, { session_id: 'coord-1', scratchpad_dir: scratch })!;
    expect(a).toMatchObject({ runId: 'spike-x', main, worktree: wt, branch: 'forge/spike-x', protectedBranches: ['main'], tmp: runTmp('spike-x'), branches: ['forge/spike-x'], resources: [] });
    expect(a.roots).toEqual([wt, runTmp('spike-x'), scratch]);
  });
  it('takes in the execution the coordinator started: its worktrees, its branches and its members by their hook id', () => {
    saveRun(main, { ...startRun(T0, { hours: 1 }, 10, 'coord-1'), autonomous: auto() });
    seedExecution(main, ex({ tasks: { T001: task('T001') } }));
    writeMember(main, { sessionId: 'm-sid', role: 'executor', runId: ex().runId, task: 'T001', name: null, since: T0.toISOString(), hookSession: 'member-1' });
    const a = autonomousFor(main, { session_id: 'member-1' })!;
    expect(a.roots).toEqual(expect.arrayContaining([runWorktree(main), taskWorktree(main, 'T001')]));
    expect(a.branches).toEqual(['forge/spike-x', 'forge/run-x', 'task/T001']);
    const r = autonomousRun(main)!;
    expect(r.ids).toEqual(['coord-1', 'member-1']);
    expect(r.dirs).toEqual([wt, runWorktree(main), taskWorktree(main, 'T001')]);
  });
  it('an execution another session started is not the run\'s: neither its worktrees nor its members count', () => {
    saveRun(main, { ...startRun(T0, { hours: 1 }, 10, 'coord-1'), autonomous: auto() });
    seedExecution(main, ex({ hookSession: 'someone-else', tasks: { T001: task('T001') } }));
    writeMember(main, { sessionId: 'm-sid', role: 'executor', runId: ex().runId, task: 'T001', name: null, since: T0.toISOString(), hookSession: 'member-1' });
    expect(autonomousFor(main, { session_id: 'member-1' })).toBeNull();
    expect(autonomousFor(main, { session_id: 'coord-1' })!.roots).not.toContain(runWorktree(main));
  });
  it('a session working inside the worktree belongs, whatever its id; one in the main checkout or another worktree does not', () => {
    saveRun(main, { ...startRun(T0, { hours: 1 }, 10, 'coord-1'), autonomous: auto() });
    expect(autonomousFor(main, { session_id: 'sub-agent', cwd: path.join(wt, 'src') })).not.toBeNull();
    expect(autonomousFor(main, { session_id: 'person', cwd: main })).toBeNull();
    expect(autonomousFor(main, { session_id: 'person', cwd: path.join(main, '.claude', 'worktrees', 'audit') })).toBeNull();
  });
  it('fails closed for the coordinator, its execution\'s members and the sessions in .claude/worktrees when the autonomous block does not read (M6)', () => {
    writeFileSync(runFile(main), JSON.stringify({ ...startRun(T0, { hours: 1 }, 10, 'coord-1'), autonomous: { profile: 'nope' } }));
    seedExecution(main, ex({ tasks: { T001: task('T001') } }));
    writeMember(main, { sessionId: 'm-sid', role: 'executor', runId: ex().runId, task: 'T001', name: null, since: T0.toISOString(), hookSession: 'member-1' });
    const closed = { runId: INVALID_RUN, main, worktree: '', roots: [], tmp: '', branch: '', protectedBranches: ['main'], branches: [], resources: [] };
    expect(autonomousFor(main, { session_id: 'coord-1' })).toEqual(closed);
    expect(autonomousFor(main, { session_id: 'member-1' })).toEqual(closed);
    expect(autonomousFor(main, { session_id: 'sub', cwd: path.join(wt, 'src') })).toEqual(closed);
    expect(autonomousFor(main, { session_id: 'person', cwd: main })).toBeNull();
  });
  it('a run.json that does not read fails closed only where an autonomous run can be (M6)', () => {
    writeFileSync(runFile(main), '{"active": true, "autonomous": {"profile"');
    expect(autonomousFor(main, { session_id: 'sub', cwd: wt })).toMatchObject({ runId: INVALID_RUN });
    expect(autonomousFor(main, { session_id: 'person', cwd: main })).toBeNull();
    writeFileSync(runFile(main), 'not json');
    expect(autonomousFor(main, { session_id: 'sub', cwd: wt })).toBeNull();
  });
  it('an execution.json that does not read still counts its worktrees for the sessions in them (M6)', () => {
    saveRun(main, { ...startRun(T0, { hours: 1 }, 10, 'coord-1'), autonomous: auto() });
    seedExecution(main, ex({ tasks: { T001: task('T001') } }));
    writeFileSync(executionFile(main), 'not json');
    expect(autonomousFor(main, { session_id: 'member-1', cwd: taskWorktree(main, 'T001') })).not.toBeNull();
    expect(autonomousFor(main, { session_id: 'coord-1' })!.roots).not.toContain(taskWorktree(main, 'T001'));
  });
  it('a sibling worktree with the same prefix is not inside the run\'s worktree', () => {
    saveRun(main, { ...startRun(T0, { hours: 1 }, 10, 'coord-1'), autonomous: auto() });
    expect(autonomousFor(main, { session_id: 'person', cwd: `${wt}2` })).toBeNull();
    expect(autonomousFor(main, { session_id: 'person', cwd: path.join(wt, '..', '..', '..') })).toBeNull();
  });
});

describe('autonomousFor only reads, and its fail-closed paths hold (fix round 1)', () => {
  const member = (hook: string) => writeMember(main, { sessionId: `sid-${hook}`, role: 'executor', runId: ex().runId, task: 'T001', name: null, since: T0.toISOString(), hookSession: hook });
  it('writes nothing for a main with only a legacy swarm.json, and the coordinator still belongs', () => {
    saveRun(main, { ...startRun(T0, { hours: 1 }, 10, 'coord-1'), autonomous: auto() });
    writeFileSync(path.join(main, '.forge', 'swarm.json'), JSON.stringify({
      active: true, parallel: 5, mergeAuthorized: false, project: 'shop', base: 'main', coordinator: 'main', hookSession: 'coord-1',
      startedAt: T0.toISOString(), lastTickAt: T0.toISOString(), lastBlockTick: null, sleepUntil: null, stopReason: null, stallReason: null, notice: null, fronts: {},
    }));
    const before = readdirSync(path.join(main, '.forge')).sort();
    expect(autonomousFor(main, { session_id: 'coord-1' })).not.toBeNull();
    expect(autonomousRun(main)).not.toBeNull();
    expect(readdirSync(path.join(main, '.forge')).sort()).toEqual(before);
  });
  it('reads an autonomous key written with a JSON escape', () => {
    const text = JSON.stringify({ ...startRun(T0, { hours: 1 }, 10, 'coord-1'), autonomous: auto() }).replace('"autonomous"', '"autonom\\u006fus"');
    expect(text).not.toContain('"autonomous"');
    writeFileSync(runFile(main), text);
    expect(autonomousFor(main, { session_id: 'coord-1' })).not.toBeNull();
  });
  it.runIf(process.platform === 'win32')('a task folder is matched without case on Windows when execution.json does not read', () => {
    saveRun(main, { ...startRun(T0, { hours: 1 }, 10, 'coord-1'), autonomous: auto() });
    writeFileSync(executionFile(main), 'not json');
    expect(autonomousFor(main, { session_id: 'x', cwd: path.join(main, '.claude', 'worktrees', 'TASK-T001') })).not.toBeNull();
  });
  it('an execution with closedAt is not the run\'s', () => {
    saveRun(main, { ...startRun(T0, { hours: 1 }, 10, 'coord-1'), autonomous: auto() });
    seedExecution(main, ex({ closedAt: T0.toISOString(), closedBy: 'close', tasks: { T001: task('T001') } }));
    member('member-1');
    expect(autonomousFor(main, { session_id: 'member-1' })).toBeNull();
    expect(autonomousFor(main, { session_id: 'x', cwd: taskWorktree(main, 'T001') })).toBeNull();
    expect(autonomousFor(main, { session_id: 'coord-1' })!.roots).toEqual([wt, runTmp('spike-x')]);
  });
  it('a relative scratchpad is not a root', () => {
    saveRun(main, { ...startRun(T0, { hours: 1 }, 10, 'coord-1'), autonomous: auto() });
    expect(autonomousFor(main, { session_id: 'coord-1', scratchpad_dir: 'scratch' })!.roots).toEqual([wt, runTmp('spike-x')]);
  });
  it('with an invalid block, a member of another session\'s execution gets null unless its cwd is under .claude/worktrees', () => {
    writeFileSync(runFile(main), JSON.stringify({ ...startRun(T0, { hours: 1 }, 10, 'coord-1'), autonomous: { profile: 'nope' } }));
    seedExecution(main, ex({ hookSession: 'someone-else', tasks: { T001: task('T001') } }));
    member('member-1');
    expect(autonomousFor(main, { session_id: 'member-1', cwd: main })).toBeNull();
    expect(autonomousFor(main, { session_id: 'member-1', cwd: wt })).toMatchObject({ runId: INVALID_RUN });
  });
  it('autonomousRun lists the run worktree among its dirs when execution.json does not read', () => {
    saveRun(main, { ...startRun(T0, { hours: 1 }, 10, 'coord-1'), autonomous: auto() });
    writeFileSync(executionFile(main), 'not json');
    expect(autonomousRun(main)!.dirs).toContain(runWorktree(main));
  });
  it('ids has no duplicate when the execution\'s hookSession is the run\'s sessionId', () => {
    saveRun(main, { ...startRun(T0, { hours: 1 }, 10, 'coord-1'), autonomous: auto() });
    seedExecution(main, ex());
    member('coord-1');
    expect(autonomousRun(main)!.ids).toEqual(['coord-1']);
  });
});

describe('stopping an autonomous run keeps its block, so the conversation stays guarded', () => {
  it('FORGE stop leaves the autonomous block in run.json and the coordinator still belongs', () => {
    saveRun(main, { ...startRun(T0, { hours: 1 }, 10, 'coord-1'), autonomous: auto() });
    run(['stop'], { cwd: main, now: () => T0, env: {} });
    const after = parseRun(readRunText(main));
    expect(after?.active).toBe(false);
    expect(after?.autonomous).toEqual(auto());
    expect(autonomousFor(main, { session_id: 'coord-1' })).not.toBeNull();
  });
  it('the budget end keeps the block through a parseRun round trip and the coordinator still belongs', () => {
    saveRun(main, endRun({ ...startRun(T0, { hours: 1 }, 10, 'coord-1'), autonomous: auto() }, 'budget'));
    const after = parseRun(readRunText(main));
    expect(after?.active).toBe(false);
    expect(after?.autonomous).toEqual(auto());
    expect(autonomousFor(main, { session_id: 'coord-1' })).not.toBeNull();
  });
});
