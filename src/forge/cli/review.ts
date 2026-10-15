import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { UsageError } from './errors.js';
import { appendEvent, readEvents, type LedgerEvent } from '../ledger.js';
import { loadConfig, agentFor, type Profile, type ForgeConfig } from '../config.js';
import { detectValidators, selectValidators, runValidators, markPreexisting, blocking, runOptions, type ExecMany, type RepoReader, type Scope, type Validator, type ValidatorResult } from '../validators.js';
import { PATH_ORDER, zonesFromPaths, type PathName, type ReviewRole } from '../triage.js';
import { parseReview, parseHunks, parseVerifyFile, verifyReview, weightsFor, synthesize, repoRelative, type Finding, type Review, type ReviewerName, type FailingValidator } from '../verdict.js';
import { roundDecision } from '../round.js';
import { buildCase, readShadow, saveShadow, takeBrief } from '../shadow.js';
import { shadowCommand } from './shadow.js';
import { restoringRegenerated } from './swarm.js';
import { reviewRound, reviewerKey, type PreviousResult, type ReviewerKey, type RoundPlan, type RoundReviewer, type TriageReview } from '../review-round.js';

// The review commands. run.ts dispatches here; this module never imports run.ts (that would be a cycle).

type Result = { code: number; stdout: string; stderr: string };
type Exec = Parameters<typeof runValidators>[1];
/** What the review commands need from the caller: forge's own dir (`cwd`), the code's dir (`repoDir`) and its tools. */
export interface ReviewDeps { cwd: string; repoDir: string; now: () => Date; git: (args: string[]) => string | null; exec: Exec; execMany?: ExecMany; repo: RepoReader }

const ROLES: readonly ReviewRole[] = ['review-correctness', 'review-security', 'review-perf'];
const EFFORTS = ['medium', 'high', 'xhigh'] as const;
const TASK_N = /^([A-Za-z0-9_.~:@+]+(?:-[A-Za-z0-9_.~:@+]+)*)-(\d{1,4})$/;

const json = (v: unknown, code = 0): Result => ({ code, stdout: JSON.stringify(v, null, 2) + '\n', stderr: '' });
const rel = (cwd: string, p: string) => path.relative(cwd, p).split(path.sep).join('/') || '.';

/** The id `<T>` of a task `<T>-<n>` and the events that belong to it (`<T>` itself or any `<T>-<k>`). */
const ofTask = (base: string) => (e: LedgerEvent) =>
  typeof e.task === 'string' && (e.task === base || (e.task.startsWith(`${base}-`) && /^\d+$/.test(e.task.slice(base.length + 1))));

/** The `review` the task's last triage logged, its reviewers resolved to agents with the profile. Null when none. */
export function triageReview(events: LedgerEvent[], base: string, profile: Profile): TriageReview | null {
  const last = events.filter(e => e.kind === 'triage' && ofTask(base)(e) && e.review && typeof e.review === 'object').at(-1);
  if (!last) return null;
  const r = last.review as { light?: unknown; reviewers?: unknown; flags?: unknown };
  if (!Array.isArray(r.reviewers)) return null;
  const reviewers: RoundReviewer[] = [];
  for (const x of r.reviewers as Record<string, unknown>[]) {
    if (!x || typeof x !== 'object' || !(ROLES as unknown[]).includes(x.role)) continue;
    const role = x.role as ReviewRole;
    const effort = (EFFORTS as readonly unknown[]).includes(x.effort) ? x.effort as RoundReviewer['effort'] : 'high';
    reviewers.push({ role, agent: typeof x.agent === 'string' && x.agent ? x.agent : agentFor(role, profile), model: x.model === 'sonnet' ? 'sonnet' : null, effort });
  }
  if (!reviewers.length) return null;
  return { light: r.light === true, reviewers, flags: Array.isArray(r.flags) ? r.flags.filter((f): f is string => typeof f === 'string') : [] };
}

