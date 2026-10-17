import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildBandModel, NO_VIEWER, openTasksFrom, pickProject, type BandFiles } from '../src/mod/model.js';
import { bandLine, clip } from '../src/mod/band-line.js';

const plan = readFileSync(new URL('./fixtures/plan.yaml', import.meta.url), 'utf8')
  .replace('version: "0.1"', 'version: "0.1"\nartifacts:\n  roadmap: https://claude.ai/artifact/abc');
const design = readFileSync(new URL('./fixtures/design.md', import.meta.url), 'utf8');
const j = (v: unknown) => JSON.stringify(v);
const empty = { states: {}, messages: {}, critiques: {} };
const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();
/** The binding of seat `sid` to the conversation `claude`, renewed a minute ago (C3). */
const bound = (sid: string, claude: string, over: object = {}) =>
  j({ sid, claude, pid: null, via: 'work', since: ago(60), seenAt: ago(1), endedAt: null, endReason: null, ...over });
/** The conversation `claude` bound to the checkout seat `sid`, looking at the band. */
const ownerOf = (sid: string, claude = 'A', over: object = {}): Pick<BandFiles, 'sessionId' | 'bindings'> =>
  ({ sessionId: claude, bindings: { '.': bound(sid, claude, over) } });
const OWNER = { role: 'owner', coordinator: false, runId: null };
// This project's execution; its coordinator is the conversation s1.
const EXEC = (over: object = {}) => JSON.stringify({ runId: 'r1', kind: 'plan', mode: 'subagents', parallel: 3, project: 'demo-shop', base: 'main', branch: 'forge/run-demo-shop', mergeOnFinish: false, coordinator: 'main', hookSession: 's1', active: true, stopReason: null, stallReason: null,
  startedAt: new Date(Date.now() - 3600000).toISOString(), lastStepAt: new Date(Date.now() - 60000).toISOString(), lastBlockStep: null, sleepUntil: null,
  tasks: {
    T002: { status: 'running', stage: 'review', round: 2, worktree: '/w', branch: 'task/T002', executor: 'subagents', attempts: 0, agent: null, startedAt: new Date(Date.now() - 1200000).toISOString(), updatedAt: new Date().toISOString(), stageSince: new Date().toISOString(), detail: null },
    T001: { status: 'integrated', stage: 'integrate', round: 1, worktree: '/w1', branch: 'task/T001', executor: 'subagents', attempts: 0, agent: null, startedAt: new Date(Date.now() - 3000000).toISOString(), updatedAt: new Date().toISOString(), stageSince: new Date().toISOString(), detail: null },
  }, ...over });
const LOOSE = 'fecha-corta-en-la-cabecera-del-listado-k3x9';
const EPHEMERAL = (over: object = {}) => EXEC({ runId: 'e1', kind: 'ephemeral', project: 'loose', tasks: {
  [LOOSE]: { status: 'running', stage: 'implement', round: 1, worktree: '/w', branch: `task/${LOOSE}`, executor: 'subagents', attempts: 0, agent: null, startedAt: new Date(Date.now() - 600000).toISOString(), updatedAt: new Date().toISOString(), stageSince: new Date().toISOString(), detail: null },
  'otra-cosa-a7b2': { status: 'running', stage: 'review', round: 2, worktree: '/w2', branch: 'task/otra-cosa-a7b2', executor: 'subagents', attempts: 0, agent: null, startedAt: new Date(Date.now() - 600000).toISOString(), updatedAt: new Date().toISOString(), stageSince: new Date().toISOString(), detail: null },
}, ...over });

describe('pickProject (A-15)', () => {
  const bound = (claude: string, seenAt: string, endedAt: string | null = null) =>
    ({ sid: 'main', claude, pid: null, via: 'work' as const, since: seenAt, seenAt, endedAt, endReason: endedAt ? 'clear' as const : null });
  const T = (h: number) => `2026-10-15T${String(h).padStart(2, '0')}:00:00.000Z`;
  const ms = (h: number) => Date.parse(T(h));
  it("prefers the project of this session's binding, the newest when several", () => {
    const entries = [
      { name: 'old', bindings: [], mtimeMs: ms(11) },
      { name: 'mine', bindings: [bound('A', T(8))], mtimeMs: ms(1) },
      { name: 'other', bindings: [bound('B', T(10))], mtimeMs: ms(2) },
      { name: 'mine-too', bindings: [bound('A', T(9))], mtimeMs: ms(1) },
    ];
    expect(pickProject(entries, 'A')).toBe('mine-too');
    expect(pickProject(entries, 'B')).toBe('other');
  });
  it('otherwise the latest activity: a plan or design file, or a binding renewed or ended', () => {
    const entries = [
      { name: 'files', bindings: [], mtimeMs: ms(9) },
      { name: 'bound', bindings: [bound('B', T(7), T(10))], mtimeMs: ms(1) },
    ];
    expect(pickProject(entries, 'C')).toBe('bound');
    expect(pickProject(entries, null)).toBe('bound');
    expect(pickProject([{ name: 'a', bindings: [], mtimeMs: 1 }, { name: 'b', bindings: [], mtimeMs: 5 }], null)).toBe('b');
    expect(pickProject([{ name: 'a', bindings: [], mtimeMs: 1 }], 'A')).toBe('a');
    expect(pickProject([], 'A')).toBeNull();
  });
  it("the end of this session's binding is its activity too: one ended later beats one renewed earlier", () => {
    const entries = [
      { name: 'live', bindings: [bound('A', T(9))], mtimeMs: ms(1) },
      { name: 'ended', bindings: [bound('A', T(7), T(10))], mtimeMs: ms(1) },
    ];
    expect(pickProject(entries, 'A')).toBe('ended');
  });
  it('ties keep the first listed, and between own bindings of the same time the files decide', () => {
    expect(pickProject([{ name: 'a', bindings: [bound('A', T(9))], mtimeMs: ms(1) }, { name: 'b', bindings: [bound('A', T(9))], mtimeMs: ms(1) }], 'A')).toBe('a');
    expect(pickProject([{ name: 'a', bindings: [bound('A', T(9))], mtimeMs: ms(1) }, { name: 'b', bindings: [bound('A', T(9))], mtimeMs: ms(10) }], 'A')).toBe('b');
    expect(pickProject([{ name: 'a', bindings: [], mtimeMs: ms(3) }, { name: 'b', bindings: [], mtimeMs: ms(3) }], null)).toBe('a');
  });
  it('dates that do not parse give no activity: such a binding of this session does not make its project the own one', () => {
    // Unreachable through the hooks (normalizeBound drops such a binding first); pickProject still never throws on it.
    const entries = [
      { name: 'broken', bindings: [bound('A', 'not a date', 'nor this')], mtimeMs: ms(1) },
      { name: 'files', bindings: [], mtimeMs: ms(5) },
    ];
    expect(pickProject(entries, 'A')).toBe('files');
    expect(pickProject([{ name: 'broken', bindings: [bound('A', 'not a date')], mtimeMs: ms(1) }], 'A')).toBe('broken');
  });
});

