import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { FORGE_DOC_MAX_BYTES, isSafeId, LIVE_STOPPED_MINUTES, normalizeLive, type ExecutionState, type LiveDoc } from '../lib/execution-state.js';
import { coordinatorGone, lastMovedAt, type CoordinatorActivity } from '../lib/execution-view.js';
import { describeViewer } from '../lib/viewer-role.js';
import { claudeBindings } from '../lib/bound-fs.js';
import { endReasonOf } from '../lib/bound.js';
import { readExecution } from './execution.js';
import { liveJobs } from './jobs.js';
import { forgeDir } from './ledger.js';
import { mainCheckout } from './local.js';
import { memberForHook } from './members.js';
import { parseRun, readRunText } from './run.js';
import { endRoute, reopenRoute } from './route.js';
import { planLocale, sessionReply } from '../lib/locale.js';
import type { Io } from './cli/run.js';

export const liveFile = (main: string, sessionId: string) => path.join(main, '.forge', 'live', `${sessionId}.json`);
export type LiveEvent = 'SessionStart' | 'SessionEnd' | 'SubagentStart' | 'SubagentStop' | 'Stop';
const EVENTS: readonly LiveEvent[] = ['SessionStart', 'SessionEnd', 'SubagentStart', 'SubagentStop', 'Stop'];
const AGENT_STALE_MS = 3 * 3600000;
const SAFE =/^[A-Za-z0-9_\-.]{1,120}$/;

export function nextLive(prev: LiveDoc | null, ev: { event: LiveEvent; agentId?: string; agentType?: string },
  ctx: { sessionId: string; role: LiveDoc['role']; runId: string | null; task: string | null; now: string }): LiveDoc {
  let agents = prev?.agents ?? [];
  if (ev.event === 'SubagentStart' && ev.agentId) agents = [...agents.filter(a => a.id !== ev.agentId), { id: ev.agentId, type: ev.agentType ?? '', since: ctx.now }].slice(-20);
  if (ev.event === 'SubagentStop' && ev.agentId) agents = agents.filter(a => a.id !== ev.agentId);
  if (ev.event === 'SessionEnd') agents = [];
  const cutoff = Date.parse(ctx.now) - AGENT_STALE_MS;
  agents = agents.filter(a => { const t = Date.parse(a.since); return !Number.isFinite(t) || t >= cutoff; });
  const ended = ev.event === 'SessionEnd' ? true : ev.event === 'SessionStart' ? false : prev?.ended ?? false;
  return { sessionId: ctx.sessionId, role: ctx.role, runId: ctx.runId, task: ctx.task, event: ev.event, ts: ctx.now, agents, ended };
}

/** Writes a live signal file whole (a reader never sees half of one). */
function writeLive(main: string, file: string, doc: LiveDoc): void {
  forgeDir(main);
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try { writeFileSync(tmp, JSON.stringify(doc)); renameSync(tmp, file); } finally { rmSync(tmp, { force: true }); }
}

/**
 * R7 (I2): the bound session `sessionId` acts on run `e` again (swarm retry of its own run), so its conversation did not
 * end: an ended signal of its own is renewed as a start, and coordinatorLiveness stops reading it as gone. Never throws.
 */
export function clearEnded(main: string, e: ExecutionState, sessionId: string, now: Date): void {
  try {
    if (!isSafeId(sessionId)) return;
    const file = liveFile(main, sessionId);
    const prev = normalizeLive(JSON.parse(readFileSync(file, 'utf8')));
    if (!prev?.ended || prev.sessionId !== sessionId) return;
    writeLive(main, file, nextLive(prev, { event: 'SessionStart' }, { sessionId, role: prev.role, runId: e.runId, task: prev.task, now: now.toISOString() }));
  } catch { /* no signal to clear */ }
}

/** How long ago, in a SessionStart text: minutes under an hour, hours after. */
function agoText(ms: number): string {
  return ms < 3600_000 ? `${Math.max(1, Math.round(ms / 60_000))} min` : `${Math.round(ms / 3600_000)} h`;
}

const readCapped = (file: string, max: number): string | null => {
  try { return statSync(file).size > max ? null : readFileSync(file, 'utf8'); } catch { return null; }
};

