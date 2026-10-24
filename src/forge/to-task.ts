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

/** 6b-3: where a new task of a `product` run goes, with what proves it done, what it waits for and how long it takes. */
export interface Placement { phase: string; doneWhen: string; dependsOn: string[]; estimateMin: number }

/** The shortest done_when a placement takes: one that says what a check sees, not a word. */
export const DONE_WHEN_MIN = 12;

/** The text as checkPlacement compares it with the title: no capitals, and no spaces at the ends or in a run. */
const plain = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * 6b-3: what is wrong with `p` as the placement of a new task titled `title` in `plan` (empty: it holds), `done` being the
 * ids of the tasks the roadmap's state says are done. Its phase must exist and not be done (it has tasks and all of them are
 * done; an empty one, just added, is a target), and in a product run (`product`) never be the improvements phase (L-6);
 * each dependency must be a task of the plan; its done_when must say more than the title, in DONE_WHEN_MIN characters at
 * least; its estimate must be whole minutes in 1..MAX_ESTIMATE_MIN.
 */
export function checkPlacement(plan: Plan, title: string, p: Placement, done: ReadonlySet<string>, opts: { product?: boolean } = {}): string[] {
  const problems: string[] = [];
  const tasksOf = plan.tasks.filter(t => t.phase === p.phase);
  if (!plan.phases.some(ph => ph.id === p.phase)) problems.push(`phase ${p.phase} is not a phase of the plan`);
  else if (tasksOf.length && tasksOf.every(t => done.has(t.id))) problems.push(`phase ${p.phase} is done: every task of it is done`);
  if (opts.product && p.phase === IMPROVEMENTS_PHASE) problems.push(`phase ${p.phase} is the improvements phase: in a product run a task goes to the phase it belongs to`);
  const ids = new Set(plan.tasks.map(t => t.id));
  for (const d of p.dependsOn) if (!ids.has(d)) problems.push(`dependency ${d} is not a task of the plan`);
  const doneWhen = plain(p.doneWhen);
  if (Array.from(doneWhen).length < DONE_WHEN_MIN) problems.push(`the done_when needs at least ${DONE_WHEN_MIN} characters that say how the task is checked`);
  else if (doneWhen === plain(title)) problems.push('the done_when only repeats the title: say how the task is checked');
  if (!Number.isInteger(p.estimateMin) || p.estimateMin < 1 || p.estimateMin > MAX_ESTIMATE_MIN) problems.push(`the estimate must be 1 to ${MAX_ESTIMATE_MIN} whole minutes`);
  return problems;
}

/**
 * The task (and the improvements phase, when the plan has none yet) proposal `p` becomes. 6b-3: with a `placement` the task
 * goes to its phase with its done_when, its dependencies and its estimate, and no improvements phase is made; the caller
 * checks it first (checkPlacement).
 */
export function proposalToTask(plan: Plan, p: ProposalDoc & { id: string }, opts: { track?: string; placement?: Placement }): { task: PlanTask; phase: PlanPhase | null } {
  // T6B3-RETIRED-IDS: past the plan's tasks and the ids a replan retired, so a new task never takes a retired one's state.
  let max = 0;
  for (const id of [...plan.tasks.map(t => t.id), ...(plan.retired ?? [])]) { const m = /^T(\d+)$/.exec(id); if (m) max = Math.max(max, Number(m[1])); }
  const es = plan.locale.toLowerCase().startsWith('es');
  const placed = opts.placement;
  const existing = placed || plan.phases.some(ph => ph.id === IMPROVEMENTS_PHASE);
  const phase: PlanPhase | null = existing ? null : { id: IMPROVEMENTS_PHASE, name: es ? 'Mejoras' : 'Improvements', plan_status: 'provisional' };
  const zone = safeZone(p.path);
  const includes = includesOf(p, es);
  const task: PlanTask = {
    id: `T${String(max + 1).padStart(3, '0')}`,
    title: p.title,
    track: opts.track ?? plan.tracks[0]?.id ?? '',
    phase: placed?.phase ?? IMPROVEMENTS_PHASE,
    includes,
    done_when: placed?.doneWhen ?? (es ? `${p.title} — los validadores pasan` : `${p.title} — validators pass`),
    depends_on: placed ? [...placed.dependsOn] : [],
    zones: zone ? [zone] : [],
    estimate_min: placed?.estimateMin ?? estimateMinutes(p.estimate) ?? 30,
  };
  return { task, phase };
}
