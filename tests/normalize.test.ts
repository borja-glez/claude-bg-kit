import { describe, it, expect } from 'vitest';
import { normalizeMeta, normalizePhase, normalizeState, normalizeSession, normalizeEvent, normalizeMessage, normalizeInfinite } from '../src/page/normalize.js';

describe('normalizeMeta', () => {
  it('rejects non-objects', () => {
    for (const v of [null, undefined, 5, 'x', []]) expect(normalizeMeta(v)).toBeNull();
  });
  it('coerces garbage fields', () => {
    const m = normalizeMeta({ name: 5, locale: null, version: { a: 1 }, tracks: 'x', versions: 3, phaseOrder: null, metrics: 7, syncedAt: undefined })!;
    expect(m.name).toBe('5');
    expect(m.locale).toBe('');
    expect(m.tracks).toEqual([]);
    expect(m.versions).toEqual([]);
    expect(m.phaseOrder).toEqual([]);
    expect(m.metrics).toEqual({});
    expect(m.syncedAt).toBe('');
  });
  it('filters tracks and lastCommit', () => {
    const m = normalizeMeta({ tracks: [{ id: 'a', name: 'A', color: 'blue' }, { id: 1, name: 'B' }, null], metrics: { tests: 3, lastCommit: { sha: 5, ts: 'x' } } })!;
    expect(m.tracks.map(t => t.id)).toEqual(['a']);
    expect(m.metrics.lastCommit).toBeUndefined();
    expect(normalizeMeta({ metrics: { lastCommit: { sha: 'abc', ts: '2026-01-01T00:00:00Z' } } })!.metrics.lastCommit).toEqual({ sha: 'abc', ts: '2026-01-01T00:00:00Z' });
  });
});

describe('normalizePhase', () => {
  it('needs a string id', () => {
    expect(normalizePhase({ id: 4 })).toBeNull();
    expect(normalizePhase(null)).toBeNull();
  });
  it('cleans tasks', () => {
    const p = normalizePhase({ id: 'F1', name: 9, order: 'x', tasks: [{ id: 'T1', title: 'a', depends_on: 'x', zones: [1, 'z'], done_when: 4, track: 't', phase: 'F1' }, { id: 2, title: 'b' }, 'junk'] })!;
    expect(p.order).toBe(0);
    expect(p.tasks).toHaveLength(1);
    expect(p.tasks[0]).toMatchObject({ depends_on: [], zones: ['z'], done_when: '' });
  });
  it('tolerates missing tasks', () => {
    expect(normalizePhase({ id: 'F1', tasks: 'x' })!.tasks).toEqual([]);
  });
});

describe('normalizeState', () => {
  it('drops malformed commits and timestamps', () => {
    const s = normalizeState({ status: 'done', commits: [{ sha: 'a', title: 't', add: 1 }, { sha: 1 }, 'x'], blockedBy: [1, 'T1'], startedAt: 5, doneAt: '2026-01-01' });
    expect(s.commits).toHaveLength(1);
    expect(s.blockedBy).toEqual(['T1']);
    expect(s.startedAt).toBeUndefined();
    expect(s.doneAt).toBe('2026-01-01');
  });
  it('handles garbage', () => {
    expect(normalizeState('x').commits).toBeUndefined();
    expect(normalizeState({ commits: 'x', blockedBy: 'y' })).toMatchObject({ commits: [], blockedBy: undefined });
    expect(normalizeState(null)).toBeTruthy();
  });
});

describe('normalizeSession / normalizeEvent', () => {
  it('coerces strings', () => {
    expect(normalizeSession({ name: 5, heartbeatAt: null, status: 'active' })).toMatchObject({ name: '5', heartbeatAt: '' });
    expect(normalizeSession(null)).toMatchObject({ name: '', heartbeatAt: '' });
    expect(normalizeEvent({ ts: 1, type: null, sessionId: 2, text: 5 })).toMatchObject({ ts: '', type: '', sessionId: '', text: '5' });
    expect(normalizeEvent(undefined)).toMatchObject({ ts: '' });
  });
});

describe('normalizeMessage', () => {
  it('keeps a valid message', () => {
    const m = { ts: '2026-10-11T10:00:00Z', from: 'a', to: 'b', type: 'reply', taskId: 'T1', text: 'hi', status: 'resolved', replyTo: 'm1' };
    expect(normalizeMessage(m)).toEqual(m);
  });
  it('rejects non-objects', () => {
    for (const v of [null, 5, 'x']) expect(normalizeMessage(v)).toBeNull();
  });
  it('coerces garbage', () => {
    expect(normalizeMessage({ from: 5, to: null, text: {} })).toMatchObject({ from: '5', to: '', text: '[object Object]', status: 'open' });
    expect(normalizeMessage({ status: 'weird' })!.status).toBe('open');
  });
  it('keeps session extras only when text', () => {
    expect(normalizeSession({ agentName: 'a', branch: 'b', worktree: 5 })).toMatchObject({ agentName: 'a', branch: 'b', worktree: undefined });
    expect(normalizeSession({ busyUntil: '2026-10-11T11:00:00Z' }).busyUntil).toBe('2026-10-11T11:00:00Z');
    expect(normalizeSession({ busyUntil: { __delete__: true } }).busyUntil).toBeUndefined();
  });
});

