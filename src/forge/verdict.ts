import { createHash } from 'node:crypto';

export type ReviewerName = 'correctness' | 'security' | 'perf' | 'verify';
export interface Finding { severity: 'critical' | 'important' | 'minor'; file?: string; line?: number; problem: string; fix?: string }
export interface Review { verdict: 'pass' | 'fail' | 'abstain'; confidence: number; findings: Finding[]; approach?: 'ok' | 'wrong'; invalid?: boolean; dropped?: number }
export interface FailingValidator { validator: string; failures: string[] }
export interface Weights { correctness: number; security: number; perf: number; verify: number }
export type Action = 'accept' | 'fix' | 'redo';
export interface VerdictResult {
  action: Action; score: number | null; reasons: string[]; critical: Finding[]; important: Finding[]; minor: Finding[];
  reviewers: { name: ReviewerName; verdict: Review['verdict']; confidence: number; weight: number; invalid: boolean; dropped: number }[]; signature: string;
}

const invalidReview = (): Review => ({ verdict: 'abstain', confidence: 0, findings: [], invalid: true });
const SEVERITIES = ['critical', 'important', 'minor'] as const;

// A number, or a string that is one ("0.8"); null otherwise.
function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v.trim()))) return Number(v.trim());
  return null;
}

// A line number: 12, "12", or the start of a range such as "12-15".
function lineOf(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 ? v : undefined;
  const m = typeof v === 'string' ? /^\s*(\d+)/.exec(v) : null;
  return m ? Number(m[1]) : undefined;
}

// One finding, leniently: an unknown severity counts as important, a null file is no file, and a
// finding without a problem is dropped (null) rather than voiding the whole review.
function findingOf(v: unknown): Finding | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const f = v as Record<string, unknown>;
  if (typeof f.problem !== 'string' || !f.problem.trim()) return null;
  const sev = typeof f.severity === 'string' ? f.severity.trim().toLowerCase() : '';
  const out: Finding = { severity: (SEVERITIES as readonly string[]).includes(sev) ? sev as Finding['severity'] : 'important', problem: f.problem };
  if (typeof f.file === 'string' && f.file.trim()) out.file = f.file;
  const line = lineOf(f.line);
  if (line !== undefined) out.line = line;
  if (typeof f.fix === 'string') out.fix = f.fix;
  return out;
}

