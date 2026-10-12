import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { forgeDir } from './ledger.js';
import { isPlanId } from '../lib/plan.js';

export type MemberRole = 'executor' | 'manual';
export interface MemberDoc { sessionId: string; role: MemberRole; runId: string; task: string | null; name: string | null; since: string }
const SID = /^[A-Za-z0-9_\-.]{1,120}$/;
export const memberFile = (main: string, sessionId: string) => path.join(main, '.forge', 'members', `${sessionId}.json`);

export function normalizeMember(x: unknown): MemberDoc | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const sessionId = typeof o.sessionId === 'string' && SID.test(o.sessionId) ? o.sessionId : null;
  const role = o.role === 'executor' || o.role === 'manual' ? o.role : null;
  const runId = typeof o.runId === 'string' && o.runId ? o.runId.slice(0, 120) : null;
  const since = typeof o.since === 'string' && !Number.isNaN(Date.parse(o.since)) ? o.since : null;
  if (!sessionId || !role || !runId || !since) return null;
  const task = typeof o.task === 'string' && isPlanId(o.task) ? o.task : null;
  const name = typeof o.name === 'string' && o.name ? o.name.slice(0, 80) : null;
  return { sessionId, role, runId, task, name, since };
}

export function readMember(main: string, sessionId: string): MemberDoc | null {
  if (!SID.test(sessionId)) return null;
  try { return normalizeMember(JSON.parse(readFileSync(memberFile(main, sessionId), 'utf8'))); } catch { return null; }
}

export function writeMember(main: string, m: MemberDoc): void {
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
