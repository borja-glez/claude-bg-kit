// Conversación (spec §4.6.7). In 4b, two sub-tabs over the renders of before: the notes and the proposals; 4c joins them
// with their filters, the comments inside their proposal and the decisions with their structure.
import { canDecide, MAX_PROPOSAL_TEXT, PROPOSAL_CATEGORIES, PROPOSAL_RISKS, PROPOSAL_STATUSES, type ProposalStatus } from '../../lib/proposals.js';
import { counts, filterNotes, MAX_NOTE, NOTE_TYPES } from '../../lib/notes.js';
import type { Dict } from '../i18n.js';
import { authorLabel, esc, fmt, oneOf, safeNote, unmarked } from '../html.js';
import { NOTE_FILTERS, PROPOSAL_FILTERS, TALK_KINDS, type Model, type ProposalFilter, type ProposalFilterKind, type UiState } from '../model.js';

export function renderTalkView(m: Model, d: Dict, ui: UiState, loc: string): string {
  const kind = ui.talk ?? 'notes';
  const c = counts(m.notes);
  const notes = `<b>${c.decision}</b> ${esc(d.noteCounts.decision)} · <b>${c.idea}</b> ${esc(d.noteCounts.idea)} · <b>${c.debt}</b> ${esc(d.noteCounts.debt)} · <b>${c.open}</b> ${esc(d.noteCounts.open)}`;
  const statuses = m.proposals.map(p => oneOf(PROPOSAL_STATUSES, p.status, 'done'));
  const proposals = PROPOSAL_FILTERS.status.filter((s): s is ProposalStatus => s !== 'all').map(s => `<b>${statuses.filter(x => x === s).length}</b> ${esc(d.pstatus[s])}`).join(' · ');
  const tabs = TALK_KINDS.map(k => `<button type="button" class="tab${k === kind ? ' on' : ''}" data-action="talk-c" data-c="${k}" aria-pressed="${k === kind}">${esc(d.talkKind[k])}</button>`).join('');
  return `<header class="hd"><h1>${esc(d.views.talk)}</h1><div class="meta">${kind === 'proposals' ? proposals : notes}</div></header>
  <div class="tabs">${tabs}</div>
  ${kind === 'proposals' ? renderProposals(m, d, ui, loc) : renderNotes(m, d, ui, loc)}`;
}

