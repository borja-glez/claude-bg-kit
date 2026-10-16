import { computeMetrics } from '../lib/metrics.js';
import { escalationCandidates, inboxFor } from '../lib/coordination.js';
import { parseCritique } from '../lib/critique.js';
import { parseDismissed, pendingProposals, type GateCritique } from '../lib/design-gate.js';
import { parseDesign } from '../lib/design.js';
import { parseChangelog } from '../lib/history.js';
import { parsePlan } from '../lib/plan.js';
import { coordinatorGone, executionView, isVisibleRun } from '../lib/execution-view.js';
import { isSafeId, normalizeLive, normalizePublicTask, parseExecution, type ExecutionState, type LiveDoc, type PublicTask } from '../lib/execution-state.js';
import type { MessageDoc, Plan, States } from '../lib/types.js';
import { decisionsSummary } from '../lib/decisions.js';
import { MAX_SEATS, parseBound, type BoundDoc } from '../lib/bound.js';
import { normalizeMember, type MemberDoc } from '../lib/member-doc.js';
import { describeViewer, type Viewer, type ViewerInput } from '../lib/viewer-role.js';

export interface ProjectEntry { name: string; bindings: readonly BoundDoc[]; mtimeMs: number }
export interface BandFiles {
  plan?: string; session?: string; execution?: string; execTasks?: Record<string, string>; live?: Record<string, string>;
  design?: string; changelog?: string; decisions?: string; dismissed?: string;
  states: Record<string, string>; messages: Record<string, string>; critiques: Record<string, string>;
  /** C3: the project's bindings by seat: '.' is the checkout seat's bound.json, '<sid>' the one in seats/<sid>/. */
  bindings?: Record<string, string>;
  /** The session.json of each extra seat, by its sid (the checkout seat's is `session`). */
  seatSessions?: Record<string, string>;
  /** The main checkout's .forge/members/*.json, by file name. */
  members?: Record<string, string>;
  /** The live signal of the execution's coordinator, .forge/live/<hookSession>.json. */
  coordinatorLive?: string;
  /** The bound.json texts of the active execution's coordinator (its hook session, any via) in every .waypoint/<p>/ of
   *  the main checkout, by `<p>/<seat>` ('.' the checkout seat): an open conversation holds one live. */
  coordinatorBindings?: Record<string, string>;
  /** $.session.id() of the conversation that looks; null or absent: it owns nothing. */
  sessionId?: string | null;
  /** The engine's clock in ms; absent: Date.now(). */
  now?: number;
}
// In work mode `cells` holds one letter per task of the track (or of the plan), in plan order: d done, a active,
// b blocked, p pending. A notice (spec §4.5) is what a conversation that is not the owner sees: another live one works
// the roadmap or coordinates a run (kind other-live), or an earlier one left a task, a draft or a run behind (kind
// previous); its key names the subject for a dismissal: task:<T>, run:<runId>, design:<project> or seat:<sid>.
// Every variant carries `viewer`, the role of the conversation that looks (C3): lens reads it from here. build.mjs
// copies this type as it is into plugins/waypoint/types, so it names no other type and its body has no capitalised
// word: the role is written out.
export type BandModel = (
  // locale, when known, lets a reader of the band (lens) keep the project's language while no band is drawn.
  | { mode: 'none'; locale?: string }
  | { mode: 'work'; project: string; locale: string; sid: string; track: string | null; roadmapUrl: string | null;
      current: { id: string; title: string; startedAt?: string; estimateMin?: number } | null;
      trackDone: number; trackTotal: number; percent: number; inbox: number; escalation: boolean;
      phase: { index: number; total: number; name: string } | null; cells: string; swarm: boolean;
      run: { coordinator: string; stage: string } | null;
      recentDone?: { id: string; minutes: number; estimateMin?: number }[]; auto?: { count: number; lastMajor: string | null } }
  | { mode: 'run'; project: string; locale: string; executor: 'subagents' | 'sessions'; running: number; parallel: number;
      integrated: number; total: number; slots: { task: string; stage: string; round: number }[];
      worst: 'alive' | 'silent' | 'stopped'; stalled: boolean; roadmapUrl: string | null; auto?: { count: number; lastMajor: string | null } }
  // proposals/critical count the latest critique; pending/pendingCritical the proposals of every round still undecided.
  | { mode: 'design'; project: string; locale: string; version: number; round: number; proposals: number; critical: number;
      pending: number; pendingCritical: number; designUrl: string | null; auto?: { count: number; lastMajor: string | null } }
  // joinable, on a notice about a run: whether forge takes members in it (an active plan run; an ephemeral one never).
  | { mode: 'notice'; project: string; locale: string; kind: 'other-live' | 'previous'; subject: 'task' | 'run' | 'design';
      seat: string | null; task: string | null; title: string | null; since: string | null; runId: string | null;
      integrated?: number; total?: number; stopReason?: string | null; joinable?: boolean; roadmapUrl: string | null; key: string }
) & { viewer: { role: 'owner' | 'other-live' | 'previous' | 'none'; coordinator: boolean; runId: string | null } };

