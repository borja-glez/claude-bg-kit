// 6b-2, spec «Aprobación autónoma»: an autonomous profile decides a proposal on its own (`proposals judge`) by the critic's
// verdict of the proposal's present text. keep approves it with the owner's mark by forge:auto, drop rejects it, adapt asks
// for a v2 that is then approved on that verdict (its original replaced), and a clash parks a person's idea until the person
// answers (anyone else's is rejected). An idea of someone who is not the owner waits for the owner's mark. Everything is
// read and written in `root`, the profile's worktree; the decision each outcome is goes back to the caller, which records it
// in the main checkout's ledger.
import { appendEvent, readEvents, type LedgerEvent } from './ledger.js';
import { loadApproval, loadProposal, saveApproval, saveProposal } from './proposals.js';
import { normalizeParked, proposalDigest, type ApprovalDoc, type ProposalDoc, type ProposalParked } from '../lib/proposals.js';
import type { CriticVerdict } from './critic.js';
import type { Write } from '../lib/sync.js';

export type JudgeOutcome = 'approved' | 'rejected' | 'parked' | 'adapt' | 'waits-owner';

/** Why a proposal is not judged now: `proposals judge` (and Task 5's unpark) turn it into exit 2, with nothing written. */
export class JudgeError extends Error {}

export interface Judged {
  outcome: JudgeOutcome;
  /** The update of proposals/<id> for the roadmap (the skill pins it to the version it read); null when nothing changed. */
  write: Record<string, unknown> | null;
  /** The set of approvals/<id>: the owner's mark, written by this run (forge:auto); null when there is none to write. */
  approval: Write | null;
  /** The original a v2 replaced: rejected, with its mark. */
  original?: { id: string; write: Record<string, unknown>; approval: Write };
  /** The `addDecision` input of the outcome; null for adapt and waits-owner, which decide nothing. */
  decision: Record<string, unknown> | null;
  /** adapt: what the critic asks the v2 to change. */
  changes?: string;
}

const BY = 'forge:auto';
const DEL = { __delete__: true } as const;

/** Each outcome's words and the alternative it did not take (L-13), in the run's language. Every undo names the proposal, so
 *  two decisions of different proposals never read as one re-run (addDecision's repeat window). */
const WORDS = {
  en: {
    approved: 'approve it', rejected: 'reject it', parked: 'park it', integrate: 'integrate it',
    replaced: (v2: string) => `replaced by ${v2}`,
    undo: {
      approved: (id: string) => `the person can reject it with /forge:decide ${id} reject before it becomes a task`,
      rejected: (id: string) => `the person can approve it with /forge:decide ${id} approve`,
      parked: (id: string) => `${id} waits, parked, for the person's answer`,
    },
  },
  es: {
    approved: 'aprobarla', rejected: 'rechazarla', parked: 'aparcarla', integrate: 'integrarla',
    replaced: (v2: string) => `sustituida por ${v2}`,
    undo: {
      approved: (id: string) => `la persona puede rechazarla con /forge:decide ${id} reject antes de que sea una tarea`,
      rejected: (id: string) => `la persona puede aprobarla con /forge:decide ${id} approve`,
      parked: (id: string) => `${id} espera, aparcada, la respuesta de la persona`,
    },
  },
} as const;

/**
 * Why `id` is not judged now, or null. Only a proposed one, or one under discussion and not parked, that no judge decided
 * yet (the ledger's `proposal` `judge` events) and that holds no owner's mark: a mark is the owner's own decision, which the
 * run never overwrites (the policy's rule).
 */
function notJudgeable(root: string, events: readonly LedgerEvent[], id: string, doc: ProposalDoc): string | null {
  if (doc.status !== 'proposed' && !(doc.status === 'discussing' && !doc.parked)) {
    return `${id} is ${doc.status}${doc.parked ? ' and parked' : ''}: only a proposed one, or one under discussion and not parked, is judged`;
  }
  if (events.some(e => e.action === 'judge' && e.id === id)) return `${id} was already judged`;
  if (loadApproval(root, id)) return `${id} has the owner's mark (approvals/${id}): the owner decided it`;
  return null;
}

