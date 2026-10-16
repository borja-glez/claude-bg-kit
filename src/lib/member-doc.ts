// A member of a forge execution (.forge/members/<sid>.json), read by forge, by waypoint's hooks and by describeViewer.
// Pure, without Node imports: src/forge/members.ts re-exports it and keeps the file I/O.
import { isPlanId } from './ids.js';
import { isSafeId } from './execution-state.js';

export type MemberRole = 'executor' | 'manual';
/**
 * A member of an execution. `sessionId` is its waypoint SID (the roadmap id the skills pass with --session, which names
 * the member file and its live signal); `hookSession` is Claude's own session id, the `session_id` its hooks receive.
 * The two differ: the SID comes from a track name, the hook id is Claude's UUID.
 */
export interface MemberDoc { sessionId: string; role: MemberRole; runId: string; task: string | null; name: string | null; since: string; hookSession: string | null }
/** The one rule for a member's session id: it names a file, so no `:` (an NTFS stream), `/` or `..` (shared with execution.json). */
export const isMemberId = (s: string): boolean => isSafeId(s);

export function normalizeMember(x: unknown): MemberDoc | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const sessionId = typeof o.sessionId === 'string' && isMemberId(o.sessionId) ? o.sessionId : null;
  const role = o.role === 'executor' || o.role === 'manual' ? o.role : null;
  const runId = typeof o.runId === 'string' && o.runId ? o.runId.slice(0, 120) : null;
  const since = typeof o.since === 'string' && !Number.isNaN(Date.parse(o.since)) ? o.since : null;
  if (!sessionId || !role || !runId || !since) return null;
  const task = typeof o.task === 'string' && isPlanId(o.task) ? o.task : null;
  const name = typeof o.name === 'string' && o.name ? o.name.slice(0, 80) : null;
  const hookSession = typeof o.hookSession === 'string' && isMemberId(o.hookSession) ? o.hookSession : null;
  return { sessionId, role, runId, task, name, since, hookSession };
}
