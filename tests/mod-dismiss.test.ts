import { describe, it, expect } from 'vitest';
import { addDismissal, DISMISS_MAX, dismissalKey, dismissalUntil, isDismissed, normalizeDismissals, type Dismissals } from '../src/mod/notice-dismiss.js';

const NOW = Date.parse('2026-10-15T12:00:00.000Z');
const at = (h: number) => new Date(NOW + h * 3600_000).toISOString();
/** The key of a previous notice about `subject` in project shop of /repo. */
const K = (subject: string) => dismissalKey('/repo', 'shop', 'previous', subject);

describe('notice dismissals (K5-08)', () => {
  it('a key names the checkout, the project, the kind of notice and its subject', () => {
    expect(dismissalKey('/repo', 'shop', 'previous', 'task:T019')).toBe('["/repo","shop","previous","task:T019"]');
    expect(dismissalKey('/repo', 'shop', 'other-live', 'run:r1')).toBe('["/repo","shop","other-live","run:r1"]');
  });
  it('a | in a project name, a root or a run id never makes two notices share a key (M7)', () => {
    // Joined with |, both of these were "/r|a|other-live|previous|k".
    expect(dismissalKey('/r', 'a|other-live', 'previous', 'k')).not.toBe(dismissalKey('/r', 'a', 'other-live', 'previous|k'));
    expect(dismissalKey('/r|a', 'b', 'previous', 'run:r1')).not.toBe(dismissalKey('/r', 'a|b', 'previous', 'run:r1'));
    const d = addDismissal({}, dismissalKey('/r', 'a|other-live', 'previous', 'k'), at(24), NOW);
    expect(isDismissed(d, dismissalKey('/r', 'a|other-live', 'previous', 'k'), NOW)).toBe(true);
    expect(isDismissed(d, dismissalKey('/r', 'a', 'other-live', 'previous|k'), NOW)).toBe(false);
  });
  it('an older |-joined key, or any other that dismissalKey does not build, is dropped: its notice shows once more (M7)', () => {
    expect(normalizeDismissals({ '/repo|shop|previous|task:T019': at(5), [K('task:T019')]: at(5) }, NOW)).toEqual({ [K('task:T019')]: at(5) });
    for (const k of ['["/repo","shop","previous"]', '[1,2,3,4]', '{"a":1}', 'null', '']) expect(normalizeDismissals({ [k]: at(5) }, NOW), k).toEqual({});
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
    expect(normalizeDismissals({ [K('a')]: at(1), [K('b')]: at(-1), [K('c')]: 'tomorrow', [K('d')]: 3 }, NOW)).toEqual({ [K('a')]: at(1) });
    for (const junk of [null, undefined, 'x', ['a'], 42]) expect(normalizeDismissals(junk, NOW)).toEqual({});
  });
  it('adding drops what expired, moves a key to the end and keeps the newest 200', () => {
    let d: Dismissals = { [K('old')]: at(-1), [K('keep')]: at(5) };
    d = addDismissal(d, K('new'), at(3), NOW);
    expect(d).toEqual({ [K('keep')]: at(5), [K('new')]: at(3) });
    d = addDismissal(d, K('keep'), at(6), NOW);
    expect(Object.keys(d)).toEqual([K('new'), K('keep')]);
    for (let i = 0; i < 250; i++) d = addDismissal(d, K(`k${i}`), at(1), NOW);
    expect(Object.keys(d)).toHaveLength(DISMISS_MAX);
    expect(d[K('k249')]).toBe(at(1));
    expect(d).not.toHaveProperty([K('new')]);
  });
  it('a notice is dismissed only while its date is ahead', () => {
    expect(isDismissed({ a: at(1) }, 'a', NOW)).toBe(true);
    expect(isDismissed({ a: at(-1) }, 'a', NOW)).toBe(false);
    expect(isDismissed({}, 'a', NOW)).toBe(false);
    expect(isDismissed({}, 'toString', NOW)).toBe(false);
  });
});
