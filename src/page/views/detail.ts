// The task detail and the screenshot gallery. In this task, the modal of before; Task 10 turns it into four tabs.
import { filterNotes } from '../../lib/notes.js';
import type { TaskState } from '../../lib/types.js';
import type { Dict } from '../i18n.js';
import { authorLabel, esc, execLine, fmt, isOrphan, num, pastMs, rel, roleOf, safeNote, safeStatus, trackTag } from '../html.js';
import type { Model } from '../model.js';

export function renderTaskModal(m: Model, d: Dict, id: string, loc: string): string {
  const t = m.plan.tasks.find(x => x.id === id);
  if (!t) return '';
  const s = m.states[id] ?? { status: 'free' as const };
  const status = safeStatus(s.status);
  const ph = m.plan.phases.find(p => p.id === t.phase);
  const unlocks = m.plan.tasks.filter(x => x.depends_on.includes(id)).map(x => x.id);
  const chips = (ids: string[]) => (ids.length ? ids.map(i => `<button class="chip" data-action="open-task" data-id="${esc(i)}">${esc(i)}</button>`).join(' ') : '—');
  const start = s.startedAt ?? s.claimedAt;
  const period = start ? `${esc(fmt(start, loc))} → ${s.doneAt ? esc(fmt(s.doneAt, loc)) : '…'}` : '—';
  // How long it took (done) or has run (claimed or in progress); nothing for a junk, future or reversed date.
  const from = pastMs(start, m.now);
  const to = s.status === 'done' ? pastMs(s.doneAt, m.now) : status === 'in_progress' || status === 'claimed' ? m.now : null;
  const took = from !== null && to !== null && to >= from ? Math.floor((to - from) / 60000) : null;
  const est = t.estimate_min ? num(t.estimate_min) : undefined;
  const duration = took === null ? ''
    : s.status === 'done' ? `<div class="mono dur"><span${est && took > est ? ' class="ye"' : ''}>${esc(d.took(took, est))}</span></div>`
    : `<div class="mono dur">${rel(d, 'lasts', start ?? '', m.now)}</div>`;
  const sec = (label: string, body: string) => `<div class="sec"><div class="lbl">${esc(label)}</div><div>${body}</div></div>`;
  return `<div class="overlay" data-action="close-modal" data-scroll-key="modal:${esc(t.id)}"><div class="modal" role="dialog" aria-modal="true">
    <div class="mh"><div><span class="k">${esc(t.id)}</span> <span class="t">${esc(t.title)}</span><br>
      <span class="pill st-${status}${isOrphan(m, s) ? ' orphan' : ''}">${esc(isOrphan(m, s) ? d.run.orphan : d.status[status])}</span> <span class="mono">${esc(ph?.name)}${t.category ? ` · ${esc(t.category)}` : ''}</span> ${trackTag(m, t.track)}
      ${s.exec ? `<div class="mono exec">${execLine(m, d, s.exec, roleOf(m, s))}</div>` : ''}</div>
      <div class="mhb"><button class="btn" data-action="close-modal" aria-label="${esc(d.close)}">✕</button></div></div>
    <div class="mgrid"><div>
      ${sec(d.field.period, period + duration)}
      ${sec(d.field.dependsOn, chips(t.depends_on))}
      ${sec(d.field.unlocks, chips(unlocks))}
      ${sec(d.field.session, esc(s.owner ?? '—'))}
      ${sec(d.field.zones, t.zones.length ? `<span class="mono">${t.zones.map(esc).join(' · ')}</span>` : esc(d.field.wholeRepo))}
    </div><div>
      ${t.includes ? sec(d.field.includes, esc(t.includes)) : ''}
      ${sec(d.field.doneWhen, esc(t.done_when))}
      ${t.verification ? sec(d.field.verification, `<span class="mono">${esc(t.verification)}</span>`) : ''}
      ${s.summary ? sec(d.field.summary, esc(s.summary)) : ''}
      ${(() => { const ns = filterNotes(m.notes.filter(n => n.taskId === id), 'all', m.me); return ns.length ? sec(d.notesSec, ns.map(n => `<div class="mnote nb-${safeNote(n.type)}"><span class="nt-${safeNote(n.type)}">${esc(d.noteType[safeNote(n.type)])}</span> <span class="k">${esc(authorLabel(m, d, n.author))}</span><div>${esc(n.text)}</div>${n.answer ? `<div class="ans">↳ ${esc(n.answer)}</div>` : ''}</div>`).join('')) : ''; })()}
      ${s.forge ? sec(d.forge.title, renderForge(d, s.forge)) : ''}
      ${s.evidence ? sec(d.verify.title, renderEvidence(d, s.evidence)) : ''}
      ${sec(d.field.commits, s.commits?.length ? s.commits.map(c => `<div class="mono"><span class="c-blue">${esc(c.sha.slice(0, 7))}</span> ${esc(c.title)} <span class="ok">+${num(c.add)}</span> <span class="del">−${num(c.del)}</span></div>`).join('') : '—')}
    </div></div>
  </div></div>`;
}

