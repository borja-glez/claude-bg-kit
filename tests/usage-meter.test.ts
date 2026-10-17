import { describe, it, expect } from 'vitest';
import { newUsage, recordStep, labelLoop, trackingKind, recordTracking, compactUsage, closeTurn, newTurnClock, startTurn, touchTurn, endTurn, MAIN } from '../src/lens/usage.js';

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
  it('prices 5-minute cache writes at 1.25x input and 1-hour ones at 2x, from the response split', () => {
    const s = newUsage(1);
    const M = 1_000_000;
    // Opus 5.5: input $4/M, so 5m writes $5/M and 1h writes $8/M.
    recordStep(s, { agentId: 'a', model: 'claude-opus-5-5', usage: { ...U(0, 0, 0, M), cache_creation: { ephemeral_5m_input_tokens: M, ephemeral_1h_input_tokens: 0 } } });
    recordStep(s, { agentId: 'b', model: 'claude-opus-5-5', usage: { ...U(0, 0, 0, M), cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: M } } });
    recordStep(s, { agentId: 'c', model: 'claude-opus-5-5', usage: U(0, 0, 0, M) });
    expect(s.loops.a.costUsd).toBeCloseTo(5);
    expect(s.loops.b.costUsd).toBeCloseTo(8);
    expect(s.loops.c.costUsd).toBeCloseTo(8); // no split: the 1-hour price, as before
    expect(s.loops.a.cacheWrite).toBe(M);
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
    expect(s.tracking).toEqual({ waypoint: 101, forge: 2, reread: 0 });
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
  it('each main step re-reads the tracking gathered since the last compaction; a subagent step does not (E-08)', () => {
    const s = newUsage(1);
    recordTracking(s, 'forge', 4000);
    for (let i = 0; i < 3; i++) recordStep(s, { model: 'claude-opus-5-5', usage: U(1, 1) });
    recordStep(s, { agentId: 'a1', model: 'claude-opus-5-5', usage: U(1, 1) });
    expect(s.tracking.reread).toBe(3000);
    compactUsage(s);
    recordStep(s, { model: 'claude-opus-5-5', usage: U(1, 1) });
    expect(s.tracking.reread).toBe(3000);
    recordTracking(s, 'waypoint', 400);
    recordStep(s, { model: 'claude-opus-5-5', usage: U(1, 1) });
    expect(s.tracking.reread).toBe(3100);
  });
});

describe('active time', () => {
  it('adds each closed turn and ignores a turn that ends before it starts', () => {
    const s = newUsage(1000);
    expect(s.activeMs).toBe(0);
    closeTurn(s, 10_000, 70_000);
    closeTurn(s, 100_000, 105_000);
    closeTurn(s, 200_000, 150_000);
    closeTurn(s, NaN, 150_000);
    expect(s.activeMs).toBe(65_000);
  });
  it('an aborted or failed turn (turn.complete with any reason) closes the clock and stops accruing', () => {
    const s = newUsage(0);
    const c = newTurnClock();
    startTurn(s, c, 1_000);
    touchTurn(c, 4_000);
    endTurn(s, c, 5_000);
    expect(s.activeMs).toBe(4_000);
    expect(c.since).toBeNull();
    // Nothing is open: a second end (Stop after turn.complete) adds nothing, and activity does not reopen it.
    touchTurn(c, 9_000);
    endTurn(s, c, 20_000);
    expect(s.activeMs).toBe(4_000);
  });
  it('a dangling turn followed by a new turn.start counts only up to its last activity', () => {
    const s = newUsage(0);
    const c = newTurnClock();
    startTurn(s, c, 1_000);
    touchTurn(c, 3_000);
    touchTurn(c, 2_000); // never goes back
    startTurn(s, c, 100_000);
    expect(s.activeMs).toBe(2_000);
    expect(c.since).toBe(100_000);
    endTurn(s, c, 101_000);
    expect(s.activeMs).toBe(3_000);
    // A dangling turn with no activity after its start adds nothing.
    startTurn(s, c, 200_000);
    startTurn(s, c, 300_000);
    expect(s.activeMs).toBe(3_000);
  });
});
