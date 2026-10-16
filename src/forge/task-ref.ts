// D-08, C4: a task is identified by the pair (project, task). An event of a plan task carries its project; an older
// event is attributed by the last triage of its id. A plan task's work folder is .forge/work/<project>/<T>/, a loose
// task's .forge/work/<T>/; readers accept the older folder too. Every reader of src/forge compares an event's task
// with an id here, and nowhere else.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { isSafeId } from '../lib/execution-state.js';
import type { LedgerEvent } from './ledger.js';

/** `task`: the id whose events (itself and its briefs `<task>-<n>`) and whose work folder are meant. */
export interface TaskRef { project: string | null; task: string }

/** The id a brief `<id>-<n>` belongs to; the id itself otherwise. */
export const baseOf = (id: string): string => id.replace(/-\d+$/, '');

/** The id and the ids it belongs to, nearest first: `T1-2-1` → `T1-2-1`, `T1-2`, `T1`. */
export function idChain(id: string): string[] {
  const out = [id];
  for (let k = baseOf(id); k !== out[out.length - 1]; k = baseOf(k)) out.push(k);
  return out;
}

/** Whether event `e` is of exactly `id`. */
export const isTask = (e: LedgerEvent, id: string): boolean => e.task === id;

/** The events of task `id` itself and of its briefs `<id>-<n>`. */
export const ofTask = (id: string) => (e: LedgerEvent): boolean =>
  typeof e.task === 'string' && (e.task === id || (e.task.startsWith(`${id}-`) && /^\d+$/.test(e.task.slice(id.length + 1))));

/** An event's own project: a safe id, or none. */
const ownProject = (e: LedgerEvent): string | undefined => (isSafeId(e.project) ? e.project : undefined);

function lookup(last: ReadonlyMap<string, string | null>, id: string): string | null {
  for (const k of idChain(id)) if (last.has(k)) return last.get(k)!;
  return null;
}

/**
 * The project of each event: its own `project`, else that of the last triage of its id before it (by the id, then by
 * the ids it belongs to). A triage without a project opens a loose task's attribution (null), so a second plan's T001
 * never inherits the first one's events.
 */
export function attribute(events: readonly LedgerEvent[]): (e: LedgerEvent) => string | null {
  const last = new Map<string, string | null>();
  const of = new Map<LedgerEvent, string | null>();
  for (const e of events) {
    if (typeof e.task !== 'string') continue;
    const own = ownProject(e);
    if (e.kind === 'triage') last.set(e.task, own ?? null);
    of.set(e, own ?? lookup(last, e.task));
  }
  return e => (of.has(e) ? of.get(e)! : ownProject(e) ?? null);
}

/** The project the ledger gives task `id` now: that of its last triage (by the id, then by the ids it belongs to). */
export function projectOf(events: readonly LedgerEvent[], id: string): string | null {
  const last = new Map<string, string | null>();
  for (const e of events) if (e.kind === 'triage' && typeof e.task === 'string') last.set(e.task, ownProject(e) ?? null);
  return lookup(last, id);
}

/** The events of task `ref.task` (itself and its briefs) that belong to `ref.project`. */
export function eventsOf(events: readonly LedgerEvent[], ref: TaskRef): LedgerEvent[] {
  const owner = attribute(events);
  const mine = ofTask(ref.task);
  return events.filter(e => mine(e) && owner(e) === ref.project);
}

/** The project a work folder names: `.forge/work/<project>/<T>[/…]`, `<T>` being `task` or an id it belongs to. */
export function projectOfDir(dir: string, task: string): string | null {
  const parts = dir.split(/[\\/]+/);
  for (let i = parts.length - 1; i > 0; i--) {
    if (parts[i] !== 'work' || parts[i - 1] !== '.forge') continue;
    const project = parts[i + 1], id = parts[i + 2];
    return project && id && isSafeId(project) && idChain(task).includes(id) ? project : null;
  }
  return null;
}

/** The project an event of `task` belongs to, by order: a safe --project, the folder --dir names, the ledger, none. */
export function resolveProject(i: { flag?: string | null; dir?: string | null; task: string; events: readonly LedgerEvent[] }): string | null {
  if (i.flag && isSafeId(i.flag)) return i.flag;
  return (i.dir ? projectOfDir(i.dir, i.task) : null) ?? projectOf(i.events, i.task);
}

function folderOf(ref: TaskRef): string[] {
  if (!isSafeId(ref.task)) throw new Error(`not a task id: ${String(ref.task).slice(0, 80)}`);
  return ref.project !== null && isSafeId(ref.project) ? ['.forge', 'work', ref.project, ref.task] : ['.forge', 'work', ref.task];
}

/** A task's work folder (C4): .forge/work/<project>/<T> for a plan task, .forge/work/<T> for a loose one. */
export const workDir = (root: string, ref: TaskRef): string => path.join(root, ...folderOf(ref));

/** The same folder relative to the checkout, with `/`: what the CLI prints as `work`. */
export const workRel = (ref: TaskRef): string => folderOf(ref).join('/');

/** The folder to read: the project's when it exists; else the older .forge/work/<T> when it exists and the ledger says it
 *  is this project's; else the project's. */
export function readWorkDir(root: string, ref: TaskRef, events: readonly LedgerEvent[]): string {
  const fresh = workDir(root, ref);
  if (existsSync(fresh) || ref.project === null) return fresh;
  const old = workDir(root, { project: null, task: ref.task });
  return existsSync(old) && projectOf(events, ref.task) === ref.project ? old : fresh;
}
