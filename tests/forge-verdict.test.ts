import { describe, it, expect } from 'vitest';
import { parseReview, parseVerifyFile, verifyReview, weightsFor, synthesize, type Review } from '../src/forge/verdict.js';

const pass = (confidence = 1, findings: Review['findings'] = []): Review => ({ verdict: 'pass', confidence, findings });
const fail = (confidence = 1, findings: Review['findings'] = []): Review => ({ verdict: 'fail', confidence, findings });
const W = weightsFor({ sensitive: false, perf: false });

describe('parseReview', () => {
  it('reads JSON wrapped in prose or a fence', () => {
    expect(parseReview('Here:\n```json\n{"verdict":"pass","confidence":0.8,"findings":[]}\n```').verdict).toBe('pass');
  });
  it('unusable output abstains and is flagged invalid', () => {
    for (const t of [null, '', 'no json', '[1]', '{"verdict":"maybe","confidence":1}', '{"verdict":"pass","confidence":3,"findings":[]}',
      '{"verdict":"pass","findings":[]}', '{"verdict":"pass","confidence":"high"}', '{"verdict":"fail","confidence":0.5,"findings":"none"}']) {
      expect(parseReview(t)).toEqual({ verdict: 'abstain', confidence: 0, findings: [], invalid: true });
    }
  });
  it('a reviewer that abstains on purpose is not invalid', () => {
    expect(parseReview('{"verdict":"abstain","confidence":0}')).toEqual({ verdict: 'abstain', confidence: 0, findings: [] });
  });
  it('coerces numeric strings: confidence "0.8", line "12" and the start of "12-15"', () => {
    const r = parseReview('{"verdict":"fail","confidence":"0.8","findings":[{"severity":"important","file":"a.ts","line":"12","problem":"x"},{"severity":"minor","file":"b.ts","line":"12-15","problem":"y"}]}');
    expect(r).toEqual({ verdict: 'fail', confidence: 0.8, findings: [
      { severity: 'important', file: 'a.ts', line: 12, problem: 'x' },
      { severity: 'minor', file: 'b.ts', line: 12, problem: 'y' },
    ] });
  });
  it('a null file is no file, an unknown severity is important', () => {
    const r = parseReview('{"verdict":"fail","confidence":1,"findings":[{"severity":"huge","file":null,"line":null,"problem":"x","fix":"do y"}]}');
    expect(r.findings).toEqual([{ severity: 'important', problem: 'x', fix: 'do y' }]);
  });
  it('drops an invalid finding, keeps the rest of the review', () => {
    const r = parseReview('{"verdict":"fail","confidence":0.6,"approach":"wrong","findings":[{"severity":"critical"},"text",{"severity":"critical","file":"a.ts","problem":"real"}]}');
    expect(r).toEqual({ verdict: 'fail', confidence: 0.6, approach: 'wrong', invalid: true, dropped: 2, findings: [{ severity: 'critical', file: 'a.ts', problem: 'real' }] });
  });
});

describe('weightsFor', () => {
  it('defaults, sensitive and perf', () => {
    expect(W).toEqual({ correctness: 0.5, security: 0.3, perf: 0.2, verify: 0.5 });
    expect(weightsFor({ sensitive: true, perf: false })).toEqual({ correctness: 0.3, security: 0.5, perf: 0.2, verify: 0.3 });
    expect(weightsFor({ sensitive: false, perf: true })).toEqual({ correctness: 0.3, security: 0.2, perf: 0.5, verify: 0.3 });
    expect(weightsFor({ sensitive: true, perf: true })).toEqual({ correctness: 0.2, security: 0.4, perf: 0.4, verify: 0.2 });
  });
});

