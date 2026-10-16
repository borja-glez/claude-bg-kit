// K5-08: a notice dismissed with × stays dismissed, across sessions, for as long as that notice lasts. The band keeps
// one map under a key of $.store, { '["<root>","<project>","<kind>","<key>"]': "<ISO until>" }: the key names the
// subject (a task, a run, a design or a seat), so a new subject shows again, and the kind of notice, so dismissing
// another live session's work never hides the offer it leaves behind once it ends (nor the reverse). M7: the key is a
// JSON list, so a `|` in a folder name or a run id never makes two notices share it. Pure: register.tsx reads and writes
// the store.
import { PREVIOUS_OFFER_MS } from '../lib/viewer-role.js';

/** The $.store key of the map. */
export const DISMISS_STORE_KEY = 'dismissed';
/** At most this many dismissals are kept, the newest. */
export const DISMISS_MAX = 200;
/** How long a dismissed notice of another live session stays hidden. */
export const OTHER_LIVE_DISMISS_MS = 24 * 3600_000;
export type Dismissals = Record<string, string>;
type NoticeKind = 'other-live' | 'previous';

/** The map's key of a notice: the checkout, the project, the kind of notice and its subject, as a JSON list. */
export const dismissalKey = (root: string, project: string, kind: NoticeKind, key: string): string => JSON.stringify([root, project, kind, key]);

/** Whether `k` is a key dismissalKey builds: a JSON list of four strings. */
function isDismissalKey(k: string): boolean {
  try {
    const v = JSON.parse(k) as unknown;
    return Array.isArray(v) && v.length === 4 && v.every(x => typeof x === 'string');
  } catch { return false; }
}

/**
 * The stored map, keeping only the keys dismissalKey builds, to dates still ahead of `now`; anything else is no
 * dismissal. A key of an earlier version (`root|project|kind|key`) is dropped: that notice shows once more.
 */
export function normalizeDismissals(x: unknown, now: number): Dismissals {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return {};
  return Object.fromEntries(Object.entries(x as Record<string, unknown>).filter((entry): entry is [string, string] => {
    const [k, v] = entry;
    const t = typeof v === 'string' ? Date.parse(v) : NaN;
    return isDismissalKey(k) && Number.isFinite(t) && t > now;
  }));
}

/**
 * Until when a notice stays dismissed: the end of its offer for a previous one, a day from now for another live one. A
 * previous notice whose offer already ended (a run whose coordinator left, last moved over a day ago) also gets a day
 * from now, so the × never stores a date already past.
 */
export function dismissalUntil(n: { kind: NoticeKind; since: string | null }, now: number): string {
  const offerEnds = (n.since ? Date.parse(n.since) : NaN) + PREVIOUS_OFFER_MS;
  return new Date(n.kind === 'previous' && Number.isFinite(offerEnds) && offerEnds > now ? offerEnds : now + OTHER_LIVE_DISMISS_MS).toISOString();
}

/** The map with `key` dismissed until `until`: what expired is dropped, the key moves to the end, the newest DISMISS_MAX stay. */
export function addDismissal(d: Dismissals, key: string, until: string, now: number): Dismissals {
  const kept = Object.entries(normalizeDismissals(d, now)).filter(([k]) => k !== key);
  kept.push([key, until]);
  return Object.fromEntries(kept.slice(-DISMISS_MAX));
}

/** Whether the notice under `key` is still dismissed at `now`. */
export function isDismissed(d: Dismissals, key: string, now: number): boolean {
  const v = Object.prototype.hasOwnProperty.call(d, key) ? d[key] : undefined;
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) && t > now;
}
