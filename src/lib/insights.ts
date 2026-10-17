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

/** G-12: the one forecast end of the page: when the work left ends, and with how many working in parallel. */
export interface ForecastEnd { at: number; parallel: number }
/** The latest time a Date can hold (ECMAScript: 8.64e15 ms from the epoch). */
const MAX_DATE = 8.64e15;

/** G-12: the real pace against the estimates is taken within these bounds. */
export const PACE_MIN = 0.25;
export const PACE_MAX = 4;
const clampPace = (r: number): number => (Number.isFinite(r) && r > 0 ? Math.min(PACE_MAX, Math.max(PACE_MIN, r)) : 1);

/** G-12: how the real durations compare with the estimates: the median of real / estimate over the done tasks that have a
 *  start, an end and an estimate, within [PACE_MIN, PACE_MAX]; 1 without any. */
export function paceRatioOf(plan: PlanView, states: States): number {
  const ratios: number[] = [];
  for (const t of plan.tasks) {
    const s = states[t.id];
    const est = Number(t.estimate_min);
    if (s?.status !== 'done' || !s.startedAt || !s.doneAt || !(est > 0)) continue;
    const real = (Date.parse(s.doneAt) - Date.parse(s.startedAt)) / MIN;
    if (Number.isFinite(real) && real > 0) ratios.push(real / est);
  }
  if (!ratios.length) return 1;
  ratios.sort((a, b) => a - b);
  const mid = ratios.length >> 1;
  return clampPace(ratios.length % 2 ? ratios[mid]! : (ratios[mid - 1]! + ratios[mid]!) / 2);
}

/**
 * G-12: the one forecast end. A list schedule of the work left: each pending task lasts its remaining minutes times the
 * pace; the running ones go first, from now; then, in turn, the ready task (its pending dependencies already scheduled)
 * with the most critical path ahead (itself and the longest chain that waits for it), ties by plain id order (carry 6:
 * the same on every machine), goes to the worker that lets it start earliest. A dependency outside the plan or already
 * done does not count; a cycle is scheduled as if free of dependencies. Null when nothing is pending.
 */
export function forecastEnd(plan: PlanView, states: States, now: number, opts: { parallel: number; paceRatio: number }): ForecastEnd | null {
  const pending = plan.tasks.filter(t => !isDone(states, t.id));
  if (!pending.length) return null;
  const parallel = Math.max(1, Math.floor(Number.isFinite(opts.parallel) ? opts.parallel : 1));
  const pace = clampPace(opts.paceRatio);
  const ids = new Set(pending.map(t => t.id));
  const dur = new Map(pending.map(t => [t.id, remainingMin(plan, states, t.id, now) * pace]));
  const deps = new Map(pending.map(t => [t.id, [...new Set(t.depends_on)].filter(x => ids.has(x) && x !== t.id)]));
  const waiting = new Map<string, string[]>();
  for (const [id, ds] of deps) for (const x of ds) waiting.set(x, [...(waiting.get(x) ?? []), id]);
  const tail = new Map<string, number>();
  const visiting = new Set<string>();
  const tailOf = (id: string): number => {
    const known = tail.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let best = 0;
    for (const next of waiting.get(id) ?? []) best = Math.max(best, tailOf(next));
    visiting.delete(id);
    const v = best + dur.get(id)!;
    tail.set(id, v);
    return v;
  };
  const running = (id: string): boolean => { const s = states[id]?.status; return s === 'in_progress' || s === 'claimed'; };
  const rank = (a: string, b: string): number => Number(running(b)) - Number(running(a)) || tailOf(b) - tailOf(a) || (a < b ? -1 : a > b ? 1 : 0);
  // The minute (from now) at which each worker is free, and the minute each scheduled task ends. Never more workers than
  // tasks: the others would stay free, and a huge parallel must not allocate a huge array.
  const free = Array.from({ length: Math.min(parallel, pending.length) }, () => 0);
  const finish = new Map<string, number>();
  const left = new Set(ids);
  while (left.size) {
    let ready = [...left].filter(id => deps.get(id)!.every(x => finish.has(x)));
    if (!ready.length) ready = [...left];
    ready.sort(rank);
    const id = ready[0]!;
    const after = Math.max(0, ...deps.get(id)!.map(x => finish.get(x) ?? 0));
    let w = 0;
    for (let i = 1; i < free.length; i++) if (Math.max(free[i]!, after) < Math.max(free[w]!, after)) w = i;
    const end = Math.max(free[w]!, after) + dur.get(id)!;
    free[w] = end;
    finish.set(id, end);
    left.delete(id);
  }
  const at = now + Math.max(...finish.values()) * MIN;
  // A finite date past what a Date holds (an absurd estimate) would throw in toISOString: none rather than a broken page.
  return Number.isFinite(at) && Math.abs(at) <= MAX_DATE ? { at: Math.round(at), parallel } : null;
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
