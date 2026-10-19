// K2-03, K2-20: the processes a verify agent starts, and stopping them safely. FORGE verify-spawn starts each one
// detached under a small node wrapper (its own process group on POSIX) that records the command's exit code, and keeps
// [{pid, startedAt, image}] in logs/<n>.pid.json, one file per spawn. verify-cleanup reads those and pids.json (the older
// list of integers the agent wrote) and stops a pid only while it is still that process: the same image, started within
// 2 s of the recorded time (a pid of the older list: started before pids.json was last written). A pid whose identity
// cannot be read now is never stopped, and a record in logs/ that verify-spawn did not write is never read for a pid. On
// POSIX it sends SIGTERM to the group and the descendants and SIGKILL after 5 s to what still shows its identity; on
// Windows, taskkill /T /F.
import { execFileSync, spawn } from 'node:child_process';
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync, utimesSync } from 'node:fs';
import path from 'node:path';
import { pidAlive, removeFileIf, sleepSync } from './pid.js';
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
/** What verify-cleanup did with each recorded pid. `unknown`: alive and left running, because its identity cannot be read
 *  now or because stopping it failed; its record stays for the next pass. */
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

/** One entry of a list of pids: an integer, or {pid, startedAt?, image?}; null for anything else. */
function entryOf(x: unknown): PidEntry | null {
  if (Number.isInteger(x) && (x as number) > 0) return { pid: x as number };
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (!Number.isInteger(o.pid) || (o.pid as number) <= 0) return null;
  return {
    pid: o.pid as number,
    ...(typeof o.startedAt === 'number' && Number.isFinite(o.startedAt) ? { startedAt: o.startedAt } : {}),
    ...(typeof o.image === 'string' && o.image ? { image: o.image } : {}),
  };
}

/** pids.json: a list of {pid, startedAt?, image?} or, as forge ≤ 0.25 had the agent write it, of integers. */
export function parsePids(text: string | null): PidEntry[] {
  let raw: unknown;
  try { raw = JSON.parse(text ?? ''); } catch { return []; }
  return Array.isArray(raw) ? raw.map(entryOf).filter((e): e is PidEntry => e !== null) : [];
}

/** A record as verify-spawn writes it (logs/<n>.pid.json): a list whose every entry has its pid, its start and its image.
 *  Null for any other file, or one that cannot be read: verify-cleanup leaves it alone (K2-20). */
