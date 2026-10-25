import { describe, it, expect, beforeEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { doctorExit, doctorSay, runChecks, satisfiesRange, type CheckResult, type DoctorCheck, type DoctorCtx } from '../src/forge/doctor.js';
import { run, type Io } from '../src/forge/cli/run.js';
import { assumeTrustedForTests } from '../src/forge/trust-flag.js';
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
  const check = (id: string) => checks(doctor()).find(x => x.id === id)!;
  const put = (rel: string, text: string) => { const f = path.join(root, '.forge', rel); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, text); };
  const deadPid = () => spawnSync(process.execPath, ['-e', '']).pid!;
  const marker = (pid: number, staleAt: string) => JSON.stringify({ task: 'T2', pre: 'abcdef1', ref: 'task/T2', pid, startedAt: '2026-10-24T09:00:00.000Z', staleAt, dir: root, phase: 'merge' });
  it('a live merge attempt warns with a manual fix', () => {
    put('execution/merging.json', marker(process.ppid, '2026-10-24T11:00:00.000Z'));
    expect(check('merging')).toMatchObject({ status: 'warn', fix: { kind: 'manual' } });
  });
  it('a stale execution lock warns, and the lock stays', () => {
    put('execution.lock', JSON.stringify({ pid: deadPid(), at: '2026-10-24T09:00:00.000Z' }));
    expect(check('execution-lock')).toMatchObject({ status: 'warn', fix: { kind: 'manual' } });
    expect(existsSync(path.join(root, '.forge', 'execution.lock'))).toBe(true);
  });
  it('untrusted config commands warn; a config that does not parse fails, and verify-env is unverified (Review Focus 5)', () => {
    put('config.yaml', 'validators:\n  - name: t\n    cmd: npm test\n    kind: test\n');
    assumeTrustedForTests(false);
    try { expect(check('trust')).toMatchObject({ status: 'warn', fix: { kind: 'manual' } }); } finally { assumeTrustedForTests(true); }
    put('config.yaml', 'validators: [oops\n');
    const r = doctor();
    expect(checks(r).find(x => x.id === 'trust')?.status).toBe('fail');
    expect(checks(r).find(x => x.id === 'verify-env')?.status).toBe('unverified');
    expect(r.code).toBe(2);
  });
  it('a verify-env reservation past its minutes with no live process warns with a confirm fix', () => {
    // 15 min old: past verify.limits.minutes (10), still standing (under 2 × 10)
    const evidence = path.join(root, '.forge', 'work', 'shop', 'T1', 'reviews-1-1');
    put('verify-env/reviews-1-1.json', JSON.stringify({ key: 'reviews-1-1', task: 'T1', port: 41000, profileDir: '', evidence, dir: root, startedAt: '2026-10-24T09:45:00.000Z' }));
    expect(check('verify-env')).toMatchObject({ status: 'warn', fix: { kind: 'confirm' } });
  });
  it('git tracking .forge/local.yaml warns (a repository could ship it)', () => {
    put('local.yaml', 'surfaces: {}\n');
    git(root, 'add', '-f', '.forge/local.yaml'); git(root, 'commit', '-q', '-m', 'x');
    expect(check('tracked-state')).toMatchObject({ status: 'warn', fix: { kind: 'manual' } });
  });
  it('a merged task branch: the dry run of swarm cleanup warns with a confirm fix, and the branch stays', () => {
    git(root, 'commit', '--allow-empty', '-q', '-m', 'init');
    git(root, 'branch', 'task/T1');
    expect(check('worktrees')).toMatchObject({ status: 'warn', fix: { kind: 'confirm' } });
    expect(git(root, 'branch', '--list', 'task/T1')).not.toBe('');
  });
  it('reads and never writes: a dead job, step.lock, execution.lock and merging.json and a legacy swarm.json stay byte for byte (Review Focus 4)', () => {
    const dead = deadPid(), at = '2026-10-24T09:00:00.000Z';
    const seed: Record<string, string> = {
      'jobs/integrate-T2-1.json': JSON.stringify({ name: 'integrate-T2-1', cmd: 'integrate', task: 'T2', pid: dead, startedAt: at, out: 'o.json', session: null }),
      'jobs/step.lock': JSON.stringify({ pid: dead, startedAt: at }),
      'execution.lock': JSON.stringify({ pid: dead, at }),
      'execution/merging.json': marker(dead, at),
      'swarm.json': JSON.stringify({ active: true, project: 'shop', fronts: {} }),
    };
    for (const [rel, text] of Object.entries(seed)) put(rel, text);
    const r = doctor();
    expect(r.code).toBe(doctorExit(checks(r)));
    expect(checks(r).find(x => x.id === 'worktrees')?.status).toBe('ok'); // skipped: the legacy swarm.json is not migrated
    const dir = path.join(root, '.forge');
    const files = (readdirSync(dir, { recursive: true }) as string[]).filter(f => statSync(path.join(dir, f)).isFile()).map(f => f.split(path.sep).join('/'));
    expect(files.sort()).toEqual(Object.keys(seed).sort());
    for (const [rel, text] of Object.entries(seed)) expect(readFileSync(path.join(dir, rel), 'utf8'), rel).toBe(text);
  });
});
