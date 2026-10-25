import { describe, it, expect } from 'vitest';
import { mkdirSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { Finding } from '../src/forge/verdict.js';
import {
  readShadow, startShadow, stopShadow, takeBrief, addCase, shadowFile,
  findingsMatch, buildCase, shadowReport, renderShadowReport, type ShadowCase,
} from '../src/forge/shadow.js';
import { useTempDirs } from './helpers/tmp.js';
const tempDir = useTempDirs();

const tmp = () => tempDir('forge-shadow-');
const f = (severity: Finding['severity'], problem: string, file?: string, line?: number): Finding => ({ severity, problem, file, line });

describe('shadow state', () => {
  it('opens with 10 briefs by default, keeps cases and writes inside a git-ignored .forge', () => {
    const root = tmp();
    expect(readShadow(root)).toBeNull();
    expect(startShadow(root)).toEqual({ remaining: 10, cases: [] });
    expect(readShadow(root)).toEqual({ remaining: 10, cases: [] });
    expect(existsSync(path.join(root, '.forge', '.gitignore'))).toBe(true);
    expect(JSON.parse(readFileSync(shadowFile(root), 'utf8'))).toEqual({ remaining: 10, cases: [] });
    expect(readdirSync(path.join(root, '.forge')).filter(n => n.endsWith('.tmp'))).toEqual([]);
  });
  it('opens with N briefs and subtracts one per brief down to zero', () => {
    const root = tmp();
    startShadow(root, 2);
    expect(takeBrief(root)).toBe(true);
    expect(readShadow(root)?.remaining).toBe(1);
    expect(takeBrief(root)).toBe(true);
    expect(readShadow(root)?.remaining).toBe(0);
    expect(takeBrief(root)).toBe(false);
    expect(readShadow(root)?.remaining).toBe(0);
  });
  it('takeBrief is false with no test open', () => {
    expect(takeBrief(tmp())).toBe(false);
  });
  it('stops early keeping the cases for the report', () => {
    const root = tmp();
    startShadow(root, 5);
    addCase(root, buildCase('T1', 'correctness', [], [f('important', 'x', 'a.ts', 1)]));
    stopShadow(root);
    const s = readShadow(root);
    expect(s?.remaining).toBe(0);
    expect(s?.cases).toHaveLength(1);
    expect(takeBrief(root)).toBe(false);
  });
  it('starting again keeps the cases collected and resets the briefs left; reset clears them', () => {
    const root = tmp();
    startShadow(root, 5);
    addCase(root, buildCase('T1', 'correctness', [], [f('important', 'x', 'a.ts', 1)]));
    expect(startShadow(root, 3)).toMatchObject({ remaining: 3, cases: [{ task: 'T1' }] });
    expect(readShadow(root)?.cases).toHaveLength(1);
    expect(startShadow(root, 4, { reset: true })).toEqual({ remaining: 4, cases: [] });
    expect(readShadow(root)).toEqual({ remaining: 4, cases: [] });
  });
  it('reads a broken file as no test', () => {
    const root = tmp();
    startShadow(root);
    writeFileSync(shadowFile(root), '{nope');
    expect(readShadow(root)).toBeNull();
  });
});

describe('shadow state in a linked worktree', () => {
  it('a test opened in the main checkout is seen, spent and fed from a worktree', () => {
    const root = tmp();
    const main = path.join(root, 'main');
    mkdirSync(main);
    const git = (...a: string[]) => execFileSync('git', a, { cwd: main, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'a@b.c');
    git('config', 'user.name', 't');
    writeFileSync(path.join(main, 'a.txt'), 'a\n');
    git('add', 'a.txt');
    git('commit', '-qm', 'init');
    const wt = path.join(root, 'wt');
    git('worktree', 'add', '-q', wt, '-b', 'task');
    startShadow(main, 2);
    expect(readShadow(wt)).toEqual({ remaining: 2, cases: [] });
    expect(takeBrief(wt)).toBe(true);
    expect(readShadow(main)?.remaining).toBe(1);
    addCase(wt, buildCase('T1', 'correctness', [], [f('important', 'x', 'a.ts', 1)]));
    expect(readShadow(main)?.cases).toHaveLength(1);
    expect(path.resolve(shadowFile(wt))).toBe(path.resolve(main, '.forge', 'shadow.json'));
    expect(existsSync(path.join(wt, '.forge', 'shadow.json'))).toBe(false);
  });
});

describe('findingsMatch', () => {
  it('matches in the same file within ±10 lines and not at 11', () => {
    expect(findingsMatch(f('important', 'alpha'), f('important', 'beta'))).toBe(false);
    expect(findingsMatch(f('important', 'alpha', 'src/a.ts', 20), f('important', 'beta', 'src/a.ts', 30))).toBe(true);
    expect(findingsMatch(f('important', 'alpha', 'src/a.ts', 20), f('important', 'beta', 'src/a.ts', 10))).toBe(true);
    expect(findingsMatch(f('important', 'alpha', 'src/a.ts', 20), f('important', 'beta', 'src/a.ts', 31))).toBe(false);
    expect(findingsMatch(f('important', 'alpha', 'src/a.ts', 20), f('important', 'beta', 'src/a.ts', 9))).toBe(false);
  });
  it('in another file matches only by word overlap >= 0.3', () => {
    // {null, check, missing, before, write} vs {null, check, missing, parse}: 3 / 6 = 0.5
    expect(findingsMatch(f('important', 'Null check missing before write', 'a.ts', 5), f('important', 'null check missing in parse', 'b.ts', 5))).toBe(true);
    // {path, traversal, upload} vs {missing, quota, limit, for, size, upload, path}: 2 / 8 < 0.3
    expect(findingsMatch(f('important', 'path traversal in upload', 'a.ts', 5), f('important', 'missing quota limit for size of upload path', 'b.ts', 5))).toBe(false);
    // 3 shared of 10 distinct = 0.3 exactly
    expect(findingsMatch(f('important', 'one two three four five six seven', 'a.ts', 1), f('important', 'one two three eight nine ten', 'b.ts', 1))).toBe(true);
  });
});

describe('buildCase', () => {
  it('pairs blockers one to one and counts an unpaired critical as missed', () => {
    const xhigh = [
      f('critical', 'sql injection in query builder', 'db.ts', 40),
      f('important', 'race on cache refresh', 'cache.ts', 10),
      f('important', 'off by one in pager', 'page.ts', 100),
      f('minor', 'naming', 'x.ts', 1),
    ];
    const high = [
      f('important', 'cache refresh is not locked', 'cache.ts', 14),
      f('important', 'pagination skips last item', 'page.ts', 109),
      f('important', 'leaks file handle', 'io.ts', 3),
      f('minor', 'style', 'y.ts', 1),
    ];
    const c = buildCase('T7', 'security', high, xhigh);
    expect(c.task).toBe('T7');
    expect(c.reviewer).toBe('security');
    expect(c.xhigh).toHaveLength(3);
    expect(c.recovered.map(r => r.file)).toEqual(['cache.ts', 'page.ts']);
    expect(c.missed.map(r => r.file)).toEqual(['db.ts']);
    expect(c.missedCritical.map(r => r.file)).toEqual(['db.ts']);
    expect(c.highOnly.map(r => r.file)).toEqual(['io.ts']);
  });
  it('one high finding recovers at most one xhigh finding', () => {
    const c = buildCase('T1', 'correctness', [f('important', 'a', 'a.ts', 10)], [f('important', 'b', 'a.ts', 10), f('important', 'c', 'a.ts', 12)]);
    expect(c.recovered).toHaveLength(1);
    expect(c.missed).toHaveLength(1);
    expect(c.highOnly).toHaveLength(0);
  });
});

describe('shadowReport', () => {
  const blockers = (n: number, file: string): Finding[] => Array.from({ length: n }, (_, i) => f('important', `issue ${file} ${i}`, file, i * 100 + 1));
  it('marks a reviewer that passes, one at 89 % and one that loses a critical', () => {
    const cases: ShadowCase[] = [
      // correctness: 10 of 10 → passes
      buildCase('T1', 'correctness', blockers(10, 'c.ts'), blockers(10, 'c.ts')),
      // perf: 8 of 9 → 89 %
      buildCase('T1', 'perf', blockers(8, 'p.ts'), blockers(9, 'p.ts')),
      // security: 10 of 11 (≥ 90 %) but the missed one is critical
      buildCase('T1', 'security', blockers(10, 's.ts'), [...blockers(10, 's.ts'), f('critical', 'auth bypass', 'auth.ts', 5)]),
      buildCase('T2', 'security', [f('important', 'extra', 'z.ts', 1)], []),
    ];
    const r = shadowReport(cases);
    const by = Object.fromEntries(r.map(x => [x.reviewer, x]));
    expect(by.correctness).toMatchObject({ cases: 1, xhighBlockers: 10, recovered: 10, recoveredPct: 100, missedCritical: 0, highOnly: 0, status: 'passes' });
    expect(by.perf).toMatchObject({ cases: 1, xhighBlockers: 9, recovered: 8, recoveredPct: 89, missedCritical: 0, status: 'fails' });
    expect(by.perf.missedCases).toEqual([{ task: 'T1', missed: [blockers(9, 'p.ts')[8]] }]);
    expect(by.security).toMatchObject({ cases: 2, xhighBlockers: 11, recovered: 10, recoveredPct: 91, missedCritical: 1, highOnly: 1, status: 'fails' });
    expect(by.security.missedCases).toEqual([{ task: 'T1', missed: [f('critical', 'auth bypass', 'auth.ts', 5)] }]);
  });
  it('a reviewer whose twins found no blocker is unverified: it neither passes nor fails (A3)', () => {
    const [r] = shadowReport([buildCase('T1', 'perf', [], []), buildCase('T2', 'perf', [f('important', 'only high', 'p.ts', 3)], [])]);
    expect(r).toMatchObject({ cases: 2, xhighBlockers: 0, recovered: 0, recoveredPct: null, missedCritical: 0, highOnly: 1, missedCases: [], status: 'unverified' });
    expect(r).not.toHaveProperty('passes');
    const es = renderShadowReport([r], 'es');
    expect(es).toContain('perf: sin verificar');
    expect(es).toContain('(-)');
    expect(es).not.toContain('cumple');
    expect(renderShadowReport([r], 'en')).toContain('perf: unverified');
  });
  it('renders the report in Spanish and English', () => {
    const r = shadowReport([buildCase('T1', 'perf', [], [f('critical', 'auth bypass', 'auth.ts', 5)])]);
    const es = renderShadowReport(r, 'es');
    expect(es).toContain('perf');
    expect(es).toContain('0 %');
    expect(es).toContain('auth.ts:5');
    expect(es).toContain('no cumple');
    const en = renderShadowReport(r, 'en');
    expect(en).toContain('fails');
    expect(en).toContain('auth bypass');
    expect(renderShadowReport([], 'en')).toContain('No shadow cases');
  });
});
