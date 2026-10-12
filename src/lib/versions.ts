import { statusOf } from './deps.js';
import { computeMetrics } from './metrics.js';
import type { PlanView, States, TaskStatus } from './types.js';

export interface VersionColumn {
  versionId: string | null;
  phase: { id: string; name: string; status: 'done' | 'in_progress' | 'committed' | 'provisional' };
  categories: { name: string; tasks: { id: string; title: string; status: TaskStatus; track: string }[] }[];
  done: number;
  total: number;
}

export function buildVersionColumns(
  plan: PlanView,
  states: States,
  filter?: { statuses?: TaskStatus[]; track?: string },
): VersionColumn[] {
  const byPhase = computeMetrics(plan, states, 0).byPhase;
  const placed = new Set<string>();
  const order: { versionId: string | null; phaseId: string }[] = [];
  for (const v of plan.versions) {
    const wanted = new Set(v.phases);
    for (const ph of plan.phases) {
      if (wanted.has(ph.id) && !placed.has(ph.id)) {
        placed.add(ph.id);
        order.push({ versionId: v.id, phaseId: ph.id });
      }
    }
  }
  for (const ph of plan.phases) if (!placed.has(ph.id)) order.push({ versionId: null, phaseId: ph.id });

  return order.map(({ versionId, phaseId }) => {
    const ph = plan.phases.find(p => p.id === phaseId)!;
    const m = byPhase[phaseId];
    const cats = new Map<string, VersionColumn['categories'][number]['tasks']>();
    for (const t of plan.tasks.filter(x => x.phase === phaseId)) {
      const status = statusOf(states, t.id);
      if (filter?.statuses && !filter.statuses.includes(status)) continue;
      if (filter?.track && t.track !== filter.track) continue;
      const name = t.category ?? '—';
      if (!cats.has(name)) cats.set(name, []);
      cats.get(name)!.push({ id: t.id, title: t.title, status, track: t.track });
    }
    return {
      versionId,
      phase: { id: ph.id, name: ph.name, status: m.status },
      categories: [...cats].map(([name, tasks]) => ({ name, tasks })),
      done: m.done,
      total: m.total,
    };
  });
}
