// Resumen: what needs the person («Te necesita», on top), what is running now, what comes next, how
// far each version and phase is, what happened lately and which sessions are alive. A section shows only when it has
// something, except «En curso», which with nothing running says which free task is next.
import { availableTasks, statusOf } from '../../lib/deps.js';
import { liveness, sessionLiveness } from '../../lib/coordination.js';
import { SATURATION_BLOCKING, SATURATION_ROUNDS, type SaturationBlocking } from '../../lib/forge-run.js';
import type { ForgeDocV2 } from '../../lib/roadmap-doc.js';
import type { PlanTask, RunDoc, TaskState } from '../../lib/types.js';
import type { Derived } from '../derive.js';
import type { Dict } from '../i18n.js';
import { MAX_NOTE } from '../../lib/notes.js';
import type { Need } from '../needs.js';
import { authorLabel, escalatedSessions, esc, eviMark, fmt, hhmm, ICON, isOrphan, labelOf, liveDot, num, pastMs, rel, roleOf, safeNote, safeType, trackTag } from '../html.js';
import { miniFlow } from '../flow.js';
import { versionCards, versionLabel } from './versions.js';
import type { Model, UiState } from '../model.js';

/** v3: the figures on top, then two columns: what needs the person, what runs and what happened (wide), and the versions,
 *  what comes next and the live sessions (narrow). Under 1180 px the columns stack, the wide one first. */
export function renderSummary(m: Model, d: Dict, ui: UiState, loc: string, dv: Derived): string {
  return `<header class="hd"><h1>${esc(d.views.summary)}</h1>${metaLine(m, d, dv)}</header>${renderKpis(m, d, dv, loc)}
  <div class="sumg"><div class="sum-main">${renderNeeds(m, d, ui, dv)}${renderAutonomous(m, d, loc)}${renderNow(m, d, dv)}${renderRecent(m, d, loc)}</div>
  <aside class="sum-side">${renderProgress(m, d, dv, loc)}${renderNext(m, d)}${renderLive(m, d, dv)}</aside></div>`;
}

/** v3: the plan's figures as tiles: the version in progress, the tasks done (with what runs and what is blocked), the
 *  phase, the forecast end, the real pace and the last commit. */
