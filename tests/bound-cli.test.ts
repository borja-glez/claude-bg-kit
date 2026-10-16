import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, copyFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { run, type Io } from '../src/cli/run.js';
import { pidAlive } from '../src/lib/pid.js';
import { pidAlive as forgePidAlive } from '../src/forge/pid.js';
import { boundLive, pidAlive as seatPidAlive, pidFromEnv, settleBinding } from '../src/lib/bound-fs.js';
import { BOUND_MAX_BYTES, type BoundDoc } from '../src/lib/bound.js';

const FIXTURE = new URL('./fixtures/plan.yaml', import.meta.url);
const NOW = Date.parse('2026-10-15T12:00:00.000Z');
const at = (min: number) => new Date(NOW + min * 60000).toISOString();
const PLAN = 'docs/waypoint/demo-shop/plan.yaml';
let dir: string;
let io: Io;
const wp = (...p: string[]) => path.join(dir, '.waypoint', 'demo-shop', ...p);
const json = (f: string) => JSON.parse(readFileSync(f, 'utf8'));
const bind = (claude: string, ...flags: string[]) => run(['bind', PLAN, '--via', 'work', '--claude', claude, ...flags], io);
const outOf = (r: { stdout: string }) => JSON.parse(r.stdout);
/** Another conversation (A) bound to the checkout seat main, renewed a minute ago. */
const holder = (over: Record<string, unknown> = {}) => {
  mkdirSync(wp(), { recursive: true });
  writeFileSync(wp('bound.json'), JSON.stringify({ sid: 'main', claude: 'A', pid: null, via: 'work', since: at(-60), seenAt: at(-1), endedAt: null, endReason: null, ...over }));
};
const openTask = (task: string, owner: string) => {
  mkdirSync(wp('dbcache', 'state'), { recursive: true });
  writeFileSync(wp('dbcache', 'state', `${task}.json`), JSON.stringify({ status: 'in_progress', owner }));
};

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'wp-bind-'));
  mkdirSync(path.join(dir, 'docs', 'waypoint', 'demo-shop'), { recursive: true });
  copyFileSync(FIXTURE, path.join(dir, PLAN));
  io = { cwd: dir, now: () => new Date(NOW), rand: () => 0, assetsDir: dir, env: {} };
});

