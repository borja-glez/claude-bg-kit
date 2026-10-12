import { createHash } from 'node:crypto';
import type { MetaDoc, PhaseDoc, Plan, PlanView, States } from './types.js';

export function planHash(plan: Plan): string {
  const { artifacts: _ignored, ...rest } = plan;
  return createHash('sha256').update(JSON.stringify(rest)).digest('hex').slice(0, 16);
}

export function buildDocs(plan: Plan, nowIso: string): { meta: MetaDoc; phases: PhaseDoc[] } {
  return {
    meta: {
      name: plan.project,
      locale: plan.locale,
      version: plan.version,
      planHash: planHash(plan),
      tracks: plan.tracks,
      versions: plan.versions,
      phaseOrder: plan.phases.map(p => p.id),
      metrics: {},
      syncedAt: nowIso,
    },
    phases: plan.phases.map((p, i) => ({
      id: p.id,
      name: p.name,
      plan_status: p.plan_status,
      order: i,
      tasks: plan.tasks.filter(t => t.phase === p.id),
    })),
  };
}

export function planViewFromDocs(meta: MetaDoc, phases: PhaseDoc[]): PlanView {
  const ordered = [...phases].sort((a, b) => a.order - b.order);
  return {
    tracks: meta.tracks,
    versions: meta.versions,
    phases: ordered.map(({ id, name, plan_status }) => ({ id, name, plan_status })),
    tasks: ordered.flatMap(p => p.tasks),
  };
}

export type Known = Record<string, Record<string, number>>;
export interface Write {
  op: 'set' | 'update' | 'delete';
  collection: string;
  doc_id: string;
  data?: Record<string, unknown>;
  file_path?: string;
  if_version?: number;
}

export function buildSyncWrites(
  plan: Plan,
  known: Known,
  outDir: string,
  opts: { nowIso: string; sessionId: string; eventId: string; states?: States },
): { files: Record<string, unknown>; batches: Write[][] } {
  const k = (c: string) => known[c] ?? {};
  const { meta, phases } = buildDocs(plan, opts.nowIso);
  const files: Record<string, unknown> = {};
  const file = (name: string, body: unknown) => {
    const p = `${outDir.replace(/[\\/]+$/, '')}/${name}`;
    files[p] = body;
    return p;
  };
  const writes: Write[] = [];

  const metaV = k('meta').project;
  if (metaV) {
    const { metrics: _keep, ...rest } = meta; // never overwrite live metrics on resync
    writes.push({ op: 'update', collection: 'meta', doc_id: 'project', file_path: file('meta.json', rest), if_version: metaV });
  } else {
    writes.push({ op: 'set', collection: 'meta', doc_id: 'project', file_path: file('meta.json', meta) });
  }

  for (const ph of phases) {
    const v = k('plan')[ph.id];
    writes.push({ op: 'set', collection: 'plan', doc_id: ph.id, file_path: file(`plan-${ph.id.replace(/:/g, '_')}.json`, ph), ...(v ? { if_version: v } : {}) });
  }
  for (const [id, v] of Object.entries(k('plan'))) {
    if (!phases.some(p => p.id === id)) writes.push({ op: 'delete', collection: 'plan', doc_id: id, if_version: v });
  }

  const taskIds = new Set(plan.tasks.map(t => t.id));
  for (const t of plan.tasks) {
    const v = k('state')[t.id];
    if (!v) writes.push({ op: 'set', collection: 'state', doc_id: t.id, data: { status: 'free' } });
    else if (opts.states?.[t.id]?.status === 'orphaned') {
      writes.push({
        op: 'update',
        collection: 'state',
        doc_id: t.id,
        data: {
          status: 'free',
          owner: { __delete__: true },
          claimedAt: { __delete__: true },
          startedAt: { __delete__: true },
          doneAt: { __delete__: true },
          blockedBy: { __delete__: true },
        },
        if_version: v,
      });
    }
  }
  for (const [id, v] of Object.entries(k('state'))) {
    if (!taskIds.has(id) && opts.states?.[id]?.status !== 'orphaned') writes.push({ op: 'update', collection: 'state', doc_id: id, data: { status: 'orphaned' }, if_version: v });
  }

  writes.push({
    op: 'set',
    collection: 'events',
    doc_id: opts.eventId,
    data: { ts: opts.nowIso, type: 'plan_changed', sessionId: opts.sessionId, text: `plan ${meta.planHash}` },
  });

  return { files, batches: chunk(writes, files) };
}

function chunk(writes: Write[], files: Record<string, unknown>, max = 50, maxBytes = 900_000): Write[][] {
  const out: Write[][] = [];
  let cur: Write[] = [];
  let bytes = 0;
  for (const w of writes) {
    const size = JSON.stringify(w.file_path ? files[w.file_path] : w.data ?? {}).length + 200;
    if (cur.length && (cur.length >= max || bytes + size > maxBytes)) {
      out.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(w);
    bytes += size;
  }
  if (cur.length) out.push(cur);
  return out;
}
