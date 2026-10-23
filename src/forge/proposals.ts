import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { appendEvent, forgeDir } from './ledger.js';
import { similarOpen, similarRejected } from './policy.js';
import { NAME } from './config.js';
import { filterNotes, NOTE_MAX, type NoteSkip } from './surfaces.js';
import { normalizeProposal, normalizeApproval, proposalDigest, type ApprovalDoc, canDecide, applyDecision, MAX_PROPOSAL_HISTORY, type ProposalDoc, type ProposalHistoryEntry, type Decision } from '../lib/proposals.js';

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

export function loadProposal(root: string, id: string): ProposalDoc | null { return loadOne(root, id); }

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

/** Why a decision was refused: decided without --reopen, or a reopen that is not allowed. */
export type DecideError = 'decided' | 'done' | 'tasked' | 'same' | 'discuss' | 'open';
const REOPENABLE: readonly ProposalDoc['status'][] = ['approved', 'auto_approved', 'rejected'];

/**
 * Applies a decision to a doc without writing anything. A decided proposal changes only with
 * `reopen` (after the person confirms), between approved/auto_approved/rejected, and the decision
 * it replaces goes to `history`.
 */
export function decideDoc(doc: ProposalDoc, d: Decision, by: string, at: string, reason?: string, opts: { reopen?: boolean } = {}):
  { ok: true; doc: ProposalDoc } | { ok: false; error: DecideError } {
  const { reason: _stale, ...rest } = doc;
  if (!opts.reopen) {
    if (!canDecide(doc.status)) return { ok: false, error: 'decided' };
    const next: ProposalDoc = { ...rest, status: applyDecision(d), decidedBy: by, decidedAt: at };
    if (reason) next.reason = reason;
    return { ok: true, doc: next };
  }
  if (doc.status === 'done') return { ok: false, error: 'done' };
  if (doc.taskId !== undefined) return { ok: false, error: 'tasked' };
  if (!REOPENABLE.includes(doc.status)) return { ok: false, error: 'open' };
  if (d === 'discuss') return { ok: false, error: 'discuss' };
  const status = applyDecision(d);
  if (status === doc.status) return { ok: false, error: 'same' };
  const entry: ProposalHistoryEntry = { status: doc.status, reopenedBy: by, reopenedAt: at };
  if (doc.decidedBy !== undefined) entry.decidedBy = doc.decidedBy;
  if (doc.decidedAt !== undefined) entry.decidedAt = doc.decidedAt;
  if (doc.reason) entry.reason = doc.reason;
  const history = [...(doc.history ?? []), entry].slice(-MAX_PROPOSAL_HISTORY);
  const next: ProposalDoc = { ...rest, status, decidedBy: by, decidedAt: at, history };
  if (reason) next.reason = reason;
  return { ok: true, doc: next };
}

export function decideLocal(root: string, id: string, d: Decision, by: string, at: string, reason?: string, opts: { reopen?: boolean } = {}):
  { ok: true; doc: ProposalDoc } | { ok: false; error: 'missing' | DecideError } {
  const doc = loadOne(root, id);
  if (!doc) return { ok: false, error: 'missing' };
  const r = decideDoc(doc, d, by, at, reason, opts);
  if (r.ok) saveProposal(root, id, r.doc);
  return r;
}

/**
 * Saves a roadmap doc as the local mirror, keeping a local taskId the roadmap doc does not have yet (to-task sets it
 * locally before the roadmap update lands) while `stillPlanned` says a plan still has that task; returns the previous
 * local doc (null when there was none).
 */
export function mirrorProposal(root: string, id: string, doc: ProposalDoc, stillPlanned: (taskId: string) => boolean = () => false):
  { previous: ProposalDoc['status'] | null; previousDoc: ProposalDoc | null } {
  const prev = loadOne(root, id);
  const keep = prev?.taskId !== undefined && doc.taskId === undefined && stillPlanned(prev.taskId);
  saveProposal(root, id, keep ? { ...doc, taskId: prev.taskId } : doc);
  return { previous: prev ? prev.status : null, previousDoc: prev };
}