describe('waypoint bind (A-01, B-04, K5-04)', () => {
  it('binds the checkout seat, creates its session.json, and needs a Claude id', () => {
    const r = bind('A');
    expect(r.code).toBe(0);
    expect(outOf(r)).toEqual({ took: 'new', sid: 'main', seatDir: '.waypoint/demo-shop', sessionFile: '.waypoint/demo-shop/session.json', claude: 'A', via: 'work' });
    expect(json(wp('bound.json'))).toEqual({ sid: 'main', claude: 'A', pid: null, via: 'work', since: at(0), seenAt: at(0), endedAt: null, endReason: null });
    expect(json(wp('session.json'))).toEqual({ plan: PLAN, url: null, sessionId: 'main', track: null });
    expect(outOf(bind('A', '--track', 'ui'))).toMatchObject({ took: 'same', sid: 'main' });
    const none = run(['bind', PLAN, '--via', 'work'], io);
    expect(none.code).toBe(2);
    expect(none.stderr).toContain('no Claude session id');
    expect(run(['bind', PLAN, '--via', 'swarm', '--claude', 'A'], io).code).toBe(2);
    expect(run(['bind', PLAN, '--via', 'work', '--claude', 'A', '--seat', 'x', '--second-seat'], io).code).toBe(2);
  });
  it('a track names the new seat; a seat id a folder cannot hold is refused', () => {
    expect(outOf(bind('A', '--track', 'backend'))).toMatchObject({ took: 'new', sid: 'backend' });
    rmSync(wp(), { recursive: true });
    mkdirSync(wp(), { recursive: true });
    writeFileSync(wp('session.json'), JSON.stringify({ sessionId: 'a:b' }));
    expect(bind('A').code).toBe(2);
  });
  it('never takes a seat another live conversation holds: exit 3 with the three options in order, and nothing written', () => {
    holder();
    openTask('T002', 'main');
    const r = bind('B');
    expect(r.code).toBe(3);
    expect(outOf(r)).toEqual({ held: { sid: 'main', claude: 'A', via: 'work', seenAt: at(-1), task: 'T002' }, options: ['worktree', 'second-seat', 'takeover'], secondSeat: 'main-2' });
    expect(json(wp('bound.json')).claude).toBe('A');
    expect(bind('B', '--resume').code).toBe(3);
  });
  it('--second-seat binds main-2 in seats/ with its own session.json; the next one is main-3, and it keeps its own', () => {
    holder();
    expect(outOf(bind('B', '--second-seat'))).toMatchObject({ took: 'new', sid: 'main-2', seatDir: '.waypoint/demo-shop/seats/main-2' });
    expect(json(wp('seats', 'main-2', 'bound.json'))).toMatchObject({ sid: 'main-2', claude: 'B' });
    expect(json(wp('seats', 'main-2', 'session.json'))).toMatchObject({ sessionId: 'main-2' });
    expect(outOf(bind('C', '--second-seat')).sid).toBe('main-3');
    expect(outOf(bind('B', '--second-seat'))).toMatchObject({ took: 'same', sid: 'main-2' });
  });
  it('--takeover overwrites a live binding and names the previous one', () => {
    holder();
    expect(outOf(bind('B', '--takeover'))).toMatchObject({ took: 'takeover', sid: 'main', previous: { sid: 'main', claude: 'A', endedAt: null, task: null } });
    expect(json(wp('bound.json'))).toMatchObject({ claude: 'B', endedAt: null, since: at(0) });
  });
  it('an ended binding with a task in progress asks first (exit 4); --resume takes it', () => {
    holder({ endedAt: at(-30), endReason: 'clear' });
    openTask('T002', 'main');
    const r = bind('B');
    expect(r.code).toBe(4);
    expect(outOf(r)).toEqual({ previous: { sid: 'main', claude: 'A', endedAt: at(-30), endReason: 'clear', seenAt: at(-1), task: 'T002' }, options: ['resume', 'release'] });
    expect(json(wp('bound.json')).claude).toBe('A');
    expect(outOf(bind('B', '--resume'))).toMatchObject({ took: 'previous', sid: 'main' });
    expect(json(wp('bound.json'))).toMatchObject({ claude: 'B', since: at(0), endedAt: null });
  });
  /** An earlier conversation's binding of the extra seat `sid`, ended `min` minutes ago by /clear. */
  const leftOn = (sid: string, claude: string, min: number) => {
    mkdirSync(wp('seats', sid), { recursive: true });
    writeFileSync(wp('seats', sid, 'bound.json'), JSON.stringify({ sid, claude, pid: null, via: 'work', since: at(-90), seenAt: at(-min), endedAt: at(-min), endReason: 'clear' }));
  };
  const startContext = (claude: string) => {
    const r = run(['hook', 'session-start'], { ...io, stdin: JSON.stringify({ session_id: claude, source: 'startup' }) });
    return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext as string : '';
  };
  it('--resume takes the seat an earlier conversation left its task on, also a second seat next to a live one (I3)', () => {
    holder();
    leftOn('main-2', 'W', 30);
    openTask('T003', 'main-2');
    expect(outOf(bind('C', '--resume'))).toMatchObject({ took: 'previous', sid: 'main-2', seatDir: '.waypoint/demo-shop/seats/main-2', previous: { sid: 'main-2', claude: 'W', task: 'T003' } });
    expect(json(wp('seats', 'main-2', 'bound.json'))).toMatchObject({ claude: 'C', endedAt: null });
    expect(json(wp('bound.json')).claude).toBe('A');
    expect(startContext('C')).toContain('Current task: T003');
  });
  it('exit 3 names a task another seat left, so the person can resume it there (I3)', () => {
    holder();
    leftOn('main-2', 'W', 30);
    openTask('T003', 'main-2');
    const r = bind('C');
    expect(r.code).toBe(3);
    expect(outOf(r)).toMatchObject({ held: { sid: 'main', claude: 'A' }, previous: { sid: 'main-2', claude: 'W', endedAt: at(-30), endReason: 'clear', task: 'T003' } });
    expect(outOf(bind('C', '--seat', 'main-2', '--resume'))).toMatchObject({ took: 'previous', sid: 'main-2' });
  });
  it('a newer ended binding without a task does not hide an older one that has a task (I3)', () => {
    leftOn('main-2', 'W', 60);
    openTask('T003', 'main-2');
    leftOn('main-3', 'X', 5);
    expect(startContext('C')).toContain('T003');
    expect(outOf(bind('C', '--resume'))).toMatchObject({ took: 'previous', sid: 'main-2' });
  });
  it('--resume keeps the seat this conversation holds with a task open; a left seat is only for one without (M1, I3)', () => {
    bind('A');
    leftOn('main-2', 'W', 30);
    openTask('T001', 'main');
    openTask('T003', 'main-2');
    expect(outOf(bind('A', '--resume'))).toMatchObject({ took: 'same', sid: 'main', seatDir: '.waypoint/demo-shop' });
    expect(json(wp('bound.json'))).toMatchObject({ claude: 'A', endedAt: null });
    expect(json(wp('seats', 'main-2', 'bound.json'))).toMatchObject({ claude: 'W' });
    // With no task of its own open, --resume takes up the left task, and its old seat ends (one seat per conversation).
    rmSync(wp('dbcache', 'state', 'T001.json'));
    expect(outOf(bind('A', '--resume'))).toMatchObject({ took: 'previous', sid: 'main-2' });
    expect(json(wp('bound.json'))).toMatchObject({ claude: 'A', endReason: 'released' });
  });
  it('without a task left anywhere --resume binds as before', () => {
    leftOn('main-3', 'X', 5);
    expect(outOf(bind('C', '--resume'))).toMatchObject({ took: 'new', sid: 'main', seatDir: '.waypoint/demo-shop' });
  });
  it("a bind ends this conversation's other live bindings in the project: one conversation, one seat (M1)", () => {
    bind('A');
    bind('B', '--seat', 'main-3');
    expect(outOf(bind('A', '--seat', 'main-2'))).toMatchObject({ took: 'new', sid: 'main-2' });
    expect(json(wp('bound.json'))).toMatchObject({ claude: 'A', endedAt: at(0), endReason: 'released' });
    expect(json(wp('seats', 'main-2', 'bound.json'))).toMatchObject({ claude: 'A', endedAt: null });
    expect(json(wp('seats', 'main-3', 'bound.json'))).toMatchObject({ claude: 'B', endedAt: null });
  });
  it('the holder binding again with --seat <its sid> (work §1.1) is took: same and renews its binding (M2)', () => {
    bind('A');
    bind('B', '--second-seat');
    io = { ...io, now: () => new Date(NOW + 3 * 60000) };
    expect(outOf(bind('A', '--seat', 'main'))).toMatchObject({ took: 'same', sid: 'main', seatDir: '.waypoint/demo-shop' });
    expect(json(wp('bound.json'))).toMatchObject({ since: at(0), seenAt: at(3) });
    expect(outOf(bind('B', '--seat', 'main-2'))).toMatchObject({ took: 'same', sid: 'main-2', seatDir: '.waypoint/demo-shop/seats/main-2' });
    expect(bind('C', '--seat', 'main').code).toBe(3);
  });
  it('a lapsed lease without a task binds at once', () => {
    holder({ seenAt: at(-6) });
    expect(outOf(bind('B'))).toMatchObject({ took: 'previous', previous: { claude: 'A', task: null } });
  });
  it('an owner whose process is gone counts as ended: exit 4 with a task, 0 without; a live process holds it', () => {
    holder({ pid: 2147483646 });
    openTask('T002', 'main');
    const r = bind('B');
    expect(r.code).toBe(4);
    // previous says what the hooks see: ended at its last renewal.
    expect(outOf(r).previous).toMatchObject({ endedAt: at(-1), endReason: null, task: 'T002' });
    rmSync(wp('dbcache'), { recursive: true });
    expect(bind('B').code).toBe(0);
    holder({ pid: process.pid });
    expect(bind('C').code).toBe(3);
  });
  it('the same conversation moving to forge keeps since; CLAUDE_PID is the pid when it is a positive integer', () => {
    io = { ...io, env: { CLAUDE_PID: '4242' } };
    bind('A');
    io = { ...io, now: () => new Date(NOW + 60000) };
    expect(outOf(run(['bind', PLAN, '--via', 'forge-run', '--claude', 'A'], io))).toMatchObject({ took: 'same', via: 'forge-run' });
    expect(json(wp('bound.json'))).toMatchObject({ via: 'forge-run', since: at(0), seenAt: at(1), pid: 4242 });
  });
  it('a broken, future or unknown bound.json is no binding: bind writes over it (Review Focus 4)', () => {
    const texts = ['{oops',
      JSON.stringify({ sid: 'main', claude: 'A', pid: null, via: 'work', since: at(10), seenAt: at(10), endedAt: null, endReason: null }),
      JSON.stringify({ sid: 'main', claude: 'A', pid: null, via: 'swarm', since: at(-1), seenAt: at(-1), endedAt: null, endReason: null }),
      JSON.stringify({ sid: 'main-9', claude: 'A', pid: null, via: 'work', since: at(-1), seenAt: at(-1), endedAt: null, endReason: null })];
    for (const text of texts) {
      mkdirSync(wp(), { recursive: true });
      writeFileSync(wp('session.json'), JSON.stringify({ sessionId: 'main' }));
      writeFileSync(wp('bound.json'), text);
      expect(outOf(bind('B')), text).toMatchObject({ took: 'new', sid: 'main' });
    }
  });
  it('bind keeps every field session.json already has, and release leaves it (B-12)', () => {
    mkdirSync(wp(), { recursive: true });
    const session = { plan: 'x', url: 'u', sessionId: 'backend', track: 'backend', agentName: 'work-1', lastNoteTs: 't' };
    writeFileSync(wp('session.json'), JSON.stringify(session));
    expect(outOf(bind('A'))).toMatchObject({ sid: 'backend', seatDir: '.waypoint/demo-shop' });
    expect(json(wp('session.json'))).toEqual(session);
    run(['release', PLAN, '--claude', 'A'], io);
    expect(json(wp('session.json'))).toEqual(session);
  });
  it('stores HEAD of the worktree as the base of this conversation in last-head.json', () => {
    const git = (...a: string[]) => execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', '-c', 'core.autocrlf=false', ...a], { cwd: dir, encoding: 'utf8' }).trim();
    git('init', '-q'); git('add', '.'); git('commit', '-qm', 'init');
    bind('A');
    const lh = json(wp('last-head.json'));
    expect(lh.session).toBe('A');
    expect(Object.values(lh.heads)).toEqual([git('rev-parse', 'HEAD')]);
  });
  it('a design binds the project of its folder', () => {
    copyFileSync(new URL('./fixtures/design.md', import.meta.url), path.join(dir, 'docs', 'waypoint', 'demo-shop', 'design.md'));
    expect(outOf(run(['bind', 'docs/waypoint/demo-shop/design.md', '--via', 'design', '--claude', 'A'], io))).toMatchObject({ took: 'new', sid: 'main', via: 'design' });
    expect(json(wp('session.json'))).toMatchObject({ plan: PLAN, sessionId: 'main' });
  });
});

