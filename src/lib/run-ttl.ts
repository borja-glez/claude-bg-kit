// C2: an inactive execution that was not closed is drawn at most this long after its last movement. Its own module,
// without imports, so the roadmap page can read it without bundling execution-state (and through it zod and yaml);
// execution-view re-exports it for the band and lens.
export const STALE_RUN_TTL_MS = 24 * 3600_000;

/** Carry 7: the one rule with it, the one execution-view applies: still drawn while less than STALE_RUN_TTL_MS passed
 *  since `at` (a valid time in ms); gone at the TTL itself. The page's stalled run and its ∞ pill and entry use it. */
export const withinRunTtl = (now: number, at: number): boolean => Number.isFinite(at) && now - at < STALE_RUN_TTL_MS;
