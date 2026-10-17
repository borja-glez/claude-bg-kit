import { planViewFromDocs } from '../lib/sync.js';
import type { EventDoc, MessageDoc, MetaDoc, NoteDoc, NoteType, PhaseDoc, SessionDoc, States, TaskStatus } from '../lib/types.js';
import { clampSpan, panFor, planRange, zoomAround, type Zoom } from '../lib/timeline.js';
import { MAX_NOTE, NOTE_TYPES } from '../lib/notes.js';
import { applyDecision, canDecide, MAX_PROPOSAL_TEXT, normalizeProposal, type Decision, type ProposalDoc } from '../lib/proposals.js';
import { dictFor } from './i18n.js';
import { normalizeEvent, normalizeInfinite, normalizeMessage, normalizeMeta, normalizeNote, normalizePhase, normalizeRun, normalizeSession, normalizeState, type Drop, type Report } from './normalize.js';
import { decodeView, encodeView } from './urlstate.js';
import { categoryKeys, esc, NOTE_FILTERS, PROPOSAL_FILTERS, relText, renderApp, timelineSvg, timelineWindow, TL_LAYERS, TL_STATUSES, vfilterStatuses, VFILTER_KEYS, VIEWS, type Model, type RelKind, type ProposalFilterKind, type UiState, type VFilterKey, type View } from './render.js';

export interface Snapshot { meta: MetaDoc; phases: PhaseDoc[] }
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
}

/** A composition longer than this renders anyway (a lost compositionend must not freeze the page). */
const COMPOSE_CEILING_MS = 3000;

interface Snap { exists?: boolean; data(): unknown; id?: string }
interface QSnap { docs: (Snap & { id: string })[] }
interface Sub { onSnapshot(next: (s: never) => void, err?: (e: unknown) => void): () => void }
interface DocRef extends Sub { get(): Promise<Snap>; update(data: Record<string, unknown>): Promise<unknown> }
interface Coll extends Sub { orderBy(f: string, d?: string): { limit(n: number): Sub }; add(data: Record<string, unknown>): Promise<unknown> }
interface Db { doc(p: string): DocRef; collection(p: string): Coll }
interface User { id(): Promise<string | null> | string | null; profiles?(ids: string[]): unknown }

const TEXT_ROLES = ['search', 'note-text', 'answer-text', 'reason-text', 'comment-text'];
/** Textareas whose focus loss ends an IME composition. */
const DRAFT_ROLES = ['note-text', 'answer-text', 'reason-text', 'comment-text'];
const isInvalidArgument = (e: unknown): boolean => {
  const o = e as { code?: unknown; message?: unknown } | null;
  return o?.code === 'invalid_argument' || /invalid_argument/.test(String(o?.message ?? ''));
};

