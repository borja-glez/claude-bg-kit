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