/** C3: the role of the conversation that looks, as every band publishes it. */
export type BandViewer = BandModel['viewer'];
/** §4.5: the band of a conversation that is not the owner. */
export type NoticeBand = Extract<BandModel, { mode: 'notice' }>;
/** Nothing to work out (no project and no execution, or a plan that does not read): nobody's role. */
export const NO_VIEWER: BandViewer = { role: 'none', coordinator: false, runId: null };
/** The band that draws nothing, with the language and the role it knows. */
export function noneBand(locale?: string, viewer: BandViewer = NO_VIEWER): BandModel {
  return locale ? { mode: 'none', locale, viewer: { ...viewer } } : { mode: 'none', viewer: { ...viewer } };
}

function json<T>(text: string | undefined): T | undefined {
  if (text === undefined) return undefined;
  try { return JSON.parse(text) as T; } catch { return undefined; }
}
function parsed<T>(rows: Record<string, string>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [id, text] of Object.entries(rows)) { const v = json<T>(text); if (v && typeof v === 'object') out[id] = v; }
  return out;
}

/**
 * A-15: the project of this session's binding (the one renewed last when several), else the one with the latest
 * activity: its plan.yaml or design.md, or the last renewal or end of any of its bindings. A session.json alone no
 * longer wins: it is the seat of whoever worked there, not of this session.
 */
export function pickProject(entries: readonly ProjectEntry[], sessionId: string | null): string | null {
  if (!entries.length) return null;
  const time = (s: string | null) => { const t = s ? Date.parse(s) : NaN; return Number.isFinite(t) ? t : -Infinity; };
  const at = (b: BoundDoc) => Math.max(time(b.seenAt), time(b.endedAt));
  const activity = (e: ProjectEntry) => Math.max(e.mtimeMs, ...e.bindings.map(at));
  const ownAt = (e: ProjectEntry) => Math.max(-Infinity, ...e.bindings.filter(b => b.claude === sessionId).map(at));
  const own = sessionId ? entries.filter(e => ownAt(e) > -Infinity) : [];
  const score = (e: ProjectEntry) => (own.length ? [ownAt(e), activity(e)] : [activity(e)]);
  const better = (a: ProjectEntry, b: ProjectEntry) => {
    const sa = score(a), sb = score(b);
    for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sb[i] > sa[i] ? 1 : -1;
    return 0;
  };
  return [...(own.length ? own : entries)].sort(better)[0].name;
}

/** C3: a seat of the project as the band reads it (readSeats does the same on disk). */
export interface BandSeat { sid: string; checkout: boolean; bound: BoundDoc | null; session: string | undefined }

/** The checkout seat's id from the texts of its session.json and bound.json, as checkoutSid reads them on disk. */
export function checkoutSidOf(session: string | undefined, bound: string | undefined, now?: number): string | null {
  const named = json<{ sessionId?: unknown }>(session)?.sessionId;
  return typeof named === 'string' && named ? named : parseBound(bound, now)?.sid ?? null;
}

