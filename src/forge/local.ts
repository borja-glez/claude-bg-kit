// .forge/local.yaml: what forge knows about this machine (surface permissions, validators already announced,
// drafts already proposed). Ignored by git; read leniently, written atomically, unknown keys kept.
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { NAME } from './config.js';
import { forgeDir } from './ledger.js';

// A permission is tied to the surface's content (its hash, see surfaces.ts): a changed surface asks again.
export interface SurfacePermission { state: 'allowed' | 'denied'; hash: string | null }
export interface LocalState { surfaces: Record<string, SurfacePermission>; known: string[]; proposed: string[]; [key: string]: unknown }

export const localFile = (root: string) => path.join(root, '.forge', 'local.yaml');

const names = (x: unknown): string[] =>
  Array.isArray(x) ? [...new Set(x.filter((s): s is string => typeof s === 'string' && NAME.test(s)))] : [];

export function readLocal(root: string): LocalState {
  let raw: unknown = null;
  try { raw = parse(readFileSync(localFile(root), 'utf8')); } catch { raw = null; }
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const surfaces: LocalState['surfaces'] = {};
  if (o.surfaces && typeof o.surfaces === 'object' && !Array.isArray(o.surfaces)) {
    for (const [k, v] of Object.entries(o.surfaces)) {
      if (!NAME.test(k) || !v || typeof v !== 'object' || Array.isArray(v)) continue;
      const p = v as Record<string, unknown>;
      if (p.state === 'allowed' || p.state === 'denied') surfaces[k] = { state: p.state, hash: typeof p.hash === 'string' ? p.hash : null };
    }
  }
  return { ...o, surfaces, known: names(o.known), proposed: names(o.proposed) };
}

export function writeLocal(root: string, s: LocalState): void {
  forgeDir(root);
  const file = localFile(root);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, stringify(s));
  renameSync(tmp, file);
}

export function updateLocal(root: string, fn: (s: LocalState) => LocalState): LocalState {
  const next = fn(readLocal(root));
  writeLocal(root, next);
  return next;
}
