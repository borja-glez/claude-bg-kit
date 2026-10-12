// The usage meter: what each model loop (the main session, each subagent) spent, from the turn.step responses, and
// the main session's tracking calls (waypoint, forge) estimated by their size. Pure: register.tsx feeds it events.
import { stepCost } from '../lib/prices.js';

export const MAIN = 'main';
export interface UsageLoop {
  kind: string; description: string | null; model: string | null; effort: string | null; steps: number;
  input: number; output: number; cacheRead: number; cacheWrite: number; costUsd: number; unpriced: number;
}
export interface UsageState { startedAt: number; loops: Record<string, UsageLoop>; tracking: { waypoint: number; forge: number } }
type StepUsage = {
  input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number; model?: string;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number } | null;
};

const MAX_LOOPS = 200;
/** Where the steps of loops past MAX_LOOPS go, so none is lost. */
export const OVERFLOW = 'overflow';
const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : 0);

export const newUsage = (startedAt: number): UsageState => ({ startedAt, loops: {}, tracking: { waypoint: 0, forge: 0 } });

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

export function recordStep(s: UsageState, step: { agentId?: string; model: string; effort?: string | number; usage: StepUsage | null }): void {
  const loop = loopOf(s, step.agentId || MAIN);
  const model = (typeof step.usage?.model === 'string' && step.usage.model) || step.model;
  loop.model = model;
  loop.effort = effortText(step.effort);
  loop.steps += 1;
  if (!step.usage) return;
  const t = { input: n(step.usage.input_tokens), output: n(step.usage.output_tokens), cacheRead: n(step.usage.cache_read_input_tokens), cacheWrite: n(step.usage.cache_creation_input_tokens) };
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
