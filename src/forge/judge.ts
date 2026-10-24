// 6b-2, spec «Aprobación autónoma»: an autonomous profile decides a proposal on its own (`proposals judge`) by the critic's
// verdict of the proposal's present text. keep approves it with the owner's mark by forge:auto, drop rejects it, and a clash
// parks a person's idea until the person answers (anyone else's is rejected). adapt only lets the run write a v2, which is
// approved on its own keep in a later batch and then replaces its original (fix 1, T6B2-V2-OWN-VERDICT); rejected, it takes
// its original with it (Task 7 fix 3, T6B2-PENDING-V2), and either way every proposal before that one in its revises chain
// (final fix M2). An idea of someone who is not the owner waits for the owner's mark, and a v2 keeps the standing of its
// original and of the whole chain (I-2). Everything is read and
// written in `root`, the profile's worktree; the decision each outcome is goes first, through the caller's `record`, to the
// main checkout's ledger (T6B2-DECISION-FIRST). Task 5: `proposals unpark` applies the person's answer to a parked idea, in
// the same order, and never judges it: insisting integrates it, withdrawing rejects it.
import { appendEvent, readEvents, type LedgerEvent } from './ledger.js';
import { loadApproval, loadProposal, loadProposals, saveApproval, saveProposal } from './proposals.js';
import { checkDecision, DecisionInputError } from './decisions.js';
import { normalizeParked, proposalDigest, type ApprovalDoc, type ProposalDoc, type ProposalParked } from '../lib/proposals.js';
import type { CriticPlacement, CriticVerdict } from './critic.js';
import { OWNER_USER, roadmapOwner } from './ideas.js';
import type { Write } from '../lib/sync.js';

export type JudgeOutcome = 'approved' | 'rejected' | 'parked' | 'adapt' | 'waits-owner';

/** A proposal an approved or rejected v2 decided with it: its roadmap update and its mark. */
export interface Replaced { id: string; write: Record<string, unknown>; approval: Write }

/** Why a proposal is not judged now: `proposals judge` (and Task 5's unpark) turn it into exit 2, with nothing written. */
export class JudgeError extends Error {}

export interface Judged {
  outcome: JudgeOutcome;
  /** The update of proposals/<id> for the roadmap (the skill pins it to the version it read); null when nothing changed. */
  write: Record<string, unknown> | null;
  /** The set of approvals/<id>: the owner's mark, written by this run (forge:auto); null when there is none to write. */
  approval: Write | null;
  /** The original of a v2 that was approved (it replaced it) or rejected (it took it with it, T6B2-PENDING-V2): rejected, with
   *  its mark. */
  original?: Replaced;
  /** Final fix M2: the earlier proposals of the v2's revises chain (its original's original, and so on, nearest first),
   *  rejected with it the same way; absent when it has none. */
  ancestors?: Replaced[];
  /** The `addDecision` input of the outcome, already recorded through `record`; null when nothing was decided (adapt,
   *  waits-owner, and a v2 that waits with its parked original). */
  decision: Record<string, unknown> | null;
  /** adapt: what the critic asks the v2 to change. */
  changes?: string;
  /** 6b-3 B-1: approved on a keep, the placement of that keep (readVerdicts cleaned it), also in the `judge` event, where
   *  `proposals to-task` finds it in a product run; absent when the keep has none. */
  placement?: CriticPlacement;
}

/** 6b-3 H-3: the adapts a revises chain gets. The critic's adapt of a proposal with this many earlier versions (a v3) is a drop,
 *  so a chain whose v3 is refused as close to its root can no longer wedge the loop. */
