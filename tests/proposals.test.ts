import { describe, it, expect } from 'vitest';
import { normalizeProposal, canDecide, applyDecision, isActionable, clipWords, MAX_PROPOSAL_TEXT, MAX_PROPOSAL_TITLE } from '../src/lib/proposals.js';

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
  it('cuts a long title at a word, ends it in … and stays within the limit', () => {
    const title = `${'palabra '.repeat(24)}fin`.padEnd(201, 'z');
    expect(Array.from(title)).toHaveLength(201);
    const p = normalizeProposal({ ...base, title })!;
    expect(p.title.endsWith('…')).toBe(true);
    expect(Array.from(p.title).length).toBeLessThanOrEqual(MAX_PROPOSAL_TITLE);
    expect(p.title).toMatch(/palabra…$/);
    expect(normalizeProposal({ ...base, rationale: `${'mot, '.repeat(900)}` })!.rationale).toMatch(/mot…$/);
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

describe('clipWords', () => {
  it('returns short text unchanged', () => { expect(clipWords('hola mundo', 20)).toBe('hola mundo'); });
  it('cuts at the last space, trims punctuation and appends …', () => {
    expect(clipWords('one two, three four', 12)).toBe('one two…');
    expect(clipWords('one two three', 8)).toBe('one two…');
  });
  it('works on code points', () => {
    const s = '😀😀😀 😀😀😀 😀😀😀';
    const out = clipWords(s, 9);
    expect(out).toBe('😀😀😀 😀😀😀…');
    expect(Array.from(out).length).toBeLessThanOrEqual(9);
  });
  it('hard-cuts one long token', () => {
    const url = `see https://example.com/${'a'.repeat(80)}`;
    const out = clipWords(url, 40);
    expect(Array.from(out)).toHaveLength(40);
    expect(out.startsWith('see https://example.com/aaa')).toBe(true);
    expect(out.endsWith('a…')).toBe(true);
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
