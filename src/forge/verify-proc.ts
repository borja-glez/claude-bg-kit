// K2-03, K2-20: the processes a verify agent starts, and stopping them safely. FORGE verify-spawn starts each one
// detached under a small node wrapper (its own process group on POSIX) that records the command's exit code, and keeps
// [{pid, startedAt, image}] in logs/<n>.pid.json, one file per spawn. verify-cleanup reads those and pids.json (the older
// list of integers the agent wrote) and stops a pid only while it is still that process: the same image, started within
// 2 s of the recorded time (a pid of the older list: started before pids.json was last written). A pid whose identity
// cannot be read now is never stopped. On POSIX it sends SIGTERM to the group and the descendants and SIGKILL after 5 s
// to what still shows its identity; on Windows, taskkill /T /F.
import { execFileSync, spawn } from 'node:child_process';
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, utimesSync } from 'node:fs';
import path from 'node:path';
import { pidAlive, sleepSync } from './pid.js';
import { writeAtomic } from './execution.js';

export interface PidEntry { pid: number; startedAt?: number; image?: string }
export interface ProcInfo { startedAt: number; image: string }
export interface ProcDeps {
  platform: NodeJS.Platform;
  /** When the process started (ms) and its image's name; null when that cannot be read. */
  procInfo: (pid: number) => ProcInfo | null;
  /** Alive, and not a zombie waiting for its parent to collect it. */
  alive: (pid: number) => boolean;
  /** POSIX: the direct children of a pid. */
  children: (pid: number) => number[];
  /** POSIX: the process group of a pid; null when unknown. */
  pgid: (pid: number) => number | null;
  /** A signal to a pid, or to its group with -pid; false when nothing received it. */
  signal: (target: number, sig: 'SIGTERM' | 'SIGKILL') => boolean;
  /** Windows: taskkill /T /F of the pid's tree; false when it failed. */
  taskkill: (pid: number) => boolean;
  sleep: (ms: number) => void;
  now: () => number;
}
/** What verify-cleanup did with each recorded pid. `unknown`: alive, but its identity cannot be read now, so left alone. */
export interface Cleanup { killed: number[]; gone: number[]; reused: number[]; unknown: number[] }

/** How far the start a process shows may be from the recorded one: ps gives whole seconds. */
export const START_TOLERANCE_MS = 2000;
/** How long verify-cleanup waits after SIGTERM before SIGKILL. */
export const TERM_GRACE_MS = 5000;
/** How long verify-spawn waits to tell a command that could not start from one that runs. */
export const SPAWN_WAIT_MS = 1000;
const TAIL_BYTES = 2000;
/** The image the wrapper (node) shows, for its record when its identity could not be read at the spawn. */
const NODE_IMAGE = path.basename(process.execPath).replace(/\.exe$/i, '');

const quiet = (cmd: string, args: string[]): string | null => {
  try { return execFileSync(cmd, args, { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }); } catch { return null; }
};

/** `ps -o etime=`: `[[dd-]hh:]mm:ss` in seconds; null when it is not that. */
export function parseEtime(s: string): number | null {
  const m = /^\s*(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)\s*$/.exec(s);
  if (!m) return null;
  const [, d, h, mm, ss] = m;
  return Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(mm) * 60 + Number(ss);
}

/** One line of `ps -o etime= -o comm= -p <pid>`, read at `now` (ms): when it started and its image's base name. */
export function parsePsLine(line: string, now: number): ProcInfo | null {
  const m = /^\s*(\S+)\s+(.+?)\s*$/.exec(line);
  const secs = m ? parseEtime(m[1]) : null;
  return m && secs !== null ? { startedAt: now - secs * 1000, image: path.basename(m[2]) } : null;
}

