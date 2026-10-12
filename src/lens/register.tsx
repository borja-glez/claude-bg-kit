import { atom, read, update } from 'claude-code';
import type { Register, Timer } from 'claude-code';
import type { BandModel } from '../mod/model.js';
import { buildPanelModel, parseSddLedger, summarizeTodos, FORGE_RUN_MAX, FORGE_EXEC_MAX, FORGE_EXEC_FILE_MAX, FORGE_EXEC_TASKS_MAX, FORGE_LIVE_MAX, PROPOSAL_ID, type Activity, type PanelModel } from './model.js';
import { clip, join, listOpt, loadBandModel, mtime, nowMs, readOpt, MAX_DOCS, type Engine } from '../mod/files.js';
import { normalizeStatus } from '../lib/forge-status.js';
import { buildCards, cardAlt } from './cards.js';
import { cardSvg, bandSvg } from './svg.js';
import { termCard, termBand, type TermUI } from './term.js';
import { headline, ratio, usageBandText, PALETTE, SECTION_HUE, SECTION_ICON } from './view.js';
import { labelLoop, newUsage, recordStep, recordTracking, trackingKind, type UsageState } from './usage.js';
import { mainCheckoutFrom, mergeForRun, parseUsageFile, runStartedAt, seedUsage, toUsageFile, USAGE_FILE_MAX, USAGE_FILES_MAX, type RunSource, type UsageFile } from './usage-file.js';

const panel = atom({ plugin: 'lens', key: 'panel' } as const, null as PanelModel | null);
const hidden = atom({ plugin: 'lens', key: 'hidden' } as const, false);

const PANE = 'lens';
const LINE_MAX = 80;
const MAX_ACTIVITY = 50;
const SUBAGENT_TTL_MS = 3600_000;
const PANEL_EVERY_MS = 10_000;
const WRITE_GAP_MS = 1000;
const PLAN_FALLBACK_AGE_MS = 24 * 3600_000;
// forge's status.json is a few hundred bytes; anything above this is not read.
const FORGE_STATUS_MAX = 64 * 1024;
const MAX_PROPOSAL_FILES = 50;

let timer: Timer | null = null;

// ---- The progress panel ------------------------------------------------------------------------
// What happens in the session is kept in module memory, always and cheaply (at most 50 entries per
// list). Files are read and $.state written only while the pane is open.

const emptyActivity = (): Activity => ({ tool: null, turnSince: null, todos: undefined, subagents: [], ccTasks: [] });
let activity: Activity = emptyActivity();
// The main loop's tools in flight by tool_use_id, in start order: "Now" shows the most recent still running.
const tools = new Map<string, { name: string; since: number }>();
const MAX_TODOS = 200;
// Whether there is activity worth a band of its own (open todos or recent subagents) when no waypoint band shows.
let busy = false;
// The roadmap section, read from the waypoint project's files at the panel's pace while the pane is open.
let roadmap: BandModel = { mode: 'none' };

type PanelFiles = {
  ledger?: string; ledgerPlan?: string; planFallback?: string; ledgerMtimeMs?: number;
  forgeStatus?: string; forgeRun?: string; proposals?: Record<string, string>; forgeBriefs?: number;
  forgeExecution?: string; forgeExecTasks?: Record<string, string>; forgeLive?: Record<string, string>;
};
// The last model built, kept in module memory for the band (which draws without reading $.state or files).
let bandModel: PanelModel | null = null;
let bandJson = '';
const SAFE_TASK = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,80}$/;
let panelFiles: PanelFiles = {};
let paneUp = false;
let panelTimer: Timer | null = null;
let panelRefreshing = false;
let writeTimer: Timer | null = null;
let writing = false;
let dirty = false;
let lastWrite = -Infinity;
let lastJson = '';

function resetPanel(): void {
  activity = emptyActivity();
  tools.clear();
  busy = false;
  panelFiles = {};
  lastJson = '';
  bandModel = null;
  bandJson = '';
}

// Open todos, or a subagent heard of within the hour (older entries are dropped here).
function isBusy(now: number): boolean {
  activity.subagents = activity.subagents.filter(s => now - s.since < SUBAGENT_TTL_MS);
  const todos = summarizeTodos(activity.todos);
  return todos.total - todos.done > 0 || activity.subagents.length > 0;
}

// Whether waypoint will draw its own band (and its Panel button): its plugin is installed and its band model for
// this root is not 'none' (a joined plan or a design in progress). Checked only when activity appears and on the
// 30 s tick while it lasts, never while idle, and not while the minimal band is hidden.
let waypointBand = false;
async function checkWaypoint($: Engine): Promise<void> {
  try { if (await read($, hidden)) return; } catch { /* check anyway */ }
  let installed = false;
  try { installed = (await $.command.list()).some(c => c.plugin === 'waypoint' || c.name.startsWith('waypoint:')); } catch { /* treat as absent */ }
  let next = false;
  if (installed) {
    try { next = (await loadBandModel($)).mode !== 'none'; } catch { /* no band */ }
  }
  if (next !== waypointBand) { waypointBand = next; $.ui.invalidate('ui.render'); }
}

// Redraws the band when activity appears or goes, so the minimal band with its Panel button follows it.
// When activity appears, whether waypoint draws its own band is checked first.
async function noteActivity($: Engine): Promise<void> {
  try {
    const now = isBusy(await nowMs($));
    if (now && !busy) await checkWaypoint($);
    if (now === busy) return;
    busy = now;
    $.ui.invalidate('ui.render');
  } catch { /* ignore */ }
}

// The 30 s tick: a subagent that never sent Stop ages out of the minimal band, and while there is activity
// waypoint's presence is checked again.
async function tick($: Engine): Promise<void> {
  const was = busy;
  await noteActivity($);
  if (was && busy) {
    try { await checkWaypoint($); } catch { /* ignore */ }
  }
  if (busy && !paneUp) await refreshPanel($);
  // A session with the pane closed and no activity still keeps its usage file at this pace (no run files are read).
  if (!paneUp && !busy) await refreshUsage($, false);
}

