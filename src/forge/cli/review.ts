import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { UsageError } from './errors.js';
import { appendEvent, readEvents, type LedgerEvent } from '../ledger.js';
import { loadConfig, agentFor, type Profile } from '../config.js';
import { detectValidators, selectValidators, runValidators, markPreexisting, blocking, type RepoReader, type Scope, type ValidatorResult } from '../validators.js';
import { PATH_ORDER, zonesFromPaths, type PathName, type ReviewRole } from '../triage.js';
import { parseReview, type Review } from '../verdict.js';
import { takeBrief } from '../shadow.js';
import { reviewRound, reviewerKey, type PreviousResult, type ReviewerKey, type RoundPlan, type RoundReviewer, type TriageReview } from '../review-round.js';

// The review commands. run.ts dispatches here; this module never imports run.ts (that would be a cycle).

type Result = { code: number; stdout: string; stderr: string };
type Exec = Parameters<typeof runValidators>[1];
/** What the review commands need from the caller: forge's own dir (`cwd`), the code's dir (`repoDir`) and its tools. */
export interface ReviewDeps { cwd: string; repoDir: string; now: () => Date; git: (args: string[]) => string | null; exec: Exec; repo: RepoReader }

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
  const review = triageReview(events, id, config.profile);
  if (!review) throw new UsageError(`review-prep: no triage of ${id} logged a review: run FORGE triage --task ${id} first`);
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
  const results: ValidatorResult[] = markPreexisting(
    runValidators(selectValidators(detectValidators(deps.repo, config), scope), deps.exec, config.validatorTimeoutSec), baseline);
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
      previous[role] = { verdict: r.verdict, findings: r.findings };
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

/** `review-prep`, `review-close`, `prep` and `shadow`; the ones not built yet answer with a usage error. */
export function reviewCommand(cmd: string, args: string[], deps: ReviewDeps): Result {
  switch (cmd) {
    case 'review-prep': return reviewPrep(args, deps);
    case 'review-close':
    case 'prep':
    case 'shadow':
      throw new UsageError(`${cmd}: not available yet in this forge version`);
    default:
      throw new UsageError(`unknown review command ${cmd}`);
  }
}
