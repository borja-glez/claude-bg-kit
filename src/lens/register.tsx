import { atom, read, update } from 'claude-code';
import type { Register, Timer } from 'claude-code';
import { noneBand, type BandModel } from '../mod/model.js';
import { buildPanelModel, bandKey, parsePlanTasks, parseSddLedger, planFileOf, FORGE_RUN_MAX, FORGE_EXEC_MAX, FORGE_EXEC_FILE_MAX, FORGE_EXEC_TASKS_MAX, FORGE_LIVE_MAX, FORGE_STATUSES_READ, PROPOSAL_ID, type Activity, type PanelModel } from './model.js';
import { clip, join, listOpt, loadBandModel, mtime, nowMs, readOpt, type Engine } from '../mod/files.js';
import { findAnchor, fsFailure, isOwnStatus, refusalReason, samePath, under, type Anchor, type AnchorScope, type Refusal } from '../mod/anchor.js';
import { normalizeStatus, statusKey, statusRootOf, type ForgeStatus } from '../lib/forge-status.js';
import { JOB_FILE_MAX, parseJob, runRoleOf } from './activities.js';
import { isSafeId, parseExecution } from '../lib/execution-state.js';
import { DECISIONS_MAX } from '../lib/decisions.js';
import { buildCards, cardAlt } from './cards.js';
import { cardSvg, bandSvg, type Card } from './svg.js';
import { termCard, termBand, type TermUI } from './term.js';
import { cardRows, clipCard, DOCK_COLUMNS, DOCK_MIN_COLUMNS, fitCards, panelLayout, paneRows } from './layout.js';
import { bandLevel, controlWidth, DEFAULT_COLUMNS, fitParts, joinParts, partsWidth } from '../mod/band-fit.js';
import { bandSubject, lensBand } from './lens-band.js';
import { keepPhoto, lensMode, photoId, photoText } from './photo.js';
import { clipWidth } from '../lib/text-width.js';
import { modeLabels, ownBusy, spinnerText, statusText, surfaceEvents } from './surfaces.js';
import { PALETTE, SECTION_HUE, SECTION_ICON } from './view.js';
import { freshFinished, pushFinished, withoutRunning, type FinishedAgent } from './finished.js';
import { endTurn, labelLoop, newTurnClock, newUsage, startTurn, touchTurn, recordStep, recordTracking, trackingKind, type UsageState } from './usage.js';
import { mainCheckoutFrom, mergeForRun, parseUsageFile, runStartedAt, seedUsage, toUsageFile, totalsOf, USAGE_FILE_MAX, USAGE_FILES_MAX, type RunBaseline, type RunSource, type UsageFile } from './usage-file.js';
import { addOwnTask, endAgent, endTool, knownTasks, linkSpawn, LINKS_MAX, LIST_GRACE_MS, ownTaskOf, pruneLinks, setTool, syncListed, type AgentLink, type ListedAgent } from './links.js';
import { taskCall } from './tasks.js';
import { failureText } from './failure.js';

const panel = atom({ plugin: 'lens', key: 'panel' } as const, null as PanelModel | null);
const hidden = atom({ plugin: 'lens', key: 'hidden' } as const, false);
// F-16: waypoint's own flags, read (never written) by lens: whether its band is drawn now, and whether it was closed
// with ×. drawn stays null with a waypoint older than 0.25, which does not publish it.
const waypointDrawn = atom({ plugin: 'waypoint', key: 'drawn' } as const, null as boolean | null);
const waypointHidden = atom({ plugin: 'waypoint', key: 'hidden' } as const, false);

const PANE = 'lens';
const LINE_MAX = 80;
const MAX_ACTIVITY = 50;
const SUBAGENT_TTL_MS = 3600_000;
const PANEL_EVERY_MS = 10_000;
const WRITE_GAP_MS = 1000;
// forge's status.json is a few hundred bytes; anything above this is not read.
const FORGE_STATUS_MAX = 64 * 1024;
const MAX_PROPOSAL_FILES = 50;
// C5: a status untouched for a day is not read; at most 5 folders are listed to count the briefs of the tasks in
// progress. Wave 1: at most 10 job files are read.
const STATUS_AGE_MS = 24 * 3600_000;
const BRIEF_LISTINGS_MAX = 5;
const JOBS_MAX = 10;

let timer: Timer | null = null;

// ---- The progress panel ------------------------------------------------------------------------
// What happens in the session is kept in module memory, always and cheaply (at most 50 entries per
// list). Files are read and $.state written only while the pane is open.

const emptyActivity = (): Activity => ({ tool: null, turnSince: null, todos: undefined, subagents: [], ccTasks: [] });
let activity: Activity = emptyActivity();
// Subagents heard finishing, for five minutes (see finished.ts).
let finished: FinishedAgent[] = [];
// The open main turn and its last sign of life, for the active time (see TurnClock).
const turnClock = newTurnClock();
const syncTurn = () => { activity.turnSince = turnClock.since; };
async function touch($: Engine): Promise<void> {
  try { touchTurn(turnClock, await nowMs($)); } catch { /* ignore */ }
}
// The main loop's tools in flight by tool_use_id, in start order: "Now" shows the most recent still running.
const tools = new Map<string, { name: string; since: number }>();
const MAX_TODOS = 200;
// E-02, E-06, E-11: the agents lens heard of and their task (links.ts), the tasks this session touched with forge.cjs,
// and when the main loop's last ScheduleWakeup wakes it. Module memory only, each with its cap.
let links: AgentLink[] = [];
// ownTaskOf keeps `T001-1` whole: activities.ts matches it to the status of `T001` and to its jobs by isOf.
let ownTasks: string[] = [];
let wakeAt: number | null = null;
const WAKE_MIN_S = 60;
const WAKE_MAX_S = 3600;
// E-11: each subagent's tools in flight by call id, in start order: its agent shows the latest still running.
const agentTools = new Map<string, Map<string, { name: string; since: number }>>();
// E-09: a subagent's turn.complete heard before its agent.spawn returned (no link yet), by agent id: the link is ended
// when it appears, if that is within PENDING_END_MS; at most PENDING_ENDS_MAX are kept.
const pendingEnds = new Map<string, number>();
const PENDING_END_MS = 2 * 60_000;
const PENDING_ENDS_MAX = 50;
// w8 M1: the teammates among the agents lens heard of (agent.spawn's isTeammate, the agents list's teammateId): a
// teammate's turn.complete leaves it idle, not finished. At most LINKS_MAX are kept.
const teammates = new Set<string>();
// Review Minor 4: when each agent lens ended last ended, by id, for LIST_GRACE_MS (settledList); at most LINKS_MAX.
const endedAt = new Map<string, number>();
// Whether there is activity worth a band of its own (recent subagents, links agents or forge work; todos alone do not count) when no waypoint band shows.
let busy = false;
// The roadmap section, read from the waypoint project's files at the panel's pace while the pane is open.
let roadmap: BandModel = noneBand();
// I2: whether this session read its band since it started (or since /clear or a resume): until then lens cannot tell
// whether it works for a run, and neither names one in its usage file nor takes a run baseline.
let bandRead = false;
// The lens anchor design (docs/superpowers/specs/2026-10-27-lens-project-anchor-design.md), D2-D5: the checkout every
// file-backed card reads, and whether this conversation joined it or works there alone. The search (anchor.ts) runs when
// `anchorDirty` says so (a session or conversation start, the pane opening, a waypoint or forge call, a superpowers
// ledger or plan written, an anchor gone) or when the session root moved; the ordinary refresh reads the anchored
// checkout without searching. No anchor: no card read from project files (D3).
let anchor: Anchor | null = null;
let anchorDirty = true;
let anchorRoot: string | null = null;
// The conversation id the last search used: an own-work anchor's statuses are told own by it, as the search told them.
// `anchorNoId`: the last search had no id; the next look asks for the id alone, and searches once it reads one.
let anchorId: string | null = null;
let anchorNoId = false;
// D2.5, D2.6: the superpowers ledgers and plans this session wrote, newest last, at most OWN_PATHS_MAX.
let ownPaths: { path: string; at: number }[] = [];
const OWN_PATHS_MAX = 20;
// D2: the tasks of the own statuses the last read found, which an own-work anchor's needs keep to.
let ownStatusTasks: string[] = [];
// D8: a refused read of the session root or of the anchored checkout, for the panel to say.
let refused: Refusal | null = null;
// D8: the same, found by an ordinary refresh listing the anchored checkout's .forge and .waypoint.
let readRefused: Refusal | null = null;
// One search at a time; the epoch moves with the conversation, so a search begun for the one before is not adopted.
let anchorSearch: Promise<void> | null = null;
let anchorEpoch = 0;

type PanelFiles = {
  ledger?: string; ledgerPlan?: string; ledgerPlanPath?: string; planFallback?: string; ledgerMtimeMs?: number;
  forgeStatus?: string; forgeRun?: string; proposals?: Record<string, string>; forgeBriefs?: number; forgeDecisions?: string;
  forgeExecution?: string; forgeExecTasks?: Record<string, string>; forgeLive?: Record<string, string>;
  forgeStatuses?: string[]; forgeBriefsBy?: Record<string, number>; forgeJobs?: string[];
};
// The last model built, kept in module memory for the band (which draws without reading $.state or files).
let bandModel: PanelModel | null = null;
let bandJson = '';
// The last size and screen mode lens's renders saw, kept per surface so one never overwrites another's (final review
// m-5): the pane's rows (F-01), the status line (§4.6) and the photo's width (m-2) read them; null until a render says.
// `body` is the band's bodyColumns there (the transcript's column less the engine's five), `docked` whether lens's pane
// was seated beside that transcript.
type View = { columns: number | null; rows: number | null; fullscreen: boolean | null; maxRows: number | null; body: number | null; docked: boolean };
type Viewport = { columns?: unknown; rows?: unknown; isFullscreen?: unknown } | undefined;
const NO_VIEW: View = { columns: null, rows: null, fullscreen: null, maxRows: null, body: null, docked: false };
const views = new Map<string, View>();
const viewOf = (surface: unknown): View => views.get(String(surface)) ?? NO_VIEW;
// F-08: the agent the person looks at in the pane (view.agentId): its task is the one expanded, and the first.
let focusAgent: string | null = null;
const viewNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
function noteView(surface: unknown, viewport: Viewport, more: { maxRows?: unknown; body?: unknown; docked?: boolean } = {}): void {
  const was = viewOf(surface);
  views.set(String(surface), {
    columns: viewNumber(viewport?.columns) ?? was.columns,
    rows: viewNumber(viewport?.rows) ?? was.rows,
    fullscreen: typeof viewport?.isFullscreen === 'boolean' ? viewport.isFullscreen : was.fullscreen,
    maxRows: viewNumber(more.maxRows) ?? was.maxRows,
    body: viewNumber(more.body) ?? was.body,
    docked: more.docked ?? was.docked,
  });
}
// Final review m-2: a CommandOutput row draws at the transcript's width, which a docked pane narrows. On a surface it is
// the band's column there and the engine's five (AbovePrompt.bodyColumns, «the transcript's beside a docked Pane»), when
// measured at this screen width; else the screen less the pane, while lens's is docked beside it; else the screen.
const BAND_MARK_COLUMNS = 5;
function transcriptColumns(surface: unknown, viewport: Viewport): number {
  const screen = viewNumber(viewport?.columns) ?? LINE_MAX;
  const v = viewOf(surface);
  if (v.body !== null && v.columns === screen) return Math.min(screen, v.body + BAND_MARK_COLUMNS);
  if (paneUp && v.docked) return Math.max(1, screen - DOCK_COLUMNS);
  return screen;
}
// A render keeps its surface's view; when that moves the transcript's width, the photos in it are laid out again.
function noteRender($: Engine, surface: unknown, viewport: Viewport, more: { maxRows?: unknown; body?: unknown; docked?: boolean } = {}): void {
  const before = transcriptColumns(surface, viewport);
  noteView(surface, viewport, more);
  if (photos.size && transcriptColumns(surface, viewport) !== before) $.ui.invalidate('ui.render');
}
// F-12: the band's measures: the icon and its gap, the bar's narrowest and widest, the boxes it draws at most.
const ICON_COLUMNS = 2;
const BAR_MIN = 6;
const BAR_MAX = 36;
const BAND_CELLS = 16;
// Final review m-4: whether waypoint's band was drawn at the last render of lens's, and when lens's band then took the
// site; a × within TAKEOVER_MS of that was meant for waypoint's band (a double tap, a key repeat) and closes nothing.
let waypointSeen = false;
let takeoverAt = Number.NEGATIVE_INFINITY;
const TAKEOVER_MS = 5_000;
// The subject lens's band was closed for with × (bandSubject): a band about something else is drawn again.
let hiddenSubject: string | null = null;

// × on lens's band: closed for the subject it shows, unless it came right after the band took the site.
async function closeBand($: Engine, subject: string): Promise<void> {
  try {
    if ((await nowMs($)) - takeoverAt < TAKEOVER_MS) return;
    hiddenSubject = subject;
    await update($, hidden, () => true);
  } catch { /* the band stays */ }
}

