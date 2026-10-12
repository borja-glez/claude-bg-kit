import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parsePlan } from '../src/lib/plan.js';
import { availableTasks, nextTask, unlockedBy } from '../src/lib/deps.js';
import { compactTs, eventId, sessionIdFrom } from '../src/lib/ids.js';
import type { States } from '../src/lib/types.js';

const plan = parsePlan(readFileSync(new URL('./fixtures/plan.yaml', import.meta.url), 'utf8'));

describe('availableTasks', () => {
  it('offers only free, unlocked tasks in phase then plan order', () => {
    expect(availableTasks(plan, {}).map(t => t.id)).toEqual(['T001', 'T003']);
    const s: States = { T001: { status: 'done' } };
    expect(availableTasks(plan, s).map(t => t.id)).toEqual(['T002', 'T003']);
  });
  it('filters by track and never offers tasks owned by someone else', () => {
    const s: States = { T001: { status: 'in_progress', owner: 'other' } };
    expect(availableTasks(plan, s, { track: 'backend' }).map(t => t.id)).toEqual([]);
    expect(availableTasks(plan, s, { track: 'ui' }).map(t => t.id)).toEqual(['T003']);
  });
});

describe('blocked tasks', () => {
  it('become available again once every blocker is done', () => {
    const s: States = { T001: { status: 'done' }, T002: { status: 'blocked', blockedBy: ['T001'] } };
    expect(availableTasks(plan, s).map(t => t.id)).toContain('T002');
    expect(nextTask(plan, s, { sessionId: 'main' }).task?.id).toBe('T002');
  });
  it('stay unavailable while a blocker is open or external', () => {
    const open: States = { T001: { status: 'done' }, T002: { status: 'blocked', blockedBy: ['T003'] } };
    expect(availableTasks(plan, open).map(t => t.id)).not.toContain('T002');
    const ext: States = { T001: { status: 'done' }, T002: { status: 'blocked', blockedBy: ['external'] } };
    expect(availableTasks(plan, ext).map(t => t.id)).not.toContain('T002');
    const mixed: States = { T001: { status: 'done' }, T002: { status: 'blocked', blockedBy: ['T001', 'external'] } };
    expect(availableTasks(plan, mixed).map(t => t.id)).not.toContain('T002');
  });
});

describe('nextTask', () => {
  it('resumes a task this session already owns', () => {
    const s: States = { T003: { status: 'in_progress', owner: 'main' } };
    expect(nextTask(plan, s, { sessionId: 'main' })).toEqual({ task: plan.tasks[2], resumed: true });
  });
  it('returns null when nothing is available', () => {
    const s: States = { T001: { status: 'blocked' }, T003: { status: 'in_progress', owner: 'x' } };
    expect(nextTask(plan, s, { sessionId: 'main' })).toEqual({ task: null, resumed: false });
  });
});

describe('unlockedBy', () => {
  it('lists tasks that become available when a task is done', () => {
    const s: States = { T001: { status: 'done' }, T002: { status: 'done' }, T003: { status: 'done' } };
    expect(unlockedBy(plan, s, 'T004')).toEqual(['T005', 'T006']);
  });
});

describe('ids', () => {
  it('slugifies session names into valid segments', () => {
    expect(sessionIdFrom('Interfaz Gráfica!')).toBe('interfaz-grafica');
    expect(sessionIdFrom('***')).toBe('main');
  });
  it('builds sortable event ids', () => {
    const d = new Date('2026-10-11T10:41:00.123Z');
    expect(compactTs(d)).toBe('20261011T104100123Z');
    expect(eventId(d, 'main', () => 0)).toBe('20261011T104100123Z-main-0000');
  });
});
