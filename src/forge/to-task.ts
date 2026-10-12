import type { Plan, PlanTask, PlanPhase } from '../lib/types.js';
import type { ProposalDoc } from '../lib/proposals.js';
import { safeZone } from './policy.js';

export const IMPROVEMENTS_PHASE = 'PX';

export function proposalToTask(plan: Plan, p: ProposalDoc & { id: string }, opts: { track?: string }): { task: PlanTask; phase: PlanPhase | null } {
  let max = 0;
  for (const t of plan.tasks) { const m = /^T(\d+)$/.exec(t.id); if (m) max = Math.max(max, Number(m[1])); }
  const es = plan.locale.toLowerCase().startsWith('es');
  const existing = plan.phases.find(ph => ph.id === IMPROVEMENTS_PHASE);
  const phase: PlanPhase | null = existing ? null : { id: IMPROVEMENTS_PHASE, name: es ? 'Mejoras' : 'Improvements', plan_status: 'provisional' };
  const zone = safeZone(p.path);
  const task: PlanTask = {
    id: `T${String(max + 1).padStart(3, '0')}`,
    title: p.title,
    track: opts.track ?? plan.tracks[0]?.id ?? '',
    phase: IMPROVEMENTS_PHASE,
    includes: p.rationale.slice(0, 300),
    done_when: es ? `${p.title} — los validadores pasan` : `${p.title} — validators pass`,
    depends_on: [],
    zones: zone ? [zone] : [],
    estimate_min: 30,
  };
  return { task, phase };
}