describe('buildBandModel · work', () => {
  const session = j({ plan: 'docs/waypoint/demo-shop/plan.yaml', sessionId: 'backend', track: 'backend' });
  const files = (): BandFiles => ({
    ...empty, plan, session, ...ownerOf('backend'),
    states: {
      T001: j({ status: 'done' }),
      T002: j({ status: 'in_progress', owner: 'backend', startedAt: '2026-10-11T10:00:00Z' }),
    },
    messages: {
      m1: j({ ts: '2026-10-11T10:01:00Z', from: 'ui', to: 'backend', type: 'overlap_warning', taskId: 'T002', text: 'x', status: 'open' }),
      m2: j({ ts: '2026-10-11T10:02:00Z', from: 'ui', to: 'backend', type: 'reply', taskId: 'T002', text: 'y', status: 'resolved' }),
    },
  });
  it('summarises the session, its task, its track and the inbox', () => {
    const m = buildBandModel('demo-shop', files());
    expect(m).toMatchObject({
      mode: 'work', project: 'demo-shop', locale: 'es', sid: 'backend', track: 'backend',
      roadmapUrl: 'https://claude.ai/artifact/abc',
      current: { id: 'T002', title: 'API de pedidos', startedAt: '2026-10-11T10:00:00Z', estimateMin: 30 },
      trackDone: 1, trackTotal: 4, percent: 17, inbox: 1, escalation: false,
      phase: { index: 1, total: 2, name: 'Base' },
      viewer: OWNER,
    });
  });
  it('lists the 3 newest done tasks of the track with their minutes, from startedAt or claimedAt', () => {
    const later = new Date(Date.now() + 3600_000).toISOString();
    const m = buildBandModel('demo-shop', { ...files(), states: {
      ...files().states,
      T001: j({ status: 'done', startedAt: '2026-10-11T10:00:00Z', doneAt: '2026-10-11T10:22:30Z' }),
      T004: j({ status: 'done', claimedAt: '2026-10-11T09:00:00Z', doneAt: '2026-10-11T09:31:00Z' }),
      T006: j({ status: 'done', doneAt: '2026-10-11T11:00:00Z' }),
      T003: j({ status: 'done', startedAt: '2026-10-11T08:00:00Z', doneAt: '2026-10-11T12:00:00Z' }),
    } });
    expect(m).toMatchObject({ mode: 'work', recentDone: [{ id: 'T001', minutes: 22, estimateMin: 20 }, { id: 'T004', minutes: 31 }] });
    const odd = buildBandModel('demo-shop', { ...files(), states: {
      ...files().states,
      T001: j({ status: 'done', startedAt: '2026-10-11T10:00:00Z', doneAt: later }),
      T004: j({ status: 'done', startedAt: '2026-10-11T10:00:00Z', doneAt: '2026-10-11T09:00:00Z' }),
      T006: j({ status: 'done', startedAt: 'nope', doneAt: '2026-10-11T09:00:00Z' }),
    } });
    expect(odd).toMatchObject({ mode: 'work', recentDone: [] });
  });
  it('run mode: executor, slots with stage and round, progress and the worst liveness, for its coordinator', () => {
    const m = buildBandModel('demo-shop', { ...empty, plan, session: j({ sessionId: 'main', track: null }), sessionId: 's1', execution: EXEC() });
    expect(m).toMatchObject({ mode: 'run', executor: 'subagents', running: 1, parallel: 3, integrated: 1, total: 2, slots: [{ task: 'T002', stage: 'review', round: 2 }], worst: 'alive', stalled: false,
      viewer: { role: 'owner', coordinator: true, runId: 'r1' } });
  });
  it('the coordinator sees its run until it is closed, also once it stopped, with no time limit (C2, B-07)', () => {
    const files = (over: object) => ({ ...empty, plan, session: j({ sessionId: 'main', track: null }), sessionId: 's1', execution: EXEC(over) });
    const ended = (stopReason: string, hoursAgo: number) => ({ active: false, stopReason, stallReason: stopReason === 'stalled' ? 'x' : null,
      lastStepAt: new Date(Date.now() - hoursAgo * 3600000).toISOString(), startedAt: new Date(Date.now() - (hoursAgo + 1) * 3600000).toISOString() });
    for (const r of ['stalled', 'stopped', 'budget', 'finished']) {
      expect(buildBandModel('demo-shop', files(ended(r, 1))), r).toMatchObject({ mode: 'run', stalled: true, viewer: { role: 'owner', coordinator: true, runId: 'r1' } });
      expect(buildBandModel('demo-shop', files(ended(r, 30))).mode, r).toBe('run');
    }
    expect(buildBandModel('demo-shop', files({ ...ended('stopped', 1), closedAt: new Date().toISOString(), closedBy: 'close' })))
      .toMatchObject({ mode: 'none', viewer: { role: 'none', coordinator: false, runId: null } });
    expect(buildBandModel('demo-shop', files(ended('migrated', 1))).mode).toBe('none');
  });
  it('run mode turns silent and then stopped when the coordinator stops stepping', () => {
    const old = (min: number) => EXEC({ lastStepAt: new Date(Date.now() - min * 60000).toISOString() });
    expect(buildBandModel('demo-shop', { ...empty, plan, sessionId: 's1', execution: old(8) })).toMatchObject({ mode: 'run', worst: 'silent' });
    expect(buildBandModel('demo-shop', { ...empty, plan, sessionId: 's1', execution: old(13) })).toMatchObject({ mode: 'run', worst: 'stopped' });
  });
  it('run mode stays alive while the coordinator waits on a long agent', () => {
    const execution = EXEC({ lastStepAt: ago(20), tasks: { T002: { status: 'running', stage: 'implement', round: 1, worktree: '/w', branch: 'task/T002', executor: 'subagents', attempts: 0, agent: 'forge-impl', startedAt: ago(25), updatedAt: ago(20), stageSince: ago(20), detail: null } } });
    const live = (ended: boolean) => ({ s1: j({ sessionId: 's1', role: 'coordinator', runId: 'r1', task: null, event: 'SubagentStart', ts: ago(20), agents: [{ id: 'a1', type: 'forge:forge-impl', since: ago(20) }], ended }) });
    expect(buildBandModel('demo-shop', { ...empty, plan, sessionId: 's1', execution, live: live(false) })).toMatchObject({ mode: 'run', worst: 'alive' });
    expect(buildBandModel('demo-shop', { ...empty, plan, sessionId: 's1', execution, live: live(true) })).toMatchObject({ mode: 'run', worst: 'stopped' });
  });
  it('a member of the execution sees its own task with the line of the run, never the run band (B-06)', () => {
    const member = j({ sessionId: 'backend', role: 'executor', runId: 'r1', task: 'T002', name: null, since: ago(20), hookSession: 'M' });
    const pubDoc = j({ task: 'T002', runId: 'r1', stage: 'implement', status: 'running', agent: null, round: 1, since: ago(20), updatedAt: ago(1), leaseUntil: new Date(Date.now() + 300000).toISOString(), by: 'backend', mode: 'sessions' });
    const f: BandFiles = { ...empty, plan, session: j({ sessionId: 'main', track: null }), ...ownerOf('main', 'A'), execution: EXEC({ mode: 'sessions' }), members: { backend: member }, execTasks: { T002: pubDoc } };
    const m = buildBandModel('demo-shop', { ...f, sessionId: 'M' });
    expect(m).toMatchObject({ mode: 'work', sid: 'backend', current: { id: 'T002', title: 'API de pedidos' }, run: { coordinator: 'main', stage: 'implement' },
      viewer: { role: 'owner', coordinator: false, runId: 'r1' } });
    expect(bandLine(m, 0)).toContain('· implementar · de la ejecución de main');
    // Without its public task, the stage is the run's own record of the task.
    expect(buildBandModel('demo-shop', { ...f, sessionId: 'M', execTasks: {} })).toMatchObject({ mode: 'work', run: { coordinator: 'main', stage: 'review' } });
    // The same files: the coordinator sees the run band, the seat's owner its own work band.
    expect(buildBandModel('demo-shop', { ...f, sessionId: 's1' })).toMatchObject({ mode: 'run', viewer: { role: 'owner', coordinator: true, runId: 'r1' } });
    // The seat's owner beside another's run: the run is not its own, so its viewer names none.
    expect(buildBandModel('demo-shop', { ...f, sessionId: 'A' })).toMatchObject({ mode: 'work', sid: 'main', run: null, viewer: { role: 'owner', coordinator: false, runId: null } });
  });
  it("a seat that works for a sessions run names it in its work band; without an execution run is null", () => {
    const session = j({ sessionId: 'S2', track: 'backend', launchedBy: 'main' });
    const pubDoc = j({ task: 'T002', runId: 'r1', stage: 'implement', status: 'running', agent: null, round: 1, since: new Date().toISOString(), updatedAt: new Date().toISOString(), leaseUntil: new Date(Date.now() + 300000).toISOString(), by: 'S2', mode: 'sessions' });
    const own = ownerOf('S2');
    const m = buildBandModel('demo-shop', { ...empty, plan, session, ...own, execution: EXEC(), execTasks: { T002: pubDoc } });
    expect(m).toMatchObject({ mode: 'work', run: { coordinator: 'main', stage: 'implement' } });
    expect(bandLine(m, 0)).toContain('· implementar · de la ejecución de main');
    expect(buildBandModel('demo-shop', { ...empty, plan, session, ...own, execTasks: { T002: pubDoc } })).toMatchObject({ mode: 'work', run: null });
    expect(buildBandModel('demo-shop', { ...empty, plan, session, ...own, execution: EXEC(), execTasks: { T002: pubDoc.replace('"S2"', '"S3"') } })).toMatchObject({ run: null });
  });
  it('run mode for an ephemeral execution (project loose) in a project with a plan, slot ids clipped in the line', () => {
    const m = buildBandModel('demo-shop', { ...empty, plan, session: j({ sessionId: 'main', track: null }), sessionId: 's1', execution: EPHEMERAL() });
    expect(m).toMatchObject({ mode: 'run', project: 'demo-shop', locale: 'es', roadmapUrl: 'https://claude.ai/artifact/abc', running: 2, integrated: 0, total: 2, stalled: false });
    const line = bandLine(m, 0);
    expect(line).toContain('► EJECUCIÓN · subagentes 2/3 · ');
    expect(line).toContain('fecha-corta-en-la-c… implementar');
    expect(line).toContain('otra-cosa-a7b2 revisar (r2)');
    expect(line).not.toContain(LOOSE);
  });
  it("an ephemeral run that finished stays its coordinator's until it is closed; a seat's owner keeps its work band", () => {
    expect(buildBandModel('demo-shop', { ...empty, plan, session: j({ sessionId: 'main', track: null }), sessionId: 's1', execution: EPHEMERAL({ active: false, stopReason: 'finished' }) }))
      .toMatchObject({ mode: 'run', stalled: true });
    expect(buildBandModel('demo-shop', { ...empty, plan, session: j({ sessionId: 'x', track: 'backend' }), ...ownerOf('x'), execution: EPHEMERAL() }).mode).toBe('work');
  });
  it('a plan execution of another project is not drawn: its coordinator bound here sees its work band', () => {
    expect(buildBandModel('demo-shop', { ...empty, plan, session: j({ sessionId: 'main', track: null }), ...ownerOf('main', 's1'), execution: EXEC({ project: 'other-shop' }) }))
      .toMatchObject({ mode: 'work', viewer: { role: 'owner', coordinator: false, runId: null } });
  });
  it('run mode takes worst from a slot whose lease lapsed while the coordinator is alive', () => {
    const pub = JSON.stringify({ task: 'T002', runId: 'r1', stage: 'review', status: 'running', agent: null, round: 2, since: new Date().toISOString(), updatedAt: new Date().toISOString(), leaseUntil: new Date(Date.now() - 3600000).toISOString(), by: 'x', mode: 'subagents' });
    const m = buildBandModel('demo-shop', { ...empty, plan, sessionId: 's1', execution: EXEC(), execTasks: { T002: pub } });
    expect(m).toMatchObject({ mode: 'run', worst: 'stopped' });
  });
  it('bandLine variants: stalled, stopped, sessions, round 1, en locale, unknown stage', () => {
    const run = (over: object, locale = 'es') => bandLine({ mode: 'run', project: 'p', locale, executor: 'subagents', running: 1, parallel: 2, integrated: 0, queued: 0, total: 4, slots: [{ task: 'T001', stage: 'implement', round: 1 }], worst: 'alive', stalled: false, roadmapUrl: null, viewer: NO_VIEWER, ...over } as never, 0);
    expect(run({ stalled: true })).toBe('► EJECUCIÓN · ▲ parada · 0/4 integradas');
    expect(run({ worst: 'stopped' })).toBe('► EJECUCIÓN · subagentes 1/2 · T001 implementar · 0/4 integradas · ▲ parada');
    expect(run({ executor: 'sessions' })).toBe('► EJECUCIÓN · sesiones 1/2 · T001 implementar · 0/4 integradas');
    expect(run({}, 'en')).toBe('► EXECUTION · subagents 1/2 · T001 implement · 0/4 integrated');
    expect(run({ worst: 'silent' }, 'en')).toContain('▲ no signal');
    expect(run({ slots: [{ task: 'T009', stage: 'weird', round: 1 }] })).toContain('T009 weird');
  });
  it('draws the run band line with stages, rounds and the liveness warning', () => {
    expect(bandLine({ mode: 'run', project: 'p', locale: 'es', executor: 'subagents', running: 2, parallel: 3, integrated: 3, queued: 0, total: 12, slots: [{ task: 'T004', stage: 'review', round: 2 }, { task: 'T008', stage: 'implement', round: 1 }], worst: 'silent', stalled: false, roadmapUrl: null, sid: 'main', inbox: 0, escalation: false, percent: 25, phase: null, viewer: NO_VIEWER }, 0))
      .toBe('► EJECUCIÓN · subagentes 2/3 · T004 revisar (r2) · T008 implementar · 3/12 integradas · ▲ sin señal');
  });
  it('marks a swarm member in work mode', () => {
    const m = buildBandModel('demo-shop', { ...files(), session: JSON.stringify({ sessionId: 'backend', track: 'backend', launchedBy: 'main' }) });
    expect(m).toMatchObject({ mode: 'work', swarm: true });
  });
  it('gives the current task phase, else the first phase not done, else null', () => {
    const own = j({ status: 'in_progress', owner: 'backend' });
    const owner = ownerOf('backend');
    const f1 = Object.fromEntries(['T001', 'T002', 'T003'].map(id => [id, j({ status: 'done' })]));
    expect(buildBandModel('demo-shop', { ...empty, plan, session, ...owner, states: { T004: own } }))
      .toMatchObject({ phase: { index: 2, total: 2, name: 'Checkout' } });
    expect(buildBandModel('demo-shop', { ...empty, plan, session, ...owner, states: f1 }))
      .toMatchObject({ current: null, phase: { index: 2, total: 2, name: 'Checkout' } });
    const all = Object.fromEntries(plan.match(/id: T\d+/g)!.map(s => [s.slice(4), j({ status: 'done' })]));
    expect(buildBandModel('demo-shop', { ...empty, plan, session, ...owner, states: all })).toMatchObject({ phase: null });
  });
  it('flags escalations involving this session', () => {
    const msg = (from: string, to: string, type = 'reply') => j({ ts: '2026-10-11T10:00:00Z', from, to, type, taskId: 'T002', text: 'x', status: 'open' });
    const m = buildBandModel('demo-shop', { ...empty, plan, session, ...ownerOf('backend'), messages: { a: msg('ui', 'backend', 'escalation') } });
    expect(m).toMatchObject({ mode: 'work', escalation: true });
  });
  it('parses each state of the cache once per build, for the role and the band alike', () => {
    const f = files();
    const texts = new Set(Object.values(f.states));
    const spy = vi.spyOn(JSON, 'parse');
    try {
      expect(buildBandModel('demo-shop', f)).toMatchObject({ mode: 'work', current: { id: 'T002' } });
      expect(spy.mock.calls.filter(([text]) => texts.has(text as string))).toHaveLength(texts.size);
    } finally { spy.mockRestore(); }
  });
  it('survives corrupt files; a plan that does not read is nothing to work out', () => {
    const m = buildBandModel('demo-shop', { ...empty, plan, session, ...ownerOf('backend'), states: { T001: '{oops' }, messages: { x: 'nope' } });
    expect(m).toMatchObject({ mode: 'work', percent: 0, inbox: 0, current: null });
    expect(buildBandModel('demo-shop', { ...empty, plan: 'not: [yaml', session, ...ownerOf('backend') })).toEqual({ mode: 'none', viewer: NO_VIEWER });
  });
});