/**
 * The project's seats from their files' texts: the checkout seat (its id from session.json, else from its own
 * bound.json) and up to MAX_SEATS extra seats, by name, never the checkout seat's own id. A binding that does not read,
 * comes from the future or names another seat is none. The band never checks a pid: only the CLI and the hooks can.
 */
export function seatsOf(f: Pick<BandFiles, 'session' | 'bindings' | 'seatSessions'>, now?: number): BandSeat[] {
  const texts = f.bindings ?? {};
  const checkoutBound = parseBound(texts['.'], now);
  const sid = checkoutSidOf(f.session, texts['.'], now);
  const out: BandSeat[] = [];
  if (sid !== null && isSafeId(sid)) out.push({ sid, checkout: true, bound: checkoutBound?.sid === sid ? checkoutBound : null, session: f.session });
  const extra = Object.keys(texts).filter(k => k !== '.' && k !== sid && isSafeId(k)).sort().slice(0, MAX_SEATS);
  for (const k of extra) {
    const b = parseBound(texts[k], now);
    out.push({ sid: k, checkout: false, bound: b?.sid === k ? b : null, session: f.seatSessions?.[k] });
  }
  return out;
}

/** Each seat's task claimed or in progress in the state cache (SID → its task), the first by id: openTasksOf on disk. */
export function openTasksFrom(states: States): Record<string, string> {
  const open = new Map<string, string>();
  for (const id of Object.keys(states).sort()) {
    const s = states[id];
    if ((s?.status === 'claimed' || s?.status === 'in_progress') && typeof s.owner === 'string' && !open.has(s.owner)) open.set(s.owner, id);
  }
  return Object.fromEntries(open);
}

/** The execution this roadmap is about: this project's plan run, or forge's ephemeral one of the checkout (project loose). */
function projectExecution(project: string, f: BandFiles, now: number): ExecutionState | null {
  const e = parseExecution(f.execution, now);
  return e && (e.kind === 'ephemeral' || e.project === project) ? e : null;
}
/** The members of run `runId` (.forge/members/*.json). */
function membersOf(f: BandFiles, runId: string): MemberDoc[] {
  return Object.values(f.members ?? {}).flatMap(text => {
    const m = normalizeMember(json(text));
    return m && m.runId === runId ? [m] : [];
  });
}
/**
 * C3: the role as the band publishes it. runId names the execution only when the role is about it (its coordinator,
 * a member, or another conversation's run), while it is drawn for that role (C2: for its coordinator and members until
 * it is closed, for anyone else STALE_RUN_TTL_MS after it last moved). A role by a binding names no run: a seat's owner
 * beside another's run must not read as its member.
 */
function viewerOf(v: Viewer, exec: ExecutionState | null, now: number): BandViewer {
  const ownsRun = v.role === 'owner' && v.subject === 'execution';
  const runId = exec && v.subject === 'execution' && isVisibleRun(exec, now, ownsRun ? 'owner' : 'none') ? exec.runId : null;
  return { role: v.role, coordinator: v.coordinator, runId };
}
/**
 * What describeViewer reads of forge: the execution, the members of its run, and whether it has no coordinator: its
 * conversation ended or it went silent while not open (B-09, M4), by its own signal and bindings as the hooks read
 * them; the bindings raw, since the band cannot check a pid (M6).
 */
function runInput(exec: ExecutionState | null, f: BandFiles, now: number): Pick<ViewerInput, 'execution' | 'members' | 'coordinatorEnded'> {
  const bindings = Object.values(f.coordinatorBindings ?? {}).flatMap(text => { const b = parseBound(text, now); return b ? [b] : []; });
  return { execution: exec, members: exec ? membersOf(f, exec.runId) : [], coordinatorEnded: coordinatorGone(exec, normalizeLive(json(f.coordinatorLive)), now, { bindings }) };
}
/** The role from the execution alone, with no binding: there is no waypoint project whose seats could be held. */
function forgeViewer(exec: ExecutionState | null, f: BandFiles, now: number): BandViewer {
  return viewerOf(describeViewer({ bound: null, ...runInput(exec, f, now), sessionId: isSafeId(f.sessionId) ? f.sessionId : null, now }), exec, now);
}
/**
 * I2: the role of the conversation that looks at a checkout without a waypoint project (neither a plan nor a design):
 * from forge's execution there, of any kind, and its members, so forge's coordinator of a run in a repository without a
 * roadmap still publishes `{ role: 'owner', coordinator: true, runId }` (C3: lens reads the role only from the band).
 */
