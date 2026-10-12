import { describe, it, expect } from 'vitest';
import { newUsage, recordStep, labelLoop, trackingKind, recordTracking, MAIN } from '../src/lens/usage.js';

const U = (input: number, output: number, cacheRead = 0, cacheWrite = 0) =>
  ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheWrite });

describe('usage meter', () => {
  it('adds steps to the main loop and to each subagent loop, with the last model and effort', () => {
    const s = newUsage(1);
    recordStep(s, { model: 'claude-opus-5-5', effort: 'high', usage: U(100, 50, 1000, 10) });
    recordStep(s, { model: 'claude-opus-5-5', effort: 'medium', usage: U(10, 5) });
    recordStep(s, { agentId: 'a1', model: 'claude-sonnet-5-5', effort: 'low', usage: U(7, 3) });
    expect(s.loops[MAIN]).toMatchObject({ kind: 'main', model: 'claude-opus-5-5', effort: 'medium', steps: 2, input: 110, output: 55, cacheRead: 1000, cacheWrite: 10 });
    expect(s.loops.a1).toMatchObject({ kind: 'unknown', model: 'claude-sonnet-5-5', effort: 'low', steps: 1, input: 7, output: 3 });
    expect(s.loops[MAIN].costUsd).toBeCloseTo((110 * 4 + 55 * 20 + 1000 * 0.2 + 10 * 8) / 1e6);
  });
  it('counts a step with no usage as a step with no tokens, and an unpriced model as unpriced', () => {
    const s = newUsage(1);
    recordStep(s, { model: 'claude-opus-5-5', usage: null });
    recordStep(s, { model: 'mystery', usage: U(5, 5) });
    expect(s.loops[MAIN]).toMatchObject({ steps: 2, input: 5, output: 5, unpriced: 1, effort: null });
  });
  it('prefers the model the response reports', () => {
    const s = newUsage(1);
    recordStep(s, { model: 'claude-opus-5-5', usage: { ...U(1, 1), model: 'claude-sonnet-5-5' } });
    expect(s.loops[MAIN].model).toBe('claude-sonnet-5-5');
  });
  it('labels a subagent loop before or after its first step', () => {
    const s = newUsage(1);
    labelLoop(s, 'a1', 'forge:forge-impl', 'Implement T07');
    recordStep(s, { agentId: 'a1', model: 'claude-sonnet-5-5', usage: U(1, 1) });
    recordStep(s, { agentId: 'a2', model: 'claude-opus-5-5', usage: U(1, 1) });
    labelLoop(s, 'a2', 'forge:forge-review-correctness');
    expect(s.loops.a1).toMatchObject({ kind: 'forge:forge-impl', description: 'Implement T07', steps: 1 });
    expect(s.loops.a2.kind).toBe('forge:forge-review-correctness');
  });
  it('recognizes tracking calls and estimates them by characters', () => {
    expect(trackingKind('ArtifactData', { action: 'get' })).toBe('waypoint');
    expect(trackingKind('Bash', { command: 'node "/x/dist/waypoint.cjs" next p' })).toBe('waypoint');
    expect(trackingKind('Bash', { command: 'node "/x/dist/forge.cjs" triage' })).toBe('forge');
    expect(trackingKind('Skill', { skill: 'waypoint:work' })).toBe('waypoint');
    expect(trackingKind('Skill', { skill: 'forge:run' })).toBe('forge');
    expect(trackingKind('Bash', { command: 'npm test' })).toBeNull();
    expect(trackingKind('Read', { file_path: 'waypoint.cjs' })).toBeNull();
    const s = newUsage(1);
    recordTracking(s, 'waypoint', 401);
    recordTracking(s, 'forge', 8);
    expect(s.tracking).toEqual({ waypoint: 101, forge: 2 });
  });
  it('keeps the steps of loops past the cap in one overflow loop', () => {
    const s = newUsage(1);
    for (let i = 0; i < 200; i++) recordStep(s, { agentId: `a${i}`, model: 'claude-opus-5-5', usage: U(1, 1) });
    recordStep(s, { agentId: 'late', model: 'claude-opus-5-5', usage: U(5, 5) });
    recordStep(s, { agentId: 'later', model: 'claude-opus-5-5', usage: U(5, 5) });
    labelLoop(s, 'late', 'forge:forge-impl', 'x');
    expect(Object.keys(s.loops)).toHaveLength(201);
    expect(s.loops.overflow).toMatchObject({ kind: 'unknown', description: null, steps: 2, input: 10, output: 10 });
    expect(s.loops.late).toBeUndefined();
  });
});
