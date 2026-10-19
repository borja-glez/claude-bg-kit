import { afterEach, describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { useTempDirs } from './helpers/tmp.js';
import { run, type Io } from '../src/forge/cli/run.js';
import {
  cleanupProcs, defaultProcDeps, parseEtime, parsePids, parsePowershell, parsePsLine, sameProcess, spawnVerified, stopEvidence,
  SPAWN_QUOTE, SPAWN_WRAPPER, type ProcDeps,
} from '../src/forge/verify-proc.js';

const tmp = useTempDirs();

type Fake = { startedAt: number; image: string; pgid?: number; children?: number[]; dies?: 'term' | 'kill' };
/** A fake machine: each pid with its start, image, group and children; a SIGTERM ends a 'term' process, only SIGKILL a
 *  'kill' one. Every signal is recorded, and sleeping moves the clock. */
function machine(procs: Record<number, Fake>, platform: NodeJS.Platform = 'linux') {
  const sent: string[] = [];
  const alive = new Set(Object.keys(procs).map(Number));
  let clock = 1_000_000;
  const deps: ProcDeps = {
    platform,
    procInfo: pid => (alive.has(pid) ? { startedAt: procs[pid].startedAt, image: procs[pid].image } : null),
    alive: pid => alive.has(pid),
    children: pid => procs[pid]?.children ?? [],
    pgid: pid => procs[pid]?.pgid ?? null,
    signal: (target, sig) => {
      sent.push(`${sig} ${target}`);
      const pids = target < 0 ? Object.keys(procs).map(Number).filter(p => procs[p].pgid === -target) : [target];
      let any = false;
      for (const p of pids) {
        if (!alive.has(p)) continue;
        any = true;
        if ((procs[p].dies ?? 'term') === 'term' || sig === 'SIGKILL') alive.delete(p);
      }
      return any;
    },
    taskkill: pid => {
      sent.push(`taskkill ${pid}`);
      const was = alive.delete(pid);
      for (const c of procs[pid]?.children ?? []) alive.delete(c);
      return was;
    },
    sleep: ms => { clock += ms; },
    now: () => clock,
  };
  return { deps, sent, alive };
}

describe('cleanupProcs (K2-03, K2-20)', () => {
  it('a pid whose start or image is not the recorded one is reused and left alone', () => {
    const { deps, sent } = machine({ 100: { startedAt: 50_000, image: 'node' }, 101: { startedAt: 10_000, image: 'chrome' } });
    const r = cleanupProcs([{ pid: 100, startedAt: 10_000, image: 'node' }, { pid: 101, startedAt: 10_500, image: 'node' }], null, deps, []);
    expect(r).toEqual({ killed: [], gone: [], reused: [100, 101] });
    expect(sent).toEqual([]);
  });
  it('POSIX: SIGTERM to the group it leads and to its descendants, SIGKILL to what is left after 5 s', () => {
    const { deps, sent, alive } = machine({
      200: { startedAt: 10_000, image: 'node', pgid: 200, children: [201], dies: 'kill' },
      201: { startedAt: 10_100, image: 'vite', pgid: 200, children: [202], dies: 'kill' },
      202: { startedAt: 10_200, image: 'esbuild', pgid: 999 },
    });
    const t0 = deps.now();
    expect(cleanupProcs([{ pid: 200, startedAt: 11_500, image: 'node' }], null, deps, []).killed).toEqual([200]);
    expect(sent).toEqual(['SIGTERM -200', 'SIGTERM 201', 'SIGTERM 202', 'SIGKILL -200']);
    expect(deps.now() - t0).toBeGreaterThanOrEqual(5000);
    expect([...alive]).toEqual([]);
  });
  it('an older list of integers: a process that started after pids.json was written is not killed; one before it is', () => {
    const { deps, sent } = machine({ 300: { startedAt: 20_000, image: 'node', pgid: 300 }, 301: { startedAt: 5_000, image: 'node', pgid: 301 } });
    expect(cleanupProcs(parsePids('[300, 301]'), 10_000, deps, [])).toEqual({ killed: [301], gone: [], reused: [300] });
    expect(sent).toEqual(['SIGTERM -301']);
  });
  it('never touches pid 1, its own process or its parent; a pid already gone is gone', () => {
    const { deps, sent } = machine({});
    const list = [1, process.pid, process.ppid, 4242];
    expect(cleanupProcs(parsePids(JSON.stringify(list)), null, deps)).toEqual({ killed: [], gone: list, reused: [] });
    expect(sent).toEqual([]);
  });
  it('Windows ends the tree with taskkill /T /F', () => {
    const { deps, sent } = machine({ 400: { startedAt: 1_000, image: 'node', children: [401] }, 401: { startedAt: 1_100, image: 'cmd' } }, 'win32');
    expect(cleanupProcs([{ pid: 400, startedAt: 1_000, image: 'node' }], null, deps, []).killed).toEqual([400]);
    expect(sent).toEqual(['taskkill 400']);
  });
  it('reads ps etime in its three forms, the PowerShell lines, both pids.json formats and the start tolerance', () => {
    expect([parseEtime('05:07'), parseEtime('02:05:07'), parseEtime('3-02:05:07'), parseEtime('x')]).toEqual([307, 7507, 266707, null]);
    expect(parsePsLine('   01:30 node', 100_000)).toEqual({ startedAt: 10_000, image: 'node' });
    expect(parsePowershell('2026-10-16T10:00:00.1234567Z\r\nnode\r\n')).toEqual({ startedAt: Date.parse('2026-10-16T10:00:00.123Z'), image: 'node' });
    expect(parsePids('[12, {"pid": 13, "startedAt": 5, "image": "node"}, "x", {"pid": -1}]')).toEqual([{ pid: 12 }, { pid: 13, startedAt: 5, image: 'node' }]);
    expect(parsePids('not json')).toEqual([]);
    expect(sameProcess({ pid: 1, startedAt: 10_000, image: 'node' }, { startedAt: 11_900, image: 'node' }, null)).toBe(true);
    expect(sameProcess({ pid: 1, startedAt: 10_000, image: 'node' }, { startedAt: 12_100, image: 'node' }, null)).toBe(false);
  });
});

describe("SPAWN_WRAPPER's quoting for cmd.exe (Review Focus 1)", () => {
  const quote = runInNewContext(SPAWN_QUOTE) as (a: string) => string;
  it('quotes a node path with spaces and a script with =>, doubles an inner quote and leaves a plain argument bare', () => {
    expect(SPAWN_WRAPPER).toContain(`const quote = ${SPAWN_QUOTE};`);
    expect(quote('C:\\Program Files\\nodejs\\node.exe')).toBe('"C:\\Program Files\\nodejs\\node.exe"');
    expect(quote('setTimeout(() => {}, 60000)')).toBe('"setTimeout(() => {}, 60000)"');
    expect(quote('say "hi"')).toBe('"say ""hi"""');
    const plain = ['--cwd', 'x.json', '../bad', 'C:\\x\\y', 'a=b@c+d,e'];
    expect(plain.map(quote)).toEqual(plain);
  });
});

describe('verify-spawn and verify-cleanup with real processes (K2-03, K2-20)', () => {
  const ev = '.forge/work/T1/evidence/1-1';
  const io = (cwd: string): Io => ({ cwd, now: () => new Date(), env: {} });
  const json = (r: { code: number; stdout: string; stderr: string }) => { expect(r.stderr).toBe(''); expect(r.code).toBe(0); return JSON.parse(r.stdout); };
  // Every evidence dir a test starts processes in: what a failed test left running is stopped after it.
  const evidences: string[] = [];
  afterEach(() => { for (const dir of evidences.splice(0)) stopEvidence(dir, defaultProcDeps()); });
  const project = () => { const root = tmp('forge-vproc-'); evidences.push(path.join(root, ev)); return root; };

  it('starts a node that sleeps, records it with its identity, and verify-cleanup stops it (Review Focus 1: a script with =>)', async () => {
    const root = project();
    const out = json(run(['verify-spawn', '--dir', ev, '--', process.execPath, '-e', 'setTimeout(() => {}, 60000)'], io(root)));
    expect(out).toMatchObject({ started: true, running: true, log: `${ev}/logs/1.log` });
    const [entry] = JSON.parse(readFileSync(path.join(root, ev, 'pids.json'), 'utf8'));
    expect(entry).toMatchObject({ pid: out.pid, image: expect.any(String), startedAt: expect.any(Number) });
    expect(json(run(['verify-cleanup', '--dir', ev], io(root)))).toMatchObject({ killed: [out.pid], reused: [] });
    await new Promise(res => setTimeout(res, 500));
    expect(() => process.kill(out.pid, 0)).toThrow();
  }, 30_000);

  // The window is 15 s here, not verify-spawn's 1 s: the command always ends long before, so nothing races the clock.
  it('a command that ends in the window with another code did not start: its code and the tail of its log, nothing recorded', () => {
    const root = project();
    const out = spawnVerified(path.join(root, ev), root, [process.execPath, '-e', "console.log('port busy'); process.exit(3)"], defaultProcDeps(), 15_000);
    expect(out).toMatchObject({ started: false, code: 3, running: false });
    expect(out.logTail).toContain('port busy');
    expect(existsSync(path.join(root, ev, 'pids.json'))).toBe(false);
  }, 30_000);

  it('another code without output did not start either; one that ends with 0 started and is done, nothing to stop', () => {
    const root = project();
    expect(spawnVerified(path.join(root, ev), root, [process.execPath, '-e', 'process.exit(4)'], defaultProcDeps(), 15_000))
      .toMatchObject({ started: false, code: 4, running: false, logTail: '' });
    expect(spawnVerified(path.join(root, ev), root, [process.execPath, '-e', 'process.exit(0)'], defaultProcDeps(), 15_000))
      .toMatchObject({ started: true, running: false });
    expect(existsSync(path.join(root, ev, 'pids.json'))).toBe(false);
  }, 30_000);

  // node reads the flags after its script as its own unless a `--` of its own ends them: that one passes through too.
  it('nothing after -- is a flag of forge: the --cwd, --out and --project of the command are its own (Review Focus 1)', () => {
    const root = project();
    const cmd = [process.execPath, '-e', 'setTimeout(() => {}, 60000)', '--', '--cwd', 'nope', '--out', 'x.json', '--project', '../bad'];
    const out = json(run(['verify-spawn', '--dir', ev, '--', ...cmd], io(root)));
    expect(out).toMatchObject({ started: true, running: true });
    expect(existsSync(path.join(root, 'x.json'))).toBe(false);
    expect(json(run(['verify-cleanup', '--dir', ev], io(root)))).toMatchObject({ killed: [out.pid], reused: [] });
  }, 30_000);

  it('needs --dir and a command', () => {
    const root = project();
    expect(run(['verify-spawn', '--dir', ev], io(root)).code).toBe(2);
    expect(run(['verify-spawn', '--', 'node'], io(root)).code).toBe(2);
  });
});
