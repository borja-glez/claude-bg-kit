import type { SwarmCommand } from './context.js';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { UsageError } from '../errors.js';
import { runWorktree } from '../../execution.js';
import { mergeInFlight } from '../../merging.js';
import { schedule, type BgAgent } from '../../schedule.js';
import { normalizePublicTask, type PublicTask } from '../../../lib/execution-state.js';
import { planOfLoose, statesOfLoose, readLoose } from '../../loose.js';
import { noteOnce, trustOutput, untrustedFor } from '../../trust.js';
import { checkLaunchProject, checkPlanPath, memberLaunch, readTickInput, skippedWarnings, spanish } from './shared.js';

export const subcommand: SwarmCommand = (rest, ctx) => {
  const { io, deps, flag, json, now, iso, current, update } = ctx;
  const e = current();
  if (!e.active) throw new UsageError('swarm tick: the execution is not active');
  // A-19, M4: a --plan or a project that cannot go into a member's launch is refused before the scheduler writes anything.
  if (e.mode === 'sessions') { checkPlanPath('tick', flag('plan')); checkLaunchProject('tick', e.project); }
  // I-03: without the person's trust for the commands of a config this run would use (the main checkout's, the run
  // worktree's, those of the task worktrees not integrated yet), nothing of it runs: the run stalls here, and the
  // first stall over those commands says so (`note`: leave one question note).
  const untrusted = untrustedFor([io.cwd, ...(e.kind === 'plan' ? [runWorktree(io.cwd)] : []),
    ...Object.values(e.tasks).filter(t => t.status !== 'integrated' && t.worktree).map(t => t.worktree)]);
  if (untrusted) {
    const note = noteOnce(io.cwd, untrusted.trust.hash!);
    // Only the run this tick read, still active: one stopped or closed meanwhile stays as it is (K2-02).
    update(cur => (cur?.active && cur.runId === e.runId ? { ...cur, active: false, stopReason: 'stalled', stallReason: 'untrusted-commands', lastStepAt: iso } : null));
    const trust = trustOutput(untrusted.trust, spanish(e.locale ?? null, io.cwd, e.project), untrusted.dir);
    // `running` as any tick counts it: agents already at work go on; the run starts and integrates nothing more.
    return json({ actions: [{ type: 'stalled', reason: 'untrusted-commands', note, trust }], running: Object.values(e.tasks).filter(t => t.status === 'running').length, parallel: e.parallel });
  }
  // An ephemeral run schedules from its own loose.json and execution: no plan, no roadmap.
  const input = e.kind === 'ephemeral'
    ? (() => {
        const loose = readLoose(io.cwd, e.runId);
        if (!loose) throw new UsageError('swarm tick: the ephemeral run has no .forge/loose.json');
        return { plan: planOfLoose(loose.tasks), states: statesOfLoose(e), sessions: {}, integrated: [] as string[], skipped: [] as string[] };
      })()
    : readTickInput(io, deps, e, flag('plan'), flag('db'), 'tick');
  const { plan, states, sessions, integrated, skipped } = input;
  const publicTasks: Record<string, PublicTask> = {};
  try {
    for (const f of readdirSync(path.join(io.cwd, '.forge', 'execution')).filter(n => n.endsWith('.json')).slice(0, 500)) {
      try { const p = normalizePublicTask(JSON.parse(readFileSync(path.join(io.cwd, '.forge', 'execution', f),
        'utf8'))); if (p && `${p.task}.json` === f) publicTasks[p.task] = p; } catch { /* skip */ }
    }
  } catch { /* none yet */ }
  let agents: BgAgent[] | null = null;
  if (flag('agents')) {
    let raw: unknown;
    try { raw = JSON.parse(readFileSync(path.resolve(io.cwd, flag('agents')!), 'utf8')); } catch { throw new UsageError('swarm tick: cannot read --agents'); }
    if (!Array.isArray(raw)) throw new UsageError('swarm tick: --agents must be a JSON array of {name, state}');
    agents = raw.filter((a): a is BgAgent => !!a && typeof a === 'object' && typeof a.name === 'string' && (a.state === 'working' || a.state === 'idle')).slice(0, 100);
  }
  // D-07: an integration is in flight (merging.json, from its baseline to its commit): this tick integrates nothing.
  const merging = mergeInFlight(io.cwd, now.getTime()) !== null;
  // The scheduler decides on the execution as it is under the lock, so a swarm task or an integrate that ran
  // meanwhile is never overwritten (I-15).
  let d!: ReturnType<typeof schedule>;
  update(cur => {
    d = schedule({ plan, states, sessions, exec: cur ?? e, integrated, now: now.getTime(), publicTasks, agents, merging });
    // Wave 0 handoff: an ephemeral run integrates each task into the person's branch as it goes, so the tick that
    // finishes it finds all its work merged already, and no swarm merge will ever close it: it closes here (C2).
    if (d.next.kind === 'ephemeral' && !d.next.active && d.next.stopReason === 'finished' && !d.next.closedAt) d = { ...d, next: { ...d.next, closedAt: iso, closedBy: 'merge' } };
    return d.next;
  });
  // A-19: in sessions mode a start carries the launch of its member's session; the coordinator runs its `run`.
  const planPath = flag('plan');
  const actions = e.mode === 'sessions' && planPath
    ? d.actions.map(a => a.type === 'start' ? { ...a, launch: memberLaunch('tick', io.cwd, planPath, a.task, e) } : a)
    : d.actions;
  const out = json({ actions, running: Object.values(d.next.tasks).filter(t => t.status === 'running').length, parallel: e.parallel });
  // I-14: a listing document that did not read is said on stderr; the exit code stays 0.
  return { ...out, stderr: skippedWarnings(skipped) };
};
