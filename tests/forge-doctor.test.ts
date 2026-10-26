import { describe, it, expect, beforeEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { doctorExit, doctorSay, runChecks, satisfiesRange, type CheckResult, type DoctorCheck, type DoctorCtx } from '../src/forge/doctor.js';
import { run, type Io } from '../src/forge/cli/run.js';
import { assumeTrustedForTests } from '../src/forge/trust-flag.js';
import { agentTranscript, pendingCall } from '../src/forge/waiting-calls.js';
import { claudeVersion, OBSERVED_WITH } from '../src/forge/claude-bin.js';
import { OBSERVED_WITH as HARNESS_OBSERVED_WITH } from './e2e/harness/claude-bin.js';
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
  it('git tracking both state files: the fix names each, so one run of it clears the warning', () => {
    put('local.yaml', 'surfaces: {}\n');
    put('learned.jsonl', '');
    git(root, 'add', '-f', '.forge/local.yaml', '.forge/learned.jsonl'); git(root, 'commit', '-q', '-m', 'x');
    expect(check('tracked-state')).toMatchObject({
      status: 'warn', data: { tracked: ['local.yaml', 'learned.jsonl'] }, fix: { do: 'git rm --cached .forge/local.yaml .forge/learned.jsonl', kind: 'manual' },
    });
  });
  it('a merged task branch: the dry run of swarm cleanup warns with a confirm fix, and the branch stays', () => {
    git(root, 'commit', '--allow-empty', '-q', '-m', 'init');
    git(root, 'branch', 'task/T1');
    expect(check('worktrees')).toMatchObject({ status: 'warn', fix: { kind: 'confirm' } });
    expect(git(root, 'branch', '--list', 'task/T1')).not.toBe('');
  });
  it('a merged worktree: its index keeps its bytes and mtime, though git status would refresh it (spec: read-only)', () => {
    writeFileSync(path.join(root, 'a.txt'), 'a\n');
    git(root, 'add', 'a.txt'); git(root, 'commit', '-q', '-m', 'init');
    const wt = path.join(root, '.claude', 'worktrees', 'task-T1');
    git(root, 'worktree', 'add', '-q', '-b', 'task/T1', wt);
    // a stat the index does not hold: a plain git status refreshes the entry and rewrites the index under index.lock
    const past = new Date('2026-01-01T00:00:00.000Z');
    utimesSync(path.join(wt, 'a.txt'), past, past);
    const index = path.join(root, '.git', 'worktrees', 'task-T1', 'index');
    utimesSync(index, past, past);
    const bytes = readFileSync(index), mtime = statSync(index).mtimeMs;
    expect(check('worktrees')).toMatchObject({ status: 'warn', data: { worktrees: ['.claude/worktrees/task-T1'] } });
    expect(readFileSync(index).equals(bytes)).toBe(true);
    expect(statSync(index).mtimeMs).toBe(mtime);
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

describe('FC5: the Claude Code version against the one forge was recorded with', () => {
  const posix = (files: string[], answers: Record<string, string | null>) => ({
    platform: 'linux' as NodeJS.Platform, isFile: (f: string) => files.includes(f), run: (f: string) => answers[f] ?? null,
  });
  it('claudeVersion asks the binary that runs this session, else the claude on PATH, else reads AI_AGENT', () => {
    expect(claudeVersion({ CLAUDE_CODE_EXECPATH: '/b/claude', PATH: '/p' }, posix(['/p/claude'], { '/b/claude': '2.1.310 (Claude Code)\n', '/p/claude': '2.0.1 (Claude Code)\n' })))
      .toEqual({ version: '2.1.310', source: 'running' });
    expect(claudeVersion({ CLAUDE_CODE_EXECPATH: '/b/claude', PATH: '/x:/p' }, posix(['/p/claude'], { '/p/claude': '2.0.1 (Claude Code)\n' })))
      .toEqual({ version: '2.0.1', source: 'path' });
    expect(claudeVersion({ PATH: '/p', AI_AGENT: 'claude-code_2-1-311_agent' }, posix([], {}))).toEqual({ version: '2.1.311', source: 'env' });
    expect(claudeVersion({ AI_AGENT: 'other_1-2-3' }, posix([], {}))).toBeNull();
    expect(claudeVersion({}, posix([], {}))).toBeNull();
    // On Windows only the native claude.exe of PATH is asked (a claude.cmd would need cmd.exe).
    const win = { platform: 'win32' as NodeJS.Platform, isFile: (f: string) => /claude\.(exe|cmd)$/.test(f), run: (f: string) => (f.endsWith('.exe') ? '2.1.300 (Claude Code)' : null) };
    expect(claudeVersion({ Path: 'C:\\a;C:\\b' }, win)).toEqual({ version: '2.1.300', source: 'path' });
  });
  it('doctor: the version forge was recorded with is ok, another one warns with what to do, none read is unverified', () => {
    const root = tmp('doctor-claude-');
    const doctorWith = (env: Record<string, string>) => (JSON.parse(run(['doctor'], { cwd: root, now: () => new Date('2026-10-24T10:00:00.000Z'), env: { CLAUDE_CONFIG_DIR: path.join(root, 'cfg'), ...env }, scriptPath: path.join(root, 'forge.cjs') }).stdout).checks as CheckResult[])
      .find(c => c.id === 'claude-version')!;
    const agent = (v: string) => ({ AI_AGENT: `claude-code_${v.replace(/\./g, '-')}_agent` });
    expect(doctorWith(agent(OBSERVED_WITH))).toMatchObject({ status: 'ok', data: { version: OBSERVED_WITH, observedWith: OBSERVED_WITH } });
    const other = doctorWith(agent('9.9.9'));
    expect(other).toMatchObject({ status: 'warn', data: { version: '9.9.9', observedWith: OBSERVED_WITH }, fix: { kind: 'manual' } });
    expect(other.detail).toContain(`recorded with Claude Code ${OBSERVED_WITH}`);
    expect(doctorWith({}).status).toBe('unverified');
  });
  it('the e2e harness and forge read one OBSERVED_WITH', () => {
    expect(HARNESS_OBSERVED_WITH).toBe(OBSERVED_WITH);
  });
});

describe('forge doctor · install', () => {
  let root: string, cfg: string;
  const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8' });
  const forgeRoot = () => path.join(root, 'plugins', 'forge');
  const io = (): Io => ({ cwd: root, now: () => new Date('2026-10-24T10:00:00.000Z'), env: { CLAUDE_CONFIG_DIR: cfg }, scriptPath: path.join(forgeRoot(), 'dist', 'forge.cjs') });
  const check = (id: string) => (JSON.parse(run(['doctor'], io()).stdout).checks as CheckResult[]).find(c => c.id === id)!;
  // An install as Claude Code keeps it: <cfg>/plugins/cache/<marketplace>/<name>/<version>, listed in installed_plugins.json.
  const plugin = (name: string, version: string) => {
    const p = path.join(cfg, 'plugins', 'cache', 'm', name, version);
    mkdirSync(path.join(p, '.claude-plugin'), { recursive: true });
    writeFileSync(path.join(p, '.claude-plugin', 'plugin.json'), JSON.stringify({ name, version }));
    return { scope: 'user', installPath: p, version };
  };
  const installed = (plugins: Record<string, unknown[]> | string) => {
    mkdirSync(path.join(cfg, 'plugins'), { recursive: true });
    writeFileSync(path.join(cfg, 'plugins', 'installed_plugins.json'), typeof plugins === 'string' ? plugins : JSON.stringify({ version: 2, plugins }));
  };
  beforeEach(() => {
    root = tmp('doctor-install-');
    cfg = path.join(root, 'cfg');
    git(root, 'init', '-q', '-b', 'main');
    mkdirSync(path.join(forgeRoot(), '.claude-plugin'), { recursive: true });
    writeFileSync(path.join(forgeRoot(), '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'forge', version: '0.30.1', dependencies: [{ name: 'waypoint', version: '^0.35.0' }] }));
  });
  it('waypoint: absent or outside forge\'s range fails, inside it is ok', () => {
    expect(check('waypoint-version')).toMatchObject({ status: 'fail', fix: { kind: 'manual' } });
    installed({ 'waypoint@m': [plugin('waypoint', '0.9.0')] });
    expect(check('waypoint-version')).toMatchObject({ status: 'fail', fix: { kind: 'manual' } });
    installed({ 'waypoint@m': [plugin('waypoint', '0.35.1')] });
    expect(check('waypoint-version').status).toBe('ok');
  });
  it('a version that does not parse is read from the plugin.json, and unverified when that fails too (R12)', () => {
    const hashed = plugin('waypoint', '0.35.1');
    installed({ 'waypoint@m': [{ ...hashed, version: 'unknown' }] });
    expect(check('waypoint-version').status).toBe('ok');
    writeFileSync(path.join(hashed.installPath, '.claude-plugin', 'plugin.json'), '{oops');
    expect(check('waypoint-version').status).toBe('unverified');
    const sp = plugin('superpowers', '7.0.1');
    installed({ 'superpowers@o': [{ ...sp, version: 'abc123' }] });
    expect(check('superpowers-version').status).toBe('ok');
    writeFileSync(path.join(sp.installPath, '.claude-plugin', 'plugin.json'), '{oops');
    expect(check('superpowers-version').status).toBe('unverified');
  });
  it('the running copy: installPath when it is the installed one; another copy with forge installed elsewhere warns', () => {
    installed({ 'forge@m': [{ scope: 'user', installPath: forgeRoot(), version: '0.30.1' }] });
    expect(check('running-copy')).toMatchObject({ status: 'ok', data: { forge: { kind: 'installPath', version: '0.30.1' } } });
    installed({ 'forge@m': [plugin('forge', '0.30.1')] });
    expect(check('running-copy')).toMatchObject({ status: 'warn', data: { forge: { kind: 'other' } }, fix: { kind: 'manual' } });
  });
  it('superpowers: absent is ok, 6.x warns against the route range, 7.x is ok', () => {
    expect(check('superpowers-version').status).toBe('ok');
    installed({ 'superpowers@o': [plugin('superpowers', '6.4.1')] });
    expect(check('superpowers-version')).toMatchObject({ status: 'warn', fix: { kind: 'manual' } });
    installed({ 'superpowers@o': [plugin('superpowers', '7.0.1')] });
    expect(check('superpowers-version').status).toBe('ok');
  });
  it('an installed_plugins.json that does not read leaves the install checks unverified, never fail nor ok (Review Focus 5)', () => {
    installed('garbage');
    for (const id of ['waypoint-version', 'running-copy', 'superpowers-version']) expect(check(id).status, id).toBe('unverified');
  });
  it('permissions: none or only the user\'s warns and recommends, a settings.local.json that does not read is unverified, the project\'s entry is ok (Review Focus 5)', () => {
    const allow = JSON.stringify({ permissions: { allow: ['Bash(node *forge.cjs*)'] } });
    expect(check('permissions')).toMatchObject({ status: 'warn', fix: { kind: 'manual' }, data: { recommend: { allow: ['Bash(node *forge.cjs*)'] } } });
    mkdirSync(cfg, { recursive: true });
    writeFileSync(path.join(cfg, 'settings.json'), allow);
    expect(check('permissions').status).toBe('warn');
    mkdirSync(path.join(root, '.claude'), { recursive: true });
    writeFileSync(path.join(root, '.claude', 'settings.local.json'), '{oops');
    expect(check('permissions').status).toBe('unverified');
    writeFileSync(path.join(root, '.claude', 'settings.local.json'), allow);
    expect(check('permissions').status).toBe('ok');
  });
  it('waypoint doctor runs without --fix: no waypoint is unverified, its leftovers warn with a confirm fix and stay (Review Focus 4)', () => {
    expect(check('waypoint-doctor').status).toBe('unverified');
    // the dev layout: <root>/plugins/waypoint/dist/waypoint.cjs next to <root>/plugins/forge, a copy of the repository's own bundle
    const wp = path.join(root, 'plugins', 'waypoint', 'dist', 'waypoint.cjs');
    mkdirSync(path.dirname(wp), { recursive: true });
    copyFileSync(new URL('../plugins/waypoint/dist/waypoint.cjs', import.meta.url), wp);
    expect(check('waypoint-doctor').status).toBe('ok');
    mkdirSync(path.join(root, 'docs', 'waypoint', 'demo-shop'), { recursive: true });
    copyFileSync(new URL('./fixtures/plan.yaml', import.meta.url), path.join(root, 'docs', 'waypoint', 'demo-shop', 'plan.yaml'));
    const left = path.join(root, '.waypoint', 'demo-shop', 'last-head');
    mkdirSync(path.dirname(left), { recursive: true });
    writeFileSync(left, 'abc\n');
    expect(check('waypoint-doctor')).toMatchObject({
      status: 'warn', fix: { kind: 'confirm' }, data: { leftovers: [{ plan: 'docs/waypoint/demo-shop/plan.yaml', path: '.waypoint/demo-shop/last-head' }] },
    });
    expect(readFileSync(left, 'utf8')).toBe('abc\n');
  });
  it('waypoint doctor: the fix names the plan each leftover came from, not the first plan, and every plan that left one', () => {
    const wp = path.join(root, 'plugins', 'waypoint', 'dist', 'waypoint.cjs');
    mkdirSync(path.dirname(wp), { recursive: true });
    copyFileSync(new URL('../plugins/waypoint/dist/waypoint.cjs', import.meta.url), wp);
    const plan = readFileSync(new URL('./fixtures/plan.yaml', import.meta.url), 'utf8');
    for (const project of ['alpha-shop', 'demo-shop']) {
      mkdirSync(path.join(root, 'docs', 'waypoint', project), { recursive: true });
      writeFileSync(path.join(root, 'docs', 'waypoint', project, 'plan.yaml'), plan.replace('project: demo-shop', `project: ${project}`));
    }
    const leave = (project: string) => { const f = path.join(root, '.waypoint', project, 'last-head'); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, 'abc\n'); };
    // only the second plan, by name, left something
    leave('demo-shop');
    expect(check('waypoint-doctor')).toMatchObject({
      status: 'warn', data: { leftovers: [{ plan: 'docs/waypoint/demo-shop/plan.yaml', path: '.waypoint/demo-shop/last-head' }] },
      fix: { do: 'waypoint doctor docs/waypoint/demo-shop/plan.yaml --fix removes them', kind: 'confirm' },
    });
    leave('alpha-shop');
    expect(check('waypoint-doctor')).toMatchObject({
      status: 'warn',
      data: { leftovers: [{ plan: 'docs/waypoint/alpha-shop/plan.yaml', path: '.waypoint/alpha-shop/last-head' }, { plan: 'docs/waypoint/demo-shop/plan.yaml', path: '.waypoint/demo-shop/last-head' }] },
      fix: { do: 'waypoint doctor docs/waypoint/alpha-shop/plan.yaml --fix and waypoint doctor docs/waypoint/demo-shop/plan.yaml --fix remove them', kind: 'confirm' },
    });
  });
});

describe('forge doctor · waiting calls', () => {
  const NOW = Date.parse('2026-10-24T10:00:00.000Z');
  const use = (id: string, timestamp: string, input: object) => JSON.stringify({ type: 'assistant', timestamp, message: { content: [{ type: 'tool_use', id, name: 'Bash', input }] } });
  const answer = (id: string, timestamp: string) => JSON.stringify({ type: 'user', timestamp, message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });
  it('pendingCall reports the last tool_use with no result, redacted, and nothing when it has one', () => {
    const tail = [use('t1', '2026-10-24T09:40:00.000Z', { command: 'ls' }), answer('t1', '2026-10-24T09:40:01.000Z'), use('t2', '2026-10-24T09:45:00.000Z', { command: 'npm test -- --password=hunter2' })].join('\n') + '\n';
    expect(pendingCall(tail, NOW)).toEqual({ tool: 'Bash', waitedSec: 900, head: 'npm test -- --password=***' });
    expect(pendingCall(tail + answer('t2', '2026-10-24T09:50:00.000Z') + '\n', NOW)).toBeNull();
    expect(pendingCall('', NOW)).toBeNull();
    expect(pendingCall('{cut line\nnot json\n', NOW)).toBe('unreadable');
  });
  it('agentTranscript builds the path only from safe ids, under any project folder', () => {
    const cfg = tmp('doctor-cfg-');
    expect(agentTranscript(cfg, '../x', 'a')).toBeNull();
    expect(agentTranscript(cfg, 's1', 'bad/id')).toBeNull();
    expect(agentTranscript(cfg, 's1', 'a1')).toBeNull();
    const f = path.join(cfg, 'projects', 'E--work-shop', 's1', 'subagents', 'agent-a1.jsonl');
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, '');
    expect(agentTranscript(cfg, 's1', 'a1')).toBe(f);
  });
  it('a live subagent older than 10 min with a pending call is data, status ok; a transcript that does not read is unverified; only the tail is read', () => {
    const root = tmp('doctor-wait-');
    const cfg = path.join(root, 'cfg');
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
    mkdirSync(path.join(root, '.forge', 'live'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'live', 's1.json'), JSON.stringify({ sessionId: 's1', role: 'coordinator', runId: null, task: null, event: 'SubagentStart',
      ts: '2026-10-24T09:40:00.000Z', agents: [{ id: 'a1', type: 'forge:forge-impl', since: '2026-10-24T09:40:00.000Z' }, { id: 'a2', type: 'forge:forge-mech', since: '2026-10-24T09:55:00.000Z' }], ended: false }));
    const f = path.join(cfg, 'projects', 'p', 's1', 'subagents', 'agent-a1.jsonl');
    mkdirSync(path.dirname(f), { recursive: true });
    const waiting = () => (JSON.parse(run(['doctor'], { cwd: root, now: () => new Date(NOW), env: { CLAUDE_CONFIG_DIR: cfg }, scriptPath: path.join(root, 'plugins', 'forge', 'dist', 'forge.cjs') }).stdout).checks as CheckResult[])
      .find(c => c.id === 'waiting-calls')!;
    writeFileSync(f, use('t1', '2026-10-24T09:45:00.000Z', { command: 'npm test' }) + '\n');
    expect(waiting()).toMatchObject({ status: 'ok', data: { waiting: [{ agent: 'forge:forge-impl', tool: 'Bash', waitedSec: 900, head: 'npm test' }] } });
    writeFileSync(f, 'not json\n');
    expect(waiting().status).toBe('unverified');
    // a call more than 2 MiB back, before plain lines, is not seen: only the tail is read
    const filler = (JSON.stringify({ type: 'user', timestamp: '2026-10-24T09:41:00.000Z', message: { content: 'x'.repeat(1000) } }) + '\n').repeat(3 * 1024);
    writeFileSync(f, use('t0', '2026-10-24T09:41:00.000Z', { command: 'sleep 999' }) + '\n' + filler);
    expect(waiting()).toMatchObject({ status: 'ok', data: { waiting: [] } });
  });
});