function readRecord(file: string): PidEntry[] | null {
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
  if (!Array.isArray(raw) || !raw.length) return null;
  const list = raw.map(entryOf);
  return list.every(e => e !== null && e.startedAt !== undefined && e.image !== undefined) ? list as PidEntry[] : null;
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
 * shows the identity it had before the SIGTERM. Windows: taskkill /T /F, else SIGTERM; when neither worked, `gone` if it
 * has ended meanwhile, else `failed`.
 */
function stopProcs(known: Map<number, ProcInfo>, deps: ProcDeps, protect: number[]): { killed: number[]; gone: number[]; failed: number[] } {
  const killed: number[] = [], gone: number[] = [], failed: number[] = [];
  const safe = (p: number) => p > 1 && !protect.includes(p);
  const pids = [...known.keys()].filter(safe);
  if (!pids.length) return { killed, gone, failed };
  if (deps.platform === 'win32') {
    for (const pid of pids) {
      if (deps.taskkill(pid) || deps.signal(pid, 'SIGTERM')) killed.push(pid);
      else (deps.alive(pid) ? failed : gone).push(pid);
    }
    return { killed, gone, failed };
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
  return { killed, gone, failed };
}

type Verdict = keyof Cleanup;

/**
 * The verdict of each entry (same order), each judged against what holds its pid now: a pid <= 1, one of `protect` or one
 * that is not alive is `gone`; one whose identity cannot be read now is `unknown`. Otherwise an entry the process matches
 * is stopped with every other that matches (`killed`; `gone` or `unknown` when stopProcs could not stop it), and one it
 * does not match is `reused`: two entries of one pid (an ended spawn whose pid a later one got) are judged apart.
 */
function judge(entries: PidEntry[], writtenAt: number | null, deps: ProcDeps, protect: number[]): Verdict[] {
  const verdicts: Verdict[] = entries.map(() => 'unknown');
  const byPid = new Map<number, number[]>();
  entries.forEach((e, i) => byPid.set(e.pid, [...(byPid.get(e.pid) ?? []), i]));
  const known = new Map<number, ProcInfo>();
  const matched = new Map<number, number[]>();
  for (const [pid, at] of byPid) {
    if (pid <= 1 || protect.includes(pid) || !deps.alive(pid)) { for (const i of at) verdicts[i] = 'gone'; continue; }
    const info = deps.procInfo(pid);
    if (!info) continue;
    const hit = at.filter(i => sameProcess(entries[i], info, writtenAt));
    for (const i of at) if (!hit.includes(i)) verdicts[i] = 'reused';
    if (hit.length) { known.set(pid, info); matched.set(pid, hit); }
  }
  const r = stopProcs(known, deps, protect);
  for (const [pid, hit] of matched) {
    const v: Verdict = r.killed.includes(pid) ? 'killed' : r.gone.includes(pid) ? 'gone' : 'unknown';
    for (const i of hit) verdicts[i] = v;
  }
  return verdicts;
}

/** Each pid once, in the order it first comes: `killed` when an entry of it was stopped, else `unknown`, `gone`, `reused`. */
function summary(entries: PidEntry[], verdicts: Verdict[]): Cleanup {
  const out: Cleanup = { killed: [], gone: [], reused: [], unknown: [] };
  const order: Verdict[] = ['killed', 'unknown', 'gone', 'reused'];
  const seen = new Set<number>();
  for (const e of entries) {
    if (seen.has(e.pid)) continue;
    seen.add(e.pid);
    const mine = verdicts.filter((_, i) => entries[i].pid === e.pid);
    out[order.find(v => mine.includes(v))!].push(e.pid);
  }
  return out;
}

/**
 * Stops each recorded process that is still the one recorded. A pid <= 1, this process or its parent is never touched,
 * and one already gone is `gone`; one that is now another process is `reused` and one whose identity cannot be read now
 * is `unknown`: both are left alone (K2-20.2). The rest stop as stopProcs says; one it could not stop and still alive is
 * `unknown` too.
 */
export function cleanupProcs(entries: PidEntry[], writtenAt: number | null, deps: ProcDeps, protect: number[] = [process.pid, process.ppid]): Cleanup {
  return summary(entries, judge(entries, writtenAt, deps, protect));
}

/** The record verify-spawn keeps next to a log: `<n>.log` → `<n>.pid.json`. */
const recordOf = (log: string) => log.replace(/\.log$/, '.pid.json');

/** What verify-cleanup prints: the verdicts, and the records of logs/ it left alone because verify-spawn did not write
 *  them as it does (or they cannot be read), relative to the evidence dir. */
export type EvidenceCleanup = Cleanup & { skipped: string[] };

const entryKey = (e: PidEntry) => `${e.pid}:${e.startedAt ?? ''}:${e.image ?? ''}`;

/**
 * Takes the judged entries out of pids.json, read again now: what the agent added meanwhile stays, and so does the date of
 * its last write, which judges its integers. The date goes on the temporary file before the rename, so when it cannot be
 * kept pids.json stays as it was; it is removed only while it still reads what was read.
 */
function dropOlder(file: string, judged: PidEntry[]): void {
  if (!judged.length) return;
  let text: string;
  let mtime: number;
  try { text = readFileSync(file, 'utf8'); mtime = statSync(file).mtimeMs; } catch { return; }
  const left = new Map<string, number>();
  for (const e of judged) left.set(entryKey(e), (left.get(entryKey(e)) ?? 0) + 1);
  const now = parsePids(text);
  const keep = now.filter(e => {
    const n = left.get(entryKey(e)) ?? 0;
    if (n) left.set(entryKey(e), n - 1);
    return !n;
  });
  if (keep.length === now.length) return;
  try {
    if (!keep.length) { removeFileIf(file, text); return; }
    const when = new Date(mtime);
    writeAtomic(file, JSON.stringify(keep, null, 2) + '\n', (from, to) => { utimesSync(from, new Date(), when); renameSync(from, to); });
  } catch { /* pids.json stays as it was: its entries are judged again on the next pass */ }
}

/**
 * verify-cleanup of an evidence dir: the processes of each spawn's record (logs/<n>.pid.json) and of pids.json, the older
 * list dated by its last write. A record file goes once each of its entries is stopped, gone or reused, so a second pass
 * never looks again at a pid the system may have given to another process; pids.json loses those entries (dropOlder).
 * What is unknown stays for that pass. A record verify-spawn did not write is `skipped`: never read for a pid to stop,
 * never changed.
 */
export function stopEvidence(evidence: string, deps: ProcDeps): EvidenceCleanup {
  const logs = path.join(evidence, 'logs');
  let names: string[] = [];
  try { names = readdirSync(logs).filter(f => /^\d+\.pid\.json$/.test(f)).sort((a, b) => parseInt(a, 10) - parseInt(b, 10)); } catch { names = []; }
  const records: { file: string; entries: PidEntry[] }[] = [];
  const skipped: string[] = [];
  for (const f of names) {
    const entries = readRecord(path.join(logs, f));
    if (entries) records.push({ file: path.join(logs, f), entries });
    else skipped.push(`logs/${f}`);
  }
  const legacy = path.join(evidence, 'pids.json');
  let text: string | null = null;
  let writtenAt: number | null = null;
  try { text = readFileSync(legacy, 'utf8'); writtenAt = statSync(legacy).mtimeMs; } catch { text = null; }
  const older = parsePids(text);
  const all = [...records.flatMap(x => x.entries), ...older];
  const verdicts = judge(all, writtenAt, deps, [process.pid, process.ppid]);
  // Bookkeeping only: a record that could not be dropped is judged again, by its identity, on the next pass.
  let at = 0;
  for (const x of records) {
    const done = verdicts.slice(at, at + x.entries.length).every(v => v !== 'unknown');
    at += x.entries.length;
    if (done) { try { rmSync(x.file, { force: true }); } catch { /* kept */ } }
  }
  dropOlder(legacy, older.filter((_, k) => verdicts[at + k] !== 'unknown'));
  return { ...summary(all, verdicts), skipped };
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