function showTool(): void {
  const last = [...tools.values()].at(-1);
  activity.tool = last ? { ...last } : null;
}

async function isPaneOpen($: Engine): Promise<boolean> {
  try { return (await $.ui.panes()).some(p => p.id === PANE); } catch { return false; }
}

// A plan path from the ledger is read only when it is a relative .md path inside the root.
function planFile(root: string, path: string): string | null {
  const p = path.trim().replace(/\\/g, '/');
  if (!p.toLowerCase().endsWith('.md') || p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.split('/').includes('..')) return null;
  return join(root, p);
}

async function newest($: Engine, paths: string[]): Promise<{ path: string; t: number } | null> {
  let best: { path: string; t: number } | null = null;
  for (const path of paths) {
    const t = await mtime($, path);
    if (t !== null && (!best || t > best.t)) best = { path, t };
  }
  return best;
}

let proposalCache: { key: string; proposals: Record<string, string> } | null = null;
// The root's .forge listing and its run.json / execution.json texts from the last panel read, shared with the usage meter.
type Listing = Awaited<ReturnType<typeof listOpt>>;
let forgeSeen: { dir: string; entries: Listing; run?: string; execution?: string } | null = null;

// The texts of up to `max` .json files of a folder, each at most `size` bytes, keyed by name without .json.
async function readJsonDir($: Engine, dir: string, max: number, size: number, keep: (name: string) => boolean = () => true): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const files = (await listOpt($, dir))
    .filter(f => f.kind === 'file' && f.name.endsWith('.json') && f.size <= size && keep(f.name.slice(0, -5)))
    .sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, max);
  for (const f of files) {
    const text = await readOpt($, join(dir, f.name));
    if (text !== undefined) out[f.name.slice(0, -5)] = text;
  }
  return out;
}

// The execution (.forge/execution.json, its public task files and the live signals), always from the main checkout:
// the coordinator writes it there, whichever worktree this session is in.
async function loadExecutionFiles($: Engine, main: string, listing?: Listing): Promise<PanelFiles> {
  const out: PanelFiles = {};
  const dir = join(main, '.forge');
  const entries = listing ?? await listOpt($, dir);
  const exec = entries.find(f => f.kind === 'file' && f.name === 'execution.json');
  if (!exec || exec.size > FORGE_EXEC_MAX) return out;
  out.forgeExecution = await readOpt($, join(dir, 'execution.json'));
  if (out.forgeExecution === undefined) return out;
  if (entries.some(f => f.kind === 'dir' && f.name === 'execution')) {
    out.forgeExecTasks = await readJsonDir($, join(dir, 'execution'), FORGE_EXEC_TASKS_MAX, FORGE_EXEC_FILE_MAX, name => SAFE_TASK.test(name));
  }
  if (entries.some(f => f.kind === 'dir' && f.name === 'live')) {
    out.forgeLive = await readJsonDir($, join(dir, 'live'), FORGE_LIVE_MAX, FORGE_EXEC_FILE_MAX);
  }
  return out;
}

// forge's status (kept by forge on each ledger append; the ledger itself is never read), its infinite run and its 50
// newest proposals from the session root, only when .forge/ lists; the execution from the main checkout.
async function loadForgeFiles($: Engine, root: string): Promise<PanelFiles> {
  // Resolved once per session and shared with the usage meter (usageWhere). A .git folder does not read (undefined):
  // a normal checkout, the root itself.
  if (mainCheckout === null) mainCheckout = mainCheckoutFrom(root, (await readOpt($, join(root, '.git'))) ?? null);
  const main = mainCheckout;
  const dir = join(root, '.forge');
  const entries = await listOpt($, dir);
  let execFiles: PanelFiles = {};
  try { execFiles = await loadExecutionFiles($, main, main === root ? entries : undefined); } catch { /* no execution card */ }
  const out: PanelFiles = { ...execFiles };
  if (!entries.length) { forgeSeen = { dir, entries }; return out; }
  const status = entries.find(f => f.kind === 'file' && f.name === 'status.json');
  if (status && status.size <= FORGE_STATUS_MAX) out.forgeStatus = await readOpt($, join(dir, 'status.json'));
  // How many briefs the current task has: the brief-<n>.md files in its work folder.
  if (out.forgeStatus !== undefined) {
    let task: string | undefined;
    try { task = normalizeStatus(JSON.parse(out.forgeStatus))?.task; } catch { /* no task */ }
    if (task && SAFE_TASK.test(task)) {
      const nums = (await listOpt($, join(dir, 'work', task)))
        .filter(f => f.kind === 'file').map(f => /^brief-(\d{1,4})\.md$/.exec(f.name)?.[1]).filter(Boolean).map(Number);
      if (nums.length) out.forgeBriefs = Math.max(...nums);
    }
  }
  // The infinite run (.forge/run.json, a few hundred bytes): not read above 16 KiB.
  const run = entries.find(f => f.kind === 'file' && f.name === 'run.json');
  if (run && run.size <= FORGE_RUN_MAX) out.forgeRun = await readOpt($, join(dir, 'run.json'));
  // The execution was read above from the main checkout: shared with the usage meter when that is this root.
  forgeSeen = { dir, entries, run: out.forgeRun, execution: main === root ? out.forgeExecution : undefined };
  if (entries.some(f => f.kind === 'dir' && f.name === 'proposals')) {
    const pdir = join(dir, 'proposals');
    const files = (await listOpt($, pdir))
      .filter(f => f.kind === 'file' && f.name.endsWith('.json') && PROPOSAL_ID.test(f.name.slice(0, -5)))
      .sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0)).slice(0, MAX_PROPOSAL_FILES);
    // The files are re-read only when the listing (names, sizes, mtimes) changed since the last read.
    const key = JSON.stringify([pdir, files.map(f => [f.name, f.size, f.mtimeMs])]);
    if (proposalCache?.key === key) out.proposals = proposalCache.proposals;
    else {
      const proposals: Record<string, string> = {};
      let complete = true;
      for (const f of files) {
        const text = await readOpt($, join(pdir, f.name));
        if (text !== undefined) proposals[f.name.slice(0, -5)] = text; else complete = false;
      }
      proposalCache = complete ? { key, proposals } : null;
      out.proposals = proposals;
    }
  }
  return out;
}

