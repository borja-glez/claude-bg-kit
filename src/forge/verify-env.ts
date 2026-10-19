// K2-07: a port and a browser profile per verification, so two verify agents never share either. The reservations live
// in <main>/.forge/verify-env/<key>.json, shared by every session and worktree of the checkout; one that verify-cleanup
// did not free lapses 2 × verify.limits.minutes after it was made, so an agent that died does not hold its port forever.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { samePath } from '../lib/worktree.js';
import { writeAtomic } from './execution.js';

export interface EnvReservation { key: string; task: string; port: number; profileDir: string; evidence: string; dir: string; startedAt: string }
export interface EnvInput {
  main: string; key: string; task: string; dir: string; evidence: string; range: { from: number; to: number }; now: Date; ttlMs: number;
  /** Whether a port is free now; by default a listen on 127.0.0.1 (and ::1) in a child process. */
  free?: (port: number) => boolean;
}

export const envDir = (main: string) => path.join(main, '.forge', 'verify-env');
const KEY = /^[A-Za-z0-9_.-]{1,160}$/;

/** The reservation's name: the task's status key (C5) and its review round, `<key>-<n>-<round>` for a
 *  `reviews-<n>-<round>` folder; for any other folder (a flow pass) the status key, the folder's name and a short hash of
 *  its path, so two tasks' `flow` folders never share one. Null when unsafe. */
export function envKey(statusKey: string, dir: string): string | null {
  const abs = path.resolve(dir);
  const round = /^reviews-(\d+-\d+)$/.exec(path.basename(abs));
  const hash = createHash('sha1').update(abs).digest('hex').slice(0, 8);
  const key = round ? `${statusKey}-${round[1]}` : `${statusKey}-${path.basename(abs)}-${hash}`;
  return KEY.test(key) ? key : null;
}

function readOne(file: string): EnvReservation | null {
  try {
    const o = JSON.parse(readFileSync(file, 'utf8')) as Partial<EnvReservation> | null;
    if (!o || typeof o !== 'object' || typeof o.key !== 'string' || !Number.isInteger(o.port) || typeof o.profileDir !== 'string'
      || typeof o.evidence !== 'string' || typeof o.startedAt !== 'string') return null;
    return o as EnvReservation;
  } catch { return null; }
}

/** The reservations still standing at `now`: younger than `ttlMs`. A file that does not read reserves nothing. */
export function readReservations(main: string, now: number, ttlMs: number): EnvReservation[] {
  let names: string[] = [];
  try { names = readdirSync(envDir(main)).filter(f => f.endsWith('.json')); } catch { return []; }
  return names.map(f => readOne(path.join(envDir(main), f)))
    .filter((r): r is EnvReservation => r !== null && now - Date.parse(r.startedAt) < ttlMs);
}

// Runs as `node -e PORT_PROBE -- <port>`: exits 0 when it could listen on 127.0.0.1:<port> and, where IPv6 exists, on
// [::1]:<port>, else 1. Every server it opens is closed before it exits.
const PORT_PROBE = `
const net = require('net');
const port = Number(process.argv[1]);
const listen = (host, done) => {
  const s = net.createServer();
  s.once('error', e => done(e.code));
  s.listen(port, host, () => s.close(() => done(null)));
};
listen('127.0.0.1', a => a ? process.exit(1) : listen('::1', b => process.exit(b === 'EADDRINUSE' || b === 'EACCES' ? 1 : 0)));
`;

/** Whether a port is free on 127.0.0.1 (and ::1) now, tried in a child process: the CLI stays synchronous. */
export const portFree = (port: number): boolean =>
  spawnSync(process.execPath, ['-e', PORT_PROBE, '--', String(port)], { timeout: 5000, stdio: 'ignore', windowsHide: true }).status === 0;

/** The most ports one reserveEnv probes: each probe is a child process, so the call's time stays bounded. */
export const MAX_PROBES = 50;

const lockFile = (main: string, port: number) => path.join(envDir(main), `port-${port}.lock`);
const rmProfile = (dir: string) => {
  if (!samePath(path.dirname(dir), tmpdir()) || !path.basename(dir).startsWith('forge-verify-')) return;
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* a browser still holds it: the temp folder takes it */ }
};
const readLock = (file: string): { key: string; startedAt: string } | null => {
  try {
    const o = JSON.parse(readFileSync(file, 'utf8'));
    return typeof o?.key === 'string' && typeof o.startedAt === 'string' ? o : null;
  } catch { return null; }
};

