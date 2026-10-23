import { describe, it, expect, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  TRUST_RULES, confinedIn, evaluateGuard, forgeCalls, guardOutput, guardPath, parseGuardInput, targetPath, type GuardCtx, type GuardRule, type GuardVerdict,
} from '../src/forge/guard.js';
import { run } from '../src/forge/cli/run.js';
import { guardCtx } from '../src/forge/cli/commands/hook.js';
import { useTempDirs } from './helpers/tmp.js';

const tmp = useTempDirs();
const M = path.resolve(os.tmpdir(), 'guard-main');
const G = path.join(M, '.git');
const CTX: GuardCtx = { main: M, gitCommonDir: G, autonomous: null };
const AUTH = path.join(M, '.forge', 'execution', 'auth', 'merge-shop-r1-ab12.json');
const TRUST = path.join(G, 'forge', 'trust.json');
const LOCAL = path.join(M, '.forge', 'local.yaml');
const file = (tool: string, p: string, cwd?: string, ctx = CTX) =>
  evaluateGuard({ tool_name: tool, tool_input: tool === 'NotebookEdit' ? { notebook_path: p, new_source: '' } : { file_path: p }, ...(cwd ? { cwd } : {}) }, ctx, TRUST_RULES);
const sh = (command: string, tool = 'Bash') => evaluateGuard({ tool_name: tool, tool_input: { command } }, CTX, TRUST_RULES);
const ruleOf = (v: GuardVerdict) => (v.decision === 'deny' ? v.rule : 'allow');

