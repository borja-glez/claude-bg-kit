import { describe, it, expect } from 'vitest';
import { cleanText, deriveStatus, normalizeStatus, type ForgeStatus } from '../src/lib/forge-status.js';

const apply = (events: unknown[]) => events.reduce<ForgeStatus | null>((s, e) => deriveStatus(s, e), null);

describe('deriveStatus', () => {
  it('follows the last task and its briefs', () => {
    const s = apply([
      { ts: '1', kind: 'triage', task: 'old', path: 'small' },
      { ts: '2', kind: 'triage', task: 'hash', path: 'medium' },
      { ts: '3', kind: 'phase', task: 'hash', phase: 'implement' },
      { ts: '4', kind: 'agent', task: 'old', agent: 'other' },
      { ts: '5', kind: 'phase', task: 'hash', phase: 'review' },
      { ts: '6', kind: 'agent', task: 'hash', agent: 'forge-review-security' },
      { ts: '7', kind: 'validate', task: 'hash-1', results: [{ validator: 'test', ok: true, flaky: false }, { validator: 'lint', ok: false }, 'junk'] },
      { ts: '8', kind: 'verdict', task: 'hash-1', action: 'accept', score: 0.97 },
      { ts: '9', kind: 'round', task: 'hash-1', round: 0, cap: 3 },
      { ts: '10', kind: 'verdict', task: 'other-1', action: 'reject', score: 0.1 },
      { ts: '11', kind: 'verdict', task: 'hash-x', action: 'reject', score: 0.1 },
    ]);
    expect(s).toEqual({
      ts: '5', task: 'hash', path: 'medium', phase: 'review', agent: 'forge-review-security',
      validators: [{ name: 'test', ok: true }, { name: 'lint', ok: false }], verdict: { action: 'accept', score: 0.97 }, round: 0, cap: 3,
      brief: 1, accepted: [1], verify: null,
      taskStartedAt: '2', stageSince: '5', stages: {}, doneAt: null, lastAt: '9',
    });
  });
  it('tracks the brief in progress and the accepted briefs, from phase events and brief ids', () => {
    const s = apply([
      { ts: '1', kind: 'triage', task: 'orders', path: 'large' },
      { ts: '2', kind: 'phase', task: 'orders', phase: 'implement', brief: 1 },
      { ts: '3', kind: 'verdict', task: 'orders-1', action: 'accept', score: 0.9 },
      { ts: '4', kind: 'phase', task: 'orders', phase: 'implement', brief: 2 },
      { ts: '5', kind: 'verdict', task: 'orders-2', action: 'fix', score: 0.4 },
      { ts: '6', kind: 'round', task: 'orders-2', round: 1, cap: 3 },
      { ts: '7', kind: 'verdict', task: 'orders-1', action: 'accept', score: 0.9 },
      { ts: '8', kind: 'phase', task: 'orders', phase: 'implement', brief: 'x' },
    ]);
    expect(s).toMatchObject({ brief: 1, accepted: [1], round: 1, verdict: { action: 'accept' } });
    expect(apply([{ ts: '1', kind: 'phase', task: 'a', phase: 'p', brief: 3 }, { ts: '2', kind: 'phase', task: 'a', phase: 'q', brief: -1 }])).toMatchObject({ brief: 3 });
  });
  it('a fresh CLI triage of the same task starts over; a ratchet logged by the session keeps the run', () => {
    const run = [
      { ts: '1', kind: 'triage', task: 'o', path: 'medium', reasons: [] },
      { ts: '2', kind: 'phase', task: 'o', phase: 'implement', brief: 1 },
      { ts: '3', kind: 'agent', task: 'o', agent: 'forge-impl' },
      { ts: '4', kind: 'verdict', task: 'o-1', action: 'accept', score: 0.9 },
    ];
    expect(apply([...run, { ts: '5', kind: 'triage', task: 'o', path: 'large' }])).toMatchObject({ path: 'large', phase: 'implement', agent: 'forge-impl', accepted: [1] });
    expect(apply([...run, { ts: '5', kind: 'triage', task: 'o', path: 'large', reasons: ['x'] }])).toEqual({
      ts: '5', task: 'o', path: 'large', phase: '', agent: null, validators: [], verdict: null, round: null, cap: null, brief: null, accepted: [], verify: null,
      taskStartedAt: '5', stageSince: '5', stages: {}, doneAt: null, lastAt: '5',
    });
  });
  it('reads a status written before brief and accepted existed', () => {
    const old = { ts: '1', task: 'a', path: 'small', phase: '', agent: null, validators: [], verdict: null, round: null, cap: null };
    expect(normalizeStatus(old)).toMatchObject({ brief: null, accepted: [] });
    expect(normalizeStatus({ ...old, brief: 2, accepted: [3, 1, 1, 'x', -2] })).toMatchObject({ brief: 2, accepted: [1, 3] });
  });
  it('a new task starts afresh; junk and events before any task leave the status as it was', () => {
    expect(apply([{ ts: '1', kind: 'agent', task: 'x', agent: 'a' }, null, 'x', { kind: 'phase', task: 'y' }])).toBeNull();
    const s = apply([
      { ts: '1', kind: 'triage', task: 'a', path: 'small' },
      { ts: '2', kind: 'agent', task: 'a', agent: 'impl' },
      { ts: '3', kind: 'phase', task: 'b', phase: 'implement' },
    ]);
    expect(s).toMatchObject({ task: 'b', path: '', phase: 'implement', agent: null });
  });
  it('keeps a score of 0 and nulls a non-numeric one', () => {
    const base = apply([{ ts: '1', kind: 'triage', task: 't', path: 'small' }]);
    expect(deriveStatus(base, { ts: '2', kind: 'verdict', task: 't', action: 'reject', score: 0 })?.verdict).toEqual({ action: 'reject', score: 0 });
    expect(deriveStatus(base, { ts: '2', kind: 'verdict', task: 't', action: 'reject', score: 'x' })?.verdict).toEqual({ action: 'reject', score: null });
  });
  it('carries auto mode from a fresh triage, keeps it through a ratchet, and drops it with a new triage', () => {
    const s1 = deriveStatus(null, { ts: '1', kind: 'triage', task: 't', path: 'large', reasons: [], autonomy: 'auto' })!;
    expect(s1.autonomy).toBe('auto');
    expect(deriveStatus(s1, { ts: '2', kind: 'triage', task: 't', path: 'large' })!.autonomy).toBe('auto');
    expect(deriveStatus(s1, { ts: '3', kind: 'triage', task: 't', path: 'medium', reasons: [] })!).not.toHaveProperty('autonomy');
    expect(normalizeStatus(JSON.parse(JSON.stringify(s1)))!.autonomy).toBe('auto');
    expect(normalizeStatus({ ...s1, autonomy: 'yes' })).not.toHaveProperty('autonomy');
  });
  it('strips C1 controls and bidi overrides/isolates too', () => {
    const cp = (n: number) => String.fromCharCode(n);
    expect(cleanText(`a\u0085b\u009bc${cp(0x202e)}d${cp(0x202a)}e${cp(0x2066)}f${cp(0x2069)}g\u007fh`)).toBe('abcdefgh');
    expect(cleanText('ñ é  x')).toBe('ñ é  x');
  });
  it('strips control characters and clips to 80', () => {
    expect(apply([{ ts: '1', kind: 'triage', task: `a\u001bb${'c'.repeat(100)}`, path: 'x\u0007' }])).toMatchObject({ task: `ab${'c'.repeat(78)}`, path: 'x' });
  });
});

