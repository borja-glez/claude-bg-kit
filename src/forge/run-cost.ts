// FX2: what an infinite run (or an autonomous profile) has spent, for its --max-usd cap. forge counts what the transcripts of
// the run's sessions record, the way forge diagnose reads them (transcript-file.ts): each assistant message once, priced
// with src/lib/prices.ts by its model, its cache writes split into 5-minute and 1-hour ones. That is a measure, not the bill:
// Claude Code's side calls (the auto mode classifier, titles) are not in the transcripts, so the bill runs higher: measured
// on 2026-10-26, A10's current pass counted 6.79 USD against the 7.14 Claude Code recorded, the nested one 6.41 against
// 6.98, and lens's own pricing of six sessions came to 90-99 % of theirs. Where a part cannot be counted, the cost says so
// (`partial`, or `usd: null`) and is never made up.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { readEvents } from './ledger.js';
import { transcriptsOf } from './diagnose-sources.js';
import { scanLines } from './transcript-file.js';
import { stepCost, type Tokens } from '../lib/prices.js';
import { isSafeId } from '../lib/execution-state.js';
import type { RunCost, RunState } from '../lib/forge-run.js';

/** At most this many subagent transcripts are read per session; past it the cost is partial. */
const SUBAGENT_FILES_MAX = 5000;

export interface TranscriptCost { usd: number; messages: number; unpriced: number; truncated: boolean }

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => !!x && typeof x === 'object' && !Array.isArray(x);
const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : 0);

function tokensOf(u: Rec): Tokens {
  const created = isRec(u.cache_creation) ? u.cache_creation : {};
  return {
    input: num(u.input_tokens), output: num(u.output_tokens), cacheRead: num(u.cache_read_input_tokens),
    cacheWrite: num(u.cache_creation_input_tokens), cacheWrite5m: num(created.ephemeral_5m_input_tokens),
  };
}

/**
 * The cost of one transcript from `since` (ms): each message.id once, by its last line (every block of a message repeats
 * its usage), at its own timestamp. A message of a model without a price that used tokens counts in `unpriced`. Null when
 * the file cannot be read.
 */
export function transcriptCost(file: string, since: number): TranscriptCost | null {
  const byId = new Map<string, { model: string; tokens: Tokens }>();
  const stats = scanLines(file, (text, n) => {
    if (!text.includes('"usage"')) return;
    let rec: unknown;
    try { rec = JSON.parse(text); } catch { return; }
    if (!isRec(rec) || rec.type !== 'assistant' || !isRec(rec.message) || !isRec(rec.message.usage)) return;
    const ts = typeof rec.timestamp === 'string' ? Date.parse(rec.timestamp) : NaN;
    if (!Number.isFinite(ts) || ts < since) return;
    const m = rec.message;
    const id = typeof m.id === 'string' && m.id ? m.id : `line:${n}`;
    byId.set(id, { model: typeof m.model === 'string' ? m.model : '', tokens: tokensOf(m.usage as Rec) });
  });
  if (!stats) return null;
  let usd = 0, unpriced = 0;
  for (const { model, tokens } of byId.values()) {
    const c = stepCost(model, tokens);
    if (c !== null) usd += c;
    else if (tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite > 0) unpriced++;
  }
  return { usd, messages: byId.size, unpriced, truncated: stats.truncated };
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

/**
 * The run's cost from its start: the transcripts of its session (`run.sessionId`) and of every session that logged a forge
 * event since then in the run's ledger or the main checkout's (the members of its executions, and its coordinator), each
 * with its subagents at any depth (`<session>/subagents/`). Partial when one of those sessions has no transcript under
 * `configDir`, a message's model has no price, or a transcript is past forge's read limit; `usd: null` when no transcript
 * of them was found.
 */
export function runCost(o: { main: string; runRoot: string; run: RunState; configDir: string; now: Date }): RunCost {
  const since = Date.parse(o.run.startedAt);
  const sessions: string[] = [];
  const add = (s: unknown) => { if (isSafeId(s) && !sessions.includes(s)) sessions.push(s); };
  add(o.run.sessionId);
  for (const root of new Set([o.runRoot, o.main])) {
    for (const e of readEvents(root)) if (Date.parse(e.ts) >= since) add(e.session);
  }
  const { found, missing } = transcriptsOf(sessions, o.configDir, o.main);
  let usd = 0;
  let partial = missing.length > 0;
  for (const file of found) {
    const sub = jsonlUnder(path.join(path.dirname(file), path.basename(file, '.jsonl'), 'subagents'), SUBAGENT_FILES_MAX);
    if (sub.more) partial = true;
    for (const f of [file, ...sub.files]) {
      const c = transcriptCost(f, since);
      if (!c) { partial = true; continue; }
      usd += c.usd;
      if (c.unpriced || c.truncated) partial = true;
    }
  }
  const at = o.now.toISOString();
  return found.length ? { usd: Math.round(usd * 1e6) / 1e6, partial, at } : { usd: null, partial: true, at };
}

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
