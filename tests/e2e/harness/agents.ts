// A8: helpers for scenarios that start subagents. A `.e2e.ts` is not imported from another, so they live here.
import { toolNames, toolResults, type Logged, type MessagesRequest, type ReplyBlock } from './messages-server.js';

/** The name of the agent tool the request offers (`Agent` since Claude Code 2.1.x, `Task` before), or null. */
export function agentTool(r: MessagesRequest): string | null {
  return toolNames(r).find(n => n === 'Agent' || n === 'Task') ?? null;
}

/** A tool_use of the agent tool with the fields its input_schema requires. It throws when the request offers none. */
export function agentUse(r: MessagesRequest, id: string, prompt: string, subagentType?: string): ReplyBlock {
  const name = agentTool(r);
  if (!name) throw new Error('e2e: the request offers no agent tool');
  return { type: 'tool_use', id, name, input: { description: 'e2e agent', prompt, subagent_type: subagentType ?? 'general-purpose' } };
}

/** The tool_result of `id` in the first logged request that carries it (the next request of the thread that made the call). */
export function resultOf(log: readonly Logged[], id: string): { is_error: boolean; text: string } | null {
  for (const l of log) {
    if (!l.body) continue;
    const found = toolResults(l.body).find(t => t.tool_use_id === id);
    if (found) return { is_error: found.is_error, text: found.text };
  }
  return null;
}
