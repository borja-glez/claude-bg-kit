// A6: the rules of forge diagnose. Pure: no file is read or written here. A task runs along the steps of its path; each
// step is a ledger event or a call to forge or Agent, and the rules say which ones are missing, out of order, degraded
// by a step that only failed, repeated, or repeated after a compaction.
import type { LedgerEvent } from './ledger.js';
import type { AgentDispatch, ForgeInvocation } from './diagnose-transcript.js';

export type Path = 'trivial' | 'small' | 'medium' | 'large';
export type StepName = 'begin' | 'triage' | 'prep' | 'impl' | 'validate' | 'review-prep' | 'reviewers' | 'review-close' | 'done';
export interface StepSpec { step: StepName; brief: boolean; required: boolean; after: readonly StepName[] }

const BEGIN: StepSpec = { step: 'begin', brief: false, required: true, after: [] };
const TRIAGE: StepSpec = { step: 'triage', brief: false, required: true, after: ['begin'] };
const ROUND: StepSpec[] = [
  { step: 'prep', brief: true, required: true, after: ['triage'] },
  { step: 'impl', brief: true, required: true, after: ['prep'] },
  { step: 'review-prep', brief: true, required: true, after: ['impl'] },
  { step: 'reviewers', brief: true, required: true, after: ['review-prep'] },
  { step: 'review-close', brief: true, required: true, after: ['reviewers'] },
];
export const SEQUENCES: Record<Path, readonly StepSpec[]> = {
  trivial: [BEGIN, TRIAGE, { step: 'validate', brief: false, required: true, after: ['triage'] }],
  small: [BEGIN, TRIAGE, { step: 'prep', brief: true, required: true, after: ['triage'] }, { step: 'impl', brief: true, required: false, after: ['prep'] },
    { step: 'validate', brief: false, required: true, after: ['prep'] }, { step: 'done', brief: false, required: true, after: ['validate'] }],
  medium: [BEGIN, TRIAGE, ...ROUND, { step: 'done', brief: false, required: true, after: ['review-close'] }],
  large: [{ ...TRIAGE, after: [] }, ...ROUND],
};

export type FindingKind = 'missing-step' | 'out-of-order' | 'degraded' | 'failed' | 'repeat' | 'compact-drift';
export const KIND_ORDER: readonly FindingKind[] = ['missing-step', 'out-of-order', 'degraded', 'failed', 'repeat', 'compact-drift'];
export interface Finding { kind: FindingKind; task: string | null; step?: StepName; brief?: number | null; text: string; at: string[]; ts: string | null }
/** One time a step ran: `start`/`end` ISO (a ledger event: both its ts), `ok` false when it failed and null while unknown, `at` its citations. */
export interface Instance { task: string; step: StepName; brief: number | null; start: string; end: string | null; ok: boolean | null; at: string[] }
export type StepState = 'ok' | 'failed' | 'degraded' | 'out-of-order' | 'missing' | 'skipped' | 'pending' | 'unverified';
export interface StepRow { step: StepName; brief: number | null; state: StepState; start: string | null; end: string | null; at: string[] }
export interface Compaction { at: string; ts: string }
export interface StepsOpts { transcript: boolean; agentEvents: boolean; compactions: readonly Compaction[] }

const ms = (iso: string): number => Date.parse(iso);

/** A citation `file:line` split in its file and its line (0 when it has none). */
function splitAt(ref: string): { file: string; line: number } {
  const m = /^(.*):(\d+)$/.exec(ref);
  return m ? { file: m[1], line: Number(m[2]) } : { file: ref, line: 0 };
}
function compareAt(a: string, b: string): number {
  const x = splitAt(a);
  const y = splitAt(b);
  if (x.file !== y.file) return x.file < y.file ? -1 : 1;
  return x.line - y.line;
}
/** Time ascending with an unparsable or missing one last. */
function compareTime(a: string | null, b: string | null): number {
  const x = a === null ? NaN : ms(a);
  const y = b === null ? NaN : ms(b);
  if (Number.isNaN(x) || Number.isNaN(y)) return Number.isNaN(x) === Number.isNaN(y) ? 0 : Number.isNaN(x) ? 1 : -1;
  return x - y;
}

export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort((a, b) => compareTime(a.ts, b.ts) || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || compareAt(a.at[0] ?? '', b.at[0] ?? ''));
}

/** Drops a finding that cites no `<file>:<line>` and has no ts. */
export function cited(findings: readonly Finding[]): Finding[] {
  return findings.filter(f => f.ts !== null || f.at.some(a => /:\d+$/.test(a)));
}

// --- what each record is ---------------------------------------------------------------------------------------

