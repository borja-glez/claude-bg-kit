import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { run } from '../src/forge/cli/run.js';
import { loadConfig } from '../src/forge/config.js';
import {
  assumeTrustedForTests, readTrust, trustIn, trustFor, updateTrust, recordTrust, configCommands, commandsHash, configGuardDenials, loadTrusted, untrustedFor,
} from '../src/forge/trust.js';
import { profileNames } from '../src/forge/profile.js';
import { saveRun, parseRun, readRunText } from '../src/forge/run.js';
import { autonomousRun, readBlocked } from '../src/forge/autonomous.js';
import { useTempDirs } from './helpers/tmp.js';

const tmp = useTempDirs();
const T0 = new Date('2026-10-22T10:00:00.000Z');
const AT = T0.toISOString();
let main: string, wt: string;
const g = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const config = (cwd: string, cmd: string) => { mkdirSync(path.join(cwd, '.forge'), { recursive: true }); writeFileSync(path.join(cwd, '.forge', 'config.yaml'), `validators:\n  - name: unit\n    cmd: ${cmd}\n`); };
const cli = (cwd: string, args: string[]) => run(args, { cwd, now: () => T0, env: {} });
const trustDecisions = () => JSON.parse(cli(main, ['decision', 'list', '--all']).stdout).filter((d: { point: string }) => d.point === 'trust');
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
