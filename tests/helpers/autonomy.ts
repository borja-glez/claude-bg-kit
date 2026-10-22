import path from 'node:path';
import type { GuardCtx, GuardInput } from '../../src/forge/guard.js';
import type { AutonomousCtx } from '../../src/forge/autonomous.js';

export const MAIN = path.resolve('/repo');
export const WT = path.join(MAIN, '.claude', 'worktrees', 'spike-x');
export const TMP = path.resolve('/tmp/forge-spike-x');
export const AUTO: AutonomousCtx = {
  runId: 'spike-x', main: MAIN, worktree: WT, roots: [WT, TMP], tmp: TMP, branch: 'forge/spike-x', protectedBranches: ['main'],
  branches: ['forge/spike-x', 'forge/run-x', 'task/T001'], resources: [],
};
export const CTX: GuardCtx = { main: MAIN, gitCommonDir: path.join(MAIN, '.git'), autonomous: AUTO };
export const ATTENDED: GuardCtx = { ...CTX, autonomous: null };
export const withAuto = (over: Partial<AutonomousCtx>): GuardCtx => ({ ...CTX, autonomous: { ...AUTO, ...over } });
/** A path as a Bash command spells it on every platform: bash drops unquoted backslashes, so forward slashes (B2). */
export const sh = (p: string): string => p.split(path.sep).join('/');
export const bash = (command: string, cwd = WT): GuardInput => ({ tool_name: 'Bash', tool_input: { command }, session_id: 'coord-1', cwd });
export const pwsh = (command: string, cwd = WT): GuardInput => ({ tool_name: 'PowerShell', tool_input: { command }, session_id: 'coord-1', cwd });
/** it.each rows: the command, which names the test, and its input. */
export const B = (command: string, cwd = WT): [string, GuardInput] => [command, bash(command, cwd)];
export const P = (command: string, cwd = WT): [string, GuardInput] => [`pwsh: ${command}`, pwsh(command, cwd)];
export const edit = (file_path: string): GuardInput => ({ tool_name: 'Edit', tool_input: { file_path, old_string: 'a', new_string: 'b' }, session_id: 'coord-1', cwd: WT });
export const mcp = (tool_name: string, tool_input: Record<string, unknown> = {}): GuardInput => ({ tool_name, tool_input, session_id: 'coord-1', cwd: WT });
