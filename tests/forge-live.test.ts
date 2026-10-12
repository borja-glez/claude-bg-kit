import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run, defaultGit, type Io } from '../src/forge/cli/run.js';
import { nextLive, liveFile } from '../src/forge/live.js';
import { saveExecution, readExecution } from '../src/forge/execution.js';
import { writeMember } from '../src/forge/members.js';

const T = '2026-10-12T12:00:00.000Z';
describe('nextLive', () => {
  const ctx = { sessionId: 's1', role: 'coordinator' as const, runId: 'r1', task: null, now: T };
  it('tracks subagents and the end of the session', () => {
    let d = nextLive(null, { event: 'SessionStart' }, ctx);
    expect(d).toMatchObject({ sessionId: 's1', role: 'coordinator', runId: 'r1', ended: false, agents: [] });
    d = nextLive(d, { event: 'SubagentStart', agentId: 'a1', agentType: 'forge:forge-impl' }, ctx);
    d = nextLive(d, { event: 'SubagentStart', agentId: 'a1', agentType: 'forge:forge-impl' }, ctx);
    expect(d.agents).toEqual([{ id: 'a1', type: 'forge:forge-impl', since: T }]);
    d = nextLive(d, { event: 'SubagentStop', agentId: 'a1' }, ctx);
    expect(d.agents).toEqual([]);
    d = nextLive(d, { event: 'SessionEnd' }, ctx);
    expect(d).toMatchObject({ ended: true, event: 'SessionEnd' });
  });
  it('drops agents older than 3 hours on the next event', () => {
    const old = nextLive(null, { event: 'SubagentStart', agentId: 'a1', agentType: 't' }, { ...ctx, now: '2026-10-12T08:00:00.000Z' });
    expect(old.agents).toHaveLength(1);
    expect(nextLive(old, { event: 'Stop' }, ctx).agents).toEqual([]);
  });
});