async function loadPanelFiles($: Engine, now: number): Promise<PanelFiles> {
  const root = await $.session.root();
  let forge: PanelFiles = {};
  forgeSeen = null;
  try { forge = await loadForgeFiles($, root); } catch { /* no forge section */ }
  return { ...await loadSuperpowersFiles($, root, now), ...forge };
}

async function loadSuperpowersFiles($: Engine, root: string, now: number): Promise<PanelFiles> {
  const out: PanelFiles = {};
  const sdd = join(root, '.superpowers', 'sdd');
  const ledgers = (await listOpt($, sdd)).filter(d => d.kind === 'dir').slice(0, MAX_DOCS).map(d => join(sdd, d.name, 'progress.md'));
  const ledger = await newest($, ledgers);
  if (ledger) {
    out.ledger = await readOpt($, ledger.path);
    if (out.ledger !== undefined) out.ledgerMtimeMs = ledger.t;
  }
  if (out.ledger !== undefined) {
    const planPath = parseSddLedger(out.ledger).planPath;
    const file = planPath ? planFile(root, planPath) : null;
    if (file) out.ledgerPlan = await readOpt($, file);
    return out;
  }
  // No ledger: the newest superpowers plan, if it was touched within the day, shown by its checkboxes.
  const plans = join(root, 'docs', 'superpowers', 'plans');
  const mds = (await listOpt($, plans)).filter(f => f.kind === 'file' && f.name.endsWith('.md')).slice(0, MAX_DOCS).map(f => join(plans, f.name));
  const plan = await newest($, mds);
  if (plan && now - plan.t <= PLAN_FALLBACK_AGE_MS) out.planFallback = await readOpt($, plan.path);
  return out;
}

// ---- The usage meter ---------------------------------------------------------------------------
// What each model loop spent, from the turn.step responses (src/lens/usage.ts), kept in module memory. When the main
// checkout has .forge/, it is also written to .forge/usage/<session>.json (at most every 30 s and at session end) and
// every session's file there is summed for the current run. All file work is on the refresh / tick path; a panel
// build only merges what that path read with the live state.

const USAGE_WRITE_MS = 30_000;
const LARGE_RUNS_MAX = 100;
const LARGE_RUNS_TTL_MS = 60_000;
const SAFE_SESSION = /^[A-Za-z0-9._-]{1,128}$/;
let usage: UsageState = newUsage(0);
let usageStartedAt: number | null = null;
let officialUsd: number | null = null;
let lastUsageWrite = 0;
let lastUsageSig = '';
let usageWrite: Promise<void> | null = null;
let sessionId: string | null = null;
let mainCheckout: string | null = null;
// The run's start and the other sessions' parsed files, as the last refresh read them.
let runInputs: { since: number; files: UsageFile[] } | null = null;
// Each usage file's last read by name, kept while its size and mtime stay; `file: null` is one that did not parse.
const usageFileCache = new Map<string, { size: number; mtimeMs: number; file: UsageFile | null }>();
let largeRunsCache: { key: string; at: number; runs: RunSource[] } | null = null;
// This session's own computed cost when officialUsd was read: the drift check compares the two from one moment.
let officialOwnUsd: number | null = null;

const ownCostUsd = () => Object.values(usage.loops).reduce((a, l) => a + l.costUsd, 0);

function resetUsage(): void {
  usage = newUsage(0);
  usageStartedAt = null;
  officialUsd = null;
  officialOwnUsd = null;
  lastUsageWrite = 0;
  lastUsageSig = '';
  sessionId = null;
  mainCheckout = null;
  runInputs = null;
  usageFileCache.clear();
  largeRunsCache = null;
}

// The session's id and its main checkout (the repo a worktree belongs to), resolved once per session.
async function usageWhere($: Engine): Promise<{ root: string; session: string; main: string }> {
  const root = await $.session.root();
  if (sessionId === null) sessionId = await $.session.id();
  // A .git folder does not read (undefined): a normal checkout, the root itself.
  if (mainCheckout === null) mainCheckout = mainCheckoutFrom(root, (await readOpt($, join(root, '.git'))) ?? null);
  return { root, session: sessionId, main: mainCheckout };
}

// A resumed session keeps its id: its own file, when it has the same start, is continued rather than overwritten.
async function seedFromOwnFile($: Engine, startedAt: number): Promise<void> {
  const target = usage;
  const where = await usageWhere($);
  if (!SAFE_SESSION.test(where.session)) return;
  const file = parseUsageFile(await readOpt($, join(where.main, '.forge', 'usage', `${where.session}.json`)));
  if (file && Date.parse(file.startedAt) === startedAt && usage === target && usageStartedAt === startedAt) seedUsage(usage, file);
}

// The first start read is adopted (steps counted before it stay); a new one (`/clear`, another session) starts the
// count from zero, and the old file stays. Either way the session's own file with that start is continued.
async function syncUsageStart($: Engine): Promise<void> {
  const u = await $.session.usage();
  if (usageStartedAt !== u.startedAt) {
    const adopt = usageStartedAt === null;
    usageStartedAt = u.startedAt;
    if (adopt) usage.startedAt = u.startedAt;
    else usage = newUsage(u.startedAt);
    lastUsageSig = '';
    try { await seedFromOwnFile($, u.startedAt); } catch { /* counted from here */ }
  }
  // The official cost and the own cost at the same moment, after any reset or seed.
  officialUsd = u.cost?.usd ?? null;
  officialOwnUsd = ownCostUsd();
}