/**
 * The verdict that decides `id`: its own, else, for a v2 (`revises` in its add event), its original's adapt. Either must be
 * of the text that proposal has now (its digest), and the original must still be open; otherwise there is no verdict and
 * nothing is approved (JudgeError).
 */
function verdictFor(root: string, events: readonly LedgerEvent[], id: string, doc: ProposalDoc, add: LedgerEvent | null, verdicts: readonly CriticVerdict[]):
  { verdict: CriticVerdict; via: { id: string; doc: ProposalDoc } | null } {
  const own = verdicts.find(v => v.id === id);
  if (own) {
    if (own.digest !== proposalDigest(id, doc)) throw new JudgeError(`the critic's verdict of ${id} is of another text than it has now: send it to the critic again`);
    return { verdict: own, via: null };
  }
  const revises = typeof add?.revises === 'string' ? add.revises : null;
  const adapt = revises ? verdicts.find(v => v.id === revises) : undefined;
  if (!revises || adapt?.verdict !== 'adapt') {
    throw new JudgeError(`the critic gave no verdict of ${id}${revises ? `, nor an adapt of ${revises}, the proposal it revises` : ''}: send it to the critic`);
  }
  const orig = loadProposal(root, revises);
  if (!orig) throw new JudgeError(`${revises}, the proposal ${id} revises, is gone: its adapt no longer stands; send ${id} to the critic`);
  if (adapt.digest !== proposalDigest(revises, orig)) throw new JudgeError(`the critic's adapt of ${revises} is of another text than it has now: send ${id} to the critic`);
  const closed = notJudgeable(root, events, revises, orig);
  if (closed) throw new JudgeError(`${closed}; its adapt no longer stands: send ${id} to the critic`);
  return { verdict: adapt, via: { id: revises, doc: orig } };
}

/**
 * Whether the proposal waits for the owner's mark: a note's idea whose add event does not say it is the owner's; and, failing
 * closed, one with no add event in this ledger (its origin is unknown, as a proposal pulled from the roadmap) or whose text
 * is no longer the one forge added (someone else edited it).
 */
function waitsOwner(id: string, doc: ProposalDoc, add: LedgerEvent | null): boolean {
  if (!add) return true;
  if (typeof add.from === 'string' && add.from.startsWith('note:') && add.owner !== true) return true;
  return typeof add.digest === 'string' && add.digest !== proposalDigest(id, doc);
}

/** The doc decided by this run, and its roadmap update: a stale reason or parked mark it no longer has is deleted. */
function decidedDoc(doc: ProposalDoc, status: ProposalDoc['status'], at: string, extra: { reason?: string; parked?: ProposalParked }):
  { next: ProposalDoc; write: Record<string, unknown> } {
  const { reason: _reason, parked: _parked, ...rest } = doc;
  const next: ProposalDoc = { ...rest, status, decidedBy: BY, decidedAt: at, ...extra };
  const write: Record<string, unknown> = { status, decidedBy: BY, decidedAt: at, ...extra };
  if (doc.reason && !extra.reason) write.reason = DEL;
  if (doc.parked && !extra.parked) write.parked = DEL;
  return { next, write };
}

/** The owner's mark this run writes, of the text it decided. */
const markOf = (id: string, status: ApprovalDoc['status'], at: string, doc: ProposalDoc): ApprovalDoc =>
  ({ status, decidedAt: at, by: BY, digest: proposalDigest(id, doc) });
const markWrite = (id: string, mark: ApprovalDoc): Write => ({ op: 'set', collection: 'approvals', doc_id: id, data: { ...mark } });

/**
 * Judges proposal `id` of `root` (the profile's worktree) by `verdicts` (readVerdicts of the critic's file), at `at`, in
 * Spanish when `es`. Writes the proposal and its mark to .forge/ and logs a `proposal` `judge` event with the verdict, as the
 * policy does; adapt and waits-owner write nothing. Throws JudgeError when it is not judged now or has no verdict of its text.
 */
