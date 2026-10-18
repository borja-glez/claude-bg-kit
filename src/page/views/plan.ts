// Plan (spec §4.6.3; G-09, H-18, G-11): the plan as a vertical list of foldable phases, the one in progress open. A phase
// says its state, its version, a bar of its tasks by state, its counts and its goal; a task is a row button with its
// state, track, forge summary and evidence, grouped by category only when the plan has categories. The filters go by task
// state (the five add up to the plan), by the phase's plan status, by forge (deferred findings, over the cap) and by
// track, and travel in the URL (pf=); with one by task, forge or track, only the phases with a match show, all open.
import { statusOf } from '../../lib/deps.js';
import type { ForgeDocV2 } from '../../lib/roadmap-doc.js';
import { phaseName } from '../../lib/timeline.js';
import type { PlanStatus, PlanTask, TaskState, TaskStatus } from '../../lib/types.js';
import type { Derived } from '../derive.js';
import type { Dict } from '../i18n.js';
import { esc, eviMark, isOrphan, num, safeStatus, trackTag, versionTable } from '../html.js';
import { PLAN_FORGE_KEYS, PLAN_TASK_KEYS, type Model, type PlanFilter, type PlanForgeKey, type PlanTaskKey, type UiState } from '../model.js';

const PH_ICON: Record<'done' | 'in_progress' | 'committed' | 'provisional', string> = { done: '✓', in_progress: '◉', committed: '▣', provisional: '○' };
const ST_ICON: Record<TaskStatus, string> = { free: '○', claimed: '◎', in_progress: '◉', blocked: '⚠', done: '✓', orphaned: '?' };
const PHASE_KEYS: readonly PlanStatus[] = ['committed', 'provisional'];
const NO_FILTER: PlanFilter = { tasks: [], phases: [], forge: [], track: null };
const TRACK_KEY = /^tr:([\w.-]{1,64})$/;
const versionLabel = (id: string): string => (/^v/i.test(id) ? id : `v${id}`);
const forgeV2 = (st: TaskState | undefined): ForgeDocV2 | null => {
  const f = st?.forge;
  return f && 'v' in f && f.v === 2 ? f : null;
};

/** H-18: where a task stands for the plan's filters; the five add up to the plan. A task the plan dropped counts as free,
 *  an expired lease as blocked (it needs someone), and a done task whose integration is not merged yet apart. */
export function planTaskKey(m: Model, id: string): PlanTaskKey {
  const s = statusOf(m.states, id);
  if (s === 'done') return forgeV2(m.states[id])?.integration?.merged === false ? 'unmerged' : 'done';
  if (s === 'blocked') return 'blocked';
  if (s === 'claimed' || s === 'in_progress') return isOrphan(m, m.states[id]) ? 'blocked' : 'running';
  return 'free';
}

/** H-18: the forge marks of a task (forge v2 only): deferred findings, rounds over the cap. */
export function forgeKeysOf(st: TaskState | undefined): PlanForgeKey[] {
  const f = forgeV2(st);
  if (!f) return [];
  return [...(f.deferred.length ? ['deferred' as const] : []), ...(f.overCap ? ['overcap' as const] : [])];
}

/** The filter a URL or a link carries (pf=): the known keys, each once, and a track as tr:<id>. Nothing known: no filter. */
export function parsePlanFilter(keys: readonly string[] | undefined): PlanFilter | undefined {
  const f: PlanFilter = { tasks: [], phases: [], forge: [], track: null };
  for (const k of keys ?? []) {
    const track = TRACK_KEY.exec(k);
    if ((PLAN_TASK_KEYS as readonly string[]).includes(k)) { if (!f.tasks.includes(k as PlanTaskKey)) f.tasks.push(k as PlanTaskKey); }
    else if ((PHASE_KEYS as readonly string[]).includes(k)) { if (!f.phases.includes(k as PlanStatus)) f.phases.push(k as PlanStatus); }
    else if ((PLAN_FORGE_KEYS as readonly string[]).includes(k)) { if (!f.forge.includes(k as PlanForgeKey)) f.forge.push(k as PlanForgeKey); }
    else if (track) f.track = track[1]!;
  }
  return planFilterKeys(f).length ? f : undefined;
}

/** The keys of a filter in a fixed order: the URL's pf=. */
export function planFilterKeys(f: PlanFilter | undefined): string[] {
  if (!f) return [];
  return [...f.tasks, ...f.phases, ...f.forge, ...(f.track ? [`tr:${f.track}`] : [])];
}

/** A filter button pressed: its key in or out. */
export function togglePlanFilter(f: PlanFilter | undefined, key: string): PlanFilter | undefined {
  const keys = planFilterKeys(f);
  return parsePlanFilter(keys.includes(key) ? keys.filter(k => k !== key) : [...keys, key]);
}

