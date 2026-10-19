import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { samePath } from '../../lib/worktree.js';
import { isSafeId, type ExecutionState } from '../../lib/execution-state.js';
import { UsageError } from './errors.js';
import { appendEvent, appendPhase, ledgerRoot, readEvents, type LedgerEvent } from '../ledger.js';
import { loadConfig, agentFor, ConfigError, type Profile, type ForgeConfig } from '../config.js';
import {
  detectValidators, selectValidators, runValidators, markPreexisting, blocking, runOptions, validateEvent, failingLabel,
  type ExecMany, type RepoReader, type Scope, type Validator, type ValidatorResult,
} from '../validators.js';
import { PATH_ORDER, zonesFromPaths, type PathName, type ReviewRole } from '../triage.js';
import {
  parseReview, parseHunks, parseVerifyFile, verifyReview, weightsFor, synthesize, repoRelative,
  type Finding, type Review, type ReviewerName, type FailingValidator, type AskFinding,
} from '../verdict.js';
import { roundDecision } from '../round.js';
import { eventsOf, isTask, ofTask, readWorkDir, resolveProject, taskLine } from '../task-ref.js';
import { keepEvidence } from '../evidence-copy.js';
import {
  parseIndex, assignIds, answeredBy, idsOf, recordRound, carriedResiduals, carriedOutOfModel, openIds, closedFor, previousFindings,
  asPrevious, historyLine, renderHandover, expressCandidate, type FindingsIndex,
} from '../findings-index.js';
import { reviewsOf } from '../loop.js';
import { takeBrief } from '../shadow.js';
import { renderThreatModel } from '../threat-model.js';
import { collectTwins, shadowCommand } from './shadow.js';
import { restoringRegenerated } from './swarm.js';
import { mainCheckout } from '../local.js';
import { loadTrustedConfig } from '../trust.js';
import { eventsSince, executionHolding } from '../execution.js';
import { runWithCache, cacheGit, checkoutPrefix } from '../validate-cache.js';
import { noSlot, type Slot } from '../jobs.js';
import { reviewRound, reviewerKey, type PreviousResult, type ReviewerKey, type RoundPlan, type RoundReviewer, type SpawnEntry, type TriageReview } from '../review-round.js';

// The review commands. run.ts dispatches here; this module never imports run.ts (that would be a cycle).

type Result = { code: number; stdout: string; stderr: string };
type Exec = Parameters<typeof runValidators>[1];
/** What the review commands need from the caller: forge's own dir (`cwd`), the code's dir (`repoDir`) and its tools. */
export interface ReviewDeps { cwd: string; repoDir: string; now: () => Date; git: (args: string[]) => string | null; exec: Exec; execMany?: ExecMany; repo: RepoReader; self?: string; slot?: Slot }

const ROLES: readonly ReviewRole[] = ['review-correctness', 'review-security', 'review-perf'];
const EFFORTS = ['medium', 'high', 'xhigh'] as const;
// C-08: red validators go back to the implementer without reviewers at most this many times per review.
const MAX_VALIDATOR_ROUNDS = 2;
const TASK_N = /^([A-Za-z0-9_.~:@+]+(?:-[A-Za-z0-9_.~:@+]+)*)-(\d{1,4})$/;

const json = (v: unknown, code = 0): Result => ({ code, stdout: JSON.stringify(v, null, 2) + '\n', stderr: '' });
const rel = (cwd: string, p: string) => path.relative(cwd, p).split(path.sep).join('/') || '.';
/** A path as the printed commands give it (J-11): absolute, with /, for double quotes, which every shell takes. */
const slash = (p: string) => path.resolve(p).split(path.sep).join('/');
/** A commit id as written: what may stand unquoted in a printed command or be handed to git as BASE. */
const SHA = /^[0-9a-f]{7,64}$/i;

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

/** The round a brief's review is in: 1 + the review dirs that already have a verdict (a re-run verdict counts once).
 *  Carry 3: with `since` (the start of the execution that holds the task), only the verdicts logged from then. */
export function reviewRoundOf(events: LedgerEvent[], task: string, since: string | null = null): number {
  const dirs = new Set(eventsSince(events, since).filter(e => e.kind === 'verdict' && isTask(e, task)).map((e, i) => (typeof e.dir === 'string' ? e.dir : `#${i}`)));
  return dirs.size + 1;
}

/**
 * Carry 3: a brief that an earlier execution of the same plan task reviewed in this work folder `dir` starts again (a new
 * execution restarts its tasks with brief 1). That execution's round folders of brief `n`, their evidence and their files
 * at the folder's root (findings, fix patch, handover, validators rounds), the brief's findings index and the step's
 * validators-head-<n>.json go to `earlier-<runId>/` there (named after the run that sets them aside), so nothing of them reads as this
 * execution's: review-close and the step take the newest round folder there is, and a reviewer's file there as returned.
 * A round with a phase event of `run` (logged since it started) stays. Returns the folder they went to and what moved
 * there, or null when nothing moved. R2 (M2): a move that fails (on Windows, a handle open inside the folder is enough)
 * would leave the brief on a mixed folder, so it is a UsageError that names it (relative to `cwd` when inside it, else
 * absolute): prep exits 2.
 */
function setAsideEarlier(dir: string, n: string, id: string, events: readonly LedgerEvent[], run: ExecutionState, cwd: string): { aside: string; moved: string[] } | null {
  const ours = new Set(eventsSince(events, run.startedAt)
    .filter(e => e.kind === 'phase' && isTask(e, id) && e.brief === Number(n) && typeof e.round === 'number').map(e => e.round as number));
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { return null; }
  let evidence: string[] = [];
  try { evidence = readdirSync(path.join(dir, 'evidence')); } catch { evidence = []; }
  // R6 (I1): an earlier round is any trace of it, its folder, its evidence or its root files, so a set-aside a failed
  // move left half done is finished by the next prep, also once no round folder is left. This run's own stay.
  const roundOf = (f: string): number | null => {
    const m = new RegExp(`^(?:reviews-${n}-(\\d+)|findings-${n}-(\\d+)\\.json|fix-${n}-(\\d+)\\.patch|handover-${n}-(\\d+)\\.md|validators-fix-${n}-(\\d+)-.+\\.json)$`).exec(f);
    const k = m ? m.slice(1).find(x => x !== undefined) : undefined;
    return k === undefined ? null : Number(k);
  };
  const rounds = [...new Set([
    ...names.map(roundOf),
    ...evidence.map(f => { const m = new RegExp(`^${n}-(\\d+)$`).exec(f); return m ? Number(m[1]) : null; }),
  ].filter((k): k is number => k !== null && !ours.has(k)))].sort((a, b) => a - b);
  // The brief's findings index is this run's once it reviewed the brief; the step's validators-head says its run.
  let head: unknown = null;
  try { head = JSON.parse(readFileSync(path.join(dir, `validators-head-${n}.json`), 'utf8')); } catch { head = null; }
  const briefFiles = [
    ...(ours.size ? [] : [`findings-index-${n}.json`]),
    ...((head as { runId?: unknown } | null)?.runId === run.runId ? [] : [`validators-head-${n}.json`]),
  ].filter(f => names.includes(f));
  if (!rounds.length && !briefFiles.length) return null;
  const aside = path.join(dir, `earlier-${run.runId}`);
  const moved: string[] = [];
  const failed: string[] = [];
  const move = (name: string) => {
    const from = path.join(dir, name);
    if (!existsSync(from)) return;
    try {
      mkdirSync(path.dirname(path.join(aside, name)), { recursive: true });
      renameSync(from, path.join(aside, name));
      moved.push(name);
    } catch { failed.push(from); }
  };
  // R3 (M3): with each round, the files of that round at the folder's root, so this run's round never overwrites them.
  const roundFiles = (k: number) => names.filter(f => f === `findings-${n}-${k}.json` || f === `fix-${n}-${k}.patch` || f === `handover-${n}-${k}.md`
    || (f.startsWith(`validators-fix-${n}-${k}-`) && f.endsWith('.json')));
  for (const k of rounds) { move(`reviews-${n}-${k}`); move(`evidence/${n}-${k}`); for (const f of roundFiles(k)) move(f); }
  for (const f of briefFiles) move(f);
  if (failed.length) {
    throw new UsageError(`prep: ${failed.map(f => shown(cwd, f)).join(', ')} could not be moved aside to ${shown(cwd, aside)} `
      + "(an earlier run's review of this brief): close what holds it and run prep again");
  }
  return moved.length ? { aside, moved } : null;
}

