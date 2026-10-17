import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { copyTree, evidenceOf, keepEvidence, EVIDENCE_FILES_MAX } from '../src/forge/evidence-copy.js';

const dirs = () => ({ from: mkdtempSync(path.join(tmpdir(), 'forge-ev-from-')), to: mkdtempSync(path.join(tmpdir(), 'forge-ev-to-')) });
const outsideDir = () => mkdtempSync(path.join(tmpdir(), 'forge-ev-out-'));

// A forge task worktree as ledgerRoot tells one, without git: <main>/.claude/worktrees/task-T1 whose .git file points
// into <main>/.git/worktrees.
const taskWorktree = () => {
  const main = mkdtempSync(path.join(tmpdir(), 'forge-ev-main-'));
  const wt = path.join(main, '.claude', 'worktrees', 'task-T1');
  mkdirSync(wt, { recursive: true });
  writeFileSync(path.join(wt, '.git'), `gitdir: ${path.join(main, '.git', 'worktrees', 'task-T1').split(path.sep).join('/')}\n`);
  return { main, wt };
};

describe('copyTree (K2-04)', () => {
  it('copies files and folders to the same paths, in path order, up to the cap, and names what does not fit', () => {
    const { from, to } = dirs();
    mkdirSync(path.join(from, 'e', 'sub'), { recursive: true });
    writeFileSync(path.join(from, 'e', 'a.png'), '123456');
    writeFileSync(path.join(from, 'e', 'sub', 'b.png'), '123456');
    writeFileSync(path.join(from, 'v.json'), '{}');
    expect(copyTree(from, to, ['v.json', 'e'], { max: 10 })).toEqual({ copied: ['v.json', 'e/a.png'], bytes: 8, skipped: ['e/sub/b.png'] });
    expect(readFileSync(path.join(to, 'e', 'a.png'), 'utf8')).toBe('123456');
  });
  it('never leaves `from`, and with missingOnly keeps what `to` already has', () => {
    const { from, to } = dirs();
    writeFileSync(path.join(from, 'v.json'), '{}');
    expect(copyTree(from, to, ['../x', path.resolve(from, '..'), '']).copied).toEqual([]);
    writeFileSync(path.join(to, 'v.json'), 'mine');
    expect(copyTree(from, to, ['v.json'], { missingOnly: true }).copied).toEqual([]);
    expect(readFileSync(path.join(to, 'v.json'), 'utf8')).toBe('mine');
  });
  it('never follows a link', () => {
    const { from, to } = dirs();
    const outside = mkdtempSync(path.join(tmpdir(), 'forge-ev-out-'));
    writeFileSync(path.join(outside, 'secret.txt'), 's');
    try { symlinkSync(path.join(outside, 'secret.txt'), path.join(from, 'link.txt')); } catch { return; /* no symlinks here (Windows without the privilege) */ }
    expect(copyTree(from, to, ['link.txt']).copied).toEqual([]);
  });
  it('keepEvidence copies nothing outside a forge task worktree', () => {
    const { from } = dirs();
    expect(keepEvidence(from, '.forge/work/shop/T1/reviews-1-1')).toEqual({ skipped: [] });
  });

  it('refuses a path with a `..` part, an absolute path and a drive path, even one that lands inside `from`', () => {
    const { from, to } = dirs();
    mkdirSync(path.join(from, 'a'));
    writeFileSync(path.join(from, 'v.json'), '{}');
    writeFileSync(path.join(from, 'a', 'w.json'), '{}');
    expect(copyTree(from, to, ['a/../v.json', 'a\\..\\v.json', '..', path.join(from, 'v.json'), path.join(from, 'a'), 'C:v.json', '/v.json'])).toEqual({ copied: [], bytes: 0, skipped: [] });
    expect(readdirSync(to)).toEqual([]);
    // `.` parts and either separator are fine.
    expect(copyTree(from, to, ['./a\\w.json']).copied).toEqual(['a/w.json']);
  });
  it('never goes through a junction or a linked folder: neither inside a folder it copies nor on the way to a path', () => {
    const { from, to } = dirs();
    const outside = outsideDir();
    writeFileSync(path.join(outside, 'secret.txt'), 's');
    mkdirSync(path.join(from, 'e'));
    writeFileSync(path.join(from, 'e', 'a.png'), 'a');
    symlinkSync(outside, path.join(from, 'e', 'j'), 'junction');
    expect(copyTree(from, to, ['e'])).toEqual({ copied: ['e/a.png'], bytes: 1, skipped: [] });
    expect(copyTree(from, to, ['e/j/secret.txt', 'e/j']).copied).toEqual([]);
    expect(existsSync(path.join(to, 'e', 'j'))).toBe(false);
  });
  it('never writes outside `to`: not through a junction there, nor over a file link where the copy would go', () => {
    const { from, to } = dirs();
    const outside = outsideDir();
    mkdirSync(path.join(from, 'e'));
    writeFileSync(path.join(from, 'e', 'a.png'), 'a');
    writeFileSync(path.join(from, 'v.json'), 'new');
    symlinkSync(outside, path.join(to, 'e'), 'junction');
    expect(copyTree(from, to, ['e'])).toEqual({ copied: [], bytes: 0, skipped: ['e/a.png'] });
    expect(readdirSync(outside)).toEqual([]);
    const target = path.join(outsideDir(), 'target.txt');
    writeFileSync(target, 'old');
    try { symlinkSync(target, path.join(to, 'v.json')); } catch { return; /* no symlinks here (Windows without the privilege) */ }
    expect(copyTree(from, to, ['v.json'])).toEqual({ copied: [], bytes: 0, skipped: ['v.json'] });
    expect(copyTree(from, to, ['v.json'], { missingOnly: true }).copied).toEqual([]);
    expect(readFileSync(target, 'utf8')).toBe('old');
  });
});

