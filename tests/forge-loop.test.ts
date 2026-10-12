import { describe, it, expect } from 'vitest';
import { decideRound } from '../src/forge/loop.js';

const v = (action: 'accept' | 'fix' | 'redo', score: number | null, signature = 's') => ({ action, score, signature });

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
  it('the same failures with the same score twice in a row stalls', () => {
    expect(decideRound([v('fix', 0.6, 'x'), v('fix', 0.6, 'x')], 'medium').next).toBe('stalled');
    expect(decideRound([v('fix', 0.6, 'x'), v('fix', 0.62, 'x')], 'medium').next).toBe('resume');
  });
  it('tierUp is set from round 3, including a redo', () => {
    expect(decideRound([v('fix', 0.6, 'a')], 'medium').tierUp).toBe(false);
    const three = [v('fix', 0.6, 'a'), v('fix', 0.65, 'b'), v('redo', 0.3, 'c')];
    expect(decideRound(three, 'medium')).toMatchObject({ round: 3, next: 'redo', tierUp: true });
    expect(decideRound(three, 'medium').reason).toMatch(/tier up/);
  });
  it('no history yet is round 0, resume (first review pending)', () => {
    expect(decideRound([], 'medium')).toMatchObject({ round: 0, next: 'resume' });
  });
});
