// w7 A2: what the design page's comment threads have been through. For each thread (by the id ArtifactComments gives
// it): the first round whose critic got it, and the last version of the design whose applied proposal took it up. Never
// the text of a comment. Pure: no zod and no Node import, because critique.ts and design-lite.ts (which the band bundles)
// import THREAD_ID.

/** w7 A2: the id of a comment thread as ArtifactComments gives it: printable ASCII, no space, no comma (the list separator). */
export const THREAD_ID = /^[\x21-\x2b\x2d-\x7e]{1,200}$/;
export const COMMENTS_MAX_BYTES = 256 * 1024;
export interface ThreadSeen { round: number | null; taken: number | null }
export type CommentsSeen = Record<string, ThreadSeen>;

const posIntOrNull = (v: unknown): number | null | undefined =>
  v === null ? null : typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : undefined;

/** comments.json as read: an object of THREAD_ID keys, each with a positive integer or null `round` and `taken`; anything else is left out, junk is {}. */
export function parseCommentsSeen(text: string): CommentsSeen {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return {}; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const entries: [string, ThreadSeen][] = [];
  // Object.entries lists an own `__proto__` key (JSON.parse makes it an own property).
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!THREAD_ID.test(id) || !v || typeof v !== 'object' || Array.isArray(v)) continue;
    const round = posIntOrNull((v as Record<string, unknown>).round);
    const taken = posIntOrNull((v as Record<string, unknown>).taken);
    if (round === undefined || taken === undefined) continue;
    entries.push([id, { round, taken }]);
  }
  return Object.fromEntries(entries);
}

/** A --seen or --taken value: the ids split on ',', trimmed, empty ones dropped; null when none is left or one is not a THREAD_ID. */
export function threadIds(value: string): string[] | null {
  const ids = value.split(',').map(s => s.trim()).filter(Boolean);
  if (!ids.length || ids.some(id => !THREAD_ID.test(id))) return null;
  return ids;
}

const withEntries = (s: CommentsSeen, add: [string, ThreadSeen][]): CommentsSeen =>
  Object.fromEntries([...Object.entries(s), ...add]);

/** The ids passed to round `round`'s critic: a thread that already has a round keeps it; a new one, or one with `round: null`, gets `round`, its `taken` kept (null when new). */
export function markSeen(s: CommentsSeen, ids: readonly string[], round: number): CommentsSeen {
  const add: [string, ThreadSeen][] = [];
  for (const id of ids) {
    const cur = Object.hasOwn(s, id) ? s[id] : undefined;
    add.push([id, { round: cur?.round ?? round, taken: cur?.taken ?? null }]);
  }
  return withEntries(s, add);
}

/** The ids an applied proposal of version `version` took up: `taken` becomes `version` (each apply makes a newer one); the round stays, null for an id without an entry. */
export function markTaken(s: CommentsSeen, ids: readonly string[], version: number): CommentsSeen {
  const add: [string, ThreadSeen][] = [];
  for (const id of ids) {
    const cur = Object.hasOwn(s, id) ? s[id] : undefined;
    add.push([id, { round: cur?.round ?? null, taken: version }]);
  }
  return withEntries(s, add);
}

/** The ids no critic got: no entry, or `round: null`. */
export function unseenOf(s: CommentsSeen, ids: readonly string[]): string[] {
  return ids.filter(id => !Object.hasOwn(s, id) || s[id].round === null);
}
