import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync, readdirSync, appendFileSync, lstatSync, symlinkSync, statSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { run, defaultGit, defaultExec, repoReader, type Io } from '../src/forge/cli/run.js';
import { swarmCommand, type SwarmDeps } from '../src/forge/cli/swarm.js';
import { readExecution } from '../src/forge/execution.js';
import { readLocal } from '../src/forge/local.js';
import { readEvents } from '../src/forge/ledger.js';
import { loadConfig } from '../src/forge/config.js';
import { SLOT_MAX_WAIT_MS } from '../src/forge/jobs.js';
import { mergingFile, readMerging, readMergingFile, removeMergingIf, takeMerging, MERGING_UNREADABLE_MS } from '../src/forge/merging.js';
import { authDir, mergeAsk, readAuths, useAuth, writeAuth, type AuthRecord } from '../src/forge/auth.js';
import { hookAnswerStdin } from './helpers/hook-answer.js';
import { useTempDirs } from './helpers/tmp.js';
import { seedExecution } from './helpers/execution.js';
const tmp = useTempDirs();

let root: string;
let io: Io;
const g = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
const git = (...a: string[]) => g(root, ...a);
const commitIn = (cwd: string, file: string, text: string, msg: string) => { writeFileSync(path.join(cwd, file), text); g(cwd, 'add', file); g(cwd, 'commit', '-qm', msg); return g(cwd, 'rev-parse', 'HEAD'); };
const out = (r: { stdout: string }) => JSON.parse(r.stdout);
const runWt = () => path.join(root, '.claude', 'worktrees', 'run');
const NOBAD = 'validators:\n  - name: nobad\n    cmd: node -e "process.exit(require(\'fs\').existsSync(\'bad.txt\')?1:0)"\n';
/** I-03: the person's answer to an AskUserQuestion, as the hook `answer` records it (PostToolUse, stdin), at the time `at` says. */
const answer = (question: string, label: string, session = 'hook-main', at: Io = io) =>
  run(['hook', 'answer'], { ...at, stdin: hookAnswerStdin({ cwd: root, session, answers: { [question]: label } }) });
/** I-03: swarm merge as the skill runs it: the question, the person's yes recorded by the hook, then --yes from the same session. */
const mergeYes = (extra: string[] = [], at: Io = io) => {
  const first = run(['swarm', 'merge', '--hook-session', 'hook-main', ...extra], at);
  const p = first.code === 0 ? JSON.parse(first.stdout) : null;
  if (p?.result !== 'needs-authorization') return first;
  answer(p.ask.question, p.ask.options[0].label, 'hook-main', at);
  return run(['swarm', 'merge', '--yes', '--hook-session', 'hook-main', ...extra], at);
};

beforeEach(() => {
  root = tmp('forge-integ-');
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 'a@b.c'); git('config', 'user.name', 't'); git('config', 'core.autocrlf', 'false');
  writeFileSync(path.join(root, '.gitignore'), '.forge/\n.claude/\n');
  git('add', '.gitignore');
  commitIn(root, 'base.txt', 'base\n', 'init');
  mkdirSync(path.join(root, '.forge'), { recursive: true });
  writeFileSync(path.join(root, '.forge', 'config.yaml'), 'validators: []\n');
  io = { cwd: root, now: () => new Date('2026-10-12T12:00:00.000Z'), git: defaultGit(root), env: {} };
  out(run(['swarm', 'start', '--project', 'shop', '--session', 'main', '--hook-session', 'hook-main'], io));
});
afterEach(() => { try { git('worktree', 'prune'); } catch { /* ignore */ } });

const accept = (task: string, file: string, text: string) => {
  const w = out(run(['swarm', 'worktree', task], io)).worktree;
  commitIn(w, file, text, `${task}: work`);
  out(run(['swarm', 'task', task, '--stage', 'verdict', '--status', 'accepted'], io));
  return w;
};

