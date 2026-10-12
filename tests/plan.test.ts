import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parsePlan, PlanError } from '../src/lib/plan.js';

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
