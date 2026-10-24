// 6b-3, spec «Fases que se replanifican»: a product run's phase closes when it has tasks and the roadmap's state says every
// one of them is done; then a fresh review of the whole roadmap proposes the re-plan, once per phase (`FORGE infinite phase`).
// H-6: the phases already reviewed are kept per run id in the main checkout, .forge/autonomous/<runId>/phases.json, beside
// start.json and sessions.json: every start rebuilds run.json, and a later start of the same profile shares its runId.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isPlanId } from '../lib/ids.js';
import { readDocs } from '../lib/read-docs.js';
import type { Plan } from '../lib/types.js';
import { stateDoc } from '../page/normalize.js';
import { UsageError } from './cli/errors.js';
import { writeAtomic } from './execution.js';
import { forgeDir } from './ledger.js';
import { autonomousDir } from './resources.js';

/** The most phases the phases.json of one run keeps. */
export const PHASES_REVIEWED_MAX = 200;

export const phasesFile = (main: string, runId: string): string => path.join(autonomousDir(main, runId), 'phases.json');

/** The tasks the roadmap's state listing (`<DB>/state`) says are done. */
export const doneTasks = (stateDir: string): Set<string> =>
  new Set(Object.entries(readDocs(stateDir, stateDoc).docs).filter(([, s]) => s.status === 'done').map(([task]) => task));

/** M-11: the done tasks of `<db>/state` (`db` as given, from `cwd`). A listing that is not there is a UsageError of `cmd`:
 *  read as empty, a closed phase would look open and a done task would look pending. */
export function doneOf(cwd: string, db: string, cmd: string): Set<string> {
  const dir = path.resolve(cwd, db, 'state');
  if (!existsSync(dir)) throw new UsageError(`${cmd}: ${db} has no state listing: list state first`);
  return doneTasks(dir);
}

/**
 * The phases of `runId` already reviewed, oldest first; none when its phases.json is not there. One that does not hold
 * `{ reviewed: [<phase ids>] }` (plan ids, each once, at most PHASES_REVIEWED_MAX) is refused, naming the file: a phase is
 * never reviewed again, nor left unreviewed, on a guess.
 */
export function readReviewed(main: string, runId: string): string[] {
  const file = phasesFile(main, runId);
  if (!existsSync(file)) return [];
  let o: unknown = null;
  try { o = JSON.parse(readFileSync(file, 'utf8')); } catch { o = null; }
  const list = o && typeof o === 'object' && !Array.isArray(o) ? (o as { reviewed?: unknown }).reviewed : undefined;
  const ids = Array.isArray(list) && list.every((x): x is string => typeof x === 'string' && isPlanId(x)) ? list : null;
  if (!ids || ids.length > PHASES_REVIEWED_MAX || new Set(ids).size !== ids.length) {
    throw new UsageError(`${file} does not hold { reviewed: [<phase ids>] } (plan ids, each once, at most ${PHASES_REVIEWED_MAX}); `
      + 'fix it, or remove it so that every closed phase is reviewed again');
  }
  return ids;
}

/** Adds `phase` to the reviewed phases of `runId`, once, writing phases.json whole through a temporary file; the list it holds. */
export function markReviewed(main: string, runId: string, phase: string): string[] {
  const now = readReviewed(main, runId);
  if (now.includes(phase)) return now;
  const next = [...now, phase];
  if (next.length > PHASES_REVIEWED_MAX) throw new UsageError(`${phasesFile(main, runId)} already holds ${PHASES_REVIEWED_MAX} reviewed phases`);
  forgeDir(main);
  writeAtomic(phasesFile(main, runId), JSON.stringify({ reviewed: next }, null, 2) + '\n');
  return next;
}

export interface PhaseCount { id: string; done: number; total: number }

/** Each phase of `plan`, in its order, with how many of its tasks `done` holds; `closed` is the first one that has tasks, all of
 *  them done, and is not in `reviewed` (an empty phase, one a re-plan just added, never closes). */
export function phaseStatus(plan: Pick<Plan, 'phases' | 'tasks'>, done: ReadonlySet<string>, reviewed: readonly string[]):
  { closed: string | null; phases: PhaseCount[] } {
  const phases = plan.phases.map(ph => {
    const tasks = plan.tasks.filter(t => t.phase === ph.id);
    return { id: ph.id, done: tasks.filter(t => done.has(t.id)).length, total: tasks.length };
  });
  const closed = phases.find(p => p.total > 0 && p.done === p.total && !reviewed.includes(p.id))?.id ?? null;
  return { closed, phases };
}
