// Cronograma (spec §4.6.4). In 4b, the timeline and the analysis of the old Tracking view; Task 6 virtualizes its rows,
// and 4c adds «Ajustar», the one forecast, the burndown against the version target and the aggregated zones.
import { autoTicks, groupIds, layoutRows, NONE_GROUP, phaseLabel, phaseName, planRange, SPAN, windowAt, windowFor, type GroupBy, type Row, type Win, type Zoom } from '../../lib/timeline.js';
import { burndown } from '../../lib/insights.js';
import type { TaskStatus } from '../../lib/types.js';
import type { Derived } from '../derive.js';
import { dictFor, type Dict } from '../i18n.js';
import { esc, eviMark, fmt, trackTag } from '../html.js';
import type { Model, UiState } from '../model.js';

export function renderScheduleView(m: Model, d: Dict, ui: UiState, loc: string, dv: Derived): string {
  return `<header class="hd"><h1>${esc(d.views.schedule)}</h1></header>
    ${renderTimeline(m, d, ui, loc, dv)}
    ${renderInsights(m, d, ui, loc, dv)}`;
}

const ZOOMS: Zoom[] = ['6h', '1d', '3d', '1w', '1m'];

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
  // G-21, H-13: the phase id as it is, then its name (upper case by CSS), the id never repeated.
  if (groupBy === 'phase') {
    const name = phaseName(r.id, m.plan.phases.find(p => p.id === r.id)?.name ?? '');
    return `<span class="k">${esc(r.id)}</span>${name ? ` <span class="pn">${esc(name)}</span>` : ''}`;
  }
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

