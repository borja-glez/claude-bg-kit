import type { PathName, ReviewEffort, ReviewRole, Zone } from './triage.js';
import type { Finding } from './verdict.js';

// Who reviews in each round of a brief (design «Rondas de arreglo» and «Validación en sombra»).

export type ReviewMode = 'full' | 'delta';
export type ReviewerKey = 'correctness' | 'security' | 'perf';
/** A reviewer as the triage's `review` lists it, resolved to its agent with the profile. */
export interface RoundReviewer { role: ReviewRole; agent: string; model: 'sonnet' | null; effort: ReviewEffort }
export interface TriageReview { light: boolean; reviewers: RoundReviewer[]; flags: string[] }
/**
 * A reviewer's result in the previous round. `incomplete` (a draft with `"complete": false`) or `invalid` (findings
 * dropped by the parser): it is never carried, the reviewer repeats.
 */
export interface PreviousResult { verdict: 'pass' | 'fail' | 'abstain'; findings: Finding[]; incomplete?: boolean; invalid?: boolean }
/**
 * Paths the reviewers receive: `out` is the round's review dir and `shadow` the twins' dir; `fix` (the fix diff) and
 * `findings` (a reviewer's own previous findings) only go to delta reviewers; `report` (the implementer's, under TDD)
 * only to correctness; `threatModel` only to security.
 */
export interface RoundFiles {
  brief: string; diff: string; validators: string; out: string; shadow: string;
  fix?: string; findings?: (name: ReviewerKey) => string; report?: string;
  /** The threat model file (K4-02): security only. */
  threatModel?: string;
  /** The open findings of every reviewer, with ids and reviewers, for the express reviewer (measure 7). */
  expressFindings?: string;
}
export interface RoundInput {
  review: TriageReview; round: number; path: PathName;
  previous?: Partial<Record<ReviewRole, PreviousResult>>;
  /** Zones and files the fix diff (previous round's head to now) touches. */
  fixZones?: Zone[]; fixFiles?: string[];
  /** The shadow test is open and this brief takes twins. */
  shadowOpen?: boolean;
  /** The previous round's verdict was redo: the work was started again, so nothing is carried and nobody reviews in delta. */
  redo?: boolean;
  /** The CLI found the previous review fit for an express review (measure 7): reviewRound decides whether the plan allows it. */
  express?: boolean;
  files: RoundFiles;
}
export interface SpawnEntry {
  role: ReviewRole; name: ReviewerKey; agent: string; model: 'sonnet' | null; effort: ReviewEffort; mode: ReviewMode;
  /** An xhigh shadow twin: the verdict does not read it. */
  twin: boolean;
  /** The express reviewer (measure 7). */
  express?: boolean;
  inputs: Record<string, string>;
}
export interface CarriedReviewer { role: ReviewRole; name: ReviewerKey; verdict: PreviousResult['verdict'] }
/** `express`: one correctness reviewer on Sonnet checks every open finding; `delegated`: the reviewers that failed, whose
 *  open findings it checks instead of them (they are neither spawned nor carried). */
export interface RoundPlan { round: number; spawn: SpawnEntry[]; carried: CarriedReviewer[]; shadow: boolean; express: boolean; delegated: ReviewerKey[] }

export const reviewerKey = (role: ReviewRole): ReviewerKey => role.slice('review-'.length) as ReviewerKey;
const normPath = (p: string) => p.trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '');

/**
 * Round 1: every reviewer in full mode; with the shadow test open on a Medium or larger brief, an xhigh twin of each
 * reviewer at high, writing to `files.shadow`. From round 2: a reviewer that did not pass repeats in delta with only
 * its own findings; correctness always repeats in delta; security that passed repeats only when the fix diff touches
 * a sensitive zone, perf that passed only when the fix diff touches a file it flagged; else they are carried. A previous
 * result that was a draft or invalid is never carried: that reviewer repeats in delta.
 * A reviewer the previous round did not have runs in full mode, and after a redo every reviewer does, none carried.
 * Rounds after the first have no twins.
 * With input.express (measure 7), from round 2 and not after a redo, the plan is one correctness reviewer on Sonnet at
 * medium in delta (express: true) when every reviewer that would repeat is correctness or one that failed, never
 * security: the passing ones are carried, the failing ones delegated.
 */
export function reviewRound(input: RoundInput): RoundPlan {
  const { review, files } = input;
  const round = Math.max(1, Math.floor(input.round));
  const base = (r: RoundReviewer): Record<string, string> => ({
    brief: files.brief, diff: files.diff, validators: files.validators, out: files.out,
    ...(r.role === 'review-correctness' && files.report ? { report: files.report } : {}),
    ...(r.role === 'review-security' && files.threatModel ? { threatModel: files.threatModel } : {}),
  });
  const entry = (r: RoundReviewer, mode: ReviewMode, inputs: Record<string, string>): SpawnEntry =>
    ({ role: r.role, name: reviewerKey(r.role), agent: r.agent, model: r.model, effort: r.effort, mode, twin: false, inputs });

  if (round === 1) {
    const spawn = review.reviewers.map(r => entry(r, 'full', base(r)));
    const shadow = !!input.shadowOpen && !review.light && (input.path === 'medium' || input.path === 'large');
    const twins = shadow
      ? review.reviewers.filter(r => r.effort === 'high').map(r => ({ ...entry(r, 'full', { ...base(r), out: files.shadow }), effort: 'xhigh' as const, twin: true }))
      : [];
    return { round, spawn: [...spawn, ...twins], carried: [], shadow: twins.length > 0, express: false, delegated: [] };
  }
  if (input.redo) return { round, spawn: review.reviewers.map(r => entry(r, 'full', base(r))), carried: [], shadow: false, express: false, delegated: [] };

  const fixFiles = new Set((input.fixFiles ?? []).map(normPath));
  const fixZones = input.fixZones ?? [];
  const spawn: SpawnEntry[] = [];
  const carried: CarriedReviewer[] = [];
  for (const r of review.reviewers) {
    const prev = input.previous?.[r.role];
    if (!prev) { spawn.push(entry(r, 'full', base(r))); continue; }
    const name = reviewerKey(r.role);
    const repeats = prev.verdict !== 'pass' || !!prev.incomplete || !!prev.invalid
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
  const normal: RoundPlan = { round, spawn, carried, shadow: false, express: false, delegated: [] };
  // Measure 7 (§4.9): the CLI asks for an express review; it is one only when every reviewer that would repeat is
  // correctness or one that failed (never security): a passing reviewer that has to repeat keeps the review normal.
  const correctness = review.reviewers.find(r => r.role === 'review-correctness');
  if (!input.express || !correctness || !files.expressFindings) return normal;
  const delegated: ReviewerKey[] = [];
  for (const s of spawn) {
    const failed = input.previous?.[s.role]?.verdict === 'fail';
    if (s.name === 'security' || (s.name !== 'correctness' && !failed)) return normal;
    if (failed) delegated.push(s.name);
  }
  return {
    round, carried, shadow: false, express: true, delegated,
    spawn: [{ role: 'review-correctness', name: 'correctness', agent: correctness.agent, model: 'sonnet', effort: 'medium', mode: 'delta', twin: false, express: true,
      inputs: { brief: files.brief, diff: files.diff, validators: files.validators, out: files.out, ...(files.fix ? { fix: files.fix } : {}), findings: files.expressFindings } }],
  };
}
