import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { run } from '../src/forge/cli/run.js';
import { loadConfig } from '../src/forge/config.js';
import {
  readTrust, trustIn, trustFor, updateTrust, recordTrust, configCommands, commandsHash, configGuardDenials, loadTrusted, untrustedFor,
  trustOf, trustAsk, answerTrust, trustFile, type CommandsTrust,
} from '../src/forge/trust.js';
import { assumeTrustedForTests } from '../src/forge/trust-flag.js';
import { profileNames } from '../src/forge/profile.js';
import { saveRun, parseRun, readRunText } from '../src/forge/run.js';
import { autonomousRun, blockedFile, readBlocked } from '../src/forge/autonomous.js';
import { useTempDirs } from './helpers/tmp.js';

const tmp = useTempDirs();
const T0 = new Date('2026-10-22T10:00:00.000Z');
const AT = T0.toISOString();
let main: string, wt: string;
const g = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const config = (cwd: string, cmd: string) => { mkdirSync(path.join(cwd, '.forge'), { recursive: true }); writeFileSync(path.join(cwd, '.forge', 'config.yaml'), `validators:\n  - name: unit\n    cmd: ${cmd}\n`); };
const cli = (cwd: string, args: string[]) => run(args, { cwd, now: () => T0, env: {} });
const trustDecisions = () => JSON.parse(cli(main, ['decision', 'list', '--all']).stdout).filter((d: { point: string }) => d.point === 'trust');
const yaml = (cwd: string, text: string) => { mkdirSync(path.join(cwd, '.forge'), { recursive: true }); writeFileSync(path.join(cwd, '.forge', 'config.yaml'), text); };
const start = (session = 'coord-1') => JSON.parse(cli(wt, ['infinite', 'start', '--profile', 'spike', '--name', 'x', '--hours', '1', '--session', session, '--locale', 'en']).stdout);
const stop = () => saveRun(main, { ...parseRun(readRunText(main))!, active: false });
const hashOf = (cwd: string) => commandsHash(configCommands(loadConfig(cwd)));
const fake = (i: number) => commandsHash([{ name: 'fake', cmd: String(i) }]);
// C-1: what reaches one level above the worktree once forge fills {packages} with "." (a changed .go file at its root).
const UPWARD = process.platform === 'win32' ? 'rmdir /s /q {packages}\\..' : 'find {packages}/.. -delete';
beforeEach(() => {
  assumeTrustedForTests(false);
  main = tmp('deleg-');
  g(main, 'init', '-q', '-b', 'main'); g(main, 'config', 'user.email', 'a@b.c'); g(main, 'config', 'user.name', 't'); g(main, 'config', 'core.autocrlf', 'false');
  writeFileSync(path.join(main, '.gitignore'), '.forge/*\n!.forge/config.yaml\n.claude/\n');
  config(main, 'npm test');
  g(main, 'add', '-A'); g(main, 'commit', '-qm', 'init');
  cli(main, ['infinite', 'prepare', '--profile', 'spike', '--name', 'x']);
  wt = profileNames(main, 'spike', 'x').worktree;
});
afterEach(() => assumeTrustedForTests(true));

