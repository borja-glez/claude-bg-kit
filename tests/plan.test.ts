import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parsePlan, PlanError } from '../src/lib/plan.js';
import { planHash } from '../src/lib/sync.js';

const fixture = readFileSync(new URL('./fixtures/plan.yaml', import.meta.url), 'utf8');

function issuesOf(text: string): string[] {
  try { parsePlan(text); } catch (e) { if (e instanceof PlanError) return e.issues; throw e; }
  throw new Error('expected PlanError');
}

describe('parsePlan', () => {
  it('parses a valid plan and fills defaults', () => {
    const p = parsePlan(fixture);
    expect(p.project).toBe('demo-shop');
    expect(p.locale).toBe('es');
    expect(p.tasks).toHaveLength(6);
    expect(p.tasks[0].depends_on).toEqual([]);
    expect(p.tasks[5].zones).toEqual([]);
    expect(p.artifacts).toEqual({});
  });

  it('takes delicate as a boolean of a task (J-14)', () => {
    const p = parsePlan(fixture.replace('    estimate_min: 20\n', '    estimate_min: 20\n    delicate: true\n'));
    expect(p.tasks[0].delicate).toBe(true);
    expect(p.tasks[1].delicate).toBeUndefined();
    expect(issuesOf(fixture.replace('    estimate_min: 20\n', '    estimate_min: 20\n    delicate: "yes"\n')).some(i => i.startsWith('tasks.0.delicate'))).toBe(true);
  });

  it('reports every reference problem at once', () => {
    const bad = fixture
      .replace('track: ui\n    phase: F1', 'track: frontend\n    phase: F9')
      .replace('depends_on: [T004]', 'depends_on: [T404]');
    const issues = issuesOf(bad);
    expect(issues).toContain('task T003: unknown track frontend');
    expect(issues).toContain('task T003: unknown phase F9');
    expect(issues).toContain('task T006: unknown dependency T404');
  });

  it('detects dependency cycles', () => {
    const bad = fixture.replace('done_when: migración aplicada y test de modelo en verde',
      'done_when: x\n    depends_on: [T002]');
    expect(issuesOf(bad).some(i => i.startsWith('dependency cycle: '))).toBe(true);
  });

  it('rejects duplicate ids', () => {
    const bad = fixture.replace('id: T006', 'id: T005');
    expect(issuesOf(bad)).toContain('duplicate task id: T005');
  });

  it('rejects ids that are not valid database path segments', () => {
    const bad = fixture.replace('id: T001', 'id: "T 001/x"');
    expect(issuesOf(bad).some(i => i.startsWith('tasks.0.id:'))).toBe(true);
  });

  it('rejects ids that are not safe file names (colon, at, plus, tilde)', () => {
    for (const ch of [':', '@', '+', '~']) {
      const bad = fixture.replace('id: T001', `id: "T${ch}1"`);
      expect(issuesOf(bad).some(i => i.startsWith('tasks.0.id:'))).toBe(true);
    }
  });

  it('wraps YAML syntax errors', () => {
    const issues = issuesOf('project: [unclosed');
    expect(issues[0]).toMatch(/^YAML: /);
  });
});

describe('plan schema: the links to the design (G-25, K3-08)', () => {
  const base = readFileSync(new URL('./fixtures/plan.yaml', import.meta.url), 'utf8');
  it('accepts design_version, design_ref, goal and target', () => {
    const text = base.replace('version: "0.1"\n', 'version: "0.1"\ndesign_version: 7\n')
      .replace('    phases: [F1, F2]', '    phases: [F1, F2]\n    target: "2026-11-30"')
      .replace('  - { id: F1, name: Base, plan_status: committed }', '  - { id: F1, name: Base, plan_status: committed, goal: "orders can be placed" }')
      .replace('    title: Esquema de pedidos\n', '    title: Esquema de pedidos\n    design_ref: arquitectura\n');
    const p = parsePlan(text);
    expect(p.design_version).toBe(7);
    expect(p.versions[0].target).toBe('2026-11-30');
    expect(p.phases[0].goal).toBe('orders can be placed');
    expect(p.tasks[0].design_ref).toBe('arquitectura');
  });
  it('a plan without the new fields parses as before', () => {
    const p = parsePlan(base);
    expect(p).not.toHaveProperty('design_version');
    expect(p.versions[0]).toEqual({ id: '0.1', phases: ['F1', 'F2'] });
    expect(p.phases[0]).toEqual({ id: 'F1', name: 'Base', plan_status: 'committed' });
    expect(p.tasks[0]).not.toHaveProperty('design_ref');
  });
  it('refuses a target that is not a date, a design_ref that is not a slug, a goal over 300 characters and a design_version of 0', () => {
    for (const bad of [
      base.replace('    phases: [F1, F2]', '    phases: [F1, F2]\n    target: "next week"'),
      base.replace('    title: Esquema de pedidos\n', '    title: Esquema de pedidos\n    design_ref: "Arquitectura general"\n'),
      base.replace('  - { id: F1, name: Base, plan_status: committed }', `  - { id: F1, name: Base, plan_status: committed, goal: "${'g'.repeat(301)}" }`),
      base.replace('version: "0.1"\n', 'version: "0.1"\ndesign_version: 0\n'),
      // Carry 8: a target that is no day of the calendar.
      base.replace('    phases: [F1, F2]', '    phases: [F1, F2]\n    target: "2026-02-30"'),
      base.replace('    phases: [F1, F2]', '    phases: [F1, F2]\n    target: "2026-13-01"'),
    ]) expect(() => parsePlan(bad)).toThrow(PlanError);
  });
  it('carry 8: the design intro is a design_ref, and the hash of a plan without the new fields is as before', () => {
    const intro = parsePlan(base.replace('    title: Esquema de pedidos\n', '    title: Esquema de pedidos\n    design_ref: _intro\n'));
    expect(intro.tasks[0].design_ref).toBe('_intro');
    // The new keys absent: none of them reaches what planHash hashes, so a hash stored before wave 4 still matches.
    const hashed = JSON.stringify(parsePlan(base));
    for (const k of ['"design_version"', '"target"', '"goal"', '"design_ref"']) expect(hashed, k).not.toContain(k);
    expect(planHash(parsePlan(base.replace('version: "0.1"\n', 'version: "0.1"\ndesign_version: 7\n')))).not.toBe(planHash(parsePlan(base)));
  });
});