describe('synthesize', () => {
  it('all pass with full confidence → accept, score 1', () => {
    expect(synthesize({ correctness: pass(), security: pass(), perf: pass() }, W, true)).toMatchObject({ action: 'accept', score: 1 });
  });
  it('a critical with evidence forces fix even with a high score', () => {
    const r = synthesize({ correctness: pass(1, [{ severity: 'critical', file: 'a.ts', line: 3, problem: 'null deref' }]) }, W, true);
    expect(r.action).toBe('fix');
    expect(r.critical).toHaveLength(1);
  });
  it('a critical without a file is not evidence and does not force', () => {
    expect(synthesize({ correctness: pass(1, [{ severity: 'critical', problem: 'vibes' }]) }, W, true).action).toBe('accept');
  });
  it('pass scores 0.7 + 0.3c, so a weak pass still accepts', () => {
    // pass c=.2 → .76
    expect(synthesize({ correctness: pass(0.2) }, W, true)).toMatchObject({ action: 'accept', score: 0.76 });
  });
  it('a failing reviewer with an important finding → fix (0.6 - 0.1c)', () => {
    // fail c=.8 with an important → .52
    const r = synthesize({ correctness: fail(0.8, [{ severity: 'important', file: 'a.ts', problem: 'bug' }]) }, W, true);
    expect(r).toMatchObject({ action: 'fix', score: 0.52 });
  });
  it('fail with approach wrong → redo (0.5 - 0.5c)', () => {
    // fail c=.5 wrong → .25
    const r = synthesize({ correctness: { ...fail(0.5, [{ severity: 'important', file: 'a.ts', problem: 'bug' }]), approach: 'wrong' } }, W, true);
    expect(r).toMatchObject({ action: 'redo', score: 0.25 });
  });
  it('a critical with score under 0.5 → redo, not fix', () => {
    const r = synthesize({ correctness: { ...fail(1, [{ severity: 'critical', file: 'a.ts', problem: 'bad' }]), approach: 'wrong' } }, W, true);
    expect(r.action).toBe('redo');
  });
  it('a critical with failing validators → fix', () => {
    expect(synthesize({ correctness: pass(1, [{ severity: 'critical', file: 'a.ts', problem: 'bad' }]) }, W, false).action).toBe('fix');
  });
  it('failing validators alone force a fix over a high score (rule 3, no critical involved)', () => {
    const r = synthesize({ correctness: pass(1, [{ severity: 'minor', file: 'a.ts', problem: 'naming' }]) }, W, false);
    expect(r).toMatchObject({ action: 'fix', score: 1, reasons: ['validators failing'] });
    expect(r.critical).toHaveLength(0);
  });
  it('reports which reviewers were invalid', () => {
    const r = synthesize({ correctness: pass(), security: { verdict: 'abstain', confidence: 0, findings: [], invalid: true } }, W, true);
    expect(r.reviewers.map(x => [x.name, x.invalid])).toEqual([['correctness', false], ['security', true]]);
  });
  it('findings of an abstaining reviewer are ignored', () => {
    const r = synthesize({ correctness: pass(), security: { verdict: 'abstain', confidence: 0, findings: [{ severity: 'critical', file: 'a.ts', problem: 'x' }] } }, W, true);
    expect(r.critical).toHaveLength(0);
    expect(r.action).toBe('accept');
  });
  it('the signature covers failing validator lines', () => {
    const rv = { correctness: pass() };
    const a = synthesize(rv, W, false, [{ validator: 'test', failures: ['FAIL a'] }]);
    const b = synthesize(rv, W, false, [{ validator: 'test', failures: ['FAIL b'] }]);
    expect(a.score).toBe(b.score);
    expect(a.signature).not.toBe(b.signature);
  });
  it('score under 0.5 → redo', () => {
    expect(synthesize({ correctness: fail(0.8), security: pass(0.2) }, W, true).action).toBe('redo');
  });
  it('weights renormalise over the reviewers that answered', () => {
    // correctness pass 1 → 1 (w .5), security fail 1 with no findings → 0 (w .3); perf abstains → 0.5/0.8 = 0.625
    const r = synthesize({ correctness: pass(), security: fail(), perf: { verdict: 'abstain', confidence: 0, findings: [] } }, W, true);
    expect(r.score).toBe(0.625);
  });
  it('all abstain → validators decide', () => {
    const abstain: Review = { verdict: 'abstain', confidence: 0, findings: [] };
    expect(synthesize({ correctness: abstain }, W, true)).toMatchObject({ action: 'accept', score: null });
    expect(synthesize({ correctness: abstain }, W, false)).toMatchObject({ action: 'fix', score: null });
  });
  it('failing validators never accept', () => {
    expect(synthesize({ correctness: pass() }, W, false).action).toBe('fix');
  });
  it('splits findings by severity and signs the blocking ones', () => {
    const r = synthesize({ correctness: fail(0.6, [
      { severity: 'important', file: 'b.ts', problem: 'off by one' },
      { severity: 'minor', file: 'c.ts', problem: 'naming' },
    ]) }, W, true);
    // fail c=.6 with an important → .54
    expect(r).toMatchObject({ action: 'fix', score: 0.54 });
    expect(r.important).toHaveLength(1);
    expect(r.minor).toHaveLength(1);
    expect(r.signature).toBe(synthesize({ correctness: fail(0.6, [{ severity: 'important', file: 'b.ts', problem: 'off by one' }]) }, W, true).signature);
  });
});