/** A path for a message: relative to `cwd` when it is inside it, else absolute (both with `/`). */
const shown = (cwd: string, p: string): string => {
  const r = rel(cwd, p);
  return r.startsWith('..') ? path.resolve(p).split(path.sep).join('/') : r;
};

/** Runs `fn` (a validator run) putting back the tracked files it regenerated that the config's `generated` names. */
function restoringGenerated<T>(deps: ReviewDeps, generated: string[], fn: () => T, into: string[]): T {
  return generated.length ? restoringRegenerated({ git: deps.git }, fn, into, generated) : fn();
}

/** A validator run of the review commands (C6, C-12): through the tree cache of the main checkout (unless --no-cache or
 *  validate.cache: false), with the config's parallel batch and retry rule, putting back what the config's `generated`
 *  names. The results are raw (no baseline marks); durationMs is the call's clock. */
function validateList(deps: ReviewDeps, config: ForgeConfig, list: Validator[], restored: string[], noCache: boolean): { results: ValidatorResult[]; durationMs: number } {
  const t0 = Date.now();
  const opts = runOptions(config, readEvents(deps.cwd), deps.now(), deps.execMany);
  const use = config.validate.cache && !noCache;
  const results = runWithCache(list,
    // C-03: with --out, the validators wait for a slot (swarm.validateJobs); a list the cache answered whole does not.
    misses => (misses.length ? (deps.slot ?? noSlot) : noSlot)(() => restoringGenerated(deps, config.generated, () => runValidators(misses, deps.exec, config.validatorTimeoutSec, opts), restored)),
    { main: mainCheckout(deps.cwd), git: use ? cacheGit(deps.git) : deps.git, dir: use ? checkoutPrefix(deps.git) : null, repo: deps.repo,
      generated: config.generated, read: use, write: use, now: deps.now });
  return { results, durationMs: Date.now() - t0 };
}

const cachedNames = (results: ValidatorResult[]) => results.filter(r => r.cached === true).map(r => r.validator);

function readJson(file: string): unknown {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return undefined; }
}

function readText(file: string): string | null {
  try { return readFileSync(file, 'utf8'); } catch { return null; }
}

/** K4-02: `<dir>/threat-model.md` from the config's threatModel, rewritten each time; removed when there is none. */
function writeThreatModel(dir: string, config: ForgeConfig): string | null {
  const file = path.join(dir, 'threat-model.md');
  if (!config.threatModel) { rmSync(file, { force: true }); return null; }
  writeFileSync(file, renderThreatModel(config.threatModel));
  return file;
}

