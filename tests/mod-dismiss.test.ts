import { describe, it, expect } from 'vitest';
import { addDismissal, DISMISS_MAX, dismissalKey, dismissalUntil, isDismissed, normalizeDismissals, type Dismissals } from '../src/mod/notice-dismiss.js';

const NOW = Date.parse('2026-10-15T12:00:00.000Z');
const at = (h: number) => new Date(NOW + h * 3600_000).toISOString();

describe('notice dismissals (K5-08)', () => {
  it('a key names the checkout, the project, the kind of notice and its subject', () => {
    expect(dismissalKey('/repo', 'shop', 'previous', 'task:T019')).toBe('/repo|shop|previous|task:T019');
    expect(dismissalKey('/repo', 'shop', 'other-live', 'run:r1')).toBe('/repo|shop|other-live|run:r1');
  });
  it("another live session's notice and the offer it later leaves are dismissed apart, though they share a subject", () => {
    for (const subject of ['task:T019', 'run:r1']) {
      const live = dismissalKey('/repo', 'shop', 'other-live', subject);
      const left = dismissalKey('/repo', 'shop', 'previous', subject);
      expect(live).not.toBe(left);
      const d = addDismissal({}, live, at(24), NOW);
      expect(isDismissed(d, live, NOW), subject).toBe(true);
      expect(isDismissed(d, left, NOW), subject).toBe(false);
    }
  });
  it('a previous notice stays dismissed until its offer ends; another live one for a day', () => {
    expect(dismissalUntil({ kind: 'previous', since: at(-2) }, NOW)).toBe(at(22));
    expect(dismissalUntil({ kind: 'other-live', since: at(-2) }, NOW)).toBe(at(24));
    expect(dismissalUntil({ kind: 'previous', since: null }, NOW)).toBe(at(24));
  });
  it('a previous notice whose offer already ended (a run that has not moved for over a day) stays dismissed a day from now', () => {
    expect(dismissalUntil({ kind: 'previous', since: at(-30) }, NOW)).toBe(at(24));
    expect(dismissalUntil({ kind: 'previous', since: at(-24) }, NOW)).toBe(at(24));
    expect(dismissalUntil({ kind: 'previous', since: 'not a date' }, NOW)).toBe(at(24));
  });
  it('the stored map keeps only strings to dates still ahead; anything else is no dismissal (Review Focus 5)', () => {
    expect(normalizeDismissals({ a: at(1), b: at(-1), c: 'tomorrow', d: 3 }, NOW)).toEqual({ a: at(1) });
    for (const junk of [null, undefined, 'x', ['a'], 42]) expect(normalizeDismissals(junk, NOW)).toEqual({});
  });
  it('adding drops what expired, moves a key to the end and keeps the newest 200', () => {
    let d: Dismissals = { old: at(-1), keep: at(5) };
    d = addDismissal(d, 'new', at(3), NOW);
    expect(d).toEqual({ keep: at(5), new: at(3) });
    d = addDismissal(d, 'keep', at(6), NOW);
    expect(Object.keys(d)).toEqual(['new', 'keep']);
    for (let i = 0; i < 250; i++) d = addDismissal(d, `k${i}`, at(1), NOW);
    expect(Object.keys(d)).toHaveLength(DISMISS_MAX);
    expect(d.k249).toBe(at(1));
    expect(d).not.toHaveProperty('new');
  });
  it('a notice is dismissed only while its date is ahead', () => {
    expect(isDismissed({ a: at(1) }, 'a', NOW)).toBe(true);
    expect(isDismissed({ a: at(-1) }, 'a', NOW)).toBe(false);
    expect(isDismissed({}, 'a', NOW)).toBe(false);
    expect(isDismissed({}, 'toString', NOW)).toBe(false);
  });
});
