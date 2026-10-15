import { computeMetrics, type Metrics } from '../lib/metrics.js';
import { autoTicks, groupIds, layoutRows, NONE_GROUP, planRange, SPAN, windowAt, windowFor, type GroupBy, type Row, type Win, type Zoom } from '../lib/timeline.js';
import { burndown, criticalPath, forecast, zoneHeat } from '../lib/insights.js';
import { escalationCandidates, liveness, sessionLiveness, zonesOf } from '../lib/coordination.js';
import { LOOSE_STATUSES, TRACK_COLORS, type RunDoc, type EventDoc, type EventType, type InfiniteDoc, type MessageDoc, type MessageType, type MetaDoc, type NoteDoc, type NoteType, type PlanStatus, type PlanView, type SessionDoc, type States, type TaskState, type TaskStatus } from '../lib/types.js';
import { counts, filterNotes, MAX_NOTE, NOTE_TYPES, type NoteFilter } from '../lib/notes.js';
import { buildVersionColumns, type VersionColumn } from '../lib/versions.js';
import { canDecide, MAX_PROPOSAL_TEXT, PROPOSAL_CATEGORIES, PROPOSAL_RISKS, PROPOSAL_STATUSES, type ProposalCategory, type ProposalDoc, type ProposalRisk, type ProposalStatus } from '../lib/proposals.js';
import { dictFor, type Dict } from './i18n.js';
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
  /** forge's infinite run (meta/infinite); the pill shows only while it is active. */
  infinite?: InfiniteDoc | null;
  /** forge's execution (meta/run): the pill and the Execution block in the sessions view. */
  run?: RunDoc | null;
  /** 'user:<id>' of the viewer, or null when unknown. */
  me: string | null;
  /** Display names by opaque user id (from user.profiles). */
  profiles: Record<string, string>;
  readOnly: boolean;
  /** Set when the roadmap refused a proposal write: only the proposals view turns read-only. */
  proposalsReadOnly?: boolean;
  now: number;
  offline: boolean;
  connecting: boolean;
  /** H-04: `?debug=1` lists what the normalizers dropped or coerced (`dropped`, by collection). */
  debug?: boolean;
  dropped?: Record<string, Drop[]>;
}
export type View = 'tracking' | 'versions' | 'sessions' | 'notes' | 'proposals';
export const VIEWS: readonly View[] = ['tracking', 'versions', 'sessions', 'notes', 'proposals'];
export type VFilterKey = 'done' | 'in_progress' | 'blocked' | 'committed' | 'provisional';
export const VFILTER_KEYS: readonly VFilterKey[] = ['done', 'in_progress', 'blocked', 'committed', 'provisional'];
export const NOTE_FILTERS: readonly NoteFilter[] = ['all', 'decision', 'idea', 'debt', 'open', 'mine'];
export interface UiState {
  zoom: Zoom; offset: number; expanded: Set<string>; modal: string | null; search: string; view: View;
  /** Index of the open verification screenshot in the modal's task, or null. */
  shot: number | null;
  /** The timeline window when zoomed or moved freely: its span and its pan from the default anchor, in ms. */
  span?: number; pan?: number;
  /** Timeline status filter (empty: all) and layers drawn over it. */
  statuses?: string[]; layers?: string[];
  /** The scope of the burndown: a version id, a phase id, or empty for the whole plan. */
  burnScope?: string;
  /** Empty arrays = no filter. phaseStatuses filters columns by phase plan status. */
  versionFilter: { statuses: TaskStatus[]; phaseStatuses: PlanStatus[]; track: string | null };
  /** Collapsed version categories, keyed 'phaseId|category'. */
  collapsed: Set<string>;
  noteFilter: NoteFilter;
  timelineGroup: GroupBy;
  draft: { type: NoteType; text: string };
  answering: string | null;
  answerDraft: string;
  notice: 'readonly' | 'failed' | 'answered' | 'decided' | null;
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

const ENT: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, c => ENT[c]);
const mins = (a: number, b: number) => Math.max(0, Math.round((b - a) / 60000));
/** A usable past time in ms: a valid date not more than 2 min ahead of now (clock skew), else null. */
const pastMs = (iso: string | null | undefined, now: number): number | null => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) && t - now <= 2 * 60000 ? t : null;
};
const ICON: Record<EventType, string> = { claimed: '◎', started: '▶', done: '✓', blocked: '⚠', unblocked: '↺', commit: '●', note: '✎', plan_changed: '≡', message: '✉' };
const ZOOMS: Zoom[] = ['6h', '1d', '3d', '1w', '1m'];
const STATUSES = ['free', 'claimed', 'in_progress', 'blocked', 'done', 'orphaned'] as const;
// Values from shared db documents are untrusted: whitelist anything that lands in an attribute or a lookup.
const safeColor = (c: unknown): string => (TRACK_COLORS as readonly string[]).includes(c as string) ? (c as string) : 'blue';
const safeStatus = (s: unknown): TaskStatus => (STATUSES as readonly string[]).includes(s as string) ? (s as TaskStatus) : 'free';
const safeType = (t: unknown): EventType => (Object.prototype.hasOwnProperty.call(ICON, t as string) ? (t as EventType) : 'note');
const MSG_TYPES: readonly MessageType[] = ['overlap_warning', 'handoff_request', 'delegate', 'reply', 'escalation'];
const safeMsgType = (t: unknown): MessageType => (MSG_TYPES as readonly string[]).includes(t as string) ? (t as MessageType) : 'reply';
const safeNote = (t: unknown): NoteType => ((NOTE_TYPES as readonly string[]).includes(t as string) ? (t as NoteType) : 'idea');
const oneOf = <T extends string>(list: readonly T[], v: unknown, dflt: T): T => ((list as readonly string[]).includes(v as string) ? (v as T) : dflt);
const clip = (t: string, n: number): string => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
/** G-01: the kinds of relative text the 30 s tick rewrites in place. */
export type RelKind = 'ago' | 'lasts' | 'hb';
/** The text of a relative time: «hace X» (ago, hb) or «lleva N min» (lasts); for a junk or future time, '—' (hb) or ''. */
export function relText(d: Dict, kind: RelKind, ts: string, now: number): string {
  const t = pastMs(ts, now);
  if (t === null) return kind === 'hb' ? '—' : '';
  return kind === 'lasts' ? d.lasts(mins(t, now)) : d.ago(mins(t, now));
}
/** A relative time the tick can rewrite: its kind and its timestamp travel with it. */
const rel = (d: Dict, kind: RelKind, ts: string, now: number): string =>
  `<span data-rel="${kind}" data-ts="${esc(ts)}">${esc(relText(d, kind, ts, now))}</span>`;

export function renderApp(m: Model, ui: UiState): string {
  const d = dictFor(m.meta?.locale);
  const loc = m.meta?.locale ?? 'en';
  const x = computeMetrics(m.plan, m.states, m.now, Math.max(1, Object.values(m.sessions).filter(s => s.status === 'active').length));
  const navBtn = (view: UiState['view'], icon: string, label: string, badge = 0) =>
    `<button class="nav ${ui.view === view ? 'on' : ''}" data-action="view" data-view="${view}"><b>${icon}</b>${esc(label)}${badge > 0 ? `<span class="badge">${badge}</span>` : ''}</button>`;
  const openProposals = m.proposals.filter(p => canDecide(oneOf(PROPOSAL_STATUSES, p.status, 'done'))).length;
  const body = ui.view === 'sessions'
    ? `${renderHeader(m, d, x, d.sessionsTitle)}
    ${renderSessionsView(m, d)}`
    : ui.view === 'versions'
    ? `${renderHeader(m, d, x, d.versionsTitle)}
    ${renderVersionsView(m, d, ui)}`
    : ui.view === 'notes'
    ? `${renderNotesView(m, d, ui, loc)}`
    : ui.view === 'proposals'
    ? `${renderProposalsView(m, d, ui, loc)}`
    : `${renderHeader(m, d, x)}
    ${renderCards(m, d, x, loc)}
    ${renderLoose(m, d)}
    ${renderSessions(m, d)}
    ${renderTimeline(m, d, ui, loc)}
    ${renderInsights(m, d, ui, loc)}`;
  return `<div class="shell">
  <nav class="side" data-scroll-key="side"><div class="brand">${esc((m.meta?.name ?? '').toUpperCase())}</div>${infinitePill(m, d)}${runPill(m, d)}
    ${navBtn('tracking', '≡', d.nav.tracking)}${navBtn('versions', '▥', d.nav.versions)}${navBtn('sessions', '◎', d.nav.sessions)}${navBtn('notes', '✎', d.nav.notes)}${navBtn('proposals', '◇', d.nav.proposals, openProposals)}
    <div class="scale"><button data-action="scale" data-dir="-1" title="${esc(d.tl.smaller)}" aria-label="${esc(d.tl.smaller)}">A−</button><button data-action="scale" data-dir="1" title="${esc(d.tl.larger)}" aria-label="${esc(d.tl.larger)}">A+</button></div></nav>
  <main class="main">
    ${body}${renderDebug(m)}
  </main>
  ${ui.modal ? renderTaskModal(m, d, ui.modal, loc) : ''}
  ${ui.modal && ui.shot !== null && m.states[ui.modal]?.evidence ? renderLightbox(d, m.states[ui.modal]!.evidence!, ui.shot) : ''}
</div>`;
}

