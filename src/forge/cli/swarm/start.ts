import type { SwarmCommand } from './context.js';
import { existsSync, rmSync } from 'node:fs';
import { UsageError } from '../errors.js';
import { loadConfig } from '../../config.js';
import { stopFile } from '../../run.js';
import { readEvents } from '../../ledger.js';
import { readExecution, updateExecution, runBranch, taskBranch, runWorktree, taskWorktree, runIdOf, isRunIdOf } from '../../execution.js';
import { widthOf } from '../../schedule.js';
import { normalizeExecution, isSafeId, isRunBranch, type ExecutionState } from '../../../lib/execution-state.js';
import { claudeSessionId, noClaudeSession } from '../../../lib/claude-session.js';
import { mainWorktreeFrom, samePath } from '../../../lib/worktree.js';
import { defaultBranchOf, excludeWorktrees } from '../../../lib/git-info.js';
import { isMemberId } from '../../members.js';
import { planOfLoose, writeLoose, readLoose, type LooseTask } from '../../loose.js';
import { startAnnounce } from '../../swarm.js';
// auth's isForgeBranch (any forge/… branch: merging into it needs no answer) is not cleanup's (task/* and forge/run-*).
import { checkMofAuth, isForgeBranch as isForgeTarget, readAuths, useAuth, type MofReason } from '../../auth.js';
import { noteOnce, trustIn, trustOutput } from '../../trust.js';
import { pruneRunState } from '../../cleanup.js';
import { type SetupResult, runSetup, unionLearned, LOCAL_STATE } from './setup.js';
import { ID, worktreeHolding, loadPlanArg, checkPlanProject, loadTasksArg, boundLiveness, boundElsewhere, personLocaleArg, spanish } from './shared.js';

