// 6b-2, spec «Aprobación autónoma»: an autonomous profile decides a proposal on its own (`proposals judge`) by the critic's
// verdict of the proposal's present text. keep approves it with the owner's mark by forge:auto, drop rejects it, and a clash
// parks a person's idea until the person answers (anyone else's is rejected). adapt only lets the run write a v2, which is
// approved on its own keep in a later batch and then replaces its original (fix 1, T6B2-V2-OWN-VERDICT). An idea of someone
// who is not the owner waits for the owner's mark, and a v2 keeps its original's standing (I-2). Everything is read and
// written in `root`, the profile's worktree; the decision each outcome is goes first, through the caller's `record`, to the
// main checkout's ledger (T6B2-DECISION-FIRST). Task 5: `proposals unpark` applies the person's answer to a parked idea, in
// the same order, and never judges it: insisting integrates it, withdrawing rejects it.
import { appendEvent, readEvents, type LedgerEvent } from './ledger.js';
import { loadApproval, loadProposal, saveApproval, saveProposal } from './proposals.js';
import { checkDecision, DecisionInputError } from './decisions.js';
import { normalizeParked, proposalDigest, type ApprovalDoc, type ProposalDoc, type ProposalParked } from '../lib/proposals.js';
import type { CriticVerdict } from './critic.js';
import { OWNER_USER, roadmapOwner } from './ideas.js';
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
  /** The `addDecision` input of the outcome, already recorded through `record`; null when nothing was decided (adapt,
   *  waits-owner, and a v2 that waits with its parked original). */
  decision: Record<string, unknown> | null;
  /** adapt: what the critic asks the v2 to change. */
  changes?: string;
}

/** Records the outcome's decision (the CLI: addDecision in the main checkout). It runs after the decision's checks and before
 *  anything of the proposal is written, so a throw writes nothing. */
export type RecordDecision = (decision: Record<string, unknown>) => void;

const BY = 'forge:auto';
/** Who marks the person's own answer to a parked idea: the same as /forge:decide's decisions. */
const DECIDE = 'forge:decide';
const DEL = { __delete__: true } as const;

/** Each outcome's words and the alternative it did not take (L-13), in the run's language. Every undo names the proposal, so
 *  two decisions of different proposals never read as one re-run (addDecision's repeat window). */