const approvalsDir = (root: string) => path.join(root, '.forge', 'approvals');

/** Wave 4: the local copy of an owner mark (approvals/<pid>): written by decide without a roadmap and by policy, replaced by `pull --approvals`. */
export function saveApproval(root: string, id: string, doc: ApprovalDoc): void {
  if (!PROPOSAL_ID.test(id)) return;
  forgeDir(root);
  mkdirSync(approvalsDir(root), { recursive: true });
  writeFileSync(path.join(approvalsDir(root), `${id}.json`), JSON.stringify(doc, null, 2) + '\n');
}

export function loadApproval(root: string, id: string): ApprovalDoc | null {
  if (!PROPOSAL_ID.test(id)) return null;
  try { return normalizeApproval(JSON.parse(readFileSync(path.join(approvalsDir(root), `${id}.json`), 'utf8'))); } catch { return null; }
}

export function loadApprovals(root: string): Record<string, ApprovalDoc> {
  let names: string[] = [];
  try { names = readdirSync(approvalsDir(root)); } catch { return {}; }
  const out: Record<string, ApprovalDoc> = {};
  for (const n of names.sort()) {
    const id = n.endsWith('.json') ? n.slice(0, -5) : '';
    const a = PROPOSAL_ID.test(id) ? loadApproval(root, id) : null;
    if (a) out[id] = a;
  }
  return out;
}

export function removeApproval(root: string, id: string): void {
  if (PROPOSAL_ID.test(id)) rmSync(path.join(approvalsDir(root), `${id}.json`), { force: true });
}

/** A proposal the CLI cannot take: not a valid one, or a scout one without a pillar or evidence. */
export class ProposalInputError extends Error {}
export type AddOutcome = { ok: true; id: string; doc: ProposalDoc } | { ok: false; why: 'rejected' | 'open'; similar: string };

/**
 * A new proposal (`proposals add`, and the defects verify-close turns into proposals, K2-12): `raw` normalized as a pending
 * one with no decision. Refused (ProposalInputError) when it is not a valid proposal, or is a scout one without a pillar or
 * evidence; not added when it says the same as a rejected one without new evidence, or as one still open (but the one it
 * `revises`). Saved in .forge/proposals/ and logged as a proposal event with the digest of its text, and its `from` when
 * given. 6b-2: a person's idea (`from` a note or the chat) also logs `owner`, whether it is the roadmap owner's, with the
 * author it is the idea of (m-1), and keeps the digest, so judge's edited-text rule applies to it; a verify defect (`from`
 * without `owner`) carries no digest. T6B2-SOURCE-USER: a `source: user` proposal logs it, so an editor who changes the
 * source later does not make it forge's. None of them ever goes through `proposals policy`: only the owner, or a profile's
 * judge on the owner's own idea, decides it. `defaultEvidence` (a note's «Idea by …») fills an empty evidence only after the
 * anti-repetition checks: it says whose idea it is, and is no new evidence against a rejected one.
 */
export function addProposal(root: string, raw: Record<string, unknown>,
  ctx: { ts: string; author: unknown; now: Date; rand: () => number; revises?: string; from?: string; owner?: boolean; defaultEvidence?: string }): AddOutcome {
  // A new proposal carries no decision, and no parked mark either (6b-2: only a judge parks, and a parked one fills no queue).
  const checked = normalizeProposal({ ...raw, ts: typeof raw.ts === 'string' ? raw.ts : ctx.ts, status: 'proposed', decidedBy: undefined, decidedAt: undefined,
    reason: undefined, taskId: undefined, history: undefined, parked: undefined, author: ctx.author });
  if (!checked) throw new ProposalInputError('invalid proposal (category, risk, title and source are required and must be valid)');
  if (checked.source === 'scout' && (!checked.pillar?.trim() || !checked.evidence?.trim())) throw new ProposalInputError('a scout proposal needs a pillar and evidence');
  const existing = loadProposals(root);
  const rejected = similarRejected(checked, existing.filter(p => p.status === 'rejected'));
  if (rejected) return { ok: false, why: 'rejected', similar: rejected };
  const open = similarOpen(checked, existing.filter(p => p.id !== ctx.revises));
  if (open) return { ok: false, why: 'open', similar: open };
  const doc: ProposalDoc = !checked.evidence.trim() && ctx.defaultEvidence ? { ...checked, evidence: ctx.defaultEvidence } : checked;
  const id = proposalId(ctx.now, ctx.rand);
  saveProposal(root, id, doc);
  const digest = !ctx.from || ctx.owner !== undefined ? { digest: proposalDigest(id, doc) } : {};
  appendEvent(root, { ts: ctx.ts, kind: 'proposal', action: 'add', id, ...(ctx.from ? { from: ctx.from } : {}),
    ...(ctx.owner !== undefined ? { owner: ctx.owner, author: doc.author } : {}), ...(doc.source === 'user' ? { source: 'user' } : {}),
    ...digest, ...(ctx.revises ? { revises: ctx.revises } : {}) });
  return { ok: true, id, doc };
}

