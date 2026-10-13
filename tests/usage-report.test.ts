import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PRICES, priceOf, groupOf, splitCost, readUsageDir, byAgent, bySession, report } from '../scripts/usage-report.mjs';
import { priceFor } from '../src/lib/prices.js';
import { groupOf as lensGroupOf } from '../src/lens/usage-summary.js';

const dir = path.join('tests', 'fixtures', 'usage');
const script = path.join('scripts', 'usage-report.mjs');
const close = (a: number | undefined, b: number) => expect(a).toBeCloseTo(b, 9);

describe('usage-report', () => {
  it('keeps its price table in sync with src/lib/prices.ts', () => {
    for (const [prefix] of PRICES) {
      expect(priceOf(prefix)).toEqual(priceFor(prefix));
      expect(priceOf(`${prefix}[1m]`)).toEqual(priceFor(`${prefix}[1m]`));
      expect(priceOf(`${prefix}-20260101`)).toEqual(priceFor(`${prefix}-20260101`));
    }
    for (const m of ['claude-opus-5', 'claude-opus-5-20260101', 'claude-mythos-5-1', 'claude-haiku-4-5-20251001', 'gpt-9', '']) {
      expect(priceOf(m)).toEqual(priceFor(m));
    }
  });
  it('groups loops as lens does', () => {
    const cases: [string, string][] = [['main', 'main'], ['x/main', 'Explore'], ['a', 'forge:forge-impl-heavy'], ['a', 'forge:forge-mech'],
      ['a', 'forge:forge-fable'], ['a', 'forge:forge-verify'], ['a', 'forge:forge-review-perf'], ['a', 'forge:forge-planner'],
      ['a', 'forge:forge-scout'], ['a', 'waypoint:design-critic'], ['a', 'Explore'], ['a', 'unknown']];
    for (const [id, kind] of cases) expect(groupOf(id, kind)).toBe(lensGroupOf(id, kind));
  });
  it('splits a loop cost by token type with the model price', () => {
    const s = splitCost({ model: 'claude-sonnet-5-5', input: 1_000_000, output: 10_000, cacheRead: 1_000_000, cacheWrite: 50_000 });
    expect(s).not.toBeNull();
    close(s!.input, 2); close(s!.output, 0.1); close(s!.cacheRead, 0.1); close(s!.cacheWrite, 0.2);
    expect(splitCost({ model: 'gpt-x', input: 1, output: 1, cacheRead: 0, cacheWrite: 0 })).toBeNull();
    expect(splitCost({ model: null, input: 1, output: 1, cacheRead: 0, cacheWrite: 0 })).toBeNull();
  });
  it('reads the usage files of a directory and skips the broken ones', () => {
    const files = readUsageDir(dir);
    expect(files.map(f => f.label).sort()).toEqual(['alpha', 'beta']);
    expect(files.every(f => f.project === 'usage')).toBe(true);
    expect(readUsageDir(path.join(dir, 'missing'))).toEqual([]);
  });
  it('sums runs, steps, mean cost and cost split per agent', () => {
    const rows = byAgent(readUsageDir(dir));
    expect(rows.map(r => `${r.kind}|${r.model}|${r.effort}`)).toEqual([
      'main|claude-opus-5-5|xhigh', 'forge-impl-heavy|claude-opus-5-5|xhigh', 'Explore|claude-haiku-5-5|null',
      'forge-review-correctness|claude-sonnet-5-5|high', 'other-tool|gpt-x|null']);
    const [main, heavy, explore, review, other] = rows;
    expect(main.runs).toBe(2); expect(main.steps).toBe(16); close(main.cost, 8); close(main.avgCost, 4);
    close(main.split.input, 1); close(main.split.output, 3); close(main.split.cacheRead, 2); close(main.split.cacheWrite, 2);
    close(main.priced, 8); close(main.diff, 0);
    expect(heavy.runs).toBe(2); expect(heavy.steps).toBe(30); close(heavy.avgSteps, 15); close(heavy.cost, 5); close(heavy.avgCost, 2.5);
    close(heavy.share?.output, 0.6); close(heavy.share?.cacheRead, 0.2); close(heavy.share?.cacheWrite, 0.2); close(heavy.share?.input, 0);
    expect(review.runs).toBe(1); close(review.avgCost, 0.4); close(review.share?.cacheWrite, 0.5); close(review.share?.output, 0.25);
    close(explore.cost, 0.5); close(explore.share?.output, 1);
    expect(other.unpriced).toBe(3); close(other.priced, 0); expect(other.share).toBeNull();
  });
  it('flags a loop whose recorded cost does not match its priced tokens', () => {
    const files = readUsageDir(dir);
    files[0].loops.main.costUsd += 1;
    const main = byAgent(files).find(r => r.kind === 'main')!;
    close(main.diff, 1);
  });
  it('breaks each session down by group', () => {
    const rows = bySession(readUsageDir(dir));
    expect(rows.map(r => r.label)).toEqual(['alpha', 'beta']);
    const [a, b] = rows;
    close(a.cost, 9.4); expect(a.loops).toBe(3); expect(a.project).toBe('usage');
    close(a.groups.main, 6); close(a.groups.impl, 3); close(a.groups.review, 0.4); expect(a.groups.other).toBeUndefined();
    close(b.cost, 4.5); expect(b.loops).toBe(4); close(b.groups.main, 2); close(b.groups.impl, 2); close(b.groups.other, 0.5);
  });
  it('prints both tables and runs as a script', () => {
    const text = report(readUsageDir(dir), [dir]);
    expect(text).toContain('| forge-impl-heavy | claude-opus-5-5 | xhigh | 2 | 30 | 15 | 5.00 | 2.50 |');
    expect(text).toContain('| usage | alpha | 9.40 | 3 |');
    const run = spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('forge-impl-heavy');
    const none = spawnSync(process.execPath, [script], { encoding: 'utf8' });
    expect(none.status).toBe(2);
  });
});
