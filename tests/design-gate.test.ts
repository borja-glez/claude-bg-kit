import { describe, it, expect } from 'vitest';
import { appliedIn, designGate, mergeDismissed, parseDismissed, pendingProposals, rewroteRound } from '../src/lib/design-gate.js';
import type { ChangelogEntry } from '../src/lib/history.js';
import type { Critique } from '../src/lib/critique.js';

const C = (round: number, version: number, severities: ('critical' | 'major' | 'minor')[]): Critique => ({
  round, version, scope: 'full',
  proposals: severities.map((severity, i) => ({ n: i + 1, category: 'gap', severity, section: '_intro', problem: 'p', change: 'c' })),
});
const E = (version: number, note: string, round: number): ChangelogEntry => ({ version, date: '2026-10-13', note, words: 10, round });

describe('designGate', () => {
  it('never approves without a critique (an imported design with no round)', () => {
    expect(designGate([E(1, 'importado de docs/s.md', 0)], [])).toEqual({ version: 1, rounds: 0, latestRound: null, latestCritiqueVersion: null, criticalPending: [], invalid: [], canAutoApprove: false, pending: [], pendingCounts: { critical: 0, major: 0, minor: 0 } });
  });
  it('waits for a critical proposal not applied yet', () => {
    expect(designGate([E(1, 'v1', 0)], [{ round: 1, critique: C(1, 1, ['major', 'critical']) }])).toMatchObject({ criticalPending: [{ round: 1, n: 2 }], canAutoApprove: false });
  });
  it('approves once the changelog records the critical proposals as applied, or when there were none', () => {
    const log = [E(1, 'v1', 0), E(2, 'round 1: applied 1,2 — fixes', 1)];
    expect(designGate(log, [{ round: 1, critique: C(1, 1, ['major', 'critical']) }])).toMatchObject({ version: 2, rounds: 1, latestRound: 1, latestCritiqueVersion: 1, criticalPending: [], canAutoApprove: true });
    expect(designGate([E(1, 'v1', 0)], [{ round: 1, critique: C(1, 1, ['major', 'minor']) }]).canAutoApprove).toBe(true);
  });
  it('refuses a critique of a newer version and an invalid latest critique', () => {
    expect(designGate([E(1, 'v1', 0)], [{ round: 1, critique: C(1, 3, []) }]).canAutoApprove).toBe(false);
    expect(designGate([E(2, 'x', 1)], [{ round: 1, critique: C(1, 1, []) }, { round: 2, critique: null }])).toMatchObject({ rounds: 1, latestRound: 2, invalid: [2], canAutoApprove: false });
  });
  it('reads only the applied numbers of its own round', () => {
    expect([...appliedIn([E(2, 'round 1: applied 1 — a', 1), E(3, 'round 2: applied 3,4 — b', 2)], 2)]).toEqual([3, 4]);
  });
  it('a critical proposal skipped in an earlier round still blocks auto-approval', () => {
    const log = [E(1, 'v1', 0), E(2, 'round 1: applied 1 — a', 1)];
    const g = designGate(log, [{ round: 1, critique: C(1, 1, ['major', 'critical']) }, { round: 2, critique: C(2, 2, ['minor']) }]);
    expect(g).toMatchObject({ latestRound: 2, criticalPending: [{ round: 1, n: 2 }], canAutoApprove: false });
  });
  it('dismissing that critical lets the gate pass', () => {
    const log = [E(1, 'v1', 0), E(2, 'round 1: applied 1 — a', 1)];
    const g = designGate(log, [{ round: 1, critique: C(1, 1, ['major', 'critical']) }, { round: 2, critique: C(2, 2, []) }], { 1: [2] });
    expect(g).toMatchObject({ criticalPending: [], pending: [], canAutoApprove: true });
  });
});

describe('pending proposals across rounds', () => {
  const crits = [
    { round: 1, critique: C(1, 1, ['critical', 'major', 'minor', 'major', 'minor']) },
    { round: 2, critique: C(2, 2, ['minor', 'major']) },
    { round: 3, critique: null },
  ];
  it('lists every proposal not applied, folded in by a rewrite nor dismissed, in round order', () => {
    const log = [E(1, 'v1', 0), E(2, 'round 1: applied 1,2 — a', 1)];
    const p = pendingProposals(log, crits, { 1: [5] });
    expect(p).toEqual([
      { round: 1, n: 3, severity: 'minor', section: '_intro' },
      { round: 1, n: 4, severity: 'major', section: '_intro' },
      { round: 2, n: 1, severity: 'minor', section: '_intro' },
      { round: 2, n: 2, severity: 'major', section: '_intro' },
    ]);
    expect(designGate(log, crits, { 1: [5] })).toMatchObject({ pending: p, pendingCounts: { critical: 0, major: 2, minor: 2 } });
  });
  it('a rewrite of a round folds in all its proposals, only with the round prefix and its own round', () => {
    expect(rewroteRound([E(2, 'round 2: rewrite — a', 2)], 2)).toBe(true);
    expect(rewroteRound([E(2, 'Round 2: Rewrite of the scope', 2)], 2)).toBe(true);
    expect(rewroteRound([E(2, 'round 2: rewrite', 1)], 2)).toBe(false);
    expect(rewroteRound([E(2, 'rewrote after round 2: rewrite', 2)], 2)).toBe(false);
    const log = [E(1, 'v1', 0), E(2, 'round 1: applied 1,2 — a', 1), E(3, 'round 2: rewrite — x', 2)];
    expect(pendingProposals(log, crits, {}).map(p => `${p.round}.${p.n}`)).toEqual(['1.3', '1.4', '1.5']);
  });
  it('a design with no critique has nothing pending', () => {
    expect(designGate([E(1, 'v1', 0)], [])).toMatchObject({ pending: [], pendingCounts: { critical: 0, major: 0, minor: 0 } });
  });
});

describe('dismissed.json', () => {
  it('parses tolerantly: junk is nothing dismissed, bad entries are dropped', () => {
    expect(parseDismissed(undefined)).toEqual({});
    expect(parseDismissed('{bad')).toEqual({});
    expect(parseDismissed('[1]')).toEqual({});
    expect(parseDismissed('{"1": [3, 1, 3, "x", -2, 1.5], "x": [1], "2": "no"}')).toEqual({ 1: [1, 3] });
  });
  it('merges numbers sorted and without duplicates', () => {
    expect(mergeDismissed({ 1: [6] }, 1, [7, 6])).toEqual({ 1: [6, 7] });
    expect(mergeDismissed({ 1: [6] }, 2, [3, 1])).toEqual({ 1: [6], 2: [1, 3] });
  });
});
