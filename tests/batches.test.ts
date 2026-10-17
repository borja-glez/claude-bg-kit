import { describe, it, expect } from 'vitest';
import { blockBatch, claimBatch, cleanText, doneBatch, freeBatch, heartbeatBatch, registerBatch, REASON_MAX } from '../src/lib/batches.js';
import { eventIds } from '../src/lib/ids.js';

const NOW = new Date('2026-10-15T12:00:00.000Z');
const T = '2026-10-15T12:00:00.000Z';
const LEASE = '2026-10-15T12:10:00.000Z';
const D = { __delete__: true };

describe('task batches (A-14)', () => {
  it('eventIds: distinct ids of one instant, in order, with the SID', () => {
    expect(eventIds(NOW, 'main', 2, () => 0)).toEqual(['20261015T120000000Z-main-0000', '20261015T120000001Z-main-0000']);
  });
  it('claim: the task in progress, its started event and the session with its lease', () => {
    expect(claimBatch({ sid: 'main', task: 'T019', stateVersion: 7, sessionVersion: 3, now: NOW, eids: ['e1'] })).toEqual({
      now: T, eid: 'e1', eids: ['e1'], leaseUntil: LEASE, batch: [
        { op: 'update', collection: 'state', doc_id: 'T019', data: { status: 'in_progress', owner: 'main', claimedAt: T, startedAt: T, zonesTouched: [] }, if_version: 7 },
        { op: 'set', collection: 'events', doc_id: 'e1', data: { ts: T, type: 'started', sessionId: 'main', taskId: 'T019' } },
        { op: 'update', collection: 'sessions', doc_id: 'main', data: { currentTask: 'T019', heartbeatAt: T, leaseUntil: LEASE, status: 'active' }, if_version: 3 },
      ],
    });
  });
  it('claim --unblock drops blockedBy and blockedReason and writes unblocked first, with the first id; --recovered-from keeps zonesTouched and says from whom', () => {
    const u = claimBatch({ sid: 'main', task: 'T019', stateVersion: 7, sessionVersion: 3, now: NOW, eids: ['e1', 'e2'], unblock: true });
    expect(u.eids).toEqual(['e1', 'e2']);
    expect(u.batch[0].data).toMatchObject({ blockedBy: D, blockedReason: D });
    expect(u.batch.map(w => `${w.collection}/${w.doc_id}`)).toEqual(['state/T019', 'events/e1', 'events/e2', 'sessions/main']);
    expect(u.batch[1].data).toMatchObject({ type: 'unblocked', taskId: 'T019' });
    expect(u.batch[2].data).toMatchObject({ type: 'started', taskId: 'T019' });
    const r = claimBatch({ sid: 'main', task: 'T019', stateVersion: 7, sessionVersion: 3, now: NOW, eids: ['e1'], recoveredFrom: 'ui' });
    expect(r.batch[0].data).toEqual({ status: 'in_progress', owner: 'main', claimedAt: T, startedAt: T, recoveredFrom: 'ui' });
    expect(r.batch[1].data).toMatchObject({ type: 'started', text: 'recovered from ui' });
  });
  it('done: the task with its commit and summary, the done event and the session without a task; meta/metrics apart, never pinned (A-10)', () => {
    const commit = { sha: 'abc1234', ts: '2026-10-15T11:59:00.000Z', title: 'T019: login', add: 12, del: 3 };
    const r = doneBatch({ sid: 'main', task: 'T019', stateVersion: 8, sessionVersion: 4, now: NOW, eids: ['e1'], commit, summary: 'Login\nworks.', tests: 41 });
    expect(r.batch).toEqual([
      { op: 'update', collection: 'state', doc_id: 'T019', data: { status: 'done', doneAt: T, commits: [commit], summary: 'Login works.' }, if_version: 8 },
      { op: 'set', collection: 'events', doc_id: 'e1', data: { ts: T, type: 'done', sessionId: 'main', taskId: 'T019', text: 'T019: login', add: 12, del: 3, sha: 'abc1234' } },
      { op: 'update', collection: 'sessions', doc_id: 'main', data: { currentTask: D, heartbeatAt: T, leaseUntil: LEASE }, if_version: 4 },
    ]);
    expect(r.metrics).toEqual({ op: 'update', collection: 'meta', doc_id: 'metrics', data: { lastCommit: { sha: 'abc1234', ts: '2026-10-15T11:59:00.000Z' }, tests: 41, updatedAt: T } });
    const noTests = doneBatch({ sid: 'main', task: 'T019', stateVersion: 8, sessionVersion: 4, now: NOW, eids: ['e1'], commit, summary: 'x' });
    expect(noTests.metrics.data).toEqual({ lastCommit: { sha: 'abc1234', ts: '2026-10-15T11:59:00.000Z' }, updatedAt: T });
  });
  it('done: the event text is the commit title cleaned, without control or bidi characters', () => {
    const title = `T019:${String.fromCharCode(9)}log${String.fromCharCode(0x202e)}in${String.fromCharCode(7)}`;
    const commit = { sha: 'abc1234', ts: '2026-10-15T11:59:00.000Z', title, add: 1, del: 0 };
    const r = doneBatch({ sid: 'main', task: 'T019', stateVersion: 8, sessionVersion: 4, now: NOW, eids: ['e1'], commit, summary: 'x' });
    expect(r.batch[1].data).toMatchObject({ type: 'done', text: 'T019: login' });
  });
  it('block: the reason, cleaned, in the event and in state/T.blockedReason', () => {
    const bidi = String.fromCharCode(0x202e);
    const r = blockBatch({ sid: 'main', task: 'T019', stateVersion: 7, sessionVersion: 3, now: NOW, eids: ['e1'], by: ['T002', 'external'], reason: `waits\nfor ${bidi}the API${'.'.repeat(400)}` });
    const reason = r.batch[0].data!.blockedReason as string;
    expect(reason.startsWith('waits for the API')).toBe(true);
    expect(reason).toHaveLength(REASON_MAX);
    expect(r.batch[0]).toMatchObject({ data: { status: 'blocked', blockedBy: ['T002', 'external'] }, if_version: 7 });
    expect(r.batch[1].data).toMatchObject({ type: 'blocked', taskId: 'T019', text: reason });
    expect(r.batch[2].data).toEqual({ currentTask: D, heartbeatAt: T, leaseUntil: LEASE });
  });
  it('heartbeat: a 10-minute lease; a busy step up to its end, at least 10 and at most 90 minutes; idle ends it now', () => {
    const lease = (o: { busyUntil?: Date | null; idle?: boolean }) => heartbeatBatch({ sid: 'main', sessionVersion: 5, now: NOW, ...o });
    expect(lease({})).toEqual({ now: T, eid: null, eids: [], leaseUntil: LEASE, batch: [
      { op: 'update', collection: 'sessions', doc_id: 'main', data: { heartbeatAt: T, leaseUntil: LEASE, status: 'active' }, if_version: 5 },
    ] });
    expect(lease({ busyUntil: new Date('2026-10-15T13:00:00.000Z') }).leaseUntil).toBe('2026-10-15T13:00:00.000Z');
    expect(lease({ busyUntil: new Date('2026-10-15T15:00:00.000Z') }).leaseUntil).toBe('2026-10-15T13:30:00.000Z');
    expect(lease({ busyUntil: new Date('2026-10-15T12:05:00.000Z') }).leaseUntil).toBe(LEASE);
    expect(lease({ idle: true }).batch[0].data).toEqual({ heartbeatAt: T, leaseUntil: T, status: 'idle' });
  });
  it('register: set without a version, update with one, and the Claude id when known', () => {
    const base = { sid: 'main', now: NOW, name: 'main', agent: 'work-6b', branch: 'main', worktree: '/repo', track: null };
    expect(registerBatch({ ...base, claude: 'c-1', sessionVersion: null }).batch).toEqual([
      { op: 'set', collection: 'sessions', doc_id: 'main', data: { name: 'main', track: null, agentName: 'work-6b', branch: 'main', worktree: '/repo', claude: 'c-1', heartbeatAt: T, leaseUntil: LEASE, status: 'active' } },
    ]);
    const u = registerBatch({ ...base, claude: null, sessionVersion: 6 }).batch[0];
    expect(u).toMatchObject({ op: 'update', if_version: 6 });
    expect(u.data).not.toHaveProperty('claude');
  });
  it('free: the task free again, and the seat idle when its version is given', () => {
    expect(freeBatch({ sid: 'main', task: 'T019', stateVersion: 4, sessionVersion: 9 })).toEqual([
      { op: 'update', collection: 'state', doc_id: 'T019', data: { status: 'free', owner: D, claimedAt: D, startedAt: D }, if_version: 4 },
      { op: 'update', collection: 'sessions', doc_id: 'main', data: { currentTask: D, status: 'idle' }, if_version: 9 },
    ]);
    expect(freeBatch({ sid: 'main', task: 'T019', stateVersion: 4, sessionVersion: null })).toHaveLength(1);
  });
  it('cleanText: one line, no control nor bidi characters, at most max', () => {
    const rlo = String.fromCharCode(0x202e);
    expect(cleanText(`  a\tb\r\nc${rlo}d ${String.fromCharCode(7)} `, 10)).toBe('a b cd');
    expect(cleanText('x'.repeat(20), 5)).toBe('xxxxx');
  });
});