describe('buildBandModel · the role of who looks (C3, B-02, K5-01)', () => {
  const session = j({ sessionId: 'backend', track: 'backend' });
  const states = { T002: j({ status: 'in_progress', owner: 'backend', startedAt: ago(30) }) };
  const files = (sessionId: string | null, over: object = {}): BandFiles => ({ ...empty, plan, session, states, bindings: { '.': bound('backend', 'A', over) }, sessionId });
  it('the same files draw the work band for the conversation bound to the seat, and never for another', () => {
    expect(buildBandModel('demo-shop', files('A'))).toMatchObject({ mode: 'work', sid: 'backend', current: { id: 'T002' }, viewer: OWNER });
    // Its binding ended: the same conversation, resumed, still owns it (rule 3).
    expect(buildBandModel('demo-shop', files('A', { endedAt: ago(30), endReason: 'resume' })).mode).toBe('work');
    for (const other of ['B', null]) expect(buildBandModel('demo-shop', files(other)).mode, String(other)).not.toBe('work');
  });
  it('every band carries viewer with role, coordinator and runId', () => {
    const models = [
      buildBandModel('demo-shop', empty),
      buildBandModel('demo-shop', files('A')),
      buildBandModel('demo-shop', { ...files('s1'), execution: EXEC() }),
      buildBandModel('demo-shop', { ...empty, design, ...ownerOf('main', 'A', { via: 'design' }) }),
    ];
    expect(models.map(m => m.mode)).toEqual(['none', 'work', 'run', 'design']);
    for (const m of models) expect(Object.keys(m.viewer).sort(), m.mode).toEqual(['coordinator', 'role', 'runId']);
    expect(models[0].viewer).toEqual(NO_VIEWER);
    expect(models[2].viewer).toEqual({ role: 'owner', coordinator: true, runId: 'r1' });
  });
  it("a second seat sees its own task and track, never the checkout seat's (Review Focus 2)", () => {
    const f: BandFiles = {
      ...empty, plan, session: j({ sessionId: 'backend', track: 'backend' }),
      states: { T002: j({ status: 'in_progress', owner: 'backend' }), T003: j({ status: 'claimed', owner: 'main-2' }) },
      bindings: { '.': bound('backend', 'A'), 'main-2': bound('main-2', 'C') },
      seatSessions: { 'main-2': j({ sessionId: 'main-2', track: null }) },
    };
    expect(buildBandModel('demo-shop', { ...f, sessionId: 'C' })).toMatchObject({ mode: 'work', sid: 'main-2', track: null, current: { id: 'T003' } });
    expect(buildBandModel('demo-shop', { ...f, sessionId: 'A' })).toMatchObject({ mode: 'work', sid: 'backend', track: 'backend', current: { id: 'T002' } });
  });
  it('a session id the engine could not give, or an unsafe one, owns nothing: no work band, no run band (Review Focus 1)', () => {
    for (const id of [null, undefined, 'a b', '../x']) {
      const m = buildBandModel('demo-shop', { ...files('A'), execution: EXEC({ hookSession: 'A' }), sessionId: id });
      expect(m.mode, String(id)).not.toBe('work');
      expect(m.mode, String(id)).not.toBe('run');
      expect(m.viewer.role, String(id)).not.toBe('owner');
      // M1: nor a notice, which could be about its own seat; the role is still published.
      expect(m, String(id)).toEqual({ mode: 'none', locale: 'es', viewer: { role: 'other-live', coordinator: false, runId: 'r1' } });
      // Without the run: the owner of the seat is not told that another session works its task.
      expect(buildBandModel('demo-shop', { ...files('A'), sessionId: id }), String(id)).toEqual({ mode: 'none', locale: 'es', viewer: { role: 'other-live', coordinator: false, runId: null } });
    }
  });
  it("with neither a plan nor a design nothing is drawn, but the role still comes from forge's execution (I2)", () => {
    const member = j({ sessionId: 'backend', role: 'executor', runId: 'r1', task: 'T002', name: null, since: ago(20), hookSession: 'M' });
    const f: BandFiles = { ...empty, execution: EXEC({ mode: 'sessions' }), members: { backend: member } };
    expect(buildBandModel('demo-shop', { ...f, sessionId: 'M' })).toEqual({ mode: 'none', viewer: { role: 'owner', coordinator: false, runId: 'r1' } });
    expect(buildBandModel('demo-shop', { ...f, sessionId: 'X' })).toEqual({ mode: 'none', viewer: { role: 'other-live', coordinator: false, runId: 'r1' } });
    // A plan that does not read still publishes no role (spec §4.5).
    expect(buildBandModel('demo-shop', { ...f, plan: 'not: [yaml', sessionId: 'M' })).toEqual({ mode: 'none', viewer: NO_VIEWER });
  });
  it("openTasksFrom: each seat's task claimed or in progress, the first by id", () => {
    expect(openTasksFrom({ T003: { status: 'in_progress', owner: 'main' }, T001: { status: 'claimed', owner: 'main' }, T002: { status: 'done', owner: 'ui' }, T004: { status: 'blocked', owner: 'ui' } } as never))
      .toEqual({ main: 'T001' });
  });
  it('a member file that does not read is ignored, never thrown on', () => {
    const member = j({ sessionId: 'backend', role: 'executor', runId: 'r1', task: 'T002', name: null, since: ago(20), hookSession: 'M' });
    const junk = {
      broken: '{oops', nothing: 'null', list: '[1]',
      unsafe: j({ sessionId: '../x', role: 'executor', runId: 'r1', task: 'T002', name: null, since: ago(20), hookSession: 'M' }),
      role: j({ sessionId: 'backend', role: 'boss', runId: 'r1', task: 'T002', name: null, since: ago(20), hookSession: 'M' }),
    };
    const f: BandFiles = { ...empty, plan, session: j({ sessionId: 'main', track: null }), execution: EXEC({ mode: 'sessions' }), sessionId: 'M' };
    // Only junk: M is no member, the run is another conversation's, and M sees its notice.
    expect(buildBandModel('demo-shop', { ...f, members: junk }))
      .toMatchObject({ mode: 'notice', kind: 'other-live', subject: 'run', runId: 'r1', viewer: { role: 'other-live', coordinator: false, runId: 'r1' } });
    // The junk beside a member that reads: M is still that member.
    expect(buildBandModel('demo-shop', { ...f, members: { ...junk, backend: member } }))
      .toMatchObject({ mode: 'work', sid: 'backend', current: { id: 'T002' }, viewer: { role: 'owner', coordinator: false, runId: 'r1' } });
  });
});