function renderKpis(m: Model, d: Dict, dv: Derived, loc: string): string {
  const x = dv.metrics;
  const tile = (label: string, value: string, sub: string, extra = '', cls = '') =>
    `<div class="kpi${cls ? ` ${cls}` : ''}"><div class="lbl">${esc(label)}</div><div class="kv1">${value}</div>${sub ? `<div class="ksub">${sub}</div>` : ''}${extra}</div>`;
  const bar = (pct: number, done = false) => `<div class="bar${done ? ' c' : ''}"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></div>`;
  const cur = x.currentVersion;
  const vb = cur ? x.byVersion[cur] : undefined;
  const version = cur && vb
    ? tile(d.kpi.version, `<button type="button" class="kbig" data-action="view" data-view="plan" data-pf="v:${esc(cur)}" data-k="kpi:v" title="${esc(d.versions.stripTitle(versionLabel(cur)))}">${esc(versionLabel(cur))}</button> <span class="kpct">${num(vb.percent)} %</span>`, esc(d.versions.tasks(vb.done, vb.total)), bar(vb.percent))
    : tile(d.progress.title, `<span class="kbig">${num(x.percent)} %</span>`, '', bar(x.percent));
  const running = x.inProgress.length;
  const blocked = x.blocked.length;
  const sub = [running ? `<span class="c-peach">● ${esc(d.num(running))} ${esc(d.kpi.running.toLowerCase())}</span>` : '', blocked ? `<span class="ye">⚠ ${esc(d.num(blocked))} ${esc(d.kpi.blocked)}</span>` : ''].filter(Boolean).join(' · ');
  const tasks = tile(d.kpi.tasks, `<span class="kbig">${esc(d.num(x.done))}</span><span class="kof">/${esc(d.num(x.total))}</span>`, sub || `${num(x.percent)} %`, bar(x.percent, true));
  const ci = m.plan.phases.findIndex(p => x.byPhase[p.id]?.status !== 'done');
  const ph = ci >= 0 ? m.plan.phases[ci] : undefined;
  const phase = tile(d.kpi.phase, `<span class="kbig">${ci >= 0 ? ci + 1 : m.plan.phases.length}</span><span class="kof">/${m.plan.phases.length}</span>`, ph ? esc(ph.name || ph.id) : esc(d.phaseStatus.done));
  const f = dv.forecast;
  const eta = tile(d.eta, `<span class="kmid">${f ? esc(day(f.at, loc)) : '—'}</span>`, f ? esc(d.insights.shared(f.parallel)) : '');
  const pace = tile(d.pace, `<span class="kmid">${x.paceMin != null ? esc(d.dur(x.paceMin)) : '—'}</span>`, x.paceMin != null ? `${esc(d.progress.perTask)}${x.startedAt ? ` · ${esc(d.kpi.since)} ${esc(day(Date.parse(x.startedAt), loc))}` : ''}` : '');
  const lc = m.meta?.metrics?.lastCommit;
  const tests = m.meta?.metrics?.tests;
  const commit = lc
    ? tile(d.kpi.commit, `<b class="kmid mono">${esc(lc.sha.slice(0, 7))}</b>`, `${rel(d, 'ago', lc.ts, m.now)}${tests != null ? ` · <b>${num(tests)}</b> ${esc(d.tests)}` : ''}`)
    : tests != null ? tile(d.kpi.tests, `<b class="kmid">${num(tests)}</b>`, '') : '';
  return `<section class="kpis" aria-label="${esc(d.progress.title)}">${version}${tasks}${phase}${eta}${pace}${commit}</section>`;
}

/** A day as «28 oct», for the tiles. */
const day = (ms: number, loc: string): string => {
  try { return new Date(ms).toLocaleDateString(loc, { day: 'numeric', month: 'short' }); } catch { return ''; }
};

/**
 * 6b-3: the card of an autonomous run (meta/infinite with a profile): its profile, whether it runs or why it stopped, and
 * its last saturation report (none below the count): saturated, its evidence (the dry rounds against SATURATION_ROUNDS and
 * each count it would block on, at zero); else what keeps it going, each of the seven blocks with its full count (M-10)
 * and the inputs it lacked by name (T6B3-PAGE-LABELS); and what waits for the person, each group with its full count and
 * the ids the report kept. The findings of retired tasks are told as information only, out of the total. Every id is the
 * report's, escaped. '' for any other run.
 */
