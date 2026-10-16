// C3: the role of the session that looks at a checkout's roadmap and its forge execution: owner, other-live, previous
// or none. Pure, without Node imports: waypoint's hooks, the band (wave 2b), forge's live hook and lens (wave 3) share it.
import type { BoundDoc } from './bound.js';

/** A binding lives this long after its last renewal (seenAt). */
export const BOUND_LEASE_MS = 5 * 60_000;
/** An ended or lapsed binding is offered to a later conversation («left in progress») for this long. */
export const PREVIOUS_OFFER_MS = 24 * 3600_000;
export type ViewerRole = 'owner' | 'other-live' | 'previous' | 'none';

/** A binding is live while it has not ended and was renewed less than BOUND_LEASE_MS ago. */
export function bindingLive(b: BoundDoc, now: number): boolean {
  const seen = Date.parse(b.seenAt);
  return b.endedAt === null && Number.isFinite(seen) && now < seen + BOUND_LEASE_MS;
}