export function executionViewer(f: BandFiles): BandViewer {
  const now = f.now ?? Date.now();
  try { return forgeViewer(parseExecution(f.execution, now), f, now); } catch { return { ...NO_VIEWER }; }
}

/**
 * The band of the conversation `f.sessionId` for this project (spec §4.5). Its role (describeViewer over the seats'
 * bindings, the execution, its members and the seats' tasks in progress) picks the band: the coordinator sees the run,
 * whole until it is closed; a member of it, its own task with the run's line (B-06); the owner of a seat, its work band,
 * or the draft it is bound to (K3-13); anyone else, a notice when there is something to say. Every band carries the
 * role as `viewer`.
 */
export function buildBandModel(project: string, f: BandFiles): BandModel {
  const now = f.now ?? Date.now();
  try {
    let plan: Plan | null = null;
    try { if (f.plan !== undefined) plan = parsePlan(f.plan); } catch { plan = null; }
    const exec = projectExecution(project, f, now);
    const seats = seatsOf(f, now);
    const sessionId = isSafeId(f.sessionId) ? f.sessionId : null;
    // The state cache, parsed once for the role and the work band.
    const states = parsed<States[string]>(f.states) as States;
    const v = describeViewer({
      bound: seats.flatMap(s => (s.bound ? [s.bound] : [])),
      ...runInput(exec, f, now),
      sessionId,
      now,
      openTasks: openTasksFrom(states),
    });
    const viewer = viewerOf(v, exec, now);
    // Rule 1: the coordinator's run band, which never needed the plan.
    if (v.coordinator && exec) {
      const r = runModel(project, f, exec, plan, now, viewer);
      if (r) return withAuto(r, f, now);
    }
    // No plan nor design: no waypoint project, nothing drawn, and the role from the execution alone (I2).
    if (f.plan === undefined && f.design === undefined) return noneBand(knownLocale(f), forgeViewer(exec, f, now));
    // A plan that does not read: nothing to work out.
    if (f.plan !== undefined && !plan) return noneBand(knownLocale(f));
    // M1: a conversation whose id the engine could not give owns nothing, and a notice could be about its own seat:
    // nothing is drawn, and its role is still published.
    if (sessionId === null) return noneBand(knownLocale(f), viewer);
    const m = roleBand(project, f, plan, states, v, exec, seats, now, viewer);
    if (m) return withAuto(m, f, now);
    return noneBand(knownLocale(f), viewer);
  } catch { /* any parse failure hides the band */ }
  return noneBand(knownLocale(f));
}

/** The band of anyone but the coordinator: a member's work band, the owner's work or design band, or null. */
function roleBand(project: string, f: BandFiles, plan: Plan | null, states: States, v: Viewer, exec: ExecutionState | null, seats: readonly BandSeat[], now: number, viewer: BandViewer): BandModel | null {
  if (v.role === 'owner' && v.member && exec) {
    // B-06: a member sees its own task with the line of the execution, never the coordinator's run band.
    if (!plan) return null;
    const m = v.member;
    return workModel(project, f, plan, states, { sid: m.sessionId, ...seatInfo(seats, m.sessionId), task: m.task, since: m.since, run: memberLine(project, m, f, exec) }, now, viewer);
  }
  if (v.role === 'owner' && v.binding) {
    const b = v.binding;
    // K3-13: a design is drawn only for the conversation bound to it, and only while it is a draft.
    if (b.via === 'design') return f.design !== undefined ? designModel(project, f, viewer) : null;
    if (!plan) return null;
    return workModel(project, f, plan, states, { sid: b.sid, ...seatInfo(seats, b.sid), task: null, since: null, run: memberRun(project, b.sid, f, exec) }, now, viewer);
  }
  // Another conversation's binding or execution: a notice when there is something to say.
  if (v.role === 'other-live' || v.role === 'previous') return noticeModel(project, f, plan, v, exec, now, viewer);
  return null;
}

