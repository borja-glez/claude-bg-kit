// K2-07: a port and a browser profile per verification, so two verify agents never share either. The reservations live
// in <main>/.forge/verify-env/<key>.json, shared by every session and worktree of the checkout; one that verify-cleanup
// did not free lapses 2 × verify.limits.minutes after it was made, so an agent that died does not hold its port forever.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { samePath } from '../lib/worktree.js';
import { writeAtomic } from './execution.js';

export interface EnvReservation { key: string; task: string; port: number; profileDir: string; evidence: string; dir: string; startedAt: string }
export interface EnvInput {
  main: string; key: string; task: string; dir: string; evidence: string; range: { from: number; to: number }; now: Date; ttlMs: number;
  /** Whether a port is free now; by default a listen on 127.0.0.1 in a child process. */
  free?: (port: number) => boolean;
}

export const envDir = (main: string) => path.join(main, '.forge', 'verify-env');
const KEY = /^[A-Za-z0-9_.-]{1,160}$/;

/** The reservation's name: the task's status key (C5) and its review round, `<key>-<n>-<round>` for a
 *  `reviews-<n>-<round>` folder; the folder's own name for any other (a flow pass). Null when unsafe. */
export function envKey(statusKey: string, dir: string): string | null {
  const base = path.basename(path.resolve(dir));
  const round = /^reviews-(\d+-\d+)$/.exec(base);
  const key = round ? `${statusKey}-${round[1]}` : base;
  return KEY.test(key) && key !== '.' && key !== '..' ? key : null;
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

// Runs as `node -e PORT_PROBE -- <port>`: exits 0 when it could listen on 127.0.0.1:<port>, else 1.
const PORT_PROBE = `
const s = require('net').createServer();
s.once('error', () => process.exit(1));
s.listen(Number(process.argv[1]), '127.0.0.1', () => s.close(() => process.exit(0)));
`;

/** Whether a port is free on 127.0.0.1 now, tried in a child process: the CLI stays synchronous. */
export const portFree = (port: number): boolean =>
  spawnSync(process.execPath, ['-e', PORT_PROBE, '--', String(port)], { timeout: 5000, stdio: 'ignore', windowsHide: true }).status === 0;

/**
 * The reservation of `key`: the one it already has while it stands (a respawned agent keeps its port and profile), else
 * the first port of the range no other reservation holds and that is free, with the profile folder
 * os.tmpdir()/forge-verify-<key>. When another reservation took the same port meanwhile, the key that sorts first keeps
 * it and the other tries the next port. Null when no port of the range is left.
 */
export function reserveEnv(i: EnvInput): EnvReservation | null {
  const free = i.free ?? portFree;
  const file = path.join(envDir(i.main), `${i.key}.json`);
  const at = i.now.getTime();
  const mine = readOne(file);
  if (mine && at - Date.parse(mine.startedAt) < i.ttlMs) return mine;
  mkdirSync(envDir(i.main), { recursive: true });
  const profileDir = path.join(tmpdir(), `forge-verify-${i.key}`);
  for (let port = i.range.from; port <= i.range.to; port++) {
    if (readReservations(i.main, at, i.ttlMs).some(r => r.key !== i.key && r.port === port) || !free(port)) continue;
    const r: EnvReservation = { key: i.key, task: i.task, port, profileDir, evidence: i.evidence, dir: i.dir, startedAt: i.now.toISOString() };
    writeAtomic(file, JSON.stringify(r, null, 2) + '\n');
    const clash = readReservations(i.main, at, i.ttlMs).some(x => x.key !== i.key && x.port === port && x.key < i.key);
    if (clash) { rmSync(file, { force: true }); continue; }
    mkdirSync(profileDir, { recursive: true });
    return r;
  }
  return null;
}

/** Frees the reservations of an evidence dir and deletes their profile folders (only one forge made right under the
 *  system's temporary folder). Returns the ports it freed. */
export function releaseEnv(main: string, evidence: string): number[] {
  const out: number[] = [];
  let names: string[] = [];
  try { names = readdirSync(envDir(main)).filter(f => f.endsWith('.json')); } catch { return out; }
  for (const f of names) {
    const r = readOne(path.join(envDir(main), f));
    if (!r || !samePath(r.evidence, evidence)) continue;
    rmSync(path.join(envDir(main), f), { force: true });
    if (samePath(path.dirname(r.profileDir), tmpdir()) && path.basename(r.profileDir).startsWith('forge-verify-')) {
      try { rmSync(r.profileDir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* a browser still holds it: the temp folder takes it */ }
    }
    out.push(r.port);
  }
  return out;
}
