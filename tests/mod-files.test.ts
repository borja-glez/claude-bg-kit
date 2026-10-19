import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { clip, loadBandFiles, loadBandModel, renewBindings, RENEW_MS, type Engine } from '../src/mod/files.js';
import { openTasksFrom, seatsOf } from '../src/mod/model.js';
import { checkoutSid, openTasksOf, readSeats } from '../src/lib/bound-fs.js';
import { BOUND_REREAD_MS } from '../src/lib/bound.js';
import { eventId } from '../src/lib/ids.js';
import { designGate } from '../src/lib/design-gate.js';
import { designFilesOf, readCritiques, readDismissedOf } from '../src/cli/design-files.js';
import { useTempDirs } from './helpers/tmp.js';
const tmp = useTempDirs();

const plan = readFileSync(new URL('./fixtures/plan.yaml', import.meta.url), 'utf8');
/** The Claude conversation looking at the band ($.session.id()). */
const ID = 'conv-1';

interface FakeOptions {
  /** Sizes and mtimes by path, for list and stat. */
  over?: Record<string, { size?: number; mtimeMs?: number }>;
  /** What $.session.id() answers; null: it rejects. */
  id?: string | null;
  /** The engine's clock. */
  at?: () => number;
  /** Called before each read, with its path. */
  beforeRead?: (path: string) => void;
}

// A fake engine over a map of absolute path -> text; directories are derived from the paths. What the plugin writes
// lands in `files`, and its path in `writes`; `stats` and `sleeps` record $.fs.stat and $.clock.sleep.
function fake(root: string, files: Record<string, string>, o: FakeOptions = {}): { $: Engine; reads: string[]; lists: string[]; writes: string[]; stats: string[]; sleeps: number[] } {
  const over = o.over ?? {};
  const id = o.id === undefined ? ID : o.id;
  const reads: string[] = [];
  const lists: string[] = [];
  const writes: string[] = [];
  const stats: string[] = [];
  const sleeps: number[] = [];
  const entries = (dir: string) => {
    const seen = new Map<string, { name: string; kind: 'file' | 'dir'; size: number; mtimeMs: number }>();
    for (const [p, text] of Object.entries(files)) {
      if (!p.startsWith(dir + '/')) continue;
      const rest = p.slice(dir.length + 1);
      const name = rest.split('/')[0];
      const isFile = !rest.includes('/');
      const x = over[p] ?? {};
      seen.set(name, { name, kind: isFile ? 'file' : 'dir', size: isFile ? (x.size ?? text.length) : 0, mtimeMs: x.mtimeMs ?? 1 });
    }
    return [...seen.values()];
  };
  const $ = {
    session: {
      root: async () => root,
      id: async () => { if (id === null) throw new Error('no session id'); return id; },
    },
    fs: {
      read: async (p: string) => { o.beforeRead?.(p); reads.push(p); if (!(p in files)) throw new Error('ENOENT'); return files[p]; },
      list: async (d: string) => { lists.push(d); const e = entries(d); if (!e.length) throw new Error('ENOENT'); return e; },
      exists: async (p: string) => p in files,
      stat: async (p: string) => { stats.push(p); if (!(p in files)) throw new Error('ENOENT'); return { mtimeMs: over[p]?.mtimeMs ?? 1, size: over[p]?.size ?? files[p].length }; },
      write: async (p: string, text: string) => { writes.push(p); files[p] = text; },
    },
    clock: { now: async () => (o.at ? o.at() : Date.now()), sleep: async (ms: number) => { sleeps.push(ms); } },
  } as unknown as Engine;
  return { $, reads, lists, writes, stats, sleeps };
}

/** The same files on disk, under a new temporary folder standing for `root`: the CLI's readers see what the band sees. */
function onDisk(files: Record<string, string>, root: string): string {
  const dir = tmp('band-disk-');
  for (const [p, text] of Object.entries(files)) {
    const to = path.join(dir, p.slice(root.length + 1));
    mkdirSync(path.dirname(to), { recursive: true });
    writeFileSync(to, text);
  }
  return dir;
}

const now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const task = (status: string, extra: object = {}) => ({ status, stage: 'implement', round: 1, worktree: '/w', branch: 'b', executor: 'subagents', attempts: 0, agent: null, startedAt: iso(now - 600000), updatedAt: iso(now), stageSince: iso(now), detail: null, ...extra });
// The coordinator of this execution is the conversation looking at the band.
const EXEC = JSON.stringify({ runId: 'r1', kind: 'plan', mode: 'subagents', parallel: 3, project: 'demo-shop', base: 'main', branch: 'forge/run', mergeOnFinish: false, coordinator: 'main', hookSession: ID, active: true, stopReason: null, stallReason: null,
  startedAt: iso(now - 3600000), lastStepAt: iso(now - 60000), lastBlockStep: null, sleepUntil: null, tasks: { T002: task('running'), T001: task('integrated') } });
