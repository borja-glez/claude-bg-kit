import { describe, it, expect } from 'vitest';
import { duration, minutesText, span } from '../src/lib/duration.js';
import * as view from '../src/lens/view.js';

describe('durations (F-11)', () => {
  it('whole minutes as the band says them, long and compact', () => {
    expect([5, 45, 60, 61, 120, 598].map(m => minutesText(m))).toEqual(['5 m', '45 m', '1 h', '1 h 1 m', '2 h', '9 h 58 m']);
    expect([5, 120, 598].map(m => minutesText(m, true))).toEqual(['5m', '2h', '9h58m']);
    expect(minutesText(-3)).toBe('0 m');
    expect(minutesText(Number.NaN)).toBe('0 m');
  });
  it('boundaries: 0, 59, 59.9, 60, 119, and the non-finite ones', () => {
    expect([0, 59, 59.9, 60, 119].map(m => minutesText(m))).toEqual(['0 m', '59 m', '59 m', '1 h', '1 h 59 m']);
    expect([0, 59, 60, 119].map(m => minutesText(m, true))).toEqual(['0m', '59m', '1h', '1h59m']);
    expect([Infinity, -Infinity].map(m => minutesText(m))).toEqual(['0 m', '0 m']);
  });
  it('a huge value prints the cap with a «+», never an exponent (99 999 days)', () => {
    const cap = 99_999 * 1440;
    expect(minutesText(cap - 1)).toBe('2399975 h 59 m');
    expect(minutesText(cap)).toBe('2399976 h+');
    expect(minutesText(1e21)).toBe('2399976 h+');
    expect(minutesText(1e25, true)).toBe('2399976h+');
  });
  it('duration boundaries', () => {
    expect([0, 59, 60, 3599, 3600].map(s => duration(s))).toEqual(['0s', '59s', '1m 00s', '59m 59s', '1h 00m']);
    expect(span(0)).toBe('0s');
    expect(span(86_400)).toBe('24h 00m');
    expect(span(86_401)).toBe('>24h');
    expect(span(Number.POSITIVE_INFINITY)).toBeNull();
  });
  it('duration and span live in src/lib now, and lens still exports the same functions', () => {
    expect(duration(125)).toBe('2m 05s');
    expect(span(90_000)).toBe('>24h');
    expect(span(-1)).toBeNull();
    expect(view.span).toBe(span);
    expect(view.duration).toBe(duration);
  });
});
