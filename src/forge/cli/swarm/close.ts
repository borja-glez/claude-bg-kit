import type { SwarmCommand } from './context.js';
import { rmSync } from 'node:fs';
import { UsageError } from '../errors.js';
import type { Io } from '../run.js';
import { readExecution } from '../../execution.js';
import { mainCheckout } from '../../local.js';
import { allMembersOf, memberFile } from '../../members.js';
import { roadmapRun } from '../../roadmap-run.js';
import { releaseWrites, openTasks, closeEnded } from './shared.js';

/** G-07: the summary of the run swarm close just closed, for /forge:stop to publish; runsError when it cannot be built. */
function runsOf(io: Io, runId: string): Record<string, unknown> {
  try {
    const { doc: _doc, ...runs } = roadmapRun({ cwd: io.cwd, now: io.now }, { run: runId });
    return { runs };
  } catch (e) { return { runsError: (e instanceof Error ? e.message : String(e)).slice(0, 300) }; }
}

export const subcommand: SwarmCommand = (rest, ctx) => {
  const { io, json, iso, lockDeps } = ctx;
  // C2: closes an ended execution of the main checkout, from any worktree. It never touches git, worktrees,
  // branches or live/: /forge:stop releases the tasks it lists and publishes meta/run. K2-02: like forge stop, it
  // removes the member files of the run and lists them in `sessions`, so /forge:stop messages a stalled run's members
  // too; after forge stop there are none left.
  const main = mainCheckout(io.cwd);
  const e = readExecution(main);
  if (!e) throw new UsageError('swarm close: no execution');
  if (e.active) throw new UsageError(`swarm close: the execution ${e.runId} is active; stop it first (/forge:stop)`);
  if (e.closedAt) return json({ closed: 'already', runId: e.runId, closedAt: e.closedAt, closedBy: e.closedBy ?? null });
  closeEnded(main, iso, 'close', lockDeps);
  // K2-02: forge stop leaves the tasks it stopped as stopped: they are released like running ones.
  const open = openTasks(e).map(id => [id, e.tasks[id]] as const);
  // Every member of the run, not only those the role readers see: each is listed to message and its file goes.
  const sessions = allMembersOf(main, e.runId).map(m => ({ sessionId: m.sessionId, name: m.name, role: m.role, task: m.task }));
  // C4: the summary and its cleanup read the member files, so they are built before those files go.
  const runs = runsOf(io, e.runId);
  for (const m of sessions) rmSync(memberFile(main, m.sessionId), { force: true });
  return json({
    closed: true, runId: e.runId, kind: e.kind, stopReason: e.stopReason, closedAt: iso,
    // The coordinator's own tasks go back to free on the roadmap, as printed writes (carry 10); a member's task stays
    // with its session. A loose task has no state/T to free, so an ephemeral run releases nothing.
    release: releaseWrites(e, open.map(([id]) => id)),
    members: open.filter(([, t]) => t.executor !== 'subagents').map(([id]) => id),
    sessions,
    ...runs,
  });
};