/**
 * What the run band's rule (coordinatorLiveness, coordinatorGone) reads of run `e`'s coordinator on forge's side: the
 * one gathering of `swarm takeover`, `swarm start` resuming and the live hook. Its own signal
 * (.forge/live/<hookSession>.json, read up to FORGE_DOC_MAX_BYTES as waypoint's hooks read it); the bindings of its
 * Claude session in every project, any via, settled by their pid (a crashed conversation's binding has ended); and
 * whether its session runs a background job (.forge/jobs/, C-03), which only forge can tell. A hook id outside the safe
 * rule names no file: no signal and no activity.
 */
export function coordinatorInputs(main: string, e: ExecutionState, now: number): { signal: LiveDoc | null; activity: CoordinatorActivity } {
  const hook = isSafeId(e.hookSession) ? e.hookSession : null;
  if (hook === null) return { signal: null, activity: { busy: false, bindings: [] } };
  let signal: LiveDoc | null = null;
  try { signal = normalizeLive(JSON.parse(readCapped(liveFile(main, hook), FORGE_DOC_MAX_BYTES) ?? 'null')); } catch { signal = null; }
  const busy = liveJobs(main, new Date(now)).some(j => j.session === hook);
  return { signal, activity: { busy, bindings: claudeBindings(main, hook, now) } };
}

/**
 * B-09, M4: run `e` lost its coordinator. An active run no session is bound to (`hookSession` null, `unbound`) has none,
 * as `swarm start` and `swarm takeover` of its coordinator's SID treat it. A bound one by the rule the run band and
 * `swarm takeover` decide with (coordinatorGone, over coordinatorInputs): its own signal ended, or, active, it has been
 * silent for LIVE_STOPPED_MINUTES with no agent it started still running, no live binding of its own and no background
 * job of its session. A read that fails counts as a coordinator still there: it never costs a member its signal.
 */
function lostCoordinator(main: string, e: ExecutionState, now: number): boolean {
  if (e.active && e.hookSession === null) return true;
  try {
    const { signal, activity } = coordinatorInputs(main, e, now);
    return coordinatorGone(e, signal, now, activity);
  } catch { return false; }
}

/**
 * B-09: what a session that does not drive the execution is told at its start (English: the model reads it): a fact,
 * and a way only if the person asks; never "continue". With the execution still active (it lost its coordinator: its
 * conversation ended or went silent, or no session is bound to it) /forge:stop stops it; inactive, it closes it (C2).
 */
export function notOwnerText(e: ExecutionState, role: 'other-live' | 'previous', now: number): string {
  if (role === 'other-live') {
    const running = Object.values(e.tasks).filter(t => t.status === 'running').length;
    return `forge: execution ${e.runId} is running (${e.mode}, ${running}/${e.parallel} running), coordinated by another session. This session is not part of it.`;
  }
  const integrated = Object.values(e.tasks).filter(t => t.status === 'integrated').length;
  const total = Math.max(e.planned ?? 0, Object.keys(e.tasks).length);
  const moved = Date.parse(lastMovedAt(e));
  const when = Number.isFinite(moved) ? `${agoText(Math.max(0, now - moved))} ago` : 'a while ago';
  const why = e.hookSession === null ? 'no session is bound to it' : `its conversation ended, or it has been silent for ${LIVE_STOPPED_MINUTES} min or more`;
  const what = e.active ? `lost its coordinator (${why}) and last moved` : `stopped (${e.stopReason ?? 'stopped'})`;
  return `forge: execution ${e.runId} ${what} ${when}, with ${integrated}/${total} tasks integrated, and is not closed. This session does not coordinate it. If the user asks, /forge:run --resume ${e.active ? 'takes it over' : 'takes it up'} and /forge:stop ${e.active ? 'stops' : 'closes'} it; otherwise it stays as it is.`;
}

/**
 * forge's live hook; never fails. A route it cannot write never costs the signal below: on SessionEnd this session's
 * route records how its conversation ended, and on a SessionStart the same session starting again is live (K1-13).
 * Then, by the role of this session (B-09, describeViewer): the coordinator of an active execution, or a registered
 * member of its run, records its local signal and, on a SessionStart (not forced), gets the text to resume it; any other
 * session gets, on a SessionStart only, one line that says what runs or was left, and never writes a signal. The
 * execution is bound when it starts (C1): nothing here binds it.
 */
