// Conversación (G-17, H-17): one composer on top, one row of filters (everything, open questions, decisions,
// proposals, ideas and debt, mine) and one list where notes and proposals mix by date. A proposal carries its comments
// (they never show loose), the task it became, its history and the owner's mark; a decision shows its structure; a question
// a decision resolved shows closed, with a link to that decision. Only the roadmap's owner decides proposals (§4.1): the
// rules 4b set for it (the mark first, [Confirmar] only without one, a decision that changed decided again with its text in
// view, the retry of an update that failed) hold under every filter, and who decided is what the owner's mark says (C26).
import { canDecide, MAX_PROPOSAL_TEXT, PROPOSAL_CATEGORIES, PROPOSAL_RISKS, PROPOSAL_STATUSES, type ApprovalDoc, type ProposalDoc, type ProposalStatus } from '../../lib/proposals.js';
import { counts, MAX_NOTE, NOTE_TYPES } from '../../lib/notes.js';
import { inlineMd } from '../../lib/inline-md.js';
import type { NoteDoc } from '../../lib/types.js';
import type { Dict } from '../i18n.js';
import { authorLabel, decisionBlock, esc, fmt, labelOf, oneOf, safeNote, safeStatus, unmarkedReason } from '../html.js';
import { PROPOSAL_FILTERS, TALK_FILTERS, type Model, type ProposalFilter, type ProposalFilterKind, type TalkFilter, type UiState } from '../model.js';

type Note = NoteDoc & { id: string };
type Prop = ProposalDoc & { id: string };
type Item = { ts: string; note?: Note; prop?: Prop };

const time = (s: string): number => { const t = Date.parse(s); return Number.isFinite(t) ? t : -Infinity; };
/** An open question: no answer, and not closed by a decision (H-17). */
const isOpenQuestion = (n: NoteDoc): boolean => n.type === 'question' && !n.answer && !n.answeredByNote;
/** A person as the page names them, never as «tú»: for who decided or reopened a proposal, which anyone who writes
 *  proposals/ can set (C26). */
const named = (m: Model, d: Dict, who: string): string => authorLabel(m.me === null ? m : { ...m, me: null }, d, who);

export function renderTalkView(m: Model, d: Dict, ui: UiState, loc: string): string {
  const filter: TalkFilter = ui.talk && TALK_FILTERS.includes(ui.talk) ? ui.talk : 'all';
  // G-17: a proposal's comments live inside it, never as loose notes.
  const loose = m.notes.filter(n => !n.proposalId);
  const c = counts(loose);
  // H-17: a question a decision closed is not open, here as in its filter.
  const open = loose.filter(isOpenQuestion).length;
  const toDecide = m.proposals.filter(p => canDecide(oneOf(PROPOSAL_STATUSES, p.status, 'done'))).length;
  const meta = `<b>${open}</b> ${esc(d.noteCounts.open)} · <b>${c.decision}</b> ${esc(d.noteCounts.decision)} · <b>${c.idea}</b> ${esc(d.noteCounts.idea)} · <b>${c.debt}</b> ${esc(d.noteCounts.debt)} · <b>${toDecide}</b> ${esc(d.talk.toDecide)}`;
  // Review Important 1: the filters are keyed (a constant set), so the one clicked keeps its node, and its focus, through a
  // morph that brings or clears the notice above them.
  const tabs = `<div class="tabs" role="group" aria-label="${esc(d.talk.label)}">${TALK_FILTERS.map(k => `<button type="button" class="tab${k === filter ? ' on' : ''}" data-action="talk-c" data-c="${k}" aria-pressed="${k === filter}" data-k="tc:${k}">${esc(d.talk.filter[k])}</button>`).join('')}</div>`;
  const list = itemsOf(m, ui, filter, loose).map(x => (x.note ? noteCard(m, d, ui, loc, x.note) : proposalCard(m, d, ui, loc, x.prop!))).join('');
  return `<header class="hd"><h1>${esc(d.views.talk)}</h1><div class="meta">${meta}</div></header>
  ${composer(m, d, ui, filter)}${tabs}${filter === 'proposals' ? proposalFilters(d, ui) : ''}
  <section class="talk">${list ? `<div class="tlist">${list}</div>` : `<div class="muted">${esc(d.talk.empty[filter])}</div>`}</section>`;
}

