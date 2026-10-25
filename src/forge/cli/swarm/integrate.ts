import type { SwarmCommand, SwarmDeps } from './context.js';
import path from 'node:path';
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { UsageError } from '../errors.js';
import type { Io } from '../run.js';
import { runOptions } from '../../validators.js';
import { readEvents, appendPhase } from '../../ledger.js';
import { readExecution, updateExecution, runWorktree, writePublicTask } from '../../execution.js';
import { isSafeId, type ExecTask, type ExecutionState } from '../../../lib/execution-state.js';
import { LEASE_MINUTES } from '../../../lib/coordination.js';
import { workRel } from '../../task-ref.js';
import { taskReceipt, sameReviewedTree, treeOf, commitOf, changedOut, TASK_TREE_CHANGED, TASK_NO_RECEIPT } from '../../receipts.js';
import { isPlanId } from '../../../lib/plan.js';
import { updateLocal } from '../../local.js';
import { integratedSay } from '../../swarm.js';
import { phaseToVerify } from '../../flow.js';
import { loadTrustedConfig } from '../../trust.js';
import type { Result } from '../context.js';
import { mergeIn, attemptExtras, commitInfo, integratedPublish, logValidations } from './integration.js';
import { localeArg, spanish } from './shared.js';

const WORK_FILES = /^(?:baseline-\d+\.json|brief-\d+\.md|report-\d+\.txt)$/;

/** The task goes back to stage validate as the coordinator's, so the next swarm step prepares its review again. */
function reviewAgain(io: Io, e: ExecutionState, task: string, t: ExecTask, reason: string, changed: string[], at: string): Result {
  // A member's task passes to the coordinator: the tick would take a `sessions` task with its state/T `done` for accepted again (schedule.ts:80-82).
  if (t.executor !== 'subagents') {
    const rel = workRel({ project: e.kind === 'plan' ? e.project : null, task });
    try {
      const from = path.join(t.worktree, rel);
      const to = path.join(io.cwd, rel);
      mkdirSync(to, { recursive: true });
      for (const f of readdirSync(from)) {
        if (!WORK_FILES.test(f) || existsSync(path.join(to, f))) continue;
        try { copyFileSync(path.join(from, f), path.join(to, f)); } catch { /* the review is prepared without it */ }
      }
    } catch { /* nothing to copy */ }
  }
  const lease = new Date(io.now().getTime() + LEASE_MINUTES * 60000).toISOString();
  let changedNow = false;
  // The task's status under the lock when it was no longer accepted (a tick or a swarm task meanwhile), null when it is gone.
  let state = null as string | null;
  updateExecution(io.cwd, cur => {
    const c = cur?.tasks[task];
    if (!cur || !c || c.status !== 'accepted') { state = c?.status ?? null; return null; }
    changedNow = true;
    const next: ExecTask = {
      ...c, status: 'running', stage: 'validate', executor: 'subagents', agent: null, detail: `unreviewed: ${reason}`,
      updatedAt: at, stageSince: at, finishedAt: null,
    };
    return { ...cur, tasks: { ...cur.tasks, [task]: next } };
  }, { now: io.now, sleep: io.sleep });
  if (changedNow) {
    writePublicTask(io.cwd, {
      task, runId: e.runId, stage: 'validate', status: 'running', agent: null, round: t.round, since: at, updatedAt: at, leaseUntil: lease, by: e.coordinator, mode: 'subagents',
    });
    appendPhase(io.cwd, { ts: at, kind: 'phase', task, phase: 'validate', ...(e.kind === 'plan' && isSafeId(e.project) ? { project: e.project } : {}) });
  }
  const outcome = changedNow ? 'it is reviewed again' : `${state === null ? 'it is no longer in the execution' : `it is ${state} now`}, so it is not reviewed again`;
  return { code: 0, stdout: JSON.stringify({ result: 'unreviewed', reason, ...changedOut(changed), detail: `${task}: ${reason}; ${outcome}` }) + '\n', stderr: '' };
}