const baseName = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;

// What changes the file: the start, the steps and the tracking.
function usageSig(): string {
  const steps = Object.values(usage.loops).reduce((a, l) => a + l.steps, 0);
  return `${usage.startedAt}|${steps}|${usage.tracking.waypoint}|${usage.tracking.forge}`;
}

// Writes this session's usage file when the main checkout has .forge/ and the count changed: at most every 30 s
// unless forced (session end). A failed write is ignored. The engine's fs has no rename, so the file is written in
// place; a reader that catches it half-written skips it and reads it again when its size or mtime changes.
async function writeUsageFileNow($: Engine, force: boolean): Promise<void> {
  try {
    // Before the session's start is known there is no file to write (its start would read 1970).
    if (usageStartedAt === null) return;
    const now = await nowMs($);
    if (!force && now - lastUsageWrite < USAGE_WRITE_MS) return;
    const sig = usageSig();
    if (sig === lastUsageSig || !Object.values(usage.loops).some(l => l.steps > 0)) return;
    const where = await usageWhere($);
    if (!SAFE_SESSION.test(where.session)) return;
    const forge = join(where.main, '.forge');
    if (!(await listOpt($, forge)).length) return;
    lastUsageWrite = now;
    const label = roadmap.mode === 'work' && roadmap.track ? roadmap.track : baseName(where.root);
    const text = JSON.stringify(toUsageFile(usage, { session: where.session, label, worktree: where.root, now, costUsd: officialUsd }));
    if (text.length > USAGE_FILE_MAX) return;
    await $.fs.write(join(forge, 'usage', `${where.session}.json`), text);
    lastUsageSig = sig;
  } catch { /* the panel stays live */ }
}

// One write at a time: a throttled write finding one in flight is dropped; a forced one waits for it and then runs.
async function writeUsageFile($: Engine, force: boolean): Promise<void> {
  while (usageWrite) {
    if (!force) return;
    await usageWrite;
  }
  usageWrite = writeUsageFileNow($, force).finally(() => { usageWrite = null; });
  await usageWrite;
}

// The Large runs' bases (.forge/work/<project>/run.json, written once, with no startedAt): their mtime is the start,
// and says whether the run is recent. Re-listed only when the folder names changed or a minute passed.
async function largeRuns($: Engine, forge: string, now: number): Promise<RunSource[]> {
  const work = join(forge, 'work');
  const dirs = (await listOpt($, work)).filter(d => d.kind === 'dir' && SAFE_TASK.test(d.name)).slice(0, LARGE_RUNS_MAX);
  const key = JSON.stringify(dirs.map(d => d.name));
  if (largeRunsCache?.key === key && now - largeRunsCache.at < LARGE_RUNS_TTL_MS) return largeRunsCache.runs;
  const runs: RunSource[] = [];
  for (const d of dirs) {
    const file = join(work, d.name, 'run.json');
    let st: { size: number; mtimeMs: number };
    try { st = await $.fs.stat(file); } catch { continue; }
    const text = st.size <= FORGE_RUN_MAX ? await readOpt($, file) : undefined;
    let started = false;
    try { started = text !== undefined && Number.isFinite(Date.parse(String(JSON.parse(text).startedAt))); } catch { /* use the mtime */ }
    runs.push({ text: started ? text! : JSON.stringify({ startedAt: new Date(st.mtimeMs).toISOString() }), mtimeMs: st.mtimeMs });
  }
  largeRunsCache = { key, at: now, runs };
  return runs;
}

// The run's start and the other sessions' files, or null when the main checkout has no .forge/ or no run. The .forge
// listing, run.json and execution.json come from the panel's own read when the root is the main checkout.
async function refreshRunInputs($: Engine, now: number): Promise<void> {
  const where = await usageWhere($);
  const forge = join(where.main, '.forge');
  const seen = forgeSeen?.dir === forge ? forgeSeen : null;
  const entries = seen ? seen.entries : await listOpt($, forge);
  if (!entries.length) { runInputs = null; return; }
  const small = async (name: string, max: number) =>
    entries.some(f => f.kind === 'file' && f.name === name && f.size <= max) ? readOpt($, join(forge, name)) : undefined;
  const mtimeOf = (name: string) => entries.find(f => f.kind === 'file' && f.name === name)?.mtimeMs ?? null;
  const since = runStartedAt({
    execution: { text: seen ? seen.execution : await small('execution.json', FORGE_EXEC_MAX), mtimeMs: mtimeOf('execution.json') },
    run: { text: seen ? seen.run : await small('run.json', FORGE_RUN_MAX), mtimeMs: mtimeOf('run.json') },
    largeRuns: entries.some(f => f.kind === 'dir' && f.name === 'work') ? await largeRuns($, forge, now) : [],
  }, now);
  if (since === null) { runInputs = null; return; }
  const dir = join(forge, 'usage');
  const own = `${where.session}.json`;
  // This session's own file is never read (the live state replaces it), nor one untouched since the run began.
  const listed = (await listOpt($, dir))
    .filter(f => f.kind === 'file' && f.name.endsWith('.json') && f.name !== own && f.size <= USAGE_FILE_MAX && !(f.mtimeMs > 0 && f.mtimeMs < since))
    .sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, USAGE_FILES_MAX);
  const files: UsageFile[] = [];
  const names = new Set<string>();
  for (const f of listed) {
    names.add(f.name);
    const hit = usageFileCache.get(f.name);
    let file: UsageFile | null;
    if (hit && hit.size === f.size && hit.mtimeMs === f.mtimeMs) file = hit.file;
    else {
      const text = await readOpt($, join(dir, f.name));
      file = parseUsageFile(text);
      // A file that did not read at all is tried again next time; one that read but did not parse waits for a change.
      if (text !== undefined) usageFileCache.set(f.name, { size: f.size, mtimeMs: f.mtimeMs, file });
    }
    if (file) files.push(file);
  }
  for (const name of [...usageFileCache.keys()]) if (!names.has(name)) usageFileCache.delete(name);
  runInputs = { since, files };
}

