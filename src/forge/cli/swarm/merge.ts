import type { SwarmCommand, SwarmDeps } from './context.js';
import path from 'node:path';
import { UsageError } from '../errors.js';
import type { Io } from '../run.js';
import { runOptions } from '../../validators.js';
import { readEvents } from '../../ledger.js';
import { readExecution, updateExecution, runWorktree, type LockDeps } from '../../execution.js';
import { mergeInFlight } from '../../merging.js';
import type { ExecutionState } from '../../../lib/execution-state.js';
import { claudeSessionId } from '../../../lib/claude-session.js';
// auth's isForgeBranch (any forge/… branch: merging into it needs no answer) is not cleanup's (task/* and forge/run-*).
import { checkMergeAuth, isForgeBranch as isForgeTarget, mergeAsk, pendingAuth, readAuths, useAuth, writeAuth, type AuthRecord } from '../../auth.js';
import { loadTrustedConfig } from '../../trust.js';
import { commitOf } from '../../receipts.js';
import { publishFor, type StateWrite } from '../../roadmap-sources.js';
import { finalVerdictOf } from '../../roadmap-run.js';
import type { Result } from '../context.js';
import { type MergeOpts, mergeIn, cleanRunWorktree, attemptExtras } from './integration.js';
import { localeArg, spanish, closeEnded } from './shared.js';

/** J-15, G-06: once the run branch is merged into its base, the forge block of every integrated task again (merged: true). */
function mergedPublish(io: Io, e: ExecutionState): { publish: StateWrite[]; publishErrors?: string[] } {
  const publish: StateWrite[] = [];
  const errors: string[] = [];
  const docIo = { ...io, events: readEvents(io.cwd) };
  for (const [task, t] of Object.entries(readExecution(io.cwd)?.tasks ?? e.tasks)) {
    if (t.status !== 'integrated') continue;
    const p = publishFor(docIo, task, { project: e.project, only: ['forge'] });
    if (p.publish) publish.push(p.publish);
    else if (p.publishError) errors.push(`${task}: ${p.publishError}`);
  }
  return { publish, ...(errors.length ? { publishErrors: errors } : {}) };
}

