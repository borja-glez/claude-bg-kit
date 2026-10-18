import { describe, it, expect } from 'vitest';
import { readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { buildSync } from 'esbuild';
import { parsePlan } from '../src/lib/plan.js';
import { buildDocs, buildSyncWrites, planHash, planViewFromDocs } from '../src/lib/sync.js';
import type { States } from '../src/lib/types.js';
import { compareVersions, WAYPOINT_VERSION } from '../src/lib/waypoint-version.js';
import { isSyncBatch, syncFiles } from '../src/lib/sync-files.js';
import { useTempDirs } from './helpers/tmp.js';
const tmp = useTempDirs();

const WP = (JSON.parse(readFileSync('plugins/waypoint/.claude-plugin/plugin.json', 'utf8')) as { version: string }).version;

const plan = parsePlan(readFileSync(new URL('./fixtures/plan.yaml', import.meta.url), 'utf8'));
const NOW = '2026-10-11T10:00:00.000Z';
const opts = { nowIso: NOW, sessionId: 'main', eventId: 'E1' };

describe('planHash', () => {
  it('is stable and ignores artifact urls', () => {
    const a = planHash(plan);
    const b = planHash({ ...plan, artifacts: { roadmap: 'https://claude.ai/artifact/x' } });
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(b).toBe(a);
    expect(planHash({ ...plan, version: '0.2' })).not.toBe(a);
  });
});

describe('buildDocs / planViewFromDocs', () => {
  it('groups tasks per phase and round-trips', () => {
    const { meta, phases } = buildDocs(plan, NOW);
    expect(meta.phaseOrder).toEqual(['F1', 'F2']);
    expect(phases.map(p => p.tasks.length)).toEqual([3, 3]);
    const view = planViewFromDocs(meta, [...phases].reverse());
    expect(view.phases.map(p => p.id)).toEqual(['F1', 'F2']);
    expect(view.tasks.map(t => t.id)).toEqual(['T001', 'T002', 'T003', 'T004', 'T005', 'T006']);
    expect(view.tracks).toEqual(plan.tracks);
  });
  it('copies goal and target, and adds meta.links with the design and its version (G-25)', () => {
    const linked = {
      ...plan, design_version: 7, artifacts: { design: 'https://claude.ai/artifact/d1' },
      phases: plan.phases.map((p, i) => (i === 0 ? { ...p, goal: 'orders can be placed' } : p)), versions: [{ ...plan.versions[0], target: '2026-11-30' }],
    };
    const { meta, phases } = buildDocs(linked, NOW);
    expect(meta.links).toEqual({ design: 'https://claude.ai/artifact/d1', designVersion: 7 });
    expect(meta.versions[0].target).toBe('2026-11-30');
    expect(phases[0].goal).toBe('orders can be placed');
    expect(phases[1]).not.toHaveProperty('goal');
    expect(planViewFromDocs(meta, phases).phases[0].goal).toBe('orders can be placed');
    expect(buildDocs(plan, NOW).meta).not.toHaveProperty('links');
  });
});

describe('buildSyncWrites', () => {
  it('first sync creates meta, phases, free states and a plan_changed event', () => {
    const { files, batches } = buildSyncWrites(plan, {}, '/tmp/out', opts);
    const writes = batches.flat();
    expect(writes.find(w => w.collection === 'meta')).toMatchObject({ op: 'set', doc_id: 'project', file_path: '/tmp/out/meta.json' });
    expect(writes.filter(w => w.collection === 'plan').every(w => w.op === 'set' && w.if_version === undefined)).toBe(true);
    expect(writes.filter(w => w.collection === 'state')).toHaveLength(6);
    expect(writes.find(w => w.collection === 'state')).toMatchObject({ op: 'set', data: { status: 'free' } });
    expect(writes.at(-2)).toMatchObject({ op: 'set', collection: 'events', doc_id: 'E1', data: { type: 'plan_changed', sessionId: 'main' } });
    expect(writes.at(-1)).toMatchObject({ collection: 'meta', doc_id: 'project' });
    expect(Object.keys(files)).toEqual(['/tmp/out/meta.json', '/tmp/out/plan-F1.json', '/tmp/out/plan-F2.json']);
  });

  it('resync pins versions, keeps progress and metrics, orphans removed tasks, deletes removed phases', () => {
    const known = { meta: { project: 4 }, plan: { F1: 2, F2: 2, F0: 1 }, state: { T001: 7, T002: 3, T999: 5 } };
    const { files, batches } = buildSyncWrites(plan, known, '/o', opts);
    const writes = batches.flat();
    const meta = writes.find(w => w.collection === 'meta')!;
    expect(meta).toMatchObject({ op: 'update', if_version: 4 });
    expect(files[meta.file_path!]).not.toHaveProperty('metrics');
    expect(writes.find(w => w.collection === 'plan' && w.doc_id === 'F1')).toMatchObject({ op: 'set', if_version: 2 });
    expect(writes.find(w => w.collection === 'plan' && w.doc_id === 'F0')).toEqual({ op: 'delete', collection: 'plan', doc_id: 'F0', if_version: 1 });
    const states = writes.filter(w => w.collection === 'state');
    expect(states.map(w => w.doc_id).sort()).toEqual(['T003', 'T004', 'T005', 'T006', 'T999']);
    expect(states.find(w => w.doc_id === 'T999')).toEqual({ op: 'update', collection: 'state', doc_id: 'T999', data: { status: 'orphaned' }, if_version: 5 });
  });

  it('splits into batches of at most 50 writes', () => {
    const big = { ...plan, tasks: Array.from({ length: 120 }, (_, i) => ({ ...plan.tasks[0], id: `T${1000 + i}`, depends_on: [] })) };
    const { batches } = buildSyncWrites(big, {}, '/o', opts);
    expect(batches.every(b => b.length <= 50)).toBe(true);
    expect(batches.flat()).toHaveLength(1 + 2 + 120 + 1);
  });
});

describe('buildSyncWrites fix round 1', () => {
  it('resets a re-added orphaned task to free with pinned version and delete markers', () => {
    const known = { state: { T001: 7 } };
    const states = { T001: { status: 'orphaned' } } as unknown as States;
    const { batches } = buildSyncWrites(plan, known, '/o', { ...opts, states });
    const w = batches.flat().find(x => x.collection === 'state' && x.doc_id === 'T001');
    expect(w).toEqual({
      op: 'update',
      collection: 'state',
      doc_id: 'T001',
      data: {
        status: 'free',
        owner: { __delete__: true },
        claimedAt: { __delete__: true },
        startedAt: { __delete__: true },
        doneAt: { __delete__: true },
        blockedBy: { __delete__: true },
        blockedReason: { __delete__: true },
        prevStatus: { __delete__: true },
      },
      if_version: 7,
    });
  });

  it('does not re-orphan a known state that is already orphaned and absent from the plan', () => {
    const known = { state: { T999: 5 } };
    const states = { T999: { status: 'orphaned' } } as unknown as States;
    const { batches } = buildSyncWrites(plan, known, '/o', { ...opts, states });
    expect(batches.flat().some(w => w.collection === 'state' && w.doc_id === 'T999')).toBe(false);
  });

  it('replaces ":" in phase file names while keeping the real doc_id', () => {
    const colon = { ...plan, phases: [{ ...plan.phases[0], id: 'F:1' }], tasks: [] };
    const { files, batches } = buildSyncWrites(colon, {}, '/o', opts);
    const planWrite = batches.flat().find(w => w.collection === 'plan')!;
    expect(planWrite.doc_id).toBe('F:1');
    expect(planWrite.file_path!.endsWith('plan-F_1.json')).toBe(true);
    expect(Object.keys(files).some(p => p.endsWith('plan-F_1.json'))).toBe(true);
  });
});

describe('buildSyncWrites with the listing of the roadmap (A-11, A-12, A-13)', () => {
  const known = { meta: { project: 4 }, plan: { F1: 2, F2: 2 }, state: { T001: 7, T002: 3, T999: 5 } };
  it('a state the listing has and known.json lacks gets no set; one that has to be written asks for the list again (A-11)', () => {
    const listed = ['T001', 'T002', 'T003', 'T999'];
    const r = buildSyncWrites(plan, known, '/o', { ...opts, listed, states: { T003: { status: 'free' } } as States });
    expect(r.batches.flat().some(w => w.collection === 'state' && w.doc_id === 'T003')).toBe(false);
    expect(r.unknownVersion).toEqual(['T003']);
    expect(r.needsList).toEqual([]);
    expect(buildSyncWrites(plan, known, '/o', { ...opts, listed, states: { T003: { status: 'orphaned' } } as States }).needsList).toEqual(['T003']);
    const gone = buildSyncWrites(plan, known, '/o', { ...opts, listed: [...listed, 'T777'], states: { T777: { status: 'done' } } as States });
    expect(gone.unknownVersion).toContain('T777');
    expect(gone.needsList).toEqual(['T777']);
  });
  it('a task the plan drops keeps what it was; back in the plan, a done one is done again with its commits (A-12)', () => {
    const r = buildSyncWrites(plan, known, '/o', { ...opts, states: { T999: { status: 'done', doneAt: 'd', commits: [{ sha: 'a' }] } } as unknown as States });
    expect(r.batches.flat().find(w => w.doc_id === 'T999')).toEqual({ op: 'update', collection: 'state', doc_id: 'T999', data: { status: 'orphaned', prevStatus: 'done' }, if_version: 5 });
    expect(r.removed).toEqual(['T999']);
    const back = buildSyncWrites(plan, known, '/o', { ...opts, states: { T001: { status: 'orphaned', prevStatus: 'done', doneAt: 'd' } } as unknown as States });
    expect(back.batches.flat().find(w => w.doc_id === 'T001')).toEqual({ op: 'update', collection: 'state', doc_id: 'T001', data: { status: 'done', prevStatus: { __delete__: true } }, if_version: 7 });
    expect(back.removed).toEqual(['T999']);
  });
  it('meta/project goes in the last batch; missing lists the plan tasks the listing does not have (A-13)', () => {
    const big = { ...plan, tasks: Array.from({ length: 60 }, (_, i) => ({ ...plan.tasks[0], id: `T${1000 + i}`, depends_on: [] })) };
    const r = buildSyncWrites(big, {}, '/o', { ...opts, listed: ['T1000', 'T1001'] });
    expect(r.batches.length).toBeGreaterThanOrEqual(2);
    expect(r.batches.at(-1)!.at(-1)).toMatchObject({ collection: 'meta', doc_id: 'project' });
    expect(r.batches.slice(0, -1).flat().some(w => w.collection === 'meta')).toBe(false);
    expect(r.missing).toHaveLength(58);
    expect(r.missing).not.toContain('T1000');
    expect(buildSyncWrites(big, {}, '/o', opts).missing).toEqual([]);
  });
});

describe('the waypoint version (G-13)', () => {
  it('is the manifest version, and buildDocs writes it in meta/project, out of planHash', () => {
    expect(WAYPOINT_VERSION).toBe(WP);
    expect(buildDocs(plan, NOW).meta.waypointVersion).toBe(WP);
  });
  it('compareVersions compares x.y.z numerically; anything else counts as 0.0.0', () => {
    expect(compareVersions('0.26.0', '0.25.9')).toBe(1);
    expect(compareVersions('0.9.0', '0.10.0')).toBe(-1);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('junk', '0.0.1')).toBe(-1);
    expect(compareVersions(undefined, '0.0.0')).toBe(0);
  });
  it('carry 9: a bundle built without the define says 0.0.0 and does not throw', () => {
    const dir = tmp('wp-version-');
    try {
      const out = path.join(dir, 'v.cjs');
      buildSync({
        stdin: { contents: `import { WAYPOINT_VERSION } from './src/lib/waypoint-version.ts'; console.log(WAYPOINT_VERSION);`, resolveDir: process.cwd(), loader: 'ts' },
        bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'silent',
      });
      expect(execFileSync(process.execPath, [out], { encoding: 'utf8' }).trim()).toBe('0.0.0');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('the files of a sync (A-24)', () => {
  it('are the ones sync-files names, so sync and doctor agree on them', () => {
    const plan = parsePlan(readFileSync(new URL('./fixtures/plan.yaml', import.meta.url), 'utf8'));
    const r = buildSyncWrites(plan, {}, 'out', { nowIso: '2026-10-16T10:00:00.000Z', sessionId: 'main', eventId: 'e1' });
    const names = Object.keys(r.files).map(f => f.split('/').pop()!);
    expect(names.length).toBeGreaterThan(1);
    for (const n of names) {
      expect(syncFiles(plan).has(n), n).toBe(true);
      expect(isSyncBatch(n), n).toBe(true);
    }
    expect([isSyncBatch('known.json'), isSyncBatch('session.json'), isSyncBatch('plan-x.txt')]).toEqual([false, false, false]);
  });
});