/** What a filter shows, notes and proposals mixed by date, newest first (stable for equal or junk dates). The proposal
 *  filters (status, category, risk) apply only under «Propuestas», where they show. */
function itemsOf(m: Model, ui: UiState, filter: TalkFilter, loose: Note[]): Item[] {
  const mine = (author: string) => m.me !== null && author === m.me;
  const notes = filter === 'proposals' ? [] : loose.filter(n =>
    filter === 'all' ? true
    : filter === 'open' ? isOpenQuestion(n)
    : filter === 'decision' ? n.type === 'decision'
    : filter === 'ideas' ? n.type === 'idea' || n.type === 'debt'
    : mine(n.author));
  const f = ui.proposalFilter;
  const props = filter === 'all' ? m.proposals
    : filter === 'mine' ? m.proposals.filter(p => mine(p.author))
    : filter === 'proposals' ? m.proposals.filter(p => (f.status === 'all' || oneOf(PROPOSAL_STATUSES, p.status, 'done') === f.status)
      && (f.category === 'all' || oneOf(PROPOSAL_CATEGORIES, p.category, 'feature') === f.category)
      && (f.risk === 'all' || oneOf(PROPOSAL_RISKS, p.risk, 'high') === f.risk))
    : [];
  return [...notes.map(n => ({ ts: n.ts, note: n })), ...props.map(p => ({ ts: p.ts, prop: p }))]
    .map((x, i) => ({ x, i })).sort((a, b) => (time(b.x.ts) - time(a.x.ts)) || a.i - b.i).map(y => y.x);
}

/** The composer of a new note, and what the page has to say about writing: read-only first; else what the last action
 *  left (a failed write, an answer or a decision that came too late, the mark saved without its proposal, with its retry,
 *  review M6); else, under «Propuestas», that the proposals turned read-only (only they did: notes keep working). The
 *  notice box is always there, empty when there is nothing to say: what follows it keeps its place when a notice comes or
 *  goes (review Important 1), and a screen reader has the live region before its text arrives. */
function composer(m: Model, d: Dict, ui: UiState, filter: TalkFilter): string {
  const ro = m.readOnly;
  const notice = ro ? d.notice.readonly
    : ui.notice && ui.notice !== 'readonly' ? d.notice[ui.notice]
    : m.proposalsReadOnly && filter === 'proposals' ? d.notice.readonly : '';
  const retry = !ro && !m.proposalsReadOnly && ui.notice === 'markSaved' ? ` <button type="button" class="btn" data-action="p-retry">${esc(d.retry)}</button>` : '';
  return `<div class="ncomp ${ro ? 'ro' : ''}">
    <textarea name="note" data-role="note-text" maxlength="${MAX_NOTE}" rows="2" aria-label="${esc(d.talk.compose)}" placeholder="${esc(d.notePlaceholder)}"${ro ? ' readonly' : ''}>${esc(ui.draft.text)}</textarea>
    <label class="btn sel">${esc(d.noteTypeLabel)}: <select name="note-type" data-action="note-type"${ro ? ' disabled' : ''}>${NOTE_TYPES.map(t =>
      `<option value="${t}"${t === ui.draft.type ? ' selected' : ''}>${esc(d.noteType[t])}</option>`).join('')}</select></label>
    <button type="button" class="btn pri" data-action="note-add"${ro ? ' disabled' : ''}>${esc(d.add)}</button>
  </div><div class="notice" role="status">${notice ? `${esc(notice)}${retry}` : ''}</div>`;
}

/** The status, category and risk filters of the proposals, under «Propuestas» only. */
function proposalFilters(d: Dict, ui: UiState): string {
  const f = ui.proposalFilter;
  const row = <K extends ProposalFilterKind>(kind: K, label: (v: Exclude<ProposalFilter[K], 'all'>) => string) =>
    `<div class="pfil"><span class="lbl">${esc(d.pfilter[kind])}</span>${PROPOSAL_FILTERS[kind].map(v =>
      `<button type="button" class="tab ${f[kind] === v ? 'on' : ''}" data-action="pfilter" data-kind="${kind}" data-value="${v}" aria-pressed="${f[kind] === v}" data-k="pfl:${kind}:${v}">${esc(v === 'all' ? d.pfilter.all : label(v as Exclude<ProposalFilter[K], 'all'>))}</button>`).join('')}</div>`;
  return row('status', v => d.pstatus[v]) + row('category', v => d.pcategory[v]) + row('risk', v => d.prisk[v]);
}