/**
 * §4.5: what a conversation that is not the owner sees, dim: another live one bound to the roadmap or to its design, or
 * coordinating a run (other-live), or what an earlier one left behind (previous): a task in progress, a draft, a run
 * stopped or without its coordinator. A previous binding with nothing to take up, and another live one where there is
 * no roadmap (as the start hook says), draw nothing.
 */
function noticeModel(project: string, f: BandFiles, plan: Plan | null, v: Viewer, exec: ExecutionState | null, now: number, viewer: BandViewer): BandModel | null {
  // Declared, so the literal type survives in `base` (an inferred one would widen to string there).
  const kind: 'other-live' | 'previous' = v.role === 'previous' ? 'previous' : 'other-live';
  const base = { mode: 'notice' as const, project, locale: plan?.locale ?? knownLocale(f) ?? 'en', kind, since: v.since, roadmapUrl: plan?.artifacts.roadmap ?? null, viewer };
  const titleOf = (t: string | null): string | null => (t && plan ? plan.tasks.find(x => x.id === t)?.title ?? null : null);
  if (v.subject === 'execution') {
    if (!exec) return null;
    const view = executionView({ exec, tasks: publicTasks(f), live: lives(f), now, role: kind });
    if (!view) return null;
    // Only an active plan run takes members: `forge swarm join` refuses an ephemeral one.
    return { ...base, subject: 'run', seat: null, task: null, title: null, runId: exec.runId, integrated: view.integrated, total: view.total,
      stopReason: exec.active ? null : exec.stopReason, joinable: exec.active && exec.kind === 'plan', key: `run:${exec.runId}` };
  }
  const b = v.binding;
  if (!b) return null;
  if (kind === 'other-live') {
    if (!plan) return null;
    // M3: a conversation bound for the design works the design, not the roadmap.
    if (b.via === 'design') return { ...base, subject: 'design', seat: b.sid, task: null, title: null, runId: null, key: `design:${project}` };
    return { ...base, subject: 'task', seat: b.sid, task: v.task, title: titleOf(v.task), runId: null, key: v.task ? `task:${v.task}` : `seat:${b.sid}` };
  }
  // Something to take up (spec §4.2): the draft of a design binding, else the seat's task in progress.
  if (b.via === 'design') return isDraft(f) ? { ...base, subject: 'design', seat: b.sid, task: null, title: null, runId: null, key: `design:${project}` } : null;
  if (!v.task || !plan) return null;
  return { ...base, subject: 'task', seat: b.sid, task: v.task, title: titleOf(v.task), runId: null, key: `task:${v.task}` };
}

/** Whether the project's design is a draft: a parked or an approved one is not taken up. */
function isDraft(f: BandFiles): boolean {
  try { return f.design !== undefined && parseDesign(f.design).meta.status === 'draft'; } catch { return false; }
}

// forge's automatic decisions of the last day (.forge/decisions.json), on any band that draws.
function withAuto(m: BandModel, f: BandFiles, now: number): BandModel {
  if (m.mode === 'none' || m.mode === 'notice') return m;
  const s = decisionsSummary(f.decisions, now);
  return s ? { ...m, auto: { count: s.count, lastMajor: s.lastMajor } } : m;
}

// The project's language from its plan, else its design, for a band that draws nothing.
function knownLocale(f: BandFiles): string | undefined {
  try { if (f.plan !== undefined) return parsePlan(f.plan).locale; } catch { /* try the design */ }
  try { if (f.design !== undefined) return parseDesign(f.design).meta.locale; } catch { /* none */ }
  return undefined;
}

const MAX_CELLS = 120;
const CELL: Record<string, string> = { done: 'd', in_progress: 'a', claimed: 'a', blocked: 'b', free: 'p', orphaned: 'b' };