function integrate(rest: string[], io: Io, deps: SwarmDeps, planArg?: string, db?: string): Result {
  const task = rest[0];
  if (!task || !isPlanId(task)) throw new UsageError('swarm integrate: a task id is required');
  const locale = localeArg(rest, 'integrate');
  const e = readExecution(io.cwd);
  if (!e) throw new UsageError('swarm integrate: no execution (forge swarm start)');
  const t = e.tasks[task];
  if (!t || t.status !== 'accepted') throw new UsageError(`swarm integrate: ${task} is not accepted`);
  const at = io.now().toISOString();
  const out = (v: unknown): Result => ({ code: 0, stdout: JSON.stringify(v) + '\n', stderr: '' });
  const wt = e.kind === 'plan' ? runWorktree(io.cwd) : io.cwd;
  const target = deps.at(wt);
  const head = target.git(['rev-parse', '--abbrev-ref', 'HEAD'])?.trim();
  if (e.kind === 'plan') {
    if (head !== e.branch) return out({ result: 'run-dirty', detail: `${wt} is on ${head ?? '?'}, not ${e.branch}` });
  } else if (head !== e.branch) {
    // An ephemeral run integrates into the user's own branch: never into whatever the user switched to since.
    throw new UsageError(`swarm integrate: the main checkout is on ${head ?? '?'}, not ${e.branch} (the branch this ephemeral run started from); switch back to ${e.branch} to integrate ${task}`);
  }
  // A3: the branch must still hold the tree its review accepted (forge's notes in .forge/verify/*.md aside).
  const tip = commitOf(target.git, `refs/heads/${t.branch}`);
  if (tip && t.executor !== 'manual') {
    const receipt = taskReceipt(readEvents(io.cwd), e, task, [io.cwd, t.worktree], target.git);
    if (receipt !== 'none') {
      const now = treeOf(target.git, tip);
      if (receipt === 'unknown' || now === null) return reviewAgain(io, e, task, t, TASK_NO_RECEIPT, [], at);
      const same = sameReviewedTree(target.git, receipt.tree, now);
      if (!same.ok) return reviewAgain(io, e, task, t, TASK_TREE_CHANGED, same.changed, at);
    }
  }
  // I-03: swarm.setup and the validators run only with the person's trust (exit 2 without it, before any merge).
  const config = loadTrustedConfig(io.cwd);
  const personal = e.kind !== 'plan';
  // --no-cache: neither read nor write the tree cache (a red result it holds may have been flaky).
  const cache = config.validate.cache && !rest.includes('--no-cache');
  const r = mergeIn(target, t.branch, {
    message: `forge: integrate ${task}`, task, scope: 'heavy', timeoutSec: config.validatorTimeoutSec, configRoot: wt,
    cacheDir: path.join(io.cwd, '.forge', 'execution'), target: 'run', setup: config.swarm.setup, personal,
    retryDeps: rest.includes('--retry-deps'),
    run: runOptions(config, readEvents(io.cwd), io.now()),
    main: io.cwd, cache: { read: cache, write: cache }, now: io.now, slot: io.slot, branch: e.branch, ...(tip ? { commit: tip } : {}),
  });
  // C4: the events of a plan run's task carry the run's project.
  logValidations(io, task, r.validations, e.kind === 'plan' && isSafeId(e.project) ? e.project : null);
  const es = spanish(locale, io.cwd, e.project);
  const extras = attemptExtras(r, es, t.branch, personal);
  // Neither the target nor its dependencies are ready: the task stays accepted.
  if (r.result === 'dirty') return out({ result: 'run-dirty', detail: r.detail, ...extras });
  if (r.result === 'deps') return out({ result: 'run-deps', detail: r.detail, ...extras });
  // Under the lock, on the execution as it is now: a tick or a swarm task that ran during the merge is kept (I-15).
  updateExecution(io.cwd, cur => {
    if (!cur?.tasks[task]) return null;
    const next: ExecTask = r.result === 'merged'
      ? { ...cur.tasks[task], status: 'integrated', stage: 'integrate', updatedAt: at, detail: null, finishedAt: at, sha: r.sha }
      : { ...cur.tasks[task], status: 'conflict', detail: r.detail, updatedAt: at };
    return { ...cur, tasks: { ...cur.tasks, [task]: next } };
  }, { now: io.now, sleep: io.sleep });
  if (r.result !== 'merged') return out({ result: 'conflict', detail: r.detail, ...extras });
  // Announced here: a later triage must not announce them again.
  if (r.newValidators.length) {
    try { updateLocal(io.cwd, s => ({ ...s, known: [...new Set([...s.known, ...r.newValidators.map(v => v.name)])] })); } catch { /* a later triage announces them again */ }
  }
  // J-15, A-10: the task's state/T write and meta/metrics apart (integratedPublish). The skill adds the summary and the done event.
  const commit = commitInfo(target.git, r.sha);
  const pub = e.kind === 'plan' ? integratedPublish(io, e.project, task, t, commit, at) : { publish: null, metrics: null };
  const say = integratedSay(es, e.branch, r.newValidators, r.preexisting);
  // K2-13, verify.flow phase: the phase this integration finished, so a coordinator running single commands sees it too.
  const planFile = planArg ?? (e.kind === 'plan' ? `docs/waypoint/${e.project}/plan.yaml` : null);
  const phase = planFile ? phaseToVerify(io.cwd, planFile, db ?? null, task) : null;
  return out({
    result: 'integrated', sha: r.sha, commit, ...pub, preexisting: r.preexisting, newValidators: r.newValidators, say,
    ...(r.surfacesChanged.length ? { surfacesChanged: r.surfacesChanged } : {}), ...extras, ...(phase ? { flow: { phase } } : {}),
  });
}

export const subcommand: SwarmCommand = (rest, ctx) => {
  const { io, deps, flag } = ctx;
  return integrate(rest, io, deps, flag('plan'), flag('db'));
};