export function judgeProposal(root: string, id: string, verdicts: CriticVerdict[], at: string, es: boolean): Judged {
  const doc = loadProposal(root, id);
  if (!doc) throw new JudgeError(`${id} not found`);
  const events = readEvents(root).filter(e => e.kind === 'proposal');
  const refused = notJudgeable(root, events, id, doc);
  if (refused) throw new JudgeError(refused);
  const add = [...events].reverse().find(e => e.action === 'add' && e.id === id) ?? null;
  const { verdict, via } = verdictFor(root, events, id, doc, add, verdicts);
  if (waitsOwner(id, doc, add)) return { outcome: 'waits-owner', write: null, approval: null, decision: null };
  // An adapt of the proposal itself changes nothing and logs nothing: its v2 is judged on it, or it is judged again.
  if (verdict.verdict === 'adapt' && !via) return { outcome: 'adapt', write: null, approval: null, decision: null, changes: verdict.changes ?? '' };
  const outcome: Exclude<JudgeOutcome, 'adapt' | 'waits-owner'> = via || verdict.verdict === 'keep' ? 'approved'
    : verdict.verdict === 'clash' && doc.source === 'user' ? 'parked' : 'rejected';
  const w = es ? WORDS.es : WORDS.en;
  const parked = outcome === 'parked' ? normalizeParked({ why: verdict.why, loses: verdict.loses, at }) : null;
  if (outcome === 'parked' && !parked) throw new JudgeError(`the critic's clash of ${id} does not say what integrating it would lose`);
  const { next, write } = outcome === 'approved' ? decidedDoc(doc, 'auto_approved', at, {})
    : outcome === 'rejected' ? decidedDoc(doc, 'rejected', at, { reason: verdict.why })
    : decidedDoc(doc, 'discussing', at, { parked: parked! });
  const mark = outcome === 'parked' ? null : markOf(id, next.status === 'auto_approved' ? 'auto_approved' : 'rejected', at, doc);
  // A v2 that is approved replaces its original while that one is still open: rejected, with its own mark.
  const revises = via?.id ?? (outcome === 'approved' && typeof add?.revises === 'string' ? add.revises : null);
  const origDoc = via?.doc ?? (revises ? loadProposal(root, revises) : null);
  const orig = outcome === 'approved' && revises && origDoc && !notJudgeable(root, events, revises, origDoc)
    ? { id: revises, ...decidedDoc(origDoc, 'rejected', at, { reason: w.replaced(id) }), mark: markOf(revises, 'rejected', at, origDoc) } : null;
  saveProposal(root, id, next);
  if (mark) saveApproval(root, id, mark);
  if (orig) {
    saveProposal(root, orig.id, orig.next);
    saveApproval(root, orig.id, orig.mark);
  }
  // M-2: the event lastDecisions reads, with the verdict that decided it (its original's, for a v2 on an adapt).
  appendEvent(root, { ts: at, kind: 'proposal', action: 'judge', id, status: next.status, verdict: verdict.verdict, digest: verdict.digest, ...(via ? { verdictOf: via.id } : {}) });
  if (orig) appendEvent(root, { ts: at, kind: 'proposal', action: 'judge', id: orig.id, status: 'rejected', replacedBy: id });
  const alternative = outcome === 'approved' ? w.rejected : outcome === 'rejected' ? w.approved : w.integrate;
  const decision = {
    point: doc.source === 'user' ? 'idea' : 'approve',
    what: doc.title,
    chosen: w[outcome],
    alternatives: [{ option: alternative, whyNot: verdict.why, ...(parked ? { tradeoffs: parked.loses } : {}) }],
    why: verdict.why,
    by: 'auto',
    undo: { type: 'none', reason: w.undo[outcome](id) },
  };
  return {
    outcome, write, approval: mark ? markWrite(id, mark) : null,
    ...(orig ? { original: { id: orig.id, write: orig.write, approval: markWrite(orig.id, orig.mark) } } : {}),
    decision,
  };
}
