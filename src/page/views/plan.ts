// Plan (spec §4.6.3). In 4b, the board of versions of before under the title Plan; 4c turns it into a vertical list of
// phases and removes src/lib/versions.ts.
import { buildVersionColumns, type VersionColumn } from '../../lib/versions.js';
import type { PlanView, TaskStatus } from '../../lib/types.js';
import type { Dict } from '../i18n.js';
import { esc, eviMark, num, safeStatus, trackTag } from '../html.js';
import { VFILTER_KEYS, type Model, type UiState, type VFilterKey } from '../model.js';

export function renderPlanView(m: Model, d: Dict, ui: UiState): string {
  return `<header class="hd"><h1>${esc(d.views.plan)}</h1></header>${renderVersionsView(m, d, ui)}`;
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

/** H-02: a category's tasks as one proportional bar: done, in progress (with claimed), blocked, pending (with orphaned). */
function segBar(d: Dict, tasks: { status: TaskStatus }[]): string {
  const n = { done: 0, in_progress: 0, blocked: 0, free: 0 };
  for (const t of tasks) {
    const s = safeStatus(t.status);
    n[s === 'claimed' ? 'in_progress' : s === 'orphaned' ? 'free' : s]++;
  }
  const parts = (['done', 'in_progress', 'blocked', 'free'] as const).filter(k => n[k] > 0);
  return `<span class="seg" role="img" aria-label="${esc(d.segLabel(n))}">${parts.map(k => `<i class="st-${k}" style="flex-grow:${n[k]}"></i>`).join('')}</span>`;
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
    // H-02: a column whose only category is «—» (a plan without categories) lists its tasks without a category button.
    const bare = c.categories.length === 1 && c.categories[0]!.name === '—';
    const cats = c.categories.map(cat => {
      const key = `${c.phase.id}|${cat.name}`;
      const closed = !bare && ui.collapsed.has(key);
      const tasks = closed ? '' : cat.tasks.map(t => {
        const st = safeStatus(t.status);
        return `<button type="button" class="tc" data-action="open-task" data-id="${esc(t.id)}" data-k="t:${esc(t.id)}"><span class="st st-${st}">${ST_ICON[st]} ${esc(d.status[st])}${eviMark(m, d, t.id)}</span><span class="tt"><span class="k">${esc(t.id)}</span> ${esc(t.title)} ${trackTag(m, t.track)}</span></button>`;
      }).join('');
      if (bare) return tasks;
      return `<button class="cat" data-action="toggle-cat" data-key="${esc(key)}" aria-expanded="${!closed}"><span><span class="cn">${closed ? '›' : '⌄'} ${esc(cat.name)}</span><span class="mono">${esc(d.entries(cat.tasks.length))}</span></span>${segBar(d, cat.tasks)}</button>${tasks}`;
    }).join('');
    return `<div class="vcol ph-${ps}">
      <div class="vhd"><div class="v">${esc(c.versionId == null ? d.noVersion : d.versionCol(c.versionId))}</div><div class="ph">${esc(d.phaseN(n))}</div><div class="mono">${esc(c.phase.name)}</div>
        <span class="pill ph-${ps}">${PH_ICON[ps]} ${esc(d.phaseStatus[ps])}${ps === 'in_progress' ? ` · ${num(c.done)}/${num(c.total)}` : ''}</span></div>
      ${cats || `<div class="muted">${esc(d.noTasks)}</div>`}
    </div>`;
  }).join('');
  return `<section class="versions-view">${filters}<div class="vcols" data-scroll-key="vcols">${body || `<div class="muted">${esc(d.noTasks)}</div>`}</div></section>`;
}
