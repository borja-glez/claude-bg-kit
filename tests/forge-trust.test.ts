import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run as cli, defaultGit, type Io } from '../src/forge/cli/run.js';
import { parseConfig } from '../src/forge/config.js';
import { readLocal } from '../src/forge/local.js';
import { readExecution, runWorktree, saveExecution, taskWorktree } from '../src/forge/execution.js';
import { assumeTrustedForTests, commandsHash, configCommands, trustOf } from '../src/forge/trust.js';
import type { ExecTask } from '../src/lib/execution-state.js';
import { walk } from './helpers/files.js';
import { hookAnswerStdin } from './helpers/hook-answer.js';
import { useTempDirs } from './helpers/tmp.js';

const tmp = useTempDirs();
const NOW = new Date('2026-10-16T10:00:00.000Z');
const UNIT = 'validators:\n  - name: unit\n    cmd: node -e "process.exit(0)"\n';
const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
const config = (cwd: string, text: string) => { mkdirSync(path.join(cwd, '.forge'), { recursive: true }); writeFileSync(path.join(cwd, '.forge', 'config.yaml'), text); };
const out = (r: { code: number; stdout: string; stderr: string }) => { if (r.code !== 0) throw new Error(`exit ${r.code}: ${r.stderr}`); return JSON.parse(r.stdout); };
let root: string;
let io: Io;
let ran: string[];
const run = (argv: string[], over: Partial<Io> = {}) => cli(argv, { ...io, ...over });
const trustOfTriage = (...extra: string[]) => out(run(['triage', '--task', 't1', ...extra, 'fix the button'])).trust;

beforeEach(() => {
  assumeTrustedForTests(false);
  root = tmp('forge-trust-');
  git(root, 'init', '-q', '-b', 'main'); git(root, 'config', 'user.email', 'a@b.c'); git(root, 'config', 'user.name', 't'); git(root, 'config', 'core.autocrlf', 'false');
  writeFileSync(path.join(root, '.gitignore'), '.forge/*\n!.forge/config.yaml\n.claude/\n');
  config(root, UNIT);
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'init');
  ran = [];
  const fake = (cmd: string) => { ran.push(cmd); return { code: 0, output: '', ms: 1, timedOut: false }; };
  io = { cwd: root, now: () => NOW, git: defaultGit(root), env: {}, sleep: () => undefined, exec: fake, execMany: cmds => cmds.map(fake) };
});
afterEach(() => assumeTrustedForTests(true));

describe('the hash of the commands of .forge/config.yaml (I-03)', () => {
  const hashOf = (text: string) => commandsHash(configCommands(parseConfig(text)));
  it('changes with a cmd, an affected_cmd or swarm.setup; not with affects, when, kind or the order of the validators; CRLF counts as LF', () => {
    const base = hashOf('validators:\n  - name: a\n    cmd: x\n  - name: b\n    cmd: y\n');
    expect(hashOf('validators:\n  - name: b\n    cmd: y\n  - name: a\n    cmd: x\n')).toBe(base);
    expect(hashOf('validators:\n  - name: a\n    cmd: x\n    affects: ["src/**"]\n    when: medium\n    kind: test\n  - name: b\n    cmd: y\n')).toBe(base);
    expect(hashOf('validators:\n  - name: a\n    cmd: x2\n  - name: b\n    cmd: y\n')).not.toBe(base);
    expect(hashOf('validators:\n  - name: a\n    cmd: x\n    affected_cmd: x {files}\n  - name: b\n    cmd: y\n')).not.toBe(base);
    expect(hashOf('validators:\n  - name: a\n    cmd: x\n  - name: b\n    cmd: y\nswarm:\n  setup: npm ci\n')).not.toBe(base);
    expect(hashOf('validators:\n  - name: a\n    cmd: "x\\r\\ny"\n')).toBe(hashOf('validators:\n  - name: a\n    cmd: "x\\ny"\n'));
    expect(configCommands(parseConfig('validators: []\n'))).toEqual([]);
    expect(trustOf(parseConfig('validators: []\n'), {}).state).toBe('free');
  });
  it('a config file written with CRLF hashes as the same file with LF; a lone CR is not a line break', () => {
    const lf = 'validators:\n  - name: a\n    cmd: |\n      npm ci\n      npm test\n    affected_cmd: npm test -- {files}\nswarm:\n  setup: npm ci\n';
    expect(hashOf(lf.replace(/\n/g, '\r\n'))).toBe(hashOf(lf));
    expect(hashOf('validators:\n  - name: a\n    cmd: "x\\ry"\n')).not.toBe(hashOf('validators:\n  - name: a\n    cmd: "x\\ny"\n'));
  });
});

