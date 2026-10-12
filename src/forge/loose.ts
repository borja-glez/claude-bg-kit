import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { forgeDir } from './ledger.js';
import { isPlanId } from '../lib/plan.js';
import type { ExecutionState } from '../lib/execution-state.js';
import { LOOSE_MAX_TASKS, type PlanView, type States } from '../lib/types.js';

/** The most requests one ephemeral run takes (defined in src/lib/types.ts, where the page reads it). */
export { LOOSE_MAX_TASKS };
export type LoosePath = 'trivial' | 'small' | 'medium';
export interface LooseTask { id: string; title: string; path: LoosePath; zones: string[]; depends_on: string[] }
export interface LooseDoc { runId: string; tasks: LooseTask[] }
export const looseFile = (root: string) => path.join(root, '.forge', 'loose.json');

const PATHS: readonly string[] = ['trivial', 'small', 'medium'];
const badZone = (z: unknown) => typeof z !== 'string' || !z || z.length > 300 || /^([/\\]|[A-Za-z]:)/.test(z) || z.split(/[/\\]/).includes('..');

export function parseLooseTasks(x: unknown): { tasks: LooseTask[] } | { error: string } {
  if (!Array.isArray(x)) return { error: 'the tasks must be a JSON array' };
  if (x.length < 2) return { error: 'an ephemeral run needs at least 2 tasks (one alone is a normal task)' };
  if (x.length > LOOSE_MAX_TASKS) return { error: `an ephemeral run takes at most ${LOOSE_MAX_TASKS} tasks` };
  const tasks: LooseTask[] = [];
  for (const raw of x) {
    const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id : '';
    if (!isPlanId(id)) return { error: `invalid id ${String(o.id).slice(0, 80)}` };
    if (tasks.some(t => t.id === id)) return { error: `duplicate id ${id}` };
    if (o.path === 'large') return { error: `${id}: a Large request follows its own path (design), not an ephemeral run` };
    if (!PATHS.includes(o.path as string)) return { error: `${id}: path must be trivial, small or medium` };
    const title = typeof o.title === 'string' ? o.title.trim().slice(0, 200) : '';
    if (!title) return { error: `${id}: a title is required` };
    const zones: unknown[] = Array.isArray(o.zones) ? o.zones : [];
    if (zones.length > 50 || zones.some(badZone)) return { error: `${id}: invalid zone (relative paths or globs inside the repo, at most 50)` };
    const deps: unknown[] = Array.isArray(o.depends_on) ? o.depends_on : [];
    if (deps.some(d => typeof d !== 'string')) return { error: `${id}: depends_on must list task ids` };
    tasks.push({ id, title, path: o.path as LoosePath, zones: zones.length ? (zones as string[]) : ['**'], depends_on: [...new Set(deps as string[])] });
  }
  const ids = new Set(tasks.map(t => t.id));
  for (const t of tasks) {
    if (t.depends_on.includes(t.id)) return { error: `${t.id} depends on itself` };
    const unknown = t.depends_on.find(d => !ids.has(d));
    if (unknown) return { error: `${t.id} depends on unknown ${unknown.slice(0, 80)}` };
  }
  // Kahn: whatever never becomes ready sits on a cycle.
  const left = new Map(tasks.map(t => [t.id, t.depends_on.length]));
  const ready = tasks.filter(t => !t.depends_on.length).map(t => t.id);
  while (ready.length) {
    const id = ready.pop()!;
    left.delete(id);
    for (const t of tasks) if (left.has(t.id) && t.depends_on.includes(id)) {
      const n = left.get(t.id)! - 1;
      left.set(t.id, n);
      if (n === 0) ready.push(t.id);
    }
  }
  if (left.size) return { error: `dependency cycle among ${[...left.keys()].join(', ')}` };
  return { tasks };
}

/** One track and one phase: the scheduler orders loose tasks by their position in the batch. */
export function planOfLoose(tasks: LooseTask[]): PlanView {
  return {
    tracks: [{ id: 'loose', name: 'loose', color: 'blue' }], phases: [{ id: 'loose', name: 'loose', plan_status: 'committed' }], versions: [],
    tasks: tasks.map(t => ({ id: t.id, title: t.title, track: 'loose', phase: 'loose', done_when: t.title, depends_on: t.depends_on, zones: t.zones })),
  };
}

/** The roadmap of an ephemeral run is the execution itself: integrated is done (nothing left to merge), blocked waits on the user. */
export function statesOfLoose(e: ExecutionState): States {
  const out: States = {};
  for (const [id, t] of Object.entries(e.tasks)) {
    if (t.status === 'integrated') out[id] = { status: 'done' };
    else if (t.status === 'blocked') out[id] = { status: 'blocked', blockedBy: ['external'] };
  }
  return out;
}

export function writeLoose(root: string, doc: LooseDoc): void {
  forgeDir(root);
  const file = looseFile(root);
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try { writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n'); renameSync(tmp, file); } finally { rmSync(tmp, { force: true }); }
}

export function readLoose(root: string, runId: string): LooseDoc | null {
  try {
    const raw = JSON.parse(readFileSync(looseFile(root), 'utf8')) as { runId?: unknown; tasks?: unknown };
    if (raw.runId !== runId) return null;
    const r = parseLooseTasks(raw.tasks);
    return 'error' in r ? null : { runId, tasks: r.tasks };
  } catch { return null; }
}
