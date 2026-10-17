import { describe, it, expect } from 'vitest';
import { appliedIn, appliedVersion, designGate, mergeDismissed, parseDismissed, pendingProposals, resolvedIn, rewroteRound } from '../src/lib/design-gate.js';
import type { ChangelogEntry } from '../src/lib/history.js';
import type { Critique } from '../src/lib/critique.js';

const C = (round: number, version: number, severities: ('critical' | 'major' | 'minor')[]): Critique => ({
  round, version, scope: 'full',
  proposals: severities.map((severity, i) => ({ n: i + 1, category: 'gap', severity, section: '_intro', problem: 'p', change: 'c' })),
});
const E = (version: number, note: string, round: number): ChangelogEntry => ({ version, date: '2026-10-13', note, words: 10, round });

describe('designGate', () => {
  it('never approves without a critique (an imported design with no round)', () => {
    expect(designGate([E(1, 'importado de docs/s.md', 0)], [])).toEqual({
      version: 1, rounds: 0, latestRound: null, latestCritiqueVersion: null, criticalPending: [], invalid: [], canAutoApprove: false,
      pending: [], pendingCounts: { critical: 0, major: 0, minor: 0 }, dismissed: [], resolved: [], applied: [],
    });
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
    const g = designGate(log, [{ round: 1, critique: C(1, 1, ['major', 'critical']) }, { round: 2, critique: C(2, 2, []) }], { 1: [{ n: 2 }] });
    expect(g).toMatchObject({ criticalPending: [], pending: [], canAutoApprove: true });
  });
});

