// FORGE stats (C-09): where the clock of a brief goes, from the ledger's phase, validate and verdict events (C4), and how
// real task times compare with the plan's estimates. Pure: cli/run.ts reads the ledger and the plans. An older ledger
// (no clocks, no phases but implement) gives what it can: its time falls in implement.
import type { LedgerEvent } from './ledger.js';
import type { PlanTask } from '../lib/types.js';

export const STAGE_NAMES = ['implement', 'validate', 'review', 'verdict', 'fix'] as const;
export type StageName = (typeof STAGE_NAMES)[number];
export type StageMs = Record<StageName, number>;
export interface Quantiles { p50: number; p80: number }
export interface BriefStat {
  task: string; path: string; startedAt: string; acceptedAt: string; totalMs: number; stages: StageMs;
  validators: { runs: number; cached: number; ms: number }; implementValidateMs: number; reviews: number; express: boolean;
}
export interface PathStats { briefs: number; briefMin: Quantiles | null; stages: StageMs; validatorShare: number; cacheHits: number }
export interface PlanStates { project: string; tasks: PlanTask[]; states: Record<string, unknown> }
export interface ForgeStats {
  briefs: number; firstPass: number; reviewsMean: number; briefMin: Quantiles | null; overheadMin: Quantiles | null;
  validatorShare: number; cacheHits: number; stages: StageMs; byPath: Record<string, PathStats>;
  estimate: { tasks: number; ratio: number } | null; byBrief: BriefStat[];
}

const MIN = 60000;
const MIN_ESTIMATED = 5;
const at = (e: LedgerEvent) => Date.parse(e.ts);
const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0);
const isStage = (p: unknown): p is StageName => (STAGE_NAMES as readonly unknown[]).includes(p);
const zero = (): StageMs => ({ implement: 0, validate: 0, review: 0, verdict: 0, fix: 0 });
const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;

/** Nearest-rank p50 and p80, one decimal; null without values. */
export function quantiles(values: number[]): Quantiles | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const q = (p: number) => round1(s[Math.max(0, Math.ceil(p * s.length) - 1)]);
  return { p50: q(0.5), p80: q(0.8) };
}

/** The path of a task's last triage before index `before` (a loose `<parent>-<k>` falls back to its parent's), else 'unknown'. */
function pathOf(events: LedgerEvent[], id: string, before: number): string {
  const of = (t: string) => events.slice(0, before).filter(e => e.kind === 'triage' && e.task === t && typeof e.path === 'string').at(-1)?.path as string | undefined;
  const parent = /^(.+)-\d+$/.exec(id)?.[1];
  return of(id) ?? (parent ? of(parent) : undefined) ?? 'unknown';
}

/**
 * Every accepted brief `<id>-<n>`: from its `phase implement` (minus the clock of the baseline prep ran right before
 * it, which counts in validate) to the verdict that accepts it. Each phase of `<id>` lasts until the next one or the
 * end; validate events of the brief count as validators, its --affected passes (the implementer's) apart. A brief
 * started again by a later prep counts from the last start.
 */
