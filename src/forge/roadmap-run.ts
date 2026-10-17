// G-07, G-04 (data): runs/<runId>, the summary of a forge execution once it ends (or of a Small, Medium or Large task
// closed outside one, when the project has a roadmap), and `cleanup`, the run's executor sessions to delete from it.
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { listDecisions } from './decisions.js';
import { eventsSince, readExecution, executionTaskFile } from './execution.js';
import { readEvents, readStatus, readStatuses, type LedgerEvent } from './ledger.js';
import { mainCheckout } from './local.js';
import { readLoose } from './loose.js';
import { allMembersOf } from './members.js';
import { integrationAt } from './roadmap-sources.js';
import { eventsOf, projectOf, readWorkDir, type TaskRef } from './task-ref.js';
import { compactTs } from '../lib/ids.js';
import { isSafeId, normalizePublicTask, type ExecutionState } from '../lib/execution-state.js';
import { statusKey } from '../lib/forge-status.js';
import { fitRunSummary, type RunSummaryDoc, type RunSummaryTask, type RunTaskStatus } from '../lib/run-summary.js';

export class RoadmapRunError extends Error {
  constructor(readonly code: 2, message: string) { super(message); this.name = 'RoadmapRunError'; }
}
export interface RunIo { cwd: string; now: () => Date }
export interface RunOptions { run?: string; task?: string; project?: string | null; session?: string; out?: string }
export interface RunGenerated {
  write: { op: 'set'; collection: 'runs'; doc_id: string; file_path: string };
  cleanup: { op: 'delete'; collection: 'sessions'; doc_id: string }[];
  bytes: number; dropped: string[]; doc: RunSummaryDoc;
}

