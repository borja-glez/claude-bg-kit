import { describe, it, expect } from 'vitest';
import { ANCHOR_ORDER, anchorCandidates, chooseAnchor, findAnchor, fsFailure, isOwnStatus, refusalReason, samePath, scopeOf, under, type Anchor } from '../src/mod/anchor.js';
import type { Engine } from '../src/mod/files.js';

const ID = 'conv-1';
const NOW = 1_800_000_000_000;
const iso = (ms: number) => new Date(ms).toISOString();

const hit = (kind: Anchor['kind'], at: number, checkout: string): Anchor => ({ kind, scope: scopeOf(kind), checkout, project: null, at });

describe('anchor choice', () => {
  it('chooseAnchor picks the first kind of ANCHOR_ORDER, then the newest at', () => {
    const got = chooseAnchor([hit('binding', 5, '/c/a'), hit('forge-task', 9, '/c/b'), hit('binding', 7, '/c/c')]);
    expect(got).toMatchObject({ kind: 'binding', checkout: '/c/c' });
    expect(chooseAnchor([])).toBeNull();
    expect(ANCHOR_ORDER[0]).toBe('coordinator');
  });

  it('scopeOf: coordinator, member, binding are join; forge-task, sdd-ledger, sp-plan are own', () => {
    for (const k of ['coordinator', 'member', 'binding'] as const) expect(scopeOf(k)).toBe('join');
    for (const k of ['forge-task', 'sdd-ledger', 'sp-plan'] as const) expect(scopeOf(k)).toBe('own');
  });

  it('fsFailure tells missing from refused', () => {
    expect(fsFailure(new Error('ENOENT: no such file'))).toBe('missing');
    expect(fsFailure({ code: 'ENOTDIR' })).toBe('missing');
    expect(fsFailure(new Error('EACCES: permission denied'))).toBe('refused');
    expect(fsFailure(new Error('a network location is not reached from here'))).toBe('refused');
    expect(fsFailure('weird')).toBe('refused');
  });

  it('refusalReason is one line of at most 120 characters', () => {
    const r = refusalReason(new Error(`EACCES: no\n${'x'.repeat(300)}`));
    expect(r).not.toContain('\n');
    expect(r.length).toBeLessThanOrEqual(120);
    expect(r).toMatch(/^EACCES/);
  });

  it('samePath and under ignore separators and drive-letter case', () => {
    expect(samePath('E:\\c\\a', 'e:/c/a/')).toBe(true);
    expect(under('E:/c/a/.superpowers/sdd/x/progress.md', 'E:\\c\\a')).toBe(true);
    expect(under('E:/c/ab/x', 'E:/c/a')).toBe(false);
  });
});

interface FakeOptions { id?: string | null; fail?: Record<string, unknown>; mtimes?: Record<string, number> }

// A fake engine over a map of path -> text; directories come from the paths. Paths are compared with / separators, so a
// Windows root works. `fail` makes list, read or stat throw the given error for a path.
function fake(files: Record<string, string>, o: FakeOptions = {}) {
  const lists: string[] = [];
  const logs: string[] = [];
  const key = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');
  const store = new Map(Object.entries(files).map(([p, t]) => [key(p), t]));
  const failing = new Map(Object.entries(o.fail ?? {}).map(([p, e]) => [key(p), e]));
  const mt = (p: string) => o.mtimes?.[p] ?? NOW;
  const entries = (dir: string) => {
    const seen = new Map<string, { name: string; kind: 'file' | 'dir'; size: number; mtimeMs: number }>();
    for (const [p, text] of store) {
      if (!p.startsWith(dir + '/')) continue;
      const rest = p.slice(dir.length + 1);
      const name = rest.split('/')[0];
      const isFile = !rest.includes('/');
      seen.set(name, { name, kind: isFile ? 'file' : 'dir', size: isFile ? text.length : 0, mtimeMs: mt(p) });
    }
    return [...seen.values()];
  };
  const $ = {
    session: { root: async () => '/c', id: async () => { if (o.id === null) throw new Error('no id'); return o.id ?? ID; } },
    fs: {
      read: async (p: string) => { const k = key(p); if (failing.has(k)) throw failing.get(k); if (!store.has(k)) throw new Error('ENOENT'); return store.get(k)!; },
      list: async (d: string) => { const k = key(d); lists.push(k); if (failing.has(k)) throw failing.get(k); const e = entries(k); if (!e.length) throw new Error('ENOENT'); return e; },
      stat: async (p: string) => { const k = key(p); if (failing.has(k)) throw failing.get(k); if (!store.has(k)) throw new Error('ENOENT'); return { mtimeMs: mt(k), size: store.get(k)!.length }; },
    },
    ui: { log: (m: string) => { logs.push(m); } },
    clock: { now: async () => NOW, sleep: async () => {} },
  } as unknown as Engine;
  return { $, lists, logs };
}