/** The round a brief's review is in: 1 + the review dirs that already have a verdict (a re-run verdict counts once). */
export function reviewRoundOf(events: LedgerEvent[], task: string): number {
  const dirs = new Set(events.filter(e => e.kind === 'verdict' && e.task === task).map((e, i) => (typeof e.dir === 'string' ? e.dir : `#${i}`)));
  return dirs.size + 1;
}

/** Runs `fn` (a validator run) putting back the tracked files it regenerated that the config's `generated` names. */
function restoringGenerated<T>(deps: ReviewDeps, generated: string[], fn: () => T, into: string[]): T {
  return generated.length ? restoringRegenerated({ git: deps.git }, fn, into, generated) : fn();
}

/** A validator run of the review commands: the config's parallel batch and retry rule (C-12), putting back what the
 *  config's `generated` names. */
function validateList(deps: ReviewDeps, config: ForgeConfig, list: Validator[], restored: string[]): ValidatorResult[] {
  const opts = runOptions(config, readEvents(deps.cwd), deps.now(), deps.execMany);
  return restoringGenerated(deps, config.generated, () => runValidators(list, deps.exec, config.validatorTimeoutSec, opts), restored);
}

function readJson(file: string): unknown {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return undefined; }
}

/**
 * `FORGE review-prep --task <T>-<n> --path <p> --base <sha> --baseline <f> --dir <dir> [--locale es|en]`: validates
 * against the baseline into `<dir>/validators-<n>.json`, writes `<dir>/diff-<n>.patch`, decides who reviews with
 * reviewRound from the task's last triage and saves `head.txt` and `review-plan.json` in `<dir>/reviews-<n>-<round>/`.
 * From round 2 it also writes the fix diff and each reviewer's previous blocking findings, and copies the carried
 * results with `"carried": true`.
 */
