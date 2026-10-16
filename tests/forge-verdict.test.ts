import { describe, it, expect } from 'vitest';
import { parseReview, parseVerifyFile, verifyReview, weightsFor, synthesize, parseHunks, correctOrigin, breaksRubric, type Review, type Finding, type ClosedFinding, type RoundOptions } from '../src/forge/verdict.js';

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
  it('reads id (F1 to F999, any case), regression and outOfModel (true or "true"); a malformed id is dropped; reviewer and residual are never read (J-06, K4-02)', () => {
    const r = parseReview(JSON.stringify({ verdict: 'fail', confidence: 1, findings: [
      { severity: 'important', file: 'a.ts', line: 1, problem: 'a', id: 'f3', regression: 'true' },
      { severity: 'important', file: 'a.ts', line: 2, problem: 'b', id: 'F0001', outOfModel: true },
      { severity: 'minor', problem: 'c', id: 7, regression: false, reviewer: 'security', residual: 'cap', declared: 'critical' },
      { severity: 'important', problem: 'd', id: 'X1', outOfModel: 'yes' },
    ] }));
    expect(r.findings).toEqual([
      { severity: 'important', file: 'a.ts', line: 1, problem: 'a', id: 'F3', regression: true },
      { severity: 'important', file: 'a.ts', line: 2, problem: 'b', outOfModel: true },
      { severity: 'minor', problem: 'c' },
      { severity: 'important', problem: 'd' },
    ]);
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
  it('score under 0.5 with a failing reviewer that says the approach is wrong → redo', () => {
    // correctness wrong c=.8 → .1 (w .5), security pass c=.2 → .76 (w .3): .278/.8 = .3475
    const wrong = { ...fail(0.8, [{ severity: 'important' as const, file: 'a.ts', problem: 'bug' }]), approach: 'wrong' as const };
    expect(synthesize({ correctness: wrong, security: pass(0.2) }, W, true).action).toBe('redo');
  });
  it('weights renormalise over the reviewers that answered', () => {
    // correctness pass 1 → 1 (w .5), security fail 1 with an important → .5 (w .3); perf abstains → .65/.8 = .8125
    const r = synthesize({ correctness: pass(), security: fail(1, [{ severity: 'important', file: 'b.ts', problem: 'bug' }]), perf: { verdict: 'abstain', confidence: 0, findings: [] } }, W, true);
    expect(r.score).toBe(0.813);
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
describe('a draft review (complete: false)', () => {
  it('is flagged incomplete (boolean or "false"); missing or true is complete', () => {
    expect(parseReview('{"verdict":"abstain","confidence":0,"findings":[],"complete":false}')).toEqual({ verdict: 'abstain', confidence: 0, findings: [], incomplete: true });
    expect(parseReview('{"verdict":"pass","confidence":1,"findings":[],"complete":"false"}').incomplete).toBe(true);
    expect(parseReview('{"verdict":"pass","confidence":1,"findings":[],"complete":true}').incomplete).toBeUndefined();
    expect(parseReview('{"verdict":"pass","confidence":1,"findings":[]}').incomplete).toBeUndefined();
  });
  it('is scored as written: a draft fail with an important finding blocks', () => {
    const draft = parseReview('{"verdict":"fail","confidence":0.6,"findings":[{"severity":"important","file":"b.ts","problem":"off by one"}],"complete":false}');
    const r = synthesize({ correctness: draft }, W, true);
    expect(r).toMatchObject({ action: 'fix', score: 0.54 });
    expect(r.important).toHaveLength(1);
    expect(r.reviewers[0]).toMatchObject({ name: 'correctness', incomplete: true, invalid: false });
  });
  it('a draft abstain does not answer', () => {
    const draft = parseReview('{"verdict":"abstain","confidence":0,"findings":[],"complete":false}');
    const r = synthesize({ correctness: pass(), security: draft }, W, true);
    expect(r).toMatchObject({ action: 'accept', score: 1 });
    expect(r.reviewers.map(x => [x.name, x.incomplete])).toEqual([['correctness', false], ['security', true]]);
  });
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
  it('the result follows the checks unless blocked', () => {
    const allOk = parseVerifyFile(file({ result: 'fail', checks: [check(1, true), check(2, true)] }));
    expect(allOk!.result).toBe('pass');
    expect(verifyReview(allOk)).toEqual({ verdict: 'pass', confidence: 1, findings: [] });
    const oneFailed = parseVerifyFile(file({ result: 'pass', checks: [check(1, true), check(2, false)] }));
    expect(oneFailed!.result).toBe('fail');
    const r = verifyReview(oneFailed);
    expect(r.verdict).toBe('fail');
    expect(r.findings).toEqual([{ severity: 'important', file: 'verify/web', problem: 'c2: expected e, observed o' }]);
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

describe('fix rounds: origin and deferred', () => {
  const diff = [
    'diff --git a/src/a.ts b/src/a.ts',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -10,3 +10,4 @@ function f() {',
    ' x',
    '+++ y',
    ' z',
    '@@ -40 +41 @@',
    '-old',
    '+new',
    'diff --git a/src/gone.ts b/src/gone.ts',
    '--- a/src/gone.ts',
    '+++ /dev/null',
    '@@ -1,2 +0,0 @@',
    '-a',
    '-b',
  ].join('\n');
  const hunks = parseHunks(diff);
  const imp = (origin: Finding['origin'], file = 'src/a.ts', line: number | null = 100): Finding =>
    ({ severity: 'important', file, ...(line === null ? {} : { line }), problem: `p-${origin}`, origin });

  it('parseReview reads the three origins and ignores an unknown one', () => {
    const r = parseReview(JSON.stringify({ verdict: 'fail', confidence: 1, findings: ['previous', 'fix', 'untouched', 'other'].map(o =>
      ({ severity: 'important', file: 'a.ts', line: 1, problem: o, origin: o })) }));
    expect(r.findings.map(f => f.origin)).toEqual(['previous', 'fix', 'untouched', undefined]);
  });
  it('reads new-side hunks per file from a unified diff', () => {
    expect(hunks).toEqual({ 'src/a.ts': [{ start: 10, end: 13 }, { start: 41, end: 41 }] });
  });
  it('an untouched finding inside a fix hunk becomes fix; outside it stays untouched', () => {
    expect(correctOrigin(imp('untouched', 'src/a.ts', 12), hunks).origin).toBe('fix');
    expect(correctOrigin(imp('untouched', './src/a.ts', 41), hunks).origin).toBe('fix');
    expect(correctOrigin(imp('untouched', 'src/a.ts', 14), hunks).origin).toBe('untouched');
    expect(correctOrigin(imp('untouched', 'src/b.ts', 12), hunks).origin).toBe('untouched');
    expect(correctOrigin(imp('previous', 'src/a.ts', 12), hunks).origin).toBe('previous');
  });
  it('an untouched finding without file or line never stays untouched', () => {
    expect(correctOrigin(imp('untouched', 'src/a.ts', null), hunks).origin).not.toBe('untouched');
    expect(correctOrigin({ severity: 'important', problem: 'x', origin: 'untouched' }, hunks).origin).not.toBe('untouched');
  });
  it('round 1 does not change: an untouched important still fixes and nothing is deferred', () => {
    const rv = { correctness: fail(0.8, [imp('untouched')]) };
    const plain = synthesize(rv, W, true);
    expect(synthesize(rv, W, true, [], { round: 1, fixHunks: hunks })).toEqual(plain);
    expect(plain).toMatchObject({ action: 'fix', deferred: [] });
    expect(plain.important).toHaveLength(1);
  });
  it('round 2: an untouched important alone accepts and goes to deferred', () => {
    const r = synthesize({ correctness: fail(0.8, [imp('untouched')]), security: pass() }, W, true, [], { round: 2, fixHunks: hunks });
    // the failing review counts as a pass with its confidence: (.5 * .94 + .3 * 1) / .8 = .9625
    expect(r).toMatchObject({ action: 'accept', important: [] });
    expect(r.score).toBeCloseTo(0.9625, 2);
    expect(r.deferred).toEqual([{ ...imp('untouched'), residual: 'untouched' }]);
  });
  it('round 2: with a previous finding as well, fix carries the untouched in the findings', () => {
    const r = synthesize({ correctness: fail(0.8, [imp('untouched'), imp('previous')]) }, W, true, [], { round: 2, fixHunks: hunks });
    expect(r.action).toBe('fix');
    expect(r.important.map(f => f.origin).sort()).toEqual(['previous', 'untouched']);
    expect(r.deferred).toEqual([]);
  });
  it('round 2: a failing validator also opens the round and carries the untouched', () => {
    const r = synthesize({ correctness: fail(0.8, [imp('untouched')]) }, W, false, [{ validator: 'test', failures: ['x'] }], { round: 2, fixHunks: hunks });
    expect(r.action).toBe('fix');
    expect(r.important).toHaveLength(1);
    expect(r.deferred).toEqual([]);
  });
  it('round 2: an untouched inside a fix hunk is fix and blocks', () => {
    const r = synthesize({ correctness: fail(0.8, [imp('untouched', 'src/a.ts', 11)]) }, W, true, [], { round: 2, fixHunks: hunks });
    expect(r.action).toBe('fix');
    expect(r.important[0].origin).toBe('fix');
  });
  it('round 2: a critical untouched blocks', () => {
    const r = synthesize({ correctness: fail(0.8, [{ ...imp('untouched'), severity: 'critical' }]) }, W, true, [], { round: 2, fixHunks: hunks });
    expect(r.action).toBe('fix');
    expect(r.critical).toHaveLength(1);
    expect(r.deferred).toEqual([]);
  });
  it('hunk lines are counted by the @@ ranges: a body line starting with --- or +++ is not a file header', () => {
    const sql = [
      'diff --git a/db/q.sql b/db/q.sql',
      '--- a/db/q.sql',
      '+++ b/db/q.sql',
      '@@ -5,2 +5,2 @@',
      '--- old comment',
      '+++ new comment',
      ' select 1;',
      '@@ -20 +20,2 @@',
      ' x',
      '+y',
    ].join('\n');
    expect(parseHunks(sql)).toEqual({ 'db/q.sql': [{ start: 5, end: 6 }, { start: 20, end: 21 }] });
  });
  it('finding paths are made repo-relative before the origin check: absolute, ./ and backslashes', () => {
    expect(correctOrigin(imp('untouched', '/repo/src/a.ts', 12), hunks, '/repo').origin).toBe('fix');
    expect(correctOrigin(imp('untouched', 'C:\\repo\\src\\a.ts', 12), hunks, 'C:\\repo').origin).toBe('fix');
    expect(correctOrigin(imp('untouched', 'c:/Repo/src/a.ts', 12), hunks, 'C:\\repo').origin).toBe('fix');
    expect(correctOrigin(imp('untouched', '.\\src\\a.ts', 12), hunks).origin).toBe('fix');
    expect(correctOrigin(imp('untouched', '/elsewhere/src/a.ts', 12), hunks, '/repo').origin).toBe('untouched');
    const r = synthesize({ correctness: fail(0.8, [imp('untouched', '/repo/src/a.ts', 12)]) }, W, true, [], { round: 2, fixHunks: hunks, root: '/repo' });
    expect(r.action).toBe('fix');
  });
  it('round 2: approach wrong with only untouched findings is not accepted', () => {
    const wrong = { ...fail(0.2, [imp('untouched')]), approach: 'wrong' as const };
    const r = synthesize({ correctness: wrong, security: pass() }, W, true, [], { round: 2, fixHunks: hunks });
    expect(r.action).not.toBe('accept');
    expect(r.deferred).toEqual([]);
  });
  it('the signature is the same with and without deferred findings', () => {
    const prev = imp('previous');
    const a = synthesize({ correctness: fail(0.8, [prev]) }, W, true, [], { round: 2, fixHunks: hunks });
    const b = synthesize({ correctness: fail(0.8, [prev, imp('untouched')]) }, W, true, [], { round: 2, fixHunks: hunks });
    expect(b.signature).toBe(a.signature);
    const c = synthesize({ correctness: pass() }, W, true, [], { round: 2, fixHunks: hunks });
    const d = synthesize({ correctness: fail(0.8, [imp('untouched')]) }, W, true, [], { round: 2, fixHunks: hunks });
    expect(d.deferred).toHaveLength(1);
    expect(d.signature).toBe(c.signature);
  });
});

describe('what blocks in each review (C-04, C-06, J-05, J-06, K4-02, K4-09)', () => {
  const mk = (over: Partial<Finding> = {}): Finding => ({ severity: 'important', file: 'src/a.ts', line: 10, problem: 'p', reviewer: 'correctness', ...over });
  const closedF1: ClosedFinding = { severity: 'important', file: 'src/a.ts', line: 12, problem: 'the input is not validated', reviewer: 'correctness', id: 'F1', round: 1 };
  const at = (round: number, extra: RoundOptions = {}): RoundOptions => ({ round, ...extra });

  it('review 1: a new important blocks; one only in the person docs is residual docs and the brief is accepted (K4-09)', () => {
    expect(synthesize({ correctness: fail(0.8, [mk({ id: 'F1' })]) }, W, true, [], at(1)).action).toBe('fix');
    const docs = synthesize({ correctness: fail(0.8, [mk({ id: 'F1', file: 'README.md' })]) }, W, true, [], at(1, { personDocs: ['README.md', '**/README.md'] }));
    expect(docs).toMatchObject({ action: 'accept', important: [] });
    expect(docs.deferred).toEqual([mk({ id: 'F1', file: 'README.md', residual: 'docs' })]);
    expect(synthesize({ correctness: fail(0.8, [mk({ id: 'F1', file: 'docs/guide.md' })]) }, W, true, [], at(1, { personDocs: ['README.md'] })).action).toBe('fix');
  });

  it('review 2: a previous one still open blocks, a regression of the fix blocks, hardening of a closed class is residual and accepts', () => {
    expect(synthesize({ correctness: fail(0.8, [mk({ id: 'F1', origin: 'previous' })]) }, W, true, [], at(2, { open: { correctness: ['F1'] } })).action).toBe('fix');
    expect(synthesize({ correctness: fail(0.8, [mk({ id: 'F2', origin: 'fix', file: 'src/b.ts', problem: 'new crash on an empty list' })]) }, W, true, [],
      at(2, { closed: { correctness: [closedF1] } })).action).toBe('fix');
    const hardening = synthesize({ correctness: fail(0.8, [mk({ id: 'F2', origin: 'fix', line: 14, problem: 'the input is not validated when it is empty' })]) }, W, true, [],
      at(2, { closed: { correctness: [closedF1] } }));
    expect(hardening).toMatchObject({ action: 'accept', ask: [], important: [] });
    expect(hardening.deferred).toEqual([expect.objectContaining({ id: 'F2', residual: 'hardening' })]);
    // "regression": true keeps it blocking even when it matches a closed one.
    expect(synthesize({ correctness: fail(0.8, [mk({ id: 'F2', origin: 'fix', line: 14, regression: true })]) }, W, true, [],
      at(2, { closed: { correctness: [closedF1] } })).action).toBe('fix');
  });

  it('from review 3 only criticals and regressions block: a previous important is residual late-round, and rides along when a regression opens the round', () => {
    const r = synthesize({ correctness: fail(0.8, [mk({ id: 'F1', origin: 'previous' })]) }, W, true, [], at(3, { open: { correctness: ['F1'] } }));
    expect(r.action).toBe('accept');
    expect(r.deferred).toEqual([expect.objectContaining({ id: 'F1', residual: 'late-round' })]);
    const both = synthesize({ correctness: fail(0.8, [mk({ id: 'F1', origin: 'previous' }), mk({ id: 'F3', origin: 'fix', file: 'src/c.ts', problem: 'a new bug' })]) }, W, true, [],
      at(3, { open: { correctness: ['F1'] } }));
    expect(both.action).toBe('fix');
    expect(both.important.map(f => [f.id, f.residual ?? null])).toEqual([['F3', null], ['F1', 'late-round']]);
    expect(both.deferred).toEqual([]);
  });

  it('the last review accepts a fix with green validators and no critical, and says how many stay open; red validators or a critical still fix (C-04)', () => {
    const open = { correctness: ['F1'] };
    const r = synthesize({ correctness: fail(0.8, [mk({ id: 'F1', origin: 'previous' }), mk({ id: 'F4', origin: 'fix', file: 'src/d.ts', problem: 'a new one' })]) }, W, true, [],
      at(4, { last: true, open }));
    expect(r.action).toBe('accept');
    expect(r.reasons).toContain('accepted at the cap with 2 open finding(s)');
    expect(r.deferred.map(f => [f.id, f.residual])).toEqual([['F1', 'cap'], ['F4', 'cap']]);
    expect(synthesize({ correctness: fail(0.8, [mk({ id: 'F1', origin: 'previous' })]) }, W, false, [{ validator: 'test', failures: ['x'] }], at(4, { last: true, open })).action).toBe('fix');
    expect(synthesize({ correctness: fail(0.8, [mk({ id: 'F5', origin: 'fix', severity: 'critical' })]) }, W, true, [], at(4, { last: true })).action).toBe('fix');
  });

  it('a security finding of the fix that matches one security closed asks and counts as blocking; ruled out of the model it is minor (K4-02)', () => {
    const closedS: ClosedFinding = { ...closedF1, reviewer: 'security', problem: 'the path is joined without a check' };
    const f = mk({ id: 'F2', origin: 'fix', line: 13, reviewer: 'security', problem: 'the path is joined without a check for short names' });
    const r = synthesize({ security: fail(0.8, [f]) }, W, true, [], at(2, { closed: { security: [closedS] } }));
    expect(r.action).toBe('fix');
    expect(r.ask).toEqual([{ id: 'F2', severity: 'important', file: 'src/a.ts', line: 13, problem: f.problem, earlier: { id: 'F1', round: 1, problem: 'the path is joined without a check' } }]);
    const ruled = synthesize({ security: fail(0.8, [f]) }, W, true, [], at(2, { closed: { security: [closedS] }, outOfModel: ['F2'] }));
    expect(ruled).toMatchObject({ action: 'accept', ask: [], important: [] });
    expect(ruled.minor).toEqual([{ ...f, severity: 'minor', declared: 'important', outOfModel: true, residual: 'out-of-model' }]);
  });

  it('a finding the reviewer marks outOfModel is minor whatever its severity; --defer leaves one as residual architecture', () => {
    const r = synthesize({ security: fail(0.8, [mk({ id: 'F1', reviewer: 'security', severity: 'critical', outOfModel: true })]) }, W, true, [], at(1));
    expect(r).toMatchObject({ action: 'accept', critical: [] });
    expect(r.minor[0]).toMatchObject({ id: 'F1', severity: 'minor', declared: 'critical', outOfModel: true, residual: 'out-of-model' });
    const d = synthesize({ correctness: fail(0.8, [mk({ id: 'F3', origin: 'previous' })]) }, W, true, [], at(2, { open: { correctness: ['F3'] }, defer: ['F3'] }));
    expect(d.action).toBe('accept');
    expect(d.deferred).toEqual([expect.objectContaining({ id: 'F3', residual: 'architecture' })]);
  });

  it('a fail without a critical or important finding breaks the rubric: invalid, and it does not score (J-05)', () => {
    const r = synthesize({ correctness: fail(0.9, [{ severity: 'minor', problem: 'naming' }]), security: pass(0.8) }, W, true);
    expect(r.reviewers.map(x => [x.name, x.verdict, x.invalid])).toEqual([['correctness', 'fail', true], ['security', 'pass', false]]);
    expect(r.reasons).toContain('correctness: fail without a critical or important finding (rubric)');
    expect(r).toMatchObject({ action: 'accept', score: 0.94, minor: [] });
  });

  it('redo only when a failing reviewer says the approach is wrong with a finding that blocks; otherwise a low score is a fix (C-06)', () => {
    expect(synthesize({ correctness: { ...fail(0.5, [mk({ id: 'F1' })]), approach: 'wrong' } }, W, true).action).toBe('redo');
    const docsOnly = synthesize({ correctness: { ...fail(0.8, [mk({ id: 'F1', file: 'README.md' })]), approach: 'wrong' } }, W, true, [], at(1, { personDocs: ['README.md'] }));
    expect(docsOnly.action).toBe('fix');
    expect(docsOnly.reasons[0]).toMatch(/no failing reviewer says approach: wrong/);
  });

  it('signs the blocking findings by severity and id: other words and another score give the same signature; nothing blocking gives none (J-06)', () => {
    const a = synthesize({ correctness: fail(0.8, [mk({ id: 'F1', problem: 'one way to say it' })]) }, W, true);
    const b = synthesize({ correctness: fail(0.6, [mk({ id: 'F1', problem: 'another way', line: 30 })]) }, W, true);
    expect(a.score).not.toBe(b.score);
    expect(a.signature).toBe(b.signature);
    expect(a.signature).toMatch(/^v2:[0-9a-f]{16}$/);
    expect(synthesize({ correctness: fail(0.8, [mk({ id: 'F2' })]) }, W, true).signature).not.toBe(a.signature);
    expect(synthesize({ correctness: pass() }, W, true).signature).toBe('');
    const red = (failures: string[]) => synthesize({ correctness: pass() }, W, false, [{ validator: 'test', failures, failing: ['a.test.ts > adds'] }]).signature;
    expect(red(['FAIL a 12ms'])).toBe(red(['FAIL a 30ms']));
  });

  it('a critical security repeat asks too, also when an express reviewer reports it; a correctness critical that matches a closed one blocks without asking', () => {
    const closedS: ClosedFinding = { ...closedF1, reviewer: 'security', problem: 'the path is joined without a check' };
    const crit = mk({ id: 'F2', origin: 'fix', line: 13, reviewer: 'security', severity: 'critical', problem: 'the path is joined without a check for short names' });
    const express = synthesize({ correctness: fail(0.8, [crit]) }, W, true, [], at(2, { closed: { security: [closedS] } }));
    expect(express).toMatchObject({ action: 'fix', critical: [crit] });
    expect(express.ask).toEqual([expect.objectContaining({ id: 'F2', severity: 'critical', earlier: { id: 'F1', round: 1, problem: closedS.problem } })]);
    const own = synthesize({ correctness: fail(0.8, [mk({ id: 'F2', origin: 'fix', line: 14, severity: 'critical' })]) }, W, true, [], at(2, { closed: { correctness: [closedF1] } }));
    expect(own).toMatchObject({ action: 'fix', ask: [] });
    expect(own.critical).toHaveLength(1);
  });

  it('an id the previous review left open is previous whatever origin the reviewer gives it; an untouched one with regression: true blocks', () => {
    const r = synthesize({ correctness: fail(0.8, [mk({ id: 'F1', origin: 'fix' })]) }, W, true, [], at(3, { open: { correctness: ['F1'] } }));
    expect(r.action).toBe('accept');
    expect(r.deferred).toEqual([expect.objectContaining({ id: 'F1', residual: 'late-round' })]);
    expect(synthesize({ correctness: fail(0.8, [mk({ id: 'F6', origin: 'untouched', file: 'src/z.ts', line: 100, regression: true })]) }, W, true, [], at(2)).action).toBe('fix');
  });

  it('when a round opens, docs ride along to the implementer and hardening stays in deferred', () => {
    const r = synthesize({ correctness: fail(0.8, [
      mk({ id: 'F1', origin: 'previous' }),
      mk({ id: 'F2', origin: 'fix', line: 14, problem: 'the input is not validated when it is empty' }),
      mk({ id: 'F3', origin: 'fix', file: 'README.md' }),
    ]) }, W, true, [], at(2, { open: { correctness: ['F1'] }, closed: { correctness: [closedF1] }, personDocs: ['README.md'] }));
    expect(r.action).toBe('fix');
    expect(r.important.map(f => [f.id, f.residual ?? null])).toEqual([['F1', null], ['F3', 'docs']]);
    expect(r.deferred.map(f => [f.id, f.residual])).toEqual([['F2', 'hardening']]);
  });

  it('at the last review an untouched one keeps its residual and hardening is cap; a fix with nothing left blocking turns into an accept (rule 7)', () => {
    const r = synthesize({ correctness: fail(0.8, [
      mk({ id: 'F2', origin: 'fix', line: 14, problem: 'the input is not validated when it is empty' }),
      mk({ id: 'F6', origin: 'untouched', file: 'src/z.ts', line: 100 }),
    ]) }, W, true, [], at(4, { last: true, closed: { correctness: [closedF1] } }));
    expect(r.action).toBe('accept');
    expect(r.deferred.map(f => [f.id, f.residual])).toEqual([['F2', 'cap'], ['F6', 'untouched']]);
    expect(r.reasons).toContain('accepted at the cap with 1 open finding(s)');
    // approach: wrong keeps the review failing (score .1) but nothing blocks: a fix by rule 2, an accept by rule 7.
    const wrong = synthesize({ correctness: { ...fail(0.8, [mk({ id: 'F1', origin: 'previous' })]), approach: 'wrong' } }, W, true, [], at(4, { last: true, open: { correctness: ['F1'] } }));
    expect(wrong).toMatchObject({ action: 'accept', important: [] });
    expect(wrong.deferred).toEqual([expect.objectContaining({ id: 'F1', residual: 'cap' })]);
    expect(wrong.reasons).toContain('the last review accepts a fix with green validators and no critical (rule 7)');
  });

  it('the last review says when it turns a fix into an accept, also with nothing left at the cap (rule 7)', () => {
    const r = synthesize({ correctness: { ...fail(0.8, [mk({ id: 'F3', file: 'README.md' })]), approach: 'wrong' } }, W, true, [], at(4, { last: true, personDocs: ['README.md'] }));
    expect(r.action).toBe('accept');
    expect(r.reasons).toContain('the last review accepts a fix with green validators and no critical (rule 7)');
    expect(r.reasons.some(x => x.startsWith('accepted at the cap'))).toBe(false);
    expect(r.deferred).toEqual([expect.objectContaining({ id: 'F3', residual: 'docs' })]);
  });

  it('breaksRubric: a fail without an important finding or a critical with evidence; never a pass or an abstention (J-05)', () => {
    expect(breaksRubric(fail(0.9, [{ severity: 'critical', problem: 'vibes' }]))).toBe(true);
    expect(breaksRubric(fail(0.9, [{ severity: 'minor', problem: 'naming' }]))).toBe(true);
    expect(breaksRubric(fail(0.9, []))).toBe(true);
    expect(breaksRubric(fail(0.9, [{ severity: 'critical', file: 'src/a.ts', problem: 'crash' }]))).toBe(false);
    expect(breaksRubric(fail(0.9, [{ severity: 'important', problem: 'no file but important' }]))).toBe(false);
    expect(breaksRubric(pass(1, [{ severity: 'critical', problem: 'vibes' }]))).toBe(false);
    expect(breaksRubric({ verdict: 'abstain', confidence: 0, findings: [] })).toBe(false);
  });

  it('a fail whose only non-minor finding is a critical without evidence breaks the rubric too; a pass carrying one still accepts (J-05)', () => {
    // only security scores: pass c=.8 → .94
    const r = synthesize({ correctness: fail(0.9, [{ severity: 'critical', problem: 'vibes' }]), security: pass(0.8) }, W, true);
    expect(r.reviewers.map(x => [x.name, x.invalid])).toEqual([['correctness', true], ['security', false]]);
    expect(r.reasons).toContain('correctness: fail without a critical or important finding (rubric)');
    expect(r).toMatchObject({ action: 'accept', score: 0.94, minor: [] });
    expect(synthesize({ correctness: pass(1, [{ severity: 'critical', problem: 'vibes' }]) }, W, true).action).toBe('accept');
  });

  it('a hold (an express review whose correctness did not answer, measure 7) never accepts: its findings block once each and its reason is given', () => {
    const held = mk({ id: 'F1', reviewer: 'perf', origin: 'previous' });
    const abstained: Review = { verdict: 'abstain', confidence: 0, findings: [] };
    const r = synthesize({ correctness: abstained, security: pass(0.9) }, W, true, [], at(2, { hold: { reason: 'held', findings: [held] } }));
    expect(r).toMatchObject({ action: 'fix', critical: [], important: [held], deferred: [] });
    expect(r.reasons).toContain('held');
    expect(r.signature).toMatch(/^v2:[0-9a-f]{16}$/);
    // A finding a reviewer still names is not added twice; red validators stay a fix.
    const named = synthesize({ correctness: fail(0.8, [mk({ id: 'F1', origin: 'previous' })]) }, W, true, [],
      at(2, { open: { correctness: ['F1'] }, hold: { reason: 'held', findings: [mk({ id: 'F1', origin: 'previous' })] } }));
    expect(named.important.map(f => f.id)).toEqual(['F1']);
    expect(synthesize({ correctness: abstained }, W, false, [{ validator: 'test', failures: ['x'] }], at(2, { hold: { reason: 'held', findings: [held] } })).action).toBe('fix');
  });

  it('the signature reads a validator\'s failing tests in any order (J-06)', () => {
    const sig = (failing: string[]) => synthesize({ correctness: pass() }, W, false, [{ validator: 'test', failures: ['x'], failing }]).signature;
    expect(sig(['a.test.ts > adds', 'b.test.ts > subtracts'])).toBe(sig(['b.test.ts > subtracts', 'a.test.ts > adds']));
    expect(sig(['a.test.ts > adds'])).not.toBe(sig(['b.test.ts > subtracts']));
  });
});
