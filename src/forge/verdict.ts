import { createHash } from 'node:crypto';

export type ReviewerName = 'correctness' | 'security' | 'perf' | 'verify';
// origin (fix rounds, delta mode): previous = an earlier finding still open, fix = introduced by the fix,
// untouched = in code the fix did not touch.
export type Origin = 'previous' | 'fix' | 'untouched';
const ORIGINS = ['previous', 'fix', 'untouched'] as const;
export interface Finding { severity: 'critical' | 'important' | 'minor'; file?: string; line?: number; problem: string; fix?: string; origin?: Origin }
export interface Review { verdict: 'pass' | 'fail' | 'abstain'; confidence: number; findings: Finding[]; approach?: 'ok' | 'wrong'; invalid?: boolean; dropped?: number }
export interface FailingValidator { validator: string; failures: string[] }
export interface Weights { correctness: number; security: number; perf: number; verify: number }
export type Action = 'accept' | 'fix' | 'redo';
export interface VerdictResult {
  action: Action; score: number | null; reasons: string[]; critical: Finding[]; important: Finding[]; minor: Finding[];
  reviewers: { name: ReviewerName; verdict: Review['verdict']; confidence: number; weight: number; invalid: boolean; dropped: number }[]; signature: string;
  // From round 2: important untouched findings left for the person because nothing else opened a round.
  deferred: Finding[];
}
// New-side line ranges of a fix diff's hunks, per file (path as in `+++ b/<path>`).
export type FixHunks = Record<string, { start: number; end: number }[]>;
/**
 * `root`: the repo dir, to make reviewers' absolute paths relative. `carried`: reviewers whose result was carried
 * from the previous round: their findings keep the origins they had there instead of being checked against this fix.
 */
export interface RoundOptions { round?: number; fixHunks?: FixHunks; root?: string; carried?: ReviewerName[] }

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
  const origin = typeof f.origin === 'string' ? f.origin.trim().toLowerCase() : '';
  if ((ORIGINS as readonly string[]).includes(origin)) out.origin = origin as Origin;
  return out;
}

const normPath = (p: string) => p.trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '');

/**
 * A reviewer's path as the diff names it: backslashes to slashes, no leading `./`, and an absolute path under
 * `root` (the repo) made relative to it (case-insensitively when the root has a drive letter).
 */
export function repoRelative(p: string, root?: string): string {
  const n = normPath(p);
  if (!root?.trim()) return n;
  const r = normPath(root).replace(/\/+$/, '');
  const drive = /^[A-Za-z]:/.test(r);
  const [hay, needle] = drive ? [n.toLowerCase(), r.toLowerCase()] : [n, r];
  return r && hay.startsWith(`${needle}/`) ? normPath(n.slice(r.length + 1)) : n;
}

// Reads the hunks of a unified diff: the file from each `+++ b/<path>` header (a deleted file, /dev/null,
// has none) and the new-side range of each `@@ -a,b +c,d @@`. A pure deletion (d = 0) covers line c.
// The lines of a hunk's body are counted by its ranges, so a removed `-- x` or an added `++ y` (seen as
// `--- x` and `+++ y`) is never read as a file header.
export function parseHunks(diff: string): FixHunks {
  const out: FixHunks = {};
  let file: string | null = null;
  let prev = '';
  let oldLeft = 0, newLeft = 0;
  for (const raw of diff.split('\n')) {
    const line = raw.replace(/\r$/, '');
    // A body line starts with ' ', '-', '+' or '\'; a new hunk or file ends a body whose counts fell short.
    if ((oldLeft > 0 || newLeft > 0) && (line.startsWith('@@ ') || line.startsWith('diff '))) oldLeft = newLeft = 0;
    if (oldLeft > 0 || newLeft > 0) {
      if (line.startsWith('\\')) continue; // "\ No newline at end of file"
      if (line.startsWith('-')) oldLeft--;
      else if (line.startsWith('+')) newLeft--;
      else { oldLeft--; newLeft--; }
      prev = '';
      continue;
    }
    if (line.startsWith('+++ ') && prev.startsWith('--- ')) {
      const p = line.slice(4).split('\t')[0];
      file = p === '/dev/null' ? null : normPath(p.startsWith('b/') ? p.slice(2) : p);
    } else {
      const m = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (m) {
        oldLeft = m[1] === undefined ? 1 : Number(m[1]);
        newLeft = m[3] === undefined ? 1 : Number(m[3]);
        if (file) {
          const start = Number(m[2]), count = m[3] === undefined ? 1 : Number(m[3]);
          (out[file] ??= []).push({ start, end: start + Math.max(count, 1) - 1 });
        }
      }
    }
    prev = line;
  }
  return out;
}