export function briefStats(events: LedgerEvent[]): BriefStat[] {
  const out: BriefStat[] = [];
  events.forEach((p, i) => {
    if (p.kind !== 'phase' || p.phase !== 'implement' || typeof p.task !== 'string' || typeof p.brief !== 'number') return;
    const id = p.task, n = p.brief, brief = `${id}-${n}`;
    const j = events.findIndex((e, k) => k > i && e.kind === 'verdict' && e.task === brief && e.action === 'accept');
    if (j < 0) return;
    if (events.slice(i + 1, j).some(e => e.kind === 'phase' && e.task === id && e.phase === 'implement' && e.brief === n)) return;
    let b = i;
    for (let k = i - 1; k >= 0; k--) {
      const e = events[k];
      if (e.ts !== p.ts) break;
      if (e.kind === 'validate' && e.task === brief && e.baseline === true) { b = k; break; }
    }
    const baselineMs = b < i ? num(events[b].durationMs) : 0;
    const start = at(p) - baselineMs, end = at(events[j]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return;
    const stages = zero();
    stages.validate += baselineMs;
    const phases: LedgerEvent[] = [];
    for (let k = i; k < j; k++) if (events[k].kind === 'phase' && events[k].task === id) phases.push(events[k]);
    phases.forEach((e, x) => {
      const next = x + 1 < phases.length ? at(phases[x + 1]) : end;
      if (isStage(e.phase) && Number.isFinite(next)) stages[e.phase] += Math.max(0, next - at(e));
    });
    const validators = { runs: 0, cached: 0, ms: 0 };
    let implementValidateMs = 0;
    for (let k = b; k <= j; k++) {
      const e = events[k];
      if (e.kind !== 'validate' || e.task !== brief) continue;
      if (e.scope === 'affected') { implementValidateMs += num(e.durationMs); continue; }
      validators.ms += num(e.durationMs);
      for (const r of Array.isArray(e.results) ? e.results as { cached?: unknown }[] : []) {
        if (r && r.cached === true) validators.cached++; else validators.runs++;
      }
    }
    const dirs = new Set(events.slice(i, j + 1).filter(e => e.kind === 'verdict' && e.task === brief).map((e, x) => (typeof e.dir === 'string' ? e.dir : `#${x}`)));
    out.push({
      task: brief, path: pathOf(events, id, j), startedAt: new Date(start).toISOString(), acceptedAt: events[j].ts, totalMs: end - start,
      stages, validators, implementValidateMs, reviews: dirs.size, express: phases.some(e => e.phase === 'review' && e.express === true),
    });
  });
  return out;
}

/** Real over estimated minutes of the plan tasks the roadmap saw start and finish (done since `from`); null with fewer than 5. */
export function estimateOf(plans: PlanStates[], from: number | null): { tasks: number; ratio: number } | null {
  let real = 0, estimated = 0, tasks = 0;
  for (const p of plans) {
    for (const t of p.tasks) {
      const s = p.states[t.id] as { startedAt?: unknown; doneAt?: unknown } | undefined;
      if (!t.estimate_min || !s || typeof s.startedAt !== 'string' || typeof s.doneAt !== 'string') continue;
      const a = Date.parse(s.startedAt), b = Date.parse(s.doneAt);
      if (!(b > a) || (from !== null && b < from)) continue;
      real += (b - a) / MIN; estimated += t.estimate_min; tasks++;
    }
  }
  return tasks >= MIN_ESTIMATED && estimated > 0 ? { tasks, ratio: round2(real / estimated) } : null;
}

export function computeStats(input: { events: LedgerEvent[]; plans: PlanStates[]; from: number | null }): ForgeStats {
  const byBrief = briefStats(input.events).filter(b => input.from === null || Date.parse(b.startedAt) >= input.from);
  const first = (bs: BriefStat[]) => bs.filter(b => b.reviews <= 1);
  const sum = (bs: BriefStat[], f: (b: BriefStat) => number) => bs.reduce((a, b) => a + f(b), 0);
  const meanStages = (bs: BriefStat[]): StageMs => {
    const s = zero();
    if (bs.length) for (const k of STAGE_NAMES) s[k] = Math.round(sum(bs, b => b.stages[k]) / bs.length);
    return s;
  };
  const share = (bs: BriefStat[]) => { const t = sum(bs, b => b.totalMs); return t > 0 ? round2(sum(bs, b => b.validators.ms) / t) : 0; };
  const hits = (bs: BriefStat[]) => { const n = sum(bs, b => b.validators.runs + b.validators.cached); return n > 0 ? round2(sum(bs, b => b.validators.cached) / n) : 0; };
  const byPath: Record<string, PathStats> = {};
  for (const p of [...new Set(byBrief.map(b => b.path))].sort()) {
    const bs = byBrief.filter(b => b.path === p);
    byPath[p] = { briefs: bs.length, briefMin: quantiles(first(bs).map(b => b.totalMs / MIN)), stages: meanStages(bs), validatorShare: share(bs), cacheHits: hits(bs) };
  }
  return {
    briefs: byBrief.length,
    firstPass: byBrief.length ? round2(first(byBrief).length / byBrief.length) : 0,
    reviewsMean: byBrief.length ? round2(sum(byBrief, b => b.reviews) / byBrief.length) : 0,
    briefMin: quantiles(first(byBrief).map(b => b.totalMs / MIN)),
    // The fixed cost (C-07): the clock of a brief accepted at once minus the implementer's writing (implement and fix).
    overheadMin: quantiles(first(byBrief).map(b => (b.totalMs - b.stages.implement - b.stages.fix) / MIN)),
    validatorShare: share(byBrief), cacheHits: hits(byBrief), stages: meanStages(byBrief), byPath,
    estimate: estimateOf(input.plans, input.from), byBrief,
  };
}

const pct = (x: number) => `${Math.round(100 * x)} %`;
const mins = (ms: number) => (ms / MIN).toFixed(1);

/** The text FORGE stats prints without --json: three lines and a table per path, in the person's language. */
export function renderStats(s: ForgeStats, locale: 'es' | 'en'): string {
  const es = locale === 'es';
  const q = (x: Quantiles | null) => (x ? `p50 ${x.p50} min, p80 ${x.p80} min` : '—');
  const lines = es ? [
    `forge stats: ${s.briefs} briefs, ${pct(s.firstPass)} aceptados en la primera revisión, ${s.reviewsMean} revisiones de media.`,
    `Brief aceptado a la primera: ${q(s.briefMin)}. Coste fijo: ${q(s.overheadMin)}.`,
    `Validadores: ${pct(s.validatorShare)} del reloj, ${pct(s.cacheHits)} desde la caché.`,
  ] : [
    `forge stats: ${s.briefs} briefs, ${pct(s.firstPass)} accepted at the first review, ${s.reviewsMean} reviews on average.`,
    `Brief accepted at once: ${q(s.briefMin)}. Fixed cost: ${q(s.overheadMin)}.`,
    `Validators: ${pct(s.validatorShare)} of the clock, ${pct(s.cacheHits)} from the cache.`,
  ];
  lines.push('', `| ${es ? 'camino' : 'path'} | briefs | p50 min | implement | validate | review | verdict | fix |`, '|---|---|---|---|---|---|---|---|');
  for (const [p, x] of Object.entries(s.byPath)) {
    lines.push(`| ${p} | ${x.briefs} | ${x.briefMin ? x.briefMin.p50.toFixed(1) : '—'} | ${STAGE_NAMES.map(k => mins(x.stages[k])).join(' | ')} |`);
  }
  if (s.estimate) lines.push('', es ? `Estimaciones: real/estimado ${s.estimate.ratio} en ${s.estimate.tasks} tareas.` : `Estimates: real/estimated ${s.estimate.ratio} over ${s.estimate.tasks} tasks.`);
  return lines.join('\n') + '\n';
}