function renderHeader(m: Model, d: Dict, x: Metrics, title = d.title): string {
  const current = m.plan.phases.findIndex(p => x.byPhase[p.id]?.status !== 'done');
  const idx = current === -1 ? m.plan.phases.length : current + 1;
  const lc = m.meta?.metrics?.lastCommit;
  const tests = m.meta?.metrics?.tests;
  return `<header class="hd">
    ${liveLine(m, d)}
    <h1>${esc(title)}${infinitePill(m, d)}${runPill(m, d)}</h1>
    <div class="meta">${esc(m.meta?.name ?? '')} · ${esc(d.version)} <b>${esc(m.meta?.version ?? '')}</b> · ${esc(d.phase)} <b>${idx}</b>/${m.plan.phases.length} · <b>${x.done}</b>/${x.total} ${esc(d.tasks)} · <span title="${esc(d.trackHelp)}"><b>${m.plan.tracks.length}</b> ${esc(d.tracks)}</span>${tests != null ? ` · <b>${num(tests)}</b> ${esc(d.tests)}` : ''}${lc ? ` · ${esc(d.lastCommit)} <b>${esc(lc.sha.slice(0, 7))}</b> ${rel(d, 'ago', lc.ts, m.now)}` : ''}</div>
  </header>`;
}

// «∞ ciclo N[/M]» while forge's infinite run is active; nothing otherwise. meta/infinite.cycle counts the cycles
// done, so N is the cycle in progress (done + 1, never past M), as the lens and the Stop hook show it.
function infinitePill(m: Model, d: Dict): string {
  const inf = m.infinite;
  if (!inf || inf.active !== true) return '';
  const max = typeof inf.budget?.cycles === 'number' && inf.budget.cycles > 0 ? num(inf.budget.cycles) : undefined;
  const current = num(inf.cycle) + 1;
  return ` <span class="pill inf">${esc(d.infinite(max !== undefined ? Math.min(current, max) : current, max))}</span>`;
}

const hhmm = (iso: string | undefined) => { const t = iso ? new Date(iso) : null; return t && Number.isFinite(t.getTime()) ? `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}` : '—'; };

// «▶ ejecución · subagentes N/M» while the run is active; the coordinator's lease adds «sin señal desde» or «parada desde».
function runPill(m: Model, d: Dict): string {
  const r = m.run;
  if (!r || !r.active) return '';
  const coord = m.sessions[r.coordinator];
  const l = coord ? sessionLiveness(coord, m.now) : 'stopped';
  const extra = l === 'silent' ? ` · ${d.run.silentSince(hhmm(coord?.heartbeatAt))}` : l === 'stopped' ? ` · ${d.run.stoppedSince(hhmm(coord?.heartbeatAt))}` : '';
  const pill = r.kind === 'ephemeral' ? d.run.loosePill : d.run.pill;
  return ` <span class="pill run ${l === 'alive' ? '' : l === 'silent' ? 'warn' : 'stopped'}">${esc(pill(d.run.mode[r.mode], r.slots.length, r.parallel) + extra)}</span>`;
}

const liveDot = (l: 'alive' | 'silent' | 'stopped') => `<span class="dot live-${l}">●</span>`;

/** The «coordinadora · subagentes · agent · etapa · 7 min» line of a task with an exec block, with its liveness dot. */
function execLine(m: Model, d: Dict, exec: NonNullable<TaskState['exec']>): string {
  const l = liveness(m.now, exec.leaseUntil);
  const since = pastMs(exec.since, m.now);
  const parts = [d.run.role.coordinator, d.run.mode[exec.mode] ?? exec.mode, exec.agent, d.run.stage[exec.stage] ?? exec.stage];
  return `${liveDot(l)} ${parts.filter(Boolean).map(p => esc(String(p))).join(' · ')}${since !== null ? ` · ${rel(d, 'lasts', exec.since, m.now)}` : ''}`;
}

/** An in-progress task whose executor's lease stopped. */
const isOrphan = (m: Model, st: TaskState | undefined): boolean =>
  !!st?.exec && st.status === 'in_progress' && liveness(m.now, st.exec.leaseUntil) === 'stopped';

function trackTag(m: Model, trackId?: string | null): string {
  const tr = m.plan.tracks.find(t => t.id === trackId);
  return tr ? `<span class="tag c-${safeColor(tr.color)}">${esc(tr.name)}</span>` : '';
}

function fmt(iso: string, loc: string, withDate = true): string {
  const opts: Intl.DateTimeFormatOptions = withDate ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit' };
  try { const t = new Date(iso); return Number.isNaN(t.getTime()) ? '' : t.toLocaleString(loc, opts); } catch { return ''; }
}

function renderCards(m: Model, d: Dict, x: Metrics, loc: string): string {
  const running = x.inProgress.map(id => m.plan.tasks.find(t => t.id === id)!).filter(Boolean);
  let now = `<div class="lbl">${esc(d.nowRunning)} (${running.length})</div>`;
  if (!running.length) {
    now += `<div class="muted">${esc(d.nothingRunning)}</div>`;
  } else {
    const MAX_RUNNING = 5;
    now += `<div class="runs" data-scroll-key="runs">${running.slice(0, MAX_RUNNING).map(t => {
      const s = m.states[t.id]!;
      const start = Date.parse(s.startedAt ?? s.claimedAt ?? new Date(m.now).toISOString());
      const el = mins(start, m.now);
      const pct = t.estimate_min ? Math.min(100, (el / t.estimate_min) * 100) : 0;
      const over = !!t.estimate_min && el > t.estimate_min;
      const ph = m.plan.phases.find(p => p.id === t.phase);
      const orphan = isOrphan(m, s);
      return `<div class="run${orphan ? ' orphan' : ''}" data-action="open-task" data-id="${esc(t.id)}">
        <div class="t"><em>${esc(t.id)}</em> ${esc(t.title)}${orphan ? ` <span class="pill orphan">${esc(d.run.orphan)}</span>` : ''}${eviMark(m, d, t.id)}</div>
        <div class="mono">${trackTag(m, t.track)} ${esc(ph?.name)} · ${esc(d.elapsed(el, t.estimate_min))}${s.owner ? ` · <span class="k">${esc(s.owner)}</span>` : ''}</div>
        ${s.exec ? `<div class="mono exec">${execLine(m, d, s.exec)}</div>` : ''}
        <div class="bar${over ? ' over' : ''}"><i style="width:${pct.toFixed(1)}%"></i></div></div>`;
    }).join('')}</div>${running.length > MAX_RUNNING ? `<div class="mono">${esc(d.more(running.length - MAX_RUNNING))}</div>` : ''}`;
  }
  const prog = `<div class="lbl">${esc(d.version)} ${esc(m.meta?.version ?? '')}</div>
    <div class="big">${x.percent} %</div>
    <div class="mono">${x.done} ${esc(d.of)} ${x.total} ${esc(d.tasks)}</div>
    <div class="bar c"><i style="width:${x.percent}%"></i></div>
    <dl class="kv">
      <dt>${esc(d.phasesDone)}</dt><dd>${x.phasesDone} ${esc(d.of)} ${x.phaseCount}</dd>
      <dt>${esc(d.eta)}</dt><dd>${x.etaIso ? esc(fmt(x.etaIso, loc)) : '—'}</dd>
      <dt>${esc(d.pace)}</dt><dd>${x.paceMin != null ? `${x.paceMin} ${esc(d.minPerTask)}` : '—'}</dd>
      <dt>${esc(d.devSince)}</dt><dd>${x.startedAt ? esc(fmt(x.startedAt, loc)) : '—'}</dd>
    </dl>`;
  type Feed = { ts: string; html: string };
  const feed: Feed[] = [
    ...m.events.map(e => ({ ts: e.ts, html: `<li${e.taskId ? ` data-action="open-task" data-id="${esc(e.taskId)}"` : ''}>
      <span class="mono">${esc(fmt(e.ts, loc, false))}</span> <span class="ev ev-${safeType(e.type)}">${ICON[safeType(e.type)]}</span>
      ${e.taskId ? `<b>${esc(e.taskId)}</b> ` : ''}${esc(e.text ?? d.eventText[safeType(e.type)])}
      ${e.add != null ? `<span class="ok">+${num(e.add)}</span> <span class="del">−${num(e.del)}</span>` : ''}</li>` })),
    ...m.messages.map(g => ({ ts: g.ts, html: `<li class="ev-message">
      <span class="mono">${esc(fmt(g.ts, loc, false))}</span> <span class="ev ev-message">${ICON.message}</span>
      ${esc(g.from)} → ${esc(g.to)}: ${esc(g.text)}</li>` })),
    ...m.notes.map(n => ({ ts: n.ts, html: `<li class="ev-notefeed"${n.taskId ? ` data-action="open-task" data-id="${esc(n.taskId)}"` : ''}>
      <span class="mono">${esc(fmt(n.ts, loc, false))}</span> <span class="ev ev-note">✎</span>
      <b class="nt-${safeNote(n.type)}">${esc(d.noteType[safeNote(n.type)])}</b> ${esc(clip(n.text, 80))}</li>` })),
  ].sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
  const evs = feed.slice(0, 14).map(f => f.html).join('');
  return `<section class="row3">
    <div class="card">${now}</div>
    <div class="card">${prog}</div>
    <div class="card"><div class="lbl">${esc(d.recent)}</div>${evs ? `<ul class="events" data-scroll-key="events">${evs}</ul>` : `<div class="muted">${esc(d.noEvents)}</div>`}</div>
  </section>`;
}

