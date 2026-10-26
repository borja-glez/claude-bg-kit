// The usage meter: what each model loop (the main session, each subagent) spent, from the turn.step responses, and
// the main session's tracking calls (waypoint, forge) estimated by their size. Pure: register.tsx feeds it events.
import { stepCost } from '../lib/prices.js';

export const MAIN = 'main';
export interface UsageLoop {
  kind: string; description: string | null; model: string | null; effort: string | null; steps: number;
  input: number; output: number; cacheRead: number; cacheWrite: number; costUsd: number; unpriced: number;
}
export interface UsageState {
  startedAt: number; loops: Record<string, UsageLoop>;
  // E-08: `reread` counts the tracking that travelled as cached context on each step of the main loop.
  tracking: { waypoint: number; forge: number; reread: number };
  /** E-08: the tracking already gathered when the session was last compacted: it is not re-read after it. */
  rereadBase: number;
  /** w8 M1: the context the main loop's last measured request was answered over, in tokens (memory only). */
  mainContext?: number;
  /** Milliseconds of closed main-agent turns. */
  activeMs: number;
  /** Set by mergeForRun when some session's file had no activeMs (written before it existed). */
  activePartial?: boolean;
  /** E-07: the run's sum counted some session whole (an older lens, or a baseline that did not hold): a bound, not exact. */
  runPartial?: boolean;
}
type StepUsage = {
  input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number; model?: string;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number } | null;
};

const MAX_LOOPS = 200;
/** Where the steps of loops past MAX_LOOPS go, so none is lost. */
export const OVERFLOW = 'overflow';
const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : 0);

export const newUsage = (startedAt: number): UsageState => ({ startedAt, loops: {}, tracking: { waypoint: 0, forge: 0, reread: 0 }, rereadBase: 0, activeMs: 0 });

/**
 * The open main turn and the last moment the session showed life (tool start/end, subagent start/stop, a model request,
 * a turn event). A turn can end with no turn.complete the plugin sees; the next turn.start then closes the dangling
 * one at its last activity, not at now.
 */
export interface TurnClock { since: number | null; lastActivityMs: number }
export const newTurnClock = (): TurnClock => ({ since: null, lastActivityMs: 0 });
export function touchTurn(c: TurnClock, now: number): void {
  if (Number.isFinite(now) && now > c.lastActivityMs) c.lastActivityMs = now;
}
/** turn.start: closes a turn still open at its last activity, then opens the new one. */
export function startTurn(s: UsageState, c: TurnClock, now: number): void {
  if (c.since !== null) closeTurn(s, c.since, c.lastActivityMs);
  c.since = now;
  c.lastActivityMs = now;
}
/** The turn ended (turn.complete, whatever its reason: abort and error included; or the session ended). */
export function endTurn(s: UsageState, c: TurnClock, now: number): void {
  if (c.since !== null) closeTurn(s, c.since, now);
  c.since = null;
}

/** A main-agent turn closed: its length added to the active time (nothing for a turn that ends before it starts). */
export function closeTurn(s: UsageState, since: number, now: number): void {
  if (Number.isFinite(since) && Number.isFinite(now) && now > since) s.activeMs += now - since;
}

export function effortText(effort: string | number | undefined): string | null {
  if (typeof effort === 'string' && effort) return effort;
  if (typeof effort === 'number' && Number.isFinite(effort)) return String(effort);
  return null;
}

function loopOf(s: UsageState, id: string): UsageLoop {
  const found = s.loops[id];
  if (found) return found;
  if (id !== OVERFLOW && Object.keys(s.loops).length >= MAX_LOOPS) return loopOf(s, OVERFLOW);
  const fresh: UsageLoop = { kind: id === MAIN ? 'main' : 'unknown', description: null, model: null, effort: null, steps: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0, unpriced: 0 };
  s.loops[id] = fresh;
  return fresh;
}

/**
 * w8 M1: a main-loop request answered over less than half the context of the one before it, and over at least
 * COMPACT_MIN_DROP fewer tokens, comes after a compaction (or a rewind: either way what was gathered before has left the
 * context). lens has no session.compact hook: cc-plugin-sec-default passes that event over where it is seated. A
 * compaction of a small conversation, which falls by less, is missed, and its tracking keeps counting as re-read.
 */
export const COMPACT_FALL = 0.5;
export const COMPACT_MIN_DROP = 10_000;

export function recordStep(s: UsageState, step: { agentId?: string; model: string; effort?: string | number; usage: StepUsage | null }): void {
  const loop = loopOf(s, step.agentId || MAIN);
  const model = (typeof step.usage?.model === 'string' && step.usage.model) || step.model;
  loop.model = model;
  loop.effort = effortText(step.effort);
  loop.steps += 1;
  const t = step.usage
    ? { input: n(step.usage.input_tokens), output: n(step.usage.output_tokens), cacheRead: n(step.usage.cache_read_input_tokens), cacheWrite: n(step.usage.cache_creation_input_tokens) }
    : null;
  if ((step.agentId || MAIN) === MAIN) {
    const context = t ? t.input + t.cacheRead + t.cacheWrite : 0;
    if (context > 0) {
      const was = s.mainContext;
      if (was !== undefined && context < was * COMPACT_FALL && was - context >= COMPACT_MIN_DROP) compactUsage(s);
      s.mainContext = context;
    }
    // E-08: each step of the main loop re-reads, as cached context, the tracking gathered since the last compaction.
    s.tracking.reread += Math.max(0, s.tracking.waypoint + s.tracking.forge - s.rereadBase);
  }
  if (!step.usage || !t) return;
  loop.input += t.input;
  loop.output += t.output;
  loop.cacheRead += t.cacheRead;
  loop.cacheWrite += t.cacheWrite;
  // Subagents write to the 5-minute cache, which costs less than the main session's 1-hour one.
  const c = stepCost(model, { ...t, cacheWrite5m: n(step.usage.cache_creation?.ephemeral_5m_input_tokens) });
  if (c === null) loop.unpriced += 1;
  else loop.costUsd += c;
}

export function labelLoop(s: UsageState, agentId: string, kind: string, description?: string): void {
  const loop = loopOf(s, agentId);
  if (loop === s.loops[OVERFLOW] && agentId !== OVERFLOW) return;
  loop.kind = kind || 'unknown';
  if (description) loop.description = description.slice(0, 120);
}

const WAYPOINT_CLI = /waypoint\.cjs/;
const FORGE_CLI = /forge\.cjs/;

/** Which plugin a main-session tool call tracks for, or null for real work. */
export function trackingKind(tool: string, input: Record<string, unknown>): 'waypoint' | 'forge' | null {
  if (tool === 'ArtifactData') return 'waypoint';
  if (tool === 'Bash' && typeof input.command === 'string') {
    if (WAYPOINT_CLI.test(input.command)) return 'waypoint';
    if (FORGE_CLI.test(input.command)) return 'forge';
  }
  if (tool === 'Skill' && typeof input.skill === 'string') {
    if (input.skill.startsWith('waypoint:')) return 'waypoint';
    if (input.skill.startsWith('forge:')) return 'forge';
  }
  return null;
}

/** About four characters to a token. */
export function recordTracking(s: UsageState, kind: 'waypoint' | 'forge', chars: number): void {
  s.tracking[kind] += Math.ceil(n(chars) / 4);
}

/** E-08: after a compaction the tracking gathered so far is no longer in context: it is not re-read from then on. */
export function compactUsage(s: UsageState): void {
  s.rereadBase = s.tracking.waypoint + s.tracking.forge;
}
