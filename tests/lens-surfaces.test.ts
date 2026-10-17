import { describe, it, expect } from 'vitest';
import { modeLabels, ownActive, spinnerText, statusText, surfaceEvents, type SurfaceTexts } from '../src/lens/surfaces.js';
import type { PanelModel } from '../src/lens/model.js';

type Row = PanelModel['activities'][number];
const T: SurfaceTexts = {
  stage: { implement: 'implementar', review: 'revisar', validate: 'validar' }, validating: 'validando', integrating: 'integrando', integratedN: 'integradas',
  subagentsN: n => `${n} ${n === 1 ? 'subagente' : 'subagentes'}`,
  toastAccepted: (task, round) => (round ? `${task} · aceptada en la ronda ${round}` : `${task} · aceptada`),
  toastVerdict: (task, action, counts) => `${task} · veredicto ${action}${counts ? ` · ${counts}` : ''}`,
  toastRound: (task, n) => `${task} · ronda ${n}`,
  toastIntegrated: (task, done, total) => `${task} integrada · ${done}/${total}`,
  runFinished: (done, total) => `Ejecución terminada: ${done}/${total} integradas`,
  runStopped: why => (why ? `Ejecución parada: ${why}` : 'Ejecución parada'),
};
const EMPTY: PanelModel = {
  locale: 'es', waypoint: null, superpowers: null, todos: null, subagents: [], tool: null, turnSeconds: null, ccTasks: null,
  forge: null, infinite: null, decisions: null, execution: null, proposals: [], mainModel: null, activities: [], waiting: null, jobs: [], usage: null,
};
const ACT = (over: Partial<Row> = {}): Row => ({
  key: 'T002', kind: 'forge', owner: 'own', dim: false, done: false, slot: false, expanded: true, stopped: false, task: 'T002', project: null, title: null,
  path: 'medium', stage: 'review', round: 2, cap: 4, verdict: null, job: null, seconds: 60, agents: [], ...over,
});
const EXEC = (over: Partial<NonNullable<PanelModel['execution']>> = {}): NonNullable<PanelModel['execution']> => ({
  runId: 'r1', mode: 'subagents', parallel: 3, branch: 'b', active: true, stopReason: null, stallReason: null, coordinator: { liveness: 'alive', lastSeen: null },
  integrated: 3, total: 12, slots: [], manual: [], queued: [], conflicts: [], blocked: [], orphans: [], elapsedSeconds: 1500, finished: [], ...over,
});
const USAGE = { scope: 'session' as const, tokens: 10, costUsd: 1.2, partial: false, sessionPartial: false, officialUsd: null, drift: false, session: null, groups: [], tracking: null, withoutForge: null, pricesAsOf: '2026-10-12' };

describe('the one-line surfaces of lens (step 4 of §4.6)', () => {
  it('the status line sums up this session\'s work in 100 columns, and is null without it', () => {
    const m = { ...EMPTY, activities: [ACT()], subagents: [1, 2, 3].map(i => ({ id: `a${i}`, type: 'Explore', seconds: 5 })), usage: USAGE };
    expect(statusText(m, T, 'none')).toBe('lens · T002 revisar r2 · 3 subagentes · 1,20 $');
    expect(statusText({ ...EMPTY, activities: [ACT({ owner: 'other' })] }, T, 'none')).toBeNull();
    expect(statusText({ ...EMPTY, execution: EXEC() }, T, 'owner')).toBe('lens · ► 3/12 integradas');
    expect(statusText({ ...EMPTY, execution: EXEC() }, T, 'other-live')).toBeNull();
    expect(ownActive({ ...EMPTY, activities: [ACT({ stopped: true })] }, 'none')).toBe(false);
  });
  it('the spinner names the expanded task in progress, a job instead of its stage; the modes add forge auto and the infinite run', () => {
    expect(spinnerText({ ...EMPTY, activities: [ACT()] }, T)).toBe('T002 · revisar r2');
    expect(spinnerText({ ...EMPTY, activities: [ACT({ job: { name: 'review-prep', seconds: 5 }, round: null })] }, T)).toBe('T002 · validando');
    expect(spinnerText(EMPTY, T)).toBeNull();
    expect(modeLabels({ ...EMPTY, activities: [ACT({ autonomy: 'auto' })], infinite: { cycle: 2, cyclesMax: 5, hoursLeft: null, active: true, autoApproved: [] } })).toEqual(['forge auto', '∞ 2/5']);
    expect(modeLabels(EMPTY)).toEqual([]);
  });
  it('a verdict, a new round and a task integrated in a run of its own make toasts, never with the score (K4-05)', () => {
    const before = { ...EMPTY, activities: [ACT({ round: 1 })], execution: EXEC({ finished: [{ task: 'T001', seconds: 60 }] }) };
    const after = {
      ...EMPTY,
      activities: [ACT({ round: 2, verdict: { action: 'fix', score: 0.42, round: 1, findings: { critical: 1, important: 2, minor: 0 } } })],
      execution: EXEC({ integrated: 4, finished: [{ task: 'T003', seconds: 90 }, { task: 'T001', seconds: 60 }] }),
    };
    const moved = surfaceEvents(before, after, 'owner', T);
    expect(moved.toasts).toEqual(['T002 · veredicto fix · 1 C · 2 I', 'T002 · ronda 2', 'T003 integrada · 4/12']);
    expect(moved.toasts.join(' ')).not.toMatch(/0[.,]42/);
    expect(surfaceEvents(before, after, 'none', T).toasts).toEqual(['T002 · veredicto fix · 1 C · 2 I', 'T002 · ronda 2']);
    const accepted = { ...after, activities: [ACT({ round: 2, verdict: { action: 'accept', score: 0.9, round: 2, findings: null } })] };
    expect(surfaceEvents(after, accepted, 'none', T).toasts).toEqual(['T002 · aceptada en la ronda 2']);
    expect(surfaceEvents(null, after, 'owner', T)).toEqual({ toasts: [], ended: null });
  });
  it('a run of its own that ends after 20 minutes or more is said once, finished or stopped', () => {
    const live = { ...EMPTY, execution: EXEC() };
    expect(surfaceEvents(live, { ...EMPTY, execution: EXEC({ active: false, integrated: 12, stopReason: 'finished' }) }, 'owner', T).ended)
      .toEqual({ runId: 'r1', text: 'Ejecución terminada: 12/12 integradas' });
    expect(surfaceEvents(live, { ...EMPTY, execution: EXEC({ active: false, stopReason: 'stalled', stallReason: 'sin señal 12 min' }) }, 'owner', T).ended?.text)
      .toBe('Ejecución parada: sin señal 12 min');
    expect(surfaceEvents(live, { ...EMPTY, execution: EXEC({ active: false, elapsedSeconds: 600 }) }, 'owner', T).ended).toBeNull();
    expect(surfaceEvents(live, { ...EMPTY, execution: EXEC({ active: false }) }, 'other-live', T).ended).toBeNull();
  });
});
