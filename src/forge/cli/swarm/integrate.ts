import type { SwarmCommand, SwarmDeps } from './context.js';
import path from 'node:path';
import { UsageError } from '../errors.js';
import type { Io } from '../run.js';
import { runOptions } from '../../validators.js';
import { readEvents } from '../../ledger.js';
import { readExecution, updateExecution, runWorktree } from '../../execution.js';
import { isSafeId, type ExecTask } from '../../../lib/execution-state.js';
import { isPlanId } from '../../../lib/plan.js';
import { updateLocal } from '../../local.js';
import { integratedSay } from '../../swarm.js';
import { loadTrustedConfig } from '../../trust.js';
import type { Result } from '../context.js';
import { mergeIn, attemptExtras, commitInfo, integratedPublish, logValidations } from './integration.js';
import { localeArg, spanish } from './shared.js';

function integrate(rest: string[], io: Io, deps: SwarmDeps): Result {
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
    main: io.cwd, cache: { read: cache, write: cache }, now: io.now, slot: io.slot, branch: e.branch,
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
  return out({
    result: 'integrated', sha: r.sha, commit, ...pub, preexisting: r.preexisting, newValidators: r.newValidators, say,
    ...(r.surfacesChanged.length ? { surfacesChanged: r.surfacesChanged } : {}), ...extras,
  });
}

export const subcommand: SwarmCommand = (rest, ctx) => {
  const { io, deps } = ctx;
  return integrate(rest, io, deps);
};
