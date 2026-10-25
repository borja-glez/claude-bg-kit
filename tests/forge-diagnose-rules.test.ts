import { describe, it, expect } from 'vitest';
import { cited, pairInstances, repeats, SEQUENCES, sortTimeline, stepOfAgent, stepOfEvent, stepOfForge, stepsOf,
  type CallRef, type Entry, type Finding, type Instance, type StepRow, type StepsOpts } from '../src/forge/diagnose-rules.js';
import type { LedgerEvent } from '../src/forge/ledger.js';
import { TX_AT as at } from './helpers/transcript.js';

const T = '/t/s1.jsonl';
const inst = (step: Instance['step'], brief: number | null, start: number, end: number | null, ok: boolean | null, ...lines: number[]): Instance =>
  ({ task: 'fix', step, brief, start: at(start), end: end === null ? null : at(end), ok, at: lines.map(n => `${T}:${n}`) });
const states = (rows: StepRow[]) => Object.fromEntries(rows.map(r => [`${r.step}${r.brief === null ? '' : `#${r.brief}`}`, r.state]));
const seen = (f: Finding[]) => f.map(x => [x.kind, x.step ?? null, x.brief ?? null, x.ts, x.at]);
const OPTS: StepsOpts = { transcript: true, agentEvents: false, compactions: [] };
const BRIEF1 = [inst('begin', null, 0, 0.5, true, 1), inst('triage', null, 1, 2, true, 2), inst('prep', 1, 3, 4, true, 3), inst('impl', 1, 5, 10, true, 4),
  inst('review-prep', 1, 11, 20, true, 5), inst('reviewers', 1, 21, 25, true, 6), inst('review-close', 1, 26, 27, true, 7)];
const EARLY = BRIEF1.map((i, k) => (k === 5 ? inst('reviewers', 1, 15, 25, true, 6) : i));

describe('the steps of a forge task (A6)', () => {
  it('the sequences: every path but large starts with begin, and medium ends with done after review-close', () => {
    expect(Object.fromEntries(Object.entries(SEQUENCES).map(([p, s]) => [p, s.map(x => x.step)]))).toEqual({
      trivial: ['begin', 'triage', 'validate'],
      small: ['begin', 'triage', 'prep', 'impl', 'validate', 'done'],
      medium: ['begin', 'triage', 'prep', 'impl', 'review-prep', 'reviewers', 'review-close', 'done'],
      large: ['triage', 'prep', 'impl', 'review-prep', 'reviewers', 'review-close'],
    });
  });
  it('medium: reviewers that start before review-prep ended are out of order; after a review-prep that only failed, reviewers and review-close are degraded (chain)', () => {
    const r = stepsOf('fix', 'medium', [...EARLY, inst('prep', 2, 30, 31, true, 8), inst('impl', 2, 32, 40, true, 9), inst('review-prep', 2, 41, 42, false, 10),
      inst('reviewers', 2, 43, 50, true, 11), inst('review-close', 2, 51, 52, true, 12)], OPTS);
    expect(states(r.rows)).toEqual({ begin: 'ok', triage: 'ok', 'prep#1': 'ok', 'impl#1': 'ok', 'review-prep#1': 'ok', 'reviewers#1': 'out-of-order',
      'review-close#1': 'ok', 'prep#2': 'ok', 'impl#2': 'ok', 'review-prep#2': 'failed', 'reviewers#2': 'degraded', 'review-close#2': 'degraded', done: 'pending' });
    expect(seen(r.findings)).toEqual([
      ['out-of-order', 'reviewers', 1, at(15), [`${T}:6`, `${T}:5`]],
      ['failed', 'review-prep', 2, at(41), [`${T}:10`]],
      ['degraded', 'reviewers', 2, at(43), [`${T}:11`, `${T}:10`]],
      ['degraded', 'review-close', 2, at(51), [`${T}:12`, `${T}:11`]],
    ]);
  });
  it('a required step is missing when a later one ran and pending when none did; an optional one absent is skipped', () => {
    const r = stepsOf('fix', 'medium', BRIEF1.slice(1, 3), OPTS);
    expect(states(r.rows)).toEqual({ begin: 'missing', triage: 'ok', 'prep#1': 'ok', 'impl#1': 'pending', 'review-prep#1': 'pending', 'reviewers#1': 'pending',
      'review-close#1': 'pending', done: 'pending' });
    expect(seen(r.findings)).toEqual([['missing-step', 'begin', null, at(1), [`${T}:2`]]]);
    const small = stepsOf('fix', 'small', [...BRIEF1.slice(0, 3), inst('validate', null, 5, 6, true, 4), inst('done', null, 7, 7, true, 5)], OPTS);
    expect(states(small.rows)).toEqual({ begin: 'ok', triage: 'ok', 'prep#1': 'ok', 'impl#1': 'skipped', validate: 'ok', done: 'ok' });
    expect(small.findings).toEqual([]);
    expect(states(stepsOf('fix', 'trivial', [BRIEF1[1], inst('validate', null, 3, 4, true, 3)], OPTS).rows)).toEqual({ begin: 'missing', triage: 'ok', validate: 'ok' });
  });
  it('without a transcript begin is unverified, and so are impl and reviewers unless an agent event witnesses them; an unknown end of a prerequisite is reported, not judged (Review Focus 5)', () => {
    const some = [BRIEF1[1], BRIEF1[2], BRIEF1[4]];
    const blind = stepsOf('fix', 'medium', some, { transcript: false, agentEvents: false, compactions: [] });
    expect(states(blind.rows)).toMatchObject({ begin: 'unverified', 'impl#1': 'unverified', 'review-prep#1': 'ok', 'reviewers#1': 'unverified' });
    expect(blind.findings).toEqual([]);
    expect(states(stepsOf('fix', 'medium', some, { transcript: false, agentEvents: true, compactions: [] }).rows)).toMatchObject({ 'impl#1': 'missing' });
    const open = stepsOf('fix', 'large', [BRIEF1[1], BRIEF1[2], inst('impl', 1, 5, null, true, 4), BRIEF1[4]], OPTS);
    expect(states(open.rows)).toMatchObject({ 'review-prep#1': 'ok' });
    expect(open.unverified).toEqual([{ step: 'review-prep', brief: 1, after: 'impl' }]);
  });
  it('medium: done follows the review-close of the last brief', () => {
    const r = stepsOf('fix', 'medium', [...BRIEF1, inst('prep', 2, 30, 31, true, 8), inst('impl', 2, 32, 40, true, 9), inst('review-prep', 2, 41, 42, true, 10),
      inst('reviewers', 2, 43, 50, true, 11), inst('done', null, 51, 51, true, 13), inst('review-close', 2, 52, 53, true, 12)], OPTS);
    expect(seen(r.findings)).toEqual([['out-of-order', 'done', null, at(51), [`${T}:13`, `${T}:12`]]]);
  });
  it('an out-of-order step that is the first instance after a compaction is compact-drift too', () => {
    const r = stepsOf('fix', 'medium', EARLY, { ...OPTS, compactions: [{ at: `${T}:9`, ts: at(14) }] });
    expect(seen(r.findings)).toEqual([
      ['out-of-order', 'reviewers', 1, at(15), [`${T}:6`, `${T}:5`]],
      ['compact-drift', 'reviewers', 1, at(15), [`${T}:9`, `${T}:6`]],
    ]);
  });
  it('a ledger event pairs with the latest call of its step that started before it and did not fail; the rest stay apart, sorted by start', () => {
    const led = (step: Instance['step'], brief: number, ts: number, line: number): Instance => ({ ...inst(step, brief, ts, ts, true), at: [`.forge/ledger.jsonl:${line}`] });
    expect(pairInstances([led('review-close', 1, 30.5, 5), led('review-prep', 2, 60, 6)],
      [inst('review-close', 1, 29, 29.5, false, 16), inst('review-close', 1, 30, 30.5, true, 18), inst('prep', 1, 6, 7, true, 8), inst('review-prep', 2, 55, null, null, 24)])).toEqual([
      inst('prep', 1, 6, 7, true, 8),
      inst('review-close', 1, 29, 29.5, false, 16),
      { ...inst('review-close', 1, 30, 30.5, true), at: [`${T}:18`, '.forge/ledger.jsonl:5'] },
      { ...inst('review-prep', 2, 55, 60, true), at: [`${T}:24`, '.forge/ledger.jsonl:6'] },
    ]);
  });
});

describe('repeated work (A6)', () => {
  const ref = (kind: CallRef['kind'], key: string, line: number, ts: number, ok: boolean | null = true): CallRef => ({ task: 'fix', key, kind, ok, ts: at(ts), at: `${T}:${line}` });
  const twice = [ref('once', 'prep fix-1', 4, 2), ref('once', 'prep fix-1', 8, 6)];
  it('a once command run again after a success repeats, after a failure it is a retry, and across a compaction of its own transcript it is drift', () => {
    expect(seen(repeats(twice, []))).toEqual([['repeat', null, null, at(6), [`${T}:4`, `${T}:8`]]]);
    expect(repeats([ref('once', 'prep fix-1', 4, 2, false), ref('once', 'prep fix-1', 8, 6)], [])).toEqual([]);
    expect(seen(repeats(twice, [{ at: `${T}:7`, ts: at(5) }]))).toEqual([['compact-drift', null, null, at(6), [`${T}:7`, `${T}:4`, `${T}:8`]]]);
    expect(repeats(twice, [{ at: '/t/other.jsonl:7', ts: at(5) }]).map(f => f.kind)).toEqual(['repeat']);
  });
  it('the same agent twice with no forge call of its task between them repeats; with one between, it does not', () => {
    const g = (line: number, ts: number) => ref('agent', 'forge:forge-review-correctness|Review brief 1 correctness|fix-1', line, ts);
    expect(seen(repeats([g(12, 15), g(14, 16)], []))).toEqual([['repeat', null, null, at(16), [`${T}:12`, `${T}:14`]]]);
    expect(repeats([g(12, 15), ref('forge', 'review-close fix-1', 13, 15.5), g(14, 16)], [])).toEqual([]);
  });
});

describe('what each record is, and the order (A6)', () => {
  it('maps ledger events, forge calls and agents to the steps of task fix, with their brief', () => {
    const ev = (e: Record<string, unknown>) => stepOfEvent({ ts: at(1), ...e } as unknown as LedgerEvent, 'fix');
    expect(ev({ kind: 'triage', task: 'fix', path: 'medium' })).toEqual({ step: 'triage', brief: null, ok: true });
    expect(ev({ kind: 'phase', task: 'fix-2', phase: 'implement', brief: 2, base: 'abc' })).toEqual({ step: 'prep', brief: 2, ok: true });
    expect(ev({ kind: 'phase', task: 'fix-1', phase: 'review', brief: 1, round: 1 })).toEqual({ step: 'review-prep', brief: 1, ok: true });
    expect(ev({ kind: 'verdict', task: 'fix-1', action: 'fix' })).toEqual({ step: 'review-close', brief: 1, ok: true });
    expect(ev({ kind: 'phase', task: 'fix', phase: 'done', brief: 1 })).toEqual({ step: 'done', brief: null, ok: true });
    expect(ev({ kind: 'validate', task: 'fix', ok: false })).toEqual({ step: 'validate', brief: null, ok: false });
    expect(ev({ kind: 'agent', task: 'fix-1', agent: 'forge-impl-high', role: 'impl-high' })).toEqual({ step: 'impl', brief: 1, ok: true });
    expect(ev({ kind: 'agent', task: 'fix-1', agent: 'forge-review-security', role: 'review-security' })).toEqual({ step: 'reviewers', brief: 1, ok: true });
    for (const e of [{ kind: 'validate', task: 'fix', ok: true, baseline: true }, { kind: 'phase', task: 'fix-1', phase: 'validate' }, { kind: 'triage', task: 'fixed' },
      { kind: 'verdict', task: 'fix-1-2' }]) expect(ev(e), JSON.stringify(e)).toBeNull();
    const fc = (name: string, task: string | null, args = '') => stepOfForge({ name, task, out: null, args }, 'fix');
    expect(fc('begin', 'fix')).toEqual({ step: 'begin', brief: null });
    expect(fc('review-prep', 'fix-1')).toEqual({ step: 'review-prep', brief: 1 });
    expect(fc('validate', 'fix', '--all --task fix')).toEqual({ step: 'validate', brief: null });
    for (const [name, task, args] of [['validate', 'fix', '--all --base-run --task fix'], ['tree snapshot', 'fix', ''], ['prep', 'other-1', '']] as const) {
      expect(fc(name, task, args), name).toBeNull();
    }
    const ag = (type: string, task: string | null) => stepOfAgent({ type, description: 'x', task, project: null }, 'fix');
    expect(ag('forge:forge-mech', 'fix-1')).toEqual({ step: 'impl', brief: 1 });
    expect(ag('forge:forge-review-perf', 'fix-2')).toEqual({ step: 'reviewers', brief: 2 });
    expect(ag('forge:forge-planner', 'fix-1')).toBeNull();
    expect(ag('forge:forge-impl', null)).toBeNull();
  });
  it('sorts the timeline by time, then source, then file and line: the same for any input order', () => {
    const e = (ts: number, source: Entry['source'], ref: string): Entry => ({ ts: at(ts), at: ref, source, what: 'x', task: 'fix' });
    const sorted = [e(1, 'ledger', '.forge/ledger.jsonl:1'), e(1, 'transcript', `${T}:2`), e(1, 'transcript', `${T}:10`), e(2, 'file', '.forge/work/fix/prep-1.json'),
      e(2, 'subagent', '/t/s1/subagents/agent-a1.jsonl:3')];
    for (const order of [[4, 3, 2, 1, 0], [2, 0, 4, 1, 3]]) expect(sortTimeline(order.map(i => sorted[i]))).toEqual(sorted);
  });
  it('drops a finding that cites no file:line and has no ts', () => {
    const f = (refs: string[], ts: string | null): Finding => ({ kind: 'failed', task: 'fix', text: 'x', at: refs, ts });
    const keep = [f([`${T}:3`], null), f(['.forge/work/fix/prep-1.json'], at(1))];
    expect(cited([...keep, f(['.forge/work/fix/prep-1.json'], null), f([], null)])).toEqual(keep);
  });
});
