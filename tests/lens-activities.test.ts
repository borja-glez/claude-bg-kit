import { describe, it, expect } from 'vitest';
import { buildActivities, parseJob, runRoleOf, withSlotAgents, type ActivityInput } from '../src/lens/activities.js';
import { normalizeStatus, type ForgeStatus } from '../src/lib/forge-status.js';
import type { AgentLink } from '../src/lens/links.js';
import type { PanelModel } from '../src/lens/model.js';

const NOW = Date.parse('2026-10-16T12:00:00.000Z');
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const st = (task: string, over: Record<string, unknown> = {}): ForgeStatus => normalizeStatus({
  ts: ago(1), task, path: 'medium', phase: 'implement', agent: 'forge-impl', validators: [], verdict: null, round: null, cap: null,
  taskStartedAt: ago(10), stageSince: ago(1), stages: {}, doneAt: null, lastAt: ago(1), session: 'me', runId: null, project: null, ...over,
})!;
const OWNER = { role: 'owner' as const, coordinator: false, runId: null };
const COORDINATOR = { role: 'owner' as const, coordinator: true, runId: 'r1' };
const input = (over: Partial<ActivityInput> = {}): ActivityInput => ({
  statuses: [], links: [], execution: null, superpowers: null, todos: null, sessionId: 'me', ownTasks: [], viewer: OWNER, jobs: [],
  models: {}, liveTypes: [], turnSince: null, wakeAt: null, now: NOW, ...over,
});
const link = (id: string, task: string | null, over: Partial<AgentLink> = {}): AgentLink => ({
  id, type: 'forge:forge-impl', description: `work on ${task}`, since: NOW - 60_000, task, brief: 1, project: null, via: 'contract',
  parentId: null, workflow: null, status: 'running', tool: null, endedAt: null, ...over,
});
const keys = (i: ActivityInput) => buildActivities(i).activities.map(a => a.key);
const EXEC: NonNullable<PanelModel['execution']> = {
  runId: 'r1', mode: 'subagents', parallel: 3, branch: 'b', active: true, stopReason: null, stallReason: null, coordinator: { liveness: 'silent', lastSeen: null },
  integrated: 0, total: 3, manual: [], queued: [], conflicts: [], blocked: [], orphans: [],
  slots: [{ task: 'T1', title: null, stage: 'implement', agent: 'forge-impl', model: null, effort: null, round: 0, seconds: 60, liveness: 'silent', mode: 'subagents' }],
};

