// v3: forge's way through a task, drawn. The flow of its stages (the one in progress pulses, a loop under implement…verdict
// counts the review rounds), the small dots «En curso» and the slots use, the bar of its trail (each stage as long as it
// lasted, the last one growing to now) and the story of its rounds: what blocked each one and what forge decided next.
// Pure: strings from the model, like every view.
import { liveness } from '../lib/coordination.js';
import type { ForgeDocV2, RoundV2 } from '../lib/roadmap-doc.js';
import { STAGES, type TaskState } from '../lib/types.js';
import type { Dict } from './i18n.js';
import { esc, fmt, hhmm, labelOf, num, pastMs, rel } from './html.js';
import type { Model } from './model.js';

/** The stages of the flow, in order; `done` closes it. */
const FLOW = ['triage', 'brief', 'implement', 'validate', 'verify', 'review', 'verdict', 'integrate', 'done'] as const;
type FlowStage = (typeof FLOW)[number];
/** The span of the review loop in the flow: from implement to verdict. */
const LOOP_FROM = FLOW.indexOf('implement');
const LOOP_TO = FLOW.indexOf('verdict');

export const forgeV2 = (f: TaskState['forge']): ForgeDocV2 | null => (f && 'v' in f && f.v === 2 ? f : null);

/** A trail or doc stage as the flow places it: a fix attempt is implement; the ends and unknowns have no node. */
const flowStage = (s: string | undefined | null): FlowStage | null => {
  if (!s) return null;
  if (s === 'fix') return 'implement';
  return (FLOW as readonly string[]).includes(s) ? (s as FlowStage) : null;
};

/** Where a task is: its flow stage, and whether it stopped there blocked or stopped (no pulse, in alarm colour). */
export function whereIs(st: TaskState | undefined): { stage: FlowStage | null; halt: 'blocked' | 'stopped' | null } {
  const doc = forgeV2(st?.forge);
  const raw = st?.exec?.stage ?? doc?.stage ?? null;
  if (raw === 'blocked' || raw === 'stopped' || st?.status === 'blocked') {
    // The last stage it reached, from its trail; else the one its block says.
    const last = [...(doc?.trail ?? [])].reverse().map(t => flowStage(t.s)).find(s => s && s !== 'done') ?? null;
    return { stage: last ?? flowStage(doc?.phase), halt: raw === 'stopped' ? 'stopped' : 'blocked' };
  }
  if (st?.status === 'done') return { stage: 'done', halt: null };
  return { stage: flowStage(raw), halt: null };
}

/** The rounds of the brief in progress, closed ones; the number of the next review is one more. */
const briefRounds = (doc: ForgeDocV2): RoundV2[] => doc.rounds.filter(r => r.brief === doc.brief);

/** Whether forge still works the task: not done, not stopped, not accepted, in progress or with an exec. */
const working = (st: TaskState, doc: ForgeDocV2): boolean =>
  st.status !== 'done' && doc.stage !== 'done' && doc.stage !== 'stopped' && doc.acceptedRound === null
  && (st.status === 'in_progress' || st.status === 'claimed' || !!st.exec);

/**
 * The flow of forge's stages for one task: past stages with a tick and their time, the one in progress pulsing (still
 * when its executor's lease lapsed), the rest to do; verify dimmed when forge planned none. Under implement…verdict, the
 * loop of the review rounds with their count against the cap (red over it). '' for a task forge never touched.
 */