// Checks a reviewer's origin label against the fix's hunks: an untouched finding whose file and line fall
// inside a hunk is fix, and one without file or line cannot be shown untouched, so it is fix too. The
// finding's path is made relative to `root` (the repo) first.
export function correctOrigin(f: Finding, hunks: FixHunks, root?: string): Finding {
  if (f.origin !== 'untouched') return f;
  if (!f.file?.trim() || f.line === undefined) return { ...f, origin: 'fix' };
  const ranges = hunks[repoRelative(f.file, root)] ?? [];
  return ranges.some(r => f.line! >= r.start && f.line! <= r.end) ? { ...f, origin: 'fix' } : f;
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
  const checks = objs(r.checks).map((c, i) => ({
    id: typeof c.id === 'number' ? c.id : i + 1, surface: s(c.surface), name: s(c.name), main: truthy(c.main), ok: truthy(c.ok),
    expected: s(c.expected), observed: s(c.observed), shot: typeof c.shot === 'string' && c.shot.trim() ? c.shot : null,
  }));
  return {
    surfaces: Array.isArray(r.surfaces) ? r.surfaces.filter((x): x is string => typeof x === 'string') : [],
    // Unless blocked, the checks decide: a stated result that disagrees with them is overridden.
    result: result === 'blocked' ? result : checks.some(c => !c.ok) ? 'fail' : 'pass', reason,
    checks,
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

// From round 2 (opts.round >= 2) origins are checked against opts.fixHunks and an important untouched finding
// does not open a round by itself: it rides along when something else opens one, and is deferred when the
// task is accepted. A review whose only blocking findings are such scores as a pass with its confidence,
// and the signature leaves them out. Round 1, or no opts, behaves as before.
export function synthesize(reviews: Partial<Record<ReviewerName, Review>>, weights: Weights, validatorsOk: boolean, failingValidators: FailingValidator[] = [], opts: RoundOptions = {}): VerdictResult {
  const names = (Object.keys(reviews) as ReviewerName[]).filter(n => reviews[n]);
  const later = (opts.round ?? 1) >= 2;
  const hunks = opts.fixHunks ?? {};
  const rv: Partial<Record<ReviewerName, Review>> = later
    ? Object.fromEntries(names.map(n => [n, opts.carried?.includes(n) ? reviews[n]! : { ...reviews[n]!, findings: reviews[n]!.findings.map(f => correctOrigin(f, hunks, opts.root)) }]))
    : reviews;
  // A reviewer that says the approach is wrong keeps its findings blocking whatever their origin.
  const wrong = new Set(names.filter(n => rv[n]!.verdict === 'fail' && rv[n]!.approach === 'wrong').flatMap(n => rv[n]!.findings));
  const deferrable = (f: Finding) => later && f.severity === 'important' && f.origin === 'untouched' && !wrong.has(f);
  const blocks = (f: Finding) => (f.severity === 'critical' && isEvidence(f)) || f.severity === 'important';
  // The review as the score and the fail rule see it: failing only on deferrable findings counts as a pass,
  // unless the approach is wrong.
  const effective = (r: Review): Review => {
    const b = r.findings.filter(blocks);
    return r.verdict === 'fail' && r.approach !== 'wrong' && b.length && b.every(deferrable) ? { ...r, verdict: 'pass' } : r;
  };
  const answered = names.filter(n => rv[n]!.verdict !== 'abstain');
  const all = answered.flatMap(n => rv[n]!.findings);
  const critical = all.filter(f => f.severity === 'critical' && isEvidence(f));
  let important = all.filter(f => f.severity === 'important');
  const minor = all.filter(f => f.severity === 'minor' || (f.severity === 'critical' && !isEvidence(f)));
  const failImportant = answered.some(n => effective(rv[n]!).verdict === 'fail' && rv[n]!.findings.some(f => f.severity === 'important' && !deferrable(f)));
  const sumW = answered.reduce((s, n) => s + weights[n], 0);
  const score = answered.length && sumW > 0
    ? round3(answered.reduce((s, n) => s + weights[n] * reviewScore(effective(rv[n]!)), 0) / sumW)
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
  let deferred: Finding[] = [];
  if (action === 'accept') {
    deferred = important.filter(deferrable);
    if (deferred.length) {
      important = important.filter(f => !deferrable(f));
      reasons.push(`${deferred.length} untouched important finding(s) deferred`);
    }
  }
  const blocking = [
    ...[...critical, ...important].filter(f => !deferrable(f)).map(f => `${f.severity}|${f.file ?? ''}|${f.problem.trim().toLowerCase()}`),
    ...failingValidators.map(v => `validator|${v.validator}|${v.failures.join('\n')}`),
  ].sort();
  const signature = createHash('sha256').update(JSON.stringify(blocking)).digest('hex').slice(0, 16);
  return {
    action, score, reasons, critical, important, minor, signature,
    reviewers: names.map(n => ({ name: n, verdict: reviews[n]!.verdict, confidence: reviews[n]!.confidence, weight: weights[n], invalid: reviews[n]!.invalid === true, dropped: reviews[n]!.dropped ?? 0 })),
    deferred,
  };
}