// Sessions involved in an unresolved disagreement: escalation candidates or open escalation messages.
function escalatedSessions(m: Model): Set<string> {
  const out = new Set<string>();
  const byId = Object.fromEntries(m.messages.map(x => [x.id, x]));
  for (const c of escalationCandidates(byId)) c.sessions.forEach(s => out.add(s));
  for (const g of m.messages) if (g.type === 'escalation' && g.status === 'open') { out.add(g.from); out.add(g.to); }
  return out;
}

function renderSessions(m: Model, d: Dict): string {
  const list = Object.entries(m.sessions);
  if (!list.length) return '';
  const esca = escalatedSessions(m);
  return `<section class="sess">${list.map(([sid, s]) => {
    const idle = sessionLiveness(s, m.now) === 'stopped';
    const warn = esca.has(sid);
    return `<div class="s ${idle ? 'idle' : ''} ${warn ? 'warn' : ''}"><div class="n">${warn ? '⚠' : '<span class="dot">●</span>'} ${esc(s.name)} ${trackTag(m, s.track)}</div>
      <div class="mono">${esc(s.currentTask ?? '—')} · ${esc(d.heartbeat)} ${rel(d, 'hb', s.heartbeatAt, m.now)}</div></div>`;
  }).join('')}</section>`;
}

const MSG_COLOR: Record<MessageType, string> = { overlap_warning: 'mauve', handoff_request: 'peach', delegate: 'teal', reply: 'blue', escalation: 'yellow' };

function renderRunBlock(m: Model, d: Dict): string {
  const r = m.run;
  if (!r || !r.active) return '';
  const coord = m.sessions[r.coordinator];
  const slot = (s: RunDoc['slots'][number]) => {
    // A loose id is not a plan id: an ephemeral run never takes a title or a lease from the plan, even on a clash.
    const ephemeral = r.kind === 'ephemeral';
    const task = ephemeral ? undefined : m.plan.tasks.find(t => t.id === s.task);
    const ex = ephemeral ? undefined : m.states[s.task]?.exec;
    const l = ex ? liveness(m.now, ex.leaseUntil) : coord ? sessionLiveness(coord, m.now) : 'stopped';
    const since = pastMs(s.since, m.now);
    const title = task?.title ?? r.loose.find(x => x.id === s.task)?.title ?? '';
    return `<div class="sc slot"><h3>${liveDot(l)} <span class="pe">${esc(s.task)}</span> ${esc(title)}</h3>
      <div class="mono">${esc(d.run.stage[s.stage] ?? s.stage)}${s.agent ? ` · ${esc(s.agent)}` : ''}${since !== null ? ` · ${rel(d, 'lasts', s.since, m.now)}` : ''}</div></div>`;
  };
  const free = Math.max(0, r.parallel - r.slots.length);
  const head = r.kind === 'ephemeral'
    ? `${esc(d.run.loosePill(d.run.mode[r.mode], r.slots.length, r.parallel))} · ${esc(d.run.coordinator)}: ${esc(r.coordinator)}`
    : `${esc(d.run.title)} · ${esc(d.run.mode[r.mode])} · ${esc(d.run.slots(r.slots.length, r.parallel))} · ${esc(d.run.coordinator)}: ${esc(r.coordinator)}`;
  return `<section class="run"><div class="lbl">${head}</div>
    <div class="sgrid">${r.slots.map(slot).join('')}${Array.from({ length: free }, () => `<div class="sc slot free"><h3>${esc(d.run.free)}</h3></div>`).join('')}</div></section>`;
}

/** The loose tasks of an active ephemeral run (spec §4.4). They are not plan tasks: no progress, filters, timeline or orphans. */
function renderLoose(m: Model, d: Dict): string {
  const r = m.run;
  if (!r || !r.active || r.kind !== 'ephemeral' || !r.loose.length) return '';
  // A loose task has no state/T.exec: its dot is the coordinator's liveness, as a slot without one.
  const coord = m.sessions[r.coordinator];
  const l = coord ? sessionLiveness(coord, m.now) : 'stopped';
  const rows = r.loose.map(t => {
    const status = oneOf(LOOSE_STATUSES, t.status, 'queued');
    const finished = status === 'integrated' || status === 'conflict' || status === 'blocked';
    const parts = [d.run.looseStatus[status], t.stage ? d.run.stage[t.stage] ?? t.stage : null, t.agent, finished && t.seconds !== undefined ? (t.seconds < 60 ? d.tookUnderMin : d.took(Math.floor(t.seconds / 60))) : null];
    return `<li class="lt st-${status}">${liveDot(l)} <span class="k">${esc(t.id)}</span> <span class="lab">${esc(t.title)}</span> <span class="mono">${parts.filter(Boolean).map(p => esc(String(p))).join(' · ')}</span></li>`;
  }).join('');
  return `<section class="loose card"><div class="lbl">${esc(d.run.looseTitle)} (${r.loose.length})</div><ul class="lts">${rows}</ul></section>`;
}

function renderSessionsView(m: Model, d: Dict): string {
  const x = computeMetrics(m.plan, m.states, m.now, 1);
  const esca = escalatedSessions(m);
  const list = Object.entries(m.sessions);
  const cards = list.map(([sid, s]) => {
    const task = m.plan.tasks.find(t => t.id === s.currentTask);
    const zones = task ? [...new Set(zonesOf(task, m.states[task.id]))] : [];
    const prog = s.track ? x.byTrack[s.track] : undefined;
    const pct = prog && prog.total ? Math.round((num(prog.done) / prog.total) * 100) : 0;
    const live = sessionLiveness(s, m.now);
    const idle = live === 'stopped';
    const hb = idle ? esc(d.run.lastSignal(hhmm(s.heartbeatAt))) : live === 'silent' ? esc(d.run.silentSince(hhmm(s.heartbeatAt))) : rel(d, 'hb', s.heartbeatAt, m.now);
    const warn = esca.has(sid);
    const msgs = m.messages.filter(g => g.from === sid || g.to === sid).slice(0, 6);
    const thread = msgs.length ? `<div class="thread"><div class="lbl ${warn ? 'ye' : ''}">${esc(warn ? d.needsDecision : d.threads)}</div>${msgs.map(g => {
      const t = safeMsgType(g.type);
      return `<div class="msg c-${MSG_COLOR[t]}"><span class="who">${esc(g.from)} → ${esc(g.to)} · ${esc(d.msgType[t])}</span>${esc(g.text)}</div>`;
    }).join('')}</div>` : warn ? `<div class="thread"><div class="lbl ye">${esc(d.needsDecision)}</div></div>` : '';
    return `<div class="sc ${warn ? 'warn' : ''} ${idle ? 'idle' : ''}">
      <h3>${warn ? '⚠' : '<span class="dot">●</span>'} ${esc(s.name)} ${s.role ? `<span class="tag">${esc(d.run.role[s.role])}</span>` : ''} ${trackTag(m, s.track)}</h3>
      <dl class="kv">
        <dt>${esc(d.field.task)}</dt><dd>${task ? `<span class="pe">${esc(task.id)}</span> ${esc(task.title)}` : esc(s.currentTask ?? '—')}</dd>
        <dt>${esc(d.field.branch)}</dt><dd>${esc(s.branch ?? '—')}</dd>
        <dt>${esc(d.field.agent)}</dt><dd>${esc(s.agentName ?? '—')}</dd>
        <dt>${esc(d.heartbeat)}</dt><dd>${hb}</dd>
        <dt>${esc(d.field.zones)}</dt><dd>${zones.length ? zones.map(esc).join(' · ') : '—'}</dd>
      </dl>
      ${prog ? `<div class="bar c"><i style="width:${pct}%"></i></div><div class="mono">${num(prog.done)}/${num(prog.total)}</div>` : ''}
      ${thread}
    </div>`;
  }).join('');
  return `<section class="sessions-view">${renderRunBlock(m, d)}${cards ? `<div class="sgrid">${cards}</div>` : `<div class="muted">${esc(d.noSessions)}</div>`}</section>`;
}

/** The timeline window: free zoom and pan when set, else the zoom preset shifted by whole spans. */
export function timelineWindow(ui: UiState, now: number): Win {
  return ui.span ? windowAt(ui.span, now, ui.pan ?? 0) : windowFor(ui.zoom, now, ui.offset);
}

const GROUPS: readonly GroupBy[] = ['phase', 'track', 'session', 'category'];
export const TL_STATUSES = ['in_progress', 'blocked', 'free', 'done'] as const;
export const TL_LAYERS = ['critical', 'forecast', 'forge'] as const;

/** The timeline rows as drawn: grouping, open groups (all of them while searching), status filter and search. */
function timelineRows(m: Model, d: Dict, ui: UiState, win: Win): { rows: Row[]; groupBy: GroupBy; expanded: Set<string> } {
  const q = ui.search.trim().toLowerCase();
  const groupBy: GroupBy = GROUPS.includes(ui.timelineGroup) ? ui.timelineGroup : 'phase';
  const expanded = q ? new Set(groupIds(m.plan, m.states, groupBy)) : ui.expanded;
  // 'in_progress' in the filter also covers claimed tasks.
  const statuses = ui.statuses?.length ? ui.statuses.flatMap(x => (x === 'in_progress' ? ['in_progress', 'claimed'] : x === 'blocked' ? ['blocked', 'orphaned'] : [x])) : undefined;
  const rows = layoutRows(m.plan, m.states, m.now, win, expanded, { groupBy, statuses, unassigned: d.tl.unassigned, uncategorized: d.tl.uncategorized })
    .filter(r => !q || r.kind === 'phase' || r.label.toLowerCase().includes(q) || r.id.toLowerCase().includes(q));
  return { rows, groupBy, expanded };
}