export function renderAutonomous(m: Model, d: Dict, loc: string): string {
  const inf = m.infinite;
  if (!inf?.profile) return '';
  const a = d.auto;
  // Task 6 fix 1: each reason forge writes has its own stop line, which says it once; another reason is shown as written.
  const r = inf.stopReason ?? '';
  const state = inf.active ? a.active : Object.hasOwn(a.stop, r) ? a.stop[r]! : a.stopped(r);
  const head = `<h2 class="lbl" id="auto-h">${esc(a.title(inf.profile))}</h2><div class="ast">${esc(state)}</div>`;
  const s = inf.saturation;
  if (!s) return `<section class="card auto" aria-labelledby="auto-h">${head}</section>`;
  const c = s.counts;
  const ids = (list: readonly string[], total: number): string =>
    list.length ? ` <span class="aids">${list.map(x => esc(x)).join(' ')}${total > list.length ? ` ${esc(a.more(total - list.length))}` : ''}</span>` : '';
  const fact = (label: string, value: number, list: readonly string[] = [], cls = ''): string =>
    `<li${cls ? ` class="${cls}"` : ''}>${esc(label)}: <b>${esc(d.num(value))}</b>${ids(list, value)}</li>`;
  const block = (k: SaturationBlocking): string => {
    const e = s.evidence;
    switch (k) {
      // Task 6 fix 1: the dry rounds against their threshold, the one forge stops at; final fix F-M6: at or past it, a cycle that
      // did not explore waits for an exploration round, the only one that concludes.
      case 'rounds': return s.explored === false && s.rounds >= SATURATION_ROUNDS ? `<li>${esc(a.noRound)}</li>`
        : `<li><b>${esc(d.num(s.rounds))}</b> ${esc(a.blocking.rounds(d.num(SATURATION_ROUNDS)))}</li>`;
      case 'pending-tasks': return fact(a.blocking[k], c.pendingTasks, e.pendingTasks);
      case 'validators': return fact(a.blocking[k], c.validatorsFailed, e.validatorsFailed);
      case 'findings': return fact(a.blocking[k], e.openFindings);
      case 'defects': return fact(a.blocking[k], c.openDefects, e.openDefects);
      case 'proposals': return fact(a.blocking[k], c.openProposals, e.openProposals);
      case 'inputs': return `<li>${esc(a.blocking[k])}: ${esc((s.missing ?? []).map(x => labelOf(a.missing, x)).join(', '))}</li>`;
    }
  };
  const when = fmt(s.at, loc);
  // Final fix T6-a: a run stopped as saturated says it in its stop line; the verdict line then keeps only the report's time.
  const word = !inf.active && r === 'saturated' && s.saturated ? '' : s.saturated ? a.saturated : a.notYet;
  const time = when ? `<span class="k">${word ? '· ' : ''}${esc(when)}</span>` : '';
  const verdict = word || time ? `<div class="asat${s.saturated ? ' ok' : ''}">${esc(word)}${word && time ? ' ' : ''}${time}</div>` : '';
  // Saturated, its blocking is empty: the evidence is every count it would block on; a missing input would have blocked.
  const facts = (s.saturated ? SATURATION_BLOCKING.filter(k => k !== 'inputs') : s.blocking).map(block).join('');
  const w = s.waiting;
  const groups: [string, number, readonly string[]][] = [
    [a.wait.parked, c.parked, w.parked], [a.wait.questions, w.questions, []], [a.wait.blocked, w.blocked, []], [a.wait.deferred, w.deferred, []],
    [a.wait.waitsOwner, c.waitsOwner, w.waitsOwner], [a.wait.unowned, c.unowned, w.unowned], [a.wait.blockedTasks, c.blockedTasks, w.blockedTasks],
    [a.wait.unplaced, c.unplaced, w.unplaced],
  ];
  const total = groups.reduce((n, g) => n + g[1], 0);
  const waits = groups.filter(g => g[1] > 0).map(([label, n, list]) => fact(label, n, list)).join('')
    + (c.orphanFindings ? fact(a.wait.orphanFindings, c.orphanFindings, w.orphanFindings, 'ainfo') : '');
  return `<section class="card auto" aria-labelledby="auto-h">${head}${verdict}<ul class="afacts">${facts}</ul>`
    + `<div class="awt"><div class="lbl">${esc(a.waiting(total))}</div>${waits ? `<ul class="afacts">${waits}</ul>` : ''}</div></section>`;
}

/** «Te necesita» (G-24): what to do and a link to the object. No button changes shared state: the only ones are the
 *  answer of a question (a note), navigation and [Visto], which writes only to this browser. */