export const subcommand: SwarmCommand = (rest, ctx) => {
  const { io, deps, flag, has, json, now, iso, lockDeps } = ctx;
  const project = flag('project');
  const session = flag('session');
  if (!project || !ID.test(project) || !session || !ID.test(session)) throw new UsageError('swarm start: --project and --session are required');
  // D-08: --plan, the plan the run executes, must be of this project; checked before anything else is read or moves.
  if (has('plan')) {
    const plan = loadPlanArg(io, flag('plan'), 'start');
    checkPlanProject('start', flag('plan')!, plan.project, project);
  }
  // C1: Claude's id of the session that runs the start, checked before any branch or worktree moves. It becomes the
  // execution's hookSession, the one session its Stop hook steps (also on a resume, e.g. after a /clear).
  const hook = claudeSessionId(flag('hook-session'), io.env ?? process.env);
  if (!hook) throw new UsageError(noClaudeSession('swarm start', '--hook-session'));
  // I-03: the run id swarm propose printed (launch.json keeps it), so the start question answered before a /clear is
  // tied to this run. A resume keeps its own.
  const runIdFlag = flag('run-id');
  if (has('run-id') && runIdFlag === undefined) throw new UsageError('swarm start: --run-id needs the run id swarm propose printed');
  const config = loadConfig(io.cwd);
  let parallel = config.swarm.parallel;
  if (has('parallel')) {
    const v = Number(flag('parallel'));
    if (!Number.isInteger(v) || v < 1 || v > 10) throw new UsageError('swarm start: --parallel must be an integer from 1 to 10');
    parallel = v;
  }
  const kind = flag('kind') ?? 'plan';
  if (kind !== 'plan' && kind !== 'ephemeral') throw new UsageError('swarm start: --kind must be plan or ephemeral');
  if (kind === 'ephemeral' && flag('mode') === 'sessions') throw new UsageError('swarm start: an ephemeral run is always subagents (sessions need a plan)');
  // swarm.mode in the config chooses for plan runs only: an ephemeral run has no plan to launch sessions on.
  const mode = kind === 'ephemeral' ? (flag('mode') ?? 'subagents') : (flag('mode') ?? config.swarm.mode ?? 'subagents');
  if (mode !== 'subagents' && mode !== 'sessions') throw new UsageError('swarm start: --mode must be subagents or sessions');
  if (has('autonomy') && flag('autonomy') !== 'auto' && flag('autonomy') !== 'ask') throw new UsageError('swarm start: --autonomy must be auto or ask');
  const auto = flag('autonomy') === 'auto' ? { autonomy: 'auto' as const } : {};
  const locale = personLocaleArg(rest);
  // I-03: a run runs the config's commands (swarm.setup, the validators). Without the person's trust for them nothing
  // moves: exit 3 with `trust`, whose question the coordinator asks before it starts again.
  const trust = trustIn(io.cwd, config);
  if (trust.state === 'ask' || trust.state === 'changed') {
    const out = { started: false, trust: trustOutput(trust, spanish(locale, io.cwd, project), io.cwd, noteOnce(io.cwd, trust.hash!)) };
    return { code: 3, stdout: `${JSON.stringify(out, null, 2)}\n`, stderr: '' };
  }
  const base = deps.git(['rev-parse', '--abbrev-ref', 'HEAD'])?.trim();
  if (!base || base === 'HEAD') throw new UsageError('swarm start: the main checkout must be on a branch');
  const prev = readExecution(io.cwd);
  // D-14: a start never changes the coordinator of an active execution; taking it over is swarm takeover's call.
  if (prev?.active && prev.coordinator !== session) throw new UsageError(
    `swarm start: the execution ${prev.runId} is coordinated by ${prev.coordinator}; to go on with it from this session run ` +
    `swarm takeover --session ${session} --hook-session <id> (it checks that ${prev.coordinator} stopped), or join it as a manual member (/forge:run --join)`);
  const branch = flag('branch') ?? runBranch(project);
  if (!isRunBranch(branch)) throw new UsageError('swarm start: --branch is not a valid branch name');
  // execution.json is read back through the safe id rules: refuse here, before any branch or worktree exists.
  if (!isMemberId(session)) throw new UsageError('swarm start: --session must use letters, digits, _ - . (at most 120)');
  if (!isSafeId(runIdOf(project, now))) throw new UsageError('swarm start: --project must use letters, digits, _ - .');
  if (kind === 'ephemeral' && !isRunBranch(base)) throw new UsageError(`swarm start: the base branch ${base} is outside the run branch rule (letters, digits, _ - . /)`);
  let setup: SetupResult = null;
  let baseSync: 'created' | 'up-to-date' | 'fast-forward' | 'merged' | null = null;
  const resume = !!prev && prev.active && prev.kind === kind && prev.project === project && prev.branch === (kind === 'plan' ? branch : base);
  let loose: LooseTask[] = [];
  let ignoredTasks = false;
  const moves: string[] = [];
  // Even from its own coordinator, of either kind: a new run would overwrite the execution.json of the run in progress.
  if (prev?.active && !resume) {
    throw new UsageError(`swarm start: the execution ${prev.runId} is active (kind ${prev.kind}); finish it or stop it (forge stop) first; a request during it goes to that run`);
  }
  // Wave 0 handoff: a resume from another Claude session rebinds only once the bound one stopped, by takeover's
  // rule; while it may still step its run, a silent rebind would leave two sessions stepping it. `claude --resume`
  // goes on under the same id, so it needs no rebind.
  if (resume && prev && prev.hookSession !== null && prev.hookSession !== hook) {
    const liveness = boundLiveness(io.cwd, prev, now.getTime());
    if (liveness !== 'stopped') throw new UsageError(boundElsewhere('start', prev.runId, prev.hookSession, liveness));
  }
  // Checked before any branch or worktree moves. Only the id swarm propose prints for this project, exactly
  // (<project>-<stamp>: another project's never matches, whatever its name), and only one no run has used: the run of
  // execution.json, a run an authorization names (a merge question, or a yes it used) or the ledger's events name has
  // started, and taking its id would take its answers and mix its events with this run's.
  if (runIdFlag !== undefined && !resume) {
    if (!isRunIdOf(project, runIdFlag)) throw new UsageError(`swarm start: --run-id must be the run id swarm propose printed for ${project} (${project}-<stamp>)`);
    const started = runIdFlag === prev?.runId || readAuths(io.cwd).some(r => r.runId === runIdFlag && (r.kind === 'merge' || r.usedAt !== undefined))
      || readEvents(io.cwd).some(ev => ev.runId === runIdFlag);
    if (started) throw new UsageError(`swarm start: --run-id ${runIdFlag} is the id of a run that already started `
      + `(execution.json, an authorization or the ledger names it); run swarm propose again for a new id`);
  }
  const runId = runIdFlag !== undefined && !resume ? runIdFlag : runIdOf(project, now);
  if (kind === 'ephemeral') {
    if (resume && prev) {
      // The run keeps the batch it started with: new requests go to the next run.
      const doc = readLoose(io.cwd, prev.runId);
      if (!doc) throw new UsageError('swarm start: the ephemeral run lost .forge/loose.json');
      loose = doc.tasks;
      ignoredTasks = has('tasks');
    } else {
      loose = loadTasksArg(io, flag('tasks'), 'start');
      // Loose ids repeat between runs: a leftover worktree or a branch with unmerged work is refused, all checks
      // before anything moves.
      for (const t of loose) {
        const dir = taskWorktree(io.cwd, t.id);
        // Final review 8: an earlier run's integrated task worktree goes with swarm cleanup.
        if (existsSync(dir)) throw new UsageError(`swarm start: ${dir} already exists; once its task is integrated, FORGE swarm cleanup removes it (else git worktree remove it), or use another id`);
        const tb = taskBranch(t.id);
        if (deps.git(['rev-parse', '--verify', '-q', `refs/heads/${tb}`]) === null) continue;
        if (deps.git(['merge-base', '--is-ancestor', tb, base]) === null) throw new UsageError(`swarm start: ${tb} has work not on ${base}; use another id`);
        moves.push(tb);
      }
    }
    if (!has('parallel')) parallel = Math.min(parallel, Math.max(1, widthOf(planOfLoose(loose))));
  }
  if (kind === 'plan') {
    const wt = runWorktree(io.cwd);
    // The run branch gets its own worktree: it can be neither the base (checked out here) nor a branch
    // another worktree holds, or `git worktree add` refuses it.
    if (branch === base) throw new UsageError(`swarm start: ${branch} is the base branch (checked out in the main checkout); `
      + `the run branch must be another one (omit --branch for ${runBranch(project)})`);
    const defaultBranch = defaultBranchOf(deps.git);
    if (defaultBranch && branch === defaultBranch) throw new UsageError(`swarm start: ${branch} is the default branch; an execution never integrates into it directly`);
    const holder = worktreeHolding(deps.git(['worktree', 'list', '--porcelain']), branch);
    if (holder && !samePath(holder, wt)) throw new UsageError(`swarm start: ${branch} is checked out in another worktree (${holder}); pick another --branch`);
    if (existsSync(wt)) {
      const on = deps.at(wt).git(['rev-parse', '--abbrev-ref', 'HEAD'])?.trim();
      if (on !== branch) throw new UsageError(`swarm start: ${wt} exists and is on ${on ?? '?'}, not ${branch}; switch it or remove it (git worktree remove)`);
    }
    const existed = deps.git(['rev-parse', '--verify', '-q', `refs/heads/${branch}`]) !== null;
    if (!existed && deps.git(['branch', branch, base]) === null) {
      throw new UsageError(`swarm start: cannot create ${branch} from ${base}`);
    }
    // A-08: the run and task worktrees never show as untracked, also without a .gitignore entry for them. Asked at
    // the main checkout, as addTaskWorktree does: the ignore rules are read from where git runs.
    const mainDir = mainWorktreeFrom(deps.git(['worktree', 'list', '--porcelain']));
    excludeWorktrees(mainDir ? args => deps.git(['-C', mainDir, ...args]) : deps.git);
    if (!existsSync(wt)) {
      if (deps.git(['worktree', 'add', wt, branch]) === null) throw new UsageError(`swarm start: cannot add the worktree ${wt}`);
      setup = runSetup(deps, wt, io.cwd);
    }
    // A run branch left by an earlier execution is brought up to its base before planning; a conflict is
    // refused (never a second run branch) and nothing is removed.
    if (!existed) baseSync = 'created';
    else if (!resume) {
      const at = deps.at(wt);
      // Read before any merge: once a merge stops on a conflict, the worktree always looks dirty.
      const status = at.git(['status', '--porcelain', '--', '.', ...LOCAL_STATE]);
      const dirty = status === null || status.trim() !== '';
      const dirtyMsg = `swarm start: the run worktree ${wt} has uncommitted changes; commit or clean them before ${branch} is brought up to ${base}`;
      if (deps.git(['merge-base', '--is-ancestor', base, branch]) !== null) baseSync = 'up-to-date';
      else if (deps.git(['merge-base', '--is-ancestor', branch, base]) !== null) {
        if (at.git(['merge', '--ff-only', base]) === null) throw new UsageError(dirty ? dirtyMsg : `swarm start: cannot fast-forward ${branch} to ${base}`);
        baseSync = 'fast-forward';
      } else if (at.git(['merge', '--no-ff', base, '-m', `forge: bring ${base} into ${branch}`]) !== null) baseSync = 'merged';
      else {
        at.git(['merge', '--abort']);
        // A refused merge in a dirty worktree is not a conflict: say what blocks it.
        if (dirty) throw new UsageError(dirtyMsg);
        throw new UsageError(`swarm start: ${branch} has diverged from ${base} and they conflict; merge them by hand or remove ${branch}`);
      }
    }
  }
  // The person's language (--locale): a resume keeps the recorded one unless a new flag is given.
  const lang = locale ? { locale } : {};
  // I-03: --merge-on-finish needs the person's yes to the start question, recorded by the hook `answer`: tied to this
  // run id or, asked before the run existed (auto mode at launch), to this session and project for 24 hours. A plan
  // run whose base is forge's own needs none; an ephemeral run never takes it (it makes no final merge). Without it
  // the run starts with mergeOnFinish false and says why. A resume asks about its own run and its own base (the
  // branch it merges into), not the branch the checkout is on now. Checked here, after every git step, and spent at
  // once (a launch yes is tied to this run then): a yes that cannot be marked used starts no run with it, so it never
  // sets two runs' mergeOnFinish.
  const mergeInto = resume && prev ? prev.base : base;
  const mofAsked = kind === 'plan' && has('merge-on-finish') && !(resume && prev?.mergeOnFinish);
  let mof = mofAsked && isForgeTarget(mergeInto);
  let mergeRefused: MofReason | null = null;
  let mergeNote: string | null = null;
  if (mofAsked && !isForgeTarget(mergeInto)) {
    const mofRun = resume && prev ? prev.runId : runId;
    const v = checkMofAuth(readAuths(io.cwd), { runId: mofRun, target: mergeInto, session: hook, project: resume && prev ? prev.project : project, now: io.now().getTime() });
    if (!v.ok) { mergeRefused = v.reason; mergeNote = v.note ?? null; } else {
      try { useAuth(io.cwd, v.record, iso, mofRun); } catch (err) {
        throw new Error(`swarm start: the yes ${v.record.authId} to the start question could not be marked used (${err instanceof Error ? err.message : String(err)}); `
          + `execution.json was not written, run swarm start again`);
      }
      mof = true;
    }
  }
  const state: ExecutionState = resume && prev
    ? { ...prev, parallel, mode, mergeOnFinish: prev.mergeOnFinish || mof, coordinator: session, hookSession: hook, sleepUntil: null, ...auto, ...lang }
    : {
        runId, kind, mode, parallel, project, base, branch: kind === 'plan' ? branch : base,
        mergeOnFinish: mof, coordinator: session, hookSession: hook, active: true, stopReason: null, stallReason: null,
        startedAt: iso, lastStepAt: null, lastBlockStep: null, sleepUntil: null, tasks: {}, closedAt: null, closedBy: null, ...auto, ...lang,
      };
  // An execution that would not read back (an id outside the safe rule) is refused rather than saved.
  if (!normalizeExecution(state)) throw new UsageError('swarm start: --project, --session and the run branch must use letters, digits, _ - . (and / in the branch), at most 120 characters');
  // A task branch already merged into the base is deleted (an ancestor of it: nothing is lost); `swarm worktree`
  // creates it again from the tip of the run's branch when its turn comes, so it sees the work integrated since.
  for (const tb of moves) {
    if (deps.git(['branch', '-d', tb]) === null) throw new UsageError(`swarm start: cannot delete ${tb}; `
      + `if a worktree still holds it, run git worktree prune or remove that worktree (git worktree remove)`);
  }
  // Learned notes two tasks append to the same surface are merged by git's union driver, never left as a conflict.
  const attributes = unionLearned(deps);
  // C2: a new run over an ended one that nobody closed replaces it; say which (execution.json keeps one run).
  const replaced = prev && !prev.active && !prev.closedAt && !resume ? { runId: prev.runId, stopReason: prev.stopReason } : null;
  rmSync(stopFile(io.cwd), { force: true });
  // A resume keeps what changed meanwhile and takes only this start's fields.
  updateExecution(io.cwd, cur => (resume && cur && cur.runId === state.runId
    ? { ...cur, parallel: state.parallel, mode: state.mode, mergeOnFinish: state.mergeOnFinish, coordinator: state.coordinator, hookSession: state.hookSession, sleepUntil: null, ...auto, ...lang }
    : state), lockDeps);
  if (kind === 'ephemeral' && !resume) writeLoose(io.cwd, { runId: state.runId, tasks: loose });
  // K5-08: a new run starts clean: the public task files, members and live signals of earlier runs go (a resume keeps
  // its own).
  if (!resume) pruneRunState(io.cwd, state.runId, { now: now.getTime(), stale: false, dryRun: false });
  const looseOut = kind === 'ephemeral'
    ? { loose: loose.length, ...(ignoredTasks ? { ignoredTasks: true,
      message: `the ephemeral run ${state.runId} is resumed with its own ${loose.length} tasks; --tasks was ignored (start a new run for new requests once this one ends)` } : {}) }
    : {};
  const announce = startAnnounce({
    es: spanish(state.locale ?? null, io.cwd, project), kind, resume, runId: state.runId, mode: state.mode, parallel: state.parallel,
    branch: state.branch, base: state.base, mergeOnFinish: state.mergeOnFinish, loose: loose.length, setup, mergeRefused, mergeNote,
  });
  return json({ ...state, setup, baseSync, ...looseOut, announce, ...attributes, ...(replaced ? { replaced } : {}), ...(mergeRefused ? { mergeRefused } : {}) });
};
