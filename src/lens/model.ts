import type { BandModel } from '../mod/model.js';
import { normalizeProposal } from '../lib/proposals.js';
import { cleanText, normalizeStatus } from '../lib/forge-status.js';
import { parseRun } from '../lib/forge-run.js';
import { normalizeLive, normalizePublicTask, parseExecution, type LiveDoc, type PublicTask } from '../lib/execution-state.js';
import { executionView } from '../lib/execution-view.js';
import { MAIN, type UsageState } from './usage.js';
import { summarizeUsage } from './usage-summary.js';
import { PRICES_AS_OF } from '../lib/prices.js';
import { freshFinished, type FinishedAgent } from './finished.js';

const CLIP = 80;
const MAX_RANGE = 1000;
const clip = (s: string): string => (s.length > CLIP ? s.slice(0, CLIP) : s);

export interface LedgerSummary {
  planPath: string | null; done: number[]; current: { task: string; round: number } | null; lastLines: string[];
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
    const fixes: { lo: number; hi: number; label: string; round: number }[] = [];
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
      const fix = /^fix round\s+(\d+)\s*\/\s*\d+/i.exec(rest);
      if (fix) fixes.push({ lo, hi, label: m[2] !== undefined ? `${m[1]}-${m[2]}` : m[1], round: Number(fix[1]) });
    }
    out.done = [...done].sort((a, b) => a - b);
    for (let i = fixes.length - 1; i >= 0; i--) {
      const f = fixes[i];
      let open = false;
      for (let n = f.lo; n <= f.hi; n++) if (!done.has(n)) { open = true; break; }
      if (open) { out.current = { task: f.label, round: f.round }; break; }
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
    const h = /^###\s+Task\s+(\d+)\s*:\s*(.*?)\s*$/.exec(line);
    if (h) { cur = { n: Number(h[1]), title: h[2], steps: 0, checked: 0 }; tasks.push(cur); continue; }
    if (!cur) continue;
    const c = /^\s*[-*]\s+\[([ xX])\]/.exec(line);
    if (c) { cur.steps++; if (c[1] !== ' ') cur.checked++; }
  }
  return tasks;
}

export interface TodoSummary { total: number; done: number; inProgress: string | null; next: string[] }