describe('delegated trust (6b-2)', () => {
  it('starting the profile trusts the worktree\'s commands and notes it once', () => {
    const r = JSON.parse(cli(wt, ['infinite', 'start', '--profile', 'spike', '--name', 'x', '--hours', '1', '--session', 'coord-1', '--locale', 'en']).stdout);
    expect(r.trust).toMatchObject({ state: 'allowed' });
    expect(readTrust(main).delegated).toEqual([{ runId: 'spike-x', hashes: [r.trust.hash], refused: [], at: AT, list: [{ name: 'validators.unit.cmd', cmd: 'npm test' }] }]);
    expect(trustDecisions()).toEqual([expect.objectContaining({ point: 'trust', by: 'auto', runId: 'spike-x', why: 'validators.unit.cmd: npm test' })]);
  });
  it('a command the run changes is trusted without asking, with the before and after, only once; trustIn then reads it', () => {
    cli(wt, ['infinite', 'start', '--profile', 'spike', '--name', 'x', '--hours', '1', '--session', 'coord-1', '--locale', 'en']);
    config(wt, 'npm run test:unit');
    expect(trustIn(wt, loadConfig(wt)).state).toBe('ask');
    expect(trustFor(wt, loadConfig(wt), AT).state).toBe('allowed');
    expect(trustFor(wt, loadConfig(wt), AT).state).toBe('allowed');
    expect(trustIn(wt, loadConfig(wt)).state).toBe('allowed');
    expect(trustDecisions().map((d: { why: string }) => d.why)).toEqual(['validators.unit.cmd: npm test', 'validators.unit.cmd: npm test → npm run test:unit']);
  });
  it('a config command the guard would deny is never trusted: each denial is a blocked action noted once, and the run asks as today (6b-2, Review Focus 6)', () => {
    cli(wt, ['infinite', 'start', '--profile', 'spike', '--name', 'x', '--hours', '1', '--session', 'coord-1', '--locale', 'en']);
    config(wt, 'rm -rf ~/somewhere');
    expect(trustFor(wt, loadConfig(wt), AT).state).toBe('ask');
    expect(trustFor(wt, loadConfig(wt), AT).state).toBe('ask');
    expect(readBlocked(main, 'spike-x')).toEqual([expect.objectContaining({ rule: 'files', tool: 'config', target: 'validators.unit.cmd: rm -rf ~/somewhere', session: null })]);
    expect(readTrust(main).delegated?.[0]).toMatchObject({ hashes: [expect.any(String)], refused: [expect.any(String)] });
    expect(trustDecisions()).toHaveLength(1);
    const noted = JSON.parse(cli(main, ['blocked', 'note', '--session', 'main']).stdout);
    expect(noted.publish[0].data.decision).toMatchObject({ point: 'blocked', what: 'config: validators.unit.cmd: rm -rf ~/somewhere' });
    config(wt, 'aws s3 rm s3://bucket/x');
    expect(trustFor(wt, loadConfig(wt), AT).state).toBe('ask');
    expect(readBlocked(main, 'spike-x').map(b => b.rule)).toEqual(['files', 'cloud']);
  });
  it('the main checkout, another worktree and the worktree after the run ended ask as today', () => {
    // Nobody ever answered the trust question here: outside the run, every set of commands is «ask».
    cli(wt, ['infinite', 'start', '--profile', 'spike', '--name', 'x', '--hours', '1', '--session', 'coord-1']);
    config(main, 'npm run lint');
    expect(trustFor(main, loadConfig(main), AT).state).toBe('ask');
    const other = path.join(main, '.claude', 'worktrees', 'audit');
    g(main, 'worktree', 'add', '-q', '-b', 'audit', other);
    config(other, 'npm run e2e');
    expect(trustFor(other, loadConfig(other), AT).state).toBe('ask');
    saveRun(main, { ...parseRun(readRunText(main))!, active: false });
    config(wt, 'npm run bench');
    expect(trustFor(wt, loadConfig(wt), AT).state).toBe('ask');
    expect(readTrust(main).delegated?.[0]?.hashes).toHaveLength(1);
  });
  it('a hash the person denied stays denied', () => {
    config(wt, 'rm -rf /');
    const cfg = loadConfig(wt);
    const list = configCommands(cfg);
    updateTrust(main, r => ({ ...r, commands: recordTrust(undefined, 'denied', list, commandsHash(list), AT) }));
    cli(wt, ['infinite', 'start', '--profile', 'spike', '--name', 'x', '--hours', '1', '--session', 'coord-1']);
    expect(trustFor(wt, loadConfig(wt), AT).state).toBe('denied');
  });
  it('loadTrusted and untrustedFor trust the run\'s own commands too, at the time they are given (M-1)', () => {
    cli(wt, ['infinite', 'start', '--profile', 'spike', '--name', 'x', '--hours', '1', '--session', 'coord-1']);
    config(wt, 'npm run test:unit');
    expect(untrustedFor([wt], AT)).toBeNull();
    config(wt, 'npm run bench');
    expect(loadTrusted(wt, AT).state).toBe('allowed');
    expect(readTrust(main).delegated).toEqual([expect.objectContaining({ hashes: [expect.any(String), expect.any(String), expect.any(String)], at: AT })]);
  });
  it('configGuardDenials reads the commands in the dialect forge runs them with: cmd on win32, bash elsewhere (H-3)', () => {
    cli(wt, ['infinite', 'start', '--profile', 'spike', '--name', 'x', '--hours', '1', '--session', 'coord-1']);
    const active = autonomousRun(main)!;
    // %TEMP% is a variable only to cmd: there the target is unknown (denied); bash reads a relative path inside the worktree.
    const list = [{ name: 'swarm.setup', cmd: 'del /q %TEMP%\\x' }];
    expect(configGuardDenials(wt, list, active, 'coord-1', 'cmd')).toEqual([{ command: list[0], verdict: expect.objectContaining({ decision: 'deny', rule: 'files' }) }]);
    expect(configGuardDenials(wt, list, active, 'coord-1', 'bash')).toEqual([]);
    expect(configGuardDenials(wt, list, active, 'coord-1')).toEqual(configGuardDenials(wt, list, active, 'coord-1', process.platform === 'win32' ? 'cmd' : 'bash'));
  });
  it('a start whose worktree config does not load starts and prints no trust (M-1)', () => {
    mkdirSync(path.join(wt, '.forge'), { recursive: true });
    writeFileSync(path.join(wt, '.forge', 'config.yaml'), 'validators: nope\n');
    expect(() => loadConfig(wt)).toThrow();
    const r = cli(wt, ['infinite', 'start', '--profile', 'spike', '--name', 'x', '--hours', '1', '--session', 'coord-1']);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.autonomous).toMatchObject({ runId: 'spike-x' });
    expect(out).not.toHaveProperty('trust');
  });
});

