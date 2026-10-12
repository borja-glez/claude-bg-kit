import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run, defaultGit, type Io } from '../src/forge/cli/run.js';
import { readExecution, saveExecution, executionTaskFile } from '../src/forge/execution.js';
import { normalizeExecution } from '../src/lib/execution-state.js';
import { setupFor } from '../src/forge/cli/swarm.js';
import { writeMember } from '../src/forge/members.js';

const PLAN = `project: shop
locale: es
version: "1"
artifacts: {}
versions: []
tracks:
  - { id: a, name: A, color: blue }
phases:
  - { id: p1, name: P1, plan_status: committed }
tasks:
  - { id: T1, title: T1, track: a, phase: p1, done_when: x, depends_on: [], zones: [src/t1/**] }
  - { id: T2, title: T2, track: a, phase: p1, done_when: x, depends_on: [], zones: [src/t2/**] }
  - { id: T3, title: T3, track: a, phase: p1, done_when: x, depends_on: [T1], zones: [src/t3/**] }
`;
let root: string;
let io: Io;
const NOW = new Date('2026-10-12T12:00:00.000Z');
const git = (...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
const out = (r: { stdout: string; code: number; stderr: string }) => { if (r.code !== 0) throw new Error(r.stderr); return JSON.parse(r.stdout); };

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'forge-exec-cli-'));
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 'a@b.c'); git('config', 'user.name', 't'); git('config', 'core.autocrlf', 'false');
  writeFileSync(path.join(root, 'plan.yaml'), PLAN);
  writeFileSync(path.join(root, '.gitignore'), '.forge/\n.claude/\n');
  git('add', '.'); git('commit', '-qm', 'init');
  mkdirSync(path.join(root, '.forge'), { recursive: true });
  writeFileSync(path.join(root, '.forge', 'config.yaml'), 'validators: []\n');
  io = { cwd: root, now: () => NOW, git: defaultGit(root), sleep: () => undefined };
});
afterEach(() => { try { git('worktree', 'prune'); } catch { /* ignore */ } rmSync(root, { recursive: true, force: true }); });
const writeDocs = (dir: string, docs: Record<string, unknown>) => {
  mkdirSync(dir, { recursive: true });
  for (const [id, d] of Object.entries(docs)) writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(d));
};

