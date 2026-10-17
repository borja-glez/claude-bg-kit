import type { Plan, PlanTask, PlanPhase } from '../lib/types.js';
import type { ProposalDoc } from '../lib/proposals.js';
import { safeZone } from './policy.js';

export const IMPROVEMENTS_PHASE = 'PX';

/** The longest estimate a proposal can set: one week, in minutes (the text is untrusted). */
export const MAX_ESTIMATE_MIN = 7 * 24 * 60;

/** "2h", "1.5 h", "45 min" → whole minutes in 1..MAX_ESTIMATE_MIN; anything else → null. */
export function estimateMinutes(estimate: string | undefined): number | null {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(h|hr|hrs|hours?|horas?|m|min|mins|minutes?|minutos?)\s*$/i.exec(estimate ?? '');
  if (!m) return null;
  const n = Math.round(Number(m[1].replace(',', '.')) * (/^h/i.test(m[2]) ? 60 : 1));
  return n >= 1 && n <= MAX_ESTIMATE_MIN ? n : null;
}

/** Every proposal an `includes` links to: a line that is only the `(propuesta|proposal <id>)` reference to-task writes. The link
 *  is found on any line, so text added around it later does not hide where the task came from. */
export function proposalsOfIncludes(includes: string | undefined): string[] {
  return [...(includes ?? '').matchAll(/^\((?:propuesta|proposal) (p\d{14}[0-9a-z]{4})\)[ \t]*$/gm)].map(m => m[1]);
}

/** The proposal a task's `includes` came from: the last link line (to-task writes it last; a rationale can quote others). */
export function proposalOfIncludes(includes: string | undefined): string | null {
  return proposalsOfIncludes(includes).at(-1) ?? null;
}

/** The whole rationale, the evidence and, always, a reference to the proposal (even when both texts are blank). */
function includesOf(p: ProposalDoc & { id: string }, es: boolean): string {
  const parts: string[] = [];
  if (p.rationale.trim()) parts.push(p.rationale.trim());
  if (p.evidence.trim()) parts.push(`${es ? 'Evidencia' : 'Evidence'}: ${p.evidence.trim()}`);
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
    includes,
    done_when: es ? `${p.title} — los validadores pasan` : `${p.title} — validators pass`,
    depends_on: [],
    zones: zone ? [zone] : [],
    estimate_min: estimateMinutes(p.estimate) ?? 30,
  };
  return { task, phase };
}
