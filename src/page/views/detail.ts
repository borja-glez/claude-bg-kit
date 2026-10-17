// The task detail (spec §4.7): a dialog over the page, full screen up to 760 px, with four tabs on the ARIA pattern:
// Resumen, Definición, Forge (only with forge data or evidence) and Conversación (with a count). Every panel is rendered,
// the inactive ones hidden, so a link to a tab opens at once. app.ts gives it its URL, its keys and its focus.
import { filterNotes, MAX_NOTE } from '../../lib/notes.js';
import { inlineMd } from '../../lib/inline-md.js';
import { PROPOSAL_STATUSES } from '../../lib/proposals.js';
import type { ForgeDocV2 } from '../../lib/roadmap-doc.js';
import type { ForgeV1, PlanTask, TaskState } from '../../lib/types.js';
import { globsOverlap } from '../../lib/zones.js';
import type { Dict } from '../i18n.js';
import { authorLabel, esc, execLine, fmt, isOrphan, num, oneOf, pastMs, rel, roleOf, safeNote, safeStatus, trackTag } from '../html.js';
import { DETAIL_TABS, type DetailTab, type Model, type UiState } from '../model.js';

const sec = (label: string, body: string) => `<div class="sec"><div class="lbl">${esc(label)}</div><div>${body}</div></div>`;
/** Carry 8: a screenshot's address as <img src> and the lightbox take it: https, or the roadmap's own store (/_blob/<id>).
 *  normalize.ts keeps only those already; checked again here, as the design link is. */
