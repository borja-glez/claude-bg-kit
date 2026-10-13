import type { PathName, ReviewEffort, ReviewRole, Zone } from './triage.js';
import type { Finding } from './verdict.js';

// Who reviews in each round of a brief (design «Rondas de arreglo» and «Validación en sombra»).

export type ReviewMode = 'full' | 'delta';
export type ReviewerKey = 'correctness' | 'security' | 'perf';
/** A reviewer as the triage's `review` lists it, resolved to its agent with the profile. */
export interface RoundReviewer { role: ReviewRole; agent: string; model: 'sonnet' | null; effort: ReviewEffort }
export interface TriageReview { light: boolean; reviewers: RoundReviewer[]; flags: string[] }
/** A reviewer's result in the previous round. */
export interface PreviousResult { verdict: 'pass' | 'fail' | 'abstain'; findings: Finding[] }
/**
 * Paths the reviewers receive: `out` is the round's review dir and `shadow` the twins' dir; `fix` (the fix diff) and
 * `findings` (a reviewer's own previous findings) only go to delta reviewers; `report` (the implementer's, under TDD)
 * only to correctness.
 */
export interface RoundFiles {
  brief: string; diff: string; validators: string; out: string; shadow: string;
  fix?: string; findings?: (name: ReviewerKey) => string; report?: string;
}
export interface RoundInput {
  review: TriageReview; round: number; path: PathName;
  previous?: Partial<Record<ReviewRole, PreviousResult>>;
  /** Zones and files the fix diff (previous round's head to now) touches. */
  fixZones?: Zone[]; fixFiles?: string[];
  /** The shadow test is open and this brief takes twins. */
  shadowOpen?: boolean;
  files: RoundFiles;
}
export interface SpawnEntry {
  role: ReviewRole; name: ReviewerKey; agent: string; model: 'sonnet' | null; effort: ReviewEffort; mode: ReviewMode;
  /** An xhigh shadow twin: the verdict does not read it. */
  twin: boolean;
  inputs: Record<string, string>;
}
export interface CarriedReviewer { role: ReviewRole; name: ReviewerKey; verdict: PreviousResult['verdict'] }
export interface RoundPlan { round: number; spawn: SpawnEntry[]; carried: CarriedReviewer[]; shadow: boolean }

export const reviewerKey = (role: ReviewRole): ReviewerKey => role.slice('review-'.length) as ReviewerKey;
const normPath = (p: string) => p.trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '');

/**
 * Round 1: every reviewer in full mode; with the shadow test open on a Medium or larger brief, an xhigh twin of each
 * reviewer at high, writing to `files.shadow`. From round 2: a reviewer that did not pass repeats in delta with only
 * its own findings; correctness always repeats in delta; security that passed repeats only when the fix diff touches
 * a sensitive zone, perf that passed only when the fix diff touches a file it flagged; else they are carried.
 * A reviewer the previous round did not have runs in full mode. Delta rounds have no twins.
 */
export function reviewRound(input: RoundInput): RoundPlan {
  const { review, files } = input;
  const round = Math.max(1, Math.floor(input.round));
  const base = (r: RoundReviewer): Record<string, string> => ({
    brief: files.brief, diff: files.diff, validators: files.validators, out: files.out,
    ...(r.role === 'review-correctness' && files.report ? { report: files.report } : {}),
  });
  const entry = (r: RoundReviewer, mode: ReviewMode, inputs: Record<string, string>): SpawnEntry =>
    ({ role: r.role, name: reviewerKey(r.role), agent: r.agent, model: r.model, effort: r.effort, mode, twin: false, inputs });

  if (round === 1) {
    const spawn = review.reviewers.map(r => entry(r, 'full', base(r)));
    const shadow = !!input.shadowOpen && !review.light && (input.path === 'medium' || input.path === 'large');
    const twins = shadow
      ? review.reviewers.filter(r => r.effort === 'high').map(r => ({ ...entry(r, 'full', { ...base(r), out: files.shadow }), effort: 'xhigh' as const, twin: true }))
      : [];
    return { round, spawn: [...spawn, ...twins], carried: [], shadow: twins.length > 0 };
  }

  const fixFiles = new Set((input.fixFiles ?? []).map(normPath));
  const fixZones = input.fixZones ?? [];
  const spawn: SpawnEntry[] = [];
  const carried: CarriedReviewer[] = [];
  for (const r of review.reviewers) {
    const prev = input.previous?.[r.role];
    if (!prev) { spawn.push(entry(r, 'full', base(r))); continue; }
    const name = reviewerKey(r.role);
    const repeats = prev.verdict !== 'pass'
      || r.role === 'review-correctness'
      || (r.role === 'review-security' && fixZones.length > 0)
      || (r.role === 'review-perf' && prev.findings.some(f => !!f.file && fixFiles.has(normPath(f.file))));
    if (!repeats) { carried.push({ role: r.role, name, verdict: prev.verdict }); continue; }
    spawn.push(entry(r, 'delta', {
      ...base(r),
      ...(files.fix ? { fix: files.fix } : {}),
      ...(files.findings ? { findings: files.findings(name) } : {}),
    }));
  }
  return { round, spawn, carried, shadow: false };
}
