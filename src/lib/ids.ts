const BAD = /[^A-Za-z0-9_\-.~:@+]+/g;

export function sessionIdFrom(name: string): string {
  const s = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(BAD, '-').replace(/^-+|-+$/g, '').slice(0, 40);
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

/** The plan's rule for task, track and phase ids, also for loose tasks: letters, digits, _ - .; at most 64; not . or .. */
export const PLAN_ID_RE = /^[A-Za-z0-9_.-]{1,64}$/;
export const isPlanId = (s: string): boolean => PLAN_ID_RE.test(s) && s !== '.' && s !== '..';