describe('forge swarm (execution)', () => {
  it('start creates the run branch in its own worktree and leaves the main checkout alone', () => {
    const e = out(run(['swarm', 'start', '--project', 'shop', '--session', 'main', '--merge-on-finish'], io));
    expect(e).toMatchObject({ active: true, mode: 'subagents', parallel: 3, base: 'main', branch: 'forge/run-shop', mergeOnFinish: true });
    expect(git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    expect(existsSync(path.join(root, '.claude', 'worktrees', 'run', 'plan.yaml'))).toBe(true);
    expect(execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: path.join(root, '.claude', 'worktrees', 'run'), encoding: 'utf8' }).trim()).toBe('forge/run-shop');
    // A second coordinator is refused while the first stepped less than 15 minutes ago.
    run(['swarm', 'tick', '--plan', 'plan.yaml', '--db', 'db'], { ...io });
    expect(run(['swarm', 'start', '--project', 'shop', '--session', 'other'], io).code).toBe(2);
  });
  it('start refuses the base branch, a branch checked out elsewhere and a branch that starts with a dash', () => {
    const base = run(['swarm', 'start', '--project', 'shop', '--session', 'main', '--branch', 'main'], io);
    expect(base.code).toBe(2);
    expect(base.stderr).toMatch(/main is the base branch/);
    git('branch', 'busy');
    git('worktree', 'add', path.join(root, '.claude', 'worktrees', 'other'), 'busy');
    const busy = run(['swarm', 'start', '--project', 'shop', '--session', 'main', '--branch', 'busy'], io);
    expect(busy.code).toBe(2);
    expect(busy.stderr).toMatch(/busy is checked out in another worktree/);
    expect(run(['swarm', 'start', '--project', 'shop', '--session', 'main', '--branch', '-x'], io).code).toBe(2);
    expect(readExecution(root)).toBeNull();
  });
  it('start refuses the default branch as the run branch', () => {
    git('switch', '-qc', 'work');
    const r = run(['swarm', 'start', '--project', 'shop', '--session', 'main', '--branch', 'main'], io);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('default branch');
  });
  it('start from a non-main base creates forge/run-<project> from it', () => {
    git('checkout', '-q', '-b', 'forge/infinite');
    writeFileSync(path.join(root, 'inf.txt'), 'x');
    git('add', 'inf.txt'); git('commit', '-qm', 'infinite work');
    const e = out(run(['swarm', 'start', '--project', 'shop', '--session', 'main', '--merge-on-finish'], io));
    expect(e).toMatchObject({ base: 'forge/infinite', branch: 'forge/run-shop', mergeOnFinish: true });
    expect(git('rev-parse', 'forge/run-shop')).toBe(git('rev-parse', 'forge/infinite'));
    expect(git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('forge/infinite');
  });
  it('start refuses an existing run worktree that is on another branch, naming it', () => {
    git('branch', 'stray');
    git('worktree', 'add', path.join(root, '.claude', 'worktrees', 'run'), 'stray');
    const r = run(['swarm', 'start', '--project', 'shop', '--session', 'main'], io);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/is on stray, not forge\/run-shop/);
  });
  it('propose recommends subagents with the real width, sequential when it is 1', () => {
    expect(out(run(['swarm', 'propose', '--plan', 'plan.yaml'], io))).toMatchObject({ width: 2, recommended: { mode: 'subagents', parallel: 2 }, configured: null });
  });
  it('tick starts tasks, worktree creates each from the run branch, task records the stage', () => {
    out(run(['swarm', 'start', '--project', 'shop', '--session', 'main'], io));
    writeDocs(path.join(root, 'db', 'state'), {});
    writeDocs(path.join(root, 'db', 'sessions'), {});
    const t = out(run(['swarm', 'tick', '--plan', 'plan.yaml', '--db', 'db'], io));
    expect(t.actions.filter((a: { type: string }) => a.type === 'start').map((a: { task: string }) => a.task)).toEqual(['T1', 'T2']);
    const w = out(run(['swarm', 'worktree', 'T1'], io));
    expect(w).toMatchObject({ branch: 'task/T1', worktree: path.join(root, '.claude', 'worktrees', 'task-T1') });
    expect(existsSync(path.join(w.worktree, 'plan.yaml'))).toBe(true);
    expect(readExecution(root)!.tasks.T1.worktree).toBe(w.worktree);
    out(run(['swarm', 'task', 'T1', '--stage', 'implement', '--agent', 'forge-impl', '--round', '1'], io));
    expect(readExecution(root)!.tasks.T1).toMatchObject({ stage: 'implement', agent: 'forge-impl', round: 1 });
    expect(JSON.parse(readFileSync(executionTaskFile(root, 'T1'), 'utf8'))).toMatchObject({ task: 'T1', stage: 'implement', agent: 'forge-impl', by: 'main', mode: 'subagents' });
    const before = readExecution(root)!.tasks.T1.stageSince;
    out(run(['swarm', 'task', 'T1', '--stage', 'implement', '--round', '2'], { ...io, now: () => new Date('2026-10-12T12:07:00.000Z') }));
    expect(readExecution(root)!.tasks.T1.stageSince).toBe(before);
    expect(JSON.parse(readFileSync(executionTaskFile(root, 'T1'), 'utf8')).since).toBe(before);
  });
  it('worktree runs swarm.setup in a new task worktree once and reports it', () => {
    writeFileSync(path.join(root, '.forge', 'config.yaml'), `validators: []\nswarm:\n  setup: node -e "require('fs').writeFileSync('setup-ran','1')"\n`);
    const s = out(run(['swarm', 'start', '--project', 'shop', '--session', 'main'], { ...io, exec: undefined }));
    expect(existsSync(path.join(root, '.claude', 'worktrees', 'run', 'setup-ran'))).toBe(true);
    expect(s.setup).toMatchObject({ ok: true });
    const w = out(run(['swarm', 'worktree', 'T1'], { ...io, exec: undefined }));
    expect(existsSync(path.join(w.worktree, 'setup-ran'))).toBe(true);
    expect(w.setup).toMatchObject({ cmd: `node -e "require('fs').writeFileSync('setup-ran','1')"`, ok: true });
    expect(Array.isArray(w.setup.tail)).toBe(true);
    rmSync(path.join(w.worktree, 'setup-ran'));
    const again = out(run(['swarm', 'worktree', 'T1'], { ...io, exec: undefined }));
    expect(again.setup).toBeNull();
    expect(existsSync(path.join(w.worktree, 'setup-ran'))).toBe(false);
  });
  it('setup: a lockfile picks the install command, a failure is reported, a .venv without setup asks for one', () => {
    out(run(['swarm', 'start', '--project', 'shop', '--session', 'main'], io));
    writeFileSync(path.join(root, '.forge', 'config.yaml'), 'validators: []\nswarm:\n  setup: node -e "process.exit(3)"\n');
    const failed = out(run(['swarm', 'worktree', 'T1'], { ...io, exec: undefined }));
    expect(failed.setup).toMatchObject({ ok: false });
    writeFileSync(path.join(root, '.forge', 'config.yaml'), 'validators: []\n');
    mkdirSync(path.join(root, '.venv'));
    const venv = out(run(['swarm', 'worktree', 'T2'], io));
    expect(venv.setup).toEqual({ cmd: null, ok: false, tail: ['python project: set swarm.setup in .forge/config.yaml to create the venv in each worktree'] });
    const files = (names: string[]) => ({ exists: (f: string) => names.includes(f), read: () => null, list: () => [] });
    expect(setupFor(files(['package-lock.json']), undefined)).toEqual({ cmd: 'npm ci' });
    expect(setupFor(files(['pnpm-lock.yaml']), undefined)).toEqual({ cmd: 'pnpm install --frozen-lockfile' });
    expect(setupFor(files(['yarn.lock']), undefined)).toEqual({ cmd: 'yarn install --frozen-lockfile' });
    expect(setupFor(files([]), undefined)).toBeNull();
    expect(setupFor(files(['package-lock.json', '.venv']), 'make deps')).toEqual({ cmd: 'make deps' });
  });
  it('task --drop forgets a task lost in a claim race, so the next tick leaves it to its owner', () => {
    out(run(['swarm', 'start', '--project', 'shop', '--session', 'main'], io));
    writeDocs(path.join(root, 'db', 'state'), {});
    writeDocs(path.join(root, 'db', 'sessions'), {});
    out(run(['swarm', 'tick', '--plan', 'plan.yaml', '--db', 'db'], io));
    out(run(['swarm', 'task', 'T1', '--stage', 'brief'], io));
    expect(existsSync(executionTaskFile(root, 'T1'))).toBe(true);
    expect(run(['swarm', 'task', 'T1', '--drop'], io).code).toBe(0);
    expect(readExecution(root)!.tasks.T1).toBeUndefined();
    expect(existsSync(executionTaskFile(root, 'T1'))).toBe(false);
    writeDocs(path.join(root, 'db', 'state'), { T1: { status: 'in_progress', owner: 'other', claimedAt: NOW.toISOString() } });
    writeDocs(path.join(root, 'db', 'sessions'), { other: { status: 'active', heartbeatAt: NOW.toISOString(), leaseUntil: new Date(NOW.getTime() + 600000).toISOString() } });
    const t = out(run(['swarm', 'tick', '--plan', 'plan.yaml', '--db', 'db'], io));
    expect(t.actions.filter((a: { type: string }) => a.type === 'start').map((a: { task: string }) => a.task)).not.toContain('T1');
    expect(readExecution(root)!.tasks.T1).toBeUndefined();
  });
  it('tick refuses without the state and sessions listings', () => {
    out(run(['swarm', 'start', '--project', 'shop', '--session', 'main'], io));
    expect(run(['swarm', 'tick', '--plan', 'plan.yaml', '--db', 'nope'], io).code).toBe(2);
  });
  it('retry puts a conflicting task back to implement and revives a stalled execution', () => {
    out(run(['swarm', 'start', '--project', 'shop', '--session', 'main'], io));
    out(run(['swarm', 'worktree', 'T1'], io));
    out(run(['swarm', 'task', 'T1', '--stage', 'integrate', '--status', 'blocked'], io));
    expect(run(['swarm', 'retry', 'T1'], io).code).toBe(0);
    expect(readExecution(root)!.tasks.T1).toMatchObject({ status: 'running', stage: 'implement', attempts: 1 });
  });
  it('stop marks the execution stopped; sleep --mark records sleepUntil', () => {
    out(run(['swarm', 'start', '--project', 'shop', '--session', 'main'], io));
    expect(run(['swarm', 'sleep', '300', '--mark'], io).code).toBe(0);
    expect(readExecution(root)!.sleepUntil).toBe('2026-10-12T12:05:00.000Z');
    expect(run(['swarm', 'stop'], io).code).toBe(0);
    expect(readExecution(root)).toMatchObject({ active: false, stopReason: 'stopped' });
  });
  it('sleep clears sleepUntil only when a newer sleep did not replace it', () => {
    out(run(['swarm', 'start', '--project', 'shop', '--session', 'main'], io));
    const newer = '2026-10-12T13:00:00.000Z';
    const overlap = () => { const e = readExecution(root)!; saveExecution(root, { ...e, sleepUntil: newer }); };
    expect(run(['swarm', 'sleep', '60'], { ...io, sleep: overlap }).code).toBe(0);
    expect(readExecution(root)!.sleepUntil).toBe(newer);
    expect(run(['swarm', 'sleep', '60'], io).code).toBe(0);
    expect(readExecution(root)!.sleepUntil).toBeNull();
  });
  it('propose caps the recommendation with swarm.parallel', () => {
    writeFileSync(path.join(root, '.forge', 'config.yaml'), 'validators: []\nswarm:\n  parallel: 1\n');
    expect(out(run(['swarm', 'propose', '--plan', 'plan.yaml'], io))).toMatchObject({ width: 2, recommended: { parallel: 1 } });
  });
  it('task ids follow the plan id rule', () => {
    out(run(['swarm', 'start', '--project', 'shop', '--session', 'main'], io));
    for (const bad of ['a:b', '..', 'a/b', 'x'.repeat(65)]) expect(run(['swarm', 'worktree', bad], io).code).toBe(2);
    for (const sub of ['task', 'retry', 'integrate']) expect(run(['swarm', sub, 'a:b'], io).code).toBe(2);
    expect(normalizeExecution({ ...readExecution(root)!, tasks: { 'a:b': { status: 'running', stage: 'brief', executor: 'subagents', worktree: '', branch: 'task/x', startedAt: NOW.toISOString() } } })!.tasks).toEqual({});
  });
  it('top-level forge stop ends an active execution and leaves the stop file', () => {
    out(run(['swarm', 'start', '--project', 'shop', '--session', 'main'], io));
    expect(run(['stop'], io).code).toBe(0);
    expect(readExecution(root)).toMatchObject({ active: false, stopReason: 'stopped' });
    expect(existsSync(path.join(root, '.forge', 'stop'))).toBe(true);
  });

  const sessionsRun = () => {
    out(run(['swarm', 'start', '--project', 'shop', '--session', 'main', '--mode', 'sessions'], io));
    writeDocs(path.join(root, 'db', 'state'), {});
    writeDocs(path.join(root, 'db', 'sessions'), {});
    out(run(['swarm', 'tick', '--plan', 'plan.yaml', '--db', 'db'], io));
  };
  it('tick reads member public files and the ListAgents snapshot', () => {
    sessionsRun();
    mkdirSync(path.dirname(executionTaskFile(root, 'T1')), { recursive: true });
    writeFileSync(executionTaskFile(root, 'T1'), JSON.stringify({ task: 'T1', runId: readExecution(root)!.runId, stage: 'review', status: 'running', agent: 'forge-review-perf', round: 1, since: NOW.toISOString(), updatedAt: NOW.toISOString(), leaseUntil: NOW.toISOString(), by: 'S2', mode: 'sessions' }));
    writeFileSync(path.join(root, 'agents.json'), JSON.stringify([{ name: 'wp-shop-T1', state: 'working' }, { bad: 1 }]));
    out(run(['swarm', 'tick', '--plan', 'plan.yaml', '--db', 'db', '--agents', 'agents.json'], io));
    expect(readExecution(root)!.tasks.T1).toMatchObject({ stage: 'review', agent: 'forge-review-perf' });
    writeFileSync(path.join(root, 'bad.json'), '{"x":1}');
    expect(run(['swarm', 'tick', '--plan', 'plan.yaml', '--db', 'db', '--agents', 'bad.json'], io).code).toBe(2);
  });
  it('relaunch counts the attempt, writes the handover note and blocks at the cap', () => {
    sessionsRun();
    const r = out(run(['swarm', 'relaunch', 'T1', '--plan', 'plan.yaml'], io));
    const e = readExecution(root)!;
    expect(r).toMatchObject({ task: 'T1', attempt: 1, launch: ['launch', 'plan.yaml', 'T1', '--task', '--run', e.runId, '--coordinator', 'main', '--base', 'forge/run-shop'] });
    expect(readFileSync(path.join(root, '.forge', 'work', 'T1', 'handover.md'), 'utf8')).toContain('# Handover: T1 (attempt 1 of 3)');
    expect(e.tasks.T1.attempts).toBe(1);
    out(run(['swarm', 'relaunch', 'T1', '--plan', 'plan.yaml'], io));
    expect(out(run(['swarm', 'relaunch', 'T1', '--plan', 'plan.yaml'], io))).toEqual({ task: 'T1', blocked: true, reason: 'the session of T1 stopped 3 times' });
    expect(readExecution(root)!.tasks.T1.status).toBe('blocked');
    expect(run(['swarm', 'relaunch', 'T1', '--plan', 'plan.yaml'], io).code).toBe(2);
  });
  it('nudge prints the fixed text in the plan language and records nudgedAt', () => {
    sessionsRun();
    expect(out(run(['swarm', 'nudge', 'T1', '--plan', 'plan.yaml'], io))).toEqual({ task: 'T1', name: 'wp-shop-T1', text: '[forge run] T1: continúa con brief; si estás bloqueado, márcalo como bloqueado' });
    expect(readExecution(root)!.tasks.T1.nudgedAt).toBe(NOW.toISOString());
  });
  it('relaunch resets startedAt and nudgedAt and the note lists commits on the task branch', () => {
    sessionsRun();
    const e0 = readExecution(root)!;
    saveExecution(root, { ...e0, tasks: { ...e0.tasks, T1: { ...e0.tasks.T1, startedAt: '2026-10-12T00:00:00.000Z', nudgedAt: '2026-10-12T01:00:00.000Z' } } });
    const tree = git('rev-parse', 'forge/run-shop^{tree}');
    const sha = git('commit-tree', tree, '-p', 'forge/run-shop', '-m', 'work on t1');
    git('branch', '-f', 'task/T1', sha);
    out(run(['swarm', 'relaunch', 'T1', '--plan', 'plan.yaml'], io));
    const t = readExecution(root)!.tasks.T1;
    expect(t.startedAt).toBe(NOW.toISOString());
    expect(t.nudgedAt ?? null).toBeNull();
    expect(readFileSync(path.join(root, '.forge', 'work', 'T1', 'handover.md'), 'utf8')).toContain('work on t1');
  });
  it('relaunch refuses a blocked and an accepted task', () => {
    sessionsRun();
    for (const status of ['blocked', 'accepted'] as const) {
      const e = readExecution(root)!;
      saveExecution(root, { ...e, tasks: { ...e.tasks, T1: { ...e.tasks.T1, status } } });
      expect(run(['swarm', 'relaunch', 'T1', '--plan', 'plan.yaml'], io).code).toBe(2);
    }
  });
  it('nudge and relaunch check the plan path and nudge saves nothing when it fails', () => {
    sessionsRun();
    expect(run(['swarm', 'nudge', 'T1', '--plan', 'missing.yaml'], io).code).toBe(2);
    expect(run(['swarm', 'nudge', 'T1', '--plan', '-x'], io).code).toBe(2);
    expect(run(['swarm', 'relaunch', 'T1', '--plan', 'missing.yaml'], io).code).toBe(2);
    expect(readExecution(root)!.tasks.T1.nudgedAt ?? null).toBeNull();
    expect(readExecution(root)!.tasks.T1.attempts).toBe(0);
  });
  it('relaunch and nudge refuse a subagents task', () => {
    out(run(['swarm', 'start', '--project', 'shop', '--session', 'main'], io));
    writeDocs(path.join(root, 'db', 'state'), {}); writeDocs(path.join(root, 'db', 'sessions'), {});
    out(run(['swarm', 'tick', '--plan', 'plan.yaml', '--db', 'db'], io));
    expect(run(['swarm', 'relaunch', 'T1', '--plan', 'plan.yaml'], io).code).toBe(2);
    expect(run(['swarm', 'nudge', 'T1'], io).code).toBe(2);
  });

  it('takeover replaces a stopped coordinator and refuses a live one', () => {
    out(run(['swarm', 'start', '--project', 'shop', '--session', 'old'], io));
    const e = readExecution(root)!;
    saveExecution(root, { ...e, hookSession: 'old' });
    mkdirSync(path.join(root, '.forge', 'live'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'live', 'old.json'), JSON.stringify({ sessionId: 'old', role: 'coordinator', runId: e.runId, task: null, event: 'Stop', ts: NOW.toISOString(), agents: [], ended: false }));
    expect(out(run(['swarm', 'takeover', '--session', 'new'], io))).toMatchObject({ took: false, previous: 'old', liveness: 'alive', joinAs: 'manual' });
    const later = { ...io, now: () => new Date(NOW.getTime() + 20 * 60000) };
    expect(out(run(['swarm', 'takeover', '--session', 'new'], later))).toMatchObject({ took: true, previous: 'old', runId: e.runId });
    expect(readExecution(root)).toMatchObject({ coordinator: 'new', hookSession: 'new' });
    expect(out(run(['swarm', 'takeover', '--session', 'new'], later))).toMatchObject({ took: 'already' });
    expect(readFileSync(path.join(root, '.forge', 'ledger.jsonl'), 'utf8')).toContain('"what":"takeover"');
  });
  it('takeover takes the liveliest of the signal and the lease, and falls back to the last step', () => {
    out(run(['swarm', 'start', '--project', 'shop', '--session', 'old'], io));
    const later = { ...io, now: () => new Date(NOW.getTime() + 20 * 60000) };
    // No signal and no lease: a start 20 minutes ago with no step counts as stopped; 5 minutes ago does not.
    expect(out(run(['swarm', 'takeover', '--session', 'new'], { ...io, now: () => new Date(NOW.getTime() + 5 * 60000) }))).toMatchObject({ took: false, liveness: 'alive' });
    // An old signal but a live lease: the lease wins.
    mkdirSync(path.join(root, '.forge', 'live'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'live', 'old.json'), JSON.stringify({ sessionId: 'old', role: 'coordinator', runId: readExecution(root)!.runId, task: null, event: 'Stop', ts: NOW.toISOString(), agents: [], ended: true }));
    const leaseUntil = new Date(NOW.getTime() + 25 * 60000).toISOString();
    writeDocs(path.join(root, 'db', 'sessions'), { old: { name: 'c', status: 'active', heartbeatAt: new Date(NOW.getTime() + 19 * 60000).toISOString(), leaseUntil } });
    expect(out(run(['swarm', 'takeover', '--session', 'new', '--db', 'db'], later)).took).toBe(false);
    expect(readExecution(root)!.coordinator).toBe('old');
    expect(out(run(['swarm', 'takeover', '--session', 'new'], later)).took).toBe(true);
    expect(run(['swarm', 'takeover'], later).code).toBe(2);
  });
  it('takeover refuses a member of this run and an invalid session id', () => {
    out(run(['swarm', 'start', '--project', 'shop', '--session', 'old'], io));
    const e = readExecution(root)!;
    const later = { ...io, now: () => new Date(NOW.getTime() + 20 * 60000) };
    writeMember(root, { sessionId: 'E1', role: 'executor', runId: e.runId, task: 'T1', name: null, since: NOW.toISOString() });
    const r = run(['swarm', 'takeover', '--session', 'E1'], later);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('E1 is a member of the execution');
    expect(run(['swarm', 'takeover', '--session', 'a:b'], later).code).toBe(2);
    expect(readExecution(root)!.coordinator).toBe('old');
    // A member of an older run is not a member of this one: it may take over.
    writeMember(root, { sessionId: 'E2', role: 'executor', runId: 'old-run', task: 'T1', name: null, since: NOW.toISOString() });
    expect(out(run(['swarm', 'takeover', '--session', 'E2'], later)).took).toBe(true);
  });
  it('start refuses a session or project id that execution.json would not read back, before creating anything', () => {
    expect(run(['swarm', 'start', '--project', 'shop', '--session', 'a:b'], io).code).toBe(2);
    expect(run(['swarm', 'start', '--project', 'sh:op', '--session', 'main', '--branch', 'forge/run-x'], io).code).toBe(2);
    expect(existsSync(path.join(root, '.claude', 'worktrees', 'run'))).toBe(false);
    expect(readExecution(root)).toBeNull();
  });
  it('a refused bring-up in a dirty run worktree says so instead of reporting a conflict', () => {
    out(run(['swarm', 'start', '--project', 'shop', '--session', 'main'], io));
    expect(run(['swarm', 'stop'], io).code).toBe(0);
    const wt = path.join(root, '.claude', 'worktrees', 'run');
    writeFileSync(path.join(wt, 'run.txt'), 'r\n');
    execFileSync('git', ['add', 'run.txt'], { cwd: wt }); execFileSync('git', ['commit', '-qm', 'run work'], { cwd: wt });
    writeFileSync(path.join(wt, 'plan.yaml'), 'local edit\n');
    writeFileSync(path.join(root, 'plan.yaml'), PLAN + '# base side\n'); git('commit', '-qam', 'base side');
    const tip = git('rev-parse', 'forge/run-shop');
    const r = run(['swarm', 'start', '--project', 'shop', '--session', 'main'], io);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('has uncommitted changes');
    expect(r.stderr).not.toContain('diverged');
    expect(git('rev-parse', 'forge/run-shop')).toBe(tip);
    expect(readFileSync(path.join(wt, 'plan.yaml'), 'utf8')).toBe('local edit\n');
  });
  it('start reports how the run branch met its base: created, null on resume and for an ephemeral run', () => {
    expect(out(run(['swarm', 'start', '--project', 'shop', '--session', 'main'], io)).baseSync).toBe('created');
    expect(out(run(['swarm', 'start', '--project', 'shop', '--session', 'main'], io)).baseSync).toBeNull();
    expect(run(['swarm', 'stop'], io).code).toBe(0);
    expect(out(run(['swarm', 'start', '--project', 'shop', '--session', 'main'], io)).baseSync).toBe('up-to-date');
    expect(run(['swarm', 'stop'], io).code).toBe(0);
    expect(out(run(['swarm', 'start', '--project', 'shop', '--session', 'main', '--kind', 'ephemeral'], io)).baseSync).toBeNull();
  });
  it('a new execution brings a stale run branch up to date with its base', () => {
    out(run(['swarm', 'start', '--project', 'shop', '--session', 'main'], io));
    expect(run(['swarm', 'stop'], io).code).toBe(0);
    writeFileSync(path.join(root, 'new.txt'), 'n\n'); git('add', 'new.txt'); git('commit', '-qm', 'base moved');
    const s = out(run(['swarm', 'start', '--project', 'shop', '--session', 'main'], io));
    expect(s.baseSync).toBe('fast-forward');
    expect(git('rev-parse', 'forge/run-shop')).toBe(git('rev-parse', 'main'));
    expect(run(['swarm', 'stop'], io).code).toBe(0);
    const wt = path.join(root, '.claude', 'worktrees', 'run');
    writeFileSync(path.join(wt, 'run.txt'), 'r\n');
    execFileSync('git', ['add', 'run.txt'], { cwd: wt }); execFileSync('git', ['commit', '-qm', 'run work'], { cwd: wt });
    writeFileSync(path.join(root, 'base2.txt'), 'b\n'); git('add', 'base2.txt'); git('commit', '-qm', 'base moved again');
    expect(out(run(['swarm', 'start', '--project', 'shop', '--session', 'main'], io)).baseSync).toBe('merged');
    expect(existsSync(path.join(wt, 'base2.txt')) && existsSync(path.join(wt, 'run.txt'))).toBe(true);
  });
  it('a stale run branch that conflicts with the base is refused and kept', () => {
    out(run(['swarm', 'start', '--project', 'shop', '--session', 'main'], io));
    expect(run(['swarm', 'stop'], io).code).toBe(0);
    const wt = path.join(root, '.claude', 'worktrees', 'run');
    writeFileSync(path.join(wt, 'plan.yaml'), 'x\n');
    execFileSync('git', ['commit', '-qam', 'run side'], { cwd: wt });
    const tip = git('rev-parse', 'forge/run-shop');
    writeFileSync(path.join(root, 'plan.yaml'), PLAN + '# base side\n'); git('commit', '-qam', 'base side');
    const r = run(['swarm', 'start', '--project', 'shop', '--session', 'main'], io);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('has diverged from main');
    expect(git('rev-parse', 'forge/run-shop')).toBe(tip);
  });

  describe('members', () => {
    let wt: string;
    let wio: Io;
    beforeEach(() => {
      out(run(['swarm', 'start', '--project', 'shop', '--session', 'main'], io));
      wt = path.join(root, '.claude', 'worktrees', 'manual');
      git('worktree', 'add', '-q', wt, '-b', 'manual-work');
      wio = { ...io, cwd: wt, git: defaultGit(wt) };
    });
    it('join registers a manual member from a worktree, in the main checkout', () => {
      const j = out(run(['swarm', 'join', '--session', 'M1', '--role', 'manual'], wio));
      expect(j).toMatchObject({ role: 'manual', coordinator: 'main', branch: 'forge/run-shop', task: null });
      expect(existsSync(path.join(root, '.forge', 'members', 'M1.json'))).toBe(true);
      expect(existsSync(path.join(wt, '.forge', 'members', 'M1.json'))).toBe(false);
      expect(run(['swarm', 'join', '--session', 'main', '--role', 'manual'], wio).code).toBe(2);
      expect(run(['swarm', 'join', '--session', 'E1', '--role', 'executor'], wio).code).toBe(2);
    });
    it('worktree --member creates task/<T> from the run branch without touching execution.json', () => {
      out(run(['swarm', 'join', '--session', 'M1', '--role', 'manual'], wio));
      const before = readFileSync(path.join(root, '.forge', 'execution.json'), 'utf8');
      const w = out(run(['swarm', 'worktree', 'T2', '--member', 'M1'], wio));
      expect(w.branch).toBe('task/T2');
      expect(path.resolve(w.worktree).toLowerCase()).toBe(path.resolve(root, '.claude', 'worktrees', 'task-T2').toLowerCase());
      expect(existsSync(path.join(root, '.claude', 'worktrees', 'task-T2', 'plan.yaml'))).toBe(true);
      expect(readFileSync(path.join(root, '.forge', 'execution.json'), 'utf8')).toBe(before);
      expect(run(['swarm', 'worktree', 'T2', '--member', 'nobody'], wio).code).toBe(2);
    });
    it('report writes the public task as the member, keeping since while the stage holds', () => {
      out(run(['swarm', 'join', '--session', 'M1', '--role', 'manual'], wio));
      const p = out(run(['swarm', 'report', 'T2', '--session', 'M1', '--stage', 'implement', '--agent', 'forge-impl'], wio));
      expect(p).toMatchObject({ task: 'T2', by: 'M1', mode: 'manual', stage: 'implement', status: 'running', since: NOW.toISOString() });
      const later = { ...wio, now: () => new Date('2026-10-12T12:06:00.000Z') };
      expect(out(run(['swarm', 'report', 'T2', '--session', 'M1', '--stage', 'implement', '--round', '2'], later)).since).toBe(NOW.toISOString());
      expect(out(run(['swarm', 'report', 'T2', '--session', 'M1', '--stage', 'review'], later)).since).toBe('2026-10-12T12:06:00.000Z');
      expect(JSON.parse(readFileSync(path.join(root, '.forge', 'members', 'M1.json'), 'utf8')).task).toBe('T2');
      expect(run(['swarm', 'report', 'T2', '--session', 'X9', '--stage', 'implement'], wio).code).toBe(2);
    });
    it('next offers a manual member the task the scheduler would start, without saving', () => {
      out(run(['swarm', 'join', '--session', 'M1', '--role', 'manual'], wio));
      writeDocs(path.join(wt, 'db', 'state'), {});
      writeDocs(path.join(wt, 'db', 'sessions'), {});
      const before = readFileSync(path.join(root, '.forge', 'execution.json'), 'utf8');
      expect(out(run(['swarm', 'next', '--plan', 'plan.yaml', '--db', 'db', '--session', 'M1'], wio))).toEqual({ task: 'T1', reason: null });
      writeDocs(path.join(wt, 'db', 'state'), { T1: { status: 'in_progress', owner: 'main' }, T2: { status: 'done' }, T3: { status: 'blocked' } });
      writeDocs(path.join(wt, 'db', 'sessions'), { main: { name: 'c', status: 'active', heartbeatAt: NOW.toISOString(), leaseUntil: new Date(NOW.getTime() + 5 * 60000).toISOString(), role: 'coordinator' } });
      const none = out(run(['swarm', 'next', '--plan', 'plan.yaml', '--db', 'db', '--session', 'M1'], wio));
      expect(none.task).toBeNull();
      expect(readFileSync(path.join(root, '.forge', 'execution.json'), 'utf8')).toBe(before);
    });
    it('an executor reports only its own task', () => {
      out(run(['swarm', 'join', '--session', 'E1', '--role', 'executor', '--task', 'T1'], wio));
      expect(out(run(['swarm', 'report', 'T1', '--session', 'E1', '--stage', 'brief'], wio)).mode).toBe('sessions');
      expect(run(['swarm', 'report', 'T2', '--session', 'E1', '--stage', 'brief'], wio).code).toBe(2);
    });
    it('join refuses a session id outside the members rule and writes nothing', () => {
      expect(run(['swarm', 'join', '--session', 'a:b', '--role', 'manual'], wio).code).toBe(2);
      expect(existsSync(path.join(root, '.forge', 'members'))).toBe(false);
    });
    it('an executor gets a worktree only for its own task', () => {
      out(run(['swarm', 'join', '--session', 'E1', '--role', 'executor', '--task', 'T1'], wio));
      expect(run(['swarm', 'worktree', 'T2', '--member', 'E1'], wio).code).toBe(2);
      expect(existsSync(path.join(root, '.claude', 'worktrees', 'task-T2'))).toBe(false);
      expect(out(run(['swarm', 'worktree', 'T1', '--member', 'E1'], wio)).branch).toBe('task/T1');
    });
    it('report refuses a task another live session reports, and takes it once that lease is over', () => {
      out(run(['swarm', 'join', '--session', 'M1', '--role', 'manual'], wio));
      const runId = readExecution(root)!.runId;
      const other = (leaseUntil: string) => writeFileSync(executionTaskFile(root, 'T2'), JSON.stringify({ task: 'T2', runId, stage: 'implement', status: 'running', agent: null, round: 0, since: NOW.toISOString(), updatedAt: NOW.toISOString(), leaseUntil, by: 'S9', mode: 'sessions' }));
      mkdirSync(path.dirname(executionTaskFile(root, 'T2')), { recursive: true });
      other(new Date(NOW.getTime() + 60000).toISOString());
      expect(run(['swarm', 'report', 'T2', '--session', 'M1', '--stage', 'implement'], wio).code).toBe(2);
      expect(JSON.parse(readFileSync(executionTaskFile(root, 'T2'), 'utf8')).by).toBe('S9');
      other(new Date(NOW.getTime() - 60000).toISOString());
      expect(out(run(['swarm', 'report', 'T2', '--session', 'M1', '--stage', 'implement'], wio)).by).toBe('M1');
    });
    it('a member worktree detects its setup from the new worktree, not from the caller worktree', () => {
      mkdirSync(path.join(wt, '.venv'));
      out(run(['swarm', 'join', '--session', 'M1', '--role', 'manual'], wio));
      expect(out(run(['swarm', 'worktree', 'T2', '--member', 'M1'], wio)).setup).toBeNull();
    });
    it('a manual member joining mid-run never collides with the scheduler: the versioned claim decides and the loser steps aside', () => {
      out(run(['swarm', 'start', '--project', 'shop', '--session', 'main', '--parallel', '1'], io));
      const db = path.join(root, 'db');
      const plan = path.join(root, 'plan.yaml');
      const live = { status: 'active', heartbeatAt: NOW.toISOString(), leaseUntil: new Date(NOW.getTime() + 600000).toISOString() };
      writeDocs(path.join(db, 'state'), {});
      writeDocs(path.join(db, 'sessions'), { main: live, M1: live });
      out(run(['swarm', 'join', '--session', 'M1', '--role', 'manual'], wio));
      const starts = () => out(run(['swarm', 'tick', '--plan', plan, '--db', db], io)).actions
        .filter((a: { type: string }) => a.type === 'start').map((a: { task: string }) => a.task);
      const next = () => out(run(['swarm', 'next', '--plan', plan, '--db', db, '--session', 'M1'], wio)).task;
      // Just as the scheduler wants it: both see T1 as the next task.
      expect(next()).toBe('T1');
      expect(starts()).toEqual(['T1']);
      // The member wins the versioned claim; the coordinator's claim fails and it drops T1.
      writeDocs(path.join(db, 'state'), { T1: { status: 'in_progress', owner: 'M1', claimedAt: NOW.toISOString(), version: 2 } });
      expect(run(['swarm', 'task', 'T1', '--drop'], io).code).toBe(0);
      out(run(['swarm', 'report', 'T1', '--session', 'M1', '--stage', 'implement'], wio));
      // The tick sees the winner: T1 stays the member's, the scheduler moves on to T2.
      expect(starts()).toEqual(['T2']);
      expect(Object.keys(readExecution(root)!.tasks)).toEqual(['T2']);
      // During: the scheduler holds T2; the member is only ever offered its own claim, never T2.
      expect(next()).toBe('T1');
      expect(starts()).toEqual([]);
      expect(Object.keys(readExecution(root)!.tasks)).toEqual(['T2']);
      // The other way round: the coordinator holds the claim on T2, so a member that lost T1 is offered nothing it holds.
      writeDocs(path.join(db, 'state'), { T1: { status: 'in_progress', owner: 'main', claimedAt: NOW.toISOString(), version: 3 }, T2: { status: 'in_progress', owner: 'main', claimedAt: NOW.toISOString(), version: 1 } });
      expect(next()).toBeNull();
    });
  });
});