/** The brief of an id within task `task`: null for the task itself, its number for `<task>-<n>`, undefined when the id is not of the task. */
export function briefOf(task: string, id: string): number | null | undefined {
  if (id === task) return null;
  if (!id.startsWith(`${task}-`)) return undefined;
  const rest = id.slice(task.length + 1);
  return /^\d{1,3}$/.test(rest) ? Number(rest) : undefined;
}

const IMPL_AGENT = /^(?:forge:)?forge-(?:mech|fable|impl(?:-light|-high|-heavy)?)$/;
const IMPL_ROLES: readonly string[] = ['mech', 'impl-light', 'impl', 'impl-high', 'impl-heavy'];
const REVIEW_AGENT = /^(?:forge:)?forge-review-[a-z-]+$/;
const isImplementer = (agent: unknown, role: unknown): boolean =>
  (typeof agent === 'string' && IMPL_AGENT.test(agent)) || (typeof role === 'string' && IMPL_ROLES.includes(role));
const isReviewer = (agent: unknown, role: unknown): boolean =>
  (typeof agent === 'string' && REVIEW_AGENT.test(agent)) || (typeof role === 'string' && role.startsWith('review-'));

type Hit = { step: StepName; brief: number | null };

export function stepOfEvent(e: LedgerEvent, task: string): { step: StepName; brief: number | null; ok: boolean } | null {
  const brief = typeof e.task === 'string' ? briefOf(task, e.task) : undefined;
  if (brief === undefined) return null;
  const at = (step: StepName, ok = true) => ({ step, brief, ok });
  switch (e.kind) {
    case 'triage': return brief === null ? at('triage') : null;
    case 'validate': return brief === null && !e.baseline ? at('validate', e.ok === true) : null;
    case 'phase':
      if (e.phase === 'implement') return brief === null ? null : at('prep');
      if (e.phase === 'review') return brief === null ? null : at('review-prep');
      if (e.phase === 'done') return { step: 'done', brief: null, ok: true };
      return null;
    case 'verdict': return brief === null ? null : at('review-close');
    case 'agent':
      if (brief === null) return null;
      if (isImplementer(e.agent, e.role)) return at('impl');
      if (isReviewer(e.agent, e.role)) return at('reviewers');
      return null;
    default: return null;
  }
}

export function stepOfForge(inv: ForgeInvocation, task: string): Hit | null {
  const brief = inv.task === null ? undefined : briefOf(task, inv.task);
  if (brief === undefined) return null;
  switch (inv.name) {
    case 'begin': case 'triage': return brief === null ? { step: inv.name, brief } : null;
    case 'validate': return brief === null && !inv.args.split(/\s+/).includes('--base-run') ? { step: 'validate', brief } : null;
    case 'prep': case 'review-prep': case 'review-close': return brief === null ? null : { step: inv.name, brief };
    default: return null;
  }
}

export function stepOfAgent(a: AgentDispatch, task: string): Hit | null {
  const brief = a.task === null ? undefined : briefOf(task, a.task);
  if (brief === undefined || brief === null) return null;
  if (isImplementer(a.type, null)) return { step: 'impl', brief };
  if (isReviewer(a.type, null)) return { step: 'reviewers', brief };
  return null;
}

/** Pairs each ledger instance with the latest unpaired call of its task, step and brief that started before it and did not fail. */
export function pairInstances(ledger: readonly Instance[], calls: readonly Instance[]): Instance[] {
  const used = new Set<Instance>();
  const out: Instance[] = [];
  for (const ev of [...ledger].sort((a, b) => ms(a.start) - ms(b.start))) {
    let best: Instance | null = null;
    for (const c of calls) {
      if (used.has(c) || c.ok === false || c.task !== ev.task || c.step !== ev.step || c.brief !== ev.brief || ms(c.start) > ms(ev.start)) continue;
      if (best === null || ms(c.start) >= ms(best.start)) best = c;
    }
    if (best === null) { out.push(ev); continue; }
    used.add(best);
    out.push({ ...best, end: best.end ?? ev.start, ok: true, at: [...best.at, ...ev.at] });
  }
  for (const c of calls) if (!used.has(c)) out.push(c);
  return out.sort((a, b) => ms(a.start) - ms(b.start) || compareAt(a.at[0] ?? '', b.at[0] ?? ''));
}

// --- the steps of a task ---------------------------------------------------------------------------------------

interface Row { spec: StepSpec; brief: number | null; state: StepState; list: Instance[]; first: Instance | null; start: string | null; end: string | null; at: string[] }

const rowKey = (step: StepName, brief: number | null): string => `${step}#${brief ?? ''}`;

