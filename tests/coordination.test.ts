import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parsePlan } from '../src/lib/plan.js';
import { conflictsFor, escalationCandidates, inboxFor, isIdle, leaseOf, liveness, pickTask, recoverableTasks, sessionLiveness, threadKey, LEASE_MINUTES, SILENT_MINUTES } from '../src/lib/coordination.js';
import type { MessageDoc, SessionDoc, States } from '../src/lib/types.js';

const base = parsePlan(readFileSync(new URL('./fixtures/plan.yaml', import.meta.url), 'utf8'));
// T007 (ui) touches the same zone as T001 (backend) → overlap
const plan = {
  ...base,
  tasks: [...base.tasks, { id: 'T007', title: 'Panel de pedidos', track: 'ui', phase: 'F1', done_when: 'x', depends_on: [], zones: ['src/db/views/**'] }],
};
const NOW = Date.parse('2026-10-11T12:00:00Z');
const MIN = 60000;

describe('conflictsFor', () => {
  it('reports active tasks of other sessions with overlapping zones', () => {
    const s: States = { T001: { status: 'in_progress', owner: 'be' } };
    expect(conflictsFor(plan, s, 'T007', 'ui')).toEqual([{ taskId: 'T001', owner: 'be', zones: [['src/db/views/**', 'src/db/**']] }]);
    expect(conflictsFor(plan, s, 'T003', 'ui')).toEqual([]);
    expect(conflictsFor(plan, s, 'T007', 'be')).toEqual([]); // own tasks never conflict
  });
  it('includes zonesTouched beyond the planned zones', () => {
    const s: States = { T003: { status: 'in_progress', owner: 'ui', zonesTouched: ['src/db/seed.ts'] } };
    expect(conflictsFor(plan, s, 'T001', 'be')[0]).toMatchObject({ taskId: 'T003', owner: 'ui' });
  });
});

describe('pickTask', () => {
  it('prefers a non-conflicting task', () => {
    const s: States = { T001: { status: 'in_progress', owner: 'be' } };
    const r = pickTask(plan, s, { sessionId: 'ui', track: 'ui' });
    expect(r.task?.id).toBe('T003');
    expect(r.conflicts).toEqual([]);
  });
  it('falls back to the first available task and reports its conflicts', () => {
    const s: States = { T001: { status: 'in_progress', owner: 'be' }, T003: { status: 'done' } };
    const r = pickTask(plan, s, { sessionId: 'ui', track: 'ui' });
    expect(r.task?.id).toBe('T007');
    expect(r.conflicts[0].taskId).toBe('T001');
  });
  it('resumes only tasks this session owns and flags unblock', () => {
    const s: States = { T001: { status: 'in_progress', owner: 'other' } };
    expect(pickTask(plan, s, { sessionId: 'be', track: 'backend' }).task).toBeNull();
    const b: States = { T001: { status: 'done' }, T002: { status: 'blocked', blockedBy: ['T001'] } };
    expect(pickTask(plan, b, { sessionId: 'be', track: 'backend' })).toMatchObject({ task: { id: 'T002' }, unblock: true });
  });
});

