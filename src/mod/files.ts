import type { EngineInterface } from 'claude-code';
import { mainCheckoutFrom } from '../lib/main-checkout.js';
import { buildBandModel, pickProject, seatsOf, type BandFiles, type BandModel, type ProjectEntry } from './model.js';
import { DECISIONS_MAX } from '../lib/decisions.js';
import { BOUND_MAX_BYTES, MAX_SEATS, parseBound, type BoundDoc } from '../lib/bound.js';
import { isSafeId, parseExecution } from '../lib/execution-state.js';

export type Engine = EngineInterface;

export const MAX_DOCS = 500;
/** At most this many project folders of .waypoint/ are looked at for this conversation's bindings, as the hooks do. */
const MAX_PROJECTS = 50;
/** C3: the band's tick renews a binding of this conversation when this long passed since its last renewal. */
export const RENEW_MS = 60_000;

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

/** C3: $.session.id() when the engine gives a safe id; null otherwise, and then this conversation owns nothing. */
export async function sessionIdOf($: Engine): Promise<string | null> {
  try {
    const id = await $.session.id();
    return isSafeId(id) ? id : null;
  } catch { return null; }
}

/** A file's text when it is at most `max` bytes; undefined when it is missing or bigger (then it is not read). */
async function readSmall($: Engine, path: string, max: number): Promise<string | undefined> {
  try {
    const st = await $.fs.stat(path);
    if (typeof st.size === 'number' && st.size > max) return undefined;
  } catch { return undefined; }
  return readOpt($, path);
}

const SESSION_FILE_MAX = 8 * 1024;
type SeatFiles = Pick<BandFiles, 'session' | 'bindings' | 'seatSessions'>;

/**
 * C3: what the band reads of a project's seats in .waypoint/<p>/: the checkout seat's session.json and bound.json
 * (key '.'), and for the extra seats of seats/<sid>/ their bound.json and session.json (key '<sid>'). Folders whose name
 * is not a safe id are skipped and a bound.json over BOUND_MAX_BYTES is not read; seatsOf decides the rest.
 */
async function seatFiles($: Engine, wp: string): Promise<SeatFiles> {
  const bindings: Record<string, string> = {};
  const seatSessions: Record<string, string> = {};
  const session = await readSmall($, join(wp, 'session.json'), SESSION_FILE_MAX);
  const own = await readSmall($, join(wp, 'bound.json'), BOUND_MAX_BYTES);
  if (own !== undefined) bindings['.'] = own;
  // One more than MAX_SEATS: a folder may carry the checkout seat's own id, which seatsOf leaves out.
  const names = (await listOpt($, join(wp, 'seats')))
    .filter(d => d.kind === 'dir' && isSafeId(d.name)).map(d => d.name).sort().slice(0, MAX_SEATS + 1);
  for (const n of names) {
    const text = await readSmall($, join(wp, 'seats', n, 'bound.json'), BOUND_MAX_BYTES);
    if (text === undefined) continue;
    bindings[n] = text;
    const s = await readSmall($, join(wp, 'seats', n, 'session.json'), SESSION_FILE_MAX);
    if (s !== undefined) seatSessions[n] = s;
  }
  return { session, bindings, seatSessions };
}

interface ProjectFiles { entry: ProjectEntry; seats: SeatFiles }

// As the hooks do: only a folder holding plan.yaml or design.md is a project. Each comes with its seats' files, so the
// project of this conversation's binding can win (A-15).
async function projectEntries($: Engine, root: string, now: number): Promise<ProjectFiles[]> {
  const docs = join(root, 'docs', 'waypoint');
  const dirs = (await listOpt($, docs)).filter(d => d.kind === 'dir');
  const out: ProjectFiles[] = [];
  for (const d of dirs) {
    const times = [await mtime($, join(docs, d.name, 'plan.yaml')), await mtime($, join(docs, d.name, 'design.md'))].filter(t => t !== null);
    if (!times.length) continue;
    const seats = await seatFiles($, join(root, '.waypoint', d.name));
    const bindings = seatsOf(seats, now).flatMap(s => (s.bound ? [s.bound] : []));
    out.push({ entry: { name: d.name, bindings, mtimeMs: Math.max(...times) }, seats });
  }
  return out;
}

const EXEC_MAX = 64 * 1024;
const EXEC_FILE_MAX = 8 * 1024;
const EXEC_TASKS_MAX = 50;
const LIVE_MAX = 20;
/** C3: at most this many member files are read, the newest first. */
const MEMBERS_MAX = 50;
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