function renderNeeds(m: Model, d: Dict, ui: UiState, dv: Derived): string {
  if (!dv.needs.length) return '';
  const go = (view: string, label: string, c?: string) => `<button type="button" class="lnk" data-action="view" data-view="${view}"${c ? ` data-c="${c}"` : ''}>${esc(label)}</button>`;
  const task = (id: string, k: string) => `<button type="button" class="chip" data-action="open-task" data-id="${esc(id)}" data-k="${esc(k)}:t">${esc(id)}</button>`;
  const hint = (text: string) => `<div class="hint">${esc(text)}</div>`;
  const keyOf = (n: Need, i: number): string => (n.kind === 'question' ? `need:q:${n.note.id}` : n.kind === 'escalation' ? `need:m:${n.message.id}` : n.kind === 'external' ? `need:x:${n.task}` : `need:${n.kind}:${i}`);
  const item = (n: Need, k: string): string => {
    if (n.kind === 'question') {
      const id = n.note.id;
      const reply = m.readOnly || ui.modal ? '' : ui.answering === id
        ? `<div class="areply"><textarea name="answer" data-role="answer-text" maxlength="${MAX_NOTE}" rows="2" aria-label="${esc(d.answerPlaceholder)}" placeholder="${esc(d.answerPlaceholder)}">${esc(ui.answerDraft)}</textarea><button type="button" class="btn pri" data-action="answer-send" data-id="${esc(id)}">${esc(d.send)}</button></div>`
        : `<button type="button" class="btn" data-action="answer-open" data-id="${esc(id)}">${esc(d.reply)}</button>`;
      const ref = n.note.taskId && m.plan.tasks.some(t => t.id === n.note.taskId) ? ` ${task(n.note.taskId, k)}` : '';
      return `<b>${esc(d.needs.question)}</b> ${esc(n.note.text)}${ref}${reply}`;
    }
    // Carry 5: «only the owner decides» goes to whoever is known not to be the owner, never while it is being resolved.
    if (n.kind === 'proposals') return `<b>${esc(d.needs.proposals(n.count))}</b> ${go('talk', d.needs.seeProposals, 'proposals')}${m.isOwner === false ? hint(d.needs.onlyOwner) : ''}`;
    if (n.kind === 'unowned') return `<b>${esc(d.needs.unowned(n.count))}</b> ${go('talk', d.needs.seeProposals, 'proposals')}`;
    // C26, carry 4b-3: a decision of forge's policy that changed says it was the policy's, never «tu decisión».
    if (n.kind === 'changed') return `<b>${esc((n.policy ? d.needs.changedPolicy : d.needs.changed)(n.count))}</b> ${go('talk', d.needs.seeProposals, 'proposals')}`;
    if (n.kind === 'escalation') return `<b>${esc(`${n.message.from} → ${n.message.to}`)}</b>: ${esc(n.message.text)}${hint(d.needs.escalation(n.message.to))}`;
    if (n.kind === 'external') return `<b>${esc(d.needs.external)}</b> ${task(n.task, k)} ${esc(n.title)} — ${esc(n.reason ?? d.needs.noReason)}${hint(d.needs.unblock(n.task))}`;
    // H-18: the link opens Plan with the Aplazados filter.
    if (n.kind === 'deferred') return `<b>${esc(d.needs.deferred(n.findings, n.tasks.length))}</b> <button type="button" class="lnk" data-action="view" data-view="plan" data-pf="deferred">${esc(d.needs.seePlan)}</button> <button type="button" class="btn" data-action="seen-deferred" data-ids="${esc(n.tasks.map(t => t.id).join(' '))}">${esc(d.needs.seen)}</button>`;
    // Carry 7: the stall reason goes inside the bold line with the run (the brief had it after); kept, the line reads whole.
    // C33: the line says what stopped it (stalled, /forge:stop or the budget), as the banner of Ejecuciones does.
    if (n.kind === 'stalled') return `<b>${esc(d.needs.stalled[n.stop](n.runId) + (n.reason ? `: ${n.reason}` : ''))}</b> ${go('runs', d.needs.seeRuns)}${hint(d.needs.stalledHint)}`;
    if (n.kind === 'infinite') return `<b>${esc(d.needs.infinite(hhmm(n.since)))}</b>${hint(d.needs.infiniteHint)}`;
    return `<b>${esc(d.needs.stalePage(n.page, n.plan))}</b>`;
  };
  const items = dv.needs.map((n, i) => { const k = keyOf(n, i); return `<li class="need nd-${n.kind}" data-k="${esc(k)}">${item(n, k)}</li>`; }).join('');
  return `<section class="card needs" aria-labelledby="needs-h"><h2 class="lbl" id="needs-h">${esc(d.needs.title)}</h2><ul class="nd">${items}</ul></section>`;
}

