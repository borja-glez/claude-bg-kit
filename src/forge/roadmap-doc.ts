// C7 (wave 4): state/T's forge block (v2), its evidence and its exec, built from what forge keeps locally: the task's
// status (C5), its ledger events (C4), the execution, its review dirs and its verify files. Pure:
// src/forge/roadmap-sources.ts reads the files, and FORGE roadmap-doc and the swarm commands write the result.
import {
  DEFERRED_MAX, DOC_PATHS, NOTE_MAX, PROBLEM_MAX, ROUNDS_MAX, SHOTS_MAX, STAGE_KEYS, UNCHECKED_MAX, VALIDATORS_MAX,
  type DeferredV2, type DocAction, type DocPath, type DocStage, type EvidenceV2, type ForgeDocV2, type IntegrationV2,
  type RoundV2, type ShotV2, type ValidatorV2, type VerifyV2,
} from '../lib/roadmap-doc.js';
import { deriveStatuses, reviewersOf, statusKey, type ForgeStatus, type StatusMap } from '../lib/forge-status.js';
import { STAGES, type Stage, type TaskExec } from '../lib/types.js';
import type { ExecTask, ExecutionState, PublicTask } from '../lib/execution-state.js';
import { samePath } from '../lib/worktree.js';
import { eventsSince } from './execution.js';
import type { LedgerEvent } from './ledger.js';
import type { VerifyFile } from './verdict.js';

/** A review dir of the task, `reviews-<brief>-<n>/`, and the names of the files in it. */
export interface ReviewDir { brief: number; n: number; files: readonly string[] }
/** A verification of the task: its verify.json, its evidence dir relative to the repo, and the absolute path of a screenshot. */
export interface VerifyRound { brief: number; n: number; file: VerifyFile; local: string; shotPath: (shot: string) => string }
/** An uploaded screenshot: the absolute path of the file and the roadmap asset it became. */
export interface Asset { path: string; id: string; url: string }
export interface DocInput {
  task: string; status: ForgeStatus | null; events: readonly LedgerEvent[];
  execution: ExecutionState | null; execTask: ExecTask | null; publicTask: PublicTask | null;
  reviews: readonly ReviewDir[]; verifies: readonly VerifyRound[]; deferred: unknown;
  integration: IntegrationV2 | null; assets: readonly Asset[]; evidenceMode: 'upload' | 'local'; now: Date;
}
export type ExecWrite = TaskExec | { __delete__: true };
export interface RoadmapData { forge: ForgeDocV2; evidence: EvidenceV2 | null; exec: ExecWrite | null }

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const int = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const isAction = (v: unknown): v is DocAction => v === 'accept' || v === 'fix' || v === 'redo';
// eslint-disable-next-line no-control-regex
const clip = (v: string, max: number): string => v.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim().slice(0, max);
const REVIEW_DIR = /reviews-(\d+)-(\d+)$/;
const REVIEWER_FILE = /^(correctness|security|perf|final)\.json$/;
const dirOf = (e: LedgerEvent): { brief: number; n: number } | null => {
  const m = typeof e.dir === 'string' ? REVIEW_DIR.exec(e.dir.replace(/\\/g, '/')) : null;
  return m ? { brief: Number(m[1]), n: Number(m[2]) } : null;
};
const reviewsOf = (x: unknown): { n: number; max: number } | null => (isObj(x) && int(x.n, 1, 20) && int(x.max, 1, 20) ? { n: x.n, max: x.max } : null);

/** Who reviewed a round: its phase review (C4), else, in an older ledger, the reviewers' files of its dir; verify when it ran. */
function reviewersFor(i: DocInput, d: { brief: number; n: number }): string[] {
  const phase = i.events.filter(e => e.kind === 'phase' && e.phase === 'review' && e.brief === d.brief && e.round === d.n && Array.isArray(e.reviewers)).at(-1);
  const dir = i.reviews.find(r => r.brief === d.brief && r.n === d.n);
  const names = phase ? reviewersOf(phase.reviewers) : (dir?.files ?? []).filter(f => REVIEWER_FILE.test(f)).map(f => f.slice(0, -'.json'.length));
  if (dir?.files.includes('verify.json') && !names.includes('verify')) names.push('verify');
  return names.slice(0, 6);
}

/** One round per review dir, its last verdict (a re-run close of the same dir replaces it), oldest first. */
function roundsOf(i: DocInput): RoundV2[] {
  const last = new Map<string, number>();
  i.events.forEach((e, at) => {
    const d = e.kind === 'verdict' && isAction(e.action) ? dirOf(e) : null;
    if (d) last.set(`${d.brief}-${d.n}`, at);
  });
  const count = (v: unknown): number => (int(v, 0, 999) ? v : 0);
  return [...last.values()].sort((a, b) => a - b).map(at => {
    const e = i.events[at];
    const d = dirOf(e)!;
    // The note is the reason of the round event review-close logs right after the verdict.
    const next = i.events.slice(at + 1).find(x => x.kind === 'round' && x.task === e.task);
    return {
      brief: d.brief, n: d.n, action: e.action as DocAction, note: typeof next?.reason === 'string' ? clip(next.reason, NOTE_MAX) : '',
      findings: { critical: count(e.critical), important: count(e.important), minor: count(e.minor), deferred: count(e.deferred) },
      reviewers: reviewersFor(i, d), at: e.ts,
    };
  });
}