describe('normalizeStatus', () => {
  it('rejects wrong shapes', () => {
    expect(normalizeStatus(null)).toBeNull();
    expect(normalizeStatus({ ts: '1', task: '', path: '', phase: '', agent: null, validators: [], verdict: null })).toBeNull();
    expect(normalizeStatus({ ts: '1', task: 't', path: '', phase: '', agent: 3, validators: [], verdict: null })).toBeNull();
  });
});

describe('verify in the status', () => {
  const t = (kind: string, extra: Record<string, unknown> = {}) => ({ ts: '2026-10-12T10:00:00Z', kind, task: 'x', ...extra });
  it('a plan then a result fill verify; a fresh triage clears it', () => {
    let s = deriveStatus(null, { ...t('triage'), path: 'medium', reasons: [] });
    expect(s!.verify).toBeNull();
    s = deriveStatus(s, { ...t('verify'), task: 'x-1', planned: true, surfaces: ['web'] });
    expect(s!.verify).toEqual({ planned: true, surfaces: ['web'], result: null, passed: null, total: null, evidence: null, reason: null });
    s = deriveStatus(s, { ...t('verify'), task: 'x-1', result: 'fail', passed: 4, total: 6, evidence: '.forge/work/x/evidence/1-1' });
    expect(s!.verify).toEqual({ planned: true, surfaces: ['web'], result: 'fail', passed: 4, total: 6, evidence: '.forge/work/x/evidence/1-1', reason: null });
    s = deriveStatus(s, { ...t('triage'), path: 'medium', reasons: [] });
    expect(s!.verify).toBeNull();
  });
  it('normalizeStatus keeps a valid verify and drops a broken one; old files read as null', () => {
    const base = { ts: 'a', task: 'x', path: 'medium', phase: 'review', agent: null, validators: [], verdict: null, round: null, cap: null, brief: 1, accepted: [] };
    expect(normalizeStatus(base)!.verify).toBeNull();
    expect(normalizeStatus({ ...base, verify: { planned: true, surfaces: ['web', 3], result: 'pass', passed: 1, total: 1, evidence: 'e', reason: null } })!.verify)
      .toEqual({ planned: true, surfaces: ['web'], result: 'pass', passed: 1, total: 1, evidence: 'e', reason: null });
    expect(normalizeStatus({ ...base, verify: 'yes' })!.verify).toBeNull();
  });
});