/** The phase in progress: the first, in plan order, with a task not done; null when there is none. */
export function currentPhaseId(m: Model): string | null {
  for (const p of m.plan.phases) if (m.plan.tasks.some(t => t.phase === p.id && statusOf(m.states, t.id) !== 'done')) return p.id;
  return null;
}

export function renderPlanView(m: Model, d: Dict, ui: UiState, dv: Derived): string {
  const x = dv.metrics;
  const head = `<header class="hd"><h1>${esc(d.views.plan)}</h1><div class="meta"><b>${m.plan.phases.length}</b> ${esc(d.plan.phases)} · <b>${x.done}</b>/${x.total} ${esc(d.tasks)}</div></header>${versionTable(m, d, x)}`;
  // H-24: an empty plan says how it gets its tasks.
  if (!m.plan.tasks.length) return `${head}<div class="muted">${esc(d.plan.empty)}</div>`;
  const f = ui.planFilter ?? NO_FILTER;
  // An unknown track (an old link, a hash edited by hand) filters nothing.
  const track = f.track && m.plan.tracks.some(t => t.id === f.track) ? f.track : null;
  const filtering = f.tasks.length > 0 || f.forge.length > 0 || track !== null;
  const keyOf = new Map(m.plan.tasks.map(t => [t.id, planTaskKey(m, t.id)]));
  const forgeOf = new Map(m.plan.tasks.map(t => [t.id, forgeKeysOf(m.states[t.id])]));
  // H-18: the counters go over the whole plan; the task ones add up to it.
  const taskCount = Object.fromEntries(PLAN_TASK_KEYS.map(k => [k, 0])) as Record<PlanTaskKey, number>;
  for (const k of keyOf.values()) taskCount[k]++;
  const forgeCount = Object.fromEntries(PLAN_FORGE_KEYS.map(k => [k, 0])) as Record<PlanForgeKey, number>;
  for (const ks of forgeOf.values()) for (const k of ks) forgeCount[k]++;
  const phaseCount: Record<PlanStatus, number> = { committed: 0, provisional: 0 };
  for (const p of m.plan.phases) phaseCount[p.plan_status]++;
  const btn = (key: string, label: string, n: number, on: boolean) =>
    `<button type="button" class="f pk-${key}${on ? ' on' : ''}" data-action="plan-filter" data-key="${key}" aria-pressed="${on}">${esc(label)} · ${num(n)}</button>`;
  const group = (label: string, body: string) => `<div class="pfg" role="group" aria-label="${esc(label)}"><span class="lbl">${esc(label)}</span>${body}</div>`;
  // Close b: every field has a name (the track's select too).
  const filters = `<div class="pfs">
    ${group(d.plan.groups.task, PLAN_TASK_KEYS.map(k => btn(k, d.plan.task[k], taskCount[k], f.tasks.includes(k))).join(''))}
    ${group(d.plan.groups.phase, PHASE_KEYS.map(k => btn(k, d.plan.phase[k], phaseCount[k], f.phases.includes(k))).join(''))}
    ${group(d.plan.groups.forge, PLAN_FORGE_KEYS.map(k => btn(k, d.plan.forge[k], forgeCount[k], f.forge.includes(k))).join(''))}
    <label class="f trk" title="${esc(d.trackHelp)}">${esc(d.trackLabel)}: <select name="track" data-action="plan-track"><option value="">${esc(d.allTracks)}</option>${m.plan.tracks.map(t =>
      `<option value="${esc(t.id)}"${t.id === track ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
    ${planFilterKeys(ui.planFilter).length ? `<button type="button" class="f" data-action="plan-clear">✕ ${esc(d.plan.clear)}</button>` : ''}
  </div>`;
  const match = (t: PlanTask): boolean => (!f.tasks.length || f.tasks.includes(keyOf.get(t.id)!))
    && (!f.forge.length || forgeOf.get(t.id)!.some(k => f.forge.includes(k)))
    && (!track || t.track === track);
  const current = currentPhaseId(m);
  const open = ui.planOpen ?? new Set(current ? [current] : []);
  const hasCats = m.plan.tasks.some(t => t.category);
  const versionOf = new Map<string, string>();
  for (const v of m.plan.versions) for (const p of v.phases) if (!versionOf.has(p)) versionOf.set(p, v.id);
  const phases = m.plan.phases
    .filter(p => !f.phases.length || f.phases.includes(p.plan_status))
    .map(p => { const all = m.plan.tasks.filter(t => t.phase === p.id); return { p, all, shown: filtering ? all.filter(match) : all }; })
    .filter(y => !filtering || y.shown.length);
  const body = phases.map(({ p, all, shown }) => {
    const b = x.byPhase[p.id] ?? { done: 0, total: all.length, status: p.plan_status };
    const isOpen = filtering || open.has(p.id);
    const name = phaseName(p.id, p.name);
    const ver = versionOf.get(p.id);
    const inner = `<span class="chev" aria-hidden="true">${isOpen ? '⌄' : '›'}</span><span class="k">${esc(p.id)}</span>${name ? ` <span class="pn">${esc(name)}</span>` : ''} <span class="pill ph-${b.status}">${PH_ICON[b.status]} ${esc(d.phaseStatus[b.status])}</span>${ver ? ` <span class="pv">${esc(versionLabel(ver))}</span>` : ''}${segBar(d, all.map(t => ({ status: statusOf(m.states, t.id) })))}<span class="c">${num(b.done)}/${num(b.total)}</span>`;
    const header = filtering
      ? `<div class="plh">${inner}</div>`
      : `<button type="button" class="plh" data-action="plan-phase" data-id="${esc(p.id)}" aria-expanded="${isOpen}">${inner}</button>`;
    const goal = p.goal ? `<p class="goal">${esc(p.goal)}</p>` : '';
    const rows = isOpen && shown.length ? `<div class="plt">${taskRows(m, d, shown, hasCats)}</div>` : '';
    return `<div class="plp ph-${b.status}" data-k="pl:${esc(p.id)}">${header}${goal}${rows}</div>`;
  }).join('');
  const folds = filtering ? '' : `<div class="plc"><button type="button" class="f" data-action="plan-all" data-open="1">⌄ ${esc(d.tl.expand)}</button><button type="button" class="f" data-action="plan-all" data-open="0">⌃ ${esc(d.tl.collapse)}</button></div>`;
  const none = `<div class="muted">${esc(d.plan.none)} <button type="button" class="lnk" data-action="plan-clear">${esc(d.plan.clear)}</button></div>`;
  return `${head}<section class="plan">${filters}${folds}<div class="pll">${body || none}</div></section>`;
}

/** H-02: a phase's tasks as one proportional bar: done, in progress (with claimed), blocked, free (with orphaned). */
function segBar(d: Dict, tasks: { status: TaskStatus }[]): string {
  const n = { done: 0, in_progress: 0, blocked: 0, free: 0 };
  for (const t of tasks) {
    const s = safeStatus(t.status);
    n[s === 'claimed' ? 'in_progress' : s === 'orphaned' ? 'free' : s]++;
  }
  const parts = (['done', 'in_progress', 'blocked', 'free'] as const).filter(k => n[k] > 0);
  return `<span class="seg" role="img" aria-label="${esc(d.segLabel(n))}">${parts.map(k => `<i class="st-${k}" style="flex-grow:${n[k]}"></i>`).join('')}</span>`;
}

/** G-09: the rows of a phase, under a subtitle per category when the plan has any («Sin categoría» last). */
function taskRows(m: Model, d: Dict, tasks: PlanTask[], hasCats: boolean): string {
  if (!hasCats) return tasks.map(t => taskRow(m, d, t)).join('');
  const cats = new Map<string, PlanTask[]>();
  for (const t of tasks) { const c = t.category ?? ''; cats.set(c, [...(cats.get(c) ?? []), t]); }
  const order = [...cats.keys()].sort((a, b) => Number(a === '') - Number(b === ''));
  return order.map(c => `<div class="pcat"><span class="lbl">${esc(c || d.tl.uncategorized)}</span> <span class="c">${cats.get(c)!.length}</span></div>${cats.get(c)!.map(t => taskRow(m, d, t)).join('')}`).join('');
}

/** A task as a row button: its state, id, title, track, forge summary and evidence. */
function taskRow(m: Model, d: Dict, t: PlanTask): string {
  const s = m.states[t.id];
  const st = safeStatus(s?.status);
  const orphan = isOrphan(m, s);
  const label = orphan ? d.run.orphan : planTaskKey(m, t.id) === 'unmerged' ? d.detail.unmerged : d.status[st];
  return `<button type="button" class="pr" data-action="open-task" data-id="${esc(t.id)}" data-k="t:${esc(t.id)}"><span class="st st-${st}${orphan ? ' orphan' : ''}">${ST_ICON[st]} ${esc(label)}</span><span class="k">${esc(t.id)}</span><span class="tt">${esc(t.title)}</span>${trackTag(m, t.track)}${forgeMini(d, s)}${eviMark(m, d, t.id)}</button>`;
}

/** «verificar · r2/4»: the stage of the run, else of the forge block, and the review round against its cap (red over it). */
function forgeMini(d: Dict, s: TaskState | undefined): string {
  const f = s?.forge;
  const doc = forgeV2(s);
  const stage = s?.exec?.stage ?? doc?.stage ?? f?.phase;
  if (!stage) return '';
  const round = f && typeof f.round === 'number' ? ` · r${num(f.round)}${typeof f.cap === 'number' ? `/${num(f.cap)}` : ''}` : '';
  return `<span class="fm${doc?.overCap ? ' del' : ''}">${esc(`${d.run.stage[stage] ?? stage}${round}`)}</span>`;
}
