// A6: forge diagnose. What forge recorded of a task or a run (the ledger by line, its files under .forge, the transcripts of its
// sessions and their subagents), judged by the rules of diagnose-rules.ts and printed with every claim cited. Read only.
import { statSync } from 'node:fs';
import path from 'node:path';
import {
  ONCE_COMMANDS, WAITING_MS, briefOf, cited, pairInstances, repeats, sortFindings, sortTimeline, stepOfAgent, stepOfEvent, stepOfForge, stepsOf,
  type CallRef, type Compaction, type Entry, type Finding, type Instance, type Path, type StepRow,
} from './diagnose-rules.js';
import { forgeSources, subagentFile, transcriptsOf, type Doc, type ScopeTask, type Scope, type Source } from './diagnose-sources.js';
import {
  ZERO_TOKENS, addTokens, readTranscript,
  type AgentDispatch, type ForgeInvocation, type TCall, type TResult, type Tokens, type TranscriptFacts,
} from './diagnose-transcript.js';
import { measureJsonl } from './transcript-file.js';

export interface Waiting { at: string; ts: string; tool: string; forge: string | null; minutes: number }
export interface UsageRow { file: string; agentId: string | null; usageLines: number; messages: number; tokens: Tokens }
export interface TaskSteps { task: string; project: string | null; path: Path | null; steps: StepRow[] }
export interface Diagnosis {
  scope: { task: string; project: string | null } | { execution: string };
  now: string;
  window: { from: string | null; to: string | null };
  findings: Finding[];
  waiting: Waiting[];
  tasks: TaskSteps[];
  usage: { transcripts: UsageRow[]; total: Tokens };
  coverage: string[];
  sources: Source[];
  timeline: Entry[];
}
export interface DiagnoseOpts { configDir: string; transcript?: string; now: Date }
export const TRANSCRIPTS_MAX = 20;
export const SUBAGENTS_MAX = 200;
export const SPAWN_DEPTH_MAX = 3;

const PATHS: readonly string[] = ['trivial', 'small', 'medium', 'large'];
const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const time = (iso: string | null): number => (iso === null ? NaN : Date.parse(iso));
const cite = (file: string, line: number): string => `${file}:${line}`;

/** The earliest and the latest of some times; unparsable ones are ignored. */
function spanOf(times: readonly (string | null | undefined)[]): { from: string | null; to: string | null } {
  let from: string | null = null, to: string | null = null;
  for (const t of times) {
    if (typeof t !== 'string' || Number.isNaN(time(t))) continue;
    if (from === null || time(t) < time(from)) from = t;
    if (to === null || time(t) > time(to)) to = t;
  }
  return { from, to };
}

/** `file:line` citations in order: by file, then by line number. */
function compareCites(a: string, b: string): number {
  const split = (s: string) => { const m = /^(.*):(\d+)$/.exec(s); return m ? { f: m[1], n: Number(m[2]) } : { f: s, n: 0 }; };
  const x = split(a), y = split(b);
  return x.f === y.f ? x.n - y.n : x.f < y.f ? -1 : 1;
}

/** A call of a transcript that belongs to the scope: the invocations of forge in it (`t` null for a swarm call of a run) and its Agent. */
interface ScopedCall {
  facts: TranscriptFacts; call: TCall; res: TResult | undefined; at: string;
  hits: { inv: ForgeInvocation; t: ScopeTask | null }[]; agent: { a: AgentDispatch; t: ScopeTask } | null;
}

interface Read { facts: TranscriptFacts; agentId: string | null }

