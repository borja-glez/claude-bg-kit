import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { proposalId, saveProposal, loadProposals, decideLocal, decideDoc } from '../src/forge/proposals.js';
import type { ProposalDoc } from '../src/lib/proposals.js';

const doc = (over: Partial<ProposalDoc> = {}): ProposalDoc => ({
  ts: '2026-10-11T10:00:00.000Z', category: 'quality', risk: 'low', title: 'T', rationale: 'r', evidence: 'e', pillar: 'p',
  status: 'proposed', source: 'scout', author: 'session', ...over,
});
let root: string;
beforeEach(() => { root = mkdtempSync(path.join(tmpdir(), 'forge-prop-')); });

describe('forge proposals mirror', () => {
  it('proposalId has the expected shape', () => {
    const id = proposalId(new Date('2026-10-11T10:20:30.000Z'), () => 0.5);
    expect(id).toMatch(/^p\d{14}[0-9a-z]{4}$/);
    expect(id.slice(0, 15)).toBe('p20261011102030');
  });
  it('saves and loads, skipping corrupt files', () => {
    saveProposal(root, 'p20261011100000aaaa', doc());
    writeFileSync(path.join(root, '.forge', 'proposals', 'bad.json'), 'nope');
    writeFileSync(path.join(root, '.forge', 'proposals', 'bad2.json'), '{"title":1}');
    const all = loadProposals(root);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: 'p20261011100000aaaa', title: 'T' });
  });
  it('loads nothing when the folder is missing', () => {
    mkdirSync(path.join(root, 'x'));
    expect(loadProposals(root)).toEqual([]);
  });
  it('decideLocal approves a proposed one and refuses decided or missing', () => {
    saveProposal(root, 'p1', doc());
    const r = decideLocal(root, 'p1', 'approve', 'user:me', '2026-10-11T11:00:00.000Z');
    expect(r).toMatchObject({ ok: true, doc: { status: 'approved', decidedBy: 'user:me', decidedAt: '2026-10-11T11:00:00.000Z' } });
    expect(decideLocal(root, 'p1', 'reject', 'u', 'x')).toEqual({ ok: false, error: 'decided' });
    expect(decideLocal(root, 'nope', 'approve', 'u', 'x')).toEqual({ ok: false, error: 'missing' });
  });
  it('decideDoc with reopen moves a decided proposal and records the history', () => {
    const rejected = doc({ status: 'rejected', decidedBy: 'user:x', decidedAt: 'T1', reason: 'not now' });
    expect(decideDoc(rejected, 'approve', 'user:me', 'T2')).toEqual({ ok: false, error: 'decided' });
    const r = decideDoc(rejected, 'approve', 'user:me', 'T2', undefined, { reopen: true });
    expect(r).toEqual({ ok: true, doc: { ...doc(), status: 'approved', decidedBy: 'user:me', decidedAt: 'T2',
      history: [{ status: 'rejected', decidedBy: 'user:x', decidedAt: 'T1', reason: 'not now', reopenedBy: 'user:me', reopenedAt: 'T2' }] } });
    const back = decideDoc((r as { doc: ProposalDoc }).doc, 'reject', 'user:z', 'T3', 'changed my mind', { reopen: true });
    expect(back).toMatchObject({ ok: true, doc: { status: 'rejected', reason: 'changed my mind', history: [{ status: 'rejected' }, { status: 'approved', decidedBy: 'user:me', reopenedBy: 'user:z', reopenedAt: 'T3' }] } });
    expect(decideDoc(doc({ status: 'auto_approved' }), 'approve', 'u', 'T', undefined, { reopen: true })).toMatchObject({ ok: true, doc: { status: 'approved' } });
  });
  it('decideDoc with reopen refuses done, tasked, same status, discuss and open proposals', () => {
    const r = (d: Partial<ProposalDoc>, dec: 'approve' | 'reject' | 'discuss') => decideDoc(doc(d), dec, 'u', 'T', undefined, { reopen: true });
    expect(r({ status: 'done' }, 'reject')).toEqual({ ok: false, error: 'done' });
    expect(r({ status: 'approved', taskId: 'T008' }, 'reject')).toEqual({ ok: false, error: 'tasked' });
    expect(r({ status: 'rejected' }, 'reject')).toEqual({ ok: false, error: 'same' });
    expect(r({ status: 'rejected' }, 'discuss')).toEqual({ ok: false, error: 'discuss' });
    expect(r({ status: 'proposed' }, 'approve')).toEqual({ ok: false, error: 'open' });
  });
  it('decideDoc with reopen keeps at most 20 history entries', () => {
    const history = Array.from({ length: 20 }, (_, i) => ({ status: 'approved' as const, reopenedBy: 'u', reopenedAt: `t${i}` }));
    const r = decideDoc(doc({ status: 'rejected', history }), 'approve', 'u', 'T', undefined, { reopen: true });
    const h = (r as { doc: ProposalDoc }).doc.history!;
    expect(h).toHaveLength(20);
    expect(h[0].reopenedAt).toBe('t1');
    expect(h[19]).toMatchObject({ status: 'rejected', reopenedAt: 'T' });
  });
  it('keeps the reason on reject', () => {
    saveProposal(root, 'p2', doc());
    const r = decideLocal(root, 'p2', 'reject', 'u', 'x', 'too risky');
    expect(r).toMatchObject({ ok: true, doc: { status: 'rejected', reason: 'too risky' } });
    expect(loadProposals(root)[0]).toMatchObject({ status: 'rejected', reason: 'too risky' });
  });
});
