import { describe, it, expect } from 'vitest';
import { failureText } from '../src/lens/failure.js';

// w8 M3, review Minor 7: why /lens failed, in the words its .catch answers with (next.error is a HookFailure).
const T = { outOfTime: 'it ran out of time', failedPlain: 'it failed' };

describe('failureText (w8 M3)', () => {
  it('a timeout says it ran out of time, with what its last next() rejected with when there was something', () => {
    expect(failureText(T, { kind: 'timeout', budget: 1000 })).toBe('it ran out of time');
    expect(failureText(T, { kind: 'timeout', message: '  ', budget: 1000 })).toBe('it ran out of time');
    expect(failureText(T, { kind: 'timeout', message: 'ui.open was refused', budget: 1000 })).toBe('it ran out of time (ui.open was refused)');
  });
  it('a throw says its message on one line, at most 200 characters; without one, that it failed', () => {
    expect(failureText(T, { kind: 'throw', message: 'no surface\n  can seat it', budget: 1000 })).toBe('no surface can seat it');
    expect(failureText(T, { kind: 'throw', message: 'x'.repeat(300), budget: 1000 })).toHaveLength(200);
    expect(failureText(T, { kind: 'throw', budget: 1000 })).toBe('it failed');
    expect(failureText(T, undefined)).toBe('it failed');
  });
});
