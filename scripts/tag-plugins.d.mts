export const PLUGINS: readonly string[];
export function tagCommands(argv: string[]): { cmds: string[][] } | { error: string };
