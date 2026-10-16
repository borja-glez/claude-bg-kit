import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run as cli, defaultGit, type Io } from '../src/forge/cli/run.js';
import { readExecution } from '../src/forge/execution.js';
import { readEvents } from '../src/forge/ledger.js';

// swarm start binds Claude's session id (C1): io.env is {} and the id comes as a flag.
const run = (argv: string[], io: Io) =>
  cli(argv[0] === 'swarm' && argv[1] === 'start' && !argv.includes('--hook-session') ? [...argv, '--hook-session', 'hook-main'] : argv, io);

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
const g = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
const out = (r: { stdout: string; code: number; stderr: string }) => { if (r.code !== 0) throw new Error(r.stderr); return JSON.parse(r.stdout); };
type Action = { type: string; task?: string; [k: string]: unknown };
const step = (...extra: string[]) => out(run(['swarm', 'step', '--plan', 'plan.yaml', '--db', 'db', ...extra], io)) as { actions: Action[]; publish: { tasks: { task: string; version: number | null; claim?: true; exec: Record<string, unknown>; forge: Record<string, unknown> }[]; session: Record<string, unknown>; metaRun: Record<string, unknown> }; running: number; parallel: number; wait: number | null; say: string };
const wt = (task: string) => path.join(root, '.claude', 'worktrees', `task-${task}`);
const commitIn = (cwd: string, file: string, text: string, msg: string) => {
  mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
  writeFileSync(path.join(cwd, file), text);
  g(cwd, 'add', file); g(cwd, 'commit', '-qm', msg);
};
const pass = JSON.stringify({ verdict: 'pass', confidence: 0.9, findings: [] });

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'forge-step-'));
  g(root, 'init', '-q', '-b', 'main'); g(root, 'config', 'user.email', 'a@b.c'); g(root, 'config', 'user.name', 't'); g(root, 'config', 'core.autocrlf', 'false');
  writeFileSync(path.join(root, 'plan.yaml'), PLAN);
  writeFileSync(path.join(root, '.gitignore'), '.forge/\n.claude/\n');
  g(root, 'add', '.'); g(root, 'commit', '-qm', 'init');
  mkdirSync(path.join(root, '.forge'), { recursive: true });
  writeFileSync(path.join(root, '.forge', 'config.yaml'), 'validators: []\n');
  io = { cwd: root, now: () => NOW, git: defaultGit(root), sleep: () => undefined, env: {} };
  out(run(['swarm', 'start', '--project', 'shop', '--session', 'main'], io));
  for (const c of ['state', 'sessions']) mkdirSync(path.join(root, 'db', c), { recursive: true });
});
afterEach(() => { try { g(root, 'worktree', 'prune'); } catch { /* ignore */ } rmSync(root, { recursive: true, force: true }); });

