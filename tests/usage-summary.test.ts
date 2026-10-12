import { describe, it, expect } from 'vitest';
import { newUsage, recordStep, labelLoop, recordTracking } from '../src/lens/usage.js';
import { summarizeUsage, groupOf } from '../src/lens/usage-summary.js';

const U = (i: number, o: number) => ({ input_tokens: i, output_tokens: o, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
const M = 1_000_000;

describe('usage summary', () => {
  it('groups loops by kind', () => {
    expect(groupOf('main', 'main')).toBe('main');
    expect(groupOf('s1/main', 'main')).toBe('main');
    expect(groupOf('a', 'forge:forge-impl-heavy')).toBe('impl');
    expect(groupOf('a', 'forge:forge-mech')).toBe('impl');
    expect(groupOf('a', 'forge:forge-fable')).toBe('impl');
    expect(groupOf('a', 'forge:forge-review-perf')).toBe('review');
    expect(groupOf('a', 'forge:forge-planner')).toBe('plan');
    expect(groupOf('a', 'forge:forge-scout')).toBe('plan');
    expect(groupOf('a', 'waypoint:design-critic')).toBe('plan');
    expect(groupOf('a', 'general-purpose')).toBe('other');
    expect(groupOf('a', 'unknown')).toBe('other');
  });
  it('gives each group its effort when all its loops share one, «varios» when they differ', () => {
    const s = newUsage(0);
    recordStep(s, { model: 'claude-opus-5-5', effort: 'medium', usage: U(10, 0) });
    recordStep(s, { agentId: 'a', model: 'claude-opus-5-5', effort: 'low', usage: U(10, 0) });
    recordStep(s, { agentId: 'b', model: 'claude-opus-5-5', effort: 'low', usage: U(10, 0) });
    recordStep(s, { agentId: 'i', model: 'claude-sonnet-5-5', effort: 'low', usage: U(10, 0) });
    recordStep(s, { agentId: 'j', model: 'claude-sonnet-5-5', effort: 'high', usage: U(10, 0) });
    recordStep(s, { agentId: 'r', model: 'claude-opus-5-5', usage: U(10, 0) });
    labelLoop(s, 'i', 'forge:forge-impl'); labelLoop(s, 'j', 'forge:forge-impl'); labelLoop(s, 'r', 'forge:forge-review-perf');
    const by = Object.fromEntries(summarizeUsage(s).groups.map(g => [g.id, g.effort]));
    expect(by).toEqual({ main: 'medium', impl: 'varios', review: null, other: 'low' });
  });
  it('costs groups, subtracts tracking from main and estimates without forge', () => {
    const s = newUsage(0);
    recordStep(s, { model: 'claude-opus-5-5', usage: U(M, 0) });             // main: $4
    recordStep(s, { agentId: 'i', model: 'claude-sonnet-5-5', usage: U(M, 0) }); // impl: $2, at Opus $4
    recordStep(s, { agentId: 'r', model: 'claude-opus-5-5', usage: U(M, 0) });   // review: $4
    labelLoop(s, 'i', 'forge:forge-impl');
    labelLoop(s, 'r', 'forge:forge-review-correctness');
    recordTracking(s, 'waypoint', 4 * 250_000);                                  // 250k tokens ≈ $1 at Opus input
    const r = summarizeUsage(s);
    expect(r.tokens).toBe(3 * M);
    expect(r.costUsd).toBeCloseTo(10);
    expect(r.partial).toBe(false);
    const main = r.groups.find(g => g.id === 'main')!;
    expect(main).toMatchObject({ model: 'claude-opus-5-5', tokens: 750_000 });
    expect(main.costUsd).toBeCloseTo(3);
    expect(r.tracking).toMatchObject({ tokens: 250_000 });
    expect(r.tracking!.costUsd).toBeCloseTo(1);
    expect(r.groups.map(g => g.id)).toEqual(['main', 'impl', 'review']);
    // without forge: main 4 - tracking 1 + impl repriced at Opus 4 = 7
    expect(r.withoutForge!.costUsd).toBeCloseTo(7);
    expect(r.withoutForge!.deltaUsd).toBeCloseTo(3);
    expect(r.withoutForge!.deltaPct).toBe(43);
  });
  it('marks unpriced models and gives no estimate when the main model is unpriced', () => {
    const s = newUsage(0);
    recordStep(s, { model: 'mystery-1', usage: U(1000, 0) });
    recordStep(s, { agentId: 'i', model: 'claude-sonnet-5-5', usage: U(M, 0) });
    labelLoop(s, 'i', 'forge:forge-impl');
    const r = summarizeUsage(s);
    expect(r.partial).toBe(true);
    expect(r.groups.find(g => g.id === 'main')!.costUsd).toBeNull();
    expect(r.withoutForge).toBeNull();
  });
  it('gives no estimate without forge loops, and no tracking row without tracking', () => {
    const s = newUsage(0);
    recordStep(s, { model: 'claude-opus-5-5', usage: U(10, 10) });
    const r = summarizeUsage(s);
    expect(r.withoutForge).toBeNull();
    expect(r.tracking).toBeNull();
    expect(r.groups).toHaveLength(1);
  });
  it('keeps the known cost of a group with an unpriced loop, flagged partial', () => {
    const s = newUsage(0);
    recordStep(s, { model: 'claude-opus-5-5', usage: U(M, 0) });
    recordStep(s, { agentId: 'i', model: 'claude-sonnet-5-5', usage: U(M, 0) });
    recordStep(s, { agentId: 'j', model: 'mystery-1', usage: U(M, 0) });
    labelLoop(s, 'i', 'forge:forge-impl');
    labelLoop(s, 'j', 'forge:forge-impl');
    const r = summarizeUsage(s);
    expect(r.partial).toBe(true);
    expect(r.groups.find(g => g.id === 'impl')!.costUsd).toBeCloseTo(2);
    expect(r.groups.reduce((a, g) => a + g.share, 0)).toBeCloseTo(1);
  });
  it('never reports a negative zero delta', () => {
    const s = newUsage(0);
    recordStep(s, { model: 'claude-opus-5-5', usage: U(M, 0) });
    recordStep(s, { agentId: 'i', model: 'claude-opus-5-5', usage: U(M, 0) });
    labelLoop(s, 'i', 'forge:forge-impl');
    expect(Object.is(summarizeUsage(s).withoutForge!.deltaPct, 0)).toBe(true);
  });
  it('forge-verify loops form the verify group, left out of the without-forge estimate', () => {
    expect(groupOf('a', 'forge:forge-verify')).toBe('verify');
    expect(groupOf('a', 'forge:forge-verify-heavy')).toBe('verify');
    const s = newUsage(0);
    recordStep(s, { model: 'claude-opus-5-5', usage: U(M, 0) });
    recordStep(s, { agentId: 'i', model: 'claude-sonnet-5-5', usage: U(M, 0) });
    recordStep(s, { agentId: 'v', model: 'claude-sonnet-5-5', usage: U(M, 0) });
    labelLoop(s, 'i', 'forge:forge-impl');
    labelLoop(s, 'v', 'forge:forge-verify');
    const r = summarizeUsage(s);
    expect(r.groups.map(g => g.id)).toEqual(['main', 'impl', 'verify']);
    expect(r.withoutForge!.costUsd).toBeCloseTo(8); // main $4 + impl repriced at Opus $4; verify not counted
  });
});