export function summarizeTodos(todos: unknown): TodoSummary {
  const out: TodoSummary = { total: 0, done: 0, inProgress: null, next: [] };
  if (!Array.isArray(todos)) return out;
  for (const raw of todos) {
    if (!raw || typeof raw !== 'object') continue;
    const t = raw as { content?: unknown; status?: unknown; activeForm?: unknown };
    if (typeof t.content !== 'string') continue;
    out.total++;
    if (t.status === 'completed') out.done++;
    else if (t.status === 'in_progress') {
      if (out.inProgress === null) out.inProgress = clip(typeof t.activeForm === 'string' && t.activeForm ? t.activeForm : t.content);
    } else if (out.next.length < 3) out.next.push(clip(t.content));
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
  } | null;
  superpowers: {
    plan: string; tasks: number; done: number; current: { task: string; round: number } | null; lastLines: string[];
  } | null;
  todos: { total: number; done: number; inProgress: string | null; next: string[] } | null;
  subagents: { id: string; type: string; description?: string; status?: string; seconds: number | null; model?: string; effort?: string }[];
  subagentsDone?: { id: string; type: string; description?: string; model?: string; seconds: number }[];
  tool: { name: string; seconds: number | null } | null;
  turnSeconds: number | null;
  ccTasks: { open: number; done: number; recent: string[] } | null;
  forge: {
    task: string; path: string; phase: string; agent: string | null; validators: { name: string; ok: boolean }[];
    verdict: { action: string; score: number | null } | null; round: number | null; cap: number | null;
    brief: number | null; accepted: number[]; briefs: number | null;
    verify?: {
      planned: boolean; surfaces: string[]; result: string | null; passed: number | null; total: number | null;
      evidence: string | null; reason: string | null;
    } | null;
  } | null;
  infinite: { cycle: number; cyclesMax: number | null; hoursLeft: number | null; active: boolean; autoApproved: string[] } | null;
  execution: {
    runId: string; mode: 'subagents' | 'sessions'; parallel: number; branch: string; active: boolean;
    stopReason: string | null; stallReason: string | null;
    coordinator: { liveness: 'alive' | 'silent' | 'stopped'; lastSeen: string | null };
    integrated: number; total: number;
    slots: {
      task: string; title: string | null; stage: string; agent: string | null; model: string | null; effort: string | null;
      round: number; seconds: number; liveness: 'alive' | 'silent' | 'stopped'; mode: 'subagents' | 'sessions' | 'manual';
    }[];
    manual: { task: string; title: string | null; stage: string; seconds: number; liveness: 'alive' | 'silent' | 'stopped'; by: string }[];
    queued: string[]; conflicts: string[]; blocked: string[]; orphans: string[];
  } | null;
  proposals: { id: string; title: string; category: string; risk: string }[];
  mainModel: { model: string; effort: string | null } | null;
  usage: {
    scope: 'session' | 'run'; tokens: number; costUsd: number; partial: boolean; sessionPartial: boolean; officialUsd: number | null; drift: boolean;
    session: { tokens: number; costUsd: number } | null;
    groups: { id: 'main' | 'impl' | 'review' | 'verify' | 'plan' | 'other'; model: string | null; effort?: string | null; tokens: number; costUsd: number | null; share: number }[];
    tracking: { tokens: number; costUsd: number | null } | null;
    withoutForge: { costUsd: number; deltaUsd: number; deltaPct: number } | null;
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

const STALE_LEDGER_MS =24 * 3600_000;

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
      return { plan: clip(l.planPath ?? ''), tasks, done, current: l.current, lastLines: l.lastLines };
    }
    if (input.planFallback !== undefined) {
      const plan = parsePlanTasks(input.planFallback);
      // Without a checked step the checkboxes say nothing: a plan run by subagents keeps them empty and, once its
      // ledger is deleted, would show as not started.
      if (!plan.some(p => p.checked > 0)) return null;
      const title = /^#\s+(.+?)\s*$/m.exec(input.planFallback)?.[1] ?? '';
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
export const PROPOSAL_ID = /^p\d{14}[0-9a-z]{4}$/;

/**
 * The forge section from .forge/status.json (which forge keeps up to date on each ledger append): null when it does
 * not parse or validate, or when its task last saw a triage or phase event more than a day ago.
 */
export function forgeFromStatus(text: string, now: number, briefs: number | null = null): PanelModel['forge'] {
  if (typeof text !== 'string') return null;
  let st;
  try { st = normalizeStatus(JSON.parse(text)); } catch { return null; }
  if (!st) return null;
  const t = Date.parse(st.ts);
  if (!Number.isFinite(t) || !Number.isFinite(now) || now - t > FORGE_WINDOW_MS) return null;
  const { ts: _ts, taskStartedAt: _a, stageSince: _b, stages: _c, doneAt: _d, ...forge } = st;
  return { ...forge, briefs };
}

// Pending proposals (proposed or under discussion), newest id first (ids start with their UTC time), at most 5.
function pendingProposals(texts: Record<string, string> | undefined): PanelModel['proposals'] {
  const out: PanelModel['proposals'] = [];
  if (!texts || typeof texts !== 'object') return out;
  for (const id of Object.keys(texts).filter(k => PROPOSAL_ID.test(k)).sort().reverse()) {
    let doc;
    try { doc = normalizeProposal(JSON.parse(texts[id])); } catch { continue; }
    if (!doc || (doc.status !== 'proposed' && doc.status !== 'discussing')) continue;
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

function secondsSince(ts: string, now: number): number {
  const since = Date.parse(ts);
  return Number.isFinite(since) && Number.isFinite(now) ? Math.max(0, Math.round((now - since) / 1000)) : 0;
}

/**
 * The execution for the panel, from .forge/execution.json, the public task files (.forge/execution/<task>.json, keyed
 * by task id) and the live signals (.forge/live/*.json): null when absent, oversized, invalid or finished (a stalled
 * one stays to say why). Bad task or signal files are skipped.
 */
export function executionFromFiles(execText: string | undefined, taskTexts: Record<string, string> = {}, liveTexts: Record<string, string> = {}, now: number, titles?: Record<string, string>): PanelModel['execution'] {
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
  const clean = titles && Object.fromEntries(Object.entries(titles).map(([id, t]) => [id, cleanText(t)]));
  try { v = executionView({ exec: parseExecution(execText), tasks, live, titles: clean, now }); } catch { return null; }
  if (!v) return null;
  return {
    runId: v.runId, mode: v.mode, parallel: v.parallel, branch: v.branch, active: v.active, stopReason: v.stopReason,
    stallReason: v.stallReason ? clip(v.stallReason) : null,
    coordinator: { ...v.coordinator }, integrated: v.integrated, total: v.total,
    // model / effort: lens knows them only for its own session's subagents (from the usage loops), not for these.
    slots: v.slots.map(s => ({
      task: s.task, title: s.title ? clip(s.title) : null, stage: s.stage, agent: s.agent, model: null, effort: null, round: s.round,
      seconds: secondsSince(s.since, now), liveness: s.liveness, mode: s.mode,
    })),
    manual: v.manual.map(s => ({
      task: s.task, title: s.title ? clip(s.title) : null, stage: s.stage, seconds: secondsSince(s.since, now), liveness: s.liveness, by: s.by ?? '',
    })),
    queued: v.queued, conflicts: v.conflicts, blocked: v.blocked, orphans: v.orphans,
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

/** What the band compares and keeps: the model without the finished subagents' seconds (the band shows no times). */
export function bandKey(model: PanelModel): string {
  const { subagentsDone: _done, ...rest } = model;
  return JSON.stringify(rest);
}

export function buildPanelModel(input: {
  band: BandModel; ledger?: string; ledgerPlan?: string; planFallback?: string; ledgerMtimeMs?: number;
  forgeStatus?: string; forgeRun?: string; proposals?: Record<string, string>; forgeBriefs?: number;
  forgeExecution?: string; forgeExecTasks?: Record<string, string>; forgeLive?: Record<string, string>;
  activity: Activity; now: number; locale?: string;
  // `officialOwnUsd`: this session's own computed cost at the moment `officialUsd` was read, for the drift check.
  usage?: { session: UsageState; run: UsageState | null; officialUsd: number | null; officialOwnUsd?: number | null };
}): PanelModel {
  const { band, activity: a, now } = input;
  const wp = band.mode === 'work' ? band : null;
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
  return {
    locale: wp?.locale ?? input.locale ?? 'en',
    waypoint: wp && {
      project: wp.project, track: wp.track, percent: wp.percent, trackDone: wp.trackDone, trackTotal: wp.trackTotal,
      current: wp.current, inbox: wp.inbox, escalation: wp.escalation, roadmapUrl: wp.roadmapUrl, locale: wp.locale,
      phase: wp.phase ? { ...wp.phase, name: clip(wp.phase.name) } : null,
      cells: typeof wp.cells === 'string' ? wp.cells.replace(/[^dabp]/g, '').slice(0, 120) : '',
    },
    superpowers: superpowers(input),
    todos: todos.total ? todos : null,
    subagents: (a.subagents ?? []).map(s => {
      const loop = loopOfAgent(s.id);
      return {
      id: s.id, type: s.type,
      ...(s.description !== undefined ? { description: clip(s.description) } : {}),
      ...(s.status !== undefined ? { status: s.status } : {}),
      seconds: secs(now, s.since),
      ...(loop?.model ? { model: loop.model } : {}),
      ...(loop?.effort ? { effort: loop.effort } : {}),
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
    forge: input.forgeStatus !== undefined ? forgeFromStatus(input.forgeStatus, now, input.forgeBriefs ?? null) : null,
    infinite: infiniteFromRun(input.forgeRun, input.proposals, now),
    // The only plan task title the band model carries is the current one's.
    execution: executionFromFiles(input.forgeExecution, input.forgeExecTasks, input.forgeLive, now,
      wp?.current ? { [wp.current.id]: wp.current.title } : undefined),
    proposals: pendingProposals(input.proposals),
    mainModel: mainLoop?.model ? { model: mainLoop.model, effort: mainLoop.effort } : null,
    usage,
  };
}
