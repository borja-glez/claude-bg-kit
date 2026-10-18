import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run as cli, defaultGit, type Io } from '../src/forge/cli/run.js';
import { parseConfig } from '../src/forge/config.js';
import { readExecution, runWorktree, saveExecution, taskWorktree } from '../src/forge/execution.js';
import { assumeTrustedForTests, commandsHash, configCommands, readTrust, trustAsk, trustFile, trustOf } from '../src/forge/trust.js';
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
/** A commands record written by hand where forge keeps the answer (<git common dir>/forge/trust.json). */
const record = (cwd: string, rec: unknown) => { const f = trustFile(cwd)!; mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify({ commands: rec })); };
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
  it('every entry counts: one name twice (a config built by hand) keeps both, in file order, and the question lists both', () => {
    const swarm = parseConfig(null).swarm;
    const list = configCommands({ validators: [{ name: 't', cmd: 'a' }, { name: 't', cmd: 'b' }], swarm });
    expect(list).toEqual([{ name: 'validators.t.cmd', cmd: 'a' }, { name: 'validators.t.cmd', cmd: 'b' }]);
    expect(commandsHash(list)).not.toBe(commandsHash(configCommands({ validators: [{ name: 't', cmd: 'b' }, { name: 't', cmd: 'a' }], swarm })));
    const h0 = '0'.repeat(64);
    const t = trustOf({ validators: [{ name: 't', cmd: 'a' }, { name: 't', cmd: 'b' }], swarm },
      { commands: { state: 'allowed', hash: h0, list: [{ name: 'validators.t.cmd', cmd: 'a' }], at: '', allowed: [h0] } });
    expect(t).toMatchObject({ state: 'changed', changed: [] });
    expect(trustAsk(t, false).question.split('\n').slice(1, 3)).toEqual(['validators.t.cmd: a', 'validators.t.cmd: b']);
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
    expect(readTrust(root).commands).toMatchObject({ state: 'allowed', hash: t.hash, list: t.commands, allowed: [t.hash] });
    expect(out(run(['local', 'get', 'commands']))).toMatchObject({ state: 'allowed', hash: t.hash });
    expect(out(run(['triage', '--task', 't1', 'fix the button']))).not.toHaveProperty('trust');
    expect(run(['validate', '--all']).code).toBe(0);
    expect(ran).toContain('node -e "process.exit(0)"');
  });
  it('a cmd changed in a worktree asks again there, with the command before and after; trusting it keeps the main checkout trusted', () => {
    run(['local', 'set', 'commands', 'allowed', '--expect', trustOfTriage().hash]);
    const wt = path.join(root, '.claude', 'worktrees', 'x');
    git(root, 'worktree', 'add', '-q', '-b', 'x', wt);
    expect(trustFile(wt)).toBe(trustFile(root));
    config(wt, 'validators:\n  - name: unit\n    cmd: node -e "0"\n');
    const c = trustOfTriage('--cwd', wt);
    expect(c).toMatchObject({ state: 'changed', cwd: wt, changed: [{ name: 'validators.unit.cmd', before: 'node -e "process.exit(0)"', after: 'node -e "0"' }] });
    expect(c.ask.question).toContain('validators.unit.cmd: node -e "process.exit(0)" → node -e "0"');
    expect(run(['validate', '--all', '--cwd', wt]).code).toBe(2);
    expect(run(['local', 'set', 'commands', 'allowed', '--expect', c.hash, '--cwd', wt]).code).toBe(0);
    expect(run(['validate', '--all', '--cwd', wt]).code).toBe(0);
    expect(run(['validate', '--all']).code).toBe(0);
    expect(readTrust(root).commands?.allowed).toHaveLength(2);
  });
  it('denied runs only the validators forge detects, and says so', () => {
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node -e 0' } }));
    const t = trustOfTriage();
    expect(run(['local', 'set', 'commands', 'denied']).code).toBe(0);
    expect(readTrust(root).commands).toMatchObject({ state: 'denied', hash: t.hash, allowed: [] });
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
  it('a hand-edited or broken commands record counts as no answer; one with the shape of the spec counts', () => {
    const t = trustOfTriage();
    for (const bad of [{ state: 'allowed', hash: 'nothex' }, { state: 'maybe', hash: t.hash }, 'yes', { state: 'allowed', hash: t.hash.slice(0, 63) }]) {
      record(root, bad);
      expect(trustOf(parseConfig(UNIT), readTrust(root)).state, JSON.stringify(bad)).toBe('ask');
    }
    record(root, { state: 'allowed', hash: t.hash });
    expect(trustOf(parseConfig(UNIT), readTrust(root)).state).toBe('allowed');
  });
});