/** The plan in one line: name, version, phase, tasks done, tracks, tests and the last commit. Carry 10e: the version is
 *  the one in progress, as the strip and the progress say it; the plan's own version (meta.version) goes apart, labelled,
 *  when it is another one, and alone only when the plan has no versions. */
function metaLine(m: Model, d: Dict, dv: Derived): string {
  // v3: the version in progress, the phase, the tasks and the last commit went up to the tiles; the line keeps the plan's
  // name, its own version when it is another one (or the only one, without versions) and its tracks.
  const own = m.meta?.version ?? '';
  const cur = dv.metrics.currentVersion;
  const version = !cur ? (own ? ` · ${esc(d.version)} <b>${esc(own)}</b>` : '')
    : own && versionLabel(own) !== versionLabel(cur) ? ` · ${esc(d.planVersion)} <b>${esc(own)}</b>` : '';
  return `<div class="meta">${esc(m.meta?.name ?? '')}${version} · <span title="${esc(d.trackHelp)}"><b>${m.plan.tracks.length}</b> ${esc(d.tracks)}</span></div>`;
}

const v2 = (f: TaskState['forge']): ForgeDocV2 | null => (f && 'v' in f && f.v === 2 ? f : null);

/** «En curso» (H-08): one row per task under one header per run; the whole row is a button that opens the detail. */
function renderNow(m: Model, d: Dict, dv: Derived): string {
  const tasks = dv.running.map(id => m.plan.tasks.find(t => t.id === id)).filter((t): t is PlanTask => !!t);
  const r = m.run && m.run.active ? m.run : null;
  const loose = r && r.kind === 'ephemeral' ? r.loose.filter(x => x.status === 'running') : [];
  const n = tasks.length + loose.length;
  const title = `<h2 class="lbl">${esc(d.inProgress.title)}${n ? ` (${n})` : ''}</h2>`;
  if (!n) {
    // H-24: with nothing running, which free task comes next.
    const next = availableTasks(m.plan, m.states).find(t => statusOf(m.states, t.id) === 'free');
    return `<section class="card now">${title}<div class="muted">${esc(next ? d.inProgress.nextFree(next.id, next.title) : d.inProgress.nothing)}</div></section>`;
  }
  const inRun = (t: PlanTask) => !!r && isRunTask(m, r, t.id);
  const ofRun = tasks.filter(inRun);
  const others = tasks.filter(t => !inRun(t));
  const head = nowHead(d);
  const groups: string[] = [];
  if (r && (ofRun.length || loose.length)) groups.push(`<div class="rh">${esc(runHead(d, r))}</div>${ofRun.map(t => nowRow(m, d, t)).join('')}${loose.map(x => looseRow(m, d, r, x)).join('')}`);
  if (others.length) groups.push(`${groups.length ? `<div class="rh">${esc(d.inProgress.noRun)}</div>` : ''}${others.map(t => nowRow(m, d, t)).join('')}`);
  return `<section class="card now">${title}<div class="nowt">${head}${groups.join('')}</div></section>`;
}

/** Final review M5: whether a plan task is the run's, the one rule «En curso» and Ejecuciones share: its exec says the run,
 *  or one of the run's slots holds it (the coordinator may write the slot before the task's state). An ephemeral run's
 *  slots hold loose ids, never plan tasks. */
export const isRunTask = (m: Model, r: RunDoc, id: string): boolean =>
  m.states[id]?.exec?.runId === r.runId || (r.kind !== 'ephemeral' && r.slots.some(s => s.task === id));