function groupLabel(m: Model, groupBy: GroupBy, r: Row): string {
  if (groupBy === 'track') return trackTag(m, r.id);
  if (groupBy === 'session' && r.id !== NONE_GROUP) return `◎ ${esc(r.label)}`;
  return esc(r.label);
}

function forgeBadge(m: Model, id: string): string {
  const f = m.states[id]?.forge;
  if (!f) return '';
  const v = f.verdict;
  const score = v && typeof v.score === 'number' ? v.score.toFixed(2) : null;
  const cls = v?.action === 'accept' ? 'ok' : v?.action === 'redo' ? 'del' : 'warn';
  return ` <span class="fg ${v ? cls : ''}">⚒ ${esc([v?.action, score].filter(Boolean).join(' ') || f.phase)}${typeof f.round === 'number' ? ` · r${f.round}${typeof f.cap === 'number' ? `/${f.cap}` : ''}` : ''}</span>`;
}

function renderTimeline(m: Model, d: Dict, ui: UiState, loc: string): string {
  const win = timelineWindow(ui, m.now);
  const { rows, groupBy, expanded } = timelineRows(m, d, ui, win);
  const pos = (t: number) => ((t - win.from) / (win.to - win.from)) * 100;
  const nowLeft = pos(m.now);
  const span = win.to - win.from;
  const withDate = span > 30 * 3600000;
  const preset = ZOOMS.find(z => (ui.span ? Math.abs(SPAN[z] - ui.span) < 1 : z === ui.zoom));
  const tz = new Date(m.now).getTimezoneOffset();
  const layers = new Set(ui.layers ?? []);
  const filter = new Set(ui.statuses ?? []);
  const crit = layers.has('critical') ? new Set(criticalPath(m.plan, m.states, m.now).ids) : new Set<string>();
  const ids = groupIds(m.plan, m.states, groupBy);
  const allOpen = ids.every(id => expanded.has(id));
  const st = (r: { status?: string }) => (r.status && Object.hasOwn(d.status, r.status) ? r.status as TaskStatus : 'free');
  const deps = (id: string) => m.plan.tasks.find(t => t.id === id)?.depends_on ?? [];
  const left = rows.map(r => {
    if (r.kind === 'phase') {
      const pct = r.total ? Math.round(((r.done ?? 0) / r.total) * 100) : 0;
      return `<div class="tr ph" data-action="toggle-phase" data-id="${esc(r.id)}" title="${esc(r.label)} · ${esc(r.counter)}"><span class="chev">${expanded.has(r.id) ? '⌄' : '›'}</span> <span class="lab">${groupLabel(m, groupBy, r)}</span><span class="mini"><i style="width:${pct}%"></i></span><span class="c">${esc(r.counter)}</span></div>`;
    }
    const s = st(r);
    return `<div class="tr tk${crit.has(r.id) ? ' crit' : ''}" data-action="open-task" data-id="${esc(r.id)}" data-task="${esc(r.id)}" data-deps="${esc(deps(r.id).join(' '))}" title="${esc(r.id)} · ${esc(r.label)} · ${esc(d.status[s])}"><i class="sd st-${s}"></i><span class="k">${esc(r.id)}</span> <span class="lab">${esc(r.label)}</span>${eviMark(m, d, r.id)} ${groupBy === 'track' ? '' : trackTag(m, r.trackId)}</div>`;
  }).join('');
  const kindLabel = (k: string) => (k === 'estimate' ? d.legend.estimate : k === 'done' ? d.legend.done : k === 'blocked' ? d.legend.blocked : d.legend.current);
  const right = rows.map(r => {
    const task = r.kind === 'task';
    const bars = r.bars.map(b => `<div class="gb ${b.kind}${task && crit.has(r.id) ? ' crit' : ''}" style="left:${b.left}%;width:${b.width}%" title="${esc(task ? `${r.id} · ${r.label}` : r.label)} · ${esc(kindLabel(b.kind))}${r.durationMin != null ? ` · ${r.durationMin} min` : ''}"${task ? ` data-action="open-task" data-id="${esc(r.id)}" data-task="${esc(r.id)}"` : ''}></div>`).join('');
    const label = task && r.bars[0] && (r.bars[0].kind !== 'estimate' || layers.has('forge'))
      ? `<div class="gl" style="left:${Math.min(r.bars[0].left + r.bars[0].width + 0.6, 80)}%">${r.bars[0].kind !== 'estimate' ? `${esc(r.label)}${r.durationMin != null ? ` · ${r.durationMin} min` : ''}` : ''}${layers.has('forge') ? forgeBadge(m, r.id) : ''}</div>` : '';
    return `<div class="rr${r.kind === 'phase' ? ' ph' : ''}"${task ? ` data-task="${esc(r.id)}"` : ''}>${bars}${label}</div>`;
  }).join('');
  const tickList = autoTicks(win, 10, tz);
  const tickHtml = tickList.map(t => `<span style="left:${pos(t)}%">${esc(fmt(new Date(t).toISOString(), loc, withDate))}</span>`).join('');
  const grid = tickList.map(t => `<i style="left:${pos(t)}%"></i>`).join('');
  let band = '';
  if (layers.has('forecast')) {
    const sessions = Math.max(1, Object.values(m.sessions).filter(x => x.status === 'active').length);
    const x = computeMetrics(m.plan, m.states, m.now, sessions);
    const f = forecast(m.plan, m.states, m.now, { sessions, paceMin: x.paceMin });
    if (f) {
      const a = Math.max(0, Math.min(100, pos(f.from)));
      const b = Math.max(0, Math.min(100, pos(f.to)));
      if (b > 0 && a < 100) band = `<div class="fc" style="left:${a}%;width:${Math.max(0.4, b - a)}%" title="${esc(d.insights.forecastRange(fmt(new Date(f.from).toISOString(), loc), fmt(new Date(f.to).toISOString(), loc)))}"><span>${esc(d.tl.forecastEnd)}</span></div>`;
    }
  }
  const chip = (kind: 'status' | 'layer', key: string, label: string, on: boolean) =>
    `<button class="chipb${on ? ' on' : ''}" data-action="tl-${kind}" data-key="${esc(key)}" aria-pressed="${on}">${esc(label)}</button>`;
  const statusLabel = (k: string) => (k === 'in_progress' ? d.legend.current : k === 'blocked' ? d.legend.blocked : k === 'done' ? d.legend.done : d.tl.pending);
  const layerLabel = (k: string) => (k === 'critical' ? d.tl.critical : k === 'forecast' ? d.tl.forecast : d.tl.forge);
  const groupName = (g: GroupBy) => (g === 'phase' ? d.byPhase : g === 'track' ? d.byTrack : g === 'session' ? d.tl.bySession : d.tl.byCategory);
  return `<section class="timeline">
    <div class="tabs">
      ${GROUPS.map(g => `<button class="tab ${groupBy === g ? 'on' : ''}" data-action="tgroup" data-group="${g}"${g === 'track' ? ` title="${esc(d.trackHelp)}"` : ''}>${esc(groupName(g))}</button>`).join('')}
      <button class="tab" data-action="tl-all" data-open="${allOpen ? '0' : '1'}">${esc(allOpen ? d.tl.collapse : d.tl.expand)}</button>
      <input class="search" data-role="search" placeholder="${esc(d.search)}" value="${esc(ui.search)}">
    </div>
    <div class="tools">
      <div class="chips" data-scroll-key="chips:status"><span class="lbl">${esc(d.tl.show)}</span>${TL_STATUSES.map(k => chip('status', k, statusLabel(k), filter.has(k))).join('')}</div>
      <div class="chips" data-scroll-key="chips:layers"><span class="lbl">${esc(d.tl.layers)}</span>${TL_LAYERS.map(k => chip('layer', k, layerLabel(k), layers.has(k))).join('')}</div>
      <div class="zoom" data-scroll-key="zoom">${ZOOMS.map(z => `<button data-action="zoom" data-zoom="${z}" class="${z === preset ? 'on' : ''}">${esc(d.zoom[z])}</button>`).join('')}
        <button data-action="fit">${esc(d.tl.fit)}</button>
        <button data-action="shift" data-dir="-1" aria-label="‹">‹</button><button data-action="shift" data-dir="0">${esc(d.now)}</button><button data-action="shift" data-dir="1" aria-label="›">›</button>
        <button data-action="export" data-format="svg" class="xp" title="${esc(d.tl.export)} SVG">⤓ SVG</button><button data-action="export" data-format="png" class="xp" title="${esc(d.tl.export)} PNG">⤓ PNG</button></div>
    </div>
    <div class="tlw" data-role="timeline" data-scroll-key="timeline" tabindex="0" aria-label="${esc(d.tl.hint)}">
    <div class="tl">
      <div class="l"><div class="tr axis"></div>${left}</div>
      <div class="r" data-role="tl-canvas"><div class="ticks">${tickHtml}</div><div class="grid">${grid}</div>${band}${right}
        ${nowLeft >= 0 && nowLeft <= 100 ? `<div class="now" style="left:${nowLeft}%"><span>${esc(d.now)}</span></div>` : ''}
        <svg class="arrows" data-role="tl-arrows" aria-hidden="true"></svg></div>
    </div>
    </div>
    ${renderMinimap(m, d, win)}
    <div class="legend">${(['done', 'current', 'blocked', 'estimate'] as const).map(k => `<span><i class="lg ${k}"></i>${esc(d.legend[k])}</span>`).join('')}<span><i class="lg nowl"></i>${esc(d.legend.now)}</span>${layers.has('critical') ? `<span><i class="lg critl"></i>${esc(d.tl.critical)}</span>` : ''}${layers.has('forecast') ? `<span><i class="lg fcl"></i>${esc(d.tl.forecastEnd)}</span>` : ''}<span class="hint">${esc(d.tl.hint)}</span></div>
    <div class="tlnote" data-role="tl-note" aria-live="polite"></div>
  </section>`;
}