// The meter's file side at the refresh / tick pace: the start and official cost, the run's inputs (when a panel or
// band will show them) and the throttled write.
async function refreshUsage($: Engine, withRun: boolean): Promise<void> {
  try { await syncUsageStart($); } catch { /* no official cost */ }
  if (withRun) {
    try { await refreshRunInputs($, await nowMs($)); } catch { /* keep the last inputs */ }
  }
  await writeUsageFile($, false);
}

// What the panel model gets for the Usage card: the live state, the run merged from the last read inputs.
function usageInput(): { session: UsageState; run: UsageState | null; officialUsd: number | null; officialOwnUsd: number | null } {
  let run: UsageState | null = null;
  try {
    if (runInputs && sessionId !== null) run = mergeForRun(runInputs.files, { session: sessionId, state: usage }, runInputs.since);
  } catch { /* this session only */ }
  return { session: usage, run, officialUsd, officialOwnUsd };
}

// $.agent.list() is the truth on each refresh; without it, event entries older than an hour are dropped.
async function liveSubagents($: Engine, now: number): Promise<Activity['subagents']> {
  const fresh = activity.subagents.filter(s => now - s.since < SUBAGENT_TTL_MS);
  let list: unknown;
  try { list = await $.agent.list(); } catch { return fresh; }
  if (!Array.isArray(list)) return fresh;
  const since = new Map(fresh.map(s => [s.id, s.since]));
  const out: Activity['subagents'] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const a = raw as { id?: unknown; type?: unknown; description?: unknown; status?: unknown };
    if (typeof a.id !== 'string') continue;
    if (a.status !== 'running' && a.status !== 'pending' && a.status !== 'waiting') continue;
    out.push({
      id: a.id,
      type: typeof a.type === 'string' ? a.type : '',
      ...(typeof a.description === 'string' ? { description: a.description } : {}),
      status: a.status,
      since: since.get(a.id) ?? now,
    });
  }
  return out.slice(-MAX_ACTIVITY);
}

async function buildPanel($: Engine): Promise<PanelModel> {
  const now = await nowMs($);
  const subagents = activity.subagents.filter(s => now - s.since < SUBAGENT_TTL_MS);
  return buildPanelModel({
    band: roadmap, ...panelFiles, activity: { ...activity, subagents }, now, usage: usageInput(),
    ...(roadmap.locale ? { locale: roadmap.locale } : {}),
  });
}

// Keeps the band's model and redraws the band when it changed.
function keepBand($: Engine, model: PanelModel): void {
  const json = JSON.stringify(model);
  if (json === bandJson) return;
  bandJson = json;
  bandModel = model;
  $.ui.invalidate('ui.render');
}

async function writePanel($: Engine): Promise<void> {
  if (!paneUp) return;
  try {
    const model = await buildPanel($);
    keepBand($, model);
    const json = JSON.stringify(model);
    if (json === lastJson) return;
    lastWrite = await nowMs($);
    lastJson = json;
    await update($, panel, () => model);
  } catch { /* the pane keeps what it had */ }
}

// At most one write a second: changes that come sooner are gathered into one write when the second is up.
async function requestPanelWrite($: Engine): Promise<void> {
  if (!paneUp) return;
  dirty = true;
  if (writeTimer || writing) return;
  writing = true;
  try {
    const wait = lastWrite + WRITE_GAP_MS - await nowMs($);
    if (wait > 0) {
      writeTimer = $.clock.after(wait, () => { writeTimer = null; void requestPanelWrite($); });
      return;
    }
    dirty = false;
    await writePanel($);
  } catch { /* ignore */ } finally {
    writing = false;
  }
  if (dirty) await requestPanelWrite($);
}

// The 10 s panel refresh runs only while the pane is open, so other sessions pay only the in-memory capture.
function startPanelTimer($: Engine): void {
  if (!panelTimer) panelTimer = $.clock.every(PANEL_EVERY_MS, () => { void refreshPanel($); });
}

function stopPanelTimer(): void {
  panelTimer?.cancel();
  panelTimer = null;
}

// Reads the files and the agents list, only while the pane is open.
async function refreshPanel($: Engine): Promise<void> {
  if (panelRefreshing) return;
  panelRefreshing = true;
  try {
    paneUp = await isPaneOpen($);
    if (!paneUp) stopPanelTimer();
    // With the pane closed the files are still read while there is activity, for the band: at the 30 s tick's pace.
    if (!paneUp && !busy) return;
    if (paneUp) startPanelTimer($);
    // The roadmap section follows the waypoint project's files at the panel's pace.
    try { roadmap = await loadBandModel($); } catch { /* keep the last one */ }
    const now = await nowMs($);
    panelFiles = await loadPanelFiles($, now);
    activity.subagents = await liveSubagents($, now);
    await refreshUsage($, true);
    await noteActivity($);
    if (!paneUp) { keepBand($, await buildPanel($)); return; }
    // A refresh writes at once when the last write is a second old; else the throttle gathers it.
    await requestPanelWrite($);
  } catch { /* ignore */ } finally {
    panelRefreshing = false;
  }
}

