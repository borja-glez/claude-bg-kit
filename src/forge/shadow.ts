import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { forgeDir } from './ledger.js';
import { mainCheckout } from './local.js';
import type { Finding } from './verdict.js';

// Shadow test: for N briefs each reviewer running at high gets an xhigh twin; the cases compare their blockers.
// The state lives in .forge/shadow.json of the main checkout, as local.yaml does, so every worktree of the repository
// (a run member's, a task's) sees the test opened there. It is forge work and stays out of git.

export interface ShadowCase {
  task: string;
  reviewer: string;
  xhigh: Finding[];          // blockers (critical + important) the xhigh twin found
  recovered: Finding[];      // xhigh blockers that high also found
  missed: Finding[];         // xhigh blockers that high did not find
  missedCritical: Finding[]; // the critical ones among `missed`
  highOnly: Finding[];       // high blockers with no xhigh pair
}
export interface ShadowState { remaining: number; cases: ShadowCase[] }

export const DEFAULT_SHADOW_BRIEFS = 10;
export const LINE_WINDOW = 10;
export const OVERLAP = 0.3;
export const PASS_RATIO = 0.9;

export const shadowFile = (root: string) => path.join(mainCheckout(root), '.forge', 'shadow.json');

const isFinding = (x: unknown): x is Finding =>
  !!x && typeof x === 'object' && typeof (x as Finding).problem === 'string' && typeof (x as Finding).severity === 'string';
const isFindings = (x: unknown): x is Finding[] => Array.isArray(x) && x.every(isFinding);

function isCase(x: unknown): x is ShadowCase {
  if (!x || typeof x !== 'object') return false;
  const c = x as ShadowCase;
  return typeof c.task === 'string' && typeof c.reviewer === 'string'
    && [c.xhigh, c.recovered, c.missed, c.missedCritical, c.highOnly].every(isFindings);
}

export function parseShadow(text: string | null): ShadowState | null {
  if (text == null) return null;
  try {
    const o = JSON.parse(text) as ShadowState;
    if (!o || typeof o !== 'object' || !Number.isInteger(o.remaining) || o.remaining < 0) return null;
    if (!Array.isArray(o.cases) || !o.cases.every(isCase)) return null;
    return { remaining: o.remaining, cases: o.cases };
  } catch { return null; }
}

/** The shadow test of the project, or null when none was opened (or the file is unreadable). */
export function readShadow(root: string): ShadowState | null {
  const file = shadowFile(root);
  if (!existsSync(file)) return null;
  try { return parseShadow(readFileSync(file, 'utf8')); } catch { return null; }
}

export function saveShadow(root: string, state: ShadowState): void {
  const main = mainCheckout(root);
  forgeDir(main);
  const file = path.join(main, '.forge', 'shadow.json');
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
    renameSync(tmp, file);
  } finally { rmSync(tmp, { force: true }); }
}

/**
 * Opens the shadow test for `briefs` more briefs. The cases already collected stay (starting again only resets the
 * briefs left); `reset` clears them.
 */
export function startShadow(root: string, briefs: number = DEFAULT_SHADOW_BRIEFS, opts: { reset?: boolean } = {}): ShadowState {
  if (!Number.isInteger(briefs) || briefs < 1) throw new Error(`shadow: briefs must be a positive integer, got ${briefs}`);
  const state: ShadowState = { remaining: briefs, cases: opts.reset ? [] : readShadow(root)?.cases ?? [] };
  saveShadow(root, state);
  return state;
}

/** Closes the test early: no more twins, the cases stay for the report. */
export function stopShadow(root: string): ShadowState | null {
  const s = readShadow(root);
  if (!s) return null;
  const state = { ...s, remaining: 0 };
  saveShadow(root, state);
  return state;
}

/** Spends one brief. True when the test was open and this brief gets twins. */
export function takeBrief(root: string): boolean {
  const s = readShadow(root);
  if (!s || s.remaining <= 0) return false;
  saveShadow(root, { ...s, remaining: s.remaining - 1 });
  return true;
}

export function addCase(root: string, c: ShadowCase): void {
  const s = readShadow(root) ?? { remaining: 0, cases: [] };
  saveShadow(root, { ...s, cases: [...s.cases, c] });
}

const words = (s: string): Set<string> => new Set((s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(w => w.length >= 3));

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

const normPath = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '');

function nearby(a: Finding, b: Finding): boolean {
  return !!a.file && !!b.file && normPath(a.file) === normPath(b.file)
    && Number.isFinite(a.line) && Number.isFinite(b.line) && Math.abs(a.line! - b.line!) <= LINE_WINDOW;
}

