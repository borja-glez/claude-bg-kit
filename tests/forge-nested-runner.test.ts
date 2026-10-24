import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { run as cli, defaultGit, type Io } from '../src/forge/cli/run.js';
import { readExecution } from '../src/forge/execution.js';
import { appendEvent, readEvents } from '../src/forge/ledger.js';
import { parseConfig, ConfigError } from '../src/forge/config.js';
import { startAnnounce, type StartFacts } from '../src/forge/swarm.js';
import { stepSay } from '../src/forge/cli/step.js';
import { useTempDirs } from './helpers/tmp.js';
import { seedExecution } from './helpers/execution.js';
const tmp = useTempDirs();

// A10: the nested task runner. swarm start binds Claude's session id (C1): io.env is {} and the id comes as a flag.
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
const NOW = new Date('2026-10-12T12:00:00.000Z');
const NESTED = 'validators: []\nswarm:\n  nested: true\n';
let root = '';
let io: Io;
type Action = { type: string; task?: string; [k: string]: unknown };
const g = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
const out = (r: { stdout: string; code: number; stderr: string }) => { if (r.code !== 0) throw new Error(r.stderr); return JSON.parse(r.stdout); };
const wt = (task: string) => path.join(root, '.claude', 'worktrees', `task-${task}`);
const work = (task: string) => path.join(root, '.forge', 'work', 'shop', task);
const commitIn = (cwd: string, file: string, text: string, msg: string) => {
  mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
  writeFileSync(path.join(cwd, file), text);
  g(cwd, 'add', file); g(cwd, 'commit', '-qm', msg);
};
const step = (...extra: string[]) => out(run(['swarm', 'step', '--plan', 'plan.yaml', '--db', 'db', ...extra], io)) as { actions: Action[]; publish: { tasks: { task: string; claim?: true }[] }; say: string };
/** A repository with the plan, `config` as its .forge/config.yaml and an execution started in English; swarm start's output. */
function setup(config: string, ...startArgs: string[]): { announce: string[] } {
  root = tmp('forge-nested-');
  g(root, 'init', '-q', '-b', 'main'); g(root, 'config', 'user.email', 'a@b.c'); g(root, 'config', 'user.name', 't'); g(root, 'config', 'core.autocrlf', 'false');
  writeFileSync(path.join(root, 'plan.yaml'), PLAN);
  writeFileSync(path.join(root, '.gitignore'), '.forge/\n.claude/\n');
  g(root, 'add', '.'); g(root, 'commit', '-qm', 'init');
  mkdirSync(path.join(root, '.forge'), { recursive: true });
  writeFileSync(path.join(root, '.forge', 'config.yaml'), config);
  io = { cwd: root, now: () => NOW, git: defaultGit(root), sleep: () => undefined, env: {} };
  const started = out(run(['swarm', 'start', '--project', 'shop', '--session', 'main', '--locale', 'en', ...startArgs], io));
  for (const c of ['state', 'sessions']) mkdirSync(path.join(root, 'db', c), { recursive: true });
  return started;
}
afterEach(() => { try { if (root) g(root, 'worktree', 'prune'); } catch { /* ignore */ } });

const ON_EN = 'Each task is driven by a nested runner (forge-runner, Opus at medium effort, swarm.nested); its reviewers stay independent agents.';
const ON_ES = 'Cada tarea la lleva un runner anidado (forge-runner, Opus a esfuerzo medio, swarm.nested); sus revisores siguen siendo agentes independientes.';
const OFF_EN = 'swarm.nested applies only to a plan run in subagents mode: this run does not use it.';
const OFF_ES = 'swarm.nested solo vale en la ejecución de un plan en modo subagentes: esta ejecución no lo usa.';