it('a finding in the wrong shape is dropped and flags the review invalid', () => {
  const r = parseReview('{"verdict":"pass","confidence":0.9,"findings":[{"severity":"critical","file":"a.ts","description":"sql injection"},{"severity":"minor","file":"b.ts","problem":"naming"}]}');
  expect(r).toMatchObject({ verdict: 'pass', confidence: 0.9, invalid: true, dropped: 1 });
  expect(r.findings).toHaveLength(1);
});
it('a clean review has no dropped findings and is not invalid', () => {
  const r = parseReview('{"verdict":"pass","confidence":1,"findings":[]}');
  expect(r.invalid).toBeUndefined();
  expect(r.dropped ?? 0).toBe(0);
});
it('the verdict output reports dropped per reviewer', () => {
  const rev = parseReview('{"verdict":"pass","confidence":1,"findings":[{"severity":"critical","file":"a.ts","description":"x"}]}');
  const out = synthesize({ correctness: rev }, weightsFor({ sensitive: false, perf: false }), true);
  expect(out.reviewers[0]).toMatchObject({ name: 'correctness', invalid: true, dropped: 1 });
});

describe('verify.json', () => {
  const file = (o: Record<string, unknown>) => `Result:\n\`\`\`json\n${JSON.stringify(o)}\n\`\`\``;
  const check = (id: number, ok: unknown, main = false) => ({ id, surface: 'web', name: `c${id}`, main, ok, expected: 'e', observed: 'o', shot: `0${id}.png` });
  it('parses leniently: prose around, ok as a string, a check without shot', () => {
    const v = parseVerifyFile(file({ surfaces: ['web'], result: 'fail', checks: [check(1, 'true'), { ...check(2, false, true), shot: undefined }], learned: [{ surface: 'web', note: 'n' }] }));
    expect(v).toMatchObject({ result: 'fail', reason: null, unchecked: [], learned: [{ surface: 'web', note: 'n' }], proposals: [] });
    expect(v!.checks.map(c => [c.ok, c.shot])).toEqual([[true, '01.png'], [false, null]]);
  });
  it('unusable files are null', () => {
    for (const t of [null, '', 'no json', file({ result: 'maybe', checks: [] }), file({ result: 'pass', checks: 'x' }), file({ result: 'blocked', checks: [] })]) {
      expect(parseVerifyFile(t)).toBeNull();
    }
  });
  it('blocked with a reason parses', () => {
    expect(parseVerifyFile(file({ result: 'blocked', reason: 'no emulator', checks: [] }))).toMatchObject({ result: 'blocked', reason: 'no emulator' });
  });
  it('pass, fail (main critical, others important) and blocked as a review', () => {
    expect(verifyReview(parseVerifyFile(file({ result: 'pass', checks: [check(1, true)] })))).toEqual({ verdict: 'pass', confidence: 1, findings: [] });
    const fail = verifyReview(parseVerifyFile(file({ result: 'fail', checks: [check(1, false, true), check(2, false), check(3, true)] })));
    expect(fail.verdict).toBe('fail');
    expect(fail.findings.map(f => [f.severity, f.file])).toEqual([['critical', 'verify/web'], ['important', 'verify/web']]);
    expect(fail.findings[0].problem).toBe('c1: expected e, observed o');
    expect(verifyReview(parseVerifyFile(file({ result: 'blocked', reason: 'x', checks: [] })))).toEqual({ verdict: 'abstain', confidence: 0, findings: [], invalid: true });
    expect(verifyReview(null)).toEqual({ verdict: 'abstain', confidence: 0, findings: [], invalid: true });
  });
  it('a failing main check fails the verdict like a critical correctness finding', () => {
    const W2 = weightsFor({ sensitive: false, perf: false });
    expect(W2.verify).toBe(W2.correctness);
    const r = synthesize({ correctness: pass(), verify: verifyReview(parseVerifyFile(file({ result: 'fail', checks: [check(1, false, true)] }))) }, W2, true);
    expect(r.action).toBe('fix');
    expect(r.critical).toHaveLength(1);
  });
  it('a blocked verify never fails the task by itself', () => {
    const r = synthesize({ correctness: pass(), verify: verifyReview(parseVerifyFile(file({ result: 'blocked', reason: 'x', checks: [] }))) }, weightsFor({ sensitive: false, perf: false }), true);
    expect(r.action).toBe('accept');
  });
});
