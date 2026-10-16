// What forge is doing in a checkout, for readers that must not import src/forge/** (waypoint's CLI and hooks; the band
// and lens may use it too): the active execution, its members and the infinite run, from the texts of
// .forge/execution.json, .forge/members/*.json and .forge/run.json. Pure, without Node imports, like main-checkout.ts.
import { isSafeId, parseExecution, type ExecutionState } from './execution-state.js';
import { parseRun, type RunState } from './forge-run.js';

/** The fields of a member file a hook needs (src/forge/members.ts keeps the whole document). */
export interface ActivityMember { sessionId: string; runId: string; hookSession: string | null }
export interface ForgeActivity { execution: ExecutionState | null; members: ActivityMember[]; infinite: RunState | null }
export type ForgeRole = 'coordinator' | 'member' | 'infinite';
/** At most this many member files are read (as listMembers does). */
export const MAX_MEMBER_FILES = 200;

export function activityMember(x: unknown): ActivityMember | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  if (!isSafeId(o.sessionId) || typeof o.runId !== 'string' || !o.runId) return null;
  return { sessionId: o.sessionId, runId: o.runId.slice(0, 120), hookSession: isSafeId(o.hookSession) ? o.hookSession : null };
}

/** The activity from the files' texts (null: missing); anything that does not parse counts as absent. */
export function forgeActivityFrom(texts: { execution: string | null; members: readonly (string | null)[]; run: string | null }, now?: number): ForgeActivity {
  const members: ActivityMember[] = [];
  for (const t of texts.members.slice(0, MAX_MEMBER_FILES)) {
    if (t === null) continue;
    try { const m = activityMember(JSON.parse(t)); if (m) members.push(m); } catch { /* a broken file is no member */ }
  }
  return { execution: parseExecution(texts.execution, now), members, infinite: parseRun(texts.run) };
}

/**
 * The member of `runId` a hook call with Claude's `sessionId` comes from: the one that recorded it as its hook id, else
 * the one whose waypoint SID is that id and that recorded no other hook id (a session that joined with one id for
 * both). The one rule: src/forge/members.ts memberForHook uses it too.
 */
export function memberOfHook<M extends ActivityMember>(members: readonly M[], sessionId: string, runId: string): M | null {
  const byHook = members.find(m => m.runId === runId && m.hookSession === sessionId);
  if (byHook) return byHook;
  const direct = members.find(m => m.sessionId === sessionId);
  return direct && direct.runId === runId && (direct.hookSession === null || direct.hookSession === sessionId) ? direct : null;
}

/** What the session with Claude's id `sessionId` is to forge: the coordinator or a member of the active execution, the
 *  session of the active infinite run, or nothing. */
export function forgeRoleOf(a: ForgeActivity, sessionId: string | null): ForgeRole | null {
  if (!isSafeId(sessionId)) return null;
  const e = a.execution;
  if (e?.active && e.hookSession === sessionId) return 'coordinator';
  if (e?.active && memberOfHook(a.members, sessionId, e.runId)) return 'member';
  if (a.infinite?.active && a.infinite.sessionId === sessionId) return 'infinite';
  return null;
}
