// The activities of the panel (wave 3, §4.3): each piece of work going on, with its owner, how long it shows, its
// stage, round, verdict, job in the background and agents; the wait on subagents; the jobs without a row. Pure:
// buildPanelModel calls it with what lens read and heard. lens reads the role of who looks from the band (C3).
import type { PanelModel } from './model.js';
import type { AgentLink } from './links.js';
import { statusKey, type ForgeStatus } from '../lib/forge-status.js';
import { FUTURE_SKEW_MS, isSafeId } from '../lib/execution-state.js';
import { stageOf, tierOf } from './view.js';

/** A done or stopped task shows this long after it ended, whoever owns it. */
export const DONE_TTL_MS = 15 * 60_000;
/** Another session's task in progress shows only while it moved this recently. */
export const OTHER_TTL_MS = 30 * 60_000;
/** This session's task in progress shows while it moved within this window. */
export const OWN_TTL_MS = 24 * 3600_000;
/** A Trivial or Small task with nothing logged for this long was finished without saying so. */
export const LEFT_OPEN_MS = 30 * 60_000;
/** A job counts as alive this long after it started (a mod cannot look at a pid; liveJobs uses the same bound). */
export const JOB_ALIVE_MS = 2 * 3600_000;
export const JOB_FILE_MAX = 4 * 1024;
const JOBS_SHOWN = 5;
const CLIP = 80;
const PARENT_DEPTH = 5;

type Row = PanelModel['activities'][number];
type RowAgent = Row['agents'][number];
export type Role = 'owner' | 'other-live' | 'previous' | 'none';
export interface ViewerLike { role: Role; coordinator: boolean; runId: string | null }
export interface LensJob { name: string; cmd: string; task: string | null; startedAt: string; session: string | null }
export type Models = Readonly<Record<string, { model?: string; effort?: string }>>;

export interface ActivityInput {
  statuses: readonly ForgeStatus[];
  links: readonly AgentLink[];
  execution: PanelModel['execution'];
  superpowers: PanelModel['superpowers'];
  todos: PanelModel['todos'];
  /** Plan task titles known (the execution's slots, the work band's current task). */
  titles?: Readonly<Record<string, string>>;
  /**
   * This session's id; undefined when the caller does not know who looks (every task counts as own, as before); null
   * when it could not be read ($.session.id() failed): only the tasks this session touched with forge.cjs are own.
   */
  sessionId?: string | null;
  ownTasks: readonly string[];
  viewer: ViewerLike;
  jobs: readonly LensJob[];
  models: Models;
  /** The types of the live subagents, for a light task whose agent is still at work. */
  liveTypes: readonly string[];
  turnSince: number | null;
  /** When the main loop's last ScheduleWakeup wakes it (ms), or null. */
  wakeAt: number | null;
  /** The execution's next wake-up (execution.json), used only in its coordinator. */
  sleepUntil?: string | null;
  /** The agent the person looks at (Pane view.agentId): its task is the one expanded. */
  focusAgent?: string | null;
  now: number;
}
export interface ActivityView { activities: Row[]; waiting: PanelModel['waiting']; jobs: PanelModel['jobs']; expanded: ForgeStatus | null }

const ms = (s: string | null | undefined): number => (s ? Date.parse(s) : NaN);
const clip = (s: string): string => (s.length > CLIP ? s.slice(0, CLIP) : s);
// model.ts's elapsed, on numbers: importing it would make a runtime cycle, since model.ts imports this file.
/** Whole seconds from `from` to `to`; null when either is not a time, either is past now + FUTURE_SKEW_MS, or it would be negative. */
function span(from: number, to: number, now: number): number | null {
  if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(now)) return null;
  if (from - now > FUTURE_SKEW_MS || to - now > FUTURE_SKEW_MS || to < from) return null;
  return Math.floor((to - from) / 1000);
}
/** How long ago, never negative: a time ahead of now counts as now. */
const age = (t: number, now: number): number => Math.max(0, now - t);
/** The task itself or one of its briefs, `<task>-<n>`. */
const isOf = (task: string, id: string): boolean => id === task || (id.startsWith(`${task}-`) && /^\d{1,4}$/.test(id.slice(task.length + 1)));
const alive = (l: AgentLink): boolean => l.status !== 'done';

