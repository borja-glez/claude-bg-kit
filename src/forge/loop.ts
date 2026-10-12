import type { Action } from './verdict.js';

export type Next = 'done' | 'resume' | 'fresh-stronger' | 'redo' | 'breaker' | 'stalled';
export interface RoundDecision { round: number; cap: number; next: Next; reason: string; tierUp: boolean }

const CAP = { medium: 3, large: 4 } as const;

export function decideRound(history: { action: Action; score: number | null; signature: string }[], path: 'medium' | 'large'): RoundDecision {
  const cap = CAP[path];
  const last = history.at(-1);
  const round = history.filter(h => h.action !== 'accept').length;
  const tierUp = round >= 3;
  if (!last) return { round: 0, cap, next: 'resume', reason: 'no verdict yet', tierUp };
  if (last.action === 'accept') return { round, cap, next: 'done', reason: 'accepted', tierUp };
  const prev = history.at(-2);
  if (prev && prev.action !== 'accept' && prev.signature === last.signature && prev.score === last.score) {
    return { round, cap, next: 'stalled', reason: 'same findings and score as the previous round', tierUp };
  }
  if (round > cap) return { round, cap, next: 'breaker', reason: `round ${round} over the cap of ${cap}`, tierUp };
  if (last.action === 'redo') return { round, cap, next: 'redo', reason: `score under 0.5: start again from the brief with another approach${tierUp ? ', with an implementer one tier up' : ''}`, tierUp };
  if (round <= 2) return { round, cap, next: 'resume', reason: `round ${round}: resume the implementer`, tierUp };
  return { round, cap, next: 'fresh-stronger', reason: `round ${round}: fresh implementer one tier up`, tierUp };
}