describe('buildBandModel · design', () => {
  const critique = j({ round: 1, version: 1, scope: 'full', proposals: [
    { n: 1, category: 'gap', severity: 'critical', section: 'riesgos', problem: 'p', change: 'c' },
    { n: 2, category: 'scope', severity: 'minor', section: 'alcance', problem: 'p', change: 'c' },
  ] });
  const changelog = j([{ version: 1, date: '2026-10-11', note: 'v1', words: 40, round: 0 }]);
  const designer = ownerOf('main', 'A', { via: 'design' });
  it('reports version, latest critique and the design url', () => {
    const d = design.replace('start_prompt:', 'artifact: https://claude.ai/artifact/des\nstart_prompt:');
    const m = buildBandModel('demo-shop', { ...empty, ...designer, design: d, changelog, critiques: { 'critique-r1.json': critique } });
    expect(m).toEqual({ mode: 'design', project: 'demo-shop', locale: 'es', version: 1, round: 1, proposals: 2, critical: 1, pending: 2, pendingCritical: 1, designUrl: 'https://claude.ai/artifact/des', viewer: OWNER });
  });
  it('counts the proposals pending from every round: not applied, not rewritten, not dismissed', () => {
    const r2 = j({ round: 2, version: 2, scope: 'changed', proposals: [{ n: 1, category: 'gap', severity: 'major', section: 'riesgos', problem: 'p', change: 'c' }] });
    const log = j([{ version: 1, date: '2026-10-11', note: 'v1', words: 40, round: 0 }, { version: 2, date: '2026-10-11', note: 'round 1: applied 1 — x', words: 40, round: 1 }]);
    const files = { ...empty, ...designer, design, changelog: log, critiques: { 'critique-r1.json': critique, 'critique-r2.json': r2 } };
    expect(buildBandModel('demo-shop', files)).toMatchObject({ round: 2, proposals: 1, pending: 2, pendingCritical: 0 });
    expect(buildBandModel('demo-shop', { ...files, dismissed: j({ 1: [2] }) })).toMatchObject({ pending: 1, pendingCritical: 0 });
    expect(buildBandModel('demo-shop', { ...files, dismissed: '{junk' })).toMatchObject({ pending: 2 });
  });
  it('the design line shows the pending proposals, in es and en, singular and none', () => {
    const line = (o: object, locale = 'es') => bandLine({ mode: 'design', project: 'p', locale, version: 3, round: 2, proposals: 4, critical: 1, pending: 2, pendingCritical: 1, designUrl: null, viewer: NO_VIEWER, ...o } as never, 0);
    expect(line({})).toBe('◆ DISEÑO · p · v3 · 2 pendientes · 1 crítica');
    expect(line({ pending: 1, pendingCritical: 0 })).toBe('◆ DISEÑO · p · v3 · 1 pendiente · 0 críticas');
    expect(line({ pending: 0, pendingCritical: 0 })).toBe('◆ DISEÑO · p · v3 · sin pendientes');
    expect(line({}, 'en')).toBe('◆ DESIGN · p · v3 · 2 pending · 1 critical');
    expect(line({ pending: 0, pendingCritical: 0 }, 'en')).toBe('◆ DESIGN · p · v3 · nothing pending');
    expect(line({ round: 0, pending: 0 })).toBe('◆ DISEÑO · p · v3 · sin crítica aún');
  });
  it('uses the highest round critique and ignores invalid ones', () => {
    const m = buildBandModel('demo-shop', { ...empty, ...designer, design, changelog, critiques: { 'critique-r1.json': critique, 'critique-r2.json': '{bad' } });
    expect(m).toMatchObject({ round: 1, proposals: 2 });
  });
  it('hides the band for approved designs and when nothing exists, keeping the language it knows', () => {
    expect(buildBandModel('demo-shop', { ...empty, ...designer, design: design.replace('start_prompt:', 'status: approved\nstart_prompt:') })).toEqual({ mode: 'none', locale: 'es', viewer: OWNER });
    expect(buildBandModel('demo-shop', empty)).toEqual({ mode: 'none', viewer: NO_VIEWER });
  });
  it('keeps the plan language while a plan has no binding yet', () => {
    expect(buildBandModel('demo-shop', { ...empty, plan })).toEqual({ mode: 'none', locale: 'es', viewer: NO_VIEWER });
  });
  it('work mode wins over design mode', () => {
    const m = buildBandModel('demo-shop', { ...empty, design, plan, session: j({ sessionId: 'main', track: null }), ...ownerOf('main') });
    expect(m.mode).toBe('work');
  });
  it('a draft is drawn only for the conversation bound to it by design, and a parked one for nobody (K3-13)', () => {
    const f = { ...empty, design, changelog };
    expect(buildBandModel('demo-shop', f)).toEqual({ mode: 'none', locale: 'es', viewer: NO_VIEWER });
    expect(buildBandModel('demo-shop', { ...f, ...designer }).mode).toBe('design');
    expect(buildBandModel('demo-shop', { ...f, ...designer, sessionId: 'B' }).mode).not.toBe('design');
    expect(buildBandModel('demo-shop', { ...f, ...ownerOf('main', 'A') }).mode).not.toBe('design');
    const parked = design.replace('start_prompt:', 'status: parked\nstart_prompt:');
    expect(buildBandModel('demo-shop', { ...f, ...designer, design: parked })).toEqual({ mode: 'none', locale: 'es', viewer: OWNER });
  });
});