/** A note: its kind (an open question says so), who and when, its text, a decision's structure, its task (a chip keyed by
 *  the note, review M2), its answer or the decision that closed it (H-17), and [Responder] on an open question. Focusable
 *  (tabindex -1), so «Ver la decisión» can give it the focus. */
function noteCard(m: Model, d: Dict, ui: UiState, loc: string, n: Note): string {
  const t = safeNote(n.type);
  const open = isOpenQuestion(n);
  const when = fmt(n.ts, loc);
  const dec = n.decision;
  // H-17: a question a decision closed names that decision, and «Ver la decisión» brings it into view. Only a loose
  // decision (not a proposal's comment, not a note of another kind) is one the list shows and the link can reach.
  const by = n.answeredByNote ? m.notes.find(x => x.id === n.answeredByNote && x.type === 'decision' && !x.proposalId) : undefined;
  // Review Minor 1: the viewer's own decision reads «tu decisión», not «la decisión de tú».
  const whose = !by ? d.talk.resolvedByUnknown : m.me !== null && by.author === m.me ? d.talk.resolvedByYou : d.talk.resolvedBy(authorLabel(m, d, by.author));
  const answer = n.answeredByNote
    ? `<div class="ans res"><span class="k">${esc(whose)}</span>${n.answer ? esc(n.answer) : ''}${by ? `<button type="button" class="lnk" data-action="note-go" data-id="${esc(by.id)}">${esc(d.talk.seeDecision)}</button>` : ''}</div>`
    : n.answer ? `<div class="ans"><span class="k">${esc(d.answeredBy)} · ${esc(authorLabel(m, d, n.answeredBy ?? ''))}</span>${esc(n.answer)}</div>` : '';
  const reply = !open || m.readOnly ? '' : ui.answering === n.id
    ? `<div class="areply"><textarea name="answer" data-role="answer-text" maxlength="${MAX_NOTE}" rows="2" aria-label="${esc(d.answerPlaceholder)}" placeholder="${esc(d.answerPlaceholder)}">${esc(ui.answerDraft)}</textarea>
      <button type="button" class="btn pri" data-action="answer-send" data-id="${esc(n.id)}">${esc(d.send)}</button></div>`
    : `<button type="button" class="btn" data-action="answer-open" data-id="${esc(n.id)}">${esc(d.reply)}</button>`;
  return `<div class="note nb-${t}" data-k="n:${esc(n.id)}" tabindex="-1">
    <div class="nh"><span><span class="nt-${t}">${esc(open ? d.openQuestion : d.noteType[t])}</span>${dec ? ` <span class="nauto">${esc(dec.auto ? d.autoTag : d.yoursTag)}</span>` : ''}</span><span class="k">${esc(authorLabel(m, d, n.author))}${when ? ` · ${esc(when)}` : ''}</span></div>
    <p>${inlineMd(esc(n.text))}</p>
    ${dec ? decisionBlock(d, dec, true) : ''}
    ${n.taskId ? `<button type="button" class="chip" data-action="open-task" data-id="${esc(n.taskId)}" data-k="tk:${esc(n.id)}">${esc(n.taskId)}</button>` : ''}
    ${answer}
    ${reply}
  </div>`;
}

/** The owner's mark of a proposal (approvals/<pid>), by an own key only: nothing inherited from Object.prototype passes for
 *  one; undefined until the marks arrive. */
const markOf = (m: Model, pid: string): ApprovalDoc | undefined =>
  (m.approvals && Object.hasOwn(m.approvals, pid) ? m.approvals[pid] : undefined);

/** C26 (carries 4b-2, 4b-3): who decided a proposal, as far as the page can vouch for it. The owner's mark says it when there
 *  is one: the page or /forge:decide is the owner («tú» to them, once the page knows they are), forge's policy is the policy
 *  and never the owner; with the mark's time, and the status it marked when the proposal now says another. Final review
 *  I1: without a mark nothing vouches for who decided, whatever the status: since 4a every decision the page or forge takes
 *  writes its mark first, so a decided proposal without one is older than the marks or forged. Its decidedBy, which anyone
 *  who writes proposals/ can set, is never shown: the line reads «Decidida · sin verificar», never «tú» nor a name. The
 *  proposal's reason is not part of this line (see proposalCard). '' when nothing says it was decided. */
