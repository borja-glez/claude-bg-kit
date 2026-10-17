// Ledgers of wave 4 (roadmap-doc, the contract test): what forge logs for a task, with the fields of waves 1 to 3.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { LedgerEvent } from '../../src/forge/ledger.js';

export const ROADMAP_AT = (min: number): string => new Date(Date.parse('2026-10-16T10:00:00.000Z') + min * 60_000).toISOString();
const at = ROADMAP_AT;
const correctness = { agent: 'forge-review-correctness', role: 'review-correctness' };

/** A Medium plan task T1 of the project shop: a fix and an accept, two deferred findings, its verification skipped, done. */
export const MEDIUM_T1: LedgerEvent[] = [
  { ts: at(0), kind: 'triage', task: 'T1', project: 'shop', path: 'medium', reasons: ['4 files located'] },
  { ts: at(1), kind: 'phase', task: 'T1', project: 'shop', phase: 'implement', brief: 1, base: 'abc1234' },
  { ts: at(1), kind: 'validate', task: 'T1-1', project: 'shop', baseline: true, ok: true, scope: 'heavy', durationMs: 900, cached: false,
    results: [{ validator: 'test', ok: true, flaky: false, durationMs: 900, cached: false, failing: [], failingKnown: true }] },
  { ts: at(10), kind: 'phase', task: 'T1', project: 'shop', phase: 'validate', brief: 1, round: 1 },
  { ts: at(11), kind: 'validate', task: 'T1-1', project: 'shop', ok: false, scope: 'heavy', durationMs: 1200, cached: false, results: [
    { validator: 'test', ok: false, flaky: false, durationMs: 1000, cached: false, failing: ['cart > adds', 'cart > removes'], failingKnown: true, failures: ['2 failed'] },
    { validator: 'lint', ok: true, flaky: true, durationMs: 200, cached: true, failing: [], failingKnown: true },
    { validator: 'e2e', ok: true, flaky: false, durationMs: 0, cached: false, failing: [], failingKnown: true, skipped: 'not-affected' },
  ] },
  { ts: at(12), kind: 'phase', task: 'T1', project: 'shop', phase: 'review', brief: 1, round: 1, reviewers: [correctness, { agent: 'forge-review-security', role: 'review-security' }] },
  { ts: at(20), kind: 'verdict', task: 'T1-1', project: 'shop', dir: '.forge/work/shop/T1/reviews-1-1', action: 'fix', score: 0.4, signature: 's1',
    critical: 1, important: 2, minor: 0, deferred: 0, reviews: { n: 1, max: 4 } },
  { ts: at(20), kind: 'round', task: 'T1-1', project: 'shop', round: 1, cap: 3, next: 'resume', reason: 'round 1: resume the implementer', reviews: { n: 1, max: 4 } },
  { ts: at(30), kind: 'phase', task: 'T1', project: 'shop', phase: 'review', brief: 1, round: 2, reviewers: [correctness, { agent: 'forge-review-perf', role: 'review-perf', twin: true }] },
  { ts: at(40), kind: 'verdict', task: 'T1-1', project: 'shop', dir: '.forge/work/shop/T1/reviews-1-2', action: 'accept', score: 0.9, signature: 's2',
    critical: 0, important: 1, minor: 3, deferred: 2, reviews: { n: 2, max: 4 } },
  { ts: at(40), kind: 'round', task: 'T1-1', project: 'shop', round: 1, cap: 3, next: 'done', reason: 'accepted', reviews: { n: 2, max: 4 } },
  { ts: at(40), kind: 'ruling', task: 'T1-1', project: 'shop', round: 2, dir: '.forge/work/shop/T1/reviews-1-2',
    deferred: [{ severity: 'important', file: 'src/cart.ts', line: 12, problem: 'a slow loop over the items' }, { severity: 'important', problem: 'no index on orders' }] },
  { ts: at(41), kind: 'verify', task: 'T1', project: 'shop', planned: true, surfaces: ['web'] },
  { ts: at(42), kind: 'verify-skip', task: 'T1', project: 'shop', surface: 'web', reason: 'docs only' },
  { ts: at(45), kind: 'phase', task: 'T1', project: 'shop', phase: 'done' },
];

/** A Large task: a fix and an accept in brief 1, three deferred findings in its ruling. */
export function largeWithDeferred(task: string, project: string): LedgerEvent[] {
  const dir = (n: number) => `.forge/work/${project}/${task}/reviews-1-${n}`;
  return [
    { ts: at(100), kind: 'triage', task, project, path: 'large', reasons: ['12 files located'] },
    { ts: at(101), kind: 'phase', task, project, phase: 'implement', brief: 1, base: 'def5678' },
    { ts: at(110), kind: 'phase', task, project, phase: 'review', brief: 1, round: 1, reviewers: [correctness] },
    { ts: at(120), kind: 'verdict', task: `${task}-1`, project, dir: dir(1), action: 'fix', score: 0.45, signature: 'a', critical: 0, important: 2, minor: 1, deferred: 0, reviews: { n: 1, max: 5 } },
    { ts: at(120), kind: 'round', task: `${task}-1`, project, round: 1, cap: 4, next: 'resume', reason: 'round 1: resume the implementer', reviews: { n: 1, max: 5 } },
    { ts: at(130), kind: 'phase', task, project, phase: 'review', brief: 1, round: 2, reviewers: [correctness] },
    { ts: at(140), kind: 'verdict', task: `${task}-1`, project, dir: dir(2), action: 'accept', score: 0.85, signature: 'b', critical: 0, important: 0, minor: 2, deferred: 3, reviews: { n: 2, max: 5 } },
    { ts: at(140), kind: 'round', task: `${task}-1`, project, round: 1, cap: 4, next: 'done', reason: 'accepted', reviews: { n: 2, max: 5 } },
    { ts: at(140), kind: 'ruling', task: `${task}-1`, project, round: 2, dir: dir(2), deferred: [
      { severity: 'important', file: 'src/a.ts', line: 1, problem: 'first deferred' },
      { severity: 'important', file: 'src/b.ts', line: 2, problem: 'second deferred' },
      { severity: 'important', problem: 'third deferred' },
    ] },
  ];
}

/** forge-verify's output of one review round: `<rel>/reviews-<b>-<n>/verify.json` and its screenshots in `<rel>/evidence/<b>-<n>/`. */
export function writeVerify(root: string, rel: string, brief: number, n: number, verify: Record<string, unknown>, shots: string[] = []): void {
  const reviews = path.join(root, rel, `reviews-${brief}-${n}`);
  const evidence = path.join(root, rel, 'evidence', `${brief}-${n}`);
  mkdirSync(reviews, { recursive: true });
  mkdirSync(evidence, { recursive: true });
  writeFileSync(path.join(reviews, 'verify.json'), JSON.stringify(verify));
  for (const s of shots) writeFileSync(path.join(evidence, s), 'png');
}