describe('buildActivities: who owns a task and how long it shows (E-06)', () => {
  it('own in progress shows for 24 h, another session one for 30 min, a done one for 15 min whoever owns it', () => {
    expect(keys(input({ statuses: [st('A', { lastAt: ago(23 * 60) })] }))).toEqual(['A']);
    expect(keys(input({ statuses: [st('A', { lastAt: ago(25 * 60) })] }))).toEqual([]);
    expect(keys(input({ statuses: [st('B', { session: 'other', lastAt: ago(29) })] }))).toEqual(['B']);
    expect(keys(input({ statuses: [st('B', { session: 'other', lastAt: ago(31) })] }))).toEqual([]);
    for (const session of ['me', 'other']) {
      expect(keys(input({ statuses: [st('C', { session, doneAt: ago(14), lastAt: ago(14) })] }))).toEqual(['C']);
      expect(keys(input({ statuses: [st('C', { session, doneAt: ago(16), lastAt: ago(16) })] }))).toEqual([]);
    }
  });
  it('another session task is dim, with no agents; one without a session is own only when this session touched it; an unknown session id owns nothing (Review Focus 5)', () => {
    const [b] = buildActivities(input({ statuses: [st('B', { session: 'other', lastAt: ago(5) })], links: [link('a1', 'B')] })).activities;
    expect(b).toMatchObject({ owner: 'other', dim: true, agents: [], expanded: true });
    const loose = (own: string[]) => buildActivities(input({ statuses: [st('L', { session: null })], ownTasks: own })).activities[0];
    expect(loose(['L-1'])).toMatchObject({ owner: 'own', dim: false });
    expect(loose([])).toMatchObject({ owner: 'other', dim: true });
    expect(buildActivities(input({ statuses: [st('A')], sessionId: null })).activities[0].owner).toBe('other');
    // Without a session id at all (an older caller), every task counts as own, as before.
    expect(buildActivities(input({ statuses: [st('B', { session: 'other' })], sessionId: undefined })).activities[0].owner).toBe('own');
  });
  it('with no session id ($.session.id() failed): what names a session is another one\'s, dim, for 30 minutes; what this session touched with forge.cjs stays its own (Review Focus 5)', () => {
    const blind = (over: Partial<ActivityInput>) => buildActivities(input({ sessionId: null, ...over }));
    expect(blind({ statuses: [st('B', { lastAt: ago(29) })], links: [link('b1', 'B')] }).activities[0]).toMatchObject({ key: 'B', owner: 'other', dim: true, agents: [] });
    expect(blind({ statuses: [st('B', { lastAt: ago(31) })] }).activities).toEqual([]);
    // forge.cjs stamps this session's own id on its events, which lens could not read: the task it touched is its own.
    expect(blind({ statuses: [st('A', { lastAt: ago(31) })], ownTasks: ['A'], links: [link('a1', 'A')] }).activities[0])
      .toMatchObject({ key: 'A', owner: 'own', dim: false, agents: [{ id: 'a1' }] });
    expect(blind({ statuses: [st('L', { session: null })], ownTasks: ['L-2'] }).activities[0]).toMatchObject({ key: 'L', owner: 'own' });
    // Now takes a job that names no session, never one that names a session.
    const job = (session: string | null) => parseJob(JSON.stringify({ name: 'step-run-1', cmd: 'step', task: null, pid: 1, startedAt: ago(1), out: 'x', session }))!;
    expect(blind({ jobs: [job('me'), job(null)] }).jobs).toEqual([{ name: 'step', task: null, seconds: 60 }]);
  });
  it('the order: own in progress newest first, then other sessions, then the done and the stopped ones; one expanded', () => {
    const view = buildActivities(input({ statuses: [
      st('old', { lastAt: ago(50) }), st('new', { lastAt: ago(2) }), st('theirs', { session: 'x', lastAt: ago(1) }),
      st('done', { doneAt: ago(3), lastAt: ago(3) }), st('halted', { phase: 'stopped', doneAt: ago(1), lastAt: ago(1) }),
    ] }));
    expect(view.activities.map(a => a.key)).toEqual(['new', 'old', 'theirs', 'halted', 'done']);
    expect(view.activities.filter(a => a.expanded).map(a => a.key)).toEqual(['new']);
    expect(view.expanded?.task).toBe('new');
    // The task of the agent the person looks at is the one expanded.
    const focus = buildActivities(input({ statuses: [st('old', { lastAt: ago(50) }), st('new', { lastAt: ago(2) })], links: [link('a9', 'old')], focusAgent: 'a9' }));
    expect(focus.activities.filter(a => a.expanded).map(a => a.key)).toEqual(['old']);
  });
  it('a time in the future leaves the activity without a time, never a negative one (Review Focus 4)', () => {
    const later = new Date(NOW + 10 * 60_000).toISOString();
    expect(buildActivities(input({ statuses: [st('F', { taskStartedAt: later, lastAt: later })] })).activities[0]).toMatchObject({ key: 'F', seconds: null });
    // Only its last event ahead of this clock: its writer's clock is off, so no time is drawn for it.
    expect(buildActivities(input({ statuses: [st('G', { lastAt: later })] })).activities[0]).toMatchObject({ key: 'G', seconds: null });
    expect(buildActivities(input({ statuses: [st('D', { doneAt: later, lastAt: later })] })).activities[0]).toMatchObject({ key: 'D', done: true, seconds: null });
    // A job started ahead of this clock: on its task's row and in Now, without a time.
    const job = (name: string, cmd: string, task: string | null) => parseJob(JSON.stringify({ name, cmd, task, pid: 1, startedAt: later, out: 'x', session: 'me' }))!;
    const view = buildActivities(input({ statuses: [st('F')], jobs: [job('prep-F-1-1', 'prep', 'F-1'), job('step-run-2', 'step', null)] }));
    expect(view.activities[0].job).toEqual({ name: 'prep', seconds: null });
    expect(view.jobs).toEqual([{ name: 'step', task: null, seconds: null }]);
  });
});