/** The last validate of the task that is neither a baseline (prep, validate --base-run, swarm integrate's) nor an --affected pass. */
function validatorsOf(events: readonly LedgerEvent[]): ValidatorV2[] {
  const e = events.filter(x => x.kind === 'validate' && x.baseline !== true && x.integrate !== 'baseline' && x.scope !== 'affected' && Array.isArray(x.results)).at(-1);
  if (!e) return [];
  return (e.results as unknown[]).filter((r): r is Obj => isObj(r) && typeof r.validator === 'string' && !!r.validator.trim()).slice(0, VALIDATORS_MAX).map(r => {
    const skipped = typeof r.skipped === 'string' && r.skipped.trim() ? clip(r.skipped, 80) : null;
    // A skipped validator is ok with its reason, so a page from before wave 4 does not drop it.
    const v: ValidatorV2 = { name: clip(String(r.validator), 80), ok: skipped !== null || r.ok === true };
    if (r.flaky === true) v.flaky = true;
    if (skipped) v.skipped = skipped;
    if (r.preexisting === true) v.preexisting = true;
    if (typeof r.durationMs === 'number' && Number.isFinite(r.durationMs) && r.durationMs >= 0 && r.durationMs <= 86_400_000) v.ms = Math.round(r.durationMs);
    if (r.cached === true) v.cached = true;
    if (r.failingKnown === true && Array.isArray(r.failing) && r.failing.length) v.failing = r.failing.length;
    return v;
  });
}

function verifyOf(s: ForgeStatus | null): VerifyV2 | null {
  const v = s?.verify;
  if (!v) return null;
  const skippedSome = v.result === 'skipped' || (v.skipped ?? []).length > 0;
  return {
    planned: v.planned,
    result: v.result === 'pass' || v.result === 'fail' || v.result === 'blocked' ? v.result : null,
    passed: v.passed, total: v.total,
    // K2-05: the reason of the verify-skip (the last one given).
    skipped: skippedSome ? clip(v.reason ?? 'skipped', 200) : null,
    surfaces: v.surfaces.slice(0, 10),
  };
}

/** The seconds of each stage (C5), the fix of a round counted as implement; only forge's stages and the triage. */
function stagesOf(s: ForgeStatus | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, sec] of Object.entries(s?.stages ?? {})) {
    const key = k === 'fix' ? 'implement' : k;
    if (STAGE_KEYS.includes(key)) out[key] = (out[key] ?? 0) + sec;
  }
  return out;
}

/** A member's public file is fresher than execution.json for its own task (the tick mirrors it later). */
const liveOf = (i: DocInput): PublicTask | null => (i.publicTask && i.publicTask.mode !== 'subagents' ? i.publicTask : null);

function stageOf(i: DocInput): DocStage {
  const t = i.execTask;
  const live = liveOf(i);
  if (t || live) {
    const status = live?.status ?? t!.status;
    if (status === 'blocked') return 'blocked';
    if (status === 'stopped') return 'stopped';
    if (t?.status === 'integrated') return 'done';
    return live?.stage ?? t!.stage;
  }
  const p = (i.status?.phase ?? '').toLowerCase();
  if (p === 'stopped') return 'stopped';
  if (i.status?.doneAt) return 'done';
  if (p === 'fix') return 'implement';
  return (STAGES as readonly string[]).includes(p) ? (p as Stage) : 'triage';
}

function pathOf(i: DocInput): DocPath {
  const tri = i.events.filter(e => e.kind === 'triage' && typeof e.path === 'string').at(-1);
  const found = [tri?.path, i.status?.path].find((p): p is DocPath => (DOC_PATHS as readonly unknown[]).includes(p));
  return found ?? (i.execTask ? 'large' : 'medium');
}

/** deferred.json, else the deferred findings of the task's rulings: the first ten, one line each. */
function deferredOf(i: DocInput): DeferredV2[] {
  const list: unknown[] = Array.isArray(i.deferred) ? i.deferred
    : i.events.filter(e => e.kind === 'ruling' && Array.isArray(e.deferred)).flatMap(e => e.deferred as unknown[]);
  return list.filter((d): d is Obj => isObj(d) && typeof d.problem === 'string' && !!d.problem.trim()).slice(0, DEFERRED_MAX).map(d => ({
    ...(typeof d.file === 'string' && d.file.trim() ? { file: clip(d.file, 200) } : {}),
    ...(int(d.line, 1, 10_000_000) ? { line: d.line } : {}),
    problem: clip(String(d.problem), PROBLEM_MAX),
  }));
}

