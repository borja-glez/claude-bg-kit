import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync, readdirSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run as cli, defaultGit, type Io } from '../src/forge/cli/run.js';
import { readExecution, saveExecution } from '../src/forge/execution.js';
import * as ledger from '../src/forge/ledger.js';
import { appendEvent, readEvents } from '../src/forge/ledger.js';
import { swarmStep, stepSay } from '../src/forge/cli/step.js';

const spyOrig = ledger.readEvents;

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
const step = (...extra: string[]) => out(run(['swarm', 'step', '--plan', 'plan.yaml', '--db', 'db', ...extra], io)) as { actions: Action[]; publish: { tasks: { task: string; version: number | null; claim?: true; write: { file_path: string } & Record<string, unknown> | null; event?: Record<string, unknown>; publishError?: string }[]; session: Record<string, unknown>; metaRun: Record<string, unknown> }; running: number; parallel: number; wait: number | null; say: string };
const wt = (task: string) => path.join(root, '.claude', 'worktrees', `task-${task}`);
const commitIn = (cwd: string, file: string, text: string, msg: string) => {
  mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
  writeFileSync(path.join(cwd, file), text);
  g(cwd, 'add', file); g(cwd, 'commit', '-qm', msg);
};
const pass = JSON.stringify({ verdict: 'pass', confidence: 0.9, findings: [] });
const isCmd = (argv: string[], ...head: string[]) => head.every((h, i) => argv[i] === h);
// The step with its CLI calls recorded, and the ones `fail` picks failing (exit 2), as a command of the step can.
const stepWith = (fail: (argv: string[]) => boolean, ...extra: string[]) => {
  const calls: string[][] = [];
  const r = swarmStep(['--plan', 'plan.yaml', '--db', 'db', ...extra], io, {
    cli: argv => { calls.push(argv); return fail(argv) ? { code: 2, stdout: '', stderr: `forced: ${argv.slice(0, 2).join(' ')}\n` } : run(argv, io); },
    gitAt: dir => defaultGit(dir),
  });
  return { ...(JSON.parse(r.stdout) as ReturnType<typeof step>), calls };
};
const stageOf = (task: string) => readExecution(root)!.tasks[task].stage;

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
    expect(starts[0]).toMatchObject({ agent: expect.stringMatching(/^forge-/), brief: '.forge/work/shop/T1/brief-1.md', report: '.forge/work/shop/T1/report-1.txt', worktree: wt('T1') });
    expect(starts[0].validate).toEqual(expect.stringContaining('validate --affected --base'));
    expect(readFileSync(path.join(root, '.forge', 'work', 'shop', 'T1', 'brief-1.md'), 'utf8')).toContain('work only inside this directory');
    expect(readExecution(root)!.tasks.T1).toMatchObject({ stage: 'implement', agent: starts[0].agent });
    expect(readEvents(root).filter(e => e.kind === 'agent' && e.task === 'T1-1')).toHaveLength(1);
    const t1 = s.publish.tasks.find(x => x.task === 'T1')!;
    expect(t1).toMatchObject({ version: 4, claim: true, write: { op: 'update', collection: 'state', doc_id: 'T1' },
      event: { op: 'set', collection: 'events', data: { type: 'started', sessionId: 'main', taskId: 'T1' } } });
    expect(JSON.parse(readFileSync(t1.write!.file_path, 'utf8'))).toMatchObject({ status: 'in_progress', owner: 'main',
      exec: { stage: 'implement', by: 'main', mode: 'subagents' }, forge: { v: 2, phase: 'implement' } });
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
    writeFileSync(path.join(root, '.forge', 'work', 'shop', 'T1', 'report-1.txt'), 'done\n');
    const review = step().actions.find(a => a.task === 'T1')!;
    expect(review).toMatchObject({ type: 'spawnReviewers', round: 1 });
    const spawn = (review.spawn as { role: string; twin?: boolean }[]).filter(e => !e.twin);
    expect(spawn.map(e => e.role)).toContain('review-correctness');
    expect(readExecution(root)!.tasks.T1.stage).toBe('review');
    const dir = path.join(root, '.forge', 'work', 'shop', 'T1', 'reviews-1-1');
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
    writeFileSync(path.join(root, '.forge', 'work', 'shop', 'T2', 'report-1.txt'), 'NEEDS_CONTEXT: which format?\n');
    expect(step('--returned', 'T2').actions).toContainEqual({ type: 'readReport', task: 'T2', report: '.forge/work/shop/T2/report-1.txt' });
    expect(readExecution(root)!.tasks.T2.stage).toBe('implement');
    commitIn(wt('T1'), 'src/t1/a.ts', 'x\n', 'T1: a');
    step('--returned', 'T1');
    writeFileSync(path.join(root, '.forge', 'work', 'shop', 'T1', 'reviews-1-1', 'correctness.json'), JSON.stringify({ verdict: 'pass', confidence: 0.5, findings: [], complete: false }));
    expect(step().actions.filter(a => a.task === 'T1')).toEqual([]);
    expect(readExecution(root)!.tasks.T1.stage).toBe('review');
  });
  it('a command that fails for one task is an error action of that task, and the step goes on (Review Focus 4)', () => {
    step();
    commitIn(wt('T1'), 'src/t1/a.ts', 'x\n', 'T1: a');
    rmSync(path.join(root, '.forge', 'work', 'shop', 'T1', 'baseline-1.json'));
    const s = step('--returned', 'T1');
    expect(s.actions).toContainEqual(expect.objectContaining({ type: 'error', task: 'T1', command: 'review-prep', code: 2 }));
    expect(s.publish.tasks.map(x => x.task).sort()).toEqual(['T1', 'T2']);
  });
  it('an express review whose background validation left {error, code} is an error action of its task, and the next step waits for its validators again (C-03)', () => {
    step();
    commitIn(wt('T1'), 'src/t1/a.ts', 'x\n', 'T1: a');
    const review = step('--returned', 'T1').actions.find(a => a.task === 'T1')!;
    const dir = path.join(root, '.forge', 'work', 'shop', 'T1');
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
  it('a reviewer respawned for an invalid file is waited for, and a step that dies before its end respawns it again (Review Focus 4)', () => {
    step();
    commitIn(wt('T1'), 'src/t1/a.ts', 'x\n', 'T1: a');
    const review = step('--returned', 'T1').actions.find(a => a.task === 'T1')!;
    const dir = path.join(root, '.forge', 'work', 'shop', 'T1', 'reviews-1-1');
    for (const e of (review.spawn as { role: string; twin?: boolean }[]).filter(e => !e.twin)) {
      writeFileSync(path.join(dir, `${e.role.replace(/^review-/, '')}.json`), e.role === 'review-correctness' ? '{"verdict":"maybe"}' : pass);
    }
    // Killed after its close (here, in its tick): no respawn is recorded without its action, so the next step respawns again.
    expect(() => swarmStep(['--plan', 'plan.yaml', '--db', 'db'], io, {
      cli: argv => { if (isCmd(argv, 'swarm', 'tick')) throw new Error('killed'); return run(argv, io); }, gitAt: d => defaultGit(d),
    })).toThrow('killed');
    expect(existsSync(path.join(dir, 'respawned.json'))).toBe(false);
    expect(step().actions).toContainEqual(expect.objectContaining({ type: 'respawnReviewers', task: 'T1', reviewers: ['correctness'] }));
    // Nothing new: the step waits for the respawned reviewer and never closes on its invalid file.
    expect(step().actions.filter(a => a.task === 'T1')).toEqual([]);
    expect(stageOf('T1')).toBe('review');
    writeFileSync(path.join(dir, 'correctness.json'), pass);
    expect(step().actions.find(a => a.task === 'T1')).toMatchObject({ type: 'accepted' });
  });
  it('a respawned reviewer that never wrote again is waited for only while its lease lasts: then its result stands', () => {
    step();
    commitIn(wt('T1'), 'src/t1/a.ts', 'x\n', 'T1: a');
    const review = step('--returned', 'T1').actions.find(a => a.task === 'T1')!;
    const dir = path.join(root, '.forge', 'work', 'shop', 'T1', 'reviews-1-1');
    for (const e of (review.spawn as { role: string; twin?: boolean }[]).filter(e => !e.twin)) {
      writeFileSync(path.join(dir, `${e.role.replace(/^review-/, '')}.json`), e.role === 'review-correctness' ? '{"verdict":"maybe"}' : pass);
    }
    expect(step().actions.find(a => a.task === 'T1')).toMatchObject({ type: 'respawnReviewers' });
    io = { ...io, now: () => new Date(NOW.getTime() + 89 * 60000) };
    expect(step().actions.filter(a => a.task === 'T1')).toEqual([]);
    io = { ...io, now: () => new Date(NOW.getTime() + 91 * 60000) };
    const late = step().actions.filter(a => a.task === 'T1');
    expect(late.length).toBeGreaterThan(0);
    expect(late.map(a => a.type)).not.toContain('respawnReviewers');
    expect(stageOf('T1')).not.toBe('review');
  });
  it('a start left at stage brief by a failing prep is started again by each step until it hands its implementer out', () => {
    const failPrep = (argv: string[]) => isCmd(argv, 'prep') && argv.includes('T1-1');
    for (let i = 0; i < 2; i++) {
      const s = stepWith(failPrep);
      expect(s.actions).toContainEqual(expect.objectContaining({ type: 'error', task: 'T1', command: 'prep', code: 2 }));
      expect(s.actions.filter(a => a.type === 'spawnImplementer').map(a => a.task)).toEqual(i === 0 ? ['T2'] : []);
      expect(stageOf('T1')).toBe('brief');
    }
    const s = stepWith(() => false);
    expect(s.actions.filter(a => a.type === 'spawnImplementer').map(a => a.task)).toEqual(['T1']);
    expect(stageOf('T1')).toBe('implement');
    expect(s.publish.tasks.find(x => x.task === 'T1')).toMatchObject({ claim: true, write: { doc_id: 'T1' } });
    expect(readEvents(root).filter(e => e.kind === 'agent' && e.task === 'T1-1')).toHaveLength(1);
  });
  it('an implementer whose stage could not be recorded is not handed out; the next step hands it out without running prep again', () => {
    const s = stepWith(argv => isCmd(argv, 'swarm', 'task', 'T1') && argv.includes('implement'));
    expect(s.actions).toContainEqual(expect.objectContaining({ type: 'error', task: 'T1', command: 'swarm task' }));
    expect(s.actions.filter(a => a.type === 'spawnImplementer').map(a => a.task)).toEqual(['T2']);
    expect(stageOf('T1')).toBe('brief');
    const again = stepWith(() => false);
    expect(again.actions.filter(a => a.type === 'spawnImplementer')).toEqual([expect.objectContaining({ task: 'T1', worktree: wt('T1'), validate: expect.stringContaining('validate --affected --base') })]);
    expect(again.calls.filter(a => isCmd(a, 'prep'))).toEqual([]);
    expect(stageOf('T1')).toBe('implement');
    expect(readEvents(root).filter(e => e.kind === 'agent' && e.task === 'T1-1')).toHaveLength(1);
  });
  it('a task left at stage validate by a failing review-prep is taken up by each step, with no --returned, until its review is prepared', () => {
    step();
    commitIn(wt('T1'), 'src/t1/a.ts', 'x\n', 'T1: a');
    const baseline = path.join(root, '.forge', 'work', 'shop', 'T1', 'baseline-1.json');
    rmSync(baseline);
    expect(step('--returned', 'T1').actions).toContainEqual(expect.objectContaining({ type: 'error', task: 'T1', command: 'review-prep' }));
    expect(stageOf('T1')).toBe('validate');
    expect(step().actions).toContainEqual(expect.objectContaining({ type: 'error', task: 'T1', command: 'review-prep' }));
    writeFileSync(baseline, '[]\n');
    expect(step().actions.find(a => a.task === 'T1')).toMatchObject({ type: 'spawnReviewers', round: 1 });
    expect(stageOf('T1')).toBe('review');
  });
  it('a review prepared whose stage could not be recorded is handed out by the next step on the same round', () => {
    step();
    commitIn(wt('T1'), 'src/t1/a.ts', 'x\n', 'T1: a');
    const s = stepWith(argv => isCmd(argv, 'swarm', 'task', 'T1') && argv.includes('review'), '--returned', 'T1');
    expect(s.actions.filter(a => a.task === 'T1').map(a => [a.type, a.command])).toEqual([['error', 'swarm task']]);
    expect(stageOf('T1')).toBe('validate');
    expect(step().actions.find(a => a.task === 'T1')).toMatchObject({ type: 'spawnReviewers', round: 1 });
    expect(stageOf('T1')).toBe('review');
    expect(readdirSync(path.join(root, '.forge', 'work', 'shop', 'T1')).filter(d => d.startsWith('reviews-'))).toEqual(['reviews-1-1']);
  });
  it('after a validators round, an implementer back with no new commit hands its report over (C-08)', () => {
    step();
    mkdirSync(path.join(wt('T1'), '.forge'), { recursive: true });
    writeFileSync(path.join(wt('T1'), '.forge', 'config.yaml'), 'detect: false\nvalidators:\n  - name: check\n    cmd: node -e "process.exit(require(\'fs\').existsSync(\'bad.txt\')?1:0)"\n');
    commitIn(wt('T1'), 'bad.txt', 'x\n', 'T1: bad');
    expect(step('--returned', 'T1').actions.find(a => a.task === 'T1')).toMatchObject({ type: 'validatorsRound' });
    expect(stageOf('T1')).toBe('implement');
    writeFileSync(path.join(root, '.forge', 'work', 'shop', 'T1', 'report-1.txt'), 'BLOCKED: the check needs a server\n');
    expect(step('--returned', 'T1').actions.filter(a => a.task === 'T1')).toEqual([{ type: 'readReport', task: 'T1', report: '.forge/work/shop/T1/report-1.txt' }]);
    expect(stageOf('T1')).toBe('implement');
    expect(existsSync(path.join(root, '.forge', 'work', 'shop', 'T1', 'validators-fix-1-1-2.json'))).toBe(false);
  });
  it('after a conflict retry the review diffs from the run-branch tip the implementer merged, on a baseline run there, once', () => {
    const accept = (task: string) => out(run(['swarm', 'task', task, '--stage', 'verdict', '--status', 'accepted', '--no-agent'], io));
    // What the coordinator publishes on `integrated`: the roadmap shows the task done.
    const done = (task: string) => writeFileSync(path.join(root, 'db', 'state', `${task}.json`), JSON.stringify({ status: 'done', version: 2 }));
    const runWt = path.join(root, '.claude', 'worktrees', 'run');
    step();
    commitIn(wt('T1'), 'src/t1/a.ts', 'x\n', 'T1: a');
    accept('T1');
    expect(step().actions.find(a => a.type === 'integrated')).toMatchObject({ task: 'T1' });
    done('T1');
    // T3 (after T1) starts on the run branch with T1; T2 is integrated meanwhile.
    expect(step().actions.filter(a => a.type === 'spawnImplementer').map(a => a.task)).toEqual(['T3']);
    const oldBase = g(wt('T3'), 'rev-parse', 'HEAD');
    commitIn(wt('T2'), 'shared.txt', 'two\n', 'T2: shared');
    commitIn(wt('T2'), 'src/t2/b.ts', 'y\n', 'T2: b');
    accept('T2');
    expect(step().actions.find(a => a.type === 'integrated')).toMatchObject({ task: 'T2' });
    done('T2');
    const moved = g(runWt, 'rev-parse', 'HEAD');
    commitIn(wt('T3'), 'shared.txt', 'three\n', 'T3: shared');
    commitIn(wt('T3'), 'src/t3/c.ts', 'z\n', 'T3: c');
    accept('T3');
    expect(step().actions.find(a => a.task === 'T3')).toMatchObject({ type: 'conflict' });
    // The retry: its implementer merges the run branch into task/T3 and resolves the conflict.
    expect(run(['swarm', 'retry', 'T3'], io).code).toBe(0);
    try { g(wt('T3'), 'merge', '-q', 'forge/run-shop'); } catch { /* the conflict on shared.txt */ }
    writeFileSync(path.join(wt('T3'), 'shared.txt'), 'two and three\n');
    g(wt('T3'), 'add', 'shared.txt'); g(wt('T3'), 'commit', '-qm', 'T3: merge the run branch');
    expect(moved).not.toBe(oldBase);
    const s = stepWith(() => false, '--returned', 'T3');
    expect(s.actions.find(a => a.task === 'T3')).toMatchObject({ type: 'spawnReviewers', base: moved });
    const baseOf = (calls: string[][], cmd: string) => { const a = calls.find(x => isCmd(x, cmd) && x.some(v => v.startsWith('T3')))!; return a[a.indexOf('--base') + 1]; };
    expect(baseOf(s.calls, 'triage')).toBe(moved);
    expect(baseOf(s.calls, 'review-prep')).toBe(moved);
    expect(s.calls.filter(a => isCmd(a, 'validate'))).toEqual([['validate', '--all', '--path', 'large', '--base-run', '--task', 'T3-1', '--cwd', runWt]]);
    const diff = readFileSync(path.join(root, '.forge', 'work', 'shop', 'T3', 'diff-1.patch'), 'utf8');
    expect(diff).toContain('src/t3/c.ts');
    expect(diff).not.toContain('src/t2/b.ts');
    // `from`: the BASE prep recorded, which this one replaced (1c).
    expect(JSON.parse(readFileSync(path.join(root, '.forge', 'work', 'shop', 'T3', 'base-1.json'), 'utf8'))).toMatchObject({ base: moved, from: oldBase });
    // The next round keeps that base and does not run the baseline again.
    const dir = path.join(root, '.forge', 'work', 'shop', 'T3', 'reviews-1-1');
    for (const e of (s.actions.find(a => a.task === 'T3')!.spawn as { role: string; twin?: boolean }[]).filter(e => !e.twin)) {
      writeFileSync(path.join(dir, `${e.role.replace(/^review-/, '')}.json`), JSON.stringify({ verdict: 'fail', confidence: 0.9, findings: [{ severity: 'important', file: 'src/t3/c.ts', line: 1, problem: 'wrong' }] }));
    }
    expect(step().actions.find(a => a.task === 'T3')).toMatchObject({ type: 'resumeImplementer' });
    commitIn(wt('T3'), 'src/t3/c.ts', 'fixed\n', 'T3: fix');
    const again = stepWith(() => false, '--returned', 'T3');
    expect(again.actions.find(a => a.task === 'T3')?.type).toMatch(/^(spawnReviewers|express)$/);
    for (const cmd of ['triage', 'review-prep']) expect(baseOf(again.calls, cmd), cmd).toBe(moved);
    expect(again.calls.filter(a => isCmd(a, 'validate'))).toEqual([]);
  });
  it('a task never retried keeps the BASE prep recorded and runs no baseline again', () => {
    step();
    const base = g(wt('T1'), 'rev-parse', 'HEAD');
    commitIn(wt('T1'), 'src/t1/a.ts', 'x\n', 'T1: a');
    const s = stepWith(() => false, '--returned', 'T1');
    expect(s.actions.find(a => a.task === 'T1')).toMatchObject({ type: 'spawnReviewers', base });
    expect(s.calls.filter(a => isCmd(a, 'validate'))).toEqual([]);
    expect(existsSync(path.join(root, '.forge', 'work', 'shop', 'T1', 'base-1.json'))).toBe(false);
  });
  it('says every action it can emit, in both locales', () => {
    const types = ['spawnImplementer', 'spawnReviewers', 'express', 'validatorsRound', 'readReport', 'reviewMissing', 'respawnReviewers', 'accepted',
      'resumeImplementer', 'freshImplementer', 'redo', 'ask', 'blocked', 'integrated', 'conflict', 'run-dirty', 'run-deps', 'error',
      'start', 'relaunch', 'nudge', 'block', 'finish', 'stalled'];
    for (const locale of ['es', 'en'] as const) {
      for (const type of types) {
        const runWide = type === 'finish' || type === 'stalled';
        const said = stepSay([{ type, ...(runWide ? {} : { task: 'T9' }), agent: 'forge-impl', command: 'prep', reason: 'why' }], 300, locale);
        expect(said, `${type} (${locale})`).not.toBe(stepSay([], 300, locale));
        if (!runWide) expect(said, `${type} (${locale})`).toContain('T9');
      }
    }
  });
  it('refuses an ephemeral run: it steps with the single commands', () => {
    expect(run(['swarm', 'stop'], io).code).toBe(0);
    writeFileSync(path.join(root, '.forge', 'tasks.json'), JSON.stringify(['x1', 'x2'].map(id => ({ id, title: id, path: 'small', zones: [`${id}.txt`], depends_on: [] }))));
    out(run(['swarm', 'start', '--project', 'shop', '--session', 'main', '--kind', 'ephemeral', '--tasks', '.forge/tasks.json'], io));
    expect(run(['swarm', 'step', '--plan', 'plan.yaml', '--db', 'db'], io)).toMatchObject({ code: 2, stderr: expect.stringContaining('an ephemeral run steps with the single commands') });
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
    for (const bad of ['T1', 'T1:maybe', 'a b:fix', 'T1:defer', 'T1:defer:3', 'T1:fix,T2']) {
      expect(run(['swarm', 'step', '--plan', 'plan.yaml', '--db', 'db', '--ruling', bad], io).code, bad).toBe(2);
    }
    run(['swarm', 'stop'], io);
    expect(run(['swarm', 'step', '--plan', 'plan.yaml', '--db', 'db'], io)).toMatchObject({ code: 2, stderr: 'swarm step: the execution is not active\n' });
  });
});

