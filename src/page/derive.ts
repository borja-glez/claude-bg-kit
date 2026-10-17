// H-06: what the views compute from the data, once per revision of it. The page bumps model.rev at each snapshot, and the
// key adds the minute (the forecast and every liveness move with the clock). The cache is per model object, so two models
// never share an entry; renderApp without a Derived computes it fresh (computeDerived), which is what tests see.
import { computeMetrics, type Metrics } from '../lib/metrics.js';
import { criticalPath, forecast, zoneHeat, type ZoneHeat } from '../lib/insights.js';
import type { Model } from './model.js';

export interface Derived {
  metrics: Metrics;
  /** G-11: each version's progress (the same as metrics.byVersion). */
  byVersion: Metrics['byVersion'];
  /** The forecast range of insights.forecast; its `to` is the forecast end the strip shows. 4c replaces it with forecastEnd. */
  forecast: { from: number; to: number } | null;
  critical: { ids: string[]; minutes: number };
  zones: ZoneHeat[];
}

/** The sessions that work in parallel, for the pace of the forecast: the active ones, at least one. */
const activeSessions = (m: Model): number => Math.max(1, Object.values(m.sessions).filter(s => s.status === 'active').length);

/** The derived data of a model, computed now (no cache). */
export function computeDerived(m: Model): Derived {
  const sessions = activeSessions(m);
  const metrics = computeMetrics(m.plan, m.states, m.now, sessions);
  return {
    metrics,
    byVersion: metrics.byVersion,
    forecast: forecast(m.plan, m.states, m.now, { sessions, paceMin: metrics.paceMin }),
    critical: criticalPath(m.plan, m.states, m.now),
    zones: zoneHeat(m.plan, m.states),
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
