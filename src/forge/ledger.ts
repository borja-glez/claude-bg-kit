import { appendFileSync, closeSync, existsSync, fstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deriveStatus, deriveStatuses, normalizeStatus, statusKey, type ForgeStatus, type StatusMap } from '../lib/forge-status.js';
import { isSafeId, parseExecution, type ExecutionState } from '../lib/execution-state.js';
import { claudeSessionId, type SessionEnv } from '../lib/claude-session.js';
import { attribute, isTask, projectOf, stampEvent } from './task-ref.js';
import { mainCheckoutFrom } from '../lib/main-checkout.js';
import { samePath } from '../lib/worktree.js';

export const LEDGER_KINDS = ['triage', 'phase', 'agent', 'validate', 'verdict', 'round', 'ruling', 'cycle', 'proposal', 'verify', 'verify-skip', 'decision'] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];
export interface LedgerEvent { ts: string; kind: LedgerKind; task?: string; [key: string]: unknown }

const GITIGNORE = '*\n!.gitignore\n!config.yaml\n!verify/\n!verify/*.md\n';
// What forge 0.5.x wrote; upgraded in place so surfaces reach git. Any other content is the user's and stays.
const GITIGNORE_05 = '*\n!.gitignore\n!config.yaml\n';

const forgePath = (root: string) => path.join(root, '.forge');
const ledgerFile = (root: string) => path.join(forgePath(root), 'ledger.jsonl');
export const statusFile = (root: string) => path.join(forgePath(root), 'status.json');

/**
 * D-10: the directory whose ledger records an event of `root`: the main checkout when `root` is one of forge's task
 * worktrees (`<main>/.claude/worktrees/task-*`, told by its .git file, without calling git), else `root` itself.
 */
export function ledgerRoot(root: string): string {
  const name = path.basename(path.resolve(root));
  if (!name.startsWith('task-')) return root;
  let text: string;
  try { text = readFileSync(path.join(root, '.git'), 'utf8'); } catch { return root; }
  const main = mainCheckoutFrom(path.resolve(root), text);
  return samePath(path.join(main, '.claude', 'worktrees', name), root) ? main : root;
}

/** C5: the folder of the statuses of a checkout, one file per task, `<project>__<T>.json` or `<T>.json`. */
export const statusDir = (root: string) => path.join(forgePath(root), 'status');
/** C5: past this many status files the oldest go, down to STATUS_FILES_KEEP; a reader reads at most this many. */
export const STATUS_FILES_MAX = 200;
export const STATUS_FILES_KEEP = 150;
/** A status is a few hundred bytes: one above this is not read. */
const STATUS_FILE_MAX = 64 * 1024;

export function forgeDir(root: string): string {
  const dir = forgePath(root);
  mkdirSync(dir, { recursive: true });
  const ignore = path.join(dir, '.gitignore');
  if (!existsSync(ignore)) writeFileSync(ignore, GITIGNORE);
  else {
    try { if (readFileSync(ignore, 'utf8').replace(/\r\n/g, '\n') === GITIGNORE_05) writeFileSync(ignore, GITIGNORE); } catch { /* leave it */ }
  }
  return dir;
}

// True when the file is non-empty and its last byte is not a newline. Reads only that byte.
export function endsMidLine(file: string): boolean {
  if (!existsSync(file)) return false;
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    if (!size) return false;
    const buf = Buffer.alloc(1);
    return readSync(fd, buf, 0, 1, size - 1) === 1 && buf[0] !== 0x0a;
  } finally { closeSync(fd); }
}

/** C4: what one command stamps its events with (cli/run.ts sets it): Claude's session from the command's environment (a
 *  test passes {}), and the project its --project or --dir names; without one, the ledger's attribution decides. */
export interface EventContext { env?: SessionEnv; project?: string | null }
let context: EventContext = {};

