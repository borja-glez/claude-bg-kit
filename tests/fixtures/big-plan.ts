// A synthetic plan of 343 tasks in 15 phases and 6 tracks, the size of the largest real plan, without any real data
// (spec §4.5). The page's morph and budget tests use it, and plan 4b's Chrome trace runs on the local page that
// scripts/roadmap-harness.mjs builds from it.
import { buildDocs } from '../../src/lib/sync.js';
import type { EventDoc, NoteDoc, Plan, PlanTask, PlanTrack, RunDoc, SessionDoc, TaskState, TaskStatus } from '../../src/lib/types.js';
import type { ProposalDoc } from '../../src/lib/proposals.js';
import type { Snapshot } from '../../src/page/app.js';
import type { Model } from '../../src/page/render.js';

export const BIG_NOW = Date.parse('2026-10-16T12:00:00.000Z');
export const BIG_TASKS = 343;
export const BIG_PHASES = 15;
export const BIG_RUN = 'big-20261016T110000000Z';
const PER_PHASE = Math.ceil(BIG_TASKS / BIG_PHASES);
const DONE = 120;
export const taskId = (n: number): string => `T${String(n).padStart(3, '0')}`;
const at = (now: number, min: number): string => new Date(now + min * 60000).toISOString();
const TRACKS: PlanTrack[] = [
  { id: 'api', name: 'API', color: 'blue' }, { id: 'web', name: 'Web', color: 'mauve' }, { id: 'data', name: 'Datos', color: 'teal' },
  { id: 'mobile', name: 'Móvil', color: 'pink' }, { id: 'infra', name: 'Infra', color: 'sky' }, { id: 'docs', name: 'Docs', color: 'flamingo' },
];

/** Task n is in phase ⌊(n−1)/23⌋+1 and track n mod 6; most depend on the one before, every seventh also on one 23 back. */
export function bigPlan(): Plan {
  const phases = Array.from({ length: BIG_PHASES }, (_, i) => ({ id: `F${i + 1}`, name: `Fase ${i + 1}`, plan_status: (i < 10 ? 'committed' : 'provisional') as 'committed' | 'provisional' }));
  const tasks: PlanTask[] = Array.from({ length: BIG_TASKS }, (_, k) => {
    const n = k + 1;
    const phase = Math.min(BIG_PHASES - 1, Math.floor(k / PER_PHASE));
    const depends = n % 5 === 1 ? [] : [taskId(n - 1)];
    if (n > PER_PHASE && n % 7 === 0) depends.push(taskId(n - PER_PHASE));
    return {
      id: taskId(n), title: `Tarea sintética ${n} de la fase ${phase + 1}`, track: TRACKS[k % TRACKS.length]!.id, phase: phases[phase]!.id,
      category: ['api', 'ui', 'datos'][k % 3], includes: `El trabajo ${n}, con **un detalle** y \`código\`.`, done_when: `\`npm test -- t${n}\` pasa`,
      verification: `npm test -- t${n}`, depends_on: depends, zones: [`src/mod${k % 12}/part${k % 5}/**`], estimate_min: 15 + (k % 6) * 10,
    };
  });
  return {
    project: 'big-plan', locale: 'es', version: '0.3', artifacts: {}, tracks: TRACKS, phases, tasks,
    versions: [
      { id: '0.1', phases: ['F1', 'F2', 'F3', 'F4', 'F5'] }, { id: '0.2', phases: ['F6', 'F7', 'F8', 'F9', 'F10'] },
      { id: '0.3', phases: ['F11', 'F12', 'F13', 'F14', 'F15'] },
    ],
  };
}

/** The first 120 tasks done (one every 45 min back from now), three running in a run of subagents with their forge block,
 *  one claimed by hand, one blocked from outside with its reason and one waiting for it; the rest free. */
