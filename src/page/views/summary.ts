// Resumen (spec §4.6.1). In this task, the top of the old Tracking view: the plan's line, the cards (in progress, the
// progress, the recent changes) and the sessions. Tasks 8 and 9 rebuild it.
import { sessionLiveness } from '../../lib/coordination.js';
import type { Metrics } from '../../lib/metrics.js';
import type { Derived } from '../derive.js';
import type { Dict } from '../i18n.js';
import { clip, escalatedSessions, esc, eviMark, execLine, fmt, ICON, isOrphan, mins, num, rel, safeNote, safeType, trackTag } from '../html.js';
import type { Model, UiState } from '../model.js';

export function renderSummary(m: Model, d: Dict, ui: UiState, loc: string, dv: Derived): string {
  return `<header class="hd"><h1>${esc(d.views.summary)}</h1>${metaLine(m, d, dv.metrics)}</header>
    ${renderCards(m, d, dv.metrics, loc)}
    ${renderSessions(m, d)}`;
}

/** The plan in one line: name, version, phase, tasks done, tracks, tests and the last commit. */
function metaLine(m: Model, d: Dict, x: Metrics): string {
  const current = m.plan.phases.findIndex(p => x.byPhase[p.id]?.status !== 'done');
  const idx = current === -1 ? m.plan.phases.length : current + 1;
  const lc = m.meta?.metrics?.lastCommit;
  const tests = m.meta?.metrics?.tests;
  return `<div class="meta">${esc(m.meta?.name ?? '')} · ${esc(d.version)} <b>${esc(m.meta?.version ?? '')}</b> · ${esc(d.phase)} <b>${idx}</b>/${m.plan.phases.length} · <b>${x.done}</b>/${x.total} ${esc(d.tasks)} · <span title="${esc(d.trackHelp)}"><b>${m.plan.tracks.length}</b> ${esc(d.tracks)}</span>${tests != null ? ` · <b>${num(tests)}</b> ${esc(d.tests)}` : ''}${lc ? ` · ${esc(d.lastCommit)} <b>${esc(lc.sha.slice(0, 7))}</b> ${rel(d, 'ago', lc.ts, m.now)}` : ''}</div>`;
}

