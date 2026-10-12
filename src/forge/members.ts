import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { forgeDir } from './ledger.js';
import { isPlanId } from '../lib/plan.js';
import { isSafeId } from '../lib/execution-state.js';

export type MemberRole = 'executor' | 'manual';
/**
 * A member of an execution. `sessionId` is its waypoint SID (the roadmap id the skills pass with --session, which names
 * the member file and its live signal); `hookSession` is Claude's own session id, the `session_id` its hooks receive.
 * The two differ: the SID comes from a track name, the hook id is Claude's UUID.
 */
export interface MemberDoc { sessionId: string; role: MemberRole; runId: string; task: string | null; name: string | null; since: string; hookSession: string | null }
/** What writeMember takes: a member written without a hook id has none. */
export type MemberInput = Omit<MemberDoc, 'hookSession'> & { hookSession?: string | null };
/** The one rule for a member's session id: it names a file, so no `:` (an NTFS stream), `/` or `..` (shared with execution.json). */
export const isMemberId = (s: string): boolean => isSafeId(s);
export const memberFile = (main: string, sessionId: string) => path.join(main, '.forge', 'members', `${sessionId}.json`);

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

export function readMember(main: string, sessionId: string): MemberDoc | null {
  if (!isMemberId(sessionId)) return null;
  try {
    const m = normalizeMember(JSON.parse(readFileSync(memberFile(main, sessionId), 'utf8')));
    return m && m.sessionId === sessionId ? m : null;
  } catch { return null; }
}

export function writeMember(main: string, input: MemberInput): void {
  const m: MemberDoc = { ...input, hookSession: input.hookSession ?? null };
  if (!isMemberId(m.sessionId)) throw new Error(`invalid member session id: ${JSON.stringify(m.sessionId.slice(0, 130))}`);
  if (m.hookSession !== null && !isMemberId(m.hookSession)) throw new Error(`invalid member hook session id: ${JSON.stringify(m.hookSession.slice(0, 130))}`);
  forgeDir(main);
  const file = memberFile(main, m.sessionId);
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try { writeFileSync(tmp, JSON.stringify(m, null, 2) + '\n'); renameSync(tmp, file); } finally { rmSync(tmp, { force: true }); }
}

export function listMembers(main: string, runId: string): MemberDoc[] {
  let names: string[] = [];
  try { names = readdirSync(path.join(main, '.forge', 'members')).filter(f => f.endsWith('.json')); } catch { return []; }
  return names.slice(0, 200).map(f => readMember(main, f.slice(0, -5))).filter((m): m is MemberDoc => !!m && m.runId === runId).slice(0, 50);
}

/** The member of `runId` whose recorded hook id is `hookSessionId`; null when none. */
export function findMemberByHook(main: string, hookSessionId: string, runId: string): MemberDoc | null {
  if (!isMemberId(hookSessionId)) return null;
  return listMembers(main, runId).find(m => m.hookSession === hookSessionId && m.runId === runId) ?? null;
}

/**
 * The member of `runId` a hook call comes from: by its recorded hook id, else by a direct lookup for a member whose
 * waypoint SID equals the hook id and that recorded no other hook id (a session that joined with the same id for both).
 */
export function memberForHook(main: string, hookSessionId: string, runId: string): MemberDoc | null {
  const byHook = findMemberByHook(main, hookSessionId, runId);
  if (byHook) return byHook;
  const direct = readMember(main, hookSessionId);
  return direct && direct.runId === runId && (direct.hookSession === null || direct.hookSession === hookSessionId) ? direct : null;
}