const int = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const secondsOf = (from: string, to: string | null | undefined): number | undefined => {
  const a = Date.parse(from), b = to ? Date.parse(to) : NaN;
  return Number.isFinite(a) && Number.isFinite(b) && b >= a && b - a <= 30 * 86400_000 ? Math.round((b - a) / 1000) : undefined;
};
function writeJsonAtomic(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try { writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n'); renameSync(tmp, file); } finally { rmSync(tmp, { force: true }); }
}

/**
 * The deferred findings of a task: deferred.json of its work folder in the main checkout, else its rulings. With `since`
 * (the start of the run it summarizes, M4) an entry counts by its own `ts` (or `at`), else by the file's mtime, as
 * roadmap-doc's ownRun dates them: a deferred.json of an earlier run leaves the count to this run's rulings.
 */
function deferredCount(main: string, ref: TaskRef, events: readonly LedgerEvent[], mine: readonly LedgerEvent[], since?: string): number {
  const file = path.join(readWorkDir(main, ref, events), 'deferred.json');
  try {
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (Array.isArray(raw)) {
      if (since === undefined) return raw.length;
      const mtime = statSync(file).mtime.toISOString();
      const current = (ts: unknown): boolean => typeof ts !== 'string' || !Number.isFinite(Date.parse(ts)) || Date.parse(ts) >= Date.parse(since);
      const own = (d: unknown): unknown => {
        const o = d && typeof d === 'object' ? d as { ts?: unknown; at?: unknown } : {};
        return typeof o.ts === 'string' ? o.ts : typeof o.at === 'string' ? o.at : mtime;
      };
      const kept = raw.filter(d => current(own(d))).length;
      if (kept) return kept;
    }
  } catch { /* none */ }
  return mine.filter(e => e.kind === 'ruling' && Array.isArray(e.deferred)).reduce((s, e) => s + (e.deferred as unknown[]).length, 0);
}

/** One task of the summary; `since` (a run's start, M4) keeps only that run's events and deferred findings, as C1 does. */
function row(main: string, events: readonly LedgerEvent[], ref: TaskRef, status: RunTaskStatus, title: string | null | undefined, seconds: number | undefined, since?: string): RunSummaryTask {
  const dated = since !== undefined && Number.isFinite(Date.parse(since)) ? since : undefined;
  const mine = dated ? eventsSince(eventsOf(events, ref), dated) : eventsOf(events, ref);
  const rounds = new Set(mine.filter(e => e.kind === 'verdict' && typeof e.dir === 'string').map(e => String(e.dir))).size;
  const deferred = deferredCount(main, ref, events, mine, dated);
  return {
    id: ref.task, ...(title ? { title: title.slice(0, 200) } : {}), status, ...(seconds !== undefined ? { seconds } : {}),
    ...(rounds ? { rounds: Math.min(rounds, 99) } : {}), ...(deferred ? { deferred: Math.min(deferred, 999) } : {}),
  };
}

/** The executor sessions of a run: the `by` of its tasks' public files in mode sessions and its executor members. */
function executorsOf(main: string, e: ExecutionState): string[] {
  const out = new Set<string>();
  for (const id of Object.keys(e.tasks)) {
    try {
      const p = normalizePublicTask(JSON.parse(readFileSync(executionTaskFile(main, id), 'utf8')));
      if (p && p.task === id && p.runId === e.runId && p.mode === 'sessions') out.add(p.by);
    } catch { /* no public file */ }
  }
  for (const m of allMembersOf(main, e.runId)) if (m.role === 'executor') out.add(m.sessionId);
  out.delete(e.coordinator);
  return [...out].filter(isSafeId).sort();
}

function runSummary(main: string, e: ExecutionState, now: Date): RunSummaryDoc {
  const events = readEvents(main);
  const project = e.kind === 'plan' ? e.project : null;
  const tasks = Object.entries(e.tasks).map(([id, t]) => row(main, events, { project, task: id }, t.status, t.title, secondsOf(t.startedAt, t.finishedAt), e.startedAt));
  // An ephemeral run lists the requests it never started too.
  if (e.kind === 'ephemeral') for (const l of readLoose(main, e.runId)?.tasks ?? []) if (!e.tasks[l.id]) tasks.push({ id: l.id, title: l.title.slice(0, 200), status: 'queued' });
  const final = events.filter(x => x.kind === 'verdict' && x.task === `${e.project}-final` && x.ts >= e.startedAt).at(-1);
  const n = (v: unknown) => (int(v, 0, 999) ? v : 0);
  return {
    v: 1, runId: e.runId, kind: e.kind, mode: e.mode, parallel: e.parallel, branch: e.branch, target: e.base, coordinator: e.coordinator,
    startedAt: e.startedAt, endedAt: e.closedAt ?? e.lastStepAt ?? now.toISOString(), stopReason: e.stopReason, closedBy: e.closedBy ?? null,
    merged: e.closedBy === 'merge', tasks, loose: e.kind === 'ephemeral',
    finalReview: final && (final.action === 'accept' || final.action === 'fix' || final.action === 'redo')
      ? { action: final.action, critical: n(final.critical), important: n(final.important), minor: n(final.minor) } : null,
    decisions: listDecisions(main, { run: e.runId, auto: true }).length,
    deferred: tasks.reduce((s, t) => s + (t.deferred ?? 0), 0),
  };
}

function singleSummary(io: RunIo, main: string, task: string, given: string | null | undefined, session: string, now: Date): RunSummaryDoc {
  const events = readEvents(io.cwd);
  const project = given ?? projectOf(events, task);
  if (project !== null && !isSafeId(project)) throw new RoadmapRunError(2, 'roadmap-run: --project is not a project id');
  const key = statusKey(task, project);
  const alias = readStatus(main);
  const s = (key ? readStatuses(main)[key] : undefined) ?? (alias && alias.task === task && (alias.project ?? null) === project ? alias : null);
  if (!s) throw new RoadmapRunError(2, `roadmap-run: forge has no status of ${task}`);
  if (s.path !== 'small' && s.path !== 'medium' && s.path !== 'large') throw new RoadmapRunError(2, `roadmap-run: ${task} is ${s.path || 'not triaged'}; only a Small, Medium or Large task has a run summary`);
  const started = s.taskStartedAt ?? s.ts;
  const at = Number.isFinite(Date.parse(started)) ? new Date(started) : now;
  const integ = integrationAt(io.cwd);
  const merged = !!s.doneAt && !!integ?.merged;
  const t = row(main, events, { project, task }, !s.doneAt ? 'running' : merged ? 'integrated' : 'accepted', null, secondsOf(started, s.doneAt));
  return {
    v: 1, runId: `single-${task}-${compactTs(at)}`, kind: 'single', mode: 'single', parallel: 1,
    branch: integ?.branch ?? 'HEAD', target: integ?.target ?? 'HEAD', coordinator: session,
    startedAt: at.toISOString(), endedAt: s.doneAt ?? now.toISOString(), stopReason: s.doneAt ? 'finished' : null, closedBy: null,
    merged, tasks: [t], loose: project === null, finalReview: null,
    decisions: listDecisions(main, { task, auto: true }).length, deferred: t.deferred ?? 0,
  };
}

/**
 * G-07: runs/<runId> of an ended execution of this checkout (--run), or of a task closed outside one (--task), written
 * to --out (by default .forge/work/run/runs-<runId>.json of the main checkout). `cleanup` deletes the run's executor
 * sessions (G-04); never its coordinator, a manual member or anything of a single task.
 */
export function roadmapRun(io: RunIo, o: RunOptions): RunGenerated {
  if (!!o.run === !!o.task) throw new RoadmapRunError(2, 'usage: forge roadmap-run --run <runId> | --task <id> [--project p] [--session SID] [--out f]');
  const main = mainCheckout(io.cwd);
  const now = io.now();
  let doc: RunSummaryDoc;
  let cleanup: RunGenerated['cleanup'] = [];
  if (o.run) {
    const e = readExecution(main);
    if (!e || e.runId !== o.run) throw new RoadmapRunError(2, `roadmap-run: ${o.run.slice(0, 120)} is not the execution of this checkout`);
    if (e.active) throw new RoadmapRunError(2, `roadmap-run: ${e.runId} is still active; its summary is written once it ends`);
    doc = runSummary(main, e, now);
    cleanup = executorsOf(main, e).map(doc_id => ({ op: 'delete', collection: 'sessions', doc_id }));
  } else {
    const task = o.task!;
    if (!isSafeId(task)) throw new RoadmapRunError(2, 'roadmap-run: --task is not a task id');
    const session = o.session ?? 'main';
    if (!isSafeId(session)) throw new RoadmapRunError(2, 'roadmap-run: --session is not a session id');
    doc = singleSummary(io, main, task, o.project, session, now);
  }
  const fit = fitRunSummary(doc);
  const file = path.resolve(io.cwd, o.out ?? path.join(main, '.forge', 'work', 'run', `runs-${fit.doc.runId}.json`));
  writeJsonAtomic(file, fit.doc);
  return { write: { op: 'set', collection: 'runs', doc_id: fit.doc.runId, file_path: file }, cleanup, bytes: fit.bytes, dropped: fit.dropped, doc: fit.doc };
}