describe('forge swarm integrate (into the run branch)', () => {
  it('integrate prints the commit as commit-info does, measured by what the task brings (H-16)', () => {
    const w = out(run(['swarm', 'worktree', 'T1'], io)).worktree;
    commitIn(w, 'base.txt', 'changed\nmore\n', 'T1: rewrite base');
    commitIn(w, 'b.txt', 'b\n', 'T1: add b');
    out(run(['swarm', 'task', 'T1', '--stage', 'verdict', '--status', 'accepted'], io));
    const r = out(run(['swarm', 'integrate', 'T1'], io));
    expect(r).toMatchObject({ result: 'integrated' });
    // A merge commit: git show --shortstat prints nothing for it, so commit-info gave 0 and 0.
    expect(r.commit).toEqual({ sha: r.sha, ts: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.000Z$/), title: 'T1: add b', add: 3, del: 1 });
    expect(r.commit.sha).toBe(g(runWt(), 'rev-parse', 'HEAD'));
  });
  it('with verify.flow phase, integrate prints the phase it finished as flow, from --plan or the project\'s plan; by default it prints none (I5)', () => {
    const plan = 'project: shop\nlocale: en\nversion: "1"\ntracks:\n  - { id: a, name: A, color: blue }\nphases:\n  - { id: p1, name: P1 }\n  - { id: p2, name: P2 }\n'
      + 'tasks:\n  - { id: T1, title: One, track: a, phase: p1, done_when: it works, zones: [] }\n'
      + '  - { id: T2, title: Two, track: a, phase: p1, done_when: it works, zones: [] }\n'
      + '  - { id: T3, title: Three, track: a, phase: p2, done_when: it works, zones: [] }\n';
    mkdirSync(path.join(root, 'docs', 'waypoint', 'shop'), { recursive: true });
    writeFileSync(path.join(root, 'docs', 'waypoint', 'shop', 'plan.yaml'), plan);
    writeFileSync(path.join(root, 'other.yaml'), plan);
    accept('T1', 'a.txt', 'a\n');
    expect(out(run(['swarm', 'integrate', 'T1'], io))).not.toHaveProperty('flow');
    writeFileSync(path.join(root, '.forge', 'config.yaml'), 'validators: []\nverify:\n  flow: phase\n');
    accept('T2', 'b.txt', 'b\n');
    // T1 is integrated in the run, T2 is the last of p1: the project's plan is the default.
    const r = out(run(['swarm', 'integrate', 'T2'], io));
    expect(r).toMatchObject({ result: 'integrated', flow: { phase: 'p1' } });
    // --plan names another plan file.
    accept('T3', 'c.txt', 'c\n');
    expect(out(run(['swarm', 'integrate', 'T3', '--plan', 'other.yaml'], io))).toMatchObject({ result: 'integrated', flow: { phase: 'p2' } });
  });
  it('swarm task logs a stage once when review-prep already logged it as a phase (C4)', () => {
    out(run(['swarm', 'worktree', 'T1'], io));
    // review-prep of a plan task logs its phase with the run's project (its --dir names it, C4), as swarm task does.
    run(['log', '--kind', 'phase', '--task', 'T1', '--project', 'shop', '--data', '{"phase":"validate","brief":1,"round":1}'], io);
    out(run(['swarm', 'task', 'T1', '--stage', 'validate'], io));
    out(run(['swarm', 'task', 'T1', '--stage', 'review'], io));
    expect(readEvents(root).filter(e => e.kind === 'phase' && e.task === 'T1').map(e => e.phase)).toEqual(['validate', 'review']);
  });
  it('merge closes the ended execution it merged; needs-authorization closes nothing (C2, D-05)', () => {
    accept('T1', 'a.txt', 'a\n');
    out(run(['swarm', 'integrate', 'T1'], io));
    seedExecution(root, { ...readExecution(root)!, active: false, stopReason: 'finished' });
    expect(out(run(['swarm', 'merge'], io))).toMatchObject({ result: 'needs-authorization' });
    expect(readExecution(root)!.closedAt).toBeNull();
    expect(out(mergeYes())).toMatchObject({ result: 'merged', closed: true });
    expect(readExecution(root)).toMatchObject({ closedAt: '2026-10-12T12:00:00.000Z', closedBy: 'merge' });
  });
  it('merges an accepted task into the run branch in its worktree, never in the main checkout', () => {
    accept('T1', 'a.txt', 'a\n');
    expect(out(run(['swarm', 'integrate', 'T1'], io))).toMatchObject({ result: 'integrated' });
    expect(g(runWt(), 'log', '-1', '--format=%s')).toBe('forge: integrate T1');
    expect(git('log', '-1', '--format=%s')).toBe('init');
    expect(readExecution(root)!.tasks.T1).toMatchObject({ status: 'integrated', stage: 'integrate', finishedAt: '2026-10-12T12:00:00.000Z' });
  });
  it('refuses a task that is not accepted', () => {
    out(run(['swarm', 'worktree', 'T1'], io));
    expect(run(['swarm', 'integrate', 'T1'], io).code).toBe(2);
  });
  it('rolls back a conflict and marks the task in conflict', () => {
    accept('T1', 'base.txt', 'from T1\n');
    commitIn(runWt(), 'base.txt', 'from run\n', 'run change');
    const before = g(runWt(), 'rev-parse', 'HEAD');
    expect(out(run(['swarm', 'integrate', 'T1'], io))).toMatchObject({ result: 'conflict' });
    expect(g(runWt(), 'rev-parse', 'HEAD')).toBe(before);
    expect(g(runWt(), 'status', '--porcelain')).toBe('');
    expect(readExecution(root)!.tasks.T1.status).toBe('conflict');
    expect(readExecution(root)!.tasks.T1.finishedAt ?? null).toBeNull();
  });
  it('integrate --out runs as a job: its validators wait for a slot, and the file holds what it printed with waitedMs (C-03)', () => {
    writeFileSync(path.join(root, '.forge', 'config.yaml'), 'swarm:\n  validateJobs: 1\nvalidators: []\n');
    mkdirSync(path.join(runWt(), '.forge'), { recursive: true });
    writeFileSync(path.join(runWt(), '.forge', 'config.yaml'), NOBAD);
    accept('T1', 'a.txt', 'a\n');
    const jobs = path.join(root, '.forge', 'jobs');
    mkdirSync(jobs, { recursive: true });
    writeFileSync(path.join(jobs, 'other.json'), JSON.stringify({ name: 'other', cmd: 'prep', task: 'T2-1', pid: process.pid, startedAt: '2026-10-12T11:00:00.000Z', out: 'x.json', session: null, slot: 'validating' }));
    let sleeps = 0;
    const r = run(['swarm', 'integrate', 'T1', '--out', '.forge/work/run/integrate-T1.json'], { ...io, sleep: () => { if (++sleeps === 1) rmSync(path.join(jobs, 'other.json')); } });
    const file = JSON.parse(readFileSync(path.join(root, '.forge', 'work', 'run', 'integrate-T1.json'), 'utf8'));
    expect(file).toMatchObject({ result: 'integrated', waitedMs: 1000 });
    expect(out(r)).toEqual(file);
    expect(sleeps).toBe(1);
    expect(readdirSync(jobs)).toEqual([]);
  });
  it('rolls back when the validators fail after the merge', () => {
    accept('T1', 'bad.txt', 'x\n');
    // Validators run in the run worktree: its own .forge/config.yaml is read from there.
    // Green on the run tip, red once bad.txt is merged in (a validator red from the start would be preexisting).
    mkdirSync(path.join(runWt(), '.forge'), { recursive: true });
    writeFileSync(path.join(runWt(), '.forge', 'config.yaml'), NOBAD);
    const before = g(runWt(), 'rev-parse', 'HEAD');
    expect(out(run(['swarm', 'integrate', 'T1'], io)).detail).toContain('validators failed');
    expect(g(runWt(), 'rev-parse', 'HEAD')).toBe(before);
    expect(() => g(runWt(), 'rev-parse', '-q', '--verify', 'MERGE_HEAD')).toThrow();
    expect(g(runWt(), 'status', '--porcelain')).toBe('');
  });
  it('does not roll back for a validator the run branch already failed, and records it as preexisting', () => {
    // A validator that passes only when web.txt exists: red on the run branch from the start.
    const WEB = 'validators:\n  - name: web\n    cmd: node -e "process.exit(require(\'fs\').existsSync(\'web.txt\')?0:1)"\n';
    mkdirSync(path.join(runWt(), '.forge'), { recursive: true });
    writeFileSync(path.join(runWt(), '.forge', 'config.yaml'), WEB);
    accept('T1', 'a.txt', 'a\n');
    accept('T2', 'b.txt', 'b\n');
    const r = out(run(['swarm', 'integrate', 'T1'], io));
    expect(r).toMatchObject({ result: 'integrated', preexisting: ['web'], newValidators: [] });
    expect(r.say).toEqual(['Validators that already failed on forge/run-shop and do not count: web.']);
    expect(readExecution(root)!.tasks.T1.status).toBe('integrated');
    expect(out(run(['swarm', 'integrate', 'T2', '--locale', 'es'], io)).say).toEqual(['Validadores que ya fallaban en forge/run-shop y no cuentan: web.']);
  });
  it('announces the validators a merge brought, in the plan language, and records them as known', () => {
    const LINT = 'validators:\n  - name: lint2\n    cmd: node -e "0"\n';
    const bring = (task: string, file: string) => {
      const w = accept(task, file, 'x\n');
      mkdirSync(path.join(w, '.forge'), { recursive: true });
      writeFileSync(path.join(w, '.forge', 'config.yaml'), LINT);
      g(w, 'add', '-f', '.forge/config.yaml'); g(w, 'commit', '-qm', 'validators');
    };
    bring('T1', 'a.txt');
    const r = out(run(['swarm', 'integrate', 'T1'], io));
    expect(r).toMatchObject({ result: 'integrated', newValidators: [{ name: 'lint2', cmd: 'node -e "0"' }] });
    expect(r.say).toEqual(['New validator lint2: `node -e "0"`']);
    expect(readLocal(root).known).toContain('lint2');
    // A second merge that brings nothing new announces nothing.
    accept('T2', 'b.txt', 'b\n');
    expect(out(run(['swarm', 'integrate', 'T2'], io))).toMatchObject({ result: 'integrated', newValidators: [], say: [] });
    // The plan's locale (docs/waypoint/<project>/plan.yaml) speaks Spanish.
    mkdirSync(path.join(root, 'docs', 'waypoint', 'shop'), { recursive: true });
    writeFileSync(path.join(root, 'docs', 'waypoint', 'shop', 'plan.yaml'), 'project: shop\nlocale: es\nversion: "1"\nartifacts: {}\nversions: []\ntracks:\n  - { id: a, name: A, color: blue }\nphases:\n  - { id: p1, name: P1, plan_status: committed }\ntasks:\n  - { id: T1, title: T1, track: a, phase: p1, done_when: x, depends_on: [], zones: [] }\n');
    writeFileSync(path.join(runWt(), '.forge', 'config.yaml'), 'validators: []\n');
    g(runWt(), 'add', '-f', '.forge/config.yaml'); g(runWt(), 'commit', '-qm', 'no validators');
    bring('T3', 'c.txt');
    const bad = run(['swarm', 'integrate', 'T3', '--locale', 'fr'], io);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain('--locale');
    expect(readExecution(root)!.tasks.T3.status).toBe('accepted');
    expect(out(run(['swarm', 'integrate', 'T3'], io)).say).toEqual(['Nuevo validador lint2: `node -e "0"`']);
  });
  it('learned notes two tasks append to the same surface merge without a conflict', () => {
    const surface = '.forge/verify/web.md';
    mkdirSync(path.join(runWt(), '.forge', 'verify'), { recursive: true });
    writeFileSync(path.join(runWt(), surface), '# web\n\n## Aprendido\n\n- 2026-10-01: base note\n');
    g(runWt(), 'add', '-f', surface); g(runWt(), 'commit', '-qm', 'surface');
    const note = (task: string) => {
      const w = out(run(['swarm', 'worktree', task], io)).worktree;
      appendFileSync(path.join(w, surface), `- 2026-10-12: note from ${task}\n`);
      g(w, 'commit', '-qam', `${task}: note`);
      out(run(['swarm', 'task', task, '--stage', 'verdict', '--status', 'accepted'], io));
    };
    note('T1'); note('T2');
    expect(out(run(['swarm', 'integrate', 'T1'], io)).result).toBe('integrated');
    expect(out(run(['swarm', 'integrate', 'T2'], io)).result).toBe('integrated');
    const text = readFileSync(path.join(runWt(), surface), 'utf8');
    expect(text).toContain('note from T1');
    expect(text).toContain('note from T2');
    expect(readFileSync(path.join(root, '.git', 'info', 'attributes'), 'utf8').split(/\r?\n/).filter(l => l === '/.forge/verify/*.md merge=union')).toHaveLength(1);
  });
  it('still rolls back a validator that passed before the merge and fails after it', () => {
    mkdirSync(path.join(runWt(), '.forge'), { recursive: true });
    writeFileSync(path.join(runWt(), '.forge', 'config.yaml'), NOBAD);
    accept('T1', 'bad.txt', 'x\n');
    const r = out(run(['swarm', 'integrate', 'T1'], io));
    expect(r.result).toBe('conflict');
    expect(r.detail).toContain('nobad');
  });
  const counted = (counter: string) => {
    const CNT = `validators:\n  - name: cnt\n    cmd: node -e "require('fs').appendFileSync('${counter.replace(/\\/g, '/')}','x\\n')"\n`;
    mkdirSync(path.join(runWt(), '.forge'), { recursive: true });
    writeFileSync(path.join(runWt(), '.forge', 'config.yaml'), CNT);
    return () => (existsSync(counter) ? readFileSync(counter, 'utf8').split('\n').filter(Boolean).length : 0);
  };
  it('a second integration reuses the cached run baseline (validators run once per integration)', () => {
    const count = counted(path.join(root, '..', `cnt-${path.basename(root)}.txt`));
    accept('T1', 'a.txt', 'a\n');
    accept('T2', 'b.txt', 'b\n');
    out(run(['swarm', 'integrate', 'T1'], io));
    const afterFirst = count();
    expect(afterFirst).toBe(2); // baseline + post-merge
    out(run(['swarm', 'integrate', 'T2'], io));
    expect(count()).toBe(afterFirst + 1);
    rmSync(path.join(root, '..', `cnt-${path.basename(root)}.txt`), { force: true });
  });
  it('neither integrate nor merge write a per-sha baseline any more (C6 replaces it)', () => {
    accept('T1', 'a.txt', 'a\n');
    out(run(['swarm', 'integrate', 'T1'], io));
    expect(out(mergeYes())).toMatchObject({ result: 'merged', preexisting: [] });
    expect(existsSync(path.join(root, '.forge', 'execution', 'baseline'))).toBe(false);
  });
  it('still reads a per-sha baseline forge 0.16 left for the run tip, and writes none', () => {
    const counter = path.join(root, '..', `cnt-${path.basename(root)}.txt`);
    const count = counted(counter);
    accept('T1', 'a.txt', 'a\n');
    const dir = path.join(root, '.forge', 'execution', 'baseline');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `heavy-run-${g(runWt(), 'rev-parse', 'HEAD')}.json`), '[]');
    expect(g(runWt(), 'status', '--porcelain', '--untracked-files=all')).toBe('');
    expect(out(run(['swarm', 'integrate', 'T1'], io)).result).toBe('integrated');
    expect(count()).toBe(1); // after the merge only: the tip's baseline came from the old file
    expect(readdirSync(dir)).toHaveLength(1);
    rmSync(counter, { force: true });
  });
  it('a merge whose tree the task already validated runs nothing after it, and logs the baseline and the merged validate (C-01, C6)', () => {
    const counter = path.join(root, '..', `cnt-${path.basename(root)}.txt`);
    const count = counted(counter);
    const w = accept('T1', 'a.txt', 'a\n');
    // What review-prep does in the task worktree: a heavy run of its HEAD, with the same config, fills the tree cache.
    mkdirSync(path.join(w, '.forge'), { recursive: true });
    writeFileSync(path.join(w, '.forge', 'config.yaml'), readFileSync(path.join(runWt(), '.forge', 'config.yaml'), 'utf8'));
    expect(run(['validate', '--all', '--path', 'large', '--cwd', w], io).code).toBe(0);
    expect(count()).toBe(1);
    expect(g(runWt(), 'status', '--porcelain', '--untracked-files=all')).toBe('');
    expect(out(run(['swarm', 'integrate', 'T1'], io)).result).toBe('integrated');
    expect(count()).toBe(2); // only the run tip's baseline ran
    const validates = readEvents(root).filter(e => e.kind === 'validate' && e.task === 'T1');
    expect(validates.map(e => [e.integrate, e.baseline ?? false, e.cached, e.scope])).toEqual([['baseline', true, false, 'heavy'], ['merged', false, true, 'heavy']]);
    for (const e of validates) expect(typeof e.durationMs).toBe('number');
    rmSync(counter, { force: true });
  });
  it('--no-cache neither reads nor writes the tree cache: both validations run (a cached red result may be flaky)', () => {
    const counter = path.join(root, '..', `cnt-${path.basename(root)}.txt`);
    const count = counted(counter);
    const w = accept('T1', 'a.txt', 'a\n');
    // The merged tree is in the cache, as review-prep leaves it in the task worktree.
    mkdirSync(path.join(w, '.forge'), { recursive: true });
    writeFileSync(path.join(w, '.forge', 'config.yaml'), readFileSync(path.join(runWt(), '.forge', 'config.yaml'), 'utf8'));
    expect(run(['validate', '--all', '--path', 'large', '--cwd', w], io).code).toBe(0);
    const cacheDir = path.join(root, '.forge', 'cache', 'validate');
    const before = readdirSync(cacheDir).sort();
    expect(out(run(['swarm', 'integrate', 'T1', '--no-cache'], io)).result).toBe('integrated');
    expect(count()).toBe(3); // the run tip's baseline and the merged tree, none from the cache
    expect(readdirSync(cacheDir).sort()).toEqual(before);
    const validates = readEvents(root).filter(e => e.kind === 'validate' && e.task === 'T1');
    expect(validates.map(e => [e.integrate, e.cached])).toEqual([['baseline', false], ['merged', false]]);
    rmSync(counter, { force: true });
  });
  it('a validator red on the run tip still blocks a merge that adds a failing test, and the detail names it (D-06)', () => {
    const OLD_NEW = "validators:\n  - name: web\n    cmd: node -e \"console.log('FAIL tests/a.test.ts > old');if(require('fs').existsSync('n.txt'))console.log('FAIL tests/a.test.ts > new');process.exit(1)\"\n";
    mkdirSync(path.join(runWt(), '.forge'), { recursive: true });
    writeFileSync(path.join(runWt(), '.forge', 'config.yaml'), OLD_NEW);
    accept('T1', 'n.txt', 'x\n');
    expect(g(runWt(), 'status', '--porcelain', '--untracked-files=all')).toBe('');
    const r = out(run(['swarm', 'integrate', 'T1'], io));
    expect(r.result).toBe('conflict');
    expect(r.detail).toContain('web (new failing: tests/a.test.ts > new)');
    accept('T2', 'other.txt', 'x\n');
    expect(out(run(['swarm', 'integrate', 'T2'], io))).toMatchObject({ result: 'integrated', preexisting: ['web'] });
  });
  it('a validator that leaves files in the worktree makes the integration run-dirty and the task stays accepted', () => {
    const JUNK = 'validators:\n  - name: junk\n    cmd: node -e "require(\'fs\').writeFileSync(\'junk.txt\',\'x\')"\n';
    mkdirSync(path.join(runWt(), '.forge'), { recursive: true });
    writeFileSync(path.join(runWt(), '.forge', 'config.yaml'), JUNK);
    accept('T1', 'a.txt', 'a\n');
    const r = out(run(['swarm', 'integrate', 'T1'], io));
    expect(r.result).toBe('run-dirty');
    expect(r.detail).toContain('junk.txt');
    expect(readExecution(root)!.tasks.T1.status).toBe('accepted');
  });
  describe('validators that regenerate tracked files', () => {
    // A validator that rewrites the tracked gen.txt (a build that regenerates its committed bundle), when `cond` holds.
    const GEN = (cond = '') => `validators:\n  - name: gen\n    cmd: node -e "const f=require('fs');${cond}f.writeFileSync('gen.txt',String(Date.now()))"\n`;
    const runConfig = (text: string) => { mkdirSync(path.join(runWt(), '.forge'), { recursive: true }); writeFileSync(path.join(runWt(), '.forge', 'config.yaml'), text); };
    it('integrate puts back what its validators regenerated, says so, and the next task integrates', () => {
      commitIn(runWt(), 'gen.txt', 'committed\n', 'gen');
      runConfig(GEN());
      accept('T1', 'a.txt', 'a\n');
      accept('T2', 'b.txt', 'b\n');
      const r = out(run(['swarm', 'integrate', 'T1'], io));
      expect(r).toMatchObject({ result: 'integrated', restored: ['gen.txt'] });
      expect(g(runWt(), 'status', '--porcelain')).toBe('');
      expect(g(runWt(), 'show', `${r.sha}:gen.txt`)).toBe('committed');
      expect(out(run(['swarm', 'integrate', 'T2'], io))).toMatchObject({ result: 'integrated', restored: ['gen.txt'] });
      expect(g(runWt(), 'status', '--porcelain')).toBe('');
    });
    it('the baseline run on the run tip leaves nothing regenerated behind', () => {
      commitIn(runWt(), 'gen.txt', 'committed\n', 'gen');
      // Rewrites gen.txt only on the pre-merge tip (before a.txt is merged in): only the baseline regenerates it.
      runConfig(GEN("if(!f.existsSync('a.txt'))"));
      accept('T1', 'a.txt', 'a\n');
      const r = out(run(['swarm', 'integrate', 'T1'], io));
      expect(r).toMatchObject({ result: 'integrated', restored: ['gen.txt'] });
      expect(g(runWt(), 'status', '--porcelain')).toBe('');
      expect(readExecution(root)!.tasks.T1.status).toBe('integrated');
    });
    it('a rejected merge is rolled back even though its validators regenerated a tracked file', () => {
      commitIn(runWt(), 'gen.txt', 'committed\n', 'gen');
      runConfig(`${NOBAD}  - name: gen\n    cmd: node -e "require('fs').writeFileSync('gen.txt',String(Date.now()))"\n`);
      accept('T1', 'bad.txt', 'x\n');
      const before = g(runWt(), 'rev-parse', 'HEAD');
      const r = out(run(['swarm', 'integrate', 'T1'], io));
      expect(r).toMatchObject({ result: 'conflict', restored: ['gen.txt'] });
      expect(r.detail).toContain('validators failed');
      expect(g(runWt(), 'rev-parse', 'HEAD')).toBe(before);
      expect(g(runWt(), 'status', '--porcelain')).toBe('');
    });
    it('an unmoved final merge validated in the run worktree puts back what its validators regenerated there', () => {
      commitIn(runWt(), 'gen.txt', 'committed\n', 'gen');
      accept('T1', 'a.txt', 'a\n');
      expect(out(run(['swarm', 'integrate', 'T1'], io)).result).toBe('integrated');
      // The final validators come from the main checkout's config; there gen.txt is not there before the merge.
      writeFileSync(path.join(root, '.forge', 'config.yaml'), GEN("if(f.existsSync('gen.txt'))"));
      const r = out(mergeYes());
      expect(r).toMatchObject({ result: 'merged', restored: ['gen.txt'] });
      expect(g(runWt(), 'status', '--porcelain')).toBe('');
      expect(git('status', '--porcelain')).toBe('');
      expect(readFileSync(path.join(root, 'gen.txt'), 'utf8')).toBe('committed\n');
    });
    // An ephemeral execution on the person's checkout with `config` as its .forge/config.yaml, fix-a and fix-b to do.
    const ephemeral = (config: string) => {
      commitIn(root, 'gen.txt', 'committed\n', 'gen');
      expect(run(['swarm', 'stop'], io).code).toBe(0);
      writeFileSync(path.join(root, '.forge', 'config.yaml'), config);
      writeFileSync(path.join(root, '.forge', 'tasks.json'), JSON.stringify([
        { id: 'fix-a', title: 'fix a', path: 'small', zones: ['a.txt'], depends_on: [] },
        { id: 'fix-b', title: 'fix b', path: 'small', zones: ['b.txt'], depends_on: [] },
      ]));
      const started = run(['swarm', 'start', '--project', 'loose', '--session', 'main', '--kind', 'ephemeral', '--hook-session', 'hook-main', '--tasks', '.forge/tasks.json'], io);
      expect(started.stderr).toBe('');
      out(run(['swarm', 'tick'], io));
    };
    const acceptLoose = (task: string, file: string) => {
      const w = out(run(['swarm', 'worktree', task], io)).worktree;
      commitIn(w, file, `${file}\n`, `${task}: work`);
      out(run(['swarm', 'task', task, '--stage', 'verdict', '--status', 'accepted'], io));
    };
    it('ephemeral (the person\'s checkout) without `generated`: unchanged, the regenerated file stays modified and the integration is run-dirty', () => {
      ephemeral(GEN());
      acceptLoose('fix-a', 'a.txt');
      const r = out(run(['swarm', 'integrate', 'fix-a'], io));
      expect(r.result).toBe('run-dirty');
      expect(r.detail).toContain('gen.txt');
      expect(r.restored).toBeUndefined();
      expect(git('status', '--porcelain')).toBe('M gen.txt');
    });
    it('ephemeral with `generated`: the person\'s checkout gets the matching files back and two tasks integrate in a row', () => {
      ephemeral(`generated: [gen.txt]\n${GEN()}`);
      acceptLoose('fix-a', 'a.txt');
      acceptLoose('fix-b', 'b.txt');
      const first = out(run(['swarm', 'integrate', 'fix-a'], io));
      expect(first).toMatchObject({ result: 'integrated', restored: ['gen.txt'] });
      expect(git('status', '--porcelain')).toBe('');
      expect(git('show', `${first.sha}:gen.txt`)).toBe('committed');
      expect(out(run(['swarm', 'integrate', 'fix-b'], io))).toMatchObject({ result: 'integrated', restored: ['gen.txt'] });
      expect(git('status', '--porcelain')).toBe('');
      expect(readFileSync(path.join(root, 'gen.txt'), 'utf8')).toBe('committed\n');
    });
    it('ephemeral with `generated`: a tracked file outside its globs that a validator changes is not put back', () => {
      commitIn(root, 'other.txt', 'other\n', 'other');
      ephemeral(`generated: [gen.txt]\nvalidators:\n  - name: gen\n    cmd: node -e "const f=require('fs');f.writeFileSync('gen.txt','x');f.writeFileSync('other.txt','y')"\n`);
      acceptLoose('fix-a', 'a.txt');
      const r = out(run(['swarm', 'integrate', 'fix-a'], io));
      expect(r.result).toBe('run-dirty');
      expect(r.detail).toContain('other.txt');
      expect(r.detail).not.toContain('gen.txt');
      expect(git('status', '--porcelain')).toBe('M other.txt');
    });
  });
  it('rolls back when the validators cannot run (invalid config brought by the task)', () => {
    const w = accept('T1', 'a.txt', 'a\n');
    mkdirSync(path.join(w, '.forge'), { recursive: true });
    writeFileSync(path.join(w, '.forge', 'config.yaml'), 'swarm: [nope\n');
    g(w, 'add', '-f', '.forge/config.yaml'); g(w, 'commit', '-qm', 'bad config');
    const before = g(runWt(), 'rev-parse', 'HEAD');
    const r = out(run(['swarm', 'integrate', 'T1'], io));
    expect(r).toMatchObject({ result: 'conflict' });
    expect(r.detail).toContain('validators could not run');
    expect(g(runWt(), 'rev-parse', 'HEAD')).toBe(before);
    expect(() => g(runWt(), 'rev-parse', '-q', '--verify', 'MERGE_HEAD')).toThrow();
    expect(g(runWt(), 'status', '--porcelain')).toBe('');
  });
  it('does nothing when a merge is already in progress in the run worktree', () => {
    accept('T1', 'base.txt', 'from T1\n');
    commitIn(runWt(), 'base.txt', 'from run\n', 'run change');
    expect(() => g(runWt(), 'merge', '--no-ff', '--no-commit', 'task/T1')).toThrow();
    const head = g(runWt(), 'rev-parse', 'HEAD');
    expect(out(run(['swarm', 'integrate', 'T1'], io))).toMatchObject({ result: 'run-dirty' });
    expect(g(runWt(), 'rev-parse', 'MERGE_HEAD')).toBe(g(root, 'rev-parse', 'task/T1'));
    expect(g(runWt(), 'rev-parse', 'HEAD')).toBe(head);
    expect(readExecution(root)!.tasks.T1.status).toBe('accepted');
  });
  it('does nothing when the run worktree is dirty', () => {
    accept('T1', 'a.txt', 'a\n');
    writeFileSync(path.join(runWt(), 'stray.txt'), 'x\n');
    expect(out(run(['swarm', 'integrate', 'T1'], io))).toMatchObject({ result: 'run-dirty' });
    expect(readExecution(root)!.tasks.T1.status).toBe('accepted');
  });
  it('does nothing when the run worktree is not on the execution branch', () => {
    accept('T1', 'a.txt', 'a\n');
    g(runWt(), 'switch', '-c', 'other');
    expect(out(run(['swarm', 'integrate', 'T1'], io))).toMatchObject({ result: 'run-dirty' });
    expect(readExecution(root)!.tasks.T1.status).toBe('accepted');
  });
  describe('dependencies', () => {
    // A fake install: it creates node_modules and records where it ran in a file outside the repository (a new task
    // worktree runs it too, as its swarm.setup).
    let counter: string;
    const INSTALL = () => `node -e "const f=require('fs');f.mkdirSync('node_modules',{recursive:true});f.appendFileSync('${counter.replace(/\\/g, '/')}',process.cwd()+'\\n')"`;
    const same = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
    const installs = (dir = runWt()) => (existsSync(counter) ? readFileSync(counter, 'utf8').split('\n').filter(l => l && same(l, dir)).length : 0);
    const setupConfig = (cmd: string, validators = 'validators: []\n') => writeFileSync(path.join(root, '.forge', 'config.yaml'), `${validators}swarm:\n  setup: ${cmd}\n`);
    // A validator that passes only with the dependencies installed, brought by the task with its manifest.
    const DEPS = 'validators:\n  - name: deps\n    cmd: node -e "process.exit(require(\'fs\').existsSync(\'node_modules\')?0:1)"\n';
    const exclude = () => readFileSync(path.join(root, '.git', 'info', 'exclude'), 'utf8').split(/\r?\n/);
    beforeEach(() => { counter = path.join(root, '..', `inst-${path.basename(root)}.txt`); });
    afterEach(() => { rmSync(counter, { force: true }); });

    it('a task that brings package.json gets the dependencies installed once before the validators, ignored through info/exclude', () => {
      setupConfig(INSTALL());
      const w = accept('T1', 'package.json', '{"name":"app"}\n');
      mkdirSync(path.join(w, '.forge'), { recursive: true });
      writeFileSync(path.join(w, '.forge', 'config.yaml'), DEPS);
      g(w, 'add', '-f', '.forge/config.yaml'); g(w, 'commit', '-qm', 'validators');
      const r = out(run(['swarm', 'integrate', 'T1'], io));
      expect(r).toMatchObject({ result: 'integrated', setup: { cmd: INSTALL(), ok: true } });
      expect(Array.isArray(r.setup.tail)).toBe(true);
      expect(installs()).toBe(1);
      expect(exclude().filter(l => l === 'node_modules/')).toHaveLength(1);
      expect(g(runWt(), 'status', '--porcelain')).toBe('');
    });
    it('an integration that touches no manifest installs nothing', () => {
      setupConfig(INSTALL());
      commitIn(runWt(), '.gitignore', '.forge/\n.claude/\nnode_modules/\n', 'ignore deps');
      commitIn(runWt(), 'package.json', '{}\n', 'manifest');
      mkdirSync(path.join(runWt(), 'node_modules'));
      accept('T1', 'a.txt', 'a\n');
      const r = out(run(['swarm', 'integrate', 'T1'], io));
      expect(r.result).toBe('integrated');
      expect(r.setup).toBeUndefined();
      expect(installs()).toBe(0);
    });
    it('a manifest without node_modules installs before the baseline, and the exclude line is added once', () => {
      writeFileSync(path.join(root, '.git', 'info', 'exclude'), '# mine\n*.log');
      setupConfig(INSTALL());
      commitIn(runWt(), 'package.json', '{}\n', 'manifest');
      accept('T1', 'a.txt', 'a\n');
      expect(out(run(['swarm', 'integrate', 'T1'], io))).toMatchObject({ result: 'integrated', setup: { ok: true } });
      expect(installs()).toBe(1);
      rmSync(path.join(runWt(), 'node_modules'), { recursive: true });
      accept('T2', 'b.txt', 'b\n');
      expect(out(run(['swarm', 'integrate', 'T2'], io))).toMatchObject({ result: 'integrated', setup: { ok: true } });
      expect(installs()).toBe(2);
      expect(exclude().filter(Boolean)).toEqual(['# mine', '*.log', 'node_modules/']);
    });
    it('a failing install rolls the merge back with its last line, lists what it left and deletes nothing', () => {
      setupConfig(`node -e "const f=require('fs');f.mkdirSync('partial');f.writeFileSync('partial/x','1');console.log('npm ERR! boom');process.exit(3)"`);
      accept('T1', 'package.json', '{}\n');
      const before = g(runWt(), 'rev-parse', 'HEAD');
      const r = out(run(['swarm', 'integrate', 'T1'], io));
      expect(r).toMatchObject({ result: 'conflict', detail: 'dependencies could not be installed after merging task/T1: npm ERR! boom', setup: { ok: false }, leftovers: ['partial/'] });
      expect(g(runWt(), 'rev-parse', 'HEAD')).toBe(before);
      expect(() => g(runWt(), 'rev-parse', '-q', '--verify', 'MERGE_HEAD')).toThrow();
      expect(existsSync(path.join(runWt(), 'partial', 'x'))).toBe(true);
      expect(readExecution(root)!.tasks.T1.status).toBe('conflict');
    });
    it('a failing install before the merge is run-deps, leaves the task accepted, and is not retried until HEAD or the manifests change', () => {
      setupConfig(`node -e "require('fs').appendFileSync('${counter.replace(/\\/g, '/')}',process.cwd()+'\\n');console.log('offline');process.exit(1)"`);
      commitIn(runWt(), 'package.json', '{}\n', 'manifest');
      accept('T1', 'a.txt', 'a\n');
      const r = out(run(['swarm', 'integrate', 'T1'], io));
      expect(r).toMatchObject({ result: 'run-deps', detail: 'could not install its dependencies before merging task/T1: offline', setup: { ok: false } });
      expect(readExecution(root)!.tasks.T1.status).toBe('accepted');
      expect(installs()).toBe(1);
      // The next tick at the same HEAD does not run the failing install again.
      const again = out(run(['swarm', 'integrate', 'T1'], io));
      expect(again).toMatchObject({ result: 'run-deps', setup: { ok: false } });
      expect(again.detail).toContain('offline');
      expect(installs()).toBe(1);
      // --retry-deps forgets the failure: the install runs again at the same HEAD (after a transient failure).
      expect(out(run(['swarm', 'integrate', 'T1', '--retry-deps'], io)).result).toBe('run-deps');
      expect(installs()).toBe(2);
      expect(out(run(['swarm', 'integrate', 'T1'], io)).result).toBe('run-deps');
      expect(installs()).toBe(2);
      // A new HEAD tries again.
      commitIn(runWt(), 'other.txt', 'o\n', 'run moved');
      expect(out(run(['swarm', 'integrate', 'T1'], io)).result).toBe('run-deps');
      expect(installs()).toBe(3);
    });
    it('a rejected manifest change leaves the run worktree with the dependencies of its restored tree', () => {
      // The fake install records the manifest it installed; a validator checks the installed one is the tree's.
      setupConfig(`node -e "const f=require('fs');f.mkdirSync('node_modules',{recursive:true});f.writeFileSync('node_modules/.manifest',f.readFileSync('package.json','utf8'));f.appendFileSync('${counter.replace(/\\/g, '/')}',process.cwd()+'\\n')"`);
      mkdirSync(path.join(runWt(), '.forge'), { recursive: true });
      writeFileSync(path.join(runWt(), '.forge', 'config.yaml'), `${NOBAD}  - name: match\n    cmd: node -e "const f=require('fs');process.exit(f.readFileSync('node_modules/.manifest','utf8')===f.readFileSync('package.json','utf8')?0:1)"\n`);
      commitIn(runWt(), 'package.json', '{"name":"one"}\n', 'manifest');
      // T1 bumps the manifest and is rejected (bad.txt).
      const w = out(run(['swarm', 'worktree', 'T1'], io)).worktree;
      writeFileSync(path.join(w, 'package.json'), '{"name":"two"}\n');
      writeFileSync(path.join(w, 'bad.txt'), 'x\n');
      g(w, 'add', 'package.json', 'bad.txt'); g(w, 'commit', '-qm', 'T1: bump');
      out(run(['swarm', 'task', 'T1', '--stage', 'verdict', '--status', 'accepted'], io));
      accept('T2', 'b.txt', 'b\n');
      const r = out(run(['swarm', 'integrate', 'T1'], io));
      expect(r).toMatchObject({ result: 'conflict', restoreSetup: { ok: true } });
      expect(r.depsFromRejectedMerge).toBeUndefined();
      expect(readFileSync(path.join(runWt(), 'node_modules', '.manifest'), 'utf8')).toBe('{"name":"one"}\n');
      // A later integration that touches no manifest validates with them.
      expect(out(run(['swarm', 'integrate', 'T2'], io)).result).toBe('integrated');
      // The installed manifests no longer match the tree (changed by hand): installed again before the baseline.
      commitIn(runWt(), 'package.json', '{"name":"three"}\n', 'manifest by hand');
      accept('T3', 'c.txt', 'c\n');
      const before = installs();
      expect(out(run(['swarm', 'integrate', 'T3'], io))).toMatchObject({ result: 'integrated', setup: { ok: true } });
      expect(installs()).toBe(before + 1);
    });
    it('after an install that failed, even the reinstall of the restored tree, the next integration installs before its baseline', () => {
      setupConfig(INSTALL());
      commitIn(runWt(), 'package.json', '{"name":"one"}\n', 'manifest');
      accept('T1', 'a.txt', 'a\n');
      expect(out(run(['swarm', 'integrate', 'T1'], io))).toMatchObject({ result: 'integrated', setup: { ok: true } });
      expect(installs()).toBe(1);
      // T2 bumps the manifest while the registry is down: the install after the merge fails, and so does the one for
      // the restored tree, which leaves a partial node_modules behind.
      accept('T2', 'package.json', '{"name":"two"}\n');
      setupConfig(`node -e "require('fs').mkdirSync('node_modules/partial',{recursive:true});console.log('offline');process.exit(1)"`);
      expect(out(run(['swarm', 'integrate', 'T2'], io))).toMatchObject({ result: 'conflict', detail: 'dependencies could not be installed after merging task/T2: offline', restoreSetup: { ok: false } });
      // Back online: an integration that merges no manifest installs before its baseline all the same, once.
      setupConfig(INSTALL());
      accept('T3', 'c.txt', 'c\n');
      expect(out(run(['swarm', 'integrate', 'T3'], io))).toMatchObject({ result: 'integrated', setup: { ok: true } });
      expect(installs()).toBe(2);
      accept('T4', 'd.txt', 'd\n');
      expect(out(run(['swarm', 'integrate', 'T4'], io)).setup).toBeUndefined();
      expect(installs()).toBe(2);
    });
    it('a name git would quote stays exact: the install\'s edit of it is undone before the rollback and its leftover is listed as it is', () => {
      // git quotes DEL even with core.quotePath=false, and Windows allows it in a file name; a quote, a backslash and
      // a tab only where the platform allows them.
      const odd = process.platform === 'win32' ? 'odd\x7f.txt' : 'odd"\\\t\x7f.txt';
      setupConfig(`node -e "const f=require('fs');f.mkdirSync('node_modules',{recursive:true});for(const n of f.readdirSync('.'))if(n.startsWith('odd')){f.appendFileSync(n,'x\\n');f.writeFileSync('left'+n.slice(3),'')}"`);
      const w = out(run(['swarm', 'worktree', 'T1'], io)).worktree;
      writeFileSync(path.join(w, 'package.json'), '{}\n');
      writeFileSync(path.join(w, odd), 'o\n');
      g(w, 'add', '--', 'package.json', `:(literal)${odd}`); g(w, 'commit', '-qm', 'T1: odd name');
      out(run(['swarm', 'task', 'T1', '--stage', 'verdict', '--status', 'accepted'], io));
      const before = g(runWt(), 'rev-parse', 'HEAD');
      const r = out(run(['swarm', 'integrate', 'T1'], io));
      expect(r).toMatchObject({ result: 'conflict', detail: `the dependency install changed tracked files after merging task/T1: ${odd}`, leftovers: [`left${odd.slice(3)}`] });
      expect(g(runWt(), 'rev-parse', 'HEAD')).toBe(before);
      expect(() => g(runWt(), 'rev-parse', '-q', '--verify', 'MERGE_HEAD')).toThrow();
      expect(existsSync(path.join(runWt(), odd))).toBe(false);
    });
    it('a successful install that leaves untracked files reports them as leftovers of the merge', () => {
      setupConfig(`node -e "const f=require('fs');f.mkdirSync('node_modules',{recursive:true});if(f.existsSync('package.json'))f.writeFileSync('package-lock.json','{}')"`);
      const w = out(run(['swarm', 'worktree', 'T1'], io)).worktree;
      writeFileSync(path.join(w, 'package.json'), '{}\n');
      g(w, 'add', 'package.json'); g(w, 'commit', '-qm', 'T1: manifest');
      out(run(['swarm', 'task', 'T1', '--stage', 'verdict', '--status', 'accepted'], io));
      expect(out(run(['swarm', 'integrate', 'T1'], io))).toMatchObject({ result: 'integrated', leftovers: ['package-lock.json'] });
    });
    it('a Yarn PnP tree counts as installed, and a manifest whose install leaves nothing is installed once', () => {
      // An install that never creates node_modules (a package.json without dependencies).
      setupConfig(`node -e "require('fs').appendFileSync('${counter.replace(/\\/g, '/')}',process.cwd()+'\\n')"`);
      commitIn(runWt(), 'package.json', '{}\n', 'manifest');
      accept('T1', 'a.txt', 'a\n');
      accept('T2', 'b.txt', 'b\n');
      expect(out(run(['swarm', 'integrate', 'T1'], io))).toMatchObject({ result: 'integrated', setup: { ok: true } });
      expect(installs()).toBe(1);
      const second = out(run(['swarm', 'integrate', 'T2'], io));
      expect(second.result).toBe('integrated');
      expect(second.setup).toBeUndefined();
      expect(installs()).toBe(1);
      // A changed manifest installs again.
      commitIn(runWt(), 'package.json', '{"name":"x"}\n', 'manifest changed');
      accept('T3', 'c.txt', 'c\n');
      expect(out(run(['swarm', 'integrate', 'T3'], io)).setup).toMatchObject({ ok: true });
      expect(installs()).toBe(2);
      // .pnp.cjs: the dependencies are there without node_modules, so another setup command installs nothing.
      commitIn(runWt(), '.pnp.cjs', '// pnp\n', 'pnp');
      setupConfig(`node -e "require('fs').appendFileSync('${counter.replace(/\\/g, '/')}',process.cwd()+'\\n');void 0"`);
      accept('T4', 'd.txt', 'd\n');
      expect(out(run(['swarm', 'integrate', 'T4'], io)).setup).toBeUndefined();
      expect(installs()).toBe(2);
    });
    it('a rollback that took away the .gitignore covering node_modules/ excludes it, and lists only the other leftovers', () => {
      setupConfig(INSTALL());
      // Red once bad.txt is merged in, after writing a build output the merged .gitignore covers.
      mkdirSync(path.join(runWt(), '.forge'), { recursive: true });
      writeFileSync(path.join(runWt(), '.forge', 'config.yaml'), 'validators:\n  - name: build\n    cmd: node -e "const f=require(\'fs\');if(f.existsSync(\'bad.txt\')){f.mkdirSync(\'dist\',{recursive:true});process.exit(1)}"\n');
      const w = out(run(['swarm', 'worktree', 'T1'], io)).worktree;
      writeFileSync(path.join(w, '.gitignore'), '.forge/\n.claude/\nnode_modules/\ndist/\n');
      writeFileSync(path.join(w, 'package.json'), '{}\n');
      writeFileSync(path.join(w, 'bad.txt'), 'x\n');
      g(w, 'add', '.gitignore', 'package.json', 'bad.txt'); g(w, 'commit', '-qm', 'T1: scaffold');
      out(run(['swarm', 'task', 'T1', '--stage', 'verdict', '--status', 'accepted'], io));
      const r = out(run(['swarm', 'integrate', 'T1'], io));
      expect(r).toMatchObject({ result: 'conflict', setup: { ok: true }, leftovers: ['dist/'] });
      expect(r.detail).toContain('validators failed');
      expect(exclude().filter(l => l === 'node_modules/')).toHaveLength(1);
      expect(existsSync(path.join(runWt(), 'node_modules'))).toBe(true);
      expect(existsSync(path.join(runWt(), 'dist'))).toBe(true);
    });
    it('an install that rewrites a lockfile the merge brought is undone before the rollback; an edit of a file the merge did not change is kept', () => {
      setupConfig(`node -e "const f=require('fs');f.mkdirSync('node_modules',{recursive:true});if(f.existsSync('package-lock.json')){f.appendFileSync('package-lock.json','\\n');f.appendFileSync('base.txt','edited\\n')}"`);
      const w = out(run(['swarm', 'worktree', 'T1'], io)).worktree;
      writeFileSync(path.join(w, 'package.json'), '{}\n');
      writeFileSync(path.join(w, 'package-lock.json'), '{"lockfileVersion":3}\n');
      g(w, 'add', 'package.json', 'package-lock.json'); g(w, 'commit', '-qm', 'T1: manifest');
      out(run(['swarm', 'task', 'T1', '--stage', 'verdict', '--status', 'accepted'], io));
      const before = g(runWt(), 'rev-parse', 'HEAD');
      const r = out(run(['swarm', 'integrate', 'T1'], io));
      expect(r).toMatchObject({ result: 'conflict', detail: 'the dependency install changed tracked files after merging task/T1: base.txt, package-lock.json', touchedKept: ['base.txt'] });
      // The run worktree is forge's: no line for the person.
      expect(r.say).toBeUndefined();
      expect(g(runWt(), 'rev-parse', 'HEAD')).toBe(before);
      expect(() => g(runWt(), 'rev-parse', '-q', '--verify', 'MERGE_HEAD')).toThrow();
      // Never discarded: whoever edited base.txt meanwhile keeps the edit.
      expect(readFileSync(path.join(runWt(), 'base.txt'), 'utf8')).toBe('base\nedited\n');
      expect(g(runWt(), 'status', '--porcelain')).toBe('M base.txt');
    });
    it('integrate names the surfaces the merge changed', () => {
      const surface = '.forge/verify/web.md';
      const w = out(run(['swarm', 'worktree', 'T1'], io)).worktree;
      mkdirSync(path.join(w, '.forge', 'verify'), { recursive: true });
      writeFileSync(path.join(w, surface), '# web\n');
      g(w, 'add', '-f', surface); g(w, 'commit', '-qm', 'T1: surface');
      out(run(['swarm', 'task', 'T1', '--stage', 'verdict', '--status', 'accepted'], io));
      expect(out(run(['swarm', 'integrate', 'T1'], io))).toMatchObject({ result: 'integrated', surfacesChanged: [surface] });
      accept('T2', 'b.txt', 'b\n');
      expect(out(run(['swarm', 'integrate', 'T2'], io)).surfacesChanged).toBeUndefined();
    });
    const where = () => path.join(root, '..', `where-${path.basename(root)}.txt`);
    // The person's final validators record the directory they run in.
    const finalValidators = () => `validators:\n  - name: where\n    cmd: node -e "require('fs').appendFileSync('${where().replace(/\\/g, '/')}',process.cwd()+'\\n')"\n`;
    const lastWhere = () => { const l = readFileSync(where(), 'utf8').split('\n').filter(Boolean); return path.resolve(l[l.length - 1]).toLowerCase(); };
    it('merge into a target that has not moved validates in the run worktree and installs nothing in the main checkout', () => {
      setupConfig(INSTALL(), finalValidators());
      accept('T1', 'package.json', '{}\n');
      expect(out(run(['swarm', 'integrate', 'T1'], io)).result).toBe('integrated');
      expect(installs()).toBe(1);
      const r = out(mergeYes());
      expect(r).toMatchObject({ result: 'merged' });
      expect(r.setup).toBeUndefined();
      expect(installs()).toBe(1);
      expect(installs(root)).toBe(0);
      expect(existsSync(path.join(root, 'node_modules'))).toBe(false);
      expect(lastWhere()).toBe(path.resolve(runWt()).toLowerCase());
      expect(git('log', '-1', '--format=%s')).toBe('forge: merge forge/run-shop');
      rmSync(where(), { force: true });
    });
    it('merge into a target that moved installs the dependencies there and validates there', () => {
      setupConfig(INSTALL(), finalValidators());
      accept('T1', 'package.json', '{}\n');
      expect(out(run(['swarm', 'integrate', 'T1'], io)).result).toBe('integrated');
      commitIn(root, 'other.txt', 'o\n', 'main moved');
      const r = out(mergeYes());
      expect(r).toMatchObject({ result: 'merged', setup: { ok: true } });
      expect(installs()).toBe(1);
      expect(installs(root)).toBe(1);
      expect(existsSync(path.join(root, 'node_modules'))).toBe(true);
      expect(lastWhere()).toBe(path.resolve(root).toLowerCase());
      rmSync(where(), { force: true });
    });
    it('an unmoved final merge onto a checkout with package.json but no node_modules takes no baseline there', () => {
      commitIn(root, 'package.json', '{}\n', 'manifest');
      g(runWt(), 'merge', '-q', '--ff-only', 'main');
      setupConfig(INSTALL(), `${finalValidators()}  - name: red\n    cmd: node -e "process.exit(1)"\n`);
      accept('T1', 'a.txt', 'a\n');
      expect(out(run(['swarm', 'integrate', 'T1'], io)).result).toBe('integrated');
      const r = out(mergeYes());
      // Red in a checkout without dependencies says nothing: it counts against the merge instead of being excused.
      expect(r).toMatchObject({ result: 'conflict', detail: 'validators failed after merging forge/run-shop: red' });
      expect(readFileSync(where(), 'utf8').split('\n').filter(Boolean).map(l => path.resolve(l).toLowerCase())).toEqual([path.resolve(runWt()).toLowerCase()]);
      expect(installs(root)).toBe(0);
      rmSync(where(), { force: true });
    });
    describe('a rejected final merge onto a moved target', () => {
      // Red once the run's package.json is in: the merge is rolled back after installing in the person's checkout.
      const NOPKG = '  - name: nopkg\n    cmd: node -e "process.exit(require(\'fs\').readFileSync(\'package.json\',\'utf8\').includes(\'run\')?1:0)"\n';
      const NOFILE = '  - name: nopkg\n    cmd: node -e "process.exit(require(\'fs\').existsSync(\'package.json\')?1:0)"\n';
      const rejected = (validator: string, mainManifest: boolean) => {
        if (mainManifest) {
          commitIn(root, 'package.json', '{"name":"main"}\n', 'manifest');
          g(runWt(), 'merge', '-q', '--ff-only', 'main');
        }
        setupConfig(INSTALL(), `validators:\n${validator}`);
        accept('T1', 'package.json', '{"name":"run"}\n');
        expect(out(run(['swarm', 'integrate', 'T1'], io)).result).toBe('integrated');
        commitIn(root, 'other.txt', 'o\n', 'main moved');
      };
      it('removes the node_modules the attempt created when the restored tree has no manifest', () => {
        rejected(NOFILE, false);
        const r = out(mergeYes());
        expect(r).toMatchObject({ result: 'conflict', setup: { ok: true } });
        expect(r.depsFromRejectedMerge).toBeUndefined();
        expect(installs(root)).toBe(1);
        expect(existsSync(path.join(root, 'node_modules'))).toBe(false);
        expect(git('status', '--porcelain')).toBe('');
      });
      it('installs again for the restored tree when it has a manifest', () => {
        rejected(NOPKG, true);
        const r = out(mergeYes());
        expect(r).toMatchObject({ result: 'conflict', restoreSetup: { ok: true } });
        expect(r.depsFromRejectedMerge).toBeUndefined();
        // Before the baseline (main had no node_modules), after the merge, and for the restored tree.
        expect(installs(root)).toBe(3);
      });
      it('never removes a node_modules link that was there before the attempt, even dangling', () => {
        rejected(NOFILE, false);
        // A link to a cache that is not there: existsSync says no, but it is the person's.
        const cache = path.join(root, '..', `cache-${path.basename(root)}`);
        rmSync(cache, { recursive: true, force: true });
        symlinkSync(cache, path.join(root, 'node_modules'), 'junction');
        rmSync(cache, { recursive: true, force: true });
        writeFileSync(path.join(root, '.git', 'info', 'exclude'), 'node_modules\n');
        // The install brings the cache back: the link now resolves.
        setupConfig(`node -e "require('fs').mkdirSync('${cache.replace(/\\/g, '/')}',{recursive:true})"`, `validators:\n${NOFILE}`);
        const r = out(mergeYes());
        expect(r).toMatchObject({ result: 'conflict', depsFromRejectedMerge: true });
        expect(lstatSync(path.join(root, 'node_modules')).isSymbolicLink()).toBe(true);
        try { rmSync(path.join(root, 'node_modules'), { force: true }); } catch { /* afterEach removes the repository */ }
        rmSync(cache, { recursive: true, force: true });
      });
      it('reports the tracked files the reinstall for the restored tree changed', () => {
        // Both checkouts already have their node_modules: the only installs are after the merge and for the restored tree.
        commitIn(root, 'package-lock.json', '{}\n', 'lockfile');
        mkdirSync(path.join(root, 'node_modules'));
        writeFileSync(path.join(root, '.git', 'info', 'exclude'), 'node_modules/\n');
        g(runWt(), 'merge', '-q', '--ff-only', 'main');
        mkdirSync(path.join(runWt(), 'node_modules'));
        rejected(NOPKG, true);
        // An install that rewrites the lockfile, but only for the main manifest (the restored tree).
        setupConfig(`node -e "const f=require('fs');if(f.readFileSync('package.json','utf8').includes('main'))f.appendFileSync('package-lock.json','\\n')"`, `validators:\n${NOPKG}`);
        const r = out(mergeYes());
        expect(r).toMatchObject({ result: 'conflict', restoreSetup: { ok: true }, restoreChanged: ['package-lock.json'], depsFromRejectedMerge: true });
        expect(git('status', '--porcelain')).toBe('M package-lock.json');
      });
      it('says the dependencies may not match when it can neither reinstall nor remove them', () => {
        rejected(NOFILE, false);
        mkdirSync(path.join(root, 'node_modules'));
        writeFileSync(path.join(root, '.git', 'info', 'exclude'), 'node_modules/\n');
        const r = out(mergeYes());
        expect(r).toMatchObject({ result: 'conflict', depsFromRejectedMerge: true });
        expect(r.say).toEqual(['The dependencies in your checkout were installed for the rejected merge of forge/run-shop and may not match your files: reinstall them before you use it.']);
        expect(existsSync(path.join(root, 'node_modules'))).toBe(true);
      });
    });
  });
  it('merge: asks without authorization, merges into the base with it, refuses a dirty main checkout', () => {
    accept('T1', 'a.txt', 'a\n');
    out(run(['swarm', 'integrate', 'T1'], io));
    expect(out(run(['swarm', 'merge'], io))).toMatchObject({ result: 'needs-authorization' });
    writeFileSync(path.join(root, 'dirty.txt'), 'x\n');
    expect(out(mergeYes())).toMatchObject({ result: 'main-dirty' });
    rmSync(path.join(root, 'dirty.txt'));
    expect(out(mergeYes())).toMatchObject({ result: 'merged' });
    expect(git('log', '-1', '--format=%s')).toBe('forge: merge forge/run-shop');
  });
  it('integrate keeps the sha and prints the task done with its commit, not merged yet, and meta/metrics apart; merge prints it again, merged (G-06, J-15, A-10)', () => {
    accept('T1', 'a.txt', 'a\n');
    const r = out(run(['swarm', 'integrate', 'T1'], io));
    expect(readExecution(root)!.tasks.T1.sha).toBe(r.sha);
    expect(JSON.parse(readFileSync(r.publish.file_path, 'utf8'))).toMatchObject({
      status: 'done', doneAt: '2026-10-12T12:00:00.000Z', commits: [{ sha: r.sha, title: 'T1: work' }], exec: { __delete__: true },
      forge: { v: 2, stage: 'done', integration: { branch: 'forge/run-shop', sha: r.sha, merged: false, target: 'main' } },
    });
    expect(r.metrics).toEqual({ op: 'update', collection: 'meta', doc_id: 'metrics', data: { lastCommit: { sha: r.sha, ts: r.commit.ts }, updatedAt: '2026-10-12T12:00:00.000Z' } });
    seedExecution(root, { ...readExecution(root)!, active: false, stopReason: 'finished' });
    const m = out(mergeYes());
    expect(m.publish).toHaveLength(1);
    const merged = JSON.parse(readFileSync(m.publish[0].file_path, 'utf8'));
    expect(Object.keys(merged)).toEqual(['forge']);
    expect(merged.forge).toMatchObject({ v: 2, stage: 'done', integration: { sha: r.sha, merged: true, target: 'main' } });
  });
  it('merge prints one forge-only write per integrated task, and publishErrors for a task whose document cannot be written', () => {
    accept('T1', 'a.txt', 'a\n');
    accept('T2', 'b.txt', 'b\n');
    out(run(['swarm', 'integrate', 'T1'], io));
    out(run(['swarm', 'integrate', 'T2'], io));
    seedExecution(root, { ...readExecution(root)!, active: false, stopReason: 'finished' });
    const work = path.join(root, '.forge', 'work', 'shop', 'T2');
    rmSync(work, { recursive: true, force: true });
    writeFileSync(work, 'not a folder');
    const m = out(mergeYes());
    expect(m.result).toBe('merged');
    expect(m.publish.map((w: { doc_id: string }) => w.doc_id)).toEqual(['T1']);
    expect(m.publishErrors).toHaveLength(1);
    expect(m.publishErrors[0]).toMatch(/^T2: /);
  });
});