describe('swarm.nested and the CLI pieces of the nested runner (A10)', () => {
  it('swarm.nested: absent by default, a boolean when set; anything else is refused', () => {
    expect(parseConfig(null).swarm.nested).toBeUndefined();
    expect(parseConfig('swarm:\n  nested: true\n').swarm.nested).toBe(true);
    expect(parseConfig('swarm:\n  nested: false\n').swarm.nested).toBe(false);
    for (const bad of ['yes', 'on', '1']) expect(() => parseConfig(`swarm:\n  nested: ${bad}\n`), bad).toThrow(ConfigError);
  });
  it('swarm task --lease-minutes sets the public lease that many minutes ahead; out of range, not whole or with --lease it exits 2', () => {
    setup(NESTED);
    out(run(['swarm', 'tick', '--plan', 'plan.yaml', '--db', 'db'], io));
    out(run(['swarm', 'task', 'T1', '--stage', 'implement', '--agent', 'forge-impl', '--lease-minutes', '90'], io));
    const pub = JSON.parse(readFileSync(path.join(root, '.forge', 'execution', 'T1.json'), 'utf8'));
    expect(pub.leaseUntil).toBe(new Date(NOW.getTime() + 90 * 60000).toISOString());
    for (const bad of ['0', '91', '1.5', 'x']) {
      const r = run(['swarm', 'task', 'T1', '--lease-minutes', bad], io);
      expect(r.code, bad).toBe(2);
      expect(r.stderr, bad).toContain('--lease-minutes');
    }
    const both = run(['swarm', 'task', 'T1', '--lease', NOW.toISOString(), '--lease-minutes', '5'], io);
    expect(both.code).toBe(2);
    expect(both.stderr).toContain('use --lease or --lease-minutes, not both');
  });
  it('announce says the nested runner in a plan run of mode subagents, and that it is not used in any other run', () => {
    const facts: StartFacts = { es: false, kind: 'plan', resume: false, runId: 'shop-1', mode: 'subagents', parallel: 3, branch: 'forge/run-shop', base: 'main', mergeOnFinish: false, loose: 0, setup: null };
    expect(startAnnounce({ ...facts, nested: 'on' })).toContain(ON_EN);
    expect(startAnnounce({ ...facts, es: true, nested: 'on' })).toContain(ON_ES);
    expect(startAnnounce({ ...facts, mode: 'sessions', nested: 'ignored' })).toContain(OFF_EN);
    expect(startAnnounce({ ...facts, es: true, nested: 'ignored' })).toContain(OFF_ES);
    for (const nested of [undefined, null]) expect(startAnnounce({ ...facts, nested }).join('\n')).not.toContain('swarm.nested');
    expect(setup(NESTED).announce).toContain(ON_EN);
    expect(setup(NESTED, '--mode', 'sessions').announce).toContain(OFF_EN);
    expect(setup('validators: []\n').announce.join('\n')).not.toContain('swarm.nested');
  });
});

const runnerDoc = (task: string) => JSON.parse(readFileSync(path.join(work(task), 'runner.json'), 'utf8'));
const later = (minutes: number) => { io = { ...io, now: () => new Date(NOW.getTime() + minutes * 60000) }; };