/** The header row of «En curso» (hidden from assistive technology: each row says it all); Ejecuciones reuses it. */
export const nowHead = (d: Dict): string =>
  `<div class="nrh" aria-hidden="true">${(['task', 'stage', 'round', 'validators', 'time', 'agent', 'who'] as const).map(k => `<span>${esc(d.inProgress.cols[k])}</span>`).join('')}</div>`;

export const runHead = (d: Dict, r: RunDoc): string =>
  (r.kind === 'ephemeral' ? d.inProgress.looseHead : d.inProgress.runHead)(r.runId, labelOf(d.run.mode, r.mode), r.slots.length, r.parallel, r.coordinator, r.branch);

export function nowRow(m: Model, d: Dict, t: PlanTask): string {
  const st: TaskState = m.states[t.id] ?? { status: 'in_progress' };
  const ex = st.exec;
  const f = st.forge;
  const doc = v2(f);
  const orphan = isOrphan(m, st);
  const l = ex ? liveness(m.now, ex.leaseUntil) : sessionLiveness(st.owner ? m.sessions[st.owner] : undefined, m.now);
  const stage = ex?.stage ?? doc?.stage;
  const round = f && typeof f.round === 'number'
    ? `<span${doc?.overCap ? ' class="del"' : ''}>${esc(`r${num(f.round)}${typeof f.cap === 'number' ? `/${num(f.cap)}` : ''}${doc ? ` · ${d.inProgress.brief(doc.brief)}` : ''}`)}</span>`
    : '—';
  const role = roleOf(m, st);
  const sid = ex?.by ?? st.owner;
  return `<button type="button" class="nr${orphan ? ' orphan' : ''}" data-action="open-task" data-id="${esc(t.id)}" data-k="t:${esc(t.id)}">`
    + `<span class="c-task"><span class="k">${esc(t.id)}</span> ${esc(t.title)}${orphan ? ` <span class="pill orphan">${esc(d.run.orphan)}</span>` : ''}${eviMark(m, d, t.id)}</span>`
    + `<span class="c-stage">${liveDot(l)} ${esc(stage ? labelOf(d.run.stage, stage) : '—')}${miniFlow(d, stage)}</span>`
    + `<span class="c-round">${round}</span>`
    + `<span class="c-val">${validators(st)}</span>`
    + `<span class="c-time">${timeOf(m, d, st)}</span>`
    + `<span class="c-agent">${esc(ex?.agent ?? f?.agent ?? '—')}</span>`
    + `<span class="c-who">${esc(role ? d.run.role[role] : '—')}${sid ? ` · ${esc(sid)}` : ''}</span></button>`;
}

/** «✓5 ✗1 ~1»: passed, failed and flaky; a skipped validator, or one without a result, counts in none. */
function validators(st: TaskState): string {
  const vals = (st.forge?.validators ?? []) as { ok: boolean | null; flaky?: boolean; skipped?: string }[];
  let ok = 0;
  let bad = 0;
  let flaky = 0;
  for (const v of vals) {
    if (v.skipped) continue;
    if (v.flaky) flaky++;
    else if (v.ok === true) ok++;
    else if (v.ok === false) bad++;
  }
  if (!ok && !bad && !flaky) return '—';
  return `<span class="ok">✓${ok}</span> <span class="del">✗${bad}</span>${flaky ? ` <span class="warn">~${flaky}</span>` : ''}`;
}

/** The time in the stage and in all, as durations the 30 s tick keeps current. */
function timeOf(m: Model, d: Dict, st: TaskState): string {
  const start = st.startedAt ?? st.claimedAt;
  const total = start && pastMs(start, m.now) !== null ? rel(d, 'dur', start, m.now) : '';
  const stage = st.exec && pastMs(st.exec.since, m.now) !== null ? rel(d, 'dur', st.exec.since, m.now) : '';
  return stage && total ? `${stage} · ${total}` : stage || total || '—';
}

