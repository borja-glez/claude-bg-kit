import { describe, it, expect, beforeEach } from 'vitest';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { useTempDirs } from './helpers/tmp.js';
import { seedExecution } from './helpers/execution.js';
import { run, type Io } from '../src/forge/cli/run.js';
import { readEvents } from '../src/forge/ledger.js';
import { readExecution } from '../src/forge/execution.js';
import { closedPhase, flowSince, integratedSince, phaseToVerify, runStart } from '../src/forge/flow.js';
import type { ExecTask, ExecutionState } from '../src/lib/execution-state.js';

const tmp = useTempDirs();
const RUN = 'shop-20261016T100000000Z';
const AT = '2026-10-16T09:00:00.000Z';
let root: string;
let io: Io;
let base: string;
let branches = 0;
const g = (...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
/** git with a fixed committer date, to put a commit in the past. */
const gAt = (date: string, ...a: string[]) => execFileSync('git', a, {
  cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date },
}).trim();
const put = (f: string, text: string) => { mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); writeFileSync(path.join(root, f), text); };
const task = (title: string): ExecTask => ({ status: 'integrated', stage: 'integrate', round: 1, worktree: '', branch: 'task/x', executor: 'subagents',
  attempts: 0, agent: null, startedAt: AT, stageSince: AT, updatedAt: AT, detail: null, title });
const execution = (over: Partial<ExecutionState> = {}): ExecutionState => ({
  runId: RUN, kind: 'plan', mode: 'subagents', parallel: 2, project: 'shop', base: 'main', branch: 'forge/run-shop', mergeOnFinish: false, coordinator: 'main',
  hookSession: null, active: false, stopReason: 'finished', stallReason: null, startedAt: AT, lastStepAt: null, lastBlockStep: null,
  sleepUntil: null, closedAt: null, closedBy: null, tasks: { T1: task('Cart badge'), T2: task('CLI help') }, ...over,
});
/** A task branch merged into the current branch as swarm integrate merges it; `date` puts it in the past. */
const integrate = (id: string, file: string, date?: string) => {
  const git = (...a: string[]) => (date ? gAt(date, ...a) : g(...a));
  const from = g('rev-parse', '--abbrev-ref', 'HEAD');
  const branch = `task/${id}-${++branches}`;
  git('checkout', '-q', '-b', branch, from);
  put(file, `${id}\n`);
  git('add', '-A');
  git('commit', '-qm', `${id}: work`);
  git('checkout', '-q', from);
  git('merge', '--no-ff', '-q', '-m', `forge: integrate ${id}`, branch);
};
const vp = (...extra: string[]) => JSON.parse(run(['verify-plan', '--run', '--locale', 'en', ...extra], io).stdout);
const gitFn = (args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });

beforeEach(() => {
  root = tmp('forge-vflow-');
  io = { cwd: root, now: () => new Date('2026-10-16T12:00:00.000Z'), env: {} };
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 'a@b.c');
  g('config', 'user.name', 't');
  g('config', 'core.autocrlf', 'false');
  put('.forge/verify/web.md', '---\naffects: ["src/ui/**"]\n---\n# Web\n');
  put('docs/waypoint/shop/plan.yaml', 'project: shop\nlocale: en\nversion: "1"\ntracks:\n  - { id: a, name: A, color: blue }\n'
    + 'phases:\n  - { id: p1, name: P1 }\n  - { id: p2, name: P2 }\n'
    + 'tasks:\n  - { id: T1, title: Cart badge, track: a, phase: p1, done_when: the badge shows the count, zones: [src/ui/**] }\n'
    + '  - { id: T2, title: CLI help, track: a, phase: p1, done_when: the help lists the commands, zones: [bin/**] }\n'
    + '  - { id: T3, title: Later, track: a, phase: p2, done_when: it is there, zones: [] }\n');
  g('add', '-A');
  g('commit', '-qm', 'base');
  base = g('rev-parse', 'HEAD');
  g('checkout', '-q', '-b', 'forge/run-shop');
  integrate('T1', 'src/ui/Cart.tsx');
  integrate('T2', 'bin/cli.js');
  expect(run(['local', 'set', 'surfaces.web', 'allowed'], io).code).toBe(0);
  seedExecution(root, execution());
});

