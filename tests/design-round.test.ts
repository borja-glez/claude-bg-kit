import { describe, it, expect } from 'vitest';
import { budgetRound, nextRound } from '../src/lib/design-round.js';
import type { ChangelogEntry } from '../src/lib/history.js';

const entry = (version: number, round: number, note: string, kind?: ChangelogEntry['kind']): ChangelogEntry =>
  ({ version, round, note, ...(kind ? { kind } : {}) } as ChangelogEntry);

describe('budgetRound: the round counted from the last reopen', () => {
  it('is the round itself while the design was never reopened', () => {
    expect(budgetRound([], 1)).toBe(1);
    expect(budgetRound([entry(1, 1, 'ronda 1', 'apply')], 2)).toBe(2);
  });
  it('restarts after a reopen, however it was written (kind or an old note)', () => {
    const approved = entry(2, 2, 'aprobado', 'approve');
    expect(budgetRound([approved, entry(3, 2, 'reabierto', 'reopen')], 3)).toBe(1);
    expect(budgetRound([approved, entry(3, 2, 'reabierto para T044')], 4)).toBe(2);
  });
  it('counts from the latest reopen only', () => {
    const log = [entry(2, 2, 'x', 'reopen'), entry(3, 5, 'y', 'reopen')];
    expect(budgetRound(log, 6)).toBe(1);
  });
  it('never gives a round below 1, nor a non-number', () => {
    const log = [entry(2, 4, 'x', 'reopen')];
    expect(budgetRound(log, 4)).toBe(1);
    expect(budgetRound(log, 2)).toBe(1);
    expect(budgetRound([], 0)).toBe(1);
    expect(budgetRound([], -3)).toBe(1);
    expect(budgetRound([], NaN)).toBe(1);
  });
  it('counts only whole rounds of the changelog: a fractional or infinite one is 0 (carry 6)', () => {
    expect(budgetRound([entry(2, 2.5, 'x', 'reopen')], 3)).toBe(3);
    expect(budgetRound([entry(2, Infinity, 'x', 'reopen')], 3)).toBe(3);
    const next = (round: number) => nextRound({ changelog: [entry(1, round, 'x')], critiques: [], history: {}, current: '', sections: [] }).round;
    expect(next(2.5)).toBe(1);
    expect(next(Infinity)).toBe(1);
    expect(next(2)).toBe(3);
  });
});