/** The minimap: every task of the plan, compressed over its whole time range, with the visible window marked. */
function renderMinimap(m: Model, d: Dict, win: Win): string {
  const range = planRange(m.plan, m.states, m.now);
  const from = Math.min(range.from, win.from);
  const to = Math.max(range.to, win.to);
  const all = layoutRows(m.plan, m.states, m.now, { from, to }, new Set(m.plan.phases.map(p => p.id))).filter(r => r.kind === 'task');
  if (!all.length) return '';
  const rowH = Math.max(2, Math.min(5, Math.floor(44 / all.length)));
  const h = all.length * rowH + 4;
  const bars = all.map((r, i) => r.bars.map(b => `<rect class="mb ${b.kind}" x="${b.left * 10}" y="${2 + i * rowH}" width="${Math.max(2, b.width * 10)}" height="${Math.max(1, rowH - 1)}" rx="1"/>`).join('')).join('');
  const vx = ((win.from - from) / (to - from)) * 1000;
  const vw = ((win.to - win.from) / (to - from)) * 1000;
  const nx = ((m.now - from) / (to - from)) * 1000;
  return `<div class="mm" data-role="minimap" data-from="${from}" data-to="${to}" title="${esc(d.tl.minimap)}">
    <svg viewBox="0 0 1000 ${h}" preserveAspectRatio="none" aria-label="${esc(d.tl.minimap)}">${bars}
      <line class="mnow" x1="${nx}" x2="${nx}" y1="0" y2="${h}"/>
      <rect class="mv" x="${vx}" y="0.5" width="${Math.max(4, vw)}" height="${h - 1}" rx="3"/></svg></div>`;
}

/** The analysis row under the timeline: burndown, critical path with the forecast end, and the code zones. */
function renderInsights(m: Model, d: Dict, ui: UiState, loc: string): string {
  const sessions = Math.max(1, Object.values(m.sessions).filter(x => x.status === 'active').length);
  const x = computeMetrics(m.plan, m.states, m.now, sessions);
  const f = forecast(m.plan, m.states, m.now, { sessions, paceMin: x.paceMin });
  // Scope: a version, a phase, or the whole plan.
  const scopes = [
    { id: '', label: d.insights.wholePlan, ids: m.plan.tasks.map(t => t.id) },
    ...m.plan.versions.map(v => ({ id: `v:${v.id}`, label: `${d.version} ${v.id}`, ids: m.plan.tasks.filter(t => v.phases.includes(t.phase)).map(t => t.id) })),
    ...m.plan.phases.map(p => ({ id: `p:${p.id}`, label: `${p.id} · ${p.name}`, ids: m.plan.tasks.filter(t => t.phase === p.id).map(t => t.id) })),
  ];
  const scope = scopes.find(sc => sc.id === (ui.burnScope ?? '')) ?? scopes[0];
  const bd = burndown(m.plan, m.states, scope.ids, m.now, f?.to ?? null);
  const W = 520;
  const H = 150;
  let chart = `<div class="muted">${esc(d.insights.allDone)}</div>`;
  if (bd) {
    const px = (t: number) => 34 + ((t - bd.start) / Math.max(1, bd.end - bd.start)) * (W - 44);
    const py = (left: number) => 10 + (1 - left / Math.max(1, bd.total)) * (H - 34);
    const steps = bd.actual.map((p, i) => (i === 0 ? `M${px(p.t).toFixed(1)} ${py(p.left).toFixed(1)}` : `H${px(p.t).toFixed(1)} V${py(p.left).toFixed(1)}`)).join(' ');
    const yTicks = [...new Set([0, Math.round(bd.total / 2), bd.total])];
    chart = `<svg class="bd" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(d.insights.burndown)}">
      ${yTicks.map(v => `<line class="bdg" x1="34" x2="${W - 10}" y1="${py(v)}" y2="${py(v)}"/><text class="bdt" x="28" y="${py(v) + 4}" text-anchor="end">${v}</text>`).join('')}
      <line class="bdi" x1="${px(bd.ideal[0].t)}" y1="${py(bd.ideal[0].left)}" x2="${px(bd.ideal[1].t)}" y2="${py(0)}"/>
      <path class="bda" d="${steps}"/>
      <line class="bdn" x1="${px(m.now)}" x2="${px(m.now)}" y1="8" y2="${H - 22}"/>
      <text class="bdt" x="34" y="${H - 6}">${esc(fmt(new Date(bd.start).toISOString(), loc))}</text>
      <text class="bdt" x="${W - 10}" y="${H - 6}" text-anchor="end">${esc(fmt(new Date(bd.end).toISOString(), loc))}</text></svg>
      <div class="legend"><span><i class="lg bdl-a"></i>${esc(d.insights.actual)}</span><span><i class="lg bdl-i"></i>${esc(d.insights.ideal)}</span><span class="mono">${bd.actual.at(-1)!.left} ${esc(d.insights.tasksLeft)}</span></div>`;
  }
  const scopeSel = `<select data-action="burn-scope" aria-label="${esc(d.insights.scope)}">${scopes.map(sc => `<option value="${esc(sc.id)}"${sc.id === scope.id ? ' selected' : ''}>${esc(sc.label)}</option>`).join('')}</select>`;
  const cp = criticalPath(m.plan, m.states, m.now);
  const chain = cp.ids.length
    ? `<div class="mono">${esc(d.insights.chain(cp.ids.length, cp.minutes))}</div><ol class="chain" data-scroll-key="chain">${cp.ids.map(id => {
        const t = m.plan.tasks.find(x => x.id === id);
        const raw = m.states[id]?.status ?? 'free';
        const s = Object.hasOwn(d.status, raw) ? raw : 'free';
        return `<li data-action="open-task" data-id="${esc(id)}"><i class="sd st-${s}"></i><span class="k">${esc(id)}</span> ${esc(t?.title ?? '')}</li>`;
      }).join('')}</ol>`
    : `<div class="muted">${esc(d.insights.allDone)}</div>`;
  const fc = f ? `<div class="fct">${esc(d.insights.forecastRange(fmt(new Date(f.from).toISOString(), loc), fmt(new Date(f.to).toISOString(), loc)))}</div>` : '';
  const heat = zoneHeat(m.plan, m.states).slice(0, 12);
  const maxHeat = Math.max(1, ...heat.map(z => z.tasks + z.touched));
  const zones = heat.length
    ? `<ul class="zones" data-scroll-key="zones">${heat.map(z => `<li><div class="zn"><span class="mono">${esc(z.zone)}</span><span class="k">${esc(d.insights.zoneLine(z.tasks, z.done, z.active))}${z.touched ? ` · ${esc(d.insights.touched(z.touched))}` : ''}</span></div>
        <div class="zb"><i class="zd" style="width:${(z.done / maxHeat) * 100}%"></i><i class="za" style="width:${(z.active / maxHeat) * 100}%"></i><i class="zp" style="width:${(Math.max(0, z.tasks - z.done - z.active) / maxHeat) * 100}%"></i><i class="zt" style="width:${(z.touched / maxHeat) * 100}%"></i></div></li>`).join('')}</ul>`
    : `<div class="muted">${esc(d.insights.noZones)}</div>`;
  return `<section class="insights">
    <h2 class="lbl">${esc(d.insights.title)}</h2>
    <div class="row3 ins">
      <div class="card"><div class="ch"><span class="lbl">${esc(d.insights.burndown)}</span>${scopeSel}</div>${chart}</div>
      <div class="card"><div class="lbl">${esc(d.insights.critical)}</div>${fc}${chain}</div>
      <div class="card"><div class="lbl">${esc(d.insights.zones)}</div>${zones}</div>
    </div>
  </section>`;
}

/**
 * The timeline as a standalone SVG for export: the visible window, every row as drawn, the ticks and now. Fonts and
 * colours are written in, so the file reads the same anywhere.
 */
