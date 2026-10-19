import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { useTempDirs } from './helpers/tmp.js';
import { run, type Io } from '../src/forge/cli/run.js';
import { readEvents, type LedgerEvent } from '../src/forge/ledger.js';
import { deriveStatus } from '../src/lib/forge-status.js';
import { envDir, portFree, readReservations, releaseEnv, reserveEnv } from '../src/forge/verify-env.js';

const tmp = useTempDirs();
// A block of 12 consecutive free ports, found once; without one the suite skips (it never fails on a busy machine).
const P = (() => {
  for (let b = 47310; b < 47900; b += 20) if (Array.from({ length: 12 }, (_, k) => b + k).every(p => portFree(p))) return b;
  console.warn('forge-verify-env: no free block of 12 ports in 47310-47899; the suite is skipped');
  return null;
})();
let root: string;
let now: Date;
const io = (): Io => ({ cwd: root, now: () => now, env: {} });
const out = (r: { code: number; stdout: string; stderr: string }) => { if (r.code !== 0) throw new Error(r.stderr || r.stdout); return JSON.parse(r.stdout); };
const env = (task: string, dir: string) => run(['verify-env', '--task', task, '--dir', dir], io());
const config = (ports: string) => writeFileSync(path.join(root, '.forge', 'config.yaml'), `verify:\n  ports: "${ports}"\n`);

beforeEach(() => {
  root = tmp('forge-venv-');
  now = new Date('2026-10-16T10:00:00.000Z');
  mkdirSync(path.join(root, '.forge'), { recursive: true });
  config(`${P}-${P! + 9}`);
});