export function stageFlow(m: Model, d: Dict, st: TaskState | undefined): string {
  const doc = forgeV2(st?.forge);
  if (!doc && !st?.exec) return '';
  const { stage, halt } = whereIs(st);
  const at = stage ? FLOW.indexOf(stage) : -1;
  const alive = st?.exec ? liveness(m.now, st.exec.leaseUntil) : null;
  const still = halt !== null || alive === 'stopped';
  const secs = doc?.stages ?? {};
  const nodes = FLOW.map((k, i) => {
    const skip = k === 'verify' && doc?.verify?.planned === false;
    const state = i < at || stage === 'done' ? 'past' : i === at ? 'cur' : 'todo';
    const cls = `fn ${state}${skip ? ' skip' : ''}${state === 'cur' && halt ? ` ${halt}` : ''}${state === 'cur' && still ? ' still' : ''}`;
    const t = num(secs[k]);
    const time = skip ? d.flow.skipped : t > 0 ? d.dur(t / 60) : '';
    // The stage in progress shows how long it has run, which the 30 s tick keeps current.
    const live = state === 'cur' && k !== 'done' && st?.exec && pastMs(st.exec.since, m.now) !== null ? rel(d, 'dur', st.exec.since, m.now) : '';
    const mark = state === 'past' ? '✓' : state === 'cur' ? (halt === 'stopped' ? '■' : halt ? '!' : '●') : '';
    const label = k === 'done' ? d.run.stage.done : labelOf(d.run.stage, k);
    return `<li class="${cls}"${state === 'cur' ? ' aria-current="step"' : ''}><i class="fd" aria-hidden="true">${mark}</i><span class="fl">${esc(label)}</span><span class="ft">${live || esc(time)}</span></li>`;
  }).join('');
  // The review in progress: one past the closed ones while forge still works the task (forge's own `round` is the last
  // one closed), else the last one; never under what forge says.
  const n = doc ? Math.max(briefRounds(doc).length + (st && working(st, doc) ? 1 : 0), num(doc.round)) : 0;
  const over = !!doc && (doc.overCap || (typeof doc.cap === 'number' && n > doc.cap));
  const loop = doc && n > 1
    ? `<div class="floop${over ? ' over' : ''}${at >= LOOP_FROM && at <= LOOP_TO && !still ? ' on' : ''}" style="--a:${LOOP_FROM};--b:${LOOP_TO}" aria-hidden="true"><svg viewBox="0 0 100 20" preserveAspectRatio="none"><path d="M1 0 V12 Q1 19 8 19 H92 Q99 19 99 12 V0" vector-effect="non-scaling-stroke"/></svg>`
      + `<span>↺ ${esc(typeof doc.cap === 'number' ? d.flow.loopOf(n, doc.cap) : d.flow.loop(n))}</span></div>`
    : '';
  return `<div class="flowbox"><div class="flowin" style="--n:${FLOW.length}"><ol class="flow" aria-label="${esc(d.flow.label)}">${nodes}</ol>${loop}</div></div>`;
}

/** The small flow of «En curso» and the slots: one dot per stage of forge, the current one lit. */
export function miniFlow(d: Dict, stage: string | null | undefined): string {
  const s = flowStage(stage);
  if (!s || s === 'done' || s === 'triage') return '';
  const at = STAGES.indexOf(s as (typeof STAGES)[number]);
  if (at < 0) return '';
  return `<span class="mflow" role="img" aria-label="${esc(labelOf(d.run.stage, s))}">${STAGES.map((_, i) => `<i class="${i < at ? 'past' : i === at ? 'cur' : ''}"></i>`).join('')}</span>`;
}

/**
 * The bar of the trail: each step as wide as it lasted (the last one to now while the task runs), coloured by its stage,
 * with a tick where each round closed. '' with fewer than two steps or no usable times.
 */