/** A loose task of an ephemeral run: not a plan task, so no detail to open; its dot is the coordinator's liveness. */
export function looseRow(m: Model, d: Dict, r: RunDoc, x: RunDoc['loose'][number]): string {
  const coord = m.sessions[r.coordinator];
  const l = coord ? sessionLiveness(coord, m.now) : 'stopped';
  return `<div class="nr lt"><span class="c-task"><span class="k">${esc(x.id)}</span> ${esc(x.title)}</span>`
    + `<span class="c-stage">${liveDot(l)} ${esc(x.stage ? labelOf(d.run.stage, x.stage) : '—')}</span><span class="c-round">—</span><span class="c-val">—</span><span class="c-time">—</span>`
    + `<span class="c-agent">${esc(x.agent ?? '—')}</span><span class="c-who">${esc(d.run.role.coordinator)} · ${esc(r.coordinator)}</span></div>`;
}

/** «Siguiente»: the first five free tasks whose dependencies are done, in plan order. */
function renderNext(m: Model, d: Dict): string {
  const next = availableTasks(m.plan, m.states).filter(t => statusOf(m.states, t.id) === 'free').slice(0, 5);
  if (!next.length) return '';
  return `<section class="card next"><h2 class="lbl">${esc(d.next.title)}</h2><ul class="nx">${next.map(t =>
    `<li><button type="button" class="nxb" data-action="open-task" data-id="${esc(t.id)}" data-k="nx:${esc(t.id)}"><span class="k">${esc(t.id)}</span> ${esc(t.title)} ${trackTag(m, t.track)}</button></li>`).join('')}</ul></section>`;
}

/** The progress (G-11, H-27; v3): with versions, a card per version with its phases (what each one holds); without them,
 *  one segment per phase with the current one marked. The figures went up to the tiles. */
function renderProgress(m: Model, d: Dict, dv: Derived, loc: string): string {
  const x = dv.metrics;
  if (m.plan.versions.length) return `<section class="card prog"><h2 class="lbl">${esc(d.versions.title)}</h2>${versionCards(m, d, x, { ends: dv.versionEnds, loc, compact: true })}</section>`;
  if (!m.plan.phases.length) return '';
  const current = m.plan.phases.findIndex(p => x.byPhase[p.id]?.status !== 'done');
  const phases = `<div class="phs">${m.plan.phases.map((p, i) => {
      const b = x.byPhase[p.id];
      const pct = b && b.total ? Math.round((b.done / b.total) * 100) : 0;
      return `<span class="phseg ph-${esc(b?.status ?? p.plan_status)}${i === current ? ' cur' : ''}" style="flex-grow:${Math.max(1, b?.total ?? 1)}" title="${esc(`${p.id} · ${p.name} · ${b?.done ?? 0}/${b?.total ?? 0}`)}"><i style="width:${pct}%"></i><b>${esc(p.id)}</b> ${pct} %</span>`;
    }).join('')}</div>`;
  return `<section class="card prog"><h2 class="lbl">${esc(d.progress.title)}</h2>${phases}<div class="mono">${esc(d.phasesDone)}: ${x.phasesDone} ${esc(d.of)} ${x.phaseCount}</div></section>`;
}

const sameDay = (iso: string, now: number): boolean => {
  const a = new Date(iso);
  const b = new Date(now);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
};