// Reads a reviewer's JSON (possibly wrapped in prose or a fence). Output that cannot be used at all
// (no object, unknown verdict, confidence missing or out of 0..1, findings not a list) abstains
// with invalid: true.
export function parseReview(text: string | null): Review {
  if (!text) return invalidReview();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return invalidReview();
  let raw: unknown;
  try { raw = JSON.parse(text.slice(start, end + 1)); } catch { return invalidReview(); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalidReview();
  const r = raw as Record<string, unknown>;
  const verdict = typeof r.verdict === 'string' ? r.verdict.trim().toLowerCase() : '';
  if (verdict !== 'pass' && verdict !== 'fail' && verdict !== 'abstain') return invalidReview();
  const confidence = num(r.confidence);
  if (confidence === null || confidence < 0 || confidence > 1) return invalidReview();
  if (r.findings !== undefined && r.findings !== null && !Array.isArray(r.findings)) return invalidReview();
  const rawFindings = Array.isArray(r.findings) ? r.findings : [];
  const findings = rawFindings.map(findingOf).filter((f): f is Finding => f !== null);
  const dropped = rawFindings.length - findings.length;
  const review: Review = { verdict, confidence, findings };
  if (r.approach === 'ok' || r.approach === 'wrong') review.approach = r.approach;
  if (dropped > 0) { review.dropped = dropped; review.invalid = true; }
  return review;
}

export function weightsFor(opts: { sensitive: boolean; perf: boolean }): Weights {
  if (opts.sensitive && opts.perf) return { correctness: 0.2, security: 0.4, perf: 0.4, verify: 0.2 };
  if (opts.sensitive) return { correctness: 0.3, security: 0.5, perf: 0.2, verify: 0.3 };
  if (opts.perf) return { correctness: 0.3, security: 0.2, perf: 0.5, verify: 0.3 };
  return { correctness: 0.5, security: 0.3, perf: 0.2, verify: 0.5 };
}

export interface VerifyCheck { id: number; surface: string; name: string; main: boolean; ok: boolean; expected: string; observed: string; shot: string | null }
export interface VerifyFile {
  surfaces: string[]; result: 'pass' | 'fail' | 'blocked'; reason: string | null; checks: VerifyCheck[]; unchecked: string[];
  learned: { surface: string; note: string }[]; proposals: { surface: string; change: string }[];
}

const s = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const truthy = (v: unknown) => v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');

// forge-verify's file, read as leniently as a reviewer's: JSON inside prose or a fence; a check without `shot` keeps
// null; `ok` as "true" counts. Null when unusable: no object, an unknown result, checks not a list, blocked without reason.
export function parseVerifyFile(text: string | null): VerifyFile | null {
  if (!text) return null;
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  let raw: unknown;
  try { raw = JSON.parse(text.slice(a, b + 1)); } catch { return null; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const result = s(r.result).trim().toLowerCase();
  if (result !== 'pass' && result !== 'fail' && result !== 'blocked') return null;
  if (!Array.isArray(r.checks)) return null;
  const reason = typeof r.reason === 'string' && r.reason.trim() ? r.reason : null;
  if (result === 'blocked' && !reason) return null;
  const objs = (x: unknown) => (Array.isArray(x) ? x.filter((o): o is Record<string, unknown> => !!o && typeof o === 'object' && !Array.isArray(o)) : []);
  return {
    surfaces: Array.isArray(r.surfaces) ? r.surfaces.filter((x): x is string => typeof x === 'string') : [],
    result, reason,
    checks: objs(r.checks).map((c, i) => ({
      id: typeof c.id === 'number' ? c.id : i + 1, surface: s(c.surface), name: s(c.name), main: truthy(c.main), ok: truthy(c.ok),
      expected: s(c.expected), observed: s(c.observed), shot: typeof c.shot === 'string' && c.shot.trim() ? c.shot : null,
    })),
    unchecked: Array.isArray(r.unchecked) ? r.unchecked.map(s) : [],
    learned: objs(r.learned).filter(l => typeof l.note === 'string' && l.note.trim()).map(l => ({ surface: s(l.surface), note: s(l.note) })),
    proposals: objs(r.proposals).filter(p => typeof p.change === 'string' && p.change.trim()).map(p => ({ surface: s(p.surface), change: s(p.change) })),
  };
}

// As a review: pass is a confident pass; each failed check is a finding (critical on the main flow, important
// otherwise) with `verify/<surface>` as its evidence; blocked or unusable abstains, flagged invalid.
export function verifyReview(v: VerifyFile | null): Review {
  if (!v || v.result === 'blocked') return invalidReview();
  if (v.result === 'pass') return { verdict: 'pass', confidence: 1, findings: [] };
  const findings: Finding[] = v.checks.filter(c => !c.ok).map(c => ({
    severity: c.main ? 'critical' : 'important', file: `verify/${c.surface || 'app'}`,
    problem: `${c.name}: expected ${c.expected}, observed ${c.observed}`,
  }));
  return { verdict: 'fail', confidence: 1, findings };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const isEvidence = (f: Finding) => !!f.file?.trim() && !!f.problem.trim();

// pass: 0.7 + 0.3c. fail with a critical/important finding: 0.6 - 0.1c. fail with the wrong approach
// or with nothing concrete to fix: 0.5 - 0.5c.
function reviewScore(r: Review): number {
  if (r.verdict === 'pass') return 0.7 + 0.3 * r.confidence;
  const concrete = r.findings.some(f => f.severity === 'critical' || f.severity === 'important');
  return r.approach === 'wrong' || !concrete ? 0.5 - 0.5 * r.confidence : 0.6 - 0.1 * r.confidence;
}

export function synthesize(reviews: Partial<Record<ReviewerName, Review>>, weights: Weights, validatorsOk: boolean, failingValidators: FailingValidator[] = []): VerdictResult {
  const names = (Object.keys(reviews) as ReviewerName[]).filter(n => reviews[n]);
  const answered = names.filter(n => reviews[n]!.verdict !== 'abstain');
  const all = answered.flatMap(n => reviews[n]!.findings);
  const critical = all.filter(f => f.severity === 'critical' && isEvidence(f));
  const important = all.filter(f => f.severity === 'important');
  const minor = all.filter(f => f.severity === 'minor' || (f.severity === 'critical' && !isEvidence(f)));
  const failImportant = answered.some(n => reviews[n]!.verdict === 'fail' && reviews[n]!.findings.some(f => f.severity === 'important'));
  const sumW = answered.reduce((s, n) => s + weights[n], 0);
  const score = answered.length && sumW > 0
    ? round3(answered.reduce((s, n) => s + weights[n] * reviewScore(reviews[n]!), 0) / sumW)
    : null;
  const reasons: string[] = [];
  let action: Action;
  if (score === null) {
    action = validatorsOk ? 'accept' : 'fix';
    reasons.push('no reviewer answered: validators decide');
  } else if (score < 0.5) {
    action = 'redo'; reasons.push(`score ${score} < 0.5`);
  } else if (critical.length) {
    action = 'fix'; reasons.push(`${critical.length} critical finding(s) with evidence`);
  } else if (!validatorsOk) {
    action = 'fix'; reasons.push('validators failing');
  } else if (failImportant) {
    action = 'fix'; reasons.push('a failing reviewer reported important finding(s)');
  } else if (score >= 0.7) {
    action = 'accept'; reasons.push(`score ${score} >= 0.7`);
  } else {
    action = 'fix'; reasons.push(`score ${score} between 0.5 and 0.7`);
  }
  const blocking = [
    ...[...critical, ...important].map(f => `${f.severity}|${f.file ?? ''}|${f.problem.trim().toLowerCase()}`),
    ...failingValidators.map(v => `validator|${v.validator}|${v.failures.join('\n')}`),
  ].sort();
  const signature = createHash('sha256').update(JSON.stringify(blocking)).digest('hex').slice(0, 16);
  return {
    action, score, reasons, critical, important, minor, signature,
    reviewers: names.map(n => ({ name: n, verdict: reviews[n]!.verdict, confidence: reviews[n]!.confidence, weight: weights[n], invalid: reviews[n]!.invalid === true, dropped: reviews[n]!.dropped ?? 0 })),
  };
}
