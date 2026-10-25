import type { EngineInterface } from 'claude-code';
import { mainCheckoutFrom } from '../lib/main-checkout.js';
import { BAND_SLOTS_MAX, buildBandModel, checkoutSidOf, executionViewer, noneBand, seatsOf, withNeeds, type BandFiles, type BandModel, type BandSeat } from './model.js';
import { pickProject, type ProjectEntry } from '../lib/project-pick.js';
import { DECISIONS_MAX } from '../lib/decisions.js';
import { BOUND_MAX_BYTES, BOUND_REREAD_MS, CACHE_DOCS_MAX, MAX_PROJECTS, MAX_SEATS, parseBound, SESSION_MAX_BYTES, type BoundDoc } from '../lib/bound.js';
import { FORGE_DOC_MAX_BYTES, isSafeId, parseExecution } from '../lib/execution-state.js';
import { newestMemberFiles } from '../lib/member-doc.js';
import { CRITIQUE_FILE, LEGACY_CRITIQUE_FILE } from '../lib/critique.js';
import { DISMISSED_MAX_CHARS } from '../lib/design-gate.js';
import { oneLine } from '../lib/one-line.js';
import { isVisibleRun } from '../lib/execution-view.js';
import { AUTH_ID } from '../lib/needs-you.js';
import { NOTE_ID } from '../lib/notes.js';
import { PROPOSAL_ID } from '../lib/proposals.js';
import { clip as clipCells } from './band-line.js';

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

/**
 * A text lens draws (a subagent's description and type, a tool, a toast reason) as one clean line (oneLine), cut by the
 * cells it takes (band-line's clip, which only cuts: the band's own text comes clean from buildBandModel).
 */
export const clip = (text: string, max?: number): string => clipCells(oneLine(String(text)), max);

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
 * is empty or does not read as a binding is read once more after BOUND_REREAD_MS. One still broken is
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
async function loadForge($: Engine, main: string, now: number): Promise<ForgeFiles> {
  try {
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
      // Whether its coordinator's conversation is open: a live binding of its own. Read for every run still drawn, not
      // only an active one: a stopped run whose conversation is open is not taken up from another one (2c), and that
      // conversation renews its binding every minute although no hook writes a signal.
      if (parsed && isVisibleRun(parsed, now, 'owner')) {
        const bindings = await claudeBindingTexts($, main, hook, now);
        if (Object.keys(bindings).length) out.coordinatorBindings = bindings;
      }
    }
    return out;
  } catch { return {}; }
}

const NEED_FILE_MAX = 64 * 1024;
const SURFACE_FILE_MAX = 4 * 1024;
const NOTE_FILE_MAX = 16 * 1024;
const AUTH_KEEP = 20;
const SURFACES_KEEP = 20;
const PROPOSALS_KEEP = 50;
const NOTES_KEEP = 100;
const ROUND_DIR = /^reviews-(\d+)-(\d+)$/;

type Listed = Awaited<ReturnType<Engine['fs']['list']>>;
type NeedFiles = Pick<BandFiles, 'auth' | 'asked' | 'surfacesAsked' | 'local' | 'proposals' | 'notes'>;

/** The texts of `files` in `dir` by name without `.json`; a file that cannot be read is null. Undefined when there are none. */
async function readListed($: Engine, dir: string, files: Listed): Promise<Record<string, string | null> | undefined> {
  if (!files.length) return undefined;
  const out: Record<string, string | null> = {};
  for (const f of files) out[f.name.slice(0, -5)] = (await readOpt($, join(dir, f.name))) ?? null;
  return out;
}

/** The `.json` files of `dir` that are at most `max` bytes and whose name, without the extension, passes `ok`. */
async function jsonFiles($: Engine, dir: string, max: number, ok: (id: string) => boolean): Promise<Listed> {
  return (await listOpt($, dir)).filter(f => f.kind === 'file' && f.name.endsWith('.json') && f.size <= max && ok(f.name.slice(0, -5)));
}

const byNameDesc = (a: { name: string }, b: { name: string }) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0);

// The proposals' texts, read again only when their listing (names, sizes, mtimes) changes, as lens reads them: lens reads
// the band on every refresh of its panel. Not kept when some file did not read.
let proposalCache: { key: string; proposals: Record<string, string | null> } | null = null;

