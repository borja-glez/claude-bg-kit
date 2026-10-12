import type { EngineInterface } from 'claude-code';
import { buildBandModel, pickProject, type BandFiles, type BandModel, type ProjectEntry } from './model.js';

export type Engine = EngineInterface;

export const MAX_DOCS = 500;
const TITLE_MAX = 40;

export const join = (...parts: string[]) => parts.join('/');

export async function readOpt($: Engine, path: string): Promise<string | undefined> {
  try { return await $.fs.read(path); } catch { return undefined; }
}

export async function listOpt($: Engine, path: string): Promise<Awaited<ReturnType<Engine['fs']['list']>>> {
  try { return await $.fs.list(path); } catch { return []; }
}

// null when the file is missing.
export async function mtime($: Engine, path: string): Promise<number | null> {
  try { return (await $.fs.stat(path)).mtimeMs; } catch { return null; }
}

export async function nowMs($: Engine): Promise<number> {
  try {
    const n = await $.clock.now();
    if (Number.isFinite(n)) return n;
  } catch { /* fall back below */ }
  return Date.now();
}

export async function readCollection($: Engine, dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const files = (await listOpt($, dir)).filter(f => f.kind === 'file' && f.name.endsWith('.json')).slice(0, MAX_DOCS);
  for (const f of files) {
    const text = await readOpt($, join(dir, f.name));
    if (text !== undefined) out[f.name.slice(0, -5)] = text;
  }
  return out;
}

export function clip(text: string, max = TITLE_MAX): string {
  const chars = Array.from(String(text).replace(/\s+/g, ' ').trim());
  return chars.length <= max ? chars.join('') : chars.slice(0, max - 1).join('') + '…';
}

// As the hooks do: only a folder holding plan.yaml or design.md is a project.
async function projectEntries($: Engine, root: string): Promise<ProjectEntry[]> {
  const docs = join(root, 'docs', 'waypoint');
  const dirs = (await listOpt($, docs)).filter(d => d.kind === 'dir');
  const entries: ProjectEntry[] = [];
  for (const d of dirs) {
    const times = [await mtime($, join(docs, d.name, 'plan.yaml')), await mtime($, join(docs, d.name, 'design.md'))].filter(t => t !== null);
    if (!times.length) continue;
    const hasSession = await $.fs.exists(join(root, '.waypoint', d.name, 'session.json')).catch(() => false);
    entries.push({ name: d.name, hasSession, mtimeMs: Math.max(...times) });
  }
  return entries;
}

export async function loadBandModel($: Engine): Promise<BandModel> {
  const root = await $.session.root();
  const project = pickProject(await projectEntries($, root));
  if (!project) return { mode: 'none' };
  const pdocs = join(root, 'docs', 'waypoint', project);
  const pstate = join(root, '.waypoint', project);
  const critiques: Record<string, string> = {};
  const critiqueFiles = (await listOpt($, pstate))
    .filter(f => f.kind === 'file' && /^critique-r\d+\.json$/.test(f.name))
    .slice(0, MAX_DOCS);
  for (const f of critiqueFiles) {
    const text = await readOpt($, join(pstate, f.name));
    if (text !== undefined) critiques[f.name] = text;
  }
  const files: BandFiles = {
    plan: await readOpt($, join(pdocs, 'plan.yaml')),
    design: await readOpt($, join(pdocs, 'design.md')),
    changelog: await readOpt($, join(pdocs, 'design', 'changelog.json')),
    session: await readOpt($, join(pstate, 'session.json')),
    states: await readCollection($, join(pstate, 'dbcache', 'state')),
    messages: await readCollection($, join(pstate, 'dbcache', 'messages')),
    swarm: await readOpt($, join(root, '.forge', 'swarm.json')),
    critiques,
  };
  return buildBandModel(project, files);
}
