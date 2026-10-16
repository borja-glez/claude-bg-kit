import { describe, it, expect } from 'vitest';
import { reviewRound, type RoundInput, type TriageReview } from '../src/forge/review-round.js';

const files = { brief: 'w/brief-1.md', diff: 'w/diff-1.patch', validators: 'w/validators-1.json', out: 'w/reviews-1-R', shadow: 'w/reviews-1-R/shadow',
  fix: 'w/fix-1-R.patch', findings: (name: string) => `w/reviews-1-R/previous-${name}.json` };
const medium: TriageReview = {
  light: false, flags: ['--sensitive', '--perf'],
  reviewers: [
    { role: 'review-correctness', agent: 'forge-review-correctness', model: null, effort: 'xhigh' },
    { role: 'review-security', agent: 'forge-review-security', model: null, effort: 'high' },
    { role: 'review-perf', agent: 'forge-review-perf', model: null, effort: 'medium' },
  ],
};
const plain: TriageReview = { light: false, flags: [], reviewers: [{ role: 'review-correctness', agent: 'forge-review-correctness', model: null, effort: 'high' }] };
const at = (over: Partial<RoundInput>): RoundInput => ({ review: medium, round: 1, path: 'medium', files, ...over });
const pass = { verdict: 'pass' as const, findings: [] };
const fail = (file = 'src/a.ts') => ({ verdict: 'fail' as const, findings: [{ severity: 'important' as const, file, line: 3, problem: 'p' }] });

