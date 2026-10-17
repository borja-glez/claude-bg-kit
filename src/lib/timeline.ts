import type { PlanView, States, TaskState } from './types.js';

export type Zoom = '6h' | '1d' | '3d' | '1w' | '1m';
const H = 3600000;
export const SPAN: Record<Zoom, number> = { '6h': 6 * H, '1d': 24 * H, '3d': 72 * H, '1w': 168 * H, '1m': 720 * H };
const TICK: Record<Zoom, number> = { '6h': H, '1d': 2 * H, '3d': 6 * H, '1w': 24 * H, '1m': 72 * H };
export const DEFAULT_ESTIMATE_MIN = 30;

export interface Win { from: number; to: number }
export type BarKind = 'done' | 'current' | 'blocked' | 'estimate';
export interface Bar { left: number; width: number; kind: BarKind }
export interface Row { id: string; kind: 'phase' | 'task'; label: string; counter?: string; trackId?: string; bars: Bar[]; durationMin?: number; status?: string; done?: number; total?: number }

const round2 = (n: number) => Math.round(n * 100) / 100;

export function windowFor(zoom: Zoom, now: number, offset = 0): Win {
  const span = SPAN[zoom];
  const to = now + span * 0.25 + offset * span;
  return { from: to - span, to };
}

export function ticks(win: Win, zoom: Zoom): number[] {
  const step = TICK[zoom];
  const out: number[] = [];
  for (let t = Math.ceil(win.from / step) * step; t < win.to; t += step) out.push(t);
  return out;
}

export function clipBar(start: number, end: number, kind: BarKind, win: Win): Bar | null {
  if (end < start) end = start;
  if (end < win.from || start > win.to) return null;
  const span = win.to - win.from;
  const l = Math.max(0, ((start - win.from) / span) * 100);
  const r = Math.min(100, ((end - win.from) / span) * 100);
  return { left: round2(l), width: round2(Math.max(r - l, 0.4)), kind };
}

export function taskSpan(state: TaskState | undefined, now: number): { start: number; end: number; kind: BarKind } | null {
  const s = state?.startedAt ?? state?.claimedAt;
  if (!state || !s) return null;
  const start = Date.parse(s);
  if (state.status === 'done') {
    const end = state.doneAt ? Date.parse(state.doneAt) : start;
    return { start, end: Math.max(start, end), kind: 'done' };
  }
  if (state.status === 'in_progress' || state.status === 'claimed') return { start, end: Math.max(start, now), kind: 'current' };
  if (state.status === 'blocked') return { start, end: Math.max(start, now), kind: 'blocked' };
  return null;
}

function estimates(plan: PlanView, states: States, now: number): Map<string, { start: number; end: number }> {
  const cursor = new Map<string, number>();
  const out = new Map<string, { start: number; end: number }>();
  for (const ph of plan.phases) {
    for (const t of plan.tasks.filter(x => x.phase === ph.id)) {
      if ((states[t.id]?.status ?? 'free') !== 'free') continue;
      const start = cursor.get(t.track) ?? now;
      const end = start + (t.estimate_min ?? DEFAULT_ESTIMATE_MIN) * 60000;
      out.set(t.id, { start, end });
      cursor.set(t.track, end);
    }
  }
  return out;
}

/**
 * G-21: a phase's name without a leading copy of its id ("H0 · Base" → "Base", "P1: Setup" → "Setup"): the id, case
 * apart, followed by the end, a space, ·, :, -, — or ., is taken off with those separators. "H10 x" is not H1's prefix.
 */
export function phaseName(id: string, name: string): string {
  const n = name.trim();
  if (!n.toLowerCase().startsWith(id.toLowerCase())) return n;
  const rest = n.slice(id.length);
  return rest === '' || /^[\s·:\-—.]/.test(rest) ? rest.replace(/^[\s·:\-—.]+/, '').trim() : n;
}
/** `id · name` without the repeated id, or only the id when nothing is left of the name. */
export const phaseLabel = (id: string, name: string): string => {
  const n = phaseName(id, name);
  return n ? `${id} · ${n}` : id;
};