/** The recent activity (H-21): 14 entries in two lines (time, icon, task and author; then the whole text, also in its title). */
function renderRecent(m: Model, d: Dict, loc: string): string {
  type Entry = { ts: string; k: string; task?: string; icon: string; cls: string; who: string; text: string; add?: number; del?: number };
  const feed: Entry[] = [
    ...m.events.map(e => ({ ts: e.ts, k: `e:${e.id}`, task: e.taskId, icon: ICON[safeType(e.type)], cls: `ev-${safeType(e.type)}`, who: e.sessionId, text: e.text ?? d.eventText[safeType(e.type)], add: e.add, del: e.del })),
    ...m.messages.map(g => ({ ts: g.ts, k: `m:${g.id}`, task: g.taskId, icon: ICON.message, cls: 'ev-message', who: `${g.from} → ${g.to}`, text: g.text })),
    ...m.notes.filter(n => !n.proposalId).map(n => ({ ts: n.ts, k: `n:${n.id}`, task: n.taskId, icon: '✎', cls: `nt-${safeNote(n.type)}`, who: authorLabel(m, d, n.author), text: `${d.noteType[safeNote(n.type)]}: ${n.text}` })),
    // v3: each review round forge closed is a change too: its action and the first finding that blocked it.
    ...m.plan.tasks.flatMap(t => (v2(m.states[t.id]?.forge)?.rounds ?? []).map(r => {
      const w = r.why?.[0];
      return { ts: r.at, k: `r:${t.id}:${r.brief}-${r.n}`, task: t.id, icon: '↺', cls: `ev-round a-${r.action}`, who: r.reviewers.join(', '),
        text: `${d.round.activity(r.n, labelOf(d.action, r.action))}${w ? ` — ${d.round.sev[w.sev] ?? w.sev}: ${w.problem}` : ''}` };
    })),
  ].sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0)).slice(0, 14);
  if (!feed.length) return '';
  const items = feed.map(f => {
    const when = fmt(f.ts, loc, !sameDay(f.ts, m.now));
    const nums = f.add != null ? `<span class="nums"><span class="ok">+${num(f.add)}</span><span class="del">−${num(f.del)}</span></span>` : '<span class="nums"></span>';
    // v3: one row on a wide screen (time, icon, task, text, author, lines), two on a narrow one.
    const body = `<span class="mono t">${esc(when)}</span><span class="ev ${f.cls}" aria-hidden="true">${f.icon}</span><b class="atk">${esc(f.task ?? '')}</b><span class="tx" title="${esc(f.text)}">${esc(f.text)}</span><span class="k awho">${esc(f.who)}</span>${nums}`;
    const isTask = !!f.task && m.plan.tasks.some(t => t.id === f.task);
    return isTask
      ? `<li><button type="button" class="act" data-action="open-task" data-id="${esc(f.task)}" data-k="${esc(f.k)}">${body}</button></li>`
      : `<li><div class="act">${body}</div></li>`;
  }).join('');
  return `<section class="card recent"><h2 class="lbl">${esc(d.recent)}</h2><ul class="events feed">${items}</ul></section>`;
}

/** The live sessions (G-04), alive or silent by their lease; the stopped ones are a count that leads to Sesiones. */
function renderLive(m: Model, d: Dict, dv: Derived): string {
  const { live, idle } = dv.liveSessions;
  if (!live.length && !idle) return '';
  const esca = escalatedSessions(m);
  const cards = live.map(sid => {
    const s = m.sessions[sid]!;
    const l = sessionLiveness(s, m.now);
    const warn = esca.has(sid);
    return `<div class="s ${l === 'silent' ? 'silent' : ''} ${warn ? 'warn' : ''}" data-k="s:${esc(sid)}"><div class="n">${warn ? '⚠' : liveDot(l)} ${esc(s.name)} ${trackTag(m, s.track)}</div>
      <div class="mono">${esc(s.currentTask ?? '—')} · ${esc(d.heartbeat)} ${rel(d, 'hb', s.heartbeatAt, m.now)}</div></div>`;
  }).join('');
  const more = idle ? `<button type="button" class="more" data-action="view" data-view="sessions">${esc(d.liveSess.idle(idle))}</button>` : '';
  return `<section class="sess"><h2 class="lbl">${esc(d.liveSess.title)}</h2><div class="sgrid2">${cards}${more}</div></section>`;
}
