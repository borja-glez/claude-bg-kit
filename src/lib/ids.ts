// A-18: one SID grammar, the one isSafeId checks: anything outside [A-Za-z0-9_.-] becomes '-'. The ends lose their dots
// and dashes, before and after the cut at 40, so a SID is never '.', '..' nor a hidden name. Older SIDs with ~ : @ + are
// still read where they were.
const BAD = /[^A-Za-z0-9_.-]+/g;
const edges = (s: string) => s.replace(/^[-.]+|[-.]+$/g, '');

export function sessionIdFrom(name: string): string {
  const s = edges(edges(name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(BAD, '-')).slice(0, 40));
  return s || 'main';
}

export function compactTs(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace('.', '');
}

export function eventId(d: Date, sessionId: string, rand: () => number = Math.random): string {
  const r = Math.floor(rand() * 36 ** 4).toString(36).padStart(4, '0');
  return `${compactTs(d)}-${sessionId}-${r}`;
}

/** `n` event ids of one instant, all distinct: the i-th is stamped i milliseconds later (the order they are written in). */
export function eventIds(d: Date, sessionId: string, n: number, rand: () => number = Math.random): string[] {
  return Array.from({ length: n }, (_, i) => eventId(new Date(d.getTime() + i), sessionId, rand));
}

/** The plan's rule for a date (a version's target, G-25): YYYY-MM-DD and a day of the calendar (no 2026-02-30; carry 8). */
export const realDate = (v: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/** The plan's rule for task, track and phase ids, also for loose tasks: letters, digits, _ - .; at most 64; not . or .. */
export const PLAN_ID_RE = /^[A-Za-z0-9_.-]{1,64}$/;
export const isPlanId = (s: string): boolean => PLAN_ID_RE.test(s) && s !== '.' && s !== '..';
