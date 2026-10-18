import type { Command } from '../context.js';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { appendEvent, forgeDir } from '../../ledger.js';
import { parseRun, endRun, readRunText, saveRun, stopFile } from '../../run.js';
import { readExecution, updateExecution, executionTaskFile, writePublicTask } from '../../execution.js';
import { isSafeId, normalizePublicTask, type PublicTask } from '../../../lib/execution-state.js';
import { samePath } from '../../../lib/worktree.js';
import { releaseWrites } from '../swarm.js';
import { mainCheckout } from '../../local.js';
import { allMembersOf, memberFile } from '../../members.js';
import { liveJobs } from '../../jobs.js';
import { runRootOf } from '../shared.js';

export const command: Command = (args, ctx) => {
  const { io, json, ts } = ctx;
  // K2-01: forge's run and execution are the main checkout's, wherever this runs from.
  const main = mainCheckout(io.cwd);
  const runRoot = runRootOf(io.cwd);
  const at = ts();
  // The stop file stays so the bound session, if alive, exits cleanly; the run is closed here so a dead
  // session never keeps it active.
  for (const dir of samePath(main, runRoot) ? [main] : [main, runRoot]) { forgeDir(dir); writeFileSync(stopFile(dir), `${at}\n`); }
  const current = parseRun(readRunText(runRoot));
  if (current?.active) {
    saveRun(runRoot, endRun(current, 'stopped'));
    appendEvent(runRoot, { ts: at, kind: 'cycle', action: 'stopped', reason: 'stopped' });
  }
  // K2-02: an active execution stops for real. Its running tasks become stopped, keeping executor, branch and
  // worktree for swarm close; their public files expire now; their forge status ends with the phase stopped;
  // its members are listed and their files removed. forge stop never closes it: /forge:stop runs swarm close.
  let stopped: string[] = [];
  const after = readExecution(main)?.active ? updateExecution(main, cur => {
    if (!cur?.active) return null;
    stopped = Object.entries(cur.tasks).filter(([, t]) => t.status === 'running').map(([id]) => id);
    const tasks = { ...cur.tasks };
    for (const id of stopped) tasks[id] = { ...tasks[id], status: 'stopped', agent: null, detail: 'stopped by forge stop', updatedAt: at };
    return { ...cur, tasks, active: false, stopReason: 'stopped', sleepUntil: null };
  }, { now: io.now, sleep: io.sleep }) : null;
  let release: { task: string; write: { op: 'update'; collection: 'state'; doc_id: string; data: Record<string, unknown> } }[] = [];
  let members: { sessionId: string; name: string | null; role: string; task: string | null }[] = [];
  // The Claude sessions of this run: the coordinator's (the execution's hook session), its members' and the
  // infinite run's.
  const own = new Set<string>();
  const ofRun = after ?? readExecution(main);
  if (ofRun?.hookSession) own.add(ofRun.hookSession);
  if (current?.sessionId) own.add(current.sessionId);
  if (after) {
    for (const id of stopped) {
      let p: PublicTask | null = null;
      try { p = normalizePublicTask(JSON.parse(readFileSync(executionTaskFile(main, id), 'utf8'))); } catch { p = null; }
      if (p && p.task === id && p.runId === after.runId) writePublicTask(main, { ...p, status: 'stopped', agent: null, updatedAt: at, leaseUntil: at });
      // C4: the execution is no longer active, so the stamp would not name its run: the phase names it, and the
      // project of a plan run's task.
      appendEvent(main, { ts: at, kind: 'phase', task: id, phase: 'stopped', runId: after.runId, ...(after.kind === 'plan' && isSafeId(after.project) ? { project: after.project } : {}) });
    }
    // Every member of the run, not only those the role readers see: each is messaged, its file goes, its jobs are named.
    const listed = allMembersOf(main, after.runId);
    members = listed.map(m => ({ sessionId: m.sessionId, name: m.name, role: m.role, task: m.task }));
    for (const m of listed) { if (m.hookSession) own.add(m.hookSession); rmSync(memberFile(main, m.sessionId), { force: true }); }
    // A-23: the coordinator's own tasks go back to free on the roadmap (releaseWrites, the same writes swarm close prints).
    release = releaseWrites(after, stopped);
  }
  // forge stop kills nothing: a background job of this run (a swarm step, an integrate, a validate…: one of its
  // sessions', or one with no session) still running finishes its current step. They are named so the person knows
  // what is still at work; another conversation's jobs are not this run's.
  const running = liveJobs(main, io.now()).filter(j => j.session === null || own.has(j.session)).map(j => ({ name: j.name, task: j.task }));
  return json({ main, run: { stopped: !!current?.active }, execution: after ? { runId: after.runId, stopped } : null, release, members, running });
};
