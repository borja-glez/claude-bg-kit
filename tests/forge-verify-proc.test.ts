import { afterEach, describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { useTempDirs } from './helpers/tmp.js';
import { run, type Io } from '../src/forge/cli/run.js';
import { pidAlive, sleepSync } from '../src/forge/pid.js';
import {
  cleanupProcs, defaultProcDeps, parseEtime, parsePids, parsePowershell, parsePsLine, sameProcess, spawnVerified, stopEvidence,
  SPAWN_QUOTE, SPAWN_WRAPPER, START_TOLERANCE_MS, type ProcDeps,
} from '../src/forge/verify-proc.js';

const tmp = useTempDirs();

type Fake = { startedAt: number; image: string; pgid?: number; children?: number[]; dies?: 'term' | 'kill'; unreadable?: boolean };
/** A fake machine: each pid with its start, image, group and children; a SIGTERM ends a 'term' process, only SIGKILL a
 *  'kill' one, and an 'unreadable' one shows no identity. Every signal is recorded, and sleeping moves the clock (and
 *  runs `onSleep`, where a test changes what a pid is). */
function machine(procs: Record<number, Fake>, platform: NodeJS.Platform = 'linux', onSleep?: () => void) {
  const sent: string[] = [];
  const alive = new Set(Object.keys(procs).map(Number));
  let clock = 1_000_000;
  const deps: ProcDeps = {
    platform,
    procInfo: pid => (alive.has(pid) && !procs[pid].unreadable ? { startedAt: procs[pid].startedAt, image: procs[pid].image } : null),
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
    sleep: ms => { clock += ms; onSleep?.(); },
    now: () => clock,
  };
  return { deps, sent, alive };
}
const none = { killed: [], gone: [], reused: [], unknown: [] };

describe('cleanupProcs (K2-03, K2-20)', () => {
  it('a pid whose start or image is not the recorded one is reused and left alone', () => {
    const { deps, sent } = machine({ 100: { startedAt: 50_000, image: 'node' }, 101: { startedAt: 10_000, image: 'chrome' } });
    const r = cleanupProcs([{ pid: 100, startedAt: 10_000, image: 'node' }, { pid: 101, startedAt: 10_500, image: 'node' }], null, deps, []);
    expect(r).toEqual({ ...none, reused: [100, 101] });
    expect(sent).toEqual([]);
  });
  it('a pid whose identity cannot be read now is unknown and never signalled, on Windows as on POSIX (K2-20.2)', () => {
    for (const platform of ['win32', 'linux'] as const) {
      const { deps, sent } = machine({
        4242: { startedAt: 1_000, image: 'node', pgid: 4242, unreadable: true },
        4243: { startedAt: 1_000, image: 'node', pgid: 4243, unreadable: true },
      }, platform);
      expect(cleanupProcs([{ pid: 4242, startedAt: 1_000, image: 'node' }, { pid: 4243 }], 10_000, deps, [])).toEqual({ ...none, unknown: [4242, 4243] });
      expect(sent).toEqual([]);
    }
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
  it('the SIGKILL after the 5 s goes only to what still shows its identity: a pid another process took meanwhile is left alone', () => {
    const procs: Record<number, Fake> = {
      500: { startedAt: 10_000, image: 'node', pgid: 500, children: [501], dies: 'kill' },
      501: { startedAt: 10_100, image: 'vite', pgid: 500, dies: 'kill' },
    };
    // 500 ends during the grace and the system gives its pid to an unrelated shell, alone in its own group.
    const { deps, sent, alive } = machine(procs, 'linux', () => { procs[500] = { startedAt: 99_000, image: 'bash', pgid: 777 }; });
    expect(cleanupProcs([{ pid: 500, startedAt: 10_000, image: 'node' }], null, deps, []).killed).toEqual([500]);
    expect(sent).toEqual(['SIGTERM -500', 'SIGTERM 501', 'SIGKILL 501']);
    expect([...alive]).toEqual([500]);
  });
  it('an older list of integers: a process that started after pids.json was written is not killed; one before it is', () => {
    const { deps, sent } = machine({ 300: { startedAt: 20_000, image: 'node', pgid: 300 }, 301: { startedAt: 5_000, image: 'node', pgid: 301 } });
    expect(cleanupProcs(parsePids('[300, 301]'), 10_000, deps, [])).toEqual({ ...none, killed: [301], reused: [300] });
    expect(sent).toEqual(['SIGTERM -301']);
  });
  it('never signals pid 1, its own process or its parent, alive and recorded as they are; a pid already gone is gone', () => {
    const me: Fake = { startedAt: 10_000, image: 'node', pgid: 50 };
    const { deps, sent, alive } = machine({ 1: { startedAt: 0, image: 'init', pgid: 1 }, [process.pid]: me, [process.ppid]: { ...me } });
    const list = [1, process.pid, process.ppid, 4242];
    expect(cleanupProcs([{ pid: 1 }, ...[process.pid, process.ppid].map(pid => ({ pid, ...me })), { pid: 4242 }], null, deps)).toEqual({ ...none, gone: list });
    expect(sent).toEqual([]);
    expect([...alive].sort()).toEqual([1, process.pid, process.ppid].sort());
  });
  it('never signals pid 1 or its own process as a descendant, nor as a group the group its own process is in', () => {
    const { deps, sent } = machine({
      600: { startedAt: 10_000, image: 'node', pgid: 600, children: [1, process.pid] },
      1: { startedAt: 0, image: 'init', pgid: 1 },
      [process.pid]: { startedAt: 5_000, image: 'node', pgid: 600 },
    });
    expect(cleanupProcs([{ pid: 600, startedAt: 10_000, image: 'node' }], null, deps).killed).toEqual([600]);
    expect(sent).toEqual(['SIGTERM 600']);
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

describe('stopEvidence', () => {
  it("reads each spawn's record and the older pids.json; drops what it stopped, found gone or reused, keeps unknown with pids.json's date", () => {
    const ev = tmp('forge-vstop-');
    mkdirSync(path.join(ev, 'logs'));
    writeFileSync(path.join(ev, 'logs', '1.pid.json'), JSON.stringify([{ pid: 700, startedAt: 10_000, image: 'node' }]));
    writeFileSync(path.join(ev, 'logs', '2.pid.json'), JSON.stringify([{ pid: 701, startedAt: 10_000, image: 'node' }]));
    const pids = path.join(ev, 'pids.json');
    writeFileSync(pids, JSON.stringify([702, 703]));
    const written = new Date('2026-10-01T00:00:00Z');
    utimesSync(pids, written, written);
    const { deps, sent } = machine({
      700: { startedAt: 10_000, image: 'node', pgid: 700 },
      701: { startedAt: 90_000, image: 'chrome' },
      703: { startedAt: 1, image: 'node', unreadable: true },
    });
    expect(stopEvidence(ev, deps)).toEqual({ killed: [700], gone: [702], reused: [701], unknown: [703] });
    expect(sent).toEqual(['SIGTERM -700']);
    expect([existsSync(path.join(ev, 'logs', '1.pid.json')), existsSync(path.join(ev, 'logs', '2.pid.json'))]).toEqual([false, false]);
    expect(parsePids(readFileSync(pids, 'utf8'))).toEqual([{ pid: 703 }]);
    expect(Math.round(statSync(pids).mtimeMs)).toBe(written.getTime());
    // A second pass (verify-close runs one after the agent's verify-cleanup) looks only at what is still unknown.
    expect(stopEvidence(ev, deps)).toEqual({ ...none, unknown: [703] });
    expect(sent).toEqual(['SIGTERM -700']);
  });
});

describe("SPAWN_WRAPPER's quoting for cmd.exe (Review Focus 1)", () => {
  const quote = runInNewContext(SPAWN_QUOTE) as (a: string) => string;
  it('quotes a node path with spaces and a script with =>, doubles backslashes before a quote or at the end, and leaves a plain argument bare', () => {
    expect(SPAWN_WRAPPER).toContain(`const quote = ${SPAWN_QUOTE};`);
    expect(quote('C:\\Program Files\\nodejs\\node.exe')).toBe('"C:\\Program Files\\nodejs\\node.exe"');
    expect(quote('setTimeout(() => {}, 60000)')).toBe('"setTimeout(() => {}, 60000)"');
    expect(quote('say "hi"')).toBe('"say ""hi"""');
    expect(quote('C:\\my dir\\')).toBe('"C:\\my dir\\\\"');
    expect(quote('a\\"b')).toBe('"a\\\\""b"');
    const plain = ['--cwd', 'x.json', '../bad', 'C:\\x\\y', 'a=b@c+d,e'];
    expect(plain.map(quote)).toEqual(plain);
  });
});

describe('verify-spawn and verify-cleanup with real processes (K2-03, K2-20)', () => {
  const ev = '.forge/work/T1/evidence/1-1';
  const io = (cwd: string): Io => ({ cwd, now: () => new Date(), env: {} });
  const json = (r: { code: number; stdout: string; stderr: string }) => { expect(r.stderr).toBe(''); expect(r.code).toBe(0); return JSON.parse(r.stdout); };
  // A command that writes its pid, its start and the arguments it got to `file` (its first argument), then sleeps: the
  // process verify-cleanup must stop (on Windows the wrapper's grandchild, under cmd.exe).
  const SLEEPER = "require('fs').writeFileSync(process.argv[1], JSON.stringify({ pid: process.pid, at: Date.now(), argv: process.argv.slice(2) })); setTimeout(() => {}, 60000)";
  const sleeper = (file: string, ...args: string[]) => [process.execPath, '-e', SLEEPER, '--', file, ...args];
  type Cmd = { pid: number; at: number; argv: string[] };
  /** Whether the command has ended: its pid is free, or another process that started at another time holds it now. */
  const ended = (c: Cmd) => {
    if (!pidAlive(c.pid)) return true;
    const now = defaultProcDeps().procInfo(c.pid);
    return now !== null && Math.abs(now.startedAt - c.at) > START_TOLERANCE_MS;
  };
  const commands: Cmd[] = [];
  /** What the sleeper wrote, once it has written it. */
  function commandOf(file: string): Cmd {
    for (let i = 0; i < 100; i++) {
      try { const c = JSON.parse(readFileSync(file, 'utf8')) as Cmd; commands.push(c); return c; } catch { sleepSync(100); }
    }
    throw new Error(`the command never wrote ${file}`);
  }
  async function endedSoon(c: Cmd): Promise<boolean> {
    for (let i = 0; i < 25; i++) {
      if (ended(c)) return true;
      await new Promise(res => setTimeout(res, 200));
    }
    return false;
  }
  // Every evidence dir a test starts processes in, and every command it saw start: what a failed test left running is
  // stopped after it (a command only while it is still the one that wrote its file).
  const evidences: string[] = [];
  afterEach(() => {
    for (const dir of evidences.splice(0)) stopEvidence(dir, defaultProcDeps());
    for (const c of commands.splice(0)) if (!ended(c)) { try { process.kill(c.pid); } catch { /* gone meanwhile */ } }
  });
  const project = () => { const root = tmp('forge-vproc-'); evidences.push(path.join(root, ev)); return root; };

  it('two spawns into one evidence dir each get their own log and record; verify-cleanup stops both commands (Review Focus 1: a script with =>)', async () => {
    const root = project();
    const a = json(run(['verify-spawn', '--dir', ev, '--', ...sleeper(path.join(root, 'a.json'))], io(root)));
    const b = json(run(['verify-spawn', '--dir', ev, '--', ...sleeper(path.join(root, 'b.json'))], io(root)));
    expect(a).toMatchObject({ started: true, running: true, log: `${ev}/logs/1.log` });
    expect(b).toMatchObject({ started: true, running: true, log: `${ev}/logs/2.log` });
    const record = (n: number) => JSON.parse(readFileSync(path.join(root, ev, 'logs', `${n}.pid.json`), 'utf8'));
    expect([record(1), record(2)]).toEqual([
      [{ pid: a.pid, startedAt: expect.any(Number), image: expect.any(String) }],
      [{ pid: b.pid, startedAt: expect.any(Number), image: expect.any(String) }],
    ]);
    const cmds = [commandOf(path.join(root, 'a.json')), commandOf(path.join(root, 'b.json'))];
    expect(cmds.map(ended)).toEqual([false, false]);
    expect(json(run(['verify-cleanup', '--dir', ev], io(root)))).toEqual({ ...none, killed: [a.pid, b.pid] });
    for (const c of cmds) expect(await endedSoon(c)).toBe(true);
    // verify-close runs a second pass: nothing is left to look at.
    expect(json(run(['verify-cleanup', '--dir', ev], io(root)))).toEqual(none);
  }, 90_000);

  // The window is 15 s here, not verify-spawn's 1 s: the command always ends long before, so nothing races the clock.
  it('a command that ends in the window with another code did not start: its code and the tail of its log, nothing recorded', () => {
    const root = project();
    const out = spawnVerified(path.join(root, ev), root, [process.execPath, '-e', "console.log('port busy'); process.exit(3)"], defaultProcDeps(), 15_000);
    expect(out).toMatchObject({ started: false, code: 3, running: false });
    expect(out.logTail).toContain('port busy');
    expect(existsSync(path.join(root, ev, 'logs', '1.pid.json'))).toBe(false);
  }, 30_000);

  it('another code without output did not start either; one that ends with 0 started and is done, nothing to stop', () => {
    const root = project();
    expect(spawnVerified(path.join(root, ev), root, [process.execPath, '-e', 'process.exit(4)'], defaultProcDeps(), 15_000))
      .toMatchObject({ started: false, code: 4, running: false, logTail: '' });
    expect(spawnVerified(path.join(root, ev), root, [process.execPath, '-e', 'process.exit(0)'], defaultProcDeps(), 15_000))
      .toMatchObject({ started: true, running: false });
    expect(stopEvidence(path.join(root, ev), defaultProcDeps())).toEqual(none);
  }, 30_000);

  it('takes the next log no other spawn holds, and an exit file left from a removed log is not read as its end', () => {
    const root = project();
    const logs = path.join(root, ev, 'logs');
    mkdirSync(logs, { recursive: true });
    writeFileSync(path.join(logs, '2.log'), 'another spawn\n');
    writeFileSync(path.join(logs, '3.log.exit'), JSON.stringify({ code: 5 }));
    const out = spawnVerified(path.join(root, ev), root, [process.execPath, '-e', 'process.exit(0)'], defaultProcDeps(), 15_000);
    expect(out).toMatchObject({ started: true, running: false, log: path.join(logs, '3.log') });
    expect(readFileSync(path.join(logs, '2.log'), 'utf8')).toBe('another spawn\n');
  }, 30_000);

  it('the command gets its arguments as they were: spaces, a quote inside, a backslash before a quote and at the end, & and |', () => {
    const root = project();
    const args = ['two words', 'say "hi"', 'a\\"b', 'C:\\my dir\\', '"&echo PWNED&"', 'x|y'];
    const script = 'process.stdout.write(JSON.stringify(process.argv.slice(1)))';
    const out = spawnVerified(path.join(root, ev), root, [process.execPath, '-e', script, '--', ...args], defaultProcDeps(), 15_000);
    expect(out).toMatchObject({ started: true, running: false });
    expect(JSON.parse(readFileSync(out.log, 'utf8'))).toEqual(args);
  }, 30_000);

  it('when its record cannot be written, the command it just started is stopped before the error', async () => {
    const root = project();
    // writeAtomic's temporary file is a directory: the record of 1.log cannot be written.
    mkdirSync(path.join(root, ev, 'logs', `1.pid.json.${process.pid}.tmp`), { recursive: true });
    const file = path.join(root, 'cmd.json');
    expect(() => spawnVerified(path.join(root, ev), root, sleeper(file), defaultProcDeps(), 2_000)).toThrow();
    expect(await endedSoon(commandOf(file))).toBe(true);
  }, 30_000);

  // node reads the flags after its script as its own unless a `--` of its own ends them: that one passes through too.
  it('nothing after -- is a flag of forge: the --cwd, --out and --project of the command are its own (Review Focus 1)', async () => {
    const root = project();
    const own = ['--cwd', 'nope', '--out', 'x.json', '--project', '../bad'];
    const out = json(run(['verify-spawn', '--dir', ev, '--', ...sleeper(path.join(root, 'cmd.json'), ...own)], io(root)));
    expect(out).toMatchObject({ started: true, running: true });
    const cmd = commandOf(path.join(root, 'cmd.json'));
    expect(cmd.argv).toEqual(own);
    expect(existsSync(path.join(root, 'x.json'))).toBe(false);
    expect(json(run(['verify-cleanup', '--dir', ev], io(root)))).toEqual({ ...none, killed: [out.pid] });
    expect(await endedSoon(cmd)).toBe(true);
  }, 60_000);

  it.runIf(process.platform === 'win32')('on Windows an argument with a line break is refused: cmd.exe would end the command there', () => {
    const root = project();
    const r = run(['verify-spawn', '--dir', ev, '--', process.execPath, '-e', 'console.log(1)\nprocess.exit(0)'], io(root));
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^verify-spawn: .*line break/);
    expect(existsSync(path.join(root, ev, 'logs'))).toBe(false);
  });

  it('needs --dir and a command', () => {
    const root = project();
    expect(run(['verify-spawn', '--dir', ev], io(root)).code).toBe(2);
    expect(run(['verify-spawn', '--', 'node'], io(root)).code).toBe(2);
  });
});
