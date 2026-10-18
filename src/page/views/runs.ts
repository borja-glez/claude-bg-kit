// Ejecuciones (spec §4.6.5, §4.3; G-07): the active run (its header, its tasks as rows of «En curso» and the loose tasks
// of an ephemeral one), a stalled one (its banner, with the command that resumes or closes it) and the history of runs/,
// newest first, each folded until opened (a run of 60 tasks is a lot of rows). Nothing here writes: the roadmap stays
// read-only, and its slots are listed on the coordinator's card in Sesiones.
import { sessionLiveness } from '../../lib/coordination.js';
import { RUN_TASK_STATUSES, type RunSummaryDoc } from '../../lib/run-summary.js';
import { LOOSE_STATUSES, type PlanTask } from '../../lib/types.js';
import type { Derived } from '../derive.js';
import type { Dict } from '../i18n.js';
import type { Need } from '../needs.js';
import { esc, fmt, labelOf, liveDot, num, oneOf } from '../html.js';
import type { Model, UiState } from '../model.js';
import { looseRow, nowHead, nowRow, runHead } from './summary.js';

/** The kinds of runs/ (run-summary.ts): anything else reads as a run of the plan, in a class name and in its label. */
const RUN_KINDS = ['plan', 'ephemeral', 'single'] as const;

export function renderRunsView(m: Model, d: Dict, ui: UiState, loc: string, dv: Derived): string {
  const body = `${renderStalled(d, dv)}${renderActive(m, d, dv)}${renderLoose(m, d)}${renderHistory(m, d, ui, loc)}`;
  // H-24: with nothing at all, how runs start.
  return `<header class="hd"><h1>${esc(d.views.runs)}</h1></header>${body || `<div class="muted">${esc(d.runs.none)}</div>`}`;
}

/** §4.3: a run that stopped without being closed, within its 24 h: what stopped it (C33), why, and the command that
 *  resumes or closes it. */
function renderStalled(d: Dict, dv: Derived): string {
  const n = dv.needs.find((x): x is Extract<Need, { kind: 'stalled' }> => x.kind === 'stalled');
  if (!n) return '';
  return `<div class="warnbox" role="note"><b>${esc(d.needs.stalled[n.stop](n.runId))}</b>${n.reason ? `: ${esc(n.reason)}` : ''}<div class="hint">${esc(d.needs.stalledHint)}</div></div>`;
}

/** The active run: its header, its tasks (the exec says its runId, or the task holds one of its slots) as rows of «En
 *  curso», and the running loose tasks of an ephemeral one. */
function renderActive(m: Model, d: Dict, dv: Derived): string {
  const r = m.run && m.run.active ? m.run : null;
  if (!r) return '';
  const slotted = new Set(r.kind === 'ephemeral' ? [] : r.slots.map(s => s.task));
  const tasks = dv.running.filter(id => m.states[id]?.exec?.runId === r.runId || slotted.has(id))
    .map(id => m.plan.tasks.find(t => t.id === id)).filter((t): t is PlanTask => !!t);
  const loose = r.kind === 'ephemeral' ? r.loose.filter(x => x.status === 'running') : [];
  const rows = `${tasks.map(t => nowRow(m, d, t)).join('')}${loose.map(x => looseRow(m, d, r, x)).join('')}`;
  return `<section class="card runa"><h2 class="lbl">${esc(d.runs.active)}</h2><div class="nowt">${nowHead(d)}<div class="rh">${esc(runHead(d, r))}</div>${rows || `<div class="muted">${esc(d.runs.waiting)}</div>`}</div></section>`;
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
    const parts = [d.run.looseStatus[status], t.stage ? labelOf(d.run.stage, t.stage) : null, t.agent, finished && t.seconds !== undefined ? (t.seconds < 60 ? d.tookUnderMin : d.took(Math.floor(t.seconds / 60))) : null];
    return `<li class="lt st-${status}">${liveDot(l)} <span class="k">${esc(t.id)}</span> <span class="lab">${esc(t.title)}</span> <span class="mono">${parts.filter(Boolean).map(p => esc(String(p))).join(' · ')}</span></li>`;
  }).join('');
  return `<section class="loose card"><div class="lbl">${esc(d.run.looseTitle)} (${r.loose.length})</div><ul class="lts">${rows}</ul></section>`;
}

/** G-07: the runs that ended (runs/), newest first (ties in plain id order); one opens to tell how it ended and each of
 *  its tasks. */