describe('deriveStatus timings', () => {
  const T = (s: number) => new Date(Date.parse('2026-10-12T10:00:00.000Z') + s * 1000).toISOString();
  const run = [
    { ts: T(0), kind: 'triage', task: 'o', path: 'medium', reasons: [] },
    { ts: T(12), kind: 'phase', task: 'o', phase: 'implement', brief: 1 },
    { ts: T(312), kind: 'phase', task: 'o', phase: 'validate', brief: 1 },
    { ts: T(360), kind: 'phase', task: 'o', phase: 'fix', brief: 1 },
    { ts: T(400), kind: 'phase', task: 'o', phase: 'implement', brief: 2 },
  ];
  it('sums the seconds of phases named constructor or __proto__ like any other', () => {
    const s = apply([
      { ts: T(0), kind: 'triage', task: 'o', path: 'medium', reasons: [] },
      { ts: T(10), kind: 'phase', task: 'o', phase: 'constructor' },
      { ts: T(30), kind: 'phase', task: 'o', phase: '__proto__' },
      { ts: T(35), kind: 'phase', task: 'o', phase: 'constructor' },
      { ts: T(40), kind: 'phase', task: 'o', phase: 'x' },
    ])!;
    expect(Object.entries(s.stages)).toEqual([['triage', 10], ['constructor', 25], ['__proto__', 5]]);
    expect(Object.getPrototypeOf(s.stages)).toBeNull();
    const back = normalizeStatus(JSON.parse(JSON.stringify(s)))!;
    expect(Object.entries(back.stages)).toEqual(Object.entries(s.stages));
  });
  it('starts the task at its triage and sums each closed stage in seconds, by phase name', () => {
    const s = apply(run)!;
    expect(s).toMatchObject({ taskStartedAt: T(0), stageSince: T(400), doneAt: null });
    expect(s.stages).toEqual({ triage: 12, implement: 300, validate: 48, fix: 40 });
    // A second stretch of the same phase adds up.
    const s2 = apply([...run, { ts: T(460), kind: 'phase', task: 'o', phase: 'review' }])!;
    expect(s2.stages.implement).toBe(360);
  });
  it('the done phase closes the stage and sets doneAt; a later done keeps the first; another phase reopens', () => {
    const done = apply([...run, { ts: T(500), kind: 'phase', task: 'o', phase: 'done' }])!;
    expect(done).toMatchObject({ doneAt: T(500), stageSince: T(500), phase: 'done' });
    expect(done.stages.implement).toBe(400);
    const again = deriveStatus(done, { ts: T(900), kind: 'phase', task: 'o', phase: 'done' })!;
    expect(again.doneAt).toBe(T(500));
    expect(again.stages).toEqual(done.stages);
    const reopened = deriveStatus(done, { ts: T(900), kind: 'phase', task: 'o', phase: 'review' })!;
    expect(reopened).toMatchObject({ doneAt: null, stageSince: T(900) });
    // The time between done and the reopening is not a stage.
    expect(reopened.stages).toEqual(done.stages);
  });
  it('a verdict accepting the task itself finishes it; a brief accept does not', () => {
    const brief = apply([...run, { ts: T(450), kind: 'verdict', task: 'o-2', action: 'accept', score: 0.9 }])!;
    expect(brief.doneAt).toBeNull();
    const task = apply([...run, { ts: T(450), kind: 'verdict', task: 'o', action: 'accept', score: 0.9 }])!;
    expect(task).toMatchObject({ doneAt: T(450), stageSince: T(450) });
    expect(task.stages.implement).toBe(350);
  });
  it('a fresh CLI triage of the same id starts the clock over; a ratchet triage keeps it', () => {
    const fresh = apply([...run, { ts: T(600), kind: 'triage', task: 'o', path: 'large', reasons: ['x'] }])!;
    expect(fresh).toMatchObject({ taskStartedAt: T(600), stageSince: T(600), stages: {}, doneAt: null });
    const ratchet = apply([...run, { ts: T(600), kind: 'triage', task: 'o', path: 'large' }])!;
    expect(ratchet).toMatchObject({ taskStartedAt: T(0), stageSince: T(400) });
  });
  it('skips a stage whose end is before its start or whose times are not ISO', () => {
    const back = apply([run[0], { ts: T(-30), kind: 'phase', task: 'o', phase: 'implement' }])!;
    expect(back.stages).toEqual({});
    expect(back.stageSince).toBe(T(-30));
    const junk = apply([{ ts: 'x', kind: 'triage', task: 'o', path: 'small' }, { ts: T(5), kind: 'phase', task: 'o', phase: 'implement' }])!;
    expect(junk.stages).toEqual({});
  });
  it('normalizeStatus keeps valid timings and reads an older status without them', () => {
    const base = { ts: 'a', task: 'x', path: 'medium', phase: 'review', agent: null, validators: [], verdict: null, round: null, cap: null };
    expect(normalizeStatus(base)).toMatchObject({ taskStartedAt: null, stageSince: null, stages: {}, doneAt: null });
    const good = normalizeStatus({ ...base, taskStartedAt: T(0), stageSince: T(9), doneAt: T(20), stages: { triage: 9, implement: 11.4, bad: -1, junk: 'x', '\u001b': 3 } })!;
    expect(good).toMatchObject({ taskStartedAt: T(0), stageSince: T(9), doneAt: T(20), stages: { triage: 9, implement: 11 } });
    expect(normalizeStatus({ ...base, taskStartedAt: 7, stages: 'x', doneAt: 'y'.repeat(100) })).toMatchObject({ taskStartedAt: null, stages: {}, doneAt: null });
    const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`p${i}`, i]));
    expect(Object.keys(normalizeStatus({ ...base, stages: many })!.stages)).toHaveLength(20);
  });
});

