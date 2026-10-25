import { createHash } from 'node:crypto';
import { findingsMatch } from './finding-match.js';
import { globMatch } from './validators.js';
import { oneLine } from '../lib/one-line.js';

export type ReviewerName = 'correctness' | 'security' | 'perf' | 'verify';
// origin (fix rounds, delta mode): previous = an earlier finding still open, fix = introduced by the fix,
// untouched = in code the fix did not touch.
export type Origin = 'previous' | 'fix' | 'untouched';
const ORIGINS = ['previous', 'fix', 'untouched'] as const;
/** Why a critical or important finding does not block (C-04, §4.7): the CLI sets it. */
export type Residual = 'untouched' | 'hardening' | 'late-round' | 'cap' | 'docs' | 'out-of-model' | 'architecture' | 'env-unverified' | 'declined';
export interface Finding {
  severity: 'critical' | 'important' | 'minor'; file?: string; line?: number; problem: string; fix?: string; origin?: Origin;
  /** The finding's stable id within its brief (F1, F2…): a delta reviewer copies it; the CLI assigns it (J-06). */
  id?: string;
  /** Set by the CLI: whose finding it is (an express reviewer reports other reviewers' ones). */
  reviewer?: ReviewerName;
  /** The reviewer says the fix broke behaviour that worked before it (delta mode). */
  regression?: boolean;
  /** Security: it needs an attacker or a capability the threat model trusts, or the model lists it out of scope (K4-02). */
  outOfModel?: boolean;
  /** Set by the CLI: why it does not block. */
  residual?: Residual;
  /** Set by the CLI: the severity the reviewer gave a finding the CLI lowered to minor (outOfModel). */
  declared?: 'critical' | 'important' | 'minor';
  /** Set by the CLI on a verify finding: the name of its check (K2-10). Its stable id and the signature follow the check,
   *  not what the agent observed this time. */
  check?: string;
}
/** A finding an earlier review of the brief closed; `round` is the last review that had it open (J-06, hardening). */
export interface ClosedFinding extends Finding { id: string; round: number }
// abstained (K2-09): the reviewer said it could not judge (a verify agent's blocked), with its reason: an abstention, never invalid output to respawn.
/** A7: a part of the work the reviewer considered and chose not to judge, and why (one line each). */
export interface Declined { what: string; why: string }
export const DECLINED_MAX = 20;
export interface Review { declined?: Declined[]; verdict: 'pass' | 'fail' | 'abstain'; confidence: number; findings: Finding[]; approach?: 'ok' | 'wrong'; invalid?: boolean; dropped?: number; incomplete?: boolean; abstained?: true; reason?: string }
export interface FailingValidator { validator: string; failures: string[]; failing?: string[] }
export interface Weights { correctness: number; security: number; perf: number; verify: number }
export type Action = 'accept' | 'fix' | 'redo';
/** A security finding of a fix round that matches one security already closed (K4-02): the person says whether it is
 *  inside the threat model before the loop goes on. */
export interface AskFinding { id?: string; severity: Finding['severity']; file?: string; line?: number; problem: string; earlier: { id: string; round: number; problem: string } }
export interface VerdictResult {
  action: Action; score: number | null; reasons: string[]; critical: Finding[]; important: Finding[]; minor: Finding[];
  reviewers: { name: ReviewerName; verdict: Review['verdict']; confidence: number; weight: number; invalid: boolean; dropped: number; incomplete: boolean }[]; signature: string;
  // The critical and important findings that do not block, each with its `residual`: on an accept, all of them; on a fix,
  // the ones that do not ride along to the implementer (hardening, architecture, and cap on a fix at the last review).
  deferred: Finding[];
  /** Security findings that repeat a closed theme: counted as blocking; the skill asks the person first. */
  ask: AskFinding[];
}
// New-side line ranges of a fix diff's hunks, per file (path as in `+++ b/<path>`).
export type FixHunks = Record<string, { start: number; end: number }[]>;
/**
 * `round`: the review number r of the brief. `root`: the repo dir, to make reviewers' absolute paths relative. `carried`:
 * reviewers whose result was carried from the previous review: their findings keep the origins they had there. `last`: this
 * review closes the last attempt (the verdicts that did not accept already reach the cap). `personDocs`: globs of the docs
 * written for people (review.personDocs). `open`: the ids the previous review left open, per reviewer; `closed`: the findings
 * closed before this review (findings-index.ts). `outOfModel` and `defer`: the ids the person ruled out of the threat model
 * or deferred as an architecture change (overrides.json).
 */
