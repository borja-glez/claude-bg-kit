import type { Command } from '../context.js';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { appendEvent, readEvents } from '../../ledger.js';
import { parseReview, parseVerifyFile, verifyReview, weightsFor, synthesize, type ReviewerName, type FailingValidator } from '../../verdict.js';
import { UsageError } from '../errors.js';
import { eventsOf, isTask, resolveProject } from '../../task-ref.js';
import { blocking } from '../../validators.js';
import { logVerifyResult } from '../shared.js';

export const command: Command = (args, ctx) => {
  const { io, flag, has, json, ts } = ctx;
  const task = flag('task');
  const dirArg = flag('dir');
  if (!task || !dirArg) throw new UsageError('verdict: --task and --dir are required');
  const dir = path.resolve(io.cwd, dirArg);
  const reviews: Partial<Record<ReviewerName, ReturnType<typeof parseReview>>> = {};
  for (const name of ['correctness', 'security', 'perf'] as const) {
    const file = path.join(dir, `${name}.json`);
    if (existsSync(file)) reviews[name] = parseReview(readFileSync(file, 'utf8'));
  }
  // K2-13: --verify <file> takes the verify.json of a flow pass into the final review; the pass records its own
  // result (verify-close --flow), so no verify event is logged for it here. K2-09: the verdict waits (exit 3) for a
  // verify.json it was given, or for one a verify-env.json next to it says an agent is writing.
  const verifyArg = flag('verify');
  if (has('verify') && !verifyArg) throw new UsageError('verdict: --verify needs the path of a verify.json');
  const verifyPath = verifyArg ? path.resolve(io.cwd, verifyArg) : path.join(dir, 'verify.json');
  if (!existsSync(verifyPath) && (verifyArg || existsSync(path.join(path.dirname(verifyPath), 'verify-env.json')))) {
    return json({ missing: [path.relative(io.cwd, verifyPath).split(path.sep).join('/')] }, 3);
  }
  const verifyFile = existsSync(verifyPath) ? parseVerifyFile(readFileSync(verifyPath, 'utf8')) : undefined;
  if (verifyFile !== undefined) reviews.verify = verifyReview(verifyFile);
  if (!Object.keys(reviews).length) throw new UsageError(`no reviews found in ${dirArg}`);
  let validatorsOk: boolean;
  let failing: FailingValidator[] = [];
  let preexisting: string[] = [];
  let recorded = true;
  if (flag('validators')) {
    let results: unknown;
    try { results = JSON.parse(readFileSync(path.resolve(io.cwd, flag('validators')!), 'utf8')); } catch { throw new UsageError('verdict: --validators must be the JSON written by forge validate'); }
    const arr = Array.isArray(results) ? results as { validator?: unknown; ok?: unknown; failures?: unknown; preexisting?: unknown }[] : [];
    validatorsOk = Array.isArray(results) && arr.every(r => r && typeof r === 'object' && !blocking(r));
    failing = arr.filter(r => r && typeof r === 'object' && blocking(r)).map(r => ({ validator: String(r.validator ?? ''), failures: Array.isArray(r.failures) ? r.failures.map(String) : [] }));
    preexisting = arr.filter(r => r && typeof r === 'object' && r.ok !== true && r.preexisting === true).map(r => String(r.validator ?? ''));
  } else {
    // D-08: the last validation of this task of its project (--project, the folder --dir names, or the ledger's).
    const ledger = readEvents(io.cwd);
    const mine = eventsOf(ledger, { project: resolveProject({ flag: flag('project'), dir: dirArg, task, events: ledger }), task });
    const lastValidate = [...mine].reverse().find(e => e.kind === 'validate' && isTask(e, task) && e.baseline !== true);
    recorded = lastValidate !== undefined;
    validatorsOk = lastValidate?.ok === true;
    const rs = Array.isArray(lastValidate?.results) ? lastValidate!.results as { validator?: unknown; ok?: unknown; failures?: unknown; preexisting?: unknown }[] : [];
    failing = rs.filter(r => r && blocking(r)).map(r => ({ validator: String(r.validator ?? ''), failures: Array.isArray(r.failures) ? r.failures.map(String) : [] }));
    preexisting = rs.filter(r => r && r.ok !== true && r.preexisting === true).map(r => String(r.validator ?? ''));
  }
  const result = synthesize(reviews, weightsFor({ sensitive: has('sensitive'), perf: has('perf') }), validatorsOk, failing);
  if (!recorded) result.reasons.push('no validation recorded');
  if (preexisting.length) result.reasons.push(`already failing on the base commit, not counted: ${preexisting.join(', ')}`);
  // dir lets `round` count a re-run verdict on the same review dir once.
  appendEvent(io.cwd, { ts: ts(), kind: 'verdict', task, dir: path.relative(io.cwd, dir).split(path.sep).join('/') || '.', action: result.action, score: result.score, signature: result.signature,
    critical: result.critical.length, important: result.important.length, minor: result.minor.length });
  if (verifyFile !== undefined && !verifyArg) logVerifyResult(io.cwd, ts(), task, dir, verifyFile);
  // invalid and incomplete (a draft with "complete": false) name the reviewers to respawn once.
  return json({ ...result, invalid: result.reviewers.filter(r => r.invalid).map(r => r.name), incomplete: result.reviewers.filter(r => r.incomplete).map(r => r.name) });
};
