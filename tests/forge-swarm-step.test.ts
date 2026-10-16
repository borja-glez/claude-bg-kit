import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run as cli, defaultGit, type Io } from '../src/forge/cli/run.js';
import { readExecution } from '../src/forge/execution.js';
import { readEvents } from '../src/forge/ledger.js';
import { swarmStep, stepSay } from '../src/forge/cli/step.js';

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
  it('a reviewer respawned for an invalid file is waited for, and a step that dies before its end respawns it again (Review Focus 4)', () => {
    step();
    commitIn(wt('T1'), 'src/t1/a.ts', 'x\n', 'T1: a');
    const review = step('--returned', 'T1').actions.find(a => a.task === 'T1')!;
    const dir = path.join(root, '.forge', 'work', 'T1', 'reviews-1-1');
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
    const dir = path.join(root, '.forge', 'work', 'T1', 'reviews-1-1');
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
    expect(s.publish.tasks.find(x => x.task === 'T1')).toMatchObject({ claim: true, exec: { stage: 'implement' } });
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
    const baseline = path.join(root, '.forge', 'work', 'T1', 'baseline-1.json');
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
    expect(readdirSync(path.join(root, '.forge', 'work', 'T1')).filter(d => d.startsWith('reviews-'))).toEqual(['reviews-1-1']);
  });
  it('after a validators round, an implementer back with no new commit hands its report over (C-08)', () => {
    step();
    mkdirSync(path.join(wt('T1'), '.forge'), { recursive: true });
    writeFileSync(path.join(wt('T1'), '.forge', 'config.yaml'), 'detect: false\nvalidators:\n  - name: check\n    cmd: node -e "process.exit(require(\'fs\').existsSync(\'bad.txt\')?1:0)"\n');
    commitIn(wt('T1'), 'bad.txt', 'x\n', 'T1: bad');
    expect(step('--returned', 'T1').actions.find(a => a.task === 'T1')).toMatchObject({ type: 'validatorsRound' });
    expect(stageOf('T1')).toBe('implement');
    writeFileSync(path.join(root, '.forge', 'work', 'T1', 'report-1.txt'), 'BLOCKED: the check needs a server\n');
    expect(step('--returned', 'T1').actions.filter(a => a.task === 'T1')).toEqual([{ type: 'readReport', task: 'T1', report: '.forge/work/T1/report-1.txt' }]);
    expect(stageOf('T1')).toBe('implement');
    expect(existsSync(path.join(root, '.forge', 'work', 'T1', 'validators-fix-1-1-2.json'))).toBe(false);
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
    const diff = readFileSync(path.join(root, '.forge', 'work', 'T3', 'diff-1.patch'), 'utf8');
    expect(diff).toContain('src/t3/c.ts');
    expect(diff).not.toContain('src/t2/b.ts');
    expect(JSON.parse(readFileSync(path.join(root, '.forge', 'work', 'T3', 'base-1.json'), 'utf8'))).toMatchObject({ base: moved });
    // The next round keeps that base and does not run the baseline again.
    const dir = path.join(root, '.forge', 'work', 'T3', 'reviews-1-1');
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
    expect(existsSync(path.join(root, '.forge', 'work', 'T1', 'base-1.json'))).toBe(false);
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
    run(['swarm', 'stop'], io);
    expect(run(['swarm', 'step', '--plan', 'plan.yaml', '--db', 'db'], io)).toMatchObject({ code: 2, stderr: 'swarm step: the execution is not active\n' });
  });
});
