// The plugins Claude Code gives a project, read from its files: installed_plugins.json and the enabledPlugins of the
// settings. forge reads it to find waypoint and superpowers, and waypoint's handoff to find forge and superpowers.
// Reads only; fail-open: anything missing or unreadable means not installed.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/** Claude Code's configuration directory: CLAUDE_CONFIG_DIR, else ~/.claude. */
export function claudeConfigDir(env: Record<string, string | undefined> = process.env): string {
  return env.CLAUDE_CONFIG_DIR?.trim() || path.join(homedir(), '.claude');
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const readJson = (file: string): unknown => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };
const samePath = (a: string, b: string): boolean => {
  const x = path.resolve(a);
  const y = path.resolve(b);
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
};

/** The enabledPlugins maps of the settings files, most specific first: the project's local, the project's, the user's. */
function enabledMaps(configDir: string, projectDir: string): Record<string, unknown>[] {
  return [path.join(projectDir, '.claude', 'settings.local.json'), path.join(projectDir, '.claude', 'settings.json'), path.join(configDir, 'settings.json')]
    .map(readJson).flatMap(s => (isObj(s) && isObj(s.enabledPlugins) ? [s.enabledPlugins] : []));
}

/** enabledPlugins[key] from the most specific settings file that names it; on by default. */
const enabled = (key: string, maps: Record<string, unknown>[]): boolean => {
  const m = maps.find(ep => typeof ep[key] === 'boolean');
  return m ? (m[key] as boolean) : true;
};

export interface InstalledPlugin { key: string; name: string; installPath: string; version: string }

/**
 * The plugins this project gets from installed_plugins.json: entries `<name>@<marketplace>` whose installPath exists,
 * installed for the user (or for this project: scope project/local with this projectPath) and not turned off in
 * enabledPlugins. `only` filters by name before anything else is read. Fail-open: none.
 */
export function installedPlugins(opts: { configDir: string; projectDir: string }, only?: (name: string) => boolean): InstalledPlugin[] {
  try {
    const file = readJson(path.join(opts.configDir, 'plugins', 'installed_plugins.json'));
    const plugins = isObj(file) && isObj(file.plugins) ? file.plugins : null;
    if (!plugins) return [];
    let maps: Record<string, unknown>[] | null = null;
    const out: InstalledPlugin[] = [];
    for (const [key, value] of Object.entries(plugins)) {
      const m = /^([^@\s]+)@[^@\s]+$/.exec(key);
      if (!m || (only && !only(m[1])) || !enabled(key, maps ??= enabledMaps(opts.configDir, opts.projectDir))) continue;
      for (const e of Array.isArray(value) ? value : [value]) {
        if (!isObj(e) || typeof e.installPath !== 'string' || !existsSync(e.installPath)) continue;
        const scope = typeof e.scope === 'string' ? e.scope : 'user';
        if (scope !== 'user' && scope !== 'managed' && !(typeof e.projectPath === 'string' && samePath(e.projectPath, opts.projectDir))) continue;
        out.push({ key, name: m[1], installPath: e.installPath, version: typeof e.version === 'string' && e.version ? e.version : 'unknown' });
      }
    }
    return out;
  } catch { return []; }
}