/** Takes the port's lock file with an exclusive create: only one reservation holds it. A lock older than the TTL is stale
 *  (its reservation lapsed or was never finished) and is taken over. */
function lockPort(main: string, port: number, key: string, now: Date, ttlMs: number): boolean {
  const file = lockFile(main, port);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(file, 'wx');
      try { writeSync(fd, JSON.stringify({ key, startedAt: now.toISOString() })); } finally { closeSync(fd); }
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const held = readLock(file);
      // Unreadable: another session is writing it right now, not ours to take.
      if (!held || now.getTime() - Date.parse(held.startedAt) < ttlMs) return false;
      rmSync(file, { force: true });
    }
  }
  return false;
}

/** Removes a reservation: its file, its port lock when it holds it, and its profile folder. */
function dropOne(main: string, r: EnvReservation): void {
  rmSync(path.join(envDir(main), `${r.key}.json`), { force: true });
  if (readLock(lockFile(main, r.port))?.key === r.key) rmSync(lockFile(main, r.port), { force: true });
  rmProfile(r.profileDir);
}

/** Removes the reservations that lapsed: their file, their port lock and their profile folder. */
function sweepLapsed(main: string, now: number, ttlMs: number): void {
  let names: string[] = [];
  try { names = readdirSync(envDir(main)).filter(f => f.endsWith('.json')); } catch { return; }
  for (const f of names) {
    const r = readOne(path.join(envDir(main), f));
    if (r && now - Date.parse(r.startedAt) >= ttlMs) dropOne(main, r);
  }
}

/**
 * The reservation of `key`: the one it already has while it stands and is for the same task, folder and evidence (a
 * respawned agent keeps its port and profile), else the first port of the range no other reservation holds, that is free
 * and whose lock file this call creates exclusively, with the profile folder os.tmpdir()/forge-verify-<key>. The lock is
 * what makes the claim atomic: two sessions never take one port. At most MAX_PROBES ports are probed. Null when no port
 * is left.
 */
export function reserveEnv(i: EnvInput): EnvReservation | null {
  const free = i.free ?? portFree;
  const file = path.join(envDir(i.main), `${i.key}.json`);
  const at = i.now.getTime();
  mkdirSync(envDir(i.main), { recursive: true });
  sweepLapsed(i.main, at, i.ttlMs);
  const mine = readOne(file);
  if (mine) {
    if (mine.task === i.task && samePath(mine.evidence, i.evidence) && samePath(mine.dir, i.dir)) return mine;
    dropOne(i.main, mine); // the same name for another folder: its cleanup would never free this one
  }
  const profileDir = path.join(tmpdir(), `forge-verify-${i.key}`);
  const held = (port: number) => readReservations(i.main, at, i.ttlMs).some(r => r.key !== i.key && r.port === port);
  let probes = 0;
  for (let port = i.range.from; port <= i.range.to && probes < MAX_PROBES; port++) {
    if (held(port)) continue;
    probes++;
    if (!free(port) || !lockPort(i.main, port, i.key, i.now, i.ttlMs)) continue;
    // A reservation written without a lock (an older forge) may have taken the port while it was probed.
    if (held(port)) { rmSync(lockFile(i.main, port), { force: true }); continue; }
    const r: EnvReservation = { key: i.key, task: i.task, port, profileDir, evidence: i.evidence, dir: i.dir, startedAt: i.now.toISOString() };
    try { writeAtomic(file, JSON.stringify(r, null, 2) + '\n'); mkdirSync(profileDir, { recursive: true }); } catch (e) { dropOne(i.main, r); throw e; }
    return r;
  }
  return null;
}

/** Frees the reservations of an evidence dir, their port locks and their profile folders (only one forge made right under
 *  the system's temporary folder). Returns the ports it freed. */
export function releaseEnv(main: string, evidence: string): number[] {
  const out: number[] = [];
  let names: string[] = [];
  try { names = readdirSync(envDir(main)).filter(f => f.endsWith('.json')); } catch { return out; }
  for (const f of names) {
    const r = readOne(path.join(envDir(main), f));
    if (!r || !samePath(r.evidence, evidence)) continue;
    dropOne(main, r);
    out.push(r.port);
  }
  return out;
}