const overlapping = (a: Finding, b: Finding) => jaccard(words(a.problem), words(b.problem)) >= OVERLAP;

/** Same file within ±10 lines, or problem word overlap (Jaccard) >= 0.3. */
export const findingsMatch = (a: Finding, b: Finding): boolean => nearby(a, b) || overlapping(a, b);

const isBlocker = (f: Finding) => f.severity === 'critical' || f.severity === 'important';

/** Pairs the blockers of a high reviewer with those of its xhigh twin, one to one (location pairs first). */
export function buildCase(task: string, reviewer: string, high: Finding[], xhigh: Finding[]): ShadowCase {
  const hb = high.filter(isBlocker);
  const xb = xhigh.filter(isBlocker);
  const pairOf = new Array<number>(xb.length).fill(-1);
  const used = new Set<number>();
  for (const test of [nearby, overlapping]) {
    xb.forEach((x, i) => {
      if (pairOf[i] >= 0) return;
      const j = hb.findIndex((h, k) => !used.has(k) && test(x, h));
      if (j >= 0) { pairOf[i] = j; used.add(j); }
    });
  }
  const recovered = xb.filter((_, i) => pairOf[i] >= 0);
  const missed = xb.filter((_, i) => pairOf[i] < 0);
  return {
    task, reviewer, xhigh: xb, recovered, missed,
    missedCritical: missed.filter(f => f.severity === 'critical'),
    highOnly: hb.filter((_, k) => !used.has(k)),
  };
}

export interface ShadowReviewerReport {
  reviewer: string;
  cases: number;
  xhighBlockers: number;
  recovered: number;
  recoveredPct: number; // rounded; 100 when xhigh found no blockers
  missedCritical: number;
  highOnly: number;
  missedCases: { task: string; missed: Finding[] }[];
  passes: boolean;      // recovered >= 90 % and no critical missed
}

export function shadowReport(cases: ShadowCase[]): ShadowReviewerReport[] {
  const by = new Map<string, ShadowCase[]>();
  for (const c of cases) by.set(c.reviewer, [...(by.get(c.reviewer) ?? []), c]);
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([reviewer, cs]) => {
    const xhighBlockers = cs.reduce((n, c) => n + c.xhigh.length, 0);
    const recovered = cs.reduce((n, c) => n + c.recovered.length, 0);
    const missedCritical = cs.reduce((n, c) => n + c.missedCritical.length, 0);
    const ratio = xhighBlockers ? recovered / xhighBlockers : 1;
    return {
      reviewer, cases: cs.length, xhighBlockers, recovered,
      recoveredPct: Math.round(ratio * 100),
      missedCritical,
      highOnly: cs.reduce((n, c) => n + c.highOnly.length, 0),
      missedCases: cs.filter(c => c.missed.length).map(c => ({ task: c.task, missed: c.missed })),
      passes: ratio >= PASS_RATIO && missedCritical === 0,
    };
  });
}

const TEXT = {
  es: { none: 'No hay casos en sombra.', cases: 'casos', xhigh: 'bloqueantes de xhigh', rec: 'recuperados por high',
    crit: 'críticos perdidos', only: 'solo de high', pass: 'cumple', fail: 'no cumple', missed: 'perdidos' },
  en: { none: 'No shadow cases.', cases: 'cases', xhigh: 'xhigh blockers', rec: 'recovered by high',
    crit: 'criticals missed', only: 'high only', pass: 'passes', fail: 'fails', missed: 'missed' },
};

const where = (f: Finding) => f.file ? (f.line != null ? `${f.file}:${f.line}` : f.file) : '-';

/** Plain-text report, one block per reviewer. */
export function renderShadowReport(report: ShadowReviewerReport[], lang: 'es' | 'en' = 'es'): string {
  const t = TEXT[lang];
  if (!report.length) return t.none + '\n';
  const out: string[] = [];
  for (const r of report) {
    out.push(`${r.reviewer}: ${r.passes ? t.pass : t.fail}`);
    out.push(`  ${t.cases}: ${r.cases} · ${t.xhigh}: ${r.xhighBlockers} · ${t.rec}: ${r.recovered} (${r.recoveredPct} %) · ${t.crit}: ${r.missedCritical} · ${t.only}: ${r.highOnly}`);
    for (const c of r.missedCases) {
      out.push(`  ${c.task} — ${t.missed}:`);
      for (const f of c.missed) out.push(`    [${f.severity}] ${where(f)} ${f.problem}`);
    }
  }
  return out.join('\n') + '\n';
}