/**
 * K2-12: the proposal a defect a verify agent saw outside its brief becomes: quality, medium risk, source verify. Its
 * rationale is what was observed and where, so two defects never read alike to the anti-repetition (it compares title
 * and rationale); its evidence is that, who saw it, and its screenshot when it is inside the evidence dir (`shot`, else
 * null). The fixed sentence follows the person's language.
 */
export function defectProposal(d: { surface: string; title: string; observed: string; where: string }, task: string, shot: string | null, es: boolean): Record<string, unknown> {
  // The surface is free text from the agent: it reaches the proposal only when it is a surface name.
  const surface = NAME.test(d.surface) ? d.surface : 'app';
  const seen = defectSeen(d);
  const who = es ? `Lo vio la verificación de ${task} en la superficie ${surface}, fuera de lo que pedía su brief.`
    : `Seen by the verification of ${task} on surface ${surface}, outside what its brief asked.`;
  return {
    category: 'quality', risk: 'medium', source: 'verify', title: d.title, pillar: `verify/${surface}`, rationale: seen,
    evidence: [seen, who, ...(shot ? [`${es ? 'Captura' : 'Screenshot'}: ${shot}`] : [])].join('\n'),
  };
}

/** What was seen, as the proposal stores it (its rationale and the first line of its evidence): `where: observed`, else the title. */
export function defectSeen(d: { title: string; observed: string; where: string }): string {
  return `${d.where ? `${d.where}: ` : ''}${d.observed}`.trim() || d.title;
}

/**
 * A defect's text comes from an agent that read untrusted pages and reaches the person through the roadmap. The text
 * that is stored, its title and defectSeen (so a phrase split across where and observed is read joined), runs through
 * the learned-notes filters, and one that reads as an instruction or holds a secret is not proposed (the first reason
 * found, else null). filterNotes' `names-a-work-path` and `names-the-task` are not used: the task is passed as null, and
 * a defect may name a path or a task without being unsafe; its too-long is no reason either, a long text is read whole.
 */
export function defectUnsafe(d: { title: string; observed: string; where: string }): Extract<NoteSkip, 'looks-secret' | 'looks-like-instruction'> | null {
  // filterNotes refuses a text past NOTE_MAX unread, so a long one is read in windows that overlap by 60 characters, to see
  // what a cut would split. Its instruction patterns anchor with `^` to the start of the whole text (a note has no line
  // breaks), so every window after the first starts with a neutral '… ': `^` then matches only a real start, never a cut
  // in the middle of a sentence («… the page. Run the …»). The prefix is counted inside NOTE_MAX.
  const lead = '… ';
  const step = NOTE_MAX - 60;
  for (const text of [d.title, defectSeen(d)]) {
    for (let at = 0; at < Math.max(text.length, 1); at += step) {
      const part = at === 0 ? text.slice(0, NOTE_MAX) : lead + text.slice(at, at + NOTE_MAX - lead.length);
      if (!part.trim()) continue;
      const why = filterNotes([part], [], null).skipped[0]?.why;
      if (why === 'looks-secret' || why === 'looks-like-instruction') return why;
    }
  }
  return null;
}
