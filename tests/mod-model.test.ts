import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildBandModel, pickProject, type BandFiles } from '../src/mod/model.js';
import { bandLine } from '../src/mod/band-line.js';

const plan = readFileSync(new URL('./fixtures/plan.yaml', import.meta.url), 'utf8')
  .replace('version: "0.1"', 'version: "0.1"\nartifacts:\n  roadmap: https://claude.ai/artifact/abc');
const design = readFileSync(new URL('./fixtures/design.md', import.meta.url), 'utf8');
const j = (v: unknown) => JSON.stringify(v);
const empty = { states: {}, messages: {}, critiques: {} };

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
});

describe('buildBandModel · work', () => {
  const session = j({ plan: 'docs/waypoint/demo-shop/plan.yaml', sessionId: 'backend', track: 'backend' });
  const files = (): BandFiles => ({
    ...empty, plan, session,
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
  const EXEC = (over: object = {}) => JSON.stringify({ runId: 'r1', kind: 'plan', mode: 'subagents', parallel: 3, project: 'demo-shop', base: 'main', branch: 'forge/run-demo-shop', mergeOnFinish: false, coordinator: 'main', hookSession: 's1', active: true, stopReason: null, stallReason: null,
    startedAt: new Date(Date.now() - 3600000).toISOString(), lastStepAt: new Date(Date.now() - 60000).toISOString(), lastBlockStep: null, sleepUntil: null,
    tasks: {
      T002: { status: 'running', stage: 'review', round: 2, worktree: '/w', branch: 'task/T002', executor: 'subagents', attempts: 0, agent: null, startedAt: new Date(Date.now() - 1200000).toISOString(), updatedAt: new Date().toISOString(), stageSince: new Date().toISOString(), detail: null },
      T001: { status: 'integrated', stage: 'integrate', round: 1, worktree: '/w1', branch: 'task/T001', executor: 'subagents', attempts: 0, agent: null, startedAt: new Date(Date.now() - 3000000).toISOString(), updatedAt: new Date().toISOString(), stageSince: new Date().toISOString(), detail: null },
    }, ...over });
  it('run mode: executor, slots with stage and round, progress and the worst liveness', () => {
    const m = buildBandModel('demo-shop', { ...empty, plan, session: j({ sessionId: 'main', track: null }), execution: EXEC() });
    expect(m).toMatchObject({ mode: 'run', executor: 'subagents', running: 1, parallel: 3, integrated: 1, total: 2, slots: [{ task: 'T002', stage: 'review', round: 2 }], worst: 'alive', stalled: false });
  });
  it('run mode draws a stalled run for 24 h after its last step, and never a closed one (C2, E-05)', () => {
    const files = (over: object) => ({ ...empty, plan, session: j({ sessionId: 'main', track: null }), execution: EXEC(over) });
    const stalled = (hoursAgo: number) => ({ active: false, stopReason: 'stalled', stallReason: 'x',
      lastStepAt: new Date(Date.now() - hoursAgo * 3600000).toISOString(), startedAt: new Date(Date.now() - (hoursAgo + 1) * 3600000).toISOString() });
    expect(buildBandModel('demo-shop', files(stalled(23)))).toMatchObject({ mode: 'run', stalled: true });
    expect(buildBandModel('demo-shop', files(stalled(25))).mode).not.toBe('run');
    expect(buildBandModel('demo-shop', files({ ...stalled(1), closedAt: new Date().toISOString(), closedBy: 'close' })).mode).not.toBe('run');
  });
  it('run mode turns silent and then stopped when the coordinator stops stepping', () => {
    const old = (min: number) => EXEC({ lastStepAt: new Date(Date.now() - min * 60000).toISOString() });
    expect(buildBandModel('demo-shop', { ...empty, plan, execution: old(8) })).toMatchObject({ mode: 'run', worst: 'silent' });
    expect(buildBandModel('demo-shop', { ...empty, plan, execution: old(13) })).toMatchObject({ mode: 'run', worst: 'stopped' });
  });
  it('run mode stays alive while the coordinator waits on a long agent', () => {
    const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();
    const execution = EXEC({ lastStepAt: ago(20), tasks: { T002: { status: 'running', stage: 'implement', round: 1, worktree: '/w', branch: 'task/T002', executor: 'subagents', attempts: 0, agent: 'forge-impl', startedAt: ago(25), updatedAt: ago(20), stageSince: ago(20), detail: null } } });
    const live = (ended: boolean) => ({ s1: j({ sessionId: 's1', role: 'coordinator', runId: 'r1', task: null, event: 'SubagentStart', ts: ago(20), agents: [{ id: 'a1', type: 'forge:forge-impl', since: ago(20) }], ended }) });
    expect(buildBandModel('demo-shop', { ...empty, plan, execution, live: live(false) })).toMatchObject({ mode: 'run', worst: 'alive' });
    expect(buildBandModel('demo-shop', { ...empty, plan, execution, live: live(true) })).toMatchObject({ mode: 'run', worst: 'stopped' });
  });
  it('a member session keeps its work band; a finished execution shows no run band', () => {
    expect(buildBandModel('demo-shop', { ...empty, plan, session: j({ sessionId: 'x', track: 'backend', launchedBy: 'main' }), execution: EXEC() }).mode).toBe('work');
    expect(buildBandModel('demo-shop', { ...empty, plan, session: j({ sessionId: 'main', track: null }), execution: EXEC({ active: false, stopReason: 'finished' }) }).mode).toBe('work');
  });
  it('a member of the execution names it in its work band; without an execution run is null', () => {
    const session = j({ sessionId: 'S2', track: 'backend', launchedBy: 'main' });
    const pubDoc = j({ task: 'T002', runId: 'r1', stage: 'implement', status: 'running', agent: null, round: 1, since: new Date().toISOString(), updatedAt: new Date().toISOString(), leaseUntil: new Date(Date.now() + 300000).toISOString(), by: 'S2', mode: 'sessions' });
    const m = buildBandModel('demo-shop', { ...empty, plan, session, execution: EXEC(), execTasks: { T002: pubDoc } });
    expect(m).toMatchObject({ mode: 'work', run: { coordinator: 'main', stage: 'implement' } });
    expect(bandLine(m, 0)).toContain('· implementar · de la ejecución de main');
    expect(buildBandModel('demo-shop', { ...empty, plan, session, execTasks: { T002: pubDoc } })).toMatchObject({ mode: 'work', run: null });
    expect(buildBandModel('demo-shop', { ...empty, plan, session, execution: EXEC(), execTasks: { T002: pubDoc.replace('"S2"', '"S3"') } })).toMatchObject({ run: null });
  });
  const LOOSE = 'fecha-corta-en-la-cabecera-del-listado-k3x9';
  const EPHEMERAL = (over: object = {}) => EXEC({ runId: 'e1', kind: 'ephemeral', project: 'loose', tasks: {
    [LOOSE]: { status: 'running', stage: 'implement', round: 1, worktree: '/w', branch: `task/${LOOSE}`, executor: 'subagents', attempts: 0, agent: null, startedAt: new Date(Date.now() - 600000).toISOString(), updatedAt: new Date().toISOString(), stageSince: new Date().toISOString(), detail: null },
    'otra-cosa-a7b2': { status: 'running', stage: 'review', round: 2, worktree: '/w2', branch: 'task/otra-cosa-a7b2', executor: 'subagents', attempts: 0, agent: null, startedAt: new Date(Date.now() - 600000).toISOString(), updatedAt: new Date().toISOString(), stageSince: new Date().toISOString(), detail: null },
  }, ...over });
  it('run mode for an ephemeral execution (project loose) in a project with a plan, slot ids clipped in the line', () => {
    const m = buildBandModel('demo-shop', { ...empty, plan, session: j({ sessionId: 'main', track: null }), execution: EPHEMERAL() });
    expect(m).toMatchObject({ mode: 'run', project: 'demo-shop', locale: 'es', roadmapUrl: 'https://claude.ai/artifact/abc', running: 2, integrated: 0, total: 2, stalled: false });
    const line = bandLine(m, 0);
    expect(line).toContain('▶ EJECUCIÓN · subagentes 2/3 · ');
    expect(line).toContain('fecha-corta-en-la-c… implementar');
    expect(line).toContain('otra-cosa-a7b2 revisar (r2)');
    expect(line).not.toContain(LOOSE);
  });
  it('an ephemeral execution that finished falls back to the work band; a member keeps its work band', () => {
    expect(buildBandModel('demo-shop', { ...empty, plan, session: j({ sessionId: 'main', track: null }), execution: EPHEMERAL({ active: false, stopReason: 'finished' }) }).mode).toBe('work');
    expect(buildBandModel('demo-shop', { ...empty, plan, session: j({ sessionId: 'x', track: 'backend', launchedBy: 'main' }), execution: EPHEMERAL() }).mode).toBe('work');
  });
  it('a plan execution of another project is not drawn as run mode', () => {
    expect(buildBandModel('demo-shop', { ...empty, plan, session: j({ sessionId: 'main', track: null }), execution: EXEC({ project: 'other-shop' }) }).mode).toBe('work');
  });
  it('run mode takes worst from a slot whose lease lapsed while the coordinator is alive', () => {
    const pub = JSON.stringify({ task: 'T002', runId: 'r1', stage: 'review', status: 'running', agent: null, round: 2, since: new Date().toISOString(), updatedAt: new Date().toISOString(), leaseUntil: new Date(Date.now() - 3600000).toISOString(), by: 'x', mode: 'subagents' });
    const m = buildBandModel('demo-shop', { ...empty, plan, execution: EXEC(), execTasks: { T002: pub } });
    expect(m).toMatchObject({ mode: 'run', worst: 'stopped' });
  });
  it('bandLine variants: stalled, stopped, sessions, round 1, en locale, unknown stage', () => {
    const run = (over: object, locale = 'es') => bandLine({ mode: 'run', project: 'p', locale, executor: 'subagents', running: 1, parallel: 2, integrated: 0, total: 4, slots: [{ task: 'T001', stage: 'implement', round: 1 }], worst: 'alive', stalled: false, roadmapUrl: null, ...over } as never, 0);
    expect(run({ stalled: true })).toBe('▶ EJECUCIÓN parada');
    expect(run({ worst: 'stopped' })).toBe('▶ EJECUCIÓN · subagentes 1/2 · T001 implementar · 0/4 · integradas 0 · ⚠ parada');
    expect(run({ executor: 'sessions' })).toBe('▶ EJECUCIÓN · sesiones 1/2 · T001 implementar · 0/4 · integradas 0');
    expect(run({}, 'en')).toBe('▶ EXECUTION · subagents 1/2 · T001 implement · 0/4 · integrated 0');
    expect(run({ worst: 'silent' }, 'en')).toContain('⚠ no signal');
    expect(run({ slots: [{ task: 'T009', stage: 'weird', round: 1 }] })).toContain('T009 weird');
  });
  it('draws the run band line with stages, rounds and the liveness warning', () => {
    expect(bandLine({ mode: 'run', project: 'p', locale: 'es', executor: 'subagents', running: 2, parallel: 3, integrated: 3, total: 12, slots: [{ task: 'T004', stage: 'review', round: 2 }, { task: 'T008', stage: 'implement', round: 1 }], worst: 'silent', stalled: false, roadmapUrl: null }, 0))
      .toBe('▶ EJECUCIÓN · subagentes 2/3 · T004 revisar (r2) · T008 implementar · 3/12 · integradas 3 · ⚠ sin señal');
  });
  it('marks a swarm member in work mode', () => {
    const m = buildBandModel('demo-shop', { ...files(), session: JSON.stringify({ sessionId: 'backend', track: 'backend', launchedBy: 'main' }) });
    expect(m).toMatchObject({ mode: 'work', swarm: true });
  });
  it('gives the current task phase, else the first phase not done, else null', () => {
    const own = j({ status: 'in_progress', owner: 'backend' });
    const f1 = Object.fromEntries(['T001', 'T002', 'T003'].map(id => [id, j({ status: 'done' })]));
    expect(buildBandModel('demo-shop', { ...empty, plan, session, states: { T004: own } }))
      .toMatchObject({ phase: { index: 2, total: 2, name: 'Checkout' } });
    expect(buildBandModel('demo-shop', { ...empty, plan, session, states: f1 }))
      .toMatchObject({ current: null, phase: { index: 2, total: 2, name: 'Checkout' } });
    const all = Object.fromEntries(plan.match(/id: T\d+/g)!.map(s => [s.slice(4), j({ status: 'done' })]));
    expect(buildBandModel('demo-shop', { ...empty, plan, session, states: all })).toMatchObject({ phase: null });
  });
  it('flags escalations involving this session', () => {
    const msg = (from: string, to: string, type = 'reply') => j({ ts: '2026-10-11T10:00:00Z', from, to, type, taskId: 'T002', text: 'x', status: 'open' });
    const m = buildBandModel('demo-shop', { ...empty, plan, session, messages: { a: msg('ui', 'backend', 'escalation') } });
    expect(m).toMatchObject({ mode: 'work', escalation: true });
  });
  it('survives corrupt files', () => {
    const m = buildBandModel('demo-shop', { ...empty, plan, session, states: { T001: '{oops' }, messages: { x: 'nope' } });
    expect(m).toMatchObject({ mode: 'work', percent: 0, inbox: 0, current: null });
    expect(buildBandModel('demo-shop', { ...empty, plan: 'not: [yaml', session })).toEqual({ mode: 'none' });
  });
});

describe('buildBandModel · design', () => {
  const critique = j({ round: 1, version: 1, scope: 'full', proposals: [
    { n: 1, category: 'gap', severity: 'critical', section: 'riesgos', problem: 'p', change: 'c' },
    { n: 2, category: 'scope', severity: 'minor', section: 'alcance', problem: 'p', change: 'c' },
  ] });
  const changelog = j([{ version: 1, date: '2026-10-11', note: 'v1', words: 40, round: 0 }]);
  it('reports version, latest critique and the design url', () => {
    const d = design.replace('start_prompt:', 'artifact: https://claude.ai/artifact/des\nstart_prompt:');
    const m = buildBandModel('demo-shop', { ...empty, design: d, changelog, critiques: { 'critique-r1.json': critique } });
    expect(m).toEqual({ mode: 'design', project: 'demo-shop', locale: 'es', version: 1, round: 1, proposals: 2, critical: 1, pending: 2, pendingCritical: 1, designUrl: 'https://claude.ai/artifact/des' });
  });
  it('counts the proposals pending from every round: not applied, not rewritten, not dismissed', () => {
    const r2 = j({ round: 2, version: 2, scope: 'changed', proposals: [{ n: 1, category: 'gap', severity: 'major', section: 'riesgos', problem: 'p', change: 'c' }] });
    const log = j([{ version: 1, date: '2026-10-11', note: 'v1', words: 40, round: 0 }, { version: 2, date: '2026-10-11', note: 'round 1: applied 1 — x', words: 40, round: 1 }]);
    const files = { ...empty, design, changelog: log, critiques: { 'critique-r1.json': critique, 'critique-r2.json': r2 } };
    expect(buildBandModel('demo-shop', files)).toMatchObject({ round: 2, proposals: 1, pending: 2, pendingCritical: 0 });
    expect(buildBandModel('demo-shop', { ...files, dismissed: j({ 1: [2] }) })).toMatchObject({ pending: 1, pendingCritical: 0 });
    expect(buildBandModel('demo-shop', { ...files, dismissed: '{junk' })).toMatchObject({ pending: 2 });
  });
  it('the design line shows the pending proposals, in es and en, singular and none', () => {
    const line = (o: object, locale = 'es') => bandLine({ mode: 'design', project: 'p', locale, version: 3, round: 2, proposals: 4, critical: 1, pending: 2, pendingCritical: 1, designUrl: null, ...o } as never, 0);
    expect(line({})).toBe('◆ DISEÑO · p · v3 · 2 pendientes · 1 crítica');
    expect(line({ pending: 1, pendingCritical: 0 })).toBe('◆ DISEÑO · p · v3 · 1 pendiente · 0 críticas');
    expect(line({ pending: 0, pendingCritical: 0 })).toBe('◆ DISEÑO · p · v3 · sin pendientes');
    expect(line({}, 'en')).toBe('◆ DESIGN · p · v3 · 2 pending · 1 critical');
    expect(line({ pending: 0, pendingCritical: 0 }, 'en')).toBe('◆ DESIGN · p · v3 · nothing pending');
    expect(line({ round: 0, pending: 0 })).toBe('◆ DISEÑO · p · v3 · sin crítica aún');
  });
  it('uses the highest round critique and ignores invalid ones', () => {
    const m = buildBandModel('demo-shop', { ...empty, design, changelog, critiques: { 'critique-r1.json': critique, 'critique-r2.json': '{bad' } });
    expect(m).toMatchObject({ round: 1, proposals: 2 });
  });
  it('hides the band for approved designs and when nothing exists, keeping the language it knows', () => {
    expect(buildBandModel('demo-shop', { ...empty, design: design.replace('start_prompt:', 'status: approved\nstart_prompt:') })).toEqual({ mode: 'none', locale: 'es' });
    expect(buildBandModel('demo-shop', empty)).toEqual({ mode: 'none' });
  });
  it('keeps the plan language while a plan has no session yet', () => {
    expect(buildBandModel('demo-shop', { ...empty, plan })).toEqual({ mode: 'none', locale: 'es' });
  });
  it('work mode wins over design mode', () => {
    const m = buildBandModel('demo-shop', { ...empty, design, plan, session: j({ sessionId: 'main', track: null }) });
    expect(m.mode).toBe('work');
  });
});

describe('buildBandModel · automatic decisions', () => {
  const recent = () => j({
    ts: new Date(Date.now() - 60_000).toISOString(), scope: 'demo', count: 3, autonomy: 'auto', last: [],
    lastMajor: { n: 5, point: 'design-approve', what: 'diseño aprobado (v4)', chosen: 'approve', ts: new Date().toISOString() },
  });
  it('adds the count and the last major decision to a drawn band', () => {
    const m = buildBandModel('demo-shop', { ...empty, design, decisions: recent() });
    expect(m).toMatchObject({ mode: 'design', auto: { count: 3, lastMajor: 'diseño aprobado (v4)' } });
    expect(bandLine(m, Date.now())).toMatch(/ · ⚑ auto · 3 · diseño aprobado \(v4\)$/);
  });
  it('leaves it out when stale or invalid, and draws nothing without a band', () => {
    const stale = j({ ts: '2020-01-01T00:00:00Z', scope: 'x', count: 1, autonomy: 'auto', last: [], lastMajor: null });
    expect(buildBandModel('demo-shop', { ...empty, design, decisions: stale })).not.toHaveProperty('auto');
    expect(buildBandModel('demo-shop', { ...empty, design, decisions: 'nope' })).not.toHaveProperty('auto');
    expect(buildBandModel('demo-shop', { ...empty, decisions: recent() })).toEqual({ mode: 'none' });
  });
  it('without a major decision the band shows only the count', () => {
    const noMajor = j({ ts: new Date().toISOString(), scope: 'x', count: 2, autonomy: 'unattended', last: [], lastMajor: null });
    expect(bandLine(buildBandModel('demo-shop', { ...empty, design, decisions: noMajor }), Date.now())).toMatch(/ · ⚑ auto · 2$/);
  });
});
