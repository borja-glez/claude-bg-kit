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
  it('duration and span live in src/lib now, and lens still exports the same functions', () => {
    expect(duration(125)).toBe('2m 05s');
    expect(span(90_000)).toBe('>24h');
    expect(span(-1)).toBeNull();
    expect(view.span).toBe(span);
    expect(view.duration).toBe(duration);
  });
});
