// C2: an inactive execution that was not closed is drawn at most this long after its last movement. Its own module,
// without imports, so the roadmap page can read it without bundling execution-state (and through it zod and yaml);
// execution-view re-exports it for the band and lens.
export const STALE_RUN_TTL_MS = 24 * 3600_000;
