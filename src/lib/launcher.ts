export type Launcher = 'bg' | 'herdr';
// From docs/superpowers/notes/2026-10-12-herdr-spike.md: null when herdr cannot open a pane from the command line.
export const HERDR_TEMPLATE: string | null = null;
const quote = (s: string) => `'${s.split("'").join(`'\\''`)}'`;
export function launchRun(launcher: Launcher, x: { name: string; prompt: string; worktree: string }): string | null {
  if (launcher === 'bg') return `(cd ${quote(x.worktree)} && claude --bg --name ${x.name} "${x.prompt}")`;
  if (HERDR_TEMPLATE === null) return null;
  return HERDR_TEMPLATE.split('{name}').join(x.name).split('{cwd}').join(quote(x.worktree)).split('{command}').join(`claude --name ${x.name} "${x.prompt}"`);
}
