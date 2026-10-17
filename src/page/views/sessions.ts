// Sesiones (spec §4.6.6). In 4b, the session cards of before, without the execution block (it moved to Ejecuciones); 4c
// groups them by run and lists each one's tasks.
import { sessionLiveness, zonesOf } from '../../lib/coordination.js';
import type { MessageType } from '../../lib/types.js';
import type { Derived } from '../derive.js';
import type { Dict } from '../i18n.js';
import { escalatedSessions, esc, hhmm, num, rel, safeMsgType, trackTag } from '../html.js';
import type { Model } from '../model.js';

const MSG_COLOR: Record<MessageType, string> = { overlap_warning: 'mauve', handoff_request: 'peach', delegate: 'teal', reply: 'blue', escalation: 'yellow' };

export function renderSessionsView(m: Model, d: Dict, dv: Derived): string {
  const x = dv.metrics;
  const esca = escalatedSessions(m);
  const list = Object.entries(m.sessions);
  const cards = list.map(([sid, s]) => {
    const task = m.plan.tasks.find(t => t.id === s.currentTask);
    const zones = task ? [...new Set(zonesOf(task, m.states[task.id]))] : [];
    const prog = s.track ? x.byTrack[s.track] : undefined;
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
    return `<div class="sc ${warn ? 'warn' : ''} ${idle ? 'idle' : ''}">
      <h3>${warn ? '⚠' : '<span class="dot">●</span>'} ${esc(s.name)} ${s.role ? `<span class="tag">${esc(d.run.role[s.role])}</span>` : ''} ${trackTag(m, s.track)}</h3>
      <dl class="kv">
        <dt>${esc(d.field.task)}</dt><dd>${task ? `<span class="pe">${esc(task.id)}</span> ${esc(task.title)}` : esc(s.currentTask ?? '—')}</dd>
        <dt>${esc(d.field.branch)}</dt><dd>${esc(s.branch ?? '—')}</dd>
        <dt>${esc(d.field.agent)}</dt><dd>${esc(s.agentName ?? '—')}</dd>
        <dt>${esc(d.heartbeat)}</dt><dd>${hb}</dd>
        <dt>${esc(d.field.zones)}</dt><dd>${task && !task.zones.length ? esc(d.field.wholeRepo) : zones.length ? zones.map(esc).join(' · ') : '—'}</dd>
      </dl>
      ${prog ? `<div class="bar c"><i style="width:${pct}%"></i></div><div class="mono">${num(prog.done)}/${num(prog.total)}</div>` : ''}
      ${thread}
    </div>`;
  }).join('');
  return `<header class="hd"><h1>${esc(d.views.sessions)}</h1></header>
  <section class="sessions-view">${cards ? `<div class="sgrid">${cards}</div>` : `<div class="muted">${esc(d.noSessions)}</div>`}</section>`;
}
