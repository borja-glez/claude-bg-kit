// Sesiones (G-04, G-10, H-23): the sessions grouped by the run they work for, the active run first and
// «Sin ejecución» last. A group whose run ended, or whose sessions all stopped, starts folded; in a live group the
// stopped ones fold apart. Each card lists every task its session runs (G-10), its heartbeat, zones and threads, with its
// values aligned to the left; the coordinator of the active run also lists its slots and the free ones (H-23).
import { liveness, sessionLiveness, zonesOf } from '../../lib/coordination.js';
import type { MessageType, PlanTask, RunDoc } from '../../lib/types.js';
import type { Derived } from '../derive.js';
import type { Dict } from '../i18n.js';
import { escalatedSessions, esc, hhmm, labelOf, liveDot, num, pastMs, rel, safeMsgType, safeStatus, trackTag } from '../html.js';
import { miniFlow } from '../flow.js';
import type { Model, UiState } from '../model.js';

const MSG_COLOR: Record<MessageType, string> = { overlap_warning: 'mauve', handoff_request: 'peach', delegate: 'teal', reply: 'blue', escalation: 'yellow' };
/** The group of the sessions that work for no run. */
const NO_RUN = '';

export function renderSessionsView(m: Model, d: Dict, ui: UiState, dv: Derived): string {
  const head = `<header class="hd"><h1>${esc(d.views.sessions)}</h1></header>`;
  const sids = Object.keys(m.sessions);
  // H-24: with no session, when they show up.
  if (!sids.length) return `${head}<section class="sessions-view"><div class="muted">${esc(d.sessions.none)}</div></section>`;
  const r = m.run;
  const active = r && r.active && !r.closedAt ? r.runId : null;
  const ended = new Set((m.runs ?? []).map(x => x.runId));
  if (r && (!r.active || r.closedAt)) ended.add(r.runId);
  const groups = new Map<string, string[]>();
  for (const sid of sids) {
    const rid = typeof m.sessions[sid]!.runId === 'string' ? m.sessions[sid]!.runId! : NO_RUN;
    groups.set(rid, [...(groups.get(rid) ?? []), sid]);
  }
  // The active run first, then the other runs newest first (run ids carry their start; plain id order, never locale), «Sin ejecución» last.
  const order = [...groups.keys()].sort((a, b) => (a === NO_RUN ? 1 : b === NO_RUN ? -1 : a === active ? -1 : b === active ? 1 : a < b ? 1 : a > b ? -1 : 0));
  const esca = escalatedSessions(m);
  const cards = (list: string[]) => `<div class="sgrid">${list.map(sid => card(m, d, dv, sid, esca)).join('')}</div>`;
  const body = order.map(rid => {
    const list = groups.get(rid)!;
    const live = list.filter(sid => sessionLiveness(m.sessions[sid], m.now) !== 'stopped');
    const idle = list.filter(sid => !live.includes(sid));
    const isEnded = rid !== NO_RUN && rid !== active && ended.has(rid);
    const folded = isEnded || !live.length;
    const state = rid === NO_RUN ? '' : rid === active ? d.sessions.running : isEnded ? d.sessions.ended : '';
    const title = `${rid === NO_RUN ? d.sessions.noRun : d.sessions.group(rid)}${state ? ` · ${state}` : ''} · ${d.sessions.count(list.length)}`;
    // v3: the active run says how it runs under its title: mode, slots, branch and since when.
    const runMeta = r && rid === active ? `<span class="srm mono">${esc(labelOf(d.run.mode, r.mode))} · ${esc(d.run.slots(r.slots.length, r.parallel))} · ${esc(r.branch)}${r.startedAt && pastMs(r.startedAt, m.now) !== null ? ` · ${esc(d.sess.since(hhmm(r.startedAt)))} · ${rel(d, 'dur', r.startedAt, m.now)}` : ''}</span>` : '';
    // Final review M1: a run and «Sin ejecución» have keys of their own kind (r:<run> and none), so no run id, whatever it
    // says, takes the other's. M2: the fold the data says is in the key too, so a change of it is a new node the morph does
    // not keep folded; the fold the person chose (the `toggle` event, app.ts) wins over it. Re-review N2: while it does, the
    // key keeps the data's fold of when the person chose, so a flip of the data rebuilds nothing and a focus inside stays.
    const group = rid === NO_RUN ? 'none' : `r:${rid}`;
    const fold = (kind: 'sg' | 'si', byData: boolean) => {
      const own = ui.folds?.get(`${kind}:${group}`);
      const open = own ? own.open : byData;
      return `data-k="${esc(`${kind}:${group}:${own ? own.key : byData ? 'open' : 'folded'}`)}"${open ? ' open' : ''}`;
    };
    const inner = folded || !idle.length
      ? cards(list)
      : `${cards(live)}<details class="sidle" ${fold('si', false)}><summary>${esc(d.liveSess.idle(idle.length))}</summary>${cards(idle)}</details>`;
    return `<details class="sgrp" ${fold('sg', !folded)}><summary><span class="lbl">${esc(title)}</span>${runMeta}</summary>${inner}</details>`;
  }).join('');
  return `${head}<section class="sessions-view">${body}</section>`;
}

