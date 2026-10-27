import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  styleOfSubjects, commitStyleSetting, resolveCommitStyle, commitStyleAt, briefCommitLine, forgeCommitTitle,
  taskCommitTitle, integratedTaskOf, HISTORY_SPAN,
} from '../src/lib/commit-style.js';
import { useTempDirs } from './helpers/tmp.js';

const tmp = useTempDirs();

const conv = ['feat: add the cart', 'fix(api): a 500 on an empty order', 'docs: the README', 'refactor!: the store', 'chore(deps): bump vite'];
const plain = ['w8: forge 0.32.0', 'zod 4: drop zod 3', 'CI: the Windows rows', 'T3: the login form', 'Update the README'];

describe('w9: the style a repository uses for its commits', () => {
  it('reads Conventional Commits from 60 % of the subjects, and nothing from fewer than three', () => {
    expect(styleOfSubjects(conv)).toBe('conventional');
    expect(styleOfSubjects([...conv.slice(0, 3), ...plain.slice(0, 2)])).toBe('conventional');
    expect(styleOfSubjects([...conv.slice(0, 2), ...plain.slice(0, 3)])).toBe('plain');
    // A new repository: its first commit and forge's first two, which must not settle the style by themselves.
    expect(styleOfSubjects(['Initial commit', 'feat(T1): a', 'feat(T2): b'])).toBe('conventional');
    expect(styleOfSubjects(['Initial commit', 'T1: a', 'T2: b'])).toBe('plain');
    expect(styleOfSubjects(conv.slice(0, 2))).toBeNull();
    expect(styleOfSubjects([])).toBeNull();
  });

  it('takes only the standard types, so a prefix of the project\'s own is not a type', () => {
    expect(styleOfSubjects(plain)).toBe('plain');
    expect(styleOfSubjects(['w8: a', 'w9: b', 'api: c', 'fixes: d'])).toBe('plain');
    expect(styleOfSubjects(['Feat: a', 'FIX: b', 'Docs: c'])).toBe('plain');
    expect(styleOfSubjects(['feat:missing space', 'fix(): empty scope', 'docs(a)(b): two scopes'])).toBe('plain');
    expect(styleOfSubjects(['perf(T3): a', 'test: b', 'build: c', 'ci: d', 'style: e', 'revert: f'])).toBe('conventional');
  });

  it('reads commits.style of .forge/config.yaml leniently: anything else is auto', () => {
    const root = tmp('cstyle-');
    expect(commitStyleSetting(root)).toBeNull();
    mkdirSync(path.join(root, '.forge'));
    const set = (text: string) => writeFileSync(path.join(root, '.forge', 'config.yaml'), text);
    set('commits:\n  style: conventional\n');
    expect(commitStyleSetting(root)).toBe('conventional');
    set('commits: { style: plain }\nprofile: economy\n');
    expect(commitStyleSetting(root)).toBe('plain');
    for (const bad of ['commits: { style: angular }\n', 'commits: plain\n', ': [\n', 'profile: economy\n', '- a\n']) {
      set(bad);
      expect(commitStyleSetting(root), bad).toBeNull();
    }
  });

  it('puts the setting before the history, and reads the history of HEAD without merges', () => {
    const calls: string[][] = [];
    const git = (subjects: string[] | null) => (args: string[]) => { calls.push(args); return subjects === null ? null : subjects.join('\n') + '\n'; };
    expect(resolveCommitStyle('plain', git(conv))).toEqual({ style: 'plain', source: 'config' });
    expect(resolveCommitStyle('conventional', git(plain))).toEqual({ style: 'conventional', source: 'config' });
    expect(calls).toEqual([]);
    expect(resolveCommitStyle('auto', git(conv))).toEqual({ style: 'conventional', source: 'history' });
    expect(resolveCommitStyle(null, git(plain))).toEqual({ style: 'plain', source: 'history' });
    // Too short a history: FORGE_COMMIT_STYLE says it, else plain; the env never overrides a history that decides.
    expect(resolveCommitStyle(undefined, git(null), {})).toEqual({ style: 'plain', source: 'default' });
    expect(resolveCommitStyle('auto', git(['Initial commit']), { FORGE_COMMIT_STYLE: 'conventional' })).toEqual({ style: 'conventional', source: 'env' });
    expect(resolveCommitStyle(null, git([]), { FORGE_COMMIT_STYLE: 'plain' })).toEqual({ style: 'plain', source: 'env' });
    expect(resolveCommitStyle(null, git([]), { FORGE_COMMIT_STYLE: 'angular' })).toEqual({ style: 'plain', source: 'default' });
    expect(resolveCommitStyle(null, git(plain), { FORGE_COMMIT_STYLE: 'conventional' })).toEqual({ style: 'plain', source: 'history' });
    expect(resolveCommitStyle('plain', git([]), { FORGE_COMMIT_STYLE: 'conventional' })).toEqual({ style: 'plain', source: 'config' });
    expect(calls[0]).toEqual(['log', '-n', String(HISTORY_SPAN), '--no-merges', '--format=%s', 'HEAD']);
  });

  it('commitStyleAt reads the root\'s config and then its history', () => {
    const root = tmp('cstyle-');
    expect(commitStyleAt(root, () => conv.join('\n'))).toEqual({ style: 'conventional', source: 'history' });
    mkdirSync(path.join(root, '.forge'));
    writeFileSync(path.join(root, '.forge', 'config.yaml'), 'commits:\n  style: plain\n');
    expect(commitStyleAt(root, () => conv.join('\n'))).toEqual({ style: 'plain', source: 'config' });
  });
});