export function stepsOf(task: string, path: Path, instances: readonly Instance[], opts: StepsOpts):
  { rows: StepRow[]; findings: Finding[]; unverified: { step: StepName; brief: number | null; after: StepName }[] } {
  const specs = SEQUENCES[path];
  const briefNums = [...new Set(instances.flatMap(i => (i.brief === null ? [] : [i.brief])))].sort((a, b) => a - b);
  const briefs = briefNums.length > 0 ? briefNums : [1];
  const lastBrief = briefs[briefs.length - 1];
  const firstBriefAt = specs.findIndex(s => s.brief);
  const briefSpecs = specs.filter(s => s.brief);
  const taskSpecs = (before: boolean) => specs.filter((s, i) => !s.brief && (firstBriefAt < 0 ? before : before === (i < firstBriefAt)));
  const order: { spec: StepSpec; brief: number | null }[] = [
    ...taskSpecs(true).map(spec => ({ spec, brief: null })),
    ...briefs.flatMap(b => briefSpecs.map(spec => ({ spec, brief: b }))),
    ...taskSpecs(false).map(spec => ({ spec, brief: null })),
  ];
  const byStart = (a: Instance, b: Instance) => ms(a.start) - ms(b.start);
  const rows: Row[] = order.map(({ spec, brief }) => {
    const list = instances.filter(i => i.step === spec.step && i.brief === brief).sort(byStart);
    return { spec, brief, state: 'pending', list, first: list[0] ?? null, start: null, end: null, at: [] };
  });
  const byKey = new Map(rows.map(r => [rowKey(r.spec.step, r.brief), r]));

  // 2. the initial state of each row
  rows.forEach((r, idx) => {
    const counted = r.list.find(i => i.ok === true);
    if (counted) {
      r.state = 'ok'; r.first = counted; r.start = counted.start; r.end = counted.end; r.at = [...counted.at];
    } else if (r.list.length > 0) {
      const failedOnly = r.list.every(i => i.ok === false);
      r.state = failedOnly ? 'failed' : 'unverified';
      r.start = r.list[0].start; r.end = r.list[0].end;
      r.at = failedOnly ? r.list.flatMap(i => i.at) : [...r.list[0].at];
    } else {
      const step = r.spec.step;
      const blind = (step === 'begin' && !opts.transcript) || ((step === 'impl' || step === 'reviewers') && !opts.transcript && !opts.agentEvents);
      const later = rows.slice(idx + 1).some(x => x.list.length > 0);
      r.state = blind ? 'unverified' : later ? (r.spec.required ? 'missing' : 'skipped') : 'pending';
    }
  });

  // 3. the prerequisites of a row
  const prereqs = (r: Row): Row[] => r.spec.after.flatMap(name => {
    const ps = specs.find(s => s.step === name);
    if (!ps) return [];
    const p = byKey.get(rowKey(name, ps.brief ? (r.spec.brief ? r.brief : lastBrief) : null));
    return p ? [p] : [];
  });

  // 4. degradation, down the chain
  for (let changed = true; changed;) {
    changed = false;
    for (const r of rows) {
      if ((r.state === 'ok' || r.state === 'out-of-order') && prereqs(r).some(p => p.state === 'failed' || p.state === 'degraded')) { r.state = 'degraded'; changed = true; }
    }
  }

  // 5. the order
  const unverified: { step: StepName; brief: number | null; after: StepName }[] = [];
  const culprit = new Map<Row, Row>();
  for (const r of rows) {
    if (r.state !== 'ok' || r.start === null) continue;
    for (const p of prereqs(r)) {
      if (p.state !== 'ok' && p.state !== 'out-of-order') continue;
      if (p.end === null) { unverified.push({ step: r.spec.step, brief: r.brief, after: p.spec.step }); continue; }
      if (ms(r.start) < ms(p.end)) { r.state = 'out-of-order'; culprit.set(r, p); break; }
    }
  }

  // 6. the findings
  const findings: Finding[] = [];
  const label = (r: Row) => (r.brief === null ? r.spec.step : `${r.spec.step} of brief ${r.brief}`);
  rows.forEach((r, idx) => {
    const base = { task, step: r.spec.step, brief: r.brief };
    if (r.state === 'missing') {
      const next = rows.slice(idx + 1).find(x => x.list.length > 0)?.first;
      findings.push({ ...base, kind: 'missing-step', text: `${label(r)} never ran, though a later step did`, at: next ? [...next.at] : [], ts: next?.start ?? null });
    } else if (r.state === 'out-of-order') {
      findings.push({ ...base, kind: 'out-of-order', text: `${label(r)} started before the step it needs had ended`, at: [...r.at, ...(culprit.get(r)?.at ?? [])], ts: r.start });
    } else if (r.state === 'degraded') {
      const bad = prereqs(r).find(p => p.state === 'failed' || p.state === 'degraded');
      findings.push({ ...base, kind: 'degraded', text: `${label(r)} ran on top of a step that only failed`, at: [...r.at, ...(bad?.at ?? [])], ts: r.start });
    }
    for (const i of r.list) {
      if (i.ok === false) findings.push({ ...base, kind: 'failed', text: `${label(r)} failed`, at: [...i.at], ts: i.start });
    }
  });
  const drifted = new Map<Instance, Compaction>();
  const sortedAll = [...instances].sort(byStart);
  for (const c of [...opts.compactions].sort((a, b) => ms(a.ts) - ms(b.ts))) {
    const firstAfter = sortedAll.find(i => ms(i.start) > ms(c.ts));
    if (firstAfter) drifted.set(firstAfter, c);
  }
  for (const r of rows) {
    const c = r.state === 'out-of-order' && r.first ? drifted.get(r.first) : undefined;
    if (c) findings.push({ task, step: r.spec.step, brief: r.brief, kind: 'compact-drift', text: `${label(r)} is the first step after a compaction and ran out of order`, at: [c.at, ...r.at], ts: r.start });
  }

  return {
    rows: rows.map(r => ({ step: r.spec.step, brief: r.brief, state: r.state, start: r.start, end: r.end, at: r.at })),
    findings: sortFindings(findings),
    unverified,
  };
}

