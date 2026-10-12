import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parsePlan } from '../src/lib/plan.js';
import { buildDocs, buildSyncWrites, planHash, planViewFromDocs } from '../src/lib/sync.js';
import type { States } from '../src/lib/types.js';

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
});

describe('buildSyncWrites', () => {
  it('first sync creates meta, phases, free states and a plan_changed event', () => {
    const { files, batches } = buildSyncWrites(plan, {}, '/tmp/out', opts);
    const writes = batches.flat();
    expect(writes.find(w => w.collection === 'meta')).toMatchObject({ op: 'set', doc_id: 'project', file_path: '/tmp/out/meta.json' });
    expect(writes.filter(w => w.collection === 'plan').every(w => w.op === 'set' && w.if_version === undefined)).toBe(true);
    expect(writes.filter(w => w.collection === 'state')).toHaveLength(6);
    expect(writes.find(w => w.collection === 'state')).toMatchObject({ op: 'set', data: { status: 'free' } });
    expect(writes.at(-1)).toMatchObject({ op: 'set', collection: 'events', doc_id: 'E1', data: { type: 'plan_changed', sessionId: 'main' } });
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