export function diagnose(main: string, scope: Scope, opts: DiagnoseOpts): Diagnosis | null {
  const src = forgeSources(main, scope);
  if (src.scoped.length === 0 && src.exec === null && (scope.kind === 'execution' || src.docs.length === 0)) return null;
  const coverage = [...src.coverage];
  const sources = [...src.sources];
  const tasks = src.tasks;
  const now = opts.now.getTime();

  // 2. the main transcripts
  let files: string[];
  if (opts.transcript) files = [opts.transcript];
  else {
    const t = transcriptsOf(src.sessions, opts.configDir, main);
    files = t.found;
    for (const s of t.missing) coverage.push(`no transcript for session ${s} on this machine`);
  }
  if (files.length > TRANSCRIPTS_MAX) {
    coverage.push(`${files.length - TRANSCRIPTS_MAX} more transcripts not read (at most ${TRANSCRIPTS_MAX})`);
    files = files.slice(0, TRANSCRIPTS_MAX);
  }
  /** Reads one transcript and adds its row to the sources: the bytes are the measured size, the lines those read. */
  const load = (file: string, kind: 'transcript' | 'subagent'): TranscriptFacts | null => {
    const facts = readTranscript(file);
    const bytes = measureJsonl(file)?.bytes ?? null;
    if (!facts) { sources.push({ file, kind, bytes, error: 'unreadable' }); return null; }
    const { stats } = facts;
    sources.push({ file, kind, bytes, lines: stats.lines, ...(stats.long.length ? { long: stats.long } : {}), truncated: stats.truncated });
    if (stats.truncated) coverage.push(`${file}: read only its first 512 MiB`);
    return facts;
  };
  const mains: TranscriptFacts[] = [];
  for (const f of files) {
    const facts = load(f, 'transcript');
    if (facts) mains.push(facts);
  }

  // 4 (execution). the window of a run does not depend on its calls
  let window = scope.kind === 'execution'
    ? { from: src.exec?.startedAt ?? spanOf(src.scoped.map(l => l.event.ts)).from, to: spanOf([...src.scoped.map(l => l.event.ts), src.exec?.lastStepAt]).to }
    : spanOf(src.scoped.map(l => l.event.ts));
  if (scope.kind === 'execution' && window.from === null && window.to === null) window = { from: null, to: null };
  const inWindow = (ts: string): boolean => {
    const x = Date.parse(ts);
    if (Number.isNaN(x)) return true;
    return !(window.from !== null && x < time(window.from)) && !(window.to !== null && x > time(window.to));
  };

  // 3. what is in the scope
  const forTask = (id: string | null): ScopeTask | undefined => (id === null ? undefined : tasks.find(t => briefOf(t.task, id) !== undefined));
  // An Agent whose forge-task line carries @<project> is in scope only for that project (null for a loose task); without it, by id.
  const forAgent = (a: AgentDispatch): ScopeTask | undefined =>
    (a.task === null ? undefined : tasks.find(t => briefOf(t.task, a.task as string) !== undefined && (a.project === null || a.project === t.project)));
  const isSwarm = (inv: ForgeInvocation) => inv.task === null && (inv.name === 'swarm' || inv.name.startsWith('swarm '));
  const scoped = (call: TCall, facts: TranscriptFacts): ScopedCall | null => {
    const hits: ScopedCall['hits'] = [];
    for (const inv of call.forge) {
      const t = forTask(inv.task);
      if (t) hits.push({ inv, t });
    }
    if (hits.length === 0 && scope.kind === 'execution' && call.forge.length > 0 && call.forge.every(isSwarm) && window.from !== null && window.to !== null && inWindow(call.ts)) {
      for (const inv of call.forge) hits.push({ inv, t: null });
    }
    const t = call.agent ? forAgent(call.agent) : undefined;
    const agent = call.agent && t ? { a: call.agent, t } : null;
    if (hits.length === 0 && agent === null) return null;
    return { facts, call, res: facts.results.get(call.id), at: cite(facts.file, call.line), hits, agent };
  };
  const scopedOf = (facts: TranscriptFacts): ScopedCall[] => facts.calls.flatMap(c => { const s = scoped(c, facts); return s ? [s] : []; });
  const mainCalls = mains.flatMap(scopedOf);

  // 4 (task). the window of a task also takes its calls
  if (scope.kind === 'task') window = spanOf([...src.scoped.map(l => l.event.ts), ...mainCalls.map(c => c.call.ts)]);

  // 5. the subagents
  const subs: Read[] = [];
  const lastTsOf = new Map<string, string | null>();
  const seenAgents = new Set<string>();
  let capped = false;
  const follow = (mainFile: string, facts: TranscriptFacts, depth: number): void => {
    for (const sc of scopedOf(facts)) {
      const id = sc.res?.agentId;
      if (!sc.agent || !id || seenAgents.has(id)) continue;
      if (subs.length >= SUBAGENTS_MAX) {
        if (!capped) coverage.push(`more than ${SUBAGENTS_MAX} subagents: the rest are not read`);
        capped = true;
        return;
      }
      seenAgents.add(id);
      const sf = subagentFile(mainFile, id);
      const sub = sf ? load(sf.file, 'subagent') : null;
      if (!sf || !sub) { if (!sf) coverage.push(`no transcript for agent ${id} (${sc.at})`); continue; }
      try {
        sources.push({ file: sf.metaFile, kind: 'meta', bytes: statSync(sf.metaFile).size });
      } catch { /* no meta file */ }
      subs.push({ facts: sub, agentId: id });
      lastTsOf.set(id, sub.lastTs);
      if (depth < SPAWN_DEPTH_MAX) follow(mainFile, sub, depth + 1);
      else if (scopedOf(sub).some(s => s.agent && s.res?.agentId)) coverage.push(`agents launched by agent ${id} are not followed: more than ${SPAWN_DEPTH_MAX} levels deep`);
    }
  };
  for (const m of mains) follow(m.file, m, 0);

  // 6. the instances of each task
  const outDocs = new Map<string, Doc>(src.docs.filter(d => d.kind === 'out').map(d => [d.abs, d]));
  const outOf = (inv: ForgeInvocation): Doc | undefined => (inv.out === null ? undefined : outDocs.get(path.resolve(main, inv.out)));
  const hasError = (d: Doc): boolean => isRecord(d.doc) && d.doc.error !== undefined && d.doc.error !== null;
  /** Whether a call to forge went well: null while unknown (no result, or launched in the background). */
  const okOfCall = (sc: ScopedCall, inv: ForgeInvocation): boolean | null => {
    const doc = outOf(inv);
    if (doc) return !hasError(doc);
    if (!sc.res) return null;
    if (sc.res.error) return false;
    return sc.call.background || sc.res.launched ? null : true;
  };
  const named = new Set<string>();
  for (const m of mains) for (const c of m.calls) for (const inv of c.forge) if (inv.out !== null) named.add(path.resolve(main, inv.out));

  const instancesOf = new Map<string, Instance[]>();
  const extra: Finding[] = [];
  for (const T of tasks) {
    const ledger: Instance[] = [];
    for (const l of src.scoped) {
      const s = stepOfEvent(l.event, T.task);
      if (s) ledger.push({ task: T.task, step: s.step, brief: s.brief, start: l.event.ts, end: l.event.ts, ok: s.ok, at: [cite('.forge/ledger.jsonl', l.line)] });
    }
    const calls: Instance[] = [];
    for (const sc of mainCalls) {
      for (const h of sc.hits) {
        const hit = stepOfForge(h.inv, T.task);
        if (!hit) continue;
        const launched = sc.call.background || sc.res?.launched === true;
        const inst: Instance = { task: T.task, step: hit.step, brief: hit.brief, start: sc.call.ts, end: sc.res && !launched ? sc.res.ts : null, ok: okOfCall(sc, h.inv), at: [sc.at] };
        const doc = outOf(h.inv);
        if (doc) {
          if (hasError(doc)) inst.at.push(doc.file);
          else inst.end = doc.ts;
        }
        calls.push(inst);
      }
      if (sc.agent && forAgent(sc.agent.a) === T) {
        const hit = stepOfAgent(sc.agent.a, T.task);
        if (hit) {
          const id = sc.res?.agentId;
          calls.push({ task: T.task, step: hit.step, brief: hit.brief, start: sc.call.ts, end: (id ? lastTsOf.get(id) : null) ?? null, ok: sc.res ? !sc.res.error : null, at: [sc.at] });
        }
      }
    }
    // An out file with an error that no call names.
    for (const d of src.docs) {
      if (d.kind !== 'out' || d.task !== T.task || !hasError(d) || named.has(d.abs)) continue;
      const m = /^(prep|review-prep)-(\d+)\.json$/.exec(path.basename(d.abs));
      if (m) calls.push({ task: T.task, step: m[1] as 'prep' | 'review-prep', brief: Number(m[2]), start: d.ts, end: d.ts, ok: false, at: [d.file] });
      else extra.push({ kind: 'failed', task: T.task, text: `${d.file} holds an error`, at: [d.file], ts: d.ts });
    }
    instancesOf.set(T.task, pairInstances(ledger, calls));
  }
  // The same for the out files of a run that belong to no task.
  for (const d of src.docs) {
    if (d.kind === 'out' && d.task === null && hasError(d) && !named.has(d.abs)) extra.push({ kind: 'failed', task: null, text: `${d.file} holds an error`, at: [d.file], ts: d.ts });
  }

  // 7. the steps of each task
  const compactions: Compaction[] = mains.flatMap(m => m.compactions.filter(c => inWindow(c.ts)).map(c => ({ at: cite(m.file, c.line), ts: c.ts })));
  const taskSteps: TaskSteps[] = [];
  const stepFindings: Finding[] = [];
  for (const T of tasks) {
    let pathOf: Path | null = null;
    if (T.inExecution) pathOf = 'large';
    else {
      const triage = [...src.scoped].reverse().find(l => l.event.kind === 'triage' && l.event.task === T.task);
      const p = triage?.event.path;
      if (typeof p === 'string' && PATHS.includes(p)) pathOf = p as Path;
      else if (triage) coverage.push(`no path for ${T.task}`);
    }
    if (pathOf === null) { taskSteps.push({ task: T.task, project: T.project, path: null, steps: [] }); continue; }
    const agentEvents = src.scoped.some(l => l.event.kind === 'agent' && typeof l.event.task === 'string' && briefOf(T.task, l.event.task) !== undefined);
    const r = stepsOf(T.task, pathOf, instancesOf.get(T.task) ?? [], { transcript: mains.length > 0, agentEvents, compactions });
    for (const u of r.unverified) {
      coverage.push(`unverified: ${u.step} of ${T.task}${u.brief === null ? '' : ` brief ${u.brief}`} after ${u.after}: its end is unknown`);
    }
    stepFindings.push(...r.findings);
    taskSteps.push({ task: T.task, project: T.project, path: pathOf, steps: r.rows });
  }

  // 8. repeats
  const refs: CallRef[] = [];
  for (const sc of mainCalls) {
    for (const h of sc.hits) {
      const kind = ONCE_COMMANDS.includes(h.inv.name) ? 'once' : 'forge';
      refs.push({ task: h.t?.task ?? null, key: `${h.inv.name} ${h.inv.task ?? ''}`, kind, ok: okOfCall(sc, h.inv), ts: sc.call.ts, at: sc.at });
    }
    if (sc.agent) {
      refs.push({ task: sc.agent.t.task, key: `${sc.agent.a.type}|${sc.agent.a.description}|${sc.agent.a.task}`, kind: 'agent', ok: sc.res ? !sc.res.error : null, ts: sc.call.ts, at: sc.at });
    }
  }
  const repeatFindings = repeats(refs, compactions);

  // 9. other failures
  const failures: Finding[] = [];
  for (const sc of mainCalls) {
    if (!sc.res?.error) continue;
    for (const h of sc.hits) {
      if (tasks.some(T => stepOfForge(h.inv, T.task) !== null)) continue;
      failures.push({ kind: 'failed', task: h.t?.task ?? null, text: `${h.inv.name} failed`, at: [sc.at], ts: sc.call.ts });
    }
  }

  // 10. findings
  const findings = sortFindings(cited([...stepFindings, ...repeatFindings, ...failures, ...extra]));

  // 11. waiting
  const waiting: Waiting[] = [];
  const pending = (facts: TranscriptFacts, all: boolean): void => {
    for (const c of facts.calls) {
      if (facts.results.has(c.id) || !c.ts) continue;
      if (!all && window.from !== null && time(c.ts) < time(window.from)) continue;
      if (now - time(c.ts) < WAITING_MS) continue;
      waiting.push({ at: cite(facts.file, c.line), ts: c.ts, tool: c.tool, forge: c.forge[0]?.name ?? null, minutes: Math.floor((now - time(c.ts)) / 60_000) });
    }
  };
  for (const m of mains) pending(m, false);
  for (const s of subs) pending(s.facts, true);
  waiting.sort((a, b) => time(a.ts) - time(b.ts) || compareCites(a.at, b.at));

  // 12. usage
  const rows: UsageRow[] = [];
  for (const m of mains) {
    const mine = m.messages.filter(x => inWindow(x.ts));
    rows.push({ file: m.file, agentId: null, usageLines: mine.reduce((n, x) => n + x.lines, 0), messages: mine.length, tokens: mine.reduce((t, x) => addTokens(t, x.tokens), ZERO_TOKENS) });
  }
  for (const s of subs) {
    rows.push({
      file: s.facts.file, agentId: s.agentId, usageLines: s.facts.messages.reduce((n, x) => n + x.lines, 0), messages: s.facts.messages.length,
      tokens: s.facts.messages.reduce((t, x) => addTokens(t, x.tokens), ZERO_TOKENS),
    });
  }

  // 13. the timeline
  const entries: Entry[] = [];
  for (const l of src.scoped) {
    const e = l.event;
    const detail = [e.phase, e.action, e.path, e.agent].filter((x): x is string => typeof x === 'string');
    entries.push({ ts: e.ts, at: cite('.forge/ledger.jsonl', l.line), source: 'ledger', what: [e.kind, ...detail].join(' '), task: typeof e.task === 'string' ? e.task : null });
  }
  for (const d of src.docs) {
    if (d.kind === 'execution') {
      entries.push({ ts: d.ts, at: d.file, source: 'file', what: 'execution started', task: null });
      for (const [task, t] of Object.entries(src.exec?.tasks ?? {})) {
        if (!Number.isNaN(time(t.updatedAt))) entries.push({ ts: t.updatedAt, at: d.file, source: 'file', what: `${task} ${t.status} at ${t.stage}`, task });
      }
    } else {
      entries.push({ ts: d.ts, at: d.file, source: 'file', what: `${d.kind}${hasError(d) ? ' with an error' : ''}`, task: d.task });
    }
  }
  const describe = (sc: ScopedCall): string => {
    const names = [...sc.hits.map(h => `forge ${h.inv.name}`), ...(sc.agent ? [`Agent ${sc.agent.a.type} ${sc.agent.a.description}`] : [])].join(', ');
    const res = !sc.res ? 'no result' : sc.res.error ? `failed${sc.res.exit === null ? '' : ` (exit ${sc.res.exit})`}` : sc.call.background || sc.res.launched ? 'launched' : 'ok';
    return `${names}: ${res}`;
  };
  const named1 = (sc: ScopedCall): string | null => sc.hits.find(h => h.t)?.inv.task ?? sc.agent?.a.task ?? null;
  for (const sc of mainCalls) if (sc.call.ts) entries.push({ ts: sc.call.ts, at: sc.at, source: 'transcript', what: describe(sc), task: named1(sc) });
  for (const c of compactions) entries.push({ ts: c.ts, at: c.at, source: 'transcript', what: 'conversation compacted', task: null });
  for (const s of subs) {
    for (const sc of scopedOf(s.facts)) if (sc.call.ts) entries.push({ ts: sc.call.ts, at: sc.at, source: 'subagent', what: describe(sc), task: named1(sc) });
  }

  return {
    scope: scope.kind === 'task' ? { task: scope.task, project: scope.project } : { execution: scope.runId },
    now: opts.now.toISOString(),
    window,
    findings,
    waiting,
    tasks: taskSteps,
    usage: { transcripts: rows, total: rows.reduce((t, r) => addTokens(t, r.tokens), ZERO_TOKENS) },
    coverage,
    sources,
    timeline: sortTimeline(entries),
  };
}