/** G-10: the tasks a session runs: every task claimed or in progress whose exec is by it or that it owns. */
function tasksOf(m: Model, sid: string): PlanTask[] {
  return m.plan.tasks.filter(t => {
    const st = m.states[t.id];
    return !!st && (st.status === 'in_progress' || st.status === 'claimed') && (st.exec?.by === sid || st.owner === sid);
  });
}

function card(m: Model, d: Dict, dv: Derived, sid: string, esca: Set<string>): string {
  const s = m.sessions[sid]!;
  const tasks = tasksOf(m, sid);
  // A task without zones claims the whole repository (zonesOf says «**»): it reads in words, beside the other tasks' zones.
  const wholeRepo = tasks.some(t => !t.zones.length);
  const zones = [...new Set(tasks.flatMap(t => (t.zones.length ? zonesOf(t, m.states[t.id]) : [])))];
  const zoneParts = [...(wholeRepo ? [esc(d.field.wholeRepo)] : []), ...zones.map(esc)];
  const prog = s.track ? dv.metrics.byTrack[s.track] : undefined;
  const pct = prog && prog.total ? Math.round((num(prog.done) / prog.total) * 100) : 0;
  const live = sessionLiveness(s, m.now);
  const idle = live === 'stopped';
  const hb = idle ? esc(d.run.lastSignal(hhmm(s.heartbeatAt))) : live === 'silent' ? esc(d.run.silentSince(hhmm(s.heartbeatAt))) : rel(d, 'hb', s.heartbeatAt, m.now);
  const warn = esca.has(sid);
  const msgs = m.messages.filter(g => g.from === sid || g.to === sid).slice(0, 6);
  const thread = msgs.length ? `<div class="thread"><div class="lbl ${warn ? 'ye' : ''}">${esc(warn ? d.needsDecision : d.threads)}</div>${msgs.map(g => {
    const t = safeMsgType(g.type);
    return `<div class="msg c-${MSG_COLOR[t]}"><span class="who">${esc(g.from)} → ${esc(g.to)} · ${esc(d.msgType[t])}</span>${esc(g.text)}</div>`;
  }).join('')}</div>` : warn ? `<div class="thread"><div class="lbl ye">${esc(d.needsDecision)}</div></div>` : '';
  // H-23: the coordinator of the active run lists its slots; v3: as a board, and its tasks only once (the ones in no slot
  // go under «Otras tareas»).
  const r = m.run && m.run.active && m.run.coordinator === sid ? m.run : null;
  const inSlots = new Set(r && r.kind !== 'ephemeral' ? r.slots.map(x => x.task) : []);
  const rest = tasks.filter(t => !inSlots.has(t.id));
  const taskList = rest.map(t => `<li class="stk"><button type="button" class="chip st-${safeStatus(m.states[t.id]?.status)}" data-action="open-task" data-id="${esc(t.id)}" data-k="ts:${esc(sid)}:${esc(t.id)}">${esc(t.id)}</button><span class="stt">${esc(t.title)}</span>${miniFlow(d, m.states[t.id]?.exec?.stage)}</li>`).join('');
  const meta = [
    `<span title="${esc(d.heartbeat)}">♥ ${hb}</span>`,
    s.branch ? `<span title="${esc(d.field.branch)}">⎇ ${esc(s.branch)}</span>` : '',
    s.agentName ? `<span title="${esc(d.field.agent)}">${esc(s.agentName)}</span>` : '',
  ].filter(Boolean).join('<span class="sep">·</span>');
  const zoneChips = zoneParts.length ? `<div class="szones" title="${esc(d.field.zones)}">${zoneParts.map(z => `<span class="szc">${z}</span>`).join('')}</div>` : '';
  const track = prog ? `<div class="strk"><span class="lbl">${esc(d.sess.track)}</span><div class="bar c"><i style="width:${pct}%"></i></div><span class="mono">${num(prog.done)}/${num(prog.total)}</span></div>` : '';
  return `<div class="sc${warn ? ' warn' : ''}${idle ? ' idle' : ''}${r ? ' wide' : ''}" data-k="s:${esc(sid)}">
      <header class="sch"><h3>${warn ? '⚠' : `<span class="dot">●</span>`} ${esc(s.name)} ${s.role ? `<span class="tag">${esc(labelOf(d.run.role, s.role))}</span>` : ''} ${trackTag(m, s.track)}</h3><div class="smeta mono">${meta}</div></header>
      ${r ? slotBoard(m, d, r) : ''}
      ${taskList ? `<div class="stl"><div class="lbl">${esc(r ? d.sess.other : d.sessions.tasks)}</div><ul class="stks">${taskList}</ul></div>` : !r ? `<div class="muted">${esc(d.sessions.tasks)}: —</div>` : ''}
      ${zoneChips}${track}${thread}
    </div>`;
}

