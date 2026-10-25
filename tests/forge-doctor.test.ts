import { describe, it, expect, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { doctorExit, doctorSay, runChecks, satisfiesRange, type CheckResult, type DoctorCheck, type DoctorCtx } from '../src/forge/doctor.js';
import { run, type Io } from '../src/forge/cli/run.js';
import { useTempDirs } from './helpers/tmp.js';
const tmp = useTempDirs();

describe('doctor framework', () => {
  const base = (over: Partial<DoctorCtx> = {}): DoctorCtx => ({ main: '/m', cwd: '/m', configDir: '/cfg', scriptPath: '/s/forge.cjs', now: new Date('2026-10-24T10:00:00.000Z'), locale: 'en', env: {}, ...over });
  const check = (id: string, status: CheckResult['status']): DoctorCheck => ({ id, run: () => ({ id, status, detail: id }) });
  it('runChecks isolates a throwing check as a single unverified one and keeps the rest', () => {
    const boom: DoctorCheck = { id: 'boom', run: () => { throw new Error('x'); } };
    const out = runChecks([check('a', 'ok'), boom, check('b', 'warn')], base());
    expect(out.map(c => [c.id, c.status])).toEqual([['a', 'ok'], ['boom', 'unverified'], ['b', 'warn']]);
  });
  it('doctorExit is 2 for a warn or fail, else 1 for an unverified, else 0', () => {
    expect(doctorExit([{ id: 'a', status: 'ok', detail: '' }])).toBe(0);
    expect(doctorExit([{ id: 'a', status: 'unverified', detail: '' }])).toBe(1);
    expect(doctorExit([{ id: 'a', status: 'unverified', detail: '' }, { id: 'b', status: 'warn', detail: '' }])).toBe(2);
    expect(doctorExit([{ id: 'a', status: 'fail', detail: '' }])).toBe(2);
  });
  it('doctorSay counts the checks in the locale', () => {
    const cs: CheckResult[] = [{ id: 'a', status: 'ok', detail: '' }, { id: 'b', status: 'warn', detail: '' }, { id: 'c', status: 'unverified', detail: '' }];
    expect(doctorSay(cs, 'en')).toBe('forge doctor: 1 ok, 1 to look at, 1 unverified');
    expect(doctorSay(cs, 'es')).toBe('forge doctor: 1 correcta, 1 que mirar, 1 sin verificar');
    expect(doctorSay([...cs, { id: 'd', status: 'ok', detail: '' }, { id: 'e', status: 'fail', detail: '' }], 'es')).toBe('forge doctor: 2 correctas, 2 que mirar, 1 sin verificar');
  });
  it('satisfiesRange reads caret, tilde and exact, and refuses what does not parse', () => {
    const rows: [string, string, boolean][] = [['7.0.0', '^7.0.0', true], ['7.2.1', '^7.0.0', true], ['8.0.0', '^7.0.0', false], ['6.4.1', '^7.0.0', false], ['7.1.0', '^7.2.0', false], ['0.36.0', '^0.35.0', false],
      ['0.35.1', '~0.35.0', true], ['0.36.0', '~0.35.0', false], ['0.35.0', '0.35.0', true], ['7.0.0-rc.1', '^7.0.0', true], ['unknown', '^7.0.0', false], ['7.0.0', 'x', false]];
    for (const [v, r, want] of rows) expect(satisfiesRange(v, r), `${v} ${r}`).toBe(want);
  });
});

describe('forge doctor (the command)', () => {
  let root: string;
  const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8' });
  // forge's root is <root>/plugins/forge: Task 7 seeds its plugin.json and, for the dev layout, <root>/plugins/waypoint.
  const io = (over: Partial<Io> = {}): Io => ({ cwd: root, now: () => new Date('2026-10-24T10:00:00.000Z'), env: { CLAUDE_CONFIG_DIR: path.join(root, 'cfg') }, scriptPath: path.join(root, 'plugins', 'forge', 'dist', 'forge.cjs'), ...over });
  const doctor = (args: string[] = []) => run(['doctor', ...args], io());
  const checks = (r: { stdout: string }) => JSON.parse(r.stdout).checks as CheckResult[];
  const known = (cs: CheckResult[]) => cs.every(c => ['ok', 'warn', 'fail', 'unverified'].includes(c.status));
  const liveStep = (main: string) => {
    mkdirSync(path.join(main, '.forge', 'jobs'), { recursive: true });
    writeFileSync(path.join(main, '.forge', 'jobs', 'step.lock'), JSON.stringify({ pid: process.ppid, startedAt: '2026-10-24T09:59:00.000Z' }));
  };
  beforeEach(() => { root = tmp('doctor-'); git(root, 'init', '-q', '-b', 'main'); });
  it('a clean repo: every check a known status, the exit its statuses give, and no .forge/ appears (Review Focus 4)', () => {
    const r = doctor();
    const out = JSON.parse(r.stdout) as { checks: CheckResult[]; say: string };
    expect(known(out.checks)).toBe(true);
    expect(out.say).toMatch(/^forge doctor:/);
    expect(out.checks.find(c => c.id === 'step-lock')?.status).toBe('ok');
    expect(r.code).toBe(doctorExit(out.checks));
    expect(existsSync(path.join(root, '.forge'))).toBe(false);
  });
  it('a live swarm step: the step-lock check warns and names its remedy, exit 2', () => {
    liveStep(root);
    const r = doctor();
    const c = checks(r).find(x => x.id === 'step-lock')!;
    expect(c.status).toBe('warn');
    expect(c.fix?.kind).toBe('manual');
    expect(r.code).toBe(2);
  });
  it('from a task worktree it reads the main checkout; outside git every check still gives its own status (Review Focus 5)', () => {
    git(root, 'commit', '--allow-empty', '-q', '-m', 'init');
    const wt = path.join(root, '.claude', 'worktrees', 'task-T1');
    git(root, 'worktree', 'add', '-q', '-b', 'task/T1', wt);
    liveStep(root);
    expect(checks(run(['doctor'], io({ cwd: wt }))).find(x => x.id === 'step-lock')?.status).toBe('warn');
    const away = tmp('doctor-nogit-');
    const r = run(['doctor'], io({ cwd: away }));
    expect(known(checks(r))).toBe(true);
    expect(r.code).toBe(doctorExit(checks(r)));
    expect(existsSync(path.join(away, '.forge'))).toBe(false);
  });
  it('--locale es gives the say in Spanish, and a bad locale exits 2', () => {
    expect(JSON.parse(run(['doctor', '--locale', 'es'], io()).stdout).say).toContain('correcta');
    expect(run(['doctor', '--locale', 'fr'], io()).code).toBe(2);
  });
});
