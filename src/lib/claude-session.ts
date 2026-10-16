import { isSafeId } from './execution-state.js';

/** The environment claudeSessionId reads: process.env in the CLIs, a plain object in the tests. */
export type SessionEnv = Readonly<Record<string, string | undefined>>;

/**
 * C1: Claude's id of the session that runs a command. The flag when isSafeId accepts it (an unsubstituted
 * `${CLAUDE_SESSION_ID}` or an empty value does not) and it does not start with "-" (an empty substitution leaves the
 * next flag there, e.g. `--claude --sessions …`), else CLAUDE_CODE_SESSION_ID of env when valid, else null.
 */
export function claudeSessionId(flag?: string | null, env: SessionEnv = process.env): string | null {
  if (isSafeId(flag) && !flag.startsWith('-')) return flag;
  const v = env.CLAUDE_CODE_SESSION_ID;
  return isSafeId(v) ? v : null;
}

/** The code-2 message of a command that binds something to the session and got no usable id. */
export const noClaudeSession = (cmd: string, flagName: string): string =>
  `${cmd}: no Claude session id: pass ${flagName} <id> or run it from Claude Code (CLAUDE_CODE_SESSION_ID)`;