/** A Trivial or Small task with no doneAt and nothing logged for over 30 minutes: the session finished it without saying so. */
export function leftOpen(st: { path: string; doneAt: string | null; lastAt: string | null }, now: number): boolean {
  if ((st.path !== 'trivial' && st.path !== 'small') || st.doneAt) return false;
  const last = ms(st.lastAt);
  return Number.isFinite(last) && Number.isFinite(now) && now - last > LEFT_OPEN_MS;
}

/**
 * C3: the role lens takes for an execution from the band's viewer: owner only as its coordinator or a member (a work
 * band with the run's line); other-live and previous as the band publishes them; none without a viewer. Never worked
 * out again from the files.
 */
export function runRoleOf(band: { mode: string; viewer?: ViewerLike; run?: unknown }): Role {
  const v = band.viewer;
  if (!v) return 'none';
  if (v.role !== 'owner') return v.role;
  return v.coordinator || (band.mode === 'work' && band.run != null) ? 'owner' : 'none';
}

/** A file of .forge/jobs (wave 1): null when too big, not JSON, or its name, command, task or start does not validate. */
export function parseJob(text: string): LensJob | null {
  if (typeof text !== 'string' || text.length > JOB_FILE_MAX) return null;
  let o: unknown;
  try { o = JSON.parse(text); } catch { return null; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const j = o as Record<string, unknown>;
  if (!isSafeId(j.name) || typeof j.cmd !== 'string' || !/^[a-z][a-z-]{0,39}$/.test(j.cmd)) return null;
  if (typeof j.startedAt !== 'string' || !Number.isFinite(Date.parse(j.startedAt))) return null;
  if (j.task !== null && j.task !== undefined && !isSafeId(j.task)) return null;
  return { name: j.name, cmd: j.cmd, task: isSafeId(j.task) ? j.task : null, startedAt: j.startedAt, session: isSafeId(j.session) ? j.session : null };
}

function agentOf(l: AgentLink, links: readonly AgentLink[], models: Models, now: number): RowAgent {
  const m = models[l.id];
  let depth = 0;
  let up = links.find(x => x.id === l.parentId);
  while (up && up.task === l.task && depth < PARENT_DEPTH) {
    depth++;
    const parent = up.parentId;
    up = links.find(x => x.id === parent);
  }
  return {
    id: l.id, type: l.type, ...(l.description ? { description: clip(l.description) } : {}),
    ...(m?.model ? { model: m.model } : {}), ...(m?.effort ? { effort: m.effort } : {}),
    tool: l.tool?.name ?? null, seconds: span(l.since, now, now), status: l.status === 'running' ? 'running' : 'waiting', depth,
  };
}

/**
 * E-02: the execution with the linked agents of each slot under it, the slot's model from the first of them and, in
 * the coordinator (which drives them), the slot alive while one of them lives. executionView itself does not change.
 */
export function withSlotAgents(x: PanelModel['execution'], links: readonly AgentLink[], models: Models, viewer: ViewerLike, now: number): PanelModel['execution'] {
  if (!x) return x;
  type Slot = NonNullable<PanelModel['execution']>['slots'][number];
  return {
    ...x,
    slots: x.slots.map((s): Slot => {
      const agents = links.filter(l => alive(l) && l.task === s.task).map(l => agentOf(l, links, models, now));
      const first = agents.find(g => g.model);
      const liveness: Slot['liveness'] = viewer.coordinator && agents.length ? 'alive' : s.liveness;
      return { ...s, agents, model: s.model ?? first?.model ?? null, effort: s.effort ?? first?.effort ?? null, liveness };
    }),
  };
}

const summary = (key: string, kind: Row['kind'], o: { title: string | null; stage?: string | null; round?: number | null; cap?: number | null; done: boolean; dim: boolean }): Row => ({
  key, kind, owner: 'own', dim: o.dim, done: o.done, slot: false, expanded: false, stopped: false, task: null, project: null, title: o.title,
  path: null, stage: o.stage ?? null, round: o.round ?? null, cap: o.cap ?? null, verdict: null, job: null, seconds: null, agents: [],
});

/**
 * Wave 3, §4.3: one activity per forge task that shows (own in progress for 24 hours, another session's for 30 minutes,
 * a done or stopped one for 15 minutes), per workflow run (while its agents live and 15 minutes after), and a summary
 * of superpowers, the todos and the agents without a task. Own in progress first (newest first), then other sessions',
 * then the done and stopped ones; one forge task that is not a slot is expanded: the agent the person looks at, else
 * the newest own in progress, else the newest of all.
 */
export function buildActivities(i: ActivityInput): ActivityView {
  const now = i.now;
  const known = i.sessionId !== undefined;
  const slotTasks = new Set(i.execution?.mode === 'subagents' ? i.execution.slots.map(s => s.task) : []);
  const liveJobs = i.jobs.filter(j => { const t = ms(j.startedAt); return Number.isFinite(t) && age(t, now) < JOB_ALIVE_MS; });
  type Built = { row: Row; at: number; end: number; st: ForgeStatus | null; rank: number };
  const built: Built[] = [];
  const seen = new Set<string>();
  for (const st of i.statuses) {
    const key = statusKey(st.task, st.project) ?? st.task;
    if (seen.has(key)) continue;
    seen.add(key);
    const last = ms(st.lastAt ?? st.ts);
    if (!Number.isFinite(last)) continue;
    const stopped = st.phase.toLowerCase() === 'stopped';
    const mine = i.links.filter(l => alive(l) && l.task === st.task && (l.project === null || st.project === null || l.project === st.project));
    const working = mine.length > 0 || (!!st.agent && i.liveTypes.some(t => tierOf(t).label === tierOf(st.agent).label));
    const left = !stopped && !working && leftOpen(st, now);
    const done = !stopped && (!!st.doneAt || left);
    // Its time stops at its doneAt or, left open, at its last event; a task left open is judged done LEFT_OPEN_MS
    // after that event, and shows DONE_TTL_MS from then (C6): `end` only orders and hides it.
    const ended = st.doneAt ? ms(st.doneAt) : left ? last : NaN;
    const end = left ? last + LEFT_OPEN_MS : ended;
    // Review Focus 5: an id that could not be read (null) owns only what this session touched with forge.cjs, which
    // stamps this session's own id on its events.
    const owner: Row['owner'] = !known ? 'own'
      : st.session !== null && i.sessionId ? (st.session === i.sessionId ? 'own' : 'other')
        : i.ownTasks.some(t => isOf(st.task, t)) ? 'own' : 'other';
    const visible = done || stopped ? Number.isFinite(end) && age(end, now) < DONE_TTL_MS
      : age(last, now) < (owner === 'own' ? OWN_TTL_MS : OTHER_TTL_MS);
    if (!visible) continue;
    // Review Focus 4: an event ahead of this clock means its writer's clock is off: the task shows without a time.
    const skewed = last - now > FUTURE_SKEW_MS;
    const job = liveJobs.find(j => j.task !== null && isOf(st.task, j.task));
    const live = owner === 'own' && !done && !stopped;
    const title = i.titles?.[st.task];
    built.push({
      row: {
        key, kind: 'forge', owner, dim: owner === 'other' || done || stopped, done, slot: slotTasks.has(st.task) && !done && !stopped, expanded: false, stopped,
        task: st.task, project: st.project, title: title ? clip(title) : null,
        path: st.path || null, stage: done || stopped ? null : stageOf(st.phase || 'triage'),
        round: st.reviews?.n ?? st.round, cap: st.reviews?.max ?? st.cap,
        verdict: st.verdict ? { action: st.verdict.action, score: st.verdict.score, round: st.verdict.round, findings: st.verdict.findings } : null,
        ...(st.autonomy === 'auto' ? { autonomy: 'auto' as const } : {}),
        job: job ? { name: job.cmd, seconds: span(ms(job.startedAt), now, now) } : null,
        seconds: skewed ? null : span(ms(st.taskStartedAt), done || stopped ? ended : now, now),
        agents: live ? mine.map(l => agentOf(l, i.links, i.models, now)) : [],
      },
      at: last, end, st, rank: done || stopped ? 2 : owner === 'own' ? 0 : 1,
    });
  }
  const runs = new Map<string, AgentLink[]>();
  for (const l of i.links) if (l.workflow) runs.set(l.workflow.runId, [...(runs.get(l.workflow.runId) ?? []), l]);
  for (const [runId, ls] of runs) {
    const living = ls.filter(alive);
    const end = Math.max(...ls.map(l => l.endedAt ?? -Infinity));
    if (!living.length && !(Number.isFinite(end) && age(end, now) < DONE_TTL_MS)) continue;
    const start = Math.min(...ls.map(l => l.since));
    built.push({
      row: {
        ...summary(`wf:${isSafeId(runId) ? runId : 'run'}`, 'workflow', { title: ls[0].description ? clip(ls[0].description) : null, done: !living.length, dim: !living.length }),
        seconds: span(start, living.length ? now : end, now), agents: living.map(l => agentOf(l, i.links, i.models, now)),
      },
      at: living.length ? now : end, end, st: null, rank: living.length ? 0 : 2,
    });
  }
  built.sort((a, b) => a.rank - b.rank || (a.rank === 2 ? b.end - a.end : b.at - a.at));
  const forge = built.filter(b => b.row.kind === 'forge' && !b.row.slot);
  const focus = i.focusAgent ? i.links.find(l => l.id === i.focusAgent)?.task ?? null : null;
  const pick = (focus ? forge.find(b => b.row.task === focus) : undefined)
    ?? forge.find(b => b.rank === 0 && b.row.owner === 'own')
    ?? forge.reduce<Built | undefined>((best, b) => (!best || b.at > best.at ? b : best), undefined);
  if (pick) pick.row.expanded = true;
  const out = built.map(b => b.row);
  if (i.superpowers) {
    const s = i.superpowers;
    out.push(summary('sp', 'superpowers', { title: s.plan || null, stage: s.current ? 'fix' : null, round: s.current?.round ?? null, cap: s.current?.cap ?? null, done: s.tasks > 0 && s.done >= s.tasks, dim: !!s.stale }));
  }
  if (i.todos && i.todos.total > i.todos.done) out.push(summary('todo', 'todo', { title: i.todos.inProgress, done: false, dim: false }));
  const adhoc = i.links.filter(l => alive(l) && !l.task && !l.workflow);
  if (adhoc.length) out.push({ ...summary('adhoc', 'adhoc', { title: null, done: false, dim: false }), agents: adhoc.map(l => agentOf(l, i.links, i.models, now)) });

  // E-11: no main turn open and agents of the main loop alive: waiting on them, and when the session wakes.
  const mainAgents = i.links.filter(l => alive(l) && l.parentId === null);
  let waiting: PanelModel['waiting'] = null;
  if (i.turnSince === null && mainAgents.length) {
    const wakes = [i.viewer.coordinator ? ms(i.sleepUntil) : NaN, i.wakeAt ?? NaN].filter(t => Number.isFinite(t) && t >= now);
    waiting = { agents: mainAgents.length, wakeSeconds: wakes.length ? Math.round((Math.min(...wakes) - now) / 1000) : null };
  }
  // Wave 1: a live job of a task without a row (or of no task) goes to Now, this session's or one that names none.
  const rows = out.filter(a => a.kind === 'forge' && !a.slot && a.task !== null).map(a => a.task!);
  const jobs = liveJobs
    .filter(j => !(j.task !== null && rows.some(t => isOf(t, j.task!))))
    .filter(j => !known || j.session === null || j.session === i.sessionId)
    .slice(0, JOBS_SHOWN)
    .map(j => ({ name: j.cmd, task: j.task, seconds: span(ms(j.startedAt), now, now) }));
  return { activities: out, waiting, jobs, expanded: pick?.st ?? null };
}