describe('isIdle / recoverableTasks', () => {
  const sessions: Record<string, SessionDoc> = {
    be: { name: 'be', heartbeatAt: new Date(NOW - 20 * MIN).toISOString(), status: 'active' },
    ui: { name: 'ui', heartbeatAt: new Date(NOW - 2 * MIN).toISOString(), status: 'active' },
  };
  it('detects idle sessions by status, stale heartbeat or absence', () => {
    expect(isIdle(sessions.be, NOW)).toBe(true);
    expect(isIdle(sessions.ui, NOW)).toBe(false);
    expect(isIdle({ ...sessions.ui, status: 'idle' }, NOW)).toBe(true);
    expect(isIdle(undefined, NOW)).toBe(true);
    expect(isIdle({ ...sessions.ui, heartbeatAt: 'garbage' }, NOW)).toBe(true);
  });
  it('a busyUntil lease keeps a stale-heartbeat session non-idle until it expires', () => {
    const hb = NOW - 40 * MIN;
    const leased = (until: number): SessionDoc => ({ ...sessions.be, heartbeatAt: new Date(hb).toISOString(), busyUntil: new Date(until).toISOString() });
    expect(isIdle(leased(hb + 60 * MIN), NOW)).toBe(false);
    // A-05: a lease that ended reads silent for 5 minutes, as every lease does, then stopped.
    expect(isIdle(leased(NOW - MIN), NOW)).toBe(false);
    expect(isIdle(leased(NOW - 6 * MIN), NOW)).toBe(true);
    expect(isIdle(leased(hb + 120 * MIN), NOW)).toBe(true);
    expect(isIdle(leased(hb + 90 * MIN), NOW)).toBe(false);
    expect(isIdle({ ...leased(hb + 60 * MIN), status: 'idle' }, NOW)).toBe(true);
    expect(isIdle({ ...sessions.be, busyUntil: 'garbage' }, NOW)).toBe(true);
    const s: States = { T001: { status: 'in_progress', owner: 'be' } };
    expect(recoverableTasks(plan, s, { be: leased(hb + 60 * MIN) }, NOW)).toEqual([]);
  });
  it('lists active tasks owned by idle or unknown sessions', () => {
    const s: States = {
      T001: { status: 'in_progress', owner: 'be' },
      T003: { status: 'in_progress', owner: 'ui' },
      T002: { status: 'claimed', owner: 'ghost' },
      T004: { status: 'done', owner: 'be' },
    };
    expect(recoverableTasks(plan, s, sessions, NOW)).toEqual([{ taskId: 'T001', owner: 'be' }, { taskId: 'T002', owner: 'ghost' }]);
  });
});

describe('messages', () => {
  const m = (over: Partial<MessageDoc>): MessageDoc => ({ ts: '2026-10-11T10:00:00Z', from: 'ui', to: 'be', type: 'overlap_warning', taskId: 'T007', text: 'x', status: 'open', ...over });
  it('inbox shows open messages to me or to everyone, never my own, oldest first', () => {
    const msgs = {
      a: m({ ts: '2026-10-11T10:02:00Z' }),
      b: m({ ts: '2026-10-11T10:01:00Z', to: '*' }),
      c: m({ status: 'resolved' }),
      d: m({ from: 'be', to: '*' }),
      e: m({ to: 'data' }),
    };
    expect(inboxFor(msgs, 'be').map(x => x.id)).toEqual(['b', 'a']);
  });
  it('thread keys ignore direction', () => {
    expect(threadKey(m({}))).toBe(threadKey(m({ from: 'be', to: 'ui' })));
  });
  it('escalates threads with 4+ open messages and no escalation yet', () => {
    const four = { a: m({}), b: m({ from: 'be', to: 'ui', type: 'reply' }), c: m({}), d: m({ from: 'be', to: 'ui', type: 'reply' }) };
    expect(escalationCandidates(four)).toEqual([{ key: threadKey(m({})), taskId: 'T007', sessions: ['be', 'ui'], count: 4 }]);
    expect(escalationCandidates({ ...four, e: m({ type: 'escalation' }) })).toEqual([]);
    expect(escalationCandidates({ a: m({}), b: m({}), c: m({}) })).toEqual([]);
    expect(escalationCandidates({ a: m({ to: '*' }), b: m({ to: '*' }), c: m({ to: '*' }), d: m({ to: '*' }) })).toEqual([]);
  });
});

describe('untrusted shared data (fix round)', () => {
  const m = (over: Partial<MessageDoc>): MessageDoc => ({ ts: '2026-10-11T10:00:00Z', from: 'ui', to: 'be', type: 'overlap_warning', taskId: 'T007', text: 'x', status: 'open', ...over });
  it('zonesOf ignores non-string zonesTouched entries', () => {
    const s: States = { T003: { status: 'in_progress', owner: 'ui', zonesTouched: [1, null, 'src/db/x.ts'] as unknown as string[] } };
    expect(() => conflictsFor(plan, s, 'T001', 'be')).not.toThrow();
    expect(conflictsFor(plan, s, 'T001', 'be')[0]).toMatchObject({ taskId: 'T003', owner: 'ui' });
  });
  it('inbox tolerates missing or non-string ts and keeps the real key as id', () => {
    const msgs = {
      a: { ...m({}), ts: undefined as unknown as string },
      b: { ...m({ ts: '2026-10-11T10:00:00Z' }), ts: 5 as unknown as string },
      c: { ...m({ ts: '2026-10-11T11:00:00Z' }), id: 'evil' } as MessageDoc,
    };
    expect(() => inboxFor(msgs, 'be')).not.toThrow();
    expect(inboxFor(msgs, 'be').map(x => x.id).sort()).toEqual(['a', 'b', 'c']);
  });
  it('thread keys and escalation tolerate non-string from/to', () => {
    const bad = { ...m({}), from: 5 as unknown as string };
    expect(() => threadKey(bad)).not.toThrow();
    const four = { a: bad, b: bad, c: bad, d: bad };
    expect(() => escalationCandidates(four)).not.toThrow();
  });
});

