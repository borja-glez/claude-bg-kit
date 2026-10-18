import type { Command } from '../context.js';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { UsageError } from '../errors.js';

// Finds waypoint's CLI from the running forge.cjs: dev layout (plugins/forge, plugins/waypoint) or
// cache layout (<marketplace>/forge/<ver>, <marketplace>/waypoint/<ver>); the highest version wins.
// Caveat: after a downgrade a stale higher-version directory left in the cache could be picked.
export function findWaypointCli(scriptPath: string): string | null {
  const forgeRoot = path.resolve(path.dirname(scriptPath), '..');
  const dev = path.join(forgeRoot, '..', 'waypoint', 'dist', 'waypoint.cjs');
  if (existsSync(dev)) return path.resolve(dev);
  const base = path.join(forgeRoot, '..', '..', 'waypoint');
  let versions: string[] = [];
  try { versions = readdirSync(base); } catch { return null; }
  const key = (v: string) => v.split(/[.+-]/).map(n => (/^\d+$/.test(n) ? Number(n) : 0));
  const cmp = (a: string, b: string) => { const x = key(a), y = key(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d) return d; } return 0; };
  for (const v of versions.sort((a, b) => cmp(b, a))) {
    const f = path.join(base, v, 'dist', 'waypoint.cjs');
    if (existsSync(f)) return path.resolve(f);
  }
  return null;
}

export const command: Command = (args, ctx) => {
  const { io, ok } = ctx;
  const found = findWaypointCli(io.scriptPath ?? process.argv[1] ?? '');
  if (!found) throw new UsageError('waypoint-cli: waypoint.cjs not found next to this forge install; is the waypoint plugin installed?');
  return ok(found);
};
