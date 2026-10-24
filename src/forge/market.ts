// 6b-3: forge's market research. The forge-market agent replies with a market.json (MarketReport) that the session writes;
// `forge market note` reads it, keeps it in .forge/market/ of the checkout it runs in (the worktree, beside the proposals),
// where `forge market last` finds it for the scout, the critic and the planner, and prints the roadmap's market note.
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { clean } from '../lib/decisions.js';
import { compactTs } from '../lib/ids.js';
import { MAX_NOTE, normalizeSources } from '../lib/notes.js';
import { sha256Hex } from '../lib/sha256.js';
import type { Write } from '../lib/sync.js';
import type { NoteSource } from '../lib/types.js';

export interface MarketReport { summary: string; findings: { text: string; sources: NoteSource[] }[]; noWeb: boolean }

const SUMMARY_MAX = 600;
const FINDING_MAX = 400;
const FINDINGS_MAX = 12;
/** A report's file name: its time, compactTs. */
const REPORT_FILE = /^\d{8}T\d{9}Z\.json$/;
/** A byte order mark at the start of the file is no part of its JSON (built from its code point: no invisible character here). */
const BOM = String.fromCharCode(0xfeff);

/**
 * A market report from the text of a market.json (untrusted: the agent read the web), or null when it is not a JSON object
 * with a summary. Texts are cleaned to one line and cut (the summary to SUMMARY_MAX, each finding to FINDING_MAX); a finding
 * without one source normalizeSources keeps is left out (only what is cited goes in), and FINDINGS_MAX are kept. With
 * `noWeb: true` the findings are ignored.
 */
export function readMarket(text: string): MarketReport | null {
  let raw: unknown;
  try { raw = JSON.parse(text.startsWith(BOM) ? text.slice(1) : text); } catch { return null; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const summary = typeof o.summary === 'string' ? clean(o.summary, SUMMARY_MAX) : '';
  if (!summary) return null;
  if (o.noWeb === true) return { summary, findings: [], noWeb: true };
  const findings: MarketReport['findings'] = [];
  for (const f of Array.isArray(o.findings) ? o.findings : []) {
    if (findings.length >= FINDINGS_MAX) break;
    if (!f || typeof f !== 'object' || Array.isArray(f)) continue;
    const { text: t, sources: s } = f as Record<string, unknown>;
    const line = typeof t === 'string' ? clean(t, FINDING_MAX) : '';
    const sources = normalizeSources(s);
    if (line && sources.length) findings.push({ text: line, sources });
  }
  return { summary, findings, noWeb: false };
}

/**
 * The roadmap write of a report: a `set` of `notes/<compactTs(ts)>-<session>-m<the first 10 hex of the sha256 of the note's
 * text>` (L-3: the same report at the same time is the same note), by `session:<session>`. Its text is the summary, with
 * «Sin acceso a la web: » | «No web access: » before it without web, and one `- <finding>` line per finding, cut to
 * MAX_NOTE; its sources are those of every finding, once each, MAX_SOURCES at most (normalizeSources).
 */
export function marketNote(r: MarketReport, ts: string, session: string, es: boolean): Write {
  const head = r.noWeb ? `${es ? 'Sin acceso a la web: ' : 'No web access: '}${r.summary}` : r.summary;
  const full = [head, ...r.findings.map(f => `- ${f.text}`)].join('\n');
  const text = full.length <= MAX_NOTE ? full : Array.from(full).slice(0, MAX_NOTE).join('');
  const sources = normalizeSources(r.findings.flatMap(f => f.sources));
  return {
    op: 'set', collection: 'notes', doc_id: `${compactTs(new Date(ts))}-${session}-m${sha256Hex(text).slice(0, 10)}`,
    data: { ts, type: 'market', author: `session:${session}`, text, sources },
  };
}

/** Where a checkout keeps its market reports. */
export const marketDir = (root: string): string => path.join(root, '.forge', 'market');

/** Keeps a report as `<compactTs(ts)>.json` in marketDir, written atomically, and returns its path. */
export function saveMarket(root: string, r: MarketReport, ts: string): string {
  const dir = marketDir(root);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${compactTs(new Date(ts))}.json`);
  const tmp = `${file}.${process.pid}.tmp`;
  try { writeFileSync(tmp, JSON.stringify(r, null, 2) + '\n'); renameSync(tmp, file); } finally { rmSync(tmp, { force: true }); }
  return file;
}

/** The newest report of marketDir (its names are times, so the last in order), or null when there is none. */
export function lastMarket(root: string): string | null {
  let names: string[];
  try { names = readdirSync(marketDir(root)); } catch { return null; }
  const last = names.filter(n => REPORT_FILE.test(n)).sort().at(-1);
  return last ? path.join(marketDir(root), last) : null;
}
