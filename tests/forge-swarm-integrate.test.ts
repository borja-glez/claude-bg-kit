import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync, readdirSync, appendFileSync, lstatSync, symlinkSync } from 'node:fs';
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
      const r = out(run(['swarm', 'merge', '--yes'], io));
      expect(r).toMatchObject({ result: 'merged', restored: ['gen.txt'] });
      expect(g(runWt(), 'status', '--porcelain')).toBe('');
      expect(git('status', '--porcelain')).toBe('');
      expect(readFileSync(path.join(root, 'gen.txt'), 'utf8')).toBe('committed\n');
    });
    it('ephemeral (the person\'s checkout): unchanged, the regenerated file stays modified and the integration is run-dirty', () => {
      commitIn(root, 'gen.txt', 'committed\n', 'gen');
      expect(run(['swarm', 'stop'], io).code).toBe(0);
      writeFileSync(path.join(root, '.forge', 'config.yaml'), GEN());
      writeFileSync(path.join(root, '.forge', 'tasks.json'), JSON.stringify([
        { id: 'fix-a', title: 'fix a', path: 'small', zones: ['a.txt'], depends_on: [] },
        { id: 'fix-b', title: 'fix b', path: 'small', zones: ['b.txt'], depends_on: [] },
      ]));
      const started = run(['swarm', 'start', '--project', 'loose', '--session', 'main', '--kind', 'ephemeral', '--tasks', '.forge/tasks.json'], io);
      expect(started.stderr).toBe('');
      out(run(['swarm', 'tick'], io));
      const w = out(run(['swarm', 'worktree', 'fix-a'], io)).worktree;
      commitIn(w, 'a.txt', 'a\n', 'fix-a: work');
      out(run(['swarm', 'task', 'fix-a', '--stage', 'verdict', '--status', 'accepted'], io));
      const r = out(run(['swarm', 'integrate', 'fix-a'], io));
      expect(r.result).toBe('run-dirty');
      expect(r.detail).toContain('gen.txt');
      expect(r.restored).toBeUndefined();
      expect(git('status', '--porcelain')).toBe('M gen.txt');
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
    it('an unmoved final merge onto a checkout with package.json but no node_modules takes no baseline there', () => {
      commitIn(root, 'package.json', '{}\n', 'manifest');
      g(runWt(), 'merge', '-q', '--ff-only', 'main');
      setupConfig(INSTALL(), `${finalValidators()}  - name: red\n    cmd: node -e "process.exit(1)"\n`);
      accept('T1', 'a.txt', 'a\n');
      expect(out(run(['swarm', 'integrate', 'T1'], io)).result).toBe('integrated');
      const r = out(run(['swarm', 'merge', '--yes'], io));
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
        const r = out(run(['swarm', 'merge', '--yes'], io));
        expect(r).toMatchObject({ result: 'conflict', setup: { ok: true } });
        expect(r.depsFromRejectedMerge).toBeUndefined();
        expect(installs(root)).toBe(1);
        expect(existsSync(path.join(root, 'node_modules'))).toBe(false);
        expect(git('status', '--porcelain')).toBe('');
      });
      it('installs again for the restored tree when it has a manifest', () => {
        rejected(NOPKG, true);
        const r = out(run(['swarm', 'merge', '--yes'], io));
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
        const r = out(run(['swarm', 'merge', '--yes'], io));
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
        const r = out(run(['swarm', 'merge', '--yes'], io));
        expect(r).toMatchObject({ result: 'conflict', restoreSetup: { ok: true }, restoreChanged: ['package-lock.json'], depsFromRejectedMerge: true });
        expect(git('status', '--porcelain')).toBe('M package-lock.json');
      });
      it('says the dependencies may not match when it can neither reinstall nor remove them', () => {
        rejected(NOFILE, false);
        mkdirSync(path.join(root, 'node_modules'));
        writeFileSync(path.join(root, '.git', 'info', 'exclude'), 'node_modules/\n');
        const r = out(run(['swarm', 'merge', '--yes'], io));
        expect(r).toMatchObject({ result: 'conflict', depsFromRejectedMerge: true });
        expect(r.say).toEqual(['The dependencies in your checkout were installed for the rejected merge of forge/run-shop and may not match your files: reinstall them before you use it.']);
        expect(existsSync(path.join(root, 'node_modules'))).toBe(true);
      });
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
