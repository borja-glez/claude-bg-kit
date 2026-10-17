import { statusOf } from './deps.js';
import type { PlanView, States } from './types.js';

export interface Metrics {
  total: number;
  done: number;
  percent: number;
  inProgress: string[];
  blocked: string[];
  phasesDone: number;
  phaseCount: number;
  paceMin: number | null;
  etaIso: string | null;
  startedAt: string | null;
  byPhase: Record<string, { done: number; total: number; status: 'done' | 'in_progress' | 'committed' | 'provisional' }>;
  byTrack: Record<string, { done: number; total: number }>;
  /** G-11: each version's tasks (those of its phases): done, total and percent. */
  byVersion: Record<string, { done: number; total: number; percent: number }>;
  /** G-11: the first version (plan order) with work left; the last one when every version is done; null without versions. */
  currentVersion: string | null;
}

export function computeMetrics(plan: PlanView, states: States, now: number, activeSessions = 1): Metrics {
  const st = (id: string) => statusOf(states, id);
  const total = plan.tasks.length;
  const done = plan.tasks.filter(t => st(t.id) === 'done').length;

  const byPhase: Metrics['byPhase'] = {};
  for (const ph of plan.phases) {
    const ts = plan.tasks.filter(t => t.phase === ph.id);
    const d = ts.filter(t => st(t.id) === 'done').length;
    const started = ts.some(t => st(t.id) !== 'free');
    byPhase[ph.id] = { done: d, total: ts.length, status: ts.length > 0 && d === ts.length ? 'done' : started ? 'in_progress' : ph.plan_status };
  }
  const byTrack: Metrics['byTrack'] = {};
  for (const tr of plan.tracks) {
    const ts = plan.tasks.filter(t => t.track === tr.id);
    byTrack[tr.id] = { done: ts.filter(t => st(t.id) === 'done').length, total: ts.length };
  }

  const byVersion: Metrics['byVersion'] = {};
  const versions = plan.versions ?? [];
  for (const v of versions) {
    const phases = new Set(v.phases);
    const ts = plan.tasks.filter(t => phases.has(t.phase));
    const d = ts.filter(t => st(t.id) === 'done').length;
    byVersion[v.id] = { done: d, total: ts.length, percent: ts.length ? Math.round((d / ts.length) * 100) : 0 };
  }
  const open = versions.find(v => byVersion[v.id]!.done < byVersion[v.id]!.total);
  const currentVersion = open?.id ?? versions.at(-1)?.id ?? null;
  const durations: number[] = [];
  const starts: number[] = [];
  for (const t of plan.tasks) {
    const s = states[t.id];
    const start = s?.startedAt ?? s?.claimedAt;
    // A junk date must not throw (toISOString on NaN) and hide the whole band: it is left out.
    if (start && Number.isFinite(Date.parse(start))) starts.push(Date.parse(start));
    if (s?.status === 'done' && s.startedAt && s.doneAt) {
      const d = Math.max(0, (Date.parse(s.doneAt) - Date.parse(s.startedAt)) / 60000);
      if (Number.isFinite(d)) durations.push(d);
    }
  }
  const paceMin = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;
  const remaining = total - done;
  const etaIso = paceMin != null && remaining > 0
    ? new Date(now + (remaining * paceMin * 60000) / Math.max(1, activeSessions)).toISOString()
    : null;

  return {
    total,
    done,
    percent: total ? Math.round((done / total) * 100) : 0,
    inProgress: plan.tasks.filter(t => ['claimed', 'in_progress'].includes(st(t.id))).map(t => t.id),
    blocked: plan.tasks.filter(t => st(t.id) === 'blocked').map(t => t.id),
    phasesDone: Object.values(byPhase).filter(p => p.status === 'done').length,
    phaseCount: plan.phases.length,
    paceMin,
    etaIso,
    startedAt: starts.length ? new Date(Math.min(...starts)).toISOString() : null,
    byPhase,
    byTrack,
    byVersion,
    currentVersion,
  };
}
