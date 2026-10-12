import { describe, it, expect } from 'vitest';
import { applyWrite, artifactId, writeFailed, writesOf } from '../src/mod/mirror.js';

const URL = 'https://claude.ai/artifact/Q71skZnSzoxfxm2799thGY';

describe('mirror of roadmap writes', () => {
  it('reads the artifact id from either URL spelling', () => {
    expect(artifactId(URL)).toBe('Q71skZnSzoxfxm2799thGY');
    expect(artifactId(`${URL}/`)).toBe('Q71skZnSzoxfxm2799thGY');
    expect(artifactId('https://claude.ai/code/artifact/Q71skZnSzoxfxm2799thGY?x=1')).toBe('Q71skZnSzoxfxm2799thGY');
    expect(artifactId('https://example.com/nope')).toBeNull();
    expect(artifactId(7)).toBeNull();
  });
  it('takes the mirrored writes of a batch (writes or batch) and of single writes', () => {
    const batch = {
      action: 'batch', url: URL, writes: [
        { op: 'update', collection: 'state', doc_id: 'T001', data: { status: 'in_progress', owner: 'main' } },
        { op: 'set', collection: 'events', doc_id: 'e1', data: { type: 'started' } },
        { op: 'update', collection: 'sessions', doc_id: 'main', data: { currentTask: 'T001' } },
        { op: 'update', collection: 'state', doc_id: '../x', data: { status: 'done' } },
        { op: 'update', collection: 'state', doc_id: 'T002', file_path: 'a.json' },
      ],
    };
    expect(writesOf(batch).map(w => `${w.collection}/${w.docId}`)).toEqual(['state/T001', 'sessions/main']);
    expect(writesOf({ action: 'batch', batch: batch.writes }).length).toBe(2);
    expect(writesOf({ action: 'update', collection: 'state', doc_id: 'T003', data: { status: 'blocked' } })).toEqual([
      { op: 'update', collection: 'state', docId: 'T003', data: { status: 'blocked' } },
    ]);
    expect(writesOf({ action: 'list', collection: 'state' })).toEqual([]);
    expect(writesOf(null)).toEqual([]);
  });
  it('merges an update, replaces on set and removes __delete__ fields', () => {
    const prev = JSON.stringify({ status: 'free', blockedBy: 'T000' });
    const up = applyWrite(prev, { op: 'update', collection: 'state', docId: 'T001', data: { status: 'in_progress', owner: 'main', blockedBy: { __delete__: true } } });
    expect(JSON.parse(up!)).toEqual({ status: 'in_progress', owner: 'main' });
    expect(JSON.parse(applyWrite(prev, { op: 'set', collection: 'state', docId: 'T001', data: { status: 'done' } })!)).toEqual({ status: 'done' });
    expect(JSON.parse(applyWrite('{corrupt', { op: 'update', collection: 'state', docId: 'T001', data: { status: 'done' } })!)).toEqual({ status: 'done' });
    expect(applyWrite(prev, { op: 'delete', collection: 'state', docId: 'T001' })).toBeNull();
    const polluted = applyWrite(undefined, { op: 'update', collection: 'state', docId: 'T', data: JSON.parse('{"__proto__":{"x":1},"ok":true}') });
    expect(JSON.parse(polluted!)).toEqual({ ok: true });
  });
  it('treats a version mismatch reported in the text as a failed write', () => {
    expect(writeFailed('version_mismatch on state/T001')).toBe(true);
    expect(writeFailed('database batch committed (3 writes)')).toBe(false);
    expect(writeFailed(undefined)).toBe(false);
  });
});