const pub = (id: string) => JSON.stringify({ task: id, runId: 'r1', stage: 'review', status: 'running', agent: null, round: 3, since: iso(now), updatedAt: iso(now), leaseUntil: iso(now + 600000), by: 'x', mode: 'subagents' });
/** The binding of seat `sid` to the conversation `claude`, renewed a minute ago (C3). */
const bound = (sid: string, claude = ID, over: object = {}) =>
  JSON.stringify({ sid, claude, pid: null, via: 'work', since: iso(now - 3600_000), seenAt: iso(now - 60_000), endedAt: null, endReason: null, ...over });

// The checkout seat main, bound to the conversation looking at the band.
const base = (root: string) => ({
  [`${root}/docs/waypoint/demo-shop/plan.yaml`]: plan,
  [`${root}/.waypoint/demo-shop/session.json`]: JSON.stringify({ sessionId: 'main', track: null }),
  [`${root}/.waypoint/demo-shop/bound.json`]: bound('main'),
});

describe('clip, as lens takes it from here', () => {
  it('puts a text on one clean line, then cuts it by the cells it takes', () => {
    const c = (...codes: number[]) => String.fromCharCode(...codes);
    expect(clip(`a${c(0x1b)}[31m${c(10)}b${c(0x202e)}c`)).toBe('a [31m bc');
    expect(clip(`${c(0x2066)}${'x'.repeat(50)}`, 10)).toBe(`${'x'.repeat(9)}…`);
    expect(clip('Bash')).toBe('Bash');
  });
});

describe('loadBandModel · decisions', () => {
  const doc = () => JSON.stringify({ ts: iso(Date.now() - 60000), scope: 'r1', count: 2, autonomy: 'unattended', last: [], lastMajor: null });
  it('reads decisions.json from the main checkout when the root is a linked worktree, and ignores the worktree own', async () => {
    const root = '/repo-w'; const main = '/repo';
    const { $, reads } = fake(root, {
      ...base(root),
      [`${root}/.git`]: `gitdir: ${main}/.git/worktrees/w\n`,
      [`${main}/.forge/decisions.json`]: doc(),
      [`${root}/.forge/decisions.json`]: JSON.stringify({ nope: true }),
    });
    expect(await loadBandModel($)).toMatchObject({ mode: 'work', auto: { count: 2, lastMajor: null } });
    expect(reads).toContain(`${main}/.forge/decisions.json`);
    expect(reads).not.toContain(`${root}/.forge/decisions.json`);
  });
  it('does not read an oversized decisions.json', async () => {
    const root = '/repo';
    const { $, reads } = fake(root, { ...base(root), [`${root}/.forge/decisions.json`]: doc() }, { over: { [`${root}/.forge/decisions.json`]: { size: 17 * 1024 } } });
    expect(await loadBandModel($)).not.toHaveProperty('auto');
    expect(reads).not.toContain(`${root}/.forge/decisions.json`);
  });
  it('lists the main checkout .forge once per refresh, for the execution and the decisions', async () => {
    const root = '/repo';
    const { $, lists } = fake(root, { ...base(root), [`${root}/.forge/execution.json`]: EXEC, [`${root}/.forge/decisions.json`]: doc() });
    expect(await loadBandModel($)).toMatchObject({ auto: { count: 2 } });
    expect(lists.filter(d => d === `${root}/.forge`)).toHaveLength(1);
  });
});

