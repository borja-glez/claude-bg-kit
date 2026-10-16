import type { EngineInterface } from 'claude-code';
import { mainCheckoutFrom } from '../lib/main-checkout.js';
import { buildBandModel, checkoutSidOf, executionViewer, noneBand, pickProject, seatsOf, type BandFiles, type BandModel, type BandSeat, type ProjectEntry } from './model.js';
import { DECISIONS_MAX } from '../lib/decisions.js';
import { BOUND_MAX_BYTES, BOUND_REREAD_MS, CACHE_DOCS_MAX, MAX_PROJECTS, MAX_SEATS, parseBound, SESSION_MAX_BYTES, type BoundDoc } from '../lib/bound.js';
import { FORGE_DOC_MAX_BYTES, isSafeId, parseExecution } from '../lib/execution-state.js';
import { newestMemberFiles } from '../lib/member-doc.js';

export type Engine = EngineInterface;

/** At most this many documents of a collection, by name (for the state cache, as openTasksOf on disk). */
export const MAX_DOCS = CACHE_DOCS_MAX;
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

/**
 * A cache collection's documents by id: MAX_DOCS `.json` files by name, whatever order the listing gives. `first` keeps
 * the first names (the state cache, as openTasksOf reads it on disk); `last` keeps the last ones (messages, whose event
 * ids start with their time, so the inbox and the escalations see the newest).
 */
export async function readCollection($: Engine, dir: string, keep: 'first' | 'last'): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const sorted = (await listOpt($, dir)).filter(f => f.kind === 'file' && f.name.endsWith('.json'))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const files = keep === 'first' ? sorted.slice(0, MAX_DOCS) : sorted.slice(-MAX_DOCS);
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

type SeatFiles = Pick<BandFiles, 'session' | 'bindings' | 'seatSessions'>;

/**
 * A bound.json's text, read as the CLI's readBound reads it: the band's own renewal writes it in place, so a text that
 * is empty or does not read as a binding is read once more after BOUND_REREAD_MS (spec §4.10). One still broken is
 * left as it is, and seatsOf finds no binding in it.
 */
async function readBoundText($: Engine, path: string, now: number): Promise<string | undefined> {
  const text = await readSmall($, path, BOUND_MAX_BYTES);
  if (text === undefined || parseBound(text, now) !== null) return text;
  try { await $.clock.sleep(BOUND_REREAD_MS); } catch { /* read again at once */ }
  return readSmall($, path, BOUND_MAX_BYTES);
}

/**
 * C3: what the band reads of a project's seats in .waypoint/<p>/: the checkout seat's session.json and bound.json
 * (key '.'), and for the extra seats of seats/<sid>/ their bound.json and session.json (key '<sid>'). The extra seats
 * are taken as readSeats takes them on disk: the folders with a safe name other than the checkout seat's own id, the
 * first MAX_SEATS by name; then one without a bound.json is skipped. A file over its size cap is not read.
 */
async function seatFiles($: Engine, wp: string, now: number): Promise<SeatFiles> {
  const bindings: Record<string, string> = {};
  const seatSessions: Record<string, string> = {};
  const session = await readSmall($, join(wp, 'session.json'), SESSION_MAX_BYTES);
  const own = await readBoundText($, join(wp, 'bound.json'), now);
  if (own !== undefined) bindings['.'] = own;
  const checkout = checkoutSidOf(session, own, now);
  const names = (await listOpt($, join(wp, 'seats')))
    .filter(d => d.kind === 'dir' && isSafeId(d.name) && d.name !== checkout).map(d => d.name).sort().slice(0, MAX_SEATS);
  for (const n of names) {
    const text = await readBoundText($, join(wp, 'seats', n, 'bound.json'), now);
    if (text === undefined) continue;
    bindings[n] = text;
    const s = await readSmall($, join(wp, 'seats', n, 'session.json'), SESSION_MAX_BYTES);
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
    const seats = await seatFiles($, join(root, '.waypoint', d.name), now);
    const bindings = seatsOf(seats, now).flatMap(s => (s.bound ? [s.bound] : []));
    out.push({ entry: { name: d.name, bindings, mtimeMs: Math.max(...times) }, seats });
  }
  return out;
}

const EXEC_MAX = 64 * 1024;
const EXEC_FILE_MAX = FORGE_DOC_MAX_BYTES;
const EXEC_TASKS_MAX = 50;
const LIVE_MAX = 20;
const SAFE_TASK = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,80}$/;

/** The texts of `files` in `dir`, by name without `.json`; one that cannot be read is left out. */
async function readEach($: Engine, dir: string, files: readonly { name: string }[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const f of files) {
    const text = await readOpt($, join(dir, f.name));
    if (text !== undefined) out[f.name.slice(0, -5)] = text;
  }
  return out;
}

async function readJsonDir($: Engine, dir: string, max: number, keep: (name: string) => boolean): Promise<Record<string, string>> {
  const files = (await listOpt($, dir))
    .filter(f => f.kind === 'file' && f.name.endsWith('.json') && f.size <= EXEC_FILE_MAX && keep(f.name.slice(0, -5)))
    .sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, max);
  return readEach($, dir, files);
}

type ForgeFiles = Pick<BandFiles, 'execution' | 'execTasks' | 'live' | 'decisions' | 'members' | 'coordinatorLive' | 'coordinatorBindings'>;

