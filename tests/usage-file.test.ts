import { describe, it, expect } from 'vitest';
import { newUsage, recordStep, recordTracking, labelLoop } from '../src/lens/usage.js';
import { toUsageFile, parseUsageFile, mainCheckoutFrom, runStartedAt, mergeForRun, seedUsage, USAGE_FILE_MAX } from '../src/lens/usage-file.js';
import { mainCheckoutFrom as libMainCheckoutFrom } from '../src/lib/worktree.js';

const U = (i: number, o: number) => ({ input_tokens: i, output_tokens: o, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
const T0 = Date.parse('2026-10-12T10:00:00.000Z');
const state = (i: number) => { const s = newUsage(T0); recordStep(s, { model: 'claude-opus-5-5', effort: 'high', usage: U(i, i) }); return s; };
const meta = (session: string, minutes: number) => ({ session, label: session, worktree: `/w/${session}`, now: T0 + minutes * 60000, costUsd: 1.5 });

describe('usage file', () => {
  it('round-trips', () => {
    const s = state(10);
    labelLoop(s, 'a1', 'forge:forge-impl', 'T1');
    recordTracking(s, 'forge', 40);
    const f = toUsageFile(s, meta('s1', 5));
    expect(f).toMatchObject({ v: 1, session: 's1', startedAt: '2026-10-12T10:00:00.000Z', updatedAt: '2026-10-12T10:05:00.000Z', costUsd: 1.5 });
    expect(parseUsageFile(JSON.stringify(f))).toEqual(f);
  });
  it('drops corrupt, oversized, other-version and malformed files', () => {
    expect(parseUsageFile(undefined)).toBeNull();
    expect(parseUsageFile('{')).toBeNull();
    expect(parseUsageFile(JSON.stringify({ ...toUsageFile(state(1), meta('s', 1)), v: 2 }))).toBeNull();
    expect(parseUsageFile('x'.repeat(USAGE_FILE_MAX + 1))).toBeNull();
    const bad = { ...toUsageFile(state(1), meta('s', 1)), loops: { main: { kind: 'main', steps: 'x' } } };
    expect(parseUsageFile(JSON.stringify(bad))?.loops.main.steps).toBe(0);
  });
  it('finds the main checkout from a worktree .git file', () => {
    expect(mainCheckoutFrom('E:/repo/.claude/worktrees/ui', 'gitdir: E:/repo/.git/worktrees/ui\n')).toBe('E:/repo');
    expect(mainCheckoutFrom('/home/u/repo/.claude/worktrees/ui', 'gitdir: /home/u/repo/.git/worktrees/ui')).toBe('/home/u/repo');
    expect(mainCheckoutFrom('E:/repo', null)).toBe('E:/repo');
    expect(mainCheckoutFrom('E:/repo', 'garbage')).toBe('E:/repo');
    expect(libMainCheckoutFrom).toBe(mainCheckoutFrom);
  });
  it('takes the run start from the execution, else the infinite run, else the newest Large run', () => {
    const now = T0;
    const fresh = now - 60_000;
    const execution = { text: JSON.stringify({ startedAt: '2026-10-12T09:00:00.000Z' }), mtimeMs: fresh };
    const run = { text: JSON.stringify({ startedAt: '2026-10-12T08:00:00.000Z' }), mtimeMs: fresh };
    expect(runStartedAt({ execution, run, largeRuns: [] }, now)).toBe(Date.parse('2026-10-12T09:00:00.000Z'));
    expect(runStartedAt({ run, largeRuns: [] }, now)).toBe(Date.parse('2026-10-12T08:00:00.000Z'));
    const large = [{ text: JSON.stringify({ startedAt: '2026-10-12T07:00:00.000Z' }), mtimeMs: fresh }, { text: '{}', mtimeMs: fresh }];
    expect(runStartedAt({ largeRuns: large }, now)).toBe(Date.parse('2026-10-12T07:00:00.000Z'));
    expect(runStartedAt({ largeRuns: [] }, now)).toBeNull();
  });
  it('counts a run source only while it is active or touched within 12 hours', () => {
    const now = T0;
    const old = now - 13 * 3600_000;
    const recent = now - 11 * 3600_000;
    const doc = (active: boolean, startedAt: string) => JSON.stringify({ active, startedAt });
    // An inactive execution or infinite run untouched for 13 hours is over.
    expect(runStartedAt({ execution: { text: doc(false, '2026-10-11T09:00:00.000Z'), mtimeMs: old }, largeRuns: [] }, now)).toBeNull();
    expect(runStartedAt({ run: { text: doc(false, '2026-10-11T08:00:00.000Z'), mtimeMs: old }, largeRuns: [] }, now)).toBeNull();
    // Active ones count whatever their age; recent inactive ones count too.
    expect(runStartedAt({ execution: { text: doc(true, '2026-10-11T09:00:00.000Z'), mtimeMs: old }, largeRuns: [] }, now)).toBe(Date.parse('2026-10-11T09:00:00.000Z'));
    expect(runStartedAt({ run: { text: doc(false, '2026-10-11T08:00:00.000Z'), mtimeMs: recent }, largeRuns: [] }, now)).toBe(Date.parse('2026-10-11T08:00:00.000Z'));
    // An old execution gives way to a live infinite run.
    expect(runStartedAt({
      execution: { text: doc(false, '2026-10-11T09:00:00.000Z'), mtimeMs: old },
      run: { text: doc(true, '2026-10-11T08:00:00.000Z'), mtimeMs: old }, largeRuns: [],
    }, now)).toBe(Date.parse('2026-10-11T08:00:00.000Z'));
    // A Large run counts only by its mtime.
    const large = (startedAt: string, mtimeMs: number) => ({ text: doc(true, startedAt), mtimeMs });
    expect(runStartedAt({ largeRuns: [large('2026-10-11T07:00:00.000Z', old)] }, now)).toBeNull();
    expect(runStartedAt({ largeRuns: [large('2026-10-12T01:00:00.000Z', old), large('2026-10-11T23:00:00.000Z', recent)] }, now)).toBe(Date.parse('2026-10-11T23:00:00.000Z'));
  });
  it('sums the run, skipping old files and replacing its own file with the live state', () => {
    const other = toUsageFile(state(100), meta('s2', 30));
    const old = toUsageFile(state(1000), { ...meta('s3', 0), now: T0 - 3600_000 });
    const ownStale = toUsageFile(state(5), meta('s1', 10));
    const live = state(7);
    const sum = mergeForRun([other, old, ownStale], { session: 's1', state: live }, T0);
    const loops = Object.values(sum.loops);
    expect(loops.reduce((a, l) => a + l.input, 0)).toBe(107);
    expect(Object.keys(sum.loops).sort()).toEqual(['s1/main', 's2/main']);
  });
  it('round-trips a state with 200 labelled loops and an overflow loop', () => {
    const s = newUsage(T0);
    for (let i = 0; i < 205; i++) {
      recordStep(s, { agentId: `agent-${i}`, model: 'claude-sonnet-5-5', effort: 'medium', usage: U(123456 + i, 7890) });
      labelLoop(s, `agent-${i}`, 'forge:forge-review-correctness', 'd'.repeat(120));
    }
    const text = JSON.stringify(toUsageFile(s, meta('s1', 5)));
    expect(text.length).toBeLessThanOrEqual(USAGE_FILE_MAX);
    expect(Object.keys(parseUsageFile(text)!.loops)).toHaveLength(201);
    expect(parseUsageFile(text)!.loops.overflow.steps).toBe(5);
  });
  it('ignores a relative gitdir', () => {
    expect(mainCheckoutFrom('E:/repo/wt', 'gitdir: ../.git/worktrees/ui')).toBe('E:/repo/wt');
  });
  it('seeds a resumed session from its own file, adding steps recorded before the seed', () => {
    const before = state(10);
    labelLoop(before, 'a1', 'forge:forge-impl', 'T1');
    recordTracking(before, 'waypoint', 40);
    const file = parseUsageFile(JSON.stringify(toUsageFile(before, meta('s1', 5))))!;
    const live = state(5);
    labelLoop(live, 'a2', 'unknown');
    seedUsage(live, file);
    expect(live.loops.main).toMatchObject({ steps: 2, input: 15, output: 15, model: 'claude-opus-5-5', effort: 'high' });
    expect(live.loops.a1).toMatchObject({ kind: 'forge:forge-impl', description: 'T1' });
    expect(live.loops.a2.kind).toBe('unknown');
    expect(live.tracking).toEqual({ waypoint: 10, forge: 0 });
    // The file's loops are copies: recording more does not change the parsed file.
    recordStep(live, { model: 'claude-opus-5-5', usage: U(1, 1) });
    expect(file.loops.main.steps).toBe(1);
  });
});