describe('pending proposals across rounds', () => {
  const crits = [
    { round: 1, critique: C(1, 1, ['critical', 'major', 'minor', 'major', 'minor']) },
    { round: 2, critique: C(2, 2, ['minor', 'major']) },
    { round: 3, critique: null },
  ];
  it('lists every proposal not applied, folded in by a rewrite nor dismissed, in round order, with its problem', () => {
    const log = [E(1, 'v1', 0), E(2, 'round 1: applied 1,2 — a', 1)];
    const p = pendingProposals(log, crits, { 1: [{ n: 5 }] });
    expect(p).toEqual([
      { round: 1, n: 3, severity: 'minor', section: '_intro', problem: 'p' },
      { round: 1, n: 4, severity: 'major', section: '_intro', problem: 'p' },
      { round: 2, n: 1, severity: 'minor', section: '_intro', problem: 'p' },
      { round: 2, n: 2, severity: 'major', section: '_intro', problem: 'p' },
    ]);
    expect(designGate(log, crits, { 1: [{ n: 5 }] })).toMatchObject({ pending: p, pendingCounts: { critical: 0, major: 2, minor: 2 } });
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

describe('dismissed.json with reasons (K3-05)', () => {
  it('reads the shape of numbers and the shape with reasons; junk is nothing dismissed, bad entries are dropped', () => {
    expect(parseDismissed(undefined)).toEqual({});
    expect(parseDismissed('{bad')).toEqual({});
    expect(parseDismissed('[1]')).toEqual({});
    expect(parseDismissed('{"1": [3, 1, 3, "x", -2, 1.5], "x": [1], "2": "no"}')).toEqual({ 1: [{ n: 1 }, { n: 3 }] });
    expect(parseDismissed(JSON.stringify({ 1: [{ n: 2, reason: 'fuera de alcance' }, { n: 5 }], 2: [4] })))
      .toEqual({ 1: [{ n: 2, reason: 'fuera de alcance' }, { n: 5 }], 2: [{ n: 4 }] });
  });
  it('cleans a hostile reason: controls and bidi become spaces, 300 characters at most, a reason that is not text is none (Review Focus 4)', () => {
    const bidi = String.fromCharCode(0x202e);
    const nul = String.fromCharCode(0);
    const got = parseDismissed(JSON.stringify({ 1: [
      { n: 2, reason: `fuera${bidi}\nde${nul}alcance` }, { n: 0, reason: 'x' }, { reason: 'x' }, { n: 7, reason: 9 }, { n: 8, reason: 'z'.repeat(400) }, { n: 9, reason: '   ' },
    ] }));
    expect(got).toEqual({ 1: [{ n: 2, reason: 'fuera de alcance' }, { n: 7 }, { n: 8, reason: 'z'.repeat(300) }, { n: 9 }] });
  });
  it('merges numbers sorted; a new reason replaces the old one, and no reason keeps it', () => {
    expect(mergeDismissed({ 1: [{ n: 6, reason: 'a' }] }, 1, [7, 6])).toEqual({ 1: [{ n: 6, reason: 'a' }, { n: 7 }] });
    expect(mergeDismissed({ 1: [{ n: 6, reason: 'a' }] }, 1, [6], 'b')).toEqual({ 1: [{ n: 6, reason: 'b' }] });
    expect(mergeDismissed({ 1: [{ n: 6 }] }, 2, [3, 1], '   ')).toEqual({ 1: [{ n: 6 }], 2: [{ n: 1 }, { n: 3 }] });
  });
});

describe('applied and rewrite: structured first, old notes in English or Spanish as a fallback (A-04, K3-01)', () => {
  const S = (version: number, round: number, applied?: Record<number, number[]>, rewrite?: true, note = 'resumen'): ChangelogEntry =>
    ({ ...E(version, note, round), ...(applied ? { applied } : {}), ...(rewrite ? { rewrite } : {}) });
  const sorted = (s: Set<number>) => [...s].sort((a, b) => a - b);
  it('counts the structured applied numbers of every entry', () => {
    expect(sorted(appliedIn([S(2, 2, { 1: [4, 5], 2: [2] }), S(3, 2, { 1: [1] })], 1))).toEqual([1, 4, 5]);
    expect(sorted(appliedIn([S(2, 2, { 1: [4, 5], 2: [2] })], 2))).toEqual([2]);
  });
  it('reads the old notes in Spanish and in English', () => {
    expect(sorted(appliedIn([E(2, 'ronda 1: aplicadas 1,3 — criterio de terminado', 1)], 1))).toEqual([1, 3]);
    expect(sorted(appliedIn([E(2, 'ronda 1: aplicadas 1, 3 y 5 — x', 1)], 1))).toEqual([1, 3, 5]);
    expect(sorted(appliedIn([E(2, 'Round 2: Applied 3 and 4', 2)], 2))).toEqual([3, 4]);
  });
  it('never passes the note of a structured entry through the regex', () => {
    expect(sorted(appliedIn([S(2, 1, { 1: [2] }, undefined, 'round 1: applied 7')], 1))).toEqual([2]);
    expect(rewroteRound([S(2, 2, { 1: [1] }, undefined, 'round 2: rewrite')], 2)).toBe(false);
  });
  it('a rewrite folds in its own round, structured or from an old note', () => {
    expect(rewroteRound([S(3, 2, undefined, true)], 2)).toBe(true);
    expect(rewroteRound([S(3, 2, undefined, true)], 1)).toBe(false);
    expect(rewroteRound([E(3, 'ronda 2: reescritura completa', 2)], 2)).toBe(true);
  });
  it('structured entries and old notes of the same round count each number once', () => {
    expect(sorted(appliedIn([E(2, 'ronda 1: aplicadas 1,3 — a', 1), S(3, 1, { 1: [3, 4] })], 1))).toEqual([1, 3, 4]);
  });
  it('with the notes of the real reparto changelogs, the applied proposals are no longer pending', () => {
    const sev = (s: string) => s.split('').map(c => (c === 'M' ? 'major' : 'minor') as 'major' | 'minor');
    const reparto = [E(1, 'Borrador inicial', 0), E(2, 'ronda 1: aplicadas 1,3 — criterio de terminado de settle con casos fijos', 1), E(3, 'entrevista: formulario', 1), E(4, 'aprobado', 1)];
    const a = pendingProposals(reparto, [{ round: 1, critique: C(1, 1, sev('MmMMMMmmmmm')) }, { round: 2, critique: C(2, 2, sev('MMmmmmmmm')) }]);
    expect(a).toHaveLength(18);
    expect(a.filter(p => p.round === 1).map(p => p.n)).toEqual([2, 4, 5, 6, 7, 8, 9, 10, 11]);
    const reparto2 = [E(1, 'Borrador inicial', 0), E(2, 'ronda 1: aplicadas 1,2,3,4,5 — tipos de respuesta', 1),
      E(3, 'ronda 2: aplicadas 1,2,3,4,5,6,7 — dependencias en la Base', 2), E(4, 'entrevista: autorrelleno', 2), E(5, 'aprobado', 2)];
    const b = pendingProposals(reparto2, [{ round: 1, critique: C(1, 1, sev('MMMMMmmmmm')) }, { round: 2, critique: C(2, 2, sev('MMMmmmm')) }]);
    expect(b.map(p => `${p.round}.${p.n}`)).toEqual(['1.6', '1.7', '1.8', '1.9', '1.10']);
  });
});

describe('resolved in an interview, and what the gate hands the next critic (K3-02, K3-04, K3-05)', () => {
  const named = (round: number, version: number, sevs: ('critical' | 'major' | 'minor')[]): Critique => ({
    round, version, scope: 'full',
    proposals: sevs.map((severity, i) => ({ n: i + 1, category: 'gap', severity, section: `s${i + 1}`, problem: `p${i + 1}`, change: `c${i + 1}` })),
  });
  it('a proposal an interview resolved is no longer pending', () => {
    const log: ChangelogEntry[] = [E(1, 'v1', 0), { ...E(2, 'entrevista', 1), resolved: [{ round: 1, n: 2 }] }];
    expect([...resolvedIn(log, 1)]).toEqual([2]);
    expect([...resolvedIn(log, 2)]).toEqual([]);
    expect(pendingProposals(log, [{ round: 1, critique: named(1, 1, ['major', 'major']) }]).map(p => p.n)).toEqual([1]);
  });
  it('the gate lists what was dismissed with its reason, resolved and applied, round by round', () => {
    const log: ChangelogEntry[] = [E(1, 'v1', 0), { ...E(2, 'ronda 1', 1), applied: { 1: [1] }, resolved: [{ round: 1, n: 3 }] }];
    const crits = [{ round: 2, critique: named(2, 2, ['minor']) }, { round: 1, critique: named(1, 1, ['critical', 'major', 'major', 'minor']) }, { round: 3, critique: null }];
    const g = designGate(log, crits, { 1: [{ n: 2, reason: 'no aplica' }, { n: 4 }], 2: [{ n: 1 }] });
    expect(g.applied).toEqual([{ round: 1, n: 1, section: 's1', change: 'c1' }]);
    expect(g.resolved).toEqual([{ round: 1, n: 3, section: 's3', problem: 'p3' }]);
    expect(g.dismissed).toEqual([
      { round: 1, n: 2, section: 's2', problem: 'p2', reason: 'no aplica' },
      { round: 1, n: 4, section: 's4', problem: 'p4' },
      { round: 2, n: 1, section: 's1', problem: 'p1' },
    ]);
    expect(g.pending).toEqual([]);
    expect(g.rounds).toBe(2);
  });
  it('bounds the lists for the critic: newest 40 of each, texts cleaned and clipped to 300 code points, the rest counted', () => {
    const bidi = String.fromCharCode(0x202e);
    const long = `${bidi}\n` + '😀'.repeat(5000);
    const proposals = Array.from({ length: 200 }, (_, i) => ({ n: i + 1, category: 'gap' as const, severity: 'minor' as const, section: long, problem: long, change: long }));
    const crit: Critique = { round: 1, version: 1, scope: 'full', proposals };
    const all = Array.from({ length: 200 }, (_, i) => i + 1);
    const log: ChangelogEntry[] = [E(1, 'v1', 0), { ...E(2, 'x', 1), applied: { 1: all }, resolved: all.map(n => ({ round: 1, n })) }];
    const g = designGate(log, [{ round: 1, critique: crit }], { 1: all.map(n => ({ n })) });
    for (const list of [g.dismissed, g.resolved, g.applied]) expect(list).toHaveLength(40);
    expect(g.dismissed.map(x => x.n)).toEqual(all.slice(160));
    expect(g).toMatchObject({ dismissedMore: 160, resolvedMore: 160, appliedMore: 160 });
    expect(Array.from(g.dismissed[0].problem)).toHaveLength(300);
    expect(g.dismissed[0].problem).not.toContain(bidi);
    expect(g.applied[0].change.startsWith('😀')).toBe(true);
    expect(JSON.stringify(g).length).toBeLessThan(150_000);
  });
  it('appliedVersion names the version whose entry applied a proposal, structured or from an old note', () => {
    const log: ChangelogEntry[] = [E(1, 'v1', 0), E(2, 'round 1: applied 2 — a', 1), { ...E(3, 'x', 1), applied: { 1: [1] } }];
    expect(appliedVersion(log, 1, 2)).toBe(2);
    expect(appliedVersion(log, 1, 1)).toBe(3);
    expect(appliedVersion(log, 1, 5)).toBeNull();
    expect(appliedVersion(log, 2, 2)).toBeNull();
  });
});
