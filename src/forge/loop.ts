import type { Action } from './verdict.js';
import type { ImplRole } from './triage.js';

export type Next = 'done' | 'resume' | 'fresh-stronger' | 'redo' | 'breaker' | 'stalled';
/** `last`: the attempt about to start is the last one before the breaker (round 3 on Medium, 4 on Large). */
export interface RoundDecision { round: number; cap: number; next: Next; reason: string; tierUp: boolean; last: boolean }

const CAP = { medium: 3, large: 4 } as const;

export function decideRound(history: { action: Action; score: number | null; signature: string }[], path: 'medium' | 'large'): RoundDecision {
  const cap = CAP[path];
  const latest = history.at(-1);
  const round = history.filter(h => h.action !== 'accept').length;
  const tierUp = round >= 3;
  // Only an attempt (resume, fresh-stronger, redo) can be the last one; done, stalled and the breaker start none.
  const last = round === cap;
  const lastNote = last ? ' (the last attempt before the breaker: impl-heavy)' : '';
  if (!latest) return { round: 0, cap, next: 'resume', reason: 'no verdict yet', tierUp, last: false };
  if (latest.action === 'accept') return { round, cap, next: 'done', reason: 'accepted', tierUp, last: false };
  const prev = history.at(-2);
  if (prev && prev.action !== 'accept' && prev.signature === latest.signature && prev.score === latest.score) {
    return { round, cap, next: 'stalled', reason: 'same findings and score as the previous round', tierUp, last: false };
  }
  if (round > cap) return { round, cap, next: 'breaker', reason: `round ${round} over the cap of ${cap}`, tierUp, last: false };
  if (latest.action === 'redo') return { round, cap, next: 'redo', reason: `score under 0.5: start again from the brief with another approach${tierUp ? ', with an implementer one tier up' : ''}${lastNote}`, tierUp, last };
  if (round <= 2) return { round, cap, next: 'resume', reason: `round ${round}: resume the implementer${lastNote}`, tierUp, last };
  return { round, cap, next: 'fresh-stronger', reason: `round ${round}: fresh implementer one tier up${lastNote}`, tierUp, last };
}

/** The implementer ladder, lowest rung first. */
export const IMPL_LADDER: readonly ImplRole[] = ['mech', 'impl-light', 'impl', 'impl-high', 'impl-heavy'];

/** One rung up the ladder; the top rung stays. */
export function stepUp(role: ImplRole): ImplRole {
  return IMPL_LADDER[Math.min(IMPL_LADDER.indexOf(role) + 1, IMPL_LADDER.length - 1)];
}

/**
 * Who implements the attempt a round decision starts, given who implemented the previous one: impl-heavy on the
 * last attempt from any rung, one rung up on fresh-stronger or a redo with tierUp, else the same one. Null when
 * the decision starts no attempt (done, stalled, breaker).
 */
export function nextImplementer(d: Pick<RoundDecision, 'next' | 'tierUp' | 'last'>, current: ImplRole): ImplRole | null {
  if (d.next !== 'resume' && d.next !== 'fresh-stronger' && d.next !== 'redo') return null;
  if (d.last) return 'impl-heavy';
  if (d.next === 'fresh-stronger' || (d.next === 'redo' && d.tierUp)) return stepUp(current);
  return current;
}
