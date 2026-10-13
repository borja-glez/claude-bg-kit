import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadBandModel, type Engine } from '../src/mod/files.js';

const plan = readFileSync(new URL('./fixtures/plan.yaml', import.meta.url), 'utf8');

// A fake engine over a map of absolute path -> text; directories are derived from the paths.
function fake(root: string, files: Record<string, string>, over: Record<string, { size?: number; mtimeMs?: number }> = {}): { $: Engine; reads: string[]; lists: string[] } {
  const reads: string[] = [];
  const lists: string[] = [];
  const entries = (dir: string) => {
    const seen = new Map<string, { name: string; kind: 'file' | 'dir'; size: number; mtimeMs: number }>();
    for (const [p, text] of Object.entries(files)) {
      if (!p.startsWith(dir + '/')) continue;
      const rest = p.slice(dir.length + 1);
      const name = rest.split('/')[0];
      const isFile = !rest.includes('/');
      const o = over[p] ?? {};
      seen.set(name, { name, kind: isFile ? 'file' : 'dir', size: isFile ? (o.size ?? text.length) : 0, mtimeMs: o.mtimeMs ?? 1 });
    }
    return [...seen.values()];
  };
  const $ = {
    session: { root: async () => root },
    fs: {
      read: async (p: string) => { reads.push(p); if (!(p in files)) throw new Error('ENOENT'); return files[p]; },
      list: async (d: string) => { lists.push(d); const e = entries(d); if (!e.length) throw new Error('ENOENT'); return e; },
      exists: async (p: string) => p in files,
      stat: async (p: string) => { if (!(p in files)) throw new Error('ENOENT'); return { mtimeMs: over[p]?.mtimeMs ?? 1 }; },
    },
    clock: { now: async () => Date.now() },
  } as unknown as Engine;
  return { $, reads, lists };
}

const now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const task = (status: string, extra: object = {}) => ({ status, stage: 'implement', round: 1, worktree: '/w', branch: 'b', executor: 'subagents', attempts: 0, agent: null, startedAt: iso(now - 600000), updatedAt: iso(now), stageSince: iso(now), detail: null, ...extra });
const EXEC = JSON.stringify({ runId: 'r1', kind: 'plan', mode: 'subagents', parallel: 3, project: 'demo-shop', base: 'main', branch: 'forge/run', mergeOnFinish: false, coordinator: 'main', hookSession: null, active: true, stopReason: null, stallReason: null,
  startedAt: iso(now - 3600000), lastStepAt: iso(now - 60000), lastBlockStep: null, sleepUntil: null, tasks: { T002: task('running'), T001: task('integrated') } });
const pub = (id: string) => JSON.stringify({ task: id, runId: 'r1', stage: 'review', status: 'running', agent: null, round: 3, since: iso(now), updatedAt: iso(now), leaseUntil: iso(now + 600000), by: 'x', mode: 'subagents' });

const base = (root: string) => ({
  [`${root}/docs/waypoint/demo-shop/plan.yaml`]: plan,
  [`${root}/.waypoint/demo-shop/session.json`]: JSON.stringify({ sessionId: 'main', track: null }),
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
    const { $, reads } = fake(root, { ...base(root), [`${root}/.forge/decisions.json`]: doc() }, { [`${root}/.forge/decisions.json`]: { size: 17 * 1024 } });
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
    }, { [`${root}/.forge/execution/T004.json`]: { size: 9 * 1024 }, [`${root}/.forge/live/big.json`]: { size: 9 * 1024 } });
    const m = await loadBandModel($);
    expect(m).toMatchObject({ mode: 'run', slots: [{ task: 'T002' }] });
    expect(reads).not.toContain(`${root}/.forge/execution/T004.json`);
    expect(reads).not.toContain(`${root}/.forge/live/big.json`);

    const oversized = fake(root, { ...base(root), [`${root}/.forge/execution.json`]: EXEC }, { [`${root}/.forge/execution.json`]: { size: 65 * 1024 } });
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
      [`${root}/.waypoint/demo-shop/critique-r1.json`]: JSON.stringify({ round: 1, version: 1, scope: 'full', proposals: [prop(1), prop(2), prop(3)] }),
    };
    expect(await loadBandModel(fake(root, files).$)).toMatchObject({ mode: 'design', pending: 3 });
    const { $, reads } = fake(root, { ...files, [`${root}/.waypoint/demo-shop/dismissed.json`]: JSON.stringify({ 1: [2, 3] }) });
    expect(await loadBandModel($)).toMatchObject({ mode: 'design', pending: 1 });
    expect(reads).toContain(`${root}/.waypoint/demo-shop/dismissed.json`);
  });
});
