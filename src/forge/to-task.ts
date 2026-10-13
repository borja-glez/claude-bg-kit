import type { Plan, PlanTask, PlanPhase } from '../lib/types.js';
import type { ProposalDoc } from '../lib/proposals.js';
import { safeZone } from './policy.js';

export const IMPROVEMENTS_PHASE = 'PX';

/** "2h", "1.5 h", "45 min" → minutes; anything else → null. */
export function estimateMinutes(estimate: string | undefined): number | null {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(h|hr|hrs|hours?|horas?|m|min|mins|minutes?|minutos?)\s*$/i.exec(estimate ?? '');
  if (!m) return null;
  const n = Number(m[1].replace(',', '.')) * (/^h/i.test(m[2]) ? 60 : 1);
  return n > 0 ? Math.round(n) : null;
}

/** The whole rationale, the evidence and a reference to the proposal; undefined when both texts are blank. */
function includesOf(p: ProposalDoc & { id: string }, es: boolean): string | undefined {
  const parts: string[] = [];
  if (p.rationale.trim()) parts.push(p.rationale.trim());
  if (p.evidence.trim()) parts.push(`${es ? 'Evidencia' : 'Evidence'}: ${p.evidence.trim()}`);
  if (!parts.length) return undefined;
  parts.push(es ? `(propuesta ${p.id})` : `(proposal ${p.id})`);
  return parts.join('\n\n');
}

export function proposalToTask(plan: Plan, p: ProposalDoc & { id: string }, opts: { track?: string }): { task: PlanTask; phase: PlanPhase | null } {
  let max = 0;
  for (const t of plan.tasks) { const m = /^T(\d+)$/.exec(t.id); if (m) max = Math.max(max, Number(m[1])); }
  const es = plan.locale.toLowerCase().startsWith('es');
  const existing = plan.phases.find(ph => ph.id === IMPROVEMENTS_PHASE);
  const phase: PlanPhase | null = existing ? null : { id: IMPROVEMENTS_PHASE, name: es ? 'Mejoras' : 'Improvements', plan_status: 'provisional' };
  const zone = safeZone(p.path);
  const includes = includesOf(p, es);
  const task: PlanTask = {
    id: `T${String(max + 1).padStart(3, '0')}`,
    title: p.title,
    track: opts.track ?? plan.tracks[0]?.id ?? '',
    phase: IMPROVEMENTS_PHASE,
    ...(includes !== undefined ? { includes } : {}),
    done_when: es ? `${p.title} — los validadores pasan` : `${p.title} — validators pass`,
    depends_on: [],
    zones: zone ? [zone] : [],
    estimate_min: estimateMinutes(p.estimate) ?? 30,
  };
  return { task, phase };
}