const shotUrl = (u: string | undefined): string | undefined => (u && (/^https:\/\//.test(u) || /^\/_blob\/[\w-]+$/.test(u)) ? u : undefined);
const forgeV2 = (f: TaskState['forge']): ForgeDocV2 | null => (f && 'v' in f && f.v === 2 ? f : null);

export function renderTaskModal(m: Model, d: Dict, ui: UiState, loc: string): string {
  const t = ui.modal ? m.plan.tasks.find(x => x.id === ui.modal) : undefined;
  if (!t) return '';
  const s: TaskState = m.states[t.id] ?? { status: 'free' };
  const status = safeStatus(s.status);
  const doc = forgeV2(s.forge);
  const hasForge = !!s.forge || !!s.evidence;
  const tabs = DETAIL_TABS.filter(k => k !== 'forge' || hasForge);
  const active: DetailTab = ui.tab && tabs.includes(ui.tab) ? ui.tab : 'summary';
  const talk = talkOf(m, t.id);
  const label = (k: DetailTab) => (k === 'talk' ? `${d.detail.tabs.talk} (${talk.count})` : d.detail.tabs[k]);
  const orphan = isOrphan(m, s);
  const unmerged = status === 'done' && doc?.integration?.merged === false;
  const pill = `<span class="pill st-${status}${orphan ? ' orphan' : ''}">${esc(orphan ? d.run.orphan : unmerged ? d.detail.unmerged : d.status[status])}</span>`;
  const ph = m.plan.phases.find(p => p.id === t.phase);
  const tabButtons = tabs.map(k => `<button type="button" role="tab" id="dtab-${k}" class="dtab${k === active ? ' on' : ''}" aria-selected="${k === active}" aria-controls="dpanel-${k}" tabindex="${k === active ? 0 : -1}" data-action="detail-tab" data-tab="${k}">${esc(label(k))}</button>`).join('');
  const panel = (k: DetailTab, body: string) => `<div class="dpanel" role="tabpanel" id="dpanel-${k}" aria-labelledby="dtab-${k}" tabindex="0"${k === active ? '' : ' hidden'}>${body}</div>`;
  return `<div class="overlay" data-action="close-modal" data-scroll-key="modal:${esc(t.id)}"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="dtitle">
    <div class="mh"><div><span class="k">${esc(t.id)}</span> <span class="t" id="dtitle">${esc(t.title)}</span><br>
      ${pill} <span class="mono">${esc(ph?.name)}${t.category ? ` · ${esc(t.category)}` : ''}</span> ${trackTag(m, t.track)}</div>
      <div class="mhb"><button type="button" class="btn" data-action="close-modal" aria-label="${esc(d.close)}">✕</button></div></div>
    <div class="dtabs" role="tablist" aria-label="${esc(d.detail.tabsLabel)}">${tabButtons}</div>
    ${panel('summary', summaryTab(m, d, t, s, loc))}
    ${panel('definition', definitionTab(m, d, t, s))}
    ${hasForge ? panel('forge', forgeTab(d, s, doc)) : ''}
    ${panel('talk', talkTab(m, d, ui, talk, loc))}
  </div></div>`;
}

/** Resumen: why it is blocked, its state and who runs it, the period against the estimate, the branch and the commits
 *  (with the intermediate ones its events carry) and the summary. */
function summaryTab(m: Model, d: Dict, t: PlanTask, s: TaskState, loc: string): string {
  const status = safeStatus(s.status);
  const blocked = status === 'blocked'
    ? `<div class="warnbox" role="note"><b>${esc(d.detail.blockedBy)}</b> ${esc((s.blockedBy ?? []).join(', ') || '—')}${s.blockedReason ? ` · ${esc(s.blockedReason)}` : ''}</div>`
    : '';
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
  const role = roleOf(m, s);
  const sid = s.exec?.by ?? s.owner;
  const agent = s.exec?.agent ?? s.forge?.agent;
  const who = [sid ? esc(sid) : '', role ? esc(d.run.role[role]) : '', agent ? `${esc(d.field.agent)}: ${esc(agent)}` : ''].filter(Boolean).join(' · ') || '—';
  const branch = (sid ? m.sessions[sid]?.branch : undefined) ?? forgeV2(s.forge)?.integration?.branch;
  const row = (sha: string | undefined, title: string, add?: number, del?: number) =>
    `<div class="mono">${sha ? `<span class="c-blue">${esc(sha.slice(0, 7))}</span> ` : ''}${esc(title)}${add != null ? ` <span class="ok">+${num(add)}</span> <span class="del">−${num(del)}</span>` : ''}</div>`;
  const shas = new Set((s.commits ?? []).map(c => c.sha));
  // H-15: the commits the task's events carry that are not in its commits yet.
  const mid = m.events.filter(e => e.type === 'commit' && e.taskId === t.id && !(e.sha && shas.has(e.sha)));
  return `${blocked}
    ${sec(d.detail.status, `${esc(d.status[status])}${s.exec ? `<div class="mono exec">${execLine(m, d, s.exec, role)}</div>` : ''}`)}
    ${sec(d.field.period, period + duration)}
    ${sec(d.field.session, who)}
    ${sec(d.field.branch, esc(branch ?? '—'))}
    ${sec(d.field.commits, s.commits?.length ? s.commits.map(c => row(c.sha, c.title, c.add, c.del)).join('') : '—')}
    ${mid.length ? sec(d.detail.intermediate, mid.map(e => row(e.sha, e.text ?? '', e.add, e.del)).join('')) : ''}
    ${s.summary ? sec(d.field.summary, inlineMd(esc(s.summary))) : ''}`;
}

/** Definición: what it includes and when it is done, its section of the design (G-25), the zones planned against the
 *  ones touched (H-15), its dependencies with their state (G-23) and what it unlocks. */
function definitionTab(m: Model, d: Dict, t: PlanTask, s: TaskState): string {
  const links = m.meta?.links;
  const design = t.design_ref && links?.design && /^https:\/\//.test(links.design)
    ? sec(d.detail.design, `<a href="${esc(links.design)}#${esc(t.design_ref)}" target="_blank" rel="noopener noreferrer">${esc(t.design_ref)}</a>${links.designVersion ? ` <span class="mono">v${num(links.designVersion)}</span>` : ''}`)
    : '';
  const touched = (Array.isArray(s.zonesTouched) ? s.zonesTouched : []).filter((z): z is string => typeof z === 'string');
  const touchedHtml = touched.map(z => {
    const planned = !t.zones.length || t.zones.some(p => globsOverlap(p, z));
    return `<span class="zt${planned ? '' : ' out'}">${esc(z)}${planned ? '' : ` · ${esc(d.detail.outOfPlan)}`}</span>`;
  }).join(' ');
  const deps = t.depends_on;
  const missing = deps.filter(x => m.states[x]?.status !== 'done');
  const depLine = deps.length ? `<div class="mono">${esc(d.detail.depsDone(deps.length - missing.length, deps.length, missing.slice(0, 5), missing.length > 5))}</div>` : '';
  const unlocks = m.plan.tasks.filter(x => x.depends_on.includes(t.id)).map(x => x.id);
  return `${t.includes ? sec(d.field.includes, inlineMd(esc(t.includes))) : ''}
    ${sec(d.field.doneWhen, inlineMd(esc(t.done_when)))}
    ${t.verification ? sec(d.field.verification, `<span class="mono">${inlineMd(esc(t.verification))}</span>`) : ''}
    ${design}
    ${sec(d.detail.zonesPlanned, t.zones.length ? `<span class="mono">${t.zones.map(esc).join(' · ')}</span>` : esc(d.field.wholeRepo))}
    ${touched.length ? sec(d.detail.zonesTouched, `<span class="mono">${touchedHtml}</span>`) : ''}
    ${sec(d.field.dependsOn, `${depLine}${chips(m, d, deps, 'dep')}`)}
    ${sec(d.field.unlocks, chips(m, d, unlocks, 'unl'))}`;
}

/** G-23: task chips in the colour of their state; each opens its task. */
function chips(m: Model, d: Dict, ids: string[], key: string): string {
  if (!ids.length) return '—';
  return ids.map(i => {
    const st = safeStatus(m.states[i]?.status);
    return `<button type="button" class="chip st-${st}" data-action="open-task" data-id="${esc(i)}" data-k="${key}:${esc(i)}" title="${esc(d.status[st])}">${esc(i)}</button>`;
  }).join(' ');
}

/** Forge: a v2 block with its stages, rounds, validators, accepted round, deferred findings and skipped verification; a
 *  v1 block as before; and the verification by round. */
function forgeTab(d: Dict, s: TaskState, doc: ForgeDocV2 | null): string {
  const forge = doc ? renderForgeV2(d, doc) : s.forge ? sec(d.forge.title, renderForge(d, s.forge as ForgeV1)) : '';
  return `${forge}${s.evidence ? sec(d.verify.title, renderEvidence(d, s.evidence)) : ''}`;
}

function renderForgeV2(d: Dict, f: ForgeDocV2): string {
  const stages = Object.entries(f.stages).filter(([, secs]) => secs > 0).map(([k, secs]) => `${d.run.stage[k] ?? k} ${d.dur(secs / 60)}`).join(' · ');
  const head = `<div class="forge mono"><div><b>${esc(d.path[f.path] ?? f.path)}</b> · ${esc(d.run.stage[f.stage] ?? f.stage)} · ${esc(d.inProgress.brief(f.brief))}${typeof f.round === 'number' ? ` · r${num(f.round)}${typeof f.cap === 'number' ? `/${num(f.cap)}` : ''}` : ''}</div>`
    + `${f.agent ? `<div>${esc(d.forge.agent)}: ${esc(f.agent)}</div>` : ''}${stages ? `<div>${esc(d.detail.stages)}: ${esc(stages)}</div>` : ''}`
    + `${f.stage === 'stopped' ? `<div class="warn">${esc(d.run.stoppedHint)}</div>` : ''}</div>`;
  // K4-05: the accepted round, its score only in the title.
  const accepted = f.acceptedRound !== null
    ? `<div class="ok"${f.verdict && typeof f.verdict.score === 'number' ? ` title="${esc(`${d.forge.verdict}: ${f.verdict.score}`)}"` : ''}>${esc(d.detail.acceptedIn(f.acceptedRound))}</div>`
    : '';
  const rounds = f.rounds.length
    ? `<table class="rt"><thead><tr>${(['round', 'action', 'findings', 'reviewers', 'note'] as const).map(k => `<th>${esc(d.detail.roundCols[k])}</th>`).join('')}</tr></thead><tbody>${f.rounds.map(r => {
        const over = typeof f.cap === 'number' && r.brief === f.brief && r.n > f.cap;
        return `<tr${over ? ' class="over"' : ''}><td>${num(r.brief)}·${num(r.n)}</td><td>${esc(d.action[r.action] ?? r.action)}</td><td>${num(r.findings.critical)} C · ${num(r.findings.important)} I · ${num(r.findings.minor)} m</td><td>${esc(r.reviewers.join(', ') || '—')}</td><td>${esc(r.note)}</td></tr>`;
      }).join('')}</tbody></table>`
    : '—';
  const vals = f.validators.length
    ? `<ul class="vals">${f.validators.map(v => {
        const mark = v.skipped ? `<span class="muted">${esc(v.name)} ⊘</span>` : `<span class="${v.ok ? 'ok' : 'del'}">${esc(v.name)} ${v.ok ? '✓' : '✗'}</span>`;
        const tags = [v.flaky ? d.detail.flaky : '', v.skipped ? d.detail.skipped(v.skipped) : '', v.preexisting ? d.detail.preexisting : '', v.ms !== undefined ? d.detail.secs(v.ms) : '', v.cached ? d.detail.cached : '', v.failing !== undefined ? d.detail.failing(v.failing) : ''].filter(Boolean);
        return `<li>${mark}${tags.map(x => ` <span class="mono">${esc(x)}</span>`).join('')}</li>`;
      }).join('')}</ul>`
    : '—';
  const deferred = f.deferred.length
    ? sec(d.detail.deferred, f.deferred.map(x => `<div class="mono">${x.file ? `${esc(x.line ? `${x.file}:${x.line}` : x.file)} — ` : ''}${esc(x.problem)}</div>`).join(''))
    : '';
  const skipped = f.verify?.skipped ? `<div class="warn">${esc(d.detail.verifySkipped(f.verify.skipped))}</div>` : '';
  return `${sec(d.forge.title, head + accepted)}${sec(d.detail.rounds, rounds)}${sec(d.forge.validators, vals)}${deferred}${skipped}`;
}

/** The verification: the result, every check (with its screenshot when uploaded), grouped by review round when the
 *  evidence says it (K2-14), what was not checked, and why it is blocked or local only. */
function renderEvidence(d: Dict, e: NonNullable<TaskState['evidence']>): string {
  const head = e.result === 'pass' ? `<span class="ok">✓ ${num(e.passed)}/${num(e.total)}</span>`
    : e.result === 'fail' ? `<span class="del">✗ ${num(e.passed)}/${num(e.total)}</span>`
    : `<span class="warn">⊘ ${esc(d.verify.blocked)}${e.reason ? `: ${esc(e.reason)}` : ''}</span>`;
  const withUrl = e.shots.filter(s => shotUrl(s.url));
  const shot = (s: (typeof e.shots)[number], i: number) => (shotUrl(s.url)
    ? `<button type="button" class="shot ${s.ok ? 'ok' : 'del'}" data-action="open-shot" data-i="${i}" data-k="shot:${i}" title="${esc(s.check)}"><img src="${esc(shotUrl(s.url))}" alt="${esc(s.check)}" loading="lazy"></button>`
    : `<div class="shot-row ${s.ok ? 'ok' : 'del'}">${s.ok ? '✓' : '✗'} ${esc(s.check)}</div>`);
  const rounds = [...new Set(e.shots.map(s => s.round ?? 0))];
  const strip = !e.shots.length ? ''
    : rounds.length === 1 && rounds[0] === 0 ? `<div class="shots">${e.shots.map(shot).join('')}</div>`
    : rounds.map(r => `${r ? `<div class="lbl">${esc(d.detail.verifyRound(r))}</div>` : ''}<div class="shots">${e.shots.map((s, i) => ({ s, i })).filter(x => (x.s.round ?? 0) === r).map(x => shot(x.s, x.i)).join('')}</div>`).join('');
  const unchecked = e.unchecked?.length ? `<div class="mono">${esc(d.detail.unchecked)}: ${e.unchecked.map(esc).join(', ')}</div>` : '';
  const note = e.pending ? `<div class="muted">${esc(d.verify.pending)}</div>` : !withUrl.length && e.local ? `<div class="muted">${esc(d.verify.localOnly(e.shots.length))}</div>` : '';
  return `<div class="evidence"><div class="mono">${esc(e.surfaces.join(', '))} · ${head}</div>${strip}${unchecked}${note}</div>`;
}

export function renderLightbox(d: Dict, e: NonNullable<TaskState['evidence']>, i: number): string {
  const s = e.shots[i];
  const url = shotUrl(s?.url);
  if (!s || !url) return '';
  return `<div class="lightbox" data-action="close-shot" role="dialog" aria-modal="true" aria-label="${esc(s.check)}" tabindex="-1"><img src="${esc(url)}" alt="${esc(s.check)}">
    <div class="cap"><b>${esc(s.surface)}</b> · ${esc(s.check)} ${s.ok ? '<span class="ok">✓</span>' : '<span class="del">✗</span>'}
    ${s.expected ? `<div>${esc(d.verify.expected)}: ${esc(s.expected)}</div>` : ''}${s.observed ? `<div>${esc(d.verify.observed)}: ${esc(s.observed)}</div>` : ''}</div></div>`;
}

/** The forge block as it was written before wave 4 (v1). */
function renderForge(d: Dict, f: ForgeV1): string {
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

/** The task's notes (not a proposal's comments) and the proposal it came from. */
function talkOf(m: Model, id: string) {
  const notes = filterNotes(m.notes.filter(n => n.taskId === id && !n.proposalId), 'all', m.me);
  const origin = m.proposals.find(p => p.taskId === id) ?? null;
  return { notes, origin, count: notes.length + (origin ? 1 : 0) };
}

/** Conversación: the notes (decisions with their structure, [Responder] on an open question) and the proposal of origin. */
function talkTab(m: Model, d: Dict, ui: UiState, talk: ReturnType<typeof talkOf>, loc: string): string {
  const notes = talk.notes.map(n => {
    const type = safeNote(n.type);
    const open = type === 'question' && !n.answer && !n.answeredByNote;
    const dec = n.decision;
    const when = fmt(n.ts, loc);
    const decHtml = dec ? `<div class="ndec"><div><span class="k">${esc(d.decisionChosen)}</span> ${esc(dec.chosen)}${dec.alternatives?.length ? ` <span class="k">(${esc(dec.alternatives.join(', '))})</span>` : ''}</div>`
      + `<div><span class="k">${esc(d.decisionWhy)}</span> ${esc(dec.why)}</div>${dec.revert ? `<div><span class="k">${esc(d.decisionRevert)}</span> ${esc(dec.revert)}</div>` : ''}</div>` : '';
    const reply = !open || m.readOnly ? '' : ui.answering === n.id
      ? `<div class="areply"><textarea name="answer" data-role="answer-text" maxlength="${MAX_NOTE}" rows="2" placeholder="${esc(d.answerPlaceholder)}">${esc(ui.answerDraft)}</textarea><button type="button" class="btn pri" data-action="answer-send" data-id="${esc(n.id)}">${esc(d.send)}</button></div>`
      : `<button type="button" class="btn" data-action="answer-open" data-id="${esc(n.id)}">${esc(d.reply)}</button>`;
    return `<div class="mnote nb-${type}"><span class="nt-${type}">${esc(open ? d.openQuestion : d.noteType[type])}</span>${dec ? ` <span class="nauto">${esc(dec.auto ? d.autoTag : d.yoursTag)}</span>` : ''} <span class="k">${esc(authorLabel(m, d, n.author))}${when ? ` · ${esc(when)}` : ''}</span>`
      + `<div>${inlineMd(esc(n.text))}</div>${decHtml}${n.answer ? `<div class="ans">↳ ${esc(n.answer)}</div>` : ''}${reply}</div>`;
  }).join('');
  const o = talk.origin;
  const status = o ? oneOf(PROPOSAL_STATUSES, o.status, 'done') : 'done';
  const origin = o
    ? sec(d.detail.origin, `<div class="mnote"><b>${esc(o.title)}</b> <span class="pill ps-${status}">${esc(d.pstatus[status])}</span> <button type="button" class="lnk" data-action="view" data-view="talk" data-c="proposals">${esc(d.talkKind.proposals)}</button></div>`)
    : '';
  return `${notes ? `<div class="sec"><div class="lbl">${esc(d.notesSec)}</div>${notes}</div>` : `<div class="muted">${esc(d.detail.noTalk)}</div>`}${origin}`;
}