describe('an integration left half-done (D-07)', () => {
  // What a swarm integrate killed between `git merge --no-commit` and its commit leaves in the run worktree.
  const half = (task: string) => {
    const pre = g(runWt(), 'rev-parse', 'HEAD');
    g(runWt(), 'merge', '--no-ff', '--no-commit', `task/${task}`);
    return pre;
  };
  const marker = (m: Record<string, unknown>) => {
    mkdirSync(path.dirname(mergingFile(root)), { recursive: true });
    writeFileSync(mergingFile(root), JSON.stringify(m));
  };
  // A pid that existed and is gone: its process already exited.
  const deadPid = () => spawnSync(process.execPath, ['-e', '']).pid!;
  const dirOf = (wt: string) => g(wt, 'rev-parse', '--show-toplevel');
  const later = '2026-10-12T13:00:00.000Z';

  it('aborts its own merge whose process died, says so and integrates', () => {
    accept('T1', 'a.txt', 'a\n');
    const pre = half('T1');
    marker({ task: 'T1', pre, ref: 'task/T1', pid: deadPid(), startedAt: '2026-10-12T11:59:00.000Z', staleAt: later, dir: dirOf(runWt()), phase: 'merge' });
    const r = out(run(['swarm', 'integrate', 'T1'], io));
    expect(r).toMatchObject({ result: 'integrated', recovered: { task: 'T1', pre } });
    expect(existsSync(mergingFile(root))).toBe(false);
    expect(g(runWt(), 'log', '-1', '--format=%s')).toBe('forge: integrate T1');
  });
  it('an unfinished merge without a marker, or with the marker of another worktree, is someone else\'s: run-dirty, untouched (Review Focus 3)', () => {
    accept('T1', 'a.txt', 'a\n');
    const pre = half('T1');
    expect(out(run(['swarm', 'integrate', 'T1'], io))).toMatchObject({ result: 'run-dirty', detail: expect.stringContaining('unfinished merge') });
    marker({ task: 'T1', pre, ref: 'task/T1', pid: deadPid(), startedAt: '2026-10-12T11:59:00.000Z', staleAt: later, dir: dirOf(root), phase: 'merge' });
    expect(out(run(['swarm', 'integrate', 'T1'], io)).result).toBe('run-dirty');
    expect(g(runWt(), 'rev-parse', '-q', '--verify', 'MERGE_HEAD')).not.toBe('');
    expect(g(runWt(), 'rev-parse', 'HEAD')).toBe(pre);
  });
  it('a live marker of another process in the same worktree makes the integration wait without touching git', () => {
    accept('T1', 'a.txt', 'a\n');
    const pre = g(runWt(), 'rev-parse', 'HEAD');
    marker({ task: 'T2', pre, ref: 'task/T2', pid: process.ppid, startedAt: '2026-10-12T11:59:00.000Z', staleAt: later, dir: dirOf(runWt()), phase: 'baseline' });
    expect(out(run(['swarm', 'integrate', 'T1'], io))).toMatchObject({ result: 'run-dirty', detail: expect.stringContaining('is merging there') });
    expect(g(runWt(), 'rev-parse', 'HEAD')).toBe(pre);
    expect(readExecution(root)!.tasks.T1.status).toBe('accepted');
  });
  it('a marker here whose HEAD moved, whose process lives or that cannot be read leaves the unfinished merge alone (Review Focus 3)', () => {
    accept('T1', 'a.txt', 'a\n');
    const pre = half('T1');
    const here = { task: 'T1', ref: 'task/T1', startedAt: '2026-10-12T11:59:00.000Z', staleAt: later, dir: dirOf(runWt()), phase: 'merge' };
    // Never `git merge --abort`: the merge stays as it was, HEAD where it was, and the task accepted.
    const untouched = () => {
      expect(g(runWt(), 'rev-parse', '-q', '--verify', 'MERGE_HEAD')).not.toBe('');
      expect(g(runWt(), 'rev-parse', 'HEAD')).toBe(pre);
      expect(readExecution(root)!.tasks.T1.status).toBe('accepted');
    };
    // The marker records another starting commit: the merge in progress is not the one it wrote.
    marker({ ...here, pre: g(runWt(), 'rev-parse', 'task/T1'), pid: deadPid() });
    expect(out(run(['swarm', 'integrate', 'T1'], io))).toMatchObject({ result: 'run-dirty', detail: expect.stringContaining('unfinished merge') });
    untouched();
    // Its process still lives, before its staleAt: it is merging, and the integration waits.
    marker({ ...here, pre, pid: process.ppid });
    expect(out(run(['swarm', 'integrate', 'T1'], io))).toMatchObject({ result: 'run-dirty', detail: expect.stringContaining('is merging there') });
    untouched();
    // Without a pid it cannot be trusted: as if there were none.
    marker({ ...here, pre });
    expect(out(run(['swarm', 'integrate', 'T1'], io))).toMatchObject({ result: 'run-dirty', detail: expect.stringContaining('unfinished merge') });
    untouched();
    writeFileSync(mergingFile(root), '{not json');
    expect(out(run(['swarm', 'integrate', 'T1'], io)).result).toBe('run-dirty');
    untouched();
  });
  it('a marker past its staleAt counts as dead even when its pid lives: its merge is aborted', () => {
    accept('T1', 'a.txt', 'a\n');
    const pre = half('T1');
    marker({ task: 'T1', pre, ref: 'task/T1', pid: process.ppid, startedAt: '2026-10-12T11:00:00.000Z', staleAt: '2026-10-12T11:30:00.000Z', dir: dirOf(runWt()), phase: 'merge' });
    expect(out(run(['swarm', 'integrate', 'T1'], io))).toMatchObject({ result: 'integrated', recovered: { task: 'T1', pre } });
    expect(existsSync(mergingFile(root))).toBe(false);
  });
  it('a marker left by an attempt that died before its merge is removed, and the integration goes on', () => {
    accept('T1', 'a.txt', 'a\n');
    const pre = g(runWt(), 'rev-parse', 'HEAD');
    marker({ task: 'T1', pre, ref: 'task/T1', pid: deadPid(), startedAt: '2026-10-12T11:59:00.000Z', staleAt: later, dir: dirOf(runWt()), phase: 'baseline' });
    const r = out(run(['swarm', 'integrate', 'T1'], io));
    expect(r.result).toBe('integrated');
    expect(r.recovered).toBeUndefined();
    expect(existsSync(mergingFile(root))).toBe(false);
  });
  it('a merge that commits or rolls back leaves no marker behind', () => {
    accept('T1', 'a.txt', 'a\n');
    expect(out(run(['swarm', 'integrate', 'T1'], io)).result).toBe('integrated');
    expect(existsSync(mergingFile(root))).toBe(false);
    accept('T2', 'base.txt', 'from T2\n');
    commitIn(runWt(), 'base.txt', 'from run\n', 'run change');
    expect(out(run(['swarm', 'integrate', 'T2'], io)).result).toBe('conflict');
    expect(existsSync(mergingFile(root))).toBe(false);
  });

  // swarm integrate with the deps run() gives it, except that each command run in a worktree (here, only validators:
  // there is no package.json) calls `during` first; `git` can be wrapped too.
  const hooked = (during: () => void, git: (dir: string) => (a: string[]) => string | null = defaultGit): SwarmDeps => ({
    git: defaultGit(root), exec: defaultExec(root), repo: repoReader(root),
    at: dir => ({ git: git(dir), repo: repoReader(dir), exec: (cmd, t) => { during(); return defaultExec(dir)(cmd, t); } }),
  });
  const runValidator = () => { mkdirSync(path.join(runWt(), '.forge'), { recursive: true }); writeFileSync(path.join(runWt(), '.forge', 'config.yaml'), NOBAD); };

  it('one integration at a time from its start: a second one during the first one\'s baseline is turned away, and the first merges', () => {
    runValidator();
    accept('T1', 'a.txt', 'a\n');
    const seen: { phase: string; staleAt: string }[] = [];
    let second: Record<string, unknown> | null = null;
    let started = false;
    const deps: SwarmDeps = hooked(() => {
      const m = readMerging(root);
      seen.push({ phase: m?.phase ?? 'none', staleAt: m?.staleAt ?? '' });
      if (!started) { started = true; second = out(swarmCommand(['integrate', 'T1'], io, deps)); }
    });
    const first = out(swarmCommand(['integrate', 'T1'], io, deps));
    expect(second).toMatchObject({ result: 'run-dirty', detail: expect.stringContaining('is merging there') });
    expect(first).toMatchObject({ result: 'integrated' });
    expect(g(runWt(), 'log', '-1', '--format=%s')).toBe('forge: integrate T1');
    expect(g(runWt(), 'log', '--format=%s')).not.toMatch(/forge: integrate T1[\s\S]*forge: integrate T1/);
    // The marker stood from the baseline (the first validator run) to the merged tree's run, and went with the commit.
    expect(seen.map(s => s.phase)).toEqual(['baseline', 'merge']);
    expect(existsSync(mergingFile(root))).toBe(false);
    // Each staleAt bounds the run it covers: a full slot wait, then the validator and its retry at the full timeout.
    const t = loadConfig(root).validatorTimeoutSec;
    for (const s of seen) expect(Date.parse(s.staleAt) - io.now().getTime()).toBeGreaterThanOrEqual(SLOT_MAX_WAIT_MS + 2 * t * 1000);
  });
  it('checks again under the marker: HEAD moved or a merge started between the first checks and the take gives run-dirty, and the marker goes', () => {
    accept('T1', 'a.txt', 'a\n');
    accept('T2', 'b.txt', 'b\n');
    for (const meanwhile of [
      () => commitIn(runWt(), 'other.txt', 'x\n', 'someone else'),
      () => g(runWt(), 'merge', '--no-ff', '--no-commit', 'task/T2'),
    ]) {
      let done = false;
      // The first git call made while this attempt holds merging.json: someone else acts just before it.
      const wrapped = (dir: string) => (a: string[]) => { if (!done && existsSync(mergingFile(root))) { done = true; meanwhile(); } return defaultGit(dir)(a); };
      const r = out(swarmCommand(['integrate', 'T1'], io, hooked(() => undefined, wrapped)));
      expect(done).toBe(true);
      expect(r).toMatchObject({ result: 'run-dirty', detail: expect.stringContaining('while this integration was starting') });
      expect(existsSync(mergingFile(root))).toBe(false);
      expect(g(runWt(), 'log', '--format=%s')).not.toContain('forge: integrate T1');
      expect(readExecution(root)!.tasks.T1.status).toBe('accepted');
    }
    // The merge someone else started is theirs: left as it was.
    expect(g(runWt(), 'rev-parse', 'MERGE_HEAD')).toBe(g(runWt(), 'rev-parse', 'task/T2'));
  });
  it('a live attempt merging in another directory holds the marker too: the integration waits and leaves it as it was', () => {
    accept('T1', 'a.txt', 'a\n');
    const pre = g(runWt(), 'rev-parse', 'HEAD');
    marker({ task: null, pre, ref: 'forge/run-shop', pid: process.ppid, startedAt: '2026-10-12T11:59:00.000Z', staleAt: later, dir: dirOf(root), phase: 'merge' });
    const before = readFileSync(mergingFile(root), 'utf8');
    expect(out(run(['swarm', 'integrate', 'T1'], io))).toMatchObject({ result: 'run-dirty', detail: expect.stringContaining('is merging in') });
    expect(readFileSync(mergingFile(root), 'utf8')).toBe(before);
    expect(g(runWt(), 'rev-parse', 'HEAD')).toBe(pre);
    expect(readExecution(root)!.tasks.T1.status).toBe('accepted');
  });
  it('a dead marker of the baseline phase is removed, and a merge seen there is someone else\'s: run-dirty, no abort', () => {
    accept('T1', 'a.txt', 'a\n');
    const pre = half('T1');
    marker({ task: 'T1', pre, ref: 'task/T1', pid: deadPid(), startedAt: '2026-10-12T11:59:00.000Z', staleAt: later, dir: dirOf(runWt()), phase: 'baseline' });
    expect(out(run(['swarm', 'integrate', 'T1'], io))).toMatchObject({ result: 'run-dirty', detail: 'an unfinished merge is in progress there (git merge --abort to clear it)' });
    expect(existsSync(mergingFile(root))).toBe(false);
    expect(g(runWt(), 'rev-parse', 'MERGE_HEAD')).toBe(g(runWt(), 'rev-parse', 'task/T1'));
    expect(g(runWt(), 'rev-parse', 'HEAD')).toBe(pre);
  });
  it('a dead marker whose ref is not the merge in progress leaves it alone: run-dirty, untouched', () => {
    accept('T1', 'a.txt', 'a\n');
    accept('T2', 'b.txt', 'b\n');
    const pre = half('T2');
    marker({ task: 'T1', pre, ref: 'task/T1', pid: deadPid(), startedAt: '2026-10-12T11:59:00.000Z', staleAt: later, dir: dirOf(runWt()), phase: 'merge' });
    expect(out(run(['swarm', 'integrate', 'T1'], io))).toMatchObject({ result: 'run-dirty', detail: expect.stringContaining('unfinished merge') });
    expect(g(runWt(), 'rev-parse', 'MERGE_HEAD')).toBe(g(runWt(), 'rev-parse', 'task/T2'));
    expect(g(runWt(), 'rev-parse', 'HEAD')).toBe(pre);
    expect(readExecution(root)!.tasks.T1.status).toBe('accepted');
  });
  it('swarm merge refuses while an integration is in flight, wherever, and leaves its marker as it was', () => {
    accept('T1', 'a.txt', 'a\n');
    out(run(['swarm', 'integrate', 'T1'], io));
    const live = { task: 'T2', pre: g(runWt(), 'rev-parse', 'HEAD'), ref: 'task/T2', startedAt: '2026-10-12T11:59:00.000Z', staleAt: later, dir: dirOf(runWt()), phase: 'baseline' };
    marker({ ...live, pid: process.ppid });
    const before = readFileSync(mergingFile(root), 'utf8');
    // A JSON result, as main-dirty is, not a usage error.
    expect(out(mergeYes())).toMatchObject({ result: 'busy', detail: expect.stringContaining(`an integration (T2, pid ${process.ppid}) is merging in`) });
    expect(readFileSync(mergingFile(root), 'utf8')).toBe(before);
    expect(git('log', '-1', '--format=%s')).toBe('init');
    // Once its process is gone, the merge goes on.
    marker({ ...live, pid: deadPid() });
    expect(out(mergeYes())).toMatchObject({ result: 'merged' });
    expect(existsSync(mergingFile(root))).toBe(false);
  });
  it('a leftover marker is removed only while it is still what was read: one written since stays', () => {
    const doc = { task: 'T1', pre: 'a'.repeat(40), ref: 'task/T1', startedAt: '2026-10-12T11:59:00.000Z', staleAt: later, dir: root, phase: 'baseline' };
    marker({ ...doc, pid: deadPid() });
    const read = readMergingFile(root)!;
    marker({ ...doc, pid: process.ppid });
    expect(removeMergingIf(root, read.text)).toBe(false);
    expect(readMerging(root)!.pid).toBe(process.ppid);
    expect(readdirSync(path.dirname(mergingFile(root))).filter(f => f.startsWith('merging.json.'))).toEqual([]);
    expect(removeMergingIf(root, readMergingFile(root)!.text)).toBe(true);
    expect(existsSync(mergingFile(root))).toBe(false);
  });
  it('the marker is taken one at a time: a live holder or one being written keeps it, a dead one is taken over', () => {
    const now = io.now().getTime();
    const m = { task: 'T1', pre: 'a'.repeat(40), ref: 'task/T1', pid: process.pid, startedAt: '2026-10-12T12:00:00.000Z', staleAt: later, dir: root, phase: 'baseline' as const };
    const first = takeMerging(root, m, now);
    if (!('hold' in first)) throw new Error('not taken');
    expect(takeMerging(root, { ...m, task: 'T2' }, now)).toEqual({ busy: expect.objectContaining({ task: 'T1' }) });
    // Its own stamp rewrites it; anyone else's marker in its place is not its own any more.
    expect(first.hold.stamp('merge', later)).toBe(true);
    expect(readMerging(root)!.phase).toBe('merge');
    first.hold.release();
    expect(existsSync(mergingFile(root))).toBe(false);
    marker({ ...m, pid: deadPid() });
    const second = takeMerging(root, m, now);
    if (!('hold' in second)) throw new Error('a dead holder was not taken over');
    marker({ ...m, pid: process.ppid });
    expect(second.hold.stamp('merge', later)).toBe(false);
    second.hold.release();
    expect(readMerging(root)!.pid).toBe(process.ppid);
    // An empty marker is one being written: it stands while young, and is taken over once old.
    writeFileSync(mergingFile(root), '');
    const written = statSync(mergingFile(root)).mtimeMs;
    expect(takeMerging(root, m, written + 1000)).toEqual({ busy: null });
    const third = takeMerging(root, m, written + MERGING_UNREADABLE_MS + 1000);
    expect('hold' in third).toBe(true);
    if ('hold' in third) third.hold.release();
  });
  it('a worktree git cannot name still gets a marker that can be read', () => {
    runValidator();
    accept('T1', 'a.txt', 'a\n');
    let seen: unknown = undefined;
    const blind = (dir: string) => (a: string[]) => (a.includes('--show-prefix') ? null : defaultGit(dir)(a));
    const r = out(swarmCommand(['integrate', 'T1'], io, hooked(() => { seen ??= readMerging(root); }, blind)));
    expect(r.result).toBe('integrated');
    expect(seen).toMatchObject({ phase: 'baseline', dir: path.resolve(runWt()) });
  });
});