const TEXT = {
  es: {
    panel: 'Panel', panelOpened: 'Panel de progreso abierto.',
    panelWaiting: 'El panel lens está abierto pero aún no se muestra', nothing: 'Nada que mostrar todavía',
    noTask: 'sin tarea en curso', track: 'frente', decision: 'decisión pendiente',
    sRoadmap: 'Roadmap', sSuperpowers: 'superpowers', sNow: 'Ahora', sTodos: 'Pendientes', sSubagents: 'Subagentes',
    sTasks: 'Tareas de Claude Code', fixRound: 'ronda', phase: 'Fase', done: 'hechas', open: 'abiertas', tool: 'herramienta', turn: 'turno',
    sExecution: 'Ejecución', manualRow: 'manual', modeSubagents: 'subagentes', modeSessions: 'sesiones', alive: 'viva', silent: 'sin señal', stopped: 'parada',
    queued: 'por integrar', orphans: 'huérfanas', conflictsLbl: 'en conflicto', blockedLbl: 'bloqueadas', integratedN: 'integradas',
    stage: { brief: 'brief', implement: 'implementar', validate: 'validar', verify: 'verificar', review: 'revisar', verdict: 'veredicto', integrate: 'integrar', execution: 'ejecución' },
    sForge: 'forge', approve: 'Aprobar', reject: 'Rechazar', hoursLeft: (h: number) => `quedan ${h} h`, auto: 'auto',
    pressEnter: 'Comando listo en el prompt: pulsa Enter',
    briefs: 'briefs', cycle: 'ciclo', task: 'Tarea', proposals: 'Propuestas',
    sUsage: 'Consumo', effort: 'esfuerzo', thisSession: 'esta sesión', run: 'ejecución', gMain: 'Sesión principal', gImpl: 'Implementadores', gReview: 'Revisores', gVerify: 'Verificación', blocked: 'bloqueada', gPlan: 'Planificación y scout', gOther: 'Otros subagentes', tracking: 'Seguimiento', withoutForge: 'Sin forge (estimado)', withoutForgeNote: 'orientativo: en una sola sesión el contexto crecería y costaría más, y no habría revisión', forgeCosts: (usd: string, pct: number) => `forge cuesta +${usd} (+${pct} %)`, forgeSaves: (usd: string) => `forge ahorra −${usd}`, pricesAsOf: 'precios a', drift: 'precios o medición incompletos', various: 'varios', noReview: 'sin revisiones independientes', effortLevel: (e: string) => ({ low: 'bajo', medium: 'medio', high: 'alto', xhigh: 'muy alto', max: 'máximo' } as Record<string, string>)[e] ?? e,
  },
  en: {
    panel: 'Panel', panelOpened: 'Progress panel opened.',
    panelWaiting: 'The lens panel is open but not shown yet', nothing: 'Nothing to show yet',
    noTask: 'no task in progress', track: 'track', decision: 'decision pending',
    sRoadmap: 'Roadmap', sSuperpowers: 'superpowers', sNow: 'Now', sTodos: 'Todos', sSubagents: 'Subagents',
    sTasks: 'Claude Code tasks', fixRound: 'round', phase: 'Phase', done: 'done', open: 'open', tool: 'tool', turn: 'turn',
    sExecution: 'Execution', manualRow: 'manual', modeSubagents: 'subagents', modeSessions: 'sessions', alive: 'alive', silent: 'silent', stopped: 'stopped',
    queued: 'to integrate', orphans: 'orphaned', conflictsLbl: 'in conflict', blockedLbl: 'blocked', integratedN: 'integrated',
    stage: { brief: 'brief', implement: 'implement', validate: 'validate', verify: 'verify', review: 'review', verdict: 'verdict', integrate: 'integrate', execution: 'execution' },
    sForge: 'forge', approve: 'Approve', reject: 'Reject', hoursLeft: (h: number) => `${h}h left`, auto: 'auto',
    pressEnter: 'Command ready in the prompt: press Enter',
    briefs: 'briefs', cycle: 'cycle', task: 'Task', proposals: 'Proposals',
    sUsage: 'Usage', effort: 'effort', thisSession: 'this session', run: 'run', gMain: 'Main session', gImpl: 'Implementers', gReview: 'Reviewers', gVerify: 'Verification', blocked: 'blocked', gPlan: 'Planning and scout', gOther: 'Other subagents', tracking: 'Tracking', withoutForge: 'Without forge (estimate)', withoutForgeNote: 'rough: in one session the context would grow and cost more, with no review', forgeCosts: (usd: string, pct: number) => `forge costs +${usd} (+${pct}%)`, forgeSaves: (usd: string) => `forge saves −${usd}`, pricesAsOf: 'prices as of', drift: 'prices or measurement incomplete', various: 'mixed', noReview: 'no independent review', effortLevel: (e: string) => e,
  },
} as const;
type Texts = (typeof TEXT)[keyof typeof TEXT];

const textsFor = (locale: string | undefined): Texts => (locale === 'es' ? TEXT.es : TEXT.en);
const lensTexts = (): Texts => textsFor(roadmap.locale);

// Opens the pane at the person's request; where it is not placed, a toast says why.
async function openPanel($: Engine): Promise<boolean> {
  const t = lensTexts();
  let placed = false;
  try {
    const opened = await $.ui.open({ id: PANE, title: 'lens' });
    placed = opened.isPlaced;
    if (!opened.isPlaced) $.ui.toast(`${t.panelWaiting}: ${clip(opened.reason, 200)}`);
  } catch {
    return false;
  }
  await refreshPanel($);
  return placed;
}

const RISK_HUE: Record<string, 'green' | 'yellow' | 'red'> = { low: 'green', medium: 'yellow', high: 'red' };

// A decision runs /forge:decide; where it cannot run from here it is left in the prompt for the person to send.
function decide($: Engine, t: Texts, id: string, d: 'approve' | 'reject'): void {
  if (!PROPOSAL_ID.test(id)) return;
  const args = `${id} ${d}`;
  $.command.run({ command: 'forge:decide', args }).catch(async () => {
    try {
      await $.prompt.fill({ text: `/forge:decide ${args}`, mode: 'replace' });
      $.ui.toast(t.pressEnter);
    } catch { /* nothing else to do */ }
  });
}