const MAX_ADAPTS = 2;

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
    replaced: (v2: string) => `replaced by ${v2}`, dropped: 'its v2 was dropped',
    withdraw: 'withdraw it', withdrawn: 'withdrawn by the person', insists: 'the person insists on it', withdrew: 'the person withdrew their idea',
    insisted: (why: string) => `the person insists on their idea (it was parked: ${why})`,
    adapts: (why: string) => `a chain of versions gets at most ${MAX_ADAPTS} adapts, and the critic asked for one more: ${why}`,
    adaptedTwice: 'adapted twice; its v2 could not be added',
    undo: {
      approved: (id: string) => `the person can reject it with /forge:decide ${id} reject before it becomes a task`,
      rejected: (id: string) => `the person can approve it with /forge:decide ${id} approve`,
      parked: (id: string) => `${id} waits, parked, for the person's answer`,
    },
  },
  es: {
    approved: 'aprobarla', rejected: 'rechazarla', parked: 'aparcarla', integrate: 'integrarla',
    replaced: (v2: string) => `sustituida por ${v2}`, dropped: 'su v2 se descartó',
    withdraw: 'retirarla', withdrawn: 'retirada por la persona', insists: 'la persona insiste en ella', withdrew: 'la persona retiró su idea',
    insisted: (why: string) => `la persona insiste en su idea (estaba aparcada: ${why})`,
    adapts: (why: string) => `una cadena de versiones admite como mucho ${MAX_ADAPTS} adaptaciones, y el crítico pidió una más: ${why}`,
    adaptedTwice: 'adaptada dos veces; su v2 no se pudo añadir',
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

/** T6B2-SOURCE-USER: whether the proposal is a person's idea: its source is `user` now or was when it was added, or it came
 *  from a note or the chat. */
function isIdea(doc: ProposalDoc, add: LedgerEvent | null): boolean {
  const from = typeof add?.from === 'string' ? add.from : '';
  return doc.source === 'user' || add?.source === 'user' || from.startsWith('note:') || from === 'chat';
}

/** 6b-3 B-2: whether proposal `id` is a person's idea (isIdea), by its doc and its last add event among the `proposal` `events`:
 *  `proposals replan-check` never lets a re-plan override the task it became. */
export const personsIdea = (events: readonly LedgerEvent[], id: string, doc: ProposalDoc): boolean => isIdea(doc, lastAdd(events, id));

/**
 * Whether the proposal waits for the owner's mark:
 * - T6B2-SOURCE-USER: a person's idea (isIdea) whose add event does not say it is the owner's (`owner: true`, which only
 *   `--from-chat`, the owner's `--from-note` and their v2s write), whatever flag added it;
 * - m-1: an owner's idea of someone who is no longer the roadmap's owner (`approvals/owner` now);
 * - failing closed, one with no add event in this ledger (its origin is unknown, as a proposal pulled from the roadmap) or
 *   whose text is no longer the one forge added (someone else edited it).
 */
function waitsOwner(root: string, id: string, doc: ProposalDoc, add: LedgerEvent | null): boolean {
  if (!add) return true;
  const idea = isIdea(doc, add);
  if (idea && add.owner !== true) return true;
  if (idea && typeof add.author === 'string' && OWNER_USER.test(add.author) && add.author !== roadmapOwner(root)) return true;
  return typeof add.digest === 'string' && add.digest !== proposalDigest(id, doc);
}

/** Final fix F-I2: the last `adapt` of `id` among the `proposal` `events` of the text whose digest is `digest`, when no v2 of it
 *  was added after it (an `add` whose `revises` is `id`): that adapt's v2 could not be added. null otherwise. */
function adaptWithoutV2(events: readonly LedgerEvent[], id: string, digest: string): LedgerEvent | null {
  let at = -1;
  events.forEach((e, i) => { if (e.action === 'adapt' && e.id === id && e.digest === digest) at = i; });
  return at >= 0 && !events.slice(at + 1).some(e => e.action === 'add' && e.revises === id) ? events[at] : null;
}

/** The proposal `id`'s last add event says it revises, or null. */
const revisesOf = (events: readonly LedgerEvent[], id: string): string | null => {
  const r = lastAdd(events, id)?.revises;
  return typeof r === 'string' ? r : null;
};

/** Final fix M2: the earlier proposals of `id`'s revises chain, nearest first (its original, that one's original, …), each
 *  once: a chain that comes back to itself stops there. 6b-3 H-3: `proposals add --revises` exempts them all from the
 *  open-proposal check, and their count is how many adapts the chain already had. */
export function ancestorsOf(events: readonly LedgerEvent[], id: string): string[] {
  const out: string[] = [];
  for (let at = revisesOf(events, id); at !== null && at !== id && !out.includes(at); at = revisesOf(events, at)) out.push(at);
  return out;
}

/**
 * I-2: where the original of a v2 stands, which the v2 keeps. `open`: it could be judged now (open, never judged, no owner's
 * mark), its origin is the owner's or forge's and (final fix M2) so is its own original's, up the whole revises chain, so the
 * v2 is judged and, approved, replaces it. `parked`: it, or one before it in the chain, waits, parked, for the person, and so
 * does the v2. `waits-owner` otherwise, a missing original and a chain that comes back to itself too: the v2 waits for the
 * owner's mark. `seen` are the proposals of the chain already on the way.
 */
function originalStanding(root: string, events: readonly LedgerEvent[], id: string, doc: ProposalDoc | null, seen: ReadonlySet<string>):
  'open' | 'parked' | 'waits-owner' {
  if (!doc || seen.has(id)) return 'waits-owner';
  if (doc.status === 'discussing' && doc.parked) return 'parked';
  if (notJudgeable(root, events, id, doc) !== null) return 'waits-owner';
  return heldBack(root, events, id, doc, seen).held ?? 'open';
}

/**
 * What judge answers of `id` without reading its verdict, with the original it revises: `held` is `waits-owner` (waitsOwner,
 * or a v2 whose original waits for the owner) or `parked` (a v2 of a parked original), and null when the verdict decides.
 * judgeProposal and pendingForJudge share it (Task 7 fix 3, N3).
 */
function heldBack(root: string, events: readonly LedgerEvent[], id: string, doc: ProposalDoc, seen: ReadonlySet<string> = new Set()):
  { held: 'waits-owner' | 'parked' | null; revises: string | null; origDoc: ProposalDoc | null } {
  const add = lastAdd(events, id);
  if (waitsOwner(root, id, doc, add)) return { held: 'waits-owner', revises: null, origDoc: null };
  // I-2: a v2 is never judged past its original's standing, nor (final fix M2) past that of any proposal before it.
  const revises = typeof add?.revises === 'string' ? add.revises : null;
  const origDoc = revises ? loadProposal(root, revises) : null;
  const standing = revises ? originalStanding(root, events, revises, origDoc, new Set([...seen, id])) : 'open';
  return { held: standing === 'open' ? null : standing, revises, origDoc };
}

/**
 * 6b-2 Task 7 fix 1: the proposals of `root` that `proposals batch --pending` hands the critic, by id (oldest first): every one
 * still to decide (notJudgeable: proposed, or under discussion and not parked; no `judge` event; no owner's mark) whose
 * outcome the verdict decides (heldBack: not one judge would answer `waits-owner` or `parked` anyway, fix 3 N3), and none
 * with an open descendant in its revises chain (T6B2-PENDING-V2, final fix M2: that v-n's outcome decides it too). What the
 * run must judge is kept on disk, so a compaction between two cycles loses none of it.
 */
export function pendingForJudge(root: string): string[] {
  return judgeQueue(root).pending;
}

/**
 * The proposals of `root` still to decide (notJudgeable) with no open descendant in their revises chain, by what judge would
 * answer of each without its verdict (heldBack), by id: `pending`, which the verdict decides (pendingForJudge), and (6b-3
 * L-18) `waitsOwner`, which only the owner's mark moves, so a saturation report lists them apart, as waiting for the person.
 * `all`: the proposals of `root`, when the caller has them loaded (fix 1: a report loads them once).
 */
export function judgeQueue(root: string, all: (ProposalDoc & { id: string })[] = loadProposals(root)): { pending: string[]; waitsOwner: string[] } {
  const queue = undecided(root, all);
  const ids = (held: 'waits-owner' | null) => queue.filter(p => p.held === held).map(p => p.id).sort();
  return { pending: ids(null), waitsOwner: ids('waits-owner') };
}

/** The proposals of `all` still to decide (notJudgeable) and with no open descendant in their revises chain, each with what
 *  heldBack answers of it. */
function undecided(root: string, all: (ProposalDoc & { id: string })[]): { id: string; held: 'waits-owner' | 'parked' | null }[] {
  const events = readEvents(root).filter(e => e.kind === 'proposal');
  const heldByOpen = new Set(all.filter(p => p.status === 'proposed' || p.status === 'discussing').flatMap(p => ancestorsOf(events, p.id)));
  return all
    .filter(({ id, ...doc }) => !heldByOpen.has(id) && notJudgeable(root, events, id, doc) === null)
    .map(({ id, ...doc }) => ({ id, held: heldBack(root, events, id, doc).held }));
}

/** The doc decided by this run (or, `by` forge:decide, by the person's answer), and its roadmap update: a stale reason or
 *  parked mark it no longer has is deleted (L-7). `by` null is a park, which decides nothing (final fix m-3): neither
 *  decidedBy nor decidedAt is written, and parked.at says when. */
function decidedDoc(doc: ProposalDoc, status: ProposalDoc['status'], at: string, extra: { reason?: string; parked?: ProposalParked }, by: string | null = BY):
  { next: ProposalDoc; write: Record<string, unknown> } {
  const { reason: _reason, parked: _parked, ...rest } = doc;
  const decided = by === null ? {} : { decidedBy: by, decidedAt: at };
  const next: ProposalDoc = { ...rest, status, ...decided, ...extra };
  const write: Record<string, unknown> = { status, ...decided, ...extra };
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
 * before anything is written; then the proposal, its mark (and those of the original an approved or rejected v2 decides) and a `proposal` `judge` event with the
 * verdict go to .forge/, as the policy writes them. Every wait writes nothing, and an adapt only its `adapt` event (final fix
 * F-I2); 6b-3 H-3: the adapt of a proposal whose chain already had MAX_ADAPTS is a drop, and so (F-I2) is a second adapt of
 * the same text, in a later cycle than `runCycle` (the run's start and its cycle count, which the CLI passes), with no v2
 * added since. 6b-3 B-1: a keep's placement goes into its event and its output. Throws JudgeError, with nothing written, when
 * it is not judged now, has no verdict of its own text, or its decision does not hold.
 */
export function judgeProposal(root: string, id: string, verdicts: CriticVerdict[], at: string, es: boolean, record: RecordDecision, runCycle = ''): Judged {
  const doc = loadProposal(root, id);
  if (!doc) throw new JudgeError(`${id} not found`);
  const events = readEvents(root).filter(e => e.kind === 'proposal');
  const refused = notJudgeable(root, events, id, doc);
  if (refused) throw new JudgeError(refused);
  const verdict = verdictFor(id, doc, verdicts);
  const { held, revises, origDoc } = heldBack(root, events, id, doc);
  if (held) return { outcome: held, write: null, approval: null, decision: null };
  // 6b-3 H-3: a chain gets at most MAX_ADAPTS adapts, so the critic's adapt of a proposal with that many earlier versions is
  // judged as a drop, and takes the chain with it below.
  const overAdapted = verdict.verdict === 'adapt' && ancestorsOf(events, id).length >= MAX_ADAPTS;
  // Final fix F-I2: an adapt, in a later cycle, of the text an earlier adapt was of, with no v2 added since (its add was refused),
  // is a drop too: otherwise the proposal is batched and adapted again every cycle. One of the same cycle (`runCycle`: a session
  // that resumes its batch judges it again) is that adapt, never a second one.
  const adapted = verdict.verdict === 'adapt' && !overAdapted ? adaptWithoutV2(events, id, verdict.digest) : null;
  const adaptedTwice = adapted !== null && adapted.runCycle !== runCycle;
  // An adapt changes nothing: it is logged once, as an `adapt` event of the text's digest and the cycle that no state reads, and
  // the run may write a v2, or the proposal is judged again.
  if (verdict.verdict === 'adapt' && !overAdapted && !adaptedTwice) {
    if (!adapted) appendEvent(root, { ts: at, kind: 'proposal', action: 'adapt', id, digest: verdict.digest, runCycle });
    return { outcome: 'adapt', write: null, approval: null, decision: null, changes: verdict.changes ?? '' };
  }
  const outcome: Exclude<JudgeOutcome, 'adapt' | 'waits-owner'> = verdict.verdict === 'keep' ? 'approved'
    : verdict.verdict === 'clash' && doc.source === 'user' ? 'parked' : 'rejected';
  const w = es ? WORDS.es : WORDS.en;
  const why = overAdapted ? w.adapts(verdict.why) : adaptedTwice ? w.adaptedTwice : verdict.why;
  // 6b-3 B-1, L-4: only a keep places its task (readVerdicts keeps a placement on nothing else).
  const placement = outcome === 'approved' ? verdict.placement : undefined;
  const parked = outcome === 'parked' ? normalizeParked({ why: verdict.why, loses: verdict.loses, at }) : null;
  if (outcome === 'parked' && !parked) throw new JudgeError(`the critic's clash of ${id} does not say what integrating it would lose`);
  const { next, write } = outcome === 'approved' ? decidedDoc(doc, 'auto_approved', at, {})
    : outcome === 'rejected' ? decidedDoc(doc, 'rejected', at, { reason: why })
    : decidedDoc(doc, 'discussing', at, { parked: parked! }, null);
  const mark = outcome === 'parked' ? null : markOf(id, next.status === 'auto_approved' ? 'auto_approved' : 'rejected', at, doc);
  // An approved v2 replaces its original, which its standing keeps open, and a rejected one takes it with it (T6B2-PENDING-V2):
  // rejected either way, with its own mark. Final fix M2: so is every proposal before it in its revises chain, which the same
  // standing keeps open (one that is not, never, so no decision or mark is overwritten).
  const origReason = outcome === 'approved' ? w.replaced(id) : w.dropped;
  const replaced = outcome === 'parked' || !revises || !origDoc ? [] : ancestorsOf(events, id).flatMap(rid => {
    const rdoc = rid === revises ? origDoc : loadProposal(root, rid);
    return rdoc && notJudgeable(root, events, rid, rdoc) === null
      ? [{ id: rid, ...decidedDoc(rdoc, 'rejected', at, { reason: origReason }), mark: markOf(rid, 'rejected', at, rdoc) }] : [];
  });
  const [orig, ...earlier] = replaced;
  const alternative = outcome === 'approved' ? w.rejected : outcome === 'rejected' ? w.approved : w.integrate;
  const decision = {
    point: doc.source === 'user' ? 'idea' : 'approve',
    what: doc.title,
    chosen: w[outcome],
    alternatives: [{ option: alternative, whyNot: why, ...(parked ? { tradeoffs: parked.loses } : {}) }],
    why,
    by: 'auto',
    undo: { type: 'none', reason: w.undo[outcome](id) },
  };
  // T6B2-DECISION-FIRST: a valid decision is recorded before the proposal changes, so no approval is ever left without it.
  holds(id, decision);
  record(decision);
  saveProposal(root, id, next);
  if (mark) saveApproval(root, id, mark);
  for (const r of replaced) {
    saveProposal(root, r.id, r.next);
    saveApproval(root, r.id, r.mark);
  }
  // M-2: the event lastDecisions reads, with the verdict that decided it (H-3: an adapt past the limit decided it as a drop),
  // and 6b-3 B-1: a keep's placement, which `proposals to-task` takes in a product run, so nothing is carried in memory.
  appendEvent(root, { ts: at, kind: 'proposal', action: 'judge', id, status: next.status, verdict: overAdapted || adaptedTwice ? 'drop' : verdict.verdict, digest: verdict.digest,
    ...(placement ? { placement } : {}) });
  for (const r of replaced) {
    appendEvent(root, { ts: at, kind: 'proposal', action: 'judge', id: r.id, status: 'rejected', ...(outcome === 'approved' ? { replacedBy: id } : { droppedWith: id }) });
  }
  const out = (r: (typeof replaced)[number]): Replaced => ({ id: r.id, write: r.write, approval: markWrite(r.id, r.mark) });
  return {
    outcome, write, approval: mark ? markWrite(id, mark) : null,
    ...(orig ? { original: out(orig) } : {}),
    ...(earlier.length ? { ancestors: earlier.map(out) } : {}),
    decision,
    ...(placement ? { placement } : {}),
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
 * idea, holds the owner's mark, or its decision does not hold. It never judges: the answer is the person's.
 */
export function unparkProposal(root: string, id: string, insist: boolean, at: string, es: boolean, record: RecordDecision): Unparked {
  const doc = loadProposal(root, id);
  if (!doc) throw new JudgeError(`${id} not found`);
  const parked = doc.status === 'discussing' ? doc.parked : undefined;
  if (!parked) throw new JudgeError(`${id} is ${doc.status}${doc.status === 'discussing' ? ' and not parked' : ''}: only a parked idea waits for the person's answer`);
  // Final fix (probe S3): the owner's mark is the owner's own decision (the page's, say, whose update of the proposal has not
  // landed yet), which no answer here overwrites, as judge refuses it (notJudgeable).
  if (loadApproval(root, id)) throw new JudgeError(`${id} has the owner's mark (approvals/${id}): the owner decided it`);
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