describe('buildBandModel · automatic decisions', () => {
  const designer = ownerOf('main', 'A', { via: 'design' });
  const recent = () => j({
    ts: new Date(Date.now() - 60_000).toISOString(), scope: 'demo', count: 3, autonomy: 'auto', last: [],
    lastMajor: { n: 5, point: 'design-approve', what: 'diseño aprobado (v4)', chosen: 'approve', ts: new Date().toISOString() },
  });
  it('adds the count and the last major decision to a drawn band', () => {
    const m = buildBandModel('demo-shop', { ...empty, ...designer, design, decisions: recent() });
    expect(m).toMatchObject({ mode: 'design', auto: { count: 3, lastMajor: 'diseño aprobado (v4)' } });
    expect(bandLine(m, Date.now())).toMatch(/ · ⚑ auto · 3 · diseño aprobado \(v4\)$/);
  });
  it('leaves it out when stale or invalid, and draws nothing without a band', () => {
    const stale = j({ ts: '2020-01-01T00:00:00Z', scope: 'x', count: 1, autonomy: 'auto', last: [], lastMajor: null });
    expect(buildBandModel('demo-shop', { ...empty, ...designer, design, decisions: stale })).not.toHaveProperty('auto');
    expect(buildBandModel('demo-shop', { ...empty, ...designer, design, decisions: 'nope' })).not.toHaveProperty('auto');
    expect(buildBandModel('demo-shop', { ...empty, decisions: recent() })).toEqual({ mode: 'none', viewer: NO_VIEWER });
  });
  it('without a major decision the band shows only the count', () => {
    const noMajor = j({ ts: new Date().toISOString(), scope: 'x', count: 2, autonomy: 'unattended', last: [], lastMajor: null });
    expect(bandLine(buildBandModel('demo-shop', { ...empty, ...designer, design, decisions: noMajor }), Date.now())).toMatch(/ · ⚑ auto · 2$/);
  });
});