describe('trusting the commands of .forge/config.yaml (I-03)', () => {
  it('without trust: triage prints trust with its question, and validate and prep exit 2 without running anything', () => {
    const t = out(run(['triage', '--task', 't1', '--locale', 'es', 'arregla el botón'])).trust;
    expect(t).toMatchObject({ state: 'ask', hash: commandsHash(configCommands(parseConfig(UNIT))), cwd: root, note: true,
      commands: [{ name: 'validators.unit.cmd', cmd: 'node -e "process.exit(0)"' }] });
    expect(t.ask).toMatchObject({ header: 'Comandos', multiSelect: false, options: [{ label: 'Sí, confío' }, { label: 'No' }] });
    expect(t.ask.question).toContain('validators.unit.cmd: node -e "process.exit(0)"');
    expect(trustOfTriage().note).toBe(false);
    const v = run(['validate', '--all']);
    expect(v.code).toBe(2);
    expect(v.stderr).toContain('the commands of .forge/config.yaml are not trusted on this machine (ask)');
    expect(run(['prep', '--task', 't1-1', '--path', 'small', '--no-baseline']).code).toBe(2);
    expect(ran).toEqual([]);
  });
  it('local set commands allowed --expect <hash> trusts them and validate runs them; without --expect or with a stale hash it exits 2', () => {
    const t = trustOfTriage();
    expect(run(['local', 'set', 'commands', 'allowed']).code).toBe(2);
    expect(run(['local', 'set', 'commands', 'allowed', '--expect', '0'.repeat(64)]).code).toBe(2);
    expect(run(['local', 'set', 'commands', 'allowed', '--expect', t.hash]).code).toBe(0);
    expect(readLocal(root).commands).toMatchObject({ state: 'allowed', hash: t.hash, list: t.commands, allowed: [t.hash] });
    expect(out(run(['local', 'get', 'commands']))).toMatchObject({ state: 'allowed', hash: t.hash });
    expect(out(run(['triage', '--task', 't1', 'fix the button']))).not.toHaveProperty('trust');
    expect(run(['validate', '--all']).code).toBe(0);
    expect(ran).toContain('node -e "process.exit(0)"');
  });
  it('a cmd changed in a worktree asks again there, with the command before and after; trusting it keeps the main checkout trusted', () => {
    run(['local', 'set', 'commands', 'allowed', '--expect', trustOfTriage().hash]);
    const wt = path.join(root, '.claude', 'worktrees', 'x');
    git(root, 'worktree', 'add', '-q', '-b', 'x', wt);
    config(wt, 'validators:\n  - name: unit\n    cmd: node -e "0"\n');
    const c = trustOfTriage('--cwd', wt);
    expect(c).toMatchObject({ state: 'changed', cwd: wt, changed: [{ name: 'validators.unit.cmd', before: 'node -e "process.exit(0)"', after: 'node -e "0"' }] });
    expect(c.ask.question).toContain('validators.unit.cmd: node -e "process.exit(0)" → node -e "0"');
    expect(run(['validate', '--all', '--cwd', wt]).code).toBe(2);
    expect(run(['local', 'set', 'commands', 'allowed', '--expect', c.hash, '--cwd', wt]).code).toBe(0);
    expect(run(['validate', '--all', '--cwd', wt]).code).toBe(0);
    expect(run(['validate', '--all']).code).toBe(0);
    expect(readLocal(root).commands?.allowed).toHaveLength(2);
  });
  it('denied runs only the validators forge detects, and says so', () => {
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node -e 0' } }));
    const t = trustOfTriage();
    expect(run(['local', 'set', 'commands', 'denied']).code).toBe(0);
    expect(readLocal(root).commands).toMatchObject({ state: 'denied', hash: t.hash, allowed: [] });
    const v = run(['validate', '--all']);
    expect(v.code).toBe(0);
    expect(ran.some(c => c.includes('process.exit(0)'))).toBe(false);
    expect(ran.some(c => /\bnpm\b.*\btest\b/.test(c))).toBe(true);
    expect(v.stderr).toContain('configCommands: denied');
  });
  it('swarm start exits 3 with the question before anything moves, and FORGE setup exits 2', () => {
    config(root, `${UNIT}swarm:\n  setup: node -e "0"\n`);
    const s = run(['swarm', 'start', '--project', 'shop', '--session', 'main', '--hook-session', 'h1', '--locale', 'en']);
    expect(s.code).toBe(3);
    expect(JSON.parse(s.stdout)).toMatchObject({ started: false, trust: { state: 'ask', note: true, ask: { header: 'Commands' } } });
    expect(readExecution(root)).toBeNull();
    expect(git(root, 'branch', '--list', 'forge/run-shop')).toBe('');
    expect(run(['setup']).code).toBe(2);
  });
  it('in a run, tick stalls with untrusted-commands when the commands change, and says to leave a note once per hash', () => {
    run(['local', 'set', 'commands', 'allowed', '--expect', trustOfTriage().hash]);
    out(run(['swarm', 'start', '--project', 'shop', '--session', 'main', '--hook-session', 'h1']));
    config(root, 'validators:\n  - name: unit\n    cmd: node -e "1"\n');
    const tick = () => out(run(['swarm', 'tick', '--plan', 'plan.yaml', '--db', 'db']));
    const first = tick();
    expect(first.actions).toEqual([expect.objectContaining({ type: 'stalled', reason: 'untrusted-commands', note: true, trust: expect.objectContaining({ state: 'changed', cwd: root }) })]);
    expect(readExecution(root)).toMatchObject({ active: false, stopReason: 'stalled', stallReason: 'untrusted-commands' });
    saveExecution(root, { ...readExecution(root)!, active: true, stopReason: null, stallReason: null });
    expect(tick().actions[0]).toMatchObject({ type: 'stalled', note: false });
  });
  it('a hand-edited or broken commands record of local.yaml counts as no answer; one with the shape of the spec counts', () => {
    const t = trustOfTriage();
    for (const bad of [{ state: 'allowed', hash: 'nothex' }, { state: 'maybe', hash: t.hash }, 'yes', { state: 'allowed', hash: t.hash.slice(0, 63) }]) {
      writeFileSync(path.join(root, '.forge', 'local.yaml'), `commands: ${JSON.stringify(bad)}\n`);
      expect(trustOf(parseConfig(UNIT), readLocal(root)).state, JSON.stringify(bad)).toBe('ask');
    }
    writeFileSync(path.join(root, '.forge', 'local.yaml'), `commands: ${JSON.stringify({ state: 'allowed', hash: t.hash })}\n`);
    expect(trustOf(parseConfig(UNIT), readLocal(root)).state).toBe('allowed');
  });
});

