import { describe, it, expect } from 'vitest';
import { buildActivities, JOB_FILE_MAX, linkHomes, parseJob, runRoleOf, withSlotAgents, type ActivityInput } from '../src/lens/activities.js';
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
    expect(focus.activities.map(a => a.key)).toEqual(['old', 'new']);
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
  it('a status ahead of this clock past the skew neither sorts as the newest nor takes the expansion (task 7 review, minor 1)', () => {
    const later = new Date(NOW + 10 * 60_000).toISOString();
    const view = buildActivities(input({ statuses: [st('S', { lastAt: later }), st('A', { lastAt: ago(5) })] }));
    expect(view.activities.map(a => a.key)).toEqual(['A', 'S']);
    expect(view.expanded?.task).toBe('A');
    // A done one whose end is ahead goes after the done ones whose end is known.
    const done = buildActivities(input({ statuses: [st('D1', { doneAt: later, lastAt: later }), st('D2', { doneAt: ago(2), lastAt: ago(2) })] }));
    expect(done.activities.map(a => a.key)).toEqual(['D2', 'D1']);
  });
  it('a start less than two minutes ahead of this clock leaves the task without a time, never a negative one', () => {
    const soon = new Date(NOW + 60_000).toISOString();
    expect(buildActivities(input({ statuses: [st('F', { taskStartedAt: soon })] })).activities[0]).toMatchObject({ key: 'F', done: false, seconds: null });
  });
});

