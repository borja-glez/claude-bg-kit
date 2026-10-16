// C3: the binding of a waypoint seat to the Claude conversation that works it: .waypoint/<p>/bound.json for the
// checkout's seat, .waypoint/<p>/seats/<sid>/bound.json for an extra one (main-2…). Pure and without Node imports:
// waypoint's hooks and CLI read it through src/lib/bound-fs.ts, and the band (wave 2b) through $.fs.
import { FUTURE_SKEW_MS, isSafeId } from './execution-state.js';

export const BOUND_VIAS = ['work', 'design', 'forge-run', 'forge-member', 'forge-infinite'] as const;
export type BoundVia = (typeof BOUND_VIAS)[number];
export const BOUND_END_REASONS = ['clear', 'resume', 'logout', 'prompt_input_exit', 'other', 'released'] as const;
export type BoundEndReason = (typeof BOUND_END_REASONS)[number];
export interface BoundDoc {
  sid: string; claude: string; pid: number | null; via: BoundVia;
  since: string; seenAt: string; endedAt: string | null; endReason: BoundEndReason | null;
}
/** At most this many extra seats (seats/<sid>/) are read per project. */
export const MAX_SEATS = 10;
/** A bound.json larger than this is not read. */
export const BOUND_MAX_BYTES = 4096;

export const isBoundVia = (x: unknown): x is BoundVia => (BOUND_VIAS as readonly unknown[]).includes(x);
const isEndReason = (x: unknown): x is BoundEndReason => (BOUND_END_REASONS as readonly unknown[]).includes(x);
/** SessionEnd's reason as a binding keeps it: a value the engine adds later (or `released`, which is not one) is `other`. */
export const endReasonOf = (x: unknown): BoundEndReason => (isEndReason(x) && x !== 'released' ? x : 'other');

/** An ISO date not more than FUTURE_SKEW_MS ahead of `now` (when given): clock skew or corruption is not a date. */
function date(x: unknown, now?: number): string | null {
  if (typeof x !== 'string') return null;
  const t = Date.parse(x);
  if (!Number.isFinite(t)) return null;
  return now !== undefined && Number.isFinite(now) && t - now > FUTURE_SKEW_MS ? null : x;
}

/**
 * Strict: `sid` and `claude` pass isSafeId, the dates are ISO and none is more than 2 minutes ahead of `now`, `via`
 * and `endReason` are known; anything else is no binding. A pid that is not a positive integer is none, and a reason
 * without an end is dropped.
 */
export function normalizeBound(x: unknown, now?: number): BoundDoc | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  if (!isSafeId(o.sid) || !isSafeId(o.claude) || !isBoundVia(o.via)) return null;
  const since = date(o.since, now);
  const seenAt = date(o.seenAt, now);
  if (!since || !seenAt) return null;
  const ended = o.endedAt === null || o.endedAt === undefined;
  const endedAt = ended ? null : date(o.endedAt, now);
  if (!ended && endedAt === null) return null;
  let endReason: BoundEndReason | null = null;
  if (o.endReason !== null && o.endReason !== undefined) {
    if (!isEndReason(o.endReason)) return null;
    endReason = o.endReason;
  }
  const pid = typeof o.pid === 'number' && Number.isInteger(o.pid) && o.pid > 0 ? o.pid : null;
  return { sid: o.sid, claude: o.claude, pid, via: o.via, since, seenAt, endedAt, endReason: endedAt ? endReason : null };
}

/** bound.json's text (null: missing); broken JSON or more than BOUND_MAX_BYTES is no binding. */
export function parseBound(text: string | null | undefined, now?: number): BoundDoc | null {
  if (typeof text !== 'string' || !text || text.length > BOUND_MAX_BYTES) return null;
  try { return normalizeBound(JSON.parse(text), now); } catch { return null; }
}
