import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { attribute, baseOf, eventsOf, idChain, isTask, projectOf, projectOfDir, readWorkDir, resolveProject, stampEvent, taskLine, workDir, workRel } from '../src/forge/task-ref.js';
import type { ExecutionState } from '../src/lib/execution-state.js';
import { roundDecision } from '../src/forge/round.js';
import { briefStats } from '../src/forge/stats.js';
import type { LedgerEvent } from '../src/forge/ledger.js';
import { useTempDirs } from './helpers/tmp.js';
const tmp = useTempDirs();

const ev = (min: number, kind: LedgerEvent['kind'], task: string, extra: Record<string, unknown> = {}): LedgerEvent =>
  ({ ts: `2026-10-16T10:${String(min).padStart(2, '0')}:00.000Z`, kind, task, ...extra });
const minute = (e: LedgerEvent) => e.ts.slice(14, 16);

describe('task-ref: a task is the pair (project, task) (D-08)', () => {
  it('a brief belongs to its task', () => {
    expect(baseOf('T001-2')).toBe('T001');
    expect(idChain('T1-2-1')).toEqual(['T1-2-1', 'T1-2', 'T1']);
    expect(idChain('fix-cart-ab12')).toEqual(['fix-cart-ab12']);
  });
  it('an event without a project takes the last triage of its id; a new triage opens a new attribution', () => {
    const events = [
      ev(1, 'triage', 'T001', { project: 'a' }), ev(2, 'verdict', 'T001-1', { action: 'fix' }),
      ev(3, 'triage', 'T001', { project: 'b' }), ev(4, 'verdict', 'T001-1', { action: 'accept' }),
      ev(5, 'verdict', 'T001-1', { action: 'fix', project: 'a' }),
      ev(6, 'triage', 'T001'), ev(7, 'phase', 'T001', { phase: 'implement' }),
      ev(8, 'phase', 'T002', { phase: 'implement' }), ev(9, 'phase', 'T003', { phase: 'x', project: '../evil' }),
    ];
    expect(events.map(attribute(events))).toEqual(['a', 'a', 'b', 'b', 'a', null, null, null, null]);
    expect(projectOf(events, 'T001')).toBeNull();
    expect(projectOf(events.slice(0, 5), 'T001-1')).toBe('b');
    expect(eventsOf(events, { project: 'a', task: 'T001' }).map(minute)).toEqual(['01', '02', '05']);
    expect(eventsOf(events, { project: null, task: 'T001' }).map(minute)).toEqual(['06', '07']);
    expect(isTask(events[1], 'T001-1')).toBe(true);
  });
  it('the project of a command: --project, then the work folder --dir names, then the ledger; never an unsafe id', () => {
    const events = [ev(1, 'triage', 'T1', { project: 'shop' })];
    expect(projectOfDir('.forge/work/shop/T1', 'T1')).toBe('shop');
    expect(projectOfDir('.forge/work/shop/T1/reviews-1-1', 'T1-1')).toBe('shop');
    expect(projectOfDir('C:\\repo\\.forge\\work\\shop\\T1', 'T1')).toBe('shop');
    expect(projectOfDir('.forge/work/T1', 'T1')).toBeNull();
    expect(projectOfDir('.forge/work/fix-cart-ab12/reviews-1-1', 'fix-cart-ab12-1')).toBeNull();
    expect(projectOfDir('.forge/work/../T1', 'T1')).toBeNull();
    expect(resolveProject({ flag: 'cart', dir: '.forge/work/shop/T1', task: 'T1', events })).toBe('cart');
    expect(resolveProject({ flag: '../x', dir: '.forge/work/web/T1', task: 'T1', events })).toBe('web');
    expect(resolveProject({ task: 'T1', events })).toBe('shop');
    expect(resolveProject({ task: 'T9', events })).toBeNull();
  });
  it("work folders: the project's, the older one while the ledger says it is that project's, and never an unsafe name", () => {
    const root = tmp('forge-task-ref-');
    const at = (...p: string[]) => path.join(root, '.forge', 'work', ...p);
    expect(workDir(root, { project: 'shop', task: 'T1' })).toBe(at('shop', 'T1'));
    expect(workRel({ project: null, task: 'fix-a' })).toBe('.forge/work/fix-a');
    expect(workRel({ project: '../x', task: 'T1' })).toBe('.forge/work/T1');
    expect(() => workDir(root, { project: 'shop', task: '..' })).toThrow();
    const events = [ev(1, 'triage', 'T1', { project: 'shop' })];
    expect(readWorkDir(root, { project: 'shop', task: 'T1' }, events)).toBe(at('shop', 'T1'));
    mkdirSync(at('T1'), { recursive: true });
    expect(readWorkDir(root, { project: 'shop', task: 'T1' }, events)).toBe(at('T1'));
    expect(readWorkDir(root, { project: 'web', task: 'T1' }, events)).toBe(at('web', 'T1'));
    mkdirSync(at('shop', 'T1'), { recursive: true });
    expect(readWorkDir(root, { project: 'shop', task: 'T1' }, events)).toBe(at('shop', 'T1'));
  });
  it('a folder a command only made never takes a task away from the folder that holds its brief', () => {
    const root = tmp('forge-task-ref-');
    const at = (...p: string[]) => path.join(root, '.forge', 'work', ...p);
    const shop = { project: 'shop', task: 'T1' };
    const events = [ev(1, 'triage', 'T1', { project: 'shop' })];
    // The task started in the older folder; verify-plan --dir then made the project's.
    mkdirSync(at('T1'), { recursive: true });
    writeFileSync(at('T1', 'brief-1.md'), 'brief\n');
    mkdirSync(at('shop', 'T1', 'reviews-1-1'), { recursive: true });
    expect(readWorkDir(root, shop, events)).toBe(at('T1'));
    // Not this project's by the ledger: its brief is another task's, and the project's folder is read.
    expect(readWorkDir(root, shop, [ev(1, 'triage', 'T1', { project: 'web' })])).toBe(at('shop', 'T1'));
    // A brief in the project's folder: that one, first.
    writeFileSync(at('shop', 'T1', 'brief-1.md'), 'brief\n');
    expect(readWorkDir(root, shop, events)).toBe(at('shop', 'T1'));
    // A loose task has one folder.
    expect(readWorkDir(root, { project: null, task: 'T1' }, events)).toBe(at('T1'));
  });
  it('two plans with T001 share no rounds: roundDecision of B never sees the verdicts of A', () => {
    const events = [
      ev(1, 'triage', 'T001', { project: 'a', path: 'medium' }),
      ev(2, 'verdict', 'T001-1', { action: 'fix', dir: 'a/r1', score: 0.4, signature: 'v2:1' }),
      ev(3, 'verdict', 'T001-1', { action: 'fix', dir: 'a/r2', score: 0.4, signature: 'v2:2' }),
      ev(4, 'triage', 'T001', { project: 'b', path: 'medium' }),
    ];
    expect(roundDecision(events, 'T001-1', 'medium', 'balanced', 'b')).toMatchObject({ round: 0, next: 'resume' });
    expect(roundDecision(events, 'T001-1', 'medium', 'balanced', 'a')).toMatchObject({ round: 2 });
  });
  it('stats count each brief inside its own project', () => {
    const events = [
      ev(1, 'triage', 'T001', { project: 'a', path: 'medium' }), ev(2, 'phase', 'T001', { phase: 'implement', brief: 1 }),
      ev(3, 'triage', 'T001', { project: 'b', path: 'large' }), ev(4, 'phase', 'T001', { phase: 'implement', brief: 1 }),
      ev(5, 'verdict', 'T001-1', { action: 'accept', project: 'a', dir: 'x' }), ev(6, 'verdict', 'T001-1', { action: 'accept', project: 'b', dir: 'y' }),
    ];
    expect(briefStats(events).map(b => [b.acceptedAt.slice(14, 16), b.path])).toEqual([['05', 'medium'], ['06', 'large']]);
  });
});

