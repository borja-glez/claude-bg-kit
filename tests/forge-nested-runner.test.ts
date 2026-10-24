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