/** H-23: the slots of the active run, as a board (v3): a tile per slot with its task (a plan task opens its detail; a loose
 *  one has none), the small flow of its stage, its agent and time, with the liveness of its executor (or of the coordinator
 *  for a slot without one), its round when forge says it; then a dashed tile per free slot. */
function slotBoard(m: Model, d: Dict, r: RunDoc): string {
  const coord = m.sessions[r.coordinator];
  // A loose id is not a plan id: an ephemeral run never takes a title or a lease from the plan, even on a clash.
  const ephemeral = r.kind === 'ephemeral';
  const tiles = r.slots.map(s => {
    const task = ephemeral ? undefined : m.plan.tasks.find(t => t.id === s.task);
    const st = ephemeral ? undefined : m.states[s.task];
    const ex = st?.exec;
    const l = ex ? liveness(m.now, ex.leaseUntil) : coord ? sessionLiveness(coord, m.now) : 'stopped';
    const title = task?.title ?? r.loose.find(x => x.id === s.task)?.title ?? '';
    const since = pastMs(s.since, m.now);
    const f = st?.forge;
    const round = f && typeof f.round === 'number' ? ` · r${num(f.round)}${typeof f.cap === 'number' ? `/${num(f.cap)}` : ''}` : '';
    const id = task
      ? `<button type="button" class="chip st-${safeStatus(st?.status)}" data-action="open-task" data-id="${esc(s.task)}" data-k="slot:${esc(s.task)}">${esc(s.task)}</button>`
      : `<span class="k">${esc(s.task)}</span>`;
    return `<li class="slt live-${l}">${id}<span class="slti" title="${esc(title)}">${esc(title)}</span>`
      + `<div class="slf">${liveDot(l)} ${miniFlow(d, s.stage)} <b>${esc(labelOf(d.run.stage, s.stage))}</b><span class="mono">${esc(round)}</span></div>`
      + `<div class="mono slm">${s.agent ? esc(s.agent) : ''}${s.agent && since !== null ? ' · ' : ''}${since !== null ? rel(d, 'lasts', s.since, m.now) : ''}</div></li>`;
  }).join('');
  const free = Math.max(0, num(r.parallel) - r.slots.length);
  const empty = Array.from({ length: Math.min(free, 12) }, () => `<li class="slt free"><span class="muted">${esc(d.sessions.free(1))}</span></li>`).join('');
  return `<div class="slotb"><div class="lbl">${esc(d.sessions.slots)} · ${esc(d.sess.slotsOf(r.slots.length, r.parallel))}</div><ul class="slotg">${tiles}${empty}</ul></div>`;
}
