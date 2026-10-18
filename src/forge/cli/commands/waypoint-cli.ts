import type { Command } from '../context.js';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { UsageError } from '../errors.js';
import { installedPlugins, claudeConfigDir } from '../../superpowers.js';
import { mainCheckout } from '../../local.js';

/**
 * I-18: waypoint's CLI for the running forge.cjs, in this order: the dev layout (plugins/forge next to plugins/waypoint,
 * which only a checkout of this repository has); with `opts`, the installPath installed_plugins.json gives waypoint for
 * this project (what Claude Code loads; the highest version when several entries apply); and last the cache layout
 * (<marketplace>/forge/<ver> next to <marketplace>/waypoint/<ver>), the highest version, for an install that file lacks.
 */
export function findWaypointCli(scriptPath: string, opts?: { configDir: string; projectDir: string }): string | null {
  const forgeRoot = path.resolve(path.dirname(scriptPath), '..');
  const dev = path.join(forgeRoot, '..', 'waypoint', 'dist', 'waypoint.cjs');
  if (existsSync(dev)) return path.resolve(dev);
  const key = (v: string) => v.split(/[.+-]/).map(n => (/^\d+$/.test(n) ? Number(n) : 0));
  const cmp = (a: string, b: string) => {
    const x = key(a), y = key(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d) return d; }
    return 0;
  };
  if (opts) {
    const installed = installedPlugins(opts, name => name === 'waypoint')
      .map(p => ({ version: p.version, file: path.join(p.installPath, 'dist', 'waypoint.cjs') }))
      .filter(p => existsSync(p.file))
      .sort((a, b) => cmp(b.version, a.version));
    if (installed.length) return path.resolve(installed[0].file);
  }
  const base = path.join(forgeRoot, '..', '..', 'waypoint');
  let versions: string[] = [];
  try { versions = readdirSync(base); } catch { return null; }
  for (const v of versions.sort((a, b) => cmp(b, a))) {
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