// --- repeated work ---------------------------------------------------------------------------------------------

/** A call for the repeat rules: `once` (ONCE_COMMANDS), `forge` (any other forge call: a separator) or `agent`; `task` the base task id. */
export interface CallRef { task: string | null; key: string; kind: 'once' | 'forge' | 'agent'; ok: boolean | null; ts: string; at: string }
export const ONCE_COMMANDS: readonly string[] = ['begin', 'prep', 'tree snapshot', 'swarm start', 'swarm worktree'];
export const REPEAT_FORGE = 2;
export const REPEAT_AGENT = 2;
export const WAITING_MS = 10 * 60_000;

const fileOf = (ref: string): string => splitAt(ref).file;

export function repeats(calls: readonly CallRef[], compactions: readonly Compaction[]): Finding[] {
  const sorted = [...calls].sort((a, b) => ms(a.ts) - ms(b.ts) || compareAt(a.at, b.at));
  const out: Finding[] = [];
  /** The first compaction of the transcript of `first` with a ts from the call `first` to the one `last`. */
  const between = (first: CallRef, last: CallRef): Compaction | undefined =>
    [...compactions].sort((a, b) => ms(a.ts) - ms(b.ts)).find(c => fileOf(c.at) === fileOf(first.at) && ms(c.ts) >= ms(first.ts) && ms(c.ts) <= ms(last.ts));

  const groups = new Map<string, CallRef[]>();
  for (const c of sorted) if (c.kind === 'once') groups.set(c.key, [...(groups.get(c.key) ?? []), c]);
  for (const group of groups.values()) {
    const from = group.findIndex(c => c.ok === true);
    if (from < 0) continue;
    const rest = group.slice(from);
    if (rest.length < REPEAT_FORGE) continue;
    const c = between(rest[0], rest[1]);
    out.push(c
      ? { kind: 'compact-drift', task: rest[0].task, text: `${rest[0].key} ran again after a compaction`, at: [c.at, ...rest.map(r => r.at)], ts: rest[1].ts }
      : { kind: 'repeat', task: rest[0].task, text: `${rest[0].key} ran again after it had succeeded`, at: rest.map(r => r.at), ts: rest[1].ts });
  }

  const runs = new Map<string, CallRef[]>();
  const close = (run: CallRef[]) => {
    if (run.length < REPEAT_AGENT) return;
    const c = between(run[0], run[run.length - 1]);
    out.push(c
      ? { kind: 'compact-drift', task: run[0].task, text: `agent ${run[0].key} dispatched again after a compaction`, at: [c.at, ...run.map(r => r.at)], ts: run[1].ts }
      : { kind: 'repeat', task: run[0].task, text: `agent ${run[0].key} dispatched again with no forge call of its task in between`, at: run.map(r => r.at), ts: run[1].ts });
  };
  for (const c of sorted) {
    if (c.kind === 'agent') {
      const id = `${c.task ?? ''}\u0000${c.key}`;
      runs.set(id, [...(runs.get(id) ?? []), c]);
    } else {
      for (const [id, run] of runs) {
        if (run[0].task !== c.task) continue;
        close(run);
        runs.delete(id);
      }
    }
  }
  for (const run of runs.values()) close(run);
  return sortFindings(out);
}

// --- the timeline ----------------------------------------------------------------------------------------------

export interface Entry { ts: string; at: string; source: 'ledger' | 'file' | 'transcript' | 'subagent'; what: string; task: string | null }
const SOURCE_RANK: Record<Entry['source'], number> = { ledger: 0, file: 1, transcript: 2, subagent: 3 };

export function sortTimeline(entries: readonly Entry[]): Entry[] {
  return [...entries].sort((a, b) => compareTime(a.ts, b.ts) || SOURCE_RANK[a.source] - SOURCE_RANK[b.source] || compareAt(a.at, b.at));
}