export function reviewPrep(args: string[], deps: ReviewDeps): Result {
  const flag = (name: string) => {
    const i = args.indexOf(`--${name}`);
    const v = i >= 0 ? args[i + 1] : undefined;
    return v === undefined || v.startsWith('--') ? undefined : v;
  };
  const task = flag('task'), p = flag('path'), baseSha = flag('base'), baselineArg = flag('baseline'), dirArg = flag('dir');
  if (!task || !p || !baseSha || !baselineArg || !dirArg) throw new UsageError('review-prep: --task <id>-<n>, --path, --base, --baseline and --dir are required');
  const m = TASK_N.exec(task);
  if (!m) throw new UsageError('review-prep: --task must be <id>-<n>');
  if (!(PATH_ORDER as readonly string[]).includes(p)) throw new UsageError(`review-prep: --path must be one of ${PATH_ORDER.join('|')}`);
  const locale = flag('locale');
  if (args.includes('--locale') && locale !== 'es' && locale !== 'en') throw new UsageError('review-prep: --locale must be es or en');
  const [, id, n] = m;
  const pathName = p as PathName;
  let baseline: unknown;
  try { baseline = JSON.parse(readFileSync(path.resolve(deps.cwd, baselineArg), 'utf8')); } catch { throw new UsageError('review-prep: --baseline must be the JSON written by forge validate'); }

  const config = loadConfig(deps.repoDir);
  const events = readEvents(deps.cwd);
  // A Medium brief run as a loose task has the id `<parent>-<k>` and no triage of its own: it reviews with the
  // parent's (that id exactly, never a sibling brief's).
  const parent = /^(.+)-\d+$/.exec(id)?.[1];
  const review = triageReview(events, id, config.profile)
    ?? (parent ? triageReview(events.filter(e => e.task === parent), parent, config.profile) : null);
  if (!review) throw new UsageError(`review-prep: no triage of ${id}${parent ? ` nor of ${parent}` : ''} logged a review: run FORGE triage --task ${id} first`);
  const head = (deps.git(['rev-parse', 'HEAD']) ?? '').trim();
  if (!head) throw new UsageError('review-prep: cannot read HEAD');
  const diff = deps.git(['diff', `${baseSha}..HEAD`]);
  if (diff === null) throw new UsageError(`review-prep: cannot diff ${baseSha}..HEAD`);

  const dir = path.resolve(deps.cwd, dirArg);
  const round = reviewRoundOf(events, task);
  const roundDir = path.join(dir, `reviews-${n}-${round}`);
  mkdirSync(roundDir, { recursive: true });

  // Validation, as `FORGE validate --all --path <p> --base <sha> --baseline <f>` runs it.
  const changed = deps.git(['diff', '--name-only', `${baseSha}..HEAD`]);
  const scope: Scope = pathName === 'trivial' || pathName === 'small' ? { mode: 'small' }
    : { mode: 'heavy', changed: changed === null ? null : changed.split('\n').map(s => s.trim()).filter(Boolean) };
  const restored: string[] = [];
  const results: ValidatorResult[] = markPreexisting(validateList(deps, config, selectValidators(detectValidators(deps.repo, config), scope), restored), baseline);
  const ok = results.every(r => !blocking(r));
  const validatorsFile = path.join(dir, `validators-${n}.json`);
  writeFileSync(validatorsFile, JSON.stringify(results, null, 2) + '\n');
  appendEvent(deps.cwd, { ts: deps.now().toISOString(), kind: 'validate', task, ok, results: results.map(r => ({ validator: r.validator, ok: r.ok, flaky: r.flaky, ...(r.skipped ? { skipped: r.skipped } : {}), ...(r.preexisting ? { preexisting: true } : {}), ...(r.ok ? {} : { failures: r.failures }) })) });
  const diffFile = path.join(dir, `diff-${n}.patch`);
  writeFileSync(diffFile, diff);

  // The previous round: each reviewer's result (a carried one included) and the fix diff from the commit it reviewed.
  const previous: Partial<Record<ReviewRole, PreviousResult>> = {};
  let fixFiles: string[] = [];
  const fixFile = path.join(dir, `fix-${n}-${round}.patch`);
  const findingsFile = (name: ReviewerKey) => path.join(roundDir, `previous-${name}.json`);
  const prevReviews: Partial<Record<ReviewerKey, Review>> = {};
  if (round >= 2) {
    const prevDir = path.join(dir, `reviews-${n}-${round - 1}`);
    for (const role of ROLES) {
      const file = path.join(prevDir, `${reviewerKey(role)}.json`);
      if (!existsSync(file)) continue;
      const r = parseReview(readFileSync(file, 'utf8'));
      prevReviews[reviewerKey(role)] = r;
      // A draft or an invalid result is never carried; an unusable one (nothing parsed) leaves no previous result,
      // so the reviewer repeats in full rather than in delta with no findings.
      if (r.invalid && !r.dropped) continue;
      previous[role] = { verdict: r.verdict, findings: r.findings, ...(r.incomplete ? { incomplete: true } : {}), ...(r.invalid ? { invalid: true } : {}) };
    }
    const prevHead = existsSync(path.join(prevDir, 'head.txt')) ? readFileSync(path.join(prevDir, 'head.txt'), 'utf8').trim() : '';
    // Without the commit the previous round reviewed, or when git cannot diff from it, the whole diff stands in for the fix.
    const diffFrom = (from: string) => {
      const names = deps.git(['diff', '--name-only', `${from}..HEAD`]);
      const patch = names === null ? null : deps.git(['diff', `${from}..HEAD`]);
      return names === null || patch === null ? null : { names, patch };
    };
    const fix = (prevHead ? diffFrom(prevHead) : null) ?? diffFrom(baseSha);
    if (!fix) throw new UsageError(`review-prep: cannot diff the fix (${prevHead || baseSha}..HEAD)`);
    fixFiles = fix.names.split('\n').map(s => s.trim()).filter(Boolean);
    writeFileSync(fixFile, fix.patch);
  }
  // After a redo the work was started again: every reviewer reviews it in full, nothing is carried.
  const redo = round >= 2 && events.filter(e => e.kind === 'verdict' && e.task === task).at(-1)?.action === 'redo';

  // A brief spends one shadow brief on its first round only, and only when it gets twins (a reviewer at high):
  // preparing that round again reuses the first answer.
  const planFile = path.join(roundDir, 'review-plan.json');
  const earlier = readJson(planFile) as { shadow?: unknown } | undefined;
  const twinsAllowed = round === 1 && !review.light && (pathName === 'medium' || pathName === 'large') && review.reviewers.some(r => r.effort === 'high');
  const shadowOpen = twinsAllowed && (earlier && typeof earlier.shadow === 'boolean' ? earlier.shadow : takeBrief(deps.cwd));

  const brief = path.join(dir, `brief-${n}.md`);
  const report = path.join(dir, `report-${n}.txt`);
  let tdd = false;
  try { tdd = /^TDD: required/m.test(readFileSync(brief, 'utf8')); } catch { /* no brief file */ }
  const plan: RoundPlan = reviewRound({
    review, round, path: pathName, previous, fixFiles, fixZones: zonesFromPaths(fixFiles), shadowOpen, redo,
    files: {
      brief: rel(deps.cwd, brief), diff: rel(deps.cwd, diffFile), validators: rel(deps.cwd, validatorsFile),
      out: rel(deps.cwd, roundDir), shadow: rel(deps.cwd, path.join(roundDir, 'shadow')),
      ...(round >= 2 ? { fix: rel(deps.cwd, fixFile), findings: (name: ReviewerKey) => rel(deps.cwd, findingsFile(name)) } : {}),
      ...(tdd && existsSync(report) ? { report: rel(deps.cwd, report) } : {}),
    },
  });
  if (plan.shadow) mkdirSync(path.join(roundDir, 'shadow'), { recursive: true });

  // Delta reviewers get their own blocking findings only; a carried result is copied with "carried": true.
  for (const s of plan.spawn.filter(s => s.mode === 'delta' && !s.twin)) {
    const blockers = (previous[s.role]?.findings ?? []).filter(f => f.severity === 'critical' || f.severity === 'important');
    writeFileSync(findingsFile(s.name), JSON.stringify(blockers, null, 2) + '\n');
  }
  for (const c of plan.carried) {
    // The file as written when it is plain JSON; else (JSON inside prose or a fence) the result as parsed.
    const raw = readJson(path.join(dir, `reviews-${n}-${round - 1}`, `${c.name}.json`));
    const parsed = prevReviews[c.name]!;
    const prev = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : { verdict: parsed.verdict, confidence: parsed.confidence, findings: parsed.findings };
    writeFileSync(path.join(roundDir, `${c.name}.json`), JSON.stringify({ ...prev, carried: true }, null, 2) + '\n');
  }

  const spawn = plan.spawn.map(s => ({ agent: s.agent, model: s.model, effort: s.effort, mode: s.mode, ...(s.twin ? { twin: true } : {}), role: s.role, inputs: s.inputs }));
  writeFileSync(path.join(roundDir, 'head.txt'), head + '\n');
  writeFileSync(planFile, JSON.stringify({
    task, round, path: pathName, base: baseSha, head, light: review.light, flags: review.flags, shadow: plan.shadow,
    spawn, carried: plan.carried,
  }, null, 2) + '\n');

  const failing = results.filter(blocking).map(r => r.validator);
  const preexisting = results.filter(r => r.ok !== true && r.preexisting === true).map(r => r.validator);
  const out: Record<string, unknown> = {
    round, validators: { ok, failing, preexisting, file: rel(deps.cwd, validatorsFile) }, spawn,
    ...(plan.carried.length ? { carried: plan.carried.map(c => c.name) } : {}),
    ...(restored.length ? { restored } : {}),
  };
  if (locale === 'es' || locale === 'en') out.say = sayPrep(round, ok, failing, plan, locale);
  return json(out);
}