describe('forge hook live', () => {
  let root: string; let io: Io;
  const git = (...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'forge-live-'));
    git('init', '-q', '-b', 'main'); git('config', 'user.email', 'a@b.c'); git('config', 'user.name', 't');
    writeFileSync(path.join(root, 'x.txt'), 'x'); git('add', '.'); git('commit', '-qm', 'init');
    mkdirSync(path.join(root, '.forge'), { recursive: true });
    io = { cwd: root, now: () => new Date(T), git: defaultGit(root) };
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));
  const hook = (input: object) => run(['hook', 'live'], { ...io, stdin: JSON.stringify(input) });
  const exec = (over: object = {}) => saveExecution(root, {
    runId: 'r1', kind: 'plan', mode: 'subagents', parallel: 3, project: 'shop', base: 'main', branch: 'forge/run-shop', mergeOnFinish: false,
    coordinator: 'main', hookSession: 's1', active: true, stopReason: null, stallReason: null, startedAt: T, lastStepAt: null, lastBlockStep: null, sleepUntil: null, tasks: {}, ...over,
  });
  it('writes nothing without an active execution, or for another session', () => {
    expect(hook({ session_id: 's1', hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'x' }).stdout).toBe('');
    expect(existsSync(liveFile(root, 's1'))).toBe(false);
    exec();
    hook({ session_id: 's2', hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'x' });
    expect(existsSync(liveFile(root, 's2'))).toBe(false);
  });
  it('records the coordinator signal, and the Stop hook refreshes it', () => {
    exec();
    hook({ session_id: 's1', hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'forge:forge-impl' });
    expect(JSON.parse(readFileSync(liveFile(root, 's1'), 'utf8'))).toMatchObject({ role: 'coordinator', runId: 'r1', agents: [{ id: 'a1' }] });
    run(['hook', 'stop'], { ...io, now: () => new Date('2026-10-12T12:03:00.000Z'), stdin: JSON.stringify({ session_id: 's1' }) });
    expect(JSON.parse(readFileSync(liveFile(root, 's1'), 'utf8'))).toMatchObject({ event: 'Stop', ts: '2026-10-12T12:03:00.000Z' });
  });
  const runningTask = { T1: { status: 'running', stage: 'implement', round: 1, worktree: '/w', branch: 'task/T1', executor: 'subagents', attempts: 0, agent: 'forge-impl', startedAt: T, stageSince: T, updatedAt: T, detail: null } };
  it('a Stop while unbound and with an agent running binds the session and writes the signal', () => {
    exec({ hookSession: null, tasks: runningTask });
    expect(run(['hook', 'stop'], { ...io, stdin: JSON.stringify({ session_id: 's1' }) }).stdout).toBe('');
    expect(readExecution(root)?.hookSession).toBe('s1');
    expect(JSON.parse(readFileSync(liveFile(root, 's1'), 'utf8'))).toMatchObject({ role: 'coordinator', runId: 'r1', event: 'Stop' });
  });
  it('a SubagentStart while unbound binds the session and the signal lists the agent', () => {
    exec({ hookSession: null });
    hook({ session_id: 's1', hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'forge:forge-impl' });
    expect(readExecution(root)?.hookSession).toBe('s1');
    expect(JSON.parse(readFileSync(liveFile(root, 's1'), 'utf8'))).toMatchObject({ agents: [{ id: 'a1', type: 'forge:forge-impl' }] });
  });
  it('a SubagentStart from another session never rebinds a bound execution', () => {
    exec({ hookSession: 's1' });
    hook({ session_id: 's2', hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'x' });
    expect(readExecution(root)?.hookSession).toBe('s1');
    expect(existsSync(liveFile(root, 's2'))).toBe(false);
    expect(existsSync(liveFile(root, 's1'))).toBe(false);
  });
  it('writes into the main checkout from a linked worktree, under the ignored forge dir', () => {
    exec();
    const wt = path.join(root, '.claude', 'worktrees', 'w');
    git('worktree', 'add', '-q', wt, '-b', 'w');
    run(['hook', 'live'], { ...io, cwd: wt, git: defaultGit(wt), stdin: JSON.stringify({ session_id: 's1', hook_event_name: 'SessionStart' }) });
    expect(existsSync(liveFile(root, 's1'))).toBe(true);
    expect(existsSync(path.join(wt, '.forge', 'live', 's1.json'))).toBe(false);
    expect(existsSync(path.join(root, '.forge', '.gitignore'))).toBe(true);
  });
  it('records executor and manual members of the run with their role and task', () => {
    exec();
    writeMember(root, { sessionId: 's2', role: 'executor', runId: 'r1', task: 'T002', name: 'wp-shop-T002', since: T });
    writeMember(root, { sessionId: 's3', role: 'manual', runId: 'r1', task: null, name: null, since: T });
    writeMember(root, { sessionId: 's4', role: 'manual', runId: 'old-run', task: null, name: null, since: T });
    hook({ session_id: 's2', hook_event_name: 'SessionStart' });
    hook({ session_id: 's3', hook_event_name: 'SubagentStart', agent_id: 'a9', agent_type: 'forge:forge-mech' });
    hook({ session_id: 's4', hook_event_name: 'SessionStart' });
    expect(JSON.parse(readFileSync(liveFile(root, 's2'), 'utf8'))).toMatchObject({ role: 'executor', runId: 'r1', task: 'T002' });
    expect(JSON.parse(readFileSync(liveFile(root, 's3'), 'utf8'))).toMatchObject({ role: 'manual', task: null, agents: [{ id: 'a9' }] });
    expect(existsSync(liveFile(root, 's4'))).toBe(false);
    expect(readExecution(root)?.hookSession).toBe('s1');
  });
  it('a member Stop hook writes its signal and never blocks', () => {
    exec({ tasks: runningTask });
    writeMember(root, { sessionId: 's2', role: 'executor', runId: 'r1', task: 'T1', name: null, since: T });
    expect(run(['hook', 'stop'], { ...io, stdin: JSON.stringify({ session_id: 's2' }) }).stdout).toBe('');
    expect(JSON.parse(readFileSync(liveFile(root, 's2'), 'utf8'))).toMatchObject({ role: 'executor', event: 'Stop' });
  });
  it('the Stop hook from a linked worktree reads and saves the execution in the main checkout', () => {
    exec({ hookSession: null, tasks: runningTask });
    const wt = path.join(root, '.claude', 'worktrees', 'run');
    git('worktree', 'add', '-q', wt, '-b', 'forge/run-shop');
    run(['hook', 'stop'], { ...io, cwd: wt, git: defaultGit(wt), stdin: JSON.stringify({ session_id: 's1' }) });
    expect(readExecution(root)?.hookSession).toBe('s1');
    expect(existsSync(path.join(wt, '.forge', 'execution.json'))).toBe(false);
    expect(existsSync(liveFile(root, 's1'))).toBe(true);
  });
  it('fails open on junk input', () => {
    exec();
    expect(run(['hook', 'live'], { ...io, stdin: '{oops' })).toMatchObject({ code: 0, stdout: '' });
  });
});
