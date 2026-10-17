import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { forgeDir } from './ledger.js';
// MemberDoc and its normalizer are pure and live in src/lib (waypoint's hooks and describeViewer read them too).
import { isMemberId, newestMemberFiles, normalizeMember, type MemberDoc } from '../lib/member-doc.js';
import { FORGE_DOC_MAX_BYTES } from '../lib/execution-state.js';
export { isMemberId, normalizeMember };
export type { MemberDoc, MemberRole } from '../lib/member-doc.js';
import { memberOfHook } from '../lib/forge-activity.js';

/** What writeMember takes: a member written without a hook id has none. */
export type MemberInput = Omit<MemberDoc, 'hookSession'> & { hookSession?: string | null };
export const memberFile = (main: string, sessionId: string) => path.join(main, '.forge', 'members', `${sessionId}.json`);
const membersDir = (main: string) => path.join(main, '.forge', 'members');

/** A member file larger than FORGE_DOC_MAX_BYTES is no member, for forge as for the band and waypoint's hooks. */
export function readMember(main: string, sessionId: string): MemberDoc | null {
  if (!isMemberId(sessionId)) return null;
  try {
    const file = memberFile(main, sessionId);
    if (statSync(file).size > FORGE_DOC_MAX_BYTES) return null;
    const m = normalizeMember(JSON.parse(readFileSync(file, 'utf8')));
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

/** At most this many member files are read by a cleanup (allMembersOf). */
const CLEANUP_MEMBERS_MAX = 500;
type MemberFileStat = { name: string; size: number; mtimeMs: number };

/** The `.json` files of `.forge/members/` with a safe name, with their size and mtime, the newest first (then by name). */
function memberFiles(main: string): MemberFileStat[] {
  const dir = membersDir(main);
  let files: MemberFileStat[] = [];
  try {
    files = readdirSync(dir, { withFileTypes: true }).filter(d => d.isFile() && d.name.endsWith('.json') && isMemberId(d.name.slice(0, -5))).flatMap(d => {
      try { const st = statSync(path.join(dir, d.name)); return [{ name: d.name, size: st.size, mtimeMs: st.mtimeMs }]; } catch { return []; }
    });
  } catch { return []; }
  return files.sort((a, b) => b.mtimeMs - a.mtimeMs || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
const readEach = (main: string, files: readonly MemberFileStat[]): MemberDoc[] =>
  files.flatMap(f => { const m = readMember(main, f.name.slice(0, -5)); return m ? [m] : []; });

/**
 * The members of `runId` as the role readers see them, by the rule of the band and waypoint's hooks (newestMemberFiles):
 * of the `.json` files with a safe name and at most FORGE_DOC_MAX_BYTES, the MEMBERS_MAX newest. So forge's hooks and
 * theirs give a session the same role (describeViewer, forgeRoleOf). A cleanup reads allMembersOf instead.
 */
export function listMembers(main: string, runId: string): MemberDoc[] {
  return readEach(main, newestMemberFiles(memberFiles(main))).filter(m => m.runId === runId);
}

/**
 * Every member of `runId` a cleanup must reach (forge stop and swarm close: the files they remove, the sessions they list
 * to message, the hook ids whose jobs they name), not only those the role readers see: of the `.json` files with a safe
 * name, the CLEANUP_MEMBERS_MAX newest, each read by readMember.
 */
export function allMembersOf(main: string, runId: string): MemberDoc[] {
  return readEach(main, memberFiles(main).slice(0, CLEANUP_MEMBERS_MAX)).filter(m => m.runId === runId);
}

/** The member of `runId` whose recorded hook id is `hookSessionId`; null when none. */
export function findMemberByHook(main: string, hookSessionId: string, runId: string): MemberDoc | null {
  if (!isMemberId(hookSessionId)) return null;
  return listMembers(main, runId).find(m => m.hookSession === hookSessionId && m.runId === runId) ?? null;
}

/**
 * The member of `runId` a hook call comes from: by its recorded hook id, else the member whose waypoint SID equals the
 * hook id and that recorded no other hook id (a session that joined with the same id for both). The rule is memberOfHook
 * (src/lib/forge-activity.ts), over the same files the band and waypoint's hooks read (listMembers): no other file is
 * looked up, so forge's hooks and theirs agree on who is a member.
 */
export function memberForHook(main: string, hookSessionId: string, runId: string): MemberDoc | null {
  if (!isMemberId(hookSessionId)) return null;
  return memberOfHook(listMembers(main, runId), hookSessionId, runId);
}