describe('delegated trust, fix round 1 (6b-2)', () => {
  it('C-1: an affected_cmd is judged as forge fills it; one that reaches above the worktree once {packages} is "." is refused and blocked (T6B2-TRUST-EXPANDED)', () => {
    start();
    yaml(wt, `validators:\n  - name: unit\n    kind: test\n    cmd: npm test\n    affected_cmd: ${JSON.stringify(UPWARD)}\n`);
    expect(trustFor(wt, loadConfig(wt), AT)).toMatchObject({ state: 'ask', blocked: true });
    expect(readBlocked(main, 'spike-x')).toEqual([expect.objectContaining({ rule: 'files', tool: 'config', target: `validators.unit.affected_cmd: ${UPWARD}` })]);
    expect(trustDecisions()).toHaveLength(1);
  });
  it('each placeholder form is judged in both dialects; the usual related-tests forms still pass, and a placeholder forge does not fill is an unknown target', () => {
    start();
    const active = autonomousRun(main)!;
    const denied = (cmd: string, dialect: 'cmd' | 'bash') =>
      configGuardDenials(wt, [{ name: 'validators.unit.affected_cmd', cmd }], active, 'coord-1', dialect).map(x => x.verdict);
    // The reviewer's probe: each template alone is allowed; filled with "." it reaches above the worktree.
    expect(denied('rmdir /s /q {packages}\\..', 'cmd')).toEqual([expect.objectContaining({ rule: 'files', reason: expect.stringContaining('as forge fills its placeholders: rmdir /s /q "."\\..') })]);
    expect(denied('find {packages}/.. -delete', 'bash')).toEqual([expect.objectContaining({ rule: 'files' })]);
    for (const [cmd, dialect] of [['npx vitest related --run {files}', 'cmd'], ['npx vitest run {files}', 'bash'], ['go test {packages}', 'bash'], ['pytest {tests}', 'cmd'], ['echo ${HOME}', 'bash']] as const) {
      expect(denied(cmd, dialect), cmd).toEqual([]);
    }
    expect(denied('npx vitest run {changed}', 'bash')).toEqual([expect.objectContaining({ rule: 'config', reason: expect.stringContaining('unknown target: {changed}') })]);
  });
  it('a config whose only denied command is its swarm.setup is refused and blocked through trustFor', () => {
    start();
    yaml(wt, 'validators:\n  - name: unit\n    cmd: npm test\nswarm:\n  setup: rm -rf ~/cache\n');
    expect(trustFor(wt, loadConfig(wt), AT)).toMatchObject({ state: 'ask', blocked: true });
    expect(readBlocked(main, 'spike-x')).toEqual([expect.objectContaining({ rule: 'files', tool: 'config', target: 'swarm.setup: rm -rf ~/cache' })]);
  });
  it('I-1: delegation covers the profile\'s worktree only: with execution.json unreadable, a task-… worktree still asks', () => {
    start();
    writeFileSync(path.join(main, '.forge', 'execution.json'), '{ not json');
    const task = path.join(main, '.claude', 'worktrees', 'task-x');
    g(main, 'worktree', 'add', '-q', '-b', 'task/x', task);
    config(task, 'npm run e2e');
    expect(autonomousRun(main)!.dirs).toContain(task); // the guard's widening stays
    expect(trustFor(task, loadConfig(task), AT).state).toBe('ask');
    // Not the run's to judge either: no blocked action, no refusal.
    expect(readBlocked(main, 'spike-x')).toEqual([]);
    expect(readTrust(main).delegated).toEqual([expect.objectContaining({ runId: 'spike-x', hashes: [expect.any(String)], refused: [] })]);
  });
  it('T6B2-TRUST-RESET: a start of the same id judges again what an earlier run of it trusted or refused', () => {
    start();
    config(wt, 'npm run test:unit');
    expect(trustFor(wt, loadConfig(wt), AT).state).toBe('allowed');
    stop();
    expect(start('coord-2').trust).toEqual({ state: 'allowed', hash: hashOf(wt) });
    expect(readTrust(main).delegated).toEqual([{ runId: 'spike-x', hashes: [hashOf(wt)], refused: [], at: AT, list: [{ name: 'validators.unit.cmd', cmd: 'npm run test:unit' }] }]);
    expect(trustDecisions().map((d: { why: string }) => d.why)).toEqual(['validators.unit.cmd: npm test', 'validators.unit.cmd: npm test → npm run test:unit', 'validators.unit.cmd: npm run test:unit']);
    config(wt, 'rm -rf ~/somewhere');
    expect(trustFor(wt, loadConfig(wt), AT).state).toBe('ask');
    stop();
    expect(start('coord-3').trust).toEqual({ state: 'ask', hash: hashOf(wt), blocked: true, note: false });
    expect(readBlocked(main, 'spike-x')).toHaveLength(2);
    expect(readTrust(main).delegated).toEqual([{ runId: 'spike-x', hashes: [], refused: [hashOf(wt)], at: AT, list: [] }]);
  });
  it('m-2: a denial that could not be recorded leaves the hash unrefused, so the next check judges it again', () => {
    start();
    mkdirSync(blockedFile(main, 'spike-x'), { recursive: true }); // blocked.jsonl is a folder: every append fails
    config(wt, 'rm -rf ~/somewhere');
    expect(trustFor(wt, loadConfig(wt), AT)).toMatchObject({ state: 'ask', blocked: true });
    expect(readTrust(main).delegated?.[0]?.refused).toEqual([]);
  });
  it('m-3: the person\'s No to a set the run delegated meanwhile is recorded, takes it out of the delegation, and wins from then on', () => {
    start();
    config(wt, 'npm run test:unit');
    const t = trustOf(loadConfig(wt), readTrust(main)); // the question forge printed before the run trusted the set
    expect(t.state).toBe('ask');
    expect(trustFor(wt, loadConfig(wt), AT).state).toBe('allowed');
    const ask = trustAsk(t, false);
    const asked = [{ question: ask.question, header: ask.header, options: ask.options, multiSelect: false }];
    expect(answerTrust([wt], asked, { answers: new Map([[ask.question, 'No']]), notes: new Map() }, AT)).toEqual([expect.objectContaining({ state: 'denied', hash: t.hash })]);
    expect(readTrust(main).delegated?.[0]?.hashes).not.toContain(t.hash);
    expect(trustIn(wt, loadConfig(wt)).state).toBe('denied');
    expect(trustFor(wt, loadConfig(wt), AT).state).toBe('denied');
  });
  it('m-4, T6B2-REFUSED-IN-RUN: a set the person refused, once a run restores it, is blocked with one record and no question; outside a run it asks as before', () => {
    const answer = (cmd: string, state: 'allowed' | 'denied') => {
      config(wt, cmd);
      const list = configCommands(loadConfig(wt));
      updateTrust(main, r => ({ ...r, commands: recordTrust(r.commands, state, list, commandsHash(list), AT) }));
    };
    answer('npm run a', 'denied');
    const a = hashOf(wt);
    answer('npm run b', 'allowed');
    // Outside a run: the person is asked again, as 6a does.
    config(wt, 'npm run a');
    expect(trustFor(wt, loadConfig(wt), AT)).toEqual(expect.not.objectContaining({ blocked: true }));
    expect(trustFor(wt, loadConfig(wt), AT).state).toBe('changed');
    config(wt, 'npm run b');
    expect(start().trust).toEqual({ state: 'allowed', hash: hashOf(wt) });
    config(wt, 'npm run a'); // the run restores the set the person refused
    expect(trustFor(wt, loadConfig(wt), AT)).toMatchObject({ state: 'changed', hash: a, blocked: true });
    expect(trustFor(wt, loadConfig(wt), AT)).toMatchObject({ state: 'changed', blocked: true });
    const r = JSON.parse(cli(wt, ['triage', '--task', 't1', 'fix the button']).stdout);
    expect(r.trust).toMatchObject({ state: 'changed', hash: a, note: false, blocked: true });
    expect(readTrust(main).commandsAsked).toBeUndefined();
    expect(readBlocked(main, 'spike-x')).toEqual([{
      ts: AT, rule: 'trust', tool: 'config', target: 'validators.unit.cmd: npm run a', reason: 'the person refused these commands; rewrite them or leave them out', session: null,
    }]);
    expect(readTrust(main).delegated?.[0]).toMatchObject({ hashes: [], refused: [a] }); // B was the person's own Yes: nothing delegated
    expect(readTrust(main).commands?.denied).toEqual([a]);
    expect(trustDecisions()).toEqual([]);
    // A start with that set in place prints it blocked, with no note.
    stop();
    expect(start('coord-2').trust).toEqual({ state: 'changed', hash: a, blocked: true, note: false });
  });
  it('keeps 20 runs, and 20 hashes of each kind per run, the newest last; and the person\'s last 20 Nos', () => {
    start();
    const others = Array.from({ length: 20 }, (_, i) => ({ runId: `other-${i}`, hashes: [fake(i)], refused: [], at: AT, list: [] }));
    updateTrust(main, r => ({
      ...r, delegated: [...others, { ...r.delegated![0], hashes: Array.from({ length: 20 }, (_, i) => fake(100 + i)), refused: Array.from({ length: 20 }, (_, i) => fake(200 + i)) }],
    }));
    config(wt, 'npm run test:unit');
    expect(trustFor(wt, loadConfig(wt), AT).state).toBe('allowed');
    const trusted = hashOf(wt);
    config(wt, 'rm -rf ~/somewhere');
    expect(trustFor(wt, loadConfig(wt), AT).state).toBe('ask');
    const all = readTrust(main).delegated!;
    expect(all.map(d => d.runId)).toEqual([...Array.from({ length: 19 }, (_, i) => `other-${i + 1}`), 'spike-x']);
    const mine = all.at(-1)!;
    expect(mine.hashes).toHaveLength(20);
    expect(mine.hashes).not.toContain(fake(100));
    expect(mine.hashes.at(-1)).toBe(trusted);
    expect(mine.refused).toHaveLength(20);
    expect(mine.refused.at(-1)).toBe(hashOf(wt));
    let rec: CommandsTrust | undefined;
    for (let i = 0; i < 21; i++) rec = recordTrust(rec, 'denied', [], fake(300 + i), AT);
    expect(rec!.denied).toEqual(Array.from({ length: 20 }, (_, i) => fake(301 + i)));
  });
  it('blocked note --session then decision publish prints no note twice', () => {
    start();
    config(wt, 'rm -rf ~/somewhere');
    trustFor(wt, loadConfig(wt), AT);
    expect(JSON.parse(cli(main, ['blocked', 'note', '--session', 'main']).stdout).publish).toHaveLength(1);
    const publish = (): { published: number; publish: { data: { decision: { point: string } } }[] } =>
      JSON.parse(cli(main, ['decision', 'publish', '--session', 'main', '--since', AT, '--run', 'spike-x']).stdout);
    expect(publish().publish.map(w => w.data.decision.point)).toEqual(['trust']);
    expect(publish()).toEqual({ published: 0, publish: [] });
  });
  it('trustIn writes nothing: trust.json, blocked.jsonl and the ledger stay as they were', () => {
    start();
    config(wt, 'rm -rf ~/somewhere');
    const file = trustFile(main)!;
    const before = { text: readFileSync(file, 'utf8'), mtime: statSync(file).mtimeMs };
    const ledger = cli(main, ['decision', 'list', '--all']).stdout;
    expect(trustIn(wt, loadConfig(wt)).state).toBe('ask');
    expect(trustIn(wt, loadConfig(wt)).state).toBe('ask');
    expect({ text: readFileSync(file, 'utf8'), mtime: statSync(file).mtimeMs }).toEqual(before);
    expect(readBlocked(main, 'spike-x')).toEqual([]);
    expect(cli(main, ['decision', 'list', '--all']).stdout).toBe(ledger);
  });
  it('decision add stamps the autonomous run\'s id from its worktree or one of its sessions, so publish --run prints it', () => {
    start();
    const data = (cwd: string, what: string) => writeFileSync(path.join(cwd, 'd.json'), JSON.stringify({ point: 'other', what, chosen: 'grid', why: 'simplest', by: 'auto' }));
    data(wt, 'from the worktree');
    expect(JSON.parse(cli(wt, ['decision', 'add', '--data-file', 'd.json']).stdout).runId).toBe('spike-x');
    data(main, 'from its session');
    expect(JSON.parse(run(['decision', 'add', '--data-file', 'd.json'], { cwd: main, now: () => T0, env: { CLAUDE_CODE_SESSION_ID: 'coord-1' } }).stdout).runId).toBe('spike-x');
    data(main, 'from elsewhere');
    expect(JSON.parse(cli(main, ['decision', 'add', '--data-file', 'd.json']).stdout)).not.toHaveProperty('runId');
    const r = JSON.parse(cli(main, ['decision', 'publish', '--session', 'main', '--since', AT, '--run', 'spike-x']).stdout);
    expect(r.publish.map((w: { data: { decision: { what: string } } }) => w.data.decision.what)).toEqual(['commands of .forge/config.yaml', 'from the worktree', 'from its session']);
  });
  it('triage in the run with a refused config leaves no question note: note false, trust.blocked true (H-4)', () => {
    start();
    config(wt, 'rm -rf ~/somewhere');
    const r = JSON.parse(cli(wt, ['triage', '--task', 't1', 'fix the button']).stdout);
    expect(r.trust).toMatchObject({ state: 'ask', note: false, blocked: true });
    expect(readTrust(main).commandsAsked).toBeUndefined();
  });
});