/**
 * `FORGE review-prep --task <T>-<n> --path <p> --base <sha> --baseline <f> --dir <dir> [--locale es|en] [--no-cache]`: validates
 * against the baseline into `<dir>/validators-<n>.json`, writes `<dir>/diff-<n>.patch`, decides who reviews with
 * reviewRound from the task's last triage and saves `head.txt` and `review-plan.json` in `<dir>/reviews-<n>-<round>/`.
 * From round 2 it also writes the fix diff and each delta reviewer's previous findings (with their ids from
 * findings-index-<n>.json when it has the previous review: J-06), and copies the carried
 * results with `"carried": true`. With validators red that the baseline does not excuse it opens a validators round
 * instead (C-08): validators-fix-<n>-<round>-<k>.json, the phase fix with validators: true, spawn [] and
 * validatorsRound {k, max, findings}, at most twice per review. It logs the phases validate and review (with the reviewers).
 * It prints reviews {n, max}, the review of the brief as the person counts it (C-13), which its say begins with.
 * An express review (measure 7) does not validate: it prints validators {pending, cmd}, the validation to run in the
 * background, one correctness reviewer on Sonnet and delegated.
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

  // I-03: its validators run the config's commands: without the person's trust it exits 2 here, before it writes anything.
  const config = loadTrustedConfig(deps.repoDir);
  // D-08: only this task's events of its project (ids repeat between plans): --project, else the folder --dir names,
  // else the ledger's attribution.
  const all = readEvents(deps.cwd);
  const project = resolveProject({ flag: flag('project'), dir: dirArg, task: id, events: all });
  const events = eventsOf(all, { project, task: id });
  // A Medium brief run as a loose task has the id `<parent>-<k>` and no triage of its own: it reviews with the
  // parent's (that id exactly, never a sibling brief's).
  const parent = /^(.+)-\d+$/.exec(id)?.[1];
  const review = triageReview(events, id, config.profile)
    ?? (parent ? triageReview(eventsOf(all, { project, task: parent }).filter(e => isTask(e, parent)), parent, config.profile) : null);
  if (!review) throw new UsageError(`review-prep: no triage of ${id}${parent ? ` nor of ${parent}` : ''} logged a review: run FORGE triage --task ${id} first`);
  const head = (deps.git(['rev-parse', 'HEAD']) ?? '').trim();
  if (!head) throw new UsageError('review-prep: cannot read HEAD');
  const diff = deps.git(['diff', `${baseSha}..HEAD`]);
  if (diff === null) throw new UsageError(`review-prep: cannot diff ${baseSha}..HEAD`);

  const dir = path.resolve(deps.cwd, dirArg);
  // Carry 3: in an execution, only its own verdicts count (the round, the redo, the express review, the validators rounds).
  const since = executionHolding(deps.cwd, { project, task: id })?.startedAt ?? null;
  const counted = eventsSince(events, since);
  const round = reviewRoundOf(counted, task);
  const roundDir = path.join(dir, `reviews-${n}-${round}`);
  mkdirSync(roundDir, { recursive: true });
  // K4-02: the threat model goes to the security reviewer (reviewRound adds it to its inputs).
  const tmFile = writeThreatModel(dir, config);
  // J-06: the brief's findings index (review-close writes it), for the ids a delta reviewer gets. C-13: review n of max.
  const index = parseIndex(readText(path.join(dir, `findings-index-${n}.json`)), task);
  const reviewsCount = reviewsOf(round, pathName);

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
    // I2: a reviewer delegated to an express review has no file of its own there. Its previous result is what the index
    // says the express reviewer left of its findings: a fail with the ones still open, else a pass with the express
    // reviewer's confidence. So it repeats in delta with its previous-<name>.json, or is carried, never in full.
    const prevPlan = readJson(path.join(prevDir, 'review-plan.json')) as { express?: unknown; delegated?: unknown } | undefined;
    if (prevPlan?.express === true && Array.isArray(prevPlan.delegated) && index.rounds.some(r => r.round === round - 1)) {
      for (const role of ROLES) {
        const name = reviewerKey(role);
        if (!prevPlan.delegated.includes(name) || prevReviews[name]) continue;
        const open = previousFindings(index, round, name).map(f => asPrevious(f));
        const r: Review = { verdict: open.length ? 'fail' : 'pass', confidence: prevReviews.correctness?.confidence ?? 0, findings: open };
        prevReviews[name] = r;
        previous[role] = { verdict: r.verdict, findings: r.findings };
      }
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
  const redo = round >= 2 && counted.filter(e => e.kind === 'verdict' && isTask(e, task)).at(-1)?.action === 'redo';

  // Measure 7 (§4.9): an express review when the previous review asked for a fix with green validators and left one or
  // two important findings with file and line, none from security, a regression or out of the model; never after a redo,
  // on the last review, or with review.express: false. It does not validate here (expressPrep). The validate command it
  // prints carries BASE unquoted, so only a commit id qualifies.
  const lastVerdict = counted.filter(e => e.kind === 'verdict' && isTask(e, task)).at(-1);
  const prevSent = readJson(path.join(dir, `findings-${n}-${round - 1}.json`)) as { validators?: unknown } | undefined;
  if (round >= 2 && !redo && round < reviewsCount.max && (pathName === 'medium' || pathName === 'large') && config.review.express
    && lastVerdict?.action === 'fix' && Array.isArray(prevSent?.validators) && prevSent!.validators.length === 0 && expressCandidate(index, round)
    && SHA.test(baseSha)) {
    const express = expressPrep({ deps, task, project, id, n, round, pathName, review, previous, prevReviews, fixFiles, dir, roundDir, baseSha,
      baselineArg, diff, head, tmFile, index, reviewsCount, locale, noCache: args.includes('--no-cache') });
    if (express) return express;
  }

  // C4: the brief enters validation (logged before the validators run, so the stage's clock includes them).
  appendPhase(deps.cwd, { ts: deps.now().toISOString(), kind: 'phase', task: id, phase: 'validate', brief: Number(n), round });

  // Validation, as `FORGE validate --all --path <p> --base <sha> --baseline <f>` runs it.
  const changed = deps.git(['diff', '--name-only', `${baseSha}..HEAD`]);
  const scope: Scope = pathName === 'trivial' || pathName === 'small' ? { mode: 'small' }
    : { mode: 'heavy', changed: changed === null ? null : changed.split('\n').map(s => s.trim()).filter(Boolean) };
  const restored: string[] = [];
  const validation = validateList(deps, config, selectValidators(detectValidators(deps.repo, config), scope), restored, args.includes('--no-cache'));
  const results: ValidatorResult[] = markPreexisting(validation.results, baseline);
  const ok = results.every(r => !blocking(r));
  const validatorsFile = path.join(dir, `validators-${n}.json`);
  writeFileSync(validatorsFile, JSON.stringify(results, null, 2) + '\n');
  appendEvent(deps.cwd, validateEvent(deps.now().toISOString(), task, results, validation.durationMs, scope.mode));
  const diffFile = path.join(dir, `diff-${n}.patch`);
  writeFileSync(diffFile, diff);

  // C-08: validators red that BASE did not have go back to the implementer before anyone reviews: a validators round,
  // at most MAX_VALIDATOR_ROUNDS per review (counted since the brief's last verdict). It writes no verdict, so it never
  // counts against the cap; after them, the review is planned as before and the verdict is a fix by validators.
  if (!ok) {
    const sinceVerdict = counted.slice(counted.map(e => e.kind === 'verdict' && isTask(e, task)).lastIndexOf(true) + 1);
    const k = sinceVerdict.filter(e => e.kind === 'phase' && isTask(e, id) && e.phase === 'fix' && e.validators === true && e.brief === Number(n)).length;
    if (k < MAX_VALIDATOR_ROUNDS) {
      const blockers = results.filter(blocking);
      const roundFile = path.join(dir, `validators-fix-${n}-${round}-${k + 1}.json`);
      writeFileSync(roundFile, JSON.stringify({
        task, round, validators: blockers.map(r => ({ validator: r.validator, failures: r.failures, failing: r.failing ?? [], ...(r.newFailing?.length ? { newFailing: r.newFailing } : {}) })),
      }, null, 2) + '\n');
      appendPhase(deps.cwd, { ts: deps.now().toISOString(), kind: 'phase', task: id, phase: 'fix', brief: Number(n), round, validators: true });
      // A plan an earlier preparation of this round left would let review-close close a review nobody did.
      rmSync(path.join(roundDir, 'review-plan.json'), { force: true });
      const fixOut: Record<string, unknown> = {
        round, reviews: reviewsCount,
        validators: { ok, failing: blockers.map(r => r.validator),
          preexisting: results.filter(r => r.ok !== true && r.preexisting === true).map(r => r.validator), file: rel(deps.cwd, validatorsFile) },
        spawn: [], validatorsRound: { k: k + 1, max: MAX_VALIDATOR_ROUNDS, findings: rel(deps.cwd, roundFile) },
        cached: cachedNames(results), durationMs: validation.durationMs, ...(restored.length ? { restored } : {}),
      };
      if (locale === 'es' || locale === 'en') fixOut.say = sayValidatorsRound(reviewsCount, k + 1, blockers.map(r => failingLabel(r, locale)), locale);
      return json(fixOut);
    }
  }

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
      ...(tmFile ? { threatModel: rel(deps.cwd, tmFile) } : {}),
    },
  });
  if (plan.shadow) mkdirSync(path.join(roundDir, 'shadow'), { recursive: true });

  // Delta reviewers get only their own findings the previous review left open (blocking, or residual sent to the
  // implementer), each with its stable id, from the brief's index (J-06); a brief without a record of that review (begun
  // before forge 0.18) gets its own blocking findings as parsed. A carried result is copied with "carried": true.
  const indexed = index.rounds.some(r => r.round === round - 1);
  for (const s of plan.spawn.filter(s => s.mode === 'delta' && !s.twin)) {
    const own = indexed ? previousFindings(index, round, s.name).map(f => asPrevious(f))
      : (previous[s.role]?.findings ?? []).filter(f => f.severity === 'critical' || f.severity === 'important');
    writeFileSync(findingsFile(s.name), JSON.stringify(own, null, 2) + '\n');
  }
  writeCarried(plan, dir, n, round, roundDir, prevReviews);

  const spawn = plan.spawn.map(s => spawnOut(s, taskLine(task, project)));
  writeFileSync(path.join(roundDir, 'head.txt'), head + '\n');
  writeFileSync(planFile, JSON.stringify({
    task, round, path: pathName, base: baseSha, head, light: review.light, flags: review.flags, shadow: plan.shadow,
    spawn, carried: plan.carried,
  }, null, 2) + '\n');

  // C4: who reviews this round, logged before they are spawned.
  appendPhase(deps.cwd, { ts: deps.now().toISOString(), kind: 'phase', task: id, phase: 'review', brief: Number(n), round,
    reviewers: spawn.map(s => ({ agent: s.agent, role: s.role, effort: s.effort, model: s.model, mode: s.mode, ...(s.twin === true ? { twin: true } : {}) })) });

  const failing = results.filter(blocking).map(r => r.validator);
  const preexisting = results.filter(r => r.ok !== true && r.preexisting === true).map(r => r.validator);
  const out: Record<string, unknown> = {
    round, reviews: reviewsCount, validators: { ok, failing, preexisting, file: rel(deps.cwd, validatorsFile) }, spawn, cached: cachedNames(results), durationMs: validation.durationMs,
    ...(plan.carried.length ? { carried: plan.carried.map(c => c.name) } : {}),
    ...(restored.length ? { restored } : {}),
  };
  if (locale === 'es' || locale === 'en') out.say = sayPrep(reviewsCount, ok, results.filter(blocking).map(r => failingLabel(r, locale)), plan, locale, cachedNames(results).length);
  return json(out);
}

function sayPrep(reviews: { n: number; max: number }, ok: boolean, failing: string[], plan: RoundPlan, locale: 'es' | 'en', cached: number): string {
  const who = plan.spawn.filter(s => !s.twin).map(s => `${s.name} (${s.effort}${s.mode === 'delta' ? ', delta' : ''})`).join(', ');
  const twins = plan.spawn.filter(s => s.twin).length;
  if (locale === 'es') {
    return `Revisión ${reviews.n} de ${reviews.max}: validadores ${ok ? 'en verde' : `en rojo (${failing.join(', ')})`}${cached ? ` (${cached} de caché)` : ''}; revisan ${who || 'nadie'}`
      + `${plan.carried.length ? `; se arrastran ${plan.carried.map(c => c.name).join(', ')}` : ''}${twins ? `; ${twins} gemelo(s) en sombra` : ''}.`;
  }
  return `Review ${reviews.n} of ${reviews.max}: validators ${ok ? 'green' : `red (${failing.join(', ')})`}${cached ? ` (${cached} cached)` : ''}; reviewing: ${who || 'nobody'}`
    + `${plan.carried.length ? `; carried: ${plan.carried.map(c => c.name).join(', ')}` : ''}${twins ? `; ${twins} shadow twin(s)` : ''}.`;
}

function sayValidatorsRound(reviews: { n: number; max: number }, k: number, failing: string[], locale: 'es' | 'en'): string {
  return locale === 'es'
    ? `Revisión ${reviews.n} de ${reviews.max}: validadores en rojo (${failing.join(', ')}); ronda de validadores ${k} de ${MAX_VALIDATOR_ROUNDS}: nadie revisa, el implementador los arregla primero.`
    : `Review ${reviews.n} of ${reviews.max}: validators red (${failing.join(', ')}); validators round ${k} of ${MAX_VALIDATOR_ROUNDS}: nobody reviews, the implementer fixes them first.`;
}

/** A spawn entry as review-prep prints it and review-plan.json keeps it. */
const spawnOut = (s: SpawnEntry, line: string) => ({
  agent: s.agent, model: s.model, effort: s.effort, mode: s.mode, ...(s.twin ? { twin: true } : {}), ...(s.express ? { express: true } : {}),
  role: s.role, inputs: s.inputs, taskLine: line,
});

