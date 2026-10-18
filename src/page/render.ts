// The roadmap page's shell (spec §4.6): the side nav with the six views (a tab bar at the bottom on a phone), the sticky
// status strip, the open view, and the task detail and the screenshot gallery over them. Pure: model and view state in,
// one HTML string out (renderPage marks its sections, R2, so app.ts repaints only those that changed). Each view lives in
// views/<view>.ts; this module re-exports what app.ts and the tests use.
import { liveness, sessionLiveness } from '../lib/coordination.js';
import { canDecide, PROPOSAL_STATUSES } from '../lib/proposals.js';
import { withinRunTtl } from '../lib/run-ttl.js';
import { computeDerived, type Derived } from './derive.js';
import { dictFor, type Dict } from './i18n.js';
import { esc, fmt, forecastTitle, hhmm, num, oneOf, rel } from './html.js';
import { VIEWS, type Model, type UiState, type View } from './model.js';
import { section, stripSections } from './sections.js';
import { renderSummary } from './views/summary.js';
import { renderPlanView } from './views/plan.js';
import { renderScheduleView } from './views/schedule.js';
import { renderRunsView } from './views/runs.js';
import { renderSessionsView } from './views/sessions.js';
import { renderTalkView } from './views/talk.js';
import { renderLightbox, renderTaskModal } from './views/detail.js';

export * from './model.js';
export { esc, relText, type RelKind } from './html.js';
export { GROUPS, openGroups, phasesInProgress, timelineSvg, timelineWindow, TL_LAYERS, TL_STATUSES, VIRTUAL_FROM, virtualRange } from './views/schedule.js';
export { currentPhaseId, forgeKeysOf, parsePlanFilter, planFilterKeys, planTaskKey, togglePlanFilter } from './views/plan.js';
export { byNewestRun } from './views/runs.js';

const NAV_ICON: Record<View, string> = { summary: '◉', plan: '▤', schedule: '≡', runs: '▶', sessions: '◎', talk: '✎' };

/** The page as one HTML string, every section in full (what the tests read, and what a full replace paints). */
export function renderApp(m: Model, ui: UiState, dv: Derived = computeDerived(m)): string {
  return stripSections(renderPage(m, ui, dv));
}

/** R2: the page with its sections marked (sections.ts): the nav, the strip, the open view (in the schedule, its analysis and
 *  the minimap's bars too) and the detail. app.ts paints it with paintSections, so a repaint skips what did not change. */
export function renderPage(m: Model, ui: UiState, dv: Derived = computeDerived(m)): string {
  const d = dictFor(m.meta?.locale);
  const loc = m.meta?.locale ?? 'en';
  const view: View = VIEWS.includes(ui.view) ? ui.view : 'summary';
  const openProposals = m.proposals.filter(p => canDecide(oneOf(PROPOSAL_STATUSES, p.status, 'done'))).length;
  const nav = VIEWS.map(v => {
    const on = v === view;
    const badge = v === 'talk' ? openProposals : 0;
    return `<button type="button" class="nav${on ? ' on' : ''}" data-action="view" data-view="${v}"${on ? ' aria-current="page"' : ''} aria-label="${esc(d.views[v])}${badge ? ` (${badge})` : ''}"><b aria-hidden="true">${NAV_ICON[v]}</b><span class="nl" aria-hidden="true">${esc(d.views[v])}</span><span class="ns" aria-hidden="true">${esc(d.navShort[v])}</span>${badge > 0 ? `<span class="badge" aria-hidden="true">${badge}</span>` : ''}</button>`;
  }).join('');
  const body = view === 'plan' ? renderPlanView(m, d, ui, dv)
    : view === 'schedule' ? renderScheduleView(m, d, ui, loc, dv)
    : view === 'runs' ? renderRunsView(m, d, ui, loc, dv)
    : view === 'sessions' ? renderSessionsView(m, d, dv)
    : view === 'talk' ? renderTalkView(m, d, ui, loc)
    : renderSummary(m, d, ui, loc, dv);
  const evidence = ui.modal ? m.states[ui.modal]?.evidence : undefined;
  return `<div class="shell">
  ${section('nav', `<nav class="side" aria-label="${esc(d.nav.label)}" data-scroll-key="side"><div class="brand">${esc((m.meta?.name ?? '').toUpperCase())}</div>${nav}
    <div class="scale"><button type="button" data-action="scale" data-dir="-1" title="${esc(d.tl.smaller)}" aria-label="${esc(d.tl.smaller)}">A−</button><button type="button" data-action="scale" data-dir="1" title="${esc(d.tl.larger)}" aria-label="${esc(d.tl.larger)}">A+</button></div></nav>`)}
  <main class="main" tabindex="-1">
    ${section('strip', renderStrip(m, d, dv, loc))}${section('view', `<div class="vw">${body}</div>`)}${renderDebug(m)}
  </main>
  ${ui.modal ? section('detail', renderTaskModal(m, d, ui, loc)) : ''}
  ${ui.modal && ui.shot !== null && evidence ? renderLightbox(d, evidence, ui.shot) : ''}
</div>`;
}

