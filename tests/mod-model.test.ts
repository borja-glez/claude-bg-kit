import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildBandModel, pickProject, type BandFiles } from '../src/mod/model.js';
import { bandLine } from '../src/mod/band-line.js';

const plan = readFileSync(new URL('./fixtures/plan.yaml', import.meta.url), 'utf8')
  .replace('version: "0.1"', 'version: "0.1"\nartifacts:\n  roadmap: https://claude.ai/artifact/abc');
const design = readFileSync(new URL('./fixtures/design.md', import.meta.url), 'utf8');
const j = (v: unknown) => JSON.stringify(v);
const empty = { states: {}, messages: {}, critiques: {} };

describe('pickProject', () => {
  it('prefers the project with a session, then the only one, then the newest', () => {
    expect(pickProject([{ name: 'a', hasSession: false, mtimeMs: 9 }, { name: 'b', hasSession: true, mtimeMs: 1 }])).toBe('b');
    expect(pickProject([{ name: 'a', hasSession: false, mtimeMs: 1 }])).toBe('a');
    expect(pickProject([{ name: 'a', hasSession: false, mtimeMs: 1 }, { name: 'b', hasSession: false, mtimeMs: 5 }])).toBe('b');
    expect(pickProject([])).toBeNull();
  });
  it('among several projects with a session, picks the newest', () => {
    expect(pickProject([
      { name: 'old', hasSession: true, mtimeMs: 1 },
      { name: 'free', hasSession: false, mtimeMs: 99 },
      { name: 'new', hasSession: true, mtimeMs: 7 },
    ])).toBe('new');
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
  it('run mode turns silent and then stopped when the coordinator stops stepping', () => {
    const old = (min: number) => EXEC({ lastStepAt: new Date(Date.now() - min * 60000).toISOString() });
    expect(buildBandModel('demo-shop', { ...empty, plan, execution: old(8) })).toMatchObject({ mode: 'run', worst: 'silent' });
    expect(buildBandModel('demo-shop', { ...empty, plan, execution: old(13) })).toMatchObject({ mode: 'run', worst: 'stopped' });
  });
  it('a member session keeps its work band; a finished execution shows no run band', () => {
    expect(buildBandModel('demo-shop', { ...empty, plan, session: j({ sessionId: 'x', track: 'backend', launchedBy: 'main' }), execution: EXEC() }).mode).toBe('work');
    expect(buildBandModel('demo-shop', { ...empty, plan, session: j({ sessionId: 'main', track: null }), execution: EXEC({ active: false, stopReason: 'finished' }) }).mode).toBe('work');
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
    expect(m).toEqual({ mode: 'design', project: 'demo-shop', locale: 'es', version: 1, round: 1, proposals: 2, critical: 1, designUrl: 'https://claude.ai/artifact/des' });
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