export function trailBar(m: Model, d: Dict, st: TaskState | undefined, loc: string): string {
  const doc = forgeV2(st?.forge);
  const trail = (doc?.trail ?? []).filter(t => pastMs(t.at, m.now) !== null);
  if (trail.length < 2 && !(trail.length === 1 && st?.status !== 'done')) return '';
  const ends = trail.at(-1)!.s === 'done' || trail.at(-1)!.s === 'stopped' || st?.status === 'done';
  const t0 = Date.parse(trail[0]!.at);
  const t1 = ends ? Date.parse(trail.at(-1)!.at) : m.now;
  const span = t1 - t0;
  if (!(span > 0)) return '';
  const pct = (t: number) => Math.max(0, Math.min(100, ((t - t0) / span) * 100));
  const segs = trail.map((t, i) => {
    const from = Date.parse(t.at);
    const to = i + 1 < trail.length ? Date.parse(trail[i + 1]!.at) : t1;
    const w = pct(to) - pct(from);
    if (w <= 0 && i + 1 < trail.length) return '';
    const label = labelOf(d.run.stage, t.s);
    const took = to > from ? d.dur((to - from) / 60000) : '';
    const last = i + 1 === trail.length && !ends;
    return `<i class="tseg ts-${esc(stageClass(t.s))}${last ? ' tlive' : ''}" style="left:${pct(from).toFixed(2)}%;width:${Math.max(w, 0.6).toFixed(2)}%" title="${esc(d.flow.step(label, hhmm(t.at), took))}"></i>`;
  }).join('');
  const ticks = (doc?.rounds ?? []).filter(r => pastMs(r.at, m.now) !== null && Date.parse(r.at) >= t0 && Date.parse(r.at) <= t1).map(r =>
    `<b class="rtick a-${esc(r.action)}" style="left:${pct(Date.parse(r.at)).toFixed(2)}%" title="${esc(`${d.round.title(r.n, r.brief)} · ${labelOf(d.action, r.action)} · ${fmt(r.at, loc)}`)}">r${num(r.n)}</b>`).join('');
  const seen = [...new Set(trail.map(t => stageClass(t.s)))];
  const legend = seen.map(s => `<span><i class="ts-${esc(s)}"></i>${esc(labelOf(d.run.stage, s))}</span>`).join('');
  return `<div class="trail"><div class="tbar">${segs}${ticks}</div><div class="tscale mono"><span>${esc(hhmm(trail[0]!.at))}</span><span>${esc(ends ? hhmm(trail.at(-1)!.at) : d.flow.now)}</span></div><div class="tleg">${legend}</div></div>`;
}

/** The colour class of a trail stage: a fix is an implement; the others as they are (whitelisted by the parser). */
const stageClass = (s: string): string => (s === 'fix' ? 'implement' : s);

/** What forge decided after a round, in words; the round's own note for a block of an older forge. */
export function decisionText(d: Dict, r: RoundV2): string {
  if (r.next && Object.hasOwn(d.round.next, r.next)) return d.round.next[r.next]!(r.impl ?? '');
  return r.note;
}

/** The counts of a round as small chips (the zeros left out; minor and deferred quieter). */
function countChips(d: Dict, r: RoundV2): string {
  const f = r.findings;
  return (['critical', 'important', 'minor', 'deferred'] as const).filter(k => num(f[k]) > 0)
    .map(k => `<span class="cc cc-${k}">${esc(d.round.counts(k, num(f[k])))}</span>`).join('');
}

/** One closed round: its title, action, score and time; what blocked it, the validators in red, who reviewed it and
 *  what forge decided next. */