function decidedLine(m: Model, d: Dict, p: Prop, status: ProposalStatus, a: ApprovalDoc | undefined, loc: string): string {
  let line: string;
  let at: string | undefined;
  if (a) {
    const owner = m.isOwner === true;
    const who = a.by === 'forge:policy' ? d.owner.by.policy
      : a.by === 'forge:decide' ? (owner ? d.owner.by.youForge : d.owner.by.ownerForge)
      : owner ? d.you : d.owner.by.owner;
    at = a.decidedAt;
    line = `${d.pfield.decided} · ${who}${a.status !== status ? ` · ${labelOf(d.pstatus, a.status)}` : ''}`;
  } else {
    if (!p.decidedBy && !p.decidedAt) return '';
    line = d.pfield.unverified;
    at = p.decidedAt;
  }
  const date = at ? fmt(at, loc) : '';
  return `<div class="pdec"><span class="k">${esc(line)}${date ? ` · ${esc(date)}` : ''}</span></div>`;
}

/** A proposal: its category, risk and status, the task it became (G-17), its text, who decided it (C26), the owner's mark
 *  (§4.1), its history, its comments (oldest first) and, to the owner, Approve and Reject; anyone else comments. */
function proposalCard(m: Model, d: Dict, ui: UiState, loc: string, p: Prop): string {
  const ro = m.readOnly || !!m.proposalsReadOnly;
  const status = oneOf(PROPOSAL_STATUSES, p.status, 'done');
  const category = oneOf(PROPOSAL_CATEGORIES, p.category, 'feature');
  const risk = oneOf(PROPOSAL_RISKS, p.risk, 'high');
  const id = esc(p.id);
  const when = fmt(p.ts, loc);
  const comments = m.notes.filter(n => n.proposalId === p.id).sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  const a = markOf(m, p.id);
  const decided = decidedLine(m, d, p, status, a, loc);
  // Review Minor 2: the reason is free text anyone who writes proposals/ can change (the mark's digest does not cover it):
  // it goes on its own line, labelled as the proposal's, never inside the line the owner's mark vouches for.
  const reason = p.reason ? `<div class="prsn"><span class="k">${esc(d.pfield.reason)}</span> ${esc(p.reason)}</div>` : '';
  const thread = comments.length ? `<div class="pcom"><div class="lbl">${esc(d.pfield.comments)}</div>${comments.map(n =>
    `<div class="mnote"><span class="k">${esc(authorLabel(m, d, n.author))}${fmt(n.ts, loc) ? ` · ${esc(fmt(n.ts, loc))}` : ''}</span><div>${esc(n.text)}</div></div>`).join('')}</div>` : '';
  // §4.1: an approval the owner's mark does not back never becomes a task. Without a mark (from before the marks) the owner
  // confirms it (only approvals/ is written); with a mark of other text or another status, the decision changed after the
  // owner took it (review I2, re-review N1): it is decided again with its text in view, as a proposed one, with Approve
  // and Reject, never a one-click confirm.
  const why = unmarkedReason(p.id, p, m.approvals);
  const open = canDecide(status) || why === 'changed';
  let actions = '';
  if (!ro) {
    // §4.1: only the roadmap's owner decides; anyone else comments, and is told so once it is known (carry 5).
    const decide = open && m.isOwner === true;
    const rejectUi = !decide ? '' : ui.rejecting === p.id
      ? `<div class="areply"><textarea name="reason" data-role="reason-text" maxlength="${MAX_PROPOSAL_TEXT}" rows="2" aria-label="${esc(d.reasonPlaceholder)}" placeholder="${esc(d.reasonPlaceholder)}">${esc(ui.reasonDraft)}</textarea>
        <button type="button" class="btn del" data-action="p-reject-send" data-id="${id}">${esc(d.sendReject)}</button></div>`
      : `<button type="button" class="btn" data-action="p-reject-open" data-id="${id}">${esc(d.reject)}</button>`;
    const commentUi = ui.commenting === p.id
      ? `<div class="areply"><textarea name="comment" data-role="comment-text" maxlength="${MAX_NOTE}" rows="2" aria-label="${esc(d.commentPlaceholder)}" placeholder="${esc(d.commentPlaceholder)}">${esc(ui.commentDraft)}</textarea>
        <button type="button" class="btn pri" data-action="p-comment-send" data-id="${id}">${esc(d.send)}</button></div>`
      : `<button type="button" class="btn" data-action="p-comment-open" data-id="${id}">${esc(d.comment)}</button>`;
    const onlyOwner = open && m.isOwner === false ? `<div class="muted">${esc(d.owner.onlyOwner)}</div>` : '';
    actions = `<div class="pact">${decide ? `<button type="button" class="btn pri" data-action="p-approve" data-id="${id}">${esc(d.approve)}</button>` : ''}${rejectUi}${commentUi}${onlyOwner}</div>`;
  }
  // C26, carry 4b-3: a decision that changed after it was taken says whose it was: forge's policy, or the owner's («tu
  // decisión» to the owner).
  const changed = a?.by === 'forge:policy'
    ? (m.isOwner === true ? d.owner.changedPolicy : d.owner.changedPolicyOther)
    : (m.isOwner === true ? d.owner.changed : d.owner.changedOther);
  const mark = why === 'no-mark'
    ? `<div class="pmark"><span class="warn">${esc(d.owner.noMark)}</span>${m.isOwner === true && !ro ? ` <button type="button" class="btn" data-action="p-confirm" data-id="${id}">${esc(d.owner.confirm)}</button>` : ''}</div>`
    : why === 'changed' ? `<div class="pmark"><span class="warn">${esc(changed)}</span></div>` : '';
  // G-17: the task the proposal became; a button only when the plan has it.
  const toTask = !p.taskId ? ''
    : m.plan.tasks.some(t => t.id === p.taskId)
      ? `<button type="button" class="chip st-${safeStatus(m.states[p.taskId]?.status)}" data-action="open-task" data-id="${esc(p.taskId)}" data-k="pt:${id}">→ ${esc(p.taskId)}</button>`
      : `<span class="chip">→ ${esc(p.taskId)}</span>`;
  // G-17: the decisions a reopen replaced, as the proposal records them: its own account, which anyone who writes
  // proposals/ can change, and labelled so. Who reopened it is named as written, never as «tú» (C26); who had decided is not
  // named at all: no mark vouches for it (final review I1).
  const history = p.history?.length
    ? `<div class="phist"><div class="lbl">${esc(d.talk.history)}</div><ul>${p.history.map(step =>
        `<li>${esc(d.talk.reopened(named(m, d, step.reopenedBy), fmt(step.reopenedAt, loc), d.pstatus[oneOf(PROPOSAL_STATUSES, step.status, 'done')]))}${step.reason ? ` · ${esc(step.reason)}` : ''}</li>`).join('')}</ul></div>`
    : '';
  return `<div class="note prop pr-${risk}" data-id="${id}" data-k="pr:${id}">
    <div class="nh"><span class="tag pc">${esc(d.pcategory[category])}</span><span class="pill risk-${risk}">${esc(d.prisk[risk])}</span><span class="pill ps-${status}">${esc(d.pstatus[status])}</span>${toTask}<span class="k">${esc(authorLabel(m, d, p.author))}${when ? ` · ${esc(when)}` : ''}</span></div>
    <h3>${esc(p.title)}</h3>
    ${p.pillar ? `<div class="mono">${esc(d.pfield.pillar)}: ${esc(p.pillar)}</div>` : ''}
    ${p.rationale ? `<p>${esc(p.rationale)}</p>` : ''}
    ${p.evidence ? `<div class="lbl">${esc(d.pfield.evidence)}</div><pre class="evid" data-scroll-key="evid:${id}">${esc(p.evidence)}</pre>` : ''}
    ${p.estimate || p.path ? `<div class="mono">${p.estimate ? `${esc(d.pfield.estimate)}: ${esc(p.estimate)}` : ''}${p.estimate && p.path ? ' · ' : ''}${p.path ? `${esc(d.pfield.path)}: ${esc(p.path)}` : ''}</div>` : ''}
    ${decided}${reason}${mark}${history}
    ${thread}
    ${actions}
  </div>`;
}
