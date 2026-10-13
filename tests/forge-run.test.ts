import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseRun, startRun, recordCycle, stopReason, saveRun, type RunState } from '../src/forge/run.js';

const T0 = new Date('2026-10-11T10:00:00.000Z');
const ctx = (over: Partial<{ now: Date; stopFile: boolean; approvedPending: number; pendingProposals: number }> = {}) =>
  ({ now: T0, stopFile: false, approvedPending: 0, pendingProposals: 0, ...over });

describe('parseRun', () => {
  it('reads a valid run', () => {
    const r = startRun(T0, { cycles: 3, hours: 2 });
    expect(parseRun(JSON.stringify(r))).toEqual(r);
    expect(r).toMatchObject({ mode: 'infinite', active: true, startedAt: T0.toISOString(), cycle: 0, noProgress: 0,
      lastError: null, repeatedError: false, lastBlockEvents: null, queueMax: 10, sessionId: null, blocksSinceCycle: 0 });
    const bound = startRun(T0, {}, 10, 'sess-1');
    expect(parseRun(JSON.stringify(bound))).toEqual(bound);
  });
  it('keeps a stoppedReason and a custom queueMax', () => {
    const r = { ...startRun(T0, {}, 4), active: false, stoppedReason: 'stop-file' };
    expect(parseRun(JSON.stringify(r))).toEqual(r);
  });
  it('is null for absent, bad JSON or non-objects', () => {
    expect(parseRun(null)).toBeNull();
    expect(parseRun('{nope')).toBeNull();
    expect(parseRun('[]')).toBeNull();
    expect(parseRun('null')).toBeNull();
  });
  it('is null for a negative, zero, NaN or string budget', () => {
    const base = startRun(T0, {});
    for (const budget of [{ cycles: -1 }, { cycles: 0 }, { hours: -2 }, { cycles: 'x' }, { hours: '3' }, { cycles: 1.5 }, { hours: 'NaN' }, null, []])
      expect(parseRun(JSON.stringify({ ...base, budget }))).toBeNull();
  });
  it('is null when a field is missing or of the wrong type', () => {
    const base = startRun(T0, { cycles: 2 }) as unknown as Record<string, unknown>;
    for (const k of ['mode', 'active', 'startedAt', 'budget', 'cycle', 'noProgress', 'lastError', 'repeatedError', 'lastBlockEvents', 'queueMax', 'sessionId']) {
      const { [k]: _gone, ...rest } = base;
      expect(parseRun(JSON.stringify(rest))).toBeNull();
    }
    expect(parseRun(JSON.stringify({ ...base, cycle: '1' }))).toBeNull();
    expect(parseRun(JSON.stringify({ ...base, cycle: -1 }))).toBeNull();
    expect(parseRun(JSON.stringify({ ...base, startedAt: 'yesterday' }))).toBeNull();
    expect(parseRun(JSON.stringify({ ...base, mode: 'finite' }))).toBeNull();
    expect(parseRun(JSON.stringify({ ...base, queueMax: 0 }))).toBeNull();
    expect(parseRun(JSON.stringify({ ...base, stoppedReason: 3 }))).toBeNull();
    expect(parseRun(JSON.stringify({ ...base, sessionId: 3 }))).toBeNull();
    expect(parseRun(JSON.stringify({ ...base, sessionId: '' }))).toBeNull();
    expect(parseRun(JSON.stringify({ ...base, blocksSinceCycle: -1 }))).toBeNull();
    expect(parseRun(JSON.stringify({ ...base, blocksSinceCycle: '1' }))).toBeNull();
  });
  it('reads a run.json without blocksSinceCycle as 0', () => {
    const { blocksSinceCycle: _b, ...old } = startRun(T0, { cycles: 2 });
    expect(parseRun(JSON.stringify({ ...old }))?.blocksSinceCycle).toBe(0);
    expect(parseRun(JSON.stringify({ ...old, blocksSinceCycle: 1 }))?.blocksSinceCycle).toBe(1);
  });
  it('keeps a valid locale and ignores a missing or invalid one', () => {
    const r = startRun(T0, { cycles: 2 }, 10, null, 'es');
    expect(r.locale).toBe('es');
    expect(parseRun(JSON.stringify(r))).toEqual(r);
    expect(parseRun(JSON.stringify({ ...r, locale: 'pt-BR' }))?.locale).toBe('pt-BR');
    for (const locale of ['', 'spanish', 3, 'es es', null]) {
      const p = parseRun(JSON.stringify({ ...r, locale }));
      expect(p).not.toBeNull();
      expect(p).not.toHaveProperty('locale');
    }
    expect(startRun(T0, { cycles: 2 })).not.toHaveProperty('locale');
  });
});