export type GroupBy = 'phase' | 'track' | 'session' | 'category';
/** The id under which tasks with no owner, or no category, are grouped. */
export const NONE_GROUP = '_none';

// The row groups of the timeline: phases, tracks, the sessions that own tasks (then the unowned), or categories.
function groupsFor(
  plan: PlanView, states: States, by: GroupBy, inPhaseOrder: (l: PlanView['tasks']) => PlanView['tasks'],
  opts?: { unassigned?: string; uncategorized?: string },
): { id: string; label: string; tasks: PlanView['tasks'] }[] {
  if (by === 'track') return plan.tracks.map(tr => ({ id: tr.id, label: tr.name, tasks: inPhaseOrder(plan.tasks.filter(t => t.track === tr.id)) }));
  if (by === 'session' || by === 'category') {
    const keyOf = (t: PlanView['tasks'][number]) => (by === 'session' ? states[t.id]?.owner : t.category) || NONE_GROUP;
    const keys = [...new Set(plan.tasks.map(keyOf))].sort((a, b) => (a === NONE_GROUP ? 1 : b === NONE_GROUP ? -1 : a.localeCompare(b)));
    const none = by === 'session' ? opts?.unassigned ?? 'unassigned' : opts?.uncategorized ?? 'uncategorized';
    return keys.map(k => ({ id: k, label: k === NONE_GROUP ? none : k, tasks: inPhaseOrder(plan.tasks.filter(t => keyOf(t) === k)) }));
  }
  return plan.phases.map(ph => ({ id: ph.id, label: phaseLabel(ph.id, ph.name), tasks: plan.tasks.filter(t => t.phase === ph.id) }));
}

/** The ids of the timeline's groups for a grouping, in the order layoutRows draws them. */
export function groupIds(plan: PlanView, states: States, by: GroupBy): string[] {
  return groupsFor(plan, states, by, l => l).map(g => g.id);
}

export function layoutRows(
  plan: PlanView,
  states: States,
  now: number,
  win: Win,
  expanded: Set<string>,
  opts?: { groupBy?: GroupBy; statuses?: readonly string[]; unassigned?: string; uncategorized?: string },
): Row[] {
  const est = estimates(plan, states, now);
  const rows: Row[] = [];
  const phaseOrder = new Map(plan.phases.map((p, i) => [p.id, i]));
  const inPhaseOrder = (list: PlanView['tasks']) => list
    .map((t, i) => ({ t, i }))
    .sort((a, b) => (phaseOrder.get(a.t.phase) ?? 1e9) - (phaseOrder.get(b.t.phase) ?? 1e9) || a.i - b.i)
    .map(x => x.t);
  const groups = groupsFor(plan, states, opts?.groupBy ?? 'phase', inPhaseOrder, opts);
  const wanted = opts?.statuses?.length ? new Set(opts.statuses) : null;
  for (const g of groups) {
    const tasks = g.tasks;
    const spans = tasks.map(t => taskSpan(states[t.id], now)).filter((x): x is NonNullable<typeof x> => x !== null);
    const ests = tasks.map(t => est.get(t.id)).filter((x): x is NonNullable<typeof x> => x !== undefined);
    const bars: Bar[] = [];
    if (spans.length) {
      const kind: BarKind = spans.some(s => s.kind !== 'done') ? 'current' : 'done';
      const b = clipBar(Math.min(...spans.map(s => s.start)), Math.max(...spans.map(s => s.end)), kind, win);
      if (b) bars.push(b);
    }
    if (ests.length) {
      const b = clipBar(Math.min(...ests.map(e => e.start)), Math.max(...ests.map(e => e.end)), 'estimate', win);
      if (b) bars.push(b);
    }
    const done = tasks.filter(t => states[t.id]?.status === 'done').length;
    rows.push({ id: g.id, kind: 'phase', label: g.label, counter: `${done}/${tasks.length}`, bars, done, total: tasks.length });
    if (!expanded.has(g.id)) continue;
    for (const t of tasks) {
      if (wanted && !wanted.has(states[t.id]?.status ?? 'free')) continue;
      const sp = taskSpan(states[t.id], now);
      const e = est.get(t.id);
      const b = sp ? clipBar(sp.start, sp.end, sp.kind, win) : e ? clipBar(e.start, e.end, 'estimate', win) : null;
      rows.push({
        id: t.id,
        kind: 'task',
        label: t.title,
        trackId: t.track,
        bars: b ? [b] : [],
        durationMin: sp ? Math.round((sp.end - sp.start) / 60000) : undefined,
        status: states[t.id]?.status ?? 'free',
      });
    }
  }
  return rows;
}