function roundCard(d: Dict, r: RoundV2, doc: ForgeDocV2, loc: string): string {
  const over = typeof doc.cap === 'number' && r.brief === doc.brief && r.n > doc.cap;
  // K4-05: a verdict's score only in a title, never as text.
  const score = typeof r.score === 'number' ? ` title="${esc(d.round.score(r.score.toFixed(2)))}"` : '';
  const why = r.why?.length
    ? `<div class="rwhy"><div class="lbl">${esc(d.round.why)}</div><ul>${r.why.map(w => `<li class="sev-${w.sev}"><b>${esc(d.round.sev[w.sev] ?? w.sev)}</b>${w.by ? ` <span class="k">${esc(w.by)}</span>` : ''}${w.file ? ` <span class="mono loc">${esc(w.line ? `${w.file}:${w.line}` : w.file)}</span>` : ''}<span class="wp">${esc(w.problem)}</span></li>`).join('')}</ul></div>`
    : '';
  const red = r.red?.length ? `<div class="rred"><span class="lbl">${esc(d.round.red)}</span> ${r.red.map(v => `<span class="del mono">✗ ${esc(v)}</span>`).join(' ')}</div>` : '';
  const by = r.reviewers.length ? `<div class="rby"><span class="lbl">${esc(d.round.by)}</span> ${r.reviewers.map(x => `<span class="rv">${esc(x)}</span>`).join('')}</div>` : '';
  const next = decisionText(d, r);
  return `<li class="rc a-${esc(r.action)}${over ? ' over' : ''}"><div class="rch"><b>${esc(d.round.title(r.n, r.brief))}</b> <span class="ra a-${esc(r.action)}"${score}>${esc(labelOf(d.action, r.action))}</span><span class="mono rt-at">${esc(fmt(r.at, loc))}</span></div>`
    + `${countChips(d, r) ? `<div class="rcc">${countChips(d, r)}</div>` : ''}${why}${red}${by}${next ? `<div class="rnext">→ ${esc(next)}</div>` : ''}</li>`;
}

/** The round in progress: its number, the stage it is in (pulsing) and the steps it went through since the last close. */
function liveRound(m: Model, d: Dict, st: TaskState, doc: ForgeDocV2): string {
  const closed = briefRounds(doc);
  const n = (closed.at(-1)?.n ?? 0) + 1;
  const since = closed.at(-1)?.at ?? doc.rounds.at(-1)?.at;
  const steps = (doc.trail ?? []).filter(t => !since || t.at > since);
  const { stage, halt } = whereIs(st);
  const where = stage ? labelOf(d.run.stage, stage) : '—';
  const time = st.exec && pastMs(st.exec.since, m.now) !== null ? ` · ${rel(d, 'lasts', st.exec.since, m.now)}` : '';
  const path = steps.length ? `<div class="rsteps mono">${steps.map(t => `<span>${esc(labelOf(d.run.stage, t.s))} <span class="k">${esc(hhmm(t.at))}</span></span>`).join(' → ')}</div>` : '';
  return `<li class="rc rlive${halt ? ` ${halt}` : ''}"><div class="rch"><b>${esc(d.round.title(n, doc.brief))}</b> <span class="ra rlive"><i class="pulse" aria-hidden="true"></i>${esc(d.round.live)}</span></div>`
    + `<div class="rnow">${miniFlow(d, stage)} ${esc(where)}${time}</div>${path}</li>`;
}


/** The story of the rounds, oldest first, with the round in progress last. '' without a v2 block or any round. */
export function roundsStory(m: Model, d: Dict, st: TaskState, loc: string): string {
  const doc = forgeV2(st.forge);
  if (!doc) return '';
  const live = working(st, doc);
  if (!doc.rounds.length && !live) return '';
  return `<ol class="rstory">${doc.rounds.map(r => roundCard(d, r, doc, loc)).join('')}${live ? liveRound(m, d, st, doc) : ''}</ol>`;
}

/** The last closed round in one line, for the summary of the task: its number, action and first reason, and what next. */
export function lastRoundLine(d: Dict, st: TaskState | undefined): string {
  const doc = forgeV2(st?.forge);
  const r = doc?.rounds.at(-1);
  if (!r) return '';
  const w = r.why?.[0];
  const why = w ? ` — ${d.round.sev[w.sev] ?? w.sev}${w.file ? ` · ${w.line ? `${w.file}:${w.line}` : w.file}` : ''}: ${w.problem}` : '';
  const next = decisionText(d, r);
  return `<div class="lastr"><b>${esc(d.round.title(r.n, r.brief))}</b> · <span class="ra a-${esc(r.action)}">${esc(labelOf(d.action, r.action))}</span>${esc(why)}${next ? `<div class="rnext">→ ${esc(next)}</div>` : ''}</div>`;
}