describe('buildBandModel · notices (B-02, B-07, K3-13, K5-02)', () => {
  const session = j({ sessionId: 'backend', track: 'backend' });
  const states = { T002: j({ status: 'in_progress', owner: 'backend', startedAt: ago(30) }) };
  /** A is bound to the checkout seat backend, with T002 in progress; B looks. */
  const withA = (over: object = {}): BandFiles => ({ ...empty, plan, session, states, bindings: { '.': bound('backend', 'A', over) }, sessionId: 'B' });
  it('another live conversation bound to the seat: a notice with its seat and its task', () => {
    expect(buildBandModel('demo-shop', withA())).toEqual({
      mode: 'notice', project: 'demo-shop', locale: 'es', kind: 'other-live', subject: 'task', seat: 'backend', task: 'T002', title: 'API de pedidos',
      since: expect.any(String), runId: null, roadmapUrl: 'https://claude.ai/artifact/abc', key: 'task:T002',
      viewer: { role: 'other-live', coordinator: false, runId: null },
    });
    expect(buildBandModel('demo-shop', { ...withA(), states: {} })).toMatchObject({ mode: 'notice', kind: 'other-live', task: null, title: null, key: 'seat:backend' });
  });
  it('an earlier conversation that left a task: the offer for 24 hours, then nothing (criterion 2)', () => {
    const ended = ago(120);
    expect(buildBandModel('demo-shop', withA({ endedAt: ended, endReason: 'clear' }))).toMatchObject({
      mode: 'notice', kind: 'previous', subject: 'task', seat: 'backend', task: 'T002', title: 'API de pedidos', since: ended, key: 'task:T002',
      viewer: { role: 'previous', coordinator: false, runId: null },
    });
    expect(buildBandModel('demo-shop', withA({ seenAt: ago(25 * 60 + 1), endedAt: ago(25 * 60), endReason: 'clear' }))).toMatchObject({ mode: 'none', viewer: { role: 'none' } });
    // Nothing to take up: the seat has no task in progress.
    expect(buildBandModel('demo-shop', { ...withA({ endedAt: ended, endReason: 'clear' }), states: {} })).toMatchObject({ mode: 'none', viewer: { role: 'previous' } });
  });
  it('another live conversation bound for the design: a design notice of its own, never «bound to the roadmap» (M3)', () => {
    const f: BandFiles = { ...empty, plan, design, session: j({ sessionId: 'main' }), bindings: { '.': bound('main', 'D', { via: 'design' }) }, sessionId: 'X' };
    const m = buildBandModel('demo-shop', f);
    expect(m).toMatchObject({ mode: 'notice', kind: 'other-live', subject: 'design', seat: 'main', task: null, title: null, key: 'design:demo-shop',
      viewer: { role: 'other-live', coordinator: false, runId: null } });
    expect(bandLine(m, Date.now())).toBe('◦ otra sesión (main) trabaja en el diseño · hace 1 min');
  });
  it('an earlier conversation on a draft: the design offer; a parked design, or another live one on a design without a plan, draws nothing', () => {
    const f: BandFiles = { ...empty, design, bindings: { '.': bound('main', 'A', { via: 'design', endedAt: ago(60), endReason: 'prompt_input_exit' }) }, sessionId: 'B' };
    expect(buildBandModel('demo-shop', f)).toMatchObject({ mode: 'notice', kind: 'previous', subject: 'design', seat: 'main', task: null, key: 'design:demo-shop', locale: 'es', roadmapUrl: null });
    expect(buildBandModel('demo-shop', { ...f, design: design.replace('start_prompt:', 'status: parked\nstart_prompt:') }).mode).toBe('none');
    expect(buildBandModel('demo-shop', { ...f, bindings: { '.': bound('main', 'A', { via: 'design' }) } }).mode).toBe('none');
  });
  it("someone else's execution: running is other-live; stopped, or without its coordinator, is previous for 24 hours (B-07, K5-02)", () => {
    const f = (over: object, extra: Partial<BandFiles> = {}): BandFiles => ({ ...empty, plan, sessionId: 'B', execution: EXEC(over), ...extra });
    expect(buildBandModel('demo-shop', f({}))).toMatchObject({
      mode: 'notice', kind: 'other-live', subject: 'run', seat: null, task: null, runId: 'r1', integrated: 1, total: 2, stopReason: null, key: 'run:r1', joinable: true,
      viewer: { role: 'other-live', coordinator: false, runId: 'r1' },
    });
    const moved = ago(60);
    const stalled = { active: false, stopReason: 'stalled', stallReason: 'x', lastStepAt: moved };
    expect(buildBandModel('demo-shop', f(stalled))).toMatchObject({ mode: 'notice', kind: 'previous', subject: 'run', stopReason: 'stalled', since: moved, viewer: { role: 'previous', runId: 'r1' } });
    const coordinatorLive = j({ sessionId: 's1', role: 'coordinator', runId: 'r1', task: null, event: 'SessionEnd', ts: ago(5), agents: [], ended: true });
    expect(buildBandModel('demo-shop', f({}, { coordinatorLive }))).toMatchObject({ mode: 'notice', kind: 'previous', subject: 'run', stopReason: null });
    expect(buildBandModel('demo-shop', f({ ...stalled, lastStepAt: ago(25 * 60) })).mode).toBe('none');
    expect(buildBandModel('demo-shop', f({ ...stalled, closedAt: ago(1), closedBy: 'close' })).mode).toBe('none');
    // Its coordinator still sees the run band.
    expect(buildBandModel('demo-shop', { ...f(stalled), sessionId: 's1' }).mode).toBe('run');
  });
  it('an active run whose coordinator went silent (no step nor signal for 12 minutes, no agent running) has no coordinator (M4)', () => {
    const f = (over: object, extra: Partial<BandFiles> = {}): BandFiles => ({ ...empty, plan, sessionId: 'B', execution: EXEC(over), ...extra });
    // Killed three days ago without a SessionEnd: the offer to close it, which only fills /forge:stop (stopReason null).
    const dead = ago(3 * 24 * 60);
    expect(buildBandModel('demo-shop', f({ lastStepAt: dead, startedAt: ago(3 * 24 * 60 + 60) }))).toMatchObject({
      mode: 'notice', kind: 'previous', subject: 'run', runId: 'r1', stopReason: null, since: dead, viewer: { role: 'previous', coordinator: false, runId: 'r1' },
    });
    expect(buildBandModel('demo-shop', f({ lastStepAt: ago(13) }))).toMatchObject({ mode: 'notice', kind: 'previous', stopReason: null });
    // Silent but not stopped yet, or waiting on an agent it started: still running, coordinated by another session.
    expect(buildBandModel('demo-shop', f({ lastStepAt: ago(8) }))).toMatchObject({ mode: 'notice', kind: 'other-live', subject: 'run' });
    const waiting = j({ sessionId: 's1', role: 'coordinator', runId: 'r1', task: null, event: 'SubagentStart', ts: ago(20), agents: [{ id: 'a1', type: 'forge:forge-impl', since: ago(20) }], ended: false });
    expect(buildBandModel('demo-shop', f({ lastStepAt: ago(20) }, { coordinatorLive: waiting }))).toMatchObject({ mode: 'notice', kind: 'other-live' });
    // A fresh signal keeps it alive whatever the last step; a run that never stepped counts from its start.
    const fresh = j({ sessionId: 's1', role: 'coordinator', runId: 'r1', task: null, event: 'PostToolUse', ts: ago(1), agents: [], ended: false });
    expect(buildBandModel('demo-shop', f({ lastStepAt: ago(60) }, { coordinatorLive: fresh }))).toMatchObject({ mode: 'notice', kind: 'other-live' });
    expect(buildBandModel('demo-shop', f({ lastStepAt: null, startedAt: ago(5) }))).toMatchObject({ mode: 'notice', kind: 'other-live' });
    expect(buildBandModel('demo-shop', f({ lastStepAt: null, startedAt: ago(13) }))).toMatchObject({ mode: 'notice', kind: 'previous', stopReason: null });
    // Its coordinator still sees it as its own run.
    expect(buildBandModel('demo-shop', { ...f({ lastStepAt: dead }), sessionId: 's1' })).toMatchObject({ mode: 'run', viewer: { coordinator: true } });
  });
  it('an active run no session is bound to has no coordinator at once: the previous notice, which offers [Resume] (final review, item 9)', () => {
    const f: BandFiles = { ...empty, plan, sessionId: 'B', execution: EXEC({ hookSession: null, lastStepAt: ago(1) }) };
    expect(buildBandModel('demo-shop', f)).toMatchObject({
      mode: 'notice', kind: 'previous', subject: 'run', runId: 'r1', stopReason: null, viewer: { role: 'previous', coordinator: false, runId: 'r1' },
    });
  });
  it("an open coordinator conversation, waiting 20 minutes on the person, keeps its run: its own live binding, read raw (no pid check)", () => {
    const f = (coordinatorBindings: Record<string, string>): BandFiles => ({ ...empty, plan, sessionId: 'B', execution: EXEC({ lastStepAt: ago(20) }), coordinatorBindings });
    // Bound in any project and seat, with any via; the band cannot check a pid, so a dead one does not end it here.
    expect(buildBandModel('demo-shop', f({ 'demo-shop/.': bound('main', 's1', { via: 'forge-run' }) }))).toMatchObject({ mode: 'notice', kind: 'other-live', subject: 'run' });
    expect(buildBandModel('demo-shop', f({ 'other/main-2': bound('main-2', 's1', { pid: 2147483646 }) }))).toMatchObject({ mode: 'notice', kind: 'other-live', subject: 'run' });
    // Ended, lapsed, or another conversation's: no coordinator after 12 minutes, the offer to resume it.
    expect(buildBandModel('demo-shop', f({ 'demo-shop/.': bound('main', 's1', { endedAt: ago(2), endReason: 'other' }) }))).toMatchObject({ mode: 'notice', kind: 'previous', subject: 'run', stopReason: null });
    expect(buildBandModel('demo-shop', f({ 'demo-shop/.': bound('main', 's1', { seenAt: ago(6) }) }))).toMatchObject({ mode: 'notice', kind: 'previous', subject: 'run' });
    expect(buildBandModel('demo-shop', f({ 'demo-shop/.': bound('main', 'B') }))).toMatchObject({ mode: 'notice', kind: 'previous', subject: 'run' });
  });
  it('only a plan run can be joined: the notice of an ephemeral one says so (I1, swarm join refuses it)', () => {
    expect(buildBandModel('demo-shop', { ...empty, plan, sessionId: 'X', execution: EPHEMERAL() }))
      .toMatchObject({ mode: 'notice', kind: 'other-live', subject: 'run', runId: 'e1', joinable: false });
    expect(buildBandModel('demo-shop', { ...empty, plan, sessionId: 'X', execution: EXEC() })).toMatchObject({ mode: 'notice', subject: 'run', joinable: true });
  });
  it('the notice lines, in es and en', () => {
    const n = (o: object, locale = 'es') => bandLine({ mode: 'notice', project: 'demo-shop', locale, kind: 'other-live', subject: 'task', seat: 'main', task: 'T002', title: 'API de pedidos',
      since: '2026-10-15T11:57:00.000Z', runId: null, roadmapUrl: null, key: 'task:T002', viewer: NO_VIEWER, ...o } as never, Date.parse('2026-10-15T12:00:00.000Z'));
    expect(n({})).toBe('◦ otra sesión (main) trabaja en T002 · hace 3 min');
    expect(n({}, 'en')).toBe('◦ another session (main) works on T002 · 3 min ago');
    expect(n({ task: null, title: null })).toBe('◦ otra sesión (main) está ligada al roadmap · hace 3 min');
    expect(n({ subject: 'design', task: null, title: null, key: 'design:demo-shop' })).toBe('◦ otra sesión (main) trabaja en el diseño · hace 3 min');
    expect(n({ subject: 'design', task: null, title: null, key: 'design:demo-shop' }, 'en')).toBe('◦ another session (main) is working on the design · 3 min ago');
    expect(n({ since: null })).toBe('◦ otra sesión (main) trabaja en T002');
    expect(n({ subject: 'run', seat: null, task: null, title: null, runId: 'r1', integrated: 3, total: 12 })).toBe('◦ ejecución de forge en curso, la coordina otra sesión · 3/12');
    expect(n({ kind: 'previous', since: '2026-10-15T10:00:00.000Z' })).toBe('◌ quedó a medias: T002 API de pedidos · hace 2 h');
    expect(n({ kind: 'previous', since: '2026-10-15T10:00:00.000Z' }, 'en')).toBe('◌ left in progress: T002 API de pedidos · 2 h ago');
    expect(n({ kind: 'previous', title: 'Un título muy largo que pasa de cuarenta caracteres con holgura' })).toContain('Un título muy largo que pasa de cuarent…');
    expect(n({ kind: 'previous', subject: 'design', task: null, title: null })).toBe('◌ diseño a medias: demo-shop · hace 3 min');
    // M7: the project is a folder name nobody checks: one line, without controls, at most 40 characters.
    const c = (...codes: number[]) => String.fromCharCode(...codes);
    expect(n({ kind: 'previous', subject: 'design', task: null, title: null, project: `a|b${c(0x1b)}[2J${c(0x202e)}${'x'.repeat(60)}` }))
      .toBe(`◌ diseño a medias: a|b [2J${'x'.repeat(32)}… · hace 3 min`);
    expect(n({ kind: 'previous', subject: 'run', task: null, title: null, integrated: 3, total: 12, stopReason: 'stalled', since: '2026-10-13T12:00:00.000Z' })).toBe('◌ ejecución parada: 3/12 integradas · hace 2 d');
    expect(n({ kind: 'previous', subject: 'run', task: null, title: null, integrated: 3, total: 12, stopReason: null }, 'en')).toBe('◌ execution without a coordinator: 3/12 integrated · 3 min ago');
  });
  it('a title loses its control and bidi characters, in a notice and in the work band', () => {
    const c = (...codes: number[]) => String.fromCharCode(...codes);
    // A bell and a C1 CSI become spaces; the bidi overrides and isolates go.
    const dirty = `API${c(0x202e)} de${c(0x07)}pedidos${c(0x2066)}${c(0x9b)}${c(0x2069)}${c(0x202a, 0x202b, 0x202c, 0x202d, 0x2067, 0x2068)}`;
    expect(clip(dirty)).toBe('API de pedidos');
    expect(clip(`${c(0x1b)}[31m${'x'.repeat(50)}`)).toBe(`[31m${'x'.repeat(35)}…`);
    const notice = bandLine({ mode: 'notice', project: 'demo-shop', locale: 'es', kind: 'previous', subject: 'task', seat: 'main', task: 'T002', title: dirty,
      since: null, runId: null, roadmapUrl: null, key: 'task:T002', viewer: NO_VIEWER } as never, 0);
    expect(notice).toBe('◌ quedó a medias: T002 API de pedidos');
    const work = bandLine({ mode: 'work', project: 'p', locale: 'es', sid: 'main', track: null, roadmapUrl: null, current: { id: 'T002', title: dirty },
      trackDone: 0, trackTotal: 2, percent: 0, inbox: 0, escalation: false, phase: null, cells: 'ap', swarm: false, run: null, viewer: NO_VIEWER } as never, 0);
    expect(work).toBe('● main · T002 API de pedidos · tareas 0/2 · global 0 %');
  });
});