describe('pickTask ownership (fix round)', () => {
  it('never returns a task owned by another session', () => {
    const s: States = { T001: { status: 'done' }, T002: { status: 'blocked', blockedBy: ['T001'], owner: 'other' } };
    expect(pickTask(plan, s, { sessionId: 'be', track: 'backend' }).task).toBeNull();
  });
});

describe('idle conflict owners (final fix)', () => {
  const sessions: Record<string, SessionDoc> = {
    be: { name: 'be', heartbeatAt: new Date(NOW - 20 * MIN).toISOString(), status: 'active' },
    live: { name: 'live', heartbeatAt: new Date(NOW - 2 * MIN).toISOString(), status: 'active' },
  };
  it('conflictsFor flags ownerIdle only when sessions are given', () => {
    const s: States = { T001: { status: 'in_progress', owner: 'be' } };
    expect(conflictsFor(plan, s, 'T007', 'ui')[0]).not.toHaveProperty('ownerIdle');
    expect(conflictsFor(plan, s, 'T007', 'ui', sessions, NOW)[0]).toMatchObject({ taskId: 'T001', owner: 'be', ownerIdle: true });
    const live: States = { T001: { status: 'in_progress', owner: 'live' } };
    expect(conflictsFor(plan, live, 'T007', 'ui', sessions, NOW)[0]).toMatchObject({ ownerIdle: false });
  });
  it('pickTask does not avoid tasks whose only conflicts have idle owners, but reports them', () => {
    const s: States = { T001: { status: 'in_progress', owner: 'be' }, T003: { status: 'claimed', owner: 'x' } };
    const p = { ...plan, tasks: [...plan.tasks, { id: 'T008', title: 'Otra', track: 'ui', phase: 'F1', done_when: 'x', depends_on: [], zones: ['web/other/**'] }] };
    const withIdle = pickTask(p, s, { sessionId: 'ui', track: 'ui', sessions, now: NOW });
    expect(withIdle.task?.id).toBe('T007');
    expect(withIdle.conflicts).toEqual([expect.objectContaining({ taskId: 'T001', owner: 'be', ownerIdle: true })]);
    const live: States = { ...s, T001: { status: 'in_progress', owner: 'live' } };
    expect(pickTask(p, live, { sessionId: 'ui', track: 'ui', sessions, now: NOW }).task?.id).toBe('T008');
  });
});

describe('delegates never escalate (residual fix)', () => {
  const m = (over: Partial<MessageDoc>): MessageDoc => ({ ts: '2026-10-11T10:00:00Z', from: 'ui', to: 'be', type: 'delegate', taskId: 'T007', text: 'x', status: 'open', ...over });
  it('ignores delegate messages when counting a thread', () => {
    expect(escalationCandidates({ a: m({}), b: m({}), c: m({}), d: m({}) })).toEqual([]);
  });
});