function renderCards(m: Model, d: Dict, x: Metrics, loc: string): string {
  const running = x.inProgress.map(id => m.plan.tasks.find(t => t.id === id)!).filter(Boolean);
  let now = `<div class="lbl">${esc(d.nowRunning)} (${running.length})</div>`;
  if (!running.length) {
    now += `<div class="muted">${esc(d.nothingRunning)}</div>`;
  } else {
    const MAX_RUNNING = 5;
    now += `<div class="runs" data-scroll-key="runs">${running.slice(0, MAX_RUNNING).map(t => {
      const s = m.states[t.id]!;
      const start = Date.parse(s.startedAt ?? s.claimedAt ?? new Date(m.now).toISOString());
      const el = mins(start, m.now);
      const pct = t.estimate_min ? Math.min(100, (el / t.estimate_min) * 100) : 0;
      const over = !!t.estimate_min && el > t.estimate_min;
      const ph = m.plan.phases.find(p => p.id === t.phase);
      const orphan = isOrphan(m, s);
      return `<div class="run${orphan ? ' orphan' : ''}" data-action="open-task" data-id="${esc(t.id)}">
        <div class="t"><em>${esc(t.id)}</em> ${esc(t.title)}${orphan ? ` <span class="pill orphan">${esc(d.run.orphan)}</span>` : ''}${eviMark(m, d, t.id)}</div>
        <div class="mono">${trackTag(m, t.track)} ${esc(ph?.name)} · ${esc(d.elapsed(el, t.estimate_min))}${s.owner ? ` · <span class="k">${esc(s.owner)}</span>` : ''}</div>
        ${s.exec ? `<div class="mono exec">${execLine(m, d, s.exec)}</div>` : ''}
        <div class="bar${over ? ' over' : ''}"><i style="width:${pct.toFixed(1)}%"></i></div></div>`;
    }).join('')}</div>${running.length > MAX_RUNNING ? `<div class="mono">${esc(d.more(running.length - MAX_RUNNING))}</div>` : ''}`;
  }
  const prog = `<div class="lbl">${esc(d.version)} ${esc(m.meta?.version ?? '')}</div>
    <div class="big">${x.percent} %</div>
    <div class="mono">${x.done} ${esc(d.of)} ${x.total} ${esc(d.tasks)}</div>
    <div class="bar c"><i style="width:${x.percent}%"></i></div>
    <dl class="kv">
      <dt>${esc(d.phasesDone)}</dt><dd>${x.phasesDone} ${esc(d.of)} ${x.phaseCount}</dd>
      <dt>${esc(d.eta)}</dt><dd>${x.etaIso ? esc(fmt(x.etaIso, loc)) : '—'}</dd>
      <dt>${esc(d.pace)}</dt><dd>${x.paceMin != null ? `${x.paceMin} ${esc(d.minPerTask)}` : '—'}</dd>
      <dt>${esc(d.devSince)}</dt><dd>${x.startedAt ? esc(fmt(x.startedAt, loc)) : '—'}</dd>
    </dl>`;
  type Feed = { ts: string; html: string };
  const feed: Feed[] = [
    ...m.events.map(e => ({ ts: e.ts, html: `<li${e.taskId ? ` data-action="open-task" data-id="${esc(e.taskId)}"` : ''}>
      <span class="mono">${esc(fmt(e.ts, loc, false))}</span> <span class="ev ev-${safeType(e.type)}">${ICON[safeType(e.type)]}</span>
      ${e.taskId ? `<b>${esc(e.taskId)}</b> ` : ''}${esc(e.text ?? d.eventText[safeType(e.type)])}
      ${e.add != null ? `<span class="ok">+${num(e.add)}</span> <span class="del">−${num(e.del)}</span>` : ''}</li>` })),
    ...m.messages.map(g => ({ ts: g.ts, html: `<li class="ev-message">
      <span class="mono">${esc(fmt(g.ts, loc, false))}</span> <span class="ev ev-message">${ICON.message}</span>
      ${esc(g.from)} → ${esc(g.to)}: ${esc(g.text)}</li>` })),
    ...m.notes.map(n => ({ ts: n.ts, html: `<li class="ev-notefeed"${n.taskId ? ` data-action="open-task" data-id="${esc(n.taskId)}"` : ''}>
      <span class="mono">${esc(fmt(n.ts, loc, false))}</span> <span class="ev ev-note">✎</span>
      <b class="nt-${safeNote(n.type)}">${esc(d.noteType[safeNote(n.type)])}</b> ${esc(clip(n.text, 80))}</li>` })),
  ].sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
  const evs = feed.slice(0, 14).map(f => f.html).join('');
  return `<section class="row3">
    <div class="card">${now}</div>
    <div class="card">${prog}</div>
    <div class="card"><div class="lbl">${esc(d.recent)}</div>${evs ? `<ul class="events" data-scroll-key="events">${evs}</ul>` : `<div class="muted">${esc(d.noEvents)}</div>`}</div>
  </section>`;
}

function renderSessions(m: Model, d: Dict): string {
  const list = Object.entries(m.sessions);
  if (!list.length) return '';
  const esca = escalatedSessions(m);
  return `<section class="sess">${list.map(([sid, s]) => {
    const idle = sessionLiveness(s, m.now) === 'stopped';
    const warn = esca.has(sid);
    return `<div class="s ${idle ? 'idle' : ''} ${warn ? 'warn' : ''}"><div class="n">${warn ? '⚠' : '<span class="dot">●</span>'} ${esc(s.name)} ${trackTag(m, s.track)}</div>
      <div class="mono">${esc(s.currentTask ?? '—')} · ${esc(d.heartbeat)} ${rel(d, 'hb', s.heartbeatAt, m.now)}</div></div>`;
  }).join('')}</section>`;
}
