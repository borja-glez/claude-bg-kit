// Ejecuciones (spec §4.6.5). In 4b, the execution block and the loose tasks that the Sessions and Tracking views showed;
// 4c adds the stalled banner and the history of runs/.
import { liveness, sessionLiveness } from '../../lib/coordination.js';
import { LOOSE_STATUSES, type RunDoc } from '../../lib/types.js';
import type { Dict } from '../i18n.js';
import { esc, labelOf, liveDot, oneOf, pastMs, rel } from '../html.js';
import type { Model } from '../model.js';

export function renderRunsView(m: Model, d: Dict): string {
  const body = `${renderRunBlock(m, d)}${renderLoose(m, d)}`;
  return `<header class="hd"><h1>${esc(d.views.runs)}</h1></header>${body || `<div class="muted">${esc(d.runs.none)}</div>`}`;
}

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
    const head = `${liveDot(l)} <span class="pe">${esc(s.task)}</span> ${esc(title)}`;
    const line = `${esc(labelOf(d.run.stage, s.stage))}${s.agent ? ` · ${esc(s.agent)}` : ''}${since !== null ? ` · ${rel(d, 'lasts', s.since, m.now)}` : ''}`;
    // G-15: a plan task's slot opens its detail, so it is a button; a loose task has no detail.
    return task
      ? `<button type="button" class="sc slot" data-action="open-task" data-id="${esc(s.task)}" data-k="slot:${esc(s.task)}"><span class="sh">${head}</span><span class="mono">${line}</span></button>`
      : `<div class="sc slot"><h3>${head}</h3>
      <div class="mono">${line}</div></div>`;
  };
  const free = Math.max(0, r.parallel - r.slots.length);
  const head = r.kind === 'ephemeral'
    ? `${esc(d.run.loosePill(d.run.mode[r.mode], r.slots.length, r.parallel))} · ${esc(d.run.coordinator)}: ${esc(r.coordinator)}`
    : `${esc(d.run.title)} · ${esc(d.run.mode[r.mode])} · ${esc(d.run.slots(r.slots.length, r.parallel))} · ${esc(d.run.coordinator)}: ${esc(r.coordinator)}`;
  return `<section class="exec-sec"><div class="lbl">${head}</div>
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
    const parts = [d.run.looseStatus[status], t.stage ? labelOf(d.run.stage, t.stage) : null, t.agent, finished && t.seconds !== undefined ? (t.seconds < 60 ? d.tookUnderMin : d.took(Math.floor(t.seconds / 60))) : null];
    return `<li class="lt st-${status}">${liveDot(l)} <span class="k">${esc(t.id)}</span> <span class="lab">${esc(t.title)}</span> <span class="mono">${parts.filter(Boolean).map(p => esc(String(p))).join(' · ')}</span></li>`;
  }).join('');
  return `<section class="loose card"><div class="lbl">${esc(d.run.looseTitle)} (${r.loose.length})</div><ul class="lts">${rows}</ul></section>`;
}