function renderEvidence(d: Dict, e: NonNullable<TaskState['evidence']>): string {
  const head = e.result === 'pass' ? `<span class="ok">✓ ${num(e.passed)}/${num(e.total)}</span>`
    : e.result === 'fail' ? `<span class="del">✗ ${num(e.passed)}/${num(e.total)}</span>`
    : `<span class="warn">⊘ ${esc(d.verify.blocked)}${e.reason ? `: ${esc(e.reason)}` : ''}</span>`;
  const withUrl = e.shots.filter(s => s.url);
  const strip = e.shots.map((s, i) => s.url
    ? `<button class="shot ${s.ok ? 'ok' : 'del'}" data-action="open-shot" data-i="${i}" title="${esc(s.check)}"><img src="${esc(s.url)}" alt="${esc(s.check)}" loading="lazy"></button>`
    : `<div class="shot-row ${s.ok ? 'ok' : 'del'}">${s.ok ? '✓' : '✗'} ${esc(s.check)}</div>`).join('');
  const note = e.pending ? `<div class="muted">${esc(d.verify.pending)}</div>` : !withUrl.length && e.local ? `<div class="muted">${esc(d.verify.localOnly(e.shots.length))}</div>` : '';
  return `<div class="evidence"><div class="mono">${esc(e.surfaces.join(', '))} · ${head}</div>${strip ? `<div class="shots">${strip}</div>` : ''}${note}</div>`;
}

export function renderLightbox(d: Dict, e: NonNullable<TaskState['evidence']>, i: number): string {
  const s = e.shots[i];
  if (!s?.url) return '';
  return `<div class="lightbox" data-action="close-shot" role="dialog" aria-modal="true"><img src="${esc(s.url)}" alt="${esc(s.check)}">
    <div class="cap"><b>${esc(s.surface)}</b> · ${esc(s.check)} ${s.ok ? '<span class="ok">✓</span>' : '<span class="del">✗</span>'}
    ${s.expected ? `<div>${esc(d.verify.expected)}: ${esc(s.expected)}</div>` : ''}${s.observed ? `<div>${esc(d.verify.observed)}: ${esc(s.observed)}</div>` : ''}</div></div>`;
}

function renderForge(d: Dict, f: NonNullable<TaskState['forge']>): string {
  const vals = Array.isArray(f.validators) ? f.validators : [];
  const score = f.verdict && typeof f.verdict.score === 'number' && Number.isFinite(f.verdict.score) ? String(f.verdict.score) : '—';
  const round = f.round != null ? `${num(f.round)}${f.cap != null ? `/${num(f.cap)}` : ''}` : '';
  return `<div class="forge mono"><div><b>${esc(f.path)}</b> · ${esc(f.phase)}</div>
    ${f.agent ? `<div>${esc(d.forge.agent)}: ${esc(f.agent)}</div>` : ''}
    ${vals.length ? `<div>${esc(d.forge.validators)}: ${vals.map(v => (v.ok === null
      ? `<span class="muted" title="${esc(d.forge.noResult)}">${esc(v.name)} ·</span>`
      : `<span class="${v.ok ? 'ok' : 'del'}">${esc(v.name)} ${v.ok ? '✓' : '✗'}</span>`)).join(' ')}</div>` : ''}
    ${f.verdict ? `<div>${esc(d.forge.verdict)}: ${esc(f.verdict.action)} · ${esc(score)}</div>` : ''}
    ${round ? `<div>${esc(d.forge.round)}: ${esc(round)}</div>` : ''}</div>`;
}