// Re-review m-4: what the band is about, with the todo list and the subagents lens holds in memory: the band closed on a
// list or on some agents comes back with a new todo or a new agent.
function subjectOf(model: PanelModel | null): string {
  const todos = Array.isArray(activity.todos) ? activity.todos.map(t => String((t as { content?: unknown } | null)?.content ?? '')) : [];
  return bandSubject(model, { todos, agents: activity.subagents.map(s => s.id) });
}

// F-06, carry 3: whether lens's band is up, from its state rather than its last drawing: activity, no band of waypoint's,
// not closed for what it is about. Read while the hint draws, so the hint follows waypoint's drawn and lens's × at once.
async function bandUp($: Engine): Promise<boolean> {
  if (!busy || await waypointDraws($)) return false;
  return !(await read($, hidden) && hiddenSubject === subjectOf(bandModel));
}

// A model about something else than what the band was closed for opens it again (and so does one after a reload, which
// forgot the subject): the band never stays closed for a whole session.
async function releaseBand($: Engine, model: PanelModel): Promise<void> {
  if (hiddenSubject !== null && hiddenSubject === subjectOf(model)) return;
  hiddenSubject = null;
  try { if (await read($, hidden)) await update($, hidden, () => false); } catch { /* the render draws it anyway */ }
}

// The Panel button: /lens in the form the band measured, run as the person would; left in the prompt where it cannot run.
function runLens($: Engine, args: 'live' | 'foto'): void {
  $.command.run({ command: 'lens', args }).catch(async () => {
    try {
      await $.prompt.fill({ text: `/lens ${args}`, mode: 'replace' });
      $.ui.toast(lensTexts().pressEnter);
    } catch { /* nothing else to do */ }
  });
}
// An id that names a folder or file: isSafeId's rule (src/lib/execution-state.ts), up to 120 characters, as forge names them.
const SAFE_TASK = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,120}$/;
let panelFiles: PanelFiles = {};
let paneUp = false;
// Review Minor 5: where the terminal last drew lens's pane, docked or inline; null before any drawing of this opening.
let panePlacement: 'dock' | 'inline' | null = null;
let panelTimer: Timer | null = null;
let writeTimer: Timer | null = null;
let writing = false;
let dirty = false;
let lastWrite = -Infinity;
let lastJson = '';

function resetPanel(): void {
  activity = emptyActivity();
  finished = [];
  turnClock.since = null;
  turnClock.lastActivityMs = 0;
  tools.clear();
  busy = false;
  panelFiles = {};
  lastJson = '';
  bandModel = null;
  bandJson = '';
  focusAgent = null;
  hiddenSubject = null;
  waypointSeen = false;
  takeoverAt = Number.NEGATIVE_INFINITY;
  prevModel = null;
  primed = false;
  toastQueue = [];
  toastTimer?.cancel();
  toastTimer = null;
  toastPending = false;
  forgeHeardAt = null;
  statusCache.clear();
  jobCache.clear();
  links = [];
  ownTasks = [];
  wakeAt = null;
  agentTools.clear();
  pendingEnds.clear();
  teammates.clear();
  endedAt.clear();
}

// E-11: the tool agent `id` shows: the latest of its calls still in flight, or none.
function showAgentTool(id: string): void {
  const last = [...(agentTools.get(id)?.values() ?? [])].at(-1);
  links = setTool(links, id, last ?? null);
}

// E-09: a link that just appeared whose turn already ended (pendingEnds) is ended at that moment, with the subagent it is
// (w8 M1); a teammate's turn end leaves it idle.
function applyPendingEnd(id: string, now: number): void {
  const at = pendingEnds.get(id);
  if (at === undefined) return;
  pendingEnds.delete(id);
  if (now - at <= PENDING_END_MS && !teammates.has(id)) endSubagent(id, at);
}

// w8 M1: a subagent's run starts at its agent.spawn and ends at its own turn.complete, which every hook hears. The classic
// SubagentStart and SubagentStop said the same, but cc-plugin-sec-default passes every classic hook of a plugin the person
// installed over where it is seated (managed settings, Team and Enterprise), so lens never hangs on them.
function startSubagent(id: string, type: string, description: string, now: number): void {
  endedAt.delete(id);
  finished = finished.filter(f => f.id !== id);
  const entry = { id, type: clip(type, LINE_MAX), ...(description ? { description: clip(description, LINE_MAX) } : {}), since: now };
  activity.subagents = pushCapped(activity.subagents.filter(s => s.id !== id), entry);
}

// The run ended: its link with it, and one lens knew as running is kept as finished.
function endSubagent(id: string, now: number): void {
  const ran = activity.subagents.find(s => s.id === id);
  activity.subagents = activity.subagents.filter(s => s.id !== id);
  links = endAgent(links, id, now, { any: true });
  if (ran) recordFinished(ran, now);
  endedAt.delete(id);
  endedAt.set(id, now);
  while (endedAt.size > LINKS_MAX) endedAt.delete(endedAt.keys().next().value!);
}

// Review Minor 4: an agents list read just after an agent's turn.complete may still name it running. Within LIST_GRACE_MS
// of its end, and with no spawn resuming it since (startSubagent forgets the end), that is taken as finished, so the list
// neither brings it back nor starts its time again. Past the grace, the list is the truth again.
function settledList(list: ListedAgent[], now: number): ListedAgent[] {
  for (const [id, at] of endedAt) if (now - at > LIST_GRACE_MS) endedAt.delete(id);
  return list.map(a => (endedAt.has(a.id) && LIVE_STATUSES.has(a.status) ? { ...a, status: 'completed' } : a));
}
const LIVE_STATUSES = new Set(['running', 'pending', 'waiting', 'idle']);

function noteTeammate(id: string): void {
  teammates.delete(id);
  teammates.add(id);
  while (teammates.size > LINKS_MAX) teammates.delete(teammates.keys().next().value!);
}

// A subagent heard of within the hour (older entries are dropped here), an agent of links still alive, or
// this session's own forge work: in progress in the last model and moving (final review m-3: a task left in progress for
// LEFT_OPEN_MS keeps nothing reading), or a forge.cjs call heard within 10 minutes (§4.6: the surfaces need the tick
// reading while it lasts). Todos alone count for nothing: Claude Code 2.1.233 took TodoWrite away from the newest models.
function isBusy(now: number): boolean {
  activity.subagents = activity.subagents.filter(s => now - s.since < SUBAGENT_TTL_MS);
  return activity.subagents.length > 0 || links.some(l => l.status !== 'done')
    || ownBusy(bandModel, runRoleOf(roadmap)) || (forgeHeardAt !== null && now - forgeHeardAt < FORGE_HEARD_MS);
}

// Whether waypoint will draw its own band (and its Panel button): its plugin is installed and its band model for
// this root is not 'none' (a joined plan or a design in progress). Checked only when activity appears and on the
// 30 s tick while it lasts, never while idle, and not while the minimal band is hidden.
let waypointBand = false;
// Carry 2: whether the waypoint plugin is loaded, from the command list (no file is read) when activity appears and on
// the tick while it lasts; null until checked. A waypoint unloaded mid-session leaves its last `drawn` in $.state,
// which only its owner writes: from then on lens takes it as unsaid (null) and guesses, so its band comes back.
let waypointLoaded: boolean | null = null;
async function checkWaypoint($: Engine): Promise<void> {
  try { if (await read($, hidden)) return; } catch { /* check anyway */ }
  let listed: boolean | null = null;
  try { listed = (await $.command.list()).some(c => c.plugin === 'waypoint' || c.name.startsWith('waypoint:')); } catch { listed = null; }
  // Re-review m-5: a listing that fails says nothing: what lens knew stands, and it is never read as «unloaded».
  const loadedChanged = listed !== null && listed !== waypointLoaded;
  if (listed !== null) waypointLoaded = listed;
  const installed = waypointLoaded === true;
  // F-16: a loaded waypoint that says whether it draws needs no guess (and no read of its files).
  let said = false;
  try { said = installed && typeof (await read($, waypointDrawn)) === 'boolean'; } catch { /* guess below */ }
  let next = false;
  if (installed && !said) {
    try { next = (await loadBandModel($)).mode !== 'none'; } catch { /* no band */ }
  }
  if (next !== waypointBand || loadedChanged) { waypointBand = next; $.ui.invalidate('ui.render'); }
}

// F-16: whether waypoint draws its band now. It says so itself; an older waypoint does not, and then lens takes its band
// as drawn unless it was closed with × (its hidden flag), guessing the rest as before (checkWaypoint). A waypoint no
// longer loaded says nothing (carry 2).
async function waypointDraws($: Engine): Promise<boolean> {
  if (waypointLoaded === false) return waypointBand;
  try {
    const said = await read($, waypointDrawn);
    if (typeof said === 'boolean') return said;
  } catch { /* guess */ }
  try { if (await read($, waypointHidden)) return false; } catch { /* as far as lens knows, it draws */ }
  return waypointBand;
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

// D2.5, D2.6: a superpowers ledger or plan as lens hears this session write it, and as it sits in a checkout.
const OWN_LEDGER_PATH = /[\\/]\.superpowers[\\/]sdd[\\/][^\\/]+[\\/]progress\.md$/;
const OWN_PLAN_PATH = /[\\/]docs[\\/]superpowers[\\/]plans[\\/][^\\/]+\.md$/;
const LEDGER_IN_CHECKOUT = /^\.superpowers\/sdd\/[^/]+\/progress\.md$/;
const PLAN_IN_CHECKOUT = /^docs\/superpowers\/plans\/[^/]+\.md$/;

// The newest of the paths this session wrote that sits in `dir` as `kind` says, or null.
function newestOwnPath(dir: string, kind: RegExp): string | null {
  const base = dir.replace(/\\/g, '/').replace(/\/+$/, '');
  let best: { path: string; at: number } | null = null;
  for (const p of ownPaths) {
    if (under(p.path, dir) && kind.test(p.path.slice(base.length + 1)) && (!best || p.at >= best.at)) best = p;
  }
  return best?.path ?? null;
}

// A task id names `task` or one of its attempts (T001-1 is of T001), as activities.ts matches them.
const isTaskOf = (task: string, id: string): boolean => id === task || (id.startsWith(`${task}-`) && /^\d{1,4}$/.test(id.slice(task.length + 1)));

// D2: a status of this conversation's own work, told as the search that found the anchor told it (isOwnStatus, with
// the id it used), so the lost-anchor rule never disagrees with it.
function ownStatus(text: string | undefined): ForgeStatus | null {
  let st: ForgeStatus | null = null;
  try { st = text === undefined ? null : normalizeStatus(JSON.parse(text)); } catch { st = null; }
  return st && anchorId !== null && isOwnStatus(st, anchorId, ownTasks) ? st : null;
}

let proposalCache: { key: string; proposals: Record<string, string> } | null = null;
// The root's .forge listing and its run.json / execution.json texts from the last panel read, shared with the usage meter.
type Listing = Awaited<ReturnType<typeof listOpt>>;
let forgeSeen: { dir: string; entries: Listing; run?: string; execution?: string } | null = null;

// Each status and job file's last read by path, kept while its size and mtime stay (C5, wave 1).
type FileCache = Map<string, { size: number; mtimeMs: number; text: string }>;
const statusCache: FileCache = new Map();
const jobCache: FileCache = new Map();

// The texts of up to `max` .json files of a folder that `keep` accepts, newest first, each at most `size` bytes; a file
// is read again only when its size or mtime changed, and the cache keeps only what the folder still lists.
async function readCached($: Engine, dir: string, max: number, size: number, cache: FileCache, keep: (f: Listing[number]) => boolean): Promise<string[]> {
  const files = (await listOpt($, dir))
    .filter(f => f.kind === 'file' && f.name.endsWith('.json') && f.size <= size && keep(f))
    .sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, max);
  const out: string[] = [];
  const names = new Set<string>();
  for (const f of files) {
    const path = join(dir, f.name);
    names.add(path);
    const hit = cache.get(path);
    if (hit && hit.size === f.size && hit.mtimeMs === f.mtimeMs) { out.push(hit.text); continue; }
    const text = await readOpt($, path);
    if (text === undefined) continue;
    cache.set(path, { size: f.size, mtimeMs: f.mtimeMs, text });
    out.push(text);
  }
  for (const k of [...cache.keys()]) if (k.startsWith(`${dir}/`) && !names.has(k)) cache.delete(k);
  return out;
}

// The numbers of the brief-<n>.md files of a folder.
async function briefNumbers($: Engine, folder: string): Promise<number[]> {
  return (await listOpt($, folder))
    .filter(f => f.kind === 'file').map(f => /^brief-(\d{1,4})\.md$/.exec(f.name)?.[1]).filter(Boolean).map(Number);
}

