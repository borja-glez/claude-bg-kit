import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { designFilesOf, readCritiques, readDismissedOf, readHistory, repoRootOf, writeDismissed } from '../src/cli/design-files.js';

const made: string[] = [];
const temp = () => { const d = mkdtempSync(path.join(tmpdir(), 'wp-files-')); made.push(d); return d; };
afterAll(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });
const crit = (round: number, count: number) => JSON.stringify({ round, version: 1, scope: 'full',
  proposals: Array.from({ length: count }, (_, i) => ({ n: i + 1, category: 'gap', severity: 'major', section: '_intro', problem: 'p', change: 'c' })) });

describe('designFilesOf (K3-10)', () => {
  it('puts the critiques next to the design and the older ones in the repository .waypoint/<project>/', () => {
    const root = temp();
    const file = path.join(root, 'docs', 'waypoint', 'shop', 'design.md');
    expect(designFilesOf(file, 'shop')).toEqual({
      file, dir: path.join(root, 'docs', 'waypoint', 'shop'),
      critiques: path.join(root, 'docs', 'waypoint', 'shop', 'design', 'critiques'),
      legacy: path.join(root, '.waypoint', 'shop'),
    });
  });
  it('outside docs/waypoint/<project>/, the repository is git top level, else the design own folder (Review Focus 3)', () => {
    const repo = temp();
    execFileSync('git', ['init', '-q'], { cwd: repo });
    mkdirSync(path.join(repo, 'specs', 'x'), { recursive: true });
    expect(path.relative(realpathSync.native(repo), repoRootOf(path.join(repo, 'specs', 'x')))).toBe('');
    const loose = temp();
    expect(repoRootOf(loose)).toBe(loose);
    expect(designFilesOf(path.join(loose, 'design.md'), 'p').legacy).toBe(path.join(loose, '.waypoint', 'p'));
  });
});

describe('reading and writing the critiques (K3-10, K3-05)', () => {
  const filesIn = (root: string) => designFilesOf(path.join(root, 'docs', 'waypoint', 'shop', 'design.md'), 'shop');
  it('reads every round from both places, docs/ winning a round both have; a broken file is a null critique', () => {
    const root = temp();
    const f = filesIn(root);
    mkdirSync(f.critiques, { recursive: true });
    mkdirSync(f.legacy, { recursive: true });
    writeFileSync(path.join(f.legacy, 'critique-r1.json'), crit(1, 3));
    writeFileSync(path.join(f.legacy, 'critique-r2.json'), crit(2, 4));
    writeFileSync(path.join(f.critiques, 'r2.json'), crit(2, 1));
    writeFileSync(path.join(f.critiques, 'r3.json'), '{bad');
    writeFileSync(path.join(f.critiques, 'notes.md'), 'x');
    expect(readCritiques(f).map(c => [c.round, c.critique?.proposals.length ?? null, path.relative(root, c.file)])).toEqual([
      [1, 3, path.join('.waypoint', 'shop', 'critique-r1.json')],
      [2, 1, path.join('docs', 'waypoint', 'shop', 'design', 'critiques', 'r2.json')],
      [3, null, path.join('docs', 'waypoint', 'shop', 'design', 'critiques', 'r3.json')],
    ]);
  });
  it('dismissed.json comes from docs/ when it is there, else from .waypoint/; writing goes to docs/ without empty rounds (Review Focus 1)', () => {
    const root = temp();
    const f = filesIn(root);
    expect(readDismissedOf(f)).toEqual({});
    mkdirSync(f.legacy, { recursive: true });
    writeFileSync(path.join(f.legacy, 'dismissed.json'), JSON.stringify({ 1: [3] }));
    expect(readDismissedOf(f)).toEqual({ 1: [{ n: 3 }] });
    const p = writeDismissed(f, { 1: [{ n: 3 }, { n: 4, reason: 'no' }], 2: [] });
    expect(p).toBe(path.join(f.critiques, 'dismissed.json'));
    expect(JSON.parse(readFileSync(p, 'utf8'))).toEqual({ 1: [{ n: 3 }, { n: 4, reason: 'no' }] });
    expect(readDismissedOf(f)).toEqual({ 1: [{ n: 3 }, { n: 4, reason: 'no' }] });
  });
  it('writeDismissed is atomic: it leaves no temp file and replaces the previous content whole', () => {
    const root = temp();
    const f = filesIn(root);
    writeDismissed(f, { 1: [{ n: 1 }] });
    const p = writeDismissed(f, { 2: [{ n: 5, reason: 'x'.repeat(100) }] });
    expect(JSON.parse(readFileSync(p, 'utf8'))).toEqual({ 2: [{ n: 5, reason: 'x'.repeat(100) }] });
    expect(readdirSync(f.critiques)).toEqual(['dismissed.json']);
  });
  it('readHistory maps each version to its text', () => {
    const root = temp();
    const dir = path.join(root, 'docs', 'waypoint', 'shop');
    mkdirSync(path.join(dir, 'design', 'history'), { recursive: true });
    writeFileSync(path.join(dir, 'design', 'history', 'v1.md'), 'uno');
    writeFileSync(path.join(dir, 'design', 'history', 'v3.md'), 'tres');
    expect(readHistory(dir)).toEqual({ 1: 'uno', 3: 'tres' });
    expect(readHistory(path.join(root, 'nada'))).toEqual({});
  });
});