describe.skipIf(P === null)('forge verify-env (K2-07)', () => {
  it('two verifications get different ports and profiles; the same round asks again and keeps its own (Review Focus 2)', () => {
    const a = out(env('T1-1', '.forge/work/T1/reviews-1-1'));
    const b = out(env('T2-1', '.forge/work/T2/reviews-1-1'));
    expect(a.port).not.toBe(b.port);
    expect(a.profileDir).not.toBe(b.profileDir);
    expect(a.env).toEqual({ PORT: String(a.port), FORGE_VERIFY_PORT: String(a.port) });
    expect(existsSync(a.profileDir)).toBe(true);
    expect(out(env('T1-1', '.forge/work/T1/reviews-1-1'))).toEqual(a);
    expect(JSON.parse(readFileSync(path.join(root, '.forge/work/T1/reviews-1-1/verify-env.json'), 'utf8'))).toMatchObject({ task: 'T1-1', port: a.port, profileDir: a.profileDir });
    expect(existsSync(path.join(root, '.forge/work/T1/evidence/1-1'))).toBe(true);
  });
  it('a port another program listens on is skipped', async () => {
    const srv = createServer();
    await new Promise<void>(res => srv.listen(P!, '127.0.0.1', () => res()));
    try { expect(out(env('T1-1', '.forge/work/T1/reviews-1-1')).port).toBe(P! + 1); } finally { await new Promise<void>(res => srv.close(() => res())); }
  });
  it('verify-cleanup frees the reservation and deletes the profile; one never freed lapses after 2 × verify.limits.minutes', () => {
    const a = out(env('T1-1', '.forge/work/T1/reviews-1-1'));
    expect(out(run(['verify-cleanup', '--dir', '.forge/work/T1/evidence/1-1'], io())).released).toEqual([a.port]);
    expect(existsSync(a.profileDir)).toBe(false);
    expect(out(env('T2-1', '.forge/work/T2/reviews-1-1')).port).toBe(a.port);
    // T2's reservation is never freed: 21 minutes later (limits.minutes 10) its port is handed out again.
    now = new Date(now.getTime() + 21 * 60_000);
    expect(out(env('T3-1', '.forge/work/T3/reviews-1-1')).port).toBe(a.port);
  });
  it('a reservation file that does not read is none, and a full range exits 2 and names it (Review Focus 2)', () => {
    mkdirSync(envDir(root), { recursive: true });
    writeFileSync(path.join(envDir(root), 'junk.json'), '{oops');
    config(`${P! + 10}-${P! + 10}`);
    expect(out(env('T1-1', '.forge/work/T1/reviews-1-1')).port).toBe(P! + 10);
    const full = env('T2-1', '.forge/work/T2/reviews-1-1');
    expect(full.code).toBe(2);
    expect(full.stderr).toContain(`verify.ports (${P! + 10}-${P! + 10})`);
  });
  it('two reservations that pick the same port at once: the key that sorts first keeps it, the other takes the next (Review Focus 2)', () => {
    mkdirSync(envDir(root), { recursive: true });
    // While T1-1-1 probes 47310, another session reserves it for A-1-1.
    const free = (port: number) => {
      if (port === P) {
        writeFileSync(path.join(envDir(root), 'A-1-1.json'), JSON.stringify({ key: 'A-1-1', task: 'A-1', port: P, profileDir: 'p', evidence: 'e', dir: 'd', startedAt: now.toISOString() }));
      }
      return true;
    };
    const r = reserveEnv({ main: root, key: 'T1-1-1', task: 'T1-1', dir: 'd', evidence: path.join(root, 'ev'), range: { from: P!, to: P! + 9 }, now, ttlMs: 60_000, free });
    expect(r?.port).toBe(P! + 1);
  });
  const reserve = (key: string, over: Partial<Parameters<typeof reserveEnv>[0]> = {}) =>
    reserveEnv({ main: root, key, task: key, dir: `d-${key}`, evidence: path.join(root, `ev-${key}`), range: { from: P!, to: P! + 9 }, now, ttlMs: 60_000, free: () => true, ...over });
  const lock = (port: number, key: string, at: Date) => {
    mkdirSync(envDir(root), { recursive: true });
    writeFileSync(path.join(envDir(root), `port-${port}.lock`), JSON.stringify({ key, startedAt: at.toISOString() }));
  };
  it('a smaller key that arrives second cannot take a port the other already locked, even before its reservation is written', () => {
    // While Z-1-1 probes P, A-1-1 (the smaller key) claims it; A-1-1 has no reservation file yet, only the lock.
    const free = (port: number) => { if (port === P) lock(P!, 'A-1-1', now); return true; };
    expect(reserve('Z-1-1', { free })?.port).toBe(P! + 1);
  });
  it('a lock whose owner lapsed past the ttl is taken over, a fresh one is not', () => {
    lock(P!, 'old', new Date(now.getTime() - 61_000));
    lock(P! + 1, 'new', new Date(now.getTime() - 1_000));
    expect(reserve('T1-1-1')?.port).toBe(P);
    expect(reserve('T2-1-1')?.port).toBe(P! + 2);
  });
  it('flow folders of two tasks do not share a reservation, and a reservation for another folder is not handed back', () => {
    const a = out(env('T1-1', '.forge/work/T1/flow'));
    const b = out(env('T2-1', '.forge/work/T2/flow'));
    expect(a.port).not.toBe(b.port);
    expect(a.profileDir).not.toBe(b.profileDir);
    const first = reserve('K-1-1');
    const other = reserve('K-1-1', { evidence: path.join(root, 'elsewhere') });
    expect(other?.evidence).toBe(path.join(root, 'elsewhere'));
    expect(first?.evidence).not.toBe(other?.evidence);
  });
  it('a lapsed reservation is swept: its file, its lock and its profile folder', () => {
    const a = reserve('S-1-1')!;
    expect(existsSync(a.profileDir)).toBe(true);
    reserve('S-2-1', { now: new Date(now.getTime() + 61_000) });
    expect(existsSync(path.join(envDir(root), 'S-1-1.json'))).toBe(false);
    expect(existsSync(a.profileDir)).toBe(false);
    expect(existsSync(path.join(envDir(root), `port-${a.port}.lock`))).toBe(true); // retaken by S-2-1
  });
  it('a lapsed reservation\'s lock is gone when its port is not retaken', () => {
    const a = reserve('S-1-1')!;
    const b = reserve('S-2-1', { now: new Date(now.getTime() + 61_000), free: p => p !== a.port })!;
    expect(b.port).toBe(a.port + 1);
    expect(existsSync(path.join(envDir(root), `port-${a.port}.lock`))).toBe(false);
  });
  it('a stale lock replaced by a fresh one between the read and the removal stays; the port is skipped', () => {
    lock(P!, 'old', new Date(now.getTime() - 61_000));
    const lockPath = path.join(envDir(root), `port-${P}.lock`);
    const beforeTakeover = () => writeFileSync(lockPath, JSON.stringify({ key: 'C-1-1', startedAt: now.toISOString() }));
    expect(reserve('B-1-1', { beforeTakeover })?.port).toBe(P! + 1);
    expect(JSON.parse(readFileSync(lockPath, 'utf8')).key).toBe('C-1-1');
  });
  it('a create the system refuses while the lock is being removed (EPERM) skips the port and throws nothing', () => {
    const open = (f: string, flags: string) => {
      if (f.endsWith(`port-${P}.lock`)) throw Object.assign(new Error('refused'), { code: 'EPERM' });
      return openSync(f, flags);
    };
    expect(reserve('R-1-1', { open })?.port).toBe(P! + 1);
  });
  it('a corrupt lock is judged by its mtime: fresh blocks the port, past the ttl it is taken over', () => {
    mkdirSync(envDir(root), { recursive: true });
    const lockPath = path.join(envDir(root), `port-${P}.lock`);
    writeFileSync(lockPath, '{oops');
    expect(reserve('J-1-1')?.port).toBe(P! + 1);
    utimesSync(lockPath, new Date(now.getTime() - 61_000), new Date(now.getTime() - 61_000));
    expect(reserve('J-2-1')?.port).toBe(P);
  });
  it('when writing the output files fails, the reservation, its lock and its profile are released', () => {
    mkdirSync(path.join(root, '.forge/work/T1/reviews-1-1/verify-env.json'), { recursive: true }); // writing the file there fails
    try { env('T1-1', '.forge/work/T1/reviews-1-1'); } catch { /* expected */ }
    expect(existsSync(envDir(root)) ? readdirSync(envDir(root)) : []).toEqual([]);
  });
  describe('a reservation file never names the file that goes: a planted key that climbs out of the folder deletes nothing (I3)', () => {
    const plant = (name: string, victim: string, over: Record<string, unknown>) => {
      mkdirSync(envDir(root), { recursive: true });
      writeFileSync(path.join(root, victim), '{"keep":true}\n');
      writeFileSync(path.join(envDir(root), name), JSON.stringify({ key: `../../${victim.replace(/\.json$/, '')}`, task: 'x', port: 1, profileDir: 'nope', dir: 'd', ...over }));
    };
    it('the sweep of a lapsed one', () => {
      plant('evil.json', 'victim.json', { evidence: 'e', startedAt: '2000-01-01T00:00:00.000Z' });
      expect(reserve('T1-1-1')?.port).toBe(P);
      expect(existsSync(path.join(root, 'victim.json'))).toBe(true);
    });
    it('the release of an evidence dir', () => {
      plant('evil2.json', 'victim2.json', { evidence: path.join(root, 'ev2'), startedAt: now.toISOString() });
      expect(releaseEnv(root, path.join(root, 'ev2'))).toEqual([]);
      expect(existsSync(path.join(root, 'victim2.json'))).toBe(true);
    });
    it('a file whose key is not its name, or whose port is out of range, reserves nothing', () => {
      mkdirSync(envDir(root), { recursive: true });
      const r = (key: string, port: number) => ({ key, task: 'x', port, profileDir: 'p', evidence: path.join(root, 'ev3'), dir: 'd', startedAt: now.toISOString() });
      writeFileSync(path.join(envDir(root), 'A-1-1.json'), JSON.stringify(r('B-1-1', P!)));
      writeFileSync(path.join(envDir(root), 'C-1-1.json'), JSON.stringify(r('C-1-1', 70000)));
      expect(readReservations(root, now.getTime(), 60_000)).toEqual([]);
      expect(releaseEnv(root, path.join(root, 'ev3'))).toEqual([]);
    });
  });
  it('probes at most 50 ports per call', () => {
    let n = 0;
    expect(reserve('M-1-1', { range: { from: P!, to: P! + 9999 }, free: () => { n++; return false; } })).toBeNull();
    expect(n).toBe(50);
  });
  it('a free-port probe sees a server bound to ::1 as busy', async ({ skip }) => {
    const srv = createServer();
    const bound = await new Promise<boolean>(res => { srv.once('error', () => res(false)); srv.listen(P! + 11, '::1', () => res(true)); });
    if (!bound) { srv.close(); skip('IPv6 (::1) is not available on this machine'); }
    try { expect(portFree(P! + 11)).toBe(false); } finally { await new Promise<void>(res => srv.close(() => res())); }
  });
  it('logs a verify-env event the ledger reads, and the forge status of a planned verification stays as it was', () => {
    out(env('T1-1', '.forge/work/T1/reviews-1-1'));
    const e = readEvents(root).find(x => x.kind === 'verify-env')!;
    expect(e).toMatchObject({ kind: 'verify-env', task: 'T1-1', port: P });
    const triage: LedgerEvent = { ts: '2026-10-16T09:00:00.000Z', kind: 'triage', task: 'T1', path: 'medium', reasons: ['x'] };
    const planned: LedgerEvent = { ts: '2026-10-16T09:01:00.000Z', kind: 'verify', task: 'T1-1', planned: true, surfaces: ['web'] };
    const s = deriveStatus(deriveStatus(null, triage), planned)!;
    expect(deriveStatus(s, e)!.verify).toEqual(s.verify);
  });
  it('needs --task and --dir', () => {
    expect(run(['verify-env', '--task', 'T1-1'], io()).code).toBe(2);
    expect(run(['verify-env', '--dir', '.forge/work/T1/reviews-1-1'], io()).code).toBe(2);
  });
});