async function readProposals($: Engine, main: string): Promise<Record<string, string | null> | undefined> {
  const dir = join(main, '.forge', 'proposals');
  const files = (await jsonFiles($, dir, NEED_FILE_MAX, id => PROPOSAL_ID.test(id))).sort(byNameDesc).slice(0, PROPOSALS_KEEP);
  if (!files.length) return undefined;
  const key = JSON.stringify([dir, files.map(f => [f.name, f.size, f.mtimeMs])]);
  if (proposalCache?.key === key) return proposalCache.proposals;
  const proposals = (await readListed($, dir, files))!;
  proposalCache = Object.values(proposals).includes(null) ? null : { key, proposals };
  return proposals;
}

/** The asked.json of the newest review round (the highest brief, then round, as numbers) of the task, in the first folder that has rounds. */
async function readAsked($: Engine, main: string, folders: readonly string[]): Promise<{ file: string; text: string | null } | undefined> {
  for (const folder of folders) {
    const rounds = (await listOpt($, join(main, folder))).filter(d => d.kind === 'dir')
      .flatMap(d => { const m = ROUND_DIR.exec(d.name); return m ? [{ name: d.name, n: Number(m[1]), r: Number(m[2]) }] : []; })
      .sort((a, b) => b.n - a.n || b.r - a.r);
    if (!rounds.length) continue;
    const round = join(folder, rounds[0].name);
    const asked = (await listOpt($, join(main, round))).find(f => f.kind === 'file' && f.name === 'asked.json');
    if (!asked) return undefined;
    const file = join(round, 'asked.json');
    // Over the cap it is still listed, unread: forge writes it uncapped, and a question must not vanish (A5.m6).
    return { file, text: asked.size > NEED_FILE_MAX ? null : (await readOpt($, join(main, file))) ?? null };
  }
  return undefined;
}

/**
 * w7 A5: what the band reads for the list of what waits for the person. From the main checkout's .forge: the pending
 * authorizations, the asked.json of each running task in review, the surfaces the run asked about (with local.yaml)
 * and the proposals; from this project's cache under `root`, the roadmap's notes. The asked.json and the surfaces belong
 * to the execution of this project (an ephemeral one, or any without a project) that is not closed. Never throws: what
 * fails leaves its field as it is.
 */