describe('stampEvent (C4)', () => {
  const exec = { runId: 'r1', active: true, tasks: { T1: {} } } as unknown as ExecutionState;
  const e = { ts: 't', kind: 'phase' as const, task: 'T1-2', phase: 'x' };
  it('adds session, runId and project when they apply and the event lacks them', () => {
    expect(stampEvent(e, { session: 'c1', exec, project: 'shop' })).toEqual({ ...e, session: 'c1', runId: 'r1', project: 'shop' });
    expect(stampEvent(e, { session: null, exec: { ...exec, active: false }, project: null })).toEqual(e);
    expect(stampEvent({ ...e, task: 'T9' }, { session: 'a b', exec, project: '../x' })).toEqual({ ...e, task: 'T9' });
    expect(stampEvent({ ts: 't', kind: 'cycle' }, { session: 'c1', exec, project: 'shop' })).toEqual({ ts: 't', kind: 'cycle', session: 'c1' });
  });
  it('an event that names its own session, run or project keeps them', () => {
    const own = { ...e, session: 'keep', runId: 'r0', project: 'mine' };
    expect(stampEvent(own, { session: 'c1', exec, project: 'shop' })).toEqual(own);
  });
});

describe('taskLine (E-02)', () => {
  it('names the brief and, for a plan task, its project', () => {
    expect(taskLine('T001-1', 'shop')).toBe('forge-task: T001-1 @shop');
    expect(taskLine('fix-cart-a1b2-1', null)).toBe('forge-task: fix-cart-a1b2-1');
    expect(taskLine('T001-1', '../x')).toBe('forge-task: T001-1');
  });
  it('keeps ids of up to 120 characters whole', () => {
    const t = 'a'.repeat(120), p = 'b'.repeat(120);
    expect(taskLine(t, p)).toBe(`forge-task: ${t} @${p}`);
  });
});