const bound = (claude = ID, over: object = {}) => JSON.stringify({ sid: 'main', claude, pid: null, via: 'work', since: iso(NOW - 3_600_000), seenAt: iso(NOW - 60_000), endedAt: null, endReason: null, ...over });
const run = (hookSession: string, project = 'q', over: object = {}) => JSON.stringify({
  runId: 'r1', kind: 'plan', mode: 'subagents', parallel: 3, project, base: 'main', branch: 'forge/run', mergeOnFinish: false, coordinator: 'main',
  hookSession, active: true, stopReason: null, stallReason: null, startedAt: iso(NOW - 3_600_000), lastStepAt: iso(NOW - 60_000), lastBlockStep: null, sleepUntil: null, tasks: {}, ...over,
});
const status = (task: string, session: string | null) => JSON.stringify({ ts: iso(NOW), task, path: '/w', phase: 'implement', agent: null, validators: [], verdict: null, session, lastAt: iso(NOW - 1000) });
/** A project `p` planned in `dir`, with this conversation's binding when `claude` is given. */
const project = (dir: string, p: string, claude?: string, over: object = {}): Record<string, string> => ({
  [`${dir}/docs/waypoint/${p}/plan.yaml`]: 'x: 1\n',
  ...(claude ? { [`${dir}/.waypoint/${p}/bound.json`]: bound(claude, over) } : {}),
});
const search = (f: ReturnType<typeof fake>, o: Partial<Parameters<typeof findAnchor>[1]> = {}) =>
  findAnchor(f.$, { root: '/c', sessionId: ID, held: null, kinds: 'join', now: NOW, ...o });

describe('anchorCandidates', () => {
  it('the held checkout, the root, then marked first-level children by name', async () => {
    const f = fake({ '/c/a/.forge/x.json': '{}', '/c/b/readme.md': 'x', '/c/z/docs/waypoint/p/plan.yaml': 'x', '/c/file.txt': 'x' });
    const got = await anchorCandidates(f.$, '/c', '/elsewhere/r');
    expect(got.dirs).toEqual(['/elsewhere/r', '/c', '/c/a', '/c/z']);
    expect(got.refused).toBeNull();
  });

  it('at most 50 children, each listed once', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 60; i++) files[`/c/r${String(i).padStart(2, '0')}/.forge/x.json`] = '{}';
    const f = fake(files);
    const got = await anchorCandidates(f.$, '/c', '/h');
    expect(got.dirs).toHaveLength(52);
    for (let i = 0; i < 50; i++) expect(f.lists.filter(l => l === `/c/r${String(i).padStart(2, '0')}`)).toHaveLength(1);
    expect(f.lists).not.toContain('/c/r55');
  });

  it('a refused root is reported, a refused child only skipped', async () => {
    const eacces = new Error('EACCES: permission denied');
    const a = fake({ '/c/a/.forge/x.json': '{}' }, { fail: { '/c': eacces } });
    expect((await anchorCandidates(a.$, '/c', null)).refused).toMatchObject({ path: '/c', reason: expect.stringMatching(/EACCES/) });
    const b = fake({ '/c/a/.forge/x.json': '{}', '/c/locked/.forge/x.json': '{}' }, { fail: { '/c/locked': eacces } });
    const got = await anchorCandidates(b.$, '/c', null);
    expect(got.refused).toBeNull();
    expect(got.dirs).toContain('/c/a');
    expect(got.dirs).not.toContain('/c/locked');
    expect(b.logs.length).toBe(1);
  });
});

