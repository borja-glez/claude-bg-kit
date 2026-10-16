// A-14: the roadmap writes of a task's life, built by the CLI instead of by the work skill. `waypoint claim`, `done`,
// `block`, `heartbeat` and `release --free` print {now, eid, eids, leaseUntil, batch} and the skill hands `batch` to
// ArtifactData `batch` as it is. Pure: src/cli/run.ts reads the flags, the clock, git and the files.
import { LEASE_CAP_MINUTES, LEASE_MINUTES } from './coordination.js';
import type { Write } from './sync.js';
import type { Commit } from './types.js';

export interface BatchOut { now: string; eid: string | null; eids: string[]; leaseUntil: string; batch: Write[] }
/** The longest block reason and task summary the roadmap gets. */
export const REASON_MAX = 300;
export const SUMMARY_MAX = 300;
const DEL = { __delete__: true } as const;
const MIN = 60_000;
const iso = (ms: number): string => new Date(ms).toISOString();
// Bidi controls reorder what a reader sees; they are built from their code points, so none is written in this file.
const BIDI = new RegExp(`[${[0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069].map(c => String.fromCharCode(c)).join('')}]`, 'g');
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

/** Free text for the roadmap (a block reason, a summary): one line, without control or bidi characters, at most `max`. */
export function cleanText(text: string, max: number): string {
  return text.replace(CONTROL, ' ').replace(BIDI, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

const event = (doc_id: string, data: Record<string, unknown>): Write => ({ op: 'set', collection: 'events', doc_id, data });

export interface ClaimInput {
  sid: string; task: string; stateVersion: number; sessionVersion: number; now: Date; eids: readonly string[];
  unblock?: boolean; recoveredFrom?: string | null;
}
/**
 * The task in progress, its `started` event (eids[0]; with `unblock`, the `unblocked` one is eids[1] and comes first)
 * and the session with its task and lease. A recovered task keeps its zonesTouched and says from whom.
 */
export function claimBatch(i: ClaimInput): BatchOut {
  const now = i.now.toISOString();
  const leaseUntil = iso(i.now.getTime() + LEASE_MINUTES * MIN);
  const data: Record<string, unknown> = { status: 'in_progress', owner: i.sid, claimedAt: now, startedAt: now };
  if (i.recoveredFrom) data.recoveredFrom = i.recoveredFrom; else data.zonesTouched = [];
  if (i.unblock) data.blockedBy = DEL;
  const eids = i.eids.slice(0, i.unblock ? 2 : 1);
  const base = { ts: now, sessionId: i.sid, taskId: i.task };
  return {
    now, eid: eids[0], eids, leaseUntil,
    batch: [
      { op: 'update', collection: 'state', doc_id: i.task, data, if_version: i.stateVersion },
      ...(i.unblock ? [event(eids[1], { ...base, type: 'unblocked' })] : []),
      event(eids[0], { ...base, type: 'started', ...(i.recoveredFrom ? { text: `recovered from ${i.recoveredFrom}` } : {}) }),
      { op: 'update', collection: 'sessions', doc_id: i.sid, data: { currentTask: i.task, heartbeatAt: now, leaseUntil, status: 'active' }, if_version: i.sessionVersion },
    ],
  };
}

export interface DoneInput {
  sid: string; task: string; stateVersion: number; sessionVersion: number; metaVersion: number; now: Date; eids: readonly string[];
  commit: Commit; summary: string; tests?: number;
}
/** The task done with its commit and summary, the `done` event, the session without a task, and meta/project's last
 *  commit (with `tests` when known: wave 4 moves the metrics out of this batch, A-10). */
export function doneBatch(i: DoneInput): BatchOut {
  const now = i.now.toISOString();
  const leaseUntil = iso(i.now.getTime() + LEASE_MINUTES * MIN);
  const eid = i.eids[0];
  const c = i.commit;
  return {
    now, eid, eids: [eid], leaseUntil,
    batch: [
      { op: 'update', collection: 'state', doc_id: i.task, data: { status: 'done', doneAt: now, commits: [c], summary: cleanText(i.summary, SUMMARY_MAX) }, if_version: i.stateVersion },
      event(eid, { ts: now, type: 'done', sessionId: i.sid, taskId: i.task, text: c.title, add: c.add, del: c.del, sha: c.sha }),
      { op: 'update', collection: 'sessions', doc_id: i.sid, data: { currentTask: DEL, heartbeatAt: now, leaseUntil }, if_version: i.sessionVersion },
      { op: 'update', collection: 'meta', doc_id: 'project', data: { metrics: { lastCommit: { sha: c.sha, ts: c.ts }, ...(i.tests !== undefined ? { tests: i.tests } : {}) } }, if_version: i.metaVersion },
    ],
  };
}

export interface BlockInput {
  sid: string; task: string; stateVersion: number; sessionVersion: number; now: Date; eids: readonly string[];
  by: readonly string[]; reason: string;
}
/** The task blocked with `blockedBy` and `blockedReason`, the `blocked` event with the same reason, and the session
 *  without a task. The reason is the one of --why-file, cleaned (cleanText, REASON_MAX). */
export function blockBatch(i: BlockInput): BatchOut {
  const now = i.now.toISOString();
  const leaseUntil = iso(i.now.getTime() + LEASE_MINUTES * MIN);
  const eid = i.eids[0];
  const reason = cleanText(i.reason, REASON_MAX);
  return {
    now, eid, eids: [eid], leaseUntil,
    batch: [
      { op: 'update', collection: 'state', doc_id: i.task, data: { status: 'blocked', blockedBy: [...i.by], blockedReason: reason }, if_version: i.stateVersion },
      event(eid, { ts: now, type: 'blocked', sessionId: i.sid, taskId: i.task, text: reason }),
      { op: 'update', collection: 'sessions', doc_id: i.sid, data: { currentTask: DEL, heartbeatAt: now, leaseUntil }, if_version: i.sessionVersion },
    ],
  };
}

export interface HeartbeatInput { sid: string; sessionVersion: number; now: Date; busyUntil?: Date | null; idle?: boolean }
/**
 * A-05: each heartbeat renews `leaseUntil`: 10 minutes; for a busy step, until its end, at least 10 and at most
 * LEASE_CAP_MINUTES; an idle session's lease ends now. `busyUntil` is no longer written.
 */
export function heartbeatBatch(i: HeartbeatInput): BatchOut {
  const t = i.now.getTime();
  const now = i.now.toISOString();
  const busy = i.busyUntil ? i.busyUntil.getTime() : NaN;
  const until = i.idle ? t : Number.isFinite(busy) ? Math.max(t + LEASE_MINUTES * MIN, Math.min(busy, t + LEASE_CAP_MINUTES * MIN)) : t + LEASE_MINUTES * MIN;
  const leaseUntil = iso(until);
  return {
    now, eid: null, eids: [], leaseUntil,
    batch: [{ op: 'update', collection: 'sessions', doc_id: i.sid, data: { heartbeatAt: now, leaseUntil, status: i.idle ? 'idle' : 'active' }, if_version: i.sessionVersion }],
  };
}

export interface RegisterInput {
  sid: string; now: Date; name: string; agent: string; branch: string; worktree: string; track: string | null;
  claude: string | null; sessionVersion: number | null;
}
/** The session's document: `set` when it has none yet (no version), else `update`, with its lease and Claude's id. */
export function registerBatch(i: RegisterInput): BatchOut {
  const now = i.now.toISOString();
  const leaseUntil = iso(i.now.getTime() + LEASE_MINUTES * MIN);
  const data = { name: i.name, track: i.track, agentName: i.agent, branch: i.branch, worktree: i.worktree, ...(i.claude ? { claude: i.claude } : {}), heartbeatAt: now, leaseUntil, status: 'active' };
  const write: Write = i.sessionVersion === null
    ? { op: 'set', collection: 'sessions', doc_id: i.sid, data }
    : { op: 'update', collection: 'sessions', doc_id: i.sid, data, if_version: i.sessionVersion };
  return { now, eid: null, eids: [], leaseUntil, batch: [write] };
}

export interface FreeInput { sid: string; task: string; stateVersion: number; sessionVersion: number | null }
/** [Release]: the task free again on the roadmap and, with its version, the seat's session idle without a task. */
export function freeBatch(i: FreeInput): Write[] {
  return [
    { op: 'update', collection: 'state', doc_id: i.task, data: { status: 'free', owner: DEL, claimedAt: DEL, startedAt: DEL }, if_version: i.stateVersion },
    ...(i.sessionVersion !== null ? [{ op: 'update' as const, collection: 'sessions', doc_id: i.sid, data: { currentTask: DEL, status: 'idle' }, if_version: i.sessionVersion }] : []),
  ];
}
