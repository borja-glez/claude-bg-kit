import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { run, defaultGit, type Io } from '../src/forge/cli/run.js';
import { appendEvent, readEvents, type LedgerEvent } from '../src/forge/ledger.js';
import { expectedImplementer, isImplementerAgent } from '../src/forge/deviation.js';
import { useTempDirs } from './helpers/tmp.js';
import { seedExecution } from './helpers/execution.js';
const tmp = useTempDirs();

// FX1: an implementer the coordinator starts that is not the one forge named for the task in progress is recorded and
// said, never blocked (A10: forge-impl on Opus where the step handed out forge-impl-light).

const T = '2026-10-26T07:30:00.000Z';
const at = (min: number) => new Date(Date.parse(T) + min * 60_000).toISOString();
const ev = (min: number, e: Omit<LedgerEvent, 'ts'>): LedgerEvent => ({ ts: at(min), ...e } as LedgerEvent);
const cliTriage = (min: number, task: string, implementer: string, extra: object = {}) =>
  ev(min, { kind: 'triage', task, path: 'small', reasons: ['r'], implementer, ...extra });

describe('isImplementerAgent', () => {
  it('names the agents of the ladder and forge-fable, nothing else', () => {
    for (const a of ['forge-mech', 'forge-impl-light', 'forge-impl', 'forge-impl-high', 'forge-impl-heavy', 'forge-fable']) expect(isImplementerAgent(a)).toBe(true);
    for (const a of ['forge-review-correctness', 'forge-runner', 'forge-verify', 'forge-impl-x', 'impl', 'general-purpose', '']) expect(isImplementerAgent(a)).toBe(false);
  });
});

describe('expectedImplementer', () => {
  const ref = { project: null, task: 'T1' };
  it('is the implementer of the last CLI triage of the task; a raise the session logged names none', () => {
    const events = [cliTriage(0, 'T1', 'forge-impl-light'), ev(1, { kind: 'triage', task: 'T1', path: 'medium', why: 'w' })];
    expect(expectedImplementer(events, ref, 1)).toEqual({ brief: 'T1-1', agent: 'forge-impl-light', ts: at(0) });
    // the triage run again after the raise names the raised implementer
    expect(expectedImplementer([...events, cliTriage(2, 'T1', 'forge-impl')], ref, 1)).toMatchObject({ agent: 'forge-impl' });
  });
  it('a triage of the real diff (--base) names nobody for the brief', () => {
    const events = [cliTriage(0, 'T1', 'forge-impl-light'), cliTriage(5, 'T1', 'forge-impl-high', { diff: { base: 'b', files: 1, lines: 2 } })];
    expect(expectedImplementer(events, ref, 1)).toMatchObject({ agent: 'forge-impl-light' });
  });
  it("swarm step's hand-out wins over a triage the coordinator runs again by hand (A10), and a hand log never counts", () => {
    const events = [
      cliTriage(0, 'T1', 'forge-impl-light'),
      ev(1, { kind: 'agent', task: 'T1-1', agent: 'forge-impl-light', role: 'impl-light', by: 'step' }),
      ev(2, { kind: 'triage', task: 'T1', path: 'medium', why: 'w' }),
      cliTriage(3, 'T1', 'forge-impl'),
      ev(4, { kind: 'agent', task: 'T1-1', agent: 'forge-impl', role: 'impl' }),
    ];
    expect(expectedImplementer(events, ref, 1)).toEqual({ brief: 'T1-1', agent: 'forge-impl-light', ts: at(1) });
  });
  it("a fix round goes to review-close's implementer, of that brief only", () => {
    const round = (min: number, task: string, next: string, agent: string | null) =>
      ev(min, { kind: 'round', task, next, implementer: agent ? { role: 'impl-high', agent } : null });
    const events = [cliTriage(0, 'T1', 'forge-impl'), round(10, 'T1-1', 'fresh-stronger', 'forge-impl-high'), round(20, 'T1-1', 'done', null)];
    expect(expectedImplementer(events, ref, 1)).toEqual({ brief: 'T1-1', agent: 'forge-impl-high', ts: at(10) });
    // brief 2 starts from the triage again
    expect(expectedImplementer(events, ref, 2)).toEqual({ brief: 'T1-2', agent: 'forge-impl', ts: at(0) });
  });
  it('null when forge named no implementer', () => {
    expect(expectedImplementer([], ref, 1)).toBeNull();
    expect(expectedImplementer([ev(0, { kind: 'triage', task: 'T1', path: 'trivial', reasons: [], implementer: null })], ref, 1)).toBeNull();
  });
  it("only the task's own project counts (ids repeat between plans)", () => {
    const events = [cliTriage(0, 'T1', 'forge-impl', { project: 'shop' }), cliTriage(1, 'T1', 'forge-mech', { project: 'blog' })];
    expect(expectedImplementer(events, { project: 'shop', task: 'T1' }, 1)).toMatchObject({ agent: 'forge-impl' });
  });
});

