// The page's model and view state: what renderApp reads, the six views (spec §4.6) and the allowed values of each filter.
// Types and constants only; every view renders from these.
import type { EventDoc, InfiniteDoc, MessageDoc, MetaDoc, NoteDoc, NoteType, PlanStatus, PlanView, RunDoc, SessionDoc, States, TaskStatus } from '../lib/types.js';
import type { GroupBy, Zoom } from '../lib/timeline.js';
import type { NoteFilter } from '../lib/notes.js';
import { PROPOSAL_CATEGORIES, PROPOSAL_RISKS, type ApprovalDoc, type ProposalCategory, type ProposalDoc, type ProposalRisk, type ProposalStatus } from '../lib/proposals.js';
import type { Drop } from './normalize.js';

export interface Model {
  meta: MetaDoc | null;
  plan: PlanView;
  states: States;
  sessions: Record<string, SessionDoc>;
  events: (EventDoc & { id: string })[];
  messages: (MessageDoc & { id: string })[];
  notes: (NoteDoc & { id: string })[];
  proposals: (ProposalDoc & { id: string })[];
  /** §4.1: the owner's marks (approvals/<pid>), by proposal id; undefined until their first snapshot. */
  approvals?: Record<string, ApprovalDoc>;
  /** §4.1: whether the viewer owns the roadmap (user.isOwner(), once, after connecting); false on any error. Undefined while
   *  it resolves (carry 5): neither the owner's buttons nor the line «only the owner decides» show until it is known. */
  isOwner?: boolean;
  /** G-24: the deferred findings this viewer marked as seen (task → its doneAt), from its own localStorage. */
  seenDeferred?: Record<string, string>;
  /** forge's infinite run (meta/infinite); the pill shows only while it is active. */
  infinite?: InfiniteDoc | null;
  /** forge's execution (meta/run): the pill, «En curso» and the runs view. */
  run?: RunDoc | null;
  /** 'user:<id>' of the viewer, or null when unknown. */
  me: string | null;
  /** Display names by opaque user id (from user.profiles). */
  profiles: Record<string, string>;
  readOnly: boolean;
  /** Set when the roadmap refused a proposal write: only the proposals turn read-only. */
  proposalsReadOnly?: boolean;
  now: number;
  offline: boolean;
  connecting: boolean;
  /** H-04: `?debug=1` lists what the normalizers dropped or coerced (`dropped`, by collection). */
  debug?: boolean;
  dropped?: Record<string, Drop[]>;
  /** H-06: bumped by every change of the data; derive() caches by it. */
  rev?: number;
  /** G-14: when the snapshot's states were listed; null once the database answered with its own. */
  statesAt?: string | null;
  /** When the last snapshot of state arrived (ms), for «sincronizado hace…». */
  syncedAt?: number | null;
}

/** The six views of §4.6, in the order of the nav. */
export type View = 'summary' | 'plan' | 'schedule' | 'runs' | 'sessions' | 'talk';
export const VIEWS: readonly View[] = ['summary', 'plan', 'schedule', 'runs', 'sessions', 'talk'];
/** What the conversation view shows in 4b: the notes or the proposals (4c joins them). */
export type TalkKind = 'notes' | 'proposals';
export const TALK_KINDS: readonly TalkKind[] = ['notes', 'proposals'];
/** The four tabs of the task detail (§4.7); forge shows only with forge data or evidence. */
export type DetailTab = 'summary' | 'definition' | 'forge' | 'talk';
export const DETAIL_TABS: readonly DetailTab[] = ['summary', 'definition', 'forge', 'talk'];
export type VFilterKey = 'done' | 'in_progress' | 'blocked' | 'committed' | 'provisional';
export const VFILTER_KEYS: readonly VFilterKey[] = ['done', 'in_progress', 'blocked', 'committed', 'provisional'];
export const NOTE_FILTERS: readonly NoteFilter[] = ['all', 'decision', 'idea', 'debt', 'open', 'mine'];

/** H-06: what the timeline's viewport shows, as rows: the first visible one and how many fit. Proportions of its scroll,
 *  so the page's zoom does not change them. */
export interface TlView { first: number; count: number }

export interface UiState {
  zoom: Zoom; offset: number; expanded: Set<string>; modal: string | null; search: string; view: View;
  /** The conversation's kind (notes by default). */
  talk?: TalkKind;
  /** The open tab of the task detail (the summary by default). */
  tab?: DetailTab;
  /** Index of the open verification screenshot in the modal's task, or null. */
  shot: number | null;
  /** The timeline window when zoomed or moved freely: its span and its pan from the default anchor, in ms. */
  span?: number; pan?: number;
  /** Timeline status filter (empty: all) and layers drawn over it. */
  statuses?: string[]; layers?: string[];
  /** The scope of the burndown: a version id, a phase id, or empty for the whole plan. */
  burnScope?: string;
  /** H-06: the timeline's viewport, from its last scroll; undefined until the first one, and after leaving the schedule. */
  tl?: TlView;
  /** Empty arrays = no filter. phaseStatuses filters columns by phase plan status. */
  versionFilter: { statuses: TaskStatus[]; phaseStatuses: PlanStatus[]; track: string | null };
  /** Collapsed version categories, keyed 'phaseId|category'. */
  collapsed: Set<string>;
  noteFilter: NoteFilter;
  timelineGroup: GroupBy;
  draft: { type: NoteType; text: string };
  answering: string | null;
  answerDraft: string;
  /** markSaved (review M6): a decision's mark landed and its proposal update did not; the notice offers to retry it. */
  notice: 'readonly' | 'failed' | 'answered' | 'decided' | 'owner' | 'changed' | 'markSaved' | null;
  proposalFilter: ProposalFilter;
  /** Proposal id whose comment composer is open. */
  commenting: string | null;
  commentDraft: string;
  /** Proposal id whose reject composer is open. */
  rejecting: string | null;
  reasonDraft: string;
}
export interface ProposalFilter { status: ProposalStatus | 'all'; category: ProposalCategory | 'all'; risk: ProposalRisk | 'all' }
export type ProposalFilterKind = keyof ProposalFilter;
/** Allowed values per proposal filter row ('all' first). */
export const PROPOSAL_FILTERS: { [K in ProposalFilterKind]: readonly ProposalFilter[K][] } = {
  status: ['all', 'proposed', 'discussing', 'approved', 'auto_approved', 'rejected', 'done'],
  category: ['all', ...PROPOSAL_CATEGORIES],
  risk: ['all', ...PROPOSAL_RISKS],
};