/** Runs `fn` with the context every event it appends is stamped with. What `ctx` leaves out is the enclosing context's:
 *  a command a swarm step runs that names no project keeps the step's (the run's). Sync only: the context is a module
 *  variable put back when `fn` returns, so what an async `fn` appends after its first await is not stamped with it. */
export function withEventContext<T>(ctx: EventContext, fn: () => T): T {
  const prev = context;
  context = { ...prev, ...ctx };
  try { return fn(); } finally { context = prev; }
}

/** The project the context gives an event of `task` that names none: its --project or --dir, else (none, or one that is
 *  not a safe id) the ledger's. */
const contextProject = (events: () => readonly LedgerEvent[], task: string): string | null =>
  context.project === null || isSafeId(context.project) ? context.project : projectOf(events(), task);

/** C4: the event of `root` as the ledger of `target` (ledgerRoot) keeps it, with session, runId and project when they
 *  apply and it lacks them. Never throws. */
function stamped(root: string, target: string, event: LedgerEvent): LedgerEvent {
  try {
    const task = typeof event.task === 'string' ? event.task : null;
    let exec: ExecutionState | null = null;
    if (task && event.runId === undefined) {
      let gitText: string | null = null;
      try { gitText = readFileSync(path.join(target, '.git'), 'utf8'); } catch { gitText = null; }
      const main = mainCheckoutFrom(path.resolve(target), gitText);
      try { exec = parseExecution(readFileSync(path.join(main, '.forge', 'execution.json'), 'utf8')); } catch { exec = null; }
    }
    // The event's project: the one it names, else the command's or the ledger's (attribute's order). A triage without a
    // project opens a loose task's attribution: it is never stamped with an earlier plan's.
    const project = !task ? null : isSafeId(event.project) ? event.project
      : event.kind === 'triage' ? null : contextProject(() => readEvents(root), task);
    // D-08: a run's id goes only to its own tasks' events: a plan run's project, or a loose task for an ephemeral run.
    // Another plan's task of the same id is not the run's.
    const ofRun = exec && (exec.kind === 'plan' ? project === exec.project : project === null) ? exec : null;
    return stampEvent(event, { session: context.env ? claudeSessionId(null, context.env) : null, exec: ofRun, project });
  } catch { return event; }
}

export function appendEvent(root: string, event: LedgerEvent): void {
  // D-10: a member's events go to the main checkout's ledger, where the coordinator, stats and the roadmap read them.
  const target = ledgerRoot(root);
  forgeDir(target);
  if (target !== root) forgeDir(root);
  const file = ledgerFile(target);
  // A line left half-written by a crash must not swallow the next event. The whole line is one append (O_APPEND), so
  // the member and the coordinator writing the same ledger at once never interleave their lines.
  const e = stamped(root, target, event);
  appendFileSync(file, (endsMidLine(file) ? '\n' : '') + JSON.stringify(e) + '\n');
  // C5: one status per task beside the ledger it follows (a member's reach the main checkout, D-10), with the alias
  // status.json; a forge task worktree also keeps its own status.json as wave 2 left it, for an older lens of a member.
  updateStatus(target, e);
  if (target !== root) updateWorktreeStatus(root, e);
}

/** Appends a phase event unless the task's last phase event already names that phase for the same brief (C4: a stage
 *  is logged once, whether review-prep or `swarm task`, which names no brief, logs it first). Returns whether it appended. */
export function appendPhase(root: string, event: LedgerEvent & { task: string; phase: string }): boolean {
  // D-08: the task's last phase event of its own project (ids repeat between plans). An unsafe project counts as none,
  // as attribute reads it: the phase belongs to the project the command names (C4: the one appendEvent stamps it with),
  // else to the one the ledger gives the task.
  const events = readEvents(root);
  const owner = attribute(events);
  const project = isSafeId(event.project) ? event.project : contextProject(() => events, event.task);
  const last = events.filter(e => e.kind === 'phase' && isTask(e, event.task) && owner(e) === project).at(-1);
  if (last && last.phase === event.phase && (last.brief === undefined || event.brief === undefined || last.brief === event.brief)) return false;
  appendEvent(root, event);
  return true;
}

