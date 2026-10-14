import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, appendFileSync, unlinkSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run, defaultGit, type Io } from '../src/forge/cli/run.js';
import { restoringRegenerated } from '../src/forge/cli/swarm.js';

let root: string;
let io: Io;
const g = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
const git = (...a: string[]) => g(root, ...a);
// A validator that rewrites the tracked gen.txt, as a build that regenerates its committed bundle does.
const GEN = 'validators:\n  - name: gen\n    cmd: node -e "require(\'fs\').writeFileSync(\'gen.txt\',String(Date.now()))"\n';

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'forge-regen-'));
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 'a@b.c'); git('config', 'user.name', 't'); git('config', 'core.autocrlf', 'false');
  writeFileSync(path.join(root, '.gitignore'), '.forge/\n.claude/\n');
  writeFileSync(path.join(root, 'gen.txt'), 'committed\n');
  writeFileSync(path.join(root, 'other.txt'), 'other\n');
  writeFileSync(path.join(root, 'del.txt'), 'del\n');
  git('add', '.gitignore', 'gen.txt', 'other.txt', 'del.txt'); git('commit', '-qm', 'init');
  io = { cwd: root, now: () => new Date('2026-10-14T12:00:00.000Z'), git: defaultGit(root) };
});
afterEach(() => { try { git('worktree', 'prune'); } catch { /* ignore */ } rmSync(root, { recursive: true, force: true }); });

describe('restoringRegenerated', () => {
  it('puts back the tracked files the run modified or deleted, never one already modified before it nor an untracked one', () => {
    appendFileSync(path.join(root, 'other.txt'), 'mine\n');
    const into: string[] = [];
    const value = restoringRegenerated({ git: defaultGit(root) }, () => {
      writeFileSync(path.join(root, 'gen.txt'), 'regenerated\n');
      appendFileSync(path.join(root, 'other.txt'), 'theirs\n');
      unlinkSync(path.join(root, 'del.txt'));
      writeFileSync(path.join(root, 'new.txt'), 'n\n');
      return 7;
    }, into);
    expect(value).toBe(7);
    expect(into.sort()).toEqual(['del.txt', 'gen.txt']);
    expect(readFileSync(path.join(root, 'gen.txt'), 'utf8')).toBe('committed\n');
    expect(readFileSync(path.join(root, 'del.txt'), 'utf8')).toBe('del\n');
    expect(readFileSync(path.join(root, 'other.txt'), 'utf8')).toBe('other\nmine\ntheirs\n');
    expect(existsSync(path.join(root, 'new.txt'))).toBe(true);
  });
  it('restores even when the run throws', () => {
    const into: string[] = [];
    expect(() => restoringRegenerated({ git: defaultGit(root) }, () => { writeFileSync(path.join(root, 'gen.txt'), 'x\n'); throw new Error('boom'); }, into)).toThrow('boom');
    expect(into).toEqual(['gen.txt']);
    expect(git('status', '--porcelain')).toBe('');
  });
});

describe('forge validate --cwd', () => {
  const worktree = (name: string, branch: string) => {
    const dir = path.join(root, '.claude', 'worktrees', name);
    git('worktree', 'add', '-q', '-b', branch, dir);
    mkdirSync(path.join(dir, '.forge'), { recursive: true });
    writeFileSync(path.join(dir, '.forge', 'config.yaml'), GEN);
    return dir;
  };
  it('in the run worktree puts back the tracked files the validators regenerated and says so on stderr', () => {
    const wt = worktree('run', 'forge/run-shop');
    const r = run(['validate', '--cwd', '.claude/worktrees/run'], io);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject([{ validator: 'gen', ok: true }]);
    expect(r.stderr).toBe('restored 1 tracked file(s) the validators regenerated: gen.txt\n');
    expect(g(wt, 'status', '--porcelain')).toBe('');
  });
  it('in any other directory restores nothing', () => {
    const wt = worktree('task-T1', 'task/T1');
    const r = run(['validate', '--cwd', wt], io);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe('');
    expect(g(wt, 'status', '--porcelain')).toBe('M gen.txt');
  });
});
