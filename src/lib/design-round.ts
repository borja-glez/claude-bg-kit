// K3-04, K3-06: the next critique round of a design: its number, the budget the critic gets and what it reviews. Pure;
// the waypoint CLI reads the files (critique-next).
import { budgetFor, scopeFor, type Budget } from './critique.js';
import { changedSections, designBody } from './design.js';
import { entryKind, entryRound, type ChangelogEntry } from './history.js';
import type { GateCritique } from './design-gate.js';

export interface NextRound {
  /** The round to run: one after the latest of the changelog and of the critique files. */
  round: number;
  /** The version the critic reviews: the changelog's latest. */
  version: number;
  budget: Budget;
  scope: 'full' | 'changed';
  /** The version of the latest valid critique, the one the changes are measured against; null before any critique. */
  since: number | null;
  /** The sections changed since that version, and the ones that went away (both empty before any critique). */
  changed: string[];
  removed: string[];
  /** The sections the critic reviews: every one with a full scope, the changed ones otherwise. */
  review: string[];
}

export interface NextRoundInput {
  changelog: ChangelogEntry[];
  critiques: GateCritique[];
  /** The design's history: version → text. */
  history: Record<number, string>;
  /** The design file as it is now. */
  current: string;
  /** The slugs of the design's sections, in order. */
  sections: string[];
  /** round --verify: the budget of a verification, on what changed. */
  verify?: boolean;
  /** A full review whatever changed, because the person asked for it. */
  full?: boolean;
}

/**
 * The round as the budget counts it: since the design was last reopened (spec §4.9.3: a reopened design goes through
 * the usual loop again), so the first round after a reopen is round 1. Never below 1, whatever the input.
 * critique-next and critique-check --design both use it, so that they never disagree on a budget.
 */
export function budgetRound(changelog: ChangelogEntry[], round: number): number {
  const reopen = [...changelog].reverse().find(e => entryKind(e) === 'reopen');
  const n = Number.isFinite(round) ? round : 1;
  return Math.max(1, n - entryRound(reopen));
}

/**
 * The next round. The budget counts the rounds since the last reopen (budgetRound); the first round after a reopen still
 * reviews only what changed, unless more than half did (scopeFor).
 */
export function nextRound(i: NextRoundInput): NextRound {
  const last = i.changelog[i.changelog.length - 1];
  const round = Math.max(entryRound(last), ...i.critiques.map(c => c.round)) + 1;
  const reopened = i.changelog.some(e => entryKind(e) === 'reopen');
  const cycle = budgetRound(i.changelog, round);
  const verify = i.verify ?? false;
  const budget = budgetFor(cycle, verify);
  const latest = [...i.critiques].filter(c => c.critique !== null).sort((a, b) => b.round - a.round)[0]?.critique ?? null;
  const since = latest?.version ?? null;
  const prev = since === null ? undefined : i.history[since];
  const diff = prev === undefined ? null : changedSections(designBody(prev), designBody(i.current));
  const scope: 'full' | 'changed' = i.full || !diff
    ? 'full'
    : scopeFor({ round: cycle, verify, reopened, changed: diff.changed.filter(s => s !== '_intro').length + diff.removed.length, total: i.sections.length });
  return {
    round, version: last?.version ?? 0, budget, scope, since,
    changed: diff?.changed ?? [], removed: diff?.removed ?? [],
    review: scope === 'full' ? i.sections : diff?.changed ?? [],
  };
}