const pushCapped = <T,>(list: T[], item: T): T[] => [...list, item].slice(-MAX_ACTIVITY);

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    resetPanel();
    resetUsage();
    try { await syncUsageStart($); } catch { /* counted from the first refresh that reads it */ }
    waypointBand = false;
    roadmap = { mode: 'none' };
    try { if (await read($, hidden)) await update($, hidden, () => false); } catch { /* ignore */ }
    try { await $.command.register({ name: 'lens', description: 'Show the lens progress panel', immediate: true }); } catch { /* ignore */ }
    // One timer per environment: a later session start replaces it rather than adding another.
    timer?.cancel();
    timer = $.clock.every(30000, () => { void tick($); });
    // A pane left open across a reload or a resume is filled at once, and only then is the panel timer started.
    stopPanelTimer();
    await refreshPanel($);
    return next(e);
  });

  on('session.end', async ($, e, next) => {
    // The last usage file, whatever the 30 s pace says, after any write in flight.
    try {
      const u = await $.session.usage();
      if (u.startedAt === usageStartedAt) { officialUsd = u.cost?.usd ?? null; officialOwnUsd = ownCostUsd(); }
    } catch { /* keep the last cost */ }
    try { await writeUsageFile($, true); } catch { /* ignore */ }
    // `/clear` and an in-process resume go on under a new session id without a session.start: the meter starts over
    // (the next sync adopts the new start and id, and a resumed session continues its own file) and the timers keep
    // running, since the process does.
    if (e.reason === 'clear' || e.reason === 'resume') {
      try { resetUsage(); } catch { /* ignore */ }
      return next(e);
    }
    timer?.cancel();
    timer = null;
    stopPanelTimer();
    writeTimer?.cancel();
    writeTimer = null;
    paneUp = false;
    return next(e);
  });

  on('command.run', { command: 'lens' }, async $ => {
    const t = lensTexts();
    const placed = await openPanel($);
    return { text: placed ? t.panelOpened : `${t.panelWaiting}.` };
  });

  on('ui.close', async ($, e, next) => {
    const closed = await next(e);
    if (e.id === PANE) {
      paneUp = await isPaneOpen($);
      if (!paneUp) stopPanelTimer();
    }
    return closed;
  });

  on('turn.start', async ($, e, next) => {
    try {
      activity.turnSince = await nowMs($);
      void requestPanelWrite($);
    } catch { /* ignore */ }
    return next(e);
  });

  // A subagent's turn is not the main turn: it neither ends the main turn's clock nor reads the panel's files.
  on('turn.complete', ($, e, next) => {
    if (!e.agentId) {
      activity.turnSince = null;
      void refreshPanel($);
    }
    return next(e);
  });

  // Each model request, measured from its response (the stream passes through untouched).
  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e);
    try {
      recordStep(usage, { agentId: e.agentId, model: e.model, effort: e.effort, usage: r?.usage ?? null });
      void requestPanelWrite($);
    } catch { /* ignore */ }
    return r;
  });

  // A subagent's loop gets its type and description when it is spawned.
  on('agent.spawn', async ($, e, next) => {
    const r = await next(e);
    try {
      if (r?.agentId) labelLoop(usage, r.agentId, String(e.subagentType ?? 'unknown'), e.description);
    } catch { /* ignore */ }
    return r;
  });

  // The main loop's tool in flight and its todo list; a subagent's calls are its own.
  on('tool.call', async ($, e, next) => {
    const mine = !e.agentId;
    if (mine) {
      try {
        tools.delete(e.tool_use_id);
        tools.set(e.tool_use_id, { name: clip(String(e.tool), LINE_MAX), since: await nowMs($) });
        while (tools.size > MAX_ACTIVITY) tools.delete(tools.keys().next().value!);
        showTool();
        if (e.tool === 'TodoWrite') {
          activity.todos = Array.isArray(e.todos) ? e.todos.slice(0, MAX_TODOS) : e.todos;
          void noteActivity($);
        }
        void requestPanelWrite($);
      } catch { /* ignore */ }
    }
    try {
      const result = await next(e);
      // A main-loop waypoint or forge call is tracking: its input and result, about four characters a token.
      if (mine) {
        try {
          const kind = trackingKind(String(e.tool), e as unknown as Record<string, unknown>);
          if (kind) {
            const r = result as { text?: unknown; result?: unknown } | undefined;
            const out = typeof r?.text === 'string' ? r.text.length : (JSON.stringify(r?.result ?? '') ?? '').length;
            recordTracking(usage, kind, JSON.stringify(e).length + out);
          }
        } catch { /* ignore */ }
      }
      return result;
    } finally {
      if (mine && tools.delete(e.tool_use_id)) {
        showTool();
        void requestPanelWrite($);
      }
    }
  });

  on('classic.SubagentStart', async ($, e, next) => {
    try {
      const id = String(e.agent_id);
      activity.subagents = pushCapped(activity.subagents.filter(s => s.id !== id), { id, type: clip(String(e.agent_type ?? ''), LINE_MAX), since: await nowMs($) });
      // A loop agent.spawn did not label (lens loaded later, another spawn path) takes the hook's type.
      const kind = usage.loops[id]?.kind;
      if (!kind || kind === 'unknown') labelLoop(usage, id, String(e.agent_type ?? 'unknown'));
      await noteActivity($);
      void requestPanelWrite($);
    } catch { /* ignore */ }
    return next(e);
  });

  on('classic.SubagentStop', ($, e, next) => {
    try {
      activity.subagents = activity.subagents.filter(s => s.id !== e.agent_id);
      void noteActivity($);
      void requestPanelWrite($);
    } catch { /* ignore */ }
    return next(e);
  });

  on('classic.TaskCreated', ($, e, next) => {
    try {
      const id = String(e.task_id);
      activity.ccTasks = pushCapped(activity.ccTasks.filter(c => c.id !== id), { id, subject: String(e.task_subject ?? ''), done: false });
      void requestPanelWrite($);
    } catch { /* ignore */ }
    return next(e);
  });

  on('classic.TaskCompleted', ($, e, next) => {
    try {
      const id = String(e.task_id);
      const known = activity.ccTasks.some(c => c.id === id);
      activity.ccTasks = known
        ? activity.ccTasks.map(c => (c.id === id ? { ...c, done: true } : c))
        : pushCapped(activity.ccTasks, { id, subject: String(e.task_subject ?? ''), done: true });
      void requestPanelWrite($);
    } catch { /* ignore */ }
    return next(e);
  });

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    try {
      const m = await read($, panel);
      const t = m ? textsFor(m.locale) : lensTexts();
      const cols = Math.max(20, Number(e.props.bodyColumns) || LINE_MAX);
      const nowMs = m?.waypoint?.current?.startedAt ? await $.clock.now() : 0;
      const cards = m ? buildCards(m, t, nowMs) : [];
      const proposals = (m?.proposals ?? []).filter(p => PROPOSAL_ID.test(p.id));
      const ui = $.ui.resolve(e);
      const { Box, Text, Button } = ui;
      // The desktop (and any surface that draws SVG but is not the terminal) gets SVG cards; the terminal, cells.
      const Svg = e.surface !== 'terminal' && 'Svg' in ui ? ui.Svg : null;
      const W = Math.max(240, Math.min(900, cols * 8 - 8));
      const drawn = cards.map((card, i) => {
        if (!Svg) return termCard(ui as TermUI, `card-${i}`, card, cols);
        const { source, height } = cardSvg(card, W);
        return <Svg key={`card-${i}`} source={source} alt={cardAlt(card)} width={W} height={height} />;
      });
      return (
        <Box flexDirection="column" rowGap={Svg ? 1 : 0}>
          <Box flexDirection="row" justifyContent="flex-end">
            <Button key="close" label="×" role="dismiss" onPress={() => {
              // The plugin's own close does not reach its own ui.close hook: stop the writes here.
              paneUp = false;
              stopPanelTimer();
              $.ui.close({ id: PANE }).catch(() => undefined);
            }} />
          </Box>
          {drawn.length || proposals.length ? drawn : <Text dimColor>{t.nothing}</Text>}
          {proposals.length
            ? (
                <Box key="section-proposals" flexDirection="column" borderStyle="round" borderColor={PALETTE.yellow} paddingX={1}>
                  <Text bold color={PALETTE.yellow}>{`✧ ${t.proposals} · ${proposals.length}`}</Text>
                  {proposals.map(p => (
                    <Box key={`proposal-${p.id}`} flexDirection="column" marginTop={1}>
                      <Text bold wrap="truncate-end">{clip(p.title, cols)}</Text>
                      <Box flexDirection="row" columnGap={1} flexWrap="wrap">
                        <Text color={PALETTE.lavender}>{`‹${p.category}›`}</Text>
                        <Text color={PALETTE[RISK_HUE[p.risk] ?? 'yellow']}>{`‹${p.risk}›`}</Text>
                        <Button key={`approve-${p.id}`} label={`✓ ${t.approve}`} onPress={() => decide($, t, p.id, 'approve')} />
                        <Button key={`reject-${p.id}`} label={`✗ ${t.reject}`} onPress={() => decide($, t, p.id, 'reject')} />
                      </Box>
                    </Box>
                  ))}
                </Box>
              )
            : null}
        </Box>
      );
    } catch {
      return next(e);
    }
  });

  // The band above the prompt while subagents or todos are about and waypoint draws no band of its own: the run's
  // headline with its bar and task cells, then the Panel button. Drawn from module memory: no clock or file call.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    try {
      if (e.props.hasSurvey || !busy || waypointBand || await read($, hidden)) return next(e);
      const ui = $.ui.resolve(e);
      const { Box, Text, Button } = ui;
      const t = lensTexts();
      const head = bandModel ? headline(bandModel) : null;
      const agents = bandModel?.subagents.length ?? activity.subagents.length;
      const cells = head?.cells?.cells ?? [];
      const done = head?.cells?.done ?? 0;
      const total = head?.cells?.total ?? 0;
      const section = head?.section ?? 'agents';
      const spent = bandModel ? usageBandText(bandModel) : null;
      const o = {
        icon: SECTION_ICON[section], hue: SECTION_HUE[section],
        title: head?.title || (section === 'agents' ? t.sSubagents : t.sNow),
        detail: [head?.detail ?? '', spent ?? ''].filter(Boolean).join(' · '),
        ratio: ratio(done, total), label: total ? `${done}/${total}` : agents ? `◎ ${agents}` : '', moving: true, cells,
      };
      const buttons = [
        <Button key="panel" label={agents && total ? `${t.panel} · ◎ ${agents}` : t.panel} onPress={() => { void openPanel($); }} />,
        <Button key="dismiss" label="×" role="dismiss" onPress={() => { update($, hidden, () => true).catch(() => undefined); }} />,
      ];
      const cols = Number(e.props.bodyColumns) || 100;
      if (e.surface !== 'terminal' && 'Svg' in ui) {
        const { Svg } = ui;
        const W = Math.max(200, Math.min(1600, cols * 8 - 130));
        const { source, height } = bandSvg({ W, ...o });
        return (
          <Box flexDirection="row" alignItems="center" columnGap={1}>
            <Svg source={source} alt={[o.title, o.label, o.detail].filter(Boolean).join(' · ')} width={W} height={height} />
            {buttons}
          </Box>
        );
      }
      return (
        <Box flexDirection="row" columnGap={1}>
          {termBand(ui as TermUI, { ...o, columns: cols - 16, spin: agents > 0 })}
          <Box flexDirection="row" columnGap={1} flexShrink={0}>{buttons}</Box>
        </Box>
      );
    } catch {
      return next(e);
    }
  });
};