function renderTimeline(m: Model, d: Dict, ui: UiState, loc: string, dv: Derived): string {
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
  const crit = layers.has('critical') ? new Set(dv.critical.ids) : new Set<string>();
  const ids = groupIds(m.plan, m.states, groupBy);
  const allOpen = ids.every(id => expanded.has(id));
  const st = (r: { status?: string }) => (r.status && Object.hasOwn(d.status, r.status) ? r.status as TaskStatus : 'free');
  const deps = (id: string) => m.plan.tasks.find(t => t.id === id)?.depends_on ?? [];
  const left = rows.map(r => {
    if (r.kind === 'phase') {
      const pct = r.total ? Math.round(((r.done ?? 0) / r.total) * 100) : 0;
      return `<div class="tr ph" data-action="toggle-phase" data-id="${esc(r.id)}" data-k="p:${esc(r.id)}" title="${esc(r.label)} · ${esc(r.counter)}"><span class="chev">${expanded.has(r.id) ? '⌄' : '›'}</span> <span class="lab">${groupLabel(m, groupBy, r)}</span><span class="mini"><i style="width:${pct}%"></i></span><span class="c">${esc(r.counter)}</span></div>`;
    }
    const s = st(r);
    return `<div class="tr tk${crit.has(r.id) ? ' crit' : ''}" data-action="open-task" data-id="${esc(r.id)}" data-task="${esc(r.id)}" data-deps="${esc(deps(r.id).join(' '))}" data-k="t:${esc(r.id)}" title="${esc(r.id)} · ${esc(r.label)} · ${esc(d.status[s])}"><i class="sd st-${s}"></i><span class="k">${esc(r.id)}</span> <span class="lab">${esc(r.label)}</span>${eviMark(m, d, r.id)}${layers.has('forge') ? forgeBadge(m, r.id) : ''} ${groupBy === 'track' ? '' : trackTag(m, r.trackId)}</div>`;
  }).join('');
  const kindLabel = (k: string) => (k === 'estimate' ? d.legend.estimate : k === 'done' ? d.legend.done : k === 'blocked' ? d.legend.blocked : d.legend.current);
  const right = rows.map(r => {
    const task = r.kind === 'task';
    const bars = r.bars.map(b => `<div class="gb ${b.kind}${task && crit.has(r.id) ? ' crit' : ''}" style="left:${b.left}%;width:${b.width}%" title="${esc(task ? `${r.id} · ${r.label}` : r.label)} · ${esc(kindLabel(b.kind))}${r.durationMin != null ? ` · ${r.durationMin} min` : ''}"${task ? ` data-action="open-task" data-id="${esc(r.id)}" data-task="${esc(r.id)}"` : ''}></div>`).join('');
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
        <svg class="arrows" data-role="tl-arrows" data-morph="skip" aria-hidden="true"></svg></div>
    </div>
    </div>
    ${renderMinimap(m, d, win)}
    <div class="legend">${(['done', 'current', 'blocked', 'estimate'] as const).map(k => `<span><i class="lg ${k}"></i>${esc(d.legend[k])}</span>`).join('')}<span><i class="lg nowl"></i>${esc(d.legend.now)}</span>${layers.has('critical') ? `<span><i class="lg critl"></i>${esc(d.tl.critical)}</span>` : ''}${layers.has('forecast') ? `<span><i class="lg fcl"></i>${esc(d.tl.forecastEnd)}</span>` : ''}<span class="hint">${esc(d.tl.hint)}</span></div>
    <div class="tlnote" data-role="tl-note" aria-live="polite"></div>
  </section>`;
}

/** G-22, H-03: the minimap: one row per phase (per track past 24 phases), compressed over the whole plan, window marked. */
function renderMinimap(m: Model, d: Dict, win: Win): string {
  const range = planRange(m.plan, m.states, m.now);
  const from = Math.min(range.from, win.from);
  const to = Math.max(range.to, win.to);
  const groupBy: GroupBy = m.plan.phases.length > 24 ? 'track' : 'phase';
  const groups = layoutRows(m.plan, m.states, m.now, { from, to }, new Set(), { groupBy }).filter(r => r.kind === 'phase');
  if (!groups.length) return '';
  const VB = 48;
  const rowH = Math.min(44 / groups.length, 8);
  const barH = Math.max(0.6, 0.8 * rowH);
  const bars = groups.map((r, i) => r.bars.map(b => `<rect class="mb ${b.kind}" x="${b.left * 10}" y="${(2 + i * rowH + (rowH - barH) / 2).toFixed(2)}" width="${Math.max(2, b.width * 10)}" height="${barH.toFixed(2)}" rx="1"/>`).join('')).join('');
  const vx = ((win.from - from) / (to - from)) * 1000;
  const vw = ((win.to - win.from) / (to - from)) * 1000;
  const nx = ((m.now - from) / (to - from)) * 1000;
  return `<div class="mm" data-role="minimap" data-from="${from}" data-to="${to}" data-group="${groupBy}" data-rows="${groups.length}" title="${esc(d.tl.minimap)}">
    <svg viewBox="0 0 1000 ${VB}" preserveAspectRatio="none" aria-label="${esc(d.tl.minimap)}">${bars}
      <line class="mnow" x1="${nx}" x2="${nx}" y1="0" y2="${VB}"/>
      <rect class="mv" x="${vx}" y="0.5" width="${Math.max(4, vw)}" height="${VB - 1}" rx="3"/></svg></div>`;
}

/** The analysis row under the timeline: burndown, critical path with the forecast end, and the code zones. */
function renderInsights(m: Model, d: Dict, ui: UiState, loc: string, dv: Derived): string {
  const f = dv.forecast;
  // Scope: a version, a phase, or the whole plan.
  const scopes = [
    { id: '', label: d.insights.wholePlan, ids: m.plan.tasks.map(t => t.id) },
    ...m.plan.versions.map(v => ({ id: `v:${v.id}`, label: `${d.version} ${v.id}`, ids: m.plan.tasks.filter(t => v.phases.includes(t.phase)).map(t => t.id) })),
    ...m.plan.phases.map(p => ({ id: `p:${p.id}`, label: phaseLabel(p.id, p.name), ids: m.plan.tasks.filter(t => t.phase === p.id).map(t => t.id) })),
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
  const cp = dv.critical;
  const chain = cp.ids.length
    ? `<div class="mono">${esc(d.insights.chain(cp.ids.length, cp.minutes))}</div><ol class="chain" data-scroll-key="chain">${cp.ids.map(id => {
        const t = m.plan.tasks.find(x => x.id === id);
        const raw = m.states[id]?.status ?? 'free';
        const s = Object.hasOwn(d.status, raw) ? raw : 'free';
        return `<li data-action="open-task" data-id="${esc(id)}"><i class="sd st-${s}"></i><span class="k">${esc(id)}</span> ${esc(t?.title ?? '')}</li>`;
      }).join('')}</ol>`
    : `<div class="muted">${esc(d.insights.allDone)}</div>`;
  const fc = f ? `<div class="fct">${esc(d.insights.forecastRange(fmt(new Date(f.from).toISOString(), loc), fmt(new Date(f.to).toISOString(), loc)))}</div>` : '';
  const heat = dv.zones.slice(0, 12);
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