// The review of T1 prepared and every reviewer back with a pass: what each test below starts from.
const reviewedT1 = () => {
  step();
  commitIn(wt('T1'), 'src/t1/a.ts', 'x\n', 'T1: a');
  const review = step('--returned', 'T1').actions.find(a => a.task === 'T1')!;
  expect(review).toMatchObject({ type: 'spawnReviewers', round: 1 });
  const dir = path.join(root, '.forge', 'work', 'shop', 'T1', 'reviews-1-1');
  for (const e of (review.spawn as { role: string; twin?: boolean }[]).filter(e => !e.twin)) writeFileSync(path.join(dir, `${e.role.replace(/^review-/, '')}.json`), pass);
  return { review, dir };
};
// review-close as it prints for a repeated security theme (K4-02): ask set, next resume.
const ASK_CLOSE = {
  action: 'fix', score: 0.6, next: 'resume', last: false, implementer: { agent: 'forge-impl', role: 'impl' }, findings: '.forge/work/shop/T1/findings-1-1.json',
  deferred: [], ask: { kind: 'repeat-theme', question: 'q', options: [], findings: [{ id: 'F1', severity: 'important', problem: 'p', earlier: { id: 'F0', round: 1, problem: 'e' } }] },
  handover: null, revert: null, invalid: [], incomplete: [], round: 1, reasons: [],
};
// The step with review-close answered by `close` (its argv recorded), every other command run for real.
const stepClosing = (close: (argv: string[]) => Record<string, unknown>, ...extra: string[]) => {
  const closes: string[][] = [];
  const r = swarmStep(['--plan', 'plan.yaml', '--db', 'db', ...extra], io, {
    cli: argv => { if (isCmd(argv, 'review-close')) { closes.push(argv); return { code: 0, stdout: JSON.stringify(close(argv)), stderr: '' }; } return run(argv, io); },
    gitAt: d => defaultGit(d),
  });
  return { ...(JSON.parse(r.stdout) as ReturnType<typeof step>), closes };
};

