import type { SwarmCommand } from './context.js';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { UsageError } from '../errors.js';
import { unmergedEvents } from '../../ledger.js';
import { readExecution } from '../../execution.js';
import { liveJobs, scanJobs, stepLockHeld } from '../../jobs.js';
import { mergeInFlight } from '../../merging.js';
import { isPlanId } from '../../../lib/plan.js';
import { forgeBranches, forgeWorktrees, isForgeBranch, pruneRunState, pruneWork } from '../../cleanup.js';
import { copyTree, evidenceOf } from '../../evidence-copy.js';
import { worktreeHolding } from './shared.js';

export const subcommand: SwarmCommand = (rest, ctx) => {
  const { io, deps, has, json, now } = ctx;
  // D-03, D-18: forge's worktrees and branches already integrated into the branch of the main checkout, and the
  // state of the executions that ended. Never `branch -D`, `worktree remove --force` nor `reset`: what git refuses stays.
  const dryRun = has('dry-run');
  const e = readExecution(io.cwd);
  if (e?.active) throw new UsageError(`swarm cleanup: the execution ${e.runId} is active; stop or close it first`);
  // A worktree removed under a merge, a step or a background command in flight loses their work: none may be running.
  // D-07: swarm merge's and swarm tick's rule: a live attempt's marker, or one still being written.
  const inFlight = mergeInFlight(io.cwd, now.getTime());
  if (inFlight) {
    const m = inFlight.doc;
    throw new UsageError(`swarm cleanup: an integration is merging (.forge/execution/merging.json${m ? `, pid ${m.pid}${m.task ? `, ${m.task}` : ''}` : ''}); run it again once it ends`);
  }
  const job = (dryRun ? scanJobs(io.cwd, now).live : liveJobs(io.cwd, now))[0];
  if (job) throw new UsageError(`swarm cleanup: a background forge command is running (${job.cmd}${job.task ? ` ${job.task}` : ''}, .forge/jobs/${job.name}.json); run it again once it ends`);
  const step = stepLockHeld(io.cwd, now);
  if (step) throw new UsageError(`swarm cleanup: a swarm step is running (.forge/jobs/step.lock${step.pid ? `, pid ${step.pid}` : ''}); run it again once it ends`);
  const head = deps.git(['rev-parse', '--abbrev-ref', 'HEAD'])?.trim() || 'HEAD';
  const merged = (b: string) => deps.git(['merge-base', '--is-ancestor', `refs/heads/${b}`, 'HEAD']) !== null;
  const rel = (p: string) => path.relative(io.cwd, p).split(path.sep).join('/');
  const taskOf = (b: string) => (b.startsWith('task/') && isPlanId(b.slice(5)) ? b.slice(5) : null);
  const removed = { worktrees: [] as string[], branches: [] as string[], files: 0, bytes: 0 };
  const kept: { path?: string; branch?: string; reason: string }[] = [];
  const gone: string[] = [];
  // Final review 5: cleanup holds no lock, so another session's swarm start or swarm retry may make a run active
  // meanwhile; before each removal the execution is read again, and one that became active stops it there.
  const halt = () => {
    const cur = readExecution(io.cwd);
    if (!cur?.active) return;
    const done = [...removed.worktrees, ...removed.branches];
    throw new UsageError(`swarm cleanup: the execution ${cur.runId} became active; run it again once it ends (${done.length ? `already removed: ${done.join(', ')}` : 'nothing was removed'})`);
  };
  // A worktree whose folder is gone (removed by hand) is only git's registration of it: `git worktree prune` drops it
  // first, so its branch is decided below in this same run. Carry 7: the prune is git's, for the whole repository, so
  // it runs only when one of forge's own worktrees (task-* or run, not a waypoint track's) is `prunable`, and `pruned`
  // names every registration it drops. A dry-run reads them as dropped.
  const blocks = (deps.git(['worktree', 'list', '--porcelain']) ?? '').split(/\r?\n\r?\n/);
  const prunable = (b: string) => /^prunable\b/m.test(b);
  const prunes = forgeWorktrees(blocks.filter(prunable).join('\n\n'), io.cwd).some(w => !w.branch?.startsWith('track/'));
  const pruned = prunes ? blocks.filter(prunable).flatMap(b => {
    const at = b.split(/\r?\n/).find(l => l.startsWith('worktree '))?.slice('worktree '.length).trim();
    return at ? [rel(path.resolve(at))] : [];
  }) : [];
  if (prunes && !dryRun) deps.git(['worktree', 'prune']);
  const listed = prunes && !dryRun ? (deps.git(['worktree', 'list', '--porcelain']) ?? '').split(/\r?\n\r?\n/) : blocks;
  const porcelain = listed.filter(b => !(prunes && prunable(b))).join('\n\n');
  const worktrees = forgeWorktrees(porcelain, io.cwd);
  for (const w of worktrees) {
    const where = { path: rel(w.path), ...(w.branch ? { branch: w.branch } : {}) };
    // Final review 4: a waypoint track's worktree (`.claude/worktrees/<track>`) may be named run or task-*: never forge's.
    if (w.branch?.startsWith('track/')) { kept.push({ ...where, reason: "a waypoint track, not forge's" }); continue; }
    // What prune leaves with no folder is locked: git keeps it, and its branch with it.
    if (!existsSync(w.path)) { kept.push({ ...where, reason: 'its folder is gone and git keeps it registered (locked): git worktree unlock it, then run swarm cleanup again' }); continue; }
    if (!w.branch) { kept.push({ ...where, reason: 'detached HEAD' }); continue; }
    if (!merged(w.branch)) { kept.push({ ...where, reason: `not merged into ${head}` }); continue; }
    const status = deps.at(w.path).git(['status', '--porcelain']);
    if (status === null || status.trim()) { kept.push({ ...where, reason: 'has uncommitted changes or untracked files' }); continue; }
    // D-10: events only the worktree's own ledger holds (from before D-10, or from a worktree ledgerRoot does not tell
    // as forge's) would go with it. The main ledger is never rewritten here (its order is the readers'): it stays.
    if (unmergedEvents(w.path, io.cwd).length) { kept.push({ ...where, reason: 'unmerged ledger' }); continue; }
    // Final review 3: the evidence is looked for where keepEvidence puts it; a walk that stopped at its cap cannot
    // tell what it left out, so the worktree stays.
    const evidence = evidenceOf(w.path);
    if (evidence.truncated) { kept.push({ ...where, reason: 'too many files under .forge/work to check its evidence' }); continue; }
    if (!dryRun) {
      // K2-04: the verification a member left in its worktree reaches the main checkout first; what cannot keeps it.
      const { skipped } = copyTree(w.path, io.cwd, evidence.files, { missingOnly: true });
      if (skipped.length) {
        kept.push({ ...where, reason: `its evidence could not be copied to the main checkout (${skipped.length} file${skipped.length === 1 ? '' : 's'}); run swarm cleanup again once it can` });
        continue;
      }
      halt();
      if (deps.git(['worktree', 'remove', w.path]) === null) { kept.push({ ...where, reason: 'git worktree remove refused it' }); continue; }
    }
    removed.worktrees.push(where.path);
    // The run worktree may hold a branch the person named (--branch): only forge's own branches go.
    if (!isForgeBranch(w.branch)) { kept.push({ branch: w.branch, reason: 'not a forge branch (task/* or forge/run-*)' }); continue; }
    if (!dryRun) halt();
    if (!dryRun && deps.git(['branch', '-d', w.branch]) === null) { kept.push({ branch: w.branch, reason: 'git branch -d refused it' }); continue; }
    removed.branches.push(w.branch);
    const t = taskOf(w.branch);
    if (t) gone.push(t);
  }
  const held = new Set(worktrees.map(w => w.branch).filter((b): b is string => !!b));
  const refs = deps.git(['for-each-ref', '--format=%(refname)', 'refs/heads/task', 'refs/heads/forge', 'refs/heads/track']) ?? '';
  for (const b of forgeBranches(refs)) {
    if (held.has(b)) continue;
    if (b === head) { kept.push({ branch: b, reason: 'checked out in the main checkout' }); continue; }
    const holder = worktreeHolding(porcelain, b);
    if (holder) { kept.push({ branch: b, reason: `checked out in ${rel(holder)}` }); continue; }
    if (!merged(b)) { kept.push({ branch: b, reason: `not merged into ${head}` }); continue; }
    if (!dryRun) halt();
    if (!dryRun && deps.git(['branch', '-d', b]) === null) { kept.push({ branch: b, reason: 'git branch -d refused it' }); continue; }
    removed.branches.push(b);
    const t = taskOf(b);
    if (t) gone.push(t);
  }
  // waypoint's tracks are never forge's: they stay, named, each once (its worktree may have named it above).
  for (const l of refs.split(/\r?\n/).map(x => x.trim())) {
    const b = l.slice('refs/heads/'.length);
    if (l.startsWith('refs/heads/track/') && !kept.some(k => k.branch === b)) kept.push({ branch: b, reason: "a waypoint track, not forge's" });
  }
  // The state files of a run that started meanwhile would go with the ended ones'.
  if (!dryRun) halt();
  // D-18: the state of the runs that ended: all of it once the execution is closed; that of earlier runs otherwise.
  const state = pruneRunState(io.cwd, e && !e.closedAt ? e.runId : null, { now: now.getTime(), stale: true, dryRun });
  const work = pruneWork(io.cwd, gone, dryRun);
  removed.files = state.files.length + work.files.length;
  removed.bytes = state.bytes + work.bytes;
  return json({ dryRun, removed, kept, ...(pruned.length ? { pruned } : {}) });
};
