// w7 integration (A4 R16): what the PreToolUse fast path of Read, Grep and Glob (dist/guard-read.cjs) needs, and
// nothing else, so that its bundle stays a few KB: hooks.json starts it on every Read, Grep and Glob of every session,
// where `forge.cjs hook guard` would load the whole CLI to print nothing. guard-secrets.ts re-exports both names.
// It imports nothing: whatever it imported would be bundled into guard-read.cjs.

/** The tools guard B judges by their paths that never fail closed, and that pass at once outside a forge agent. */
export const READ_TOOLS: readonly string[] = ['Read', 'Grep', 'Glob'];

/** A forge agent: agent_type is a string that starts with 'forge' (forge:forge-impl, or forge-impl loaded without its prefix). */
export function isForgeAgent(agentType: unknown): agentType is string {
  return typeof agentType === 'string' && agentType.startsWith('forge');
}

/**
 * Whether `hook guard` would print nothing for this hook input without building its context: stdin that does not
 * parse as a JSON object (hookGuard fails open for these tools), or a READ_TOOLS call outside a forge agent. False
 * hands the input to `hook guard`: a forge agent's call, or any other tool (only a matcher out of step sends one here).
 */
export function readPassesAtOnce(stdin: string): boolean {
  let input: unknown;
  try { input = JSON.parse(stdin); } catch { return true; }
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return true;
  const { tool_name, agent_type } = input as { tool_name?: unknown; agent_type?: unknown };
  return typeof tool_name === 'string' && READ_TOOLS.includes(tool_name) && !isForgeAgent(agent_type);
}
