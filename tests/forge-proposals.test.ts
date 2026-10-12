import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { proposalId, saveProposal, loadProposals, decideLocal } from '../src/forge/proposals.js';
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
  it('keeps the reason on reject', () => {
    saveProposal(root, 'p2', doc());
    const r = decideLocal(root, 'p2', 'reject', 'u', 'x', 'too risky');
    expect(r).toMatchObject({ ok: true, doc: { status: 'rejected', reason: 'too risky' } });
    expect(loadProposals(root)[0]).toMatchObject({ status: 'rejected', reason: 'too risky' });
  });
});
