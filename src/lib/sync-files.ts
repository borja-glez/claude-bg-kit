import type { Plan } from './types.js';

/** A-24: the file of a phase in a sync's --out, as buildSyncWrites names it. */
export const phaseFile = (id: string): string => `plan-${id.replace(/:/g, '_')}.json`;

/** A-24: the files one sync of `plan` writes in its --out: meta.json and one plan-<phase>.json per phase. */
export function syncFiles(plan: Pick<Plan, 'phases'>): Set<string> {
  return new Set(['meta.json', ...plan.phases.map(p => phaseFile(p.id))]);
}

/** A-24: a name a sync of any plan writes, so the one sync deletes from its --out before writing. */
export const isSyncBatch = (name: string): boolean => name === 'meta.json' || /^plan-.+\.json$/.test(name);
