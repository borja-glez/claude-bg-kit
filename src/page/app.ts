import { planViewFromDocs } from '../lib/sync.js';
import { isPlanId } from '../lib/ids.js';
import { TASK_STATUSES, type MessageDoc, type MetaDoc, type NoteDoc, type NoteType, type PhaseDoc, type SessionDoc, type States, type TaskStatus } from '../lib/types.js';
import { clampPan, clampSpan, panFor, planRange, zoomAround, type Zoom } from '../lib/timeline.js';
import { MAX_NOTE, NOTE_TYPES } from '../lib/notes.js';
import { canDecide, MAX_PROPOSAL_TEXT, normalizeApproval, normalizeProposal, proposalDigest, type ApprovalDoc, type ProposalDoc } from '../lib/proposals.js';
import { dictFor } from './i18n.js';
import { unmarkedReason } from './html.js';
import { derive } from './derive.js';
import { morphInto } from './morph.js';
import { parseSeen, pruneSeen, seenKey } from './needs.js';
import { mergeMetrics, normalizeEvent, normalizeInfinite, normalizeMessage, normalizeMeta, normalizeMetrics, normalizeNote, normalizePhase, normalizeRun, normalizeSession, normalizeState, type Drop, type Report } from './normalize.js';
import { decodeView, encodeView, type ViewState } from './urlstate.js';
import { categoryKeys, DETAIL_TABS, esc, GROUPS, NOTE_FILTERS, PROPOSAL_FILTERS, relText, renderApp, TALK_KINDS, timelineSvg, timelineWindow, TL_LAYERS, TL_STATUSES, vfilterStatuses, VFILTER_KEYS, VIEWS, VIRTUAL_FROM, type DetailTab, type Model, type ProposalFilterKind, type RelKind, type TalkKind, type UiState, type VFilterKey, type View } from './render.js';

/**
 * The page's embedded snapshot; G-13 and G-14: the waypoint that built it and the states the last listing saw. The page
 * shows `states` (only plan ids with a known status) and `statesAt` (only a date) until the database answers.
 * `pageVersion` (the waypoint that built the page, written by `waypoint page`) is not read by the page.
 */
export interface Snapshot { meta: MetaDoc; phases: PhaseDoc[]; pageVersion?: string; states?: Record<string, TaskStatus>; statesAt?: string }
export interface Env {
  claude?: { use(name: string): Promise<unknown> } | null;
  snapshot: Snapshot | null;
  root: HTMLElement;
  /** H-04: list what the normalizers dropped (?debug=1). */
  debug?: boolean;
  now?: () => number;
  refreshMs?: number;
  /** Timers for the composition ceiling (defaults to the globals; tests pass fakes). */
  timers?: { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(id: unknown): void };
  /** H-06: how the page's HTML reaches the DOM (morphInto; tests pass one that throws). */
  morph?: (root: HTMLElement, html: string) => void;
}

/** A composition longer than this renders anyway (a lost compositionend must not freeze the page). */
const COMPOSE_CEILING_MS = 3000;

interface Snap { exists?: boolean; data(): unknown; id?: string }
interface QSnap { docs: (Snap & { id: string })[] }
interface Sub { onSnapshot(next: (s: never) => void, err?: (e: unknown) => void): () => void }
interface DocRef extends Sub { get(): Promise<Snap>; update(data: Record<string, unknown>): Promise<unknown>; set(data: Record<string, unknown>): Promise<unknown> }
interface Coll extends Sub { orderBy(f: string, d?: string): { limit(n: number): Sub }; add(data: Record<string, unknown>): Promise<unknown> }
interface Db { doc(p: string): DocRef; collection(p: string): Coll }
interface User { id(): Promise<string | null> | string | null; profiles?(ids: string[]): unknown; isOwner?(): unknown }

const TEXT_ROLES = ['search', 'note-text', 'answer-text', 'reason-text', 'comment-text'];
/** The focused element of the page before a repaint; a text box and the timeline are found again by their role. */
interface Focus { el: HTMLElement; role: string | null; caret: [number | null, number | null] | null }
/** Textareas whose focus loss ends an IME composition. */
const DRAFT_ROLES = ['note-text', 'answer-text', 'reason-text', 'comment-text'];
const isInvalidArgument = (e: unknown): boolean => {
  const o = e as { code?: unknown; message?: unknown } | null;
  return o?.code === 'invalid_argument' || /invalid_argument/.test(String(o?.message ?? ''));
};

/** G-14: the states the snapshot carries (id → status), shown until the database answers; anything else is left out. */
function snapshotStates(s: Snapshot | null): States {
  const out: States = {};
  const raw: unknown = s?.states;
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, st] of Object.entries(raw as Record<string, unknown>)) {
    if (isPlanId(id) && (TASK_STATUSES as readonly unknown[]).includes(st)) out[id] = { status: st as TaskStatus };
  }
  return out;
}

/** C8: when the snapshot's states were listed, only as a string of at most 40 characters that reads as a date. */
function snapshotStatesAt(s: Snapshot | null): string | null {
  const raw: unknown = s?.statesAt;
  return typeof raw === 'string' && raw.length <= 40 && Number.isFinite(Date.parse(raw)) ? raw : null;
}

