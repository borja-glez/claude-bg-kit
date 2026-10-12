import { describe, it, expect } from 'vitest';
import { emptyFront, normalizeSwarm, parseSwarm, swarmLive, type SwarmState } from '../src/lib/swarm-state.js';

const valid = (): SwarmState => ({
  active: true, parallel: 5, mergeAuthorized: true, project: 'shop', base: 'main', coordinator: 'main',
  hookSession: null, startedAt: '2026-10-11T10:00:00.000Z', lastTickAt: null, lastBlockTick: null, sleepUntil: null,
  stopReason: null, stallReason: null, notice: null,
  fronts: { ui: { ...emptyFront(), status: 'running', session: 'wp-shop-ui', done: 1, total: 3 } },
});

describe('swarm state', () => {
  it('round-trips a valid state', () => {
    expect(parseSwarm(JSON.stringify(valid()))).toEqual(valid());
  });
  it('returns null for absent, bad JSON, arrays and missing required fields', () => {
    expect(parseSwarm(null)).toBeNull();
    expect(parseSwarm('{')).toBeNull();
    expect(parseSwarm('[]')).toBeNull();
    const { base: _b, ...noBase } = valid();
    expect(normalizeSwarm(noBase)).toBeNull();
    expect(normalizeSwarm({ ...valid(), parallel: 11 })).toBeNull();
    expect(normalizeSwarm({ ...valid(), startedAt: 'nope' })).toBeNull();
  });
  it('fills optional fields with null and drops invalid ones', () => {
    const s = normalizeSwarm({ ...valid(), lastTickAt: 'x', stopReason: 'weird', notice: { kind: 'nope' } })!;
    expect(s.lastTickAt).toBeNull();
    expect(s.stopReason).toBeNull();
    expect(s.notice).toBeNull();
  });
  it('skips fronts with an unknown status and clamps counts', () => {
    const s = normalizeSwarm({ ...valid(), fronts: { a: { status: 'zzz' }, b: { status: 'waiting', done: -1, total: 'x', waitingFor: { task: 'T1', track: 'a', reason: 'not-integrated' } } } })!;
    expect(Object.keys(s.fronts)).toEqual(['b']);
    expect(s.fronts.b).toMatchObject({ done: 0, total: 0, waitingFor: { task: 'T1', track: 'a', reason: 'not-integrated' } });
  });
  it('counts live fronts', () => {
    expect(swarmLive(valid())).toBe(1);
  });
});