type ForgeFiles = Pick<BandFiles, 'execution' | 'execTasks' | 'live' | 'decisions' | 'members' | 'coordinatorLive'>;

// The main checkout's .forge, listed once per refresh whichever worktree this session is in: the execution the
// coordinator writes (with its task files, live signals and members) and forge's decisions summary (a few hundred
// bytes; not read above DECISIONS_MAX). The coordinator's own signal is read even when it is not among the newest.
async function loadForge($: Engine, root: string, now: number): Promise<ForgeFiles> {
  try {
    const main = mainCheckoutFrom(root, (await readOpt($, join(root, '.git'))) ?? null);
    const dir = join(main, '.forge');
    const entries = await listOpt($, dir);
    const out: ForgeFiles = {};
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
    if (entries.some(f => f.kind === 'dir' && f.name === 'members')) out.members = await readJsonDir($, join(dir, 'members'), MEMBERS_MAX, name => isSafeId(name));
    // B-09: whether the coordinator's conversation ended, from its own signal.
    const hook = parseExecution(execution, now)?.hookSession;
    if (hook && isSafeId(hook)) {
      const signal = out.live?.[hook] ?? await readSmall($, join(dir, 'live', `${hook}.json`), EXEC_FILE_MAX);
      if (signal !== undefined) out.coordinatorLive = signal;
    }
    return out;
  } catch { return {}; }
}

/**
 * The project this conversation looks at and the files of its band: the project of its binding, else the one with the
 * latest activity (A-15), with this conversation's id and the engine's clock (C3). Null without a project.
 */
export async function loadBandFiles($: Engine): Promise<{ project: string; files: BandFiles } | null> {
  const root = await $.session.root();
  const now = await nowMs($);
  const sessionId = await sessionIdOf($);
  const projects = await projectEntries($, root, now);
  const project = pickProject(projects.map(p => p.entry), sessionId);
  const chosen = projects.find(p => p.entry.name === project);
  if (!project || !chosen) return null;
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
    dismissed: await readOpt($, join(pstate, 'dismissed.json')),
    ...chosen.seats,
    states: await readCollection($, join(pstate, 'dbcache', 'state')),
    messages: await readCollection($, join(pstate, 'dbcache', 'messages')),
    ...(await loadForge($, root, now)),
    critiques,
    sessionId,
    now,
  };
  return { project, files };
}

export async function loadBandModel($: Engine): Promise<BandModel> {
  const loaded = await loadBandFiles($);
  return loaded ? buildBandModel(loaded.project, loaded.files) : { mode: 'none' };
}

/**
 * C3: the band's tick keeps this conversation's bindings alive, by the rule the hooks' renewal follows (2a): a binding
 * of $.session.id() for its own seat that has not ended moves its seenAt to now when RENEW_MS or more passed since its
 * last renewal. It is read again just before the write and must still pass that rule, so an end, a release or a
 * takeover written meanwhile is never undone, an ended binding is never reopened, and a renewal the hooks made
 * meanwhile is not repeated (spec §4.10). No other binding is touched, and a write the engine refuses is left for the
 * next tick. Returns how many it renewed.
 */
export async function renewBindings($: Engine): Promise<number> {
  const id = await sessionIdOf($);
  if (!id) return 0;
  const root = await $.session.root();
  const now = await nowMs($);
  const due = (b: BoundDoc | null, sid: string): b is BoundDoc =>
    b !== null && b.sid === sid && b.claude === id && b.endedAt === null && now - Date.parse(b.seenAt) >= RENEW_MS;
  let renewed = 0;
  const projects = (await listOpt($, join(root, '.waypoint'))).filter(d => d.kind === 'dir').slice(0, MAX_PROJECTS);
  for (const p of projects) {
    const wp = join(root, '.waypoint', p.name);
    for (const s of seatsOf(await seatFiles($, wp), now)) {
      if (!due(s.bound, s.sid)) continue;
      const file = s.checkout ? join(wp, 'bound.json') : join(wp, 'seats', s.sid, 'bound.json');
      const cur = parseBound(await readOpt($, file), now);
      if (!due(cur, s.sid)) continue;
      try {
        await $.fs.write(file, `${JSON.stringify({ ...cur, seenAt: new Date(now).toISOString() }, null, 2)}\n`);
        renewed++;
      } catch { /* the next tick tries again */ }
    }
  }
  return renewed;
}