describe('swarm step: the person rules on a question (I1, M8)', () => {
  it('after an ask, the next steps run no review-close and emit nothing for the task until the person rules; after 24 h it asks once more', () => {
    const { dir } = reviewedT1();
    const first = stepClosing(() => ASK_CLOSE);
    expect(first.actions.filter(a => a.task === 'T1')).toEqual([expect.objectContaining({ type: 'ask', task: 'T1', close: expect.objectContaining({ next: 'resume' }) })]);
    expect(first.closes).toHaveLength(1);
    expect(JSON.parse(readFileSync(path.join(dir, 'asked.json'), 'utf8'))).toMatchObject({ findings: ['F1'], next: 'resume', implementer: { agent: 'forge-impl' }, findingsFile: '.forge/work/shop/T1/findings-1-1.json', handover: null, revert: null });
    for (const extra of [[], ['--returned', 'T1']]) {
      const again = stepClosing(() => ASK_CLOSE, ...extra);
      expect(again.closes, extra.join(' ')).toEqual([]);
      expect(again.actions.filter(a => a.task === 'T1')).toEqual([]);
      expect(stageOf('T1')).toBe('review');
    }
    io = { ...io, now: () => new Date(NOW.getTime() + 25 * 3600_000) };
    expect(stepClosing(() => ASK_CLOSE).actions.filter(a => a.task === 'T1')).toEqual([expect.objectContaining({ type: 'ask', task: 'T1' })]);
    const later = stepClosing(() => ASK_CLOSE);
    expect(later.actions.filter(a => a.task === 'T1')).toEqual([]);
    expect(later.closes).toEqual([]);
  });
  it('a step killed after it asked keeps no asked.json: the next step closes again and asks again', () => {
    const { dir } = reviewedT1();
    let closes = 0;
    expect(() => swarmStep(['--plan', 'plan.yaml', '--db', 'db'], io, {
      cli: argv => {
        if (isCmd(argv, 'review-close')) { closes++; return { code: 0, stdout: JSON.stringify(ASK_CLOSE), stderr: '' }; }
        if (isCmd(argv, 'swarm', 'tick')) throw new Error('killed');
        return run(argv, io);
      },
      gitAt: d => defaultGit(d),
    })).toThrow('killed');
    expect(closes).toBe(1);
    expect(existsSync(path.join(dir, 'asked.json'))).toBe(false);
    const again = stepClosing(() => ASK_CLOSE);
    expect(again.closes).toHaveLength(1);
    expect(again.actions.filter(a => a.task === 'T1')).toEqual([expect.objectContaining({ type: 'ask' })]);
    expect(existsSync(path.join(dir, 'asked.json'))).toBe(true);
  });
  it('--ruling T:fix follows the next review-close kept: the implementer resumes at stage implement', () => {
    const { dir } = reviewedT1();
    stepClosing(() => ASK_CLOSE);
    // The answer is kept with the question: a step that cannot record the stage follows it again at the next step.
    const failed = swarmStep(['--plan', 'plan.yaml', '--db', 'db', '--ruling', 'T1:fix'], io, {
      cli: argv => (isCmd(argv, 'swarm', 'task', 'T1') && argv.includes('implement') ? { code: 2, stdout: '', stderr: 'forced\n' } : run(argv, io)), gitAt: d => defaultGit(d),
    });
    expect(JSON.parse(failed.stdout).actions.filter((a: Action) => a.task === 'T1')).toEqual([expect.objectContaining({ type: 'error', command: 'swarm task' })]);
    expect(JSON.parse(readFileSync(path.join(dir, 'asked.json'), 'utf8')).ruling).toEqual({ kind: 'fix' });
    const s = stepClosing(() => ASK_CLOSE);
    expect(s.closes).toEqual([]);
    expect(s.actions.filter(a => a.task === 'T1')).toEqual([expect.objectContaining({ type: 'resumeImplementer', implementer: { agent: 'forge-impl', role: 'impl' }, findings: '.forge/work/shop/T1/findings-1-1.json' })]);
    expect(readExecution(root)!.tasks.T1).toMatchObject({ stage: 'implement', agent: 'forge-impl', round: 2 });
    expect(existsSync(path.join(dir, 'asked.json'))).toBe(false);
  });
  it('--ruling T:out-of-model closes the round again with the ids asked, and --ruling T:defer:F3+F5 with those ids; the step follows the new output', () => {
    reviewedT1();
    stepClosing(() => ASK_CLOSE);
    const accepted = { ...ASK_CLOSE, action: 'accept', score: 0.9, next: 'done', ask: null, findings: null };
    const s = stepClosing(argv => (argv.includes('--out-of-model') ? accepted : ASK_CLOSE), '--ruling', 'T1:out-of-model');
    expect(s.closes).toHaveLength(1);
    expect(s.closes[0].slice(s.closes[0].indexOf('--out-of-model'), s.closes[0].indexOf('--out-of-model') + 2)).toEqual(['--out-of-model', 'F1']);
    expect(s.actions.find(a => a.task === 'T1')).toMatchObject({ type: 'accepted' });
    expect(readExecution(root)!.tasks.T1.status).not.toBe('running');
  });
  it('--ruling T:defer:F3+F5 keeps the architecture of a fix-round implementer that asked: the round closes again with --defer', () => {
    reviewedT1();
    stepClosing(() => ({ ...ASK_CLOSE, ask: null }));
    expect(stageOf('T1')).toBe('implement');
    writeFileSync(path.join(root, '.forge', 'work', 'shop', 'T1', 'report-1.txt'), 'NEEDS_CONTEXT: this needs another storage format\n');
    expect(step('--returned', 'T1').actions.find(a => a.task === 'T1')).toMatchObject({ type: 'readReport' });
    const s = stepClosing(argv => ({ ...ASK_CLOSE, ask: null, ...(argv.includes('--defer') ? { action: 'accept', next: 'done', findings: null } : {}) }), '--ruling', 'T1:defer:F3+F5');
    expect(s.closes).toHaveLength(1);
    expect(s.closes[0].slice(s.closes[0].indexOf('--defer'), s.closes[0].indexOf('--defer') + 2)).toEqual(['--defer', 'F3,F5']);
    expect(s.actions.find(a => a.task === 'T1')).toMatchObject({ type: 'accepted' });
  });
  it('--ruling T:review prepares the next review on the same HEAD for an implementer back without a commit (M8)', () => {
    step();
    commitIn(wt('T1'), 'src/t1/a.ts', 'x\n', 'T1: a');
    const review = step('--returned', 'T1').actions.find(a => a.task === 'T1')!;
    const dir = path.join(root, '.forge', 'work', 'shop', 'T1');
    for (const e of (review.spawn as { role: string; twin?: boolean }[]).filter(e => !e.twin)) {
      writeFileSync(path.join(dir, 'reviews-1-1', `${e.role.replace(/^review-/, '')}.json`), JSON.stringify({ verdict: 'fail', confidence: 0.9, findings: [{ severity: 'important', file: 'src/t1/a.ts', line: 1, problem: 'wrong' }] }));
    }
    expect(step().actions.find(a => a.task === 'T1')).toMatchObject({ type: 'resumeImplementer' });
    writeFileSync(path.join(dir, 'report-1.txt'), 'DONE: F1 is already fixed, nothing to change\n');
    expect(step('--returned', 'T1').actions.find(a => a.task === 'T1')).toMatchObject({ type: 'readReport' });
    const s = step('--ruling', 'T1:review');
    expect(s.actions.find(a => a.task === 'T1')).toMatchObject({ type: expect.stringMatching(/^(spawnReviewers|express)$/), round: 2 });
    expect(stageOf('T1')).toBe('review');
    const head = (k: number) => readFileSync(path.join(dir, `reviews-1-${k}`, 'head.txt'), 'utf8').trim();
    expect(head(2)).toBe(head(1));
  });
});

