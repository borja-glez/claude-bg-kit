// Subagents lens heard finish (SubagentStop after a SubagentStart), kept in module memory only: never written to a
// file. At most 5, each for 5 minutes.
export interface FinishedAgent { id: string; type: string; description?: string; model?: string; seconds: number; at: number }
export const FINISHED_MAX = 5;
export const FINISHED_TTL_MS = 5 * 60_000;

/** The entry added last, an older one with the same id dropped, at most FINISHED_MAX (the newest kept). */
export function pushFinished(list: FinishedAgent[], entry: FinishedAgent): FinishedAgent[] {
  return [...list.filter(x => x.id !== entry.id), entry].slice(-FINISHED_MAX);
}

/** Entries finished within FINISHED_TTL_MS of now (none from the future). */
export function freshFinished(list: FinishedAgent[], now: number): FinishedAgent[] {
  return list.filter(x => Number.isFinite(now) && x.at <= now && now - x.at < FINISHED_TTL_MS);
}