describe('loadBandModel · execution files', () => {
  it('reads the execution from the main checkout when the root is a linked worktree', async () => {
    const root = '/repo-w'; const main = '/repo';
    const { $, reads } = fake(root, {
      ...base(root),
      [`${root}/.git`]: `gitdir: ${main}/.git/worktrees/w\n`,
      [`${main}/.forge/execution.json`]: EXEC,
      [`${main}/.forge/execution/T002.json`]: pub('T002'),
      [`${main}/.forge/live/s1.json`]: JSON.stringify({ sessionId: 's1', role: 'coordinator', runId: 'r1', ts: iso(now), event: 'x' }),
      // The worktree's own .forge must be ignored.
      [`${root}/.forge/execution.json`]: JSON.stringify({ nope: true }),
    });
    const m = await loadBandModel($);
    expect(m).toMatchObject({ mode: 'run', slots: [{ task: 'T002', stage: 'review', round: 3 }] });
    expect(reads).toContain(`${main}/.forge/execution/T002.json`);
    expect(reads).toContain(`${main}/.forge/live/s1.json`);
    expect(reads).not.toContain(`${root}/.forge/execution.json`);
  });

  it('skips the baseline/ subdirectory of the execution', async () => {
    const root = '/repo';
    const { $, reads } = fake(root, { ...base(root), [`${root}/.forge/execution.json`]: EXEC, [`${root}/.forge/execution/T002.json`]: pub('T002'), [`${root}/.forge/execution/baseline/T002.json`]: '{}' });
    await loadBandModel($);
    expect(reads).toContain(`${root}/.forge/execution/T002.json`);
    expect(reads.some(r => r.includes('/baseline'))).toBe(false);
  });

  it('caps task files at 50 and live files at 20', async () => {
    const root = '/repo';
    const f: Record<string, string> = { ...base(root), [`${root}/.forge/execution.json`]: EXEC };
    for (let i = 0; i < 70; i++) f[`${root}/.forge/execution/T${String(i).padStart(3, '0')}.json`] = '{}';
    for (let i = 0; i < 40; i++) f[`${root}/.forge/live/s${i}.json`] = '{}';
    const { $, reads } = fake(root, f);
    await loadBandModel($);
    expect(reads.filter(r => r.includes('/.forge/execution/')).length).toBe(50);
    expect(reads.filter(r => r.includes('/.forge/live/')).length).toBe(20);
  });

  it('skips junk and oversized files without throwing, and a missing .forge yields no run band', async () => {
    const root = '/repo';
    const { $, reads } = fake(root, {
      ...base(root), [`${root}/.forge/execution.json`]: EXEC,
      [`${root}/.forge/execution/T002.json`]: pub('T002'),
      [`${root}/.forge/execution/T003.json`]: 'not json{',
      [`${root}/.forge/execution/T004.json`]: pub('T004'),
      [`${root}/.forge/live/big.json`]: '{}',
    }, { over: { [`${root}/.forge/execution/T004.json`]: { size: 9 * 1024 }, [`${root}/.forge/live/big.json`]: { size: 9 * 1024 } } });
    const m = await loadBandModel($);
    expect(m).toMatchObject({ mode: 'run', slots: [{ task: 'T002' }] });
    expect(reads).not.toContain(`${root}/.forge/execution/T004.json`);
    expect(reads).not.toContain(`${root}/.forge/live/big.json`);

    const oversized = fake(root, { ...base(root), [`${root}/.forge/execution.json`]: EXEC }, { over: { [`${root}/.forge/execution.json`]: { size: 65 * 1024 } } });
    expect((await loadBandModel(oversized.$)).mode).toBe('work');

    const none = fake(root, base(root));
    expect((await loadBandModel(none.$)).mode).toBe('work');
  });
});

