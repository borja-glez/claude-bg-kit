import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildBandModel, pickProject, type BandFiles } from '../src/mod/model.js';

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
  it('shows the swarm mode in the coordinator checkout while the swarm is active or stalled', () => {
    const swarm = JSON.stringify({
      active: true, parallel: 5, mergeAuthorized: true, project: 'demo-shop', base: 'main', coordinator: 'main', hookSession: null,
      startedAt: '2026-10-11T10:00:00Z', lastTickAt: null, lastBlockTick: null, sleepUntil: null, stopReason: null, stallReason: null, notice: null,
      fronts: {
        backend: { status: 'running', session: null, launchedAt: null, currentTask: null, heartbeatAt: null, done: 1, total: 4, waitingFor: null, detail: null },
        ui: { status: 'conflict', session: null, launchedAt: null, currentTask: null, heartbeatAt: null, done: 0, total: 2, waitingFor: null, detail: 'x' },
      },
    });
    const m = buildBandModel('demo-shop', { ...files(), swarm });
    expect(m).toMatchObject({ mode: 'swarm', live: 1, parallel: 5, integrated: 0, tracks: 2, conflicts: 1, stalled: false });
    const finished = JSON.parse(swarm);
    expect(buildBandModel('demo-shop', { ...files(), swarm: JSON.stringify({ ...finished, active: false, stopReason: 'finished' }) }).mode).toBe('work');
    // A swarm of another project, or a member that sees the swarm file, stays in work mode.
    expect(buildBandModel('demo-shop', { ...files(), swarm: JSON.stringify({ ...finished, project: 'other' }) }).mode).toBe('work');
    const member = j({ sessionId: 'backend', track: 'backend', launchedBy: 'main' });
    expect(buildBandModel('demo-shop', { ...files(), session: member, swarm })).toMatchObject({ mode: 'work', swarm: true });
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
  it('hides the band for approved designs and when nothing exists', () => {
    expect(buildBandModel('demo-shop', { ...empty, design: design.replace('start_prompt:', 'status: approved\nstart_prompt:') })).toEqual({ mode: 'none' });
    expect(buildBandModel('demo-shop', empty)).toEqual({ mode: 'none' });
  });
  it('work mode wins over design mode', () => {
    const m = buildBandModel('demo-shop', { ...empty, design, plan, session: j({ sessionId: 'main', track: null }) });
    expect(m.mode).toBe('work');
  });
});