describe('the final merge needs the recorded yes of the person (I-03)', () => {
  const finished = () => { accept('T1', 'a.txt', 'a\n'); out(run(['swarm', 'integrate', 'T1'], io)); };
  const merge = (args: string[], at: Io = io) => out(run(['swarm', 'merge', ...args, '--hook-session', 'hook-main'], at));
  const when = (hhmm: string): Io => ({ ...io, now: () => new Date(`2026-10-12T${hhmm}:00.000Z`) });
  const record = (authId: string) => readAuths(root).find(r => r.authId === authId);
  it('without a record --yes asks again; with the yes the hook recorded it merges, and uses the record', () => {
    finished();
    const p = merge(['--yes']);
    expect(p).toMatchObject({ result: 'needs-authorization', reason: 'no answer recorded', authId: expect.stringMatching(/^merge-shop-.+-[0-9a-z]{4}$/) });
    expect(p.ask).toMatchObject({ header: 'Merge', multiSelect: false });
    expect(p.ask.question).toBe(`Do I merge forge/run-shop into main? [${p.authId}]`);
    expect(p.ask.options.map((o: { label: string }) => o.label)).toEqual(['Yes, merge it', 'No']);
    expect(merge([]).authId).toBe(p.authId);
    answer(p.ask.question, 'Yes, merge it');
    expect(merge(['--yes'])).toMatchObject({ result: 'merged' });
    expect(record(p.authId)).toMatchObject({ answer: 'yes', answeredBy: 'hook-main', usedAt: '2026-10-12T12:00:00.000Z' });
  });
  it('a no, a yes from another session or one older than 60 minutes is not a yes', () => {
    finished();
    const p1 = merge([]);
    answer(p1.ask.question, 'No', 'hook-main', when('12:01'));
    const p2 = merge(['--yes'], when('12:02'));
    expect(p2).toMatchObject({ result: 'needs-authorization', reason: 'answered no' });
    answer(p2.ask.question, 'Yes, merge it', 'hook-other', when('12:03'));
    const p3 = merge(['--yes'], when('12:04'));
    expect(p3).toMatchObject({ result: 'needs-authorization', reason: 'other session' });
    answer(p3.ask.question, 'Yes, merge it', 'hook-main', when('12:05'));
    expect(merge(['--yes'], when('13:06'))).toMatchObject({ result: 'needs-authorization', reason: 'expired' });
    expect(git('log', '-1', '--format=%s')).not.toBe('forge: merge forge/run-shop');
  });
  it('a yes of another run, or one already used, is not a yes either', () => {
    finished();
    const e = readExecution(root)!;
    const yes = { kind: 'merge' as const, target: 'main', question: 'q', yes: 'Yes, merge it', createdAt: '2026-10-12T12:00:00.000Z', session: 'hook-main',
      answeredAt: '2026-10-12T12:00:00.000Z', answer: 'yes' as const, answeredBy: 'hook-main' };
    writeAuth(root, { ...yes, authId: 'merge-shop-other-aaaa', runId: 'shop-other' });
    expect(merge(['--yes'])).toMatchObject({ result: 'needs-authorization', reason: 'other run' });
    writeAuth(root, { ...yes, authId: `merge-${e.runId}-bbbb`, runId: e.runId, usedAt: '2026-10-12T12:00:00.000Z' });
    expect(merge(['--yes'])).toMatchObject({ result: 'needs-authorization', reason: 'already used' });
  });
  it('into a branch of forge (forge/infinite-…) it merges without a question', () => {
    finished();
    git('checkout', '-q', '-b', 'forge/infinite-20261012');
    seedExecution(root, { ...readExecution(root)!, base: 'forge/infinite-20261012' });
    expect(merge([])).toMatchObject({ result: 'merged' });
    expect(git('log', '-1', '--format=%s')).toBe('forge: merge forge/run-shop');
  });
  it('a yes the person added a note to is no yes, and the refusal carries the note', () => {
    finished();
    const p = merge([]);
    run(['hook', 'answer'], { ...io, stdin: hookAnswerStdin({ cwd: root, session: 'hook-main', answers: { [p.ask.question]: 'Yes, merge it' },
      result: { annotations: { [p.ask.question]: { notes: 'only after CI' } } } }) });
    expect(merge(['--yes'])).toMatchObject({ result: 'needs-authorization', reason: 'answered no', note: 'only after CI' });
    expect(git('log', '-1', '--format=%s')).toBe('init');
  });
  it('a main-dirty or a conflict does not spend the yes: the same answer merges once the cause is gone, and only once', () => {
    accept('T1', 'bad.txt', 'x\n');
    out(run(['swarm', 'integrate', 'T1'], io));
    const p = merge([]);
    answer(p.ask.question, 'Yes, merge it');
    writeFileSync(path.join(root, 'dirty.txt'), 'x\n');
    expect(merge(['--yes'])).toMatchObject({ result: 'main-dirty' });
    expect(record(p.authId)).not.toHaveProperty('usedAt');
    rmSync(path.join(root, 'dirty.txt'));
    // The final validators fail on the merged tree: rolled back, a conflict.
    writeFileSync(path.join(root, '.forge', 'config.yaml'), NOBAD);
    expect(merge(['--yes'])).toMatchObject({ result: 'conflict', detail: expect.stringContaining('nobad') });
    expect(record(p.authId)).not.toHaveProperty('usedAt');
    expect(git('log', '-1', '--format=%s')).toBe('init');
    writeFileSync(path.join(root, '.forge', 'config.yaml'), 'validators: []\n');
    expect(merge(['--yes'])).toMatchObject({ result: 'merged' });
    expect(record(p.authId)).toMatchObject({ usedAt: '2026-10-12T12:00:00.000Z' });
    // More work integrated after it: the yes it used does not merge again; the merge asks a new question.
    const head = git('rev-parse', 'HEAD');
    accept('T2', 'b.txt', 'b\n');
    out(run(['swarm', 'integrate', 'T2'], io));
    const again = merge(['--yes']);
    expect(again).toMatchObject({ result: 'needs-authorization', reason: 'already used' });
    expect(again.authId).not.toBe(p.authId);
    expect(git('rev-parse', 'HEAD')).toBe(head);
  });
  it('a yes that cannot be marked used merges nothing and stays the person\'s, to be used once', () => {
    finished();
    const p = merge([]);
    answer(p.ask.question, 'Yes, merge it');
    // A directory where the record's temporary file goes: the write that marks it used fails.
    const blocker = path.join(authDir(root), `${p.authId}.json.${process.pid}.tmp`);
    mkdirSync(blocker);
    const r = run(['swarm', 'merge', '--yes', '--hook-session', 'hook-main'], io);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(`nothing was merged: the yes ${p.authId} could not be checked and marked used`);
    expect(git('log', '-1', '--format=%s')).toBe('init');
    expect(record(p.authId)).not.toHaveProperty('usedAt');
    rmSync(blocker, { recursive: true });
    expect(merge(['--yes'])).toMatchObject({ result: 'merged' });
    expect(merge(['--yes'])).toMatchObject({ result: 'needs-authorization', reason: 'already used' });
  });
  it('the yes is checked again when it is spent: one another merge spent after the first check merges nothing', () => {
    finished();
    const p = merge([]);
    answer(p.ask.question, 'Yes, merge it');
    const mainGit = defaultGit(root);
    let spent = false;
    // Another merge of the run spends the yes while this one reads which branch the main checkout is on.
    const deps: SwarmDeps = {
      git: a => {
        if (!spent && a[0] === 'rev-parse' && a[1] === '--abbrev-ref') { spent = true; useAuth(root, record(p.authId)!, '2026-10-12T12:00:00.000Z'); }
        return mainGit(a);
      },
      exec: defaultExec(root), repo: repoReader(root), at: dir => ({ git: defaultGit(dir), exec: defaultExec(dir), repo: repoReader(dir) }),
    };
    expect(out(swarmCommand(['merge', '--yes', '--hook-session', 'hook-main'], io, deps))).toMatchObject({ result: 'needs-authorization', reason: 'already used' });
    expect(spent).toBe(true);
    expect(git('log', '-1', '--format=%s')).toBe('init');
  });
  const yesTo = (authId: string, question: string): AuthRecord => ({
    authId, kind: 'merge', runId: readExecution(root)!.runId, target: 'main', question, yes: 'Yes, merge it', createdAt: '2026-10-12T12:00:00.000Z',
    session: 'hook-main', answeredAt: '2026-10-12T12:00:00.000Z', answer: 'yes', answeredBy: 'hook-main',
  });
  const mergeCommits = () => git('log', '--format=%s', 'main').split('\n').filter(s => s === 'forge: merge forge/run-shop').length;
  /** The run's final review as large.md runs it: its reviewer's JSON, then FORGE verdict --task shop-final. Its action. */
  const finalReview = (passes: boolean, at: Io = io) => {
    const dir = path.join(root, '.forge', 'work', 'shop', 'final');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'correctness.json'), passes ? '{"verdict":"pass","confidence":1,"findings":[]}'
      : '{"verdict":"fail","confidence":1,"findings":[{"severity":"critical","file":"a.txt","problem":"broken"}]}');
    writeFileSync(path.join(root, '.forge', 'work', 'shop', 'final-validators.json'), '[]');
    return out(run(['verdict', '--task', 'shop-final', '--dir', '.forge/work/shop/final', '--validators', '.forge/work/shop/final-validators.json'], at)).action;
  };
  it('the final review run from the main checkout, as large.md runs it, records the tree of the run worktree; with something uncommitted there, none (A3, Review Focus 1)', () => {
    finished();
    expect(finalReview(true)).toBe('accept');
    const last = () => readEvents(root).filter(e => e.kind === 'verdict' && e.task === 'shop-final').at(-1)!;
    expect(last().tree).toBe(g(runWt(), 'rev-parse', 'HEAD^{tree}'));
    expect(last().tree).not.toBe(git('rev-parse', 'HEAD^{tree}'));
    writeFileSync(path.join(runWt(), 'stray.txt'), 'x\n');
    expect(finalReview(true)).toBe('accept');
    expect(last()).not.toHaveProperty('tree');
  });
  it('a yes to the start question allows the one final merge of the finished run once its final review accepts: none before, none after', () => {
    finished();
    seedExecution(root, { ...readExecution(root)!, mergeOnFinish: true });
    // Active: the run has not finished, so the merge asks as any other does.
    expect(merge([])).toMatchObject({ result: 'needs-authorization' });
    seedExecution(root, { ...readExecution(root)!, active: false, stopReason: 'stopped' });
    expect(merge([])).toMatchObject({ result: 'needs-authorization' });
    seedExecution(root, { ...readExecution(root)!, stopReason: 'finished' });
    // Finished, but no final review yet, then one that asks for a fix: it asks, and keeps the start yes for later.
    expect(merge([])).toMatchObject({ result: 'needs-authorization' });
    expect(finalReview(false)).toBe('fix');
    expect(merge([])).toMatchObject({ result: 'needs-authorization' });
    expect(readExecution(root)!.mergeOnFinish).toBe(true);
    expect(mergeCommits()).toBe(0);
    expect(finalReview(true)).toBe('accept');
    // A merge that ends main-dirty gives it back; the next one merges with it and spends it.
    writeFileSync(path.join(root, 'dirty.txt'), 'x\n');
    expect(merge([])).toMatchObject({ result: 'main-dirty' });
    expect(readExecution(root)!.mergeOnFinish).toBe(true);
    rmSync(path.join(root, 'dirty.txt'));
    expect(merge([])).toMatchObject({ result: 'merged', closed: true });
    expect(readExecution(root)).toMatchObject({ mergeOnFinish: false, closedBy: 'merge' });
    // A commit on the run branch after it: the next merge asks.
    commitIn(runWt(), 'late.txt', 'late\n', 'late commit');
    expect(merge([])).toMatchObject({ result: 'needs-authorization' });
    expect(mergeCommits()).toBe(1);
  });
  it('a final accept older than the last integration into the run branch does not count: the review did not see that work', () => {
    finished();
    expect(finalReview(true)).toBe('accept');
    accept('T2', 'b.txt', 'b\n');
    expect(out(run(['swarm', 'integrate', 'T2'], when('12:05')))).toMatchObject({ result: 'integrated' });
    seedExecution(root, { ...readExecution(root)!, mergeOnFinish: true, active: false, stopReason: 'finished' });
    expect(merge([], when('12:06'))).toMatchObject({ result: 'needs-authorization' });
    expect(finalReview(true, when('12:07'))).toBe('accept');
    expect(merge([], when('12:08'))).toMatchObject({ result: 'merged', closed: true });
    expect(mergeCommits()).toBe(1);
  });
  it('the merge on finish is claimed under the lock: a run another merge claimed since it was read asks its question', () => {
    finished();
    expect(finalReview(true)).toBe('accept');
    seedExecution(root, { ...readExecution(root)!, mergeOnFinish: true, active: false, stopReason: 'finished' });
    const mainGit = defaultGit(root);
    // Another merge of the run claims it while this one reads which branch the main checkout is on.
    const deps: SwarmDeps = {
      git: a => { if (a[0] === 'rev-parse' && a[1] === '--abbrev-ref') seedExecution(root, { ...readExecution(root)!, mergeOnFinish: false }); return mainGit(a); },
      exec: defaultExec(root), repo: repoReader(root), at: dir => ({ git: defaultGit(dir), exec: defaultExec(dir), repo: repoReader(dir) }),
    };
    expect(out(swarmCommand(['merge', '--hook-session', 'hook-main'], io, deps))).toMatchObject({ result: 'needs-authorization' });
    expect(mergeCommits()).toBe(0);
  });
  it('a yes whose question named other branches is no yes for this merge: one of shop-other\'s run branch never merges shop\'s', () => {
    finished();
    const authId = `merge-${readExecution(root)!.runId}-cccc`;
    writeAuth(root, yesTo(authId, mergeAsk(authId, 'forge/run-shop-other', 'main', false).ask.question));
    expect(merge(['--yes'])).toMatchObject({ result: 'needs-authorization', reason: 'other branch' });
    expect(mergeCommits()).toBe(0);
    // This merge's own question, in either language, is one.
    writeAuth(root, yesTo(authId, mergeAsk(authId, 'forge/run-shop', 'main', true).ask.question));
    expect(merge(['--yes'])).toMatchObject({ result: 'merged' });
  });
  it('a later run cannot take this run\'s id, nor with it the yes given back to it after a main-dirty', () => {
    finished();
    const runA = readExecution(root)!.runId;
    const p = merge([]);
    answer(p.ask.question, 'Yes, merge it');
    writeFileSync(path.join(root, 'dirty.txt'), 'x\n');
    expect(merge(['--yes'])).toMatchObject({ result: 'main-dirty' });
    rmSync(path.join(root, 'dirty.txt'));
    expect(record(p.authId)).not.toHaveProperty('usedAt');
    run(['swarm', 'stop'], io);
    out(run(['swarm', 'close'], io));
    const later = (min: number): Io => ({ ...io, now: () => new Date(Date.parse('2026-10-12T12:00:00.000Z') + min * 60_000) });
    out(run(['swarm', 'start', '--project', 'shop', '--session', 'main', '--hook-session', 'hook-main'], later(1)));
    run(['swarm', 'stop'], later(1));
    out(run(['swarm', 'close'], later(1)));
    const c = run(['swarm', 'start', '--project', 'shop', '--session', 'main', '--hook-session', 'hook-main', '--run-id', runA], later(2));
    expect(c.code).toBe(2);
    expect(c.stderr).toContain(`--run-id ${runA} is the id of a run that already started`);
    expect(mergeCommits()).toBe(0);
  });
  it('a conflict whose merge commit landed anyway keeps the yes used: the base moved, so it is not given back', () => {
    finished();
    const p = merge([]);
    answer(p.ask.question, 'Yes, merge it');
    const mainGit = defaultGit(root);
    // git commits the merge but the command reports a failure: the attempt rolls back what it cannot, a conflict.
    const deps: SwarmDeps = {
      git: a => { const r = mainGit(a); return a[0] === 'commit' ? null : r; },
      exec: defaultExec(root), repo: repoReader(root), at: dir => ({ git: defaultGit(dir), exec: defaultExec(dir), repo: repoReader(dir) }),
    };
    expect(out(swarmCommand(['merge', '--yes', '--hook-session', 'hook-main'], io, deps))).toMatchObject({ result: 'conflict' });
    expect(mergeCommits()).toBe(1);
    expect(record(p.authId)).toMatchObject({ usedAt: '2026-10-12T12:00:00.000Z' });
    expect(merge(['--yes'])).toMatchObject({ result: 'needs-authorization', reason: 'already used' });
  });
  it('a main checkout switched to another branch at the same commit while the merge validates takes nothing', () => {
    finished();
    writeFileSync(path.join(root, '.forge', 'config.yaml'), 'validators:\n  - name: ok\n    cmd: node -e "process.exit(0)"\n');
    const p = merge([]);
    answer(p.ask.question, 'Yes, merge it');
    let switched = false;
    const deps: SwarmDeps = {
      git: defaultGit(root), repo: repoReader(root),
      exec: (cmd, t) => { if (!switched) { switched = true; git('switch', '-q', '-c', 'elsewhere'); } return defaultExec(root)(cmd, t); },
      at: dir => ({ git: defaultGit(dir), exec: defaultExec(dir), repo: repoReader(dir) }),
    };
    expect(out(swarmCommand(['merge', '--yes', '--hook-session', 'hook-main'], io, deps))).toMatchObject({ result: 'main-dirty', detail: 'the main checkout is on elsewhere, not main' });
    expect(switched).toBe(true);
    expect(git('log', '-1', '--format=%s', 'elsewhere')).toBe('init');
    expect(record(p.authId)).not.toHaveProperty('usedAt');
  });
  it('without a Claude session id the yes cannot be checked: needs-authorization, no session id', () => {
    finished();
    const p = out(run(['swarm', 'merge'], io));
    expect(p).toMatchObject({ result: 'needs-authorization', ask: { header: 'Merge' } });
    answer(p.ask.question, 'Yes, merge it');
    expect(out(run(['swarm', 'merge', '--yes'], io))).toMatchObject({ result: 'needs-authorization', reason: 'no session id' });
    // C1: the flag wins over the environment.
    expect(out(run(['swarm', 'merge', '--yes', '--hook-session', 'hook-x'], { ...io, env: { CLAUDE_CODE_SESSION_ID: 'hook-main' } })))
      .toMatchObject({ result: 'needs-authorization', reason: 'other session' });
    expect(git('log', '-1', '--format=%s')).toBe('init');
  });
});