describe('the trust rules of the guard (D9)', () => {
  it("denies Edit, Write and NotebookEdit on an authorization, trust.json and .forge/local.yaml, naming the person's answer", () => {
    for (const tool of ['Edit', 'Write', 'NotebookEdit']) expect([AUTH, TRUST, LOCAL].map(p => ruleOf(file(tool, p))), tool).toEqual(['auth-records', 'trust-file', 'local-yaml']);
    expect(ruleOf(file('Write', path.join(M, '.claude', 'worktrees', 'w', '.forge', 'local.yaml')))).toBe('local-yaml');
    for (const p of [AUTH, TRUST, LOCAL]) expect((file('Write', p) as { reason: string }).reason, p).toContain("Only the person's answer");
  });
  it('lets through what only looks like them, a Read, an input without a path, and trust.json when git cannot say where it is (Review Focus 2)', () => {
    for (const p of [path.join(M, '.forge', 'execution', 'T1.json'), path.join(M, '.forge', 'execution', 'auth-notes.md'), path.join(M, '.forge', 'local.yaml.bak'),
      path.join(M, 'local.yaml'), path.join(M, 'forge', 'trust.json'), path.join(M, 'src', 'a.ts')]) expect(file('Write', p), p).toEqual({ decision: 'allow' });
    expect(file('Read', LOCAL)).toEqual({ decision: 'allow' });
    expect(evaluateGuard({ tool_name: 'Write', tool_input: {} }, CTX, TRUST_RULES)).toEqual({ decision: 'allow' });
    const noGit: GuardCtx = { ...CTX, gitCommonDir: null };
    expect(file('Write', TRUST, undefined, noGit)).toEqual({ decision: 'allow' });
    expect(ruleOf(file('Write', LOCAL, undefined, noGit))).toBe('local-yaml');
  });
  it('reads a path as it may be spelled: relative to the input cwd, with .., and on Windows in another case or with / (Review Focus 2)', () => {
    expect(ruleOf(file('Write', path.join('.forge', 'local.yaml'), M))).toBe('local-yaml');
    expect(ruleOf(file('Edit', path.join(M, '.forge', 'execution', 'auth', '..', 'auth', 'x.json')))).toBe('auth-records');
    const raw = (...parts: string[]) => parts.join(path.sep); // path.join would fold the .. before the guard sees it
    expect(ruleOf(file('Edit', raw(M, '.forge', 'execution', 'auth', '..', 'auth', 'x.json')))).toBe('auth-records');
    expect(file('Write', raw(M, '.forge', 'execution', 'auth', '..', 'T1.json'))).toEqual({ decision: 'allow' });
    expect(ruleOf(file('Write', path.join('.forge', 'execution', 'auth', 'x.json'), M))).toBe('auth-records');
    expect(ruleOf(file('Write', raw('..', '.forge', 'execution', 'auth', 'x.json'), path.join(M, 'src')))).toBe('auth-records');
    if (process.platform === 'win32') {
      expect(ruleOf(file('Edit', AUTH.toUpperCase()))).toBe('auth-records');
      expect(ruleOf(file('Write', TRUST.split(path.sep).join('/')))).toBe('trust-file');
      expect(ruleOf(file('Write', LOCAL.toUpperCase()))).toBe('local-yaml');
      // the spellings Windows reads as the same file: a \\?\ or \\.\ prefix, an NTFS stream, trailing dots and spaces
      expect(ruleOf(file('Edit', '\\\\?\\' + AUTH))).toBe('auth-records');
      expect(ruleOf(file('Write', TRUST + '::$DATA'))).toBe('trust-file');
      expect(ruleOf(file('Write', LOCAL + '::$DATA'))).toBe('local-yaml');
      expect(ruleOf(file('Write', '\\\\.\\' + LOCAL + ':x'))).toBe('local-yaml');
      expect(ruleOf(file('Write', LOCAL + '. '))).toBe('local-yaml');
      expect(ruleOf(file('Write', path.join(M, '.forge.', 'execution', 'auth', 'x.json')))).toBe('auth-records');
      expect(guardPath('\\\\?\\UNC\\srv\\share\\r\\.forge\\local.yaml')).toBe(guardPath('\\\\srv\\share\\r\\.forge\\local.yaml'));
    }
  });
  it('folds case where the file system usually ignores it: Windows and macOS, not Linux (guardPath)', () => {
    expect(guardPath(LOCAL.toUpperCase(), 'darwin')).toBe(guardPath(LOCAL, 'darwin'));
    expect(path.basename(guardPath(path.join(M, '.FORGE', 'Local.YAML'), 'darwin'))).toBe('local.yaml');
    expect(guardPath(LOCAL.toUpperCase(), 'linux')).not.toBe(guardPath(LOCAL, 'linux'));
  });
  it('NotebookEdit and Edit: a harmless path in one field hides no protected path in the other', () => {
    const both = (tool: string, file_path: string, notebook_path: string) =>
      evaluateGuard({ tool_name: tool, tool_input: { file_path, notebook_path, new_source: '' } }, CTX, TRUST_RULES);
    const harmless = path.join(M, 'src', 'a.ts');
    expect(ruleOf(both('NotebookEdit', harmless, LOCAL))).toBe('local-yaml');
    expect(ruleOf(both('Edit', harmless, AUTH))).toBe('auth-records');
    expect(targetPath({ tool_name: 'NotebookEdit', tool_input: { file_path: harmless, notebook_path: LOCAL } }, CTX)).toBe(LOCAL);
    expect(targetPath({ tool_name: 'Edit', tool_input: { file_path: harmless, notebook_path: LOCAL } }, CTX)).toBe(harmless);
  });
  it('reads ctx only for a path whose name can be protected, so a shell call or another file asks git nothing (H4)', () => {
    const lazy: GuardCtx = { get main(): string { throw new Error('main read'); }, get gitCommonDir(): string | null { throw new Error('gitCommonDir read'); }, autonomous: null };
    const shell = (command: string) => evaluateGuard({ tool_name: 'Bash', tool_input: { command } }, lazy, TRUST_RULES);
    expect(ruleOf(shell('node /p/dist/forge.cjs hook answer < a.json'))).toBe('hook-answer');
    expect(shell('ls')).toEqual({ decision: 'allow' });
    for (const p of [path.join(M, 'src', 'a.ts'), path.join(M, '.forge', 'execution', 'T1.json'), path.join(M, 'auth', 'x.json')]) expect(file('Write', p, M, lazy), p).toEqual({ decision: 'allow' });
    expect(ruleOf(file('Write', LOCAL, M, lazy))).toBe('local-yaml');
    expect(() => file('Write', AUTH, M, lazy)).toThrow('main read');
    expect(() => file('Write', TRUST, M, lazy)).toThrow('gitCommonDir read');
  });
  it('denies a Bash or PowerShell call that runs forge hook answer or local set commands, however forge is spelled (Review Focus 1)', () => {
    const cases: [string, string, string?][] = [
      ['node "C:/Program Files/claude/plugins/forge/dist/forge.cjs" hook answer < answer.json', 'hook-answer'],
      ["echo '{}' | node /home/u/.claude/plugins/cache/bg-kit/forge/0.27.0/dist/forge.cjs hook answer", 'hook-answer'],
      ['node /p/dist/forge.cjs --cwd wt local set commands allowed --expect abc', 'local-set-commands'],
      ["cd x && node.exe '/p/dist/forge.cjs' local   set commands none", 'local-set-commands'],
      ['& node "C:\\Users\\b\\forge\\dist\\forge.cjs" hook answer', 'hook-answer', 'PowerShell'],
      // forge's parser takes --cwd <dir> out wherever it sits, and a shell metacharacter ends a word
      ['node /p/forge.cjs local set --cwd wt commands allowed --expect h', 'local-set-commands'],
      ['node /p/forge.cjs local --cwd wt set commands allowed --expect h', 'local-set-commands'],
      ['node /p/forge.cjs local set --cwd "my wt" commands allowed --expect h', 'local-set-commands'],
      ['node /p/forge.cjs hook --cwd . answer < a.json', 'hook-answer'],
      ['node /p/forge.cjs hook answer<a.json', 'hook-answer'],
      ['node /p/forge.cjs hook answer>out.txt', 'hook-answer'],
      ['(node /p/forge.cjs hook answer)', 'hook-answer'],
      ['x=$(node /p/forge.cjs hook answer)', 'hook-answer'],
      ['`node /p/forge.cjs hook answer`', 'hook-answer'],
      ['& "node.exe" "C:\\x\\forge.cjs" hook answer', 'hook-answer', 'PowerShell'],
      ['& "C:\\Program Files\\nodejs\\node.exe" "C:\\x\\forge.cjs" local set commands allowed', 'local-set-commands', 'PowerShell'],
    ];
    for (const [command, id, tool] of cases) expect(ruleOf(sh(command, tool)), command).toBe(id);
  });
  it('a forge call ends at a separator and passes after any other character (6a N3)', () => {
    expect(ruleOf(sh('echo node /p/forge.cjs hook answer; true'))).toBe('hook-answer');
    expect(sh('echo node /p/forge.cjs hook answer, done')).toEqual({ decision: 'allow' });
  });
  it('lets through every other forge call and any text that only mentions them (Review Focus 1)', () => {
    for (const command of ['node /p/dist/forge.cjs local set surfaces.web allowed --expect h --cwd wt', 'node /p/dist/forge.cjs local get commands',
      'node /p/dist/forge.cjs hook live', 'grep -n "hook answer" src/forge/auth.ts', 'git commit -m "w6a 9: deny hook answer and local set commands"',
      "rg 'forge.cjs hook answer' README.md", 'npm test && echo local set commands', 'git commit -m "node /p/forge.cjs hook answer"',
      'node /p/forge.cjs local set surfaces.web allowed --cwd commands']) expect(sh(command), command).toEqual({ decision: 'allow' });
    expect(forgeCalls('a && node "/x y/forge.cjs" --cwd w hook answer | node /p/forge.cjs local get')).toEqual(['--cwd w hook answer', 'local get']);
  });
  it('evaluateGuard: the first deny wins, null does not apply, an allow stops nothing, no rule allows (the seam 6b-1 extends)', () => {
    const input = { tool_name: 'Bash', tool_input: { command: 'ls' } };
    const r = (id: string, v: GuardVerdict | null): GuardRule => ({ id, check: () => v });
    const deny = (id: string): GuardVerdict => ({ decision: 'deny', rule: id, reason: id });
    expect(evaluateGuard(input, CTX, [])).toEqual({ decision: 'allow' });
    expect(evaluateGuard(input, CTX, [r('a', null), r('b', { decision: 'allow' }), r('c', deny('c')), r('d', deny('d'))])).toEqual(deny('c'));
  });
  it('guardOutput prints the PreToolUse deny of Claude Code and nothing on allow; parseGuardInput keeps only a usable input', () => {
    expect(guardOutput({ decision: 'allow' })).toBe('');
    expect(JSON.parse(guardOutput({ decision: 'deny', rule: 'x', reason: 'why' })))
      .toEqual({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'why' } });
    for (const junk of [null, [], 'x', { tool_name: 'Write' }, { tool_name: 5, tool_input: {} }, { tool_name: 'Write', tool_input: [] }]) expect(parseGuardInput(junk), JSON.stringify(junk)).toBeNull();
    expect(parseGuardInput({ tool_name: 'Write', tool_input: { file_path: 'a' }, session_id: 's', cwd: 'c', hook_event_name: 'PreToolUse' }))
      .toEqual({ tool_name: 'Write', tool_input: { file_path: 'a' }, session_id: 's', cwd: 'c' });
  });
  it('confinedIn never folds a spelling toward inside (CARRY-1)', () => {
    const W = 'C:\\r\\.claude\\worktrees\\spike-x';
    for (const p of [`${W}\\src\\a.ts`, 'c:/R/.CLAUDE/worktrees/SPIKE-X/src/a.ts']) expect(confinedIn(p, W, 'win32'), p).toBe(true);
    for (const p of [`\\\\?\\${W}.\\a.ts`, `\\\\?\\${W} \\a.ts`, `\\\\.\\${W}\\a.ts`, `${W}:s\\a.ts`, `${W}.\\a.ts`, `${W}2\\a.ts`, `${W}\\..\\x`, `e:${W.slice(2)}\\a.ts`])
      expect(confinedIn(p, W, 'win32'), p).toBe(false);
    // NTFS folds ASCII letters only: the Kelvin sign is not a K there, though toLowerCase makes it one.
    expect(confinedIn(`C:\\wor${String.fromCharCode(0x212A)}\\wt\\spike-x\\a`, 'C:\\work\\wt\\spike-x', 'win32')).toBe(false);
    const P = '/u/r/.claude/worktrees/spike-x';
    expect(confinedIn(`${P}/src/a.ts`, P, 'linux')).toBe(true);
    expect(confinedIn('/u/r/.claude/worktrees/SPIKE-X/a', P, 'darwin')).toBe(false);
    expect(confinedIn('/u/r/.claude/worktrees/spike-x2\\..\\spike-x\\a', P, 'linux')).toBe(false);
  });
});

