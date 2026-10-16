import { describe, it, expect } from 'vitest';
import {
  parseIndex, assignIds, recordRound, answeredBy, idsOf, openIds, closedFor, previousFindings, asPrevious, type FindingsIndex,
} from '../src/forge/findings-index.js';
import type { Finding, Review, ReviewerName } from '../src/forge/verdict.js';

const fail = (findings: Finding[]): Review => ({ verdict: 'fail', confidence: 0.8, findings });
const pass: Review = { verdict: 'pass', confidence: 0.9, findings: [] };
const abstain: Review = { verdict: 'abstain', confidence: 0, findings: [] };
const imp = (problem: string, over: Partial<Finding> = {}): Finding => ({ severity: 'important', file: 'src/a.ts', line: 10, problem, ...over });
const empty = (): FindingsIndex => parseIndex(null, 'T1-1');
// One review: ids assigned, then recorded as if every critical and important finding blocked.
const review = (index: FindingsIndex, round: number, reviews: Partial<Record<ReviewerName, Review>>) => {
  const withIds = assignIds(index, round, reviews);
  const heavy = Object.values(withIds).flatMap(r => r!.findings.filter(f => f.severity !== 'minor'));
  return { withIds, index: recordRound(index, round, { critical: [], important: heavy, minor: [], deferred: [] }, answeredBy(withIds)) };
};
const ids = (r: Review | undefined) => r!.findings.map(f => f.id ?? null);