/** The two lines the PowerShell query prints: StartTime in UTC in round-trip format, then ProcessName. */
export function parsePowershell(out: string): ProcInfo | null {
  const [when, name] = out.split(/\r?\n/).map(s => s.trim());
  const t = Date.parse((when ?? '').replace(/(\.\d{3})\d+/, '$1'));
  return Number.isFinite(t) && name ? { startedAt: t, image: name } : null;
}

/** pids.json: a list of {pid, startedAt?, image?} or, as forge ≤ 0.25 had the agent write it, of integers. */
export function parsePids(text: string | null): PidEntry[] {
  let raw: unknown;
  try { raw = JSON.parse(text ?? ''); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  const out: PidEntry[] = [];
  for (const x of raw) {
    if (Number.isInteger(x) && (x as number) > 0) { out.push({ pid: x as number }); continue; }
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    if (!Number.isInteger(o.pid) || (o.pid as number) <= 0) continue;
    out.push({
      pid: o.pid as number,
      ...(typeof o.startedAt === 'number' && Number.isFinite(o.startedAt) ? { startedAt: o.startedAt } : {}),
      ...(typeof o.image === 'string' && o.image ? { image: o.image } : {}),
    });
  }
  return out;
}

/** Whether `info` (the pid now) is still the process `e` recorded. A pid recorded without its start (the older list of
 *  integers) is when it started before pids.json was last written (`writtenAt`, null: unknown). */
export function sameProcess(e: PidEntry, info: ProcInfo, writtenAt: number | null): boolean {
  if (e.startedAt !== undefined) return Math.abs(info.startedAt - e.startedAt) <= START_TOLERANCE_MS && (e.image === undefined || e.image === info.image);
  return writtenAt === null || info.startedAt <= writtenAt + START_TOLERANCE_MS;
}

export function defaultProcDeps(): ProcDeps {
  const win = process.platform === 'win32';
  return {
    platform: process.platform,
    procInfo: pid => {
      if (win) {
        const query = `$p = Get-Process -Id ${pid} -ErrorAction Stop; $p.StartTime.ToUniversalTime().ToString('o'); $p.ProcessName`;
        const out = quiet('powershell', ['-NoProfile', '-NonInteractive', '-Command', query]);
        return out === null ? null : parsePowershell(out);
      }
      // The time before ps: the etime it prints is counted from the moment it reads the process, never earlier.
      const now = Date.now();
      const out = quiet('ps', ['-o', 'etime=', '-o', 'comm=', '-p', String(pid)]);
      return out === null ? null : parsePsLine(out.split('\n').find(l => l.trim()) ?? '', now);
    },
    alive: pid => {
      if (!pidAlive(pid)) return false;
      if (win) return true;
      const stat = quiet('ps', ['-o', 'stat=', '-p', String(pid)]);
      return stat === null || !stat.trim().startsWith('Z');
    },
    children: pid => (quiet('pgrep', ['-P', String(pid)]) ?? quiet('ps', ['-o', 'pid=', '--ppid', String(pid)]) ?? '')
      .split(/\s+/).map(Number).filter(n => Number.isInteger(n) && n > 0),
    pgid: pid => {
      const n = Number((quiet('ps', ['-o', 'pgid=', '-p', String(pid)]) ?? '').trim());
      return Number.isInteger(n) && n > 0 ? n : null;
    },
    signal: (target, sig) => { try { process.kill(target, sig); return true; } catch { return false; } },
    taskkill: pid => quiet('taskkill', ['/T', '/F', '/PID', String(pid)]) !== null,
    sleep: sleepSync,
    now: () => Date.now(),
  };
}

function descendants(pid: number, deps: ProcDeps, depth = 0): number[] {
  if (depth > 8) return [];
  return deps.children(pid).flatMap(c => [c, ...descendants(c, deps, depth + 1)]);
}

/**
 * Stops processes known to be the recorded ones (each pid with the identity it showed). Never a pid <= 1 or one of
 * `protect`, as a descendant or through a group they are in. POSIX: SIGTERM to the group each one leads (else to the pid)
 * and to every descendant, all read before any signal; after up to TERM_GRACE_MS, SIGKILL only to what is left and still
 * shows the identity it had before the SIGTERM. Windows: taskkill /T /F.
 */
function stopProcs(known: Map<number, ProcInfo>, deps: ProcDeps, protect: number[]): { killed: number[]; gone: number[] } {
  const killed: number[] = [], gone: number[] = [];
  const safe = (p: number) => p > 1 && !protect.includes(p);
  const pids = [...known.keys()].filter(safe);
  if (!pids.length) return { killed, gone };
  if (deps.platform === 'win32') {
    for (const pid of pids) (deps.taskkill(pid) || deps.signal(pid, 'SIGTERM') ? killed : gone).push(pid);
    return { killed, gone };
  }
  const tree = new Map(pids.map(pid => [pid, descendants(pid, deps).filter(safe)] as const));
  const ids = new Map<number, ProcInfo | null>(known);
  for (const list of tree.values()) for (const d of list) if (!ids.has(d)) ids.set(d, deps.procInfo(d));
  const shielded = new Set(protect.map(p => deps.pgid(p)));
  const groups = pids.filter(pid => deps.pgid(pid) === pid && !shielded.has(pid));
  for (const pid of pids) {
    const leader = groups.includes(pid);
    if (!deps.signal(leader ? -pid : pid, 'SIGTERM') && leader) deps.signal(pid, 'SIGTERM');
    for (const d of tree.get(pid)!) deps.signal(d, 'SIGTERM');
  }
  const all = [...new Set([...pids, ...[...tree.values()].flat()])];
  const living = () => all.filter(p => deps.alive(p));
  const until = deps.now() + TERM_GRACE_MS;
  while (living().length && deps.now() < until) deps.sleep(200);
  const still = (p: number) => {
    const was = ids.get(p), now = was ? deps.procInfo(p) : null;
    return !!was && !!now && sameProcess({ pid: p, ...was }, now, null);
  };
  const left = living().filter(still);
  for (const g of groups) if (left.includes(g)) deps.signal(-g, 'SIGKILL');
  for (const p of left) if (deps.alive(p)) deps.signal(p, 'SIGKILL');
  killed.push(...pids);
  return { killed, gone };
}

/**
 * Stops each recorded process that is still the one recorded. A pid <= 1, this process or its parent is never touched,
 * and one already gone is `gone`; one that is now another process is `reused` and one whose identity cannot be read now
 * is `unknown`: both are left alone (K2-20.2). The rest stop as stopProcs says.
 */
export function cleanupProcs(entries: PidEntry[], writtenAt: number | null, deps: ProcDeps, protect: number[] = [process.pid, process.ppid]): Cleanup {
  const out: Cleanup = { killed: [], gone: [], reused: [], unknown: [] };
  const seen = new Set<number>();
  const known = new Map<number, ProcInfo>();
  for (const e of entries) {
    if (seen.has(e.pid)) continue;
    seen.add(e.pid);
    if (e.pid <= 1 || protect.includes(e.pid) || !deps.alive(e.pid)) { out.gone.push(e.pid); continue; }
    const info = deps.procInfo(e.pid);
    if (!info) { out.unknown.push(e.pid); continue; }
    if (!sameProcess(e, info, writtenAt)) { out.reused.push(e.pid); continue; }
    known.set(e.pid, info);
  }
  const r = stopProcs(known, deps, protect);
  out.killed.push(...r.killed);
  out.gone.push(...r.gone);
  return out;
}

/** The record verify-spawn keeps next to a log: `<n>.log` → `<n>.pid.json`. */
const recordOf = (log: string) => log.replace(/\.log$/, '.pid.json');

/**
 * verify-cleanup of an evidence dir: the processes of each spawn's record (logs/<n>.pid.json) and of pids.json, the older
 * list dated by its last write. What is stopped, gone or reused leaves the records (a record file goes when nothing of it
 * is left; pids.json keeps its date), so a second pass never looks again at a pid the system may have given to another
 * process. What is unknown stays for that pass.
 */
export function stopEvidence(evidence: string, deps: ProcDeps): Cleanup {
  const logs = path.join(evidence, 'logs');
  let names: string[] = [];
  try { names = readdirSync(logs).filter(f => /^\d+\.pid\.json$/.test(f)).sort((a, b) => parseInt(a, 10) - parseInt(b, 10)); } catch { names = []; }
  const records = names.map(f => {
    const file = path.join(logs, f);
    let text: string | null = null;
    try { text = readFileSync(file, 'utf8'); } catch { text = null; }
    return { file, entries: parsePids(text) };
  });
  const legacy = path.join(evidence, 'pids.json');
  let text: string | null = null;
  let writtenAt: number | null = null;
  try { text = readFileSync(legacy, 'utf8'); writtenAt = statSync(legacy).mtimeMs; } catch { text = null; }
  const older = parsePids(text);
  const r = cleanupProcs([...records.flatMap(x => x.entries), ...older], writtenAt, deps);
  // Bookkeeping only: a record that could not be dropped is looked at again, by its identity, on the next pass.
  const done = new Set([...r.killed, ...r.gone, ...r.reused]);
  for (const x of records) if (x.entries.every(e => done.has(e.pid))) { try { rmSync(x.file, { force: true }); } catch { /* kept */ } }
  const keep = older.filter(e => !done.has(e.pid));
  try {
    if (keep.length === older.length) return r;
    if (!keep.length) rmSync(legacy, { force: true });
    else {
      writeAtomic(legacy, JSON.stringify(keep, null, 2) + '\n');
      if (writtenAt !== null) utimesSync(legacy, new Date(), new Date(writtenAt));
    }
  } catch { /* kept */ }
  return r;
}

/** SPAWN_WRAPPER's quoting of one argument for cmd.exe and the program's own parsing: as it is when plain, else in double
 *  quotes, with the backslashes before a quote or at the end doubled and each inner quote written `""` (cmd.exe stays
 *  inside the quotes, so a `&` or `|` in it is text). The source of an arrow function, exported for its test. */
export const SPAWN_QUOTE = String.raw`a => (/^[A-Za-z0-9_\-.,\/:=@+\\]+$/.test(a) ? a : '"' + a.replace(/(\\*)"/g, '$1$1""').replace(/(\\+)$/, '$1$1') + '"')`;

// Runs as `node -e SPAWN_WRAPPER -- <exitFile> <log> <cmd> [args…]`: starts the command with its output on the log (POSIX
// directly; Windows through cmd.exe, where npm and the like are .cmd files, each argument quoted unless it is plain), writes
// {code} to exitFile when it ends (whole: through a temporary file and a rename), and passes a stop signal on to it.
export const SPAWN_WRAPPER = `
const { spawn } = require('child_process');
const fs = require('fs');
const EOL = require('os').EOL;
const [exitFile, log, ...cmd] = process.argv.slice(1);
const fd = fs.openSync(log, 'a');
let child = null;
const done = code => {
  const text = JSON.stringify({ code });
  try { fs.writeFileSync(exitFile + '.tmp', text); fs.renameSync(exitFile + '.tmp', exitFile); } catch { try { fs.writeFileSync(exitFile, text); } catch {} }
  process.exit(0);
};
const quote = ${SPAWN_QUOTE};
try {
  child = process.platform === 'win32'
    ? spawn(cmd.map(quote).join(' '), { shell: true, stdio: ['ignore', fd, fd], windowsHide: true })
    : spawn(cmd[0], cmd.slice(1), { stdio: ['ignore', fd, fd] });
} catch (e) { try { fs.writeSync(fd, 'spawn error: ' + e.message + EOL); } catch {} done(127); }
child.on('error', e => { try { fs.writeSync(fd, 'spawn error: ' + e.message + EOL); } catch {} done(127); });
child.on('exit', (code, signal) => done(code === null ? (signal ? 128 : 1) : code));
for (const s of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(s, () => { try { child.kill(s); } catch {} process.exit(143); });
`;

function logTail(file: string): string {
  try {
    const fd = openSync(file, 'r');
    try {
      const size = fstatSync(fd).size, len = Math.min(size, TAIL_BYTES);
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, size - len);
      return buf.toString('utf8');
    } finally { closeSync(fd); }
  } catch { return ''; }
}