describe('loadBandModel · design', () => {
  it('reads dismissed.json next to the critiques for the pending count', async () => {
    const root = '/repo';
    const design = readFileSync(new URL('./fixtures/design.md', import.meta.url), 'utf8');
    const prop = (n: number) => ({ n, category: 'gap', severity: 'major', section: 'riesgos', problem: 'p', change: 'c' });
    const files = {
      [`${root}/docs/waypoint/demo-shop/design.md`]: design,
      [`${root}/.waypoint/demo-shop/bound.json`]: bound('main', ID, { via: 'design' }),
      [`${root}/.waypoint/demo-shop/critique-r1.json`]: JSON.stringify({ round: 1, version: 1, scope: 'full', proposals: [prop(1), prop(2), prop(3)] }),
    };
    expect(await loadBandModel(fake(root, files).$)).toMatchObject({ mode: 'design', pending: 3 });
    const { $, reads } = fake(root, { ...files, [`${root}/.waypoint/demo-shop/dismissed.json`]: JSON.stringify({ 1: [2, 3] }) });
    expect(await loadBandModel($)).toMatchObject({ mode: 'design', pending: 1 });
    expect(reads).toContain(`${root}/.waypoint/demo-shop/dismissed.json`);
  });
  it('reads the critiques of docs/…/design/critiques/ first and .waypoint/ for a round docs/ lacks, never reading a .waypoint/ round docs/ has; dismissed.json of both places merged (K3-10, Review Focus 1, carry 8)', async () => {
    const root = '/repo';
    const design = readFileSync(new URL('./fixtures/design.md', import.meta.url), 'utf8');
    const prop = (n: number) => ({ n, category: 'gap', severity: 'major', section: 'riesgos', problem: 'p', change: 'c' });
    const crit = (round: number, count: number) => JSON.stringify({ round, version: round, scope: 'full', proposals: Array.from({ length: count }, (_, i) => prop(i + 1)) });
    const files = {
      [`${root}/docs/waypoint/demo-shop/design.md`]: design,
      [`${root}/.waypoint/demo-shop/bound.json`]: bound('main', ID, { via: 'design' }),
      [`${root}/.waypoint/demo-shop/critique-r1.json`]: crit(1, 5),
      [`${root}/.waypoint/demo-shop/critique-r2.json`]: crit(2, 4),
      [`${root}/docs/waypoint/demo-shop/design/critiques/r2.json`]: crit(2, 2),
      [`${root}/docs/waypoint/demo-shop/design/critiques/r3.json`]: crit(3, 1),
      [`${root}/.waypoint/demo-shop/dismissed.json`]: JSON.stringify({ 1: [2, 3, 4, 5] }),
      [`${root}/docs/waypoint/demo-shop/design/critiques/dismissed.json`]: JSON.stringify({ 1: [{ n: 1, reason: 'no' }] }),
    };
    // Round 1 from .waypoint/ (5, all dismissed between both files), round 2 from docs/ (2, not the 4 of .waypoint/),
    // round 3 from docs/ (1).
    const { $, reads } = fake(root, files);
    expect(await loadBandModel($)).toMatchObject({ mode: 'design', round: 3, proposals: 1, pending: 3 });
    expect(reads).toContain(`${root}/.waypoint/demo-shop/dismissed.json`);
    expect(reads).not.toContain(`${root}/.waypoint/demo-shop/critique-r2.json`);
    // The CLI counts the same from the same files.
    const disk = onDisk(files, root);
    const g = designGate([], readCritiques(designFilesOf(path.join(disk, 'docs/waypoint/demo-shop/design.md'), 'demo-shop')), readDismissedOf(designFilesOf(path.join(disk, 'docs/waypoint/demo-shop/design.md'), 'demo-shop')));
    expect(g.pending).toHaveLength(3);
  });
  const designFiles = (root: string, extra: Record<string, string>) => ({
    [`${root}/docs/waypoint/demo-shop/design.md`]: readFileSync(new URL('./fixtures/design.md', import.meta.url), 'utf8'),
    [`${root}/.waypoint/demo-shop/bound.json`]: bound('main', ID, { via: 'design' }),
    ...extra,
  });
  const crit = (round: number, count: number, severity = 'major') => JSON.stringify({ round, version: 1, scope: 'full',
    proposals: Array.from({ length: count }, (_, i) => ({ n: i + 1, category: 'gap', severity, section: 'riesgos', problem: 'p', change: 'c' })) });
  it('reads the newest 500 rounds, not the first listed, and no round 0, leading zero or critique set aside as rejected (carry 8, final review M2)', async () => {
    const root = '/repo';
    const docs = `${root}/docs/waypoint/demo-shop/design/critiques`;
    const many: Record<string, string> = {};
    for (let r = 1; r <= 510; r++) many[`${docs}/r${r}.json`] = crit(r, 1, 'minor');
    const extra = { [`${docs}/r0.json`]: crit(1, 9), [`${docs}/r0511.json`]: crit(511, 9), [`${docs}/r511.rejected.json`]: crit(511, 9), [`${root}/.waypoint/demo-shop/critique-r0.json`]: crit(1, 9) };
    const { $, reads } = fake(root, designFiles(root, { ...many, ...extra }));
    expect(await loadBandModel($)).toMatchObject({ mode: 'design', round: 510, proposals: 1, pending: 500 });
    expect(reads).toContain(`${docs}/r510.json`);
    expect(reads).toContain(`${docs}/r11.json`);
    expect(reads).not.toContain(`${docs}/r10.json`);
    for (const name of Object.keys(extra)) expect(reads).not.toContain(name);
  });
  it('a junk critique in docs/ hides only its own round; docs/ critiques without a dismissed.json use the one in .waypoint/ (carry 8)', async () => {
    const root = '/repo';
    const docs = `${root}/docs/waypoint/demo-shop/design/critiques`;
    const files = designFiles(root, {
      [`${docs}/r1.json`]: crit(1, 3),
      [`${docs}/r2.json`]: '{bad',
      [`${root}/.waypoint/demo-shop/critique-r2.json`]: crit(2, 4),
      [`${root}/.waypoint/demo-shop/dismissed.json`]: JSON.stringify({ 1: [2] }),
    });
    const { $, reads } = fake(root, files);
    expect(await loadBandModel($)).toMatchObject({ mode: 'design', round: 1, proposals: 3, pending: 2 });
    expect(reads).not.toContain(`${root}/.waypoint/demo-shop/critique-r2.json`);
    // A junk dismissed.json in docs/ hides nothing of the one in .waypoint/.
    const junk = fake(root, { ...files, [`${docs}/dismissed.json`]: '{junk' });
    expect(await loadBandModel(junk.$)).toMatchObject({ pending: 2 });
  });
});