describe('swarm step with swarm.nested (A10)', () => {
  it('hands each task it starts to a runner instead of its implementer, and writes runner.json', () => {
    setup(NESTED);
    const s = step();
    expect(s.actions.filter(a => a.type === 'spawnImplementer')).toEqual([]);
    const runners = s.actions.filter(a => a.type === 'spawnRunner');
    expect(runners.map(a => a.task)).toEqual(['T1', 'T2']);
    const impl = readExecution(root)!.tasks.T1.agent!;
    expect(impl).toMatch(/^forge-/);
    expect(runners[0]).toMatchObject({
      agent: 'forge-runner', effort: 'medium', taskLine: 'forge-task: T1 @shop', plan: 'plan.yaml', project: 'shop', locale: 'en', work: '.forge/work/shop/T1',
      implementer: { agent: impl, taskLine: 'forge-task: T1-1 @shop' }, brief: '.forge/work/shop/T1/brief-1.md', report: '.forge/work/shop/T1/report-1.txt', worktree: wt('T1'),
    });
    expect(runners[0].validate).toEqual(expect.stringContaining('validate --affected --base'));
    expect(readExecution(root)!.tasks.T1.stage).toBe('implement');
    expect(readEvents(root).filter(e => e.kind === 'agent' && e.task === 'T1-1')).toHaveLength(1);
    expect(runnerDoc('T1')).toEqual({ runId: readExecution(root)!.runId, attempts: 0, state: 'running', at: NOW.toISOString() });
    expect(s.publish.tasks.find(x => x.task === 'T1')).toMatchObject({ claim: true });
    expect(s.say).toContain(`T1 starts with its runner (${impl})`);
  });
  it('leaves a task its runner holds alone, also with a new commit and report; --returned hands it back and the step takes it up', () => {
    setup(NESTED);
    step();
    commitIn(wt('T1'), 'src/t1/a.ts', 'export const a = 1;\n', 'T1: a');
    writeFileSync(path.join(work('T1'), 'report-1.txt'), 'done\n');
    expect(step().actions.filter(a => a.task === 'T1')).toEqual([]);
    expect(readExecution(root)!.tasks.T1.stage).toBe('implement');
    const back = step('--returned', 'T1');
    expect(back.actions).toContainEqual({ type: 'handback', task: 'T1', stage: 'implement', reason: 'returned' });
    expect(back.actions.find(a => a.task === 'T1' && a.type === 'spawnReviewers')).toMatchObject({ round: 1 });
    expect(runnerDoc('T1')).toMatchObject({ state: 'back', reason: 'returned', backAt: NOW.toISOString() });
    expect(back.say).toContain('T1: its runner handed it back; I take it from here');
  });
  it('a runner that accepted its task leaves it to the tick, which integrates it; --returned lets runner.json go without a handback', () => {
    setup(NESTED);
    step();
    commitIn(wt('T2'), 'src/t2/a.ts', 'export const b = 2;\n', 'T2: b');
    out(run(['swarm', 'task', 'T2', '--stage', 'verdict', '--status', 'accepted', '--no-agent'], io));
    const s = step('--returned', 'T2');
    expect(s.actions.find(a => a.type === 'integrated')).toMatchObject({ task: 'T2' });
    expect(s.actions.filter(a => a.type === 'handback')).toEqual([]);
    expect(runnerDoc('T2')).toMatchObject({ state: 'back', reason: 'returned' });
  });
  it('a runner silent for 100 minutes loses its task: held at 99, handed back at 101 (Review Focus 1)', () => {
    setup(NESTED);
    step();
    later(99);
    expect(step().actions.filter(a => a.type === 'handback')).toEqual([]);
    later(101);
    const s = step();
    expect(s.actions).toContainEqual({ type: 'handback', task: 'T1', stage: 'implement', reason: 'silent' });
    expect(runnerDoc('T1')).toMatchObject({ state: 'back', reason: 'silent' });
  });
  it('a runner back at once, with no commit and no report: a handback, then the report it never wrote (Review Focus 2)', () => {
    setup(NESTED);
    step();
    const s = step('--returned', 'T2');
    expect(s.actions).toContainEqual({ type: 'handback', task: 'T2', stage: 'implement', reason: 'returned' });
    expect(s.actions).toContainEqual({ type: 'readReport', task: 'T2', report: '.forge/work/shop/T2/report-1.txt' });
  });
  it('turning swarm.nested off mid-run keeps the runner already out; the next start gets its implementer (Review Focus 3)', () => {
    setup(NESTED, '--parallel', '1');
    expect(step().actions.filter(a => a.type === 'spawnRunner').map(a => a.task)).toEqual(['T1']);
    writeFileSync(path.join(root, '.forge', 'config.yaml'), 'validators: []\n');
    commitIn(wt('T1'), 'src/t1/a.ts', 'x\n', 'T1: a');
    writeFileSync(path.join(work('T1'), 'report-1.txt'), 'done\n');
    expect(step().actions.filter(a => a.task === 'T1')).toEqual([]);
    out(run(['swarm', 'task', 'T1', '--stage', 'verdict', '--status', 'accepted', '--no-agent'], io));
    const s = step('--returned', 'T1');
    expect(s.actions.find(a => a.type === 'integrated')).toMatchObject({ task: 'T1' });
    expect(s.actions.find(a => a.task === 'T2')).toMatchObject({ type: 'spawnImplementer' });
  });
  it('an unreadable .forge/config.yaml reads as nested off: the step prints its errors and starts no runner (Review Focus 4)', () => {
    setup(NESTED);
    writeFileSync(path.join(root, '.forge', 'config.yaml'), 'swarm: [\n');
    const r = run(['swarm', 'step', '--plan', 'plan.yaml', '--db', 'db'], io);
    expect(r.code).toBe(0);
    const actions = (JSON.parse(r.stdout) as { actions: Action[] }).actions;
    expect(actions.filter(a => a.type === 'spawnRunner')).toEqual([]);
    expect(actions.some(a => a.type === 'error')).toBe(true);
  });
  it('a task resumed on its branch, or retried, is the coordinator\'s: no runner for it, and an older runner.json holds nothing (Review Focus 5)', () => {
    setup(NESTED);
    // D-02: task/T1 survived an earlier attempt, with its worktree, and that attempt's prep logged its phase implement.
    g(root, 'worktree', 'add', '-q', '-b', 'task/T1', wt('T1'), 'forge/run-shop');
    appendEvent(root, { ts: new Date(NOW.getTime() - 60000).toISOString(), kind: 'phase', task: 'T1', phase: 'implement', brief: 1, base: g(root, 'rev-parse', 'forge/run-shop'), project: 'shop' });
    commitIn(wt('T1'), 'src/t1/a.ts', 'x\n', 'T1: first try');
    const s = step();
    expect(s.actions.find(a => a.task === 'T1')).toMatchObject({ type: 'spawnImplementer' });
    expect(existsSync(path.join(work('T1'), 'runner.json'))).toBe(false);
    expect(s.actions.find(a => a.task === 'T2')).toMatchObject({ type: 'spawnRunner' });
    // A retry raises the task's attempts: the runner.json of the attempt before holds it no more.
    const e = readExecution(root)!;
    seedExecution(root, { ...e, tasks: { ...e.tasks, T2: { ...e.tasks.T2, attempts: 1 } } });
    commitIn(wt('T2'), 'src/t2/a.ts', 'y\n', 'T2: b');
    writeFileSync(path.join(work('T2'), 'report-1.txt'), 'done\n');
    const again = step();
    expect(again.actions.find(a => a.task === 'T2')).toMatchObject({ type: 'spawnReviewers' });
    expect(again.actions.filter(a => a.type === 'handback')).toEqual([]);
  });
  it('without swarm.nested the step hands out implementers and writes no runner.json', () => {
    setup('validators: []\n');
    const s = step();
    expect(s.actions.filter(a => a.type === 'spawnImplementer').map(a => a.task)).toEqual(['T1', 'T2']);
    expect(s.actions.filter(a => a.type === 'spawnRunner')).toEqual([]);
    expect(existsSync(path.join(work('T1'), 'runner.json'))).toBe(false);
  });
});

