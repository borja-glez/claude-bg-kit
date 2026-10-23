import { sha256Hex } from './sha256.js';
import { clean as cleanLine } from './decisions.js';
export const PROPOSAL_CATEGORIES = ['feature', 'security', 'perf', 'quality', 'tests', 'deps'] as const;
export const PROPOSAL_RISKS = ['low', 'medium', 'high'] as const;
export const PROPOSAL_STATUSES = ['proposed', 'approved', 'rejected', 'discussing', 'auto_approved', 'done'] as const;
// verify (K2-12): a defect a verify agent saw outside its brief.
export const PROPOSAL_SOURCES = ['scout', 'user', 'verify'] as const;
export type ProposalCategory = (typeof PROPOSAL_CATEGORIES)[number];
export type ProposalRisk = (typeof PROPOSAL_RISKS)[number];
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];
export type Decision = 'approve' | 'reject' | 'discuss';
export const MAX_PROPOSAL_TEXT = 4000;
export const MAX_PROPOSAL_TITLE = 200;

export interface ProposalDoc {
  ts: string; category: ProposalCategory; risk: ProposalRisk; title: string; rationale: string; evidence: string; pillar: string;
  estimate?: string; path?: string; taskId?: string; status: ProposalStatus; decidedBy?: string; decidedAt?: string; reason?: string;
  source: (typeof PROPOSAL_SOURCES)[number]; author: string; history?: ProposalHistoryEntry[];
  /** 6b-2: a person's idea that clashes with the vision, parked by an autonomous run until the person answers: why, what
   *  integrating it would lose, and when. A parked proposal is `discussing` and fills no queue. */
  parked?: ProposalParked;
}

export interface ProposalParked { why: string; loses: string; at: string }

/** A decision a reopen replaced: the old status and who decided it, and who reopened it and when. */
export interface ProposalHistoryEntry {
  status: ProposalStatus; decidedBy?: string; decidedAt?: string; reason?: string; reopenedBy: string; reopenedAt: string;
}
export const MAX_PROPOSAL_HISTORY = 20;

const str = (x: unknown): x is string => typeof x === 'string';
const oneOf = <T extends string>(list: readonly T[], x: unknown): x is T => str(x) && (list as readonly string[]).includes(x);

/**
 * Clips to at most `max` code points at a word boundary, ending in «…». Hard cut only when the
 * last ~30% holds no whitespace (one long token such as a URL). No Node imports: the page bundles this.
 */
export function clipWords(s: string, max: number): string {
  const chars = Array.from(s);
  if (chars.length <= max) return s;
  let space = -1;
  for (let i = Math.min(max - 1, chars.length - 1); i >= 0; i--) if (/\s/.test(chars[i])) { space = i; break; }
  const hard = chars.slice(0, max - 1).join('');
  if (space < Math.floor((max - 1) * 0.7)) return hard + '…';
  const soft = chars.slice(0, space).join('').replace(/[\s.,;:!?¡¿…\-–—]+$/u, '');
  return (soft || hard) + '…';
}

/** Strict normalizer for shared (untrusted) proposal docs. */
export function normalizeProposal(x: unknown): ProposalDoc | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  if (!oneOf(PROPOSAL_CATEGORIES, o.category) || !oneOf(PROPOSAL_RISKS, o.risk) || !oneOf(PROPOSAL_STATUSES, o.status)) return null;
  if (!oneOf(PROPOSAL_SOURCES, o.source)) return null;
  if (!str(o.title) || !o.title.trim() || !str(o.author)) return null;
  const text = (v: unknown, max = MAX_PROPOSAL_TEXT) => (str(v) ? clipWords(v, max) : '');
  // One-line fields: whitespace runs (newlines included) collapse to one space, so they never fake brief lines.
  const line = (v: unknown) => (str(v) ? clipWords(v.replace(/[\s\x85]+/g, ' ').trim(), MAX_PROPOSAL_TITLE) : '');
  const out: ProposalDoc = {
    ts: str(o.ts) ? o.ts : '', category: o.category, risk: o.risk, title: line(o.title),
    rationale: text(o.rationale), evidence: text(o.evidence), pillar: line(o.pillar),
    status: o.status, source: o.source, author: o.author,
  };
  for (const k of ['estimate', 'path', 'decidedBy', 'decidedAt'] as const) if (str(o[k])) out[k] = (o[k] as string).slice(0, MAX_PROPOSAL_TITLE);
  if (str(o.taskId) && /^[A-Za-z0-9_.-]{1,64}$/.test(o.taskId)) out.taskId = o.taskId;
  if (str(o.reason)) out.reason = clipWords(o.reason, MAX_PROPOSAL_TEXT);
  if (Array.isArray(o.history)) {
    const history = o.history.map(normalizeHistoryEntry).filter((e): e is ProposalHistoryEntry => e !== null).slice(-MAX_PROPOSAL_HISTORY);
    if (history.length) out.history = history;
  }
  const parked = normalizeParked(o.parked);
  if (parked) out.parked = parked;
  return out;
}

/** An ISO time as Date#toISOString writes it, that is a real date. */
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/** A parked mark, or null unless it has a why, what would be lost (each one line, cleaned as the critic's text and the
 *  decisions are, by lib/decisions' clean, and cut at a word to MAX_PROPOSAL_TEXT) and an ISO time. */