export async function start(env: Env): Promise<{ stop(): void; model: Model; ui: UiState }> {
  const now = env.now ?? Date.now;
  const ui: UiState = {
    zoom: '1d', offset: 0, expanded: new Set(), modal: null, shot: null, search: '', view: 'tracking',
    versionFilter: { statuses: [], phaseStatuses: [], track: null }, collapsed: new Set(), noteFilter: 'all', timelineGroup: 'phase',
    draft: { type: 'idea', text: '' }, answering: null, answerDraft: '', notice: null,
    proposalFilter: { status: 'all', category: 'all', risk: 'all' }, commenting: null, commentDraft: '', rejecting: null, reasonDraft: '',
  };
  // A link carries the view (see urlstate.ts): apply it before the first render.
  const GROUPS = ['phase', 'track', 'session', 'category'] as const;
  let debugHash = false;
  try {
    const v = decodeView(typeof location !== 'undefined' ? location.hash : '');
    if (v.view && (VIEWS as readonly string[]).includes(v.view)) ui.view = v.view as View;
    if (v.group && (GROUPS as readonly string[]).includes(v.group)) ui.timelineGroup = v.group as UiState['timelineGroup'];
    if (v.zoom) ui.zoom = v.zoom;
    if (v.span) { ui.span = v.span; ui.pan = v.pan ?? 0; }
    if (v.open) ui.expanded = new Set(v.open);
    if (v.status) ui.statuses = v.status.filter(x => (TL_STATUSES as readonly string[]).includes(x));
    if (v.layers) ui.layers = v.layers.filter(x => (TL_LAYERS as readonly string[]).includes(x));
    if (v.q) ui.search = v.q;
    if (v.debug) debugHash = true;
  } catch { /* no location */ }
  let lastHash = '';
  const writeHash = () => {
    try {
      const h = encodeView({ view: ui.view, group: ui.timelineGroup, zoom: ui.zoom, span: ui.span, pan: ui.pan, open: [...ui.expanded], status: ui.statuses, q: ui.search.trim(), layers: ui.layers, debug: model.debug });
      if (h === lastHash) return;
      lastHash = h;
      history.replaceState(null, '', h || `${location.pathname}${location.search}`);
    } catch { /* a sandboxed frame may refuse: the view just is not in the link */ }
  };
  let tlNote = '';
  let tlNoteTimer: ReturnType<typeof setTimeout> | null = null;
  const note = (text: string) => {
    tlNote = text;
    if (tlNoteTimer) clearTimeout(tlNoteTimer);
    tlNoteTimer = setTimeout(() => { tlNote = ''; schedule(); }, 5000);
    schedule();
  };
  let phaseDocs: PhaseDoc[] = env.snapshot?.phases ?? [];
  const model: Model = {
    meta: env.snapshot?.meta ?? null,
    plan: env.snapshot ? planViewFromDocs(env.snapshot.meta, env.snapshot.phases) : { tracks: [], versions: [], phases: [], tasks: [] },
    states: {},
    sessions: {},
    events: [],
    messages: [],
    notes: [],
    proposals: [],
    infinite: null,
    run: null,
    me: null,
    profiles: {},
    readOnly: false,
    now: now(),
    offline: false,
    connecting: true,
    debug: env.debug === true || debugHash,
    dropped: {},
  };

  // While an IME composition is active, replacing the textarea would cancel it: hold every render
  // (input, snapshots, the timer) until compositionend, focusout, a click action or the ceiling.
  const timers = env.timers ?? { setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout: (id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>) };
  let composing = false;
  let deferred = false;
  let ceiling: unknown = null;
  // G-01: a data render that arrives while the modal is open or a <select> has focus waits (↻ shows it).
  let pendingData = false;
  const endComposition = () => {
    composing = false;
    if (ceiling !== null) { timers.clearTimeout(ceiling); ceiling = null; }
    if (deferred) { deferred = false; schedule(); }
  };
  const render = () => {
    scheduled = false;
    if (composing) { deferred = true; return; }
    try {
      model.now = now();
      pendingData = false;
      const active = document.activeElement as HTMLInputElement | null;
      const role = active && env.root.contains(active) ? active.getAttribute?.('data-role') : null;
      const keep = role && TEXT_ROLES.includes(role) ? role : null;
      const caret = keep ? [active!.selectionStart, active!.selectionEnd] : null;
      // G-01: the scroll of every keyed container, and of the page, survives the repaint.
      const scrolls = new Map<string, [number, number]>();
      env.root.querySelectorAll<HTMLElement>('[data-scroll-key]').forEach(el => scrolls.set(el.dataset.scrollKey ?? '', [el.scrollTop, el.scrollLeft]));
      const page = document.scrollingElement?.scrollTop ?? 0;
      const tlw = env.root.querySelector('[data-role="timeline"]') as HTMLElement | null;
      const tlFocus = !!tlw && document.activeElement === tlw;
      env.root.innerHTML = renderApp(model, ui);
      env.root.querySelectorAll<HTMLElement>('[data-scroll-key]').forEach(el => {
        const s = scrolls.get(el.dataset.scrollKey ?? '');
        if (s) { el.scrollTop = s[0]; el.scrollLeft = s[1]; }
      });
      if (document.scrollingElement && document.scrollingElement.scrollTop !== page) document.scrollingElement.scrollTop = page;
      document.documentElement.classList.toggle('wp-modal', ui.modal !== null);
      const tlNew = env.root.querySelector('[data-role="timeline"]') as HTMLElement | null;
      if (tlNew && tlFocus && !keep) tlNew.focus({ preventScroll: true });
      const noteEl = env.root.querySelector('[data-role="tl-note"]');
      if (noteEl) noteEl.textContent = tlNote;
      writeHash();
      if (keep) {
        const input = env.root.querySelector(`[data-role="${keep}"]`) as HTMLInputElement | null;
        input?.focus();
        if (input && caret && caret[0] != null) input.setSelectionRange(caret[0], caret[1] ?? caret[0]);
      }
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
  // G-01: renders that come from data (snapshots, the full tick) wait while the modal is open or a <select> of the page
  // has focus: they mark pendingData and show ↻. Renders from the person's own actions go through schedule().
  const holding = (): boolean => {
    const a = document.activeElement;
    return ui.modal !== null || (!!a && a.tagName === 'SELECT' && env.root.contains(a));
  };
  const showPending = () => {
    const b = env.root.querySelector('[data-role="pending"]') as HTMLElement | null;
    if (b) b.hidden = false;
  };
  const scheduleData = () => {
    if (holding()) { pendingData = true; showPending(); return; }
    schedule();
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
      let changed = false;
      for (const id of ids) {
        const raw = res && typeof res === 'object' ? res[id]?.name : undefined;
        const name = typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, 80) : undefined;
        if (name !== model.profiles[id]) {
          if (name) model.profiles[id] = name; else delete model.profiles[id];
          changed = true;
        }
      }
      if (changed) schedule();
    } catch { /* names stay as the generic fallback */ }
  };

  const setReadOnly = () => { model.readOnly = true; ui.notice = 'readonly'; };
  // A refused proposal write (e.g. a roadmap without the proposals schema) locks only the proposals view.
  const setProposalsReadOnly = () => { model.proposalsReadOnly = true; if (ui.notice !== 'readonly') ui.notice = null; };

  // Writes happen only here, from event handlers, and only under notes/ and proposals/.
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
  const decide = async (pid: string, decision: Decision) => {
    if (busy || !knownProposal(pid)) return;
    const raw = decision === 'reject' ? ui.reasonDraft.slice(0, MAX_PROPOSAL_TEXT) : '';
    const reason = raw.trim() ? raw : '';
    if (!db || model.readOnly) { setReadOnly(); schedule(); return; }
    if (model.proposalsReadOnly) { schedule(); return; }
    busy = true;
    try {
      const id = await userId(await getUser());
      if (!id) { setReadOnly(); return; }
      // Re-read first: someone (or forge) may have decided it meanwhile. Not atomic, like answers.
      const ref = db.doc(`proposals/${pid}`);
      const snap = await ref.get();
      const cur = snap?.exists ? normalizeProposal(snap.data()) : null;
      if (!cur || !canDecide(cur.status)) { ui.notice = 'decided'; return; }
      await ref.update({ status: applyDecision(decision), decidedBy: `user:${id}`, decidedAt: new Date(now()).toISOString(), ...(reason ? { reason } : {}) });
      if (decision === 'reject') { ui.rejecting = null; ui.reasonDraft = ''; }
      ui.notice = null;
    } catch (e) {
      if (isInvalidArgument(e)) setProposalsReadOnly(); else ui.notice = 'failed';
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
      if (ui.span) ui.pan = dir === 0 ? 0 : (ui.pan ?? 0) + dir * ui.span * 0.5;
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
    else if (action === 'open-task') { ui.modal = el.dataset.id || null; ui.shot = null; }
    else if (action === 'close-modal') { ui.modal = null; ui.shot = null; }
    else if (action === 'open-shot') { const i = Number(el.dataset.i); ui.shot = Number.isInteger(i) && i >= 0 ? i : null; }
    else if (action === 'close-shot') { ui.shot = null; }
    else if (action === 'view') { const v = el.dataset.view as View; ui.view = VIEWS.includes(v) ? v : 'tracking'; if (ui.notice !== 'readonly') ui.notice = null; }
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
    else if (action === 'p-reject-send') { void decide(el.dataset.id ?? '', 'reject'); return; }
    else if (action === 'p-comment-send') { void sendComment(el.dataset.id ?? ''); return; }
    else if (action === 'note-add') { void addNote(); return; }
    else if (action === 'answer-send') { void sendAnswer(el.dataset.id ?? ''); return; }
    else if (action === 'refresh') { /* ↻: the render below paints what the modal held back */ }
    else return;
    schedule();
  };
  const onChange = (ev: Event) => {
    const el = ev.target as HTMLSelectElement;
    const action = el.dataset?.action;
    if (action === 'vtrack') { ui.versionFilter.track = el.value || null; }
    else if (action === 'burn-scope') { ui.burnScope = /^(?:[vp]:[\w.-]{1,64})?$/.test(el.value) ? el.value : ''; }
    else if (action === 'note-type') { if (!(NOTE_TYPES as string[]).includes(el.value)) return; ui.draft.type = el.value as NoteType; }
    else { if (pendingData && el.tagName === 'SELECT') schedule(); return; }
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
    // A <select> that loses focus lets the held data paint.
    if (pendingData && target?.tagName === 'SELECT') schedule();
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
  const panBy = (fraction: number) => { freeze(); ui.pan = (ui.pan ?? 0) + fraction * (ui.span ?? 0); scheduleFrame(); };
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
    ui.pan = drag.pan - (dx * drag.span) / drag.width;
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
    if (ev.key === 'Escape' && ui.shot !== null) { ui.shot = null; schedule(); return; }
    if (ev.key === 'Escape' && ui.modal) { ui.modal = null; schedule(); return; }
    const t = ev.target as HTMLElement | null;
    if (ui.modal || ev.ctrlKey || ev.metaKey || ev.altKey || (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) return;
    const inTimeline = overTimeline || !!t?.closest?.('[data-role="timeline"]');
    if (!inTimeline || ui.view !== 'tracking') return;
    if (ev.key === 'ArrowLeft') panBy(-0.15);
    else if (ev.key === 'ArrowRight') panBy(0.15);
    else if (ev.key === '+' || ev.key === '=') zoomBy(0.8, 0.5);
    else if (ev.key === '-' || ev.key === '_') zoomBy(1.25, 0.5);
    else if (ev.key === '0') { ui.span = undefined; ui.pan = undefined; ui.offset = 0; schedule(); }
    else return;
    ev.preventDefault();
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
  // G-01: every 30 s only the relative times are rewritten in place; every FULL_EVERY ticks (5 min) a full render comes
  // by the data path, so it waits while the modal is open or a <select> has focus.
  const FULL_EVERY = 10;
  let ticks = 0;
  const tick = () => {
    model.now = now();
    const d = dictFor(typeof model.meta?.locale === 'string' ? model.meta.locale : undefined);
    env.root.querySelectorAll<HTMLElement>('[data-rel]').forEach(el => {
      const kind = el.dataset.rel as RelKind;
      if (kind === 'ago' || kind === 'lasts' || kind === 'hb') el.textContent = relText(d, kind, el.dataset.ts ?? '', model.now);
    });
    if (++ticks % FULL_EVERY === 0) scheduleData();
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
  };

  render();

  try { db = env.claude ? ((await env.claude.use('db')) as Db | null) : null; } catch { db = null; }
  model.connecting = false;
  if (!db) { model.offline = true; model.readOnly = true; schedule(); return { stop, model, ui }; }

  model.offline = false;
  const onErr = () => { model.offline = true; schedule(); };
  const rebuild = () => { if (model.meta && phaseDocs.length) model.plan = planViewFromDocs(model.meta, phaseDocs); };
  // H-04: with ?debug=1, each snapshot of a collection replaces its list of what the normalizers dropped or coerced.
  const reporter = (key: string): ((doc: string) => Report | undefined) => {
    if (!model.debug) return () => undefined;
    const list: Drop[] = [];
    model.dropped = { ...model.dropped, [key]: list };
    return doc => (field, action, detail) => { list.push({ doc, field, action, detail }); };
  };
  const rows = (s: QSnap) => s.docs.map(x => ({ id: x.id, body: x.data() }));

  unsubs.push(db.doc('meta/project').onSnapshot(((s: Snap) => { if (s.exists) { const mm = normalizeMeta(s.data(), reporter('meta/project')('meta/project')); if (mm) { model.meta = mm; rebuild(); } } scheduleData(); }) as never, onErr));
  unsubs.push(db.doc('meta/run').onSnapshot(((s: Snap) => { model.run = s.exists ? normalizeRun(s.data(), reporter('meta/run')('meta/run')) : null; scheduleData(); }) as never, onErr));
  unsubs.push(db.doc('meta/infinite').onSnapshot(((s: Snap) => { model.infinite = s.exists ? normalizeInfinite(s.data(), reporter('meta/infinite')('meta/infinite')) : null; scheduleData(); }) as never, onErr));
  unsubs.push(db.collection('plan').onSnapshot(((s: QSnap) => { const rep = reporter('plan'); const p = rows(s).map(r => normalizePhase(r.body, rep(`plan/${r.id}`))).filter((x): x is PhaseDoc => x !== null); if (p.length) { phaseDocs = p; rebuild(); } scheduleData(); }) as never, onErr));
  unsubs.push(db.collection('state').onSnapshot(((s: QSnap) => { const rep = reporter('state'); model.states = Object.fromEntries(rows(s).map(r => [r.id, normalizeState(r.body, rep(`state/${r.id}`))])) as States; scheduleData(); }) as never, onErr));
  unsubs.push(db.collection('sessions').onSnapshot(((s: QSnap) => { model.sessions = Object.fromEntries(rows(s).map(r => [r.id, normalizeSession(r.body)])) as Record<string, SessionDoc>; scheduleData(); }) as never, onErr));
  unsubs.push(db.collection('events').orderBy('ts', 'desc').limit(200).onSnapshot(((s: QSnap) => { model.events = rows(s).map(r => ({ ...normalizeEvent(r.body), id: r.id })); scheduleData(); }) as never, onErr));
  unsubs.push(db.collection('messages').orderBy('ts', 'desc').limit(200).onSnapshot(((s: QSnap) => {
    model.messages = rows(s).map(r => ({ m: normalizeMessage(r.body), id: r.id })).filter((r): r is { m: MessageDoc; id: string } => r.m !== null).map(r => ({ ...r.m, id: r.id }));
    scheduleData();
  }) as never, onErr));
  unsubs.push(db.collection('notes').orderBy('ts', 'desc').limit(500).onSnapshot(((s: QSnap) => {
    model.notes = rows(s).map(r => ({ n: normalizeNote(r.body), id: String(r.id) })).filter((r): r is { n: NoteDoc; id: string } => r.n !== null).map(r => ({ ...r.n, id: r.id }));
    scheduleData();
  }) as never, onErr));
  unsubs.push(db.collection('proposals').orderBy('ts', 'desc').limit(500).onSnapshot(((s: QSnap) => {
    model.proposals = rows(s).map(r => ({ p: normalizeProposal(r.body), id: String(r.id) }))
      .filter((r): r is { p: ProposalDoc; id: string } => r.p !== null && !!r.id && !r.id.includes('/')).map(r => ({ ...r.p, id: r.id }));
    scheduleData();
  }) as never, onErr));
  schedule();

  // Who is viewing: "you" labels, the "Mine" filter and whether the composer can write.
  const u = await getUser();
  const id = await userId(u);
  model.me = id ? `user:${id}` : null;
  if (!id) model.readOnly = true;
  schedule();
  return { stop, model, ui };
}
