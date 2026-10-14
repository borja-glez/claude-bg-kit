export type Launcher = 'bg' | 'herdr';
/** The closed lists for a launched session's `--effort` and `--model`: shell-safe words, so they go unquoted. */
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];
export const MODELS = ['opus', 'sonnet', 'haiku'] as const;
export type Model = (typeof MODELS)[number];
// From docs/superpowers/notes/2026-10-12-herdr-spike.md: null when herdr cannot open a pane from the command line.
export const HERDR_TEMPLATE: string | null = null;
export interface LaunchSpec { name: string; prompt: string; worktree: string; effort?: Effort; model?: Model }
const quote = (s: string) => `'${s.split("'").join(`'\\''`)}'`;
// The flags stay outside the double-quoted prompt.
const flags = (x: LaunchSpec) => `${x.effort ? ` --effort ${x.effort}` : ''}${x.model ? ` --model ${x.model}` : ''}`;
/** A herdr pane command from a template with {name}, {cwd} and {command}. */
export function herdrRun(template: string, x: LaunchSpec): string {
  return template.split('{name}').join(x.name).split('{cwd}').join(quote(x.worktree)).split('{command}').join(`claude --name ${x.name}${flags(x)} "${x.prompt}"`);
}
export function launchRun(launcher: Launcher, x: LaunchSpec): string | null {
  if (launcher === 'bg') return `(cd ${quote(x.worktree)} && claude --bg --name ${x.name}${flags(x)} "${x.prompt}")`;
  if (HERDR_TEMPLATE === null) return null;
  return herdrRun(HERDR_TEMPLATE, x);
}