// Review focus: what asks again and what does not, and records that are no answer.
describe('which changes ask again, and which records count (I-03)', () => {
  const TWO = 'validators:\n  - name: a\n    cmd: node -e "1"\n  - name: unit\n    cmd: node -e "process.exit(0)"\n';
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
  it('a record of other commands, an uppercase hash, a list, one without state or a file that is no JSON is no trust; a hand-written denied counts', () => {
    const t = trustOfTriage();
    const other = commandsHash([{ name: 'validators.unit.cmd', cmd: 'node -e 1' }]);
    const cases: [unknown, string][] = [
      [{ state: 'allowed', hash: t.hash.toUpperCase() }, 'ask'], [[{ state: 'allowed', hash: t.hash }], 'ask'], [{ hash: t.hash, allowed: [t.hash] }, 'ask'],
      [{ state: 'allowed', hash: other }, 'changed'], [{ state: 'allowed', hash: other, allowed: ['x', t.hash.slice(1), `${t.hash}0`] }, 'changed'],
    ];
    for (const [bad, state] of cases) {
      record(root, bad);
      expect(trustOf(parseConfig(UNIT), readTrust(root)).state, JSON.stringify(bad)).toBe(state);
      expect(run(['validate', '--all']).code, JSON.stringify(bad)).toBe(2);
    }
    writeFileSync(trustFile(root)!, 'commands: {state: allowed}');
    expect(trustOf(parseConfig(UNIT), readTrust(root)).state).toBe('ask');
    record(root, { state: 'denied', hash: t.hash });
    expect(trustOf(parseConfig(UNIT), readTrust(root)).state).toBe('denied');
    expect(ran).toEqual([]);
  });
  it('a hash the record denies is never trust, whatever its allowed list holds', () => {
    const t = trustOfTriage();
    record(root, { state: 'denied', hash: t.hash, allowed: [t.hash] });
    expect(readTrust(root).commands?.allowed).toEqual([]);
    expect(trustOf(parseConfig(UNIT), readTrust(root)).state).toBe('denied');
    expect(trustOf(parseConfig(UNIT), { commands: { state: 'denied', hash: t.hash, list: [], at: '', allowed: [t.hash] } }).state).toBe('denied');
    const v = run(['validate', '--all']);
    expect(v.code).toBe(0);
    expect(v.stderr).toContain('configCommands: denied');
    expect(ran).toEqual([]);
  });
});

describe('where the answer lives (I-03)', () => {
  it('in the git directory: a .forge/local.yaml the repository ships gives no trust, tracked or not, and a clone carries no answer', () => {
    const h = commandsHash(configCommands(parseConfig(UNIT)));
    const evil = `${UNIT}swarm:\n  setup: node -e "1"\n`;
    writeFileSync(path.join(root, '.forge', 'local.yaml'), `commands: ${JSON.stringify({ state: 'allowed', hash: h, allowed: [h, commandsHash(configCommands(parseConfig(evil)))] })}\ncommandsAsked: ${JSON.stringify([h])}\n`);
    git(root, 'add', '-f', '.forge/local.yaml'); git(root, 'commit', '-qm', 'an answer shipped with the repository');
    expect(trustOfTriage()).toMatchObject({ state: 'ask', hash: h, note: true });
    expect(run(['validate', '--all']).code).toBe(2);
    git(root, 'rm', '-q', '--cached', '.forge/local.yaml');
    expect(run(['validate', '--all']).code).toBe(2);
    expect(run(['local', 'set', 'commands', 'allowed', '--expect', h]).code).toBe(0);
    expect(trustFile(root)).toBe(path.join(root, '.git', 'forge', 'trust.json'));
    expect(readTrust(root).commands).toMatchObject({ state: 'allowed', hash: h, allowed: [h] });
    config(root, evil);
    expect(trustOfTriage()).toMatchObject({ state: 'changed' });
    expect(run(['setup']).code).toBe(2);
    expect(ran).toEqual([]);
    const clone = path.join(tmp('forge-trust-clone-'), 'c');
    git(root, 'clone', '-q', root, clone);
    expect(trustFile(clone)).toBe(path.join(clone, '.git', 'forge', 'trust.json'));
    expect(trustOfTriage('--cwd', clone)).toMatchObject({ state: 'ask', hash: h, cwd: clone });
    expect(run(['validate', '--all', '--cwd', clone]).code).toBe(2);
    // The answer for --cwd goes where the checks of that repository read it.
    expect(run(['local', 'set', 'commands', 'allowed', '--expect', h, '--cwd', clone]).code).toBe(0);
    expect(readTrust(clone).commands).toMatchObject({ state: 'allowed', hash: h });
    expect(out(run(['local', 'get', 'commands', '--cwd', clone]))).toMatchObject({ hash: h });
    expect(run(['validate', '--all', '--cwd', clone]).code).toBe(0);
  });
  it('outside a git repository forge keeps no answer: it asks every time, and local set commands says why', () => {
    const dir = tmp('forge-trust-nogit-');
    config(dir, UNIT);
    expect(trustFile(dir)).toBeNull();
    const at = { cwd: dir, git: defaultGit(dir) };
    const first = out(run(['triage', '--task', 't1', 'fix the button'], at)).trust;
    expect(first).toMatchObject({ state: 'ask', note: true });
    const set = run(['local', 'set', 'commands', 'allowed', '--expect', first.hash], at);
    expect(set.code).toBe(2);
    expect(set.stderr).toContain('is not in a git repository, so forge keeps no answer for it and asks each time');
    expect(out(run(['triage', '--task', 't1', 'fix the button'], at)).trust).toMatchObject({ state: 'ask', note: true });
    expect(run(['validate', '--all'], at).code).toBe(2);
    expect(ran).toEqual([]);
  });
});

