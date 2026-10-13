import { describe, it, expect } from 'vitest';
import { appliedIn, designGate } from '../src/lib/design-gate.js';
import type { ChangelogEntry } from '../src/lib/history.js';
import type { Critique } from '../src/lib/critique.js';

const C = (round: number, version: number, severities: ('critical' | 'major' | 'minor')[]): Critique => ({
  round, version, scope: 'full',
  proposals: severities.map((severity, i) => ({ n: i + 1, category: 'gap', severity, section: '_intro', problem: 'p', change: 'c' })),
});
const E = (version: number, note: string, round: number): ChangelogEntry => ({ version, date: '2026-10-13', note, words: 10, round });

describe('designGate', () => {
  it('never approves without a critique (an imported design with no round)', () => {
    expect(designGate([E(1, 'importado de docs/s.md', 0)], [])).toEqual({ version: 1, rounds: 0, latestRound: null, latestCritiqueVersion: null, criticalPending: [], invalid: [], canAutoApprove: false });
  });
  it('waits for a critical proposal not applied yet', () => {
    expect(designGate([E(1, 'v1', 0)], [{ round: 1, critique: C(1, 1, ['major', 'critical']) }])).toMatchObject({ criticalPending: [2], canAutoApprove: false });
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
});