async function loadNeeds($: Engine, main: string, root: string, project: string | null, execution: string | undefined, now: number): Promise<NeedFiles> {
  const out: NeedFiles = {};
  const forge = join(main, '.forge');
  try {
    const dir = join(forge, 'execution', 'auth');
    const files = (await jsonFiles($, dir, NEED_FILE_MAX, id => AUTH_ID.test(id))).sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, AUTH_KEEP);
    const auth = await readListed($, dir, files);
    if (auth) out.auth = auth;
  } catch { /* no authorizations */ }
  try {
    const run = execution === undefined ? null : parseExecution(execution, now);
    if (run && !run.closedAt && (run.kind !== 'plan' || project === null || run.project === project)) {
      const asked: NonNullable<BandFiles['asked']> = {};
      const reviewing = Object.entries(run.tasks).filter(([id, t]) => t.status === 'running' && t.stage === 'review' && isSafeId(id)).slice(0, BAND_SLOTS_MAX);
      for (const [id] of reviewing) {
        const folders = [...(run.kind === 'plan' && isSafeId(run.project) ? [join('.forge', 'work', run.project, id)] : []), join('.forge', 'work', id)];
        const found = await readAsked($, main, folders);
        if (found) asked[id] = found;
      }
      if (Object.keys(asked).length) out.asked = asked;
      if (isSafeId(run.runId)) {
        const dir = join(forge, 'execution', 'asked', run.runId);
        const files = (await jsonFiles($, dir, SURFACE_FILE_MAX, id => isSafeId(id))).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).slice(0, SURFACES_KEEP);
        const surfaces = await readListed($, dir, files);
        if (surfaces) {
          out.surfacesAsked = surfaces;
          const local = await readSmall($, join(forge, 'local.yaml'), NEED_FILE_MAX);
          if (local !== undefined) out.local = local;
        }
      }
    }
  } catch { /* no review questions, no surfaces */ }
  try {
    const proposals = await readProposals($, main);
    if (proposals) out.proposals = proposals;
  } catch { /* no proposals */ }
  try {
    if (project) {
      const dir = join(root, '.waypoint', project, 'dbcache', 'notes');
      const files = (await jsonFiles($, dir, NOTE_FILE_MAX, id => NOTE_ID.test(id))).sort(byNameDesc).slice(0, NOTES_KEEP);
      const notes = await readListed($, dir, files);
      if (notes) out.notes = notes;
    }
  } catch { /* no notes */ }
  return out;
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
  // The main checkout (the session may be in a worktree of it), resolved once for forge's files and the sources of the band.
  const main = mainCheckoutFrom(root, (await readOpt($, join(root, '.git'))) ?? null);
  const projects = await projectEntries($, root, now);
  const project = pickProject(projects.map(p => p.entry), sessionId);
  const chosen = projects.find(p => p.entry.name === project);
  if (!project || !chosen) {
    const forge = await loadForge($, main, now);
    return { project: null, files: { states: {}, messages: {}, critiques: {}, ...forge, ...(await loadNeeds($, main, root, null, forge.execution, now)), sessionId, now } };
  }
  const pdocs = join(root, 'docs', 'waypoint', project);
  const pstate = join(root, '.waypoint', project);
  // K3-10: the critiques and dismissed.json live in docs/waypoint/<project>/design/critiques/ (r<N>.json), versioned with
  // the design; the ones from before waypoint 0.27.0 stay in .waypoint/<project>/ (critique-r<N>.json). The model reads
  // them all under the old name, critique-r<N>.json. Carry 8, as the CLI's readCritiques: the round files of both places
  // are listed first and docs/ wins a round both have, so a .waypoint/ file of that round is never read; only the newest
  // MAX_DOCS rounds are read; round 0, a leading zero and a critique set aside as rejected are no round.
  const pcrit = join(pdocs, 'design', 'critiques');
  const rounds = new Map<number, string>();
  for (const [where, re] of [[pstate, LEGACY_CRITIQUE_FILE], [pcrit, CRITIQUE_FILE]] as const) {
    for (const f of await listOpt($, where)) {
      const m = f.kind === 'file' ? re.exec(f.name) : null;
      if (m) rounds.set(Number(m[1]), join(where, f.name));
    }
  }
  const critiques: Record<string, string> = {};
  for (const [round, file] of [...rounds.entries()].sort((a, b) => b[0] - a[0]).slice(0, MAX_DOCS)) {
    const text = await readOpt($, file);
    if (text !== undefined) critiques[`critique-r${round}.json`] = text;
  }
  const forge = await loadForge($, main, now);
  const files: BandFiles = {
    plan: await readOpt($, join(pdocs, 'plan.yaml')),
    design: await readOpt($, join(pdocs, 'design.md')),
    changelog: await readOpt($, join(pdocs, 'design', 'changelog.json')),
    // Carry 8: both dismissed.json, merged by the model as the CLI's readDismissedOf merges them; one over the size cap is
    // not read.
    dismissed: await readSmall($, join(pcrit, 'dismissed.json'), DISMISSED_MAX_CHARS),
    dismissedLegacy: await readSmall($, join(pstate, 'dismissed.json'), DISMISSED_MAX_CHARS),
    ...chosen.seats,
    states: await readCollection($, join(pstate, 'dbcache', 'state'), 'first'),
    // The newest MAX_DOCS: the band reads them again on every 30 s tick, one engine call each, so it does not count
    // every message as the start hook does once per session; an open message older than the newest 500 is rare.
    messages: await readCollection($, join(pstate, 'dbcache', 'messages'), 'last'),
    ...forge,
    ...(await loadNeeds($, main, root, project, forge.execution, now)),
    critiques,
    sessionId,
    now,
  };
  return { project, files };
}

/** The band of this conversation; without a waypoint project it draws nothing, with the role from forge's execution (I2). */
export async function loadBandModel($: Engine): Promise<BandModel> {
  const { project, files } = await readBandFiles($);
  return project ? buildBandModel(project, files) : withNeeds(noneBand(undefined, executionViewer(files)), null, files);
}

/**
 * C3: the band's tick keeps this conversation's bindings alive, by the rule the hooks' renewal follows (2a): a binding
 * of $.session.id() for its own seat that has not ended moves its seenAt to now when RENEW_MS or more passed since its
 * last renewal. It is read again just before the write and must still pass that rule, so an end, a release or a
 * takeover written meanwhile is never undone, an ended binding is never reopened, and a renewal the hooks made
 * meanwhile is not repeated. Only the newest of them in each project is renewed (M5), no other binding is
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