describe('swarm step: a verification (I2)', () => {
  const surface = '---\naffects: ["src/t1/**"]\n---\n# Web\n\nOpen the app.\n';
  // T1's review prepared with a verify surface allowed, and verify-plan run on its round with --dir.
  const verifiedT1 = () => {
    step();
    mkdirSync(path.join(wt('T1'), '.forge', 'verify'), { recursive: true });
    writeFileSync(path.join(wt('T1'), '.forge', 'verify', 'web.md'), surface);
    g(wt('T1'), 'add', '-f', '.forge/verify/web.md'); g(wt('T1'), 'commit', '-qm', 'T1: the web surface');
    commitIn(wt('T1'), 'src/t1/a.ts', 'x\n', 'T1: a');
    expect(run(['local', 'set', 'surfaces.web', 'allowed', '--cwd', wt('T1')], io).code).toBe(0);
    const review = step('--returned', 'T1').actions.find(a => a.task === 'T1')!;
    expect(review).toMatchObject({ type: 'spawnReviewers', round: 1 });
    const plan = out(run(['verify-plan', '--task', 'T1-1', '--path', 'large', '--base', String(review.base), '--dir', '.forge/work/shop/T1/reviews-1-1', '--cwd', wt('T1'), '--locale', 'en'], io));
    expect(plan.eligible).toBe(true);
    const dir = path.join(root, '.forge', 'work', 'shop', 'T1', 'reviews-1-1');
    expect(JSON.parse(readFileSync(path.join(dir, 'verify-pending.json'), 'utf8'))).toMatchObject({ task: 'T1-1', surfaces: [expect.objectContaining({ name: 'web' })], evidence: '.forge/work/shop/T1/evidence/1-1' });
    for (const e of (review.spawn as { role: string; twin?: boolean }[]).filter(e => !e.twin)) writeFileSync(path.join(dir, `${e.role.replace(/^review-/, '')}.json`), pass);
    return dir;
  };
  const verifyJson = (learned: string) => JSON.stringify({
    surfaces: ['web'], result: 'pass', checks: [{ id: 1, surface: 'web', name: 'home', main: true, ok: true, expected: 'a', observed: 'a' }], learned: [{ surface: 'web', note: learned }],
  });
  it('waits for the verify agent while verify-pending.json is there, then closes the review and the verification together', () => {
    const dir = verifiedT1();
    const waiting = stepWith(() => false);
    expect(waiting.calls.filter(a => isCmd(a, 'review-close'))).toEqual([]);
    expect(waiting.actions.filter(a => a.task === 'T1')).toEqual([]);
    expect(stageOf('T1')).toBe('review');
    writeFileSync(path.join(dir, 'verify.json'), verifyJson('the dev server takes 5 s'));
    const s = stepWith(() => false);
    const accepted = s.actions.find(a => a.task === 'T1' && a.type === 'accepted')!;
    expect(accepted).toMatchObject({ verify: { result: 'pass', learned: { web: 1 }, cleanup: { killed: [], gone: [] }, commit: ['.forge/verify/web.md'], evidence: expect.objectContaining({ mode: 'upload' }), say: expect.stringContaining('pass') } });
    expect(s.calls.filter(a => isCmd(a, 'verify-close'))).toHaveLength(1);
    expect(s.calls.find(a => isCmd(a, 'verify-close'))).toEqual(expect.arrayContaining(['--evidence', '.forge/work/shop/T1/evidence/1-1', '--db', 'db', '--cwd', wt('T1')]));
    // The note is in the surface, committed with the task's work before the tick integrates it.
    expect(g(wt('T1'), 'show', 'HEAD:.forge/verify/web.md')).toContain('the dev server takes 5 s');
    expect(g(wt('T1'), 'status', '--porcelain')).toBe('');
    expect(s.actions.find(a => a.type === 'integrated')).toMatchObject({ task: 'T1' });
  });
  it('respawns verify with the data of verify-pending.json when its verify.json is invalid', () => {
    const dir = verifiedT1();
    writeFileSync(path.join(dir, 'verify.json'), '{"result":"maybe"}');
    const s = step();
    expect(s.actions.find(a => a.task === 'T1')).toMatchObject({ type: 'respawnReviewers', reviewers: ['verify'], spawn: [expect.objectContaining({ role: 'verify', surfaces: [expect.objectContaining({ name: 'web' })] })] });
    expect(step().actions.filter(a => a.task === 'T1')).toEqual([]);
    writeFileSync(path.join(dir, 'verify.json'), verifyJson('port 3000'));
    expect(step().actions.find(a => a.task === 'T1')).toMatchObject({ type: 'accepted', verify: { learned: { web: 1 } } });
  });
  it('does not wait for a verification every candidate surface of which was skipped (verify-skip)', () => {
    verifiedT1();
    writeFileSync(path.join(root, 'skip.json'), JSON.stringify({ surface: 'web', reason: 'not worth it' }));
    expect(run(['log', '--kind', 'verify-skip', '--task', 'T1-1', '--data-file', 'skip.json'], io).code).toBe(0);
    const s = stepWith(() => false);
    expect(s.actions.find(a => a.task === 'T1')).toMatchObject({ type: 'accepted' });
    expect(s.calls.filter(a => isCmd(a, 'verify-close'))).toEqual([]);
    expect(run(['verify-plan', '--task', 'T1-1', '--path', 'large', '--base', 'HEAD', '--dir', '.forge/work/shop/T1', '--cwd', wt('T1')], io)).toMatchObject({ code: 2, stderr: expect.stringContaining('--dir must be a review dir') });
    expect(run(['verify-plan', '--task', 'T1-1', '--path', 'large', '--base', 'HEAD', '--dir', '.forge/work/shop/T1', '--cwd', wt('T1')], io).stderr).toContain('.forge/work/<project>/<T>/reviews-<n>-<round>');
  });
});

describe('swarm step: a member task adopted after a conflict (I3)', () => {
  it('reviews it from where it forks from the run branch, on a baseline run there', () => {
    g(root, 'branch', 'task/T1', 'forge/run-shop');
    const e = readExecution(root)!;
    const iso = NOW.toISOString();
    saveExecution(root, { ...e, tasks: { T1: { status: 'conflict', stage: 'integrate', round: 1, worktree: '', branch: 'task/T1', executor: 'manual', attempts: 0, agent: null, startedAt: iso, stageSince: iso, updatedAt: iso, detail: 'conflict', title: 'T1' } } });
    const adopted = out(run(['swarm', 'retry', 'T1', '--adopt'], io));
    // D-08: adopt prints the task's work folder, where the coordinator writes its brief.
    expect(adopted.work).toBe('.forge/work/shop/T1');
    const work = path.join(root, adopted.work);
    mkdirSync(work, { recursive: true });
    writeFileSync(path.join(work, 'brief-1.md'), 'brief\n');
    commitIn(adopted.worktree, 'src/t1/a.ts', 'x\n', 'T1: fix the conflict');
    writeFileSync(path.join(work, 'report-1.txt'), 'DONE\n');
    const s = stepWith(() => false, '--returned', 'T1');
    const base = g(adopted.worktree, 'merge-base', 'HEAD', 'forge/run-shop');
    expect(s.actions.find(a => a.task === 'T1')).toMatchObject({ type: 'spawnReviewers', base });
    expect(existsSync(path.join(work, 'baseline-1.json'))).toBe(true);
    expect(JSON.parse(readFileSync(path.join(work, 'base-1.json'), 'utf8'))).toMatchObject({ base });
    expect(stageOf('T1')).toBe('review');
  });
});

