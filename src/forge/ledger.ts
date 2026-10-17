import { appendFileSync, closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deriveStatus, normalizeStatus, type ForgeStatus } from '../lib/forge-status.js';
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
  // D-10: a member's events go to the main checkout's ledger, where the coordinator, stats and the roadmap read them;
  // its status.json stays in its worktree, for its own lens.
  const target = ledgerRoot(root);
  forgeDir(target);
  if (target !== root) forgeDir(root);
  const file = ledgerFile(target);
  // A line left half-written by a crash must not swallow the next event. The whole line is one append (O_APPEND), so
  // the member and the coordinator writing the same ledger at once never interleave their lines.
  const e = stamped(root, target, event);
  appendFileSync(file, (endsMidLine(file) ? '\n' : '') + JSON.stringify(e) + '\n');
  updateStatus(root, e);
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

// .forge/status.json follows the ledger one event at a time, so readers (lens) never read the whole ledger.
// A missing or corrupt status starts over from this event; any failure here leaves the append done.
function updateStatus(root: string, event: LedgerEvent): void {
  try {
    const file = statusFile(root);
    let prev: ForgeStatus | null = null;
    try { prev = normalizeStatus(JSON.parse(readFileSync(file, 'utf8'))); } catch { /* none yet, or corrupt */ }
    const next = deriveStatus(prev, event);
    if (!next || next === prev) return;
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(next) + '\n');
    renameSync(tmp, file);
  } catch { /* the ledger is the record; the status is a convenience */ }
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