/** state/T.exec: the public file of a task the run still drives; deleted once it left (integrated, blocked, conflict, stopped). */
function execOf(i: DocInput): ExecWrite | null {
  const t = i.execTask, e = i.execution;
  if (!t || !e) return null;
  const status = liveOf(i)?.status ?? t.status;
  if (t.status === 'integrated' || status === 'blocked' || status === 'conflict' || status === 'stopped') return { __delete__: true };
  const p = i.publicTask;
  if (!p || p.runId !== e.runId) return null;
  return { runId: p.runId, mode: p.mode, by: p.by, agent: p.agent, stage: p.stage, round: p.round, since: p.since, leaseUntil: p.leaseUntil };
}

/** The evidence of the brief in progress: every check of its verifications (the newest 30), the last round's totals. */
function evidenceOf(i: DocInput, brief: number): EvidenceV2 | null {
  const rounds = i.verifies.filter(v => v.brief === brief).sort((a, b) => a.n - b.n);
  const last = rounds.at(-1);
  if (!last) return null;
  const assetFor = (file: string) => i.assets.find(a => samePath(a.path, file));
  let missing = false;
  const shots: ShotV2[] = rounds.flatMap(r => r.file.checks.map(c => {
    const s: ShotV2 = { surface: clip(c.surface, 80), check: clip(c.name || `#${c.id}`, 200), ok: c.ok, round: r.n };
    if (c.expected.trim()) s.expected = clip(c.expected, 200);
    if (c.observed.trim()) s.observed = clip(c.observed, 200);
    if (c.shot) {
      const a = assetFor(r.shotPath(c.shot));
      if (a) { s.url = a.url; s.id = a.id; } else if (r === last) missing = true;
    }
    return s;
  })).slice(-SHOTS_MAX);
  const f = last.file;
  const ev: EvidenceV2 = { v: 2, surfaces: f.surfaces.slice(0, 10), result: f.result, passed: f.checks.filter(c => c.ok).length, total: f.checks.length, local: last.local, shots };
  if (f.reason) ev.reason = clip(f.reason, 200);
  if (f.unchecked.length) ev.unchecked = f.unchecked.slice(0, UNCHECKED_MAX).map(u => clip(u, 200));
  if (i.evidenceMode === 'upload' && missing) ev.pending = true;
  return ev;
}

/**
 * C1: a task the current execution holds counts only the events since that execution started (as 2c does for reviews):
 * a new run of the same plan task restarts it in the same work folder, and an earlier run's rounds, accepted round,
 * over-cap flag and deferred findings are not this run's. The status is derived again from those events for the same
 * reason (its verdict, reviews and stages). Without a holding execution every event of the task counts.
 */
function ownRun(i: DocInput): DocInput {
  if (!i.execution || !i.execTask) return i;
  const events = eventsSince(i.events, i.execution.startedAt);
  const key = statusKey(i.task, i.execution.kind === 'plan' ? i.execution.project : null);
  const own = key ? events.reduce<StatusMap>((m, e) => deriveStatuses(m, e).map, {})[key] ?? null : null;
  return { ...i, events, status: own };
}

/** C7: the forge block v2, the evidence and the exec of one task. */
export function buildRoadmapData(input: DocInput): RoadmapData {
  const i = ownRun(input);
  const all = roundsOf(i);
  const s = i.status;
  const brief = s?.brief ?? all.at(-1)?.brief ?? 1;
  // round and cap: reviews {n, max} of the last verdict or round event that says it (wave 1), never their own counters.
  const counted = i.events.filter(e => (e.kind === 'verdict' || e.kind === 'round') && reviewsOf(e.reviews)).at(-1);
  const reviews = counted ? reviewsOf(counted.reviews) : s?.reviews ?? null;
  const acceptedRound = all.filter(r => r.action === 'accept').at(-1)?.n ?? null;
  const overCap = !!reviews && (reviews.n > reviews.max || all.filter(r => r.brief === brief).length > reviews.max);
  const stage = stageOf(i);
  const agent = i.execTask?.agent ?? liveOf(i)?.agent ?? s?.agent ?? null;
  const verdict = s?.verdict && isAction(s.verdict.action) ? { action: s.verdict.action as DocAction, score: s.verdict.score } : null;
  const forge: ForgeDocV2 = {
    v: 2, path: pathOf(i), phase: stage, ...(agent ? { agent: clip(agent, 80) } : {}), validators: validatorsOf(i.events),
    ...(verdict ? { verdict } : {}), ...(reviews ? { round: reviews.n, cap: reviews.max } : {}),
    brief, stage, rounds: all.slice(-ROUNDS_MAX), verify: verifyOf(s), stages: stagesOf(s), integration: i.integration,
    deferred: deferredOf(i), acceptedRound, overCap, updatedAt: i.now.toISOString(),
  };
  return { forge, evidence: evidenceOf(i, brief), exec: execOf(i) };
}
