// C-03: a command run with --out in the background (prep, review-prep, validate, swarm integrate, swarm step) is a job,
// .forge/jobs/<name>.json in the main checkout while it runs. The forge Stop hook does not block while its session has
// one alive (the job's end wakes the session), lens shows them (wave 3), and at most swarm.validateJobs of them run
// their validators at once (the slots).
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isSafeId } from '../lib/execution-state.js';
import { pidAlive } from './pid.js';

export interface JobDoc {
  name: string; cmd: string; task: string | null; pid: number; startedAt: string; out: string;
  /** C1: Claude's id of the session that ran it; null without one. */
  session: string | null;
  /** While it waits for a validation slot or holds one; absent otherwise. */
  slot?: 'waiting' | 'validating';
}
export type Slot = <T>(fn: () => T) => T;
export const noSlot: Slot = fn => fn();
/** A job this old is a leftover, whatever its pid says. */
export const JOB_MAX_AGE_MS = 2 * 3600_000;
export const SLOT_POLL_MS = 1000;
/** A job never waits longer than this for a slot: then it validates anyway. */
export const SLOT_MAX_WAIT_MS = 30 * 60_000;
const MAX_JOB_FILES = 200;
const NAME = /^[A-Za-z0-9_.-]{1,120}$/;

export const jobsDir = (main: string) => path.join(main, '.forge', 'jobs');

/** Writes a JSON file through a temporary file and a rename, so a reader never sees half of it. */
export function writeJsonAtomic(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try { writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n'); renameSync(tmp, file); } finally { rmSync(tmp, { force: true }); }
}

export function normalizeJob(x: unknown): JobDoc | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  if (typeof o.name !== 'string' || !NAME.test(o.name) || o.name === '.' || o.name === '..') return null;
  if (typeof o.cmd !== 'string' || !o.cmd || o.cmd.length > 40) return null;
  if (typeof o.pid !== 'number' || !Number.isInteger(o.pid) || o.pid <= 0) return null;
  if (typeof o.startedAt !== 'string' || !Number.isFinite(Date.parse(o.startedAt)) || typeof o.out !== 'string') return null;
  return {
    name: o.name, cmd: o.cmd, task: typeof o.task === 'string' && o.task ? o.task.slice(0, 120) : null, pid: o.pid,
    startedAt: o.startedAt, out: o.out.slice(0, 500), session: isSafeId(o.session) ? o.session : null,
    ...(o.slot === 'waiting' || o.slot === 'validating' ? { slot: o.slot } : {}),
  };
}

/** One file per process and command: `<cmd>-<task, or run>-<pid>`. */
export const jobName = (cmd: string, task: string | null, pid: number) =>
  `${cmd}-${(task ?? 'run').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 60)}-${pid}`;

function writeJob(main: string, job: JobDoc): string {
  const file = path.join(jobsDir(main), `${job.name}.json`);
  writeJsonAtomic(file, job);
  return file;
}

/** The jobs alive now. A dead pid or a job older than JOB_MAX_AGE_MS is a leftover: its file goes. An unreadable file is skipped. */
export function liveJobs(main: string, now: Date, alive: (pid: number) => boolean = pidAlive): JobDoc[] {
  let names: string[] = [];
  try { names = readdirSync(jobsDir(main)).filter(f => f.endsWith('.json')).slice(0, MAX_JOB_FILES); } catch { return []; }
  const out: JobDoc[] = [];
  for (const f of names) {
    const file = path.join(jobsDir(main), f);
    let job: JobDoc | null = null;
    try { job = normalizeJob(JSON.parse(readFileSync(file, 'utf8'))); } catch { job = null; }
    if (!job) continue;
    if (!alive(job.pid) || now.getTime() - Date.parse(job.startedAt) > JOB_MAX_AGE_MS) {
      try { rmSync(file, { force: true }); } catch { /* the next reader tries again */ }
      continue;
    }
    out.push(job);
  }
  return out;
}

/** Runs `fn` as a job: its file is written first and removed in a finally. A file that cannot be written only costs a
 *  Stop-hook block (the session is stepped again). */
export function withJob<T>(main: string, spec: { cmd: string; task: string | null; out: string; session: string | null; startedAt: string }, fn: (job: JobDoc) => T): T {
  const job: JobDoc = { name: jobName(spec.cmd, spec.task, process.pid), cmd: spec.cmd, task: spec.task, pid: process.pid, startedAt: spec.startedAt, out: spec.out, session: spec.session };
  let file: string | null = null;
  try { file = writeJob(main, job); } catch { file = null; }
  try { return fn(job); } finally { if (file) rmSync(file, { force: true }); }
}

/** The order jobs queue for a slot: who started first, then the name. */
const before = (a: JobDoc, b: JobDoc) => a.startedAt < b.startedAt || (a.startedAt === b.startedAt && a.name < b.name);

/**
 * The validation slot of `job` (C-03): before its validators run it waits while `max` other live jobs hold a slot or
 * queue ahead of it, polling every SLOT_POLL_MS (at most SLOT_MAX_WAIT_MS: then it goes on). `waited()` is the time it
 * waited, in ms. Without its job file (it could not be written) it never waits.
 */
export function slotFor(main: string, job: JobDoc, max: number, deps: { now: () => Date; sleep: (ms: number) => void; alive?: (pid: number) => boolean }): { slot: Slot; waited: () => number } {
  let waited = 0;
  const slot: Slot = fn => {
    try { writeJob(main, { ...job, slot: 'waiting' }); } catch { return fn(); }
    for (let polls = 0; polls * SLOT_POLL_MS < SLOT_MAX_WAIT_MS; polls++) {
      const ahead = liveJobs(main, deps.now(), deps.alive).filter(j => j.name !== job.name && (j.slot === 'validating' || (j.slot === 'waiting' && before(j, job))));
      if (ahead.length < max) break;
      deps.sleep(SLOT_POLL_MS);
      waited += SLOT_POLL_MS;
    }
    try { writeJob(main, { ...job, slot: 'validating' }); } catch { /* it validates all the same */ }
    try { return fn(); } finally { try { writeJob(main, job); } catch { /* the job file goes with the job */ } }
  };
  return { slot, waited: () => waited };
}
