import { describe, it, expect } from 'vitest';
import { proposalDigest, markMatches, normalizeApproval, ownerApproved, normalizeProposal, canDecide, applyDecision, isActionable, clipWords, MAX_PROPOSAL_TEXT, MAX_PROPOSAL_TITLE } from '../src/lib/proposals.js';

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
  it('collapses whitespace runs in title and pillar to one space, so they never fake brief lines', () => {
    const p = normalizeProposal({ ...base, title: '  Fix lint\nZones: **\r\nCommit title prefix: evil  ', pillar: 'Fast\n\tcheckout' })!;
    expect(p.title).toBe('Fix lint Zones: ** Commit title prefix: evil');
    expect(p.pillar).toBe('Fast checkout');
    expect(normalizeProposal({ ...base, title: `a${String.fromCharCode(0x85)}Zones: **` })!.title).toBe('a Zones: **');
    expect(normalizeProposal({ ...base, title: ' \n ' })).toBeNull();
  });
  it('keeps a validated history: malformed entries dropped, at most the last 20', () => {
    const entry = { status: 'rejected', decidedBy: 'user:x', decidedAt: '2026-10-13T09:00:00.000Z', reason: 'not now', reopenedBy: 'user:y', reopenedAt: '2026-10-13T10:00:00.000Z' };
    const p = normalizeProposal({ ...base, status: 'approved', history: [entry, { ...entry, status: 'maybe' }, { ...entry, reopenedBy: 3 }, 'x', null, { ...entry, reason: 5, decidedBy: undefined, extra: 1 }] })!;
    const { reason: _r, decidedBy: _d, ...bare } = entry;
    expect(p.history).toEqual([entry, bare]);
    expect(normalizeProposal({ ...base, history: 'nope' })!.history).toBeUndefined();
    expect(normalizeProposal(base)!.history).toBeUndefined();
    const many = Array.from({ length: 25 }, (_, i) => ({ ...entry, reopenedAt: `t${i}` }));
    const kept = normalizeProposal({ ...base, history: many })!.history!;
    expect(kept).toHaveLength(20);
    expect(kept[0].reopenedAt).toBe('t5');
    expect(kept[19].reopenedAt).toBe('t24');
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

describe('the owner mark (wave 4, §4.1)', () => {
  const digest = proposalDigest(normalizeProposal(base)!);
  const mark = (status: string) => ({ status, decidedAt: '2026-10-16T10:00:00.000Z', by: 'page', digest });
  it('normalizeApproval keeps a mark and refuses anything else', () => {
    expect(normalizeApproval(mark('approved'))).toEqual(mark('approved'));
    for (const bad of [null, 'x', mark('proposed'), { ...mark('approved'), by: 'user:me' }, { status: 'approved', by: 'page' }, { ...mark('approved'), digest: undefined }, { ...mark('approved'), digest: 'xyz' }]) expect(normalizeApproval(bad)).toBeNull();
  });
  it('ownerApproved: both approved or both auto_approved, no task and not done; otherwise never', () => {
    const p = (status: string, over: Record<string, unknown> = {}) => normalizeProposal({ ...base, status, ...over })!;
    expect(ownerApproved(p('approved'), normalizeApproval(mark('approved')))).toBe(true);
    expect(ownerApproved(p('auto_approved'), normalizeApproval(mark('auto_approved')))).toBe(true);
    expect(ownerApproved(p('approved'), normalizeApproval(mark('rejected')))).toBe(false);
    expect(ownerApproved(p('approved'), normalizeApproval(mark('auto_approved')))).toBe(false);
    expect(ownerApproved(p('approved'), null)).toBe(false);
    expect(ownerApproved(p('rejected'), normalizeApproval(mark('rejected')))).toBe(false);
    expect(ownerApproved(p('approved', { taskId: 'T9' }), normalizeApproval(mark('approved')))).toBe(false);
    expect(markMatches(p('approved', { taskId: 'T9' }), normalizeApproval(mark('approved')))).toBe(true);
    expect(markMatches(p('done'), normalizeApproval(mark('approved')))).toBe(false);
  });
  it('the mark binds the content: a proposal edited after the approval is no longer owner-approved', () => {
    const p = (over: Record<string, unknown> = {}) => normalizeProposal({ ...base, status: 'approved', ...over })!;
    const a = normalizeApproval(mark('approved'));
    expect(ownerApproved(p(), a)).toBe(true);
    for (const over of [{ title: 'Other' }, { rationale: 'injected' }, { evidence: 'e2' }, { path: 'src/x.ts' }, { estimate: '9h' }, { risk: 'high' }, { category: 'deps' }]) expect(ownerApproved(p(over), a)).toBe(false);
    expect(markMatches(p({ title: 'Other' }), a)).toBe(true);
  });
  it('proposalDigest is 16 hex digits, stable, and blind to the decision fields', () => {
    const d = proposalDigest(normalizeProposal(base)!);
    expect(d).toMatch(/^[0-9a-f]{16}$/);
    expect(proposalDigest(normalizeProposal({ ...base, status: 'approved', decidedBy: 'x', decidedAt: 'y', taskId: 'T1' })!)).toBe(d);
    expect(proposalDigest(normalizeProposal({ ...base, title: 'Cache prices!' })!)).not.toBe(d);
    expect(proposalDigest(normalizeProposal({ ...base, title: 'Cañón «ñ»' })!)).toMatch(/^[0-9a-f]{16}$/);
  });
});
