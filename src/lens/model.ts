import type { BandModel } from '../mod/model.js';
import { normalizeProposal, PROPOSAL_ID } from '../lib/proposals.js';
import { cleanText, normalizeStatus, statusKey, type ForgeStatus } from '../lib/forge-status.js';
import { parseRun } from '../lib/forge-run.js';
import { FUTURE_SKEW_MS, isSafeId, normalizeLive, normalizePublicTask, parseExecution, type LiveDoc, type PublicTask } from '../lib/execution-state.js';
import { executionView } from '../lib/execution-view.js';
import { MAIN, type UsageState } from './usage.js';
import { STAGES, stageOf, tierOf } from './view.js';
import { summarizeUsage } from './usage-summary.js';
import { PRICES_AS_OF } from '../lib/prices.js';
import { freshFinished, type FinishedAgent } from './finished.js';
import { decisionsSummary } from '../lib/decisions.js';
import { oneLine } from '../lib/one-line.js';
import { buildActivities, leftOpen, linkHomes, parseJob, runRoleOf, withSlotAgents, type ActivityView, type LensJob, type Models, type Role } from './activities.js';
import type { AgentLink } from './links.js';

const CLIP = 80;
const MAX_RANGE = 1000;
const clip = (s: string): string => (s.length > CLIP ? s.slice(0, CLIP) : s);

export interface LedgerSummary {
  planPath: string | null; done: number[]; current: { task: string; round: number; cap: number | null } | null; lastLines: string[];
}

const PROGRESS_LINE = /^\s*(?:[-*]\s*)?Tasks?\s+(\d+)(?:\s*[-–]\s*(\d+))?\s*:\s*(.*)$/i;