function renderNotes(m: Model, d: Dict, ui: UiState, loc: string): string {
  const ro = m.readOnly;
  const notice = ro ? d.notice.readonly : ui.notice && ui.notice !== 'readonly' ? d.notice[ui.notice] : '';
  const comp = `<div class="ncomp ${ro ? 'ro' : ''}">
    <textarea data-role="note-text" maxlength="${MAX_NOTE}" rows="2" placeholder="${esc(d.notePlaceholder)}"${ro ? ' readonly' : ''}>${esc(ui.draft.text)}</textarea>
    <label class="btn sel">${esc(d.noteTypeLabel)}: <select data-action="note-type"${ro ? ' disabled' : ''}>${NOTE_TYPES.map(t =>
      `<option value="${t}"${t === ui.draft.type ? ' selected' : ''}>${esc(d.noteType[t])}</option>`).join('')}</select></label>
    <button class="btn pri" data-action="note-add"${ro ? ' disabled' : ''}>${esc(d.add)}</button>
  </div>${notice ? `<div class="notice" role="status">${esc(notice)}</div>` : ''}`;
  const filt = `<div class="nfil">${NOTE_FILTERS.map(k => `<button class="tab ${ui.noteFilter === k ? 'on' : ''}" data-action="nfilter" data-filter="${k}">${esc(d.nfilter[k as keyof Dict['nfilter']])}</button>`).join('')}</div>`;
  const list = filterNotes(m.notes, ui.noteFilter, m.me);
  const cards = list.map(n => {
    const t = safeNote(n.type);
    const open = t === 'question' && !n.answer;
    const label = open ? d.openQuestion : d.noteType[t];
    const when = fmt(n.ts, loc);
    const dec = n.decision;
    const decHtml = dec ? `<div class="ndec">
        <div><span class="k">${esc(d.decisionChosen)}</span> ${esc(dec.chosen)}${dec.alternatives?.length ? ` <span class="k">(${esc(dec.alternatives.join(', '))})</span>` : ''}</div>
        <div><span class="k">${esc(d.decisionWhy)}</span> ${esc(dec.why)}</div>
        ${dec.revert ? `<div><span class="k">${esc(d.decisionRevert)}</span> ${esc(dec.revert)}</div>` : ''}
      </div>` : '';
    const reply = !open || ro ? '' : ui.answering === n.id
      ? `<div class="areply"><textarea data-role="answer-text" maxlength="${MAX_NOTE}" rows="2" placeholder="${esc(d.answerPlaceholder)}">${esc(ui.answerDraft)}</textarea>
        <button class="btn pri" data-action="answer-send" data-id="${esc(n.id)}">${esc(d.send)}</button></div>`
      : `<button class="btn" data-action="answer-open" data-id="${esc(n.id)}">${esc(d.reply)}</button>`;
    return `<div class="note nb-${t}" data-k="n:${esc(n.id)}">
      <div class="nh"><span><span class="nt-${t}">${esc(label)}</span>${dec ? ` <span class="nauto">${esc(dec.auto ? d.autoTag : d.yoursTag)}</span>` : ''}</span><span class="k">${esc(authorLabel(m, d, n.author))}${when ? ` · ${esc(when)}` : ''}</span></div>
      <p>${esc(n.text)}</p>
      ${decHtml}
      ${n.taskId ? `<button type="button" class="chip" data-action="open-task" data-id="${esc(n.taskId)}" data-k="tk:${esc(n.taskId)}">${esc(n.taskId)}</button>` : ''}
      ${n.answer ? `<div class="ans"><span class="k">${esc(d.answeredBy)} · ${esc(authorLabel(m, d, n.answeredBy ?? ''))}</span>${esc(n.answer)}</div>` : ''}
      ${reply}
    </div>`;
  }).join('');
  return `<section class="notes-view">${comp}${filt}${cards ? `<div class="ngrid">${cards}</div>` : `<div class="muted">${esc(d.noNotes)}</div>`}</section>`;
}

