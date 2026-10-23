import { describe, it, expect, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { run } from '../src/forge/cli/run.js';
import { parseRun, readRunText, runFile, startRun } from '../src/forge/run.js';
import { samePath } from '../src/lib/worktree.js';
import { activeProfileAt, profileNames, protectedBranchesOf, startFile } from '../src/forge/profile.js';
import { autonomousFor, sessionsFile } from '../src/forge/autonomous.js';
import { isAutonomousName } from '../src/lib/forge-run.js';
import { useTempDirs } from './helpers/tmp.js';

const tmp = useTempDirs();
const T0 = new Date('2026-10-22T10:00:00.000Z');
let main: string;
const g = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const cli = (cwd: string, args: string[]) => run(['infinite', ...args], { cwd, now: () => T0, env: {} });
beforeEach(() => {
  main = tmp('profile-');
  g(main, 'init', '-q', '-b', 'main');
  g(main, 'config', 'user.email', 'a@b.c'); g(main, 'config', 'user.name', 't'); g(main, 'config', 'core.autocrlf', 'false');
  writeFileSync(path.join(main, 'a.txt'), 'a'); g(main, 'add', 'a.txt'); g(main, 'commit', '-qm', 'a');
});

describe('protectedBranchesOf', () => {
  it('keeps the start branch, main and the default branch, once each', () => {
    expect(protectedBranchesOf('feature-x', 'master')).toEqual(['feature-x', 'main', 'master']);
    expect(protectedBranchesOf('main', 'main')).toEqual(['main']);
    expect(protectedBranchesOf('main', null)).toEqual(['main']);
  });
});

describe('infinite prepare', () => {
  it('creates forge/<profile>-<name> from the current branch in its own worktree, and reuses both later', () => {
    const first = JSON.parse(cli(main, ['prepare', '--profile', 'spike', '--name', 'tetris']).stdout);
    const { worktree, branch } = profileNames(main, 'spike', 'tetris');
    expect(first).toMatchObject({ runId: 'spike-tetris', worktree, branch: 'forge/spike-tetris', startBranch: 'main', created: true, project: 'tetris' });
    expect(g(worktree, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('forge/spike-tetris');
    expect(g(main, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    expect(JSON.parse(cli(main, ['prepare', '--profile', 'spike', '--name', 'tetris']).stdout)).toMatchObject({ created: false, startBranch: 'main' });
  });
  it('a branch whose worktree was removed gets a worktree again, with the first start branch', () => {
    cli(main, ['prepare', '--profile', 'spike', '--name', 'tetris']);
    const { worktree } = profileNames(main, 'spike', 'tetris');
    g(main, 'worktree', 'remove', '--force', worktree);
    g(main, 'checkout', '-q', '-b', 'other');
    expect(JSON.parse(cli(main, ['prepare', '--profile', 'spike', '--name', 'tetris']).stdout)).toMatchObject({ created: true, startBranch: 'main' });
  });
  it('refuses a bad profile or name, a detached start, the run branch as start, and a worktree on another branch', () => {
    expect(cli(main, ['prepare', '--profile', 'prod', '--name', 'x']).code).toBe(2);
    expect(cli(main, ['prepare', '--profile', 'spike', '--name', 'Mi Juego']).code).toBe(2);
    g(main, 'checkout', '-q', '-b', 'forge/spike-self');
    expect(cli(main, ['prepare', '--profile', 'spike', '--name', 'self']).code).toBe(2);
    g(main, 'checkout', '-q', 'main');
    mkdirSync(path.join(main, '.claude', 'worktrees'), { recursive: true });
    g(main, 'worktree', 'add', '-q', '-b', 'elsewhere', profileNames(main, 'product', 'game').worktree);
    expect(cli(main, ['prepare', '--profile', 'product', '--name', 'game']).code).toBe(2);
    g(main, 'checkout', '-q', '--detach');
    expect(cli(main, ['prepare', '--profile', 'spike', '--name', 'other']).code).toBe(2);
  });
  it('records the start branch and the default branch once, in start.json, and its next line names the worktree (M-10)', () => {
    g(main, 'update-ref', 'refs/remotes/origin/master', 'HEAD');
    g(main, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/master');
    const out = JSON.parse(cli(main, ['prepare', '--profile', 'spike', '--name', 'tetris']).stdout);
    const { worktree } = profileNames(main, 'spike', 'tetris');
    expect(out.next).toContain(worktree);
    expect(JSON.parse(readFileSync(startFile(main, 'spike-tetris'), 'utf8'))).toEqual({ startBranch: 'main', defaultBranch: 'master', at: T0.toISOString() });
    g(main, 'checkout', '-q', '-b', 'later');
    const again = run(['infinite', 'prepare', '--profile', 'spike', '--name', 'tetris'], { cwd: main, now: () => new Date('2026-10-23T10:00:00.000Z'), env: {} });
    expect(JSON.parse(again.stdout)).toMatchObject({ startBranch: 'main', created: false });
    expect(JSON.parse(readFileSync(startFile(main, 'spike-tetris'), 'utf8')).at).toBe(T0.toISOString());
  });
  it('takes a name of 40 characters and refuses one of 41 (M-5)', () => {
    expect(isAutonomousName('a'.repeat(40))).toBe(true);
    expect(isAutonomousName('a'.repeat(41))).toBe(false);
    expect(cli(main, ['prepare', '--profile', 'spike', '--name', 'a'.repeat(41)]).code).toBe(2);
    expect(cli(main, ['prepare', '--profile', 'spike', '--name', 'a'.repeat(40)]).code).toBe(0);
  });
  it('a refusal touches nothing: no start.json, no exclude line, no worktree (L-5)', () => {
    // No global ignore file, so .claude/worktrees/ is not ignored yet and excludeWorktrees would write its line.
    g(main, 'config', 'core.excludesFile', path.join(main, 'no-global-ignore'));
    const exclude = path.join(main, '.git', 'info', 'exclude');
    const before = existsSync(exclude) ? readFileSync(exclude, 'utf8') : null;
    g(main, 'worktree', 'add', '-q', '-b', 'elsewhere', profileNames(main, 'product', 'game').worktree);
    expect(cli(main, ['prepare', '--profile', 'product', '--name', 'game']).code).toBe(2);
    expect(existsSync(startFile(main, 'product-game'))).toBe(false);
    expect(existsSync(exclude) ? readFileSync(exclude, 'utf8') : null).toBe(before);
    g(main, 'checkout', '-q', '--detach');
    expect(cli(main, ['prepare', '--profile', 'spike', '--name', 'tetris']).code).toBe(2);
    expect(existsSync(profileNames(main, 'spike', 'tetris').worktree)).toBe(false);
    expect(existsSync(path.join(main, '.forge'))).toBe(false);
  });
  it('clears only its own stale entry: another worktree whose folder is away stays registered, with its index (I-1, L-5-AMEND)', () => {
    const away = tmp('away-');
    const usb = path.join(away, 'usb');
    const person = path.join(usb, 'person-wt');
    g(main, 'worktree', 'add', '-q', '-b', 'person-feature', person);
    writeFileSync(path.join(person, 'b.txt'), 'b'); g(person, 'add', 'b.txt');
    renameSync(usb, path.join(away, 'unplugged'));
    const listed = () => g(main, 'worktree', 'list', '--porcelain').split('\n').filter(l => l.startsWith('worktree ')).map(l => l.slice('worktree '.length));
    expect(cli(main, ['prepare', '--profile', 'spike', '--name', 'tetris']).code).toBe(0);
    const { worktree } = profileNames(main, 'spike', 'tetris');
    rmSync(worktree, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    expect(JSON.parse(cli(main, ['prepare', '--profile', 'spike', '--name', 'tetris']).stdout)).toMatchObject({ created: true, startBranch: 'main' });
    expect(g(worktree, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('forge/spike-tetris');
    expect(listed().some(d => samePath(d, person))).toBe(true);
    renameSync(path.join(away, 'unplugged'), usb);
    expect(g(person, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('person-feature');
    expect(g(person, 'diff', '--cached', '--name-only')).toBe('b.txt');
  });
  it('leaves the main checkout\'s HEAD, branch and index as they were (m-4)', () => {
    writeFileSync(path.join(main, 'b.txt'), 'b'); g(main, 'add', 'b.txt');
    const head = g(main, 'rev-parse', 'HEAD');
    expect(cli(main, ['prepare', '--profile', 'spike', '--name', 'tetris']).code).toBe(0);
    expect(g(main, 'rev-parse', 'HEAD')).toBe(head);
    expect(g(main, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    expect(g(main, 'diff', '--cached', '--name-only')).toBe('b.txt');
  });
  it('refuses, before it writes anything, a start branch outside the rule, a bad start.json, a folder that is no worktree and a branch held elsewhere (m-1, m-4, m-5)', () => {
    g(main, 'config', 'core.excludesFile', path.join(main, 'no-global-ignore'));
    const exclude = path.join(main, '.git', 'info', 'exclude');
    const before = existsSync(exclude) ? readFileSync(exclude, 'utf8') : null;
    const refused = (name: string, cause: RegExp) => {
      const r = cli(main, ['prepare', '--profile', 'spike', '--name', name]);
      expect(r.code, name).toBe(2);
      expect(r.stderr, name).toMatch(cause);
    };
    g(main, 'checkout', '-q', '-b', 'feat#1');
    refused('hash', /outside forge's branch rule/);
    g(main, 'checkout', '-q', 'main');
    for (const [name, text] of [['bad', 'not json'], ['dash', JSON.stringify({ startBranch: '-x', defaultBranch: null, at: T0.toISOString() })]]) {
      mkdirSync(path.dirname(startFile(main, `spike-${name}`)), { recursive: true });
      writeFileSync(startFile(main, `spike-${name}`), text);
      refused(name, /does not hold \{ startBranch, defaultBranch, at \}/);
    }
    mkdirSync(profileNames(main, 'spike', 'plain').worktree, { recursive: true });
    refused('plain', /is no worktree of this repository/);
    const elsewhere = path.join(main, '.claude', 'worktrees', 'elsewhere');
    g(main, 'worktree', 'add', '-q', '-b', 'forge/spike-held', elsewhere);
    refused('held', /forge\/spike-held is checked out in/);
    renameSync(elsewhere, path.join(tmp('away-'), 'elsewhere'));
    refused('held', /whose folder is missing/);
    expect(g(main, 'worktree', 'list', '--porcelain')).toContain('branch refs/heads/forge/spike-held');
    expect(existsSync(exclude) ? readFileSync(exclude, 'utf8') : null).toBe(before);
    for (const name of ['hash', 'plain', 'held']) expect(existsSync(startFile(main, `spike-${name}`)), name).toBe(false);
  });
  it('refuses a locked stale entry of its own and a start point that is gone, and leaves both as they are (m-1)', () => {
    cli(main, ['prepare', '--profile', 'spike', '--name', 'locked']);
    const locked = profileNames(main, 'spike', 'locked').worktree;
    g(main, 'worktree', 'lock', locked);
    rmSync(locked, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    const r = cli(main, ['prepare', '--profile', 'spike', '--name', 'locked']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/registered and locked, but its folder is missing/);
    expect(existsSync(locked)).toBe(false);
    expect(g(main, 'worktree', 'list', '--porcelain')).toContain('branch refs/heads/forge/spike-locked');
    g(main, 'checkout', '-q', '-b', 'feature');
    cli(main, ['prepare', '--profile', 'spike', '--name', 'gone']);
    const gone = profileNames(main, 'spike', 'gone').worktree;
    g(main, 'worktree', 'remove', '--force', gone);
    g(main, 'checkout', '-q', 'main');
    g(main, 'branch', '-q', '-D', 'feature', 'forge/spike-gone');
    const r2 = cli(main, ['prepare', '--profile', 'spike', '--name', 'gone']);
    expect(r2.code).toBe(2);
    expect(r2.stderr).toMatch(/the start branch feature no longer exists, and neither does forge\/spike-gone/);
    expect(existsSync(gone)).toBe(false);
  });
  it('says so when git cannot name the branch it starts from, or cannot add the worktree (m-4)', () => {
    const outside = cli(tmp('nogit-'), ['prepare', '--profile', 'spike', '--name', 'tetris']);
    expect(outside.code).toBe(2);
    expect(outside.stderr).toMatch(/git cannot say which branch/);
    writeFileSync(path.join(main, '.claude'), 'a file where the worktrees folder would go');
    const r = cli(main, ['prepare', '--profile', 'spike', '--name', 'tetris']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/git could not add the worktree .* on forge\/spike-tetris from main/);
    expect(existsSync(startFile(main, 'spike-tetris'))).toBe(false);
  });
});

describe('infinite start --profile', () => {
  it('starts an autonomous run only from its worktree, and the guard then judges its session and no other', () => {
    cli(main, ['prepare', '--profile', 'spike', '--name', 'tetris']);
    const { worktree } = profileNames(main, 'spike', 'tetris');
    expect(cli(main, ['start', '--profile', 'spike', '--name', 'tetris', '--hours', '2', '--session', 'coord-1']).code).toBe(2);
    const r = JSON.parse(cli(worktree, ['start', '--profile', 'spike', '--name', 'tetris', '--hours', '2', '--session', 'coord-1', '--locale', 'es']).stdout);
    expect(r.autonomous).toEqual({ profile: 'spike', name: 'tetris', runId: 'spike-tetris', worktree, branch: 'forge/spike-tetris', startBranch: 'main', protectedBranches: ['main'] });
    expect(parseRun(readRunText(main))?.autonomous?.runId).toBe('spike-tetris');
    expect(autonomousFor(main, { session_id: 'coord-1' })).not.toBeNull();
    expect(autonomousFor(main, { session_id: 'person', cwd: main })).toBeNull();
    const guard = (input: Record<string, unknown>) => run(['hook', 'guard'], { cwd: main, now: () => T0, env: {}, stdin: JSON.stringify({ hook_event_name: 'PreToolUse', ...input }) }).stdout.trim();
    expect(guard({ session_id: 'coord-1', cwd: worktree, tool_name: 'Bash', tool_input: { command: 'git push' } })).toContain('"deny"');
    expect(guard({ session_id: 'person', cwd: main, tool_name: 'Bash', tool_input: { command: 'git push' } })).toBe('');
  });
  it('without --profile, start is today\'s', () => {
    expect(JSON.parse(cli(main, ['start', '--cycles', '3', '--session', 'coord-1']).stdout)).not.toHaveProperty('autonomous');
  });
  it('refuses before prepare, outside the worktree naming its path, off its branch, and with a bad profile or name; none writes run.json (M-5, M-10)', () => {
    const { worktree } = profileNames(main, 'spike', 'tetris');
    const start = (cwd: string, ...over: string[]) => cli(cwd, ['start', '--hours', '2', '--session', 'coord-1', ...(over.length ? over : ['--profile', 'spike', '--name', 'tetris'])]);
    g(main, 'worktree', 'add', '-q', '-b', 'forge/spike-tetris', worktree);
    expect(start(worktree).stderr).toMatch(/infinite prepare/);
    cli(main, ['prepare', '--profile', 'spike', '--name', 'tetris']);
    const outside = start(main);
    expect(outside.code).toBe(2);
    expect(outside.stderr).toContain(worktree);
    g(worktree, 'checkout', '-q', '-b', 'side');
    expect(start(worktree).code).toBe(2);
    g(worktree, 'checkout', '-q', 'forge/spike-tetris');
    for (const bad of [['--profile', 'prod', '--name', 'tetris'], ['--profile', 'spike', '--name', 'a'.repeat(41)], ['--profile', 'spike'], ['--name', 'tetris']]) {
      expect(start(worktree, ...bad).code, bad.join(' ')).toBe(2);
    }
    expect(readRunText(main)).toBeNull();
    expect(start(worktree).code).toBe(0);
  });
  it('writes sessions.json with the session and the worktree, and rewrites it for a new session (H-1)', () => {
    cli(main, ['prepare', '--profile', 'spike', '--name', 'tetris']);
    const { worktree } = profileNames(main, 'spike', 'tetris');
    expect(cli(worktree, ['start', '--profile', 'spike', '--name', 'tetris', '--hours', '2', '--session', 'coord-1']).code).toBe(0);
    expect(JSON.parse(readFileSync(sessionsFile(main, 'spike-tetris'), 'utf8'))).toEqual({ ids: ['coord-1'], worktree });
    expect(run(['stop'], { cwd: main, now: () => T0, env: {} }).code).toBe(0);
    expect(cli(worktree, ['start', '--profile', 'spike', '--name', 'tetris', '--hours', '2', '--session', 'coord-2']).code).toBe(0);
    expect(JSON.parse(readFileSync(sessionsFile(main, 'spike-tetris'), 'utf8'))).toEqual({ ids: ['coord-2'], worktree });
  });
  it('refuses while another profile is active, and from a stopped run\'s own session (L-9)', () => {
    cli(main, ['prepare', '--profile', 'spike', '--name', 'tetris']);
    cli(main, ['prepare', '--profile', 'product', '--name', 'shop']);
    const tetris = profileNames(main, 'spike', 'tetris').worktree;
    const shop = profileNames(main, 'product', 'shop').worktree;
    const start = (cwd: string, profile: string, name: string, session: string) =>
      cli(cwd, ['start', '--profile', profile, '--name', name, '--hours', '2', '--session', session]);
    expect(start(tetris, 'spike', 'tetris', 'coord-1').code).toBe(0);
    const busy = start(shop, 'product', 'shop', 'coord-2');
    expect(busy.code).toBe(2);
    expect(busy.stderr).toContain('spike-tetris');
    expect(run(['stop'], { cwd: main, now: () => T0, env: {} }).code).toBe(0);
    for (const [cwd, profile, name] of [[tetris, 'spike', 'tetris'], [shop, 'product', 'shop']]) {
      const own = start(cwd, profile, name, 'coord-1');
      expect(own.code).toBe(2);
      expect(own.stderr).toMatch(/open a new conversation/);
    }
    expect(JSON.parse(start(shop, 'product', 'shop', 'coord-2').stdout).autonomous.runId).toBe('product-shop');
  });
  it('never restarts an active run, its own session included and also once its budget is due (m-2)', () => {
    cli(main, ['prepare', '--profile', 'spike', '--name', 'tetris']);
    const { worktree } = profileNames(main, 'spike', 'tetris');
    expect(cli(worktree, ['start', '--profile', 'spike', '--name', 'tetris', '--hours', '1', '--session', 'coord-1']).code).toBe(0);
    for (const at of [T0, new Date(T0.getTime() + 2 * 3600_000)]) {
      for (const session of ['coord-1', 'coord-2']) {
        const r = run(['infinite', 'start', '--profile', 'spike', '--name', 'tetris', '--hours', '2', '--session', session], { cwd: worktree, now: () => at, env: {} });
        expect(r.code, `${session} at ${at.toISOString()}`).toBe(2);
        expect(r.stderr).toContain('a run is active: continue it, or stop it and start from a new conversation');
      }
    }
    expect(parseRun(readRunText(main))).toMatchObject({ startedAt: T0.toISOString(), budget: { hours: 1 }, sessionId: 'coord-1' });
  });
  it('prepare refuses inside an active run\'s worktree; both refuse a run.json that does not read or whose block does not parse (m-3)', () => {
    cli(main, ['prepare', '--profile', 'spike', '--name', 'tetris']);
    const { worktree } = profileNames(main, 'spike', 'tetris');
    cli(worktree, ['start', '--profile', 'spike', '--name', 'tetris', '--hours', '2', '--session', 'coord-1']);
    const inside = cli(worktree, ['prepare', '--profile', 'spike', '--name', 'tetris']);
    expect(inside.code).toBe(2);
    expect(inside.stderr).toMatch(/inside the worktree of the active autonomous run spike-tetris/);
    expect(cli(main, ['prepare', '--profile', 'product', '--name', 'shop']).code).toBe(0);
    expect(run(['stop'], { cwd: main, now: () => T0, env: {} }).code).toBe(0);
    expect(cli(worktree, ['prepare', '--profile', 'spike', '--name', 'tetris']).code).toBe(0);
    const shop = profileNames(main, 'product', 'shop').worktree;
    const broken = (setup: () => void) => {
      setup();
      for (const [cwd, args] of [[main, ['prepare', '--profile', 'spike', '--name', 'tetris']],
        [shop, ['start', '--profile', 'product', '--name', 'shop', '--hours', '2', '--session', 'coord-9']]] as const) {
        const r = cli(cwd, [...args]);
        expect(r.code, args[0]).toBe(2);
        expect(r.stderr, args[0]).toContain(runFile(main));
      }
    };
    broken(() => { rmSync(runFile(main)); mkdirSync(runFile(main)); });
    broken(() => {
      rmSync(runFile(main), { recursive: true });
      writeFileSync(runFile(main), JSON.stringify({ ...startRun(T0, { hours: 1 }, 10, 'coord-1'), autonomous: { profile: 'nope' } }));
    });
  });
  it('a profile started from a feature branch protects it first, then main (m-4)', () => {
    g(main, 'checkout', '-q', '-b', 'feature');
    cli(main, ['prepare', '--profile', 'spike', '--name', 'tetris']);
    const { worktree } = profileNames(main, 'spike', 'tetris');
    const r = JSON.parse(cli(worktree, ['start', '--profile', 'spike', '--name', 'tetris', '--hours', '2', '--session', 'coord-1']).stdout);
    expect(r.autonomous).toMatchObject({ startBranch: 'feature', protectedBranches: ['feature', 'main'] });
  });
  it('start refuses a start.json that does not hold a record, and a block that would not read back (m-4)', () => {
    cli(main, ['prepare', '--profile', 'spike', '--name', 'tetris']);
    const { worktree } = profileNames(main, 'spike', 'tetris');
    const start = () => cli(worktree, ['start', '--profile', 'spike', '--name', 'tetris', '--hours', '2', '--session', 'coord-1']);
    writeFileSync(startFile(main, 'spike-tetris'), 'not json');
    expect(start().stderr).toMatch(/does not hold \{ startBranch, defaultBranch, at \}/);
    writeFileSync(startFile(main, 'spike-tetris'), JSON.stringify({ startBranch: 'a..b', defaultBranch: null, at: T0.toISOString() }));
    const r = start();
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/the autonomous block of spike-tetris does not read back/);
    expect(readRunText(main)).toBeNull();
  });
  it('swarm start refuses inside the active profile\'s worktree, and says why (T6B2-NO-EXECUTION)', () => {
    cli(main, ['prepare', '--profile', 'spike', '--name', 'tetris']);
    const { worktree } = profileNames(main, 'spike', 'tetris');
    cli(worktree, ['start', '--profile', 'spike', '--name', 'tetris', '--hours', '2', '--session', 'coord-1']);
    const r = run(['swarm', 'start', '--project', 'tetris', '--session', 'coord', '--hook-session', 'coord-1'], { cwd: worktree, now: () => T0, env: {} });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('an execution inside an autonomous profile comes in a later version; run one task per cycle');
    expect(activeProfileAt(worktree)?.runId).toBe('spike-tetris');
    expect(activeProfileAt(path.join(worktree, 'src'))?.runId).toBe('spike-tetris');
    expect(activeProfileAt(main)).toBeNull();
    run(['stop'], { cwd: main, now: () => T0, env: {} });
    expect(activeProfileAt(worktree)).toBeNull();
  });
});
