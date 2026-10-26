// FX2: what an infinite run (or an autonomous profile) has spent, for its --max-usd cap. forge counts what the transcripts of
// the run's sessions record, as forge diagnose reads them (readTranscript): each assistant message once, priced with
// src/lib/prices.ts by its model, its cache writes split into 5-minute and 1-hour ones. That is a measure, not the bill:
// Claude Code's side calls (the auto mode classifier, titles) are not in the transcripts, so the bill runs higher: measured
// on 2026-10-26, A10's current pass counted 6.79 USD against the 7.14 Claude Code recorded, the nested one 6.41 against
// 6.98, and lens's own pricing of six sessions came to 90-99 % of theirs. Where a part cannot be counted, the cost says so
// (`partial`, or `usd: null`) and is never made up.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { readEvents } from './ledger.js';
import { transcriptsOf } from './diagnose-sources.js';
import { readTranscript } from './diagnose-transcript.js';
import { sessionsFile } from './autonomous.js';
import type { ScanOpts } from './transcript-file.js';
import { stepCost } from '../lib/prices.js';
import { isSafeId } from '../lib/execution-state.js';
import type { RunCost, RunState } from '../lib/forge-run.js';

/** At most this many subagent transcripts are read per session; past it the cost is partial. */
const SUBAGENT_FILES_MAX = 5000;

/** `unread`: part of the file was not read (a line past forge's line limit, or the file past its size limit). */
export interface TranscriptCost { usd: number; messages: number; unpriced: number; unread: boolean }

/**
 * The cost of one transcript from `since` (ms): its messages as forge diagnose reads them (readTranscript: each message.id
 * once, by its last line, which every block of a message repeats), at the time of that line. A message of a model without a
 * price that used tokens counts in `unpriced`. Null when the file cannot be read.
 */
export function transcriptCost(file: string, since: number, opts: ScanOpts = {}): TranscriptCost | null {
  const facts = readTranscript(file, opts);
  if (!facts) return null;
  let usd = 0, unpriced = 0, messages = 0;
  for (const m of facts.messages) {
    const ts = Date.parse(m.ts);
    if (!Number.isFinite(ts) || ts < since) continue;
    messages++;
    const t = m.tokens;
    const c = stepCost(m.model ?? '', { input: t.input, output: t.output, cacheRead: t.cacheRead, cacheWrite: t.cacheWrite, cacheWrite5m: m.cacheWrite5m ?? 0 });
    if (c !== null) usd += c;
    else if (t.input + t.output + t.cacheRead + t.cacheWrite > 0) unpriced++;
  }
  return { usd, messages, unpriced, unread: facts.stats.truncated || facts.stats.longCount > 0 };
}

/** Every .jsonl under `dir`, at any depth, up to `max` (sorted, so the same ones each time); `more` when there were others. */
function jsonlUnder(dir: string, max: number): { files: string[]; more: boolean } {
  const files: string[] = [];
  let more = false;
  const walk = (d: string) => {
    let names: { name: string; isDirectory(): boolean; isFile(): boolean }[];
    try { names = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of names.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      if (files.length >= max) { more = true; return; }
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith('.jsonl')) files.push(p);
    }
  };
  walk(dir);
  return { files, more };
}

/** The session ids an autonomous run recorded at its start (.forge/autonomous/<runId>/sessions.json); none without one. */
function recordedSessions(main: string, runId: string): unknown[] {
  try {
    const o: unknown = JSON.parse(readFileSync(sessionsFile(main, runId), 'utf8'));
    const ids = o && typeof o === 'object' ? (o as { ids?: unknown }).ids : undefined;
    return Array.isArray(ids) ? ids : [];
  } catch { return []; }
}

/**
 * The sessions whose transcripts make the run's cost: its own (`run.sessionId`), an autonomous run's recorded ones, and,
 * m7, every session that logged an event of one of the run's executions since the start (in the run's ledger or the main
 * checkout's): an execution is the run's when the run's session logged in it. Another forge session in the same checkout,
 * outside them, is not the run's.
 */
export function runSessions(o: { main: string; runRoot: string; run: RunState }): string[] {
  const since = Date.parse(o.run.startedAt);
  const sessions: string[] = [];
  const add = (s: unknown) => { if (isSafeId(s) && !sessions.includes(s)) sessions.push(s); };
  add(o.run.sessionId);
  if (o.run.autonomous) for (const s of recordedSessions(o.main, o.run.autonomous.runId)) add(s);
  const events = [...new Set([o.runRoot, o.main])].flatMap(root => readEvents(root)).filter(e => Date.parse(e.ts) >= since);
  const runs = new Set(events.filter(e => sessions.includes(String(e.session)) && isSafeId(e.runId)).map(e => e.runId));
  for (const e of events) if (runs.has(e.runId)) add(e.session);
  return sessions;
}

/**
 * The run's cost from its start: the transcripts of its sessions (runSessions), each with its subagents at any depth
 * (`<session>/subagents/`). Partial when one of those sessions has no transcript under `configDir`, a message's model has
 * no price, or part of a transcript was not read (a line or a file past forge's read limits); `usd: null` when no
 * transcript of them was found.
 */
export function runCost(o: { main: string; runRoot: string; run: RunState; configDir: string; now: Date }): RunCost {
  const since = Date.parse(o.run.startedAt);
  const { found, missing } = transcriptsOf(runSessions(o), o.configDir, o.main);
  let usd = 0;
  let partial = missing.length > 0;
  for (const file of found) {
    const sub = jsonlUnder(path.join(path.dirname(file), path.basename(file, '.jsonl'), 'subagents'), SUBAGENT_FILES_MAX);
    if (sub.more) partial = true;
    for (const f of [file, ...sub.files]) {
      const c = transcriptCost(f, since);
      if (!c) { partial = true; continue; }
      usd += c.usd;
      if (c.unpriced || c.unread) partial = true;
    }
  }
  const at = o.now.toISOString();
  return found.length ? { usd: Math.round(usd * 1e6) / 1e6, partial, at } : { usd: null, partial: true, at };
}

/** m10: the line `infinite start` prints once with a cap: what the cap is checked against, and when. */
export const capNote = (usd: number): string =>
  `--max-usd ${usd} is checked after each cycle against what the run's transcripts record, a lower bound of the bill (Claude Code's side calls are not in them: on the runs measured the bill came 1 to 11 % higher), and the cycle that reaches it ends past it`;

/** The line a cycle and `infinite status` print when the cap cannot rely on the cost; null when it can (or no cap). */
export function costNote(run: RunState): string | null {
  if (run.budget.usd === undefined || !run.cost) return null;
  if (run.cost.usd === null) {
    return `cost unknown: no transcript of the run's sessions was found under the Claude configuration's projects folder, so --max-usd ${run.budget.usd} cannot stop the run; its cycles or hours still do`;
  }
  if (run.cost.partial) {
    return `cost partial: at least ${run.cost.usd.toFixed(2)} USD counted (a session without a transcript, a model without a price, or a transcript past forge's read limit); --max-usd ${run.budget.usd} stops the run on what is counted`;
  }
  return null;
}