/** A carried reviewer's previous file, copied into this review with "carried": true: as written when it is plain JSON,
 *  else as parsed; a reviewer delegated to an express review has no file there, so it gets the result the index gave it
 *  (I2). Nothing to carry writes nothing: review-close then lists the file as missing. */
function writeCarried(plan: RoundPlan, dir: string, n: string, round: number, roundDir: string, prevReviews: Partial<Record<ReviewerKey, Review>>): void {
  for (const c of plan.carried) {
    const raw = readJson(path.join(dir, `reviews-${n}-${round - 1}`, `${c.name}.json`));
    const parsed = prevReviews[c.name];
    const prev = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw
      : parsed ? { verdict: parsed.verdict, confidence: parsed.confidence, findings: parsed.findings } : null;
    if (prev) writeFileSync(path.join(roundDir, `${c.name}.json`), JSON.stringify({ ...prev, carried: true }, null, 2) + '\n');
  }
}

interface ExpressCtx {
  deps: ReviewDeps; task: string; project: string | null; id: string; n: string; round: number; pathName: PathName; review: TriageReview;
  previous: Partial<Record<ReviewRole, PreviousResult>>; prevReviews: Partial<Record<ReviewerKey, Review>>; fixFiles: string[];
  dir: string; roundDir: string; baseSha: string; baselineArg: string; diff: string; head: string; tmFile: string | null;
  index: FindingsIndex; reviewsCount: { n: number; max: number }; locale: string | undefined; noCache: boolean;
}

/**
 * Measure 7 (§4.9): the express review, or null when the plan cannot be one (reviewRound keeps it normal). One correctness
 * reviewer on Sonnet at medium, in delta, checks the open findings of every reviewer (previous-express.json, with ids and
 * reviewers); those that passed are carried, those that failed delegated. review-prep does not validate: it removes
 * validators-<n>.json and prints the validate command to run in the background next to the reviewer; review-close waits
 * for its file. Logs the phase review with express: true.
 */
function expressPrep(c: ExpressCtx): Result | null {
  const { deps, dir, roundDir, n, round } = c;
  const at = (f: string) => rel(deps.cwd, f);
  const validatorsFile = path.join(dir, `validators-${n}.json`);
  const diffFile = path.join(dir, `diff-${n}.patch`);
  const expressFile = path.join(roundDir, 'previous-express.json');
  const plan = reviewRound({
    review: c.review, round, path: c.pathName, previous: c.previous, fixFiles: c.fixFiles, fixZones: zonesFromPaths(c.fixFiles), express: true,
    files: {
      brief: at(path.join(dir, `brief-${n}.md`)), diff: at(diffFile), validators: at(validatorsFile), out: at(roundDir),
      shadow: at(path.join(roundDir, 'shadow')), fix: at(path.join(dir, `fix-${n}-${round}.patch`)), expressFindings: at(expressFile),
      findings: (name: ReviewerKey) => at(path.join(roundDir, `previous-${name}.json`)),
      ...(c.tmFile ? { threatModel: at(c.tmFile) } : {}),
    },
  });
  if (!plan.express) return null;
  // The validators run in the background next to the reviewer: a file an earlier review left must not count.
  rmSync(validatorsFile, { force: true });
  writeFileSync(diffFile, c.diff);
  writeFileSync(expressFile, JSON.stringify(previousFindings(c.index, round).map(f => asPrevious(f, true)), null, 2) + '\n');
  writeCarried(plan, dir, n, round, roundDir, c.prevReviews);
  const spawn = plan.spawn.map(s => spawnOut(s, taskLine(c.task, c.project)));
  // The same form as prep's validate (J-11): paths with / in double quotes, which every shell takes; --no-cache as given.
  const cmd = `node "${slash(deps.self ?? 'forge.cjs')}" validate --all --path ${c.pathName} --base ${c.baseSha} --baseline "${slash(path.resolve(deps.cwd, c.baselineArg))}"`
    + ` --task ${c.task} --out "${slash(validatorsFile)}"${samePath(deps.repoDir, deps.cwd) ? '' : ` --cwd "${slash(deps.repoDir)}"`}${c.noCache ? ' --no-cache' : ''}`;
  writeFileSync(path.join(roundDir, 'head.txt'), c.head + '\n');
  // validatorsCmd: the coordinator reads the command again from here when it must run it once more (a validation that
  // gave no results, a missing validators file), also after its context was compacted.
  writeFileSync(path.join(roundDir, 'review-plan.json'), JSON.stringify({
    task: c.task, round, path: c.pathName, base: c.baseSha, head: c.head, light: c.review.light, flags: c.review.flags, shadow: false,
    spawn, carried: plan.carried, express: true, delegated: plan.delegated, validatorsPending: true, validatorsCmd: cmd,
  }, null, 2) + '\n');
  appendPhase(deps.cwd, { ts: deps.now().toISOString(), kind: 'phase', task: c.id, phase: 'review', brief: Number(n), round, express: true,
    reviewers: spawn.map(s => ({ agent: s.agent, role: s.role, effort: s.effort, model: s.model, mode: s.mode })) });
  const out: Record<string, unknown> = {
    round, reviews: c.reviewsCount, express: true, validators: { pending: true, cmd, file: at(validatorsFile) }, spawn,
    ...(plan.carried.length ? { carried: plan.carried.map(x => x.name) } : {}), delegated: plan.delegated,
  };
  if (c.locale === 'es' || c.locale === 'en') out.say = sayExpress(c.reviewsCount, plan, c.locale);
  return json(out);
}

