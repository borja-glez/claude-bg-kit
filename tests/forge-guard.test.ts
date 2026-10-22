import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import {
  TRUST_RULES, evaluateGuard, forgeCalls, guardOutput, guardPath, parseGuardInput, targetPath, type GuardCtx, type GuardRule, type GuardVerdict,
} from '../src/forge/guard.js';

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
    ];
    for (const [command, id, tool] of cases) expect(ruleOf(sh(command, tool)), command).toBe(id);
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
});