function sayPrep(round: number, ok: boolean, failing: string[], plan: RoundPlan, locale: 'es' | 'en'): string {
  const who = plan.spawn.filter(s => !s.twin).map(s => `${s.name} (${s.effort}${s.mode === 'delta' ? ', delta' : ''})`).join(', ');
  const twins = plan.spawn.filter(s => s.twin).length;
  if (locale === 'es') {
    return `Ronda ${round}: validadores ${ok ? 'en verde' : `en rojo (${failing.join(', ')})`}; revisan ${who || 'nadie'}`
      + `${plan.carried.length ? `; se arrastran ${plan.carried.map(c => c.name).join(', ')}` : ''}${twins ? `; ${twins} gemelo(s) en sombra` : ''}.`;
  }
  return `Round ${round}: validators ${ok ? 'green' : `red (${failing.join(', ')})`}; reviewing: ${who || 'nobody'}`
    + `${plan.carried.length ? `; carried: ${plan.carried.map(c => c.name).join(', ')}` : ''}${twins ? `; ${twins} shadow twin(s)` : ''}.`;
}

type ValidatorRow = { validator?: unknown; ok?: unknown; failures?: unknown; preexisting?: unknown };

/**
 * `FORGE review-close --task <T>-<n> --dir <dir> --path medium|large`: closes the last round review-prep prepared in
 * `<dir>/reviews-<n>-<round>/` (`--dir` may also be that round dir). Exits 3 with `missing` when a reviewer it spawned
 * (twins aside) left no file. Else runs the verdict with review-plan.json's flags, the round and the fix diff's hunks
 * (carried results keep their previous origins), logs it on the round dir and the round decision, logs the minor and
 * deferred findings as a ruling, writes `<dir>/findings-<n>-<round>.json` for the implementer when the action is not
 * accept, saves the case of each shadow twin that left its file in `shadow/` (it never counts in the verdict), and
 * prints `{action, score, next, last, implementer, findings, deferred, invalid, incomplete}` (`incomplete`: the
 * reviewers whose file is a draft with `"complete": false`; plus `shadow`, the twins compared, and
 * `shadowSkipped`, the twins whose file, or their high reviewer's, was missing, unparseable or a draft).
 */