describe('waypoint release', () => {
  it('ends the binding of this conversation; another live one is refused with exit 3; an ended one stays as it is', () => {
    bind('A');
    expect(outOf(run(['release', PLAN, '--claude', 'A'], io))).toEqual({ released: true, sid: 'main', seatDir: '.waypoint/demo-shop', now: at(0) });
    expect(json(wp('bound.json'))).toMatchObject({ endedAt: at(0), endReason: 'released' });
    expect(outOf(run(['release', PLAN, '--claude', 'A'], io)).released).toBe(false);
    holder();
    expect(run(['release', PLAN, '--claude', 'B'], io)).toEqual({ code: 3, stdout: '', stderr: 'release: main is bound to another live session\n' });
  });
  it('--free prints the batch that frees the task of its seat, and refuses a task of another seat or a bad version', () => {
    holder({ endedAt: at(-60), endReason: 'clear' });
    openTask('T002', 'main');
    openTask('T003', 'ui');
    const r = outOf(run(['release', PLAN, '--claude', 'B', '--seat', 'main', '--free', 'T002', '--state-version', '4', '--session-version', '9'], io));
    expect(r.released).toBe(false);
    expect(r.batch).toEqual([
      { op: 'update', collection: 'state', doc_id: 'T002', data: { status: 'free', owner: { __delete__: true }, claimedAt: { __delete__: true }, startedAt: { __delete__: true } }, if_version: 4 },
      { op: 'update', collection: 'sessions', doc_id: 'main', data: { currentTask: { __delete__: true }, status: 'idle' }, if_version: 9 },
    ]);
    expect(json(wp('dbcache', 'state', 'T002.json'))).toEqual({ status: 'free' });
    expect(run(['release', PLAN, '--claude', 'B', '--seat', 'main', '--free', 'T003', '--state-version', '4'], io).code).toBe(2);
    expect(run(['release', PLAN, '--claude', 'B', '--seat', 'main', '--free', 'T002', '--state-version', 'x'], io).code).toBe(2);
  });
  it('a seat it does not know, or a --db without its directory, is exit 2; a broken bound.json is released as no binding', () => {
    bind('A');
    expect(run(['release', PLAN, '--claude', 'A', '--seat', 'main-7'], io).code).toBe(2);
    // --seat with no value, also as the last argument, names no seat: exit 2, and the binding stays.
    expect(run(['release', PLAN, '--claude', 'A', '--seat'], io).code).toBe(2);
    expect(run(['release', PLAN, '--seat', '--claude', 'A'], io).code).toBe(2);
    expect(json(wp('bound.json')).endedAt).toBeNull();
    expect(run(['release', PLAN, '--claude', 'A', '--free', 'T002', '--state-version', '4', '--db', '--seat'], io).code).toBe(2);
    writeFileSync(wp('bound.json'), '{oops');
    expect(outOf(run(['release', PLAN, '--claude', 'A'], io))).toMatchObject({ released: false, sid: 'main' });
    expect(readFileSync(wp('bound.json'), 'utf8')).toBe('{oops');
  });
});

