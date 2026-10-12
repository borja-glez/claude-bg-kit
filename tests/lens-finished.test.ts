import { describe, it, expect } from 'vitest';
import { pushFinished, freshFinished, withoutRunning, FINISHED_MAX, FINISHED_TTL_MS, type FinishedAgent } from '../src/lens/finished.js';

const f = (id: string, at: number): FinishedAgent => ({ id, type: 'Explore', seconds: 10, at });

describe('finished subagents', () => {
  it('keeps the newest five, one per id', () => {
    let list: FinishedAgent[] = [];
    for (let i = 0; i < 7; i++) list = pushFinished(list, f(`a${i}`, i));
    expect(list.map(x => x.id)).toEqual(['a2', 'a3', 'a4', 'a5', 'a6']);
    expect(FINISHED_MAX).toBe(5);
    list = pushFinished(list, f('a3', 99));
    expect(list.map(x => x.id)).toEqual(['a2', 'a4', 'a5', 'a6', 'a3']);
  });
  it('an id that is running again appears once, as running', () => {
    const list = [f('a', 1), f('b', 2)];
    expect(withoutRunning(list, [{ id: 'b' }, { id: 'c' }]).map(x => x.id)).toEqual(['a']);
    expect(withoutRunning(list, [])).toEqual(list);
  });
  it('drops entries older than five minutes and any from the future', () => {
    const now = 1_000_000;
    const list = [f('old', now - FINISHED_TTL_MS - 1), f('edge', now - FINISHED_TTL_MS + 1), f('new', now), f('future', now + 60_000)];
    expect(freshFinished(list, now).map(x => x.id)).toEqual(['edge', 'new']);
  });
});
