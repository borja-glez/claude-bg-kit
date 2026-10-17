import { createHash } from 'node:crypto';
import type { MetaDoc, PhaseDoc, Plan, PlanView, States } from './types.js';
import { WAYPOINT_VERSION } from './waypoint-version.js';

export function planHash(plan: Plan): string {
  const { artifacts: _ignored, ...rest } = plan;
  return createHash('sha256').update(JSON.stringify(rest)).digest('hex').slice(0, 16);
}

export function buildDocs(plan: Plan, nowIso: string): { meta: MetaDoc; phases: PhaseDoc[] } {
  // G-25: the design the plan comes from, for the page's link (artifacts.design stays out of planHash, as before).
  const links = plan.artifacts.design || plan.design_version
    ? { ...(plan.artifacts.design ? { design: plan.artifacts.design } : {}), ...(plan.design_version ? { designVersion: plan.design_version } : {}) }
    : null;
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
      waypointVersion: WAYPOINT_VERSION,
      ...(links ? { links } : {}),
    },
    phases: plan.phases.map((p, i) => ({
      id: p.id,
      name: p.name,
      plan_status: p.plan_status,
      ...(p.goal ? { goal: p.goal } : {}),
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
    phases: ordered.map(({ id, name, plan_status, goal }) => ({ id, name, plan_status, ...(goal ? { goal } : {}) })),
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

export interface SyncOptions { nowIso: string; sessionId: string; eventId: string; states?: States; listed?: readonly string[]; planSynced?: boolean }
export interface SyncResult {
  files: Record<string, unknown>; batches: Write[][];
  /** A-12: the tasks this sync retires from the roadmap (orphaned). */
  removed: string[];
  /** A-13: the plan's tasks without a document in the listing; empty without one. */
  missing: string[];
  /** A-11: documents the listing has whose version known.json lacks: never written with a set. */
  unknownVersion: string[];
  /** A-11: those of them the sync has to write (to orphan it, or to bring it back): the caller lists state again. */
  needsList: string[];
}
const DEL = { __delete__: true } as const;

export function buildSyncWrites(plan: Plan, known: Known, outDir: string, opts: SyncOptions): SyncResult {
  const k = (c: string) => known[c] ?? {};
  const { meta, phases } = buildDocs(plan, opts.nowIso);
  const files: Record<string, unknown> = {};
  const file = (name: string, body: unknown) => {
    const p = `${outDir.replace(/[\\/]+$/, '')}/${name}`;
    files[p] = body;
    return p;
  };
  const writes: Write[] = [];

  // A-13: meta/project goes last, so its planHash says the plan is synced only once every earlier batch went in.
  const metaV = k('meta').project;
  const { metrics: _keep, ...rest } = meta; // the update never carries the empty metrics of buildDocs (live ones are in meta/metrics)
  const metaWrite: Write = metaV
    ? { op: 'update', collection: 'meta', doc_id: 'project', file_path: file('meta.json', rest), if_version: metaV }
    : { op: 'set', collection: 'meta', doc_id: 'project', file_path: file('meta.json', meta) };

  for (const ph of phases) {
    const v = k('plan')[ph.id];
    writes.push({ op: 'set', collection: 'plan', doc_id: ph.id, file_path: file(`plan-${ph.id.replace(/:/g, '_')}.json`, ph), ...(v ? { if_version: v } : {}) });
  }
  for (const [id, v] of Object.entries(k('plan'))) {
    if (!phases.some(p => p.id === id)) writes.push({ op: 'delete', collection: 'plan', doc_id: id, if_version: v });
  }

  const taskIds = new Set(plan.tasks.map(t => t.id));
  const listed = opts.listed ? new Set(opts.listed) : null;
  const removed: string[] = [], unknownVersion: string[] = [], needsList: string[] = [];
  for (const t of plan.tasks) {
    const v = k('state')[t.id];
    const st = opts.states?.[t.id];
    if (!v) {
      // A-11: a document the listing has but known.json lacks is never overwritten with a set.
      if (listed?.has(t.id)) { unknownVersion.push(t.id); if (st?.status === 'orphaned') needsList.push(t.id); continue; }
      writes.push({ op: 'set', collection: 'state', doc_id: t.id, data: { status: 'free' } });
    } else if (st?.status === 'orphaned') {
      // A-12: back in the plan, a done task is done again with its commits; any other is free, as before.
      writes.push(st.prevStatus === 'done'
        ? { op: 'update', collection: 'state', doc_id: t.id, data: { status: 'done', prevStatus: DEL }, if_version: v }
        : { op: 'update', collection: 'state', doc_id: t.id, data: { status: 'free', owner: DEL, claimedAt: DEL, startedAt: DEL, doneAt: DEL, blockedBy: DEL, blockedReason: DEL, prevStatus: DEL }, if_version: v });
    }
  }
  for (const [id, v] of Object.entries(k('state'))) {
    const st = opts.states?.[id];
    if (taskIds.has(id) || st?.status === 'orphaned') continue;
    // A-12: retired from the plan, it keeps what it was (prevStatus), and its doneAt and commits.
    writes.push({ op: 'update', collection: 'state', doc_id: id, data: { status: 'orphaned', ...(st?.status ? { prevStatus: st.status } : {}) }, if_version: v });
    removed.push(id);
  }
  // A-11: a document out of the plan the listing has and known.json lacks would need the orphan write: list again.
  if (listed) for (const id of listed) {
    if (!taskIds.has(id) && !k('state')[id] && opts.states?.[id]?.status !== 'orphaned') { unknownVersion.push(id); needsList.push(id); }
  }

  // A retry after the plan is synced (meta/project already carries the hash) does not log the change twice.
  if (!opts.planSynced) {
    writes.push({
      op: 'set',
      collection: 'events',
      doc_id: opts.eventId,
      data: { ts: opts.nowIso, type: 'plan_changed', sessionId: opts.sessionId, text: `plan ${meta.planHash}` },
    });
  }
  writes.push(metaWrite);

  const missing = listed ? plan.tasks.filter(t => !listed.has(t.id)).map(t => t.id) : [];
  return { files, batches: chunk(writes, files), removed, missing, unknownVersion, needsList };
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