// Review focus: what asks again and what does not, and records that are no answer.
describe('which changes ask again, and which records count (I-03)', () => {
  const TWO = 'validators:\n  - name: a\n    cmd: node -e "1"\n  - name: unit\n    cmd: node -e "process.exit(0)"\n';
  const local = (rec: unknown) => writeFileSync(path.join(root, '.forge', 'local.yaml'), `commands: ${JSON.stringify(rec)}\n`);
  it('reordering the validators, changing affects, when or kind, or CRLF line endings asks nothing; an affected_cmd or a swarm.setup asks again', () => {
    config(root, TWO);
    run(['local', 'set', 'commands', 'allowed', '--expect', trustOfTriage().hash]);
    const reordered = 'validators:\n  - name: unit\n    cmd: node -e "process.exit(0)"\n  - name: a\n    cmd: node -e "1"\n';
    for (const text of [
      reordered,
      'validators:\n  - name: a\n    cmd: node -e "1"\n    affects: ["src/**"]\n    when: always\n    kind: lint\n  - name: unit\n    cmd: node -e "process.exit(0)"\n    kind: test\n',
      TWO.replace(/\n/g, '\r\n'),
    ]) {
      config(root, text);
      expect(out(run(['triage', '--task', 't1', 'fix the button'])), JSON.stringify(text)).not.toHaveProperty('trust');
      expect(run(['validate', '--all']).code, JSON.stringify(text)).toBe(0);
    }
    config(root, `${reordered}    affected_cmd: node -e "1" {files}\n`);
    expect(trustOfTriage()).toMatchObject({ state: 'changed', changed: [{ name: 'validators.a.affected_cmd', before: null, after: 'node -e "1" {files}' }] });
    expect(run(['validate', '--all']).code).toBe(2);
    config(root, `${reordered}swarm:\n  setup: node -e "0"\n`);
    expect(trustOfTriage()).toMatchObject({ state: 'changed', changed: [{ name: 'swarm.setup', before: null, after: 'node -e "0"' }] });
    expect(run(['setup']).code).toBe(2);
  });
  it('a record of other commands, an uppercase hash, a list or one without state is no trust; a hand-written denied counts', () => {
    const t = trustOfTriage();
    const other = commandsHash([{ name: 'validators.unit.cmd', cmd: 'node -e 1' }]);
    const cases: [unknown, string][] = [
      [{ state: 'allowed', hash: t.hash.toUpperCase() }, 'ask'], [[{ state: 'allowed', hash: t.hash }], 'ask'], [{ hash: t.hash, allowed: [t.hash] }, 'ask'],
      [{ state: 'allowed', hash: other }, 'changed'], [{ state: 'allowed', hash: other, allowed: ['x', t.hash.slice(1), `${t.hash}0`] }, 'changed'],
    ];
    for (const [bad, state] of cases) {
      local(bad);
      expect(trustOf(parseConfig(UNIT), readLocal(root)).state, JSON.stringify(bad)).toBe(state);
      expect(run(['validate', '--all']).code, JSON.stringify(bad)).toBe(2);
    }
    local({ state: 'denied', hash: t.hash });
    expect(trustOf(parseConfig(UNIT), readLocal(root)).state).toBe('denied');
    expect(ran).toEqual([]);
  });
  it('a .forge/local.yaml that git tracks came with the repository: its record is no answer, and local set commands writes none there', () => {
    const t = trustOfTriage();
    local({ state: 'allowed', hash: t.hash });
    git(root, 'add', '-f', '.forge/local.yaml'); git(root, 'commit', '-qm', 'a trust record shipped with the repository');
    expect(trustOfTriage()).toMatchObject({ state: 'ask', hash: t.hash });
    expect(run(['validate', '--all']).code).toBe(2);
    expect(out(run(['local', 'get', 'commands']))).toBeNull();
    const set = run(['local', 'set', 'commands', 'allowed', '--expect', t.hash]);
    expect(set.code).toBe(2);
    expect(set.stderr).toContain('git rm --cached .forge/local.yaml');
    expect(ran).toEqual([]);
    git(root, 'rm', '-q', '--cached', '.forge/local.yaml');
    expect(run(['validate', '--all']).code).toBe(0);
  });
  it('the question shows a line break and an invisible character as such, and says when a command is cut', () => {
    config(root, `validators:\n  - name: unit\n    cmd: "echo a\\nnode -e 0 #\\u202Ex"\n  - name: long\n    cmd: "node -e 0 ${'x'.repeat(300)}"\n`);
    const q: string = trustOfTriage().ask.question;
    expect(q).toContain('validators.unit.cmd: echo a ⏎ node -e 0 #<U+202E>x');
    expect(q).not.toContain(String.fromCharCode(0x202e));
    expect(q).toMatch(/validators\.long\.cmd: node -e 0 x+…/);
    expect(q).toContain('read them in .forge/config.yaml before you answer');
  });
});