describe('reviewRound', () => {
  it('round 1 without the shadow test: every reviewer in full mode with the triage model and effort, no twin', () => {
    const r = reviewRound(at({}));
    expect(r.round).toBe(1);
    expect(r.carried).toEqual([]);
    expect(r.spawn.map(s => [s.agent, s.model, s.effort, s.mode, s.twin])).toEqual([
      ['forge-review-correctness', null, 'xhigh', 'full', false],
      ['forge-review-security', null, 'high', 'full', false],
      ['forge-review-perf', null, 'medium', 'full', false],
    ]);
    expect(r.spawn[0].inputs).toEqual({ brief: 'w/brief-1.md', diff: 'w/diff-1.patch', validators: 'w/validators-1.json', out: 'w/reviews-1-R' });
  });

  it('round 1 with the shadow test open on Medium: an xhigh twin per reviewer at high, writing to shadow/', () => {
    const r = reviewRound(at({ shadowOpen: true }));
    const twins = r.spawn.filter(s => s.twin);
    expect(twins).toHaveLength(1);
    expect(twins[0]).toMatchObject({ agent: 'forge-review-security', effort: 'xhigh', mode: 'full', name: 'security' });
    expect(twins[0].inputs).toEqual({ ...r.spawn.find(s => s.name === 'security' && !s.twin)!.inputs, out: 'w/reviews-1-R/shadow' });
    expect(r.shadow).toBe(true);
  });

  it('no twin below Medium even with the test open', () => {
    const light: TriageReview = { light: true, flags: [], reviewers: [{ role: 'review-correctness', agent: 'forge-review-correctness', model: 'sonnet', effort: 'medium' }] };
    expect(reviewRound(at({ review: light, path: 'small', shadowOpen: true })).spawn.filter(s => s.twin)).toEqual([]);
    expect(reviewRound(at({ review: { ...plain }, path: 'small', shadowOpen: true })).spawn.filter(s => s.twin)).toEqual([]);
    expect(reviewRound(at({ review: plain, path: 'large', shadowOpen: true })).spawn.filter(s => s.twin)).toHaveLength(1);
  });

  it('round 2: a reviewer that failed repeats in delta with only its own findings and the fix diff', () => {
    const r = reviewRound(at({ round: 2, previous: { 'review-correctness': pass, 'review-security': fail(), 'review-perf': pass }, fixZones: [], fixFiles: ['src/b.ts'] }));
    const sec = r.spawn.find(s => s.name === 'security')!;
    expect(sec.mode).toBe('delta');
    expect(sec.inputs).toEqual({ brief: 'w/brief-1.md', diff: 'w/diff-1.patch', validators: 'w/validators-1.json', out: 'w/reviews-1-R',
      fix: 'w/fix-1-R.patch', findings: 'w/reviews-1-R/previous-security.json' });
  });

  it('round 2: correctness always repeats in delta, also when it passed', () => {
    const r = reviewRound(at({ review: plain, round: 2, previous: { 'review-correctness': pass }, fixZones: [], fixFiles: [] }));
    expect(r.spawn.map(s => [s.name, s.mode])).toEqual([['correctness', 'delta']]);
    expect(r.carried).toEqual([]);
  });

  it('round 2: security that passed is carried unless the fix touches a sensitive zone', () => {
    const previous = { 'review-correctness': fail(), 'review-security': pass, 'review-perf': pass };
    const carried = reviewRound(at({ round: 2, previous, fixZones: [], fixFiles: ['src/a.ts'] }));
    expect(carried.spawn.map(s => s.name)).toEqual(['correctness']);
    expect(carried.carried).toEqual([{ role: 'review-security', name: 'security', verdict: 'pass' }, { role: 'review-perf', name: 'perf', verdict: 'pass' }]);
    const relaunched = reviewRound(at({ round: 2, previous, fixZones: ['auth'], fixFiles: ['src/auth/login.ts'] }));
    expect(relaunched.spawn.map(s => [s.name, s.mode])).toEqual([['correctness', 'delta'], ['security', 'delta']]);
  });

  it('round 2: a passed security that was a draft or invalid is not carried: it repeats in delta', () => {
    const fixed = { fixZones: [], fixFiles: ['src/a.ts'] };
    for (const flag of [{ incomplete: true }, { invalid: true }]) {
      const previous = { 'review-correctness': fail(), 'review-security': { ...pass, ...flag }, 'review-perf': pass };
      const r = reviewRound(at({ round: 2, previous, ...fixed }));
      expect(r.spawn.map(s => [s.name, s.mode])).toEqual([['correctness', 'delta'], ['security', 'delta']]);
      expect(r.spawn[1].inputs.findings).toBe('w/reviews-1-R/previous-security.json');
      expect(r.carried.map(c => c.name)).toEqual(['perf']);
    }
    // A complete, valid one is still carried.
    const ok = { 'review-correctness': fail(), 'review-security': { ...pass, incomplete: false, invalid: false }, 'review-perf': pass };
    expect(reviewRound(at({ round: 2, previous: ok, ...fixed })).carried.map(c => c.name)).toEqual(['security', 'perf']);
  });

  it('round 2: perf that passed repeats only when the fix touches a file it flagged', () => {
    const perfPassed = { verdict: 'pass' as const, findings: [{ severity: 'minor' as const, file: './src/hot.ts', line: 9, problem: 'slow loop' }] };
    const previous = { 'review-correctness': pass, 'review-security': pass, 'review-perf': perfPassed };
    expect(reviewRound(at({ round: 2, previous, fixZones: [], fixFiles: ['src/cold.ts'] })).carried.map(c => c.name)).toEqual(['security', 'perf']);
    const r = reviewRound(at({ round: 2, previous, fixZones: [], fixFiles: ['src/hot.ts'] }));
    expect(r.spawn.map(s => [s.name, s.mode])).toEqual([['correctness', 'delta'], ['perf', 'delta']]);
  });

  it('round 2: a reviewer absent from the previous round runs in full mode', () => {
    const r = reviewRound(at({ round: 2, previous: { 'review-correctness': pass }, fixZones: [], fixFiles: [] }));
    expect(r.spawn.map(s => [s.name, s.mode])).toEqual([['correctness', 'delta'], ['security', 'full'], ['perf', 'full']]);
  });

  it('after a redo every reviewer runs in full mode and nothing is carried', () => {
    const r = reviewRound(at({ round: 2, redo: true, shadowOpen: true, previous: { 'review-correctness': fail(), 'review-security': pass, 'review-perf': pass }, fixZones: [], fixFiles: [] }));
    expect(r.spawn.map(s => [s.name, s.mode, s.twin])).toEqual([['correctness', 'full', false], ['security', 'full', false], ['perf', 'full', false]]);
    expect(r.carried).toEqual([]);
    expect(r.spawn[0].inputs.fix).toBeUndefined();
  });

  it('a delta round has no twin, even with the shadow test open', () => {
    const r = reviewRound(at({ round: 2, shadowOpen: true, previous: { 'review-correctness': fail(), 'review-security': fail(), 'review-perf': pass }, fixZones: [], fixFiles: [] }));
    expect(r.spawn.filter(s => s.twin)).toEqual([]);
    expect(r.shadow).toBe(false);
  });

  it('the implementer report goes to correctness only', () => {
    const r = reviewRound(at({ files: { ...files, report: 'w/report-1.txt' } }));
    expect(r.spawn.find(s => s.name === 'correctness')!.inputs.report).toBe('w/report-1.txt');
    expect(r.spawn.find(s => s.name === 'security')!.inputs.report).toBeUndefined();
  });
  it('the threat model goes to security only, in full and in delta (K4-02)', () => {
    const tm = { ...files, threatModel: 'w/threat-model.md' };
    const first = reviewRound(at({ files: tm }));
    expect(first.spawn.find(s => s.name === 'security')!.inputs.threatModel).toBe('w/threat-model.md');
    expect(first.spawn.find(s => s.name === 'correctness')!.inputs.threatModel).toBeUndefined();
    const delta = reviewRound(at({ files: tm, round: 2, previous: { 'review-correctness': pass, 'review-security': fail(), 'review-perf': pass }, fixZones: [], fixFiles: [] }));
    expect(delta.spawn.find(s => s.name === 'security')!.inputs).toMatchObject({ threatModel: 'w/threat-model.md', findings: 'w/reviews-1-R/previous-security.json' });
  });

  it('an express review: one correctness reviewer on Sonnet at medium in delta, the passing reviewers carried, the failing ones delegated (measure 7)', () => {
    const ex = { ...files, expressFindings: 'w/reviews-1-R/previous-express.json' };
    const previous = { 'review-correctness': fail(), 'review-security': pass, 'review-perf': fail('src/hot.ts') };
    const r = reviewRound(at({ files: ex, round: 2, express: true, previous, fixZones: [], fixFiles: ['src/a.ts'] }));
    expect(r).toMatchObject({ express: true, delegated: ['correctness', 'perf'], carried: [{ role: 'review-security', name: 'security', verdict: 'pass' }], shadow: false });
    expect(r.spawn).toEqual([{ role: 'review-correctness', name: 'correctness', agent: 'forge-review-correctness', model: 'sonnet', effort: 'medium', mode: 'delta', twin: false, express: true,
      inputs: { brief: 'w/brief-1.md', diff: 'w/diff-1.patch', validators: 'w/validators-1.json', out: 'w/reviews-1-R', fix: 'w/fix-1-R.patch', findings: 'w/reviews-1-R/previous-express.json' } }]);
  });

  it('no express review when security repeats, a passing reviewer has to repeat, after a redo, without the findings file or when not asked', () => {
    const ex = { ...files, expressFindings: 'w/reviews-1-R/previous-express.json' };
    const ok = { 'review-correctness': fail(), 'review-security': pass, 'review-perf': pass };
    expect(reviewRound(at({ files: ex, round: 2, express: true, previous: { ...ok, 'review-security': fail() }, fixZones: [], fixFiles: ['src/a.ts'] })).express).toBe(false);
    expect(reviewRound(at({ files: ex, round: 2, express: true, previous: ok, fixZones: ['auth'], fixFiles: ['src/auth/login.ts'] })).express).toBe(false);
    expect(reviewRound(at({ files: ex, round: 2, express: true, redo: true, previous: ok, fixZones: [], fixFiles: ['src/a.ts'] })).express).toBe(false);
    expect(reviewRound(at({ files, round: 2, express: true, previous: ok, fixZones: [], fixFiles: ['src/a.ts'] })).express).toBe(false);
    const normal = reviewRound(at({ files: ex, round: 2, previous: ok, fixZones: [], fixFiles: ['src/a.ts'] }));
    expect(normal).toMatchObject({ express: false, delegated: [] });
    expect(normal.spawn.map(s => [s.name, s.mode, s.express ?? false])).toEqual([['correctness', 'delta', false]]);
  });
});