function renderHistory(m: Model, d: Dict, ui: UiState, loc: string): string {
  const list = [...(m.runs ?? [])].sort((a, b) => Date.parse(b.endedAt) - Date.parse(a.endedAt) || (a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0));
  if (!list.length) return '';
  const open = ui.runsOpen ?? new Set<string>();
  const items = list.map(r => {
    const isOpen = open.has(r.runId);
    const kind = oneOf(RUN_KINDS, r.kind, 'plan');
    const integrated = r.tasks.filter(t => t.status === 'integrated').length;
    const secs = (Date.parse(r.endedAt) - Date.parse(r.startedAt)) / 1000;
    const parts = [fmt(r.endedAt, loc), Number.isFinite(secs) && secs >= 0 ? d.dur(secs / 60) : '', d.runs.integrated(integrated, r.tasks.length), r.merged ? d.runs.merged(r.target) : d.runs.unmerged(r.branch)].filter(Boolean);
    return `<li class="rhi" data-k="run:${esc(r.runId)}"><button type="button" class="rhb" data-action="run-toggle" data-id="${esc(r.runId)}" aria-expanded="${isOpen}"><span class="chev" aria-hidden="true">${isOpen ? '⌄' : '›'}</span><span class="rk rk-${kind}">${esc(d.runs.kind[kind])}</span> <span class="k">${esc(r.runId)}</span> <span class="mono">${parts.map(esc).join(' · ')}</span></button>${isOpen ? historyBody(m, d, r) : ''}</li>`;
  }).join('');
  return `<section class="card rhist"><h2 class="lbl">${esc(d.runs.history)} (${list.length})</h2><ul class="rhl">${items}</ul></section>`;
}

/** How a run ended, its final review, its deferred findings and decisions, and each task: a plan task opens its detail; a
 *  loose one has none. A task stopped with /forge:stop says so. Each row is keyed by its run too (C19): a task stopped in
 *  one run and integrated in the next is two rows, and morphdom must never take one for the other. */
function historyBody(m: Model, d: Dict, r: RunSummaryDoc): string {
  const fr = r.finalReview;
  const mode = r.mode === 'single' ? d.runs.kind.single : labelOf(d.run.mode, r.mode);
  const facts = `<dl class="kv">
    <dt>${esc(d.runs.fields.mode)}</dt><dd>${esc(`${mode} · ${d.runs.parallel(num(r.parallel))}`)}</dd>
    <dt>${esc(d.runs.fields.coordinator)}</dt><dd>${esc(r.coordinator)}</dd>
    <dt>${esc(d.runs.fields.branch)}</dt><dd>${esc(`${r.branch} → ${r.target}`)}</dd>
    <dt>${esc(d.runs.fields.end)}</dt><dd>${esc(r.stopReason ? labelOf(d.runs.stop, r.stopReason) : '—')}</dd>
    <dt>${esc(d.runs.fields.final)}</dt><dd>${fr ? esc(`${labelOf(d.action, fr.action)} · ${num(fr.critical)} C · ${num(fr.important)} I · ${num(fr.minor)} m`) : '—'}</dd>
    <dt>${esc(d.runs.fields.deferred)}</dt><dd>${num(r.deferred)}</dd>
    <dt>${esc(d.runs.fields.decisions)}</dt><dd>${num(r.decisions)}</dd>
  </dl>`;
  const rows = r.tasks.map(t => {
    const task = r.loose ? undefined : m.plan.tasks.find(x => x.id === t.id);
    const status = oneOf(RUN_TASK_STATUSES, t.status, 'queued');
    const label = status === 'stopped' ? d.run.stoppedHint : labelOf(d.run.taskStatus, status);
    const extra = [t.seconds !== undefined ? d.dur(t.seconds / 60) : '', t.rounds !== undefined ? d.runs.rounds(num(t.rounds)) : '', t.deferred ? d.runs.deferred(num(t.deferred)) : ''].filter(Boolean);
    const inner = `<span class="k">${esc(t.id)}</span> ${esc(t.title ?? task?.title ?? '')} <span class="mono rs-${status}">${esc([label, ...extra].join(' · '))}</span>`;
    return `<li>${task ? `<button type="button" class="rtb" data-action="open-task" data-id="${esc(t.id)}" data-k="rt:${esc(r.runId)}:${esc(t.id)}">${inner}</button>` : `<div class="rtb">${inner}</div>`}</li>`;
  }).join('');
  return `<div class="rhd">${facts}<div class="lbl">${esc(d.runs.fields.tasks)} (${r.tasks.length})</div><ul class="rtl">${rows}</ul></div>`;
}