function sayExpress(reviews: { n: number; max: number }, plan: RoundPlan, locale: 'es' | 'en'): string {
  const carried = plan.carried.map(c => c.name).join(', ');
  return locale === 'es'
    ? `Revisión ${reviews.n} de ${reviews.max}, exprés: correctness (sonnet, medium) comprueba los hallazgos abiertos `
      + `mientras los validadores corren en segundo plano${carried ? `; se arrastran ${carried}` : ''}.`
    : `Review ${reviews.n} of ${reviews.max}, express: correctness (sonnet, medium) checks the open findings while the validators run in the background${carried ? `; carried: ${carried}` : ''}.`;
}

type ValidatorRow = { validator?: unknown; ok?: unknown; failures?: unknown; failing?: unknown; preexisting?: unknown };
const FINDING_ID = /^F\d{1,3}$/;
type Overrides = { outOfModel: string[]; defer: string[] };

/** One review's overrides.json, read leniently (K4-02, §4.8). */
function overridesOf(file: string): Overrides {
  const raw = readJson(file) as Partial<Record<keyof Overrides, unknown>> | undefined;
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && FINDING_ID.test(x)) : []);
  return { outOfModel: ids(raw?.outOfModel), defer: ids(raw?.defer) };
}

/** The overrides of every review of brief n (`reviews-<n>-*\/overrides.json`): a ruling on a finding stays for the brief. */
function briefOverrides(dir: string, n: string): Overrides {
  const all: Overrides = { outOfModel: [], defer: [] };
  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { /* no work dir */ }
  for (const e of entries) {
    if (!new RegExp(`^reviews-${n}-\\d+$`).test(e)) continue;
    const o = overridesOf(path.join(dir, e, 'overrides.json'));
    all.outOfModel.push(...o.outOfModel);
    all.defer.push(...o.defer);
  }
  return { outOfModel: [...new Set(all.outOfModel)], defer: [...new Set(all.defer)] };
}

/** The question review-close puts to the person when security repeats a closed theme (K4-02, §4.8). */
function askOf(ask: AskFinding[], locale: 'es' | 'en') {
  const pairs = ask.map(a => `${a.earlier.id} → ${a.id ?? '?'}`).join(', ');
  return locale === 'es'
    ? { kind: 'repeat-theme', findings: ask, question: `Security encontró otra variante de un problema ya arreglado (${pairs}). ¿Entra en lo que quieres proteger?`,
      options: [{ label: 'Sí, arréglalo', option: 'fix' }, { label: 'No, queda fuera del modelo', option: 'out-of-model' }] }
    : { kind: 'repeat-theme', findings: ask, question: `Security found another variant of a problem already fixed (${pairs}). Is it inside what you want to protect?`,
      options: [{ label: 'Yes, fix it', option: 'fix' }, { label: 'No, it is out of the model', option: 'out-of-model' }] };
}

