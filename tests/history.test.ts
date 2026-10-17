import { describe, it, expect } from 'vitest';
import { ENTRY_KINDS, appendChangelog, entryKind, listVersions, nextVersion, normalizeApplied, normalizeResolved, parseAppliedItems, parseChangelog, roundList } from '../src/lib/history.js';

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
  it('keeps resolved as round and number pairs, sorted and without duplicates, and drops junk (K3-02)', () => {
    const entry = { version: 3, date: '2026-10-16', note: 'entrevista', words: 10, round: 1 };
    const raw = [{ round: 2, n: 1 }, { round: 1, n: 4 }, { round: 1, n: 4 }, { round: 0, n: 1 }, { round: 1, n: 'x' }, 7, null];
    expect(parseChangelog(JSON.stringify([{ ...entry, resolved: raw }]))[0]).toEqual({ ...entry, resolved: [{ round: 1, n: 4 }, { round: 2, n: 1 }] });
    expect(parseChangelog(JSON.stringify([{ ...entry, resolved: 'r1:4' }]))[0]).toEqual(entry);
    expect(normalizeResolved([])).toBeNull();
    expect(normalizeResolved({ round: 1, n: 1 })).toBeNull();
  });
  it('parseAppliedItems names the flag it parses, and roundList turns its map into pairs (K3-02)', () => {
    expect(parseAppliedItems(['r1:5,4', 'r2:1'], 2, 'resolved')).toEqual({ 1: [4, 5], 2: [1] });
    expect(() => parseAppliedItems(['x'], 1, 'resolved')).toThrow('--resolved item x is not r<R>:<numbers> nor <numbers>');
    expect(() => parseAppliedItems([], 1, 'resolved')).toThrow('--resolved needs at least one item');
    expect(() => parseAppliedItems(['x'], 1)).toThrow('--applied item x');
    expect(roundList({ 2: [1], 1: [5, 4] })).toEqual([{ round: 1, n: 4 }, { round: 1, n: 5 }, { round: 2, n: 1 }]);
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

describe('the kind of an entry (K3-07)', () => {
  const entry = { version: 2, date: '2026-10-16', note: 'x', words: 10, round: 1 };
  it('keeps a known kind and drops an unknown one', () => {
    expect(parseChangelog(JSON.stringify([{ ...entry, kind: 'amend' }]))[0]).toEqual({ ...entry, kind: 'amend' });
    expect(parseChangelog(JSON.stringify([{ ...entry, kind: 'merge' }]))[0]).toEqual(entry);
    expect(ENTRY_KINDS).toEqual(['draft', 'round', 'apply', 'rewrite', 'interview', 'approve', 'amend', 'reopen']);
  });
  it('entryKind reads the kind, then what the entry recorded, then the notes of older entries in English or Spanish (Review Focus 2)', () => {
    expect(entryKind({ ...entry, kind: 'interview', note: 'aprobado' })).toBe('interview');
    expect(entryKind({ ...entry, rewrite: true })).toBe('rewrite');
    expect(entryKind({ ...entry, applied: { 1: [2] } })).toBe('apply');
    const notes = [['aprobado', 'approve'], ['approved (auto)', 'approve'], ['Aprobada la v3', 'approve'], ['reabierto: revert of decision 4', 'reopen'],
      ['reopened for T044', 'reopen'], ['enmienda: Node 22', 'amend'], ['amended the scope', 'amend']] as const;
    for (const [note, kind] of notes) expect(entryKind({ ...entry, note }), note).toBe(kind);
    for (const note of ['ronda 1: aplicadas 1,3', 'Borrador inicial', 'entrevista: formulario', 'interview']) expect(entryKind({ ...entry, note }), note).toBeNull();
  });
});