describe('buildActivities: a stopped task (forge stop, wave 2)', () => {
  it('phase stopped is stopped, never done, shows 15 minutes, dim, with no stage', () => {
    const one = (min: number) => buildActivities(input({ statuses: [st('S', { phase: 'stopped', doneAt: ago(min), lastAt: ago(min) })] })).activities;
    expect(one(14)[0]).toMatchObject({ key: 'S', stopped: true, done: false, dim: true, stage: null, agents: [] });
    expect(one(16)).toEqual([]);
  });
});

describe('buildActivities: a light task left open', () => {
  it('shows 15 minutes from when it is judged done (30 minutes after its last event), its time stopping at that event (C6)', () => {
    const light = (min: number) => buildActivities(input({ statuses: [st('L', { path: 'small', taskStartedAt: ago(min + 10), lastAt: ago(min) })] })).activities;
    expect(light(29)[0]).toMatchObject({ key: 'L', done: false, seconds: 39 * 60 });
    expect(light(31)[0]).toMatchObject({ key: 'L', done: true, dim: true, stage: null, seconds: 600 });
    expect(light(44)[0]).toMatchObject({ key: 'L', done: true, seconds: 600 });
    expect(light(46)).toEqual([]);
  });
});

describe('buildActivities: jobs in the background (wave 1)', () => {
  const job = (over: Record<string, unknown> = {}) => parseJob(JSON.stringify({
    name: 'review-prep-T003-1-42', cmd: 'review-prep', task: 'T003-1', pid: 42, startedAt: new Date(NOW - 90_000).toISOString(), out: 'x', session: 'me', ...over,
  }));
  it("a job of a task with a row goes on that row; without a row, or without a task, it goes to Now; old ones and other sessions' go nowhere", () => {
    const view = buildActivities(input({ statuses: [st('T003')], jobs: [
      job()!, job({ name: 'integrate-T009-7', cmd: 'integrate', task: 'T009' })!, job({ name: 'step-run-8', cmd: 'step', task: null })!,
      job({ name: 'prep-T001-1-9', cmd: 'prep', task: 'T001-1', startedAt: new Date(NOW - 3 * 3600_000).toISOString() })!,
      job({ name: 'validate-T008-1-5', cmd: 'validate', task: 'T008-1', session: 'other' })!,
    ] }));
    expect(view.activities[0].job).toEqual({ name: 'review-prep', seconds: 90 });
    expect(view.jobs).toEqual([{ name: 'integrate', task: 'T009', seconds: 90 }, { name: 'step', task: null, seconds: 90 }]);
  });
  it('a job file that is too big, not JSON, or names an unsafe task is dropped', () => {
    expect(job({ task: '../x' })).toBeNull();
    expect(job({ cmd: 'Prep!' })).toBeNull();
    expect(parseJob('{oops')).toBeNull();
    expect(parseJob('x'.repeat(5000))).toBeNull();
  });
});