export function timelineSvg(m: Model, ui: UiState): string {
  const d = dictFor(m.meta?.locale);
  const loc = m.meta?.locale ?? 'en';
  const win = timelineWindow(ui, m.now);
  const { rows, groupBy } = timelineRows(m, d, ui, win);
  const W = 1600;
  const LW = 360;
  const RH = 28;
  const TOP = 64;
  const H = TOP + rows.length * RH + 40;
  const cw = W - LW - 20;
  const xOf = (pct: number) => LW + (pct / 100) * cw;
  const pos = (t: number) => ((t - win.from) / (win.to - win.from)) * 100;
  const C = { base: '#1e1e2e', mantle: '#181825', s0: '#313244', s2: '#585b70', text: '#cdd6f4', sub: '#a6adc8', done: '#74c7ec', cur: '#fab387', blk: '#f9e2af', now: '#f38ba8', lav: '#b4befe' };
  const fill: Record<string, string> = { done: C.done, current: C.cur, blocked: C.blk, estimate: 'none' };
  const withDate = win.to - win.from > 30 * 3600000;
  const ticks = autoTicks(win, 12, new Date(m.now).getTimezoneOffset()).map(t => {
    const x = xOf(pos(t));
    return `<line x1="${x}" x2="${x}" y1="${TOP - 6}" y2="${H - 30}" stroke="${C.s0}"/><text x="${x}" y="${TOP - 12}" fill="${C.sub}" font-size="12" text-anchor="middle">${esc(fmt(new Date(t).toISOString(), loc, withDate))}</text>`;
  }).join('');
  const body = rows.map((r, i) => {
    const y = TOP + i * RH;
    const bg = r.kind === 'phase' ? `<rect x="0" y="${y}" width="${W}" height="${RH}" fill="${C.s0}" fill-opacity=".35"/>` : '';
    const label = r.kind === 'phase'
      ? `<text x="14" y="${y + 18}" fill="${C.text}" font-size="14" font-weight="700">${esc(groupBy === 'track' ? `${m.plan.tracks.find(t => t.id === r.id)?.name ?? r.label}` : r.label)} · ${esc(r.counter)}</text>`
      : `<text x="30" y="${y + 18}" fill="${C.sub}" font-size="13"><tspan fill="${C.s2}">${esc(r.id)}</tspan> ${esc(r.label.length > 34 ? `${r.label.slice(0, 33)}…` : r.label)}</text>`;
    const bars = r.bars.map(b => `<rect x="${xOf(b.left)}" y="${y + 8}" width="${Math.max(2, (b.width / 100) * cw)}" height="12" rx="6" fill="${fill[b.kind]}"${b.kind === 'estimate' ? ` stroke="${C.s2}" stroke-dasharray="4 3"` : ''}/>`).join('');
    return `${bg}${label}${bars}`;
  }).join('');
  const nowX = xOf(pos(m.now));
  const now = pos(m.now) >= 0 && pos(m.now) <= 100 ? `<line x1="${nowX}" x2="${nowX}" y1="${TOP - 6}" y2="${H - 30}" stroke="${C.now}" stroke-width="2"/><text x="${nowX + 4}" y="${TOP - 26}" fill="${C.now}" font-size="11" font-weight="700">${esc(d.now)}</text>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="'IBM Plex Sans',system-ui,sans-serif">
<rect width="${W}" height="${H}" fill="${C.base}"/>
<text x="14" y="26" fill="${C.lav}" font-size="18" font-weight="700">${esc(m.meta?.name ?? '')} · ${esc(d.title)}</text>
${ticks}${body}${now}
<text x="14" y="${H - 10}" fill="${C.s2}" font-size="11">${esc(fmt(new Date(win.from).toISOString(), loc))} → ${esc(fmt(new Date(win.to).toISOString(), loc))}</text>
</svg>`;
}

function renderTaskModal(m: Model, d: Dict, id: string, loc: string): string {
  const t = m.plan.tasks.find(x => x.id === id);
  if (!t) return '';
  const s = m.states[id] ?? { status: 'free' as const };
  const status = safeStatus(s.status);
  const ph = m.plan.phases.find(p => p.id === t.phase);
  const unlocks = m.plan.tasks.filter(x => x.depends_on.includes(id)).map(x => x.id);
  const chips = (ids: string[]) => (ids.length ? ids.map(i => `<button class="chip" data-action="open-task" data-id="${esc(i)}">${esc(i)}</button>`).join(' ') : '—');
  const start = s.startedAt ?? s.claimedAt;
  const period = start ? `${esc(fmt(start, loc))} → ${s.doneAt ? esc(fmt(s.doneAt, loc)) : '…'}` : '—';
  // How long it took (done) or has run (claimed or in progress); nothing for a junk, future or reversed date.
  const from = pastMs(start, m.now);
  const to = s.status === 'done' ? pastMs(s.doneAt, m.now) : status === 'in_progress' || status === 'claimed' ? m.now : null;
  const took = from !== null && to !== null && to >= from ? Math.floor((to - from) / 60000) : null;
  const est = t.estimate_min ? num(t.estimate_min) : undefined;
  const duration = took === null ? ''
    : s.status === 'done' ? `<div class="mono dur"><span${est && took > est ? ' class="ye"' : ''}>${esc(d.took(took, est))}</span></div>`
    : `<div class="mono dur">${rel(d, 'lasts', start ?? '', m.now)}</div>`;
  const sec = (label: string, body: string) => `<div class="sec"><div class="lbl">${esc(label)}</div><div>${body}</div></div>`;
  return `<div class="overlay" data-action="close-modal" data-scroll-key="modal:${esc(t.id)}"><div class="modal" role="dialog" aria-modal="true">
    <div class="mh"><div><span class="k">${esc(t.id)}</span> <span class="t">${esc(t.title)}</span><br>
      <span class="pill st-${status}${isOrphan(m, s) ? ' orphan' : ''}">${esc(isOrphan(m, s) ? d.run.orphan : d.status[status])}</span> <span class="mono">${esc(ph?.name)}${t.category ? ` · ${esc(t.category)}` : ''}</span> ${trackTag(m, t.track)}
      ${s.exec ? `<div class="mono exec">${execLine(m, d, s.exec)}</div>` : ''}</div>
      <div class="mhb"><button class="btn" data-action="refresh" data-role="pending" hidden>↻ ${esc(d.refresh)}</button><button class="btn" data-action="close-modal" aria-label="${esc(d.close)}">✕</button></div></div>
    <div class="mgrid"><div>
      ${sec(d.field.period, period + duration)}
      ${sec(d.field.dependsOn, chips(t.depends_on))}
      ${sec(d.field.unlocks, chips(unlocks))}
      ${sec(d.field.session, esc(s.owner ?? '—'))}
      ${sec(d.field.zones, t.zones.length ? `<span class="mono">${t.zones.map(esc).join(' · ')}</span>` : '—')}
    </div><div>
      ${t.includes ? sec(d.field.includes, esc(t.includes)) : ''}
      ${sec(d.field.doneWhen, esc(t.done_when))}
      ${t.verification ? sec(d.field.verification, `<span class="mono">${esc(t.verification)}</span>`) : ''}
      ${s.summary ? sec(d.field.summary, esc(s.summary)) : ''}
      ${(() => { const ns = filterNotes(m.notes.filter(n => n.taskId === id), 'all', m.me); return ns.length ? sec(d.notesSec, ns.map(n => `<div class="mnote nb-${safeNote(n.type)}"><span class="nt-${safeNote(n.type)}">${esc(d.noteType[safeNote(n.type)])}</span> <span class="k">${esc(authorLabel(m, d, n.author))}</span><div>${esc(n.text)}</div>${n.answer ? `<div class="ans">↳ ${esc(n.answer)}</div>` : ''}</div>`).join('')) : ''; })()}
      ${s.forge ? sec(d.forge.title, renderForge(d, s.forge)) : ''}
      ${s.evidence ? sec(d.verify.title, renderEvidence(d, s.evidence)) : ''}
      ${sec(d.field.commits, s.commits?.length ? s.commits.map(c => `<div class="mono"><span class="c-blue">${esc(c.sha.slice(0, 7))}</span> ${esc(c.title)} <span class="ok">+${num(c.add)}</span> <span class="del">−${num(c.del)}</span></div>`).join('') : '—')}
    </div></div>
  </div></div>`;
}

/** The verification marker next to a task: green when the evidence passed, red otherwise; empty without evidence. */
function eviMark(m: Model, d: Dict, id: string): string {
  const ev = m.states[id]?.evidence;
  return ev ? `<span class="evi ${ev.result === 'pass' ? 'ok' : 'del'}" title="${esc(d.verify.title)}">▣</span>` : '';
}

function renderEvidence(d: Dict, e: NonNullable<TaskState['evidence']>): string {
  const head = e.result === 'pass' ? `<span class="ok">✓ ${num(e.passed)}/${num(e.total)}</span>`
    : e.result === 'fail' ? `<span class="del">✗ ${num(e.passed)}/${num(e.total)}</span>`
    : `<span class="warn">⊘ ${esc(d.verify.blocked)}${e.reason ? `: ${esc(e.reason)}` : ''}</span>`;
  const withUrl = e.shots.filter(s => s.url);
  const strip = e.shots.map((s, i) => s.url
    ? `<button class="shot ${s.ok ? 'ok' : 'del'}" data-action="open-shot" data-i="${i}" title="${esc(s.check)}"><img src="${esc(s.url)}" alt="${esc(s.check)}" loading="lazy"></button>`
    : `<div class="shot-row ${s.ok ? 'ok' : 'del'}">${s.ok ? '✓' : '✗'} ${esc(s.check)}</div>`).join('');
  const note = e.pending ? `<div class="muted">${esc(d.verify.pending)}</div>` : !withUrl.length && e.local ? `<div class="muted">${esc(d.verify.localOnly(e.shots.length))}</div>` : '';
  return `<div class="evidence"><div class="mono">${esc(e.surfaces.join(', '))} · ${head}</div>${strip ? `<div class="shots">${strip}</div>` : ''}${note}</div>`;
}