describe('pickTask with integrated commits (swarm members)', () => {
  // T005 (ui) depends on T003 (ui) and T004 (backend).
  const states: States = {
    T001: { status: 'done' }, T002: { status: 'done' }, T003: { status: 'done', commits: [{ sha: 'u3', ts: '', title: '', add: 0, del: 0 }] },
    T004: { status: 'done', commits: [{ sha: 'b4', ts: '', title: '', add: 0, del: 0 }, { sha: 'b4b', ts: '', title: '', add: 0, del: 0 }] },
  };
  it('skips a task whose dependency in another track is not integrated, and says which one it waits for (A-09)', () => {
    expect(pickTask(base, states, { sessionId: 'ui', track: 'ui', integrated: new Set(['b4']) }))
      .toMatchObject({ task: null, waiting_on: [{ taskId: 'T005', dependsOn: 'T004' }] });
    const ok = pickTask(base, states, { sessionId: 'ui', track: 'ui', integrated: new Set(['b4', 'b4b']) });
    expect(ok.task?.id).toBe('T005');
    expect(ok).not.toHaveProperty('waiting_on');
    expect(pickTask(base, states, { sessionId: 'ui', track: 'ui' })).not.toHaveProperty('waiting_on');
  });
  it('ignores dependencies in the same track and done tasks without commits', () => {
    const s: States = { ...states, T004: { status: 'done' } };
    expect(pickTask(base, s, { sessionId: 'ui', track: 'ui', integrated: new Set() }).task?.id).toBe('T005');
  });
  it('without integrated nothing changes', () => {
    expect(pickTask(base, states, { sessionId: 'ui', track: 'ui' }).task?.id).toBe('T005');
  });
});

describe('liveness', () => {
  const t0 = Date.parse('2026-10-12T12:00:00.000Z');
  const at = (min: number) => new Date(t0 + min * 60000).toISOString();
  it('is alive before the lease ends, silent for 5 minutes after, then stopped', () => {
    expect(LEASE_MINUTES).toBe(10);
    expect(SILENT_MINUTES).toBe(5);
    expect(liveness(t0, at(1))).toBe('alive');
    expect(liveness(t0, at(0))).toBe('silent');
    expect(liveness(t0, at(-4.9))).toBe('silent');
    expect(liveness(t0, at(-5))).toBe('stopped');
    expect(liveness(t0, null)).toBe('stopped');
    expect(liveness(t0, 'nonsense')).toBe('stopped');
  });
  it('reads a session by its lease, and falls back to the heartbeat window without one', () => {
    const base = { name: 'x', status: 'active' as const };
    expect(sessionLiveness({ ...base, heartbeatAt: at(-60), leaseUntil: at(3) }, t0)).toBe('alive');
    expect(sessionLiveness({ ...base, heartbeatAt: at(-1), leaseUntil: at(-7) }, t0)).toBe('alive');
    // Without leaseUntil: the old rule (15 min of heartbeat, busyUntil within its cap).
    expect(sessionLiveness({ ...base, heartbeatAt: at(-9) }, t0)).toBe('alive');
    expect(sessionLiveness({ ...base, heartbeatAt: at(-14) }, t0)).toBe('silent');
    expect(sessionLiveness({ ...base, heartbeatAt: at(-16) }, t0)).toBe('stopped');
    expect(sessionLiveness({ ...base, heartbeatAt: at(-1), status: 'idle' }, t0)).toBe('stopped');
    expect(sessionLiveness(undefined, t0)).toBe('stopped');
  });
  it('isIdle is true only when a leased session is stopped, so a silent owner keeps its task', () => {
    const base = { name: 'x', status: 'active' as const, heartbeatAt: at(-30) };
    expect(isIdle({ ...base, leaseUntil: at(-2) }, t0)).toBe(false);
    expect(isIdle({ ...base, leaseUntil: at(-6) }, t0)).toBe(true);
  });
  it('A-05: one life: an old leaseUntil no longer hides a fresh heartbeat, and a document without a lease stops 15 minutes after it', () => {
    const base = { name: 'x', status: 'active' as const };
    const fresh = { ...base, heartbeatAt: at(-1), leaseUntil: at(-120) };
    expect(leaseOf(fresh)).toBe(t0 + 9 * 60000);
    expect(isIdle(fresh, t0)).toBe(false);
    expect(sessionLiveness(fresh, t0)).toBe('alive');
    const states: States = { T001: { status: 'in_progress', owner: 'be' } };
    expect(recoverableTasks(plan, states, { be: fresh }, t0)).toEqual([]);
    expect(isIdle({ ...base, heartbeatAt: at(-16) }, t0)).toBe(true);
    expect(isIdle({ ...base, heartbeatAt: at(-14) }, t0)).toBe(false);
    expect(isIdle({ ...base, heartbeatAt: at(-100) }, t0, 120)).toBe(false);
    expect(leaseOf(undefined)).toBeNull();
    expect(leaseOf({ ...base, heartbeatAt: 'nope' })).toBeNull();
    expect(liveness(t0, t0 + 60000)).toBe('alive');
  });
});