export async function start(env: Env): Promise<{ stop(): void; model: Model; ui: UiState }> {
  const now = env.now ?? Date.now;
  const morph = env.morph ?? morphInto;
  const ui: UiState = {
    zoom: '1d', offset: 0, expanded: new Set(), modal: null, shot: null, search: '', view: 'summary', talk: 'notes',
    versionFilter: { statuses: [], phaseStatuses: [], track: null }, collapsed: new Set(), noteFilter: 'all', timelineGroup: 'phase',
    draft: { type: 'idea', text: '' }, answering: null, answerDraft: '', notice: null,
    proposalFilter: { status: 'all', category: 'all', risk: 'all' }, commenting: null, commentDraft: '', rejecting: null, reasonDraft: '',
  };
  let phaseDocs: PhaseDoc[] = env.snapshot?.phases ?? [];
  const snapStates = snapshotStates(env.snapshot);
  const model: Model = {
    meta: env.snapshot?.meta ?? null,
    plan: env.snapshot ? planViewFromDocs(env.snapshot.meta, env.snapshot.phases) : { tracks: [], versions: [], phases: [], tasks: [] },
    states: snapStates,
    sessions: {},
    events: [],
    messages: [],
    notes: [],
    proposals: [],
    infinite: null,
    run: null,
    me: null,
    // Carry 5: unknown (undefined) until user.isOwner() answers; then true or false.
    isOwner: undefined,
    profiles: {},
    readOnly: false,
    now: now(),
    offline: false,
    connecting: true,
    debug: env.debug === true,
    dropped: {},
    rev: 0,
    statesAt: Object.keys(snapStates).length ? snapshotStatesAt(env.snapshot) : null,
    syncedAt: null,
  };

  // §4.7, H-25: the open detail is in the URL (#t=T044&tt=forge). Opening pushes an entry; closing goes back over the
  // entries it pushed, or rewrites the URL without t when the detail came from a link. The focus goes to the active tab
  // on opening and back to what opened it (its data-k) on closing.
  //
  // History safety (review I1): `trail` holds the hashes of the entries this visit pushed for the detail, in order from
  // the entry the first one was pushed over (the trail's base), and `trailAt` how many of them lie under the current
  // entry, it included. Each of those entries also carries a mark in its history state, written right after its push:
  // this visit, its depth in the trail and its base's hash. An entry the URL brings back counts as the trail's only when
  // its mark and its hash both say so, so a Back by several entries at once, a Forward, a reload, a hash edited by hand
  // or another entry with the same hash never make closing go back further than the entries this visit verifiably
  // pushed under the current one. Anything unverified rewrites the URL instead.
  interface Mark { wp: string; d: number; b: string }
  const VISIT = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  let trail: string[] = [];
  let trailAt = 0;
  /** The current entry's mark, when it is this visit's and the trail has this hash at its depth. */
  const markHere = (hash: string): Mark | null => {
    let s: unknown;
    try { s = history.state; } catch { return null; }
    const m = s as Partial<Mark> | null;
    if (!m || typeof m !== 'object' || m.wp !== VISIT || typeof m.b !== 'string' || typeof m.d !== 'number' || !Number.isInteger(m.d) || m.d < 1) return null;
    return trail[m.d - 1] === hash ? (m as Mark) : null;
  };
  /** Review I2: a link's task the embedded plan lacks (added since the page was built) stays pending, and in the URL,
   *  until the database's plan is in (`planIn`); then it opens if that plan has it, else it goes. */
  let linked: { task: string; tab: DetailTab } | null = null;
  let planIn = false;
  let opener: string | null = null;
  /** What to focus after the next render: a selector, or an element's data-k, matched by equality and never put in a
   *  selector, so no key (from the database) can break the query (review M2). */
  let focusNext: string | { k: string } | null = null;
  const byKey = (k: string): { k: string } => ({ k });
  const ACTIVE_TAB = '.modal [role="tab"][aria-selected="true"]';
  /** The detail closed: the focus goes back to what opened it, else (a link opened it) to the view's main element; the
   *  render finds another place when it is gone. Never left on the body. */
  const focusBack = () => { focusNext = opener ? byKey(opener) : 'main'; opener = null; };
  /** The data-k of the focused element of the page, if it has one. */
  const focusedKey = (): string | null => {
    const el = document.activeElement as HTMLElement | null;
    return el && el !== env.root && env.root.contains(el) ? el.dataset?.k ?? null : null;
  };
  // The detail part of what the URL says (t, tt), alone: it changes the detail (ui.modal, ui.tab, the gallery, a pending
  // link, the opener and the focus) and nothing of the view (review N1).
  const applyDetail = (v: ViewState) => {
    // The detail: a task of the plan opens (with its tab); anything else closes it, and its opener gets the focus back.
    // Before the database's plan is in, a task the plan lacks waits for it (review I2).
    const want = v.task && isPlanId(v.task) ? v.task : null;
    const task = want && model.plan.tasks.some(t => t.id === want) ? want : null;
    const tab: DetailTab = v.tab && (DETAIL_TABS as readonly string[]).includes(v.tab) ? (v.tab as DetailTab) : 'summary';
    linked = want && !task && !planIn ? { task: want, tab } : null;
    if (!task && ui.modal) focusBack();
    if (task && task !== ui.modal) {
      // Back or Forward onto a detail: what has the focus now (the row a close gave it back to) is what opened it.
      if (!ui.modal) opener = focusedKey();
      focusNext = ACTIVE_TAB;
    }
    // The gallery belongs to the task it was opened on.
    if (task !== ui.modal) ui.shot = null;
    ui.modal = task;
    ui.tab = task ? tab : 'summary';
  };
  // H-25: what the URL says (on load, Back and Forward, or a hash edited by hand), applied to the view state. The URL is
  // the schedule's whole state: what its hash leaves out is the default (a free span only with `s`, so an explicit `z`
  // wins over a span set by Ctrl + wheel). The other views never carry those parameters and leave them as they are.
  const applyView = (v: ViewState) => {
    ui.view = v.view && (VIEWS as readonly string[]).includes(v.view) ? (v.view as View) : 'summary';
    if (ui.view !== 'schedule') ui.tl = undefined;
    applyDetail(v);
    if (ui.view === 'talk') ui.talk = v.c && (TALK_KINDS as readonly string[]).includes(v.c) ? (v.c as TalkKind) : 'notes';
    if (ui.view === 'schedule') {
      ui.timelineGroup = v.group && (GROUPS as readonly string[]).includes(v.group) ? (v.group as UiState['timelineGroup']) : 'phase';
      ui.zoom = v.zoom ?? '1d';
      ui.offset = 0;
      // Review M5: clamped here too, whatever decoded the hash.
      ui.span = v.span ? clampSpan(v.span) : undefined;
      ui.pan = v.span ? clampPan(v.pan ?? 0) : undefined;
      ui.expanded = new Set(v.open ?? []);
      ui.statuses = (v.status ?? []).filter(x => (TL_STATUSES as readonly string[]).includes(x));
      ui.layers = (v.layers ?? []).filter(x => (TL_LAYERS as readonly string[]).includes(x));
      ui.search = v.q ?? '';
    }
    if (v.debug) model.debug = true;
  };
  let lastHash = '';
  try {
    applyView(decodeView(location.hash));
    lastHash = location.hash.length > 1 ? location.hash : '';
  } catch { /* no location */ }
  // G-24: the deferred findings this viewer marked as seen, kept only in this browser (never shared). Every access may
  // throw (a private window, blocked storage): then the marks last this visit only.
  const seenStoreKey = () => seenKey(model.meta?.name ?? '');
  const readSeen = (): Record<string, string> => { try { return parseSeen(localStorage.getItem(seenStoreKey())); } catch { return {}; } };
  const writeSeen = (seen: Record<string, string>) => { try { localStorage.setItem(seenStoreKey(), JSON.stringify(seen)); } catch { /* the marks last this visit */ } };
  model.seenDeferred = readSeen();
  let seenPruned = false;
  /** H-25: set by an action that changes what the person looks at, so the next render adds a history entry. */
  let pushNext = false;
  /** Set with pushNext by opening a detail: the entry that render pushes goes into the trail. */
  let pushDetail = false;
  // A pending link (review I2) stays in the URL: the render does not rewrite its t and tt away.
  const viewState = (): ViewState => ({ view: ui.view, c: ui.talk, group: ui.timelineGroup, zoom: ui.zoom, span: ui.span, pan: ui.pan, open: [...ui.expanded], status: ui.statuses, q: ui.search.trim(), layers: ui.layers, task: ui.modal ?? linked?.task, tab: ui.modal ? ui.tab : linked?.tab, debug: model.debug });
  /** What a view state says without the detail (t, tt), as the URL writes it. */
  const viewPart = (s: ViewState): string => encodeView({ ...s, task: undefined, tab: undefined });
  const openDetail = (id: string, from: HTMLElement): boolean => {
    if (!model.plan.tasks.some(t => t.id === id)) return false;
    if (!ui.modal) opener = from.dataset.k ?? null;
    ui.modal = id;
    ui.shot = null;
    ui.tab = 'summary';
    linked = null;
    pushNext = true;
    pushDetail = true;
    focusNext = ACTIVE_TAB;
    return true;
  };
  const closeDetail = () => {
    // Back over the entries this visit verifiably pushed under the current one, to the trail's base, never further, and
    // never more than the history holds. The page shows the base at once, the bare view or the detail a link opened
    // there (review M1), so nothing is rewritten in between and Back finds it applied. Anything unverified, or a history
    // the page cannot move, closes here and leaves the render to rewrite the URL without t.
    const m = trailAt ? markHere(lastHash) : null;
    const d = m && m.d === trailAt ? m.d : 0;
    trailAt = 0;
    let back = false;
    try { back = d > 0 && d < history.length; } catch { back = false; }
    if (m && back) {
      const before = lastHash;
      // Only the detail takes what the base says (none, or the detail a link opened there); the view keeps all its state,
      // the schedule's ‹ › offset included (review N1), and the URL Back lands on is that view: nothing to rewrite.
      applyDetail(decodeView(m.b));
      lastHash = encodeView(viewState());
      try { history.go(-d); } catch { lastHash = before; /* the render rewrites the URL to what the page shows */ }
    } else {
      ui.modal = null;
      ui.shot = null;
      focusBack();
    }
    schedule();
  };
  const writeHash = () => {
    const push = pushNext;
    const detail = pushDetail;
    pushNext = false;
    pushDetail = false;
    try {
      const next = encodeView(viewState());
      if (next === lastHash) return;
      const before = lastHash;
      lastHash = next;
      const url = next || `${location.pathname}${location.search}`;
      if (!push) {
        // A tab, a zoom, a filter: the same entry, keeping its mark; in the trail it takes its new hash.
        history.replaceState(history.state ?? null, '', url);
        if (trailAt) trail[trailAt - 1] = next;
        return;
      }
      // A detail pushed over an entry of the trail extends it; over any other entry it starts one, based there. Only a
      // push the browser took goes into the trail, and its mark goes on right after it.
      const under = detail && trailAt ? markHere(before) : null;
      history.pushState(null, '', url);
      if (!detail) { trailAt = 0; return; }
      const d = under ? under.d + 1 : 1;
      trail = [...trail.slice(0, d - 1), next];
      trailAt = d;
      history.replaceState({ wp: VISIT, d, b: under ? under.b : before } satisfies Mark, '', url);
    } catch { /* a sandboxed frame may refuse: the view just is not in the link */ }
  };
  // H-25: Back, Forward and a hash edited by hand apply what the URL says.
  const onUrl = () => {
    try {
      const hash = location.hash.length > 1 ? location.hash : '';
      // A browser fires popstate and then hashchange for one Back; the second finds that URL applied (or written by the
      // page itself, as closing the detail does before going back): applying it twice would count one entry twice.
      if (hash === lastHash) return;
      // Where the URL brought the page: an entry of the trail only if its mark and its hash both say so (review I1).
      trailAt = markHere(hash)?.d ?? 0;
      lastHash = hash;
      // An entry that differs from the page only in t and tt (Back or Forward over the detail's entries) moves only the
      // detail: the view keeps what the URL does not carry, the schedule's ‹ › offset (review N1). Any other entry
      // drives the whole view, as the URL is the schedule's whole state (Task 5).
      const v = decodeView(location.hash);
      if (viewPart(v) === viewPart(viewState())) applyDetail(v); else applyView(v);
      // An entry of the trail whose task left the plan opens nothing: no detail to go back from.
      if (!ui.modal) trailAt = 0;
    } catch { return; }
    // H-06: a focused search box keeps its own value through a morph; it takes the URL's here, as the composer does.
    const box = env.root.querySelector('[data-role="search"]') as HTMLInputElement | null;
    if (box && box.value !== ui.search) box.value = ui.search;
    schedule();
  };
  let tlNote = '';
  let tlNoteTimer: ReturnType<typeof setTimeout> | null = null;
  const note = (text: string) => {
    tlNote = text;
    if (tlNoteTimer) clearTimeout(tlNoteTimer);
    tlNoteTimer = setTimeout(() => { tlNote = ''; schedule(); }, 5000);
    schedule();
  };

  // While an IME composition is active, replacing the textarea would cancel it: hold every render
  // (input, snapshots, the timer) until compositionend, focusout, a click action or the ceiling.
  const timers = env.timers ?? { setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout: (id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>) };
  let composing = false;
  let deferred = false;
  let ceiling: unknown = null;
  const endComposition = () => {
    composing = false;
    if (ceiling !== null) { timers.clearTimeout(ceiling); ceiling = null; }
    if (deferred) { deferred = false; schedule(); }
  };
  // H-06: what has the focus before a repaint, morph or full replace alike. Review M1: a row of the timeline (a button
  // since G-15) falls back to the timeline itself, so a row the virtualization stops painting never drops the focus on
  // the body.
  const takeFocus = (): Focus | null => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || !env.root.contains(el)) return null;
    const r = el.getAttribute?.('data-role') ?? null;
    const text = !!r && TEXT_ROLES.includes(r);
    const box = el as HTMLInputElement;
    const role = text || r === 'timeline' ? r : el.closest?.('[data-role="timeline"]') ? 'timeline' : null;
    return { el, role, caret: text ? [box.selectionStart, box.selectionEnd] : null };
  };
  // After a repaint the focus goes back to the same element when it is still in the page (morphdom may have moved it,
  // which drops the focus), else to the text box or the timeline with its role, with its caret; anything else that was
  // replaced loses it, as before H-06.
  const giveFocus = (f: Focus | null) => {
    if (!f || document.activeElement === f.el) return;
    const el = env.root.contains(f.el) ? f.el : f.role ? env.root.querySelector<HTMLElement>(`[data-role="${f.role}"]`) : null;
    if (!el) return;
    el.focus({ preventScroll: true });
    if (f.caret && f.caret[0] != null) (el as HTMLInputElement).setSelectionRange(f.caret[0], f.caret[1] ?? f.caret[0]);
  };
  // The render of before H-06, kept for when morph throws: it replaces everything and puts back the scroll of every keyed
  // container (the focus goes back after either path).
  const replaceAll = (html: string) => {
    const scrolls = new Map<string, [number, number]>();
    env.root.querySelectorAll<HTMLElement>('[data-scroll-key]').forEach(el => scrolls.set(el.dataset.scrollKey ?? '', [el.scrollTop, el.scrollLeft]));
    env.root.innerHTML = html;
    env.root.querySelectorAll<HTMLElement>('[data-scroll-key]').forEach(el => {
      const s = scrolls.get(el.dataset.scrollKey ?? '');
      if (s) { el.scrollTop = s[0]; el.scrollLeft = s[1]; }
    });
  };
  /** Focuses what a target names in the page (a selector, or a data-k by equality); whether it took the focus. A browser
   *  refuses an element that cannot have it; a target not found, or a selector that throws, is false: never a render
   *  failure (review M2). */
  const focusTo = (target: string | { k: string } | null): boolean => {
    let el: HTMLElement | null = null;
    try {
      if (typeof target === 'string') el = env.root.querySelector<HTMLElement>(target);
      else if (target) { const k = target.k; el = Array.from(env.root.querySelectorAll<HTMLElement>('[data-k]')).find(x => x.dataset.k === k) ?? null; }
      el?.focus({ preventScroll: true });
    } catch { return false; }
    return !!el && document.activeElement === el;
  };
  const render = () => {
    scheduled = false;
    if (composing) { deferred = true; return; }
    try {
      model.now = now();
      // Review Focus 2: a plan snapshot that dropped the open task closes its detail (and unlocks the page).
      if (ui.modal && !model.plan.tasks.some(t => t.id === ui.modal)) { ui.modal = null; ui.shot = null; trailAt = 0; focusBack(); }
      const html = renderApp(model, ui, derive(model));
      const page = document.scrollingElement?.scrollTop ?? 0;
      const focus = takeFocus();
      // H-06: morphdom touches only the nodes that changed; if it throws, everything is replaced as before.
      try { morph(env.root, html); }
      catch (e) { console.error('[waypoint] morph failed', e); replaceAll(html); }
      // One focus path, after either: what an action asked to focus wins (§4.7: the active tab on opening, the tab the
      // keys moved to, the gallery, what opened a detail or a screenshot on closing); else the focus goes back to where it
      // was (H-06). After an action it is never left on the body: the open detail's tab, else the view's main element.
      const asked = focusNext;
      focusNext = null;
      if (!asked || !focusTo(asked)) giveFocus(focus);
      if (asked && !env.root.contains(document.activeElement)) focusTo(ui.modal ? ACTIVE_TAB : 'main');
      dropArrows();
      if (document.scrollingElement && document.scrollingElement.scrollTop !== page) document.scrollingElement.scrollTop = page;
      document.documentElement.classList.toggle('wp-modal', ui.modal !== null);
      // §4.8: the page speaks the plan's language (screen readers, hyphenation).
      document.documentElement.lang = model.meta?.locale || 'en';
      const noteEl = env.root.querySelector('[data-role="tl-note"]');
      if (noteEl) noteEl.textContent = tlNote;
      writeHash();
      void lookupProfiles();
    } catch (e) {
      console.error('[waypoint] render failed', e);
      model.offline = true;
      model.connecting = false;
      const d = dictFor(typeof model.meta?.locale === 'string' ? model.meta.locale : undefined);
      env.root.innerHTML = `<div class="hd"><div class="live off">● ${esc(d.offline)}</div></div>`;
    }
  };
  let framed = false;
  const scheduleFrame = () => {
    if (framed) return;
    framed = true;
    const raf = (globalThis as { requestAnimationFrame?: (fn: () => void) => unknown }).requestAnimationFrame;
    if (raf) raf(() => { framed = false; schedule(); }); else { framed = false; schedule(); }
  };
  let scheduled = false;
  const schedule = () => {
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(render);
    }
  };
  // H-06: a change of the data bumps the model's revision (derive() caches by it) and repaints at once; the modal and a
  // focused <select> no longer hold it back, morphdom leaves them as they are.
  const changed = () => { model.rev = (model.rev ?? 0) + 1; schedule(); };
  // Review I2: the database's plan is in once its snapshot came and, with phases, the meta it is built with; offline, or
  // when the plan's own subscription (or, with no meta, meta/project's) fails (`force`), the plan the page has is all
  // there will be. A pending link then opens if that plan has its task, else it goes (the render rewrites the URL).
  let planSnap = false;
  const settleLink = (force = false) => {
    if (planIn || (!force && (!planSnap || (phaseDocs.length > 0 && !model.meta)))) return;
    planIn = true;
    const l = linked;
    linked = null;
    if (!l || ui.modal || !model.plan.tasks.some(t => t.id === l.task)) return;
    ui.modal = l.task;
    ui.tab = l.tab;
    ui.shot = null;
    opener = null;
    focusNext = ACTIVE_TAB;
  };

  let db: Db | null = null;

  // The viewer, resolved once. Anything unexpected (no capability, not an object) means "no user".
  let userP: Promise<User | null> | null = null;
  const getUser = (): Promise<User | null> => (userP ??= (async () => {
    try {
      const u = env.claude ? await env.claude.use('user') : null;
      return u && typeof (u as User).id === 'function' ? (u as User) : null;
    } catch { return null; }
  })());
  const userId = async (u: User | null): Promise<string | null> => {
    if (!u) return null;
    try { const id = await u.id(); return typeof id === 'string' && id ? id : null; } catch { return null; }
  };
  // Writes are not gated on can('data.write'): it answers for the root rule (admin), while notes/
  // only needs interact. The page goes read-only when there is no user id or a write is refused.

  // Display names for user:<id> authors, asked on every render pass for the ids in the notes
  // (the runtime caches profiles). Re-render only when a name actually changed.
  const lookupProfiles = async () => {
    const u = await getUser();
    if (!u || typeof u.profiles !== 'function') return;
    const ids = [...new Set([...model.notes.flatMap(n => [n.author, n.answeredBy ?? '']), ...model.proposals.flatMap(p => [p.author, p.decidedBy ?? ''])])]
      .filter(a => a.startsWith('user:') && a !== model.me).map(a => a.slice(5)).filter(Boolean);
    if (!ids.length) return;
    try {
      const res = (await u.profiles(ids)) as Record<string, { name?: unknown } | undefined> | null;
      let changedName = false;
      for (const id of ids) {
        const raw = res && typeof res === 'object' ? res[id]?.name : undefined;
        const name = typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, 80) : undefined;
        if (name !== model.profiles[id]) {
          if (name) model.profiles[id] = name; else delete model.profiles[id];
          changedName = true;
        }
      }
      if (changedName) schedule();
    } catch { /* names stay as the generic fallback */ }
  };

  const setReadOnly = () => { model.readOnly = true; ui.notice = 'readonly'; };
  // A refused proposal write (e.g. a roadmap without the proposals schema) locks only the proposals.
  const setProposalsReadOnly = () => { model.proposalsReadOnly = true; if (ui.notice !== 'readonly') ui.notice = null; };

  // Writes happen only here, from event handlers, and only under notes/, proposals/ and, for the owner, approvals/.
  let busy = false;
  const addNote = async () => {
    const text = ui.draft.text.slice(0, MAX_NOTE);
    if (!text.trim() || busy) return;
    if (!db || model.readOnly) { setReadOnly(); schedule(); return; }
    busy = true;
    try {
      const id = await userId(await getUser());
      if (!id) { setReadOnly(); return; }
      await db.collection('notes').add({ ts: new Date(now()).toISOString(), type: ui.draft.type, author: `user:${id}`, text });
      ui.draft = { type: ui.draft.type, text: '' };
      // H-06: the box is morphed, not replaced, and a focused one keeps its value: empty it here.
      const box = env.root.querySelector('[data-role="note-text"]') as HTMLTextAreaElement | null;
      if (box) box.value = '';
      ui.notice = null;
    } catch (e) {
      if (isInvalidArgument(e)) setReadOnly(); else ui.notice = 'failed';
    } finally {
      busy = false;
      schedule();
    }
  };
  const sendAnswer = async (noteId: string) => {
    const answer = ui.answerDraft.slice(0, MAX_NOTE);
    if (!answer.trim() || busy) return;
    // Only ids we received as notes, and never a path separator: the write must stay under notes/.
    const target = model.notes.find(n => n.id === noteId);
    if (noteId.includes('/') || !target || target.type !== 'question' || target.answer) return;
    if (!db || model.readOnly) { setReadOnly(); schedule(); return; }
    busy = true;
    try {
      const id = await userId(await getUser());
      if (!id) { setReadOnly(); return; }
      // get-then-update is not atomic: two people answering at once can both pass the check and
      // the last writer wins. Acceptable for notes; the check only avoids the common overwrite.
      const ref = db.doc(`notes/${noteId}`);
      const snap = await ref.get();
      const cur = snap?.exists ? (snap.data() as { answer?: unknown } | null) : null;
      if (cur && typeof cur.answer === 'string' && cur.answer) { ui.notice = 'answered'; return; }
      await ref.update({ answer, answeredBy: `user:${id}`, answeredAt: new Date(now()).toISOString() });
      ui.answering = null;
      ui.answerDraft = '';
      ui.notice = null;
    } catch (e) {
      if (isInvalidArgument(e)) setReadOnly(); else ui.notice = 'failed';
    } finally {
      busy = false;
      schedule();
    }
  };

  // Only ids we received as proposals, and never a path separator: writes stay under proposals/.
  const knownProposal = (pid: string): boolean => !!pid && !pid.includes('/') && model.proposals.some(p => p.id === pid);
  /** Review M6: the proposal update of a decision whose mark landed; [Reintentar] re-runs it, and only it. */
  let pending: { pid: string; change: Record<string, unknown> } | null = null;
  const retryUpdate = async () => {
    const p = pending;
    if (busy || !p || ui.notice !== 'markSaved' || model.isOwner !== true || !knownProposal(p.pid)) return;
    if (!db || model.readOnly) { setReadOnly(); schedule(); return; }
    if (model.proposalsReadOnly) { schedule(); return; }
    busy = true;
    try {
      await db.doc(`proposals/${p.pid}`).update(p.change);
      pending = null;
      ui.notice = null;
    } catch (e) {
      if (isInvalidArgument(e)) { pending = null; setProposalsReadOnly(); }
    } finally {
      busy = false;
      schedule();
    }
  };
  const decide = async (pid: string, decision: 'approve' | 'reject') => {
    if (busy || !knownProposal(pid)) return;
    // §4.1: only the roadmap's owner decides; the page never writes a decision for anyone else.
    if (model.isOwner !== true) return;
    const raw = decision === 'reject' ? ui.reasonDraft.slice(0, MAX_PROPOSAL_TEXT) : '';
    const reason = raw.trim() ? raw : '';
    if (!db || model.readOnly) { setReadOnly(); schedule(); return; }
    if (model.proposalsReadOnly) { schedule(); return; }
    // The text the owner read when they clicked: the proposal as the page shows it.
    const shown = model.proposals.find(x => x.id === pid)!;
    busy = true;
    try {
      const id = await userId(await getUser());
      if (!id) { setReadOnly(); return; }
      // Re-read first: someone (or forge) may have decided it meanwhile. Not atomic, like answers.
      const ref = db.doc(`proposals/${pid}`);
      const snap = await ref.get();
      const cur = snap?.exists ? normalizeProposal(snap.data()) : null;
      // Review I2: an approval edited after the owner approved it is decided again, like a proposed one.
      if (!cur || !(canDecide(cur.status) || unmarkedReason(pid, cur, model.approvals) === 'edited')) { ui.notice = 'decided'; return; }
      // C2: the mark binds the normalized text just re-read. The owner decides only the text they read: one edited since
      // the page showed it is left alone (its snapshot is on its way).
      const digest = proposalDigest(pid, cur);
      if (digest !== proposalDigest(pid, shown)) { ui.notice = 'changed'; return; }
      const status: ApprovalDoc['status'] = decision === 'approve' ? 'approved' : 'rejected';
      const at = new Date(now()).toISOString();
      // §4.1: the owner's mark first, in approvals/ (only the owner can write it: a rule the server enforces), and the
      // proposal only once the mark is in. `set` replaces the whole mark: a rejection leaves nothing of an older approval.
      const mark = { status, decidedAt: at, by: 'page', digest } satisfies ApprovalDoc;
      try { await db.doc(`approvals/${pid}`).set(mark); }
      catch (e) { ui.notice = isInvalidArgument(e) ? 'owner' : 'failed'; return; }
      const change = { status, decidedBy: `user:${id}`, decidedAt: at, ...(reason ? { reason } : {}) };
      pending = null;
      try { await ref.update(change); ui.notice = null; }
      catch (e) {
        // A refused write locks the proposals (below). Review M6: any other failure leaves the mark saved and the proposal
        // as it was: the notice says so and its retry re-runs only this update.
        if (isInvalidArgument(e)) throw e;
        pending = { pid, change };
        ui.notice = 'markSaved';
      }
      if (decision === 'reject') { ui.rejecting = null; ui.reasonDraft = ''; }
    } catch (e) {
      if (isInvalidArgument(e)) setProposalsReadOnly(); else ui.notice = 'failed';
    } finally {
      busy = false;
      schedule();
    }
  };
  // §4.1: [Confirmar], the owner's mark for an approval without one (taken before the marks existed, or by forge before
  // 4a): the status the proposal already has and the digest of the text the page shows, written only to approvals/, like
  // `/forge:decide <id> confirm`. Review I2: never for an approval edited after the owner's mark; that one is decided
  // again with Approve or Reject.
  const confirmMark = async (pid: string) => {
    if (busy || !knownProposal(pid) || model.isOwner !== true) return;
    const p = model.proposals.find(x => x.id === pid)!;
    const status = p.status;
    // C3: the same rule as the card's line and its button.
    if ((status !== 'approved' && status !== 'auto_approved') || unmarkedReason(pid, p, model.approvals) !== 'no-mark') return;
    if (!db || model.readOnly) { setReadOnly(); schedule(); return; }
    if (model.proposalsReadOnly) { schedule(); return; }
    busy = true;
    try {
      const mark = { status, decidedAt: new Date(now()).toISOString(), by: 'page', digest: proposalDigest(pid, p) } satisfies ApprovalDoc;
      await db.doc(`approvals/${pid}`).set(mark);
      ui.notice = null;
    } catch (e) {
      ui.notice = isInvalidArgument(e) ? 'owner' : 'failed';
    } finally {
      busy = false;
      schedule();
    }
  };
  const sendComment = async (pid: string) => {
    const text = ui.commentDraft.slice(0, MAX_NOTE);
    if (!text.trim() || busy || !knownProposal(pid)) return;
    if (!db || model.readOnly) { setReadOnly(); schedule(); return; }
    if (model.proposalsReadOnly) { schedule(); return; }
    busy = true;
    try {
      const id = await userId(await getUser());
      if (!id) { setReadOnly(); return; }
      await db.collection('notes').add({ ts: new Date(now()).toISOString(), type: 'idea', author: `user:${id}`, text, proposalId: pid });
      ui.commenting = null;
      ui.commentDraft = '';
      ui.notice = null;
    } catch (e) {
      if (isInvalidArgument(e)) setProposalsReadOnly(); else ui.notice = 'failed';
    } finally {
      busy = false;
      schedule();
    }
  };

  const toggle = <T>(list: T[], items: T[]): T[] => (items.every(i => list.includes(i)) ? list.filter(x => !items.includes(x)) : [...list, ...items.filter(i => !list.includes(i))]);

  const onClick = (ev: Event) => {
    const el = (ev.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
    if (!el) return;
    if (composing) endComposition(); // a click is an explicit action: render it
    const action = el.dataset.action;
    if (action === 'close-modal' && el.classList.contains('overlay') && ev.target !== el) return; // clicks inside the dialog
    if (suppressClick) { suppressClick = false; return; } // the end of a drag on the timeline is not a click
    if (action === 'zoom') { ui.zoom = el.dataset.zoom as Zoom; ui.offset = 0; ui.span = undefined; ui.pan = undefined; }
    else if (action === 'shift') {
      const dir = Number(el.dataset.dir);
      if (ui.span) ui.pan = dir === 0 ? 0 : clampPan((ui.pan ?? 0) + dir * ui.span * 0.5);
      else ui.offset = dir === 0 ? 0 : ui.offset + dir;
    }
    else if (action === 'fit') {
      const r = planRange(model.plan, model.states, model.now);
      ui.span = clampSpan(r.to - r.from);
      ui.pan = panFor(r.from, ui.span, model.now);
    }
    else if (action === 'tl-all') {
      const ids = ui.timelineGroup === 'track' ? model.plan.tracks.map(t => t.id) : model.plan.phases.map(p => p.id);
      ui.expanded = el.dataset.open === '1' ? new Set(ids) : new Set();
    }
    else if (action === 'scale') { setScale(userScale + (Number(el.dataset.dir) > 0 ? 0.1 : -0.1)); return; }
    else if (action === 'toggle-phase') { const id = el.dataset.id!; ui.expanded.has(id) ? ui.expanded.delete(id) : ui.expanded.add(id); }
    else if (action === 'open-task' || action === 'open-bar') { if (!openDetail(el.dataset.id ?? '', el)) return; }
    else if (action === 'close-modal') { closeDetail(); return; }
    else if (action === 'open-shot') { const i = Number(el.dataset.i); ui.shot = Number.isInteger(i) && i >= 0 ? i : null; if (ui.shot !== null) focusNext = '.lightbox'; }
    else if (action === 'close-shot') { if (ui.shot !== null) focusNext = byKey(`shot:${ui.shot}`); ui.shot = null; }
    else if (action === 'detail-tab') { const k = el.dataset.tab as DetailTab; if (!DETAIL_TABS.includes(k)) return; ui.tab = k; focusNext = `#dtab-${k}`; }
    // H-25: a view (from the nav or a link inside a view) is a new history entry; a link may say which conversation.
    else if (action === 'view') {
      const v = el.dataset.view as View;
      ui.view = VIEWS.includes(v) ? v : 'summary';
      if (ui.view !== 'schedule') ui.tl = undefined;
      const c = el.dataset.c as TalkKind | undefined;
      if (ui.view === 'talk' && c && TALK_KINDS.includes(c)) ui.talk = c;
      // A link inside the detail closes it: the view it opens takes the focus (the link is gone with the detail).
      if (ui.modal) { ui.modal = null; ui.shot = null; trailAt = 0; opener = null; focusNext = 'main'; }
      linked = null;
      if (ui.notice !== 'readonly') ui.notice = null;
      pushNext = true;
    }
    else if (action === 'talk-c') {
      const c = el.dataset.c as TalkKind;
      if (!TALK_KINDS.includes(c)) return;
      ui.talk = c;
      linked = null;
      if (ui.notice !== 'readonly') ui.notice = null;
      pushNext = true;
    }
    else if (action === 'tgroup') {
      const g = el.dataset.group as UiState['timelineGroup'];
      ui.timelineGroup = (GROUPS as readonly string[]).includes(g) ? g : 'phase';
    }
    else if (action === 'tl-status' || action === 'tl-layer') {
      const k = el.dataset.key ?? '';
      const allowed: readonly string[] = action === 'tl-status' ? TL_STATUSES : TL_LAYERS;
      if (!allowed.includes(k)) return;
      const cur = new Set(action === 'tl-status' ? ui.statuses ?? [] : ui.layers ?? []);
      cur.has(k) ? cur.delete(k) : cur.add(k);
      if (action === 'tl-status') ui.statuses = [...cur]; else ui.layers = [...cur];
    }
    else if (action === 'export') { void exportTimeline(el.dataset.format === 'png' ? 'png' : 'svg'); return; }
    else if (action === 'vfilter') {
      const k = el.dataset.key as VFilterKey;
      if (!VFILTER_KEYS.includes(k)) return;
      const f = ui.versionFilter;
      if (k === 'committed' || k === 'provisional') f.phaseStatuses = toggle(f.phaseStatuses, [k]);
      else f.statuses = toggle<TaskStatus>(f.statuses, vfilterStatuses(k));
    }
    else if (action === 'toggle-cat') { const k = el.dataset.key ?? ''; ui.collapsed.has(k) ? ui.collapsed.delete(k) : ui.collapsed.add(k); }
    else if (action === 'expand-all') { ui.collapsed.clear(); }
    else if (action === 'collapse-all') { ui.collapsed = new Set(categoryKeys(model.plan)); }
    else if (action === 'nfilter') { const k = el.dataset.filter as UiState['noteFilter']; if (!NOTE_FILTERS.includes(k)) return; ui.noteFilter = k; }
    else if (action === 'answer-open') { ui.answering = el.dataset.id ?? null; ui.answerDraft = ''; ui.notice = null; }
    // G-24: [Visto] marks the deferred findings of the listed tasks as seen, in this browser only.
    else if (action === 'seen-deferred') {
      const seen = { ...(model.seenDeferred ?? {}) };
      for (const id of (el.dataset.ids ?? '').split(' ')) {
        const at = isPlanId(id) ? model.states[id]?.doneAt : undefined;
        if (at) seen[id] = at;
      }
      model.seenDeferred = seen;
      writeSeen(seen);
      model.rev = (model.rev ?? 0) + 1;
    }
    else if (action === 'pfilter') {
      const kind = el.dataset.kind as ProposalFilterKind;
      if (!Object.prototype.hasOwnProperty.call(PROPOSAL_FILTERS, kind)) return;
      const v = el.dataset.value ?? '';
      if (!(PROPOSAL_FILTERS[kind] as readonly string[]).includes(v)) return;
      (ui.proposalFilter as Record<ProposalFilterKind, string>)[kind] = v;
    }
    else if (action === 'p-reject-open') { ui.rejecting = el.dataset.id ?? null; ui.reasonDraft = ''; ui.notice = null; }
    else if (action === 'p-comment-open') { ui.commenting = el.dataset.id ?? null; ui.commentDraft = ''; ui.notice = null; }
    else if (action === 'p-approve') { void decide(el.dataset.id ?? '', 'approve'); return; }
    else if (action === 'p-confirm') { void confirmMark(el.dataset.id ?? ''); return; }
    else if (action === 'p-retry') { void retryUpdate(); return; }
    else if (action === 'p-reject-send') { void decide(el.dataset.id ?? '', 'reject'); return; }
    else if (action === 'p-comment-send') { void sendComment(el.dataset.id ?? ''); return; }
    else if (action === 'note-add') { void addNote(); return; }
    else if (action === 'answer-send') { void sendAnswer(el.dataset.id ?? ''); return; }
    else return;
    schedule();
  };
  const onChange = (ev: Event) => {
    const el = ev.target as HTMLSelectElement;
    const action = el.dataset?.action;
    if (action === 'vtrack') { ui.versionFilter.track = el.value || null; }
    else if (action === 'burn-scope') { ui.burnScope = /^(?:[vp]:[\w.-]{1,64})?$/.test(el.value) ? el.value : ''; }
    else if (action === 'note-type') { if (!(NOTE_TYPES as string[]).includes(el.value)) return; ui.draft.type = el.value as NoteType; }
    else return;
    schedule();
  };
  const onInput = (ev: Event) => {
    const el = ev.target as HTMLInputElement;
    const role = el.dataset?.role;
    if (role === 'search') { ui.search = el.value; schedule(); }
    // Drafts are only stored: re-rendering would replace the textarea under the keyboard.
    else if (role === 'note-text') {
      ui.draft.text = el.value.slice(0, MAX_NOTE);
      if (ui.notice && ui.notice !== 'readonly') { ui.notice = null; schedule(); }
    }
    else if (role === 'answer-text') ui.answerDraft = el.value.slice(0, MAX_NOTE);
    else if (role === 'reason-text') ui.reasonDraft = el.value.slice(0, MAX_PROPOSAL_TEXT);
    else if (role === 'comment-text') ui.commentDraft = el.value.slice(0, MAX_NOTE);
  };
  const onCompStart = () => {
    composing = true;
    if (ceiling !== null) timers.clearTimeout(ceiling);
    ceiling = timers.setTimeout(() => { ceiling = null; endComposition(); }, COMPOSE_CEILING_MS);
  };
  const onCompEnd = () => endComposition();
  const onFocusOut = (ev: Event) => {
    const target = ev.target as HTMLElement | null;
    const role = target?.dataset?.role;
    if (composing && role && DRAFT_ROLES.includes(role)) endComposition();
  };
  // ---- Timeline: free zoom and pan ----
  // The first wheel zoom, drag or key turns the preset window into a free one (span and pan in ms).
  const freeze = () => {
    if (ui.span) return;
    const w = timelineWindow(ui, model.now);
    ui.span = w.to - w.from;
    ui.pan = panFor(w.from, ui.span, model.now);
  };
  const canvasOf = (t: EventTarget | null) => (t as Element | null)?.closest?.('[data-role="tl-canvas"]') as HTMLElement | null;
  const zoomBy = (factor: number, at: number) => {
    freeze();
    const z = zoomAround(timelineWindow(ui, model.now), factor, at, model.now);
    ui.span = z.span;
    ui.pan = z.pan;
    scheduleFrame();
  };
  const panBy = (fraction: number) => { freeze(); ui.pan = clampPan((ui.pan ?? 0) + fraction * (ui.span ?? 0)); scheduleFrame(); };
  const onWheel = (ev: WheelEvent) => {
    const canvas = canvasOf(ev.target);
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const unit = ev.deltaMode === 1 ? 30 : ev.deltaMode === 2 ? rect.width : 1;
    if (ev.ctrlKey || ev.metaKey) {
      ev.preventDefault();
      zoomBy(Math.exp(Math.max(-60, Math.min(60, ev.deltaY * unit)) * 0.004), rect.width ? (ev.clientX - rect.left) / rect.width : 0.5);
    } else if (ev.shiftKey || Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) {
      ev.preventDefault();
      panBy(((ev.deltaX || ev.deltaY) * unit) / Math.max(1, rect.width));
    }
  };
  let drag: { x: number; pan: number; span: number; width: number; moved: boolean } | null = null;
  let suppressClick = false;
  const onPointerDown = (ev: PointerEvent) => {
    if (ev.button !== 0) return;
    const mm = (ev.target as Element | null)?.closest?.('[data-role="minimap"]') as HTMLElement | null;
    if (mm) { mmDrag = true; centreAt(ev, mm); return; }
    const canvas = canvasOf(ev.target);
    if (!canvas) return;
    freeze();
    drag = { x: ev.clientX, pan: ui.pan ?? 0, span: ui.span ?? 0, width: canvas.getBoundingClientRect().width || 1, moved: false };
  };
  const onPointerMove = (ev: PointerEvent) => {
    if (mmDrag) { const mm = env.root.querySelector('[data-role="minimap"]') as HTMLElement | null; if (mm) centreAt(ev, mm); return; }
    if (!drag || pinch) return;
    const dx = ev.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 4) return;
    drag.moved = true;
    ui.pan = clampPan(drag.pan - (dx * drag.span) / drag.width);
    scheduleFrame();
  };
  const onPointerUp = () => {
    mmDrag = false;
    if (drag?.moved) { suppressClick = true; setTimeout(() => { suppressClick = false; }, 0); }
    drag = null;
  };
  let overTimeline = false;
  const onPointerOver = (ev: PointerEvent) => { overTimeline = !!(ev.target as Element | null)?.closest?.('[data-role="timeline"]'); };
  const onKey = (ev: KeyboardEvent) => {
    // A key of an IME composition is the composition's (Escape cancels it there; Safari's keydown that ends one has
    // isComposing false and keyCode 229); a combination the page does not list (Alt+←, Ctrl+Tab, Ctrl+Escape…) is the
    // browser's.
    if (ev.isComposing || ev.keyCode === 229) return;
    const bare = !ev.ctrlKey && !ev.metaKey && !ev.altKey;
    if (ev.key === 'Escape' && bare && !ev.shiftKey && ui.shot !== null) { focusNext = byKey(`shot:${ui.shot}`); ui.shot = null; schedule(); return; }
    if (ev.key === 'Escape' && bare && !ev.shiftKey && ui.modal) { closeDetail(); return; }
    // G-15: Tab and Shift+Tab stay inside the open dialog (the gallery over the detail, else the detail). From a field too:
    // Tab types nothing there, it only moves the focus.
    if (ev.key === 'Tab' && bare && ui.modal) {
      const box = ((ui.shot !== null ? env.root.querySelector('.lightbox') : null) ?? env.root.querySelector('.modal')) as HTMLElement | null;
      if (!box) return;
      const list = Array.from(box.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]'))
        .filter(el => el.getAttribute('tabindex') !== '-1' && !el.closest('[hidden]'));
      const first = list[0] ?? box;
      const last = list[list.length - 1] ?? box;
      const active = document.activeElement;
      if (!box.contains(active) || active === box || (ev.shiftKey && active === first) || (!ev.shiftKey && active === last)) {
        ev.preventDefault();
        (ev.shiftKey ? last : first).focus();
      }
      return;
    }
    // §4.7: the arrows, Home and End move between the tabs of the detail.
    const target = ev.target as HTMLElement | null;
    if (ui.modal && bare && !ev.shiftKey && target?.getAttribute?.('role') === 'tab' && env.root.contains(target) && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(ev.key)) {
      const tabs = Array.from(env.root.querySelectorAll<HTMLElement>('.modal [role="tab"]'), b => b.dataset.tab as DetailTab);
      if (!tabs.length) return;
      const at = tabs.indexOf(target.dataset.tab as DetailTab);
      const next = ev.key === 'Home' ? 0 : ev.key === 'End' ? tabs.length - 1 : (at + (ev.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      ui.tab = tabs[next];
      focusNext = `#dtab-${tabs[next]}`;
      ev.preventDefault();
      schedule();
      return;
    }
    const t = ev.target as HTMLElement | null;
    if (ui.modal || ev.ctrlKey || ev.metaKey || ev.altKey || (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) return;
    const inTimeline = overTimeline || !!t?.closest?.('[data-role="timeline"]');
    if (!inTimeline || ui.view !== 'schedule') return;
    if (ev.key === 'ArrowLeft') panBy(-0.15);
    else if (ev.key === 'ArrowRight') panBy(0.15);
    else if (ev.key === '+' || ev.key === '=') zoomBy(0.8, 0.5);
    else if (ev.key === '-' || ev.key === '_') zoomBy(1.25, 0.5);
    else if (ev.key === '0') { ui.span = undefined; ui.pan = undefined; ui.offset = 0; schedule(); }
    else return;
    ev.preventDefault();
  };

  // H-06: the schedule paints only the rows around its viewport. Its scroll (passive) says which rows are in view, as
  // proportions of the scroll so the page's zoom does not matter, and repaints before they reach the edge of what is painted.
  const onTlScroll = (ev: Event) => {
    const el = ev.target as HTMLElement | null;
    if (!el || el.getAttribute?.('data-role') !== 'timeline') return;
    const rows = Number(el.dataset.rows);
    if (!el.scrollHeight || !(rows > 0)) return;
    const first = Math.floor((el.scrollTop / el.scrollHeight) * rows);
    const count = Math.ceil((el.clientHeight / el.scrollHeight) * rows) + 1;
    // Review I1: kept below the limit too (virtualRange ignores it there), so a timeline that grows past the limit (all
    // groups opened, a search cleared) paints around the row in view and not from row 0. Only a virtualized timeline
    // repaints before its viewport reaches the edge of what is painted.
    ui.tl = { first, count };
    if (!(rows > VIRTUAL_FROM)) return;
    const start = Number(el.dataset.start);
    const end = Number(el.dataset.end);
    if ((start > 0 && first < start + 5) || (end < rows && first + count > end - 5)) scheduleFrame();
  };

  // ---- Export ----
  // The timeline as SVG or PNG through the downloads capability (the viewer confirms the save).
  const exportTimeline = async (format: 'svg' | 'png') => {
    const d = dictFor(typeof model.meta?.locale === 'string' ? model.meta.locale : undefined);
    try {
      const dl = env.claude ? (await env.claude.use('downloads')) as { save(r: { filename: string; data: string | Blob }): Promise<unknown> } | null : null;
      if (!dl) { note(d.tl.exportFailed); return; }
      const svg = timelineSvg(model, ui);
      const base = `${(model.meta?.name ?? 'roadmap').replace(/[^\w.-]+/g, '-')}-timeline`;
      if (format === 'svg') { await dl.save({ filename: `${base}.svg`, data: new Blob([svg], { type: 'image/svg+xml' }) }); note(d.tl.exported); return; }
      const img = new Image();
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      try {
        await new Promise<void>((ok, fail) => { img.onload = () => ok(); img.onerror = () => fail(new Error('svg')); img.src = url; });
        const canvas = document.createElement('canvas');
        canvas.width = img.width * 2;
        canvas.height = img.height * 2;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('canvas');
        ctx.scale(2, 2);
        ctx.drawImage(img, 0, 0);
        const png = await new Promise<Blob | null>(ok => canvas.toBlob(ok, 'image/png'));
        if (!png) throw new Error('png');
        await dl.save({ filename: `${base}.png`, data: png });
        note(d.tl.exported);
      } finally { URL.revokeObjectURL(url); }
    } catch (e) {
      const code = (e as { code?: string } | null)?.code;
      if (code !== 'declined') note(d.tl.exportFailed);
    }
  };

  // ---- Minimap: a press or a drag centres the view there ----
  let mmDrag = false;
  const centreAt = (ev: PointerEvent, mm: HTMLElement) => {
    const from = Number(mm.dataset.from);
    const to = Number(mm.dataset.to);
    const r = mm.getBoundingClientRect();
    if (!Number.isFinite(from) || !Number.isFinite(to) || !r.width) return;
    freeze();
    const t = from + ((ev.clientX - r.left) / r.width) * (to - from);
    ui.pan = panFor(t - (ui.span ?? 0) / 2, ui.span ?? 0, model.now);
    scheduleFrame();
  };

  // ---- Dependencies on hover: what a task needs and what it unlocks, with arrows ----
  const clearDeps = () => {
    env.root.querySelectorAll('.dep-up,.dep-down,.dep-self').forEach(n => n.classList.remove('dep-up', 'dep-down', 'dep-self'));
    const svg = env.root.querySelector('[data-role="tl-arrows"]');
    if (svg) svg.innerHTML = '';
  };
  const showDeps = (id: string) => {
    clearDeps();
    const task = model.plan.tasks.find(t => t.id === id);
    if (!task) return;
    const needs = new Set(task.depends_on);
    const unlocks = new Set(model.plan.tasks.filter(t => t.depends_on.includes(id)).map(t => t.id));
    if (!needs.size && !unlocks.size) return;
    env.root.querySelectorAll<HTMLElement>('[data-task]').forEach(n => {
      const t = n.dataset.task!;
      if (t === id) n.classList.add('dep-self');
      else if (needs.has(t)) n.classList.add('dep-up');
      else if (unlocks.has(t)) n.classList.add('dep-down');
    });
    const canvas = env.root.querySelector('[data-role="tl-canvas"]') as HTMLElement | null;
    const svg = env.root.querySelector('[data-role="tl-arrows"]') as SVGSVGElement | null;
    if (!canvas || !svg) return;
    const box = canvas.getBoundingClientRect();
    const z = Number(getComputedStyle(env.root).zoom) || 1;
    const sel = (t: string) => ((globalThis as { CSS?: { escape?(s: string): string } }).CSS?.escape?.(t) ?? t.replace(/["\\]/g, ''));
    const bar = (t: string) => canvas.querySelector<HTMLElement>(`.gb[data-task="${sel(t)}"]`)?.getBoundingClientRect() ?? null;
    const me = bar(id);
    if (!me) return;
    // Rects are in viewport pixels; the SVG draws in the canvas's own (unzoomed) pixels.
    const P = (x: number, y: number) => `${((x - box.left) / z).toFixed(1)} ${((y - box.top) / z).toFixed(1)}`;
    const arrow = (a: DOMRect, b: DOMRect, cls: string) => {
      const x1 = a.right; const y1 = a.top + a.height / 2; const x2 = b.left; const y2 = b.top + b.height / 2;
      const mid = Math.max(x1 + 10 * z, (x1 + x2) / 2);
      return `<path class="${cls}" d="M${P(x1, y1)} C${P(mid, y1)} ${P(mid, y2)} ${P(x2, y2)}" marker-end="url(#ah-${cls})"/>`;
    };
    let out = '<defs><marker id="ah-up" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z"/></marker><marker id="ah-down" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z"/></marker></defs>';
    for (const t of needs) { const b = bar(t); if (b) out += arrow(b, me, 'up'); }
    for (const t of unlocks) { const b = bar(t); if (b) out += arrow(me, b, 'down'); }
    svg.innerHTML = out;
  };
  let hoverTask: string | null = null;
  // H-06: after a repaint the arrows point at where the bars were: the layer empties, and the next pointerover (even on
  // the same task) draws them again. Carry 4: the highlight classes go with them (the render does not carry them).
  const dropArrows = () => {
    const svg = env.root.querySelector('[data-role="tl-arrows"]');
    if (svg?.firstChild) svg.innerHTML = '';
    hoverTask = null;
  };
  const onDepOver = (ev: PointerEvent) => {
    if (drag?.moved) return;
    const el = (ev.target as Element | null)?.closest?.('[data-task]') as HTMLElement | null;
    const id = el?.dataset.task ?? null;
    if (id === hoverTask) return;
    hoverTask = id;
    if (id) showDeps(id); else clearDeps();
  };

  // ---- Pinch to zoom on touch screens ----
  const touches = new Map<number, number>();
  let pinch: { dist: number; at: number } | null = null;
  const onTouchDown = (ev: PointerEvent) => {
    if (ev.pointerType !== 'touch' || !canvasOf(ev.target)) return;
    touches.set(ev.pointerId, ev.clientX);
    if (touches.size === 2) {
      const [a, b] = [...touches.values()];
      const r = (canvasOf(ev.target) as HTMLElement).getBoundingClientRect();
      pinch = { dist: Math.abs(a - b) || 1, at: r.width ? ((a + b) / 2 - r.left) / r.width : 0.5 };
      drag = null; // two fingers zoom; they do not pan
    }
  };
  const onTouchMove = (ev: PointerEvent) => {
    if (!touches.has(ev.pointerId)) return;
    touches.set(ev.pointerId, ev.clientX);
    if (!pinch || touches.size !== 2) return;
    const [a, b] = [...touches.values()];
    const dist = Math.abs(a - b) || 1;
    zoomBy(pinch.dist / dist, pinch.at);
    pinch.dist = dist;
  };
  const onTouchUp = (ev: PointerEvent) => { touches.delete(ev.pointerId); if (touches.size < 2) pinch = null; };

  // ---- UI scale ----
  // The page grows with wide screens (a 4K window draws as a 1920-wide one at twice the size) and the viewer can
  // adjust it; the adjustment is a per-viewer convenience kept in this browser.
  const SCALE_KEY = 'waypoint.scale';
  let userScale = 1;
  try { const v = Number(localStorage.getItem(SCALE_KEY)); if (v >= 0.6 && v <= 2) userScale = v; } catch { /* no storage */ }
  const applyScale = () => {
    const w = typeof window !== 'undefined' ? window.innerWidth : 0;
    const auto = w ? Math.min(2.2, Math.max(1, w / 1920)) : 1;
    const z = Math.round(auto * userScale * 100) / 100;
    (env.root.style as CSSStyleDeclaration & { zoom: string }).zoom = z === 1 ? '' : String(z);
    // vh units grow with the zoom: the stylesheet divides by --z to keep full-height boxes one screen tall.
    env.root.style.setProperty('--z', String(z));
  };
  const setScale = (v: number) => {
    userScale = Math.round(Math.min(2, Math.max(0.6, v)) * 10) / 10;
    try { localStorage.setItem(SCALE_KEY, String(userScale)); } catch { /* no storage */ }
    applyScale();
  };
  applyScale();
  env.root.addEventListener('click', onClick);
  env.root.addEventListener('change', onChange);
  env.root.addEventListener('input', onInput);
  env.root.addEventListener('compositionstart', onCompStart);
  env.root.addEventListener('compositionend', onCompEnd);
  env.root.addEventListener('focusout', onFocusOut);
  document.addEventListener('keydown', onKey);
  env.root.addEventListener('wheel', onWheel, { passive: false });
  env.root.addEventListener('pointerdown', onPointerDown);
  env.root.addEventListener('pointerover', onPointerOver);
  env.root.addEventListener('pointerover', onDepOver);
  env.root.addEventListener('pointerdown', onTouchDown);
  window.addEventListener('pointermove', onTouchMove);
  window.addEventListener('pointerup', onTouchUp);
  window.addEventListener('pointercancel', onTouchUp);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  window.addEventListener('resize', applyScale);
  window.addEventListener('popstate', onUrl);
  window.addEventListener('hashchange', onUrl);
  env.root.addEventListener('scroll', onTlScroll, { capture: true, passive: true });
  // G-01: every 30 s only the relative times are rewritten in place; every FULL_EVERY ticks (5 min) a full render.
  const FULL_EVERY = 10;
  let ticks = 0;
  const tick = () => {
    model.now = now();
    const d = dictFor(typeof model.meta?.locale === 'string' ? model.meta.locale : undefined);
    env.root.querySelectorAll<HTMLElement>('[data-rel]').forEach(el => {
      const kind = el.dataset.rel as RelKind;
      if (kind === 'ago' || kind === 'lasts' || kind === 'hb' || kind === 'dur') el.textContent = relText(d, kind, el.dataset.ts ?? '', model.now);
    });
    if (++ticks % FULL_EVERY === 0) schedule();
  };
  const timer = setInterval(tick, env.refreshMs ?? 30000);
  const unsubs: (() => void)[] = [];
  const stop = () => {
    clearInterval(timer);
    document.documentElement.classList.remove('wp-modal');
    unsubs.splice(0).forEach(u => u());
    env.root.removeEventListener('click', onClick);
    env.root.removeEventListener('change', onChange);
    env.root.removeEventListener('input', onInput);
    env.root.removeEventListener('compositionstart', onCompStart);
    env.root.removeEventListener('compositionend', onCompEnd);
    env.root.removeEventListener('focusout', onFocusOut);
    if (ceiling !== null) { timers.clearTimeout(ceiling); ceiling = null; }
    document.removeEventListener('keydown', onKey);
    env.root.removeEventListener('wheel', onWheel);
    env.root.removeEventListener('pointerdown', onPointerDown);
    env.root.removeEventListener('pointerover', onPointerOver);
    env.root.removeEventListener('pointerover', onDepOver);
    env.root.removeEventListener('pointerdown', onTouchDown);
    window.removeEventListener('pointermove', onTouchMove);
    window.removeEventListener('pointerup', onTouchUp);
    window.removeEventListener('pointercancel', onTouchUp);
    if (tlNoteTimer) clearTimeout(tlNoteTimer);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    window.removeEventListener('resize', applyScale);
    window.removeEventListener('popstate', onUrl);
    window.removeEventListener('hashchange', onUrl);
    env.root.removeEventListener('scroll', onTlScroll, true);
  };

  render();

  try { db = env.claude ? ((await env.claude.use('db')) as Db | null) : null; } catch { db = null; }
  model.connecting = false;
  if (!db) { model.offline = true; model.readOnly = true; settleLink(true); schedule(); return { stop, model, ui }; }

  model.offline = false;
  const onErr = () => { model.offline = true; schedule(); };
  // Review N2: a pending link settles on the plan's own failure (the plan will not come), and on meta/project's only while
  // there is no meta to build the plan with; another subscription's failure leaves it waiting for the plan.
  const onPlanErr = () => { settleLink(true); onErr(); };
  const onMetaErr = () => { if (!model.meta) settleLink(true); onErr(); };
  const rebuild = () => { if (model.meta && phaseDocs.length) model.plan = planViewFromDocs(model.meta, phaseDocs); };
  // A-10: the metrics live in meta/metrics; a roadmap a forge before wave 4 wrote keeps them in meta/project.metrics.
  // Carry 7: no meta yet (an empty snapshot) is a missing project, which mergeMetrics takes as it is.
  let projectMetrics: MetaDoc['metrics'] | null = model.meta ? model.meta.metrics : null;
  let metricsDoc: MetaDoc['metrics'] | null = null;
  const withMetrics = () => { if (model.meta) model.meta = { ...model.meta, metrics: mergeMetrics(projectMetrics, metricsDoc) }; };
  // H-04: with ?debug=1, each snapshot of a collection replaces its list of what the normalizers dropped or coerced.
  const reporter = (key: string): ((doc: string) => Report | undefined) => {
    if (!model.debug) return () => undefined;
    const list: Drop[] = [];
    model.dropped = { ...model.dropped, [key]: list };
    return doc => (field, action, detail) => { list.push({ doc, field, action, detail }); };
  };
  const rows = (s: QSnap) => s.docs.map(x => ({ id: x.id, body: x.data() }));

  unsubs.push(db.doc('meta/project').onSnapshot(((s: Snap) => { if (s.exists) { const mm = normalizeMeta(s.data(), reporter('meta/project')('meta/project')); if (mm) { projectMetrics = mm.metrics; model.meta = mm; withMetrics(); rebuild(); settleLink(); } } changed(); }) as never, onMetaErr));
  unsubs.push(db.doc('meta/metrics').onSnapshot(((s: Snap) => { metricsDoc = s.exists ? normalizeMetrics(s.data(), reporter('meta/metrics')('meta/metrics')) : null; withMetrics(); changed(); }) as never, onErr));
  unsubs.push(db.doc('meta/run').onSnapshot(((s: Snap) => { model.run = s.exists ? normalizeRun(s.data(), reporter('meta/run')('meta/run')) : null; changed(); }) as never, onErr));
  unsubs.push(db.doc('meta/infinite').onSnapshot(((s: Snap) => { model.infinite = s.exists ? normalizeInfinite(s.data(), reporter('meta/infinite')('meta/infinite')) : null; changed(); }) as never, onErr));
  unsubs.push(db.collection('plan').onSnapshot(((s: QSnap) => { const rep = reporter('plan'); const p = rows(s).map(r => normalizePhase(r.body, rep(`plan/${r.id}`))).filter((x): x is PhaseDoc => x !== null); if (p.length) { phaseDocs = p; rebuild(); } planSnap = true; settleLink(); changed(); }) as never, onPlanErr));
  unsubs.push(db.collection('state').onSnapshot(((s: QSnap) => {
    const rep = reporter('state');
    model.states = Object.fromEntries(rows(s).map(r => [r.id, normalizeState(r.body, rep(`state/${r.id}`))])) as States;
    // G-14: from here on the states are the database's; the strip says when they synced instead of the snapshot's date.
    model.statesAt = null;
    model.syncedAt = now();
    // G-24: with the database's states in, the marks that no longer mean anything (merged, older than 7 days, redone) go.
    if (!seenPruned) {
      seenPruned = true;
      const before = model.seenDeferred ?? {};
      const kept = pruneSeen(before, model);
      if (Object.keys(kept).length !== Object.keys(before).length) writeSeen(kept);
      model.seenDeferred = kept;
    }
    changed();
  }) as never, onErr));
  unsubs.push(db.collection('sessions').onSnapshot(((s: QSnap) => { model.sessions = Object.fromEntries(rows(s).map(r => [r.id, normalizeSession(r.body)])) as Record<string, SessionDoc>; changed(); }) as never, onErr));
  unsubs.push(db.collection('events').orderBy('ts', 'desc').limit(200).onSnapshot(((s: QSnap) => { model.events = rows(s).map(r => ({ ...normalizeEvent(r.body), id: r.id })); changed(); }) as never, onErr));
  unsubs.push(db.collection('messages').orderBy('ts', 'desc').limit(200).onSnapshot(((s: QSnap) => {
    model.messages = rows(s).map(r => ({ m: normalizeMessage(r.body), id: r.id })).filter((r): r is { m: MessageDoc; id: string } => r.m !== null).map(r => ({ ...r.m, id: r.id }));
    changed();
  }) as never, onErr));
  unsubs.push(db.collection('notes').orderBy('ts', 'desc').limit(500).onSnapshot(((s: QSnap) => {
    model.notes = rows(s).map(r => ({ n: normalizeNote(r.body), id: String(r.id) })).filter((r): r is { n: NoteDoc; id: string } => r.n !== null).map(r => ({ ...r.n, id: r.id }));
    changed();
  }) as never, onErr));
  unsubs.push(db.collection('proposals').orderBy('ts', 'desc').limit(500).onSnapshot(((s: QSnap) => {
    model.proposals = rows(s).map(r => ({ p: normalizeProposal(r.body), id: String(r.id) }))
      .filter((r): r is { p: ProposalDoc; id: string } => r.p !== null && !!r.id && !r.id.includes('/')).map(r => ({ ...r.p, id: r.id }));
    changed();
  }) as never, onErr));
  // §4.1: the owner's marks; only well-formed ones under an id without a path separator count. A record without a
  // prototype, so no id (say, __proto__) is anything but a key. Carry 5: bounded like the other collections, the newest
  // decisions first, at twice the proposals the page keeps: the mark of a proposal it shows is left out only behind a
  // thousand newer decisions.
  unsubs.push(db.collection('approvals').orderBy('decidedAt', 'desc').limit(1000).onSnapshot(((s: QSnap) => {
    const marks = Object.create(null) as Record<string, ApprovalDoc>;
    for (const r of rows(s)) {
      const key = String(r.id);
      const mark = normalizeApproval(r.body);
      if (key && !key.includes('/') && mark) marks[key] = mark;
    }
    model.approvals = marks;
    changed();
  }) as never, onErr));
  schedule();

  // Who is viewing: "you" labels, the "Mine" filter and whether the composer can write.
  const u = await getUser();
  const id = await userId(u);
  model.me = id ? `user:${id}` : null;
  if (!id) model.readOnly = true;
  // §4.1: whether the viewer owns the roadmap decides which proposal buttons show; anything but true is no.
  try { model.isOwner = !!u && typeof u.isOwner === 'function' && (await u.isOwner()) === true; } catch { model.isOwner = false; }
  changed();
  return { stop, model, ui };
}