function renderLightbox(d: Dict, e: NonNullable<TaskState['evidence']>, i: number): string {
  const s = e.shots[i];
  if (!s?.url) return '';
  return `<div class="lightbox" data-action="close-shot" role="dialog" aria-modal="true"><img src="${esc(s.url)}" alt="${esc(s.check)}">
    <div class="cap"><b>${esc(s.surface)}</b> · ${esc(s.check)} ${s.ok ? '<span class="ok">✓</span>' : '<span class="del">✗</span>'}
    ${s.expected ? `<div>${esc(d.verify.expected)}: ${esc(s.expected)}</div>` : ''}${s.observed ? `<div>${esc(d.verify.observed)}: ${esc(s.observed)}</div>` : ''}</div></div>`;
}

/** H-04: with ?debug=1, what the normalizers dropped or coerced, one row per field, at most 200. */
function renderDebug(m: Model): string {
  if (!m.debug) return '';
  const all = Object.values(m.dropped ?? {}).flat();
  const rows = all.slice(0, 200).map(x => `<li>${esc(`${x.doc} · ${x.field} · ${x.action} · ${x.detail}`)}</li>`).join('');
  return `<details class="dbg" open><summary>debug · ${all.length}</summary><ul>${rows}</ul></details>`;
}

function renderForge(d: Dict, f: NonNullable<TaskState['forge']>): string {
  const vals = Array.isArray(f.validators) ? f.validators : [];
  const score = f.verdict && typeof f.verdict.score === 'number' && Number.isFinite(f.verdict.score) ? String(f.verdict.score) : '—';
  const round = f.round != null ? `${num(f.round)}${f.cap != null ? `/${num(f.cap)}` : ''}` : '';
  return `<div class="forge mono"><div><b>${esc(f.path)}</b> · ${esc(f.phase)}</div>
    ${f.agent ? `<div>${esc(d.forge.agent)}: ${esc(f.agent)}</div>` : ''}
    ${vals.length ? `<div>${esc(d.forge.validators)}: ${vals.map(v => (v.ok === null
      ? `<span class="muted" title="${esc(d.forge.noResult)}">${esc(v.name)} ·</span>`
      : `<span class="${v.ok ? 'ok' : 'del'}">${esc(v.name)} ${v.ok ? '✓' : '✗'}</span>`)).join(' ')}</div>` : ''}
    ${f.verdict ? `<div>${esc(d.forge.verdict)}: ${esc(f.verdict.action)} · ${esc(score)}</div>` : ''}
    ${round ? `<div>${esc(d.forge.round)}: ${esc(round)}</div>` : ''}</div>`;
}

function authorLabel(m: Model, d: Dict, author: string): string {
  if (m.me && author === m.me) return d.you;
  if (author === 'user') return d.aUser;
  if (author.startsWith('user:')) return m.profiles[author.slice(5)] || d.someUser;
  if (author.startsWith('session:')) return `${d.claude} · ${author.slice(8)}`;
  return author;
}

const VF_TASK: Record<'done' | 'in_progress' | 'blocked', TaskStatus[]> = { done: ['done'], in_progress: ['in_progress', 'claimed'], blocked: ['blocked'] };
const VF_ICON: Record<VFilterKey, string> = { done: '✓', in_progress: '◉', blocked: '⚠', committed: '▣', provisional: '○' };
const PH_ICON: Record<VersionColumn['phase']['status'], string> = { done: '✓', in_progress: '◉', committed: '▣', provisional: '○' };
const ST_ICON: Record<TaskStatus, string> = { free: '○', claimed: '◎', in_progress: '◉', blocked: '⚠', done: '✓', orphaned: '?' };

/** Task statuses a version filter button toggles (committed/provisional filter phases instead). */
export function vfilterStatuses(k: 'done' | 'in_progress' | 'blocked'): TaskStatus[] {
  return VF_TASK[k];
}

export function vfilterActive(f: UiState['versionFilter'], k: VFilterKey): boolean {
  return k === 'committed' || k === 'provisional' ? f.phaseStatuses.includes(k) : f.statuses.includes(VF_TASK[k][0]!);
}

/** Every category key of the plan (for "collapse all"). */
export function categoryKeys(plan: PlanView): string[] {
  return [...new Set(plan.tasks.map(t => `${t.phase}|${t.category ?? '—'}`))];
}