describe('recordCycle', () => {
  it('counts cycles and consecutive cycles without progress', () => {
    let r = startRun(T0, {});
    r = recordCycle(r, { progress: false });
    r = recordCycle(r, { progress: false });
    expect(r).toMatchObject({ cycle: 2, noProgress: 2 });
    r = recordCycle(r, { progress: true });
    expect(r).toMatchObject({ cycle: 3, noProgress: 0 });
    expect(recordCycle({ ...r, blocksSinceCycle: 2 }, { progress: false }).blocksSinceCycle).toBe(0);
  });
  it('flags the same non-empty error twice in a row', () => {
    let r = startRun(T0, {});
    r = recordCycle(r, { progress: false, error: 'boom' });
    expect(r).toMatchObject({ lastError: 'boom', repeatedError: false });
    r = recordCycle(r, { progress: false, error: 'boom' });
    expect(r.repeatedError).toBe(true);
    r = recordCycle(r, { progress: false, error: 'other' });
    expect(r).toMatchObject({ lastError: 'other', repeatedError: false });
    r = recordCycle(r, { progress: true });
    expect(r).toMatchObject({ lastError: null, repeatedError: false });
    r = recordCycle(recordCycle(r, { progress: false, error: '  ' }), { progress: false, error: '  ' });
    expect(r.repeatedError).toBe(false);
  });
});

describe('stopReason', () => {
  const r = startRun(T0, { cycles: 3, hours: 2 });
  it('is null while nothing stops the run', () => {
    expect(stopReason(r, ctx())).toBeNull();
    expect(stopReason(r, ctx({ approvedPending: 1, pendingProposals: 20 }))).toBeNull();
    expect(stopReason(startRun(T0, {}), ctx({ now: new Date('2027-01-01T00:00:00Z') }))).toBeNull();
  });
  it('stops on the stop file', () => expect(stopReason(r, ctx({ stopFile: true }))).toBe('stop-file'));
  it('stops when the cycles are spent', () => {
    expect(stopReason({ ...r, cycle: 2 }, ctx())).toBeNull();
    expect(stopReason({ ...r, cycle: 3 }, ctx())).toBe('budget-cycles');
  });
  it('stops when the hours have elapsed', () => {
    expect(stopReason(r, ctx({ now: new Date('2026-10-11T11:59:59.000Z') }))).toBeNull();
    expect(stopReason(r, ctx({ now: new Date('2026-10-11T12:00:00.000Z') }))).toBe('budget-hours');
  });
  it('stops after 3 cycles without progress', () => {
    expect(stopReason({ ...r, noProgress: 2 }, ctx())).toBeNull();
    expect(stopReason({ ...r, noProgress: 3 }, ctx())).toBe('no-progress');
  });
  it('stops after 2 blocks without a recorded cycle', () => {
    expect(stopReason({ ...r, blocksSinceCycle: 1 }, ctx())).toBeNull();
    expect(stopReason({ ...r, blocksSinceCycle: 2 }, ctx())).toBe('no-cycle');
  });
  it('stops on a repeated error', () => expect(stopReason({ ...r, repeatedError: true } as RunState, ctx())).toBe('repeated-error'));
  it('stops when nothing is approved and the pending queue is full', () => {
    expect(stopReason(r, ctx({ pendingProposals: 9 }))).toBeNull();
    expect(stopReason(r, ctx({ pendingProposals: 10 }))).toBe('queue-full');
    expect(stopReason(r, ctx({ pendingProposals: 10, approvedPending: 1 }))).toBeNull();
  });
});

describe('saveRun', () => {
  it('removes its temp file when the write fails', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'forge-run-'));
    mkdirSync(path.join(root, '.forge', 'run.json'), { recursive: true });
    expect(() => saveRun(root, startRun(T0, {}))).toThrow();
    expect(readdirSync(path.join(root, '.forge')).filter(n => n.endsWith('.tmp'))).toEqual([]);
  });
});
