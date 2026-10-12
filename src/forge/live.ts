import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeLive, type LiveDoc } from '../lib/execution-state.js';
import { readExecution, saveExecution } from './execution.js';
import { forgeDir } from './ledger.js';
import { mainCheckout } from './local.js';
import { readMember } from './members.js';
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

/**
 * Records this session's local signal when it coordinates an active execution or is a registered member of it; prints nothing and never fails.
 * A SubagentStart while the execution is unbound binds it to this session first; a bound one is never rebound.
 */
export function hookLive(io: Io, forced?: LiveEvent): string {
  try {
    const input = JSON.parse(io.stdin ?? '') as { session_id?: unknown; hook_event_name?: unknown; agent_id?: unknown; agent_type?: unknown };
    const sessionId = typeof input.session_id === 'string' && SAFE.test(input.session_id) ? input.session_id : null;
    const named = (EVENTS as readonly unknown[]).includes(input.hook_event_name) ? input.hook_event_name as LiveEvent : null;
    const event = forced ?? named;
    if (!sessionId || !event) return '';
    const main = mainCheckout(io.cwd);
    let exec = readExecution(main);
    if (!exec?.active) return '';
    // An unbound execution binds to the first session that starts an agent (the Stop hook binds it on a stop).
    if (exec.hookSession === null && event === 'SubagentStart') {
      exec = { ...exec, hookSession: sessionId };
      saveExecution(main, exec);
    }
    const member = exec.hookSession === sessionId ? null : readMember(main, sessionId);
    if (exec.hookSession !== sessionId && (!member || member.runId !== exec.runId)) return '';
    const role: LiveDoc['role'] = member ? member.role : 'coordinator';
    const file = liveFile(main, sessionId);
    let prev: LiveDoc | null = null;
    try { prev = normalizeLive(JSON.parse(readFileSync(file, 'utf8'))); } catch { prev = null; }
    const doc = nextLive(prev, { event, agentId: typeof input.agent_id === 'string' ? input.agent_id : undefined, agentType: typeof input.agent_type === 'string' ? input.agent_type : undefined },
      { sessionId, role, runId: exec.runId, task: member?.task ?? null, now: io.now().toISOString() });
    forgeDir(main);
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    try { writeFileSync(tmp, JSON.stringify(doc)); renameSync(tmp, file); } finally { rmSync(tmp, { force: true }); }
  } catch { /* fail-open */ }
  return '';
}