/**
 * The bound.json texts of the Claude conversation `claude` in every project of the checkout `main` (the first
 * MAX_PROJECTS folders of .waypoint/, every seat as seatsOf takes it, any via), by `<p>/<seat>`: claudeBindings on disk,
 * without its pid check, which the band cannot make.
 */
async function claudeBindingTexts($: Engine, main: string, claude: string, now: number): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const projects = (await listOpt($, join(main, '.waypoint'))).filter(d => d.kind === 'dir').slice(0, MAX_PROJECTS);
  for (const p of projects) {
    const seats = await seatFiles($, join(main, '.waypoint', p.name), now);
    for (const s of seatsOf(seats, now)) {
      const key = s.checkout ? '.' : s.sid;
      const text = seats.bindings?.[key];
      if (s.bound?.claude === claude && text !== undefined) out[`${p.name}/${key}`] = text;
    }
  }
  return out;
}

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
    // The members waypoint's hooks read too (newestMemberFiles), so both give a session the same role.
    if (entries.some(f => f.kind === 'dir' && f.name === 'members')) {
      const members = join(dir, 'members');
      out.members = await readEach($, members, newestMemberFiles((await listOpt($, members)).filter(f => f.kind === 'file')));
    }
    // B-09: whether the coordinator's conversation ended, from its own signal.
    const parsed = parseExecution(execution, now);
    const hook = parsed?.hookSession;
    if (hook && isSafeId(hook)) {
      const signal = out.live?.[hook] ?? await readSmall($, join(dir, 'live', `${hook}.json`), EXEC_FILE_MAX);
      if (signal !== undefined) out.coordinatorLive = signal;
      // While the run is active, whether its coordinator's conversation is open: a live binding of its own.
      if (parsed?.active) {
        const bindings = await claudeBindingTexts($, main, hook, now);
        if (Object.keys(bindings).length) out.coordinatorBindings = bindings;
      }
    }
    return out;
  } catch { return {}; }
}

/**
 * The project this conversation looks at and the files of its band: the project of its binding, else the one with the
 * latest activity (A-15), with this conversation's id and the engine's clock (C3). Null without a project.
 */
export async function loadBandFiles($: Engine): Promise<{ project: string; files: BandFiles } | null> {
  const read = await readBandFiles($);
  return read.project ? { project: read.project, files: read.files } : null;
}

/** As loadBandFiles; without a project, forge's files alone (I2: the role still comes from its execution). */
async function readBandFiles($: Engine): Promise<{ project: string | null; files: BandFiles }> {
  const root = await $.session.root();
  const now = await nowMs($);
  const sessionId = await sessionIdOf($);
  const projects = await projectEntries($, root, now);
  const project = pickProject(projects.map(p => p.entry), sessionId);
  const chosen = projects.find(p => p.entry.name === project);
  if (!project || !chosen) {
    return { project: null, files: { states: {}, messages: {}, critiques: {}, ...(await loadForge($, root, now)), sessionId, now } };
  }
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
    states: await readCollection($, join(pstate, 'dbcache', 'state'), 'first'),
    // The newest MAX_DOCS: the band reads them again on every 30 s tick, one engine call each, so it does not count
    // every message as the start hook does once per session; an open message older than the newest 500 is rare.
    messages: await readCollection($, join(pstate, 'dbcache', 'messages'), 'last'),
    ...(await loadForge($, root, now)),
    critiques,
    sessionId,
    now,
  };
  return { project, files };
}

/** The band of this conversation; without a waypoint project it draws nothing, with the role from forge's execution (I2). */
export async function loadBandModel($: Engine): Promise<BandModel> {
  const { project, files } = await readBandFiles($);
  return project ? buildBandModel(project, files) : noneBand(undefined, executionViewer(files));
}

/**
 * C3: the band's tick keeps this conversation's bindings alive, by the rule the hooks' renewal follows (2a): a binding
 * of $.session.id() for its own seat that has not ended moves its seenAt to now when RENEW_MS or more passed since its
 * last renewal. It is read again just before the write and must still pass that rule, so an end, a release or a
 * takeover written meanwhile is never undone, an ended binding is never reopened, and a renewal the hooks made
 * meanwhile is not repeated (spec §4.10). Only the newest of them in each project is renewed (M5), no other binding is
 * touched, and a write the engine refuses is left for the next tick. Returns how many it renewed.
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
    // M5: only the newest of its live bindings in the project is renewed (the newest renewal, the checkout seat first
    // on a tie, as describeViewer and the hooks pick it); any other lapses. A seat that a bind of this conversation
    // released, and that a renewal raced back to life, does not stay held.
    const mine = seatsOf(await seatFiles($, wp, now), now).filter(s => s.bound?.claude === id && s.bound.endedAt === null);
    const s = mine.reduce<BandSeat | null>((best, x) => (!best || Date.parse(x.bound!.seenAt) > Date.parse(best.bound!.seenAt) ? x : best), null);
    if (!s || !due(s.bound, s.sid)) continue;
    const file = s.checkout ? join(wp, 'bound.json') : join(wp, 'seats', s.sid, 'bound.json');
    const cur = parseBound(await readOpt($, file), now);
    if (!due(cur, s.sid)) continue;
    try {
      await $.fs.write(file, `${JSON.stringify({ ...cur, seenAt: new Date(now).toISOString() }, null, 2)}\n`);
      renewed++;
    } catch { /* the next tick tries again */ }
  }
  return renewed;
}