export function reviewClose(args: string[], deps: ReviewDeps): Result {
  const flag = (name: string) => {
    const i = args.indexOf(`--${name}`);
    const v = i >= 0 ? args[i + 1] : undefined;
    return v === undefined || v.startsWith('--') ? undefined : v;
  };
  const task = flag('task'), p = flag('path'), dirArg = flag('dir');
  if (!task || !p || !dirArg) throw new UsageError('review-close: --task <id>-<n>, --dir and --path are required');
  const m = TASK_N.exec(task);
  if (!m) throw new UsageError('review-close: --task must be <id>-<n>');
  if (p !== 'medium' && p !== 'large') throw new UsageError('review-close: --path must be medium or large');
  const n = m[2];

  // The round: the given round dir, or the last one review-prep prepared under the work dir.
  let dir = path.resolve(deps.cwd, dirArg);
  let round = 0;
  const own = new RegExp(`^reviews-${n}-(\\d+)$`).exec(path.basename(dir));
  if (own) { round = Number(own[1]); dir = path.dirname(dir); } else {
    let entries: string[] = [];
    try { entries = readdirSync(dir); } catch { /* no work dir */ }
    for (const e of entries) {
      const r = new RegExp(`^reviews-${n}-(\\d+)$`).exec(e);
      if (r && existsSync(path.join(dir, e, 'review-plan.json'))) round = Math.max(round, Number(r[1]));
    }
  }
  const roundDir = path.join(dir, `reviews-${n}-${round}`);
  const plan = readJson(path.join(roundDir, 'review-plan.json')) as { spawn?: unknown; carried?: unknown; flags?: unknown } | undefined;
  if (!round || !plan || typeof plan !== 'object') throw new UsageError(`review-close: no review-plan.json for ${task} in ${dirArg}: run FORGE review-prep first`);

  const names = (list: unknown, keep: (x: Record<string, unknown>) => boolean) => (Array.isArray(list) ? list as Record<string, unknown>[] : [])
    .filter(x => x && typeof x === 'object' && keep(x))
    .map(x => (typeof x.name === 'string' ? x.name : typeof x.role === 'string' && (ROLES as readonly string[]).includes(x.role) ? reviewerKey(x.role as ReviewRole) : null))
    .filter((x): x is ReviewerKey => x === 'correctness' || x === 'security' || x === 'perf');
  const spawned = names(plan.spawn, x => x.twin !== true);
  const carried = names(plan.carried, () => true);
  const missing = [...new Set([...spawned, ...carried])].map(k => path.join(roundDir, `${k}.json`)).filter(f => !existsSync(f));
  if (missing.length) return json({ missing: missing.map(f => rel(deps.cwd, f)) }, 3);

  const reviews: Partial<Record<ReviewerName, Review>> = {};
  for (const k of ['correctness', 'security', 'perf'] as const) {
    const file = path.join(roundDir, `${k}.json`);
    if (existsSync(file)) reviews[k] = parseReview(readFileSync(file, 'utf8'));
  }
  const verifyPath = path.join(roundDir, 'verify.json');
  const verifyFile = existsSync(verifyPath) ? parseVerifyFile(readFileSync(verifyPath, 'utf8')) : undefined;
  if (verifyFile !== undefined) reviews.verify = verifyReview(verifyFile);
  if (!Object.keys(reviews).length) throw new UsageError(`review-close: no reviews found in ${rel(deps.cwd, roundDir)}`);

  // Validators as review-prep wrote them; failing ones that already failed on the base commit do not count.
  const rows = readJson(path.join(dir, `validators-${n}.json`));
  const arr = Array.isArray(rows) ? (rows as ValidatorRow[]).filter(r => r && typeof r === 'object') : [];
  const validatorsOk = Array.isArray(rows) && arr.every(r => !blocking(r));
  const failing: FailingValidator[] = arr.filter(r => blocking(r)).map(r => ({ validator: String(r.validator ?? ''), failures: Array.isArray(r.failures) ? r.failures.map(String) : [] }));
  const preexisting = arr.filter(r => r.ok !== true && r.preexisting === true).map(r => String(r.validator ?? ''));

  const flags = Array.isArray(plan.flags) ? plan.flags : [];
  const fixPatch = round >= 2 ? (() => { try { return readFileSync(path.join(dir, `fix-${n}-${round}.patch`), 'utf8'); } catch { return ''; } })() : '';
  const result = synthesize(reviews, weightsFor({ sensitive: flags.includes('--sensitive'), perf: flags.includes('--perf') }), validatorsOk, failing,
    { round, fixHunks: parseHunks(fixPatch), root: deps.repoDir, carried });
  if (!Array.isArray(rows)) result.reasons.push('no validation recorded');
  if (preexisting.length) result.reasons.push(`already failing on the base commit, not counted: ${preexisting.join(', ')}`);

  const ts = deps.now().toISOString();
  appendEvent(deps.cwd, { ts, kind: 'verdict', task, dir: rel(deps.cwd, roundDir), action: result.action, score: result.score, signature: result.signature,
    critical: result.critical.length, important: result.important.length, minor: result.minor.length, deferred: result.deferred.length });
  if (verifyFile !== undefined) {
    // As FORGE verdict logs it.
    const evidence = rel(deps.cwd, roundDir).replace(/reviews-(\d+-\d+)$/, 'evidence/$1');
    appendEvent(deps.cwd, { ts, kind: 'verify', task, result: verifyFile?.result ?? 'invalid',
      passed: verifyFile ? verifyFile.checks.filter(c => c.ok).length : 0, total: verifyFile ? verifyFile.checks.length : 0,
      evidence, ...(verifyFile?.reason ? { reason: verifyFile.reason } : {}) });
  }
  const events = readEvents(deps.cwd);
  const d = roundDecision(events, task, p, loadConfig(deps.repoDir).profile);
  appendEvent(deps.cwd, { ts, kind: 'round', task, ...d });
  if (result.minor.length || result.deferred.length) {
    // Closing the same round again with the same findings does not log the ruling twice.
    const ruling = { task, round, dir: rel(deps.cwd, roundDir),
      ...(result.minor.length ? { minor: result.minor } : {}), ...(result.deferred.length ? { deferred: result.deferred } : {}) };
    const same = JSON.stringify(ruling);
    const logged = events.some(e => e.kind === 'ruling' && e.task === task && e.dir === ruling.dir
      && JSON.stringify({ task: e.task, round: e.round, dir: e.dir, ...(e.minor ? { minor: e.minor } : {}), ...(e.deferred ? { deferred: e.deferred } : {}) }) === same);
    if (!logged) appendEvent(deps.cwd, { ts, kind: 'ruling', ...ruling });
  }

  // What the implementer receives (the skill's «Findings to send»): critical and important findings, deferred ones
  // excluded, and the failures of the validators that block. An accept removes the file an earlier close of this round left.
  let findings: string | null = null;
  const findingsPath = path.join(dir, `findings-${n}-${round}.json`);
  if (result.action !== 'accept') {
    writeFileSync(findingsPath, JSON.stringify({ task, round, action: result.action, findings: [...result.critical, ...result.important], validators: failing }, null, 2) + '\n');
    findings = rel(deps.cwd, findingsPath);
  } else rmSync(findingsPath, { force: true });

  // The shadow twins (xhigh, in shadow/) never reach the verdict: each one with a file is paired with its high reviewer
  // and the case saved in .forge/shadow.json, replacing the one an earlier close of this round saved. A missing file or
  // one parseReview flags invalid (it would read as no blocking findings) saves no case: it is listed in shadowSkipped.
  // So does a draft (`"complete": false`): it is not a finished review to compare.
  const twins: ReviewerKey[] = [];
  const shadowSkipped: { reviewer: ReviewerKey; reason: 'missing' | 'unparseable' | 'incomplete'; file: string }[] = [];
  const pairs: { k: ReviewerKey; high: Review; xhigh: Review }[] = [];
  for (const k of names(plan.spawn, x => x.twin === true)) {
    const highFile = path.join(roundDir, `${k}.json`), twinFile = path.join(roundDir, 'shadow', `${k}.json`);
    const missing = [twinFile, highFile].find(f => !existsSync(f));
    if (missing) { shadowSkipped.push({ reviewer: k, reason: 'missing', file: rel(deps.cwd, missing) }); continue; }
    const high = parseReview(readFileSync(highFile, 'utf8'));
    const xhigh = parseReview(readFileSync(twinFile, 'utf8'));
    const bad = xhigh.invalid ? twinFile : high.invalid ? highFile : null;
    if (bad) { shadowSkipped.push({ reviewer: k, reason: 'unparseable', file: rel(deps.cwd, bad) }); continue; }
    const draft = xhigh.incomplete ? twinFile : high.incomplete ? highFile : null;
    if (draft) { shadowSkipped.push({ reviewer: k, reason: 'incomplete', file: rel(deps.cwd, draft) }); continue; }
    pairs.push({ k, high, xhigh });
    twins.push(k);
  }
  if (pairs.length) {
    const local = (fs: Finding[]) => fs.map(f => (f.file ? { ...f, file: repoRelative(f.file, deps.repoDir) } : f));
    const state = readShadow(deps.cwd) ?? { remaining: 0, cases: [] };
    let cases = state.cases;
    for (const { k, high, xhigh } of pairs) {
      cases = [...cases.filter(c => c.task !== task || c.reviewer !== k), buildCase(task, k, local(high.findings), local(xhigh.findings))];
    }
    saveShadow(deps.cwd, { ...state, cases });
  }
  return json({
    action: result.action, score: result.score, next: d.next, last: d.last, implementer: d.implementer,
    findings, deferred: result.deferred, invalid: result.reviewers.filter(r => r.invalid).map(r => r.name),
    incomplete: result.reviewers.filter(r => r.incomplete).map(r => r.name), round, reasons: result.reasons, ...(twins.length ? { shadow: twins } : {}), ...(shadowSkipped.length ? { shadowSkipped } : {}),
  });
}