export interface RoundOptions {
  round?: number; fixHunks?: FixHunks; root?: string; carried?: ReviewerName[];
  last?: boolean; personDocs?: string[];
  open?: Partial<Record<ReviewerName, string[]>>; closed?: Partial<Record<ReviewerName, ClosedFinding[]>>;
  outOfModel?: string[]; defer?: string[];
  /** Measure 7: an express review whose correctness did not answer checked nothing for the reviewers delegated to it.
   *  Their open findings (`findings`) block as they were and the review never accepts; `reason` goes to the reasons. */
  hold?: { reason: string; findings: Finding[] };
  /** I4: the first review after a redo, of an attempt started again: judged as review 1 (no origins, previous or closed
   *  findings), while `round` still counts the brief's reviews and `last` still applies. */
  fresh?: boolean;
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

// A flag as reviewers write it: true or the string "true".
const isTrue = (v: unknown): boolean => v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');

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
  // J-06 / K4-02: the id a delta reviewer copied and the reviewer's own flags, as leniently as the rest. The reviewer,
  // the residual and a declared severity are the CLI's: never read from a reviewer's file.
  const id = typeof f.id === 'string' ? f.id.trim().toUpperCase() : '';
  if (/^F\d{1,3}$/.test(id)) out.id = id;
  if (isTrue(f.regression)) out.regression = true;
  if (isTrue(f.outOfModel)) out.outOfModel = true;
  return out;
}

const normPath = (p: string) => p.trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '');

/**
 * A reviewer's path as the diff names it: backslashes to slashes, no leading `./`, and an absolute path under
 * `root` (the repo) made relative to it (case-insensitively when the root has a drive letter).
 */
