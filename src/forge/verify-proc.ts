// K2-03, K2-20: the processes a verify agent starts, and stopping them safely. FORGE verify-spawn starts each one
// detached under a small node wrapper (its own process group on POSIX) that records the command's exit code, and keeps
// {pid, startedAt, image} in pids.json. verify-cleanup stops a pid only while it is still that process: the same image,
// started within 2 s of the recorded time (a pid of the older list of integers: started before pids.json was last
// written). On POSIX it sends SIGTERM to the group and the descendants and SIGKILL after 5 s; on Windows, taskkill /T /F.
import { execFileSync, spawn } from 'node:child_process';
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs';
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
export interface Cleanup { killed: number[]; gone: number[]; reused: number[] }

/** How far the start a process shows may be from the recorded one: ps gives whole seconds. */
export const START_TOLERANCE_MS = 2000;
/** How long verify-cleanup waits after SIGTERM before SIGKILL. */
export const TERM_GRACE_MS = 5000;
/** How long verify-spawn waits to tell a command that could not start from one that runs. */
export const SPAWN_WAIT_MS = 1000;
const TAIL_BYTES = 2000;

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

/** Whether `info` (the pid now) is still the process `e` recorded. A pid recorded without its start (an older list, or an
 *  identity that could not be read) is when it started before pids.json was last written (`writtenAt`, null: unknown). */
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
      const out = quiet('ps', ['-o', 'etime=', '-o', 'comm=', '-p', String(pid)]);
      return out === null ? null : parsePsLine(out.split('\n').find(l => l.trim()) ?? '', Date.now());
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
 * Stops each recorded process that is still the one recorded. A pid <= 1, this process or its parent is never touched,
 * and one already gone is `gone`; one that is now another process is `reused` and left alone; one alive whose identity
 * cannot be read now is stopped, as forge ≤ 0.25 did. POSIX: SIGTERM to its group when it leads one (else to the pid) and
 * to every descendant, read before any signal; after up to TERM_GRACE_MS, SIGKILL to what is left. Windows: taskkill /T /F.
 */
export function cleanupProcs(entries: PidEntry[], writtenAt: number | null, deps: ProcDeps, protect: number[] = [process.pid, process.ppid]): Cleanup {
  const out: Cleanup = { killed: [], gone: [], reused: [] };
  const seen = new Set<number>();
  const stop: number[] = [];
  for (const e of entries) {
    if (seen.has(e.pid)) continue;
    seen.add(e.pid);
    if (e.pid <= 1 || protect.includes(e.pid) || !deps.alive(e.pid)) { out.gone.push(e.pid); continue; }
    const info = deps.procInfo(e.pid);
    if (info && !sameProcess(e, info, writtenAt)) { out.reused.push(e.pid); continue; }
    stop.push(e.pid);
  }
  if (deps.platform === 'win32') {
    for (const pid of stop) (deps.taskkill(pid) || deps.signal(pid, 'SIGTERM') ? out.killed : out.gone).push(pid);
    return out;
  }
  const tree = new Map(stop.map(pid => [pid, descendants(pid, deps)] as const));
  const groups = stop.filter(pid => deps.pgid(pid) === pid);
  for (const pid of stop) {
    const leader = groups.includes(pid);
    if (!deps.signal(leader ? -pid : pid, 'SIGTERM') && leader) deps.signal(pid, 'SIGTERM');
    for (const d of tree.get(pid)!) deps.signal(d, 'SIGTERM');
  }
  const living = () => stop.flatMap(pid => [pid, ...tree.get(pid)!]).filter(p => deps.alive(p));
  const until = deps.now() + TERM_GRACE_MS;
  while (living().length && deps.now() < until) deps.sleep(200);
  const left = living();
  for (const g of groups) if (left.includes(g)) deps.signal(-g, 'SIGKILL');
  for (const p of living()) deps.signal(p, 'SIGKILL');
  out.killed.push(...stop);
  return out;
}

