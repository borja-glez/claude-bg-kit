import type { EngineInterface } from 'claude-code';
import { mainCheckoutFrom } from '../lib/main-checkout.js';
import { buildBandModel, pickProject, type BandFiles, type BandModel, type ProjectEntry } from './model.js';
import { DECISIONS_MAX } from '../lib/decisions.js';

export type Engine = EngineInterface;

export const MAX_DOCS = 500;

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

export { clip } from './band-line.js';

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

const EXEC_MAX = 64 * 1024;
const EXEC_FILE_MAX = 8 * 1024;
const EXEC_TASKS_MAX = 50;
const LIVE_MAX = 20;
const SAFE_TASK = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,80}$/;

async function readJsonDir($: Engine, dir: string, max: number, keep: (name: string) => boolean): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const files = (await listOpt($, dir))
    .filter(f => f.kind === 'file' && f.name.endsWith('.json') && f.size <= EXEC_FILE_MAX && keep(f.name.slice(0, -5)))
    .sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, max);
  for (const f of files) {
    const text = await readOpt($, join(dir, f.name));
    if (text !== undefined) out[f.name.slice(0, -5)] = text;
  }
  return out;
}

// The main checkout's .forge, listed once per refresh whichever worktree this session is in: the execution the
// coordinator writes (with its task files and live signals) and forge's decisions summary (a few hundred bytes; not
// read above DECISIONS_MAX).
async function loadForge($: Engine, root: string): Promise<Pick<BandFiles, 'execution' | 'execTasks' | 'live' | 'decisions'>> {
  try {
    const main = mainCheckoutFrom(root, (await readOpt($, join(root, '.git'))) ?? null);
    const dir = join(main, '.forge');
    const entries = await listOpt($, dir);
    const out: Pick<BandFiles, 'execution' | 'execTasks' | 'live' | 'decisions'> = {};
    const dec = entries.find(f => f.kind === 'file' && f.name === 'decisions.json');
    if (dec && dec.size <= DECISIONS_MAX) out.decisions = await readOpt($, join(dir, 'decisions.json'));
    const exec = entries.find(f => f.kind === 'file' && f.name === 'execution.json');
    if (!exec || exec.size > EXEC_MAX) return out;
    const execution = await readOpt($, join(dir, 'execution.json'));
    if (execution === undefined) return out;
    out.execution = execution;
    if (entries.some(f => f.kind === 'dir' && f.name === 'execution')) {
      out.execTasks = await readJsonDir($, join(dir, 'execution'), EXEC_TASKS_MAX, name => SAFE_TASK.test(name));
    }
    if (entries.some(f => f.kind === 'dir' && f.name === 'live')) out.live = await readJsonDir($, join(dir, 'live'), LIVE_MAX, () => true);
    return out;
  } catch { return {}; }
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
    ...(await loadForge($, root)),
    critiques,
  };
  return buildBandModel(project, files);
}