function renderProposals(m: Model, d: Dict, ui: UiState, loc: string): string {
  const ro = m.readOnly || !!m.proposalsReadOnly;
  const f = ui.proposalFilter;
  const all = m.proposals.map(p => ({
    p, status: oneOf(PROPOSAL_STATUSES, p.status, 'done'), category: oneOf(PROPOSAL_CATEGORIES, p.category, 'feature'), risk: oneOf(PROPOSAL_RISKS, p.risk, 'high'),
  }));
  const notice = ro ? d.notice.readonly : ui.notice && ui.notice !== 'readonly' ? d.notice[ui.notice] : '';
  const row = <K extends ProposalFilterKind>(kind: K, label: (v: Exclude<ProposalFilter[K], 'all'>) => string) =>
    `<div class="pfil"><span class="lbl">${esc(d.pfilter[kind])}</span>${PROPOSAL_FILTERS[kind].map(v =>
      `<button class="tab ${f[kind] === v ? 'on' : ''}" data-action="pfilter" data-kind="${kind}" data-value="${v}">${esc(v === 'all' ? d.pfilter.all : label(v as Exclude<ProposalFilter[K], 'all'>))}</button>`).join('')}</div>`;
  const filters = row('status', v => d.pstatus[v]) + row('category', v => d.pcategory[v]) + row('risk', v => d.prisk[v]);
  const list = all
    .filter(x => (f.status === 'all' || x.status === f.status) && (f.category === 'all' || x.category === f.category) && (f.risk === 'all' || x.risk === f.risk))
    .sort((a, b) => (a.p.ts < b.p.ts ? 1 : a.p.ts > b.p.ts ? -1 : 0));
  const cards = list.map(({ p, status, category, risk }) => {
    const id = esc(p.id);
    const when = fmt(p.ts, loc);
    const comments = m.notes.filter(n => n.proposalId === p.id).sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
    const decided = p.decidedBy || p.decidedAt
      ? `<div class="pdec"><span class="k">${esc(d.pfield.decided)} · ${esc(authorLabel(m, d, p.decidedBy ?? ''))}${p.decidedAt && fmt(p.decidedAt, loc) ? ` · ${esc(fmt(p.decidedAt, loc))}` : ''}</span>${p.reason ? `<div>${esc(p.reason)}</div>` : ''}</div>` : '';
    const thread = comments.length ? `<div class="pcom"><div class="lbl">${esc(d.pfield.comments)}</div>${comments.map(n =>
      `<div class="mnote"><span class="k">${esc(authorLabel(m, d, n.author))}${fmt(n.ts, loc) ? ` · ${esc(fmt(n.ts, loc))}` : ''}</span><div>${esc(n.text)}</div></div>`).join('')}</div>` : '';
    let actions = '';
    if (!ro) {
      // §4.1: only the roadmap's owner decides; anyone else comments, and is told so.
      const decide = canDecide(status) && m.isOwner === true;
      const rejectUi = !decide ? '' : ui.rejecting === p.id
        ? `<div class="areply"><textarea data-role="reason-text" maxlength="${MAX_PROPOSAL_TEXT}" rows="2" placeholder="${esc(d.reasonPlaceholder)}">${esc(ui.reasonDraft)}</textarea>
          <button class="btn del" data-action="p-reject-send" data-id="${id}">${esc(d.sendReject)}</button></div>`
        : `<button class="btn" data-action="p-reject-open" data-id="${id}">${esc(d.reject)}</button>`;
      const commentUi = ui.commenting === p.id
        ? `<div class="areply"><textarea data-role="comment-text" maxlength="${MAX_NOTE}" rows="2" placeholder="${esc(d.commentPlaceholder)}">${esc(ui.commentDraft)}</textarea>
          <button class="btn pri" data-action="p-comment-send" data-id="${id}">${esc(d.send)}</button></div>`
        : `<button class="btn" data-action="p-comment-open" data-id="${id}">${esc(d.comment)}</button>`;
      const onlyOwner = canDecide(status) && m.isOwner !== true ? `<div class="muted">${esc(d.owner.onlyOwner)}</div>` : '';
      actions = `<div class="pact">${decide ? `<button class="btn pri" data-action="p-approve" data-id="${id}">${esc(d.approve)}</button>` : ''}${rejectUi}${commentUi}${onlyOwner}</div>`;
    }
    // §4.1: an approval without the owner's valid mark never becomes a task; the owner confirms it (only approvals/ is written).
    const mark = unmarked(p.id, p, m.approvals)
      ? `<div class="pmark"><span class="warn">${esc(d.owner.noMark)}</span>${m.isOwner === true && !ro ? ` <button type="button" class="btn" data-action="p-confirm" data-id="${id}">${esc(d.owner.confirm)}</button>` : ''}</div>`
      : '';
    return `<div class="note prop pr-${risk}" data-id="${id}" data-k="pr:${id}">
      <div class="nh"><span class="tag pc">${esc(d.pcategory[category])}</span><span class="pill risk-${risk}">${esc(d.prisk[risk])}</span><span class="pill ps-${status}">${esc(d.pstatus[status])}</span><span class="k">${esc(authorLabel(m, d, p.author))}${when ? ` · ${esc(when)}` : ''}</span></div>
      <h3>${esc(p.title)}</h3>
      ${p.pillar ? `<div class="mono">${esc(d.pfield.pillar)}: ${esc(p.pillar)}</div>` : ''}
      ${p.rationale ? `<p>${esc(p.rationale)}</p>` : ''}
      ${p.evidence ? `<div class="lbl">${esc(d.pfield.evidence)}</div><pre class="evid" data-scroll-key="evid:${id}">${esc(p.evidence)}</pre>` : ''}
      ${p.estimate || p.path ? `<div class="mono">${p.estimate ? `${esc(d.pfield.estimate)}: ${esc(p.estimate)}` : ''}${p.estimate && p.path ? ' · ' : ''}${p.path ? `${esc(d.pfield.path)}: ${esc(p.path)}` : ''}</div>` : ''}
      ${decided}${mark}
      ${thread}
      ${actions}
    </div>`;
  }).join('');
  return `<section class="proposals-view">${notice ? `<div class="notice" role="status">${esc(notice)}</div>` : ''}${filters}${cards ? `<div class="pgrid">${cards}</div>` : `<div class="muted">${esc(d.noProposals)}</div>`}</section>`;
}