describe('buildBandModel · the run band carries the seat, its messages, the progress and the phase (E-10)', () => {
  const coordinator = (extra: Partial<BandFiles> = {}): BandFiles => ({
    ...empty, plan, session: j({ sessionId: 'main', track: 'backend' }), execution: EXEC(), sessionId: 's1',
    messages: { m1: j({ ts: '2026-10-11T10:01:00Z', from: 'ui', to: 'main-2', type: 'overlap_warning', taskId: 'T002', text: 'x', status: 'open' }) },
    ...extra,
  });
  it("the seat is the coordinator's own binding (seats/main-2), never session.json; without a binding, the run's coordinator", () => {
    expect(buildBandModel('demo-shop', coordinator({ bindings: { 'main-2': bound('main-2', 's1', { via: 'forge-run' }) } }))).toMatchObject({
      mode: 'run', sid: 'main-2', inbox: 1, escalation: false, percent: 0, phase: { index: 1, total: 2, name: 'Base' },
      viewer: { role: 'owner', coordinator: true, runId: 'r1' },
    });
    expect(buildBandModel('demo-shop', coordinator())).toMatchObject({ mode: 'run', sid: 'main', inbox: 0, escalation: false });
  });
  it("of several bindings the live one of its own renewed last: another session's, or one that ended, never gives the seat", () => {
    const bindings = {
      'main-2': bound('main-2', 's1', { via: 'forge-run', seenAt: ago(5) }),
      'main-3': bound('main-3', 's1', { via: 'forge-run', seenAt: ago(2) }),
      'main-4': bound('main-4', 'someone-else', { via: 'forge-run', seenAt: ago(0) }),
      'main-5': bound('main-5', 's1', { via: 'forge-run', seenAt: ago(0), endedAt: ago(0), endReason: 'clear' }),
    };
    expect(buildBandModel('demo-shop', coordinator({ bindings }))).toMatchObject({ mode: 'run', sid: 'main-3' });
    // Only an ended binding of its own, or no .waypoint/ files at all: the run's coordinator.
    expect(buildBandModel('demo-shop', coordinator({ bindings: { 'main-5': bindings['main-5'] } }))).toMatchObject({ mode: 'run', sid: 'main' });
    const { session: _session, ...bare } = coordinator();
    expect(buildBandModel('demo-shop', { ...bare, messages: {} })).toMatchObject({ mode: 'run', sid: 'main', inbox: 0 });
  });
  it("an open escalation of its seat sets the run band's escalation, and its percent is the plan's", () => {
    const escalation = j({ ts: '2026-10-11T10:02:00Z', from: 'main', to: 'ui', type: 'escalation', taskId: 'T002', text: 'decide', status: 'open' });
    const done = { T001: j({ status: 'done', owner: 'main', startedAt: ago(90), doneAt: ago(60) }) };
    expect(buildBandModel('demo-shop', coordinator({ messages: { e1: escalation }, states: done }))).toMatchObject({ mode: 'run', sid: 'main', escalation: true, percent: 17 });
  });
  it('without a plan the run band has no progress nor phase', () => {
    const { plan: _plan, ...noPlan } = coordinator();
    expect(buildBandModel('demo-shop', noPlan)).toMatchObject({ mode: 'run', sid: 'main', percent: 0, phase: null });
  });
});