describe('forge hook live: a deviation from the triage (FX1)', () => {
  let root: string; let io: Io;
  const git = (...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
  beforeEach(() => {
    root = tmp('forge-deviation-');
    git('init', '-q', '-b', 'main'); git('config', 'user.email', 'a@b.c'); git('config', 'user.name', 't');
    writeFileSync(path.join(root, 'x.txt'), 'x'); git('add', '.'); git('commit', '-qm', 'init');
    mkdirSync(path.join(root, '.forge'), { recursive: true });
    io = { cwd: root, now: () => new Date(at(7)), git: defaultGit(root), env: {} };
  });
  const start = (session: string, agentId: string, agentType: string) =>
    run(['hook', 'live'], { ...io, stdin: JSON.stringify({ session_id: session, hook_event_name: 'SubagentStart', agent_id: agentId, agent_type: agentType, cwd: root }) });
  const deviations = () => readEvents(root).filter(e => e.kind === 'deviation');
  const task = (stage: string) => ({ status: 'running', stage, round: 0, worktree: '/w', branch: 'task/T', executor: 'subagents', attempts: 0, agent: 'forge-impl', startedAt: T, stageSince: T, updatedAt: T, detail: null });
  const execution = (tasks: Record<string, unknown>) => seedExecution(root, {
    runId: 'r1', kind: 'plan', mode: 'subagents', parallel: 3, project: 'sandbox', base: 'main', branch: 'forge/run-sandbox', mergeOnFinish: false,
    coordinator: 'main', hookSession: 's1', active: true, stopReason: null, stallReason: null, startedAt: T, lastStepAt: null, lastBlockStep: null, sleepUntil: null,
    tasks: tasks as never,
  });
  const handOut = (t: string, agent: string) => {
    appendEvent(root, cliTriage(4, t, agent, { project: 'sandbox' }));
    appendEvent(root, ev(5, { kind: 'phase', task: t, phase: 'implement', brief: 1, base: 'b', project: 'sandbox' }));
    appendEvent(root, ev(5, { kind: 'agent', task: `${t}-1`, agent, role: 'impl-light', by: 'step', project: 'sandbox' }));
  };

  it('A10: three forge-impl where the step handed out forge-impl-light are three deviations, one per task', () => {
    execution({ T1: task('implement'), T2: task('implement'), T3: task('implement') });
    for (const t of ['T1', 'T2', 'T3']) handOut(t, 'forge-impl-light');
    // the coordinator raised the triage by hand and logged its own agent: neither changes who the step named
    appendEvent(root, ev(6, { kind: 'triage', task: 'T1', path: 'medium', why: 'w', project: 'sandbox' }));
    appendEvent(root, ev(6, { kind: 'agent', task: 'T1-1', agent: 'forge-impl', role: 'impl', project: 'sandbox' }));
    for (const [i, id] of ['a1', 'a2', 'a3'].entries()) {
      const r = start('s1', id, 'forge:forge-impl');
      expect(r).toMatchObject({ code: 0 });
      expect(deviations()).toHaveLength(i + 1);
    }
    const d = deviations();
    expect(d.map(e => e.task).sort()).toEqual(['T1-1', 'T2-1', 'T3-1']);
    expect(d[0]).toMatchObject({ agent: 'forge-impl', expected: 'forge-impl-light', agentId: 'a1', session: 's1', project: 'sandbox', runId: 'r1' });
    // the same agent starting again (a resume) is not a second deviation
    start('s1', 'a1', 'forge:forge-impl');
    expect(deviations()).toHaveLength(3);
  });
  it('the implementer forge named, a reviewer or an agent that is not forge\'s is no deviation', () => {
    execution({ T1: task('implement'), T2: task('implement') });
    handOut('T1', 'forge-impl-light');
    handOut('T2', 'forge-impl');
    start('s1', 'a1', 'forge:forge-impl');
    start('s1', 'a2', 'forge:forge-impl-light');
    start('s1', 'a3', 'forge:forge-review-correctness');
    start('s1', 'a4', 'general-purpose');
    start('s1', 'a5', 'forge-impl');
    expect(deviations()).toEqual([]);
  });
  it('only tasks at stage implement count, and another session of the run is not its coordinator', () => {
    execution({ T1: task('review') });
    handOut('T1', 'forge-impl-light');
    start('s1', 'a1', 'forge:forge-impl');
    expect(deviations()).toEqual([]);
    execution({ T1: task('implement') });
    start('s2', 'a2', 'forge:forge-impl');
    expect(deviations()).toEqual([]);
  });
  it("attended: this session's brief in progress, by its last phase", () => {
    io = { ...io, env: { CLAUDE_CODE_SESSION_ID: 's1' } };
    run(['log', '--kind', 'phase', '--task', 'fix-login', '--data', '{"phase":"implement","brief":1,"base":"b"}'], io);
    appendEvent(root, cliTriage(0, 'fix-login', 'forge-impl-light', { session: 's1' }));
    // another session starting an implementer has no task in progress here
    start('s2', 'b1', 'forge:forge-impl');
    expect(deviations()).toEqual([]);
    start('s1', 'a1', 'forge:forge-impl');
    expect(deviations()).toEqual([expect.objectContaining({ task: 'fix-login-1', agent: 'forge-impl', expected: 'forge-impl-light', agentId: 'a1' })]);
    // once the brief left its implementing phase, an implementer is no longer checked against it
    run(['log', '--kind', 'phase', '--task', 'fix-login', '--data', '{"phase":"done","brief":1,"base":"b"}'], io);
    start('s1', 'a2', 'forge:forge-impl');
    expect(deviations()).toHaveLength(1);
  });
  it('fails open: an execution or a ledger that does not read costs neither the hook nor its live signal', () => {
    writeFileSync(path.join(root, '.forge', 'execution.json'), '{not json');
    writeFileSync(path.join(root, '.forge', 'ledger.jsonl'), '\u0000\u0001garbage\n{"kind":');
    expect(start('s1', 'a1', 'forge:forge-impl')).toEqual({ code: 0, stdout: '', stderr: '' });
    expect(run(['hook', 'live'], { ...io, stdin: 'not json' })).toEqual({ code: 0, stdout: '', stderr: '' });
  });
});

describe('forge swarm step and the deviation check', () => {
  const PLAN = `project: shop
locale: en
version: "1"
artifacts: {}
versions: []
tracks:
  - { id: a, name: A, color: blue }
phases:
  - { id: p1, name: P1, plan_status: committed }
tasks:
  - { id: T1, title: T1, track: a, phase: p1, done_when: x, depends_on: [], zones: [src/t1/**] }
`;
  const NOW = new Date('2026-10-12T12:00:00.000Z');
  let root: string; let io: Io;
  const g = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
  const out = (r: { stdout: string; code: number; stderr: string }) => { if (r.code !== 0) throw new Error(r.stderr); return JSON.parse(r.stdout); };
  const step = () => out(run(['swarm', 'step', '--plan', 'plan.yaml', '--db', 'db'], io)) as { actions: { type: string; task?: string; agent?: string }[]; say: string };
  // the coordinator starts its agents after the step that handed them out
  const start = (agentId: string, agentType: string) => run(['hook', 'live'], {
    ...io, now: () => new Date(NOW.getTime() + 30_000),
    stdin: JSON.stringify({ session_id: 'hook-main', hook_event_name: 'SubagentStart', agent_id: agentId, agent_type: agentType, cwd: root }),
  });
  beforeEach(() => {
    root = tmp('forge-deviation-step-');
    g(root, 'init', '-q', '-b', 'main'); g(root, 'config', 'user.email', 'a@b.c'); g(root, 'config', 'user.name', 't'); g(root, 'config', 'core.autocrlf', 'false');
    writeFileSync(path.join(root, 'plan.yaml'), PLAN);
    writeFileSync(path.join(root, '.gitignore'), '.forge/\n.claude/\n');
    g(root, 'add', '.'); g(root, 'commit', '-qm', 'init');
    mkdirSync(path.join(root, '.forge'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'config.yaml'), 'validators: []\n');
    io = { cwd: root, now: () => NOW, git: defaultGit(root), sleep: () => undefined, env: {} };
    out(run(['swarm', 'start', '--project', 'shop', '--session', 'main', '--hook-session', 'hook-main'], io));
    for (const c of ['state', 'sessions']) mkdirSync(path.join(root, 'db', c), { recursive: true });
  });
  afterEach(() => { try { g(root, 'worktree', 'prune'); } catch { /* ignore */ } });

  it("logs its hand-out as forge's (by: step); the implementer it handed out is no deviation, another one is", () => {
    const spawn = step().actions.find(a => a.type === 'spawnImplementer')!;
    expect(readEvents(root).filter(e => e.kind === 'agent' && e.task === 'T1-1')).toEqual([expect.objectContaining({ agent: spawn.agent, by: 'step' })]);
    start('a1', `forge:${spawn.agent}`);
    expect(readEvents(root).filter(e => e.kind === 'deviation')).toEqual([]);
    const other = spawn.agent === 'forge-impl-heavy' ? 'forge-mech' : 'forge-impl-heavy';
    start('a2', `forge:${other}`);
    expect(readEvents(root).filter(e => e.kind === 'deviation')).toEqual([expect.objectContaining({ task: 'T1-1', agent: other, expected: spawn.agent, project: 'shop' })]);
    // the next step says it once, and swarm status lists it for the closing report
    io = { ...io, now: () => new Date(NOW.getTime() + 40_000) };
    const said = step();
    expect(said.say).toContain(`Deviation from the triage: T1-1 started ${other} where forge named ${spawn.agent}.`);
    expect((said as { deviations?: unknown }).deviations).toEqual([expect.objectContaining({ task: 'T1-1', agent: other })]);
    io = { ...io, now: () => new Date(NOW.getTime() + 60_000) };
    expect(step().say).not.toContain('Deviation');
    expect(out(run(['swarm', 'status'], io)).deviations).toEqual([expect.objectContaining({ task: 'T1-1', agent: other, expected: spawn.agent })]);
  });
});

describe('a deviation is said where the work goes on, and listed for the closing report', () => {
  let root: string; let wt: string; let io: Io; let base: string;
  const git = (...a: string[]) => execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', ...a], { cwd: wt, encoding: 'utf8' }).trim();
  const work = () => path.join(root, '.forge', 'work', 'T1');
  const review = { light: true, flags: [], reviewers: [{ role: 'review-correctness', model: 'sonnet', effort: 'medium', agent: 'forge-review-correctness' }] };
  const deviation = (min: number, task = 'T1-1') => appendEvent(root, ev(min, { kind: 'deviation', task, agent: 'forge-impl', expected: 'forge-impl-light', agentId: `a${min}` }));
  beforeEach(() => {
    root = tmp('forge-deviation-say-');
    wt = path.join(root, 'wt');
    mkdirSync(path.join(wt, '.forge'), { recursive: true });
    writeFileSync(path.join(wt, '.forge', 'config.yaml'), 'detect: false\nvalidators:\n  - name: check\n    cmd: node -e "process.exit(0)"\n');
    writeFileSync(path.join(wt, 'a.txt'), 'one\n');
    git('init', '-q'); git('config', 'core.autocrlf', 'false'); git('add', '-A'); git('commit', '-q', '-m', 'base');
    base = git('rev-parse', 'HEAD');
    writeFileSync(path.join(wt, 'a.txt'), 'one\ntwo\n'); git('commit', '-q', '-am', 'change');
    mkdirSync(work(), { recursive: true });
    writeFileSync(path.join(work(), 'brief-1.md'), '# T1\n');
    writeFileSync(path.join(work(), 'baseline-1.json'), '[{"validator":"check","ok":true,"flaky":false,"durationMs":1,"failures":[]}]\n');
    io = { cwd: root, now: () => new Date(at(30)), env: {} };
    appendEvent(root, cliTriage(0, 'T1', 'forge-impl-light', { path: 'medium', review }));
  });
  const prep = (locale = 'en') => JSON.parse(run(['review-prep', '--task', 'T1-1', '--path', 'medium', '--base', base, '--baseline', '.forge/work/T1/baseline-1.json',
    '--dir', '.forge/work/T1', '--cwd', wt, '--locale', locale], io).stdout);

  it('review-prep says the deviations of the brief since its last review, once', () => {
    deviation(10);
    const first = prep();
    expect(first.deviations).toEqual([{ task: 'T1-1', agent: 'forge-impl', expected: 'forge-impl-light', at: at(10) }]);
    expect(first.say).toContain('Deviation from the triage: T1-1 started forge-impl where forge named forge-impl-light.');
    expect(prep('es').say).not.toContain('forge-impl-light');
    deviation(40);
    io = { ...io, now: () => new Date(at(50)) };
    expect(prep('es').say).toContain('Desvío del triaje: en T1-1 arrancó forge-impl donde forge nombró forge-impl-light.');
  });
  it('review-close and last --task list every deviation of the brief', () => {
    deviation(10);
    deviation(12, 'T2-1');
    prep();
    writeFileSync(path.join(work(), 'reviews-1-1', 'correctness.json'), JSON.stringify({ verdict: 'pass', confidence: 0.9, findings: [] }));
    const close = JSON.parse(run(['review-close', '--task', 'T1-1', '--dir', '.forge/work/T1', '--path', 'medium', '--cwd', wt, '--locale', 'en'], io).stdout);
    expect(close.deviations).toEqual([{ task: 'T1-1', agent: 'forge-impl', expected: 'forge-impl-light', at: at(10) }]);
    expect(close.say).toContain('Deviation from the triage: T1-1');
    expect(JSON.parse(run(['last', '--task', 'T1'], io).stdout).deviations).toEqual([expect.objectContaining({ task: 'T1-1' })]);
    expect(JSON.parse(run(['last', '--task', 'T3'], io).stdout).deviations).toEqual([]);
  });
  it('the Small path is told by its validate --all, for this run of the task', () => {
    appendEvent(root, cliTriage(20, 'fix-a', 'forge-mech', { path: 'small' }));
    deviation(25, 'fix-a-1');
    const r = run(['validate', '--all', '--path', 'small', '--task', 'fix-a', '--cwd', wt], io);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('Deviation from the triage: fix-a-1 started forge-impl where forge named forge-impl-light.');
    // an implementer's own --affected pass says nothing
    expect(run(['validate', '--affected', 'a.txt', '--task', 'fix-a-1', '--cwd', wt], io).stderr).not.toContain('Deviation');
    // a deviation of an earlier run of the task (before its last triage) is not this run's
    appendEvent(root, cliTriage(28, 'fix-a', 'forge-mech', { path: 'small' }));
    expect(run(['validate', '--all', '--path', 'small', '--task', 'fix-a', '--cwd', wt], io).stderr).not.toContain('Deviation');
  });
});

describe('the triage records the implementer it names', () => {
  it('in its ledger event, and not for a triage of the real diff', () => {
    const root = tmp('forge-deviation-triage-');
    const git = (...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
    git('init', '-q', '-b', 'main'); git('config', 'user.email', 'a@b.c'); git('config', 'user.name', 't'); git('config', 'core.autocrlf', 'false');
    writeFileSync(path.join(root, 'a.ts'), 'export const a = 1;\n'); git('add', '.'); git('commit', '-qm', 'init');
    const io: Io = { cwd: root, now: () => new Date(T), git: defaultGit(root), env: {} };
    const r = run(['triage', '--task', 'fix-a', 'fix the typo in a.ts'], io);
    expect(r.code).toBe(0);
    const printed = JSON.parse(r.stdout).implementer.agent;
    const triages = () => readEvents(root).filter(e => e.kind === 'triage');
    expect(triages().at(-1)).toMatchObject({ task: 'fix-a', implementer: printed });
    const head = git('rev-parse', 'HEAD');
    writeFileSync(path.join(root, 'a.ts'), 'export const a = 2;\n'); git('commit', '-qam', 'fix');
    expect(run(['triage', '--task', 'fix-a', '--base', head, 'fix the typo in a.ts'], io).code).toBe(0);
    expect(triages().at(-1)).not.toHaveProperty('implementer');
  });
});