describe('the config and the question (I-03)', () => {
  it('two validators of one name are a config error: forge runs none of the commands and says why', () => {
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }));
    config(root, 'validators:\n  - name: lint\n    cmd: eslint .\n  - name: test\n    cmd: npx vitest run\n');
    run(['local', 'set', 'commands', 'allowed', '--expect', trustOfTriage().hash]);
    config(root, 'validators:\n  - name: lint\n    cmd: eslint src\n  - name: test\n    cmd: npx vitest run\n  - name: test\n    cmd: node -e "require(\'fs\').writeFileSync(\'pwned\', \'\')"\n');
    expect(() => parseConfig(readFileSync(path.join(root, '.forge', 'config.yaml'), 'utf8'))).toThrow('validators.2.name: duplicate name test');
    for (const argv of [['triage', '--task', 't1', 'fix the button'], ['validate', '--all'], ['setup'], ['local', 'set', 'commands', 'denied']]) {
      const r = run(argv);
      expect(r.code, argv.join(' ')).toBe(2);
      expect(r.stderr, argv.join(' ')).toContain('duplicate name test');
    }
    expect(ran).toEqual([]);
  });
  it('after a No the next question lists every command, the refused one included; after a yes what changed comes first, then the rest', () => {
    config(root, 'validators:\n  - name: lint\n    cmd: eslint .\nswarm:\n  setup: node -e "2"\n');
    trustOfTriage();
    expect(run(['local', 'set', 'commands', 'denied']).code).toBe(0);
    config(root, 'validators:\n  - name: lint\n    cmd: eslint src\nswarm:\n  setup: node -e "2"\n');
    const after = trustOfTriage();
    expect(after.state).toBe('changed');
    expect(after).not.toHaveProperty('changed');
    expect(after.ask.question.split('\n').slice(1, 3)).toEqual(['validators.lint.cmd: eslint src', 'swarm.setup: node -e "2"']);
    expect(run(['local', 'set', 'commands', 'allowed', '--expect', after.hash]).code).toBe(0);
    config(root, 'validators:\n  - name: lint\n    cmd: eslint lib\nswarm:\n  setup: node -e "2"\n');
    expect(trustOfTriage().ask.question.split('\n').slice(1, 3)).toEqual(['validators.lint.cmd: eslint src → eslint lib', 'swarm.setup: node -e "2"']);
  });
  it('the question shows a line break as ⏎ and every character outside printable ASCII as <U+XXXX>, and says when a command is cut', () => {
    config(root, `validators:\n  - name: unit\n    cmd: "echo a\\nnode -e 0 #\\u202Ex"\n  - name: lint\n    cmd: "node scripts/l\\u0456nt.mjs\\u200D\\u00A0x\\ty"\n  - name: long\n    cmd: "node -e 0 ${'x'.repeat(300)}"\n`);
    const q: string = trustOfTriage().ask.question;
    expect(q).toContain('validators.unit.cmd: echo a ⏎ node -e 0 #<U+202E>x');
    expect(q).toContain('validators.lint.cmd: node scripts/l<U+0456>nt.mjs<U+200D><U+00A0>x<U+0009>y');
    for (const c of [0x202e, 0x456, 0x200d, 0xa0, 0x09]) expect(q).not.toContain(String.fromCharCode(c));
    expect(q).toMatch(/validators\.long\.cmd: node -e 0 x+…/);
    expect(q).toContain('read them in .forge/config.yaml before you answer');
  });
  it('what runs is what was hashed: CRLF in a command, an affected_cmd or swarm.setup is LF when it runs', () => {
    const text = 'validators:\n  - name: unit\n    cmd: "node -e 0\\r\\nnode -e 1"\n    affected_cmd: "node -e 0 {files}\\r\\nx"\nswarm:\n  setup: "a\\r\\nb"\n';
    const c = parseConfig(text);
    expect([c.validators![0].cmd, c.validators![0].affected_cmd, c.swarm.setup]).toEqual(['node -e 0\nnode -e 1', 'node -e 0 {files}\nx', 'a\nb']);
    expect(parseConfig('validators:\n  - name: unit\n    cmd: "a\\rb"\n').validators![0].cmd).toBe('a\rb');
    config(root, text);
    run(['local', 'set', 'commands', 'allowed', '--expect', trustOfTriage().hash]);
    expect(run(['validate', '--all']).code).toBe(0);
    expect(ran).toEqual(['node -e 0\nnode -e 1']);
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