export function normalizeParked(x: unknown): ProposalParked | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const oneLine = (v: unknown) => (str(v) ? clipWords(cleanLine(v, Infinity), MAX_PROPOSAL_TEXT) : '');
  const why = oneLine(o.why);
  const loses = oneLine(o.loses);
  const at = str(o.at) && ISO_TIME.test(o.at) && Number.isFinite(Date.parse(o.at)) ? o.at : '';
  return why && loses && at ? { why, loses, at } : null;
}

function normalizeHistoryEntry(x: unknown): ProposalHistoryEntry | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  if (!oneOf(PROPOSAL_STATUSES, o.status) || !str(o.reopenedBy) || !str(o.reopenedAt)) return null;
  const e: ProposalHistoryEntry = { status: o.status, reopenedBy: o.reopenedBy.slice(0, MAX_PROPOSAL_TITLE), reopenedAt: o.reopenedAt.slice(0, MAX_PROPOSAL_TITLE) };
  if (str(o.decidedBy)) e.decidedBy = o.decidedBy.slice(0, MAX_PROPOSAL_TITLE);
  if (str(o.decidedAt)) e.decidedAt = o.decidedAt.slice(0, MAX_PROPOSAL_TITLE);
  if (str(o.reason)) e.reason = clipWords(o.reason, MAX_PROPOSAL_TEXT);
  return e;
}

export const canDecide = (status: ProposalStatus): boolean => status === 'proposed' || status === 'discussing';
export const applyDecision = (d: Decision): ProposalStatus => (d === 'approve' ? 'approved' : d === 'reject' ? 'rejected' : 'discussing');
export const isActionable = (p: ProposalDoc): boolean => p.status === 'approved' || p.status === 'auto_approved';

/** Wave 4 (§4.1): the owner's mark on a decision, approvals/<pid>: a collection only the roadmap's owner can write, a rule
 *  the server enforces. A proposal counts as approved for forge only when its mark agrees with it. */
export const APPROVAL_STATUSES = ['approved', 'rejected', 'auto_approved'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
// forge:auto (6b-2): an autonomous profile's own approval or rejection (`proposals judge`), on the critic's verdict.
export const APPROVAL_BY = ['page', 'forge:decide', 'forge:policy', 'forge:auto'] as const;
export type ApprovalBy = (typeof APPROVAL_BY)[number];
export interface ApprovalDoc { status: ApprovalStatus; decidedAt: string; by: ApprovalBy; digest: string }

/** The fields a decision is about, the ones to-task builds the task from (title, rationale, evidence, path for the zone,
 *  estimate) and the policy reads (category, risk), and the pid they belong to. The owner's mark carries their digest: a
 *  proposal edited afterwards, or the same text under another pid, is not the one that was approved. SHA-256 of their
 *  canonical JSON (an array, so no key order), 64 hex digits; synchronous and pure so a page computes it too. */
export function proposalDigest(pid: string, p: Pick<ProposalDoc, 'category' | 'risk' | 'title' | 'rationale' | 'evidence' | 'path' | 'estimate'>): string {
  return sha256Hex(JSON.stringify([pid, p.category, p.risk, p.title, p.rationale, p.evidence, p.path ?? '', p.estimate ?? '']));
}

/** An approvals/<pid> document, or null: no free text, only its status, when and from where. */
export function normalizeApproval(x: unknown): ApprovalDoc | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  if (!oneOf(APPROVAL_STATUSES, o.status) || !oneOf(APPROVAL_BY, o.by) || !str(o.decidedAt) || !o.decidedAt || !str(o.digest) || !/^[0-9a-f]{64}$/.test(o.digest)) return null;
  return { status: o.status, decidedAt: o.decidedAt.slice(0, MAX_PROPOSAL_TITLE), by: o.by, digest: o.digest };
}

/** The mark agrees with the proposal: both approved, or both auto_approved, and the proposal is not done. */
export function markMatches(p: Pick<ProposalDoc, 'status'>, a: ApprovalDoc | null | undefined): boolean {
  return !!a && (p.status === 'approved' || p.status === 'auto_approved') && a.status === p.status;
}

/** Why a decided proposal is not the owner's: 'no-mark' (none, or it disagrees with the status), 'edited' (the mark is of other
 *  text than the proposal has now) or 'ok'. `last` is the status this checkout's latest decision event for the pid
 *  left it in (a reopen counts as the decision it made, its `to`): a mark of any other status is an older decision that
 *  was reopened, even if it is still in the roadmap. Undefined when the ledger holds no decision for the pid (a mark made
 *  in another checkout): the mark and its digest decide. */
export function ownerCheck(pid: string, p: Pick<ProposalDoc, 'status' | 'category' | 'risk' | 'title' | 'rationale' | 'evidence' | 'path' | 'estimate'>, a: ApprovalDoc | null | undefined, last?: string): 'ok' | 'no-mark' | 'edited' {
  if (!a || !markMatches(p, a)) return 'no-mark';
  if (last !== undefined && last !== a.status) return 'no-mark';
  return a.digest === proposalDigest(pid, p) ? 'ok' : 'edited';
}

/** Wave 4: approved by the roadmap's owner, for auto-approval and to-task: the mark agrees, is of this very text, and it has no
 *  task yet. Someone else can block a proposal by changing proposals/<pid>, never fire it or change what it says. */
export function ownerApproved(pid: string, p: Parameters<typeof ownerCheck>[1] & Pick<ProposalDoc, 'taskId'>, a: ApprovalDoc | null | undefined, last?: string): boolean {
  return ownerCheck(pid, p, a, last) === 'ok' && p.taskId === undefined;
}
