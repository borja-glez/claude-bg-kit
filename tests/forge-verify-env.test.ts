import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { useTempDirs } from './helpers/tmp.js';
import { run, type Io } from '../src/forge/cli/run.js';
import { readEvents, type LedgerEvent } from '../src/forge/ledger.js';
import { deriveStatus } from '../src/lib/forge-status.js';
import { envDir, reserveEnv } from '../src/forge/verify-env.js';

const tmp = useTempDirs();
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
  config('47310-47319');
});

describe('forge verify-env (K2-07)', () => {
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
    await new Promise<void>(res => srv.listen(47310, '127.0.0.1', () => res()));
    try { expect(out(env('T1-1', '.forge/work/T1/reviews-1-1')).port).toBe(47311); } finally { await new Promise<void>(res => srv.close(() => res())); }
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
    config('47320-47320');
    expect(out(env('T1-1', '.forge/work/T1/reviews-1-1')).port).toBe(47320);
    const full = env('T2-1', '.forge/work/T2/reviews-1-1');
    expect(full.code).toBe(2);
    expect(full.stderr).toContain('verify.ports (47320-47320)');
  });
  it('two reservations that pick the same port at once: the key that sorts first keeps it, the other takes the next (Review Focus 2)', () => {
    mkdirSync(envDir(root), { recursive: true });
    // While T1-1-1 probes 47310, another session reserves it for A-1-1.
    const free = (port: number) => {
      if (port === 47310) {
        writeFileSync(path.join(envDir(root), 'A-1-1.json'), JSON.stringify({ key: 'A-1-1', task: 'A-1', port: 47310, profileDir: 'p', evidence: 'e', dir: 'd', startedAt: now.toISOString() }));
      }
      return true;
    };
    const r = reserveEnv({ main: root, key: 'T1-1-1', task: 'T1-1', dir: 'd', evidence: path.join(root, 'ev'), range: { from: 47310, to: 47319 }, now, ttlMs: 60_000, free });
    expect(r?.port).toBe(47311);
  });
  it('logs a verify-env event the ledger reads, and the forge status of a planned verification stays as it was', () => {
    out(env('T1-1', '.forge/work/T1/reviews-1-1'));
    const e = readEvents(root).find(x => x.kind === 'verify-env')!;
    expect(e).toMatchObject({ kind: 'verify-env', task: 'T1-1', port: 47310 });
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
