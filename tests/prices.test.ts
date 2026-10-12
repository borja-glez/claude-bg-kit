import { describe, it, expect } from 'vitest';
import { priceFor, stepCost, tokensCost, shortModelName, PRICES_AS_OF } from '../src/lib/prices.js';

const T = (input: number, output = 0, cacheRead = 0, cacheWrite = 0) => ({ input, output, cacheRead, cacheWrite });

describe('prices', () => {
  it('matches by id prefix, most specific first, ignoring suffixes', () => {
    expect(priceFor('claude-opus-5-5')).toEqual({ input: 4, output: 20, cacheRead: 0.2, cacheWrite: 8 });
    expect(priceFor('claude-opus-5-5[1m]')).toEqual(priceFor('claude-opus-5-5'));
    expect(priceFor('claude-opus-5-20260101')).toEqual({ input: 5, output: 25, cacheRead: 0.5, cacheWrite: 10 });
    expect(priceFor('claude-sonnet-5-5')).toEqual({ input: 2, output: 10, cacheRead: 0.1, cacheWrite: 4 });
    expect(priceFor('claude-fable-5-1')).toEqual({ input: 10, output: 50, cacheRead: 0.25, cacheWrite: 20 });
    expect(priceFor('claude-haiku-4-5-20251001')).toEqual({ input: 1, output: 5, cacheRead: 0.1, cacheWrite: 2 });
    expect(priceFor('gpt-9')).toBeNull();
  });
  it('prices Mythos 5 as Fable 5, apart from Mythos 5.1', () => {
    expect(priceFor('claude-mythos-5')).toEqual({ input: 10, output: 50, cacheRead: 1, cacheWrite: 20 });
    expect(priceFor('claude-mythos-5[1m]')).toEqual(priceFor('claude-fable-5'));
    expect(priceFor('claude-mythos-5-1')).toEqual({ input: 10, output: 50, cacheRead: 0.25, cacheWrite: 20 });
  });
  it('picks the Haiku 5.5 tier by prompt size', () => {
    expect(priceFor('claude-haiku-5-5', 50_000)).toEqual({ input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.2 });
    expect(priceFor('claude-haiku-5-5', 100_001)).toEqual({ input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 1 });
  });
  it('costs a step per token kind, with the tier of that step', () => {
    expect(stepCost('claude-opus-5-5', T(1_000_000, 1_000_000, 1_000_000, 1_000_000))).toBeCloseTo(4 + 20 + 0.2 + 8);
    expect(stepCost('claude-haiku-5-5', T(90_000, 0, 20_000))).toBeCloseTo((90_000 * 0.5 + 20_000 * 0.05) / 1e6);
    expect(tokensCost('claude-haiku-5-5', T(90_000, 0, 20_000))).toBeCloseTo((90_000 * 0.1 + 20_000 * 0.01) / 1e6);
    expect(stepCost('unknown-model', T(10))).toBeNull();
  });
  it('names models shortly', () => {
    expect(shortModelName('claude-opus-5-5')).toBe('Opus 5.5');
    expect(shortModelName('claude-opus-5-5[1m]')).toBe('Opus 5.5');
    expect(shortModelName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5');
    expect(shortModelName('claude-fable-5-1')).toBe('Fable 5.1');
    expect(shortModelName('claude-sonnet-5')).toBe('Sonnet 5');
    expect(shortModelName('some-very-long-unknown-model-id-xyz')).toBe('some-very-long-unknown…');
    expect(PRICES_AS_OF).toBe('2026-10-12');
  });
});
