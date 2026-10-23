import { describe, it, expect, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { run } from '../src/forge/cli/run.js';
import { startRun, saveRun, runFile } from '../src/forge/run.js';
import { readBlocked, judgeGuard, runMainsOf, redactSecrets, GUARD_ERROR } from '../src/forge/autonomous.js';
import { CTX, ATTENDED, bash } from './helpers/autonomy.js';
import { useTempDirs } from './helpers/tmp.js';

const tmp = useTempDirs();
const T0 = new Date('2026-10-22T10:00:00.000Z');
let main: string, wt: string;
const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8' });
const hook = (input: Record<string, unknown>, env: Record<string, string> = {}) =>
  run(['hook', 'guard'], { cwd: main, now: () => T0, env, stdin: JSON.stringify({ hook_event_name: 'PreToolUse', ...input }) });
const guard = (input: Record<string, unknown>, env: Record<string, string> = {}) => {
  const r = hook(input, env);
  expect(r.code).toBe(0);
  return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput : null;
};
const block = { profile: 'spike', name: 'x', runId: 'spike-x', branch: 'forge/spike-x', startBranch: 'main', protectedBranches: ['main'] } as const;
const autonomous = (active = true) => saveRun(main, { ...startRun(T0, { hours: 1 }, 10, 'coord-1'), active, autonomous: { ...block, protectedBranches: [...block.protectedBranches], worktree: wt } });
const push = { session_id: 'coord-1', tool_name: 'Bash', tool_input: { command: 'git push origin forge/spike-x' } };
beforeEach(() => {
  main = tmp('guard-');
  git(main, 'init', '-q', '-b', 'main');
  writeFileSync(path.join(main, 'a.txt'), 'a');
  git(main, 'add', 'a.txt');
  git(main, 'commit', '-q', '-m', 'a');
  wt = path.join(main, '.claude', 'worktrees', 'spike-x');
  git(main, 'worktree', 'add', '-q', '-b', 'forge/spike-x', wt);
  mkdirSync(path.join(main, '.forge'), { recursive: true });
});

describe('hook guard in an autonomous run', () => {
  it('denies the run\'s session what the autonomy rules deny, with the rule in the reason, and records it', () => {
    autonomous();
    const out = guard({ ...push, cwd: wt });
    expect(out).toMatchObject({ hookEventName: 'PreToolUse', permissionDecision: 'deny' });
    expect(out.permissionDecisionReason).toMatch(/^forge autonomy · git: /);
    expect(readBlocked(main, 'spike-x')).toEqual([{ ts: T0.toISOString(), rule: 'git', tool: 'Bash', target: 'git push origin forge/spike-x', reason: out.permissionDecisionReason, session: 'coord-1' }]);
  });
  it('lets the run do what it may, and records nothing', () => {
    autonomous();
    expect(guard({ session_id: 'coord-1', cwd: wt, tool_name: 'Write', tool_input: { file_path: path.join(wt, 'a.ts'), content: 'x' } })).toBeNull();
    expect(readBlocked(main, 'spike-x')).toEqual([]);
  });
  it('an attended session of the same clone keeps 6a\'s rules only', () => {
    autonomous();
    expect(guard({ session_id: 'person', cwd: main, tool_name: 'Bash', tool_input: { command: 'git push' } })).toBeNull();
    expect(guard({ session_id: 'person', cwd: main, tool_name: 'mcp__github__createIssue', tool_input: {} })).toBeNull();
  });
  it('fails closed for the coordinator when the autonomous block does not read', () => {
    writeFileSync(runFile(main), JSON.stringify({ ...startRun(T0, { hours: 1 }, 10, 'coord-1'), autonomous: { profile: 'nope' } }));
    expect(guard({ session_id: 'coord-1', cwd: wt, tool_name: 'Edit', tool_input: { file_path: path.join(wt, 'a.ts'), old_string: 'a', new_string: 'b' } }))
      .toMatchObject({ permissionDecision: 'deny' });
  });
  it('fails closed for a session sessions.json names when run.json does not read, wherever its cwd (H-1, T3-TORN-RUN)', () => {
    const cli = (cwd: string, args: string[]) => run(['infinite', ...args], { cwd, now: () => T0, env: {} });
    expect(cli(main, ['prepare', '--profile', 'spike', '--name', 'x']).code).toBe(0);
    expect(cli(wt, ['start', '--profile', 'spike', '--name', 'x', '--hours', '1', '--session', 'coord-1']).code).toBe(0);
    // run.json as a folder: it exists and every read of it fails, as in the Windows rename window of saveRun
    rmSync(runFile(main));
    mkdirSync(runFile(main));
    const ls = { tool_name: 'Bash', tool_input: { command: 'ls' } };
    expect(guard({ session_id: 'coord-1', cwd: main, ...ls })).toMatchObject({ permissionDecision: 'deny' });
    expect(guard({ session_id: 'person', cwd: main, ...ls })).toBeNull();
  });
  it('without any run, a session keeps 6a\'s behaviour', () => {
    expect(guard({ ...push, cwd: wt })).toBeNull();
  });
  it('keeps the rules for the run\'s sessions once the run is inactive, and lets them stop it while the guard stays on (H2, STOP-ALLOWED)', () => {
    autonomous(false);
    expect(guard({ ...push, cwd: wt })).toMatchObject({ permissionDecision: 'deny' });
    autonomous();
    expect(guard({ session_id: 'coord-1', cwd: wt, tool_name: 'Bash', tool_input: { command: 'node /p/forge.cjs stop' } })).toBeNull();
    expect(run(['stop'], { cwd: main, now: () => T0, env: {} }).code).toBe(0);
    expect(guard({ session_id: 'coord-1', cwd: wt, tool_name: 'Edit', tool_input: { file_path: path.join(main, 'a.txt'), old_string: 'a', new_string: 'b' } }))
      .toMatchObject({ permissionDecision: 'deny' });
    expect(guard({ session_id: 'coord-1', cwd: wt, tool_name: 'Bash', tool_input: { command: 'node /p/forge.cjs infinite start --hours 2 --session s' } }).permissionDecisionReason)
      .toMatch(/^forge autonomy · self: /);
  });
  it('finds the run from the session\'s cwd when CLAUDE_PROJECT_DIR is outside the repository or in another one (H1, CARRY-5)', () => {
    autonomous();
    expect(guard({ ...push, cwd: wt }, { CLAUDE_PROJECT_DIR: tmp('outside-') })).toMatchObject({ permissionDecision: 'deny' });
    const other = tmp('other-');
    saveRun(other, startRun(T0, { hours: 1 }, 10, 'someone'));
    expect(guard({ ...push, cwd: wt }, { CLAUDE_PROJECT_DIR: other })).toMatchObject({ permissionDecision: 'deny' });
  });
  it('records a denial without its secrets (M7)', () => {
    autonomous();
    guard({ session_id: 'coord-1', cwd: wt, tool_name: 'Bash', tool_input: { command: 'psql postgres://u:hunter2@db.example.com/x -c "drop table t"' } });
    const [r] = readBlocked(main, 'spike-x');
    expect(r.rule).toBe('database');
    expect(JSON.stringify(r)).not.toContain('hunter2');
  });
  it('redacts the command before it cuts it to 300 characters (I1)', () => {
    autonomous();
    const command = 'echo ' + 'a'.repeat(268) + '; psql postgres://u:hunter2@db.example.com/x -c "drop table t"';
    guard({ session_id: 'coord-1', cwd: wt, tool_name: 'Bash', tool_input: { command } });
    const [r] = readBlocked(main, 'spike-x');
    expect(r.target).toContain('postgres://u:***');
    expect(JSON.stringify(r)).not.toContain('hunter2');
  });
  it('records an MCP tool by its name, whatever its input holds', () => {
    autonomous();
    guard({ session_id: 'coord-1', cwd: wt, tool_name: 'mcp__github__createIssue', tool_input: { title: 'x', file_path: 'notes.md' } });
    expect(readBlocked(main, 'spike-x').map(r => [r.rule, r.target])).toEqual([['mcp-write', 'mcp__github__createIssue']]);
  });
  it('an autonomous block that does not read denies every call with its own reason, and lets FORGE stop through (T7-INVALID-RUN-REASON)', () => {
    writeFileSync(runFile(main), JSON.stringify({ ...startRun(T0, { hours: 1 }, 10, 'coord-1'), autonomous: { profile: 'nope' } }));
    const reasons = [
      guard({ session_id: 'coord-1', cwd: wt, tool_name: 'Bash', tool_input: { command: 'ls' } }),
      guard({ session_id: 'coord-1', cwd: wt, tool_name: 'mcp__github__getIssue', tool_input: {} }),
    ].map(o => o.permissionDecisionReason);
    for (const reason of reasons) expect(reason).toMatch(/^forge autonomy · guard-error: the autonomous block of \.forge\/run\.json does not read/);
    expect(guard({ session_id: 'coord-1', cwd: wt, tool_name: 'Bash', tool_input: { command: 'node /p/forge.cjs stop' } })).toBeNull();
    expect(guard({ session_id: 'coord-1', cwd: wt, tool_name: 'Bash', tool_input: { command: 'node /p/forge.cjs stop; rm -rf x' } })).toMatchObject({ permissionDecision: 'deny' });
    for (const flags of ['--require=/x.js', '-r /x.js', '--import /x.mjs', '--eval 1', '-e 1']) {
      expect(guard({ session_id: 'coord-1', cwd: wt, tool_name: 'Bash', tool_input: { command: `node ${flags} /p/forge.cjs stop` } }), flags).toMatchObject({ permissionDecision: 'deny' });
    }
  });
  it('a denial it cannot record still denies, and says so on stderr (M17)', () => {
    autonomous();
    writeFileSync(path.join(main, '.forge', 'autonomous'), 'not a folder');
    const r = hook({ ...push, cwd: wt });
    expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
    expect(r.stderr).toMatch(/^forge guard: could not record the denial \(/);
  });
});

describe('runMainsOf', () => {
  it('walks up to every .forge/run.json without git, the nearest first', () => {
    const root = tmp('walk-');
    saveRun(root, startRun(T0, { hours: 1 }, 10, 's'));
    const deep = path.join(root, '.claude', 'worktrees', 'spike-x', 'src');
    mkdirSync(deep, { recursive: true });
    expect(runMainsOf([deep])).toEqual([root]);
    expect(runMainsOf([deep, root])).toEqual([root]);
    expect(runMainsOf([tmp('none-')])).toEqual([]);
  });
});

describe('judgeGuard and redactSecrets', () => {
  const boom = [{ id: 'boom', check: () => { throw new Error('x'); } }];
  it('denies when a rule throws in an autonomous run, and rethrows otherwise', () => {
    expect(judgeGuard(bash('ls'), CTX, boom)).toMatchObject({ decision: 'deny', rule: GUARD_ERROR });
    expect(() => judgeGuard(bash('ls'), ATTENDED, boom)).toThrow('x');
  });
  it('blanks passwords, tokens and credentials in URLs (M7)', () => {
    const s = redactSecrets('psql postgres://u:hunter2@h/x -c x; mysql -psecret1; PGPASSWORD=pw2 GITHUB_TOKEN=ghp_abc123 curl -H "Authorization: Bearer tok3" sk-live9');
    for (const w of ['hunter2', 'secret1', 'pw2', 'ghp_abc123', 'tok3', 'sk-live9']) expect(s, w).not.toContain(w);
    expect(s).toContain('postgres://u:***@h/x');
  });
  it.each([
    `mysql -u root -p'hunter2' db`, `mysql -u root -p"hunter2" db`, `mysql "-phunter2" db`, `mysql '-phunter2' db`, `mysql -h db -u root -phunter2`,
    `mysqldump --password=hunter2 db`, `mysqldump --password hunter2 db`, `mysqldump --password="hunter2 x" db`, `tool --PASSWORD=hunter2`,
    `curl -H 'Cookie: sid=hunter2' https://x`, `curl -H Authorization:hunter2 https://x`, `curl -H "Authorization: Bearer hunter2" x`,
    `MYSQL_PWD=hunter2 mysql`, `export AWS_SECRET_ACCESS_KEY=hunter2`, `CLIENT_SECRET='hunter2 x' node a`,
    `$env:GITHUB_TOKEN = "hunter2"`, `$env:GITHUB_TOKEN="hunter2"`, `$env:PGPASSWORD='hunter2'; psql`, `$env:API_KEY = hunter2`, `$env:SOME_SECRET = 'hunter2'`, `$env:MYSQL_PWD = "hunter2"`,
    `mongosh mongodb+srv://u:hunter2@h/db`, `curl -d token=xoxb-123-hunter2`, `git clone https://github_pat_hunter2@github.com/a/b`,
    `aws configure set aws_access_key_id AKIAHUNTER2`, `OPENAI=sk-proj-hunter2 node a`, `git remote add o https://x:ghp_hunter2@github.com/a`,
  ])('redacts %s', command => {
    expect(redactSecrets(command)).not.toContain('hunter2');
  });
  it('leaves a command without secrets alone', () => {
    expect(redactSecrets('mkdir -p out && ls -p')).toBe('mkdir -p out && ls -p');
  });
});
