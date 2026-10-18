// Cronograma (spec §4.6.4). In 4b, the timeline and the analysis of the old Tracking view; Task 6 virtualizes its rows,
// and 4c adds «Ajustar», the one forecast, the burndown against the version target and the aggregated zones.
import { autoTicks, fitWindow, groupIds, layoutRows, NONE_GROUP, phaseLabel, phaseName, planRange, SPAN, windowAt, windowFor, type GroupBy, type Row, type Win, type Zoom } from '../../lib/timeline.js';
import { statusOf } from '../../lib/deps.js';
import { burndown, targetMs, type Burndown, type ZoneHeat } from '../../lib/insights.js';
import type { TaskStatus } from '../../lib/types.js';
import type { Derived } from '../derive.js';
import { dictFor, type Dict } from '../i18n.js';
import { esc, eviMark, fmt, forecastTitle, labelOf, trackTag } from '../html.js';
import type { Model, TlView, UiState } from '../model.js';

export function renderScheduleView(m: Model, d: Dict, ui: UiState, loc: string, dv: Derived): string {
  return `<header class="hd"><h1>${esc(d.views.schedule)}</h1></header>
    ${renderTimeline(m, d, ui, loc, dv)}
    ${insightsOf(m, d, ui, loc, dv)}`;
}

/**
 * C31 (carry 4b-1): the analysis reads only the data, the burndown's scope and width and the locale, so it is built once
 * per data revision and minute (one Derived of derive(), whose cache has that key), scope, width and locale: a search
 * key, a pan step or «Desplegar todo» repaints the page with the string already built. Keyed by the Derived itself, so a
 * render with a fresh one (computeDerived, as renderApp without one does) always builds it.
 */
const insightsMemo = new WeakMap<Derived, { key: string; html: string }>();
function insightsOf(m: Model, d: Dict, ui: UiState, loc: string, dv: Derived): string {
  const key = `${ui.burnScope ?? ''}\n${ui.width ?? ''}\n${loc}`;
  const hit = insightsMemo.get(dv);
  if (hit && hit.key === key) return hit.html;
  const html = renderInsights(m, d, ui, loc, dv);
  insightsMemo.set(dv, { key, html });
  return html;
}

/** H-06: from this many rows (after folding and filtering), the timeline paints only those around its viewport. */
export const VIRTUAL_FROM = 150;
/** Rows painted above and below the viewport. */
export const VIRTUAL_PAD = 20;
/** The rows a viewport holds before the first scroll says it (a 960 px timeline of 28 px rows). */
const VIEW_ROWS = 35;

/** The rows to paint, [start, end), or null when every row is painted (total ≤ VIRTUAL_FROM). */
export function virtualRange(total: number, tl?: TlView): { start: number; end: number } | null {
  if (total <= VIRTUAL_FROM) return null;
  const first = Math.min(total, Math.max(0, Math.floor(tl?.first ?? 0)));
  const count = tl && tl.count > 0 ? Math.ceil(tl.count) : VIEW_ROWS;
  return { start: Math.max(0, first - VIRTUAL_PAD), end: Math.min(total, first + count + VIRTUAL_PAD) };
}

const ZOOMS: Zoom[] = ['6h', '1d', '3d', '1w', '1m'];

/** The timeline window: free zoom and pan when set; else «Ajustar» while ui.fit (H-14); else the zoom preset shifted by
 *  whole spans. */
export function timelineWindow(m: Model, ui: UiState): Win {
  if (ui.span) return windowAt(ui.span, m.now, ui.pan ?? 0);
  if (ui.fit) return fitWindow(m.plan, m.states, m.now);
  return windowFor(ui.zoom, m.now, ui.offset);
}

/** H-14: the phases in progress: some task taken or done, and some not done. */
export function phasesInProgress(m: Model): string[] {
  return m.plan.phases.filter(p => {
    const ts = m.plan.tasks.filter(t => t.phase === p.id);
    const done = ts.filter(t => statusOf(m.states, t.id) === 'done').length;
    return ts.length > 0 && done < ts.length && ts.some(t => statusOf(m.states, t.id) !== 'free');
  }).map(p => p.id);
}

/** H-14: the groups the schedule shows open: every one while searching; the phases in progress while ui.autoOpen (none in
 *  other groupings); else the ones the person opened. */
