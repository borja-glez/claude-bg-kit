/** The closed lists for a launched session's `--effort` and `--model`: shell-safe words, so they go unquoted. */
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];
export const MODELS = ['opus', 'sonnet', 'haiku'] as const;
export type Model = (typeof MODELS)[number];
export interface LaunchSpec { name: string; prompt: string; worktree: string; effort?: Effort; model?: Model }
const quote = (s: string) => `'${s.split("'").join(`'\\''`)}'`;

/** The `claude --bg` command of a launch: its flags stay outside the double-quoted prompt. */
export function launchCommand(x: Omit<LaunchSpec, 'worktree'>): string {
  return `claude --bg --name ${x.name}${x.effort ? ` --effort ${x.effort}` : ''}${x.model ? ` --model ${x.model}` : ''} "${x.prompt}"`;
}

/**
 * I-18: the one launcher, `claude --bg`, started inside the worktree from any directory without moving the caller's
 * shell (a cd outside a subshell would leave a coordinator working in the worktree). herdr was removed: it could never
 * open a pane from the command line.
 */
export function launchRun(x: LaunchSpec): string {
  return `(cd ${quote(x.worktree)} && ${launchCommand(x)})`;
}
