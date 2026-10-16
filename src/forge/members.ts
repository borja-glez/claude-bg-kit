import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { forgeDir } from './ledger.js';
// MemberDoc and its normalizer are pure and live in src/lib (waypoint's hooks and describeViewer read them too).
import { isMemberId, normalizeMember, type MemberDoc } from '../lib/member-doc.js';
export { isMemberId, normalizeMember };
export type { MemberDoc, MemberRole } from '../lib/member-doc.js';
import { memberOfHook } from '../lib/forge-activity.js';

/** What writeMember takes: a member written without a hook id has none. */
export type MemberInput = Omit<MemberDoc, 'hookSession'> & { hookSession?: string | null };
export const memberFile = (main: string, sessionId: string) => path.join(main, '.forge', 'members', `${sessionId}.json`);

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
 * The rule is memberOfHook (src/lib/forge-activity.ts), shared with waypoint's Stop hook.
 */
export function memberForHook(main: string, hookSessionId: string, runId: string): MemberDoc | null {
  if (!isMemberId(hookSessionId)) return null;
  const direct = readMember(main, hookSessionId);
  return memberOfHook([...listMembers(main, runId), ...(direct ? [direct] : [])], hookSessionId, runId);
}