describe('loadBandFiles · who looks, and the seats of its project (C3, A-15)', () => {
  it('passes the session id, the clock and the bindings of the project seats', async () => {
    const root = '/repo';
    const at = Date.now();
    const { $ } = fake(root, {
      ...base(root),
      [`${root}/.waypoint/demo-shop/seats/main-2/bound.json`]: bound('main-2', 'conv-2'),
      [`${root}/.waypoint/demo-shop/seats/main-2/session.json`]: JSON.stringify({ sessionId: 'main-2', track: 'ui' }),
    }, { at: () => at });
    const loaded = await loadBandFiles($);
    expect(loaded?.project).toBe('demo-shop');
    expect(loaded?.files).toMatchObject({ sessionId: ID, now: at, session: JSON.stringify({ sessionId: 'main', track: null }) });
    expect(Object.keys(loaded?.files.bindings ?? {}).sort()).toEqual(['.', 'main-2']);
    expect(loaded?.files.seatSessions).toEqual({ 'main-2': JSON.stringify({ sessionId: 'main-2', track: 'ui' }) });
  });
  it("prefers the project of this conversation's binding, else the latest activity (A-15)", async () => {
    const root = '/repo';
    const files = {
      [`${root}/docs/waypoint/old/plan.yaml`]: plan,
      [`${root}/docs/waypoint/mine/plan.yaml`]: plan,
      [`${root}/.waypoint/mine/session.json`]: JSON.stringify({ sessionId: 'main', track: null }),
      [`${root}/.waypoint/mine/bound.json`]: bound('main', ID, { since: iso(now - 7200_000), seenAt: iso(now - 3600_000) }),
    };
    const over = { [`${root}/docs/waypoint/old/plan.yaml`]: { mtimeMs: now }, [`${root}/docs/waypoint/mine/plan.yaml`]: { mtimeMs: 1 } };
    expect((await loadBandFiles(fake(root, files, { over }).$))?.project).toBe('mine');
    expect((await loadBandFiles(fake(root, files, { over, id: 'conv-2' }).$))?.project).toBe('old');
    const { $, reads } = fake(root, files, { over });
    await loadBandModel($);
    expect(reads).toContain(`${root}/docs/waypoint/mine/plan.yaml`);
    expect(reads).not.toContain(`${root}/docs/waypoint/old/plan.yaml`);
  });
  it("looks at MAX_SEATS seat folders by name, never the checkout seat's own nor an unsafe one, and reads no binding over 4 KiB", async () => {
    const root = '/repo';
    const f: Record<string, string> = { ...base(root) };
    for (let n = 2; n <= 14; n++) f[`${root}/.waypoint/demo-shop/seats/main-${n}/bound.json`] = bound(`main-${n}`, `c${n}`);
    f[`${root}/.waypoint/demo-shop/seats/a:b/bound.json`] = bound('main', 'x');
    // A folder named as the checkout seat is no extra seat (readSeats leaves it out before it counts).
    f[`${root}/.waypoint/demo-shop/seats/main/bound.json`] = bound('main', 'z');
    const big = `${root}/.waypoint/demo-shop/seats/main-10/bound.json`;
    const { $, reads, stats } = fake(root, f, { over: { [big]: { size: 5000 } } });
    const loaded = await loadBandFiles($);
    const seatBound = /\/seats\/[^/]+\/bound\.json$/;
    expect(stats.filter(p => seatBound.test(p))).toHaveLength(10);
    expect(reads.filter(r => seatBound.test(r))).toHaveLength(9);
    expect(reads).not.toContain(big);
    expect(stats.some(r => r.includes('/seats/a:b/') || r.includes('/seats/main/'))).toBe(false);
    expect(Object.keys(loaded?.files.bindings ?? {}).sort()).toEqual(['.', 'main-11', 'main-12', 'main-13', 'main-14', 'main-2', 'main-3', 'main-4', 'main-5', 'main-6']);
  });
  it('the seats with a binding are the ones the CLI reads: the folders by name first, then those without bound.json skipped (readSeats)', async () => {
    const root = '/repo';
    const f: Record<string, string> = { ...base(root) };
    for (let n = 2; n <= 14; n++) if (n !== 3) f[`${root}/.waypoint/demo-shop/seats/main-${n}/bound.json`] = bound(`main-${n}`, `c${n}`);
    // A seat whose conversation never bound it still takes its place among the MAX_SEATS.
    f[`${root}/.waypoint/demo-shop/seats/main-3/session.json`] = JSON.stringify({ sessionId: 'main-3', track: null });
    const loaded = await loadBandFiles(fake(root, f).$);
    const band = seatsOf(loaded!.files, now).filter(s => s.bound).map(s => s.sid);
    const cli = readSeats(path.join(onDisk(f, root), '.waypoint', 'demo-shop'), now).filter(s => s.bound).map(s => s.sid);
    expect(band).toEqual(cli);
    expect(band).not.toContain('main-7');
  });
  it("a checkout seat's session.json over 8 KiB is read by neither the band nor the CLI: its binding names the seat (one rule)", async () => {
    const root = '/repo';
    const f: Record<string, string> = { ...base(root), [`${root}/.waypoint/demo-shop/session.json`]: JSON.stringify({ sessionId: 'big', pad: 'x'.repeat(9000) }) };
    const loaded = await loadBandFiles(fake(root, f).$);
    expect(seatsOf(loaded!.files, now)[0]).toMatchObject({ sid: 'main', checkout: true });
    expect(checkoutSid(path.join(onDisk(f, root), '.waypoint', 'demo-shop'), now)).toBe('main');
  });
  it("the seats' open tasks come from the same 500 state files, by name, as openTasksOf reads (one cap)", async () => {
    const root = '/repo';
    const f: Record<string, string> = { ...base(root) };
    // 600 cache files, listed last name first: a task beyond the 500th by name is out of both reads.
    for (let i = 599; i >= 0; i--) {
      const doc = i === 550 ? { status: 'in_progress', owner: 'late' } : i === 100 ? { status: 'claimed', owner: 'early' } : { status: 'done' };
      f[`${root}/.waypoint/demo-shop/dbcache/state/S${String(i).padStart(4, '0')}.json`] = JSON.stringify(doc);
    }
    const loaded = await loadBandFiles(fake(root, f).$);
    const states = Object.fromEntries(Object.entries(loaded!.files.states).map(([k, v]) => [k, JSON.parse(v)]));
    expect(Object.keys(states)).toHaveLength(500);
    expect(openTasksFrom(states)).toEqual({ early: 'S0100' });
    expect(openTasksOf(path.join(onDisk(f, root), '.waypoint', 'demo-shop'))).toEqual({ early: 'S0100' });
  });
  it("keeps the newest 500 messages, by their time-ordered ids: an open one addressed to the seat counts in its inbox (round 2)", async () => {
    const root = '/repo';
    const f: Record<string, string> = { ...base(root) };
    // Probe 3: 600 messages named by event id; only the newest, the 600th, is open and addressed to seat main.
    const ids: string[] = [];
    for (let i = 0; i < 600; i++) {
      const id = eventId(new Date(now - (600 - i) * 60000), 'ui');
      ids.push(id);
      f[`${root}/.waypoint/demo-shop/dbcache/messages/${id}.json`] = JSON.stringify({ ts: iso(now - (600 - i) * 60000), from: 'ui', to: i === 599 ? 'main' : 'ui', type: 'reply', taskId: 'T002', text: 'x', status: i === 599 ? 'open' : 'resolved' });
    }
    const loaded = await loadBandFiles(fake(root, f).$);
    const kept = Object.keys(loaded!.files.messages);
    expect(kept).toHaveLength(500);
    expect(kept).toContain(ids[599]);
    expect(kept).not.toContain(ids[99]);
    expect(await loadBandModel(fake(root, f).$)).toMatchObject({ mode: 'work', sid: 'main', inbox: 1 });
  });
  it('reads a bound.json found empty or broken once more after a short wait, as the CLI does; one still broken is no binding (spec §4.10)', async () => {
    const root = '/repo';
    const file = `${root}/.waypoint/demo-shop/bound.json`;
    const files: Record<string, string> = { ...base(root) };
    const whole = files[file];
    for (const torn of ['', '{"sid":"main","claude":']) {
      let n = 0;
      const { $, reads, sleeps } = fake(root, files, { beforeRead: p => { if (p === file) files[p] = ++n === 1 ? torn : whole; } });
      expect(await loadBandModel($), JSON.stringify(torn)).toMatchObject({ mode: 'work', viewer: { role: 'owner' } });
      expect(reads.filter(p => p === file), JSON.stringify(torn)).toHaveLength(2);
      expect(sleeps).toEqual([BOUND_REREAD_MS]);
    }
    files[file] = '{"sid":"main"';
    const broken = fake(root, files);
    expect(await loadBandModel(broken.$)).toMatchObject({ mode: 'none' });
    expect(broken.reads.filter(p => p === file)).toHaveLength(2);
    // A whole binding is read once.
    files[file] = whole;
    const once = fake(root, files);
    await loadBandModel(once.$);
    expect(once.reads.filter(p => p === file)).toHaveLength(1);
    expect(once.sleeps).toEqual([]);
  });
  it("reads the newest 50 members and the coordinator's own signal, also when it is not among the 20 newest", async () => {
    const root = '/repo';
    const f: Record<string, string> = { ...base(root), [`${root}/.forge/execution.json`]: EXEC };
    const over: Record<string, { size?: number; mtimeMs?: number }> = {};
    for (let i = 0; i < 60; i++) { const p = `${root}/.forge/members/m${i}.json`; f[p] = '{}'; over[p] = { mtimeMs: i + 1 }; }
    for (let i = 0; i < 25; i++) { const p = `${root}/.forge/live/s${i}.json`; f[p] = '{}'; over[p] = { mtimeMs: 100 + i }; }
    const coordinator = `${root}/.forge/live/${ID}.json`;
    f[coordinator] = JSON.stringify({ sessionId: ID, role: 'coordinator', runId: 'r1', ts: iso(now), event: 'SessionEnd', ended: true });
    over[coordinator] = { mtimeMs: 0 };
    const loaded = await loadBandFiles(fake(root, f, { over }).$);
    expect(Object.keys(loaded?.files.members ?? {})).toHaveLength(50);
    expect(loaded?.files.members).toHaveProperty('m59');
    expect(loaded?.files.members).not.toHaveProperty('m0');
    expect(loaded?.files.coordinatorLive).toBe(f[coordinator]);
  });
  it("reads the coordinator's own bindings in every project of the main checkout, of any seat and via, so an open coordinator keeps its run (2b carry)", async () => {
    const root = '/repo';
    // 20 minutes without a step: its run has no coordinator unless its conversation is open.
    const exec = JSON.stringify({ ...JSON.parse(EXEC), hookSession: 'coord-h', lastStepAt: iso(now - 20 * 60_000) });
    const seat = `${root}/.waypoint/other/seats/main-2/bound.json`;
    const mine = bound('main-2', 'coord-h');
    const f: Record<string, string> = { ...base(root), [`${root}/.forge/execution.json`]: exec, [seat]: mine, [`${root}/.waypoint/demo-shop/seats/main-3/bound.json`]: bound('main-3', 'someone-else') };
    const looks = () => fake(root, f, { id: 'conv-9' }).$;
    expect((await loadBandFiles(looks()))?.files.coordinatorBindings).toEqual({ 'other/main-2': mine });
    expect(await loadBandModel(looks())).toMatchObject({ mode: 'notice', kind: 'other-live', subject: 'run' });
    delete f[seat];
    expect((await loadBandFiles(looks()))?.files).not.toHaveProperty('coordinatorBindings');
    expect(await loadBandModel(looks())).toMatchObject({ mode: 'notice', kind: 'previous', subject: 'run' });
  });
  it("without a waypoint project the band draws nothing but still publishes the role from forge's execution (I2)", async () => {
    const root = '/repo';
    // forge's ephemeral run of a checkout with no docs/waypoint, coordinated by the conversation that looks.
    const ephemeral = JSON.stringify({ ...JSON.parse(EXEC), runId: 'e1', kind: 'ephemeral', project: 'loose', tasks: { 'abc-k3x9': task('running') } });
    const files = { [`${root}/.forge/execution.json`]: ephemeral };
    expect(await loadBandModel(fake(root, files).$)).toEqual({ mode: 'none', viewer: { role: 'owner', coordinator: true, runId: 'e1' } });
    expect(await loadBandModel(fake(root, files, { id: 'conv-9' }).$)).toEqual({ mode: 'none', viewer: { role: 'other-live', coordinator: false, runId: 'e1' } });
    expect(await loadBandModel(fake(root, {}).$)).toEqual({ mode: 'none', viewer: { role: 'none', coordinator: false, runId: null } });
  });
  it('a session id the engine cannot give, or an unsafe one, is null, and the files still load (Review Focus 1)', async () => {
    const root = '/repo';
    for (const id of [null, 'a b', '../x']) {
      const loaded = await loadBandFiles(fake(root, base(root), { id }).$);
      expect(loaded?.files.sessionId, String(id)).toBeNull();
      expect(loaded?.project).toBe('demo-shop');
    }
  });
});