describe('the seats on disk (spec §4.10)', () => {
  it('one pidAlive: forge and bound-fs re-export the one of src/lib; a dead pid, 0 or a fraction is not alive', () => {
    expect(forgePidAlive).toBe(pidAlive);
    expect(seatPidAlive).toBe(pidAlive);
    expect(pidAlive(process.pid)).toBe(true);
    expect(pidAlive(spawnSync(process.execPath, ['-e', '']).pid!)).toBe(false);
    for (const p of [0, -1, 1.5, Number.NaN]) expect(pidAlive(p), String(p)).toBe(false);
  });
  it('CLAUDE_PID is a pid only as a positive integer', () => {
    expect(pidFromEnv({ CLAUDE_PID: '4242' })).toBe(4242);
    expect(pidFromEnv({ CLAUDE_PID: '2147483647' })).toBe(2147483647);
    for (const v of [undefined, '', '0', '-3', '1.5', 'abc', '0x10', ' 42', '2147483648', '9999999999']) expect(pidFromEnv({ CLAUDE_PID: v }), String(v)).toBeNull();
  });
  it('a binding live by its lease whose process is gone reads as ended at its last renewal, and is not live', () => {
    const b: BoundDoc = { sid: 'main', claude: 'A', pid: 7, via: 'work', since: at(-60), seenAt: at(-1), endedAt: null, endReason: null };
    const dead = () => false;
    const alive = () => true;
    expect(boundLive(b, NOW, alive)).toBe(true);
    expect(boundLive(b, NOW, dead)).toBe(false);
    expect(boundLive({ ...b, pid: null }, NOW, dead)).toBe(true);
    expect(settleBinding(b, NOW, dead)).toEqual({ ...b, endedAt: at(-1) });
    expect(settleBinding(b, NOW, alive)).toBe(b);
    expect(settleBinding({ ...b, seenAt: at(-6) }, NOW, dead)).toEqual({ ...b, seenAt: at(-6) });
  });
  it('a seat or a track that starts with a dash (an empty substitution leaves the next flag there) is exit 2, and nothing is written', () => {
    expect(bind('A', '--seat', '--resume').code).toBe(2);
    expect(bind('A', '--track', '--resume').code).toBe(2);
    expect(bind('A', '--seat').code).toBe(2);
    expect(existsSync(wp())).toBe(false);
  });
  it('an oversized bound.json is no binding', () => {
    mkdirSync(wp(), { recursive: true });
    writeFileSync(wp('bound.json'), JSON.stringify({ sid: 'main', claude: 'A', pid: null, via: 'work', since: at(-1), seenAt: at(-1), endedAt: null, endReason: null, pad: 'x'.repeat(BOUND_MAX_BYTES) }));
    expect(outOf(bind('B'))).toMatchObject({ took: 'new', sid: 'main' });
  });
  it('with every extra seat held by a live conversation --second-seat is exit 2, and exit 3 offers no second seat', () => {
    holder();
    for (let n = 2; n <= 11; n++) {
      mkdirSync(wp('seats', `main-${n}`), { recursive: true });
      writeFileSync(wp('seats', `main-${n}`, 'bound.json'), JSON.stringify({ sid: `main-${n}`, claude: `X${n}`, pid: null, via: 'work', since: at(-1), seenAt: at(-1), endedAt: null, endReason: null }));
    }
    const r = bind('B', '--second-seat');
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('main-2 to main-11');
    expect(outOf(bind('B'))).toMatchObject({ secondSeat: null });
  });
  it('every write goes through a temporary file and a rename: none is left behind', () => {
    bind('A', '--track', 'ui');
    bind('B', '--second-seat');
    run(['release', PLAN, '--claude', 'A'], io);
    const left = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? left(path.join(d, e.name)) : e.name.endsWith('.tmp') ? [e.name] : []));
    expect(left(wp())).toEqual([]);
  });
});