// The status.json of a forge task worktree, as before C5: one status following each of its events, for an older lens
// of a member. A missing or corrupt one starts over from the event; any failure leaves the append done.
function updateWorktreeStatus(root: string, event: LedgerEvent): void {
  try {
    const file = statusFile(root);
    let prev: ForgeStatus | null = null;
    try { prev = normalizeStatus(JSON.parse(readFileSync(file, 'utf8'))); } catch { /* none yet, or corrupt */ }
    const next = deriveStatus(prev, event);
    if (!next || next === prev) return;
    writeJsonFile(file, next);
  } catch { /* the ledger is the record; the status is a convenience */ }
}

// Through a temporary file and a rename, so a reader never sees half of it. (Duplicates writeJsonAtomic of jobs.ts, which
// imports this module: importing it here would be a cycle.)
function writeJsonFile(file: string, value: unknown): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value) + '\n');
  renameSync(tmp, file);
}

/** One status file, or null when it is missing, over STATUS_FILE_MAX, not JSON or not a status. */
function readStatusFile(file: string): ForgeStatus | null {
  try {
    if (statSync(file).size > STATUS_FILE_MAX) return null;
    return normalizeStatus(JSON.parse(readFileSync(file, 'utf8')));
  } catch { return null; }
}

/** A status file with its key; the key comes from the content, never from the file name. Null when it is not a status. */
function keyedStatus(file: string): [string, ForgeStatus] | null {
  const st = readStatusFile(file);
  const key = st ? statusKey(st.task, st.project) : null;
  return st && key ? [key, st] : null;
}

/** The regular *.json files of the status folder (a directory with such a name is junk, not a status). */
function jsonNames(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).filter(d => d.isFile() && d.name.endsWith('.json')).map(d => d.name);
}

/** The status files an event of `task` may reach: <T>.json and *__<T>.json and, for a brief id <T>-<n>, those of <T>. */
function candidates(names: readonly string[], task: string): string[] {
  const ids = [task, /^(.+)-\d{1,4}$/.exec(task)?.[1]].filter((s): s is string => !!s);
  return names.filter(n => ids.some(t => n === `${t}.json` || n.endsWith(`__${t}.json`)));
}

/**
 * C5: before the folder's first status, the status.json of an older forge becomes its task's file, so a task in
 * progress keeps what it knew. Returns the folder's file names.
 */
function migrate(root: string): string[] {
  mkdirSync(statusDir(root), { recursive: true });
  const old = keyedStatus(statusFile(root));
  if (!old) return [];
  writeJsonFile(path.join(statusDir(root), `${old[0]}.json`), old[1]);
  return [`${old[0]}.json`];
}

/** A leftover temporary file (a crash between write and rename) is removed after this long. */
const TMP_STALE_MS = 10 * 60_000;

/**
 * C5: past STATUS_FILES_MAX files, the oldest by lastAt (else by mtime; a tie goes by name) go, down to STATUS_FILES_KEEP.
 * `keep` (the status that just changed) never goes, whatever its lastAt; a future lastAt ranks like any other. Stale
 * *.tmp leftovers go too. Each removal is its own try: one that fails leaves the rest done.
 */
function prune(root: string, keep: string): void {
  const dir = statusDir(root);
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (!d.isFile() || !d.name.endsWith('.tmp')) continue;
    const file = path.join(dir, d.name);
    try { if (Date.now() - statSync(file).mtimeMs > TMP_STALE_MS) rmSync(file, { force: true }); } catch { /* next */ }
  }
  const files = jsonNames(dir).map(n => {
    const file = path.join(dir, n);
    let at = Date.parse(readStatusFile(file)?.lastAt ?? '');
    if (!Number.isFinite(at)) { try { at = statSync(file).mtimeMs; } catch { at = 0; } }
    return { name: n, file, at };
  });
  if (files.length <= STATUS_FILES_MAX) return;
  files.sort((x, y) => x.at - y.at || (x.name < y.name ? -1 : 1));
  const doomed = files.filter(f => f.name !== keep).slice(0, files.length - STATUS_FILES_KEEP);
  for (const f of doomed) { try { rmSync(f.file, { force: true }); } catch { /* next */ } }
}