describe('findAnchor', () => {
  it('a binding of this conversation in a child anchors it', async () => {
    const f = fake({ ...project('/c/a', 'p', ID), '/c/b/.forge/x.json': '{}' });
    expect((await search(f)).anchor).toMatchObject({ kind: 'binding', scope: 'join', checkout: '/c/a', project: 'p' });
  });

  it("another conversation's binding does not anchor", async () => {
    expect((await search(fake(project('/c/a', 'p', 'conv-2')))).anchor).toBeNull();
  });

  it('an ended binding does not anchor', async () => {
    const f = fake(project('/c/a', 'p', ID, { endedAt: iso(NOW - 1000), endReason: 'released' }));
    expect((await search(f)).anchor).toBeNull();
  });

  it('the coordinator of a visible run wins over a binding', async () => {
    const f = fake({ ...project('/c/a', 'p', ID), '/c/b/.forge/execution.json': run(ID) });
    expect((await search(f)).anchor).toMatchObject({ kind: 'coordinator', checkout: '/c/b', project: 'q' });
  });

  it('a member of a visible run anchors it', async () => {
    const member = JSON.stringify({ sessionId: 'track-2', role: 'executor', runId: 'r1', since: iso(NOW - 1000), hookSession: ID });
    const f = fake({ '/c/b/.forge/execution.json': run('someone-else'), '/c/b/.forge/members/track-2.json': member });
    expect((await search(f)).anchor).toMatchObject({ kind: 'member', checkout: '/c/b', project: 'q' });
  });

  it("the root's own project loses to this conversation's binding in a child", async () => {
    const f = fake({ ...project('/c', 'r'), ...project('/c/a', 'p', ID) });
    expect((await search(f)).anchor).toMatchObject({ checkout: '/c/a' });
  });

  it("kinds 'join' ignores own work; 'all' takes a forge task of this session or of its own.tasks", async () => {
    const mine = fake({ '/c/b/.forge/status/T1.json': status('T1', ID) });
    expect((await search(mine)).anchor).toBeNull();
    expect((await search(mine, { kinds: 'all' })).anchor).toMatchObject({ kind: 'forge-task', scope: 'own', checkout: '/c/b', project: null });
    const viaTask = fake({ '/c/b/.forge/status/T1.json': status('T1', null) });
    expect((await search(viaTask, { kinds: 'all', own: { tasks: ['T1-1'], paths: [] } })).anchor).toMatchObject({ kind: 'forge-task', checkout: '/c/b' });
    const other = fake({ '/c/b/.forge/status/T1.json': status('T1', 'conv-2') });
    expect((await search(other, { kinds: 'all', own: { tasks: [], paths: [] } })).anchor).toBeNull();
  });

  it('an own ledger or plan path anchors its checkout', async () => {
    const f = fake({ '/c/a/.superpowers/x': 'x', '/c/z/docs/superpowers/plans/p.md': 'x' });
    const ledger = await search(f, { kinds: 'all', own: { tasks: [], paths: [{ path: '/c/a/.superpowers/sdd/x/progress.md', at: 3 }] } });
    expect(ledger.anchor).toMatchObject({ kind: 'sdd-ledger', scope: 'own', checkout: '/c/a', at: 3 });
    const plan = await search(f, { kinds: 'all', own: { tasks: [], paths: [{ path: '/c/z/docs/superpowers/plans/p.md', at: 4 }] } });
    expect(plan.anchor).toMatchObject({ kind: 'sp-plan', checkout: '/c/z' });
  });

  it('a Windows root', async () => {
    const f = fake(project('E:/c/a', 'p', ID));
    const got = await search(f, { root: 'E:\\c' });
    expect(got.anchor).not.toBeNull();
    expect(samePath(got.anchor!.checkout, 'E:/c/a')).toBe(true);
  });

  it('no session id anchors nothing, and lists nothing', async () => {
    const f = fake(project('/c/a', 'p', ID));
    expect((await search(f, { sessionId: null, kinds: 'all' })).anchor).toBeNull();
    expect(f.lists).toEqual([]);
  });

  it("a session in a worktree reads its statuses beside that worktree's ledger; a task worktree, beside the main checkout's", async () => {
    const wt = '/c/a/.claude/worktrees/x';
    const own = fake({ [`${wt}/.git`]: 'gitdir: /c/a/.git/worktrees/x\n', [`${wt}/.forge/status/T1.json`]: status('T1', ID) });
    expect((await search(own, { root: wt, kinds: 'all' })).anchor).toMatchObject({ kind: 'forge-task', checkout: wt });
    // Its main checkout's statuses are not its worktree's.
    const main = fake({ [`${wt}/.git`]: 'gitdir: /c/a/.git/worktrees/x\n', '/c/a/.forge/status/T1.json': status('T1', ID) });
    expect((await search(main, { root: wt, kinds: 'all' })).anchor).toBeNull();
    const task = '/c/a/.claude/worktrees/task-T1';
    const t = fake({ [`${task}/.git`]: 'gitdir: /c/a/.git/worktrees/task-T1\n', '/c/a/.forge/status/T1.json': status('T1', ID) });
    expect((await search(t, { root: task, kinds: 'all' })).anchor).toMatchObject({ kind: 'forge-task', checkout: task });
  });

  it('isOwnStatus: the session it names first, else the tasks it ran (T1-2 is of T1)', () => {
    expect(isOwnStatus({ task: 'T1', session: ID }, ID, [])).toBe(true);
    expect(isOwnStatus({ task: 'T1', session: 'conv-2' }, ID, ['T1'])).toBe(false);
    expect(isOwnStatus({ task: 'T1', session: null }, ID, ['T1-2'])).toBe(true);
    expect(isOwnStatus({ task: 'T1', session: null }, ID, ['T10'])).toBe(false);
  });

  it('a refused .forge of the root is reported', async () => {
    const f = fake({ '/c/docs/waypoint/p/plan.yaml': 'x' }, { fail: { '/c/.forge': new Error('EACCES: permission denied') } });
    const got = await search(f);
    expect(got.anchor).toBeNull();
    expect(got.refused).toMatchObject({ path: '/c/.forge' });
  });
});