/**
 * `FORGE review-close --task <T>-<n> --dir <dir> --path medium|large [--locale es|en] [--out-of-model F2,F5] [--defer F3]`:
 * closes the last round review-prep prepared in `<dir>/reviews-<n>-<round>/` (`--dir` may also be that round dir). Exits 3 with `missing` when a reviewer it spawned
 * (twins aside) left no file. Else runs the verdict with review-plan.json's flags, the round and the fix diff's hunks
 * (carried results keep their previous origins), logs it on the round dir and the round decision, logs the minor and
 * deferred findings as a ruling, writes `<dir>/findings-<n>-<round>.json` for the implementer when the action is not
 * accept, saves the case of each shadow twin already back in `shadow/` and lists the others in shadowPending (C-11; it never counts in the verdict), and
 * prints `{action, score, next, last, implementer, findings, deferred, invalid, incomplete}` (`incomplete`: the
 * reviewers whose file is a draft with `"complete": false`; plus `shadow`, the twins compared, and
 * `shadowSkipped`, the twins whose file, or their high reviewer's, was unparseable or a draft).
 * Every critical and important finding gets its stable id in <dir>/findings-index-<n>.json (J-06), and the verdict
 * applies the blocking table of the review (C-04): it prints reviews {n, max} (C-13) and ask, the question for a security
 * finding that repeats a closed theme (K4-02). --out-of-model and --defer keep ids in the review's overrides.json; the
 * overrides of every review of the brief apply. They take only ids of this review or left open by the previous one: any
 * other id exits 2 and writes nothing (M2). `deferred` also lists the findings out of the threat model (M1) and, on an
 * accept, the residuals and out-of-model findings earlier reviews left that nobody re-checked (I1, M1). The first review
 * after a redo is judged as review 1 against nothing of the reverted attempt, while it still counts as review n (I4).
 * With next fresh-stronger or redo it writes <dir>/handover-<n>-<round>.md
 * for the new implementer and prints its path as handover (C-15); revert is the git args that undo a redo's attempt (J-08), null otherwise.
 * An express review (measure 7) also lists validators-<n>.json in missing until the background validation writes it;
 * its verdict and output carry express: true, and a held one (its correctness did not answer) never counts toward stalled.
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
  const locale = flag('locale');
  if (args.includes('--locale') && locale !== 'es' && locale !== 'en') throw new UsageError('review-close: --locale must be es or en');
  // K4-02 / §4.8: ids the person ruled out of the threat model, or left open as an architecture change.
  const idsArg = (name: string): string[] => {
    if (!args.includes(`--${name}`)) return [];
    const list = (flag(name) ?? '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    if (!list.length || !list.every(x => FINDING_ID.test(x))) throw new UsageError(`review-close: --${name} takes finding ids such as F3,F5`);
    return list;
  };
  const outOfModelArg = idsArg('out-of-model'), deferArg = idsArg('defer');
  const [, id, n] = m;

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
  const plan = readJson(path.join(roundDir, 'review-plan.json')) as {
    spawn?: unknown; carried?: unknown; flags?: unknown; base?: unknown; express?: unknown; delegated?: unknown; validatorsPending?: unknown;
  } | undefined;
  if (!round || !plan || typeof plan !== 'object') throw new UsageError(`review-close: no review-plan.json for ${task} in ${dirArg}: run FORGE review-prep first`);

  const names = (list: unknown, keep: (x: Record<string, unknown>) => boolean) => (Array.isArray(list) ? list as Record<string, unknown>[] : [])
    .filter(x => x && typeof x === 'object' && keep(x))
    .map(x => (typeof x.name === 'string' ? x.name : typeof x.role === 'string' && (ROLES as readonly string[]).includes(x.role) ? reviewerKey(x.role as ReviewRole) : null))
    .filter((x): x is ReviewerKey => x === 'correctness' || x === 'security' || x === 'perf');
  const spawned = names(plan.spawn, x => x.twin !== true);
  const carried = names(plan.carried, () => true);
  const missing = [...new Set([...spawned, ...carried])].map(k => path.join(roundDir, `${k}.json`)).filter(f => !existsSync(f));
  // Measure 7: an express review's validators run in the background; the review closes once their file is there.
  const validatorsPath = path.join(dir, `validators-${n}.json`);
  if (plan.validatorsPending === true && !existsSync(validatorsPath)) missing.push(validatorsPath);
  // C-03: a background validation that failed without results (a bad --baseline, an invalid config) left {error, code}
  // through --out. It is no verdict on the code: the file goes, so the next close waits for it again and the skill runs
  // validators.cmd once more in the foreground (and tells the person and stops if that fails too).
  if (plan.validatorsPending === true && existsSync(validatorsPath)) {
    const doc = readJson(validatorsPath);
    if (!Array.isArray(doc)) {
      rmSync(validatorsPath, { force: true });
      const error = doc && typeof doc === 'object' && typeof (doc as { error?: unknown }).error === 'string' ? (doc as { error: string }).error : 'not a validate result';
      throw new UsageError(`review-close: the validation of ${task} gave no results (${error}); ${rel(deps.cwd, validatorsPath)} was removed: run its validators command again`);
    }
  }
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
  // Paths as the diff names them, so the index, the matching and the implementer's file compare like with like (J-06).
  for (const k of Object.keys(reviews) as ReviewerName[]) {
    reviews[k] = { ...reviews[k]!, findings: reviews[k]!.findings.map(f => (f.file ? { ...f, file: repoRelative(f.file, deps.repoDir) } : f)) };
  }

  // Validators as review-prep wrote them; failing ones that already failed on the base commit do not count.
  const rows = readJson(path.join(dir, `validators-${n}.json`));
  const arr = Array.isArray(rows) ? (rows as ValidatorRow[]).filter(r => r && typeof r === 'object') : [];
  const validatorsOk = Array.isArray(rows) && arr.every(r => !blocking(r));
  const failing: FailingValidator[] = arr.filter(r => blocking(r)).map(r => ({ validator: String(r.validator ?? ''), failures: Array.isArray(r.failures) ? r.failures.map(String) : [],
    failing: Array.isArray(r.failing) ? r.failing.map(String) : [] }));
  const preexisting = arr.filter(r => r.ok !== true && r.preexisting === true).map(r => String(r.validator ?? ''));

  const flags = Array.isArray(plan.flags) ? plan.flags : [];
  const fixPatch = round >= 2 ? (() => { try { return readFileSync(path.join(dir, `fix-${n}-${round}.patch`), 'utf8'); } catch { return ''; } })() : '';
  // C-13: review n of max; the last one accepts a fix with green validators and no critical (C-04, rule 7).
  const config = loadConfig(deps.repoDir);
  const reviewsCount = reviewsOf(round, p);
  // J-06: every critical and important finding gets its stable id from the brief's index; what the previous review left
  // open and nobody names now is closing (a new finding that matches it is hardening). `open` is looked up with the ids
  // assignIds gave (copied or paired), so a still-open finding its reviewer mislabels keeps blocking as previous.
  const indexPath = path.join(dir, `findings-index-${n}.json`);
  const indexText = readText(indexPath);
  const index = parseIndex(indexText, task);
  const express = plan.express === true;
  // I4: the first review after a redo judges an attempt started again: as review 1 (nothing of the reverted attempt is
  // open, closed or paired with), while it still counts as review n and the last one still accepts at the cap. The
  // previous verdict is the brief's last one logged on another review dir (a re-close of this one does not count).
  const roundRel = rel(deps.cwd, roundDir);
  // D-08: only this task's events of its project (ids repeat between plans): --project, else the folder --dir names,
  // else the ledger's attribution.
  const before = readEvents(deps.cwd);
  const project = resolveProject({ flag: flag('project'), dir: dirArg, task: id, events: before });
  const fresh = round >= 2 && eventsOf(before, { project, task: id }).filter(e => e.kind === 'verdict' && isTask(e, task) && e.dir !== roundRel).at(-1)?.action === 'redo';
  const withIds = assignIds(index, round, reviews, { express, fresh });
  const open = fresh ? {} : openIds(index, round);
  // Rulings on findings stay for the brief: the ids given now are kept in this review's overrides.json, and the overrides
  // of every review of brief n apply (K4-02, §4.8). M2: only ids of this review or left open by the previous one: a
  // mistyped id would otherwise rule silently on whatever finding gets it later. One that is not refuses the whole call.
  if (outOfModelArg.length || deferArg.length) {
    const known = [...new Set([...idsOf(withIds), ...Object.values(open).flatMap(v => v ?? [])])].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
    for (const [name, list] of [['out-of-model', outOfModelArg], ['defer', deferArg]] as const) {
      const unknown = list.filter(x => !known.includes(x));
      if (unknown.length) {
        throw new UsageError(`review-close: --${name} ${unknown.join(',')}: no finding of this review, nor one the previous review left open, `
          + `has that id; nothing was written (ids: ${known.join(', ') || 'none'})`);
      }
    }
    const kept = overridesOf(path.join(roundDir, 'overrides.json'));
    writeFileSync(path.join(roundDir, 'overrides.json'), JSON.stringify({
      outOfModel: [...new Set([...kept.outOfModel, ...outOfModelArg])], defer: [...new Set([...kept.defer, ...deferArg])],
    }, null, 2) + '\n');
  }
  const overrides = briefOverrides(dir, n);
  // An express reviewer answers for the reviewers delegated to it: their open findings it does not name are closing.
  // Safety rule (measure 7): one that did not answer (abstain, invalid, a draft or missing) checked nothing, so it closes
  // nothing, what the delegated reviewers left open stays open and blocks, and the review never accepts (hold); the next
  // review-prep plans a normal review, since reviewRound wants a usable previous correctness. A draft never closes a
  // finding, in any review (answeredBy).
  const delegated = Array.isArray(plan.delegated) ? plan.delegated.filter((x): x is ReviewerKey => x === 'correctness' || x === 'security' || x === 'perf') : [];
  const answered = answeredBy(withIds);
  const held = express && !answered.includes('correctness');
  if (express && !held) answered.push(...delegated.filter(k => !answered.includes(k)));
  const hold = held ? {
    reason: 'express review: correctness did not answer (abstain, invalid, draft or missing), so what the reviewers delegated to it left open stays open; the next review is a normal one',
    findings: delegated.flatMap(k => previousFindings(index, round, k)).filter(f => f.status === 'open').map(f => asPrevious(f, true)),
  } : undefined;
  const result = synthesize(withIds, weightsFor({ sensitive: flags.includes('--sensitive'), perf: flags.includes('--perf') }), validatorsOk, failing, {
    round, fixHunks: parseHunks(fixPatch), root: deps.repoDir, carried, last: round >= reviewsCount.max, personDocs: config.review.personDocs,
    open, closed: fresh ? {} : closedFor(index, round, idsOf(withIds), answered), outOfModel: overrides.outOfModel, defer: overrides.defer,
    ...(hold ? { hold } : {}), ...(fresh ? { fresh } : {}),
  });
  // An index that exists but cannot be read is set aside next to the new one, never overwritten.
  if (indexText?.trim() && !index.rounds.length) {
    const aside = `${indexPath}.corrupt-${deps.now().toISOString().replace(/[:.]/g, '-')}`;
    renameSync(indexPath, aside);
    result.reasons.push(`unreadable findings index set aside as ${rel(deps.cwd, aside)}`);
  }
  const indexNow = recordRound(index, round, result, answered, { fresh });
  writeFileSync(indexPath, JSON.stringify(indexNow, null, 2) + '\n');
  // I1: on an accept, the residuals earlier reviews left that no reviewer gets back (hardening, architecture) are still
  // open: they go to deferred, and so to the ruling and the final report, with this review's own (§4.7). After a redo
  // they were about the reverted attempt.
  const carriedResidual = result.action === 'accept' && !fresh ? carriedResiduals(index, round, result) : [];
  if (carriedResidual.length) {
    result.deferred.push(...carriedResidual);
    result.reasons.push(`${carriedResidual.length} residual finding(s) of earlier reviews still open (${[...new Set(carriedResidual.map(f => f.residual))].join(', ')})`);
  }
  if (!Array.isArray(rows)) result.reasons.push('no validation recorded');
  if (preexisting.length) result.reasons.push(`already failing on the base commit, not counted: ${preexisting.join(', ')}`);

  const ts = deps.now().toISOString();
  appendPhase(deps.cwd, { ts, kind: 'phase', task: id, phase: 'verdict', brief: Number(n), round });
  appendEvent(deps.cwd, { ts, kind: 'verdict', task, dir: rel(deps.cwd, roundDir), action: result.action, score: result.score, signature: result.signature,
    critical: result.critical.length, important: result.important.length, minor: result.minor.length, deferred: result.deferred.length, reviews: reviewsCount,
    ...(result.ask.length ? { ask: result.ask.length } : {}), ...(express ? { express: true } : {}),
    // A held review never counts toward stalled (roundDecision): its blocking set is not a re-review result.
    ...(held ? { held: true } : {}) });
  if (verifyFile !== undefined) {
    // As FORGE verdict logs it.
    const evidence = rel(deps.cwd, roundDir).replace(/reviews-(\d+-\d+)$/, 'evidence/$1');
    // K2-04: from a forge task worktree, verify.json and the evidence are copied to the main checkout first.
    const kept = keepEvidence(deps.cwd, roundDir);
    appendEvent(deps.cwd, { ts, kind: 'verify', task, result: verifyFile?.result ?? 'invalid',
      passed: verifyFile ? verifyFile.checks.filter(c => c.ok).length : 0, total: verifyFile ? verifyFile.checks.length : 0,
      evidence, ...(verifyFile?.reason ? { reason: verifyFile.reason } : {}), ...(kept.skipped.length ? { evidenceSkipped: kept.skipped } : {}) });
  }
  // The whole ledger goes to roundDecision, which filters by the pair itself: the events of a loose brief `<parent>-<k>`
  // are attributed by its parent's triage, which `events` (those of `<id>` and its briefs) does not hold.
  const all = readEvents(deps.cwd);
  const events = eventsOf(all, { project, task: id });
  // Carry 3: in an execution, only its own verdicts count toward the cap and a stall.
  const since = executionHolding(deps.cwd, { project, task: id })?.startedAt ?? null;
  const d = roundDecision(all, task, p, config.profile, project, since);
  appendEvent(deps.cwd, { ts, kind: 'round', task, ...d, reviews: reviewsCount });
  // C4: a verdict that sends the brief back to an implementer opens its fix stage.
  if (result.action !== 'accept' && (d.next === 'resume' || d.next === 'fresh-stronger' || d.next === 'redo')) {
    appendPhase(deps.cwd, { ts, kind: 'phase', task: id, phase: 'fix', brief: Number(n), round });
  }
  if (result.minor.length || result.deferred.length) {
    // Closing the same round again with the same findings does not log the ruling twice. R3 (M3): an earlier run's ruling
    // on the same round folder is not this one's.
    const ruling = { task, round, dir: rel(deps.cwd, roundDir),
      ...(result.minor.length ? { minor: result.minor } : {}), ...(result.deferred.length ? { deferred: result.deferred } : {}) };
    const same = JSON.stringify(ruling);
    const logged = eventsSince(events, since).some(e => e.kind === 'ruling' && isTask(e, task) && e.dir === ruling.dir
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

  // C-15: a new implementer (fresh-stronger or redo) starts from a handover with the history of the brief's reviews.
  // BASE and HEAD come from files in the round dir: only a commit that resolves is used, never text that git could read as an option.
  const sha = (v: unknown): string => {
    if (typeof v !== 'string' || !SHA.test(v.trim())) return '';
    return (deps.git(['rev-parse', '--verify', '--quiet', `${v.trim()}^{commit}`]) ?? '').trim();
  };
  const planBase = sha(plan.base);
  let handover: string | null = null;
  const handoverFile = path.join(dir, `handover-${n}-${round}.md`);
  if (d.next === 'fresh-stronger' || d.next === 'redo') {
    const wrong = Object.values(reviews).filter(r => r?.verdict === 'fail' && r.approach === 'wrong')
      .flatMap(r => r!.findings.filter(f => f.severity !== 'minor').map(f => f.problem));
    writeFileSync(handoverFile, renderHandover({
      task, reviews: reviewsCount, brief: rel(deps.cwd, path.join(dir, `brief-${n}.md`)), diff: rel(deps.cwd, path.join(dir, `diff-${n}.patch`)),
      base: planBase, head: sha(readText(path.join(roundDir, 'head.txt'))),
      open: [...result.critical, ...result.important], residual: result.deferred, history: historyLine(indexNow),
      validators: failing.map(v => v.validator), report: rel(deps.cwd, path.join(dir, `report-${n}.txt`)),
      redo: d.next === 'redo' ? { reasons: wrong } : null,
    }));
    handover = rel(deps.cwd, handoverFile);
  } else rmSync(handoverFile, { force: true });
  // J-08: a redo undoes the attempt without rewriting history; the skill runs git with these args as printed. Null when
  // HEAD is still BASE, or when the plan has no BASE that resolves to a commit (one written by forge 0.17, or edited).
  // A merge in the range (a conflict retry merged the run branch into the task, and BASE moved to the tip it merged):
  // `git revert` stops on it, and `-m 1` would also undo the run branch's work it brought. Then `steps`, git argument
  // lists the skill runs in order, restore BASE's tree in one commit: the run branch's work in BASE stays, the attempt goes.
  const headNow = (deps.git(['rev-parse', 'HEAD']) ?? '').trim();
  const undo = d.next === 'redo' && !!planBase && !!headNow && headNow !== planBase;
  const revert = undo
    ? deps.git(['rev-list', '--merges', `${planBase}..HEAD`])?.trim()
      ? { base: planBase, head: headNow, steps: [['-C', deps.repoDir, 'read-tree', '-u', '--reset', planBase],
        ['-C', deps.repoDir, 'commit', '--allow-empty', '-m', `${id}: undo the attempt for a redo (back to the tree of ${planBase.slice(0, 12)})`]] }
      : { base: planBase, head: headNow, args: ['-C', deps.repoDir, 'revert', '--no-edit', `${planBase}..HEAD`] }
    : null;

  // C-11: the shadow twins never hold the review: the ones already back are saved now, the rest are listed in
  // shadowPending and saved by FORGE shadow collect when they are back. They never reach the verdict.
  const twins = collectTwins(task, roundDir, plan, deps);
  // M1: findings out of the threat model are minor in the verdict (and in the ruling), and deferred lists them too, with
  // residual out-of-model, so the report that closes the work shows every residual (§4.7); on an accept, also those
  // ruled out of the model in earlier reviews that this one does not name (the index carries them).
  const deferred = [...result.deferred, ...result.minor.filter(f => f.residual === 'out-of-model'),
    ...(result.action === 'accept' && !fresh ? carriedOutOfModel(index, round, result) : [])];
  return json({
    action: result.action, score: result.score, next: d.next, last: d.last, implementer: d.implementer, reviews: reviewsCount, ...(express ? { express: true } : {}),
    findings, deferred, ask: result.ask.length ? askOf(result.ask, locale === 'es' ? 'es' : 'en') : null, handover, revert,
    invalid: result.reviewers.filter(r => r.invalid).map(r => r.name),
    incomplete: result.reviewers.filter(r => r.incomplete).map(r => r.name), round, reasons: result.reasons,
    ...(twins.shadow.length ? { shadow: twins.shadow } : {}), ...(twins.shadowSkipped.length ? { shadowSkipped: twins.shadowSkipped } : {}),
    ...(twins.shadowPending.length ? { shadowPending: twins.shadowPending } : {}),
  });
}

/**
 * `FORGE prep --task <id>-<n> --path <p> [--phase <name>] [--dir <dir>] [--cwd <worktree>] [--base <sha>] [--no-baseline] [--no-cache]`: before a brief's work, in
 * one call, reads BASE (the HEAD of `--cwd`, or `--base`: D-02, the `base` swarm worktree printed for a task resumed on
 * its branch, HEAD or a commit below it; the phase and the output then carry `head`, the HEAD this brief's work starts on,
 * and the baseline is still the worktree's, so a caller that wants it on BASE passes --no-baseline and takes it where
 * BASE's tree is), records what already fails on it into `<dir>/baseline-<n>.json` (as
 * `validate --all --path <p> --base-run --task <id>-<n>` does; `<dir>` defaults to the task's work folder, `.forge/work/<project>/<id>` for a plan task), logs the phase
 * `{"phase":<name, default implement>,"brief":<n>,"base":<BASE>}` on `<id>` and prints
 * `{base, baseline, failing, cached, durationMs, validate, threatModel}` (the baseline comes from the tree cache when BASE's tree was
 * validated: C6, I-06; never with --no-cache).
 * validate is the command the implementer runs (J-11). --no-baseline records BASE and the phase without validating (baseline: null; J-13).
 * It also writes <dir>/threat-model.md from the config's threatModel and prints threatModel, its path or null (K4-02).
 * Carry 3: in an execution that holds the task, the review rounds an earlier run left for this brief in `<dir>` go aside
 * first (setAsideEarlier), and it prints `earlier`, the folder they went to.
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
  const head = (deps.git(['rev-parse', 'HEAD']) ?? '').trim();
  if (!head) throw new UsageError('prep: cannot read HEAD');
  let base = head;
  if (args.includes('--base')) {
    const given = flag('base');
    if (!given) throw new UsageError('prep: --base needs a commit');
    const sha = (deps.git(['rev-parse', '--verify', '-q', `${given}^{commit}`]) ?? '').trim();
    if (!SHA.test(sha) || deps.git(['merge-base', '--is-ancestor', sha, 'HEAD']) === null) throw new UsageError(`prep: --base ${given.slice(0, 80)} is not HEAD or a commit below it`);
    base = sha;
  }
  // Where this brief's work starts, when BASE is below it (the step tells by it whether the implementer committed).
  const started = base === head ? {} : { head };
  // The config, read once. --no-baseline never read it before the threat model, so an invalid one does not stop it
  // (C-T5): it then writes no threat model; a baseline run still refuses it (exit 2).
  const noBaseline = args.includes('--no-baseline');
  let config: ForgeConfig | null = null;
  // I-03: an untrusted config is never forgiven (UntrustedCommandsError is no ConfigError): the brief's validate runs it.
  try { config = loadTrustedConfig(deps.repoDir); } catch (e) { if (!noBaseline || !(e instanceof ConfigError)) throw e; }
  // K4-02: the threat model the brief and the security reviewer read, written from the config (null without one).
  // D-08: without --dir, the task's work folder: its project's, or the older one the ledger still gives it.
  if (flag('dir') === undefined && !isSafeId(id)) throw new UsageError(`prep: --task ${task.slice(0, 80)}: no work folder can be named after its id (letters, digits, _ - . only); pass --dir`);
  const ledger = readEvents(deps.cwd);
  const project = resolveProject({ flag: flag('project'), dir: flag('dir'), task: id, events: ledger });
  const dir = flag('dir') !== undefined ? path.resolve(deps.cwd, flag('dir')!) : readWorkDir(deps.cwd, { project, task: id }, ledger);
  mkdirSync(dir, { recursive: true });
  // Carry 3: an earlier execution's reviews of this brief, in the same work folder, are not this one's.
  const run = executionHolding(deps.cwd, { project, task: id });
  const mine = eventsOf(ledger, { project, task: id });
  const aside = run ? setAsideEarlier(dir, n, id, mine, run, deps.cwd) : null;
  // R1 (M1): from a forge task worktree, keepEvidence copies this folder's verification to the main checkout's same
  // folder, where the earlier run's copy is: it goes aside too, before this brief's copies land on it.
  const main = ledgerRoot(deps.cwd);
  const inWork = path.relative(deps.cwd, dir);
  if (run && !samePath(main, deps.cwd) && inWork && !inWork.startsWith('..') && !path.isAbsolute(inWork)) {
    try { setAsideEarlier(path.join(main, inWork), n, id, mine, run, deps.cwd); } catch (err) {
      // R8: what already moved on this worktree's side is said too, and where.
      if (err instanceof UsageError && aside) throw new UsageError(`${err.message}; already moved this worktree's ${aside.moved.join(', ')} to ${shown(deps.cwd, aside.aside)}`);
      throw err;
    }
  }
  const earlier = aside ? { earlier: rel(deps.cwd, aside.aside) } : {};
  const tmFile = config ? writeThreatModel(dir, config) : null;
  const threatModel = tmFile ? rel(deps.cwd, tmFile) : null;
  // J-11: the implementer's validate command, exactly as it runs it: the tests related to its changes since BASE, the
  // typecheck and the lint, in the code's directory. Paths with / and in double quotes, which every shell takes.
  const validate = `node "${slash(deps.self ?? 'forge.cjs')}" validate --affected --base ${base} --task ${task}${samePath(deps.repoDir, deps.cwd) ? '' : ` --cwd "${slash(deps.repoDir)}"`}`;
  // J-13: --no-baseline (the Small path) records BASE and the phase and runs no validator.
  if (noBaseline || !config) {
    appendEvent(deps.cwd, { ts: deps.now().toISOString(), kind: 'phase', task: id, phase, brief: Number(n), base, ...started });
    return json({ base, ...started, baseline: null, failing: [], cached: [], durationMs: 0, validate, threatModel, ...earlier });
  }

  // The baseline, as `validate --all --path <p> --base-run` runs it: on BASE nothing changed yet, so a heavy path runs
  // every heavy validator (the review's diff later selects among them).
  const scope: Scope = p === 'trivial' || p === 'small' ? { mode: 'small' } : { mode: 'heavy', changed: null };
  const restored: string[] = [];
  const { results, durationMs } = validateList(deps, config, selectValidators(detectValidators(deps.repo, config), scope), restored, args.includes('--no-cache'));
  const file = path.join(dir, `baseline-${n}.json`);
  writeFileSync(file, JSON.stringify(results, null, 2) + '\n');
  const ts = deps.now().toISOString();
  appendEvent(deps.cwd, validateEvent(ts, task, results, durationMs, scope.mode, { baseline: true }));
  appendEvent(deps.cwd, { ts, kind: 'phase', task: id, phase, brief: Number(n), base, ...started });
  return json({
    base, ...started, baseline: rel(deps.cwd, file), failing: results.filter(blocking).map(r => r.validator), cached: cachedNames(results),
    durationMs, validate, threatModel, ...(restored.length ? { restored } : {}), ...earlier,
  });
}

/** `review-prep`, `review-close`, `prep` and `shadow` (cli/shadow.ts). */
export function reviewCommand(cmd: string, args: string[], deps: ReviewDeps): Result {
  switch (cmd) {
    case 'review-prep': return reviewPrep(args, deps);
    case 'review-close': return reviewClose(args, deps);
    case 'shadow': return shadowCommand(args, deps);
    case 'prep': return prep(args, deps);
    default:
      throw new UsageError(`unknown review command ${cmd}`);
  }
}
