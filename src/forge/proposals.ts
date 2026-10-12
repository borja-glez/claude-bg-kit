import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { forgeDir } from './ledger.js';
import { normalizeProposal, canDecide, applyDecision, type ProposalDoc, type Decision } from '../lib/proposals.js';

export const PROPOSAL_ID = /^p\d{14}[0-9a-z]{4}$/;

const dirOf = (root: string) => path.join(root, '.forge', 'proposals');

// 'p' + yyyymmddHHMMss (UTC) + 4 base36 chars.
export function proposalId(now: Date, rand: () => number): string {
  const stamp = now.toISOString().replace(/\D/g, '').slice(0, 14);
  let tail = '';
  for (let i = 0; i < 4; i++) tail += Math.floor(Math.min(Math.max(rand(), 0), 0.999999) * 36).toString(36);
  return `p${stamp}${tail}`;
}

export function saveProposal(root: string, id: string, doc: ProposalDoc): void {
  forgeDir(root);
  mkdirSync(dirOf(root), { recursive: true });
  writeFileSync(path.join(dirOf(root), `${id}.json`), JSON.stringify(doc, null, 2) + '\n');
}

function loadOne(root: string, id: string): ProposalDoc | null {
  const file = path.join(dirOf(root), `${id}.json`);
  if (!existsSync(file)) return null;
  try { return normalizeProposal(JSON.parse(readFileSync(file, 'utf8'))); } catch { return null; }
}

export function loadProposals(root: string): (ProposalDoc & { id: string })[] {
  let names: string[] = [];
  try { names = readdirSync(dirOf(root)); } catch { return []; }
  const out: (ProposalDoc & { id: string })[] = [];
  for (const n of names.sort()) {
    if (!n.endsWith('.json')) continue;
    const id = n.slice(0, -5);
    const doc = loadOne(root, id);
    if (doc) out.push({ ...doc, id });
  }
  return out;
}

/** Applies a decision to a doc without writing anything. */
export function decideDoc(doc: ProposalDoc, d: Decision, by: string, at: string, reason?: string):
  { ok: true; doc: ProposalDoc } | { ok: false; error: 'decided' } {
  if (!canDecide(doc.status)) return { ok: false, error: 'decided' };
  const { reason: _stale, ...rest } = doc;
  const next: ProposalDoc = { ...rest, status: applyDecision(d), decidedBy: by, decidedAt: at };
  if (reason) next.reason = reason;
  return { ok: true, doc: next };
}

export function decideLocal(root: string, id: string, d: Decision, by: string, at: string, reason?: string):
  { ok: true; doc: ProposalDoc } | { ok: false; error: 'missing' | 'decided' } {
  const doc = loadOne(root, id);
  if (!doc) return { ok: false, error: 'missing' };
  const r = decideDoc(doc, d, by, at, reason);
  if (r.ok) saveProposal(root, id, r.doc);
  return r;
}

/** Saves a roadmap doc as the local mirror; returns the previous local status (null when there was none). */
export function mirrorProposal(root: string, id: string, doc: ProposalDoc): { previous: ProposalDoc['status'] | null } {
  const prev = loadOne(root, id);
  saveProposal(root, id, doc);
  return { previous: prev ? prev.status : null };
}