// ---- Continuous zoom and pan ------------------------------------------------------------------
// The presets above set a span; the page can also zoom and pan freely (wheel, drag, keys), so the window is a span in
// ms and a pan in ms from the default anchor (now at 75% of the window).

export const MIN_SPAN = 30 * 60000;
export const MAX_SPAN = 180 * 24 * H;
export const clampSpan = (span: number): number => Math.min(MAX_SPAN, Math.max(MIN_SPAN, Number.isFinite(span) ? span : 24 * H));
/** Review M5: how far the window can move from now either way, ten years; past that a date of the window could be no
 *  valid date at all (a hand-edited pan of 14 digits of minutes made the render throw). */
export const MAX_PAN = 10 * 365 * 24 * H;
export const clampPan = (pan: number): number => Math.min(MAX_PAN, Math.max(-MAX_PAN, Number.isFinite(pan) ? pan : 0));

export function windowAt(span: number, now: number, pan = 0): Win {
  const s = clampSpan(span);
  const to = now + s * 0.25 + clampPan(pan);
  return { from: to - s, to };
}

/** The pan that puts the window [from, from + span] on screen. */
export const panFor = (from: number, span: number, now: number): number => from + span - now - span * 0.25;

/** Zooms by `factor` keeping the instant under `at` (0..1 across the window) where it is. */
export function zoomAround(win: Win, factor: number, at: number, now: number): { span: number; pan: number } {
  const span = clampSpan((win.to - win.from) * factor);
  const x = Math.min(1, Math.max(0, at));
  const pivot = win.from + x * (win.to - win.from);
  const from = pivot - x * span;
  return { span, pan: panFor(from, span, now) };
}

const STEPS = [15 * 60000, 30 * 60000, H, 2 * H, 3 * H, 6 * H, 12 * H, 24 * H, 48 * H, 168 * H, 336 * H, 720 * H];

/** Tick step for a window: the smallest of the usual steps that gives at most `max` ticks. */
export function stepFor(win: Win, max = 10): number {
  const span = win.to - win.from;
  return STEPS.find(s => span / s <= max) ?? STEPS[STEPS.length - 1];
}

/** Aligned ticks for any window; day steps fall on local midnight when `tzOffsetMin` is the viewer's offset. */
export function autoTicks(win: Win, max = 10, tzOffsetMin = 0): number[] {
  const step = stepFor(win, max);
  // getTimezoneOffset convention: local midnight is at UTC midnight + offset minutes (UTC+2 gives -120: 22:00 UTC).
  const shift = step >= 24 * H ? tzOffsetMin * 60000 : 0;
  const out: number[] = [];
  for (let t = Math.ceil((win.from - shift) / step) * step + shift; t < win.to && out.length < 200; t += step) out.push(t);
  return out;
}

/** The whole plan in time: from the earliest start (or now) to the latest estimate end (or now), with a margin. */
export function planRange(plan: PlanView, states: States, now: number): Win {
  let from = now;
  let to = now;
  for (const t of plan.tasks) {
    const sp = taskSpan(states[t.id], now);
    if (sp && Number.isFinite(sp.start) && Number.isFinite(sp.end)) { from = Math.min(from, sp.start); to = Math.max(to, sp.end); }
  }
  for (const e of estimates(plan, states, now).values()) to = Math.max(to, e.end);
  const pad = Math.max((to - from) * 0.06, 15 * 60000);
  return { from: from - pad, to: to + pad };
}

/** H-14: «Ajustar»: the window that holds the whole plan (planRange), within the zoom limits. */
export function fitWindow(plan: PlanView, states: States, now: number): Win {
  const r = planRange(plan, states, now);
  const span = clampSpan(r.to - r.from);
  return windowAt(span, now, panFor(r.from, span, now));
}