// C5: .forge/status/<key>.json follows the ledger one event at a time, so readers (lens, the route hint) never read the
// whole ledger. Only the statuses the event may reach are read (one or two small files), deriveStatuses applies it to its
// task alone, and the changed status is written with the alias status.json (the task that changed last). A corrupt or
// oversized status starts over from the event; any failure here leaves the append done.
function updateStatus(root: string, event: LedgerEvent): void {
  try {
    if (typeof event.task !== 'string' || !event.task) return;
    const dir = statusDir(root);
    let names: string[];
    try { names = jsonNames(dir); } catch { names = migrate(root); }
    // Null-prototype, so a task named __proto__ is an ordinary key.
    const map = Object.create(null) as StatusMap;
    for (const n of candidates(names, event.task)) {
      const one = keyedStatus(path.join(dir, n));
      if (one) map[one[0]] = one[1];
    }
    const { map: next, changed } = deriveStatuses(map, event);
    if (!changed) return;
    mkdirSync(dir, { recursive: true });
    writeJsonFile(path.join(dir, `${changed}.json`), next[changed]);
    writeJsonFile(statusFile(root), next[changed]);
    if (names.length + (names.includes(`${changed}.json`) ? 0 : 1) > STATUS_FILES_MAX) prune(root, `${changed}.json`);
  } catch { /* the ledger is the record; the status is a convenience */ }
}

/**
 * C5: every task's status of a checkout, by key (at most STATUS_FILES_MAX files; one that does not read or does not
 * validate is left out). Without .forge/status/ (an older forge), the alias status.json alone.
 */
export function readStatuses(root: string, opts: { maxAgeMs?: number; now?: number } = {}): StatusMap {
  const out = Object.create(null) as StatusMap;
  // M6: with maxAgeMs, a file whose mtime is older (by `now`, the clock's now by default) is skipped before it is read.
  const now = opts.now ?? Date.now();
  const read = (file: string): [string, ForgeStatus] | null => {
    if (opts.maxAgeMs !== undefined) {
      try { if (now - statSync(file).mtimeMs > opts.maxAgeMs) return null; } catch { return null; }
    }
    return keyedStatus(file);
  };
  let names: string[];
  try { names = jsonNames(statusDir(root)).sort().slice(0, STATUS_FILES_MAX); } catch {
    const alias = read(statusFile(root));
    if (alias) out[alias[0]] = alias[1];
    return out;
  }
  for (const n of names) {
    const one = read(path.join(statusDir(root), n));
    if (one) out[one[0]] = one[1];
  }
  return out;
}

export function readStatus(root: string): ForgeStatus | null {
  try { return normalizeStatus(JSON.parse(readFileSync(statusFile(root), 'utf8'))); } catch { return null; }
}

export function readEvents(root: string): LedgerEvent[] {
  const target = ledgerRoot(root);
  if (target === root) return present(readLedger(root).events);
  // D-10: a task worktree's own ledger holds what it wrote before its events went to the main checkout's: read first.
  // A line both hold (copied over) is one event: the main ledger's copy is left out, once per copy the worktree has.
  const own = readLedger(root);
  return present([...own.events, ...notIn(readLedger(target), own.lines)]);
}

/** The events of `of` whose line `other` lacks: a line both hold counts once per copy `other` has (readEvents' rule). */
function notIn(of: Ledger, other: readonly string[]): (LedgerEvent | null)[] {
  const left = new Map<string, number>();
  for (const line of other) left.set(line, (left.get(line) ?? 0) + 1);
  return of.events.filter((_, i) => {
    const n = left.get(of.lines[i]) ?? 0;
    if (n) left.set(of.lines[i], n - 1);
    return !n;
  });
}

