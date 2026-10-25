import { closeSync, fstatSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import path from 'node:path';
import type { CheckResult, DoctorCheck, DoctorCtx } from './doctor.js';
import { FORGE_DOC_MAX_BYTES, isSafeId, LIVE_MAX_AGE_HOURS, normalizeLive } from '../lib/execution-state.js';
import { redactSecrets } from './autonomous.js';

/** A4 (ecc 2.5): a live subagent older than this, whose last tool call has no result yet, is reported as data. */
export const WAITING_MINUTES = 10;
/** Only this many trailing bytes of a transcript are read, never the whole file. */
export const TRANSCRIPT_TAIL = 2 * 1024 * 1024;
const MAX_LIVE_FILES = 50;
const HEAD_CHARS = 80;

export interface PendingCall { tool: string; waitedSec: number; head: string }

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** The transcript of a subagent: <configDir>/projects/<any project>/<sessionId>/subagents/agent-<agentId>.jsonl, the first that exists, built only from ids that pass isSafeId. Null otherwise. */
export function agentTranscript(configDir: string, sessionId: string, agentId: string): string | null {
  if (!isSafeId(sessionId) || !isSafeId(agentId)) return null;
  const projects = path.join(configDir, 'projects');
  let names: string[];
  try { names = readdirSync(projects).sort(); } catch { return null; }
  for (const name of names) {
    const file = path.join(projects, name, sessionId, 'subagents', `agent-${agentId}.jsonl`);
    try { if (statSync(file).isFile()) return file; } catch { /* not in this project */ }
  }
  return null;
}

/**
 * The last tool_use of a transcript tail with no tool_result yet: its tool, the seconds since its line's timestamp and its command, redacted and cut to 80 chars.
 * Null when there is none or it has its result; 'unreadable' when the tail has lines and none parses as JSON.
 */
export function pendingCall(tailText: string, now: number): PendingCall | null | 'unreadable' {
  let parsed = 0, seen = 0;
  let last: { id: string; name: string; input: unknown; timestamp: unknown } | null = null;
  const answered = new Set<string>();
  for (const raw of tailText.split('\n')) {
    const text = raw.trim();
    if (!text) continue;
    seen++;
    let line: unknown;
    try { line = JSON.parse(text); } catch { continue; } // the first line may be cut by the tail
    if (!isObject(line)) continue;
    parsed++;
    const content = isObject(line.message) && Array.isArray(line.message.content) ? line.message.content : [];
    for (const block of content) {
      if (!isObject(block)) continue;
      if (block.type === 'tool_use' && typeof block.id === 'string') {
        last = { id: block.id, name: typeof block.name === 'string' ? block.name : '', input: block.input, timestamp: line.timestamp };
      } else if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') answered.add(block.tool_use_id);
    }
  }
  if (seen > 0 && parsed === 0) return 'unreadable';
  if (!last || answered.has(last.id)) return null;
  const command = isObject(last.input) && typeof last.input.command === 'string' ? last.input.command : JSON.stringify(last.input) ?? '';
  const at = typeof last.timestamp === 'string' ? Date.parse(last.timestamp) : NaN;
  // Redact before cutting: a cut never leaves half a secret that no pattern recognises.
  return { tool: last.name, waitedSec: Math.round((now - at) / 1000), head: redactSecrets(command).slice(0, HEAD_CHARS) };
}

/** The last TRANSCRIPT_TAIL bytes of a regular file as text; throws when it cannot be opened. */
function readTail(file: string): string {
  // Never a pipe or a device: opening one could wait.
  if (!statSync(file).isFile()) throw new Error('not a file');
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    const len = Math.min(size, TRANSCRIPT_TAIL);
    const buf = Buffer.alloc(len);
    let off = 0;
    while (off < len) {
      const n = readSync(fd, buf, off, len - off, size - len + off);
      if (n <= 0) break;
      off += n;
    }
    return buf.subarray(0, off).toString('utf8');
  } finally { closeSync(fd); }
}

function liveDocs(ctx: DoctorCtx) {
  const dir = path.join(ctx.main, '.forge', 'live');
  let names: string[];
  try { names = readdirSync(dir).filter(n => n.endsWith('.json')).sort().slice(0, MAX_LIVE_FILES); } catch { return []; }
  const now = ctx.now.getTime();
  const out = [];
  for (const name of names) {
    try {
      const file = path.join(dir, name);
      if (statSync(file).size > FORGE_DOC_MAX_BYTES) continue;
      const live = normalizeLive(JSON.parse(readFileSync(file, 'utf8')));
      if (!live || live.ended || now - Date.parse(live.ts) > LIVE_MAX_AGE_HOURS * 3_600_000) continue;
      out.push(live);
    } catch { /* a signal that does not read is not one */ }
  }
  return out;
}

/** A4: a live subagent whose last tool call has waited a while, as data (status ok), never an alarm. */
export const WAITING_CHECK: DoctorCheck = {
  id: 'waiting-calls',
  run(ctx: DoctorCtx): CheckResult {
    const now = ctx.now.getTime();
    const waiting: { agent: string; tool: string; waitedSec: number; head: string }[] = [];
    try {
      for (const live of liveDocs(ctx)) {
        for (const agent of live.agents) {
          // `since` only pre-filters; a call is reported once it has itself waited WAITING_MINUTES.
          if (!(now - Date.parse(agent.since) >= WAITING_MINUTES * 60_000)) continue;
          const file = agentTranscript(ctx.configDir, live.sessionId, agent.id);
          if (!file) continue;
          let call: PendingCall | null | 'unreadable';
          try { call = pendingCall(readTail(file), now); } catch { call = 'unreadable'; }
          if (call === 'unreadable') return { id: 'waiting-calls', status: 'unverified', detail: `a transcript does not read: ${file}` };
          if (call && call.waitedSec >= WAITING_MINUTES * 60) waiting.push({ agent: agent.type, tool: call.tool, waitedSec: call.waitedSec, head: call.head });
        }
      }
    } catch (e) {
      return { id: 'waiting-calls', status: 'unverified', detail: e instanceof Error ? e.message : String(e) };
    }
    return waiting.length
      ? { id: 'waiting-calls', status: 'ok', detail: `${waiting.length} subagent call(s) have been waiting a while (data, not an alarm)`, data: { waiting } }
      : { id: 'waiting-calls', status: 'ok', detail: 'no long-waiting subagent call', data: { waiting: [] } };
  },
};