describe('findings index (J-06)', () => {
  it('gives F1, F2… to critical and important findings in reviewer order, never to minor ones, and sets the reviewer', () => {
    const { withIds, index } = review(empty(), 1, {
      correctness: fail([imp('a'), { severity: 'minor', problem: 'm' }, imp('b', { file: 'src/b.ts' })]),
      security: fail([{ ...imp('c', { file: 'src/c.ts' }), severity: 'critical' }]),
    });
    expect(ids(withIds.correctness)).toEqual(['F1', null, 'F2']);
    expect(withIds.correctness!.findings.map(f => f.reviewer)).toEqual(['correctness', 'correctness', 'correctness']);
    expect(ids(withIds.security)).toEqual(['F3']);
    expect(index).toMatchObject({ task: 'T1-1', next: 4, rounds: [{ round: 1 }] });
    expect(index.rounds[0].findings.map(f => [f.id, f.reviewer, f.status])).toEqual([['F1', 'correctness', 'open'], ['F2', 'correctness', 'open'], ['F3', 'security', 'open']]);
  });

  it('keeps a copied id that was open for that reviewer, pairs a reworded previous one, and gives a new id to what the reviewer calls new', () => {
    const one = review(empty(), 1, { correctness: fail([imp('null check missing'), imp('loop never ends', { file: 'src/b.ts', line: 40 })]) }).index;
    const { withIds } = review(one, 2, { correctness: fail([
      imp('reworded', { id: 'F1', origin: 'previous' }),
      imp('the loop still spins', { file: 'src/b.ts', line: 44, origin: 'previous' }),
      imp('a new crash', { file: 'src/b.ts', line: 41, origin: 'fix' }),
    ]) });
    expect(ids(withIds.correctness)).toEqual(['F1', 'F2', 'F3']);
  });

  it('drops a copied id that is not open, another reviewer\'s or already taken: the finding is paired or new, never two with one id', () => {
    const one = review(empty(), 1, { correctness: fail([imp('x')]), security: fail([imp('y', { file: 'src/s.ts', line: 1 })]) }).index;
    const { withIds } = review(one, 2, { correctness: fail([
      imp('x again', { id: 'F2', origin: 'previous', file: 'src/q.ts', line: 70 }),
      imp('x once more', { id: 'F1', origin: 'previous' }),
      imp('x a third time', { id: 'F1', origin: 'previous', file: 'src/z.ts', line: 90 }),
      imp('x a fourth time', { id: 'F9', origin: 'previous', file: 'src/w.ts', line: 5 }),
    ]) });
    expect(ids(withIds.correctness)).toEqual(['F3', 'F1', 'F4', 'F5']);
  });

  it('an express review keeps an id copied from any reviewer, and the finding stays that reviewer\'s', () => {
    const one = review(empty(), 1, { perf: fail([imp('slow loop', { file: 'src/hot.ts', line: 3 })]) }).index;
    const withIds = assignIds(one, 2, { correctness: fail([imp('still slow', { id: 'F1', origin: 'previous', file: 'src/hot.ts', line: 3 })]) }, { express: true });
    expect(withIds.correctness!.findings[0]).toMatchObject({ id: 'F1', reviewer: 'perf' });
  });

  it('records each review once: recording it again replaces it with the same ids; an open finding nobody reports again is closed, unless its reviewer did not answer', () => {
    const one = review(empty(), 1, { correctness: fail([imp('a')]), security: fail([imp('s', { file: 'src/s.ts', line: 2 })]) }).index;
    const two = review(one, 2, { correctness: pass, security: abstain }).index;
    expect(two.rounds.map(r => r.round)).toEqual([1, 2]);
    expect(two.rounds[1].findings.map(f => [f.id, f.status])).toEqual([['F1', 'closed'], ['F2', 'open']]);
    const again = review(two, 2, { correctness: fail([imp('b', { file: 'src/n.ts', line: 1, origin: 'fix' })]), security: abstain });
    expect(ids(again.withIds.correctness)).toEqual(['F3']);
    expect(again.index.rounds).toHaveLength(2);
    expect(again.index.rounds[1].findings.map(f => [f.id, f.status])).toEqual([['F3', 'open'], ['F1', 'closed'], ['F2', 'open']]);
    expect(openIds(again.index, 3)).toEqual({ correctness: ['F3'], security: ['F2'] });
  });

  it('answeredBy leaves out an abstention, an invalid result and a fail without a critical or important finding', () => {
    expect(answeredBy({ correctness: pass, security: abstain, perf: { ...pass, invalid: true }, verify: fail([{ severity: 'minor', problem: 'm' }]) })).toEqual(['correctness']);
    expect([...idsOf({ correctness: fail([imp('a', { id: 'F2' }), imp('b')]) })]).toEqual(['F2']);
  });

  it('closedFor lists what earlier reviews closed and what this one is closing, with the last review that had it open', () => {
    const one = review(empty(), 1, { correctness: fail([imp('a')]) }).index;
    expect(closedFor(one, 2, new Set(), ['correctness'])).toEqual({ correctness: [expect.objectContaining({ id: 'F1', reviewer: 'correctness', problem: 'a', round: 1 })] });
    expect(closedFor(one, 2, new Set(['F1']), ['correctness'])).toEqual({});
    expect(closedFor(one, 2, new Set(), ['security'])).toEqual({});
    const two = review(one, 2, { correctness: pass }).index;
    expect(closedFor(two, 3, new Set(), [])).toEqual({ correctness: [expect.objectContaining({ id: 'F1', round: 1 })] });
  });

  it('previousFindings hands a delta reviewer its open findings and the residuals sent to the implementer; the express reviewer gets everyone\'s', () => {
    const idx = parseIndex(JSON.stringify({ task: 'T', rounds: [{ round: 1, findings: [
      { id: 'F1', reviewer: 'correctness', severity: 'important', file: 'a.ts', line: 1, problem: 'p1', status: 'open' },
      { id: 'F2', reviewer: 'correctness', severity: 'important', problem: 'p2', status: 'residual', residual: 'untouched' },
      { id: 'F3', reviewer: 'correctness', severity: 'important', problem: 'p3', status: 'residual', residual: 'hardening' },
      { id: 'F4', reviewer: 'perf', severity: 'important', problem: 'p4', status: 'open' },
      { id: 'F5', reviewer: 'correctness', severity: 'important', problem: 'p5', status: 'closed' },
    ] }] }), 'T');
    expect(previousFindings(idx, 2, 'correctness').map(f => f.id)).toEqual(['F1', 'F2']);
    expect(previousFindings(idx, 2).map(f => f.id)).toEqual(['F1', 'F2', 'F4']);
    expect(asPrevious(previousFindings(idx, 2, 'correctness')[0])).toEqual({ id: 'F1', severity: 'important', file: 'a.ts', line: 1, problem: 'p1' });
    expect(asPrevious(previousFindings(idx, 2)[2], true)).toEqual({ id: 'F4', reviewer: 'perf', severity: 'important', problem: 'p4' });
    expect(previousFindings(idx, 1)).toEqual([]);
  });

  it('reads a damaged index leniently: junk is empty, a bad entry or round is dropped, next follows the highest id', () => {
    expect(parseIndex('{not json', 'T')).toEqual({ task: 'T', next: 1, rounds: [] });
    expect(parseIndex('[]', 'T')).toEqual({ task: 'T', next: 1, rounds: [] });
    const idx = parseIndex(JSON.stringify({ task: 'other', next: 99, rounds: [{ round: 1, findings: [
      { id: 'F2', reviewer: 'correctness', severity: 'important', problem: 'p', status: 'open', file: 7, line: 'x' },
      { id: 'G1', reviewer: 'correctness', severity: 'important', problem: 'p', status: 'open' },
      { id: 'F3', reviewer: 'nobody', severity: 'important', problem: 'p', status: 'open' },
      { id: 'F4', reviewer: 'security', severity: 'important', problem: 'p', status: 'maybe' },
      { id: 'F5', reviewer: 'security', severity: 'huge', problem: 'p', status: 'open' },
      { id: 'F6', reviewer: 'security', severity: 'important', problem: '', status: 'open' },
      'text',
    ] }, { round: 'x', findings: [] }, { round: 2 }] }), 'T');
    expect(idx).toEqual({ task: 'T', next: 3, rounds: [{ round: 1, findings: [{ id: 'F2', reviewer: 'correctness', severity: 'important', problem: 'p', status: 'open' }] }] });
  });
});