/**
 * `FORGE prep --task <id>-<n> --path <p> [--phase <name>] [--dir <dir>] [--cwd <worktree>]`: before a brief's work, in
 * one call, reads BASE (the HEAD of `--cwd`), records what already fails on it into `<dir>/baseline-<n>.json` (as
 * `validate --all --path <p> --base-run --task <id>-<n>` does; `<dir>` defaults to `.forge/work/<id>`), logs the phase
 * `{"phase":<name, default implement>,"brief":<n>,"base":<BASE>}` on `<id>` and prints `{base, baseline, failing}`.
 * A validator failing on BASE is what the baseline is for: prep exits 0.
 */
export function prep(args: string[], deps: ReviewDeps): Result {
  const flag = (name: string) => {
    const i = args.indexOf(`--${name}`);
    const v = i >= 0 ? args[i + 1] : undefined;
    return v === undefined || v.startsWith('--') ? undefined : v;
  };
  const task = flag('task'), p = flag('path');
  if (!task || !p) throw new UsageError('prep: --task <id>-<n> and --path are required');
  const m = TASK_N.exec(task);
  if (!m) throw new UsageError('prep: --task must be <id>-<n>');
  if (!(PATH_ORDER as readonly string[]).includes(p)) throw new UsageError(`prep: --path must be one of ${PATH_ORDER.join('|')}`);
  const phase = flag('phase') ?? 'implement';
  if (args.includes('--phase') && !/^[a-z][a-z0-9-]{0,39}$/.test(phase)) throw new UsageError('prep: --phase must be a phase name (lowercase letters, digits and -)');
  const [, id, n] = m;
  const base = (deps.git(['rev-parse', 'HEAD']) ?? '').trim();
  if (!base) throw new UsageError('prep: cannot read HEAD');

  // The baseline, as `validate --all --path <p> --base-run` runs it: on BASE nothing changed yet, so a heavy path runs
  // every heavy validator (the review's diff later selects among them).
  const config = loadConfig(deps.repoDir);
  const scope: Scope = p === 'trivial' || p === 'small' ? { mode: 'small' } : { mode: 'heavy', changed: null };
  const restored: string[] = [];
  const results = validateList(deps, config, selectValidators(detectValidators(deps.repo, config), scope), restored);
  const dir = path.resolve(deps.cwd, flag('dir') ?? path.join('.forge', 'work', id));
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `baseline-${n}.json`);
  writeFileSync(file, JSON.stringify(results, null, 2) + '\n');
  const ts = deps.now().toISOString();
  appendEvent(deps.cwd, { ts, kind: 'validate', task, baseline: true, ok: results.every(r => !blocking(r)), results: results.map(r => ({ validator: r.validator, ok: r.ok, flaky: r.flaky, ...(r.skipped ? { skipped: r.skipped } : {}), ...(r.ok ? {} : { failures: r.failures }) })) });
  appendEvent(deps.cwd, { ts, kind: 'phase', task: id, phase, brief: Number(n), base });
  return json({ base, baseline: rel(deps.cwd, file), failing: results.filter(blocking).map(r => r.validator), ...(restored.length ? { restored } : {}) });
}

/** `review-prep`, `review-close`, `prep` and `shadow` (cli/shadow.ts). */
export function reviewCommand(cmd: string, args: string[], deps: ReviewDeps): Result {
  switch (cmd) {
    case 'review-prep': return reviewPrep(args, deps);
    case 'review-close': return reviewClose(args, deps);
    case 'shadow': return shadowCommand(args, deps.cwd);
    case 'prep': return prep(args, deps);
    default:
      throw new UsageError(`unknown review command ${cmd}`);
  }
}