describe('buildActivities: waiting on subagents (E-11)', () => {
  const links = [link('a', 'T1'), link('b', 'T2', { status: 'idle' }), link('c', null), link('d', 'T1', { parentId: 'a' }), link('e', null, { status: 'done', endedAt: NOW })];
  const waiting = (over: Partial<ActivityInput>) => buildActivities(input({ links, ...over })).waiting;
  it("no main turn and live agents of the main loop: waiting, waking at the coordinator's sleep or the last ScheduleWakeup, whichever comes first", () => {
    const sleepUntil = new Date(NOW + 240_000).toISOString();
    expect(waiting({ viewer: COORDINATOR, sleepUntil })).toEqual({ agents: 3, wakeSeconds: 240 });
    expect(waiting({ viewer: COORDINATOR, sleepUntil, wakeAt: NOW + 120_000 })).toEqual({ agents: 3, wakeSeconds: 120 });
    expect(waiting({ sleepUntil })).toEqual({ agents: 3, wakeSeconds: null });
    expect(waiting({ turnSince: NOW - 1000 })).toBeNull();
    expect(buildActivities(input()).waiting).toBeNull();
  });
});

describe('withSlotAgents and the slots (E-02)', () => {
  it("puts the linked agents under their slot, fills its model and, in the coordinator, makes it alive", () => {
    const out = withSlotAgents(EXEC, [link('a1', 'T1', { tool: { name: 'Edit', since: NOW - 5000 } })], { a1: { model: 'claude-opus-5-5', effort: 'high' } }, COORDINATOR, NOW)!;
    expect(out.slots[0]).toMatchObject({ model: 'claude-opus-5-5', effort: 'high', liveness: 'alive', agents: [{ id: 'a1', tool: 'Edit', status: 'running', model: 'claude-opus-5-5', depth: 0 }] });
    expect(withSlotAgents(EXEC, [link('a1', 'T1')], {}, OWNER, NOW)!.slots[0].liveness).toBe('silent');
    expect(withSlotAgents(null, [], {}, OWNER, NOW)).toBeNull();
  });
  it('a slot task is a row marked slot, and is not the one expanded', () => {
    const view = buildActivities(input({ statuses: [st('T1')], execution: EXEC }));
    expect(view.activities[0]).toMatchObject({ key: 'T1', slot: true, expanded: false });
    expect(view.expanded).toBeNull();
  });
});

describe('buildActivities: a workflow, and the agents without a task', () => {
  it('the agents of a workflow run make one activity while they live and 15 minutes after; agents without a task make adhoc', () => {
    const wf = (id: string, over: Partial<AgentLink> = {}) => link(id, null, { workflow: { runId: 'wf_1', index: 1 }, ...over });
    expect(buildActivities(input({ links: [wf('w1'), wf('w2')] })).activities[0]).toMatchObject({ key: 'wf:wf_1', kind: 'workflow', owner: 'own', done: false, agents: [{ id: 'w1' }, { id: 'w2' }] });
    expect(buildActivities(input({ links: [wf('w1', { status: 'done', endedAt: NOW - 14 * 60_000 })] })).activities[0]).toMatchObject({ key: 'wf:wf_1', done: true, agents: [] });
    expect(buildActivities(input({ links: [wf('w1', { status: 'done', endedAt: NOW - 16 * 60_000 })] })).activities).toEqual([]);
    expect(buildActivities(input({ links: [link('x', null)] })).activities).toMatchObject([{ key: 'adhoc', kind: 'adhoc', agents: [{ id: 'x' }] }]);
  });
});

describe('runRoleOf: the role lens reads from the band (C3)', () => {
  it('owner only as the coordinator or a member; other-live and previous as published; none without a viewer', () => {
    expect(runRoleOf({ mode: 'run', viewer: COORDINATOR })).toBe('owner');
    expect(runRoleOf({ mode: 'work', run: { coordinator: 'main', stage: 'implement' }, viewer: { role: 'owner', coordinator: false, runId: 'r1' } })).toBe('owner');
    expect(runRoleOf({ mode: 'work', run: null, viewer: { role: 'owner', coordinator: false, runId: 'r1' } })).toBe('none');
    expect(runRoleOf({ mode: 'notice', viewer: { role: 'other-live', coordinator: false, runId: 'r1' } })).toBe('other-live');
    expect(runRoleOf({ mode: 'none' })).toBe('none');
  });
});