describe('swarm step: robustness (M1, M2, M7, M9)', () => {
  it('a validators round taken up at stage validate names the implementer the step logged and records its stage with it (M1)', () => {
    const s0 = step();
    const agent = String(s0.actions.find(a => a.task === 'T1')!.agent);
    mkdirSync(path.join(wt('T1'), '.forge'), { recursive: true });
    writeFileSync(path.join(wt('T1'), '.forge', 'config.yaml'), 'detect: false\nvalidators:\n  - name: check\n    cmd: node -e "process.exit(require(\'fs\').existsSync(\'bad.txt\')?1:0)"\n');
    commitIn(wt('T1'), 'bad.txt', 'x\n', 'T1: bad');
    const failed = stepWith(argv => isCmd(argv, 'review-prep'), '--returned', 'T1');
    expect(failed.actions).toContainEqual(expect.objectContaining({ type: 'error', task: 'T1', command: 'review-prep' }));
    expect(readExecution(root)!.tasks.T1).toMatchObject({ stage: 'validate', agent: null });
    expect(step().actions.find(a => a.task === 'T1')).toMatchObject({ type: 'validatorsRound', implementer: agent });
    expect(readExecution(root)!.tasks.T1).toMatchObject({ stage: 'implement', agent });
  });
  it('a task integrated whose roadmap state is not done gets its integrated action again, with its commit (M2)', () => {
    step();
    commitIn(wt('T1'), 'src/t1/a.ts', 'x\n', 'T1: a');
    out(run(['swarm', 'task', 'T1', '--stage', 'verdict', '--status', 'accepted', '--no-agent'], io));
    const first = step().actions.find(a => a.type === 'integrated')!;
    expect(first).toMatchObject({ task: 'T1', commit: { title: 'T1: a' } });
    writeFileSync(path.join(root, 'db', 'state', 'T1.json'), JSON.stringify({ status: 'in_progress', version: 3 }));
    expect(step().actions.filter(a => a.task === 'T1')).toEqual([expect.objectContaining({ type: 'integrated', task: 'T1', sha: (first.commit as { sha: string }).sha, commit: first.commit })]);
    writeFileSync(path.join(root, 'db', 'state', 'T1.json'), JSON.stringify({ status: 'done', version: 4 }));
    expect(step().actions.filter(a => a.task === 'T1')).toEqual([]);
  });
  it('the integrated action again carries the publish and the metrics of a normal integrate: the task done with its commit (final review I3)', () => {
    step();
    commitIn(wt('T1'), 'src/t1/a.ts', 'x\n', 'T1: a');
    out(run(['swarm', 'task', 'T1', '--stage', 'verdict', '--status', 'accepted', '--no-agent'], io));
    const first = step().actions.find(a => a.type === 'integrated')!;
    const finishedAt = readExecution(root)!.tasks.T1.finishedAt;
    writeFileSync(path.join(root, 'db', 'state', 'T1.json'), JSON.stringify({ status: 'in_progress', version: 3 }));
    const again = step().actions.find(a => a.task === 'T1')!;
    expect(again).toMatchObject({ type: 'integrated', again: true, publish: { op: 'update', collection: 'state', doc_id: 'T1' },
      metrics: { op: 'update', collection: 'meta', doc_id: 'metrics', data: { lastCommit: { sha: (first.commit as { sha: string }).sha } } } });
    expect(again.metrics).toEqual(first.metrics);
    const data = JSON.parse(readFileSync((again.publish as { file_path: string }).file_path, 'utf8'));
    expect(data).toMatchObject({ status: 'done', doneAt: finishedAt, commits: [first.commit], forge: { v: 2, stage: 'done' }, exec: { __delete__: true } });
  });
  it('finds an integration by its exact title when the task branch moved since: T1 is never T10\'s merge (M2)', () => {
    step();
    commitIn(wt('T1'), 'src/t1/a.ts', 'x\n', 'T1: a');
    out(run(['swarm', 'task', 'T1', '--stage', 'verdict', '--status', 'accepted', '--no-agent'], io));
    const first = step().actions.find(a => a.type === 'integrated')!;
    expect(first).toMatchObject({ task: 'T1' });
    // A later merge titled for T10 on the run branch, and task/T1 moved on: its tip is no merge's second parent now.
    const runWt = path.join(root, '.claude', 'worktrees', 'run');
    g(runWt, 'checkout', '-q', '-b', 'side');
    commitIn(runWt, 'side.txt', 'x\n', 'side');
    g(runWt, 'checkout', '-q', 'forge/run-shop');
    g(runWt, 'merge', '-q', '--no-ff', '-m', 'forge: integrate T10', 'side');
    commitIn(wt('T1'), 'src/t1/b.ts', 'y\n', 'T1: after');
    writeFileSync(path.join(root, 'db', 'state', 'T1.json'), JSON.stringify({ status: 'in_progress', version: 3 }));
    expect(step().actions.find(a => a.task === 'T1')).toMatchObject({ type: 'integrated', again: true, sha: (first.commit as { sha: string }).sha });
  });
  it('stamps each hand-out with the time it happens, not the time the step started (M7)', () => {
    let k = 0;
    io = { ...io, now: () => new Date(NOW.getTime() + 60000 * k++) };
    step();
    const leaseOf = (task: string) => JSON.parse(readFileSync(path.join(root, '.forge', 'execution', `${task}.json`), 'utf8')).leaseUntil as string;
    expect(Date.parse(leaseOf('T2'))).toBeGreaterThan(Date.parse(leaseOf('T1')));
  });
  it('redo: stage implement at the next round, its revert carried (M9)', () => {
    reviewedT1();
    const revert = { base: 'b', head: 'h', args: ['-C', wt('T1'), 'revert', '--no-edit', 'b..HEAD'] };
    const s = stepClosing(() => ({ ...ASK_CLOSE, ask: null, next: 'redo', implementer: { agent: 'forge-impl-high', role: 'impl-high' }, handover: '.forge/work/shop/T1/handover-1-1.md', revert }));
    expect(s.actions.filter(a => a.task === 'T1')).toEqual([expect.objectContaining({ type: 'redo', implementer: { agent: 'forge-impl-high', role: 'impl-high' }, handover: '.forge/work/shop/T1/handover-1-1.md', revert, taskLine: 'forge-task: T1-1 @shop' })]);
    expect(readExecution(root)!.tasks.T1).toMatchObject({ stage: 'implement', agent: 'forge-impl-high', round: 2 });
  });
  it('freshImplementer carries its handover; the new implementer is logged (M9)', () => {
    reviewedT1();
    const s = stepClosing(() => ({ ...ASK_CLOSE, ask: null, next: 'fresh-stronger', implementer: { agent: 'forge-impl-high', role: 'impl-high' }, handover: '.forge/work/shop/T1/handover-1-1.md' }));
    expect(s.actions.find(a => a.task === 'T1')).toMatchObject({ type: 'freshImplementer', handover: '.forge/work/shop/T1/handover-1-1.md', implementer: { agent: 'forge-impl-high' }, taskLine: 'forge-task: T1-1 @shop' });
    expect(readEvents(root).filter(e => e.kind === 'agent' && e.task === 'T1-1').at(-1)).toMatchObject({ agent: 'forge-impl-high', role: 'impl-high' });
    expect(stageOf('T1')).toBe('implement');
  });
  it('blocked: blocked.txt with its reasons, and the task blocked (M9)', () => {
    reviewedT1();
    const s = stepClosing(() => ({ ...ASK_CLOSE, ask: null, next: 'breaker', reasons: ['the same finding three times'] }));
    expect(s.actions.find(a => a.task === 'T1')).toMatchObject({ type: 'blocked', next: 'breaker', reasons: ['the same finding three times'] });
    expect(readFileSync(path.join(root, '.forge', 'work', 'shop', 'T1', 'blocked.txt'), 'utf8')).toContain('breaker: the same finding three times');
    expect(readExecution(root)!.tasks.T1.status).toBe('blocked');
  });
  it('an express review closes normally once its validators file arrives (M9)', () => {
    step();
    commitIn(wt('T1'), 'src/t1/a.ts', 'x\n', 'T1: a');
    const review = step('--returned', 'T1').actions.find(a => a.task === 'T1')!;
    const dir = path.join(root, '.forge', 'work', 'shop', 'T1');
    const planFile = path.join(dir, 'reviews-1-1', 'review-plan.json');
    writeFileSync(planFile, JSON.stringify({ ...JSON.parse(readFileSync(planFile, 'utf8')), express: true, validatorsPending: true }));
    rmSync(path.join(dir, 'validators-1.json'), { force: true });
    for (const e of (review.spawn as { role: string; twin?: boolean }[]).filter(e => !e.twin)) writeFileSync(path.join(dir, 'reviews-1-1', `${e.role.replace(/^review-/, '')}.json`), pass);
    const waiting = stepWith(() => false);
    expect(waiting.actions.filter(a => a.task === 'T1')).toEqual([]);
    expect(waiting.calls.filter(a => isCmd(a, 'review-close'))).toEqual([]);
    writeFileSync(path.join(dir, 'validators-1.json'), '[]\n');
    expect(step().actions.find(a => a.task === 'T1')).toMatchObject({ type: 'accepted' });
  });
  it('in mode sessions, the tick\'s start passes through with its launch (M9)', () => {
    expect(run(['swarm', 'stop'], io).code).toBe(0);
    out(run(['swarm', 'start', '--project', 'shop', '--session', 'main', '--mode', 'sessions'], io));
    const s = stepWith(() => false);
    const starts = s.actions.filter(a => a.type === 'start');
    expect(starts.map(a => a.task)).toEqual(['T1', 'T2']);
    for (const a of starts) expect(a.launch).toEqual(expect.arrayContaining(['launch']));
    expect(s.calls.filter(a => isCmd(a, 'brief') || isCmd(a, 'prep'))).toEqual([]);
  });
});