describe('deriveStatus closes a light task', () => {
  const T = (s: number) => new Date(Date.parse('2026-10-12T10:00:00.000Z') + s * 1000).toISOString();
  const triage = (path: string) => ({ ts: T(0), kind: 'triage', task: 'f', path, reasons: [] });
  it('a done phase also clears the agent', () => {
    const s = apply([triage('medium'), { ts: T(10), kind: 'agent', task: 'f', agent: 'forge-impl' }, { ts: T(20), kind: 'phase', task: 'f', phase: 'done' }])!;
    expect(s).toMatchObject({ doneAt: T(20), agent: null });
  });
  it('a passing validate of a trivial task itself finishes it; a failing, baseline, brief or non-trivial one does not', () => {
    const ok = { ts: T(30), kind: 'validate', task: 'f', ok: true, results: [{ validator: 'test', ok: true }] };
    const done = apply([triage('trivial'), ok])!;
    expect(done).toMatchObject({ doneAt: T(30), stageSince: T(30), stages: { triage: 30 } });
    expect(apply([triage('trivial'), { ...ok, ok: false }])!.doneAt).toBeNull();
    expect(apply([triage('trivial'), { ...ok, baseline: true }])!.doneAt).toBeNull();
    expect(apply([triage('trivial'), { ...ok, task: 'f-1' }])!.doneAt).toBeNull();
    expect(apply([triage('small'), ok])!.doneAt).toBeNull();
    // A second passing validate keeps the first finish.
    expect(deriveStatus(done, { ...ok, ts: T(90) })!.doneAt).toBe(T(30));
  });
  it('an agent launched after the task closed reopens it', () => {
    const s = apply([triage('trivial'), { ts: T(30), kind: 'validate', task: 'f', ok: true, results: [] }, { ts: T(60), kind: 'agent', task: 'f', agent: 'forge-verify' }])!;
    expect(s).toMatchObject({ doneAt: null, stageSince: T(60), agent: 'forge-verify', stages: { triage: 30 } });
  });
  it('an agent after a done phase moves the phase off done: verify for the verify agent, else the last stage', () => {
    const medium = [triage('medium'), { ts: T(10), kind: 'phase', task: 'f', phase: 'implement' }, { ts: T(50), kind: 'phase', task: 'f', phase: 'review' },
      { ts: T(80), kind: 'verdict', task: 'f-1', action: 'accept', score: 0.9 }, { ts: T(100), kind: 'phase', task: 'f', phase: 'done' }];
    const impl = apply([...medium, { ts: T(200), kind: 'agent', task: 'f', agent: 'forge-impl' }])!;
    // The accept belonged to the finished run: a new agent is new work, so it no longer reads as accepted.
    expect(impl).toMatchObject({ phase: 'review', doneAt: null, agent: 'forge-impl', verdict: null, accepted: [1] });
    expect(apply([...medium, { ts: T(200), kind: 'agent', task: 'f', agent: 'forge-verify' }])!.phase).toBe('verify');
    const light = apply([triage('small'), { ts: T(100), kind: 'phase', task: 'f', phase: 'done' }, { ts: T(200), kind: 'agent', task: 'f', agent: 'forge-impl-light' }])!;
    expect(light).toMatchObject({ phase: '', doneAt: null });
    // Finished again by a verify result (light) or a done phase.
    expect(deriveStatus(light, { ts: T(300), kind: 'verify', task: 'f', result: 'pass', passed: 1, total: 1 })!.doneAt).toBe(T(300));
    expect(deriveStatus(impl, { ts: T(300), kind: 'phase', task: 'f', phase: 'done' })!).toMatchObject({ doneAt: T(300), agent: null });
  });
  it('a ratchet that raises a closed task\'s path reopens it', () => {
    const closed = apply([triage('trivial'), { ts: T(30), kind: 'validate', task: 'f', ok: true, results: [] }])!;
    expect(deriveStatus(closed, { ts: T(60), kind: 'triage', task: 'f', path: 'medium' })!).toMatchObject({ path: 'medium', doneAt: null, stageSince: T(60) });
    expect(deriveStatus(closed, { ts: T(60), kind: 'triage', task: 'f', path: 'trivial' })!.doneAt).toBe(T(30));
  });
  it('a verify result clears the verify agent and finishes a trivial or small task', () => {
    const run = [triage('small'), { ts: T(60), kind: 'agent', task: 'f', agent: 'forge-verify' }, { ts: T(70), kind: 'verify', task: 'f', planned: true, surfaces: ['web'] }];
    const res = { ts: T(200), kind: 'verify', task: 'f', result: 'pass', passed: 2, total: 2 };
    const s = apply([...run, res])!;
    expect(s).toMatchObject({ agent: null, doneAt: T(200), stageSince: T(200), stages: { triage: 200 }, verify: { result: 'pass', passed: 2, total: 2 } });
    expect(apply([...run, { ...res, task: 'f-1' }])!).toMatchObject({ agent: null, doneAt: T(200) });
    // Only the verify agent is cleared; Medium and Large finish by verdict, not by the verify result.
    const medium = apply([triage('medium'), { ts: T(60), kind: 'agent', task: 'f', agent: 'forge-verify-heavy' }, res])!;
    expect(medium).toMatchObject({ agent: null, doneAt: null });
    expect(apply([triage('small'), { ts: T(60), kind: 'agent', task: 'f', agent: 'forge-impl' }, res])!).toMatchObject({ agent: 'forge-impl', doneAt: T(200) });
    // A plan alone is no result.
    expect(apply(run)!).toMatchObject({ agent: 'forge-verify', doneAt: null });
  });
  it('keeps lastAt, the time of the task\'s latest event of any kind', () => {
    const s = apply([triage('small'), { ts: T(60), kind: 'agent', task: 'f', agent: 'forge-verify' }, { ts: T(90), kind: 'verify', task: 'f-1', planned: true, surfaces: [] }, { ts: T(500), kind: 'agent', task: 'other', agent: 'x' }])!;
    expect(s).toMatchObject({ ts: T(0), lastAt: T(90) });
    expect(normalizeStatus(JSON.parse(JSON.stringify(s)))!.lastAt).toBe(T(90));
    expect(normalizeStatus({ ...s, lastAt: undefined })!.lastAt).toBeNull();
  });
  it('the B016 run: small, forge-verify launched with no phase logged, then its result', () => {
    const s = apply([
      triage('small'),
      { ts: T(542), kind: 'validate', task: 'f', ok: true, results: [{ validator: 'test', ok: true }] },
      { ts: T(600), kind: 'agent', task: 'f', agent: 'forge-verify' },
      { ts: T(700), kind: 'verify', task: 'f', result: 'pass', passed: 3, total: 3 },
    ])!;
    expect(s).toMatchObject({ agent: null, doneAt: T(700), verify: { result: 'pass' }, lastAt: T(700) });
  });
});

describe('deriveStatus: the phase stopped (K2-02)', () => {
  it('ends the task like done: doneAt, no agent; a repeated stopped keeps the first, another phase reopens it', () => {
    const s = apply([
      { ts: '2026-10-16T10:00:00.000Z', kind: 'triage', task: 'T1', path: 'large', reasons: [] },
      { ts: '2026-10-16T10:01:00.000Z', kind: 'agent', task: 'T1-1', agent: 'forge-impl' },
      { ts: '2026-10-16T10:05:00.000Z', kind: 'phase', task: 'T1', phase: 'stopped' },
    ])!;
    expect(s).toMatchObject({ phase: 'stopped', doneAt: '2026-10-16T10:05:00.000Z', agent: null });
    expect(deriveStatus(s, { ts: '2026-10-16T10:06:00.000Z', kind: 'phase', task: 'T1', phase: 'stopped' })!.doneAt).toBe('2026-10-16T10:05:00.000Z');
    expect(deriveStatus(s, { ts: '2026-10-16T10:07:00.000Z', kind: 'phase', task: 'T1', phase: 'implement' })).toMatchObject({ phase: 'implement', doneAt: null });
  });
});