describe('forge swarm step (D-12)', () => {
  it('starts the tasks of the tick with their worktree, brief, triage and prep, and publishes their claim', () => {
    writeFileSync(path.join(root, 'versions.json'), JSON.stringify({ state: { T1: 4 }, sessions: { main: 7 } }));
    const s = step('--versions', 'versions.json');
    const starts = s.actions.filter(a => a.type === 'spawnImplementer');
    expect(starts.map(a => a.task)).toEqual(['T1', 'T2']);
    expect(starts[0]).toMatchObject({ agent: expect.stringMatching(/^forge-/), brief: '.forge/work/T1/brief-1.md', report: '.forge/work/T1/report-1.txt', worktree: wt('T1') });
    expect(starts[0].validate).toEqual(expect.stringContaining('validate --affected --base'));
    expect(readFileSync(path.join(root, '.forge', 'work', 'T1', 'brief-1.md'), 'utf8')).toContain('work only inside this directory');
    expect(readExecution(root)!.tasks.T1).toMatchObject({ stage: 'implement', agent: starts[0].agent });
    expect(readEvents(root).filter(e => e.kind === 'agent' && e.task === 'T1-1')).toHaveLength(1);
    const t1 = s.publish.tasks.find(x => x.task === 'T1')!;
    expect(t1).toMatchObject({ version: 4, claim: true, exec: { stage: 'implement', by: 'main', mode: 'subagents' }, forge: { phase: 'implement' } });
    expect(s.publish.tasks.find(x => x.task === 'T2')).toMatchObject({ version: null, claim: true });
    expect(s.publish.session).toMatchObject({ version: 7 });
    expect(s.publish.metaRun).toMatchObject({ kind: 'plan', loose: [], coordinator: 'main', active: true });
    expect((s.publish.metaRun.slots as { task: string }[]).map(x => x.task).sort()).toEqual(['T1', 'T2']);
    expect(s).toMatchObject({ running: 2, parallel: 3, wait: 300 });
    expect(s.say).toContain('T1');
  });
  it('an implementer back with a commit gets its reviewers; reviewers back close the task, and the tick integrates it with its commit (H-16)', () => {
    step();
    commitIn(wt('T1'), 'src/t1/a.ts', 'export const a = 1;\n', 'T1: a');
    writeFileSync(path.join(root, '.forge', 'work', 'T1', 'report-1.txt'), 'done\n');
    const review = step().actions.find(a => a.task === 'T1')!;
    expect(review).toMatchObject({ type: 'spawnReviewers', round: 1 });
    const spawn = (review.spawn as { role: string; twin?: boolean }[]).filter(e => !e.twin);
    expect(spawn.map(e => e.role)).toContain('review-correctness');
    expect(readExecution(root)!.tasks.T1.stage).toBe('review');
    const dir = path.join(root, '.forge', 'work', 'T1', 'reviews-1-1');
    for (const e of spawn) writeFileSync(path.join(dir, `${e.role.replace(/^review-/, '')}.json`), pass);
    const s = step();
    expect(s.actions.find(a => a.type === 'accepted')).toMatchObject({ task: 'T1' });
    expect(s.actions.filter(a => a.type === 'integrated' || a.type === 'conflict')).toHaveLength(1);
    expect(s.actions.find(a => a.type === 'integrated')).toMatchObject({ task: 'T1', commit: { title: 'T1: a' } });
    expect(readExecution(root)!.tasks.T1.status).toBe('integrated');
    expect(s.wait).toBe(0);
  });
  it('an implementer back without a commit hands its report over; a review draft is not closed (Review Focus 4)', () => {
    step();
    writeFileSync(path.join(root, '.forge', 'work', 'T2', 'report-1.txt'), 'NEEDS_CONTEXT: which format?\n');
    expect(step('--returned', 'T2').actions).toContainEqual({ type: 'readReport', task: 'T2', report: '.forge/work/T2/report-1.txt' });
    expect(readExecution(root)!.tasks.T2.stage).toBe('implement');
    commitIn(wt('T1'), 'src/t1/a.ts', 'x\n', 'T1: a');
    step('--returned', 'T1');
    writeFileSync(path.join(root, '.forge', 'work', 'T1', 'reviews-1-1', 'correctness.json'), JSON.stringify({ verdict: 'pass', confidence: 0.5, findings: [], complete: false }));
    expect(step().actions.filter(a => a.task === 'T1')).toEqual([]);
    expect(readExecution(root)!.tasks.T1.stage).toBe('review');
  });
  it('a command that fails for one task is an error action of that task, and the step goes on (Review Focus 4)', () => {
    step();
    commitIn(wt('T1'), 'src/t1/a.ts', 'x\n', 'T1: a');
    rmSync(path.join(root, '.forge', 'work', 'T1', 'baseline-1.json'));
    const s = step('--returned', 'T1');
    expect(s.actions).toContainEqual(expect.objectContaining({ type: 'error', task: 'T1', command: 'review-prep', code: 2 }));
    expect(s.publish.tasks.map(x => x.task).sort()).toEqual(['T1', 'T2']);
  });
  it('an express review whose background validation left {error, code} is an error action of its task, and the next step waits for its validators again (C-03)', () => {
    step();
    commitIn(wt('T1'), 'src/t1/a.ts', 'x\n', 'T1: a');
    const review = step('--returned', 'T1').actions.find(a => a.task === 'T1')!;
    const dir = path.join(root, '.forge', 'work', 'T1');
    const roundDir = path.join(dir, 'reviews-1-1');
    // The round as an express review leaves it: its validators run in the background and their file is pending.
    const planFile = path.join(roundDir, 'review-plan.json');
    writeFileSync(planFile, JSON.stringify({ ...JSON.parse(readFileSync(planFile, 'utf8')), express: true, validatorsPending: true }));
    for (const e of (review.spawn as { role: string; twin?: boolean }[]).filter(e => !e.twin)) writeFileSync(path.join(roundDir, `${e.role.replace(/^review-/, '')}.json`), pass);
    writeFileSync(path.join(dir, 'validators-1.json'), JSON.stringify({ error: 'review-prep: --baseline must be the JSON written by forge validate', code: 2 }));
    const s = step();
    expect(s.actions).toContainEqual(expect.objectContaining({ type: 'error', task: 'T1', command: 'review-close', code: 2, stderr: expect.stringContaining('gave no results') }));
    expect(existsSync(path.join(dir, 'validators-1.json'))).toBe(false);
    expect(readExecution(root)!.tasks.T1.stage).toBe('review');
    expect(step().actions.filter(a => a.task === 'T1')).toEqual([]);
  });
  it('with --out it writes step.json and leaves no job behind (C-03)', () => {
    const r = run(['swarm', 'step', '--plan', 'plan.yaml', '--db', 'db', '--out', '.forge/work/run/step.json'], io);
    expect(r.code).toBe(0);
    expect(JSON.parse(readFileSync(path.join(root, '.forge', 'work', 'run', 'step.json'), 'utf8'))).toMatchObject({ actions: expect.any(Array), waitedMs: 0 });
    const jobs = path.join(root, '.forge', 'jobs');
    expect(existsSync(jobs) ? readdirSync(jobs) : []).toEqual([]);
  });
  it('refuses outside the main checkout, without --plan or --db, with a bad --returned, and once the run stopped', () => {
    const runWt = path.join(root, '.claude', 'worktrees', 'run');
    expect(run(['swarm', 'step', '--plan', 'plan.yaml', '--db', 'db'], { ...io, cwd: runWt, git: defaultGit(runWt) }).code).toBe(2);
    expect(run(['swarm', 'step', '--db', 'db'], io).code).toBe(2);
    expect(run(['swarm', 'step', '--plan', 'plan.yaml', '--db', 'db', '--returned', 'T1,a b'], io).code).toBe(2);
    run(['swarm', 'stop'], io);
    expect(run(['swarm', 'step', '--plan', 'plan.yaml', '--db', 'db'], io)).toMatchObject({ code: 2, stderr: 'swarm step: the execution is not active\n' });
  });
});