export function bigStates(now = BIG_NOW): Record<string, TaskState> {
  const out: Record<string, TaskState> = {};
  for (let n = 1; n <= DONE; n++) {
    const end = now - (DONE - n + 1) * 45 * 60000;
    const doneAt = new Date(end).toISOString();
    out[taskId(n)] = {
      status: 'done', owner: 'main', startedAt: new Date(end - 30 * 60000).toISOString(), doneAt,
      commits: [{ sha: (n * 7919).toString(16).padStart(7, '0'), ts: doneAt, title: `${taskId(n)}: hecha`, add: 10 + n, del: n % 7 }],
    };
  }
  (['implement', 'review', 'verify'] as const).forEach((stage, i) => {
    out[taskId(DONE + 1 + i)] = {
      status: 'in_progress', owner: 'main', claimedAt: at(now, -50), startedAt: at(now, -48),
      exec: { runId: BIG_RUN, mode: 'subagents', by: 'main', agent: 'forge-impl', stage, round: 1, since: at(now, -12 + i * 3), leaseUntil: at(now, 10) },
      forge: {
        v: 2, path: 'medium', phase: stage, agent: 'forge-impl', round: i + 1, cap: 4, brief: 1, stage,
        validators: [{ name: 'test', ok: true, ms: 41000 }, { name: 'typecheck', ok: true, ms: 9000, cached: true }, { name: 'lint', ok: i !== 1 }, { name: 'e2e', ok: true, flaky: true }],
        rounds: Array.from({ length: i }, (_, k) => ({
          brief: 1, n: k + 1, action: 'fix' as const, note: `ronda ${k + 1}: arreglar el caso borde`,
          findings: { critical: 0, important: 1, minor: 2, deferred: 0 }, reviewers: ['correctness'], at: at(now, -30 + k * 5),
        })),
        verify: null, stages: { brief: 60, implement: 600 }, integration: null, deferred: [], acceptedRound: null, overCap: false, updatedAt: at(now, -5),
      },
    };
  });
  // A done task whose integration is not merged yet, with two deferred findings: Plan's «Sin fusionar» and «Aplazados».
  const t118 = out[taskId(118)]!;
  out[taskId(118)] = { ...t118, forge: {
    v: 2, path: 'medium', phase: 'done', agent: 'forge-impl', round: 2, cap: 4, brief: 1, stage: 'done', validators: [{ name: 'test', ok: true }],
    rounds: [{ brief: 1, n: 2, action: 'accept', note: 'listo', findings: { critical: 0, important: 0, minor: 2, deferred: 2 }, reviewers: ['correctness'], at: t118.doneAt! }],
    verify: null, stages: { implement: 1200 }, integration: { branch: 'forge/run-big', sha: 'abc1234', merged: false, target: 'main' },
    deferred: [{ file: 'src/mod9/part2/x.ts', line: 12, problem: 'falta un índice' }, { problem: 'n+1 en el listado' }], acceptedRound: 2, overCap: false, updatedAt: t118.doneAt!,
  } };
  out[taskId(DONE + 4)] = { status: 'claimed', owner: 'ana', claimedAt: at(now, -20) };
  out[taskId(DONE + 10)] = { status: 'blocked', blockedBy: ['external'], blockedReason: 'Espera las credenciales del proveedor de pagos' };
  out[taskId(DONE + 11)] = { status: 'blocked', blockedBy: [taskId(DONE + 10)] };
  return out;
}

/** Two live sessions (the run's coordinator and a manual one) and 29 that stopped days ago. */
export function bigSessions(now = BIG_NOW): Record<string, SessionDoc> {
  const out: Record<string, SessionDoc> = {
    main: { name: 'main', track: 'api', currentTask: taskId(DONE + 1), heartbeatAt: at(now, -1), leaseUntil: at(now, 9), status: 'active', role: 'coordinator', runId: BIG_RUN, branch: 'forge/run-big' },
    ana: { name: 'ana', track: 'web', currentTask: taskId(DONE + 4), heartbeatAt: at(now, -2), leaseUntil: at(now, 8), status: 'active', role: 'manual', branch: 'track/web' },
  };
  for (let i = 1; i <= 29; i++) out[`old-${i}`] = { name: `old-${i}`, track: null, heartbeatAt: at(now, -(i + 2) * 1440), leaseUntil: at(now, -(i + 2) * 1440 + 10), status: 'idle' };
  return out;
}

/** The run of subagents the three running tasks belong to. */
export function bigRun(now = BIG_NOW): RunDoc {
  return {
    runId: BIG_RUN, mode: 'subagents', parallel: 3, branch: 'forge/run-big', mergeOnFinish: false, active: true, stopReason: null, coordinator: 'main', kind: 'plan', loose: [],
    slots: (['implement', 'review', 'verify'] as const).map((stage, i) => ({ task: taskId(DONE + 1 + i), stage, agent: 'forge-impl', by: 'main', since: at(now, -12 + i * 3) })),
    startedAt: at(now, -60), lastStepAt: at(now, -2),
  };
}

export function bigEvents(now = BIG_NOW): (EventDoc & { id: string })[] {
  return Array.from({ length: 20 }, (_, i) => {
    const n = DONE - i;
    return { id: `e${n}`, ts: at(now, -(i + 1) * 45), type: 'done' as const, sessionId: 'main', taskId: taskId(n), text: `${taskId(n)}: hecha`, add: 10 + n, del: n % 7 };
  });
}

export function bigNotes(now = BIG_NOW): (NoteDoc & { id: string })[] {
  return [
    { id: 'q1', ts: at(now, -90), type: 'question', author: 'session:main', text: '¿Usamos el proveedor de pagos A o B?', taskId: taskId(DONE + 10) },
    { id: 'd1', ts: at(now, -120), type: 'decision', author: 'session:main', text: 'Diseño aprobado (v3)', decision: { point: 'design-approve', what: 'Diseño aprobado (v3)', chosen: 'approve', why: 'ronda 2 sin critical', auto: true } },
  ];
}