function mergeFinal(rest: string[], io: Io, deps: SwarmDeps): Result {
  const e = readExecution(io.cwd);
  if (!e) throw new UsageError('swarm merge: no execution (forge swarm start)');
  const locale = localeArg(rest, 'merge');
  const out = (v: unknown): Result => ({ code: 0, stdout: JSON.stringify(v) + '\n', stderr: '' });
  // C2: a merged run that already ended is over: closed, so lens, the band and the roadmap stop drawing it.
  const merged = (v: Record<string, unknown>): Result => out({ ...v, ...(closeEnded(io.cwd, io.now().toISOString(), 'merge', { now: io.now, sleep: io.sleep }) ? { closed: true } : {}) });
  if (e.kind !== 'plan') return merged({ result: 'merged', sha: deps.git(['rev-parse', 'HEAD'])?.trim() ?? '' });
  // D-07: never while an integration is in flight, wherever it merges; its merging.json stays as it is. A result, as
  // main-dirty is: the coordinator waits for it and runs swarm merge again.
  const inFlight = mergeInFlight(io.cwd, io.now().getTime());
  if (inFlight) {
    const m = inFlight.doc;
    return out({ result: 'busy', detail: `${m ? `an integration (${m.task ?? m.ref}, pid ${m.pid}) is merging in ${m.dir}` : 'an integration is starting'}; run swarm merge again once it ends` });
  }
  // A3: the commit the run branch has now is the one merged, whatever lands on it while the validators run.
  const tip = commitOf(deps.git, `refs/heads/${e.branch}`);
  // I-03: a merge into a branch that is not forge's needs a permission of the person's, recorded by the hook `answer` from
  // their AskUserQuestion answer (--yes alone is none), and each permission allows one merge:
  // - their yes to the start question (mergeOnFinish) allows the one final merge of this run once it finished (inactive,
  //   `finished`, not closed) and its final review accepted it; while the run is active, stopped or closed, or its final
  //   review has not accepted the run as it is, the merge asks as any other does;
  // - their yes to this merge's question, from the session that merges (C1's: the flag wins over
  //   CLAUDE_CODE_SESSION_ID), less than an hour old, whose question named this run branch and this base.
  const es = spanish(locale, io.cwd, e.project);
  const hookAt = rest.indexOf('--hook-session');
  const session = claudeSessionId(hookAt >= 0 ? rest[hookAt + 1] : null, io.env ?? process.env);
  const ask = () => pendingAuth(io.cwd, {
    kind: 'merge', runId: e.runId, target: e.base, session, now: io.now(), rand: io.rand ?? Math.random,
    build: id => mergeAsk(id, e.branch, e.base, es),
  });
  // A yes is bound to the branches its question named: its record carries this merge's question, in either language.
  const named = (r: AuthRecord) => [true, false].some(sp => mergeAsk(r.authId, e.branch, e.base, sp).ask.question === r.question);
  const check = (): ReturnType<typeof checkMergeAuth> => {
    const v = checkMergeAuth(readAuths(io.cwd), { runId: e.runId, target: e.base, session, now: io.now().getTime() });
    return v.ok && !named(v.record) ? { ok: false, reason: 'other branch' } : v;
  };
  const needsYes = (v: { reason: string; note?: string }): Result => out({ result: 'needs-authorization', reason: v.reason, ...(v.note ? { note: v.note } : {}), ...ask() });
  /** The question path: without --yes the question; with it the yes recorded for it, or why not. */
  const askYes = (): Result | AuthRecord => {
    if (!rest.includes('--yes')) return out({ result: 'needs-authorization', ...ask() });
    const v = check();
    return v.ok ? v.record : needsYes(v);
  };
  const events = readEvents(io.cwd);
  // The start question's promise: «when everything is done and the final review passes». The run's final review last
  // said `accept` (fix and redo do not), and no task was integrated into the run branch after that verdict.
  const reviewed = (x: ExecutionState): boolean => {
    const v = finalVerdictOf(events, x);
    const at = v?.action === 'accept' ? Date.parse(v.ts) : NaN;
    if (Number.isNaN(at)) return false;
    return Object.values(x.tasks).every(t => t.status !== 'integrated' || !t.finishedAt || !(Date.parse(t.finishedAt) > at));
  };
  const finishedRun = (x: ExecutionState | null): x is ExecutionState =>
    !!x && x.runId === e.runId && x.mergeOnFinish && !x.active && x.stopReason === 'finished' && !x.closedAt && reviewed(x);
  const asks = !isForgeTarget(e.base);
  const onFinish = asks && finishedRun(e);
  let auth: AuthRecord | null = null;
  if (asks && !onFinish) {
    const a = askYes();
    if ('code' in a) return a;
    auth = a;
  }
  const branch = deps.git(['rev-parse', '--abbrev-ref', 'HEAD'])?.trim();
  if (branch !== e.base) return out({ result: 'main-dirty', detail: `the main checkout is on ${branch ?? '?'}, not ${e.base}` });
  // I-03: before any permission is spent: without the person's trust in the commands, exit 2 with nothing merged.
  const config = loadTrustedConfig(io.cwd);
  const runAt = cleanRunWorktree(deps, runWorktree(io.cwd), e.branch);
  const opts: MergeOpts = {
    message: `forge: merge ${e.branch}`, scope: 'final', timeoutSec: config.validatorTimeoutSec, configRoot: io.cwd,
    cacheDir: path.join(io.cwd, '.forge', 'execution'), target: 'main', setup: config.swarm.setup,
    runAt: runAt && tip && runAt.git(['rev-parse', 'HEAD'])?.trim() === tip ? runAt : null,
    personal: true, retryDeps: rest.includes('--retry-deps'),
    run: runOptions(config, events, io.now()),
    main: io.cwd, cache: { read: false, write: config.validate.cache }, now: io.now, slot: io.slot, branch: e.base, ...(tip ? { commit: tip } : {}),
  };
  // I-03: the permission is spent before the merge, the one step that cannot be undone, so none ever allows two merges.
  // Each is checked again and spent while this process holds the execution's lock, which another merge of the run takes
  // to spend its own: mergeOnFinish goes false, the merge yes gets usedAt. One that cannot be checked and spent merges
  // nothing. A merge that ends otherwise (main-dirty, main-deps, conflict) with the base's HEAD where it was gives it
  // back; a give-back that fails, a base that moved, or a merge that throws leaves it spent (the next swarm merge asks).
  const lockDeps: LockDeps = { now: io.now, sleep: io.sleep };
  const locked = <T>(fn: () => T): T => {
    const box: { v?: T } = {};
    updateExecution(io.cwd, () => { box.v = fn(); return null; }, lockDeps);
    return box.v as T;
  };
  const failed = (err: unknown) => (err instanceof Error ? err.message : String(err));
  let finishSpent = false;
  if (onFinish) {
    try {
      finishSpent = updateExecution(io.cwd, cur => (finishedRun(cur) ? { ...cur, mergeOnFinish: false } : null), lockDeps) !== null;
    } catch (err) {
      throw new Error(`swarm merge: nothing was merged: the merge on finish could not be checked and claimed (${failed(err)}); run swarm merge again`);
    }
    // The run changed since it was read (another merge claimed it, or it was resumed): the question path.
    if (!finishSpent) {
      const a = askYes();
      if ('code' in a) return a;
      auth = a;
    }
  }
  const usedAt = io.now().toISOString();
  if (auth) {
    const asked = auth.authId;
    let v: ReturnType<typeof checkMergeAuth>;
    try {
      v = locked(() => {
        const again = check();
        if (again.ok) useAuth(io.cwd, again.record, usedAt);
        return again;
      });
    } catch (err) {
      throw new Error(`swarm merge: nothing was merged: the yes ${asked} could not be checked and marked used (${failed(err)}); run swarm merge --yes again`);
    }
    if (!v.ok) return needsYes(v);
    auth = v.record;
  }
  const headOf = () => deps.git(['rev-parse', 'HEAD'])?.trim() || null;
  const headBefore = headOf();
  const r = mergeIn(deps, e.branch, opts);
  const given = auth;
  if (r.result !== 'merged' && headBefore !== null && headOf() === headBefore) {
    if (finishSpent) {
      try {
        updateExecution(io.cwd, cur => (cur && cur.runId === e.runId && !cur.mergeOnFinish && !cur.active && cur.stopReason === 'finished' && !cur.closedAt
          ? { ...cur, mergeOnFinish: true } : null), lockDeps);
      } catch { /* it stays spent: the next swarm merge asks the merge question */ }
    }
    if (given) {
      try {
        locked(() => {
          const cur = readAuths(io.cwd).find(x => x.authId === given.authId && !x.unreadable);
          if (cur?.usedAt === usedAt) writeAuth(io.cwd, given);
        });
      } catch { /* it stays used: the next swarm merge asks again */ }
    }
  } else if (r.result === 'merged' && given) {
    // Marked used again, in case a give-back from a lock section that was taken over (past its stale time) undid it.
    try {
      locked(() => {
        const cur = readAuths(io.cwd).find(x => x.authId === given.authId && !x.unreadable);
        if (cur && !cur.usedAt) useAuth(io.cwd, cur, usedAt);
      });
    } catch { /* best effort: it was marked used before the merge */ }
  }
  const extras = attemptExtras(r, es, e.branch, true);
  if (r.result === 'dirty') return out({ result: 'main-dirty', detail: `the main checkout ${r.detail}`, ...extras });
  if (r.result === 'deps') return out({ result: 'main-deps', detail: `the main checkout ${r.detail}`, ...extras });
  return r.result === 'merged' ? merged({ result: 'merged', sha: r.sha, preexisting: r.preexisting, ...extras, ...mergedPublish(io, e) }) : out({ result: 'conflict', detail: r.detail, ...extras });
}

export const subcommand: SwarmCommand = (rest, ctx) => {
  const { io, deps } = ctx;
  return mergeFinal(rest, io, deps);
};