describe('the other commands that run them, without trust (I-03)', () => {
  const task = (over: Partial<ExecTask>): ExecTask => ({
    status: 'accepted', stage: 'review', round: 1, worktree: '', branch: 'task/t1', executor: 'subagents', attempts: 1, agent: null,
    startedAt: NOW.toISOString(), stageSince: NOW.toISOString(), updatedAt: NOW.toISOString(), detail: null, ...over,
  });
  it('review-prep, swarm worktree, swarm integrate and swarm merge exit 2 before anything moves', () => {
    git(root, 'checkout', '-q', '-b', 'forge/base'); // a forge branch as the base: swarm merge asks no merge question
    run(['local', 'set', 'commands', 'allowed', '--expect', trustOfTriage().hash]);
    out(run(['swarm', 'start', '--project', 'shop', '--session', 'main', '--hook-session', 'h1']));
    config(root, 'validators:\n  - name: unit\n    cmd: node -e "1"\n');
    writeFileSync(path.join(root, 'baseline.json'), '[]\n');
    const rp = run(['review-prep', '--task', 't1-1', '--path', 'small', '--base', 'HEAD', '--baseline', 'baseline.json', '--dir', '.forge/work/t1']);
    expect(rp.code).toBe(2);
    expect(rp.stderr).toContain('not trusted on this machine (changed)');
    expect(run(['swarm', 'worktree', 't1']).code).toBe(2);
    expect(existsSync(taskWorktree(root, 't1'))).toBe(false);
    const tips = () => [git(root, 'rev-parse', 'forge/run-shop'), git(root, 'rev-parse', 'forge/base')];
    const before = tips();
    saveExecution(root, { ...readExecution(root)!, tasks: { t1: task({ branch: 'forge/base' }) } });
    expect(run(['swarm', 'integrate', 't1']).code).toBe(2);
    expect(run(['swarm', 'merge']).code).toBe(2);
    expect(tips()).toEqual(before);
    expect(ran).toEqual([]);
  });
  it('swarm merge --yes without trust exits 2 before it spends the person\'s yes, which merges once they trust the commands', () => {
    run(['local', 'set', 'commands', 'allowed', '--expect', trustOfTriage().hash]);
    out(run(['swarm', 'start', '--project', 'shop', '--session', 'main', '--hook-session', 'h1']));
    config(root, 'validators:\n  - name: unit\n    cmd: node -e "1"\n');
    const p = out(run(['swarm', 'merge', '--hook-session', 'hook-main']));
    expect(p.result).toBe('needs-authorization');
    run(['hook', 'answer'], { stdin: hookAnswerStdin({ cwd: root, session: 'hook-main', answers: { [p.ask.question]: p.ask.options[0].label } }) });
    const m = run(['swarm', 'merge', '--yes', '--hook-session', 'hook-main']);
    expect(m.code).toBe(2);
    expect(m.stderr).toContain('not trusted on this machine (changed)');
    expect(ran).toEqual([]);
    run(['local', 'set', 'commands', 'allowed', '--expect', trustOfTriage().hash]);
    expect(out(run(['swarm', 'merge', '--yes', '--hook-session', 'hook-main']))).toMatchObject({ result: 'merged' });
  });
  it('an integration whose merge brings commands nobody trusted is rolled back without running them', () => {
    run(['local', 'set', 'commands', 'allowed', '--expect', trustOfTriage().hash]);
    out(run(['swarm', 'start', '--project', 'shop', '--session', 'main', '--hook-session', 'h1']));
    const wt = taskWorktree(root, 't1');
    git(root, 'worktree', 'add', '-q', '-b', 'task/t1', wt, 'forge/run-shop');
    config(wt, `${UNIT}  - name: evil\n    cmd: node -e "require('fs').writeFileSync('pwned', '')"\n`);
    git(wt, 'commit', '-qam', 'a new validator');
    const tip = git(root, 'rev-parse', 'forge/run-shop');
    saveExecution(root, { ...readExecution(root)!, tasks: { t1: task({ worktree: wt }) } });
    const r = out(run(['swarm', 'integrate', 't1']));
    expect(r.result).toBe('conflict');
    expect(r.detail).toContain('not trusted on this machine (changed)');
    expect(git(root, 'rev-parse', 'forge/run-shop')).toBe(tip);
    expect(existsSync(path.join(runWorktree(root), 'pwned'))).toBe(false);
  });
});

describe('the test switch (I-03)', () => {
  it('only src/forge/trust.ts names assumeTrustedForTests, and only to define it', () => {
    const src = fileURLToPath(new URL('../src', import.meta.url));
    const naming = walk(src).filter(f => /\.tsx?$/.test(f) && readFileSync(f, 'utf8').includes('assumeTrustedForTests'));
    expect(naming.map(f => path.relative(src, f).split(path.sep).join('/'))).toEqual(['forge/trust.ts']);
    expect(readFileSync(naming[0], 'utf8').match(/assumeTrustedForTests\(/g)).toHaveLength(1);
  });
});