function renderVersionsView(m: Model, d: Dict, ui: UiState): string {
  const f = ui.versionFilter;
  const track = f.track && m.plan.tracks.some(t => t.id === f.track) ? f.track : undefined;
  const all = buildVersionColumns(m.plan, m.states, track ? { track } : undefined);
  const cnt: Record<VFilterKey, number> = { done: 0, in_progress: 0, blocked: 0, committed: 0, provisional: 0 };
  for (const c of all) for (const cat of c.categories) for (const t of cat.tasks) {
    if (t.status === 'done') cnt.done++;
    else if (t.status === 'in_progress' || t.status === 'claimed') cnt.in_progress++;
    else if (t.status === 'blocked') cnt.blocked++;
    else if (c.phase.status === 'committed' || c.phase.status === 'provisional') cnt[c.phase.status]++;
  }
  const filtering = f.statuses.length > 0 || f.phaseStatuses.length > 0 || !!track;
  const cols = buildVersionColumns(m.plan, m.states, { statuses: f.statuses.length ? f.statuses : undefined, track })
    .filter(c => !f.phaseStatuses.length || (f.phaseStatuses as string[]).includes(c.phase.status))
    .filter(c => !filtering || c.categories.length > 0);
  const filters = `<div class="filters">
    <button class="f" data-action="expand-all">⌄ ${esc(d.expandAll)}</button><button class="f" data-action="collapse-all">⌃ ${esc(d.collapseAll)}</button>
    ${VFILTER_KEYS.map(k => {
      const on = vfilterActive(f, k);
      return `<button class="f vf-${k} ${on ? 'on' : ''}" data-action="vfilter" data-key="${k}" aria-pressed="${on}">${VF_ICON[k]} ${esc(d.vfilter[k])} · ${cnt[k]}</button>`;
    }).join('')}
    <label class="f trk" title="${esc(d.trackHelp)}">${esc(d.trackLabel)}: <select data-action="vtrack"><option value="">${esc(d.allTracks)}</option>${m.plan.tracks.map(t =>
      `<option value="${esc(t.id)}"${t.id === track ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
  </div>`;
  const body = cols.map(c => {
    const n = m.plan.phases.findIndex(p => p.id === c.phase.id) + 1;
    const ps = c.phase.status;
    const cats = c.categories.map(cat => {
      const key = `${c.phase.id}|${cat.name}`;
      const closed = ui.collapsed.has(key);
      const pips = cat.tasks.map(t => `<i class="st-${safeStatus(t.status)}">■</i>`).join('');
      const tasks = closed ? '' : cat.tasks.map(t => {
        const st = safeStatus(t.status);
        return `<div class="tc" data-action="open-task" data-id="${esc(t.id)}"><div class="st st-${st}">${ST_ICON[st]} ${esc(d.status[st])}${eviMark(m, d, t.id)}</div><div class="tt"><span class="k">${esc(t.id)}</span> ${esc(t.title)} ${trackTag(m, t.track)}</div></div>`;
      }).join('');
      return `<button class="cat" data-action="toggle-cat" data-key="${esc(key)}" aria-expanded="${!closed}"><span><span class="cn">${closed ? '›' : '⌄'} ${esc(cat.name)}</span><span class="mono">${esc(d.entries(cat.tasks.length))}</span></span><span class="pips">${pips}</span></button>${tasks}`;
    }).join('');
    return `<div class="vcol ph-${ps}">
      <div class="vhd"><div class="v">${esc(c.versionId == null ? d.noVersion : d.versionCol(c.versionId))}</div><div class="ph">${esc(d.phaseN(n))}</div><div class="mono">${esc(c.phase.name)}</div>
        <span class="pill ph-${ps}">${PH_ICON[ps]} ${esc(d.phaseStatus[ps])}${ps === 'in_progress' ? ` · ${num(c.done)}/${num(c.total)}` : ''}</span></div>
      ${cats || `<div class="muted">${esc(d.noTasks)}</div>`}
    </div>`;
  }).join('');
  return `<section class="versions-view">${filters}<div class="vcols" data-scroll-key="vcols">${body || `<div class="muted">${esc(d.noTasks)}</div>`}</div></section>`;
}

function liveLine(m: Model, d: Dict): string {
  return `<div class="live ${m.offline && !m.connecting ? 'off' : ''}">● ${m.connecting ? esc(d.connecting) : m.offline ? esc(d.offline) : `${esc(d.live)} · ${esc(d.roadmap)}`}</div>`;
}

function renderNotesView(m: Model, d: Dict, ui: UiState, loc: string): string {
  const c = counts(m.notes);
  const ro = m.readOnly;
  const notice = ro ? d.notice.readonly : ui.notice && ui.notice !== 'readonly' ? d.notice[ui.notice] : '';
  const comp = `<div class="ncomp ${ro ? 'ro' : ''}">
    <textarea data-role="note-text" maxlength="${MAX_NOTE}" rows="2" placeholder="${esc(d.notePlaceholder)}"${ro ? ' readonly' : ''}>${esc(ui.draft.text)}</textarea>
    <label class="btn sel">${esc(d.noteTypeLabel)}: <select data-action="note-type"${ro ? ' disabled' : ''}>${NOTE_TYPES.map(t =>
      `<option value="${t}"${t === ui.draft.type ? ' selected' : ''}>${esc(d.noteType[t])}</option>`).join('')}</select></label>
    <button class="btn pri" data-action="note-add"${ro ? ' disabled' : ''}>${esc(d.add)}</button>
  </div>${notice ? `<div class="notice" role="status">${esc(notice)}</div>` : ''}`;
  const filt = `<div class="nfil">${NOTE_FILTERS.map(k => `<button class="tab ${ui.noteFilter === k ? 'on' : ''}" data-action="nfilter" data-filter="${k}">${esc(d.nfilter[k as keyof Dict['nfilter']])}</button>`).join('')}</div>`;
  const list = filterNotes(m.notes, ui.noteFilter, m.me);
  const cards = list.map(n => {
    const t = safeNote(n.type);
    const open = t === 'question' && !n.answer;
    const label = open ? d.openQuestion : d.noteType[t];
    const when = fmt(n.ts, loc);
    const dec = n.decision;
    const decHtml = dec ? `<div class="ndec">
        <div><span class="k">${esc(d.decisionChosen)}</span> ${esc(dec.chosen)}${dec.alternatives?.length ? ` <span class="k">(${esc(dec.alternatives.join(', '))})</span>` : ''}</div>
        <div><span class="k">${esc(d.decisionWhy)}</span> ${esc(dec.why)}</div>
        ${dec.revert ? `<div><span class="k">${esc(d.decisionRevert)}</span> ${esc(dec.revert)}</div>` : ''}
      </div>` : '';
    const reply = !open || ro ? '' : ui.answering === n.id
      ? `<div class="areply"><textarea data-role="answer-text" maxlength="${MAX_NOTE}" rows="2" placeholder="${esc(d.answerPlaceholder)}">${esc(ui.answerDraft)}</textarea>
        <button class="btn pri" data-action="answer-send" data-id="${esc(n.id)}">${esc(d.send)}</button></div>`
      : `<button class="btn" data-action="answer-open" data-id="${esc(n.id)}">${esc(d.reply)}</button>`;
    return `<div class="note nb-${t}">
      <div class="nh"><span><span class="nt-${t}">${esc(label)}</span>${dec ? ` <span class="nauto">${esc(dec.auto ? d.autoTag : d.yoursTag)}</span>` : ''}</span><span class="k">${esc(authorLabel(m, d, n.author))}${when ? ` · ${esc(when)}` : ''}</span></div>
      <p>${esc(n.text)}</p>
      ${decHtml}
      ${n.taskId ? `<button class="chip" data-action="open-task" data-id="${esc(n.taskId)}">${esc(n.taskId)}</button>` : ''}
      ${n.answer ? `<div class="ans"><span class="k">${esc(d.answeredBy)} · ${esc(authorLabel(m, d, n.answeredBy ?? ''))}</span>${esc(n.answer)}</div>` : ''}
      ${reply}
    </div>`;
  }).join('');
  return `<header class="hd">
    ${liveLine(m, d)}
    <h1>${esc(d.notesTitle)}</h1>
    <div class="meta"><b>${c.decision}</b> ${esc(d.noteCounts.decision)} · <b>${c.idea}</b> ${esc(d.noteCounts.idea)} · <b>${c.debt}</b> ${esc(d.noteCounts.debt)} · <b>${c.open}</b> ${esc(d.noteCounts.open)}</div>
  </header>
  <section class="notes-view">${comp}${filt}${cards ? `<div class="ngrid">${cards}</div>` : `<div class="muted">${esc(d.noNotes)}</div>`}</section>`;
}

function renderProposalsView(m: Model, d: Dict, ui: UiState, loc: string): string {
  const ro = m.readOnly || !!m.proposalsReadOnly;
  const f = ui.proposalFilter;
  const all = m.proposals.map(p => ({
    p, status: oneOf(PROPOSAL_STATUSES, p.status, 'done'), category: oneOf(PROPOSAL_CATEGORIES, p.category, 'feature'), risk: oneOf(PROPOSAL_RISKS, p.risk, 'high'),
  }));
  const cnt = Object.fromEntries(PROPOSAL_STATUSES.map(s => [s, all.filter(x => x.status === s).length])) as Record<ProposalStatus, number>;
  const notice = ro ? d.notice.readonly : ui.notice && ui.notice !== 'readonly' ? d.notice[ui.notice] : '';
  const row = <K extends ProposalFilterKind>(kind: K, label: (v: Exclude<ProposalFilter[K], 'all'>) => string) =>
    `<div class="pfil"><span class="lbl">${esc(d.pfilter[kind])}</span>${PROPOSAL_FILTERS[kind].map(v =>
      `<button class="tab ${f[kind] === v ? 'on' : ''}" data-action="pfilter" data-kind="${kind}" data-value="${v}">${esc(v === 'all' ? d.pfilter.all : label(v as Exclude<ProposalFilter[K], 'all'>))}</button>`).join('')}</div>`;
  const filters = row('status', v => d.pstatus[v]) + row('category', v => d.pcategory[v]) + row('risk', v => d.prisk[v]);
  const list = all
    .filter(x => (f.status === 'all' || x.status === f.status) && (f.category === 'all' || x.category === f.category) && (f.risk === 'all' || x.risk === f.risk))
    .sort((a, b) => (a.p.ts < b.p.ts ? 1 : a.p.ts > b.p.ts ? -1 : 0));
  const cards = list.map(({ p, status, category, risk }) => {
    const id = esc(p.id);
    const when = fmt(p.ts, loc);
    const comments = m.notes.filter(n => n.proposalId === p.id).sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
    const decided = p.decidedBy || p.decidedAt
      ? `<div class="pdec"><span class="k">${esc(d.pfield.decided)} · ${esc(authorLabel(m, d, p.decidedBy ?? ''))}${p.decidedAt && fmt(p.decidedAt, loc) ? ` · ${esc(fmt(p.decidedAt, loc))}` : ''}</span>${p.reason ? `<div>${esc(p.reason)}</div>` : ''}</div>` : '';
    const thread = comments.length ? `<div class="pcom"><div class="lbl">${esc(d.pfield.comments)}</div>${comments.map(n =>
      `<div class="mnote"><span class="k">${esc(authorLabel(m, d, n.author))}${fmt(n.ts, loc) ? ` · ${esc(fmt(n.ts, loc))}` : ''}</span><div>${esc(n.text)}</div></div>`).join('')}</div>` : '';
    let actions = '';
    if (!ro) {
      const decide = canDecide(status);
      const rejectUi = !decide ? '' : ui.rejecting === p.id
        ? `<div class="areply"><textarea data-role="reason-text" maxlength="${MAX_PROPOSAL_TEXT}" rows="2" placeholder="${esc(d.reasonPlaceholder)}">${esc(ui.reasonDraft)}</textarea>
          <button class="btn del" data-action="p-reject-send" data-id="${id}">${esc(d.sendReject)}</button></div>`
        : `<button class="btn" data-action="p-reject-open" data-id="${id}">${esc(d.reject)}</button>`;
      const commentUi = ui.commenting === p.id
        ? `<div class="areply"><textarea data-role="comment-text" maxlength="${MAX_NOTE}" rows="2" placeholder="${esc(d.commentPlaceholder)}">${esc(ui.commentDraft)}</textarea>
          <button class="btn pri" data-action="p-comment-send" data-id="${id}">${esc(d.send)}</button></div>`
        : `<button class="btn" data-action="p-comment-open" data-id="${id}">${esc(d.comment)}</button>`;
      actions = `<div class="pact">${decide ? `<button class="btn pri" data-action="p-approve" data-id="${id}">${esc(d.approve)}</button>` : ''}${rejectUi}${commentUi}</div>`;
    }
    return `<div class="note prop pr-${risk}" data-id="${id}">
      <div class="nh"><span class="tag pc">${esc(d.pcategory[category])}</span><span class="pill risk-${risk}">${esc(d.prisk[risk])}</span><span class="pill ps-${status}">${esc(d.pstatus[status])}</span><span class="k">${esc(authorLabel(m, d, p.author))}${when ? ` · ${esc(when)}` : ''}</span></div>
      <h3>${esc(p.title)}</h3>
      ${p.pillar ? `<div class="mono">${esc(d.pfield.pillar)}: ${esc(p.pillar)}</div>` : ''}
      ${p.rationale ? `<p>${esc(p.rationale)}</p>` : ''}
      ${p.evidence ? `<div class="lbl">${esc(d.pfield.evidence)}</div><pre class="evid" data-scroll-key="evid:${id}">${esc(p.evidence)}</pre>` : ''}
      ${p.estimate || p.path ? `<div class="mono">${p.estimate ? `${esc(d.pfield.estimate)}: ${esc(p.estimate)}` : ''}${p.estimate && p.path ? ' · ' : ''}${p.path ? `${esc(d.pfield.path)}: ${esc(p.path)}` : ''}</div>` : ''}
      ${decided}
      ${thread}
      ${actions}
    </div>`;
  }).join('');
  return `<header class="hd">
    ${liveLine(m, d)}
    <h1>${esc(d.proposalsTitle)}</h1>
    <div class="meta">${PROPOSAL_FILTERS.status.filter((s): s is ProposalStatus => s !== 'all').map(s => `<b>${cnt[s]}</b> ${esc(d.pstatus[s])}`).join(' · ')}</div>
  </header>
  <section class="proposals-view">${notice ? `<div class="notice" role="status">${esc(notice)}</div>` : ''}${filters}${cards ? `<div class="pgrid">${cards}</div>` : `<div class="muted">${esc(d.noProposals)}</div>`}</section>`;
}
