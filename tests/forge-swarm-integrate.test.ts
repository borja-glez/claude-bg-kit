import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync, readdirSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run, defaultGit, type Io } from '../src/forge/cli/run.js';
import { readExecution } from '../src/forge/execution.js';
import { readLocal } from '../src/forge/local.js';

let root: string;
let io: Io;
const g = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
const git = (...a: string[]) => g(root, ...a);
const commitIn = (cwd: string, file: string, text: string, msg: string) => { writeFileSync(path.join(cwd, file), text); g(cwd, 'add', file); g(cwd, 'commit', '-qm', msg); return g(cwd, 'rev-parse', 'HEAD'); };
const out = (r: { stdout: string }) => JSON.parse(r.stdout);
const runWt = () => path.join(root, '.claude', 'worktrees', 'run');
const NOBAD = 'validators:\n  - name: nobad\n    cmd: node -e "process.exit(require(\'fs\').existsSync(\'bad.txt\')?1:0)"\n';

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'forge-integ-'));
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 'a@b.c'); git('config', 'user.name', 't'); git('config', 'core.autocrlf', 'false');
  writeFileSync(path.join(root, '.gitignore'), '.forge/\n.claude/\n');
  git('add', '.gitignore');
  commitIn(root, 'base.txt', 'base\n', 'init');
  mkdirSync(path.join(root, '.forge'), { recursive: true });
  writeFileSync(path.join(root, '.forge', 'config.yaml'), 'validators: []\n');
  io = { cwd: root, now: () => new Date('2026-10-12T12:00:00.000Z'), git: defaultGit(root) };
  out(run(['swarm', 'start', '--project', 'shop', '--session', 'main'], io));
});
afterEach(() => { try { git('worktree', 'prune'); } catch { /* ignore */ } rmSync(root, { recursive: true, force: true }); });

const accept = (task: string, file: string, text: string) => {
  const w = out(run(['swarm', 'worktree', task], io)).worktree;
  commitIn(w, file, text, `${task}: work`);
  out(run(['swarm', 'task', task, '--stage', 'verdict', '--status', 'accepted'], io));
  return w;
};

describe('forge swarm integrate (into the run branch)', () => {
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
  it('reuses the baseline of the run tip it just produced', () => {
    accept('T1', 'a.txt', 'a\n');
    const first = out(run(['swarm', 'integrate', 'T1'], io));
    expect(existsSync(path.join(root, '.forge', 'execution', 'baseline', `heavy-run-${first.sha}.json`))).toBe(true);
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
  it('merge does not reuse the run baseline: the main checkout gets its own', () => {
    accept('T1', 'a.txt', 'a\n');
    const first = out(run(['swarm', 'integrate', 'T1'], io));
    const dir = path.join(root, '.forge', 'execution', 'baseline');
    expect(existsSync(path.join(dir, `final-main-${g(root, 'rev-parse', 'main')}.json`))).toBe(false);
    const r = out(run(['swarm', 'merge', '--yes'], io));
    expect(r).toMatchObject({ result: 'merged', preexisting: [] });
    expect(existsSync(path.join(dir, `heavy-run-${first.sha}.json`))).toBe(true);
    expect(readdirSync(dir).some(f => f.startsWith('final-main-'))).toBe(true);
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
    it('a failing install before the merge leaves the task accepted and says why', () => {
      setupConfig('node -e "console.log(\'offline\');process.exit(1)"');
      commitIn(runWt(), 'package.json', '{}\n', 'manifest');
      accept('T1', 'a.txt', 'a\n');
      const r = out(run(['swarm', 'integrate', 'T1'], io));
      expect(r).toMatchObject({ result: 'run-dirty', detail: 'could not install its dependencies before merging task/T1: offline', setup: { ok: false } });
      expect(readExecution(root)!.tasks.T1.status).toBe('accepted');
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
      const r = out(run(['swarm', 'merge', '--yes'], io));
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
      const r = out(run(['swarm', 'merge', '--yes'], io));
      expect(r).toMatchObject({ result: 'merged', setup: { ok: true } });
      expect(installs()).toBe(1);
      expect(installs(root)).toBe(1);
      expect(existsSync(path.join(root, 'node_modules'))).toBe(true);
      expect(lastWhere()).toBe(path.resolve(root).toLowerCase());
      rmSync(where(), { force: true });
    });
  });
  it('merge: asks without authorization, merges into the base with it, refuses a dirty main checkout', () => {
    accept('T1', 'a.txt', 'a\n');
    out(run(['swarm', 'integrate', 'T1'], io));
    expect(out(run(['swarm', 'merge'], io))).toEqual({ result: 'needs-authorization' });
    writeFileSync(path.join(root, 'dirty.txt'), 'x\n');
    expect(out(run(['swarm', 'merge', '--yes'], io))).toMatchObject({ result: 'main-dirty' });
    rmSync(path.join(root, 'dirty.txt'));
    expect(out(run(['swarm', 'merge', '--yes'], io))).toMatchObject({ result: 'merged' });
    expect(git('log', '-1', '--format=%s')).toBe('forge: merge forge/run-shop');
  });
});
