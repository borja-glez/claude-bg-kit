import { describe, it, expect } from 'vitest';
import { decideRound, nextImplementer, stepUp, reviewsOf, IMPL_LADDER } from '../src/forge/loop.js';

const v = (action: 'accept' | 'fix' | 'redo', score: number | null, signature = 's') => ({ action, score, signature: `v2:${signature}` });

describe('decideRound', () => {
  it('accept is done', () => { expect(decideRound([v('fix', 0.6, 'a'), v('accept', 0.9)], 'medium').next).toBe('done'); });
  it('rounds 1-2 resume, 3+ fresh-stronger', () => {
    expect(decideRound([v('fix', 0.6, 'a')], 'medium')).toMatchObject({ round: 1, cap: 3, next: 'resume' });
    expect(decideRound([v('fix', 0.6, 'a'), v('fix', 0.65, 'b')], 'medium')).toMatchObject({ round: 2, next: 'resume' });
    expect(decideRound([v('fix', 0.6, 'a'), v('fix', 0.65, 'b'), v('fix', 0.68, 'c')], 'medium')).toMatchObject({ round: 3, next: 'fresh-stronger' });
  });
  it('redo is its own next step and counts as a round', () => {
    expect(decideRound([v('redo', 0.3, 'a')], 'medium')).toMatchObject({ round: 1, next: 'redo' });
  });
  it('past the cap the breaker trips (3 medium, 4 large)', () => {
    const four = [v('fix', 0.6, 'a'), v('fix', 0.6, 'b'), v('fix', 0.6, 'c'), v('fix', 0.6, 'd')];
    expect(decideRound(four, 'medium').next).toBe('breaker');
    expect(decideRound(four, 'large').next).toBe('fresh-stronger');
    expect(decideRound([...four, v('fix', 0.6, 'e')], 'large').next).toBe('breaker');
  });
  it('the same blocking set (by id) as the previous review stalls, whatever the score (C-05)', () => {
    expect(decideRound([v('fix', 0.6, 'x'), v('fix', 0.6, 'x')], 'medium').next).toBe('stalled');
    expect(decideRound([v('fix', 0.6, 'x'), v('fix', 0.62, 'x')], 'medium')).toMatchObject({ next: 'stalled', reason: 'the same blocking findings as the previous review' });
    expect(decideRound([v('fix', 0.6, 'x'), v('fix', 0.6, 'y')], 'medium').next).toBe('resume');
  });
  it('a held review (an express one whose correctness did not answer) never stalls, and a later review compares with the last one that was not held', () => {
    const held = (signature: string) => ({ ...v('fix', 0.6, signature), held: true });
    expect(decideRound([v('fix', 0.6, 'x'), held('x')], 'medium')).toMatchObject({ round: 2, next: 'resume' });
    // Reviews 1 and 3 are real re-review results with the same blocking set: the held review between them hides nothing.
    expect(decideRound([v('fix', 0.6, 'x'), held('x'), v('fix', 0.6, 'x')], 'medium')).toMatchObject({ round: 3, next: 'stalled' });
    expect(decideRound([v('fix', 0.6, 'x'), held('x'), v('fix', 0.6, 'y')], 'medium')).toMatchObject({ round: 3, next: 'fresh-stronger' });
    expect(decideRound([v('fix', 0.6, 'x'), v('fix', 0.6, 'x')], 'medium').next).toBe('stalled');
  });
  it('an accept between two reviews with the same blocking set does not stall the later one (C-T4)', () => {
    expect(decideRound([v('fix', 0.6, 'x'), v('accept', 0.9, 'x'), v('fix', 0.6, 'x')], 'medium').next).not.toBe('stalled');
    expect(decideRound([v('fix', 0.6, 'x'), v('accept', 0.9), v('fix', 0.6, 'x')], 'medium')).toMatchObject({ round: 2, next: 'resume' });
  });
  it('nothing blocking never stalls, and a signature of forge 0.17 or older never matches (C-05)', () => {
    expect(decideRound([{ action: 'fix', score: 0.6, signature: '' }, { action: 'fix', score: 0.6, signature: '' }], 'medium').next).toBe('resume');
    expect(decideRound([{ action: 'fix', score: 0.6, signature: 'abc' }, { action: 'fix', score: 0.6, signature: 'abc' }], 'medium').next).toBe('resume');
    expect(decideRound([{ action: 'fix', score: 0.6, signature: 'abc' }, v('fix', 0.6, 'abc')], 'medium').next).toBe('resume');
  });
  it('reviewsOf counts the reviews of a brief: at most 4 on Medium and 5 on Large (C-13)', () => {
    expect(reviewsOf(2, 'medium')).toEqual({ n: 2, max: 4 });
    expect(reviewsOf(1, 'large')).toEqual({ n: 1, max: 5 });
    expect(reviewsOf(1, 'small')).toEqual({ n: 1, max: 4 });
  });
  it('tierUp is set from round 3, including a redo', () => {
    expect(decideRound([v('fix', 0.6, 'a')], 'medium').tierUp).toBe(false);
    const three = [v('fix', 0.6, 'a'), v('fix', 0.65, 'b'), v('redo', 0.3, 'c')];
    expect(decideRound(three, 'medium')).toMatchObject({ round: 3, next: 'redo', tierUp: true });
    expect(decideRound(three, 'medium').reason).toMatch(/tier up/);
  });
  it('no history yet is round 0, resume (first review pending)', () => {
    expect(decideRound([], 'medium')).toMatchObject({ round: 0, next: 'resume', last: false });
  });
  it('last is set only on the attempt before the cap: round 3 on Medium, 4 on Large', () => {
    const fixes = (n: number) => Array.from({ length: n }, (_, i) => v('fix', 0.6 + i / 100, String(i)));
    for (let n = 0; n <= 4; n++) expect(decideRound(fixes(n), 'medium').last).toBe(n === 3);
    for (let n = 0; n <= 5; n++) expect(decideRound(fixes(n), 'large').last).toBe(n === 4);
    // A redo on the last round is the last attempt too; the breaker, a stall and done are no attempt.
    expect(decideRound([...fixes(2), v('redo', 0.3, 'r')], 'medium')).toMatchObject({ next: 'redo', last: true });
    expect(decideRound([...fixes(2), v('fix', 0.61, '1')], 'medium')).toMatchObject({ next: 'stalled', last: false });
    expect(decideRound([...fixes(3), v('accept', 0.9)], 'medium')).toMatchObject({ next: 'done', last: false });
  });
});

