import type { Command } from '../context.js';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { UsageError } from '../errors.js';
import { compareVersions, installedPlugins, claudeConfigDir } from '../../superpowers.js';
import { mainCheckout } from '../../local.js';
import { samePath } from '../../../lib/worktree.js';

const marketplaceOf = (key: string) => key.slice(key.indexOf('@') + 1);

/**
 * I-18: waypoint's CLI for the running forge.cjs, in this order: the dev layout (plugins/forge next to plugins/waypoint,
 * which only a checkout of this repository has); with `opts`, the installPath installed_plugins.json gives waypoint for
 * this project (what Claude Code loads): M7, the entry of forge's own marketplace first (`forge@<m>` installed where
 * this forge runs gives `waypoint@<m>`, as does the cache layout's `<m>/forge/<ver>`), then the highest version; and
 * last the cache layout (<marketplace>/forge/<ver> next to <marketplace>/waypoint/<ver>), the highest version, for an
 * install that file lacks.
 */
export function findWaypointCli(scriptPath: string, opts?: { configDir: string; projectDir: string }): string | null {
  const forgeRoot = path.resolve(path.dirname(scriptPath), '..');
  const dev = path.join(forgeRoot, '..', 'waypoint', 'dist', 'waypoint.cjs');
  if (existsSync(dev)) return path.resolve(dev);
  if (opts) {
    const plugins = installedPlugins(opts, name => name === 'waypoint' || name === 'forge');
    const own = new Set(plugins.filter(p => p.name === 'forge' && samePath(p.installPath, forgeRoot)).map(p => marketplaceOf(p.key)));
    if (path.basename(path.dirname(forgeRoot)) === 'forge') own.add(path.basename(path.resolve(forgeRoot, '..', '..')));
    const installed = plugins.filter(p => p.name === 'waypoint')
      .map(p => ({ own: own.has(marketplaceOf(p.key)), version: p.version, file: path.join(p.installPath, 'dist', 'waypoint.cjs') }))
      .filter(p => existsSync(p.file))
      .sort((a, b) => Number(b.own) - Number(a.own) || compareVersions(b.version, a.version));
    if (installed.length) return path.resolve(installed[0].file);
  }
  const base = path.join(forgeRoot, '..', '..', 'waypoint');
  let versions: string[] = [];
  try { versions = readdirSync(base); } catch { return null; }
  for (const v of versions.sort((a, b) => compareVersions(b, a))) {
    const f = path.join(base, v, 'dist', 'waypoint.cjs');
    if (existsSync(f)) return path.resolve(f);
  }
  return null;
}

export const command: Command = (args, ctx) => {
  const { io, ok } = ctx;
  const found = findWaypointCli(io.scriptPath ?? process.argv[1] ?? '', { configDir: claudeConfigDir(io.env ?? process.env), projectDir: mainCheckout(io.cwd) });
  if (!found) throw new UsageError('waypoint-cli: waypoint.cjs not found next to this forge install; is the waypoint plugin installed?');
  return ok(found);
};