describe('keepEvidence and evidenceOf (D-10, K2-04)', () => {
  it("copies a review dir's verify.json and its evidence folder from a task worktree to the main checkout, nothing else", () => {
    const { main, wt } = taskWorktree();
    const rd = '.forge/work/shop/T1/reviews-1-1';
    mkdirSync(path.join(wt, rd), { recursive: true });
    writeFileSync(path.join(wt, rd, 'verify.json'), '{}');
    writeFileSync(path.join(wt, rd, 'correctness.json'), '{}');
    mkdirSync(path.join(wt, '.forge/work/shop/T1/evidence/1-1'), { recursive: true });
    writeFileSync(path.join(wt, '.forge/work/shop/T1/evidence/1-1/01-home.png'), 'png');
    // A review dir outside the worktree copies nothing.
    const other = outsideDir();
    mkdirSync(path.join(other, 'reviews-1-1'));
    writeFileSync(path.join(other, 'reviews-1-1', 'verify.json'), '{}');
    expect(keepEvidence(wt, path.join(other, 'reviews-1-1'))).toEqual({ skipped: [] });
    expect(keepEvidence(wt, '../../../x/reviews-1-1')).toEqual({ skipped: [] });
    expect(readdirSync(main)).toEqual(['.claude']);
    expect(keepEvidence(wt, rd)).toEqual({ skipped: [] });
    expect(readFileSync(path.join(main, rd, 'verify.json'), 'utf8')).toBe('{}');
    expect(existsSync(path.join(main, rd, 'correctness.json'))).toBe(false);
    expect(readFileSync(path.join(main, '.forge/work/shop/T1/evidence/1-1/01-home.png'), 'utf8')).toBe('png');
    // A dir that is not a reviews-<n>-<k> one has no evidence folder: only its verify.json.
    mkdirSync(path.join(wt, '.forge/work/T2/r'), { recursive: true });
    writeFileSync(path.join(wt, '.forge/work/T2/r/verify.json'), '{}');
    expect(keepEvidence(wt, path.join(wt, '.forge/work/T2/r'))).toEqual({ skipped: [] });
    expect(existsSync(path.join(main, '.forge/work/T2/r/verify.json'))).toBe(true);
  });
  it("evidenceOf lists each reviews-* folder's verify.json and every evidence file under a worktree's .forge/work, in path order", () => {
    const { wt } = taskWorktree();
    for (const f of ['.forge/work/shop/T1/reviews-1-1/verify.json', '.forge/work/shop/T1/reviews-1-1/correctness.json', '.forge/work/shop/T1/evidence/1-1/01.png',
      '.forge/work/shop/T1/brief-1.md', '.forge/work/T2/reviews-1-2/verify.json', '.forge/work/T2/evidence/1-2/a/02.png', '.forge/work/T2/verify-1/verify.json', '.forge/ledger.jsonl']) {
      mkdirSync(path.dirname(path.join(wt, f)), { recursive: true });
      writeFileSync(path.join(wt, f), 'x');
    }
    expect(evidenceOf(wt)).toEqual({
      files: ['.forge/work/T2/evidence/1-2/a/02.png', '.forge/work/T2/reviews-1-2/verify.json', '.forge/work/shop/T1/evidence/1-1/01.png', '.forge/work/shop/T1/reviews-1-1/verify.json'],
      truncated: false,
    });
    expect(evidenceOf(outsideDir())).toEqual({ files: [], truncated: false });
  });
  it('evidenceOf walks only what it copies: other files never count against its cap; past the cap it says so (final review 3)', () => {
    const { wt } = taskWorktree();
    const put = (f: string) => { mkdirSync(path.dirname(path.join(wt, f)), { recursive: true }); writeFileSync(path.join(wt, f), 'x'); };
    for (let i = 0; i < 5; i++) put(`.forge/work/shop/T1/aaa-shots/${i}.png`);
    put('.forge/work/shop/T1/evidence/1-1/01.png');
    put('.forge/work/shop/T1/reviews-1-1/verify.json');
    expect(evidenceOf(wt, 2)).toEqual({ files: ['.forge/work/shop/T1/evidence/1-1/01.png', '.forge/work/shop/T1/reviews-1-1/verify.json'], truncated: false });
    put('.forge/work/shop/T1/evidence/1-1/02.png');
    expect(evidenceOf(wt, 2)).toMatchObject({ truncated: true });
  });
});

describe('a walk that stops at its cap is never silent (carry 5)', () => {
  it('copyTree copies the files it walked and names the folder whose walk stopped in skipped, so keepEvidence lists it as evidenceSkipped', () => {
    const { from, to } = dirs();
    mkdirSync(path.join(from, 'e', 'sub'), { recursive: true });
    for (const f of ['e/a.png', 'e/b.png', 'e/sub/c.png']) writeFileSync(path.join(from, f), 'x');
    expect(copyTree(from, to, ['e'], { maxFiles: 2 })).toEqual({ copied: ['e/a.png', 'e/b.png'], bytes: 2, skipped: ['e/'] });
    expect(copyTree(from, to, ['e'], { maxFiles: 3, missingOnly: true })).toEqual({ copied: ['e/sub/c.png'], bytes: 1, skipped: [] });
    expect(EVIDENCE_FILES_MAX).toBe(5000);
  });
});