describe('the implementer ladder', () => {
  it('stepUp climbs one rung: mech, impl-light, impl, impl-high, impl-heavy (the top stays)', () => {
    expect(IMPL_LADDER).toEqual(['mech', 'impl-light', 'impl', 'impl-high', 'impl-heavy']);
    expect(stepUp('mech')).toBe('impl-light');
    expect(stepUp('impl-light')).toBe('impl');
    expect(stepUp('impl')).toBe('impl-high');
    expect(stepUp('impl-high')).toBe('impl-heavy');
    expect(stepUp('impl-heavy')).toBe('impl-heavy');
  });
  const fixes = (n: number) => Array.from({ length: n }, (_, i) => v('fix', 0.6 + i / 100, String(i)));
  it('resume and a redo without tierUp keep the implementer', () => {
    expect(nextImplementer(decideRound(fixes(1), 'medium'), 'impl')).toBe('impl');
    expect(nextImplementer(decideRound([v('redo', 0.3, 'a')], 'medium'), 'mech')).toBe('mech');
  });
  it('fresh-stronger and a redo with tierUp climb one rung when the attempt is not the last', () => {
    expect(nextImplementer(decideRound(fixes(3), 'large'), 'impl')).toBe('impl-high');
    expect(nextImplementer(decideRound(fixes(3), 'large'), 'mech')).toBe('impl-light');
    expect(nextImplementer(decideRound([...fixes(2), v('redo', 0.3, 'r')], 'large'), 'impl-light')).toBe('impl');
  });
  it('the last attempt goes to impl-heavy from any rung', () => {
    for (const role of IMPL_LADDER) {
      expect(nextImplementer(decideRound(fixes(3), 'medium'), role)).toBe('impl-heavy');
      expect(nextImplementer(decideRound(fixes(4), 'large'), role)).toBe('impl-heavy');
    }
  });
  it('done, the breaker and a stall launch nobody', () => {
    expect(nextImplementer(decideRound([v('accept', 0.9)], 'medium'), 'impl')).toBeNull();
    expect(nextImplementer(decideRound(fixes(4), 'medium'), 'impl')).toBeNull();
    expect(nextImplementer(decideRound([v('fix', 0.6, 'x'), v('fix', 0.6, 'x')], 'medium'), 'impl')).toBeNull();
  });
});
