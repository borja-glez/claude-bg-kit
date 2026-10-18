// H-06: what the views compute from the data, once per revision of it. The page bumps model.rev at each snapshot, and the
// key adds the minute (the forecast and every liveness move with the clock). The cache is per model object, so two models
// never share an entry; renderApp without a Derived computes it fresh (computeDerived), which is what tests see.
import { computeMetrics, type Metrics } from '../lib/metrics.js';
import { criticalPath, forecastEnd, paceRatioOf, zoneHeat, type ForecastEnd, type ZoneHeat } from '../lib/insights.js';
import { sessionLiveness } from '../lib/coordination.js';
import { STAGES } from '../lib/types.js';
import { num } from './html.js';
import { needsOf, type Need } from './needs.js';
import type { Model } from './model.js';

export interface Derived {
  metrics: Metrics;
  /** G-11: each version's progress (the same as metrics.byVersion). */
  byVersion: Metrics['byVersion'];
  /** G-12: the one forecast end of the page, which the strip, the timeline and the analysis read, with its parallelism. */
  forecast: ForecastEnd | null;
  /** G-12: the real pace against the estimates (paceRatioOf). */
  pace: number;
  critical: { ids: string[]; minutes: number };
  zones: ZoneHeat[];
  /** H-08: the plan tasks claimed or in progress, by stage (brief first) and then id; those without an exec go last. */
  running: string[];
  /** G-04: the sessions alive or silent (by their lease), and how many stopped. */
  liveSessions: { live: string[]; idle: number };
  /** G-24: the entries of «Te necesita». */
  needs: Need[];
}

/** G-12: how many work in parallel: each live session counts one, the coordinator of the active run its parallel, and the
 *  sessions of that run (or executors of no run) nothing more, since they are its slots. Final carry 1: a live executor
 *  counts whatever the coordinator does: with the coordinator not live (its lease lapsed mid-run), each live session of
 *  the run counts one; an executor of another run is never one of its slots. At least 1. */
export function parallelOf(m: Model, live: readonly string[]): number {
  const r = m.run && m.run.active ? m.run : null;
  const led = !!r && live.includes(r.coordinator);
  let n = 0;
  for (const sid of live) {
    const s = m.sessions[sid];
    if (r && sid === r.coordinator) n += Math.max(1, Math.floor(num(r.parallel)));
    else if (led && (s?.runId === r!.runId || (s?.role === 'executor' && !s.runId))) continue;
    else n += 1;
  }
  return Math.max(1, n);
}

const stageRank = (m: Model, id: string): number => {
  const s = m.states[id]?.exec?.stage;
  const i = s ? STAGES.indexOf(s) : -1;
  return i < 0 ? STAGES.length : i;
};

/** A value computed the first time it is read, then kept. */
const once = <T>(f: () => T): (() => T) => {
  let done = false;
  let value: T;
  return () => {
    if (!done) { value = f(); done = true; }
    return value;
  };
};

/** The derived data of a model, computed now (no cache). The metrics and the forecast (with the pace and the live
 *  sessions it reads) are read by the strip on every view; the rest only by the views that show it, so it is computed the
 *  first time one reads it (carry 10d): a snapshot on Conversación computes no critical path, zones or «Te necesita». */
export function computeDerived(m: Model): Derived {
  const metrics = computeMetrics(m.plan, m.states, m.now);
  const critical = once(() => criticalPath(m.plan, m.states, m.now));
  const zones = once(() => zoneHeat(m.plan, m.states));
  // Carry 6: ties by plain id order, not localeCompare (which depends on the machine's language).
  const running = once(() => [...metrics.inProgress].sort((a, b) => stageRank(m, a) - stageRank(m, b) || (a < b ? -1 : a > b ? 1 : 0)));
  const liveSessions = once(() => {
    const all = Object.keys(m.sessions);
    const live = all.filter(sid => sessionLiveness(m.sessions[sid], m.now) !== 'stopped');
    return { live, idle: all.length - live.length };
  });
  const needs = once(() => needsOf(m));
  const pace = paceRatioOf(m.plan, m.states);
  return {
    metrics,
    byVersion: metrics.byVersion,
    forecast: forecastEnd(m.plan, m.states, m.now, { parallel: parallelOf(m, liveSessions().live), paceRatio: pace }),
    pace,
    get critical() { return critical(); },
    get zones() { return zones(); },
    get running() { return running(); },
    get liveSessions() { return liveSessions(); },
    get needs() { return needs(); },
  };
}

/** The cache key of a model (§4.5): its revision and the minute of its clock. */
export const deriveKey = (m: Model): string => `${m.rev ?? 0}:${Math.floor(m.now / 60000)}`;

const cache = new WeakMap<Model, { key: string; value: Derived }>();

/** H-06: the derived data of a model, computed once per key. */
export function derive(m: Model): Derived {
  const key = deriveKey(m);
  const hit = cache.get(m);
  if (hit && hit.key === key) return hit.value;
  const value = computeDerived(m);
  cache.set(m, { key, value });
  return value;
}