describe('swarm step: one at a time (I4)', () => {
  const lockFile = () => path.join(root, '.forge', 'jobs', 'step.lock');
  const stepAlive = (alive: boolean) => {
    const calls: string[][] = [];
    const r = swarmStep(['--plan', 'plan.yaml', '--db', 'db'], io, { cli: argv => { calls.push(argv); return run(argv, io); }, gitAt: d => defaultGit(d), alive: () => alive });
    return { r, calls };
  };
  it('a live step.lock makes the step print busy and run nothing; a dead or old one is taken over and released', () => {
    mkdirSync(path.dirname(lockFile()), { recursive: true });
    writeFileSync(lockFile(), JSON.stringify({ pid: 424242, startedAt: NOW.toISOString() }));
    const busy = stepAlive(true);
    expect(busy.r.code).toBe(0);
    expect(JSON.parse(busy.r.stdout)).toEqual({ busy: { pid: 424242, startedAt: NOW.toISOString() } });
    expect(busy.calls).toEqual([]);
    expect(existsSync(lockFile())).toBe(true);
    const dead = stepAlive(false);
    expect(JSON.parse(dead.r.stdout).actions.filter((a: Action) => a.type === 'spawnImplementer').map((a: Action) => a.task)).toEqual(['T1', 'T2']);
    expect(existsSync(lockFile())).toBe(false);
    writeFileSync(lockFile(), JSON.stringify({ pid: 424242, startedAt: new Date(NOW.getTime() - 3 * 3600_000).toISOString() }));
    expect(stepAlive(true).calls.length).toBeGreaterThan(0);
    expect(existsSync(lockFile())).toBe(false);
  });
  it('with --out, busy is what step.json holds', () => {
    mkdirSync(path.dirname(lockFile()), { recursive: true });
    // A live process that is not this one: the one that started the test runner.
    writeFileSync(lockFile(), JSON.stringify({ pid: process.ppid, startedAt: NOW.toISOString() }));
    expect(run(['swarm', 'step', '--plan', 'plan.yaml', '--db', 'db', '--out', '.forge/work/run/step.json'], io).code).toBe(0);
    expect(JSON.parse(readFileSync(path.join(root, '.forge', 'work', 'run', 'step.json'), 'utf8'))).toMatchObject({ busy: { pid: process.ppid } });
  });
});

describe('swarm step: the person presses Stop while a step starts a task (K2-02)', () => {
  // The tick of the step started T1 and T2; /forge:stop runs (forge stop, then swarm close) just before the step's
  // `swarm worktree T1`, or between it and `swarm task T1 --stage implement`. Whatever the step does after, it starts nothing.
  it.each(['worktree', 'task'])('stopped and closed before the step\'s swarm %s T1: no task runs, no implementer, no claim', sub => {
    let pressed = false;
    const s = stepWith(argv => {
      if (!pressed && isCmd(argv, 'swarm', sub, 'T1')) { pressed = true; out(run(['stop'], io)); out(run(['swarm', 'close'], io)); }
      return false;
    });
    expect(pressed).toBe(true);
    expect(s.actions).toContainEqual(expect.objectContaining({ type: 'error', task: 'T1', command: `swarm ${sub}`, code: 2 }));
    expect(s.actions.filter(a => a.type === 'spawnImplementer')).toEqual([]);
    expect(s.publish.tasks.filter(x => x.claim)).toEqual([]);
    expect(s.running).toBe(0);
    const e = readExecution(root)!;
    expect(e).toMatchObject({ active: false, stopReason: 'stopped', closedBy: 'close' });
    expect(Object.entries(e.tasks).filter(([, t]) => t.status === 'running')).toEqual([]);
    expect(e.tasks.T1?.stage ?? 'brief').toBe('brief');
  });
});

describe('swarm step briefs a resumed task with its earlier attempt (D-02)', () => {
  // task/T1 survived an earlier attempt of this plan, with its worktree; that attempt's prep logged its phase implement.
  const earlier = () => {
    g(root, 'worktree', 'add', '-q', '-b', 'task/T1', wt('T1'), 'forge/run-shop');
    appendEvent(root, { ts: new Date(NOW.getTime() - 60000).toISOString(), kind: 'phase', task: 'T1', phase: 'implement', brief: 1, base: g(root, 'rev-parse', 'forge/run-shop'), project: 'shop' });
  };
  it('writes prior.json and the brief carries the commits the task branch already had', () => {
    // The tick starts T1 again on it.
    earlier();
    commitIn(wt('T1'), 'src/t1/a.ts', 'x\n', 'T1: first try');
    step();
    const work = path.join(root, '.forge', 'work', 'shop', 'T1');
    expect(readFileSync(path.join(work, 'brief-1.md'), 'utf8')).toContain('## Previous attempt');
    expect(JSON.parse(readFileSync(path.join(work, 'prior.json'), 'utf8'))).toEqual([{ sha: g(wt('T1'), 'rev-parse', 'HEAD'), title: 'T1: first try' }]);
  });
  it('prep, the implementer and the review take the BASE swarm worktree printed: the review diffs the earlier commits too, on a baseline run in the run worktree', () => {
    const fork = g(root, 'rev-parse', 'forge/run-shop');
    earlier();
    commitIn(wt('T1'), 'src/t1/a.ts', 'x\n', 'T1: first try');
    const s = stepWith(() => false);
    const prep = s.calls.find(a => isCmd(a, 'prep') && a.includes('T1-1'))!;
    expect(prep[prep.indexOf('--base') + 1]).toBe(fork);
    expect(s.actions.find(a => a.type === 'spawnImplementer' && a.task === 'T1')).toMatchObject({ base: fork, validate: expect.stringContaining(`--base ${fork} `) });
    expect(readEvents(root).filter(e => e.kind === 'phase' && e.task === 'T1').at(-1)).toMatchObject({ base: fork, head: g(wt('T1'), 'rev-parse', 'HEAD') });
    // Back with no commit of its own: its report is handed over; the earlier attempt alone is not sent to review.
    writeFileSync(path.join(root, '.forge', 'work', 'shop', 'T1', 'report-1.txt'), 'NEEDS_CONTEXT: which format?\n');
    expect(step('--returned', 'T1').actions.filter(a => a.task === 'T1')).toEqual([{ type: 'readReport', task: 'T1', report: '.forge/work/shop/T1/report-1.txt' }]);
    commitIn(wt('T1'), 'src/t1/b.ts', 'y\n', 'T1: b');
    const r = stepWith(() => false, '--returned', 'T1');
    expect(r.actions.find(a => a.task === 'T1')).toMatchObject({ type: 'spawnReviewers', base: fork });
    const diff = readFileSync(path.join(root, '.forge', 'work', 'shop', 'T1', 'diff-1.patch'), 'utf8');
    for (const f of ['src/t1/a.ts', 'src/t1/b.ts']) expect(diff).toContain(f);
    // The worktree is past BASE: what already failed there is not excused; the baseline runs where the run branch is.
    const runWt = path.join(root, '.claude', 'worktrees', 'run');
    expect(r.calls.filter(a => isCmd(a, 'validate'))).toEqual([['validate', '--all', '--path', 'large', '--base-run', '--task', 'T1-1', '--cwd', runWt]]);
    expect(JSON.parse(readFileSync(path.join(root, '.forge', 'work', 'shop', 'T1', 'base-1.json'), 'utf8'))).toMatchObject({ base: fork, from: null });
  });
  it('a start left at stage brief after its prep reuses that prep on the same BASE and HEAD', () => {
    earlier();
    commitIn(wt('T1'), 'src/t1/a.ts', 'x\n', 'T1: first try');
    const s = stepWith(argv => isCmd(argv, 'swarm', 'task', 'T1') && argv.includes('implement'));
    expect(s.actions).toContainEqual(expect.objectContaining({ type: 'error', task: 'T1', command: 'swarm task' }));
    const again = stepWith(() => false);
    expect(again.calls.filter(a => isCmd(a, 'prep'))).toEqual([]);
    expect(again.actions.find(a => a.type === 'spawnImplementer' && a.task === 'T1')).toMatchObject({ base: g(root, 'rev-parse', 'forge/run-shop') });
  });
});