describe('forge hook guard (D9)', () => {
  const SILENT = { code: 0, stdout: '', stderr: '' };
  const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8' });
  let root: string;
  beforeEach(() => { root = tmp('forge-guard-'); git(root, 'init', '-q', '-b', 'main'); });
  const guard = (stdin: unknown, cwd = root) =>
    run(['hook', 'guard'], { cwd, now: () => new Date('2026-10-22T10:00:00.000Z'), env: {}, stdin: typeof stdin === 'string' ? stdin : JSON.stringify(stdin) });
  const pre = (tool_name: string, tool_input: Record<string, unknown>, cwd = root) =>
    ({ session_id: 's1', transcript_path: 't.jsonl', cwd, permission_mode: 'default', hook_event_name: 'PreToolUse', tool_name, tool_input, tool_use_id: 'toolu_1' });
  const denied = (r: { code: number; stdout: string; stderr: string }) => {
    expect(r.code).toBe(0);
    expect(r.stderr).toBe('');
    return JSON.parse(r.stdout).hookSpecificOutput as { hookEventName: string; permissionDecision: string; permissionDecisionReason: string };
  };
  it('prints the PreToolUse deny for a write of an authorization, of trust.json or of local.yaml, also from a worktree', () => {
    for (const p of [path.join(root, '.forge', 'execution', 'auth', 'merge-x.json'), path.join(root, '.git', 'forge', 'trust.json'), path.join(root, '.forge', 'local.yaml')]) {
      expect(denied(guard(pre('Write', { file_path: p, content: '{}' }))), p).toMatchObject({ hookEventName: 'PreToolUse', permissionDecision: 'deny' });
    }
    writeFileSync(path.join(root, 'a.txt'), 'a');
    git(root, 'add', 'a.txt');
    git(root, 'commit', '-q', '-m', 'a');
    const wt = path.join(root, '.claude', 'worktrees', 'w');
    git(root, 'worktree', 'add', '-q', '-b', 'w', wt);
    expect(denied(guard(pre('Edit', { file_path: path.join(root, '.forge', 'execution', 'auth', 'm.json'), old_string: 'a', new_string: 'b' }, wt), wt)).permissionDecision).toBe('deny');
    expect(denied(guard(pre('Write', { file_path: path.join(root, '.git', 'forge', 'trust.json'), content: '' }, wt), wt)).permissionDecision).toBe('deny');
  });
  it('guardCtx answers main and gitCommonDir through lazy getters, so a call that meets no protected name starts no git process (H4)', () => {
    const io = { cwd: root, now: () => new Date('2026-10-22T10:00:00.000Z'), env: {}, stdin: '' } as unknown as Parameters<typeof guardCtx>[0];
    const ctx = guardCtx(io, { tool_name: 'Bash', tool_input: { command: 'ls' } });
    for (const key of ['main', 'gitCommonDir'] as const) expect(typeof Object.getOwnPropertyDescriptor(ctx, key)?.get, key).toBe('function');
    expect(Object.getOwnPropertyDescriptor(ctx, 'autonomous')).toMatchObject({ value: null });
  });
  it('judges a protected file by its own repository when CLAUDE_PROJECT_DIR points outside it (CARRY-5)', () => {
    const r = run(['hook', 'guard'], { cwd: root, now: () => new Date('2026-10-22T10:00:00.000Z'), env: { CLAUDE_PROJECT_DIR: tmp('outside-') },
      stdin: JSON.stringify(pre('Write', { file_path: path.join(root, '.forge', 'execution', 'auth', 'm.json'), content: '{}' })) });
    expect(denied(r).permissionDecision).toBe('deny');
  });
  it('denies a Bash call to hook answer and lets local set surfaces through', () => {
    expect(denied(guard(pre('Bash', { command: 'node /p/dist/forge.cjs hook answer < a.json', description: 'x' }))).permissionDecisionReason).toContain("Only the person's answer");
    expect(guard(pre('Bash', { command: 'node /p/dist/forge.cjs local set surfaces.web allowed --expect h' }))).toEqual(SILENT);
  });
  it('prints nothing for anything else, and fails open: another file, a Read, junk stdin, no tool_input, outside git (Review Focus 3)', () => {
    expect(guard(pre('Write', { file_path: path.join(root, 'src', 'a.ts'), content: '' }))).toEqual(SILENT);
    expect(guard(pre('Read', { file_path: path.join(root, '.forge', 'local.yaml') }))).toEqual(SILENT);
    for (const junk of ['not json', '', { tool_name: 'Write' }]) expect(guard(junk), JSON.stringify(junk)).toEqual(SILENT);
    const plain = tmp('forge-guard-plain-');
    expect(denied(guard(pre('Write', { file_path: path.join(plain, '.forge', 'local.yaml'), content: '' }, plain), plain)).permissionDecision).toBe('deny');
    expect(guard(pre('Write', { file_path: path.join(plain, '.git', 'forge', 'trust.json'), content: '' }, plain), plain)).toEqual(SILENT);
  });
});