export function repoRelative(p: string, root?: string): string {
  let n = normPath(p);
  if (!root?.trim()) return n;
  const r = normPath(root).replace(/\/+$/, '');
  const drive = /^[A-Za-z]:/.test(r);
  if (drive && /^\/[A-Za-z]\//.test(n)) n = `${n[1]}:${n.slice(2)}`; // Git Bash's /e/... is E:/...
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
// with invalid: true. `"complete": false` (or "false") marks a reviewer's draft, left when it ran out of turns:
// incomplete: true, scored as written. A missing `complete` is a complete review.
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
  if (r.complete === false || (typeof r.complete === 'string' && r.complete.trim().toLowerCase() === 'false')) review.incomplete = true;
  const declined = declinedOf(r.declined);
  if (declined.length) review.declined = declined;
  return review;
}

// A7: the reviewer's declined list, read leniently: strings and {what, why} objects, one line each, never a reason to invalidate.
function declinedOf(raw: unknown): Declined[] {
  if (!Array.isArray(raw)) return [];
  const cut = (s: string, n: number) => Array.from(oneLine(s)).slice(0, n).join('');
  const out: Declined[] = [];
  for (const e of raw) {
    let what: unknown; let why: unknown = '';
    if (typeof e === 'string') what = e;
    else if (e && typeof e === 'object' && !Array.isArray(e)) { what = (e as Record<string, unknown>).what; why = (e as Record<string, unknown>).why; }
    if (typeof what !== 'string') continue;
    const w = cut(what, 200);
    if (!w) continue;
    out.push({ what: w, why: typeof why === 'string' ? cut(why, 300) : '' });
    if (out.length >= DECLINED_MAX) break;
  }
  return out;
}

export function weightsFor(opts: { sensitive: boolean; perf: boolean }): Weights {
  if (opts.sensitive && opts.perf) return { correctness: 0.2, security: 0.4, perf: 0.4, verify: 0.2 };
  if (opts.sensitive) return { correctness: 0.3, security: 0.5, perf: 0.2, verify: 0.3 };
  if (opts.perf) return { correctness: 0.3, security: 0.2, perf: 0.5, verify: 0.3 };
  return { correctness: 0.5, security: 0.3, perf: 0.2, verify: 0.5 };
}

export interface VerifyCheck { id: number; surface: string; name: string; main: boolean; ok: boolean; expected: string; observed: string; shot: string | null; env: boolean }
/** K2-12: a real problem the verify agent saw outside what the brief asked; verify-close makes it a proposal. */
export interface VerifyDefect { surface: string; title: string; observed: string; where: string; shot: string | null }
export interface VerifyFile {
  surfaces: string[]; result: 'pass' | 'fail' | 'blocked'; reason: string | null; checks: VerifyCheck[]; unchecked: string[];
  learned: { surface: string; note: string }[]; proposals: { surface: string; change: string }[]; defects: VerifyDefect[];
}

const s = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const truthy = isTrue;

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
    env: truthy(c.env),
  }));
  // K2-10: when every failed check is of the environment (it did not start, the port was taken, a tool is missing), the
  // verification could not judge the brief: blocked, with those checks as its reason when the agent gave none.
  const failed = checks.filter(c => !c.ok);
  const envOnly = result !== 'blocked' && failed.length > 0 && failed.every(c => c.env);
  return {
    surfaces: Array.isArray(r.surfaces) ? r.surfaces.filter((x): x is string => typeof x === 'string') : [],
    // Unless blocked, the checks decide: a stated result that disagrees with them is overridden.
    result: result === 'blocked' || envOnly ? 'blocked' : failed.length ? 'fail' : 'pass',
    reason: envOnly && !reason ? `environment: ${failed.map(c => c.name || `check ${c.id}`).join(', ')}` : reason,
    checks,
    unchecked: Array.isArray(r.unchecked) ? r.unchecked.map(s) : [],
    learned: objs(r.learned).filter(l => typeof l.note === 'string' && l.note.trim()).map(l => ({ surface: s(l.surface), note: s(l.note) })),
    proposals: objs(r.proposals).filter(p => typeof p.change === 'string' && p.change.trim()).map(p => ({ surface: s(p.surface), change: s(p.change) })),
    defects: objs(r.defects).filter(d => typeof d.title === 'string' && d.title.trim()).slice(0, 20).map(d => ({
      surface: s(d.surface), title: s(d.title).trim(), observed: s(d.observed), where: s(d.where), shot: typeof d.shot === 'string' && d.shot.trim() ? d.shot : null,
    })),
  };
}