describe('a run is the project of its plan (D-08)', () => {
  it('swarm start and swarm step refuse a plan of another project, before anything moves', () => {
    writeFileSync(path.join(root, 'web.yaml'), PLAN.replace('project: shop', 'project: web'));
    const runId = readExecution(root)!.runId;
    const start = run(['swarm', 'start', '--project', 'shop-v2', '--session', 'main', '--plan', 'plan.yaml'], io);
    expect(start.code).toBe(2);
    expect(start.stderr).toContain('the plan says project "shop" but the run is "shop-v2"');
    expect(start.stderr).toContain('--project shop');
    expect(g(root, 'branch', '--list', 'forge/run-shop-v2')).toBe('');
    expect(readExecution(root)!.runId).toBe(runId);
    // The plan of the run's own project resumes it as before.
    expect(out(run(['swarm', 'start', '--project', 'shop', '--session', 'main', '--plan', 'plan.yaml'], io)).runId).toBe(runId);
    const s = run(['swarm', 'step', '--plan', 'web.yaml', '--db', 'db'], io);
    expect(s.code).toBe(2);
    expect(s.stderr).toContain('the plan says project "web" but the run is "shop"');
    expect(s.stderr).toContain('--project web');
    expect(existsSync(wt('T1'))).toBe(false);
    expect(readExecution(root)!.tasks).toEqual({});
    expect(readEvents(root).filter(e => e.kind === 'triage')).toEqual([]);
  });
  it("a step keeps apart the events of another plan's T1 in the same ledger: its round, its implementer and its BASE", () => {
    const web = { project: 'web' };
    const at = (min: number) => `2026-10-12T11:${String(min).padStart(2, '0')}:00.000Z`;
    // The plan web ran its own T1 in this checkout before.
    appendEvent(root, { ts: at(0), kind: 'triage', task: 'T1', path: 'large', ...web });
    const t1 = step().actions.find(a => a.type === 'spawnImplementer' && a.task === 'T1')!;
    expect(t1.role).not.toBe('mech');
    // ...and goes on with it while shop's T1 runs: each of its events carries its project (C4).
    appendEvent(root, { ts: at(1), kind: 'agent', task: 'T1-1', agent: 'forge-mech', role: 'mech', ...web });
    appendEvent(root, { ts: at(2), kind: 'verdict', task: 'T1-1', dir: '.forge/work/web/T1/reviews-1-1', action: 'fix', score: 0.4, signature: 'v2:a', ...web });
    appendEvent(root, { ts: at(3), kind: 'verdict', task: 'T1-1', dir: '.forge/work/web/T1/reviews-1-2', action: 'fix', score: 0.4, signature: 'v2:b', ...web });
    appendEvent(root, { ts: at(4), kind: 'phase', task: 'T1', phase: 'implement', brief: 2, base: 'feedfacefeedfacefeedfacefeedfacefeedface', ...web });
    commitIn(wt('T1'), 'src/t1/a.ts', 'x\n', 'T1: a');
    const review = step('--returned', 'T1').actions.find(a => a.task === 'T1')!;
    expect(review).toMatchObject({ type: 'spawnReviewers', round: 1, base: t1.base });
    const dir = path.join(root, '.forge', 'work', 'shop', 'T1', 'reviews-1-1');
    for (const e of (review.spawn as { role: string; twin?: boolean }[]).filter(e => !e.twin)) {
      writeFileSync(path.join(dir, `${e.role.replace(/^review-/, '')}.json`), JSON.stringify({ verdict: 'fail', confidence: 0.9, findings: [{ severity: 'important', file: 'src/t1/a.ts', line: 1, problem: 'wrong' }] }));
    }
    expect(step().actions.find(a => a.task === 'T1')).toMatchObject({ type: 'resumeImplementer', implementer: { role: t1.role } });
  });
});

describe("swarm step keeps a plan task's files in its project's work folder (D-08)", () => {
  const spawned = (a: Action) => (a.spawn as { role: string; twin?: boolean }[]).filter(e => !e.twin).map(e => e.role.replace(/^review-/, ''));
  it('start, review, a respawn, accept and integrate: every file is in .forge/work/shop/T1, none in .forge/work/T1', () => {
    const work = path.join(root, '.forge', 'work', 'shop', 'T1');
    const s0 = stepWith(() => false);
    expect(s0.actions.find(a => a.task === 'T1')).toMatchObject({ type: 'spawnImplementer', brief: '.forge/work/shop/T1/brief-1.md', report: '.forge/work/shop/T1/report-1.txt' });
    expect(s0.calls.find(a => isCmd(a, 'prep') && a.includes('T1-1'))).toEqual(expect.arrayContaining(['--dir', '.forge/work/shop/T1']));
    for (const f of ['brief-1.md', 'prep-1.json', 'baseline-1.json']) expect(existsSync(path.join(work, f)), f).toBe(true);
    commitIn(wt('T1'), 'src/t1/a.ts', 'x\n', 'T1: a');
    writeFileSync(path.join(work, 'report-1.txt'), 'done\n');
    const s1 = stepWith(() => false);
    const review = s1.actions.find(a => a.task === 'T1')!;
    expect(review).toMatchObject({ type: 'spawnReviewers', round: 1 });
    expect(s1.calls.find(a => isCmd(a, 'review-prep'))).toEqual(expect.arrayContaining(['--baseline', '.forge/work/shop/T1/baseline-1.json', '--dir', '.forge/work/shop/T1']));
    const roundDir = path.join(work, 'reviews-1-1');
    for (const k of spawned(review)) writeFileSync(path.join(roundDir, `${k}.json`), k === 'correctness' ? '{"verdict":"maybe"}' : pass);
    expect(step().actions.find(a => a.task === 'T1')).toMatchObject({ type: 'respawnReviewers', reviewers: ['correctness'] });
    expect(existsSync(path.join(roundDir, 'respawned.json'))).toBe(true);
    writeFileSync(path.join(roundDir, 'correctness.json'), pass);
    const s2 = stepWith(() => false);
    expect(s2.calls.find(a => isCmd(a, 'review-close'))).toEqual(expect.arrayContaining(['--dir', '.forge/work/shop/T1']));
    expect(s2.actions.find(a => a.type === 'accepted')).toMatchObject({ task: 'T1' });
    expect(s2.actions.find(a => a.type === 'integrated')).toMatchObject({ task: 'T1', commit: { title: 'T1: a' } });
    expect(existsSync(path.join(root, '.forge', 'work', 'T1'))).toBe(false);
  });
  it('a task an earlier version started in .forge/work/T1 goes on there: review, accept, integrate', () => {
    step();
    // What an earlier version left: T1's files in .forge/work/T1; the ledger gives T1 the project shop (its triage --plan).
    const old = path.join(root, '.forge', 'work', 'T1');
    renameSync(path.join(root, '.forge', 'work', 'shop', 'T1'), old);
    commitIn(wt('T1'), 'src/t1/a.ts', 'x\n', 'T1: a');
    writeFileSync(path.join(old, 'report-1.txt'), 'done\n');
    const s1 = stepWith(() => false);
    const review = s1.actions.find(a => a.task === 'T1')!;
    expect(review).toMatchObject({ type: 'spawnReviewers', round: 1 });
    expect(s1.calls.find(a => isCmd(a, 'review-prep'))).toEqual(expect.arrayContaining(['--baseline', '.forge/work/T1/baseline-1.json', '--dir', '.forge/work/T1']));
    for (const k of spawned(review)) writeFileSync(path.join(old, 'reviews-1-1', `${k}.json`), pass);
    const s2 = stepWith(() => false);
    expect(s2.calls.find(a => isCmd(a, 'review-close'))).toEqual(expect.arrayContaining(['--dir', '.forge/work/T1']));
    expect(s2.actions.find(a => a.type === 'accepted')).toMatchObject({ task: 'T1' });
    expect(s2.actions.find(a => a.type === 'integrated')).toMatchObject({ task: 'T1', commit: { title: 'T1: a' } });
    expect(existsSync(path.join(root, '.forge', 'work', 'shop', 'T1'))).toBe(false);
  });
  it('a task at review in .forge/work/T1 stays there when verify-plan --dir makes .forge/work/shop/T1', () => {
    step();
    const old = path.join(root, '.forge', 'work', 'T1');
    renameSync(path.join(root, '.forge', 'work', 'shop', 'T1'), old);
    mkdirSync(path.join(wt('T1'), '.forge', 'verify'), { recursive: true });
    writeFileSync(path.join(wt('T1'), '.forge', 'verify', 'web.md'), '---\naffects: ["src/t1/**"]\n---\n# Web\n\nOpen the app.\n');
    g(wt('T1'), 'add', '-f', '.forge/verify/web.md'); g(wt('T1'), 'commit', '-qm', 'T1: the web surface');
    commitIn(wt('T1'), 'src/t1/a.ts', 'x\n', 'T1: a');
    expect(run(['local', 'set', 'surfaces.web', 'allowed', '--cwd', wt('T1')], io).code).toBe(0);
    writeFileSync(path.join(old, 'report-1.txt'), 'done\n');
    const review = step().actions.find(a => a.task === 'T1')!;
    expect(review).toMatchObject({ type: 'spawnReviewers', round: 1 });
    expect(stageOf('T1')).toBe('review');
    // The coordinator names the round by the new form (<WORK>): verify-plan makes the project's folder.
    expect(out(run(['verify-plan', '--task', 'T1-1', '--path', 'large', '--base', String(review.base), '--dir', '.forge/work/shop/T1/reviews-1-1', '--cwd', wt('T1')], io)).eligible).toBe(true);
    expect(existsSync(path.join(root, '.forge', 'work', 'shop', 'T1', 'reviews-1-1', 'verify-pending.json'))).toBe(true);
    for (const k of spawned(review)) writeFileSync(path.join(old, 'reviews-1-1', `${k}.json`), pass);
    const s = stepWith(() => false);
    expect(s.calls.find(a => isCmd(a, 'review-close'))).toEqual(expect.arrayContaining(['--dir', '.forge/work/T1']));
    expect(s.actions.find(a => a.type === 'accepted')).toMatchObject({ task: 'T1' });
  });
});

