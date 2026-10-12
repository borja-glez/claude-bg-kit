import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parsePlan } from '../src/lib/plan.js';
import { buildVersionColumns } from '../src/lib/versions.js';
import type { PlanView, States } from '../src/lib/types.js';

const base = parsePlan(readFileSync(new URL('./fixtures/plan.yaml', import.meta.url), 'utf8'));
const clone = (): PlanView => JSON.parse(JSON.stringify(base));

describe('buildVersionColumns', () => {
  it('builds one column per phase of each version, with category fallback', () => {
    const cols = buildVersionColumns(base, {});
    expect(cols.map(c => [c.versionId, c.phase.id])).toEqual([['0.1', 'F1'], ['0.1', 'F2']]);
    expect(cols[0].categories).toEqual([{ name: '—', tasks: [
      { id: 'T001', title: 'Esquema de pedidos', status: 'free', track: 'backend' },
      { id: 'T002', title: 'API de pedidos', status: 'free', track: 'backend' },
      { id: 'T003', title: 'Maqueta de carrito', status: 'free', track: 'ui' },
    ] }]);
    expect(cols[0]).toMatchObject({ done: 0, total: 3 });
    expect(cols[0].phase).toEqual({ id: 'F1', name: 'Base', status: 'committed' });
    expect(cols[1].phase.status).toBe('provisional');
  });
  it('groups by category and uses metrics for phase status and done', () => {
    const p = clone();
    p.tasks[0].category = 'DB';
    p.tasks[1].category = 'API';
    const states: States = { T001: { status: 'done' }, T002: { status: 'in_progress' } };
    const c = buildVersionColumns(p, states)[0];
    expect(c.categories.map(x => x.name)).toEqual(['DB', 'API', '—']);
    expect(c.phase.status).toBe('in_progress');
    expect(c).toMatchObject({ done: 1, total: 3 });
  });
  it('puts phases in no version in a trailing null column', () => {
    const p = clone();
    p.phases.push({ id: 'F3', name: 'Extra', plan_status: 'provisional' });
    const cols = buildVersionColumns(p, {});
    expect(cols.map(c => [c.versionId, c.phase.id])).toEqual([['0.1', 'F1'], ['0.1', 'F2'], [null, 'F3']]);
    expect(cols[2]).toMatchObject({ categories: [], done: 0, total: 0 });
  });
  it('plan without versions puts every phase under null', () => {
    const p = clone();
    p.versions = [];
    const cols = buildVersionColumns(p, {});
    expect(cols.map(c => [c.versionId, c.phase.id])).toEqual([[null, 'F1'], [null, 'F2']]);
  });
  it('ignores version phases that do not exist and orders by plan.phases within a version', () => {
    const p = clone();
    p.versions = [{ id: 'v', phases: ['F2', 'GHOST', 'F1'] }];
    expect(buildVersionColumns(p, {}).map(c => c.phase.id)).toEqual(['F1', 'F2']);
  });
  it('filters listed tasks only, keeping done/total and empty columns', () => {
    const states: States = { T001: { status: 'done' } };
    const cols = buildVersionColumns(base, states, { statuses: ['done'] });
    expect(cols[0].categories[0].tasks.map(t => t.id)).toEqual(['T001']);
    expect(cols[0]).toMatchObject({ done: 1, total: 3 });
    expect(cols[1].categories).toEqual([]);
    expect(cols[1].total).toBe(3);
    const ui = buildVersionColumns(base, {}, { track: 'ui' });
    expect(ui[0].categories[0].tasks.map(t => t.id)).toEqual(['T003']);
  });
});
