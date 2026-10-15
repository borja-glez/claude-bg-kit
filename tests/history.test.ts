import { describe, it, expect } from 'vitest';
import { appendChangelog, listVersions, nextVersion, normalizeApplied, parseChangelog } from '../src/lib/history.js';

describe('versions', () => {
  it('lists v<N>.md files only, sorted', () => {
    expect(listVersions(['v3.md', 'v1.md', 'notes.md', 'v10.md', 'v2.txt', 'v1.md'])).toEqual([1, 3, 10]);
  });
  it('next version is max+1, never fills gaps', () => {
    expect(nextVersion([])).toBe(1);
    expect(nextVersion(['v1.md', 'v3.md'])).toBe(4);
  });
});

describe('changelog', () => {
  const e = (version: number) => ({ version, date: '2026-10-11', note: `v${version}`, words: 100, round: version - 1 });
  it('parses empty and missing files', () => {
    expect(parseChangelog(null)).toEqual([]);
    expect(parseChangelog('  ')).toEqual([]);
    expect(parseChangelog(JSON.stringify([e(1)]))).toEqual([e(1)]);
  });
  it('rejects invalid json', () => {
    expect(() => parseChangelog('{oops')).toThrow('changelog.json is not valid JSON');
  });
  it('appends only increasing versions', () => {
    expect(appendChangelog([e(1)], e(2))).toEqual([e(1), e(2)]);
    expect(() => appendChangelog([e(2)], e(2))).toThrow(/version 2/);
  });
  it('keeps a valid applied, sorted and without duplicates, and rewrite: true; drops junk without failing (A-04)', () => {
    const entry = { version: 2, date: '2026-10-15', note: 'resumen', words: 10, round: 2 };
    expect(parseChangelog(JSON.stringify([{ ...entry, applied: { 2: [5, 4, 4], 1: [3] }, rewrite: true }]))[0])
      .toEqual({ ...entry, applied: { 1: [3], 2: [4, 5] }, rewrite: true });
    for (const junk of [7, 'x', [1, 2], { '01': [1] }, { x: [1] }, { 1: 'a' }, { 1: [0, -1, 1.5, 'x'] }]) {
      expect(parseChangelog(JSON.stringify([{ ...entry, applied: junk, rewrite: 'yes' }]))[0]).toEqual(entry);
    }
    expect(normalizeApplied({ 1: [2, 'x', 2], 3: [], '04': [1] })).toEqual({ 1: [2] });
    expect(normalizeApplied(null)).toBeNull();
  });
});

describe('fix round 1: changelog validation', () => {
  const good = { version: 1, date: '2026-10-11', note: 'n', words: 10, round: 0 };
  it('rejects a JSON value that is not an array', () => {
    expect(() => parseChangelog('{"a":1}')).toThrow('changelog.json must be a JSON array');
  });
  it('names the index of an entry with a wrong type', () => {
    expect(() => parseChangelog(JSON.stringify([good, { ...good, version: '1' }]))).toThrow(/entry 1/);
  });
  it('rejects an entry missing a field', () => {
    const { note: _n, ...noNote } = good;
    expect(() => parseChangelog(JSON.stringify([noNote]))).toThrow(/entry 0/);
  });
});