describe("renewBindings (C3): the band keeps this conversation's bindings alive", () => {
  const at = Date.parse('2026-10-15T12:00:00.000Z');
  const t = (min: number) => new Date(at + min * 60000).toISOString();
  const b = (sid: string, claude: string, seenMin: number, over: object = {}) =>
    JSON.stringify({ sid, claude, pid: null, via: 'work', since: t(-60), seenAt: t(seenMin), endedAt: null, endReason: null, ...over });
  const root = '/repo';
  const shop = `${root}/.waypoint/shop`;
  it('moves seenAt of its own live binding a minute or more old, in every project and seat, and touches no other', async () => {
    const files: Record<string, string> = {
      [`${shop}/session.json`]: JSON.stringify({ sessionId: 'main' }),
      [`${shop}/bound.json`]: b('main', 'conv-8', -2),
      [`${shop}/seats/main-2/bound.json`]: b('main-2', ID, -RENEW_MS / 60000),
      [`${shop}/seats/main-3/bound.json`]: b('main-3', 'conv-9', -2),
      [`${root}/.waypoint/web/bound.json`]: b('main', ID, -2),
      [`${root}/.waypoint/docs/bound.json`]: b('main', ID, -0.5),
    };
    const before = { ...files };
    const { $, writes } = fake(root, files, { at: () => at });
    expect(await renewBindings($)).toBe(2);
    expect(writes.sort()).toEqual([`${shop}/seats/main-2/bound.json`, `${root}/.waypoint/web/bound.json`]);
    expect(JSON.parse(files[`${shop}/seats/main-2/bound.json`])).toEqual({ ...JSON.parse(before[`${shop}/seats/main-2/bound.json`]), seenAt: t(0) });
    for (const p of [`${shop}/bound.json`, `${shop}/seats/main-3/bound.json`, `${root}/.waypoint/docs/bound.json`]) expect(files[p], p).toBe(before[p]);
  });
  it('renews only the newest of its live bindings in a project; the others lapse (M5: a seat a bind released stays released)', async () => {
    const files: Record<string, string> = {
      [`${shop}/session.json`]: JSON.stringify({ sessionId: 'main' }),
      // main was released by this conversation's bind --second-seat, and a renewal raced it back to life.
      [`${shop}/bound.json`]: b('main', ID, -3),
      [`${shop}/seats/main-2/bound.json`]: b('main-2', ID, -2),
    };
    const before = { ...files };
    const { $, writes } = fake(root, files, { at: () => at });
    expect(await renewBindings($)).toBe(1);
    expect(writes).toEqual([`${shop}/seats/main-2/bound.json`]);
    expect(files[`${shop}/bound.json`]).toBe(before[`${shop}/bound.json`]);
    // The same renewal time: the checkout seat is the one kept, as the hooks and describeViewer pick it.
    const tie: Record<string, string> = { ...before, [`${shop}/seats/main-2/bound.json`]: b('main-2', ID, -3) };
    const again = fake(root, tie, { at: () => at });
    expect(await renewBindings(again.$)).toBe(1);
    expect(again.writes).toEqual([`${shop}/bound.json`]);
    // An ended binding is not a live one: the newest live is renewed even when an ended one is newer.
    const ended: Record<string, string> = { ...before, [`${shop}/seats/main-2/bound.json`]: b('main-2', ID, -2, { endedAt: t(-1), endReason: 'clear' }) };
    const third = fake(root, ended, { at: () => at });
    expect(await renewBindings(third.$)).toBe(1);
    expect(third.writes).toEqual([`${shop}/bound.json`]);
  });
  it('never renews an ended binding, nor one an end or a takeover rewrote between its read and its write (Review Focus 3)', async () => {
    const ended = fake(root, { [`${shop}/bound.json`]: b('main', ID, -2, { endedAt: t(-1), endReason: 'clear' }) }, { at: () => at });
    expect(await renewBindings(ended.$)).toBe(0);
    expect(ended.writes).toEqual([]);
    for (const meanwhile of [b('main', 'conv-9', 0), b('main', ID, -2, { endedAt: t(0), endReason: 'clear' })]) {
      const files: Record<string, string> = { [`${shop}/bound.json`]: b('main', ID, -2) };
      let seen = 0;
      const two = fake(root, files, { at: () => at, beforeRead: p => { if (p === `${shop}/bound.json` && ++seen === 2) files[p] = meanwhile; } });
      expect(await renewBindings(two.$)).toBe(0);
      expect(files[`${shop}/bound.json`]).toBe(meanwhile);
    }
  });
  it('writes nothing without a session id (Review Focus 1)', async () => {
    const { $, writes } = fake(root, { [`${shop}/bound.json`]: b('main', ID, -2) }, { at: () => at, id: null });
    expect(await renewBindings($)).toBe(0);
    expect(writes).toEqual([]);
  });
  it("agrees with the hooks (Ruling 1): a released binding stays released, an ended one is never reopened, another conversation's is untouched", async () => {
    const files: Record<string, string> = {
      [`${shop}/session.json`]: JSON.stringify({ sessionId: 'main' }),
      // Released by a bind of this conversation elsewhere (M1) or by waypoint release, an hour ago.
      [`${shop}/bound.json`]: b('main', ID, -60, { endedAt: t(-60), endReason: 'released' }),
      // Ended by a /clear long ago: the band never clears an end, as only a resume or a compact hook does.
      [`${shop}/seats/main-2/bound.json`]: b('main-2', ID, -30, { endedAt: t(-30), endReason: 'clear' }),
      // Another conversation's binding, live but stale: only its own conversation renews it.
      [`${shop}/seats/main-3/bound.json`]: b('main-3', 'conv-9', -4),
    };
    const before = { ...files };
    const { $, writes } = fake(root, files, { at: () => at });
    expect(await renewBindings($)).toBe(0);
    expect(writes).toEqual([]);
    expect(files).toEqual(before);
  });
  it('renews at most once a minute: a binding the hooks renewed between its read and its write is left as they wrote it', async () => {
    const files: Record<string, string> = { [`${shop}/bound.json`]: b('main', ID, -2) };
    const fresh = b('main', ID, -0.25);
    let seen = 0;
    const { $, writes } = fake(root, files, { at: () => at, beforeRead: p => { if (p === `${shop}/bound.json` && ++seen === 2) files[p] = fresh; } });
    expect(await renewBindings($)).toBe(0);
    expect(writes).toEqual([]);
    expect(files[`${shop}/bound.json`]).toBe(fresh);
  });
  it('swallows a write the engine refuses and goes on with the next binding', async () => {
    const web = `${root}/.waypoint/web`;
    const files: Record<string, string> = {
      [`${shop}/session.json`]: JSON.stringify({ sessionId: 'main' }),
      [`${shop}/bound.json`]: b('main', ID, -2),
      [`${web}/bound.json`]: b('main', ID, -2),
    };
    const { $ } = fake(root, files, { at: () => at });
    const tried: string[] = [];
    const refusing = { ...$, fs: { ...$.fs, write: async (p: string, text: string) => {
      tried.push(p);
      if (p === `${shop}/bound.json`) throw new Error('EACCES');
      files[p] = text;
    } } } as Engine;
    expect(await renewBindings(refusing)).toBe(1);
    expect(tried.sort()).toEqual([`${shop}/bound.json`, `${web}/bound.json`]);
    expect(JSON.parse(files[`${web}/bound.json`]).seenAt).toBe(t(0));
  });
});
