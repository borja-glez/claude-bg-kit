// G-07 (wave 4): runs/<runId>, the summary of a forge execution once it ends, or of a Small, Medium or Large task closed
// outside one. FORGE roadmap-run writes it; the page lists it (the Runs view of plan 4c). Pure, without Node imports.
import { isPlanId } from './ids.js';
import { byteLength, type DocReport } from './roadmap-doc.js';

export const RUN_SUMMARY_MAX = 8192;
export const RUN_TASKS_MAX = 60;
export const RUN_TASK_STATUSES = ['integrated', 'blocked', 'conflict', 'accepted', 'running', 'queued', 'stopped'] as const;
export type RunTaskStatus = (typeof RUN_TASK_STATUSES)[number];
export interface RunSummaryTask { id: string; title?: string; status: RunTaskStatus; seconds?: number; rounds?: number; deferred?: number }
export interface RunSummaryDoc {
  v: 1; runId: string; kind: 'plan' | 'ephemeral' | 'single';
  mode: 'subagents' | 'sessions' | 'single'; parallel: number;
  branch: string; target: string; coordinator: string;          // coordinator: a waypoint SID
  startedAt: string; endedAt: string;
  stopReason: 'finished' | 'stalled' | 'stopped' | 'budget' | 'migrated' | null;
  closedBy: 'merge' | 'close' | null; merged: boolean;
  tasks: RunSummaryTask[];                                      // at most 60
  loose: boolean;                                               // its tasks are not the plan's
  finalReview: { action: 'accept' | 'fix' | 'redo'; critical: number; important: number; minor: number } | null;
  decisions: number; deferred: number;
}

const KINDS = ['plan', 'ephemeral', 'single'] as const;
const MODES = ['subagents', 'sessions', 'single'] as const;
const STOPS = ['finished', 'stalled', 'stopped', 'budget', 'migrated'] as const;
const SAFE_ID = /^[A-Za-z0-9_\-.]{1,120}$/;
type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const kindOf = (v: unknown): string => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const int = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const iso = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v));
const oneOf = <T extends string>(list: readonly T[], x: unknown): x is T => (list as readonly unknown[]).includes(x);
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
// eslint-disable-next-line no-control-regex
const clip = (v: string, max: number): string => v.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim().slice(0, max);

function taskOf(t: unknown): RunSummaryTask | null {
  if (!isObj(t) || typeof t.id !== 'string' || !isPlanId(t.id) || !oneOf(RUN_TASK_STATUSES, t.status)) return null;
  const out: RunSummaryTask = { id: t.id, status: t.status };
  if (text(t.title)) out.title = clip(t.title, 200);
  if (int(t.seconds, 0, 30 * 86400)) out.seconds = t.seconds;
  if (int(t.rounds, 0, 99)) out.rounds = t.rounds;
  if (int(t.deferred, 0, 999)) out.deferred = t.deferred;
  return out;
}

/** A runs/<runId> document, checked: null (reported as `run`) when it is not one; a task that does not validate is dropped alone. */
export function normalizeRunSummary(x: unknown, report?: DocReport): RunSummaryDoc | null {
  const bad = (why: string): null => { report?.('run', 'dropped', why); return null; };
  if (!isObj(x)) return bad(kindOf(x));
  if (x.v !== 1) return bad('no v: 1');
  if (typeof x.runId !== 'string' || !SAFE_ID.test(x.runId)) return bad('runId');
  if (!oneOf(KINDS, x.kind) || !oneOf(MODES, x.mode) || !int(x.parallel, 1, 10)) return bad('kind, mode or parallel');
  if (!text(x.branch) || !text(x.target) || !text(x.coordinator)) return bad('branch, target or coordinator');
  if (!iso(x.startedAt) || !iso(x.endedAt)) return bad('startedAt or endedAt');
  if (x.stopReason !== null && !oneOf(STOPS, x.stopReason)) return bad('stopReason');
  if (x.closedBy !== null && x.closedBy !== 'merge' && x.closedBy !== 'close') return bad('closedBy');
  if (typeof x.merged !== 'boolean' || typeof x.loose !== 'boolean' || !Array.isArray(x.tasks)) return bad('merged, loose or tasks');
  if (!int(x.decisions, 0, 100_000) || !int(x.deferred, 0, 100_000)) return bad('decisions or deferred');
  const tasks: RunSummaryTask[] = [];
  x.tasks.forEach((t, i) => {
    const o = taskOf(t);
    if (!o) report?.(`tasks[${i}]`, 'dropped', kindOf(t));
    else if (tasks.length < RUN_TASKS_MAX) tasks.push(o);
  });
  let finalReview: RunSummaryDoc['finalReview'] = null;
  const f = x.finalReview;
  if (f !== null && f !== undefined) {
    if (isObj(f) && (f.action === 'accept' || f.action === 'fix' || f.action === 'redo') && int(f.critical, 0, 999) && int(f.important, 0, 999) && int(f.minor, 0, 999)) {
      finalReview = { action: f.action, critical: f.critical, important: f.important, minor: f.minor };
    } else report?.('finalReview', 'dropped', kindOf(f));
  }
  return {
    v: 1, runId: x.runId, kind: x.kind as RunSummaryDoc['kind'], mode: x.mode as RunSummaryDoc['mode'], parallel: x.parallel,
    branch: clip(x.branch, 200), target: clip(x.target, 200), coordinator: clip(x.coordinator, 120),
    startedAt: x.startedAt, endedAt: x.endedAt, stopReason: (x.stopReason ?? null) as RunSummaryDoc['stopReason'],
    closedBy: (x.closedBy ?? null) as RunSummaryDoc['closedBy'], merged: x.merged, tasks, loose: x.loose, finalReview,
    decisions: x.decisions, deferred: x.deferred,
  };
}

/** At most 60 tasks, then tasks dropped from the end until the JSON measures at most 8 KB. */
export function fitRunSummary(doc: RunSummaryDoc): { doc: RunSummaryDoc; dropped: string[]; bytes: number } {
  const dropped: string[] = [];
  let cur: RunSummaryDoc = { ...doc, tasks: doc.tasks.slice(0, RUN_TASKS_MAX) };
  if (cur.tasks.length < doc.tasks.length) dropped.push(`tasks>${RUN_TASKS_MAX}`);
  const kept = cur.tasks.length;
  while (byteLength(JSON.stringify(cur)) > RUN_SUMMARY_MAX && cur.tasks.length) cur = { ...cur, tasks: cur.tasks.slice(0, -1) };
  if (cur.tasks.length < kept) dropped.push(`tasks:${cur.tasks.length}`);
  return { doc: cur, dropped, bytes: byteLength(JSON.stringify(cur)) };
}