describe('buildBandModel · every slot of the run, at most 12, and those waiting to integrate (E-04, F-10)', () => {
  const running = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => {
    const id = `T${String(i + 1).padStart(3, '0')}`;
    return [id, { status: 'running', stage: 'implement', round: 1, worktree: `/w${i}`, branch: `task/${id}`, executor: 'subagents', attempts: 0, agent: null,
      startedAt: ago(10), updatedAt: ago(1), stageSince: ago(1), detail: null }];
  }));
  const coordinator = (tasks: object): BandFiles => ({ ...empty, plan, session: j({ sessionId: 'main', track: null }), sessionId: 's1', execution: EXEC({ parallel: 14, tasks }) });
  it('the run band carries every slot: five of five, and twelve of fourteen', () => {
    const five = buildBandModel('demo-shop', coordinator(running(5)));
    expect(five.mode === 'run' && five.slots.map(s => s.task)).toEqual(['T001', 'T002', 'T003', 'T004', 'T005']);
    const many = buildBandModel('demo-shop', coordinator(running(14)));
    expect(many).toMatchObject({ mode: 'run', running: 14 });
    expect(many.mode === 'run' && many.slots.length).toBe(12);
  });
  it('counts the accepted tasks waiting to integrate', () => {
    const tasks = { ...running(1), T009: { ...running(1).T001, status: 'accepted', worktree: '/w9', branch: 'task/T009' } };
    expect(buildBandModel('demo-shop', coordinator(tasks))).toMatchObject({ mode: 'run', queued: 1 });
  });
});