/** verify-cleanup of an evidence dir: the processes of its pids.json, dated by its last write for the older list. */
export function stopEvidence(evidence: string, deps: ProcDeps): Cleanup {
  const file = path.join(evidence, 'pids.json');
  let text: string | null = null;
  let writtenAt: number | null = null;
  try { text = readFileSync(file, 'utf8'); writtenAt = statSync(file).mtimeMs; } catch { text = null; }
  return cleanupProcs(parsePids(text), writtenAt, deps);
}

/** SPAWN_WRAPPER's quoting of one argument for cmd.exe: as it is when plain, else in double quotes with each inner one
 *  doubled (a node path with spaces, a script with `=>`). The source of an arrow function, exported for its test. */
export const SPAWN_QUOTE = `a => (/^[A-Za-z0-9_\\-.,\\/:=@+\\\\]+$/.test(a) ? a : '"' + a.replace(/"/g, '""') + '"')`;

// Runs as `node -e SPAWN_WRAPPER -- <exitFile> <log> <cmd> [args…]`: starts the command with its output on the log (POSIX
// directly; Windows through cmd.exe, where npm and the like are .cmd files, each argument quoted unless it is plain), writes
// {code} to exitFile when it ends, and passes a stop signal on to it.
export const SPAWN_WRAPPER = `
const { spawn } = require('child_process');
const fs = require('fs');
const EOL = require('os').EOL;
const [exitFile, log, ...cmd] = process.argv.slice(1);
const fd = fs.openSync(log, 'a');
let child = null;
const done = code => { try { fs.writeFileSync(exitFile, JSON.stringify({ code })); } catch {} process.exit(0); };
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

function readExit(file: string): number | null {
  try {
    const o = JSON.parse(readFileSync(file, 'utf8')) as { code?: unknown };
    return Number.isInteger(o?.code) ? o.code as number : 1;
  } catch { return null; }
}

/** Adds `e` to pids.json through writeAtomic, whose rename retries what Windows refuses for a moment (R10). */
function appendPid(evidence: string, e: PidEntry): void {
  const file = path.join(evidence, 'pids.json');
  let list: PidEntry[] = [];
  try { list = parsePids(readFileSync(file, 'utf8')); } catch { list = []; }
  writeAtomic(file, JSON.stringify([...list.filter(x => x.pid !== e.pid), e], null, 2) + '\n');
}

/**
 * FORGE verify-spawn: starts `cmd` (its argv) in `cwd`, detached under SPAWN_WRAPPER, its output in `<evidence>/logs/<n>.log`,
 * and waits up to `waitMs` (SPAWN_WAIT_MS). Ended by then with a code other than 0 (127: no such command), it did not start:
 * `{started: false, code, logTail}`, nothing recorded. Ended with 0: started and done, nothing to stop. Still running: the
 * wrapper's pid goes to pids.json with its identity (`running: true`); stopping its group or tree stops the command.
 */
export function spawnVerified(evidence: string, cwd: string, cmd: string[], deps: ProcDeps, waitMs = SPAWN_WAIT_MS):
  { started: boolean; pid: number | null; log: string; running: boolean; code?: number; logTail?: string } {
  const logs = path.join(evidence, 'logs');
  mkdirSync(logs, { recursive: true });
  const n = 1 + readdirSync(logs).filter(f => /^\d+\.log$/.test(f)).length;
  const log = path.join(logs, `${n}.log`);
  const exitFile = `${log}.exit`;
  closeSync(openSync(log, 'a'));
  const child = spawn(process.execPath, ['-e', SPAWN_WRAPPER, '--', exitFile, log, ...cmd], { cwd, detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => { /* no pid: reported below */ });
  child.unref();
  const pid = child.pid ?? null;
  if (pid === null) return { started: false, pid: null, log, running: false, code: 127, logTail: 'forge could not start node' };
  const until = deps.now() + waitMs;
  while (!existsSync(exitFile) && deps.now() < until) deps.sleep(100);
  const code = existsSync(exitFile) ? readExit(exitFile) : null;
  if (code !== null && code !== 0) return { started: false, pid, log, running: false, code, logTail: logTail(log) };
  if (code === 0) return { started: true, pid, log, running: false };
  const info = deps.procInfo(pid);
  appendPid(evidence, { pid, ...(info ? { startedAt: info.startedAt, image: info.image } : {}) });
  return { started: true, pid, log, running: true };
}