/**
 * The events of `worktree`'s own ledger that the ledger of `main` lacks, by readEvents' rule: what removing that
 * worktree would lose (a member's events from before D-10, or from a worktree ledgerRoot does not tell as forge's).
 */
export function unmergedEvents(worktree: string, main: string): LedgerEvent[] {
  const own = readLedger(worktree);
  return own.lines.length ? present(notIn(own, readLedger(main).lines)) : [];
}

/** A ledger file as read: its non-empty lines, trimmed, and each one's event (null for a line that is none). */
interface Ledger { lines: string[]; events: (LedgerEvent | null)[] }
/** What readLedger kept of a file: the ledger, and the size, mtime and last bytes it was read at. */
interface Kept extends Ledger { size: number; mtimeMs: number; tail: Buffer }
const TAIL_BYTES = 256;
const KEPT_FILES = 32;
const kept = new Map<string, Kept>();
/** Carry 6: how often readLedger read a file whole, and how often only what was appended to it. For its tests. */
export const ledgerReads = { whole: 0, appended: 0 };

const present = (events: readonly (LedgerEvent | null)[]): LedgerEvent[] => events.filter((e): e is LedgerEvent => e !== null);
const lineEvent = (line: string): LedgerEvent | null => {
  try {
    const e = JSON.parse(line);
    return e && typeof e === 'object' && typeof e.ts === 'string' && (LEDGER_KINDS as readonly string[]).includes(e.kind)
      && ['undefined', 'string'].includes(typeof e.task) ? e : null;
  } catch { return null; /* a half-written line */ }
};
const splitLines = (text: string): string[] => text.split('\n').map(l => l.trim()).filter(Boolean);

/**
 * `root`'s ledger, kept per process (carry 6): a command stamps each event it appends with the ledger's attribution
 * (stamped) and appendPhase reads it too, so a file is parsed once per change. Unchanged (the same size, mtime and last
 * bytes) it is the one kept; grown from a whole last line, with the bytes it ended with still there, only what was
 * appended is read; any other change reads it whole.
 */
function readLedger(root: string): Ledger {
  const file = ledgerFile(root);
  let fd: number;
  try { fd = openSync(file, 'r'); } catch { kept.delete(file); return { lines: [], events: [] }; }
  try {
    const { size, mtimeMs } = fstatSync(fd);
    const bytes = (pos: number, len: number): Buffer => {
      const b = Buffer.alloc(Math.max(0, len));
      let got = 0;
      while (got < len) {
        const n = readSync(fd, b, got, len - got, pos + got);
        if (!n) break;
        got += n;
      }
      return b.subarray(0, got);
    };
    const tailOf = (end: number) => bytes(Math.max(0, end - TAIL_BYTES), Math.min(end, TAIL_BYTES));
    const was = kept.get(file);
    const keep = (ledger: Ledger): Ledger => {
      kept.delete(file);
      if (kept.size >= KEPT_FILES) kept.delete(kept.keys().next().value!);
      kept.set(file, { ...ledger, size, mtimeMs, tail: tailOf(size) });
      return ledger;
    };
    if (was && was.size === size && was.mtimeMs === mtimeMs && tailOf(size).equals(was.tail)) return was;
    if (was && size > was.size && was.tail.at(-1) === 0x0a && tailOf(was.size).equals(was.tail)) {
      ledgerReads.appended++;
      const added = splitLines(bytes(was.size, size - was.size).toString('utf8'));
      return keep({ lines: [...was.lines, ...added], events: [...was.events, ...added.map(lineEvent)] });
    }
    ledgerReads.whole++;
    // Up to the size it was read at: a line appended meanwhile is read with the next change.
    const lines = splitLines(bytes(0, size).toString('utf8'));
    return keep({ lines, events: lines.map(lineEvent) });
  } finally { closeSync(fd); }
}