// How many briefs each task in progress has, by its status key: the brief-<n>.md files of .forge/work/<project>/<task>
// for a plan task (C4), else .forge/work/<task>; at most BRIEF_LISTINGS_MAX folders are listed.
async function briefsByKey($: Engine, statusRoot: string, texts: readonly string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const work = join(statusRoot, '.forge', 'work');
  let listings = 0;
  const nums = async (folder: string) => { listings++; return briefNumbers($, folder); };
  for (const text of texts) {
    if (listings >= BRIEF_LISTINGS_MAX) break;
    let st: ReturnType<typeof normalizeStatus> = null;
    try { st = normalizeStatus(JSON.parse(text)); } catch { st = null; }
    const key = st ? statusKey(st.task, st.project) : null;
    if (!st || !key || st.doneAt || !SAFE_TASK.test(st.task)) continue;
    let found = st.project && SAFE_TASK.test(st.project) ? await nums(join(work, st.project, st.task)) : [];
    if (!found.length && listings < BRIEF_LISTINGS_MAX) found = await nums(join(work, st.task));
    if (found.length) out[key] = Math.max(...found);
  }
  return out;
}

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

// forge's state for the panel. Each task's status (.forge/status/, kept by forge on each ledger append; the ledger itself
// is never read) beside the ledger this root writes to (C5: the main checkout for a forge task worktree), else, from an
// older forge, the root's status.json; the jobs in the background, the automatic decisions and the execution from the
// main checkout; the infinite run and the 50 newest proposals from the root, only when its .forge/ lists. `root` is the
// anchored checkout (D5); an anchor of its own work (`own`, D2) reads its own tasks alone: their statuses, briefs and
// jobs, and no run, proposals, automatic decisions nor infinite run.
async function loadForgeFiles($: Engine, root: string, now: number, scope: AnchorScope): Promise<PanelFiles> {
  const main = await mainOf($, root);
  const joined = scope === 'join';
  const dir = join(root, '.forge');
  const entries = await listOpt($, dir);
  let execFiles: PanelFiles = {};
  if (joined) {
    try { execFiles = await loadExecutionFiles($, main, main === root ? entries : undefined); } catch { /* no execution card */ }
  }
  const out: PanelFiles = { ...execFiles };
  // forge's automatic decisions (.forge/decisions.json, a few hundred bytes; not read above DECISIONS_MAX), kept in the
  // main checkout whichever worktree this session is in, so read even when this root has no .forge/ of its own.
  const mainDir = join(main, '.forge');
  const mainEntries = main === root ? entries : await listOpt($, mainDir);
  const decisions = joined ? mainEntries.find(f => f.kind === 'file' && f.name === 'decisions.json') : undefined;
  if (decisions && decisions.size <= DECISIONS_MAX) out.forgeDecisions = await readOpt($, join(mainDir, 'decisions.json'));
  // Wave 1: the commands running in the background (prep, review-prep, validate, integrate, step), in the main checkout.
  let jobs: string[] = [];
  if (mainEntries.some(f => f.kind === 'dir' && f.name === 'jobs')) {
    jobs = await readCached($, join(mainDir, 'jobs'), JOBS_MAX, JOB_FILE_MAX, jobCache, () => true);
  } else jobCache.clear();
  // C5: the statuses beside the ledger: at most the 20 newest touched within the day, each at most 64 KiB.
  const statusRoot = statusRootOf(root, main);
  const statusEntries = statusRoot === root ? entries : mainEntries;
  if (statusEntries.some(f => f.kind === 'dir' && f.name === 'status')) {
    const statuses = await readCached($, join(statusRoot, '.forge', 'status'), FORGE_STATUSES_READ, FORGE_STATUS_MAX, statusCache, f => now - f.mtimeMs < STATUS_AGE_MS);
    out.forgeStatuses = joined ? statuses : statuses.filter(text => ownStatus(text) !== null);
    out.forgeBriefsBy = await briefsByKey($, statusRoot, out.forgeStatuses);
  } else {
    // The folder went away: so do its cached reads, or a file back with the same size and mtime would read stale.
    statusCache.clear();
    // An older forge: the root's one status.json, as before C5.
    const status = entries.find(f => f.kind === 'file' && f.name === 'status.json');
    if (status && status.size <= FORGE_STATUS_MAX) {
      const text = await readOpt($, join(dir, 'status.json'));
      if (joined || ownStatus(text)) out.forgeStatus = text;
    }
    // How many briefs the current task has: the brief-<n>.md files in its work folder, .forge/work/<project>/<task> for a
    // plan task (D-08), else (a loose task, an older status or a task started before) .forge/work/<task>.
    if (out.forgeStatus !== undefined) {
      let st: ReturnType<typeof normalizeStatus> = null;
      try { st = normalizeStatus(JSON.parse(out.forgeStatus)); } catch { st = null; }
      const task = st?.task;
      if (task && SAFE_TASK.test(task)) {
        const project = st?.project;
        let nums = project && SAFE_TASK.test(project) ? await briefNumbers($, join(dir, 'work', project, task)) : [];
        if (!nums.length) nums = await briefNumbers($, join(dir, 'work', task));
        if (nums.length) out.forgeBriefs = Math.max(...nums);
      }
    }
  }
  // Own work keeps the jobs of its own tasks alone (and its needs, readBand).
  const tasks = joined ? [] : [...(out.forgeStatuses ?? []), ...(out.forgeStatus !== undefined ? [out.forgeStatus] : [])].flatMap(text => ownStatus(text)?.task ?? []);
  ownStatusTasks = tasks;
  const kept = joined ? jobs : jobs.filter(text => { const task = parseJob(text)?.task; return !!task && tasks.some(t => isTaskOf(t, task)); });
  if (kept.length) out.forgeJobs = kept;
  if (!joined || !entries.length) { forgeSeen = { dir, entries }; return out; }
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

// D4: this conversation's anchor, searched for only when a trigger marked it or the session root moved. A caller that
// finds a search in flight waits for it and looks again: a trigger may have come meanwhile. A search made without an id
// is not repeated on every look: the id alone is asked for again, and the search runs once it reads.
async function ensureAnchor($: Engine): Promise<void> {
  try {
    const root = await $.session.root();
    if (anchorNoId && !anchorDirty) {
      let id = sessionId;
      if (id === null) { try { id = await sessionIdNow($); } catch { id = null; } }
      if (id !== null) anchorDirty = true;
    }
    while (anchorSearch) await anchorSearch;
    if (!anchorDirty && anchorRoot !== null && samePath(root, anchorRoot)) return;
    const run: Promise<void> = searchAnchor($, root).finally(() => { if (anchorSearch === run) anchorSearch = null; });
    anchorSearch = run;
    await run;
  } catch { /* the anchor held stands */ }
}

// D1, D2: the search, among the anchor held, the session root and the marked folders below it, for every kind of anchor.
async function searchAnchor($: Engine, root: string): Promise<void> {
  const epoch = anchorEpoch;
  // Cleared before the search: a trigger that raises it meanwhile may not have been read, and the next look searches.
  anchorDirty = false;
  try {
    let id = sessionId;
    if (id === null) { try { id = await sessionIdNow($); } catch { id = null; } }
    const found = await findAnchor($, { root, sessionId: id, held: anchor?.checkout ?? null, kinds: 'all', own: { tasks: ownTasks, paths: ownPaths }, now: await nowMs($) });
    if (epoch !== anchorEpoch) return;
    anchor = found.anchor;
    anchorId = id;
    anchorNoId = id === null;
    refused = found.refused;
    anchorRoot = root;
  } catch { anchorDirty = true; }
}

// D2, D5: the band of the anchored checkout and project, for a conversation that joined it; none otherwise (D3). A join
// whose band no longer names this conversation its owner (a binding ended or released, a run closed) is searched again.
// Own work keeps the needs tied to its own tasks (a review question of its task), and nothing of a run, proposals or
// notes. Read for a conversation that a /clear or a resume has since replaced, it is dropped.
async function readBand($: Engine): Promise<void> {
  const at = anchor;
  const epoch = anchorEpoch;
  let band: BandModel = noneBand();
  if (at?.scope === 'join') band = await loadBandModel($, { checkout: at.checkout, project: at.project });
  else if (at) {
    const items = ((await loadBandModel($, { checkout: at.checkout, project: null })).needs?.items ?? [])
      .filter(n => n.task !== null && ownStatusTasks.some(t => isTaskOf(t, n.task!)));
    if (items.length) band = { ...noneBand(), needs: { total: items.length, items } };
  }
  if (epoch !== anchorEpoch) return;
  roadmap = band;
  bandRead = true;
  if (at?.scope === 'join' && at === anchor && band.viewer.role !== 'owner') anchorDirty = true;
}

// The anchor is this conversation's: a new one (a session start, /clear, a resume) searches from nothing, and what was
// read or heard for the one before goes with it, the tasks it touched with forge.cjs included.
function resetAnchor(): void {
  anchor = null;
  anchorDirty = true;
  anchorRoot = null;
  anchorId = null;
  anchorNoId = false;
  refused = null;
  readRefused = null;
  ownPaths = [];
  ownTasks = [];
  ownStatusTasks = [];
  anchorEpoch++;
  roadmap = noneBand();
  panelFiles = {};
  forgeSeen = null;
}

// D2.5, D2.6: a superpowers ledger or plan this session wrote is its own work: kept, absolute against the shell's
// directory when relative, and the anchor is searched for again, unless the path was known and the anchored checkout
// holds it (executing-plans ticks a checkbox a step: that moves no anchor).
async function noteOwnPath($: Engine, filePath: unknown): Promise<void> {
  if (typeof filePath !== 'string' || !filePath) return;
  const path = (/^([A-Za-z]:)?[\\/]/.test(filePath) ? filePath : join(await $.session.cwd(), filePath)).replace(/\\/g, '/');
  if (!OWN_LEDGER_PATH.test(path) && !OWN_PLAN_PATH.test(path)) return;
  const known = ownPaths.some(p => samePath(p.path, path));
  ownPaths = [...ownPaths.filter(p => !samePath(p.path, path)), { path, at: await nowMs($) }].slice(-OWN_PATHS_MAX);
  if (!(known && anchor && under(path, anchor.checkout))) anchorDirty = true;
}

// After /clear or a resume: the new conversation's language, its panel written emptied (E-13), and its first read at
// once, its anchor searched from nothing, so an open pane is not left empty until the next 10 s refresh.
async function afterSwitch($: Engine): Promise<void> {
  try {
    await readUiLocale($);
    void requestPanelWrite($);
    await refreshPanel($);
  } catch { /* the next refresh reads it */ }
}

// A conversation whose last search had no id searches once its id reads: at once while the pane shows (a resume, M1).
function idRead($: Engine): void {
  if (!anchorNoId || anchorDirty || sessionId === null) return;
  anchorDirty = true;
  if (paneUp) void refreshPanel($, true);
}

// D8: lens's own reads swallow every error, so a refusal of the anchored checkout's .forge or .waypoint is asked of a
// checked listing; a missing folder says nothing.
async function refusedIn($: Engine, checkout: string): Promise<Refusal | null> {
  for (const name of ['.forge', '.waypoint']) {
    const path = join(checkout, name);
    try { await $.fs.list(path); } catch (err) { if (fsFailure(err) === 'refused') return { path, reason: refusalReason(err) }; }
  }
  return null;
}

// D3, D5: the files of the anchored checkout; no anchor, none.
async function loadPanelFiles($: Engine, now: number): Promise<PanelFiles> {
  forgeSeen = null;
  const at = anchor;
  if (!at) { readRefused = null; return {}; }
  const denied = await refusedIn($, at.checkout);
  if (at === anchor) readRefused = denied;
  let forge: PanelFiles = {};
  try { forge = await loadForgeFiles($, at.checkout, now, at.scope); } catch { /* no forge section */ }
  // A lone forge task whose status no longer reads as this conversation's is searched for again.
  if (at.kind === 'forge-task' && at === anchor && !forge.forgeStatuses?.length && forge.forgeStatus === undefined) anchorDirty = true;
  return { ...await loadSuperpowersFiles($, at.checkout), ...forge };
}

// A plan-path file holds one path: one above this is not read.
const PLAN_PATH_MAX = 4096;
// w8 integration: where each base lands, every link followed ($.fs.stat's realPath), or null when it is where it says.
const realBaseCache = new Map<string, string | null>();
async function realBases($: Engine, bases: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  for (const base of bases) {
    if (!realBaseCache.has(base)) {
      let real: string | null = null;
      try { real = (await $.fs.stat(base, { resolve: true })).realPath ?? null; } catch { real = null; }
      realBaseCache.set(base, real && real.replace(/[\\/]+$/, '') !== base.replace(/[\\/]+$/, '') ? real : null);
    }
    const real = realBaseCache.get(base);
    if (real && !out.includes(real)) out.push(real);
  }
  return out;
}
// The plan as the card names it: its path under the base it was found in.
function shownPlanPath(file: string, bases: readonly string[]): string {
  for (const b of bases) {
    const base = b.replace(/[\\/]+$/, '');
    if (file.startsWith(`${base}/`)) return file.slice(base.length + 1);
  }
  return file;
}

// D2.5, D2.6: the superpowers run of this conversation in the anchored checkout `root`: the newest ledger it wrote there,
// else the newest plan it wrote or edited (executing-plans ticks its checkboxes and writes no ledger). No other ledger or
// plan is listed or read: another conversation's run is not this one's.
async function loadSuperpowersFiles($: Engine, root: string): Promise<PanelFiles> {
  const out: PanelFiles = {};
  const ledger = newestOwnPath(root, LEDGER_IN_CHECKOUT);
  if (ledger) {
    out.ledger = await readOpt($, ledger);
    const t = out.ledger !== undefined ? await mtime($, ledger) : null;
    if (t !== null) out.ledgerMtimeMs = t;
  }
  if (ledger && out.ledger !== undefined) {
    // w8 M4: superpowers 7 writes the plan's path to plan-path beside the ledger, and absolute (`X:/…`, msys `/x/…`) there
    // and in the ledger's header: the first that names a plan inside the root, or its main checkout from a worktree.
    const main = await mainOf($, root);
    const bases = main !== root ? [root, main] : [root];
    const marker = join(ledger.slice(0, ledger.lastIndexOf('/')), 'plan-path');
    let markerText: string | undefined;
    try { if ((await $.fs.stat(marker)).size <= PLAN_PATH_MAX) markerText = await readOpt($, marker); } catch { /* none */ }
    const names = [markerText, parseSddLedger(out.ledger).planPath];
    const readPlan = async (from: readonly string[]): Promise<boolean> => {
      for (const named of names) {
        const file = named ? planFileOf(named, from) : null;
        const text = file ? await readOpt($, file) : undefined;
        if (file && text !== undefined && parsePlanTasks(text).length) {
          out.ledgerPlan = text;
          out.ledgerPlanPath = shownPlanPath(file, from);
          return true;
        }
      }
      return false;
    };
    // w8 integration: sdd-workspace spells the plan with `pwd -P`, so a root under a symbolic link is also tried by
    // where it lands, asked only when the bases as given name no plan.
    if (!await readPlan(bases)) {
      const reals = await realBases($, bases);
      if (reals.length) await readPlan([...bases, ...reals]);
    }
    return out;
  }
  // No ledger: the newest plan of its own, shown by its checkboxes.
  const plan = newestOwnPath(root, PLAN_IN_CHECKOUT);
  if (plan) out.planFallback = await readOpt($, plan);
  return out;
}

// ---- The usage meter ---------------------------------------------------------------------------
// What each model loop spent, from the turn.step responses (src/lens/usage.ts), kept in module memory. When this
// conversation has an anchor whose main checkout has .forge/ (D7), it is also written to .forge/usage/<session>.json (at
// most every 30 s and at session end) and, for a join, every session's file there is summed for the current run. All
// file work is on the refresh / tick path; a panel build only merges what that path read with the live state.

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
// The main checkout of the anchored checkout (the repo a worktree belongs to), resolved once for each.
let mainCheckout: { checkout: string; main: string } | null = null;
// The run's start and the other sessions' parsed files, as the last refresh read them.
let runInputs: { since: number; files: UsageFile[] } | null = null;
// Each usage file's last read by name, kept while its size and mtime stay; `file: null` is one that did not parse.
const usageFileCache = new Map<string, { size: number; mtimeMs: number; file: UsageFile | null }>();
let largeRunsCache: { key: string; at: number; runs: RunSource[] } | null = null;
// This session's own computed cost when officialUsd was read: the drift check compares the two from one moment.
let officialOwnUsd: number | null = null;
// E-12: the cost of this session's own file seeded into the live state on a resume; /cost does not count it.
let seededUsd = 0;
// The start whose own usage file is still to be continued: without an anchor yet (D7) there is no file to read, so the
// seed waits, and runs before the first write that has one (it would overwrite the file otherwise).
let seedPending: number | null = null;
// E-07: this session's totals the first time it saw the run it works for, kept in memory and in its usage file.
let runBaseline: RunBaseline | null = null;

// E-07: the run this session works for, as the band publishes it (C3: its coordinator or a member), else none (null);
// undefined while its band was not read yet (I2).
function runKeyNow(): string | null | undefined {
  if (!bandRead) return undefined;
  const id = roadmap.viewer?.runId;
  return runRoleOf(roadmap) === 'owner' && isSafeId(id) ? id : null;
}

// E-07: the first time this session sees a run's key, its totals so far: that run counts only what comes after.
function keepRunBaseline(): void {
  const key = runKeyNow();
  if (key === null || key === undefined || runBaseline?.runKey === key) return;
  const t = totalsOf(usage.loops);
  runBaseline = { runKey: key, costUsd: t.costUsd, tokens: t.tokens, activeMs: usage.activeMs };
}

const ownCostUsd = () => Object.values(usage.loops).reduce((a, l) => a + l.costUsd, 0);

function resetUsage(): void {
  usage = newUsage(0);
  usageStartedAt = null;
  officialUsd = null;
  officialOwnUsd = null;
  seededUsd = 0;
  runBaseline = null;
  bandRead = false;
  execSeen = null;
  lastUsageWrite = 0;
  lastUsageSig = '';
  sessionId = null;
  mainCheckout = null;
  realBaseCache.clear();
  runInputs = null;
  usageFileCache.clear();
  largeRunsCache = null;
  seedPending = null;
  resetAnchor();
}

// The main checkout's execution.json as the last check saw it (`<size>:<mtime>`, '' when absent), null before any.
let execSeen: string | null = null;

// I2, R2: with the pane closed and nothing busy no refresh reads the band, so the usage write stats the main checkout's
// execution.json (one stat) and reads the band again when that file appeared, went or changed: the run this session
// works for, and its baseline, follow a run as it starts and ends. A band never read is read only for an active run
// (until then the file names no run); the execution file itself is read only then, and only when it changed.
async function watchRun($: Engine, main: string): Promise<void> {
  const path = join(main, '.forge', 'execution.json');
  let st: { size: number; mtimeMs: number } | null = null;
  try { st = await $.fs.stat(path); } catch { st = null; }
  const seen = st ? `${st.size}:${st.mtimeMs}` : '';
  if (seen === execSeen) return;
  if (!bandRead) {
    const active = !!st && st.size <= FORGE_EXEC_MAX && parseExecution(await readOpt($, path), await nowMs($))?.active === true;
    if (!active) { execSeen = seen; return; }
  }
  try { await readBand($); } catch { return; }
  execSeen = seen;
  keepRunBaseline();
}

// R1: the id of the conversation /clear or a resume just ended. Within its session.end chain $.session.id() still
// answers it ("until now"), so a read that gives it is not adopted: the id stays unknown and is read again next time.
let endedId: string | null = null;
async function sessionIdNow($: Engine): Promise<string | null> {
  const id = await $.session.id();
  return id === endedId ? null : id;
}

// The main checkout of `checkout`. A .git folder does not read (undefined): a normal checkout, the checkout itself.
async function mainOf($: Engine, checkout: string): Promise<string> {
  if (mainCheckout?.checkout === checkout) return mainCheckout.main;
  const main = mainCheckoutFrom(checkout, (await readOpt($, join(checkout, '.git'))) ?? null);
  mainCheckout = { checkout, main };
  return main;
}

// The session's id, the anchored checkout and its main checkout. Until the new conversation's id can be read (R1), and
// without an anchor (D7), there is no file of this session to read or write.
async function usageWhere($: Engine): Promise<{ root: string; session: string; main: string }> {
  if (sessionId === null) sessionId = await sessionIdNow($);
  const session = sessionId;
  if (session === null) throw new Error('the session id is not known yet');
  await ensureAnchor($);
  const at = anchor;
  if (!at) throw new Error('no anchor');
  return { root: at.checkout, session, main: await mainOf($, at.checkout) };
}

// A resumed session keeps its id: its own file, when it has the same start, is continued rather than overwritten.
// The seed is taken once per start: a caller that finds it pending takes it, and gives it back when there is no id or
// anchor yet to read the file by.
async function seedFromOwnFile($: Engine, startedAt: number): Promise<void> {
  if (seedPending !== startedAt) return;
  seedPending = null;
  const target = usage;
  let where: Awaited<ReturnType<typeof usageWhere>>;
  try { where = await usageWhere($); } catch (err) {
    if (usage === target && usageStartedAt === startedAt) seedPending = startedAt;
    throw err;
  }
  if (!SAFE_SESSION.test(where.session)) return;
  const file = parseUsageFile(await readOpt($, join(where.main, '.forge', 'usage', `${where.session}.json`)));
  if (file && Date.parse(file.startedAt) === startedAt && usage === target && usageStartedAt === startedAt) {
    seedUsage(usage, file);
    seededUsd = Object.values(file.loops).reduce((a, l) => a + l.costUsd, 0);
    if (file.runBaseline) runBaseline = file.runBaseline;
  }
}

// The first start read is adopted (steps counted before it stay); a new one (`/clear`, another session) starts the
// count from zero, and the old file stays. Either way the session's own file with that start is continued.
async function syncUsageStart($: Engine): Promise<void> {
  const u = await $.session.usage();
  if (usageStartedAt !== u.startedAt) {
    const adopt = usageStartedAt === null;
    usageStartedAt = u.startedAt;
    if (adopt) usage.startedAt = u.startedAt;
    else { usage = newUsage(u.startedAt); seededUsd = 0; }
    lastUsageSig = '';
    seedPending = u.startedAt;
    try { await seedFromOwnFile($, u.startedAt); } catch { /* seeded before the first write, or counted from here */ }
  }
  takeOfficial(u);
}

// The official cost and the own cost at the same moment, after any reset or seed; E-12: a seeded file's cost is not in
// /cost. The usage sync and the session end both take them here.
function takeOfficial(u: { cost?: { usd: number } | null }): void {
  officialUsd = u.cost?.usd ?? null;
  officialOwnUsd = ownCostUsd() - seededUsd;
}

const baseName = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;

// What changes the file: the start, the steps, the tracking and the run it works for (unknown until the band is read).
function usageSig(): string {
  const steps = Object.values(usage.loops).reduce((a, l) => a + l.steps, 0);
  const key = runKeyNow();
  return `${usage.startedAt}|${steps}|${usage.tracking.waypoint}|${usage.tracking.forge}|${usage.activeMs}|${key === undefined ? '?' : key ?? ''}`;
}

// Writes this session's usage file when it has an anchor (D7), the anchored main checkout has .forge/ and the count
// changed: at most every 30 s unless forced (session end). A failed write is ignored. The engine's fs has no rename, so
// the file is written in place; a reader that catches it half-written skips it and reads it again when its size or mtime
// changes. `watch`: no refresh reads the band (the 30 s tick with the pane closed and nothing busy), so the write
// follows the run (R2).
async function writeUsageFileNow($: Engine, force: boolean, watch: boolean): Promise<void> {
  try {
    // Before the session's start is known there is no file to write (its start would read 1970).
    if (usageStartedAt === null) return;
    const now = await nowMs($);
    if (!force && now - lastUsageWrite < USAGE_WRITE_MS) return;
    if (!Object.values(usage.loops).some(l => l.steps > 0)) return;
    await ensureAnchor($);
    if (!anchor) return;
    // A resumed session's own file, continued now that it has an anchor to read it by, before this write replaces it.
    if (seedPending !== null && seedPending === usageStartedAt) {
      try { await seedFromOwnFile($, seedPending); } catch { /* counted from here */ }
    }
    // I2, R2: the run this session works for, while no refresh reads the band, or as long as it was never read.
    if (watch || !bandRead) await watchRun($, (await usageWhere($)).main);
    const sig = usageSig();
    if (sig === lastUsageSig) return;
    const where = await usageWhere($);
    if (!SAFE_SESSION.test(where.session)) return;
    const forge = join(where.main, '.forge');
    if (!(await listOpt($, forge)).length) return;
    lastUsageWrite = now;
    const label = roadmap.mode === 'work' && roadmap.track ? roadmap.track : baseName(where.root);
    keepRunBaseline();
    const text = JSON.stringify(toUsageFile(usage, { session: where.session, label, worktree: where.root, now, costUsd: officialUsd, runKey: runKeyNow(), runBaseline }));
    if (text.length > USAGE_FILE_MAX) return;
    await $.fs.write(join(forge, 'usage', `${where.session}.json`), text);
    lastUsageSig = sig;
  } catch { /* the panel stays live */ }
}

// One write at a time: a throttled write finding one in flight is dropped; a forced one waits for it and then runs.
async function writeUsageFile($: Engine, force: boolean, watch = false): Promise<void> {
  while (usageWrite) {
    if (!force) return;
    await usageWrite;
  }
  usageWrite = writeUsageFileNow($, force, watch).finally(() => { usageWrite = null; });
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
// listing, run.json and execution.json come from the panel's own read when the root is the main checkout. D2: only for
// a conversation that joined the checkout; one there by its own work counts its own spend alone.
async function refreshRunInputs($: Engine, now: number): Promise<void> {
  if (anchor?.scope !== 'join') { runInputs = null; return; }
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
// band will show them) and the throttled write. Without them (the tick with the pane closed and nothing busy) no
// refresh has just read the band, so the write watches the execution itself (R2).
async function refreshUsage($: Engine, withRun: boolean): Promise<void> {
  try { await syncUsageStart($); } catch { /* no official cost */ }
  if (withRun) {
    try { await refreshRunInputs($, await nowMs($)); } catch { /* keep the last inputs */ }
  }
  await writeUsageFile($, false, !withRun);
}

// What the panel model gets for the Usage card: the live state, the run merged from the last read inputs.
function usageInput(): { session: UsageState; run: UsageState | null; officialUsd: number | null; officialOwnUsd: number | null } {
  let run: UsageState | null = null;
  try {
    if (runInputs && sessionId !== null) run = mergeForRun(runInputs.files, { session: sessionId, state: usage, baseline: runBaseline }, runInputs.since, runKeyNow() ?? null);
  } catch { /* this session only */ }
  return { session: usage, run, officialUsd, officialOwnUsd };
}

// Keeps a subagent that ended as finished: its run time from its known start, its description from the live entry or
// the consumption loop's label, its model from the loop.
function recordFinished(ran: Activity['subagents'][number], now: number): void {
  if (!Number.isFinite(ran.since) || !Number.isFinite(now)) return;
  const loop = usage.loops[ran.id];
  const description = ran.description ?? loop?.description;
  finished = pushFinished(freshFinished(finished, now), {
    id: ran.id, type: ran.type, seconds: Math.max(0, Math.floor((now - ran.since) / 1000)), at: now,
    ...(description ? { description: clip(String(description), LINE_MAX) } : {}),
    ...(loop?.model ? { model: loop.model } : {}),
  });
}

// $.agent.list(), each entry with its id, type, description, status and parent; null when it fails or answers junk.
async function agentList($: Engine): Promise<ListedAgent[] | null> {
  let list: unknown;
  try { list = await $.agent.list(); } catch { return null; }
  if (!Array.isArray(list)) return null;
  return list.flatMap((raw): ListedAgent[] => {
    if (!raw || typeof raw !== 'object') return [];
    const a = raw as { id?: unknown; type?: unknown; description?: unknown; status?: unknown; parentId?: unknown; teammateId?: unknown };
    if (typeof a.id !== 'string') return [];
    if (typeof a.teammateId === 'string' && a.teammateId) noteTeammate(a.id);
    return [{
      id: a.id, type: typeof a.type === 'string' ? a.type : '', description: typeof a.description === 'string' ? a.description : '',
      status: typeof a.status === 'string' ? a.status : '', parentId: typeof a.parentId === 'string' ? a.parentId : null,
    }];
  });
}

// $.agent.list() is the truth on each refresh; without it, event entries older than an hour are dropped. A teammate
// idle between turns waits: it is not gone (E-09). w8 M1: one spawned within LIST_GRACE_MS that no list named yet (it
// has no status of the list's) stays, as its link does.
function liveSubagents(now: number, list: ListedAgent[] | null): Activity['subagents'] {
  const fresh = activity.subagents.filter(s => now - s.since < SUBAGENT_TTL_MS);
  if (!list) return fresh;
  const since = new Map(fresh.map(s => [s.id, s.since]));
  const listed = new Set(list.map(a => a.id));
  const out: Activity['subagents'] = [];
  for (const a of list) {
    if (a.status !== 'running' && a.status !== 'pending' && a.status !== 'waiting' && a.status !== 'idle') continue;
    out.push({ id: a.id, type: a.type, ...(a.description ? { description: a.description } : {}), status: a.status, since: since.get(a.id) ?? now });
  }
  for (const s of fresh) if (!listed.has(s.id) && s.status === undefined && now - s.since <= LIST_GRACE_MS) out.push(s);
  // One that was running here and is gone from the list has ended: kept as finished.
  const live = new Set(out.map(s => s.id));
  for (const s of fresh) if (!live.has(s.id)) recordFinished(s, now);
  // An id that is running again is not also finished.
  finished = withoutRunning(finished, out);
  return out.slice(-MAX_ACTIVITY);
}

// What the agents list says, taken in by a refresh or a photo: the subagents and the links it names, and the usage loop
// of an agent agent.spawn did not label (lens loaded later, another spawn path) gets its type (w8 M1).
function adoptListed(listed: ListedAgent[] | null, now: number): void {
  const list = listed ? settledList(listed, now) : null;
  activity.subagents = liveSubagents(now, list);
  if (list) {
    links = syncListed(links, list, now, knownTasks(bandModel));
    for (const a of list) if (a.type && usage.loops[a.id]?.kind === 'unknown') labelLoop(usage, a.id, a.type, a.description || undefined);
  }
  links = pruneLinks(links, now);
}

async function buildPanel($: Engine): Promise<PanelModel> {
  const now = await nowMs($);
  // M1: /clear and an in-process resume forget the session id with the usage meter; it is read again here, so a write
  // before the next refresh (a turn starting, a tool call) never draws this session's own tasks as another session's.
  // The id is the new conversation's: after a resume, the resumed one's; never the one that is ending (R1).
  if (sessionId === null) {
    try { sessionId = await sessionIdNow($); } catch { /* nothing is own by its session */ }
    idRead($);
  }
  const subagents = activity.subagents.filter(s => now - s.since < SUBAGENT_TTL_MS);
  return buildPanelModel({
    band: roadmap, ...panelFiles, activity: { ...activity, subagents, finished: freshFinished(finished, now) }, now, usage: usageInput(), sessionId,
    links, ownTasks, wakeAt, focusAgent, locale: localeNow(), unreadable: readRefused ?? refused,
  });
}

// Keeps the band's model and redraws the band when it changed.
function keepBand($: Engine, model: PanelModel): void {
  // The band shows no finished-subagent times: they do not count as a change.
  const json = bandKey(model);
  if (json === bandJson) return;
  bandJson = json;
  bandModel = model;
  $.ui.invalidate('ui.render');
  void releaseBand($, model);
  void updateSurfaces($, model);
}

// Whether the pane is open, as last seen; a change moves the transcript's width where it docks, so the photos are laid
// out again (final review m-2).
// A closed pane forgets the agent it showed (carry 5): the photos and the band expand the default task again.
function notePane($: Engine, up: boolean): void {
  if (up === paneUp) return;
  paneUp = up;
  if (!up) { focusAgent = null; panePlacement = null; }
  if (photos.size) $.ui.invalidate('ui.render');
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

// Reads the files and the agents list, only while the pane is open (or `force`d, by a pane just opened); the promise is
// the read in progress, so a caller asked during one waits for it. w8 M3, review Minor 1: a forced one asked meanwhile is
// run once more after it (the read in progress may have looked before the pane opened); any other (the 10 s timer, a
// turn's end) is covered by the read in progress, and repeating it would read without pause while reads are slow.
let refreshRun: Promise<void> | null = null;
let refreshAgain = false;
function refreshPanel($: Engine, force = false): Promise<void> {
  if (refreshRun) {
    if (force) refreshAgain = true;
    return refreshRun;
  }
  refreshRun = (async () => {
    try {
      let forced = force;
      do {
        refreshAgain = false;
        await refreshPanelOnce($, forced);
        forced = true;
      } while (refreshAgain);
    } finally {
      refreshRun = null;
    }
  })();
  return refreshRun;
}

async function refreshPanelOnce($: Engine, force: boolean): Promise<void> {
  try {
    notePane($, await isPaneOpen($));
    if (!paneUp) stopPanelTimer();
    // With the pane closed the files are still read while there is activity, for the band: at the 30 s tick's pace.
    if (!paneUp && !busy && !force) return;
    if (paneUp) startPanelTimer($);
    // E-06: who looks, so the panel knows whose tasks are its own; null when the engine cannot say (or still names the
    // conversation that is ending, R1). Read before the anchor, which is this conversation's.
    if (sessionId === null) {
      try { sessionId = await sessionIdNow($); } catch { /* nothing is own by its session */ }
    }
    await ensureAnchor($);
    const now = await nowMs($);
    // Files read for a conversation that a /clear or a resume has since replaced are dropped.
    const epoch = anchorEpoch;
    const files = await loadPanelFiles($, now);
    if (epoch === anchorEpoch) panelFiles = files;
    // The roadmap section follows the waypoint project's files at the panel's pace (after the files: own work's needs
    // keep to the tasks they read).
    try { await readBand($); } catch { /* keep the last one */ }
    keepRunBaseline();
    // E-09: the agents list is the truth for what it lists; a workflow's agents live by their own turn.
    adoptListed(await agentList($), now);
    // The tools in flight of an agent that ended go with it.
    for (const id of [...agentTools.keys()]) if (!links.some(l => l.id === id && l.status !== 'done')) agentTools.delete(id);
    await refreshUsage($, true);
    await noteActivity($);
    if (!paneUp) { keepBand($, await buildPanel($)); return; }
    // A refresh writes at once when the last write is a second old; else the throttle gathers it.
    await requestPanelWrite($);
  } catch { /* ignore */ }
}

const TEXT = {
  es: {
    panel: 'Panel', panelOpened: 'Panel de progreso abierto.',
    panelWaiting: 'El panel lens está abierto pero aún no se muestra', nothing: 'Nada que mostrar todavía',
    moreRows: (n: number) => `↓ ${n} más · /lens foto`,
    bandHint: 'ctrl+x tab · banda',
    photoTasks: (n: number) => (n === 0 ? 'sin tareas' : n === 1 ? '1 tarea' : `${n} tareas`),
    subagentsN: (n: number) => `${n} ${n === 1 ? 'subagente' : 'subagentes'}`,
    toastAccepted: (task: string, round: number | null) => (round ? `${task} · aceptada en la ronda ${round}` : `${task} · aceptada`),
    toastVerdict: (task: string, action: string, counts: string) => `${task} · veredicto ${action}${counts ? ` · ${counts}` : ''}`,
    toastRound: (task: string, n: number) => `${task} · ronda ${n}`,
    toastIntegrated: (task: string, done: number, total: number) => `${task} integrada · ${done}/${total}`,
    runFinished: (done: number, total: number) => `Ejecución terminada: ${done}/${total} integradas`,
    runStopped: (why: string) => (why ? `Ejecución parada: ${why}` : 'Ejecución parada'),
    noTask: 'sin tarea en curso', track: 'frente', decision: 'decisión pendiente',
    sRoadmap: 'Roadmap', sSuperpowers: 'superpowers', sNow: 'Ahora', sTodos: 'Pendientes', sSubagents: 'Subagentes',
    sTasks: 'Tareas de Claude Code', fixRound: 'ronda', phase: 'Fase', done: 'hechas', open: 'abiertas', tool: 'herramienta', turn: 'turno',
    sExecution: 'Ejecución', manualRow: 'manual', modeSubagents: 'subagentes', modeSessions: 'sesiones', alive: 'viva', silent: 'sin señal', stopped: 'parada',
    queued: 'por integrar', orphans: 'huérfanas', conflictsLbl: 'en conflicto', blockedLbl: 'bloqueadas', integratedN: 'integradas',
    stage: { brief: 'brief', implement: 'implementar', validate: 'validar', verify: 'verificar', review: 'revisar', verdict: 'veredicto', integrate: 'integrar', execution: 'ejecución', triage: 'triaje', design: 'diseño', plan: 'plan', final: 'final' },
    sForge: 'forge', approve: 'Aprobar', reject: 'Rechazar', hoursLeft: (hours: number) => `quedan ${hours} h`, auto: 'auto',
    autoDecisions: (n: number) => `${n} ${n === 1 ? 'decisión automática' : 'decisiones automáticas'}`, autoMode: 'modo auto',
    staleLedger: 'sin cambios desde hace más de un día',
    sTasksInProgress: 'Tareas en curso', otherSession: 'otra sesión', validating: 'validando', integrating: 'integrando', skipped: 'omitida', noResult: 'sin resultado',
    accepted: 'aceptado', acceptedInRound: (n: number) => `aceptado en la ronda ${n}`,
    waitingOn: (n: number, wake: string | null) => `esperando a ${n} ${n === 1 ? 'subagente' : 'subagentes'}${wake ? ` · despierta en ${wake}` : ''}`,
    waitingLbl: 'en espera', cached: 'caché', reviewersLbl: 'revisan',
    sNeeds: 'Te toca',
    needKind: { 'review-question': 'pregunta de revisión', authorization: 'fusión por autorizar', 'untrusted-commands': 'confianza en los comandos', run: 'ejecución parada', question: 'pregunta', proposal: 'propuesta', 'design-approval': 'diseño por aprobar', surface: 'permiso de superficie' },
    needCoordinator: 'te toca en la conversación de la coordinadora', needConversation: 'en la conversación que preguntó', needRoadmap: 'en el roadmap', needUnverified: 'no se pudo leer',
    unreadable: (path: string, reason: string) => `no se puede leer ${path}: ${reason}`,
    needsN: (n: number) => `te toca ${n}`,
    pressEnter: 'Comando listo en el prompt: pulsa Enter',
    commandFailed: (why: string) => `lens no pudo responder a /lens: ${why}. Vuelve a probar; el motivo queda también en el log de depuración.`,
    outOfTime: 'se quedó sin tiempo', failedPlain: 'falló',
    briefs: 'briefs', cycle: 'ciclo', task: 'Tarea', proposals: 'Propuestas',
    sUsage: 'Consumo', effort: 'esfuerzo', thisSession: 'esta sesión', active: 'activo', sinceStart: 'desde el inicio', taskTime: 'tarea', run: 'ejecución', gMain: 'Sesión principal', gImpl: 'Implementadores', gReview: 'Revisores', gVerify: 'Verificación', blocked: 'bloqueada', gPlan: 'Planificación y scout', gOther: 'Otros subagentes', tracking: 'Seguimiento', withoutForge: 'Sin forge (estimado)', withoutForgeNote: 'orientativo: en una sola sesión el contexto crecería y costaría más, y no habría revisión; el extremo bajo supone que todo el seguimiento se releía en cada paso', forgeCosts: (usd: string, pct: number) => `forge cuesta +${usd} (+${pct} %)`, forgeSaves: (usd: string) => `forge ahorra −${usd}`, pricesAsOf: 'precios a', drift: 'precios o medición incompletos', various: 'varios', noReview: 'sin revisiones independientes', effortLevel: (e: string) => ({ low: 'bajo', medium: 'medio', high: 'alto', xhigh: 'muy alto', max: 'máximo' } as Record<string, string>)[e] ?? e,
  },
  en: {
    panel: 'Panel', panelOpened: 'Progress panel opened.',
    panelWaiting: 'The lens panel is open but not shown yet', nothing: 'Nothing to show yet',
    moreRows: (n: number) => `↓ ${n} more · /lens photo`,
    bandHint: 'ctrl+x tab · band',
    photoTasks: (n: number) => (n === 0 ? 'no tasks' : n === 1 ? '1 task' : `${n} tasks`),
    subagentsN: (n: number) => `${n} subagent${n === 1 ? '' : 's'}`,
    toastAccepted: (task: string, round: number | null) => (round ? `${task} · accepted in round ${round}` : `${task} · accepted`),
    toastVerdict: (task: string, action: string, counts: string) => `${task} · verdict ${action}${counts ? ` · ${counts}` : ''}`,
    toastRound: (task: string, n: number) => `${task} · round ${n}`,
    toastIntegrated: (task: string, done: number, total: number) => `${task} integrated · ${done}/${total}`,
    runFinished: (done: number, total: number) => `Execution finished: ${done}/${total} integrated`,
    runStopped: (why: string) => (why ? `Execution stopped: ${why}` : 'Execution stopped'),
    noTask: 'no task in progress', track: 'track', decision: 'decision pending',
    sRoadmap: 'Roadmap', sSuperpowers: 'superpowers', sNow: 'Now', sTodos: 'Todos', sSubagents: 'Subagents',
    sTasks: 'Claude Code tasks', fixRound: 'round', phase: 'Phase', done: 'done', open: 'open', tool: 'tool', turn: 'turn',
    sExecution: 'Execution', manualRow: 'manual', modeSubagents: 'subagents', modeSessions: 'sessions', alive: 'alive', silent: 'silent', stopped: 'stopped',
    queued: 'to integrate', orphans: 'orphaned', conflictsLbl: 'in conflict', blockedLbl: 'blocked', integratedN: 'integrated',
    stage: { brief: 'brief', implement: 'implement', validate: 'validate', verify: 'verify', review: 'review', verdict: 'verdict', integrate: 'integrate', execution: 'execution', triage: 'triage', design: 'design', plan: 'plan', final: 'final' },
    sForge: 'forge', approve: 'Approve', reject: 'Reject', hoursLeft: (hours: number) => `${hours}h left`, auto: 'auto',
    autoDecisions: (n: number) => `${n} automatic decision${n === 1 ? '' : 's'}`, autoMode: 'auto mode',
    staleLedger: 'unchanged for over a day',
    sTasksInProgress: 'Tasks in progress', otherSession: 'other session', validating: 'validating', integrating: 'integrating', skipped: 'skipped', noResult: 'no result',
    accepted: 'accepted', acceptedInRound: (n: number) => `accepted in round ${n}`,
    waitingOn: (n: number, wake: string | null) => `waiting on ${n} subagent${n === 1 ? '' : 's'}${wake ? ` · wakes in ${wake}` : ''}`,
    waitingLbl: 'waiting', cached: 'cached', reviewersLbl: 'reviewers',
    sNeeds: 'Waiting for you',
    needKind: { 'review-question': 'review question', authorization: 'merge to authorize', 'untrusted-commands': 'trust in the commands', run: 'stopped execution', question: 'question', proposal: 'proposal', 'design-approval': 'design to approve', surface: 'surface permission' },
    needCoordinator: "your turn in the coordinator's conversation", needConversation: 'in the conversation that asked', needRoadmap: 'on the roadmap', needUnverified: 'could not be read',
    unreadable: (path: string, reason: string) => `cannot read ${path}: ${reason}`,
    needsN: (n: number) => `waiting for you ${n}`,
    pressEnter: 'Command ready in the prompt: press Enter',
    commandFailed: (why: string) => `lens could not answer /lens: ${why}. Try it again; the reason is in the debug log too.`,
    outOfTime: 'it ran out of time', failedPlain: 'it failed',
    briefs: 'briefs', cycle: 'cycle', task: 'Task', proposals: 'Proposals',
    sUsage: 'Usage', effort: 'effort', thisSession: 'this session', active: 'active', sinceStart: 'since start', taskTime: 'task', run: 'run', gMain: 'Main session', gImpl: 'Implementers', gReview: 'Reviewers', gVerify: 'Verification', blocked: 'blocked', gPlan: 'Planning and scout', gOther: 'Other subagents', tracking: 'Tracking', withoutForge: 'Without forge (estimate)', withoutForgeNote: 'rough: in one session the context would grow and cost more, with no review; the low end assumes all the tracking was re-read on every step', forgeCosts: (usd: string, pct: number) => `forge costs +${usd} (+${pct}%)`, forgeSaves: (usd: string) => `forge saves −${usd}`, pricesAsOf: 'prices as of', drift: 'prices or measurement incomplete', various: 'mixed', noReview: 'no independent review', effortLevel: (e: string) => e,
  },
} as const;
type Texts = (typeof TEXT)[keyof typeof TEXT];

const textsFor = (locale: string | undefined): Texts => (locale === 'es' ? TEXT.es : TEXT.en);
const lensTexts = (): Texts => textsFor(localeNow());

// The language the person set in Claude Code (`language`), read once a session start, /clear or resume, for a panel
// whose band names none: with no anchor no plan is read for it (decision 3). A refused read, or another language, is
// English.
let uiLocale: 'es' | 'en' = 'en';
const SPANISH = /^(?:es(?![a-z])|español|espanol|spanish|castellano)/;
async function readUiLocale($: Engine): Promise<void> {
  let value: unknown;
  try { value = await $.settings.read({ key: 'language' }); } catch { value = undefined; }
  uiLocale = typeof value === 'string' && SPANISH.test(value.trim().toLowerCase()) ? 'es' : 'en';
}
// The plan's language when the band has one, as before; else the person's.
const localeNow = (): string => roadmap.locale ?? uiLocale;

// Opens the pane at the person's request (F-01): inline it asks for the rows its compact cards take (between 6 and a
// third of the screen), docked for 56 columns; both are requests the engine may not grant. Where it is not placed, a
// toast says why. w8 M3: the pane is asked for first and the command answers at once; the files are read after, so a
// slow or failing read never leaves /lens unanswered. With no model yet (the pane closed and nothing going on) the rows
// are those of the cards lens holds in memory; once the read is in, a pane still inline is asked for again with its
// cards' rows (carry 5, review Minor 5). An open that fails fails the command's hook, whose .catch says why. `inline`:
// whether the pane would sit inline as the command saw the screen (no dock outside fullscreen or under 110 columns).
async function openPanel($: Engine, inline: boolean): Promise<boolean> {
  // D4: the pane opening searches for the anchor again.
  anchorDirty = true;
  const first = bandModel === null;
  let model: PanelModel | null = bandModel;
  try { model ??= await buildPanel($); } catch { model = null; }
  const rows = panelRowsFor(model);
  const opened = await $.ui.open({ id: PANE, title: 'lens', rows, columns: DOCK_COLUMNS });
  if (!opened.isPlaced) {
    try { $.ui.toast(`${lensTexts().panelWaiting}: ${clip(opened.reason, 200)}`); } catch { /* the answer says it */ }
  }
  // The open pane is filled by this read, and gets its timer.
  const read = refreshPanel($, true);
  if (first) void read.then(() => askRowsAgain($, rows, inline));
  return opened.isPlaced;
}

// The rows an inline pane asks for: those its compact cards take at the terminal's width, between 6 and a third of it.
function panelRowsFor(model: PanelModel | null): number {
  const view = viewOf('terminal');
  let estimate = 0;
  try {
    const compact = panelLayout({ bodyColumns: view.columns ?? LINE_MAX, placement: 'inline' });
    if (model) estimate = buildCards(model, textsFor(model.locale), 0).reduce((n, card) => n + cardRows(card, compact), 0);
  } catch { estimate = 0; }
  return paneRows(estimate, view.rows);
}

// Review Minor 5: after the first read, an open pane drawn inline (or, before any drawing, one the command saw would
// sit inline) asks for its cards' rows when they are more than it asked for. The dock ignores rows, so it is not asked.
async function askRowsAgain($: Engine, asked: number, inline: boolean): Promise<void> {
  try {
    if (!bandModel || !(panePlacement === 'inline' || (panePlacement === null && inline))) return;
    if (!(await isPaneOpen($))) return;
    const rows = panelRowsFor(bandModel);
    if (rows > asked) await $.ui.open({ id: PANE, title: 'lens', rows, columns: DOCK_COLUMNS });
  } catch { /* the pane keeps its rows */ }
}

// Step 3 of §4.6: the photos `/lens` took, by number, at most PHOTOS_MAX: the cards as they were, never moving.
// Each keeps its full line: a row is drawn only when its text is that line, so a number reused after a reload never
// draws another photo's cards on an older row.
const photos = new Map<number, { text: string; cards: Card[] }>();
let photoCount = 0;

// Step 3 of §4.6: the files read once, the model and its cards built and kept under a new number; the command answers
// one line, so a model that reads command output pays for one line only. Nothing is written to $.state.
// Review Minor 3: how long /lens foto waits for its read; past it the photo is taken from what lens holds, and the read
// goes on for the next look.
const PHOTO_READ_MS = 5_000;

// What a photo reads: the band, the files and, carry 7, the agents list (with the pane closed nothing asked it, so a
// subagent that ended would be drawn as running). It never throws.
async function readForPhoto($: Engine, now: number): Promise<void> {
  if (sessionId === null) {
    try { sessionId = await sessionIdNow($); } catch { /* nothing is own by its session */ }
  }
  await ensureAnchor($);
  try {
    const epoch = anchorEpoch;
    const files = await loadPanelFiles($, now);
    if (epoch === anchorEpoch) panelFiles = files;
  } catch { /* the files read last */ }
  try { await readBand($); } catch { /* keep the last one */ }
  keepRunBaseline();
  try { adoptListed(await agentList($), now); } catch { /* the agents heard of */ }
}

// Waits for `work` up to `ms` on the engine's clock; whatever it has not done by then it goes on doing unwaited.
async function within($: Engine, work: Promise<void>, ms: number): Promise<void> {
  const wait: { timer: Timer | null } = { timer: null };
  const expiry = new Promise<void>(resolve => { wait.timer = $.clock.after(ms, () => resolve()); });
  try { await Promise.race([work.catch(() => undefined), expiry]); } finally { wait.timer?.cancel(); }
}

async function takePhoto($: Engine): Promise<string> {
  const now = await nowMs($);
  await within($, readForPhoto($, now), PHOTO_READ_MS);
  const model = await buildPanel($);
  keepBand($, model);
  const t = textsFor(model.locale);
  // Carry 7: the tasks going on, neither done nor stopped.
  const tasks = model.activities.filter(a => (a.kind === 'forge' || a.kind === 'workflow') && !a.done && !a.stopped).length;
  const n = ++photoCount;
  const text = photoText(n, now, t.photoTasks(tasks));
  keepPhoto(photos, n, { text, cards: buildCards(model, t, now) });
  return text;
}

// Step 4 of §4.6: the status line last set, the model the toasts compare with, when the last toast went and those
// waiting for their turn, the runs already notified, and the last forge.cjs call of this session (busy, above).
const TOAST_GAP_MS = 5_000;
const FORGE_HEARD_MS = 10 * 60_000;
let lastStatus: string | undefined;
let prevModel: PanelModel | null = null;
let primed = false;
let lastToastAt = -Infinity;
let toastQueue: string[] = [];
let toastTimer: Timer | null = null;
let toastPending = false;
const TOAST_QUEUE_MAX = 5;
const TOAST_CELLS = 200;
const notified = new Set<string>();
let forgeHeardAt: number | null = null;

// At most one toast every 5 s: what comes sooner waits and goes out with the rest, joined.
// The queue holds at most TOAST_QUEUE_MAX entries and the joined text TOAST_CELLS cells. `toastPending` is set before
// the first await, so concurrent calls neither add a second timer nor break the gap.
async function queueToasts($: Engine, texts: readonly string[]): Promise<void> {
  toastQueue = [...toastQueue, ...texts].slice(0, TOAST_QUEUE_MAX);
  if (toastPending) return;
  toastPending = true;
  try {
    const wait = lastToastAt + TOAST_GAP_MS - await nowMs($);
    if (wait > 0) {
      toastTimer = $.clock.after(wait, () => { toastTimer = null; toastPending = false; void flushToasts($); });
      return;
    }
    toastPending = false;
    await flushToasts($);
  } catch { toastPending = false; }
}
async function flushToasts($: Engine): Promise<void> {
  if (!toastQueue.length) return;
  const text = clipWidth(toastQueue.splice(0).join(' · '), TOAST_CELLS);
  lastToastAt = await nowMs($);
  try { $.ui.toast(text); } catch { /* nothing else to say */ }
}
// A status line left by the conversation before (a new session, a /clear) goes.
function clearStatus($: Engine): void {
  if (lastStatus === undefined) return;
  lastStatus = undefined;
  try { $.ui.status(undefined); } catch { /* the next model sets it again */ }
}

// Step 4 of §4.6, after each model the band keeps: the status line (outside fullscreen, or with fewer than 3 rows above
// the prompt, while this session has work of its own; set only when it changes), the toasts of what moved since the
// last model (none for the first one after a start or /clear) and the notification of a run of its own that ended.
// The status line alone: it depends on the view too, so a render that changes the view runs it again (pure, no reads).
// It is the terminal's line under the prompt, so the terminal's view decides it, whichever surface drew last (m-5).
function updateStatus($: Engine, model: PanelModel | null): void {
  try {
    const view = viewOf('terminal');
    const show = view.fullscreen === false || (view.maxRows !== null && view.maxRows < 3);
    const text = show && model ? statusText(model, textsFor(model.locale), runRoleOf(roadmap)) ?? undefined : undefined;
    if (text === lastStatus) return;
    lastStatus = text;
    try { $.ui.status(text); } catch { /* the next model tries again */ }
  } catch { /* the line keeps what it had */ }
}

async function updateSurfaces($: Engine, model: PanelModel): Promise<void> {
  try {
    const t = textsFor(model.locale);
    const role = runRoleOf(roadmap);
    updateStatus($, model);
    if (!primed) { primed = true; prevModel = model; return; }
    const moved = surfaceEvents(prevModel, model, role, t);
    prevModel = model;
    if (moved.toasts.length) await queueToasts($, moved.toasts);
    if (moved.ended && !notified.has(moved.ended.runId)) {
      notified.add(moved.ended.runId);
      let sent = false;
      try { sent = (await $.ui.notify(moved.ended.text).catch(() => null))?.isSent === true; } catch { sent = false; }
      if (!sent) await queueToasts($, [moved.ended.text]);
    }
  } catch { /* the surfaces keep what they had */ }
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
    clearStatus($);
    endedId = null;
    await readUiLocale($);
    try { await syncUsageStart($); } catch { /* counted from the first refresh that reads it */ }
    waypointBand = false;
    waypointLoaded = null;
    roadmap = noneBand();
    try { if (await read($, hidden)) await update($, hidden, () => false); } catch { /* ignore */ }
    try { await $.command.register({ name: 'lens', description: 'Show the lens progress panel', argumentHint: '[live|foto]', immediate: true }); } catch { /* ignore */ }
    // One timer per environment: a later session start replaces it rather than adding another.
    timer?.cancel();
    timer = $.clock.every(30000, () => { void tick($); });
    // A pane left open across a reload or a resume is filled at once, and only then is the panel timer started.
    stopPanelTimer();
    await refreshPanel($);
    return next(e);
  });

  on('session.end', async ($, e, next) => {
    // A turn still open when the session ends counts up to now.
    try { endTurn(usage, turnClock, await nowMs($)); syncTurn(); } catch { /* ignore */ }
    // The last usage file, whatever the 30 s pace says, after any write in flight.
    try {
      const u = await $.session.usage();
      if (u.startedAt === usageStartedAt) takeOfficial(u);
    } catch { /* keep the last cost */ }
    try { await writeUsageFile($, true); } catch { /* ignore */ }
    // `/clear` and an in-process resume go on under a new session id without a session.start: the meter starts over
    // (the next sync adopts the new start and id, and a resumed session continues its own file) and the timers keep
    // running, since the process does.
    if (e.reason === 'clear' || e.reason === 'resume') {
      // R1: from here on, a read of the ending conversation's id is not adopted.
      endedId = typeof e.sessionId === 'string' && e.sessionId ? e.sessionId : null;
      try { resetUsage(); } catch { /* ignore */ }
      // E-13: after /clear the new conversation starts with an empty panel: no todos, subagents or tools of the old one,
      // written once the end chain beneath has run.
      if (e.reason === 'clear') {
        try { resetPanel(); clearStatus($); } catch { /* ignore */ }
      }
      const r = await next(e);
      void afterSwitch($);
      return r;
    }
    timer?.cancel();
    timer = null;
    stopPanelTimer();
    writeTimer?.cancel();
    writeTimer = null;
    paneUp = false;
    return next(e);
  });

  // E-08: after a compaction the tracking gathered so far is no longer in context: it is not re-read from then on. w8 M1:
  // no session.compact hook tells it (cc-plugin-sec-default passes that event over where it is seated); the first main
  // request after it, carrying fewer messages than the one before, does (turn.step's messageCount; recordStep, usage.ts).

  // Steps 2 and 3 of §4.6: /lens opens the pane where it docks (fullscreen, 110 columns or more); elsewhere it leaves a
  // photo in the transcript, which keeps the live region small (F-15). /lens live (or pane) opens the pane anyway;
  // /lens foto (or photo) always takes the photo.
  // w8 M3: a hook that throws or outruns its budget is skipped, and then the engine runs /lens as registered, which has
  // no body («no command.run hook answered it»): the .catch answers instead, with the reason, and logs it for debugging.
  on('command.run', { command: 'lens' }, async ($, e) => {
    const t = lensTexts();
    if (lensMode(e.args, e.presentation) === 'photo') return { text: await takePhoto($) };
    const placed = await openPanel($, lensMode('', e.presentation) === 'photo');
    return { text: placed ? t.panelOpened : `${t.panelWaiting}.` };
  }).catch(($, _e, next) => {
    const t = lensTexts();
    const why = failureText(t, next.error);
    try { $.ui.log(`/lens failed (${String(next.error?.kind ?? 'throw')}): ${String(next.error?.message ?? '')}`, { to: 'debug' }); } catch { /* the answer says it */ }
    return { text: t.commandFailed(why) };
  });

  // Step 3 of §4.6: the row of a photo /lens took, drawn from module memory, still and compact: its line and its cards.
  // A line this module does not hold (after a reload, on another surface, or written by hand) stays the engine's.
  on('ui.render', { component: 'CommandOutput', props: { command: 'lens' } }, async ($, e, next) => {
    try {
      const n = photoId(e.props.text);
      const shot = n === null ? undefined : photos.get(n);
      if (!shot || shot.text !== e.props.text) return next(e);
      const ui = $.ui.resolve(e);
      const { Box, Text } = ui;
      const layout = panelLayout({ bodyColumns: transcriptColumns(e.surface, e.viewport), placement: 'inline' });
      // Carry 7: a surface that draws SVG and is not the terminal gets the SVG cards the pane draws there; the terminal
      // (and a surface without SVG) the still cells.
      const Svg = e.surface !== 'terminal' && 'Svg' in ui ? ui.Svg : null;
      const W = Math.max(240, Math.min(900, layout.cols * 8 - 8));
      return (
        <Box flexDirection="column" rowGap={Svg ? 1 : 0}>
          <Text dimColor>{e.props.text}</Text>
          {shot.cards.map((card, i) => {
            if (!Svg) return termCard({ Box, Text }, `photo-${n}-${i}`, card, layout);
            const { source, height } = cardSvg(card, W);
            return <Svg key={`photo-${n}-${i}`} source={source} alt={cardAlt(card)} width={W} height={height} />;
          })}
        </Box>
      );
    } catch {
      return next(e);
    }
  });

  // I-11: every hook that gates (ui.close, agent.spawn, tool.call) goes on when it fails.
  on('ui.close', async ($, e, next) => {
    const closed = await next(e);
    if (e.id === PANE) {
      notePane($, await isPaneOpen($));
      if (!paneUp) stopPanelTimer();
    }
    return closed;
  }).catch(($, e, next) => next(e));

  on('turn.start', async ($, e, next) => {
    try {
      startTurn(usage, turnClock, await nowMs($));
      syncTurn();
      void requestPanelWrite($);
    } catch { /* ignore */ }
    return next(e);
  });

  // A subagent's turn is not the main turn: it neither ends the main turn's clock nor reads the panel's files.
  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      // Every reason closes it: an abort or an API error also arrives here, so the clock never runs on.
      try { endTurn(usage, turnClock, await nowMs($)); } catch { turnClock.since = null; }
      syncTurn();
      void refreshPanel($);
    } else {
      // w8 M1: an agent's run is one turn, so its end ends it (a workflow's, which no agents list names, too, E-09); a
      // teammate goes idle instead. One not linked yet (its spawn not answered) is ended when it is.
      try {
        const id = e.agentId;
        const now = await nowMs($);
        void touch($);
        if (teammates.has(id)) { /* idle: the agents list says so */ }
        else if (links.some(l => l.id === id) || activity.subagents.some(s => s.id === id)) {
          endSubagent(id, now);
          void noteActivity($);
        } else {
          for (const [k, at] of pendingEnds) if (now - at > PENDING_END_MS) pendingEnds.delete(k);
          pendingEnds.delete(id);
          pendingEnds.set(id, now);
          while (pendingEnds.size > PENDING_ENDS_MAX) pendingEnds.delete(pendingEnds.keys().next().value!);
        }
        void requestPanelWrite($);
      } catch { /* ignore */ }
    }
    return next(e);
  });

  // Each model request, measured from its response (the stream passes through untouched).
  on('turn.step', async function* ($, e, next) {
    void touch($);
    const r = yield* next(e);
    void touch($);
    try {
      recordStep(usage, { agentId: e.agentId, model: e.model, effort: e.effort, messageCount: e.messageCount, usage: r?.usage ?? null });
      void requestPanelWrite($);
    } catch { /* ignore */ }
    return r;
  });

  // A subagent's loop gets its type and description when it is spawned, and lens keeps which task it works on (E-02):
  // the task its prompt names, else its parent's; a workflow's agents too, which no agents list names (E-09). It only
  // observes: the spawn goes on whatever lens makes of it. w8 M1: the spawn is where a subagent starts (a workflow's
  // agents show under their workflow, not among the subagents, which the agents list keeps).
  on('agent.spawn', async ($, e, next) => {
    const r = await next(e);
    try {
      if (r?.agentId) {
        labelLoop(usage, r.agentId, String(e.subagentType ?? 'unknown'), e.description);
        const wf = e.workflow;
        const now = await nowMs($);
        void touch($);
        if (e.isTeammate === true || r.teammateId) noteTeammate(r.agentId);
        if (!wf) startSubagent(r.agentId, String(e.subagentType ?? ''), typeof e.description === 'string' ? e.description : '', now);
        links = linkSpawn(links, {
          id: r.agentId, type: String(e.subagentType ?? ''), description: String(e.description ?? ''), prompt: typeof e.prompt === 'string' ? e.prompt : '',
          parentId: typeof e.parentAgentId === 'string' ? e.parentAgentId : null,
          workflow: wf && typeof wf.runId === 'string' ? { runId: wf.runId, index: Number(wf.agentIndex) || 0 } : null,
          now, resume: !!e.resume,
        }, knownTasks(bandModel));
        applyPendingEnd(r.agentId, now);
        void noteActivity($);
        void requestPanelWrite($);
      }
    } catch { /* ignore */ }
    return r;
  }).catch(($, e, next) => next(e));

  // The main loop's tool in flight and its todo list; a subagent's tool goes on its own agent (E-11). A forge.cjs call of
  // any loop names a task this session works on (E-06), and the main loop's ScheduleWakeup says when it wakes (E-11).
  on('tool.call', async ($, e, next) => {
    const mine = !e.agentId;
    const input = e as unknown as Record<string, unknown>;
    // A subagent's call is kept by its own id, so the first of two tools to return does not clear the other.
    const callId = typeof e.tool_use_id === 'string' && e.tool_use_id ? e.tool_use_id : null;
    void touch($);
    const started = await nowMs($);
    if (mine) {
      try {
        tools.delete(e.tool_use_id);
        tools.set(e.tool_use_id, { name: clip(String(e.tool), LINE_MAX), since: started });
        while (tools.size > MAX_ACTIVITY) tools.delete(tools.keys().next().value!);
        showTool();
        if (e.tool === 'TodoWrite') {
          activity.todos = Array.isArray(e.todos) ? e.todos.slice(0, MAX_TODOS) : e.todos;
          void noteActivity($);
        }
        void requestPanelWrite($);
      } catch { /* ignore */ }
    } else {
      try {
        const id = e.agentId!;
        if (callId) {
          const calls = agentTools.get(id) ?? new Map<string, { name: string; since: number }>();
          calls.delete(callId);
          calls.set(callId, { name: String(e.tool), since: started });
          while (calls.size > MAX_ACTIVITY) calls.delete(calls.keys().next().value!);
          agentTools.delete(id);
          agentTools.set(id, calls);
          while (agentTools.size > LINKS_MAX) agentTools.delete(agentTools.keys().next().value!);
          showAgentTool(id);
        } else links = setTool(links, id, { name: String(e.tool), since: started });
        void requestPanelWrite($);
      } catch { /* ignore */ }
    }
    try {
      const result = await next(e);
      // What the call says of this session is kept only once the engine ran it: a refused call records nothing.
      try {
        const answer = result as { deny?: unknown; isError?: unknown } | undefined;
        if (answer && typeof answer.deny !== 'string') {
          // E-06: a forge.cjs call of any loop names a task this session works on.
          if (e.tool === 'Bash') {
            const own = ownTaskOf(input.command);
            ownTasks = addOwnTask(ownTasks, own);
            // §4.6: a forge task this session works on keeps the tick reading, with no subagent nor todo.
            if (own) {
              forgeHeardAt = await nowMs($);
              void noteActivity($);
            }
            // D4: a waypoint or forge call may bind this conversation, start or join a run, or start a task of its own.
            if (own || trackingKind('Bash', input)) anchorDirty = true;
          }
          if (e.tool === 'Skill' && trackingKind('Skill', input)) anchorDirty = true;
          // w8 M1: a TaskCreate or TaskUpdate of any loop that ran moves the Claude Code tasks card.
          if (answer.isError !== true) {
            const cc = taskCall(activity.ccTasks, String(e.tool), input, (answer as { result?: unknown }).result);
            if (cc) { activity.ccTasks = cc; void requestPanelWrite($); }
          }
          // E-11: the engine clamps the delay to 60-3600 s; stop, or a wake-up that failed, leaves none.
          if (mine && e.tool === 'ScheduleWakeup') {
            const delay = typeof input.delaySeconds === 'number' && Number.isFinite(input.delaySeconds) ? input.delaySeconds : null;
            wakeAt = input.stop === true || delay === null || answer.isError === true ? null : started + Math.min(WAKE_MAX_S, Math.max(WAKE_MIN_S, delay)) * 1000;
          }
          if (e.tool === 'Write' || e.tool === 'Edit' || e.tool === 'MultiEdit') await noteOwnPath($, input.file_path);
        }
      } catch { /* ignore */ }
      // A main-loop waypoint or forge call is tracking: its input and result, about four characters a token.
      if (mine) {
        try {
          const kind = trackingKind(String(e.tool), input);
          if (kind) {
            const r = result as { text?: unknown; result?: unknown } | undefined;
            const out = typeof r?.text === 'string' ? r.text.length : (JSON.stringify(r?.result ?? '') ?? '').length;
            recordTracking(usage, kind, JSON.stringify(e).length + out);
          }
        } catch { /* ignore */ }
      }
      return result;
    } finally {
      void touch($);
      if (mine && tools.delete(e.tool_use_id)) {
        showTool();
        void requestPanelWrite($);
      }
      if (!mine) {
        const id = e.agentId!;
        if (callId) {
          const calls = agentTools.get(id);
          calls?.delete(callId);
          if (calls && !calls.size) agentTools.delete(id);
          showAgentTool(id);
        } else links = endTool(links, id, String(e.tool));
        void requestPanelWrite($);
      }
    }
  }).catch(($, e, next) => next(e));

  // The pane, as the engine seats it (F-01, F-08): docked from 56 columns in fullscreen, its cards framed; inline,
  // narrow or outside fullscreen, without a frame (F-07) and, inline, only what fits in its rows, «↓ N more» last. The
  // engine's own close mark (or ctrl+x x) closes it: ui.close, above, stops the writes. The agent the person looks at
  // expands its task (F-08).
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    try {
      noteRender($, e.surface, e.viewport, { docked: e.props.placement === 'dock' });
      if (e.surface === 'terminal') panePlacement = e.props.placement === 'dock' ? 'dock' : 'inline';
      updateStatus($, bandModel);
      const layout = panelLayout(e.props, e.viewport);
      if (layout.focusAgent !== focusAgent) {
        focusAgent = layout.focusAgent;
        void requestPanelWrite($);
      }
      const m = await read($, panel);
      const t = m ? textsFor(m.locale) : lensTexts();
      const nowMs = m?.waypoint?.current?.startedAt ? await $.clock.now() : 0;
      const proposals = (m?.proposals ?? []).filter(p => PROPOSAL_ID.test(p.id));
      const ui = $.ui.resolve(e);
      const { Box, Text, Button } = ui;
      // The desktop (and any surface that draws SVG but is not the terminal) gets SVG cards; the terminal, cells.
      const Svg = e.surface !== 'terminal' && 'Svg' in ui ? ui.Svg : null;
      const all = m ? buildCards(m, t, nowMs) : [];
      // The proposals take their own rows: their frame (2), their header (1) and three for each.
      const reserve = proposals.length ? 3 + 3 * proposals.length : 0;
      const avail = layout.rows === null ? null : Math.max(1, layout.rows - reserve);
      let fitted = Svg || avail === null ? { cards: all, hidden: 0 } : fitCards(all, { ...layout, rows: avail });
      let more = fitted.hidden;
      if (!Svg && avail !== null && fitted.cards.length) {
        // «↓ N more» takes the last row when there are two or more; with one row the card alone is drawn.
        const moreRow = fitted.hidden > 0 && avail >= 2;
        const room = moreRow ? avail - 1 : avail;
        const shown = fitted.cards.reduce((n, card) => n + cardRows(card, layout), 0);
        if (shown > room) {
          // fitCards keeps one card whole; where even that one exceeds the rows, it is clipped to them (marker «…») and
          // the rows cut count among the ones left out.
          const clipped = clipCard(fitted.cards[0]!, layout, room);
          fitted = { ...fitted, cards: [clipped] };
          more += shown - cardRows(clipped, layout);
        }
        if (!moreRow) more = 0;
      }
      const W = Math.max(240, Math.min(900, layout.cols * 8 - 8));
      const drawn = fitted.cards.map((card, i) => {
        if (!Svg) return termCard(ui as TermUI, `card-${i}`, card, layout);
        const { source, height } = cardSvg(card, W);
        return <Svg key={`card-${i}`} source={source} alt={cardAlt(card)} width={W} height={height} />;
      });
      return (
        <Box flexDirection="column" rowGap={Svg ? 1 : 0}>
          {drawn.length || proposals.length ? drawn : <Text dimColor>{t.nothing}</Text>}
          {proposals.length
            ? (
                <Box key="section-proposals" flexDirection="column" borderStyle="round" borderColor={PALETTE.yellow} paddingX={1}>
                  <Text bold color={PALETTE.yellow}>{`✧ ${t.proposals} · ${proposals.length}`}</Text>
                  {proposals.map(p => (
                    <Box key={`proposal-${p.id}`} flexDirection="column" marginTop={1}>
                      <Text bold wrap="truncate-end">{clip(p.title, layout.cols)}</Text>
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
          {more ? <Text key="more" dimColor>{t.moreRows(more)}</Text> : null}
        </Box>
      );
    } catch {
      return next(e);
    }
  });

  // The band above the prompt while there is activity and waypoint draws no band of its own (F-16): this session's tasks
  // in progress, or the run going on, with its count, the agents without a task and the spend, fitted to the width as
  // waypoint's band is (F-09, F-12); the bar and the task boxes only where there is room (wide). Its buttons have
  // letters, drawn plain outside fullscreen (F-06). Drawn from module memory: no file call, and the clock is read only
  // when the band takes the site from waypoint's (m-4). Its × closes it for what it is about (bandSubject).
  // The band is one instance per chain: drawing without next(e) hides the bands of the plugins beneath, so ours stacks over them.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e);
    noteRender($, e.surface, e.viewport, { maxRows: e.props.maxRows, body: e.props.bodyColumns });
    updateStatus($, bandModel);
    try {
      if (e.props.hasSurvey || !busy) return below;
      if (await waypointDraws($)) { waypointSeen = true; return below; }
      if (waypointSeen) {
        // waypoint's band just went (its × included): a second x within TAKEOVER_MS was meant for it.
        waypointSeen = false;
        void nowMs($).then(at => { takeoverAt = at; });
      }
      const subject = subjectOf(bandModel);
      if (await read($, hidden) && hiddenSubject === subject) return below;
      const ui = $.ui.resolve(e);
      const { Box, Button } = ui;
      const t = lensTexts();
      const fullscreen = e.viewport?.isFullscreen !== false;
      const cols = Number(e.props.bodyColumns) > 0 ? Math.floor(Number(e.props.bodyColumns)) : DEFAULT_COLUMNS;
      const maxRows = Number(e.props.maxRows) > 0 ? Number(e.props.maxRows) : 10;
      const plain = !fullscreen;
      const shape = lensBand(bandModel, t, activity.subagents.length);
      const buttonsWidth = 1 + controlWidth(t.panel, { plain, hotkey: 'p' }) + 1 + controlWidth('×', { plain, hotkey: 'x' });
      const boxes = shape.cells.slice(0, BAND_CELLS);
      const wide = bandLevel({ bodyColumns: cols, maxRows, fullscreen }) === 'wide' && boxes.length > 0;
      const extra = wide ? 1 + BAR_MIN + 1 + boxes.length * 2 : 0;
      const shown = fitParts(shape.parts, cols - ICON_COLUMNS - buttonsWidth - extra).shown;
      const barWidth = wide
        ? Math.max(BAR_MIN, Math.min(BAR_MAX, cols - ICON_COLUMNS - buttonsWidth - partsWidth(shown) - 1 - boxes.length * 2 - 1))
        : 0;
      // The Panel button runs /lens as the band measures the screen: the pane where it docks (fullscreen, 110 columns or
      // more), else the photo in the transcript (§4.6, steps 2 and 3).
      const screen = Number(e.viewport?.columns) > 0 ? Number(e.viewport?.columns) : cols + 5;
      const form = fullscreen && screen >= DOCK_MIN_COLUMNS ? 'live' : 'foto';
      const plainProp = plain ? { plain: true as const } : {};
      const buttons = [
        <Button key="panel" label={t.panel} hotkey="p" {...plainProp} onPress={() => { runLens($, form); }} />,
        <Button key="dismiss" label="×" role="dismiss" hotkey="x" {...plainProp} onPress={() => { void closeBand($, subject); }} />,
      ];
      const icon = SECTION_ICON[shape.section];
      const hue = SECTION_HUE[shape.section];
      if (e.surface !== 'terminal' && 'Svg' in ui) {
        const { Svg } = ui;
        const W = Math.max(200, Math.min(1600, cols * 8 - 130));
        const title = joinParts(shown);
        const { source, height } = bandSvg({ W, icon, title, detail: '', hue, ratio: shape.ratio, label: '', moving: true, cells: shape.cells });
        return (
          <Box flexDirection="column">
            <Box flexDirection="row" alignItems="center" columnGap={1}>
              <Svg source={source} alt={title} width={W} height={height} />
              {buttons}
            </Box>
            {below}
          </Box>
        );
      }
      return (
        <Box flexDirection="column">
          <Box key="band-row" flexDirection="row" columnGap={1}>
            {termBand(ui as TermUI, { icon, hue, spin: shape.spin, parts: shown, bar: wide ? { ratio: shape.ratio, width: barWidth, moving: true } : null, cells: wide ? boxes : [] })}
            <Box flexDirection="row" columnGap={1} flexShrink={0}>{buttons}</Box>
          </Box>
          {below}
        </Box>
      );
    } catch {
      return below;
    }
  });

  // F-06, step 1 of §4.6: outside fullscreen, at the end of the hint line, how to reach the band's letters, while lens's
  // band is up (carry 3: from its state, not its last drawing) and the line has no tail of its own.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    try {
      if (e.viewport?.isFullscreen === false && !e.props.tail && await bandUp($)) return next({ ...e, props: { ...e.props, tail: lensTexts().bandHint } });
    } catch { /* the engine's line */ }
    return next(e);
  });

  // Step 4 of §4.6: while a turn runs, the spinner names the task of this session it is on, unless the engine has a
  // message of its own; forge's auto mode and the infinite run show as mode labels, each once.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    try {
      if (e.props.message === null) {
        const message = spinnerText(bandModel, bandModel ? textsFor(bandModel.locale) : lensTexts());
        if (message) return next({ ...e, props: { ...e.props, message } });
      }
    } catch { /* the engine's line */ }
    return next(e);
  });

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    try {
      const extra = modeLabels(bandModel).filter(x => !e.props.modes.includes(x));
      if (extra.length) return next({ ...e, props: { ...e.props, modes: [...e.props.modes, ...extra] } });
    } catch { /* the engine's labels */ }
    return next(e);
  });
};