export function hookLive(io: Io, forced?: LiveEvent): string {
  try {
    const input = JSON.parse(io.stdin ?? '') as { session_id?: unknown; hook_event_name?: unknown; agent_id?: unknown; agent_type?: unknown; reason?: unknown };
    const sessionId = typeof input.session_id === 'string' && SAFE.test(input.session_id) ? input.session_id : null;
    const named = (EVENTS as readonly unknown[]).includes(input.hook_event_name) ? input.hook_event_name as LiveEvent : null;
    const event = forced ?? named;
    if (!sessionId || !event) return '';
    const main = mainCheckout(io.cwd);
    // K1-13: this session's route records how its conversation ended, whatever forge does with an execution.
    if (event === 'SessionEnd' && !forced) {
      const reason = endReasonOf(input.reason);
      try { endRoute(main, sessionId, reason === 'released' ? 'other' : reason, io.now().toISOString()); } catch { /* the route is a reminder */ }
    }
    // K1-13: the same session starting again (claude --resume keeps its id) is live: its route is no longer ended.
    const starting = event === 'SessionStart' && !forced;
    if (starting) {
      try { reopenRoute(main, sessionId); } catch { /* the route is a reminder */ }
    }
    const exec = readExecution(main);
    if (!exec) return '';
    const now = io.now().getTime();
    // Whether the run lost its coordinator (rule 4 or 5) only matters to what another session is told at its start: the
    // coordinator's files are read then, not on every agent or Stop event.
    const coordinatorEnded = starting && exec.hookSession !== sessionId && lostCoordinator(main, exec, now);
    // A registered member of this run is found by its hook id (Claude's session_id), recorded at join; the hook id is not
    // its waypoint SID (memberForHook, the rule describeViewer applies to the members it is given).
    const found = memberForHook(main, sessionId, exec.runId);
    const viewer = describeViewer({ bound: [], execution: exec, members: found ? [found] : [], sessionId, now, coordinatorEnded });
    if (viewer.subject !== 'execution' || viewer.role !== 'owner') {
      // B-09: a session that does not drive the execution writes no signal; at its start it is told what runs or was left.
      if (!starting) return '';
      const role = viewer.subject === 'execution' ? viewer.role : 'none';
      if (role !== 'other-live' && role !== 'previous') return '';
      return JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: notOwnerText(exec, role, now) } });
    }
    // The coordinator, or a member of its run: its signal and its resume text, while the execution is active.
    const member = viewer.coordinator ? null : viewer.member;
    const role: LiveDoc['role'] = member ? member.role : 'coordinator';
    // A member's signal is keyed by its waypoint SID, the `by` of its public task; the coordinator's by its hook id.
    const signalId = member ? member.sessionId : sessionId;
    const file = liveFile(main, signalId);
    let prev: LiveDoc | null = null;
    try { prev = normalizeLive(JSON.parse(readFileSync(file, 'utf8'))); } catch { prev = null; }
    if (!exec.active) {
      // R4 (M4): the coordinator's conversation ending (SessionEnd, e.g. /clear) is recorded for an ended run that is not
      // closed too: its own ended signal tells swarm retry and /forge:run --resume at once that it is no longer on the
      // run. R7 (I2): its mirror: that same conversation back (SessionStart, claude --resume) clears it, so it never
      // outlives the bound session's return.
      const bound = viewer.coordinator && exec.hookSession === sessionId && !exec.closedAt;
      if (!bound || !(event === 'SessionEnd' || (event === 'SessionStart' && prev?.ended === true))) return '';
    }
    writeLive(main, file, nextLive(prev, { event, agentId: typeof input.agent_id === 'string' ? input.agent_id : undefined, agentType: typeof input.agent_type === 'string' ? input.agent_type : undefined },
      { sessionId: signalId, role, runId: exec.runId, task: member?.task ?? null, now: io.now().toISOString() }));
    // The resume text is for a run that is active; an ended one is taken up with /forge:run --resume.
    if (starting && exec.active) {
      const running = Object.values(exec.tasks).filter(t => t.status === 'running').length;
      const text = role === 'coordinator'
        ? `forge: this session coordinates the execution ${exec.runId} (${exec.mode}, ${running}/${exec.parallel} running, run branch ${exec.branch}). Resume it with /forge:run → Resume: renew your lease, reconcile each task and keep stepping.`
        : `forge: this session is the ${role} session of ${member?.task ?? 'a task'} in the execution ${exec.runId} coordinated by ${exec.coordinator}. Resume it with /forge:member: rejoin with FORGE swarm join, renew your lease and continue from your last reported stage.`;
      // A resumed session reads this first: it repeats the language to answer in, when one is known.
      const run = parseRun(readRunText(main));
      const project = exec.project;
      const reply = sessionReply(run?.active ? run : null, exec, () => planLocale(main, project)) ?? '';
      return JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text + reply } });
    }
  } catch { /* fail-open */ }
  return '';
}