describe('the flow pass (K2-13)', () => {
  it('plans the surfaces of the integrated result since the first integration, every one at depth flow, and opens the pass', () => {
    const out = vp();
    expect(out.eligible).toBe(true);
    expect(out.surfaces.map((s: { name: string; depth: string }) => [s.name, s.depth])).toEqual([['web', 'flow']]);
    expect(out.flow).toMatchObject({ id: `flow-${RUN}-1`, n: 1, since: base, head: g('rev-parse', 'HEAD'), dir: `.forge/work/flow-${RUN}-1` });
    const brief = readFileSync(path.join(root, out.flow.brief), 'utf8');
    expect(brief).toContain('- T1: Cart badge — done when the badge shows the count');
    expect(brief).toContain('- T2: CLI help');
    expect(readFileSync(path.join(root, out.flow.diff), 'utf8')).toContain('src/ui/Cart.tsx');
    expect(readEvents(root).some(e => e.kind === 'verify')).toBe(false);
  });
  it('with verify.flow off there is no pass and no surface', () => {
    put('.forge/config.yaml', 'verify:\n  flow: off\n');
    expect(vp()).toMatchObject({ eligible: false, surfaces: [], flow: null, reason: 'verify.flow is off' });
  });
  it('verify-close --flow records the pass once: verify-flow, never verify, execution.json flow, and the next pass starts there', () => {
    const { flow } = vp();
    writeFileSync(path.join(root, flow.dir, 'verify.json'), JSON.stringify({ surfaces: ['web'], result: 'fail',
      checks: [{ id: 1, surface: 'web', name: 'checkout', main: true, ok: false, expected: 'paid', observed: '500' }] }));
    const close = () => JSON.parse(run(['verify-close', '--flow', flow.dir, '--locale', 'en'], io).stdout);
    expect(close()).toMatchObject({ result: 'fail', flow: { runId: RUN, sha: flow.head, result: 'fail' },
      failed: [{ surface: 'web', check: 'checkout', expected: 'paid', observed: '500' }] });
    close();
    expect(readEvents(root).filter(e => e.kind === 'verify-flow')).toEqual([expect.objectContaining({ runId: RUN, result: 'fail', dir: flow.dir })]);
    expect(readEvents(root).some(e => e.kind === 'verify')).toBe(false);
    expect(readExecution(root)!.flow).toMatchObject({ sha: flow.head, result: 'fail' });
    expect(vp()).toMatchObject({ eligible: false, flow: null, reason: 'nothing integrated since the last flow pass' });
  });
  it("--whole-run diffs from the run's start whatever the last pass covered, and excludes --since (I2)", () => {
    const first = vp().flow;
    writeFileSync(path.join(root, first.dir, 'verify.json'), JSON.stringify({ surfaces: ['web'], result: 'fail',
      checks: [{ id: 1, surface: 'web', name: 'checkout', main: true, ok: false, expected: 'paid', observed: '500' }] }));
    expect(run(['verify-close', '--flow', first.dir, '--locale', 'en'], io).code).toBe(0);
    integrate('T3', 'src/ui/More.tsx');
    const next = vp();
    expect(next.flow).toMatchObject({ n: 2, since: first.head });
    const whole = vp('--whole-run');
    expect(whole.flow).toMatchObject({ n: 3, since: base });
    expect(readFileSync(path.join(root, whole.flow.diff), 'utf8')).toContain('src/ui/Cart.tsx');
    expect(readFileSync(path.join(root, whole.flow.brief), 'utf8')).toContain('- T1: Cart badge');
    // M-2: a whole-run pass that closed at this commit is not run twice; a plain pass or another commit still is.
    expect(whole.flow.whole).toBe(true);
    writeFileSync(path.join(root, whole.flow.dir, 'verify.json'), JSON.stringify({ surfaces: ['web'], result: 'pass', checks: [] }));
    expect(run(['verify-close', '--flow', whole.flow.dir, '--locale', 'en'], io).code).toBe(0);
    expect(readExecution(root)!.flow).toMatchObject({ sha: whole.flow.head, whole: true });
    expect(vp('--whole-run')).toMatchObject({ flow: null, reason: 'the whole run was already verified at this commit' });
    integrate('T4', 'src/ui/Other.tsx');
    expect(vp('--whole-run').flow).toMatchObject({ n: 4, whole: true });
    const both = run(['verify-plan', '--run', '--whole-run', '--since', base], io);
    expect(both.code).toBe(2);
    expect(both.stderr).toContain('--since and --whole-run');
  });
  it("a blocked pass keeps its base: the next pass still diffs from the pass's own since, and moves it only after a pass or a fail (M6)", () => {
    const first = vp().flow;
    writeFileSync(path.join(root, first.dir, 'verify.json'), JSON.stringify({ surfaces: ['web'], result: 'blocked', reason: 'the emulator did not boot', checks: [] }));
    expect(run(['verify-close', '--flow', first.dir, '--locale', 'en'], io).code).toBe(0);
    expect(readExecution(root)!.flow).toMatchObject({ sha: first.head, result: 'blocked', since: base });
    integrate('T3', 'src/ui/More.tsx');
    const second = vp().flow;
    expect(second).toMatchObject({ n: 2, since: base });
    expect(readFileSync(path.join(root, second.brief), 'utf8')).toContain('- T1: Cart badge');
    writeFileSync(path.join(root, second.dir, 'verify.json'), JSON.stringify({ surfaces: ['web'], result: 'blocked', reason: 'again', checks: [] }));
    expect(run(['verify-close', '--flow', second.dir, '--locale', 'en'], io).code).toBe(0);
    integrate('T4', 'src/ui/Other.tsx');
    const third = vp().flow;
    expect(third).toMatchObject({ n: 3, since: base });
    writeFileSync(path.join(root, third.dir, 'verify.json'), JSON.stringify({ surfaces: ['web'], result: 'pass', checks: [] }));
    expect(run(['verify-close', '--flow', third.dir, '--locale', 'en'], io).code).toBe(0);
    expect(readExecution(root)!.flow).toMatchObject({ sha: third.head, result: 'pass', since: base });
    integrate('T5', 'src/ui/Last.tsx');
    expect(vp().flow).toMatchObject({ n: 4, since: third.head });
  });
  it("flowSince: the last pass, else the commit before the first integration of one of the run's tasks, else none", () => {
    expect(flowSince({ tasks: execution().tasks }, gitFn)).toBe(base);
    expect(flowSince({ tasks: execution().tasks, flow: { sha: 'abc1234', at: AT, result: 'pass' } }, gitFn)).toBe('abc1234');
    expect(flowSince({ tasks: {} }, gitFn)).toBeNull();
  });
  it("flowSince prefers the merges the run recorded (ExecTask.sha) over a scan of the subjects (R9)", () => {
    const t2 = g('rev-parse', 'HEAD');
    const tasks = { T1: execution().tasks.T1, T2: { ...execution().tasks.T2, sha: t2 } };
    expect(flowSince({ tasks }, gitFn)).toBe(g('rev-parse', `${t2}^1`));
    expect(flowSince({ tasks }, gitFn)).not.toBe(base);
    // A recorded sha that is not in the history falls back to the scan.
    expect(flowSince({ tasks: { T1: { ...tasks.T1, sha: 'deadbeef' }, T2: execution().tasks.T2 } }, gitFn)).toBe(base);
    // A short recorded sha matches too.
    expect(flowSince({ tasks: { T2: { ...tasks.T2, sha: t2.slice(0, 9) } } }, gitFn)).toBe(g('rev-parse', `${t2}^1`));
  });
  it("flowSince without recorded merges skips a previous run's integration, by the run's startedAt (R9)", () => {
    // forge/run-old: a previous run's `forge: integrate T1` in 2020, then this run's T2, merged just now.
    g('checkout', '-q', '-b', 'forge/run-old', 'main');
    integrate('T1', 'src/ui/Old.tsx', '2020-01-01T00:00:00Z');
    const prev = g('rev-parse', 'HEAD');
    integrate('T2', 'bin/new.js');
    const tasks = execution().tasks;
    expect(flowSince({ tasks }, gitFn)).toBe(base);
    expect(flowSince({ tasks, startedAt: '2026-01-01T00:00:00.000Z' }, gitFn)).toBe(prev);
  });
  it('verify-close --flow refuses a folder that is not a pass', () => {
    mkdirSync(path.join(root, '.forge', 'work', 'nope'), { recursive: true });
    expect(run(['verify-close', '--flow', '.forge/work/nope'], io).code).toBe(2);
    // A valid flow.json dropped into any other folder records nothing.
    const { flow } = vp();
    mkdirSync(path.join(root, '.forge', 'work', 'other'), { recursive: true });
    copyFileSync(path.join(root, flow.dir, 'flow.json'), path.join(root, '.forge', 'work', 'other', 'flow.json'));
    writeFileSync(path.join(root, '.forge', 'work', 'other', 'verify.json'), JSON.stringify({ surfaces: ['web'], result: 'pass', checks: [] }));
    expect(run(['verify-close', '--flow', '.forge/work/other'], io).code).toBe(2);
    expect(readEvents(root).some(e => e.kind === 'verify-flow')).toBe(false);
    expect(readExecution(root)!.flow).toBeUndefined();
  });
  it("verify-close --flow is the coordinator's: from a forge task worktree it exits 2 and records nothing", () => {
    const { flow } = vp();
    writeFileSync(path.join(root, flow.dir, 'verify.json'), JSON.stringify({ surfaces: ['web'], result: 'pass', checks: [] }));
    // M9: a real task worktree, which ledgerRoot maps to this checkout (on a branch integrate() never names).
    const wt = path.join(root, '.claude', 'worktrees', 'task-T1-1');
    g('worktree', 'add', '-q', wt, '-b', 'wt/task-T1-1');
    const r = run(['verify-close', '--flow', path.join(root, flow.dir)], { ...io, cwd: wt });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("--flow is the coordinator's");
    expect(readEvents(root).some(e => e.kind === 'verify-flow')).toBe(false);
    expect(readExecution(root)!.flow).toBeUndefined();
  });
  it('a pass number is the highest one plus one: a folder deleted by hand frees none, and a folder is never reused', () => {
    const { flow: first } = vp();
    const work = path.join(root, '.forge', 'work');
    for (const n of [2, 3]) {
      mkdirSync(path.join(work, `flow-${RUN}-${n}`));
      writeFileSync(path.join(work, `flow-${RUN}-${n}`, 'flow.json'), `{"keep":${n}}`);
    }
    expect(first.n).toBe(1);
    rmSync(path.join(work, `flow-${RUN}-2`), { recursive: true });
    const out = vp();
    expect(out.flow.n).toBe(4);
    expect(readFileSync(path.join(work, `flow-${RUN}-3`, 'flow.json'), 'utf8')).toBe('{"keep":3}');
  });
  describe('a surface that needs the person', () => {
    const cli = () => put('.forge/verify/cli.md', '---\naffects: ["bin/**"]\n---\n# CLI\n');
    const folders = () => readdirSync(path.join(root, '.forge', 'work')).filter(n => n.startsWith('flow-'));
    const surface = (out: { surfaces: { name: string }[] }, name: string) => out.surfaces.find(s => s.name === name) as Record<string, unknown>;
    it('attended, the pass opens only once nobody is waiting for an answer, and no folder is left before', () => {
      cli();
      const out = vp();
      expect(out.flow).toBeNull();
      expect(out.reason).toBe('ask the person first: cli');
      expect(surface(out, 'cli')).toMatchObject({ permission: 'ask' });
      expect(existsSync(path.join(root, '.forge', 'work')) ? folders() : []).toEqual([]);
      expect(run(['local', 'set', 'surfaces.cli', 'allowed'], io).code).toBe(0);
      expect(vp().flow).toMatchObject({ id: `flow-${RUN}-1`, n: 1 });
      expect(folders()).toEqual([`flow-${RUN}-1`]);
    });
    it('unattended, the pass opens with what is allowed, the rest logs its verify-skip with the pass id, and its note is asked once', () => {
      cli();
      const out = vp('--unattended');
      expect(out.flow).toMatchObject({ id: `flow-${RUN}-1` });
      expect(surface(out, 'cli')).toMatchObject({ permission: 'ask', note: true });
      expect(surface(out, 'web')).not.toHaveProperty('note');
      expect(readEvents(root).filter(e => e.kind === 'verify-skip').map(e => [e.task, e.surface])).toEqual([[`flow-${RUN}-1`, 'cli']]);
      writeFileSync(path.join(root, out.flow.dir, 'verify.json'), JSON.stringify({ surfaces: ['web'], result: 'pass', checks: [] }));
      expect(run(['verify-close', '--flow', out.flow.dir], io).code).toBe(0);
      integrate('T3', 'src/ui/More.tsx');
      put('bin/more.js', 'more\n');
      g('add', '-A');
      g('commit', '-qm', 'T3: bin');
      const again = vp('--unattended');
      expect(again.flow).toMatchObject({ id: `flow-${RUN}-2` });
      expect(surface(again, 'cli')).toMatchObject({ note: false });
    });
    it('unattended with only a surface that needs the person: no pass, and the note is asked once', () => {
      cli();
      const since = g('rev-parse', 'HEAD^1');
      const out = vp('--unattended', '--since', since);
      expect(out.flow).toBeNull();
      expect(out.reason).toBe('no surface is allowed for an unattended pass');
      expect(out.surfaces.map((s: { name: string }) => s.name)).toEqual(['cli']);
      expect(surface(out, 'cli')).toMatchObject({ note: true });
      expect(surface(vp('--unattended', '--since', since), 'cli')).toMatchObject({ note: false });
      expect(existsSync(path.join(root, '.forge', 'work')) ? folders() : []).toEqual([]);
    });
    it('«No, esta vez» is recorded on a finished run, and the attended pass then ends with a reason that is not a question (C1, M4)', () => {
      cli();
      const since = g('rev-parse', 'HEAD^1');
      expect(readExecution(root)).toMatchObject({ active: false, stopReason: 'finished' });
      expect(vp('--since', since).reason).toBe('ask the person first: cli');
      const skip = run(['verify-preflight', '--skip', 'cli'], io);
      expect(skip.code).toBe(0);
      expect(JSON.parse(skip.stdout)).toMatchObject({ runId: RUN, skip: ['cli'] });
      const out = vp('--since', since);
      expect(out.flow).toBeNull();
      expect(out.reason).toBe('no surface is allowed for this pass');
      expect(surface(out, 'cli')).toMatchObject({ permission: 'skipped' });
      expect(existsSync(path.join(root, '.forge', 'work')) ? folders() : []).toEqual([]);
    });
  });
  it('an ephemeral run, already closed by the tick that finished it, still gets its pass (K2-13.4)', () => {
    seedExecution(root, execution({ kind: 'ephemeral', closedAt: AT, closedBy: 'merge' }));
    expect(vp().flow).not.toBeNull();
  });
});