describe('every event a step writes carries the run project (C4)', () => {
  it('its own (the implementer it logs) and its commands\', even when another plan\'s T1 triage is the last one in the ledger', () => {
    let from = -1;
    swarmStep(['--plan', 'plan.yaml', '--db', 'db'], io, {
      cli: argv => {
        const r = run(argv, io);
        // Another plan's T1 is triaged while this step starts its T1: the ledger now attributes T1 to web.
        if (from < 0 && isCmd(argv, 'triage') && argv.includes('T1')) {
          appendEvent(root, { ts: NOW.toISOString(), kind: 'triage', task: 'T1', path: 'small', reasons: [], project: 'web' });
          from = readEvents(root).length;
        }
        return r;
      },
      gitAt: dir => defaultGit(dir),
    });
    expect(from).toBeGreaterThan(0);
    const later = readEvents(root).slice(from).filter(e => typeof e.task === 'string' && /^T1(-\d+)?$/.test(e.task));
    expect(later.map(e => e.kind)).toEqual(expect.arrayContaining(['phase', 'validate', 'agent']));
    expect(later.filter(e => e.project !== 'shop')).toEqual([]);
  });
});

describe('a new execution of the same plan task counts only its own reviews (carry 3)', () => {
  it('run A stopped after two review rounds; run B restarts the task with a full review cap and sees a NEEDS_CONTEXT return', () => {
    const work = path.join(root, '.forge', 'work', 'shop', 'T1');
    // Review 1 leaves three findings (no express review after it); review 2 keeps two of them open (no stall).
    const fail = (k: number) => JSON.stringify({ verdict: 'fail', confidence: 0.9, findings: [1, 2, 3].slice(0, 4 - k).map(i => ({ severity: 'important', file: 'src/t1/a.ts', line: 1, problem: `wrong ${i}` })) });
    const reviewed = (s: { actions: Action[] }, k: number) => {
      const a = s.actions.find(x => x.task === 'T1')!;
      expect(a).toMatchObject({ type: 'spawnReviewers', round: k });
      for (const e of (a.spawn as { role: string; twin?: boolean }[]).filter(e => !e.twin)) writeFileSync(path.join(work, `reviews-1-${k}`, `${e.role.replace(/^review-/, '')}.json`), fail(k));
      expect(step().actions.find(x => x.task === 'T1')?.type).toMatch(/^(resumeImplementer|freshImplementer)$/);
    };
    // Run A: two reviews ask for fixes; the third attempt is committed when the person stops the run.
    step();
    commitIn(wt('T1'), 'src/t1/a.ts', 'one\n', 'T1: a');
    reviewed(step('--returned', 'T1'), 1);
    commitIn(wt('T1'), 'src/t1/a.ts', 'two\n', 'T1: fix 1');
    reviewed(step('--returned', 'T1'), 2);
    commitIn(wt('T1'), 'src/t1/a.ts', 'three\n', 'T1: fix 2');
    out(run(['stop'], io));
    // Run B, an hour later: a new execution of the same plan restarts T1 on its branch, with brief 1 again.
    io = { ...io, now: () => new Date(NOW.getTime() + 3600_000) };
    expect(out(run(['swarm', 'start', '--project', 'shop', '--session', 'main'], io)).replaced).toMatchObject({ stopReason: 'stopped' });
    expect(step().actions.find(a => a.task === 'T1')).toMatchObject({ type: 'spawnImplementer' });
    // A's rounds are set aside: nothing of them reads as B's.
    expect(readdirSync(work).filter(f => /^reviews-1-\d+$/.test(f))).toEqual([]);
    const aside = readdirSync(work).filter(f => f.startsWith('earlier-'));
    expect(aside).toHaveLength(1);
    expect(readdirSync(path.join(work, aside[0])).sort()).toEqual(expect.arrayContaining(['reviews-1-1', 'reviews-1-2']));
    // B's implementer comes back with NEEDS_CONTEXT and no commit: seen, not reviewed.
    writeFileSync(path.join(work, 'report-1.txt'), 'NEEDS_CONTEXT: which format?\n');
    expect(step('--returned', 'T1').actions).toContainEqual({ type: 'readReport', task: 'T1', report: '.forge/work/shop/T1/report-1.txt' });
    // With a commit, B's first review is review 1 of the full cap, in a round folder of its own.
    commitIn(wt('T1'), 'src/t1/a.ts', 'four\n', 'T1: B');
    const first = stepWith(() => false, '--returned', 'T1');
    expect(first.actions.find(a => a.task === 'T1')).toMatchObject({ type: 'spawnReviewers', round: 1 });
    expect(first.calls.filter(a => isCmd(a, 'review-prep'))).toHaveLength(1);
    expect(existsSync(path.join(work, 'reviews-1-1', 'correctness.json'))).toBe(false);
    expect(step().actions.filter(a => a.task === 'T1')).toEqual([]);
    // Its verdict is round 1 of B's cap: a resume of its implementer, not the fresh one A's two verdicts would bring.
    for (const e of (first.actions.find(a => a.task === 'T1')!.spawn as { role: string; twin?: boolean }[]).filter(e => !e.twin)) {
      writeFileSync(path.join(work, 'reviews-1-1', `${e.role.replace(/^review-/, '')}.json`), fail(1));
    }
    expect(step().actions.find(a => a.task === 'T1')).toMatchObject({ type: 'resumeImplementer' });
    expect(readEvents(root).filter(e => e.kind === 'round' && e.task === 'T1-1').at(-1)).toMatchObject({ round: 1, next: 'resume' });
  });
  it('the writes of a step share one read of the ledger: publishOf reads it once for all its tasks', () => {
    const reads: string[] = [];
    const spy = vi.spyOn(ledger, 'readEvents').mockImplementation(((root: string) => {
      if (new Error().stack?.includes('publishOf')) reads.push(root);
      return spyOrig(root);
    }) as typeof ledger.readEvents);
    try {
      const s = step();
      expect(s.publish.tasks.length).toBeGreaterThanOrEqual(2);
      expect(s.publish.tasks.every(x => x.write !== null)).toBe(true);
    } finally { spy.mockRestore(); }
    expect(reads).toHaveLength(1);
  });
  it('the publish of a task back from its implementer is the same file roadmap-doc gives (J-15)', () => {
    step();
    commitIn(wt('T1'), 'src/t1/a.ts', 'export const a = 1;\n', 'T1: a');
    writeFileSync(path.join(root, '.forge', 'work', 'shop', 'T1', 'report-1.txt'), 'done\n');
    const s = step();
    const t1 = s.publish.tasks.find(x => x.task === 'T1')!;
    expect(t1).toMatchObject({ write: { op: 'update', collection: 'state', doc_id: 'T1' } });
    expect(t1).not.toHaveProperty('claim');
    expect(t1).not.toHaveProperty('event');
    const fromStep = JSON.parse(readFileSync(t1.write!.file_path, 'utf8'));
    expect(fromStep.forge).toMatchObject({ v: 2, stage: 'review' });
    const again = out(run(['roadmap-doc', 'T1', '--project', 'shop', '--out', 'again.json'], io));
    expect(JSON.parse(readFileSync(again.file, 'utf8'))).toEqual(fromStep);
  });
});

describe('swarm step hands out the task line of each agent (E-02)', () => {
  it('spawnImplementer and every entry of spawnReviewers carry forge-task: <T>-<n> @<project>', () => {
    const start = step().actions.find(a => a.type === 'spawnImplementer' && a.task === 'T1')!;
    expect(start.taskLine).toBe('forge-task: T1-1 @shop');
    commitIn(wt('T1'), 'src/t1/a.ts', 'export const a = 1;\n', 'T1: a');
    writeFileSync(path.join(root, String(start.report)), 'done\n');
    const review = step().actions.find(a => a.task === 'T1' && a.type === 'spawnReviewers')!;
    const spawn = review.spawn as { taskLine?: string }[];
    expect(spawn.length).toBeGreaterThan(0);
    for (const e of spawn) expect(e.taskLine).toBe('forge-task: T1-1 @shop');
  });
  it('respawnReviewers and an express review carry it in each spawn entry too', () => {
    step();
    commitIn(wt('T1'), 'src/t1/a.ts', 'export const a = 1;\n', 'T1: a');
    const review = step('--returned', 'T1').actions.find(a => a.task === 'T1' && a.type === 'spawnReviewers')!;
    const dir = path.join(root, '.forge', 'work', 'shop', 'T1', 'reviews-1-1');
    // The correctness reviewer leaves a file that does not validate: it runs again, with its task line.
    for (const e of (review.spawn as { role: string; twin?: boolean }[]).filter(e => !e.twin)) {
      writeFileSync(path.join(dir, `${e.role.replace(/^review-/, '')}.json`), e.role === 'review-correctness' ? '{"verdict":"maybe"}' : pass);
    }
    const again = step().actions.find(a => a.task === 'T1')!;
    expect(again).toMatchObject({ type: 'respawnReviewers' });
    expect((again.spawn as { taskLine?: string }[]).map(e => e.taskLine)).toEqual(['forge-task: T1-1 @shop']);
    // It asks for one important fix; once the implementer commits it, review 2 is an express one.
    writeFileSync(path.join(dir, 'correctness.json'), JSON.stringify({ verdict: 'fail', confidence: 0.9, findings: [{ severity: 'important', file: 'src/t1/a.ts', line: 1, problem: 'wrong' }] }));
    expect(step().actions.find(a => a.task === 'T1')).toMatchObject({ type: 'resumeImplementer' });
    commitIn(wt('T1'), 'src/t1/a.ts', 'export const a = 2;\n', 'T1: fix');
    const express = step('--returned', 'T1').actions.find(a => a.task === 'T1')!;
    expect(express).toMatchObject({ type: 'express' });
    const entries = express.spawn as { taskLine?: string }[];
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) expect(e.taskLine).toBe('forge-task: T1-1 @shop');
  });
});