describe('normalizeNote (page)', () => {
  it('drops invalid notes and trims text', async () => {
    const { normalizeNote } = await import('../src/page/normalize.js');
    expect(normalizeNote({ type: 'nope', author: 'a', text: 'x' })).toBeNull();
    expect(normalizeNote(null)).toBeNull();
    expect(normalizeNote({ type: 'idea', author: 'user:u', text: 'y'.repeat(3000), ts: 5 })).toMatchObject({ ts: '', text: 'y'.repeat(2000) });
  });
});

describe('normalizeState forge', () => {
  it('keeps a forge block with string path and phase, dropping mistyped fields', () => {
    const s = normalizeState({ status: 'in_progress', forge: { path: 'medium', phase: 'implement', round: 'x' } });
    expect(s.forge).toEqual({ path: 'medium', phase: 'implement' });
    expect(normalizeState({ status: 'in_progress', forge: 'bad' }).forge).toBeUndefined();
    expect(normalizeState({ status: 'in_progress', forge: { path: 1, phase: 'x' } }).forge).toBeUndefined();
    const full = normalizeState({ forge: { path: 'large', phase: 'review', agent: 'a', validators: [{ name: 'test', ok: true }, { name: 1, ok: true }, 'x'], verdict: { action: 'fix', score: 0.5 }, round: 2, cap: 4 } });
    expect(full.forge).toEqual({ path: 'large', phase: 'review', agent: 'a', validators: [{ name: 'test', ok: true }], verdict: { action: 'fix', score: 0.5 }, round: 2, cap: 4 });
    expect(normalizeState({ forge: { path: 'l', phase: 'p', verdict: { action: 'x', score: 'no' } } }).forge?.verdict).toEqual({ action: 'x', score: null });
  });
  it('keeps a valid evidence block and drops unsafe urls and bad entries', () => {
    const s = normalizeState({ status: 'done', evidence: {
      surfaces: ['web', 3], result: 'fail', passed: 1, total: 2, local: '.forge/work/x/evidence/1-1',
      shots: [
        { url: 'https://claude.ai/_blob/abc', id: 'abc', surface: 'web', check: 'adds', ok: true, expected: 'e', observed: 'o' },
        { url: 'javascript:alert(1)', surface: 'web', check: 'removes', ok: false },
        { surface: 'web', ok: 'yes' },
      ],
    } });
    expect(s.evidence).toEqual({ surfaces: ['web'], result: 'fail', passed: 1, total: 2, local: '.forge/work/x/evidence/1-1', shots: [
      { url: 'https://claude.ai/_blob/abc', id: 'abc', surface: 'web', check: 'adds', ok: true, expected: 'e', observed: 'o' },
      { surface: 'web', check: 'removes', ok: false },
    ] });
    expect(normalizeState({ evidence: { result: 'maybe' } }).evidence).toBeUndefined();
    expect(normalizeState({ evidence: { result: 'pass', passed: 1, total: 1, shots: [{ url: '/_blob/id1', surface: 'w', check: 'c', ok: true }] } }).evidence!.shots[0].url).toBe('/_blob/id1');
    const urlOf = (url: string) => normalizeState({ evidence: { result: 'pass', passed: 1, total: 1, shots: [{ url, surface: 'w', check: 'c', ok: true }] } }).evidence!.shots[0].url;
    expect(urlOf('https://evil.example/x.png')).toBeUndefined();
    expect(urlOf('https://claude.ai.evil.example/x.png')).toBeUndefined();
    expect(urlOf('javascript:alert(1)')).toBeUndefined();
  });
});

describe('normalizeInfinite', () => {
  it('rejects non-objects', () => {
    for (const v of [null, undefined, 5, 'x', []]) expect(normalizeInfinite(v)).toBeNull();
  });
  it('keeps a valid doc', () => {
    expect(normalizeInfinite({ active: true, cycle: 3, budget: { cycles: 10, hours: 2.5 }, startedAt: '2026-10-11T09:00:00Z', lastCycleAt: '2026-10-11T11:00:00Z' }))
      .toEqual({ active: true, cycle: 3, budget: { cycles: 10, hours: 2.5 }, startedAt: '2026-10-11T09:00:00Z', lastCycleAt: '2026-10-11T11:00:00Z' });
  });
  it('coerces garbage: active only when true, cycle a non-negative integer, budget numbers dropped when invalid, dates ISO or empty', () => {
    expect(normalizeInfinite({ active: 'yes', cycle: -2, budget: { cycles: 0, hours: 'x' }, startedAt: 'nope', lastCycleAt: 5 }))
      .toEqual({ active: false, cycle: 0, budget: {}, startedAt: '', lastCycleAt: null });
    expect(normalizeInfinite({ active: true, cycle: 2.5, budget: { cycles: 1.5, hours: Infinity } })).toEqual({ active: true, cycle: 0, budget: {}, startedAt: '', lastCycleAt: null });
    expect(normalizeInfinite({ active: true, cycle: 4, budget: 'x' })!.budget).toEqual({});
  });
});
