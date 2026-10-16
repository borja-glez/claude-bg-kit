// C3: the role of the session that looks at a checkout's roadmap and its forge execution: owner, other-live, previous
// or none. Pure, without Node imports: waypoint's hooks, the band (wave 2b), forge's live hook and lens (wave 3) share it.
// It judges a binding by its lease alone (bindingLive). The hooks pass bindings already settled by their pid
// (bound-fs.ts settleBinding, Node only); the band passes them raw (M6).
import { bindingLive, type BoundDoc } from './bound.js';
import type { ExecutionState } from './execution-state.js';
import type { MemberDoc } from './member-doc.js';
import { isVisibleRun, lastMovedAt } from './execution-view.js';
import { memberOfHook } from './forge-activity.js';

// The lease rule lives in bound.ts, so execution-view.ts (which this file imports) reads it without a cycle.
export { bindingLive, BOUND_LEASE_MS } from './bound.js';
/** An ended or lapsed binding is offered to a later conversation («left in progress») for this long. */
export const PREVIOUS_OFFER_MS = 24 * 3600_000;
export type ViewerRole = 'owner' | 'other-live' | 'previous' | 'none';

export interface ViewerInput {
  /** The bindings of the project: the checkout's seat and its extra seats (spec §9, D1). */
  bound: BoundDoc | readonly BoundDoc[] | null;
  /** The execution this roadmap is about: the project's plan run, or the checkout's ephemeral one. */
  execution: ExecutionState | null;
  /** The members of that execution (.forge/members). */
  members: readonly MemberDoc[];
  sessionId: string | null;
  now: number;
  /** The run has no coordinator: its live signal says its conversation ended (live/<hookSession>.json with `ended`), or it
   *  went silent (coordinatorGone in execution-view.ts, M4): rule 5 instead of rule 4. */
  coordinatorEnded?: boolean;
  /** Seat SID → its task claimed or in progress. */
  openTasks?: Readonly<Record<string, string>>;
}
export interface Viewer {
  role: ViewerRole; subject: 'execution' | 'binding' | null;
  binding: BoundDoc | null; member: MemberDoc | null; coordinator: boolean;
  since: string | null; task: string | null;
}

const NONE: Viewer = { role: 'none', subject: null, binding: null, member: null, coordinator: false, since: null, task: null };
const time = (s: string | null): number => { const t = s ? Date.parse(s) : NaN; return Number.isFinite(t) ? t : -Infinity; };
const newest = (list: readonly BoundDoc[], at: (b: BoundDoc) => number): BoundDoc | null =>
  list.reduce<BoundDoc | null>((best, b) => (!best || at(b) > at(best) ? b : best), null);

/**
 * C3: what the session `sessionId` is to this roadmap and its execution, by the rules of spec §4.2, the first that
 * holds: 1 the coordinator of a visible execution, 2 a member of its run, 3 its own binding (ended or not: the same
 * conversation resumed), 4 an active execution of another session, 5 one that ended or whose coordinator's
 * conversation ended, 6 another live binding, 7 a binding that ended or lapsed within PREVIOUS_OFFER_MS (the newest
 * with a task open, else the newest), 8 none.
 * Whether a `previous` binding has something to take up (a task, a draft) is for whoever draws it to say.
 */
export function describeViewer(i: ViewerInput): Viewer {
  const list: readonly BoundDoc[] = i.bound === null ? [] : 'sid' in i.bound ? [i.bound] : i.bound;
  const e = i.execution;
  const taskOf = (b: BoundDoc): string | null => i.openTasks?.[b.sid] ?? null;
  const sid = i.sessionId;
  if (sid !== null) {
    if (e && e.hookSession === sid && isVisibleRun(e, i.now, 'owner')) {
      return { ...NONE, role: 'owner', subject: 'execution', coordinator: true, since: lastMovedAt(e) };
    }
    const m = e ? memberOfHook(i.members, sid, e.runId) : null;
    if (e && m && isVisibleRun(e, i.now, 'owner')) return { ...NONE, role: 'owner', subject: 'execution', member: m, since: m.since, task: m.task };
    const own = newest(list.filter(b => b.claude === sid), b => time(b.seenAt));
    if (own) return { ...NONE, role: 'owner', subject: 'binding', binding: own, since: own.since, task: taskOf(own) };
  }
  if (e && e.active && !i.coordinatorEnded && isVisibleRun(e, i.now, 'other-live')) {
    return { ...NONE, role: 'other-live', subject: 'execution', since: lastMovedAt(e) };
  }
  if (e && (!e.active || i.coordinatorEnded) && isVisibleRun(e, i.now, 'previous')) {
    return { ...NONE, role: 'previous', subject: 'execution', since: lastMovedAt(e) };
  }
  const others = list.filter(b => b.claude !== sid);
  const live = newest(others.filter(b => bindingLive(b, i.now)), b => time(b.seenAt));
  if (live) return { ...NONE, role: 'other-live', subject: 'binding', binding: live, since: live.seenAt, task: taskOf(live) };
  const offerAt = (b: BoundDoc) => time(b.endedAt ?? b.seenAt);
  // I3: a binding left with a task in progress comes before a newer one with nothing open.
  const offered = others.filter(b => !bindingLive(b, i.now) && offerAt(b) + PREVIOUS_OFFER_MS > i.now);
  const prev = newest(offered.filter(b => taskOf(b) !== null), offerAt) ?? newest(offered, offerAt);
  if (prev) return { ...NONE, role: 'previous', subject: 'binding', binding: prev, since: prev.endedAt ?? prev.seenAt, task: taskOf(prev) };
  return NONE;
}

/** C3's function: the role alone. */
export function viewerRole(i: ViewerInput): ViewerRole {
  return describeViewer(i).role;
}