describe('w9: a run whose merges are titled in Conventional Commits', () => {
  it('integratedSince and runStart find its tasks by chore(forge): integrate <T> as by forge: integrate <T>', () => {
    const tasks = { T1: execution().tasks.T1, T2: execution().tasks.T2 };
    const subjects = ['chore(forge): integrate T1', 'forge: integrate T2', 'chore(forge): integrate T10', 'chore(forge): merge forge/run-shop'];
    const fake = (args: string[]) => (args.includes('--format=%s') ? subjects.join('\n')
      : args.includes('--format=%H %P%x09%s') ? `a1 p1\t${subjects[0]}\n` : null);
    expect(integratedSince({ tasks }, fake, 'base')).toEqual(['T1', 'T2']);
    expect(runStart({ tasks }, fake)).toBe('p1');
  });
});

describe('the phase a flow pass verifies (K2-13, verify.flow phase)', () => {
  it('closedPhase: the phase once every task of it is finished, else null', () => {
    const tasks = [{ id: 'T1', phase: 'p1' }, { id: 'T2', phase: 'p1' }, { id: 'T3', phase: 'p2' }];
    expect(closedPhase(tasks, 'T1', id => id === 'T1')).toBeNull();
    expect(closedPhase(tasks, 'T2', id => id !== 'T3')).toBe('p1');
    expect(closedPhase(tasks, 'T9', () => true)).toBeNull();
  });
  it('phaseToVerify reads verify.flow, the plan, the run and the roadmap cache', () => {
    const plan = 'docs/waypoint/shop/plan.yaml', db = '.waypoint/shop/dbcache';
    expect(phaseToVerify(root, plan, db, 'T2')).toBeNull();
    put('.forge/config.yaml', 'verify:\n  flow: phase\n');
    expect(phaseToVerify(root, plan, db, 'T2')).toBe('p1');
    expect(phaseToVerify(root, plan, db, 'T3')).toBeNull();
    put(`${db}/state/T3.json`, JSON.stringify({ status: 'done' }));
    expect(phaseToVerify(root, plan, db, 'T3')).toBe('p2');
  });
});
