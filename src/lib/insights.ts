// Read-only analyses of a plan for the roadmap page: the critical path and the forecast end, a burndown series and
// a heat map of code zones. Pure: plan and states in, plain data out.
import { DEFAULT_ESTIMATE_MIN } from './timeline.js';
import type { PlanView, States } from './types.js';

const MIN = 60000;
const isDone = (states: States, id: string) => states[id]?.status === 'done';

/** Minutes a task still needs: its estimate, less the time already spent when it is running (at least 5). */
export function remainingMin(plan: PlanView, states: States, id: string, now: number): number {
  const t = plan.tasks.find(x => x.id === id);
  const raw = Number(t?.estimate_min);
  const est = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_ESTIMATE_MIN;
  const s = states[id];
  if (s?.status === 'done') return 0;
  const start = s?.startedAt ?? s?.claimedAt;
  if ((s?.status === 'in_progress' || s?.status === 'claimed') && start) {
    const spent = (now - Date.parse(start)) / MIN;
    return Number.isFinite(spent) ? Math.max(5, Math.round(est - spent)) : est;
  }
  return est;
}

/**
 * The critical path: the chain of unfinished tasks, following depends_on, whose estimates add up to the most time.
 * With enough sessions in parallel it decides the end. `minutes` is its length from now.
 */
export function criticalPath(plan: PlanView, states: States, now: number): { ids: string[]; minutes: number } {
  const open = new Map(plan.tasks.filter(t => !isDone(states, t.id)).map(t => [t.id, t]));
  const finish = new Map<string, number>();
  const via = new Map<string, string | null>();
  const visiting = new Set<string>();
  const ef = (id: string): number => {
    const known = finish.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0; // a cycle (the plan validator refuses them): stop here
    visiting.add(id);
    let best = 0;
    let from: string | null = null;
    for (const dep of open.get(id)?.depends_on ?? []) {
      if (!open.has(dep)) continue;
      const v = ef(dep);
      if (v > best) { best = v; from = dep; }
    }
    visiting.delete(id);
    const total = best + remainingMin(plan, states, id, now);
    finish.set(id, total);
    via.set(id, from);
    return total;
  };
  let end: string | null = null;
  let minutes = 0;
  for (const id of open.keys()) {
    const v = ef(id);
    if (v > minutes) { minutes = v; end = id; }
  }
  const ids: string[] = [];
  for (let cur = end; cur; cur = via.get(cur) ?? null) ids.unshift(cur);
  return { ids, minutes };
}

/**
 * The forecast end, as a range: the earliest is the critical path (as many sessions as needed), the latest is all the
 * remaining work done one after another by the active sessions, at the real pace when there is one.
 */
export function forecast(plan: PlanView, states: States, now: number, opts: { sessions?: number; paceMin?: number | null } = {}): { from: number; to: number } | null {
  const left = plan.tasks.filter(t => !isDone(states, t.id));
  if (!left.length) return null;
  const cp = criticalPath(plan, states, now).minutes;
  const serial = left.reduce((sum, t) => sum + (opts.paceMin ?? remainingMin(plan, states, t.id, now)), 0) / Math.max(1, opts.sessions ?? 1);
  const a = now + cp * MIN;
  const b = now + Math.max(cp, serial) * MIN;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return { from: Math.min(a, b), to: Math.max(a, b) };
}

export interface Burndown { start: number; end: number; total: number; actual: { t: number; left: number }[]; ideal: { t: number; left: number }[] }

/**
 * Tasks left over time for `ids` (a version's or a phase's tasks): the actual line steps down at each doneAt, the
 * ideal line goes straight from the first start to zero at the forecast end (or now when everything is done).
 */
export function burndown(plan: PlanView, states: States, ids: string[], now: number, forecastEnd: number | null): Burndown | null {
  if (!ids.length) return null;
  const starts = ids.map(id => Date.parse(states[id]?.startedAt ?? states[id]?.claimedAt ?? '')).filter(Number.isFinite);
  const dones = ids.filter(id => isDone(states, id)).map(id => Date.parse(states[id]?.doneAt ?? '')).filter(Number.isFinite).sort((a, b) => a - b);
  const start = starts.length ? Math.min(...starts, ...dones) : now;
  const total = ids.length;
  const actual = [{ t: start, left: total }];
  let left = total;
  for (const t of dones) { left -= 1; actual.push({ t, left }); }
  const doneNow = ids.filter(id => isDone(states, id)).length;
  // Done tasks without a doneAt still count: the line ends at the true number left now.
  actual.push({ t: now, left: total - doneNow });
  const end = Math.max(now, forecastEnd ?? now, start + MIN);
  return { start, end, total, actual, ideal: [{ t: start, left: total }, { t: end, left: 0 }] };
}

export interface ZoneHeat { zone: string; tasks: number; done: number; active: number; touched: number }

/** Each code zone with how many tasks plan to touch it, how many are done or running, and how many touched it. */
export function zoneHeat(plan: PlanView, states: States): ZoneHeat[] {
  const map = new Map<string, ZoneHeat>();
  const get = (zone: string) => {
    let z = map.get(zone);
    if (!z) { z = { zone, tasks: 0, done: 0, active: 0, touched: 0 }; map.set(zone, z); }
    return z;
  };
  for (const t of plan.tasks) {
    const st = states[t.id]?.status ?? 'free';
    for (const zone of new Set(t.zones)) {
      const z = get(zone);
      z.tasks += 1;
      if (st === 'done') z.done += 1;
      else if (st === 'in_progress' || st === 'claimed') z.active += 1;
    }
    const touched = states[t.id]?.zonesTouched;
    if (Array.isArray(touched)) for (const zone of new Set(touched.filter((x): x is string => typeof x === 'string'))) get(zone).touched += 1;
  }
  return [...map.values()].sort((a, b) => b.tasks + b.touched - (a.tasks + a.touched) || a.zone.localeCompare(b.zone));
}