describe('buildActivities: an own task left in progress (final review m-3)', () => {
  it('still shows for 24 h, but once its status has not moved for 30 minutes it is idle; a fresh, done or other one is not', () => {
    const one = (over: Record<string, unknown>, sessionId = 'me') => buildActivities(input({ statuses: [st('A', over)], sessionId })).activities[0];
    expect(one({ lastAt: ago(29) })).not.toHaveProperty('idle');
    expect(one({ lastAt: ago(31) })).toMatchObject({ key: 'A', owner: 'own', done: false, idle: true });
    expect(one({ lastAt: ago(23 * 60) })).toMatchObject({ key: 'A', idle: true });
    expect(one({ lastAt: ago(14), doneAt: ago(14) })).not.toHaveProperty('idle');
    expect(one({ session: 'other', lastAt: ago(29) })).not.toHaveProperty('idle');
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
    // Valid JSON over JOB_FILE_MAX is not parsed either.
    const big = JSON.stringify({ name: 'prep-T1-1-2', cmd: 'prep', task: 'T1-1', pid: 2, startedAt: ago(1), out: 'x'.repeat(JOB_FILE_MAX), session: 'me' });
    expect(big.length).toBeGreaterThan(JOB_FILE_MAX);
    expect(parseJob(big)).toBeNull();
  });
  it('Now keeps the newest five jobs by their start, whatever the order they were read in', () => {
    const jobs = [3, 1, 6, 2, 5, 4].map(m => job({ name: `step-run-${m}`, cmd: 'step', task: null, startedAt: ago(m) })!);
    expect(buildActivities(input({ jobs })).jobs.map(j => j.seconds)).toEqual([60, 120, 180, 240, 300]);
  });
  it("with no session id, Now keeps this session's job, whose task it touched with forge.cjs, and one that names no session", () => {
    const blind = (ownTasks: string[]) => buildActivities(input({ sessionId: null, ownTasks, jobs: [
      job({ name: 'prep-T7-1-1', cmd: 'prep', task: 'T7-1', session: 'me' })!, job({ name: 'step-run-2', cmd: 'step', task: null, session: null })!,
    ] })).jobs.map(j => j.task);
    expect(blind(['T7'])).toEqual(['T7-1', null]);
    expect(blind(['T7-1'])).toEqual(['T7-1', null]);
    expect(blind(['T8'])).toEqual([null]);
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
  it('an agent started by another agent of the same task is drawn one level deeper', () => {
    const out = withSlotAgents(EXEC, [link('a1', 'T1'), link('a2', 'T1', { parentId: 'a1' }), link('a3', 'T1', { parentId: 'a2' })], {}, COORDINATOR, NOW)!;
    expect(out.slots[0].agents?.map(g => [g.id, g.depth])).toEqual([['a1', 0], ['a2', 1], ['a3', 2]]);
  });
  it('a slot task is a row marked slot, and is not the one expanded', () => {
    const view = buildActivities(input({ statuses: [st('T1')], execution: EXEC }));
    expect(view.activities[0]).toMatchObject({ key: 'T1', slot: true, expanded: false });
    expect(view.expanded).toBeNull();
  });
});

describe('the same task id in two plans and loose (C5, spec deviation 2)', () => {
  // Plan shop runs T001 in a slot; plan web's T001 and a loose T001 are in progress in this session too.
  const SHOP: NonNullable<PanelModel['execution']> = { ...EXEC, project: 'shop', slots: [{ ...EXEC.slots[0], task: 'T001' }] };
  const statuses = (newest: 'shop' | 'web' | null) => ['shop', 'web', null].map(project =>
    st('T001', { project, lastAt: ago(project === newest ? 1 : project === 'shop' ? 3 : 2) }));
  const links = [link('s1', 'T001', { project: 'shop' }), link('w1', 'T001', { project: 'web' }), link('n1', 'T001')];
  // The rows and the slots as buildPanelModel draws them, from one set of homes; every agent drawn, in one list.
  const draw = (over: Partial<ActivityInput>, exec: NonNullable<PanelModel['execution']> = SHOP) => {
    const i = input({ links, execution: exec, viewer: COORDINATOR, ...over });
    const homes = linkHomes(i);
    const view = buildActivities({ ...i, homes });
    const underRows = new Set(view.activities.filter(a => a.kind === 'forge' && !a.slot).flatMap(a => a.agents.map(g => g.id)));
    const slots = withSlotAgents(exec, i.links, {}, i.viewer, NOW, homes, underRows)!;
    const ids = [...view.activities.filter(a => !a.slot).flatMap(a => a.agents.map(g => g.id)), ...slots.slots.flatMap(s => (s.agents ?? []).map(g => g.id))];
    // Where an agent is drawn: the keys of the rows that draw it, and 'slot' when the slot does.
    const where = (id: string) => [
      ...view.activities.filter(a => !a.slot && a.agents.some(g => g.id === id)).map(a => a.key),
      ...(slots.slots[0].agents?.some(g => g.id === id) ? ['slot'] : []),
    ];
    return { view, slots, ids, where, row: (key: string) => view.activities.find(a => a.key === key)! };
  };
  const drawn = (newest: 'shop' | 'web' | null, over: Partial<ActivityInput> = {}) => draw({ statuses: statuses(newest), ...over });
  it("another plan's task with the slot's id is a row of its own with its agent; the slot keeps its plan's agents", () => {
    const { view, slots, row } = drawn(null);
    expect(row('shop__T001')).toMatchObject({ slot: true, project: 'shop' });
    expect(row('web__T001')).toMatchObject({ slot: false, owner: 'own', project: 'web', agents: [{ id: 'w1' }] });
    expect(slots.slots[0].agents?.map(g => g.id)).toEqual(['s1']);
    expect(view.expanded).toMatchObject({ task: 'T001', project: null });
    // web's T001 can be expanded: the agent the person looks at is its own.
    expect(buildActivities(input({ statuses: statuses(null), links, execution: SHOP, viewer: COORDINATOR, focusAgent: 'w1' })).expanded).toMatchObject({ task: 'T001', project: 'web' });
  });
  it('an agent without a project goes under the loose status of its id, whichever moved last; no agent is drawn twice (R3)', () => {
    for (const newest of ['shop', 'web', null] as const) {
      const { ids, where } = drawn(newest);
      expect(ids.sort(), String(newest)).toEqual(['n1', 's1', 'w1']);
      expect(where('n1'), String(newest)).toEqual(['T001']);
    }
  });
  it("without a loose status, under the newest of its id this session has in progress, a slot included; else the newest (R3)", () => {
    const two = (newest: 'shop' | 'web', web: Record<string, unknown> = {}) => draw({ links: [link('n1', 'T001')], statuses: [
      st('T001', { project: 'shop', lastAt: ago(newest === 'shop' ? 1 : 3) }), st('T001', { project: 'web', lastAt: ago(newest === 'web' ? 1 : 3), ...web }),
    ] });
    expect(two('shop').where('n1')).toEqual(['slot']);
    expect(two('web').where('n1')).toEqual(['web__T001']);
    // Another session's status that moved last, or a done one, never takes this session's agent from its own task.
    expect(two('web', { session: 'other' }).where('n1')).toEqual(['slot']);
    expect(two('web', { doneAt: ago(1) }).where('n1')).toEqual(['slot']);
  });
  it("an own loose task keeps its agent when another session's same id moved last, and is the one expanded for it (P1)", () => {
    const statuses = [st('T001', { lastAt: ago(5) }), st('T001', { project: 'web', session: 'other', lastAt: ago(1) })];
    const p1 = draw({ statuses, links: [link('n1', 'T001')], focusAgent: 'n1' }, EXEC);
    expect(p1.where('n1')).toEqual(['T001']);
    expect(p1.view.expanded).toMatchObject({ task: 'T001', project: null });
  });
  it('an own loose task in progress keeps its agent when a done status of the same id moved later (P2)', () => {
    const statuses = [st('T001', { lastAt: ago(20) }), st('T001', { project: 'shop', doneAt: ago(2), lastAt: ago(2) })];
    expect(draw({ statuses, links: [link('n1', 'T001')] }, EXEC).where('n1')).toEqual(['T001']);
  });
  it("forge's Medium form: a loose T001 of this session, its agent linked by .forge/work/T001, another session's shop slot T001 moving last: the agent stays on the loose row (P6)", () => {
    const OTHER = { role: 'other-live' as const, coordinator: false, runId: 'r1' };
    for (const aLast of [true, false]) {
      const statuses = [st('T001', { project: 'shop', session: 'A', lastAt: ago(aLast ? 1 : 3) }), st('T001', { session: 'B', lastAt: ago(aLast ? 3 : 1) })];
      const p6 = draw({ statuses, links: [link('b1', 'T001', { via: 'work-path' })], sessionId: 'B', viewer: OTHER });
      expect(p6.where('b1'), String(aLast)).toEqual(['T001']);
      expect(p6.slots.slots[0].agents, String(aLast)).toEqual([]);
    }
  });
  it("in mode sessions a member's agent is drawn under its task's row, not under the slot too (P4)", () => {
    const SESSIONS: NonNullable<PanelModel['execution']> = { ...SHOP, mode: 'sessions', slots: [{ ...SHOP.slots[0], mode: 'sessions' }] };
    const p4 = draw({ statuses: [st('T001', { project: 'shop' })], links: [link('s1', 'T001', { project: 'shop' })] }, SESSIONS);
    expect(p4.where('s1')).toEqual(['shop__T001']);
  });
  it("a row's title follows its key: the title of its own plan", () => {
    const { row } = drawn('web', { titles: { shop__T001: 'Cart', web__T001: 'Landing' } });
    expect(row('web__T001')).toMatchObject({ title: 'Landing' });
    expect(row('T001')).toMatchObject({ title: null });
  });
  it("a job goes on the status of its id that its own session wrote, whichever moved last (R5, P3)", () => {
    const job = parseJob(JSON.stringify({ name: 'review-prep-T001-1-4', cmd: 'review-prep', task: 'T001-1', pid: 4, startedAt: ago(1), out: 'x', session: 'B' }))!;
    const statuses = [st('T001', { project: 'shop', session: 'A', lastAt: ago(1) }), st('T001', { project: 'web', session: 'B', lastAt: ago(3) })];
    for (const viewer of ['A', 'B']) {
      const rows = buildActivities(input({ statuses, sessionId: viewer, jobs: [job] })).activities;
      expect(rows.map(a => [a.key, a.job?.name ?? null]).sort(), viewer).toEqual([['shop__T001', null], ['web__T001', 'review-prep']]);
    }
    // A job that names no session, or one whose session wrote none of them, goes by the agents' rule: the loose status first.
    const loose = [...statuses, st('T001', { session: 'C', lastAt: ago(5) })];
    const anon = parseJob(JSON.stringify({ name: 'prep-T001-1-5', cmd: 'prep', task: 'T001-1', pid: 5, startedAt: ago(1), out: 'x', session: null }))!;
    expect(buildActivities(input({ statuses: loose, sessionId: 'A', jobs: [anon] })).activities.find(a => a.job)?.key).toBe('T001');
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
  it('a workflow agent whose prompt names a task has one home, the workflow row, never also a task row or a slot (3a m-5)', () => {
    const agent = link('w1', 'T001', { project: 'shop', workflow: { runId: 'wf_1', index: 1 } });
    const slotted: NonNullable<PanelModel['execution']> = { ...EXEC, project: 'shop', slots: [{ ...EXEC.slots[0], task: 'T001' }] };
    const i = input({ statuses: [st('T001', { project: 'shop' })], links: [agent, link('n1', 'T001', { project: 'shop' })], execution: slotted, viewer: COORDINATOR });
    const homes = linkHomes(i);
    expect(homes.has('w1')).toBe(false);
    expect(homes.get('n1')).toBe('shop__T001');
    const view = buildActivities({ ...i, homes });
    expect(view.activities.flatMap(a => a.agents.filter(g => g.id === 'w1').map(() => a.key))).toEqual(['wf:wf_1']);
    const slots = withSlotAgents(slotted, i.links, {}, i.viewer, NOW, homes, new Set())!;
    expect(slots.slots[0].agents?.map(g => g.id)).toEqual(['n1']);
    // Loose, with its task row in progress and not a slot: still only the workflow row.
    const loose = buildActivities(input({ statuses: [st('T001')], links: [link('w2', 'T001', { workflow: { runId: 'wf_2', index: 1 } })] }));
    expect(loose.activities.flatMap(a => a.agents.map(g => `${a.key}:${g.id}`))).toEqual(['wf:wf_2:w2']);
  });
  it('a workflow agent in view has no task home: no row is moved first for it, whatever task its prompt names (carry 4)', () => {
    const wf = link('w1', 'T001', { project: 'web', workflow: { runId: 'wf_1', index: 1 } });
    const view = buildActivities(input({ statuses: [st('T001', { project: 'web', lastAt: ago(2) })], links: [wf], focusAgent: 'w1' }));
    expect(view.activities.map(a => a.key)).toEqual(['wf:wf_1', 'web__T001']);
    // The newest own task in progress is still the one expanded, as with no agent in view.
    expect(view.activities.filter(a => a.expanded).map(a => a.key)).toEqual(['web__T001']);
  });
});

describe('runRoleOf: the role lens reads from the band (C3)', () => {
  it('owner only as the coordinator or a member; other-live and previous as published; none without a viewer', () => {
    expect(runRoleOf({ mode: 'run', viewer: COORDINATOR })).toBe('owner');
    expect(runRoleOf({ mode: 'work', run: { coordinator: 'main', stage: 'implement' }, viewer: { role: 'owner', coordinator: false, runId: 'r1' } })).toBe('owner');
    expect(runRoleOf({ mode: 'work', run: null, viewer: { role: 'owner', coordinator: false, runId: 'r1' } })).toBe('none');
    expect(runRoleOf({ mode: 'notice', viewer: { role: 'other-live', coordinator: false, runId: 'r1' } })).toBe('other-live');
    expect(runRoleOf({ mode: 'notice', viewer: { role: 'previous', coordinator: false, runId: 'r1' } })).toBe('previous');
    expect(runRoleOf({ mode: 'none' })).toBe('none');
  });
});