export function openGroups(m: Model, ui: UiState, groupBy: GroupBy): Set<string> {
  if (ui.search.trim()) return new Set(groupIds(m.plan, m.states, groupBy));
  if (ui.autoOpen) return new Set(groupBy === 'phase' ? phasesInProgress(m) : []);
  return ui.expanded;
}

/** The schedule's groupings (app.ts checks a clicked or linked one against these). */
export const GROUPS: readonly GroupBy[] = ['phase', 'track', 'session', 'category'];
export const TL_STATUSES = ['in_progress', 'blocked', 'free', 'done'] as const;
export const TL_LAYERS = ['critical', 'forecast', 'forge'] as const;

/** The timeline rows as drawn: grouping, open groups (all of them while searching), status filter and search. */
function timelineRows(m: Model, d: Dict, ui: UiState, win: Win): { rows: Row[]; groupBy: GroupBy; expanded: Set<string> } {
  const q = ui.search.trim().toLowerCase();
  const groupBy: GroupBy = GROUPS.includes(ui.timelineGroup) ? ui.timelineGroup : 'phase';
  const expanded = openGroups(m, ui, groupBy);
  // 'in_progress' in the filter also covers claimed tasks.
  const statuses = ui.statuses?.length ? ui.statuses.flatMap(x => (x === 'in_progress' ? ['in_progress', 'claimed'] : x === 'blocked' ? ['blocked', 'orphaned'] : [x])) : undefined;
  const rows = layoutRows(m.plan, m.states, m.now, win, expanded, { groupBy, statuses, unassigned: d.tl.unassigned, uncategorized: d.tl.uncategorized })
    .filter(r => !q || r.kind === 'phase' || r.label.toLowerCase().includes(q) || r.id.toLowerCase().includes(q));
  return { rows, groupBy, expanded };
}

function groupLabel(m: Model, groupBy: GroupBy, r: Row): string {
  if (groupBy === 'track') return trackTag(m, r.id);
  if (groupBy === 'session' && r.id !== NONE_GROUP) return `◎ ${esc(r.label)}`;
  // G-21, H-13: the phase id as it is, then its name (upper case by CSS), the id never repeated.
  if (groupBy === 'phase') {
    const name = phaseName(r.id, m.plan.phases.find(p => p.id === r.id)?.name ?? '');
    return `<span class="k">${esc(r.id)}</span>${name ? ` <span class="pn">${esc(name)}</span>` : ''}`;
  }
  return esc(r.label);
}

/** The forge mark of a row (layer «Revisiones»). K4-05: an accepted task reads its round and its findings by severity;
 *  the reviewers' score is not a grade of the task, so it goes only in the title. */
function forgeBadge(m: Model, d: Dict, id: string): string {
  const f = m.states[id]?.forge;
  if (!f) return '';
  const v = f.verdict;
  const title = v && typeof v.score === 'number' ? ` title="${esc(`${d.forge.verdict}: ${v.score.toFixed(2)}`)}"` : '';
  const doc = 'v' in f && f.v === 2 ? f : null;
  if (doc && doc.acceptedRound !== null) {
    const r = doc.rounds.find(x => x.brief === doc.brief && x.n === doc.acceptedRound) ?? doc.rounds[doc.rounds.length - 1];
    const counts = r ? ` · ${r.findings.critical} C · ${r.findings.important} I · ${r.findings.minor} m` : '';
    return ` <span class="fg ok"${title}>${esc(`✓ r${doc.acceptedRound}${counts}`)}</span>`;
  }
  const cls = v?.action === 'accept' ? 'ok' : v?.action === 'redo' ? 'del' : 'warn';
  const label = v ? labelOf(d.action, v.action) : doc ? labelOf(d.run.stage, doc.stage) : f.phase;
  return ` <span class="fg ${v ? cls : ''}"${title}>⚒ ${esc(label)}${typeof f.round === 'number' ? ` · r${f.round}${typeof f.cap === 'number' ? `/${f.cap}` : ''}` : ''}</span>`;
}