/** The code in an exit file; null while there is none or it cannot be read whole yet. */
function readExit(file: string): number | null {
  try {
    const o = JSON.parse(readFileSync(file, 'utf8')) as { code?: unknown };
    return Number.isInteger(o?.code) ? o.code as number : 1;
  } catch { return null; }
}

/**
 * Takes the next `<n>.log` of `logs` that nobody holds: created with 'wx', so two verify-spawn at once never share a
 * number. A number whose record is still there is skipped, and an exit file left from a log that was removed goes.
 */
function claimLog(logs: string): string {
  for (let n = 1 + readdirSync(logs).filter(f => /^\d+\.log$/.test(f)).length; ; n++) {
    const log = path.join(logs, `${n}.log`);
    if (existsSync(recordOf(log))) continue;
    try { closeSync(openSync(log, 'wx')); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') continue; throw e; }
    rmSync(`${log}.exit`, { force: true });
    return log;
  }
}

/**
 * FORGE verify-spawn: starts `cmd` (its argv) in `cwd`, detached under SPAWN_WRAPPER, its output in `<evidence>/logs/<n>.log`,
 * and waits up to `waitMs` (SPAWN_WAIT_MS). Ended by then with a code other than 0, it did not start: `{started: false, code,
 * logTail}`, nothing recorded (127: POSIX found no such command; on Windows cmd.exe ends with 1 and says why in the log).
 * Ended with 0: started and done, nothing to stop. Still running: the wrapper's pid and identity go to `<n>.pid.json`
 * (`running: true`); stopping its group or tree stops the command. When the identity cannot be read, the record takes
 * forge's own: the time just before the spawn and node's image. When the record cannot be written, the wrapper is
 * stopped before the error.
 */
export function spawnVerified(evidence: string, cwd: string, cmd: string[], deps: ProcDeps, waitMs = SPAWN_WAIT_MS):
  { started: boolean; pid: number | null; log: string; running: boolean; code?: number; logTail?: string } {
  const logs = path.join(evidence, 'logs');
  mkdirSync(logs, { recursive: true });
  const log = claimLog(logs);
  const exitFile = `${log}.exit`;
  const spawnedAt = Date.now();
  const child = spawn(process.execPath, ['-e', SPAWN_WRAPPER, '--', exitFile, log, ...cmd], { cwd, detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => { /* no pid: reported below */ });
  child.unref();
  const pid = child.pid ?? null;
  if (pid === null) return { started: false, pid: null, log, running: false, code: 127, logTail: 'forge could not start node' };
  const until = deps.now() + waitMs;
  let code = readExit(exitFile);
  while (code === null && deps.now() < until) { deps.sleep(100); code = readExit(exitFile); }
  if (code !== null && code !== 0) return { started: false, pid, log, running: false, code, logTail: logTail(log) };
  if (code === 0) return { started: true, pid, log, running: false };
  const id = deps.procInfo(pid) ?? { startedAt: spawnedAt, image: NODE_IMAGE };
  try {
    writeAtomic(recordOf(log), JSON.stringify([{ pid, ...id }], null, 2) + '\n');
  } catch (e) {
    stopProcs(new Map([[pid, id]]), deps, [process.pid, process.ppid]);
    throw e;
  }
  return { started: true, pid, log, running: true };
}