const WORDS = {
  en: {
    approved: 'approve it', rejected: 'reject it', parked: 'park it', integrate: 'integrate it',
    replaced: (v2: string) => `replaced by ${v2}`,
    withdraw: 'withdraw it', withdrawn: 'withdrawn by the person', insists: 'the person insists on it', withdrew: 'the person withdrew their idea',
    insisted: (why: string) => `the person insists on their idea (it was parked: ${why})`,
    undo: {
      approved: (id: string) => `the person can reject it with /forge:decide ${id} reject before it becomes a task`,
      rejected: (id: string) => `the person can approve it with /forge:decide ${id} approve`,
      parked: (id: string) => `${id} waits, parked, for the person's answer`,
    },
  },
  es: {
    approved: 'aprobarla', rejected: 'rechazarla', parked: 'aparcarla', integrate: 'integrarla',
    replaced: (v2: string) => `sustituida por ${v2}`,
    withdraw: 'retirarla', withdrawn: 'retirada por la persona', insists: 'la persona insiste en ella', withdrew: 'la persona retiró su idea',
    insisted: (why: string) => `la persona insiste en su idea (estaba aparcada: ${why})`,
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

/** The last `add` event of `id` in the ledger, or null. */
const lastAdd = (events: readonly LedgerEvent[], id: string): LedgerEvent | null =>
  [...events].reverse().find(e => e.action === 'add' && e.id === id) ?? null;

/**
 * The verdict that decides `id`: its own, of the text it has now (its digest); otherwise there is none and nothing is
 * approved (JudgeError). T6B2-V2-OWN-VERDICT: a v2 needs its own too; its original's adapt only let the run write it.
 */
function verdictFor(id: string, doc: ProposalDoc, verdicts: readonly CriticVerdict[]): CriticVerdict {
  const own = verdicts.find(v => v.id === id);
  if (!own) throw new JudgeError(`the critic gave no verdict of ${id}: send it to the critic (a v2 needs its own, in a later batch)`);
  if (own.digest !== proposalDigest(id, doc)) throw new JudgeError(`the critic's verdict of ${id} is of another text than it has now: send it to the critic again`);
  return own;
}

/**
 * Whether the proposal waits for the owner's mark:
 * - T6B2-SOURCE-USER: a person's idea (its source is `user` now or was when it was added, or it came from a note or the
 *   chat) whose add event does not say it is the owner's (`owner: true`, which only `--from-chat`, the owner's `--from-note`
 *   and their v2s write), whatever flag added it;
 * - m-1: an owner's idea of someone who is no longer the roadmap's owner (`approvals/owner` now);
 * - failing closed, one with no add event in this ledger (its origin is unknown, as a proposal pulled from the roadmap) or
 *   whose text is no longer the one forge added (someone else edited it).
 */
function waitsOwner(root: string, id: string, doc: ProposalDoc, add: LedgerEvent | null): boolean {
  if (!add) return true;
  const from = typeof add.from === 'string' ? add.from : '';
  const idea = doc.source === 'user' || add.source === 'user' || from.startsWith('note:') || from === 'chat';
  if (idea && add.owner !== true) return true;
  if (idea && typeof add.author === 'string' && OWNER_USER.test(add.author) && add.author !== roadmapOwner(root)) return true;
  return typeof add.digest === 'string' && add.digest !== proposalDigest(id, doc);
}

/**
 * I-2: where the original of a v2 stands, which the v2 keeps. `open`: it could be judged now (open, never judged, no owner's
 * mark) and its origin is the owner's or forge's, so the v2 is judged and, approved, replaces it. `parked`: it waits, parked,
 * for the person, and so does the v2. `waits-owner` otherwise, a missing original too: the v2 waits for the owner's mark.
 */
function originalStanding(root: string, events: readonly LedgerEvent[], id: string, doc: ProposalDoc | null): 'open' | 'parked' | 'waits-owner' {
  if (!doc) return 'waits-owner';
  if (doc.status === 'discussing' && doc.parked) return 'parked';
  return notJudgeable(root, events, id, doc) === null && !waitsOwner(root, id, doc, lastAdd(events, id)) ? 'open' : 'waits-owner';
}

/** The doc decided by this run (or, `by` forge:decide, by the person's answer), and its roadmap update: a stale reason or
 *  parked mark it no longer has is deleted (L-7). */
function decidedDoc(doc: ProposalDoc, status: ProposalDoc['status'], at: string, extra: { reason?: string; parked?: ProposalParked }, by: string = BY):
  { next: ProposalDoc; write: Record<string, unknown> } {
  const { reason: _reason, parked: _parked, ...rest } = doc;
  const next: ProposalDoc = { ...rest, status, decidedBy: by, decidedAt: at, ...extra };
  const write: Record<string, unknown> = { status, decidedBy: by, decidedAt: at, ...extra };
  if (doc.reason && !extra.reason) write.reason = DEL;
  if (doc.parked && !extra.parked) write.parked = DEL;
  return { next, write };
}

/** The owner's mark this run (or the person's answer) writes, of the text it decided. */
const markOf = (id: string, status: ApprovalDoc['status'], at: string, doc: ProposalDoc, by: ApprovalDoc['by'] = BY): ApprovalDoc =>
  ({ status, decidedAt: at, by, digest: proposalDigest(id, doc) });
const markWrite = (id: string, mark: ApprovalDoc): Write => ({ op: 'set', collection: 'approvals', doc_id: id, data: { ...mark } });

/** T6B2-DECISION-FIRST: a decision the record refuses (a title that cleans to nothing, say) is a refusal with nothing written. */
function holds(id: string, decision: Record<string, unknown>): void {
  try { checkDecision(decision); } catch (e) {
    if (e instanceof DecisionInputError) throw new JudgeError(`the decision of ${id} does not hold: ${e.message}`);
    throw e;
  }
}

/**
 * Judges proposal `id` of `root` (the profile's worktree) by `verdicts` (readVerdicts of the critic's file), at `at`, in
 * Spanish when `es`. T6B2-DECISION-FIRST: the outcome's decision is checked (addDecision's checks) and handed to `record`
 * before anything is written; then the proposal, its mark (and a replaced original's) and a `proposal` `judge` event with the
 * verdict go to .forge/, as the policy writes them. adapt and every wait write nothing. Throws JudgeError, with nothing
 * written, when it is not judged now, has no verdict of its own text, or its decision does not hold.
 */
export function judgeProposal(root: string, id: string, verdicts: CriticVerdict[], at: string, es: boolean, record: RecordDecision): Judged {
  const doc = loadProposal(root, id);
  if (!doc) throw new JudgeError(`${id} not found`);
  const events = readEvents(root).filter(e => e.kind === 'proposal');
  const refused = notJudgeable(root, events, id, doc);
  if (refused) throw new JudgeError(refused);
  const add = lastAdd(events, id);
  const verdict = verdictFor(id, doc, verdicts);
  if (waitsOwner(root, id, doc, add)) return { outcome: 'waits-owner', write: null, approval: null, decision: null };
  // I-2: a v2 is never judged past its original's standing.
  const revises = typeof add?.revises === 'string' ? add.revises : null;
  const origDoc = revises ? loadProposal(root, revises) : null;
  const standing = revises ? originalStanding(root, events, revises, origDoc) : 'open';
  if (standing !== 'open') return { outcome: standing, write: null, approval: null, decision: null };
  // An adapt changes nothing and logs nothing: the run may write a v2, or the proposal is judged again.
  if (verdict.verdict === 'adapt') return { outcome: 'adapt', write: null, approval: null, decision: null, changes: verdict.changes ?? '' };
  const outcome: Exclude<JudgeOutcome, 'adapt' | 'waits-owner'> = verdict.verdict === 'keep' ? 'approved'
    : verdict.verdict === 'clash' && doc.source === 'user' ? 'parked' : 'rejected';
  const w = es ? WORDS.es : WORDS.en;
  const parked = outcome === 'parked' ? normalizeParked({ why: verdict.why, loses: verdict.loses, at }) : null;
  if (outcome === 'parked' && !parked) throw new JudgeError(`the critic's clash of ${id} does not say what integrating it would lose`);
  const { next, write } = outcome === 'approved' ? decidedDoc(doc, 'auto_approved', at, {})
    : outcome === 'rejected' ? decidedDoc(doc, 'rejected', at, { reason: verdict.why })
    : decidedDoc(doc, 'discussing', at, { parked: parked! });
  const mark = outcome === 'parked' ? null : markOf(id, next.status === 'auto_approved' ? 'auto_approved' : 'rejected', at, doc);
  // An approved v2 replaces its original, which its standing keeps open: rejected, with its own mark.
  const orig = outcome === 'approved' && revises && origDoc
    ? { id: revises, ...decidedDoc(origDoc, 'rejected', at, { reason: w.replaced(id) }), mark: markOf(revises, 'rejected', at, origDoc) } : null;
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
  // T6B2-DECISION-FIRST: a valid decision is recorded before the proposal changes, so no approval is ever left without it.
  holds(id, decision);
  record(decision);
  saveProposal(root, id, next);
  if (mark) saveApproval(root, id, mark);
  if (orig) {
    saveProposal(root, orig.id, orig.next);
    saveApproval(root, orig.id, orig.mark);
  }
  // M-2: the event lastDecisions reads, with the verdict that decided it.
  appendEvent(root, { ts: at, kind: 'proposal', action: 'judge', id, status: next.status, verdict: verdict.verdict, digest: verdict.digest });
  if (orig) appendEvent(root, { ts: at, kind: 'proposal', action: 'judge', id: orig.id, status: 'rejected', replacedBy: id });
  return {
    outcome, write, approval: mark ? markWrite(id, mark) : null,
    ...(orig ? { original: { id: orig.id, write: orig.write, approval: markWrite(orig.id, orig.mark) } } : {}),
    decision,
  };
}

export interface Unparked {
  outcome: 'integrated' | 'withdrawn';
  /** The update of proposals/<id> for the roadmap (the skill pins it to the version it read): its parked mark deleted (L-7). */
  write: Record<string, unknown>;
  /** The set of approvals/<id>: the owner's mark of the person's answer, by forge:decide. */
  approval: Write;
  /** The `addDecision` input, already recorded through `record`: an `idea` decision by the user, the person's own. */
  decision: Record<string, unknown>;
}

/**
 * 6b-2: applies the person's answer to parked idea `id` of `root` (a `discussing` proposal with `parked`), at `at`, in Spanish
 * when `es`. Insisting (`insist`) integrates it: approved, with the owner's mark, both by forge:decide as /forge:decide marks
 * the person's decisions. Withdrawing rejects it, with its mark. No run needs to be active: the person may answer after it
 * stopped. T6B2-DECISION-FIRST, as judgeProposal: the decision is checked and handed to `record` before the proposal, its
 * mark and a `proposal` `unpark` event (M-2) are written. Throws JudgeError, with nothing written, when `id` is not a parked
 * idea or its decision does not hold. It never judges: the answer is the person's.
 */
export function unparkProposal(root: string, id: string, insist: boolean, at: string, es: boolean, record: RecordDecision): Unparked {
  const doc = loadProposal(root, id);
  if (!doc) throw new JudgeError(`${id} not found`);
  const parked = doc.status === 'discussing' ? doc.parked : undefined;
  if (!parked) throw new JudgeError(`${id} is ${doc.status}${doc.status === 'discussing' ? ' and not parked' : ''}: only a parked idea waits for the person's answer`);
  const w = es ? WORDS.es : WORDS.en;
  const status = insist ? 'approved' : 'rejected';
  const { next, write } = decidedDoc(doc, status, at, insist ? {} : { reason: w.withdrawn }, DECIDE);
  const mark = markOf(id, status, at, doc, DECIDE);
  const decision = insist
    ? { point: 'idea', what: doc.title, chosen: w.integrate, alternatives: [{ option: w.withdraw, whyNot: w.insists }], tradeoffs: parked.loses,
      why: w.insisted(parked.why), by: 'user', undo: { type: 'none', reason: w.undo.approved(id) } }
    : { point: 'idea', what: doc.title, chosen: w.withdraw, alternatives: [{ option: w.integrate, whyNot: parked.why, tradeoffs: parked.loses }],
      why: w.withdrew, by: 'user', undo: { type: 'none', reason: w.undo.rejected(id) } };
  holds(id, decision);
  record(decision);
  saveProposal(root, id, next);
  saveApproval(root, id, mark);
  appendEvent(root, { ts: at, kind: 'proposal', action: 'unpark', id, status });
  return { outcome: insist ? 'integrated' : 'withdrawn', write, approval: markWrite(id, mark), decision };
}