const RECENT_DONE = 3;
const SKEW_MS = 2 * 60000;
// The newest done tasks of the track (or plan), with their whole minutes from startedAt (else claimedAt) to doneAt.
// A missing or junk date, a doneAt in the future or one before the start leaves the task out.
function recentDone(tasks: { id: string; estimate_min?: number }[], states: States, now: number): { id: string; minutes: number; estimateMin?: number }[] {
  const out: { id: string; minutes: number; estimateMin?: number; at: number }[] = [];
  for (const t of tasks) {
    const s = states[t.id];
    if (s?.status !== 'done') continue;
    const end = Date.parse(s.doneAt ?? '');
    const start = Date.parse(s.startedAt ?? s.claimedAt ?? '');
    if (!Number.isFinite(end) || !Number.isFinite(start) || end - now > SKEW_MS || end < start) continue;
    out.push({ id: t.id, minutes: Math.floor((end - start) / 60000), ...(t.estimate_min ? { estimateMin: t.estimate_min } : {}), at: end });
  }
  return out.sort((a, b) => b.at - a.at).slice(0, RECENT_DONE).map(({ at: _at, ...r }) => r);
}

/** The seat a work band is drawn for: its id, its track and swarm mark, the task a member works and since when, and
 *  the member's line of its execution. */
interface WorkSeat { sid: string; track: string | null; swarm: boolean; task: string | null; since: string | null; run: { coordinator: string; stage: string } | null }

/** The track and the swarm mark of seat `sid`, from its session.json (the checkout's, or the one of seats/<sid>/). */
function seatInfo(seats: readonly BandSeat[], sid: string): { track: string | null; swarm: boolean } {
  const s = json<{ track?: unknown; launchedBy?: unknown }>(seats.find(x => x.sid === sid)?.session) ?? {};
  return { track: typeof s.track === 'string' ? s.track : null, swarm: typeof s.launchedBy === 'string' && !!s.launchedBy };
}

function workModel(project: string, f: BandFiles, plan: Plan, states: States, seat: WorkSeat, now: number, viewer: BandViewer): BandModel {
  const { sid, track } = seat;
  const messages = parsed<MessageDoc>(f.messages);
  const m = computeMetrics(plan, states, now);
  // A member works the task of its member file; any other seat, the one it has claimed or in progress.
  const own = seat.task
    ? plan.tasks.find(t => t.id === seat.task)
    : plan.tasks.find(t => states[t.id]?.owner === sid && ['claimed', 'in_progress'].includes(states[t.id]?.status ?? ''));
  const byTrack = track ? m.byTrack[track] : undefined;
  // The phase of the seat's task, else the first phase not done.
  const phaseAt = own ? plan.phases.findIndex(p => p.id === own.phase) : -1;
  const pi = phaseAt >= 0 ? phaseAt : plan.phases.findIndex(p => m.byPhase[p.id]?.status !== 'done');
  return {
    mode: 'work', project, locale: plan.locale, sid, track,
    roadmapUrl: plan.artifacts.roadmap ?? null,
    current: own ? { id: own.id, title: own.title, startedAt: states[own.id]?.startedAt ?? seat.since ?? undefined, estimateMin: own.estimate_min } : null,
    trackDone: byTrack?.done ?? m.done, trackTotal: byTrack?.total ?? m.total,
    percent: m.percent,
    inbox: inboxFor(messages, sid).length,
    escalation: Object.values(messages).some(x => x.type === 'escalation' && x.status === 'open' && (x.from === sid || x.to === sid))
      || escalationCandidates(messages).some(c => c.sessions.includes(sid)),
    phase: pi >= 0 ? { index: pi + 1, total: plan.phases.length, name: plan.phases[pi].name } : null,
    cells: plan.tasks.filter(t => !track || t.track === track).slice(0, MAX_CELLS).map(t => CELL[states[t.id]?.status ?? 'free'] ?? 'p').join(''),
    swarm: seat.swarm,
    run: seat.run,
    recentDone: recentDone(plan.tasks.filter(t => !track || t.track === track), states, now),
    viewer,
  };
}