const versionLabel = (id: string): string => (/^v/i.test(id) ? id : `v${id}`);
const day = (t: number, loc: string): string => {
  try { return new Date(t).toLocaleDateString(loc, { day: 'numeric', month: 'short' }); } catch { return ''; }
};

/** The status strip (§4.6), sticky over every view: the connection (with the snapshot's date before the database answers,
 *  G-14), the one ∞ pill and the one run pill (H-22), the current version's percent (G-11), the forecast end, when state
 *  last synced and the design (G-25). */
function renderStrip(m: Model, d: Dict, dv: Derived, loc: string): string {
  const conn = m.connecting ? `<span class="live">● ${esc(d.connecting)}</span>`
    : m.offline ? `<span class="live off">● ${esc(d.offline)}</span>`
    : `<span class="live">● ${esc(d.live)}</span>`;
  // C8: app.ts only keeps a statesAt that is a date; a model built elsewhere with junk still names no empty date.
  const snapAt = m.statesAt && m.syncedAt == null ? fmt(m.statesAt, loc) : '';
  const snap = snapAt ? `<span class="mono">${esc(d.strip.snapshot(snapAt))}</span>` : '';
  const x = dv.metrics;
  const cur = x.currentVersion;
  const v = cur ? x.byVersion[cur] : undefined;
  const version = cur && v
    ? `<span class="sv" title="${esc(d.strip.versionTitle(cur, v.done, v.total))}">${esc(versionLabel(cur))} · ${v.percent} %</span>`
    : `<span class="sv">${x.percent} %</span>`;
  // G-12: the one forecast end, with how many it counts in parallel in its title.
  const f = dv.forecast;
  const forecast = f
    ? `<span class="sf" title="${esc(forecastTitle(d, f, loc))}">${esc(d.strip.forecast(day(f.at, loc)))}</span>`
    : '';
  const synced = m.syncedAt != null && !m.offline ? `<span class="ss">${esc(d.strip.synced)} ${rel(d, 'ago', new Date(m.syncedAt).toISOString(), m.now)}</span>` : '';
  const links = m.meta?.links;
  // G-25: normalizeMeta keeps only https links; checked again here, since the href is the one place a link could run.
  const design = links?.design && /^https:\/\//.test(links.design)
    ? `<a class="sdl" href="${esc(links.design)}" target="_blank" rel="noopener noreferrer">${esc(d.strip.design(links.designVersion))}</a>`
    : '';
  return `<div class="strip">${conn}${snap}${infinitePill(m, d)}${runPill(m, d)}${version}${forecast}${synced}${design}</div>`;
}

// «∞ ciclo N[/M]» while forge's infinite run is active. meta/infinite.cycle counts the cycles done, so N is the cycle in
// progress (done + 1, never past M). G-08: with a coordinator, its lease decides the colour; 24 h after the lease ended,
// the pill is gone. A document without coordinator (forge before wave 4) is drawn as before.
function infinitePill(m: Model, d: Dict): string {
  const inf = m.infinite;
  if (!inf || inf.active !== true) return '';
  const max = typeof inf.budget?.cycles === 'number' && inf.budget.cycles > 0 ? num(inf.budget.cycles) : undefined;
  const current = num(inf.cycle) + 1;
  let cls = '';
  let extra = '';
  const c = inf.coordinator;
  if (c) {
    const lease = Date.parse(c.leaseUntil);
    if (Number.isFinite(lease) && !withinRunTtl(m.now, lease)) return '';
    const l = liveness(m.now, c.leaseUntil);
    if (l === 'silent') { cls = ' warn'; extra = ` · ${d.run.silentSince(hhmm(c.seenAt))}`; }
    else if (l === 'stopped') { cls = ' stopped'; extra = ` · ${d.run.stoppedSince(hhmm(c.seenAt))}`; }
  }
  return ` <span class="pill inf${cls}">${esc(d.infinite(max !== undefined ? Math.min(current, max) : current, max) + extra)}</span>`;
}

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

/** H-04: with ?debug=1, what the normalizers dropped or coerced, one row per field, at most 200. */
function renderDebug(m: Model): string {
  if (!m.debug) return '';
  const all = Object.values(m.dropped ?? {}).flat();
  const rows = all.slice(0, 200).map(x => `<li>${esc(`${x.doc} · ${x.field} · ${x.action} · ${x.detail}`)}</li>`).join('');
  return `<details class="dbg" open><summary>debug · ${all.length}</summary><ul>${rows}</ul></details>`;
}