describe('w9: the titles in each style', () => {
  it('a brief\'s Commit title line, with the plan task as the scope', () => {
    expect(briefCommitLine('plain', 'T3')).toBe('Commit title: T3: <what the commit does>');
    expect(briefCommitLine('conventional', 'T3')).toBe('Commit title: <type>(T3): <what the commit does>, in Conventional Commits as this repository writes them (<type>: feat, fix, refactor, perf, test, docs, build, ci or chore)');
    expect(briefCommitLine('conventional', null)).toBe('Commit title: <type>: <what the commit does>, in Conventional Commits as this repository writes them (<type>: feat, fix, refactor, perf, test, docs, build, ci or chore)');
    expect(briefCommitLine('plain', null)).toBe("Commit title: <what the commit does>, in the style of this repository's recent commits (git log --oneline -10)");
  });

  it('forge\'s own commits', () => {
    expect(forgeCommitTitle('plain', { kind: 'integrate', task: 'T3' })).toBe('forge: integrate T3');
    // Read back in either style (a run's flow passes and the step's lost integration), and only that title.
    for (const st of ['plain', 'conventional'] as const) expect(integratedTaskOf(forgeCommitTitle(st, { kind: 'integrate', task: 'T3' }))).toBe('T3');
    for (const other of ['forge: merge forge/run-shop', 'feat(T3): integrate T3', 'chore(T3): integrate T3', 'Merge branch x']) expect(integratedTaskOf(other)).toBeNull();
    expect(forgeCommitTitle('conventional', { kind: 'integrate', task: 'T3' })).toBe('chore(forge): integrate T3');
    expect(forgeCommitTitle('plain', { kind: 'merge', branch: 'forge/run-shop' })).toBe('forge: merge forge/run-shop');
    expect(forgeCommitTitle('conventional', { kind: 'merge', branch: 'forge/run-shop' })).toBe('chore(forge): merge forge/run-shop');
    expect(forgeCommitTitle('plain', { kind: 'bring', base: 'main', branch: 'forge/run-shop' })).toBe('forge: bring main into forge/run-shop');
    expect(forgeCommitTitle('conventional', { kind: 'bring', base: 'main', branch: 'forge/run-shop' })).toBe('chore(forge): bring main into forge/run-shop');
    expect(forgeCommitTitle('plain', { kind: 'notes', task: 'T3' })).toBe('T3: learned notes of its verification');
    expect(forgeCommitTitle('conventional', { kind: 'notes', task: 'T3' })).toBe('chore(T3): learned notes of its verification');
    expect(forgeCommitTitle('plain', { kind: 'undo', task: 'T3', tree: 'abcdef012345' })).toBe('T3: undo the attempt for a redo (back to the tree of abcdef012345)');
    expect(forgeCommitTitle('conventional', { kind: 'undo', task: 'T3', tree: 'abcdef012345' })).toBe('revert(T3): undo the attempt for a redo (back to the tree of abcdef012345)');
  });

  it("a waypoint task's commit, its type left to the session", () => {
    expect(taskCommitTitle('plain', 'T3', 'Login form')).toBe('T3: Login form');
    expect(taskCommitTitle('conventional', 'T3', 'Login form')).toBe('<type>(T3): login form');
    // Only a capital that starts a word in lower case goes down: an acronym stays.
    expect(taskCommitTitle('conventional', 'T2', 'API de pedidos')).toBe('<type>(T2): API de pedidos');
    expect(taskCommitTitle('conventional', 'T1', 'Índice de pedidos')).toBe('<type>(T1): índice de pedidos');
  });
});
