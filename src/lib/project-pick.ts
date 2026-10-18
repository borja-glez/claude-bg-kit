// A-19: which project a session works on, from each project's bindings and activity. Pure and without Node imports:
// the mod (src/mod/files.ts) and waypoint's hooks (src/cli/hooks.ts) share it, so the CLI imports nothing of src/mod.
import type { BoundDoc } from './bound.js';

export interface ProjectEntry { name: string; bindings: readonly BoundDoc[]; mtimeMs: number }

/**
 * A-15: the project of this session's binding (the one renewed last when several), else the one with the latest
 * activity: its plan.yaml or design.md, or the last renewal or end of any of its bindings. A session.json alone no
 * longer wins: it is the seat of whoever worked there, not of this session.
 */
export function pickProject(entries: readonly ProjectEntry[], sessionId: string | null): string | null {
  if (!entries.length) return null;
  const time = (s: string | null) => { const t = s ? Date.parse(s) : NaN; return Number.isFinite(t) ? t : -Infinity; };
  const at = (b: BoundDoc) => Math.max(time(b.seenAt), time(b.endedAt));
  const activity = (e: ProjectEntry) => Math.max(e.mtimeMs, ...e.bindings.map(at));
  const ownAt = (e: ProjectEntry) => Math.max(-Infinity, ...e.bindings.filter(b => b.claude === sessionId).map(at));
  const own = sessionId ? entries.filter(e => ownAt(e) > -Infinity) : [];
  const score = (e: ProjectEntry) => (own.length ? [ownAt(e), activity(e)] : [activity(e)]);
  const better = (a: ProjectEntry, b: ProjectEntry) => {
    const sa = score(a), sb = score(b);
    for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sb[i] > sa[i] ? 1 : -1;
    return 0;
  };
  return [...(own.length ? own : entries)].sort(better)[0].name;
}