export function bigProposals(now = BIG_NOW): (ProposalDoc & { id: string })[] {
  return [{ id: 'p1', ts: at(now, -200), category: 'perf', risk: 'low', title: 'Cachear los precios', rationale: 'Las consultas se repiten', evidence: 'bench: 120 ms → 8 ms', pillar: 'Checkout rápido', status: 'proposed', source: 'scout', author: 'session:main' }];
}

/** The page's embedded snapshot, with the states the last listing saw (G-14). */
export function bigSnapshot(now = BIG_NOW): Snapshot {
  const states = Object.fromEntries(Object.entries(bigStates(now)).map(([id, s]) => [id, s.status])) as Record<string, TaskStatus>;
  return { ...buildDocs(bigPlan(), at(now, -600)), states, statesAt: at(now, -30) };
}

/** Every document of the roadmap by path, as a database serves them: `meta` by document, `coll` by collection and id. */
export function bigDocs(now = BIG_NOW, snap: Snapshot = bigSnapshot(now)): { meta: Record<string, unknown>; coll: Record<string, Record<string, unknown>> } {
  const byId = <T extends { id: string }>(list: T[]) => Object.fromEntries(list.map(({ id, ...body }) => [id, body]));
  return {
    meta: { 'meta/project': snap.meta, 'meta/run': bigRun(now) },
    coll: {
      plan: Object.fromEntries(snap.phases.map(p => [p.id, p])), state: bigStates(now), sessions: bigSessions(now), events: byId(bigEvents(now)),
      notes: byId(bigNotes(now)), proposals: byId(bigProposals(now)), messages: {}, approvals: {},
    },
  };
}

/** The page's model of the same roadmap once every collection answered. */
export function bigModel(now = BIG_NOW): Model {
  const snap = bigSnapshot(now);
  return {
    meta: snap.meta, plan: bigPlan(), states: bigStates(now), sessions: bigSessions(now), events: bigEvents(now), messages: [], notes: bigNotes(now),
    proposals: bigProposals(now), infinite: null, run: bigRun(now), me: 'user:owner', isOwner: true, approvals: {}, profiles: {}, readOnly: false, now, offline: false, connecting: false, rev: 1,
  };
}

/**
 * The local page of plan 4b's Chrome trace (spec §4.5, §7.3): the built roadmap template with this plan's snapshot and a
 * fake window.claude that serves its documents (an owner, and a database that answers each subscription once). With
 * #live=1 in the address, a running task changes stage every 5 s, to watch a snapshot arrive. Nothing is published.
 */
export function harnessHtml(template: string, now = Date.now(), snap: Snapshot = bigSnapshot(now)): string {
  const snapshot = JSON.stringify(snap).replace(/</g, '\\u003c');
  const docs = JSON.stringify(bigDocs(now, snap)).replace(/</g, '\\u003c');
  const fake = `(() => {
  const DOCS = ${docs};
  const subs = {};
  const snap = p => (p.startsWith('meta/')
    ? { exists: p in DOCS.meta, data: () => DOCS.meta[p] }
    : { docs: Object.entries(DOCS.coll[p] || {}).map(([id, body]) => ({ id, exists: true, data: () => body })) });
  const ref = p => {
    const q = {
      orderBy: () => q, limit: () => q,
      onSnapshot: cb => { (subs[p] = subs[p] || []).push(cb); setTimeout(() => cb(snap(p)), 30); return () => {}; },
      get: async () => ({ exists: false, data: () => undefined }), update: async () => {}, set: async () => {}, add: async () => ({ id: 'local' }),
    };
    return q;
  };
  const db = { doc: ref, collection: ref };
  const user = { id: async () => 'owner', isOwner: async () => true, profiles: async () => ({}) };
  window.claude = { use: async n => (n === 'db' ? db : n === 'user' ? user : null) };
  if (/(^#|&)live=1(&|$)/.test(location.hash)) {
    const stages = ['implement', 'validate', 'verify', 'review', 'verdict'];
    let k = 0;
    setInterval(() => {
      const st = Object.values(DOCS.coll.state).find(s => s.exec);
      if (!st) return;
      st.exec = Object.assign({}, st.exec, { stage: stages[k++ % stages.length], since: new Date().toISOString(), leaseUntil: new Date(Date.now() + 600000).toISOString() });
      (subs.state || []).forEach(cb => cb(snap('state')));
    }, 5000);
  }
})();`;
  // Carry 10c: the publisher wraps the template in a standards-mode page; without it Chrome opens the file in quirks mode
  // and the §7.3 walk would measure another layout.
  const lang = String(snap.meta?.locale ?? 'en').replace(/[^\w-]/g, '') || 'en';
  const head = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`;
  return head + template
    .replace('__TITLE__', () => 'big-plan Roadmap')
    .replace('__SNAPSHOT__</script>', () => `${snapshot}</script>\n<script>${fake}</script>`);
}