// The execution of this project a seat works for (it owns a public task of the run), else null.
function memberRun(project: string, sid: string, f: BandFiles, exec: ExecutionState | null): { coordinator: string; stage: string } | null {
  if (!exec || !exec.active || exec.project !== project) return null;
  for (const t of Object.values(f.execTasks ?? {})) {
    const p = normalizePublicTask(json(t));
    if (p && p.by === sid && p.runId === exec.runId) return { coordinator: exec.coordinator, stage: p.stage };
  }
  return null;
}

/** B-06: a member's line of its execution: the stage of its public task, else the run's own record of its task. */
function memberLine(project: string, m: MemberDoc, f: BandFiles, exec: ExecutionState): { coordinator: string; stage: string } {
  return memberRun(project, m.sessionId, f, exec)
    ?? { coordinator: exec.coordinator, stage: (m.task ? exec.tasks[m.task]?.stage : undefined) ?? 'execution' };
}

const publicTasks = (f: BandFiles): Record<string, PublicTask> => {
  const out: Record<string, PublicTask> = {};
  for (const [id, t] of Object.entries(f.execTasks ?? {})) { const p = normalizePublicTask(json(t)); if (p && p.task === id) out[id] = p; }
  return out;
};
const lives = (f: BandFiles): LiveDoc[] => Object.values(f.live ?? {}).map(t => normalizeLive(json(t))).filter((d): d is LiveDoc => d !== null);

// Rule 1, the coordinator's band: this project's plan execution or forge's ephemeral one of this checkout, whole until
// it is closed, also once it stopped (C2: isVisibleRun for its owner, without the 24-hour limit).
function runModel(project: string, f: BandFiles, exec: ExecutionState, plan: Plan | null, now: number, viewer: BandViewer): BandModel | null {
  const v = executionView({ exec, tasks: publicTasks(f), live: lives(f), now, role: 'owner' });
  if (!v) return null;
  const rank = { alive: 0, silent: 1, stopped: 2 } as const;
  const worst = [v.coordinator.liveness, ...v.slots.map(s => s.liveness)].reduce((a, b) => (rank[b] > rank[a] ? b : a), 'alive' as 'alive' | 'silent' | 'stopped');
  return {
    mode: 'run', project, locale: plan?.locale ?? 'en', executor: v.mode, running: v.slots.length, parallel: v.parallel, integrated: v.integrated, total: v.total,
    slots: v.slots.slice(0, 2).map(s => ({ task: s.task, stage: s.stage, round: s.round })), worst, stalled: !v.active, roadmapUrl: plan?.artifacts.roadmap ?? null, viewer,
  };
}

function designModel(project: string, f: BandFiles, viewer: BandViewer): BandModel {
  const d = parseDesign(f.design!);
  if (d.meta.status !== 'draft') return noneBand(d.meta.locale, viewer);
  let changelog: ReturnType<typeof parseChangelog> = [];
  try { changelog = parseChangelog(f.changelog ?? null); } catch { changelog = []; }
  const critiques = Object.entries(f.critiques)
    .map(([name, text]) => ({ n: Number(/^critique-r(\d+)\.json$/.exec(name)?.[1] ?? NaN), text }))
    .filter(c => Number.isFinite(c.n))
    .sort((a, b) => b.n - a.n);
  const valid: GateCritique[] = critiques.map(c => {
    try { return { round: c.n, critique: parseCritique(c.text) }; } catch { return { round: c.n, critique: null }; }
  });
  // The highest round with a valid critique; invalid ones are skipped.
  const top = valid.find(c => c.critique !== null);
  const latest = top?.critique ?? null;
  const pending = pendingProposals(changelog, valid, parseDismissed(f.dismissed));
  return {
    mode: 'design', project, locale: d.meta.locale,
    version: changelog.at(-1)?.version ?? 0,
    round: top?.round ?? 0,
    proposals: latest?.proposals.length ?? 0,
    critical: latest?.proposals.filter(p => p.severity === 'critical').length ?? 0,
    pending: pending.length,
    pendingCritical: pending.filter(p => p.severity === 'critical').length,
    designUrl: d.meta.artifact ?? null,
    viewer,
  };
}