export function parseSddLedger(text: string): LedgerSummary {
  const out: LedgerSummary = { planPath: null, done: [], current: null, lastLines: [] };
  if (typeof text !== 'string') return out;
  try {
    const lines = text.split(/\r?\n/);
    const head = /^#\s+SDD ledger\b.*?\bplan:\s*(.+?)\s*$/i.exec(lines[0] ?? '');
    if (head) out.planPath = head[1];
    // The Progress section when the ledger has one, else the whole file.
    const start = lines.findIndex(l => /^##\s+Progress\s*$/i.test(l));
    let section = lines;
    if (start >= 0) {
      let end = lines.length;
      for (let i = start + 1; i < lines.length; i++) if (/^##\s/.test(lines[i])) { end = i; break; }
      section = lines.slice(start + 1, end);
    }
    const done = new Set<number>();
    const fixes: { lo: number; hi: number; label: string; round: number; cap: number | null }[] = [];
    for (const line of section) {
      const m = PROGRESS_LINE.exec(line);
      if (!m) continue;
      let lo = Number(m[1]);
      let hi = m[2] !== undefined ? Number(m[2]) : lo;
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
      if (hi < lo) [lo, hi] = [hi, lo];
      if (hi - lo >= MAX_RANGE) hi = lo + MAX_RANGE - 1;
      const rest = m[3];
      if (/^complete\b/i.test(rest)) {
        for (let n = lo; n <= hi; n++) done.add(n);
        continue;
      }
      // E-14: the cap is the ledger's own (fix round 2/3), and a line without one still counts.
      const fix = /^fix round\s+(\d+)(?:\s*\/\s*(\d+))?/i.exec(rest);
      if (fix) fixes.push({ lo, hi, label: m[2] !== undefined ? `${m[1]}-${m[2]}` : m[1], round: Number(fix[1]), cap: fix[2] !== undefined ? Number(fix[2]) : null });
    }
    out.done = [...done].sort((a, b) => a - b);
    for (let i = fixes.length - 1; i >= 0; i--) {
      const f = fixes[i];
      let open = false;
      for (let n = f.lo; n <= f.hi; n++) if (!done.has(n)) { open = true; break; }
      if (open) { out.current = { task: f.label, round: f.round, cap: f.cap }; break; }
    }
    out.lastLines = section.map(l => l.trimEnd()).filter(l => l.trim() !== '').slice(-3).map(clip);
  } catch { /* junk in, best effort out */ }
  return out;
}

export interface PlanTask { n: number; title: string; steps: number; checked: number }

export function parsePlanTasks(md: string): PlanTask[] {
  const tasks: PlanTask[] = [];
  if (typeof md !== 'string') return tasks;
  let cur: PlanTask | null = null;
  for (const line of md.split(/\r?\n/)) {
    const heading = /^###\s+Task\s+(\d+)\s*:\s*(.*?)\s*$/.exec(line);
    if (heading) { cur = { n: Number(heading[1]), title: heading[2], steps: 0, checked: 0 }; tasks.push(cur); continue; }
    if (!cur) continue;
    const c = /^\s*[-*]\s+\[([ xX])\]/.exec(line);
    if (c) { cur.steps++; if (c[1] !== ' ') cur.checked++; }
  }
  return tasks;
}

// Carry from 4d: a line scan and a trim, never a regex whose whitespace runs compete (that one was quadratic).
function planTitle(md: string): string {
  for (const line of md.split(/\r?\n/)) {
    if (!line.startsWith('#') || !/\s/.test(line.charAt(1))) continue;
    const text = line.slice(1).trim();
    if (text) return text;
  }
  return '';
}

export interface TodoSummary { total: number; done: number; inProgress: string | null; next: string[]; active: string[]; cells: string }

const TODO_ACTIVE_MAX = 3;
const TODO_CELLS_MAX = 200;

/** E-13: up to three todos in progress (inProgress is the first) and one cell per todo in its order: d done, a in progress, p pending. */
export function summarizeTodos(todos: unknown): TodoSummary {
  const out: TodoSummary = { total: 0, done: 0, inProgress: null, next: [], active: [], cells: '' };
  if (!Array.isArray(todos)) return out;
  for (const raw of todos) {
    if (!raw || typeof raw !== 'object') continue;
    const t = raw as { content?: unknown; status?: unknown; activeForm?: unknown };
    if (typeof t.content !== 'string') continue;
    out.total++;
    let cell = 'p';
    if (t.status === 'completed') { out.done++; cell = 'd'; }
    else if (t.status === 'in_progress') {
      const text = clip(typeof t.activeForm === 'string' && t.activeForm ? t.activeForm : t.content);
      if (out.inProgress === null) out.inProgress = text;
      if (out.active.length < TODO_ACTIVE_MAX) out.active.push(text);
      cell = 'a';
    } else if (out.next.length < 3) out.next.push(clip(t.content));
    if (out.cells.length < TODO_CELLS_MAX) out.cells += cell;
  }
  return out;
}

export interface Activity {
  tool: { name: string; since: number } | null;
  turnSince: number | null;
  todos: unknown;
  subagents: { id: string; type: string; description?: string; status?: string; since: number }[];
  ccTasks: { id: string; subject: string; done: boolean }[];
  finished?: FinishedAgent[];
}

// Copied into the published state contract by build.mjs: literals and primitives only, no other named types.
export type PanelModel = {
  locale: string;
  waypoint: {
    project: string; track: string | null; percent: number; trackDone: number; trackTotal: number;
    current: { id: string; title: string; startedAt?: string; estimateMin?: number } | null;
    inbox: number; escalation: boolean; roadmapUrl: string | null; locale: string;
    phase: { index: number; total: number; name: string } | null; cells: string;
    recentDone?: { id: string; minutes: number; estimateMin?: number }[];
    // run: drawn from the band of an execution, without a task nor cells.
    run?: boolean;
  } | null;
  superpowers: {
    plan: string; tasks: number; done: number; current: { task: string; round: number; cap?: number | null } | null; lastLines: string[];
    // stale: not finished and unchanged for over a day.
    stale?: boolean;
  } | null;
  todos: { total: number; done: number; inProgress: string | null; next: string[]; active?: string[]; cells?: string } | null;
  subagents: { id: string; type: string; description?: string; status?: string; seconds: number | null; model?: string; effort?: string; task?: string; shown?: true }[];
  subagentsDone?: { id: string; type: string; description?: string; model?: string; seconds: number }[];
  tool: { name: string; seconds: number | null } | null;
  turnSeconds: number | null;
  ccTasks: { open: number; done: number; recent: string[] } | null;
  forge: {
    task: string; path: string; phase: string; agent: string | null; validators: { name: string; ok: boolean; cached?: true }[];
    verdict: { action: string; score: number | null; round?: number | null; findings?: { critical: number; important: number; minor: number } | null } | null;
    round: number | null; cap: number | null; reviewers?: string[]; reviews?: { n: number; max: number } | null;
    brief: number | null; accepted: number[]; briefs: number | null; autonomy?: 'auto';
    verify?: {
      planned: boolean; surfaces: string[]; result: string | null; passed: number | null; total: number | null;
      evidence: string | null; reason: string | null; skipped?: string[]; launched?: boolean;
    } | null;
    timing?: { taskSeconds: number | null; done: boolean; stages: { name: string; seconds: number; live: boolean }[] } | null;
  } | null;
  infinite: { cycle: number; cyclesMax: number | null; hoursLeft: number | null; active: boolean; autoApproved: string[] } | null;
  decisions: { count: number; autonomy: 'auto' | 'unattended'; lastMajor: string | null } | null;
  execution: {
    runId: string; mode: 'subagents' | 'sessions'; parallel: number; branch: string; active: boolean;
    // project: the plan's, which the statuses of its slot tasks carry; null for an ephemeral run, whose tasks are loose.
    project?: string | null;
    stopReason: string | null; stallReason: string | null;
    coordinator: { liveness: 'alive' | 'silent' | 'stopped'; lastSeen: string | null };
    integrated: number; total: number;
    elapsedSeconds?: number | null;
    finished?: { task: string; seconds: number }[];
    sleepUntil?: string | null; dim?: boolean;
    slots: {
      task: string; title: string | null; stage: string; agent: string | null; model: string | null; effort: string | null;
      round: number; seconds: number; taskSeconds?: number | null; liveness: 'alive' | 'silent' | 'stopped'; mode: 'subagents' | 'sessions' | 'manual';
      agents?: { id: string; type: string; description?: string; model?: string; effort?: string; tool: string | null; seconds: number | null; status: 'running' | 'waiting'; depth: number }[];
    }[];
    manual: { task: string; title: string | null; stage: string; seconds: number; liveness: 'alive' | 'silent' | 'stopped'; by: string }[];
    queued: string[]; conflicts: string[]; blocked: string[]; orphans: string[];
  } | null;
  proposals: { id: string; title: string; category: string; risk: string }[];
  mainModel: { model: string; effort: string | null } | null;
  // one entry per piece of work going on: a forge task, a workflow run, superpowers, the todos, the agents without a task.
  activities: {
    key: string; kind: 'forge' | 'workflow' | 'superpowers' | 'todo' | 'adhoc'; owner: 'own' | 'other';
    dim: boolean; done: boolean; slot: boolean; expanded: boolean; stopped: boolean;
    task: string | null; project: string | null; title: string | null;
    path: string | null; stage: string | null; round: number | null; cap: number | null;
    verdict: { action: string; score: number | null; round?: number | null; findings?: { critical: number; important: number; minor: number } | null } | null;
    autonomy?: 'auto';
    idle?: true;
    job: { name: string; seconds: number | null } | null;
    seconds: number | null;
    agents: { id: string; type: string; description?: string; model?: string; effort?: string; tool: string | null; seconds: number | null; status: 'running' | 'waiting'; depth: number }[];
  }[];
  waiting: { agents: number; wakeSeconds: number | null } | null;
  jobs: { name: string; task: string | null; seconds: number | null }[];
  usage: {
    scope: 'session' | 'run'; tokens: number; costUsd: number; partial: boolean; sessionPartial: boolean; officialUsd: number | null; drift: boolean;
    session: { tokens: number; costUsd: number } | null;
    groups: { id: 'main' | 'impl' | 'review' | 'verify' | 'plan' | 'other'; model: string | null; effort?: string | null; tokens: number; costUsd: number | null; share: number }[];
    tracking: { tokens: number; costUsd: number | null } | null;
    withoutForge: { costUsd: number; deltaUsd: number; deltaPct: number; lowUsd?: number } | null;
    time?: { activeSeconds: number; activePartial: boolean; sinceStartSeconds: number | null; session: { activeSeconds: number; sinceStartSeconds: number | null } | null };
    pricesAsOf: string;
  } | null;
};

// null when either time is not a finite number: the renderer then leaves the seconds out.
const secs = (now: number, since: number): number | null =>
  Number.isFinite(now) && Number.isFinite(since) ? Math.max(0, Math.floor((now - since) / 1000)) : null;

/** The session's (or run's) active time with the turn in progress, and the time since its start. */
export function usageTime(session: UsageState, run: UsageState | null, turnSince: number | null, now: number): NonNullable<NonNullable<PanelModel['usage']>['time']> {
  const live = turnSince !== null && Number.isFinite(turnSince) && Number.isFinite(now) && now > turnSince ? now - turnSince : 0;
  const active = (s: UsageState) => Math.floor((s.activeMs + live) / 1000);
  const since = (s: UsageState) => (s.startedAt > 0 && Number.isFinite(now) && now >= s.startedAt ? Math.floor((now - s.startedAt) / 1000) : null);
  const shown = run ?? session;
  return {
    activeSeconds: active(shown), activePartial: !!run?.activePartial, sinceStartSeconds: since(shown),
    session: run ? { activeSeconds: active(session), sinceStartSeconds: since(session) } : null,
  };
}

const STALE_LEDGER_MS = 24 * 3600_000;

function superpowers(input: {
  ledger?: string; ledgerPlan?: string; planFallback?: string; ledgerMtimeMs?: number; now: number;
}): PanelModel['superpowers'] {
  try {
    if (input.ledger !== undefined) {
      const l = parseSddLedger(input.ledger);
      const plan = input.ledgerPlan !== undefined ? parsePlanTasks(input.ledgerPlan) : [];
      let tasks: number;
      let done: number;
      if (plan.length) {
        const nums = new Set(plan.map(p => p.n));
        tasks = plan.length;
        done = l.done.filter(n => nums.has(n)).length;
      } else {
        tasks = Math.max(0, ...l.done, ...(l.current ? [parseInt(l.current.task.split('-').pop() ?? '0', 10) || 0] : []));
        done = l.done.length;
      }
      // A finished run whose ledger has not changed for a day is history, not progress.
      const stale = input.ledgerMtimeMs !== undefined && input.now - input.ledgerMtimeMs > STALE_LEDGER_MS;
      if (stale && !l.current && done === tasks) return null;
      // E-14: a run left half done, unchanged for a day, is still drawn, dim and out of the band's headline.
      return { plan: clip(l.planPath ?? ''), tasks, done, current: l.current, lastLines: l.lastLines, ...(stale ? { stale: true } : {}) };
    }
    if (input.planFallback !== undefined) {
      const plan = parsePlanTasks(input.planFallback);
      // Without a checked step the checkboxes say nothing: a plan run by subagents keeps them empty and, once its
      // ledger is deleted, would show as not started.
      if (!plan.some(p => p.checked > 0)) return null;
      const title = planTitle(input.planFallback);
      return {
        plan: clip(title), tasks: plan.length,
        done: plan.filter(p => p.steps > 0 && p.checked === p.steps).length, current: null, lastLines: [],
      };
    }
  } catch { /* section omitted */ }
  return null;
}

const FORGE_WINDOW_MS = 24 * 3600_000;
const MAX_PROPOSALS = 5;
// The proposal id rule lives in lib/proposals.ts now (the band reads proposals too); lens's importers keep their path.
export { PROPOSAL_ID };

/** The forge section of one task's status: its fields without the times, its briefs and its timing (C5: of the expanded activity). */
export function forgeOf(st: ForgeStatus, now: number, briefs: number | null = null, liveTypes: readonly string[] = []): NonNullable<PanelModel['forge']> {
  // C4: who wrote the task's last event, its run and its project are forge's: nothing here draws them, and a session
  // that comes and goes between events must not change the band key.
  const { ts: _ts, taskStartedAt: _a, stageSince: _b, stages: _c, doneAt: _d, lastAt: _e, session: _s, runId: _r, project: _p, ...forge } = st;
  // A light task the session never closed: finished at its last event, its agent gone. Not while a subagent of its
  // agent's tier (the live subagents' types) still runs: that is a long agent, not a forgotten task.
  const working = !!st.agent && liveTypes.some(t => tierOf(t).label === tierOf(st.agent).label);
  const left = !working && leftOpen(st, now);
  // Review Focus 4: a last event more than FUTURE_SKEW_MS ahead of this clock means its writer's clock is off: the task
  // shows without times, as its row does.
  const skewed = Date.parse(st.lastAt ?? st.ts) - now > FUTURE_SKEW_MS;
  const timing = skewed ? null : forgeTiming(left ? { ...st, doneAt: st.lastAt } : st, now);
  return { ...forge, ...(left ? { agent: null } : {}), briefs, timing };
}

/**
 * The forge section from a status.json text: null when it does not parse or validate, or when its task last saw a
 * triage or phase event more than a day ago.
 */
export function forgeFromStatus(text: string, now: number, briefs: number | null = null, liveTypes: readonly string[] = []): PanelModel['forge'] {
  if (typeof text !== 'string') return null;
  let st;
  try { st = normalizeStatus(JSON.parse(text)); } catch { return null; }
  if (!st) return null;
  const t = Date.parse(st.ts);
  if (!Number.isFinite(t) || !Number.isFinite(now) || now - t > FORGE_WINDOW_MS) return null;
  return forgeOf(st, now, briefs, liveTypes);
}

/** C5: the statuses lens read (at most FORGE_STATUSES_READ, each at most FORGE_STATUS_TEXT_MAX); a junk one hides only its task. */
export const FORGE_STATUSES_READ = 20;
export const FORGE_STATUS_TEXT_MAX = 64 * 1024;
function parseStatuses(texts: readonly string[]): ForgeStatus[] {
  const out: ForgeStatus[] = [];
  for (const text of texts.slice(0, FORGE_STATUSES_READ)) {
    if (typeof text !== 'string' || text.length > FORGE_STATUS_TEXT_MAX) continue;
    try { const st = normalizeStatus(JSON.parse(text)); if (st) out.push(st); } catch { /* that task only */ }
  }
  return out;
}

/** The forge section when the activities could not be built: the newest status of the last day, as before C5. */
function newestForge(statuses: readonly ForgeStatus[], now: number, briefsOf: (st: ForgeStatus) => number | null, liveTypes: readonly string[]): PanelModel['forge'] {
  const st = [...statuses].sort((x, y) => (Date.parse(y.lastAt ?? y.ts) || 0) - (Date.parse(x.lastAt ?? x.ts) || 0))[0];
  const t = st ? Date.parse(st.ts) : NaN;
  return st && Number.isFinite(t) && now - t <= FORGE_WINDOW_MS ? forgeOf(st, now, briefsOf(st), liveTypes) : null;
}

/** Whole seconds from `from` to `to`; null when `from` is missing or not a date, either end is more than FUTURE_SKEW_MS ahead of now, or the span is negative. */
export function elapsed(from: string | null | undefined, to: number, now: number): number | null {
  const t = from ? Date.parse(from) : NaN;
  if (!Number.isFinite(t) || !Number.isFinite(to) || !Number.isFinite(now)) return null;
  if (t - now > FUTURE_SKEW_MS || to - now > FUTURE_SKEW_MS || to < t) return null;
  return Math.floor((to - t) / 1000);
}

// The task's time (to doneAt when finished) and its stages grouped as lens names them, the current one live.
function forgeTiming(st: { phase: string; taskStartedAt: string | null; stageSince: string | null; stages: Record<string, number>; doneAt: string | null }, now: number): NonNullable<PanelModel['forge']>['timing'] {
  if (!st.taskStartedAt) return null;
  // A doneAt that is not a date, is before the start or is in the future is ignored: the task counts as running.
  const rawDone = st.doneAt ? Date.parse(st.doneAt) : NaN;
  const doneMs = elapsed(st.taskStartedAt, rawDone, now) !== null ? rawDone : NaN;
  const done = Number.isFinite(doneMs);
  const sums = new Map<string, number>();
  for (const [phase, s] of Object.entries(st.stages ?? {})) {
    if (typeof s !== 'number' || !Number.isFinite(s) || s < 0) continue;
    const name = stageOf(phase);
    sums.set(name, (sums.get(name) ?? 0) + s);
  }
  const current = stageOf(st.phase || 'triage');
  const liveSecs = done ? null : elapsed(st.stageSince, now, now);
  if (liveSecs !== null) sums.set(current, (sums.get(current) ?? 0) + liveSecs);
  // A stage still open at doneAt ends there: a task taken as finished at its last event (forge itself closes the stage
  // when it sets doneAt, so stageSince is then doneAt).
  const tail = done ? elapsed(st.stageSince, doneMs, now) : null;
  if (tail) sums.set(current, (sums.get(current) ?? 0) + tail);
  const order: readonly string[] = STAGES;
  const known = order.filter(n => sums.has(n));
  const other = [...sums.keys()].filter(n => !order.includes(n));
  return {
    taskSeconds: elapsed(st.taskStartedAt, done ? doneMs : now, now),
    done,
    stages: [...known, ...other].map(name => ({ name, seconds: sums.get(name)!, live: liveSecs !== null && name === current })),
  };
}

// Pending proposals (proposed or under discussion), newest id first (ids start with their UTC time), at most 5. A parked
// one (6b-2) waits for the person, so it is not pending, as the run's queue does not count it either.
function pendingProposals(texts: Record<string, string> | undefined): PanelModel['proposals'] {
  const out: PanelModel['proposals'] = [];
  if (!texts || typeof texts !== 'object') return out;
  for (const id of Object.keys(texts).filter(k => PROPOSAL_ID.test(k)).sort().reverse()) {
    let doc;
    try { doc = normalizeProposal(JSON.parse(texts[id])); } catch { continue; }
    if (!doc || doc.parked || (doc.status !== 'proposed' && doc.status !== 'discussing')) continue;
    out.push({ id, title: cleanText(doc.title), category: doc.category, risk: doc.risk });
    if (out.length >= MAX_PROPOSALS) break;
  }
  return out;
}

/** forge's run.json is a few hundred bytes; lens neither reads nor parses one above this. */
export const FORGE_RUN_MAX = 16 * 1024;

/** .forge/execution.json is a few KB; lens neither reads nor parses one above this. */
export const FORGE_EXEC_MAX = 64 * 1024;
/** Each .forge/execution/<task>.json and .forge/live/<session>.json is small; lens reads none above this. */
export const FORGE_EXEC_FILE_MAX = 8 * 1024;
export const FORGE_EXEC_TASKS_MAX = 50;
export const FORGE_LIVE_MAX = 20;

/**
 * C5: the root whose .forge/status/ holds this session's task statuses, as ledgerRoot gives it on disk: the main
 * checkout for one of forge's task worktrees (`<main>/.claude/worktrees/task-*`), else the root itself.
 */
export function statusRootOf(root: string, main: string): string {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');
  const r = norm(root);
  const name = r.split('/').pop() ?? '';
  return name.startsWith('task-') && r.toLowerCase() === `${norm(main)}/.claude/worktrees/${name}`.toLowerCase() ? main : root;
}

function secondsSince(ts: string, now: number): number {
  const since = Date.parse(ts);
  return Number.isFinite(since) && Number.isFinite(now) ? Math.max(0, Math.round((now - since) / 1000)) : 0;
}

/**
 * The execution for the panel, from .forge/execution.json, the public task files (.forge/execution/<task>.json, keyed
 * by task id) and the live signals (.forge/live/*.json): null when absent, oversized, invalid or finished (a stalled
 * one stays to say why). Bad task or signal files are skipped.
 */
export function executionFromFiles(execText: string | undefined, taskTexts: Record<string, string> = {}, liveTexts: Record<string, string> = {}, now: number, titles?: Record<string, string>, role?: Role): PanelModel['execution'] {
  if (typeof execText !== 'string' || execText.length > FORGE_EXEC_MAX) return null;
  const tasks: Record<string, PublicTask> = {};
  for (const [id, t] of Object.entries(taskTexts)) {
    if (typeof t !== 'string' || t.length > FORGE_EXEC_FILE_MAX) continue;
    try { const p = normalizePublicTask(JSON.parse(t)); if (p && p.task === id) tasks[id] = p; } catch { /* skip */ }
  }
  const live: LiveDoc[] = [];
  for (const t of Object.values(liveTexts)) {
    if (typeof t !== 'string' || t.length > FORGE_EXEC_FILE_MAX) continue;
    try { const d = normalizeLive(JSON.parse(t)); if (d) live.push(d); } catch { /* skip */ }
  }
  let v;
  let exec;
  const clean = titles && Object.fromEntries(Object.entries(titles).map(([id, t]) => [id, cleanText(t)]));
  try { exec = parseExecution(execText, now); v = executionView({ exec, tasks, live, titles: clean, now, role }); } catch { return null; }
  if (!v) return null;
  // C2: an ended run's clock stops at its last movement (never past this reader's now).
  const to = v.frozenAt ? Math.min(now, Date.parse(v.frozenAt)) : now;
  return {
    runId: v.runId, project: exec?.kind === 'plan' && isSafeId(exec.project) ? exec.project : null,
    mode: v.mode, parallel: v.parallel, branch: v.branch, active: v.active, stopReason: v.stopReason,
    stallReason: v.stallReason ? clip(v.stallReason) : null,
    coordinator: { ...v.coordinator }, integrated: v.integrated, total: v.total,
    elapsedSeconds: elapsed(v.startedAt, to, now),
    finished: v.finished.map(f => ({ task: f.task, seconds: elapsed(f.startedAt, Date.parse(f.finishedAt), now) }))
      .filter((f): f is { task: string; seconds: number } => f.seconds !== null),
    // model / effort: lens knows them only for its own session's subagents (from the usage loops), not for these.
    slots: v.slots.map(s => ({
      task: s.task, title: s.title ? clip(s.title) : null, stage: s.stage, agent: s.agent, model: null, effort: null, round: s.round,
      seconds: secondsSince(s.since, to), taskSeconds: elapsed(s.startedAt, to, now), liveness: s.liveness, mode: s.mode,
    })),
    manual: v.manual.map(s => ({
      task: s.task, title: s.title ? clip(s.title) : null, stage: s.stage, seconds: secondsSince(s.since, to), liveness: s.liveness, by: s.by ?? '',
    })),
    queued: v.queued, conflicts: v.conflicts, blocked: v.blocked, orphans: v.orphans,
    sleepUntil: v.sleepUntil,
    // C2: someone else's run (another live session's, or one left behind) is drawn dim; with no role known, it is not.
    dim: role === 'other-live' || role === 'previous',
  };
}
const MAX_AUTO = 3;

/** Titles of the 3 newest auto-approved proposals, newest id first. */
function autoApproved(texts: Record<string, string> | undefined): string[] {
  const out: string[] = [];
  if (!texts || typeof texts !== 'object') return out;
  for (const id of Object.keys(texts).filter(k => PROPOSAL_ID.test(k)).sort().reverse()) {
    let doc;
    try { doc = normalizeProposal(JSON.parse(texts[id])); } catch { continue; }
    if (!doc || doc.status !== 'auto_approved') continue;
    out.push(cleanText(doc.title));
    if (out.length >= MAX_AUTO) break;
  }
  return out;
}

/** The infinite run from .forge/run.json (validated as forge does): null when absent, oversized or invalid. */
export function infiniteFromRun(text: string | undefined, proposals: Record<string, string> | undefined, now: number): PanelModel['infinite'] {
  if (typeof text !== 'string' || text.length > FORGE_RUN_MAX) return null;
  const run = parseRun(text);
  if (!run) return null;
  let hoursLeft: number | null = null;
  const started = Date.parse(run.startedAt);
  if (run.budget.hours !== undefined && Number.isFinite(now) && Number.isFinite(started)) {
    hoursLeft = Math.max(0, Math.round((run.budget.hours - (now - started) / 3600_000) * 10) / 10);
  }
  // The cycle in progress while active (done + 1, never past the budget), as the roadmap pill and the Stop hook show it.
  const max = run.budget.cycles ?? null;
  const cycle = run.active ? Math.min(run.cycle + 1, max ?? Infinity) : run.cycle;
  return { cycle, cyclesMax: max, hoursLeft, active: run.active, autoApproved: autoApproved(proposals) };
}

/**
 * What the band compares and keeps: the model without any second it never shows (E-16): the subagents', the tool's and
 * the turn's, the run's, its slots' and their agents', the manual rows', the activities' and their agents' (and those
 * agents' tools), the jobs' and the wait's, finished subagents and usage time. Ids, stages, rounds, verdicts, counts and
 * cost stay.
 */
export function bandKey(model: PanelModel): string {
  const { subagentsDone: _done, usage, forge, subagents, tool, turnSeconds: _turn, activities, jobs, waiting, ...rest } = model;
  const key: Record<string, unknown> = { ...rest };
  key.subagents = subagents.map(({ seconds: _s, ...s }) => s);
  key.tool = tool ? { name: tool.name } : null;
  key.activities = activities.map(({ seconds: _s, job, agents, ...a }) => ({
    ...a, job: job ? { name: job.name } : null, agents: agents.map(({ seconds: _x, tool: _y, ...g }) => g),
  }));
  key.jobs = jobs.map(({ seconds: _s, ...j }) => j);
  key.waiting = waiting ? { agents: waiting.agents } : null;
  if (usage) { const { time: _time, ...u } = usage; key.usage = u; } else key.usage = usage;
  // The forge timing's seconds are left out, but not whether the task is done: the band's phase and cells follow it.
  if (forge) { const { timing, ...f } = forge; key.forge = { ...f, done: timing?.done ?? null }; } else key.forge = forge;
  if (rest.execution) {
    const { elapsedSeconds: _e, finished: _f, slots, manual, ...x } = rest.execution;
    key.execution = {
      ...x,
      slots: slots.map(({ taskSeconds: _t, seconds: _s, agents, ...s }) => ({ ...s, agents: (agents ?? []).map(({ seconds: _a, tool: _b, ...g }) => g) })),
      manual: manual.map(({ seconds: _m, ...m }) => m),
    };
  }
  return JSON.stringify(key);
}

export function buildPanelModel(input: {
  band: BandModel; ledger?: string; ledgerPlan?: string; planFallback?: string; ledgerMtimeMs?: number;
  forgeStatus?: string; forgeRun?: string; proposals?: Record<string, string>; forgeBriefs?: number; forgeDecisions?: string;
  forgeExecution?: string; forgeExecTasks?: Record<string, string>; forgeLive?: Record<string, string>;
  // C5: the texts of .forge/status/*.json (forgeStatus, the alias, stands in for them only without the folder), the
  // briefs of each task by its status key, and the texts of .forge/jobs/*.json.
  forgeStatuses?: string[]; forgeBriefsBy?: Record<string, number>; forgeJobs?: string[];
  // What lens heard: the agents and their task, the tasks this session touched with forge.cjs, this session's id
  // (undefined: not known, every task counts as own, as before; null: it could not be read), when its last
  // ScheduleWakeup wakes it, and the agent the person looks at.
  links?: readonly AgentLink[]; ownTasks?: readonly string[]; sessionId?: string | null; wakeAt?: number | null; focusAgent?: string | null;
  activity: Activity; now: number; locale?: string;
  // `officialOwnUsd`: this session's own computed cost at the moment `officialUsd` was read, for the drift check.
  usage?: { session: UsageState; run: UsageState | null; officialUsd: number | null; officialOwnUsd?: number | null };
}): PanelModel {
  const { band, activity: a, now } = input;
  const wp = band.mode === 'work' ? band : null;
  const rb = band.mode === 'run' ? band : null;
  const cc = a.ccTasks ?? [];
  const todos = summarizeTodos(a.todos);
  const sess = input.usage?.session ?? null;
  const mainLoop = sess?.loops[MAIN];
  const loopOfAgent = (id: string) => sess?.loops[id];
  const hasSteps = !!sess && Object.values(sess.loops).some(l => l.steps > 0);
  let usage: PanelModel['usage'] = null;
  if (input.usage && hasSteps) {
    const own = summarizeUsage(input.usage.session);
    const shown = input.usage.run ? summarizeUsage(input.usage.run) : own;
    const official = input.usage.officialUsd;
    // Both sides of the check are from the same moment (the last /cost read); a partial session is not checked.
    const at = input.usage.officialOwnUsd ?? null;
    const drift = !own.partial && official !== null && official > 0 && at !== null && Math.abs(at - official) > official * 0.1;
    usage = {
      scope: input.usage.run ? 'run' : 'session',
      tokens: shown.tokens, costUsd: shown.costUsd, partial: shown.partial, sessionPartial: own.partial,
      officialUsd: official, drift,
      session: input.usage.run ? { tokens: own.tokens, costUsd: own.costUsd } : null,
      groups: shown.groups, tracking: shown.tracking, withoutForge: shown.withoutForge,
      time: usageTime(input.usage.session, input.usage.run, a.turnSince ?? null, now),
      pricesAsOf: PRICES_AS_OF,
    };
  }
  // C3: the role of who looks, as the band publishes it; lens never works it out again.
  const viewer = band.viewer ?? { role: 'none' as const, coordinator: false, runId: null };
  // The only plan task title the band model carries is the current one's.
  const execution = executionFromFiles(input.forgeExecution, input.forgeExecTasks, input.forgeLive, now,
    wp?.current ? { [wp.current.id]: wp.current.title } : undefined, runRoleOf(band));
  // C5: by status key, so a title goes to its own plan's task and never to a loose task or another plan's of that id.
  const titles: Record<string, string> = {};
  const titleOf = (task: string, project: string | null, title: string) => { const k = statusKey(task, project); if (k) titles[k] = title; };
  for (const s of execution?.slots ?? []) if (s.title) titleOf(s.task, execution?.project ?? null, s.title);
  if (wp?.current) {
    titleOf(wp.current.id, wp.project, wp.current.title);
    // R4: /forge:run's Medium path triages a plan task without --plan: its loose status takes the task's title too.
    if (!titles[wp.current.id]) titleOf(wp.current.id, null, wp.current.title);
  }
  const sp = superpowers(input);
  const todosModel = todos.total ? todos : null;
  const statuses = parseStatuses(input.forgeStatuses ?? (input.forgeStatus !== undefined ? [input.forgeStatus] : []));
  const links = input.links ?? [];
  const liveTypes = (a.subagents ?? []).map(s => s.type);
  const models: Models = Object.fromEntries(Object.entries(sess?.loops ?? {}).map(([id, l]) => [id, { ...(l.model ? { model: l.model } : {}), ...(l.effort ? { effort: l.effort } : {}) }]));
  let view: ActivityView = { activities: [], waiting: null, jobs: [], expanded: null };
  let failed = false;
  // R3: each agent's one home, for the task rows and the slots alike.
  let homes: Map<string, string> | undefined;
  try {
    homes = linkHomes({ statuses, links, sessionId: input.sessionId, ownTasks: input.ownTasks ?? [], now });
    view = buildActivities({
      statuses, links, execution, superpowers: sp, todos: todosModel, titles, sessionId: input.sessionId, ownTasks: input.ownTasks ?? [], viewer,
      jobs: (input.forgeJobs ?? []).map(parseJob).filter((j): j is LensJob => j !== null), models, liveTypes, turnSince: a.turnSince ?? null,
      wakeAt: input.wakeAt ?? null, sleepUntil: execution?.sleepUntil ?? null, focusAgent: input.focusAgent ?? null, now, homes,
    });
  } catch { failed = true; }
  // The briefs of a task: counted in its folder by key; an older forge's alias alone keeps the count read for it.
  const briefsOf = (st: ForgeStatus): number | null =>
    input.forgeBriefsBy?.[statusKey(st.task, st.project) ?? st.task] ?? (input.forgeStatuses === undefined ? input.forgeBriefs ?? null : null);
  const forge = failed ? newestForge(statuses, now, briefsOf, liveTypes)
    : view.expanded ? forgeOf(view.expanded, now, briefsOf(view.expanded), liveTypes) : null;
  // A slot leaves out the agents its status's own row draws (in mode sessions a member's task is a row, not a slot).
  const underRows = new Set(view.activities.filter(x => x.kind === 'forge' && !x.slot).flatMap(x => x.agents.map(g => g.id)));
  const withAgents = withSlotAgents(execution, links, models, viewer, now, homes, underRows);
  // A subagent drawn under its task or its slot is not drawn again among the subagents.
  const shown = new Set(view.activities.filter(x => !x.slot && x.kind !== 'adhoc').flatMap(x => x.agents.map(g => g.id)));
  for (const s of withAgents?.slots ?? []) for (const g of s.agents ?? []) shown.add(g.id);
  const taskOf = new Map(links.flatMap(l => (l.task ? [[l.id, l.task] as const] : [])));
  return {
    locale: wp?.locale ?? rb?.locale ?? input.locale ?? 'en',
    waypoint: wp ? {
      project: wp.project, track: wp.track, percent: wp.percent, trackDone: wp.trackDone, trackTotal: wp.trackTotal,
      current: wp.current, inbox: wp.inbox, escalation: wp.escalation, roadmapUrl: wp.roadmapUrl, locale: wp.locale,
      phase: wp.phase ? { ...wp.phase, name: clip(wp.phase.name) } : null,
      cells: typeof wp.cells === 'string' ? wp.cells.replace(/[^dabp]/g, '').slice(0, 120) : '',
      recentDone: (wp.recentDone ?? []).slice(0, 3),
    } : rb ? {
      // E-10: the band of an execution: its progress, the seat's messages and decision and the phase, without a task.
      project: rb.project, track: null, percent: rb.percent, trackDone: rb.integrated, trackTotal: rb.total, current: null,
      inbox: rb.inbox, escalation: rb.escalation, roadmapUrl: rb.roadmapUrl, locale: rb.locale,
      phase: rb.phase ? { ...rb.phase, name: clip(rb.phase.name) } : null, cells: '', recentDone: [], run: true,
    } : null,
    superpowers: sp,
    todos: todosModel,
    subagents: (a.subagents ?? []).map(s => {
      const loop = loopOfAgent(s.id);
      const task = taskOf.get(s.id);
      return {
        // The engine's own text, as lens draws it: one clean line.
        id: s.id, type: oneLine(s.type),
        ...(s.description !== undefined ? { description: clip(oneLine(s.description)) } : {}),
        ...(s.status !== undefined ? { status: s.status } : {}),
        seconds: secs(now, s.since),
        ...(loop?.model ? { model: loop.model } : {}),
        ...(loop?.effort ? { effort: loop.effort } : {}),
        ...(task ? { task } : {}),
        ...(shown.has(s.id) ? { shown: true as const } : {}),
      };
    }),
    subagentsDone: freshFinished(a.finished ?? [], now).map(f => ({
      id: f.id, type: f.type, ...(f.description ? { description: clip(f.description) } : {}), ...(f.model ? { model: f.model } : {}), seconds: f.seconds,
    })),
    tool: a.tool ? { name: a.tool.name, seconds: secs(now, a.tool.since) } : null,
    turnSeconds: a.turnSince === null || a.turnSince === undefined ? null : secs(now, a.turnSince),
    ccTasks: cc.length
      ? { open: cc.filter(t => !t.done).length, done: cc.filter(t => t.done).length, recent: cc.slice(-3).map(t => clip(t.subject)) }
      : null,
    forge,
    infinite: infiniteFromRun(input.forgeRun, input.proposals, now),
    decisions: decisionsSummary(input.forgeDecisions, now),
    execution: withAgents,
    proposals: pendingProposals(input.proposals),
    mainModel: mainLoop?.model ? { model: mainLoop.model, effort: mainLoop.effort } : null,
    activities: view.activities, waiting: view.waiting, jobs: view.jobs,
    usage,
  };
}