function renderTimeline(m: Model, d: Dict, ui: UiState, loc: string, dv: Derived): string {
  const win = timelineWindow(m, ui);
  const { rows, groupBy, expanded } = timelineRows(m, d, ui, win);
  const deps = (id: string) => m.plan.tasks.find(t => t.id === id)?.depends_on ?? [];
  // H-06: past VIRTUAL_FROM rows only those around the viewport are painted, between two spacers of the height of the rest.
  const vr = virtualRange(rows.length, ui.tl);
  const painted = vr ? rows.slice(vr.start, vr.end) : rows;
  const pad = (n: number) => (vr ? `<div class="vpad" style="height:calc(var(--rh) * ${n})"></div>` : '');
  const padTop = vr ? pad(vr.start) : '';
  const padBottom = vr ? pad(rows.length - vr.end) : '';
  // A row's arrows are drawn only to painted rows: its title lists every task it needs and unlocks.
  const unlocksOf = new Map<string, string[]>();
  for (const t of m.plan.tasks) for (const dep of t.depends_on) unlocksOf.set(dep, [...(unlocksOf.get(dep) ?? []), t.id]);
  const rowTitle = (id: string, label: string, status: string): string => {
    const needs = deps(id);
    const unl = unlocksOf.get(id) ?? [];
    return [id, label, status, needs.length ? `${d.tl.blockedBy}: ${needs.join(', ')}` : '', unl.length ? `${d.tl.unlocks}: ${unl.join(', ')}` : ''].filter(Boolean).join(' · ');
  };
  const pos = (t: number) => ((t - win.from) / (win.to - win.from)) * 100;
  const nowLeft = pos(m.now);
  const span = win.to - win.from;
  const withDate = span > 30 * 3600000;
  // H-14: «Ajustar» is the pressed preset while the window fits the plan.
  const fitted = !!ui.fit && !ui.span;
  const preset = fitted ? undefined : ZOOMS.find(z => (ui.span ? Math.abs(SPAN[z] - ui.span) < 1 : z === ui.zoom));
  const tz = new Date(m.now).getTimezoneOffset();
  const layers = new Set(ui.layers ?? []);
  const filter = new Set(ui.statuses ?? []);
  const crit = layers.has('critical') ? new Set(dv.critical.ids) : new Set<string>();
  const ids = groupIds(m.plan, m.states, groupBy);
  const allOpen = ids.every(id => expanded.has(id));
  const st = (r: { status?: string }) => (r.status && Object.hasOwn(d.status, r.status) ? r.status as TaskStatus : 'free');
  const left = painted.map(r => {
    if (r.kind === 'phase') {
      const pct = r.total ? Math.round(((r.done ?? 0) / r.total) * 100) : 0;
      return `<button type="button" class="tr ph" data-action="toggle-phase" data-id="${esc(r.id)}" data-k="p:${esc(r.id)}" aria-expanded="${expanded.has(r.id)}" title="${esc(r.label)} · ${esc(r.counter)}"><span class="chev">${expanded.has(r.id) ? '⌄' : '›'}</span> <span class="lab">${groupLabel(m, groupBy, r)}</span><span class="mini"><i style="width:${pct}%"></i></span><span class="c">${esc(r.counter)}</span></button>`;
    }
    const s = st(r);
    return `<button type="button" class="tr tk${crit.has(r.id) ? ' crit' : ''}" data-action="open-task" data-id="${esc(r.id)}" data-task="${esc(r.id)}" data-deps="${esc(deps(r.id).join(' '))}" data-k="t:${esc(r.id)}" title="${esc(rowTitle(r.id, r.label, d.status[s]))}"><i class="sd st-${s}"></i><span class="k">${esc(r.id)}</span> <span class="lab">${esc(r.label)}</span>${eviMark(m, d, r.id)}${layers.has('forge') ? forgeBadge(m, d, r.id) : ''} ${groupBy === 'track' ? '' : trackTag(m, r.trackId)}</button>`;
  }).join('');
  const kindLabel = (k: string) => (k === 'estimate' ? d.legend.estimate : k === 'done' ? d.legend.done : k === 'blocked' ? d.legend.blocked : d.legend.current);
  const right = painted.map(r => {
    const task = r.kind === 'task';
    const bars = r.bars.map(b => `<div class="gb ${b.kind}${task && crit.has(r.id) ? ' crit' : ''}" style="left:${b.left}%;width:${b.width}%" title="${esc(task ? `${r.id} · ${r.label}` : r.label)} · ${esc(kindLabel(b.kind))}${r.durationMin != null ? ` · ${r.durationMin} min` : ''}"${task ? ` data-action="open-bar" data-id="${esc(r.id)}" data-task="${esc(r.id)}"` : ''} aria-hidden="true"></div>`).join('');
    // H-12: a label only for a real bar (never for an estimate); it never crosses the now line when its bar ended before
    // now, and under 4 points there is none (the title keeps it).
    const b0 = r.bars[0];
    let label = '';
    if (task && b0 && b0.kind !== 'estimate') {
      const left = Math.min(b0.left + b0.width + 0.6, 80);
      const max = b0.left + b0.width <= nowLeft && left < nowLeft ? Math.min(100 - left, nowLeft - left - 0.6) : 100 - left;
      if (max >= 4) label = `<div class="gl" style="left:${left}%;max-width:${max.toFixed(1)}%">${esc(r.label)}${r.durationMin != null ? ` · ${r.durationMin} min` : ''}</div>`;
    }
    return `<div class="rr${r.kind === 'phase' ? ' ph' : ''}"${task ? ` data-task="${esc(r.id)}"` : ''}>${bars}${label}</div>`;
  }).join('');
  const tickList = autoTicks(win, 10, tz);
  // H-12: the edge ticks are pinned to their edge, and the one next to the visible now line gives way to it.
  const nowShown = nowLeft >= 0 && nowLeft <= 100;
  const tickHtml = tickList.map(t => {
    const p = pos(t);
    const cls = [p < 3 ? 'edge-l' : p > 97 ? 'edge-r' : '', nowShown && Math.abs(p - nowLeft) < 6 ? 'near-now' : ''].filter(Boolean).join(' ');
    return `<span${cls ? ` class="${cls}"` : ''} style="left:${p}%">${esc(fmt(new Date(t).toISOString(), loc, withDate))}</span>`;
  }).join('');
  const grid = tickList.map(t => `<i style="left:${pos(t)}%"></i>`).join('');
  let band = '';
  if (layers.has('forecast')) {
    const f = dv.forecast;
    if (f) {
      // G-12: the work left, from now to the one forecast end.
      const a = Math.max(0, Math.min(100, pos(m.now)));
      const b = Math.max(0, Math.min(100, pos(f.at)));
      if (b > 0 && a < 100) band = `<div class="fc" style="left:${a}%;width:${Math.max(0.4, b - a)}%" title="${esc(forecastTitle(d, f, loc))}"><span>${esc(d.tl.forecastEnd)}</span></div>`;
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
      <input class="search" name="search" data-role="search" placeholder="${esc(d.search)}" value="${esc(ui.search)}">
    </div>
    <div class="tools">
      <div class="chips" data-scroll-key="chips:status"><span class="lbl">${esc(d.tl.show)}</span>${TL_STATUSES.map(k => chip('status', k, statusLabel(k), filter.has(k))).join('')}</div>
      <div class="chips" data-scroll-key="chips:layers"><span class="lbl">${esc(d.tl.layers)}</span>${TL_LAYERS.map(k => chip('layer', k, layerLabel(k), layers.has(k))).join('')}</div>
      <div class="zoom" data-scroll-key="zoom">${ZOOMS.map(z => `<button type="button" data-action="zoom" data-zoom="${z}" class="${z === preset ? 'on' : ''}" aria-pressed="${z === preset}">${esc(d.zoom[z])}</button>`).join('')}
        <button type="button" data-action="fit" class="${fitted ? 'on' : ''}" aria-pressed="${fitted}">${esc(d.tl.fit)}</button>
        <button data-action="shift" data-dir="-1" aria-label="‹">‹</button><button data-action="shift" data-dir="0">${esc(d.now)}</button><button data-action="shift" data-dir="1" aria-label="›">›</button>
        <button data-action="export" data-format="svg" class="xp" title="${esc(d.tl.export)} SVG">⤓ SVG</button><button data-action="export" data-format="png" class="xp" title="${esc(d.tl.export)} PNG">⤓ PNG</button></div>
    </div>
    <div class="tlw" data-role="timeline" data-scroll-key="timeline" data-rows="${rows.length}"${vr ? ` data-start="${vr.start}" data-end="${vr.end}"` : ''} tabindex="0" aria-label="${esc(d.tl.hint)}">
    <div class="tl">
      <div class="l"><div class="tr axis"></div>${padTop}${left}${padBottom}</div>
      <div class="r" data-role="tl-canvas"><div class="ticks">${tickHtml}</div><div class="grid">${grid}</div>${band}${padTop}${right}${padBottom}
        ${nowLeft >= 0 && nowLeft <= 100 ? `<div class="now" style="left:${nowLeft}%"><span>${esc(d.now)}</span></div>` : ''}
        <svg class="arrows" data-role="tl-arrows" data-morph="skip" aria-hidden="true"></svg></div>
    </div>
    </div>
    ${renderMinimap(m, d, win, dv)}
    <div class="legend">${(['done', 'current', 'blocked', 'estimate'] as const).map(k => `<span><i class="lg ${k}"></i>${esc(d.legend[k])}</span>`).join('')}<span><i class="lg nowl"></i>${esc(d.legend.now)}</span>${layers.has('critical') ? `<span><i class="lg critl"></i>${esc(d.tl.critical)}</span>` : ''}${layers.has('forecast') ? `<span><i class="lg fcl"></i>${esc(d.tl.forecastEnd)}</span>` : ''}<span class="hint">${esc(d.tl.hint)}</span></div>
    <div class="tlnote" data-role="tl-note" aria-live="polite"></div>
  </section>`;
}

/** The minimap's box height, in the units of its viewBox. */
const MM_VB = 48;
/** The minimap's bars, drawn over the whole plan (planRange): one row per phase (per track past 24 phases). */
interface MiniBars { range: Win; groupBy: GroupBy; rows: number; bars: string }
/** C31 (carry 4b-1): the minimap's bars read only the data: built once per data revision and minute (one Derived of
 *  derive()), like the analysis; a search key, a pan step or «Desplegar todo» moves only the window drawn over them. */
const minimapMemo = new WeakMap<Derived, MiniBars | null>();
function miniBarsOf(m: Model, dv: Derived): MiniBars | null {
  if (minimapMemo.has(dv)) return minimapMemo.get(dv)!;
  const range = planRange(m.plan, m.states, m.now);
  const groupBy: GroupBy = m.plan.phases.length > 24 ? 'track' : 'phase';
  const groups = layoutRows(m.plan, m.states, m.now, range, new Set(), { groupBy }).filter(r => r.kind === 'phase');
  let out: MiniBars | null = null;
  if (groups.length) {
    const rowH = Math.min(44 / groups.length, 8);
    const barH = Math.max(0.6, 0.8 * rowH);
    const bars = groups.map((r, i) => r.bars.map(b => `<rect class="mb ${b.kind}" x="${b.left * 10}" y="${(2 + i * rowH + (rowH - barH) / 2).toFixed(2)}" width="${Math.max(2, b.width * 10)}" height="${barH.toFixed(2)}" rx="1"/>`).join('')).join('');
    out = { range, groupBy, rows: groups.length, bars };
  }
  minimapMemo.set(dv, out);
  return out;
}

/** G-22, H-03: the minimap: one row per phase (per track past 24 phases), compressed over the whole plan, window marked.
 *  A window that reaches past the plan widens the box, and the bars (built over the plan) are scaled into it. */
function renderMinimap(m: Model, d: Dict, win: Win, dv: Derived): string {
  const mb = miniBarsOf(m, dv);
  if (!mb) return '';
  const { range } = mb;
  const from = Math.min(range.from, win.from);
  const to = Math.max(range.to, win.to);
  const x = (t: number) => ((t - from) / (to - from)) * 1000;
  // Within a millisecond of the plan's range (a fitted window), the bars are drawn as they were built.
  const inside = range.from - from < 1 && to - range.to < 1;
  const bars = inside ? mb.bars : `<g transform="translate(${x(range.from).toFixed(3)} 0) scale(${((range.to - range.from) / (to - from)).toFixed(6)} 1)">${mb.bars}</g>`;
  const vx = x(win.from);
  const vw = ((win.to - win.from) / (to - from)) * 1000;
  const nx = x(m.now);
  return `<div class="mm" data-role="minimap" data-from="${from}" data-to="${to}" data-group="${mb.groupBy}" data-rows="${mb.rows}" title="${esc(d.tl.minimap)}">
    <svg viewBox="0 0 1000 ${MM_VB}" preserveAspectRatio="none" aria-label="${esc(d.tl.minimap)}">${bars}
      <line class="mnow" x1="${nx}" x2="${nx}" y1="0" y2="${MM_VB}"/>
      <rect class="mv" x="${vx}" y="0.5" width="${Math.max(4, vw)}" height="${MM_VB - 1}" rx="3"/></svg></div>`;
}

/** The analysis under the timeline (§4.6.4): the burndown of a scope against its version's target (H-26), the critical
 *  path with the one forecast end and how it is reckoned (G-12), and the code zones by directory (G-27). */
function renderInsights(m: Model, d: Dict, ui: UiState, loc: string, dv: Derived): string {
  const f = dv.forecast;
  // The target of a scope: a version's own; a phase reads the version it belongs to; the whole plan, its last version's.
  const versionOf = (phase: string) => m.plan.versions.find(v => v.phases.includes(phase));
  const scopes = [
    { id: '', label: d.insights.wholePlan, ids: m.plan.tasks.map(t => t.id), target: m.plan.versions.at(-1)?.target },
    ...m.plan.versions.map(v => ({ id: `v:${v.id}`, label: `${d.version} ${v.id}`, ids: m.plan.tasks.filter(t => v.phases.includes(t.phase)).map(t => t.id), target: v.target })),
    ...m.plan.phases.map(p => ({ id: `p:${p.id}`, label: phaseLabel(p.id, p.name), ids: m.plan.tasks.filter(t => t.phase === p.id).map(t => t.id), target: versionOf(p.id)?.target })),
  ];
  const scope = scopes.find(sc => sc.id === (ui.burnScope ?? '')) ?? scopes[0]!;
  const bd = burndown(m.plan, m.states, scope.ids, m.now, { forecast: f?.at ?? null, target: targetMs(scope.target) });
  const chart = bd ? burnChart(d, bd, m.now, loc, ui.width) : `<div class="muted">${esc(d.insights.allDone)}</div>`;
  // 4b (Close b): every field of the page has a name.
  const scopeSel = `<select name="burn-scope" data-action="burn-scope" aria-label="${esc(d.insights.scope)}">${scopes.map(sc => `<option value="${esc(sc.id)}"${sc.id === scope.id ? ' selected' : ''}>${esc(sc.label)}</option>`).join('')}</select>`;
  const cp = dv.critical;
  const chain = cp.ids.length
    ? `<div class="mono">${esc(d.insights.chain(cp.ids.length, cp.minutes))}</div><ol class="chain" data-scroll-key="chain">${cp.ids.map(id => {
        const t = m.plan.tasks.find(x => x.id === id);
        const raw = m.states[id]?.status ?? 'free';
        const s = Object.hasOwn(d.status, raw) ? raw : 'free';
        return `<li><button type="button" class="cpl" data-action="open-task" data-id="${esc(id)}" data-k="cp:${esc(id)}"><i class="sd st-${s}"></i><span class="k">${esc(id)}</span> ${esc(t?.title ?? '')}</button></li>`;
      }).join('')}</ol>`
    : `<div class="muted">${esc(d.insights.allDone)}</div>`;
  // G-12, riesgo 10: the date, and in one line how it is reckoned.
  const fc = f ? `<div class="fct">${esc(d.insights.forecastLine(fmt(new Date(f.at).toISOString(), loc), f.parallel, d.num(Math.round(dv.pace * 100) / 100)))}</div>` : '';
  return `<section class="insights">
    <h2 class="lbl">${esc(d.insights.title)}</h2>
    <div class="row3 ins">
      <div class="card"><div class="ch"><span class="lbl">${esc(d.insights.burndown)}</span>${scopeSel}</div>${chart}</div>
      <div class="card"><div class="lbl">${esc(d.insights.critical)}</div>${fc}${chain}</div>
      <div class="card"><div class="lbl">${esc(d.insights.zones)}</div>${zoneList(d, dv.zones.slice(0, 12))}</div>
    </div>
  </section>`;
}

/** H-26: the burndown at the width it has (ui.width, from a ResizeObserver; 520 until it reports), its labels in HTML of
 *  11 px and up, the ideal line only towards a target, and the target day marked. */
function burnChart(d: Dict, bd: Burndown, now: number, loc: string, width: number | undefined): string {
  const W = Math.round(Math.min(2000, Math.max(240, Number.isFinite(width) ? width! : 520)));
  const H = 160;
  const PAD = 8;
  const px = (t: number) => PAD + ((t - bd.start) / Math.max(1, bd.end - bd.start)) * (W - 2 * PAD);
  const py = (left: number) => PAD + (1 - left / Math.max(1, bd.total)) * (H - 2 * PAD);
  const at = (v: number, of: number) => `${((v / of) * 100).toFixed(2)}%`;
  const steps = bd.actual.map((p, i) => (i === 0 ? `M${px(p.t).toFixed(1)} ${py(p.left).toFixed(1)}` : `H${px(p.t).toFixed(1)} V${py(p.left).toFixed(1)}`)).join(' ');
  const yTicks = [...new Set([0, Math.round(bd.total / 2), bd.total])];
  const ideal = bd.ideal
    ? `<line class="bdi" x1="${px(bd.ideal[0]!.t).toFixed(1)}" y1="${py(bd.ideal[0]!.left).toFixed(1)}" x2="${px(bd.ideal[1]!.t).toFixed(1)}" y2="${py(0).toFixed(1)}"/>`
    : '';
  const target = bd.target !== null ? `<line class="bdtg" x1="${px(bd.target).toFixed(1)}" x2="${px(bd.target).toFixed(1)}" y1="${PAD}" y2="${H - PAD}"/>` : '';
  const svg = `<svg class="bd" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${yTicks.map(v => `<line class="bdg" x1="${PAD}" x2="${W - PAD}" y1="${py(v).toFixed(1)}" y2="${py(v).toFixed(1)}"/>`).join('')}${target}${ideal}<path class="bda" d="${steps}"/><line class="bdn" x1="${px(now).toFixed(1)}" x2="${px(now).toFixed(1)}" y1="${PAD}" y2="${H - PAD}"/></svg>`;
  const labels = [
    ...yTicks.map(v => `<span class="bdk y" style="top:${at(py(v), H)}">${v}</span>`),
    `<span class="bdk x l">${esc(fmt(new Date(bd.start).toISOString(), loc))}</span>`,
    `<span class="bdk x r">${esc(fmt(new Date(bd.end).toISOString(), loc))}</span>`,
    bd.target !== null ? `<span class="bdk tg" style="left:${at(px(bd.target), W)}">${esc(d.insights.target(fmt(new Date(bd.target).toISOString(), loc)))}</span>` : '',
  ].join('');
  const left = bd.actual[bd.actual.length - 1]!.left;
  const legend = `<div class="legend"><span><i class="lg bdl-a"></i>${esc(d.insights.actual)}</span>${bd.ideal ? `<span><i class="lg bdl-i"></i>${esc(d.insights.ideal)}</span>` : `<span class="hint">${esc(d.insights.noTarget)}</span>`}<span class="mono">${left} ${esc(d.insights.tasksLeft)}</span></div>`;
  return `<div class="bdw" data-role="burndown" role="img" aria-label="${esc(d.insights.burndownLabel(left, bd.total))}"><div class="bdc">${svg}${labels}</div></div>${legend}`;
}

/** G-27: the code zones by directory, the shared ones marked, with a legend of the bar. */
function zoneList(d: Dict, heat: ZoneHeat[]): string {
  if (!heat.length) return `<div class="muted">${esc(d.insights.noZones)}</div>`;
  const max = Math.max(1, ...heat.map(z => z.tasks + z.touched));
  const w = (n: number) => `${((n / max) * 100).toFixed(1)}%`;
  const items = heat.map(z => `<li class="zl${z.shared ? ' shared' : ''}"><div class="zn"><span class="mono">${esc(z.zone)}</span><span class="k">${esc(d.insights.zoneLine(z.tasks, z.done, z.active))}${z.touched ? ` · ${esc(d.insights.touched(z.touched))}` : ''}</span></div>${z.shared ? `<div class="zs">⚠ ${esc(d.insights.shared(z.active))}</div>` : ''}
      <div class="zb"><i class="zd" style="width:${w(z.done)}"></i><i class="za" style="width:${w(z.active)}"></i><i class="zp" style="width:${w(Math.max(0, z.tasks - z.done - z.active))}"></i><i class="zt" style="width:${w(z.touched)}"></i></div></li>`).join('');
  const legend = `<div class="legend zlg">${(['done', 'active', 'pending', 'touched'] as const).map((k, i) => `<span><i class="lg ${['zd', 'za', 'zp', 'zt'][i]}"></i>${esc(d.insights.zoneLegend[k])}</span>`).join('')}</div>`;
  return `<ul class="zones" data-scroll-key="zones">${items}</ul>${legend}`;
}

/**
 * The timeline as a standalone SVG for export: the visible window, every row as drawn, the ticks and now. Fonts and
 * colours are written in, so the file reads the same anywhere.
 */
export function timelineSvg(m: Model, ui: UiState): string {
  const d = dictFor(m.meta?.locale);
  const loc = m.meta?.locale ?? 'en';
  const win = timelineWindow(m, ui);
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