describe('the say of the nested runner (A10)', () => {
  it('stepSay names the runner with its implementer, and the handback, in the person\'s language', () => {
    expect(stepSay([{ type: 'spawnRunner', task: 'T1', implementer: { agent: 'forge-impl' } }], 300, 'es')).toBe('Paso: T1 empieza con su runner (forge-impl).');
    expect(stepSay([{ type: 'handback', task: 'T1', stage: 'review', reason: 'silent' }], null, 'en')).toBe('Step: T1: its runner handed it back; I take it from here.');
  });
});

describe('the runner agent and the coordinator text (A10)', () => {
  const doc = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
  it('forge-runner: Opus at medium, may spawn agents, never edits nor asks, and carries the loop\'s commands and its reply', () => {
    const md = doc('plugins/forge/agents/forge-runner.md');
    const head = md.split(/\r?\n---\r?\n/)[0];
    for (const re of [/^---\r?\nname: forge-runner\r?\n/, /\nmodel: opus\r?\n/, /\neffort: medium\r?\n/, /\nmaxTurns: 120\r?\n/, /\ndisallowedTools: Edit, NotebookEdit, AskUserQuestion\r?(\n|$)/]) expect(head).toMatch(re);
    expect(head).not.toMatch(/\ntools:/);
    for (const w of ['task-steps.md', '<WORK>/runner.json', 'FORGE swarm task <T> --stage', '--lease-minutes 90', 'timeout: 600000',
      'FORGE triage --plan <plan> --task <T> --cwd <worktree> --base <base>', 'FORGE review-prep --task <T>-<n>', 'FORGE verify-plan --task <T>-<n>',
      'FORGE review-close --task <T>-<n>', 'FORGE log --kind agent --task <T>-<n>', '<WORK>/deferred.json', '--stage verdict --status accepted --no-agent',
      'SendMessage', '`<T> accepted`', '`<T> handback: <', '`<T> handback: taken back`', 'validators-head-<n>.json']) expect(md, w).toContain(w);
  });
  it('step.md hands the coordinator spawnRunner and handback, and a runner that comes back goes in --returned', () => {
    const lines = doc('plugins/forge/skills/run/references/step.md').split('\n');
    const runner = lines.find(l => l.trimStart().startsWith('- `spawnRunner` ('))!;
    for (const w of ['`forge:forge-runner`', '`effort`', '`taskLine`', '`references/task-steps.md`', '`swarm.nested: true`']) expect(runner, w).toContain(w);
    expect(lines.find(l => l.trimStart().startsWith('- `handback` ('))).toBeDefined();
    expect(lines.find(l => l.startsWith('1. **Run it.**'))).toContain('`spawnRunner`');
  });
});
