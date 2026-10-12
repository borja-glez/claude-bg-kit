import { describe, it, expect } from 'vitest';
import { normalizeProposal, canDecide, applyDecision, isActionable, MAX_PROPOSAL_TEXT, MAX_PROPOSAL_TITLE } from '../src/lib/proposals.js';

const base = { ts: '2026-10-11T10:00:00.000Z', category: 'perf', risk: 'low', title: 'Cache prices', rationale: 'r', evidence: 'bench: 40 ms → 5 ms', pillar: 'Fast checkout', status: 'proposed', source: 'scout', author: 'session:abc' };

describe('normalizeProposal', () => {
  it('keeps a valid doc', () => { expect(normalizeProposal(base)).toEqual(base); });
  it('rejects unknown category, risk, status or source, and missing title', () => {
    for (const bad of [{ category: 'magic' }, { risk: 'none' }, { status: 'maybe' }, { source: 'bot' }, { title: '' }, { title: 3 }]) {
      expect(normalizeProposal({ ...base, ...bad })).toBeNull();
    }
    expect(normalizeProposal(null)).toBeNull();
    expect(normalizeProposal([])).toBeNull();
  });
  it('clips long text and keeps optional strings only when strings', () => {
    const p = normalizeProposal({ ...base, title: 'x'.repeat(500), rationale: 'y'.repeat(9000), estimate: 30, reason: 'no', decidedBy: 'user:1' })!;
    expect(p.title).toHaveLength(MAX_PROPOSAL_TITLE);
    expect(p.rationale).toHaveLength(MAX_PROPOSAL_TEXT);
    expect(p.estimate).toBeUndefined();
    expect(p).toMatchObject({ reason: 'no', decidedBy: 'user:1' });
  });
  it('keeps a valid taskId and drops an invalid one', () => {
    expect(normalizeProposal({ ...base, taskId: 'T008' })).toMatchObject({ taskId: 'T008' });
    for (const bad of ['', 'a b', 'x'.repeat(65), 'a;b', 5]) expect(normalizeProposal({ ...base, taskId: bad })!.taskId).toBeUndefined();
  });
  it('missing rationale, evidence or pillar become empty strings; missing ts too', () => {
    const { rationale, evidence, pillar, ts, ...rest } = base;
    void rationale; void evidence; void pillar; void ts;
    expect(normalizeProposal(rest)).toMatchObject({ rationale: '', evidence: '', pillar: '', ts: '' });
  });
});

describe('decisions', () => {
  it('only proposed and discussing can be decided', () => {
    expect(['proposed', 'discussing'].every(s => canDecide(s as never))).toBe(true);
    expect(['approved', 'rejected', 'auto_approved', 'done'].some(s => canDecide(s as never))).toBe(false);
  });
  it('maps decisions to statuses', () => {
    expect(applyDecision('approve')).toBe('approved');
    expect(applyDecision('reject')).toBe('rejected');
    expect(applyDecision('discuss')).toBe('discussing');
  });
  it('approved and auto_approved are actionable', () => {
    expect(isActionable({ ...normalizeProposal(base)!, status: 'approved' })).toBe(true);
    expect(isActionable({ ...normalizeProposal(base)!, status: 'auto_approved' })).toBe(true);
    expect(isActionable(normalizeProposal(base)!)).toBe(false);
  });
});