// As a review: pass is a confident pass; each failed check is a finding with `verify/<surface>` as its evidence and its
// check's name (K2-10): critical on the main flow, important otherwise, minor when it failed because of the environment.
// The name is cut to 200 characters as the findings index keeps it (M8), so the same check always matches its entry.
// Blocked is the agent saying it could not verify: an abstention with its reason (K2-09); an unusable file abstains, invalid.
export function verifyReview(v: VerifyFile | null): Review {
  if (!v) return invalidReview();
  if (v.result === 'blocked') return { verdict: 'abstain', confidence: 0, findings: [], abstained: true, reason: v.reason ?? 'blocked' };
  if (v.result === 'pass') return { verdict: 'pass', confidence: 1, findings: [] };
  const findings: Finding[] = v.checks.filter(c => !c.ok).map(c => ({
    severity: c.env ? 'minor' : c.main ? 'critical' : 'important', file: `verify/${c.surface || 'app'}`,
    problem: `${c.name}: expected ${c.expected}, observed ${c.observed}`, check: (c.name || `check ${c.id}`).slice(0, 200),
  }));
  return { verdict: 'fail', confidence: 1, findings };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const isEvidence = (f: Finding) => !!f.file?.trim() && !!f.problem.trim();

/** J-05, the one rubric: a fail without an important finding or a critical with evidence. Such a review does not score,
 *  is invalid (synthesize) and closes no finding (answeredBy in findings-index.ts). */
export const breaksRubric = (r: Review): boolean =>
  r.verdict === 'fail' && !r.findings.some(f => f.severity === 'important' || (f.severity === 'critical' && isEvidence(f)));

// pass: 0.7 + 0.3c. fail with a critical/important finding: 0.6 - 0.1c. fail with the wrong approach
// or with nothing concrete to fix: 0.5 - 0.5c.
function reviewScore(r: Review): number {
  if (r.verdict === 'pass') return 0.7 + 0.3 * r.confidence;
  const concrete = r.findings.some(f => f.severity === 'critical' || f.severity === 'important');
  return r.approach === 'wrong' || !concrete ? 0.5 - 0.5 * r.confidence : 0.6 - 0.1 * r.confidence;
}

// The residuals that go to the implementer with the blocking findings when a round opens (§4.7).
const RIDES_ALONG: readonly Residual[] = ['untouched', 'docs', 'late-round'];

/**
 * The verdict of one review of a brief (C-04, §4.7). `opts.round` is the review number r; from r = 2 origins are checked
 * against opts.fixHunks. A critical with evidence always blocks (a security one that repeats a closed theme is also put to
 * the person: `ask`). An important blocks in review 1 unless it is only in the person's docs; in review 2 when it is still
 * open (previous) or the fix brought it (a regression); from review 3 only as a regression, except that a failing reviewer
 * that says `approach: wrong` keeps its importants blocking (not the docs ones) in any review before the last, so a redo
 * stays possible (inherited, C-06). A new finding that matches one the same reviewer closed is hardening (security:
 * blocking and asked).
 * The last review (opts.last) accepts a fix with green validators and no critical, leaving what is open as residual cap.
 * A finding that does not block carries its `residual`; a failing reviewer whose findings all do not block scores as a
 * pass. A fail without an important finding or a critical with evidence breaks the rubric (J-05): it does not score and is
 * invalid. Redo needs a score under 0.5 and a failing reviewer that says the approach is wrong with a finding that blocks
 * (C-06). A held review (opts.hold: an express one whose correctness did not answer, measure 7) never accepts, and the
 * findings it holds block. The first review after a redo (opts.fresh) is judged as review 1, though it counts as review r.
 * The signature covers what blocks, by severity and stable id.
 */
export function synthesize(reviews: Partial<Record<ReviewerName, Review>>, weights: Weights, validatorsOk: boolean, failingValidators: FailingValidator[] = [], opts: RoundOptions = {}): VerdictResult {
  const names = (Object.keys(reviews) as ReviewerName[]).filter(n => reviews[n]);
  const r = Math.max(1, opts.round ?? 1);
  const later = r >= 2 && opts.fresh !== true;
  const last = opts.last === true;
  const hunks = opts.fixHunks ?? {};
  // J-05: a fail without an important finding or a critical with evidence breaks the rubric.
  const rubric = names.filter(n => breaksRubric(reviews[n]!));
  const rv: Partial<Record<ReviewerName, Review>> = {};
  for (const n of names) {
    const x = reviews[n]!;
    rv[n] = rubric.includes(n) ? { ...x, verdict: 'abstain', confidence: 0, findings: [], invalid: true }
      : later && !opts.carried?.includes(n) ? { ...x, findings: x.findings.map(f => correctOrigin(f, hunks, opts.root)) } : x;
  }
  const wrongOf = (n: ReviewerName) => rv[n]!.verdict === 'fail' && rv[n]!.approach === 'wrong';
  const inDocs = (f: Finding) => !!f.file?.trim() && (opts.personDocs ?? []).some(g => globMatch(g, repoRelative(f.file!, opts.root)));

  // §4.7, one finding at a time: does it block, and if not, why (its residual); `earlier` is the closed finding a security
  // one repeats.
  type Judged = { blocks: boolean; residual?: Residual; earlier?: ClosedFinding };
  const judged = new Map<Finding, Judged>();
  const judge = (f: Finding, n: ReviewerName): Judged => {
    let j = judged.get(f);
    if (!j) { j = classify(f, n); judged.set(f, j); }
    return j;
  };
  function classify(f: Finding, n: ReviewerName): Judged {
    if (f.severity === 'minor') return { blocks: false };
    if (f.outOfModel || (f.id !== undefined && opts.outOfModel?.includes(f.id))) return { blocks: false, residual: 'out-of-model' };
    if (f.severity === 'critical' && !isEvidence(f)) return { blocks: false };
    if (f.id !== undefined && opts.defer?.includes(f.id)) return { blocks: false, residual: 'architecture' };
    const owner = f.reviewer ?? n;
    const previous = later && (f.origin === 'previous' || (f.id !== undefined && !!opts.open?.[owner]?.includes(f.id)));
    const earlier = later && !previous && f.regression !== true ? opts.closed?.[owner]?.find(c => findingsMatch(c, f)) : undefined;
    if (f.severity === 'critical') return earlier && owner === 'security' && !last ? { blocks: true, earlier } : { blocks: true };
    if (inDocs(f)) return { blocks: false, residual: 'docs' };
    if (wrongOf(n)) return last ? { blocks: false, residual: 'cap' } : { blocks: true };
    if (!later) return { blocks: true };
    if (previous) return last ? { blocks: false, residual: 'cap' } : r >= 3 ? { blocks: false, residual: 'late-round' } : { blocks: true };
    if (earlier) return last ? { blocks: false, residual: 'cap' } : owner === 'security' ? { blocks: true, earlier } : { blocks: false, residual: 'hardening' };
    if (f.origin === 'untouched' && f.regression !== true) return { blocks: false, residual: 'untouched' };
    return last ? { blocks: false, residual: 'cap' } : { blocks: true };
  }

  // The review as the score and the fail rule see it: failing only on findings that do not block counts as a pass,
  // unless the approach is wrong.
  const effective = (n: ReviewerName): Review => {
    const x = rv[n]!;
    if (x.verdict !== 'fail' || x.approach === 'wrong') return x;
    const heavy = x.findings.filter(f => f.severity !== 'minor');
    return heavy.length && heavy.every(f => !judge(f, n).blocks) ? { ...x, verdict: 'pass' } : x;
  };
  const answered = names.filter(n => rv[n]!.verdict !== 'abstain');
  const critical: Finding[] = [];
  let important: Finding[] = [];
  const minor: Finding[] = [];
  const residual: Finding[] = [];
  const ask: AskFinding[] = [];
  for (const n of answered) {
    for (const f of rv[n]!.findings) {
      const j = judge(f, n);
      if (j.residual === 'out-of-model') { minor.push({ ...f, severity: 'minor', declared: f.severity, outOfModel: true, residual: 'out-of-model' }); continue; }
      if (f.severity === 'minor' || (f.severity === 'critical' && !isEvidence(f))) { minor.push(f); continue; }
      if (j.residual) { residual.push({ ...f, residual: j.residual }); continue; }
      (f.severity === 'critical' ? critical : important).push(f);
      if (j.earlier) {
        ask.push({ ...(f.id !== undefined ? { id: f.id } : {}), severity: f.severity, ...(f.file ? { file: f.file } : {}), ...(f.line !== undefined ? { line: f.line } : {}),
          problem: f.problem, earlier: { id: j.earlier.id, round: j.earlier.round, problem: j.earlier.problem } });
      }
    }
  }
  const failImportant = answered.some(n => effective(n).verdict === 'fail' && rv[n]!.findings.some(f => f.severity === 'important' && judge(f, n).blocks));
  const wrongBlocking = answered.some(n => wrongOf(n) && rv[n]!.findings.some(f => judge(f, n).blocks));
  const sumW = answered.reduce((s, n) => s + weights[n], 0);
  const score = answered.length && sumW > 0
    ? round3(answered.reduce((s, n) => s + weights[n] * reviewScore(effective(n)), 0) / sumW)
    : null;
  const reasons: string[] = rubric.map(n => `${n}: fail without a critical or important finding (rubric)`);
  let action: Action;
  if (score === null) {
    action = validatorsOk ? 'accept' : 'fix';
    reasons.push('no reviewer answered: validators decide');
  } else if (score < 0.5 && wrongBlocking) {
    action = 'redo'; reasons.push(`score ${score} < 0.5 and a failing reviewer says the approach is wrong`);
  } else if (score < 0.5) {
    action = 'fix'; reasons.push(`score ${score} < 0.5, but no failing reviewer says approach: wrong with a finding that blocks: fix, not redo`);
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
  // Rule 7 (C-04): the last review accepts a fix with green validators and no critical; what is open stays as residual cap.
  if (last && action === 'fix' && validatorsOk && !critical.length) {
    residual.push(...important.map(f => ({ ...f, residual: 'cap' as const })));
    important = [];
    action = 'accept';
    reasons.push('the last review accepts a fix with green validators and no critical (rule 7)');
  }
  // Measure 7: a held review (opts.hold, never the last one) never accepts; the findings it holds block once each, those
  // a reviewer still names already counted as judged.
  if (opts.hold) {
    const named = new Set([...critical, ...important, ...minor, ...residual].map(f => f.id).filter(Boolean));
    for (const f of opts.hold.findings) if (!f.id || !named.has(f.id)) (f.severity === 'critical' ? critical : important).push(f);
    if (action === 'accept') action = 'fix';
    reasons.push(opts.hold.reason);
  }
  const capped = residual.filter(f => f.residual === 'cap').length;
  if (last && action === 'accept' && capped) reasons.push(`accepted at the cap with ${capped} open finding(s)`);
  const blockingImportant = important;
  let deferred: Finding[];
  if (action === 'accept') {
    deferred = [...residual];
    if (residual.length) reasons.push(`${residual.length} finding(s) left open as residual (${[...new Set(residual.map(f => f.residual))].join(', ')})`);
  } else {
    important = [...important, ...residual.filter(f => RIDES_ALONG.includes(f.residual!))];
    deferred = residual.filter(f => !RIDES_ALONG.includes(f.residual!));
  }
  // A7: what a reviewer that answered declined to judge goes to the person as deferred, whatever the action: it never rides
  // along to the implementer, never blocks and is never in the signature.
  const declined: Finding[] = answered.flatMap(n => (rv[n]!.declined ?? []).map(d => ({
    severity: 'minor' as const, problem: `declined to judge: ${d.what}${d.why ? ` (${d.why})` : ''}`, reviewer: n, residual: 'declined' as const,
  })));
  if (declined.length) { deferred.push(...declined); reasons.push(`${declined.length} part(s) declined to judge, listed in deferred`); }
  // J-06: what blocks, by severity and stable id (file and problem for a finding without one), and the failing validators
  // by their failing tests, in any order (their failure lines when those are unknown). Prefixed v2: so a signature from
  // forge 0.17 or older, made of the problem's text, never matches; empty when nothing blocks.
  // K2-10: a verify finding without an id is its surface and its check, never what was observed.
  const key = (f: Finding) => `${f.severity}|${f.id ?? (f.check !== undefined ? `${f.file ?? ''}|check:${f.check}` : `${f.file ?? ''}|${f.problem.trim().toLowerCase()}`)}`;
  const blocking = [
    ...[...critical, ...blockingImportant].map(key),
    ...failingValidators.map(v => `validator|${v.validator}|${(v.failing?.length ? [...v.failing].sort() : v.failures).join('\n')}`),
  ].sort();
  const signature = blocking.length ? `v2:${createHash('sha256').update(JSON.stringify(blocking)).digest('hex').slice(0, 16)}` : '';
  return {
    action, score, reasons, critical, important, minor, signature, deferred, ask,
    reviewers: names.map(n => ({ name: n, verdict: reviews[n]!.verdict, confidence: reviews[n]!.confidence, weight: weights[n],
      invalid: reviews[n]!.invalid === true || rubric.includes(n), dropped: reviews[n]!.dropped ?? 0, incomplete: reviews[n]!.incomplete === true })),
  };
}
