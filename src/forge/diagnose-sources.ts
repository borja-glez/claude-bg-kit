// A6: what forge diagnose gathers for a scope (a task or a run): the ledger by line, the files under .forge that belong
// to it and the transcripts of its sessions. Read-only: it measures before it reads, and it never repairs, moves or
// prunes anything it finds.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { LEDGER_KINDS, type LedgerEvent } from './ledger.js';
import { attribute, baseOf, eventsOf, projectOfDir, readWorkDir } from './task-ref.js';
import { executionFile, executionTaskFile } from './execution.js';
import { isSafeId, normalizePublicTask, parseExecution, type ExecutionState } from '../lib/execution-state.js';
import { jobsDir, normalizeJob } from './jobs.js';
import { decisionsFile } from './decisions.js';
import { normalizeDecisionsDoc } from '../lib/decisions.js';
import { measureJsonl, scanLines } from './transcript-file.js';

export type Scope = { kind: 'task'; task: string; project: string | null } | { kind: 'execution'; runId: string };
export type SourceKind = 'ledger' | 'execution' | 'execution-task' | 'job' | 'out' | 'findings' | 'asked' | 'overrides' | 'decisions' | 'transcript' | 'subagent' | 'meta';
/** A file diagnose read or looked for, measured before it was read; `file` relative to the main checkout with `/` for .forge, absolute for a transcript. */
export interface Source { file: string; kind: SourceKind; bytes: number | null; lines?: number; long?: number[]; truncated?: boolean; error?: string }
export interface LedgerLine { line: number; event: LedgerEvent }
/** A JSON file of .forge read whole: `ts` is its own time (asked.at, a job's startedAt, a public task's updatedAt, execution.json's startedAt), else its mtime. */
export interface Doc { kind: SourceKind; file: string; abs: string; ts: string; task: string | null; doc: unknown }
export interface ScopeTask { task: string; project: string | null; inExecution: boolean }
export interface ForgeSources {
  main: string; lines: LedgerLine[]; scoped: LedgerLine[]; tasks: ScopeTask[]; exec: ExecutionState | null;
  docs: Doc[]; sources: Source[]; sessions: string[]; coverage: string[];
}

export const DOC_MAX_BYTES = 1024 * 1024;
export const META_MAX_BYTES = 64 * 1024;
export const PROJECT_DIRS_MAX = 1000;
const JOB_FILES_MAX = 200;
const LEDGER_REL = '.forge/ledger.jsonl';

/** Claude Code's folder name for a project directory: each character that is not a letter or a digit becomes `-`. */
export const projectSlug = (dir: string): string => dir.replace(/[^A-Za-z0-9]/g, '-');

const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const rel = (main: string, abs: string): string => path.relative(main, abs).split(path.sep).join('/');
const mtimeIso = (ms: number): string => new Date(ms).toISOString();
const validIso = (x: unknown): string | null => (typeof x === 'string' && Number.isFinite(Date.parse(x)) ? x : null);

/** A ledger line is an event when it is JSON with a string ts, a known kind and a task that is absent or a string. */
function parseEvent(line: string): LedgerEvent | null {
  try {
    const e = JSON.parse(line);
    return isRecord(e) && typeof e.ts === 'string' && (LEDGER_KINDS as readonly string[]).includes(e.kind as string)
      && (e.task === undefined || typeof e.task === 'string') ? (e as LedgerEvent) : null;
  } catch { return null; /* a half-written line */ }
}

export function ledgerLines(main: string): { lines: LedgerLine[]; source: Source } {
  const file = path.join(main, '.forge', 'ledger.jsonl');
  const m = measureJsonl(file);
  if (!m) return { lines: [], source: { file: LEDGER_REL, kind: 'ledger', bytes: null, error: 'missing' } };
  const lines: LedgerLine[] = [];
  const stats = scanLines(file, (text, n) => {
    const event = parseEvent(text);
    if (event) lines.push({ line: n, event });
  });
  if (!stats) return { lines: [], source: { file: LEDGER_REL, kind: 'ledger', bytes: m.bytes, error: 'unreadable' } };
  return {
    lines,
    source: { file: LEDGER_REL, kind: 'ledger', bytes: m.bytes, lines: stats.lines, ...(stats.long.length ? { long: stats.long } : {}), ...(stats.truncated ? { truncated: true } : {}) },
  };
}

export function scopeLines(lines: readonly LedgerLine[], scope: Scope): LedgerLine[] {
  if (scope.kind === 'execution') return lines.filter(l => l.event.runId === scope.runId);
  const byEvent = new Map<LedgerEvent, LedgerLine>(lines.map(l => [l.event, l]));
  return eventsOf(lines.map(l => l.event), { project: scope.project, task: scope.task }).map(e => byEvent.get(e)!).filter(Boolean);
}

/** Whether a run holds the task of a plan project (or, for a loose run, a task with no project). */
const runHoldsTask = (exec: ExecutionState, task: string, project: string | null): boolean =>
  Object.hasOwn(exec.tasks, task) && (exec.kind === 'plan' ? exec.project === project : project === null);

export function forgeSources(main: string, scope: Scope): ForgeSources {
  const { lines, source } = ledgerLines(main);
  const scoped = scopeLines(lines, scope);
  const events = lines.map(l => l.event);
  const sources: Source[] = [source];
  const docs: Doc[] = [];
  const coverage: string[] = [];
  if (source.error === 'missing') coverage.push(`no ledger at ${LEDGER_REL}`);

  // The execution: parsed as it is, never migrated.
  let exec: ExecutionState | null = null;
  try {
    const st = statSync(executionFile(main));
    if (st.isFile() && st.size <= DOC_MAX_BYTES) exec = parseExecution(readFileSync(executionFile(main), 'utf8'));
  } catch { /* none */ }
  if (exec && scope.kind === 'execution' && exec.runId !== scope.runId) exec = null;
  if (exec && scope.kind === 'task' && !runHoldsTask(exec, scope.task, scope.project)) exec = null;

  let tasks: ScopeTask[];
  // A task ran in an execution when one holds it now, or when its events carry a run's id: each event of a task is stamped
  // with it while its run is active, so the task keeps the large path after execution.json holds another run, or none.
  if (scope.kind === 'task') tasks = [{ task: scope.task, project: scope.project, inExecution: exec !== null || scoped.some(l => isSafeId(l.event.runId)) }];
  else if (exec) tasks = Object.keys(exec.tasks).map(task => ({ task, project: exec.kind === 'plan' ? exec.project : null, inExecution: true }));
  else {
    const owner = attribute(events);
    const seen = new Set<string>();
    tasks = [];
    for (const l of scoped) {
      if (typeof l.event.task !== 'string') continue;
      const task = baseOf(l.event.task);
      if (seen.has(task)) continue;
      seen.add(task);
      tasks.push({ task, project: owner(l.event), inExecution: true });
    }
  }

  const addDoc = (abs: string, kind: SourceKind, task: string | null, ownTs?: (doc: unknown) => string | null): Doc | null => {
    const file = rel(main, abs);
    let st;
    try { st = statSync(abs); } catch { return null; }
    if (!st.isFile()) { sources.push({ file, kind, bytes: null, error: 'not a file' }); return null; }
    if (st.size > DOC_MAX_BYTES) { sources.push({ file, kind, bytes: st.size, error: 'too large' }); return null; }
    let doc: unknown;
    try { doc = JSON.parse(readFileSync(abs, 'utf8')); } catch { sources.push({ file, kind, bytes: st.size, error: 'not JSON' }); return null; }
    sources.push({ file, kind, bytes: st.size });
    const d: Doc = { kind, file, abs, ts: ownTs?.(doc) ?? mtimeIso(st.mtimeMs), task, doc };
    docs.push(d);
    return d;
  };
  const names = (dir: string): string[] => { try { return readdirSync(dir).sort(); } catch { return []; } };

  for (const t of tasks) {
    const dir = readWorkDir(main, { project: t.project, task: t.task }, events);
    for (const f of names(dir)) {
      if (/^(prep|review-prep)-\d+\.json$/.test(f)) addDoc(path.join(dir, f), 'out', t.task);
      else if (/^findings-\d+-\d+\.json$/.test(f)) addDoc(path.join(dir, f), 'findings', t.task);
      else if (/^reviews-\d+-\d+$/.test(f)) {
        addDoc(path.join(dir, f, 'asked.json'), 'asked', t.task, d => (isRecord(d) ? validIso(d.at) : null));
        addDoc(path.join(dir, f, 'overrides.json'), 'overrides', t.task);
      }
    }
    if (exec && exec.tasks && Object.hasOwn(exec.tasks, t.task)) {
      const d = addDoc(executionTaskFile(main, t.task), 'execution-task', t.task, x => { const p = normalizePublicTask(x); return p ? p.updatedAt : null; });
      const pub = d ? normalizePublicTask(d.doc) : null;
      if (d && (!pub || pub.runId !== exec.runId || pub.task !== t.task)) {
        docs.pop();
        sources.pop();
        sources.push({ file: d.file, kind: 'execution-task', bytes: null, error: 'not this run' });
      }
    }
  }

  // Jobs: read without checking their pid and without deleting any.
  // A job joins a scope by the pair (project, task): the project is the one its out folder names, none for a loose task.
  // In an execution, a job that writes to the run folder (swarm integrate <T> --out .forge/work/run/integrate-<T>.json)
  // names no project: it joins by its task, which is one of the run's.
  const inScope = new Set(tasks.map(t => JSON.stringify([t.project, t.task])));
  const inRunFolder = (out: string): boolean => {
    const p = out.split(/[\\/]+/);
    return p.length >= 4 && p[p.length - 2] === 'run' && p[p.length - 3] === 'work' && p[p.length - 4] === '.forge';
  };
  for (const f of names(jobsDir(main)).filter(n => n.endsWith('.json')).slice(0, JOB_FILES_MAX)) {
    const abs = path.join(jobsDir(main), f);
    let raw: unknown;
    try {
      const st = statSync(abs);
      if (!st.isFile() || st.size > DOC_MAX_BYTES) continue;
      raw = JSON.parse(readFileSync(abs, 'utf8'));
    } catch { continue; }
    const job = normalizeJob(raw);
    if (!job) continue;
    const owner = job.task === null ? (scope.kind === 'execution' ? '' : null) : baseOf(job.task);
    if (owner === null) continue;
    if (owner !== '') {
      const project = projectOfDir(job.out, job.task as string);
      const ofRun = scope.kind === 'execution' && project === null && inRunFolder(job.out) && tasks.some(t => t.task === owner);
      if (!ofRun && !inScope.has(JSON.stringify([project, owner]))) continue;
    }
    addDoc(abs, 'job', owner === '' ? null : owner, () => job.startedAt);
  }

  if (scope.kind === 'execution' && exec) {
    addDoc(executionFile(main), 'execution', null, d => (isRecord(d) ? validIso(d.startedAt) : null));
    const run = path.join(main, '.forge', 'work', 'run');
    addDoc(path.join(run, 'step.json'), 'out', null);
    for (const task of Object.keys(exec.tasks)) if (isSafeId(task)) addDoc(path.join(run, `integrate-${task}.json`), 'out', null);
  }

  // decisions.json is only measured.
  try {
    const abs = decisionsFile(main);
    const st = statSync(abs);
    const row: Source = { file: rel(main, abs), kind: 'decisions', bytes: st.size };
    if (!st.isFile()) row.error = 'not a file';
    else if (st.size > DOC_MAX_BYTES) row.error = 'too large';
    else {
      try { if (!normalizeDecisionsDoc(JSON.parse(readFileSync(abs, 'utf8')))) row.error = 'not a decisions file'; } catch { row.error = 'not a decisions file'; }
    }
    sources.push(row);
  } catch { /* none */ }

  const sessions: string[] = [];
  for (const l of scoped) {
    const s = l.event.session;
    if (isSafeId(s) && !sessions.includes(s)) sessions.push(s);
  }
  if (exec && isSafeId(exec.hookSession) && !sessions.includes(exec.hookSession)) sessions.push(exec.hookSession);

  for (const t of tasks) {
    const mine = eventsOf(events, { project: t.project, task: t.task });
    if (!mine.some(e => e.kind === 'triage')) coverage.push(`no triage for ${t.task}`);
  }

  return { main, lines, scoped, tasks, exec, docs, sources, sessions, coverage };
}

/** The transcript of each session: <configDir>/projects/<slug of main>/<s>.jsonl first, else <s>.jsonl in any folder of projects/. */
export function transcriptsOf(sessions: readonly string[], configDir: string, main: string): { found: string[]; missing: string[] } {
  const projects = path.join(configDir, 'projects');
  let others: string[] | null = null;
  const folders = (): string[] => {
    if (others === null) { try { others = readdirSync(projects).sort().slice(0, PROJECT_DIRS_MAX); } catch { others = []; } }
    return others;
  };
  const found: string[] = [], missing: string[] = [];
  for (const s of sessions) {
    if (!isSafeId(s)) continue;
    let hit = measureJsonl(path.join(projects, projectSlug(main), `${s}.jsonl`))?.file ?? null;
    if (hit === null) {
      for (const dir of folders()) {
        hit = measureJsonl(path.join(projects, dir, `${s}.jsonl`))?.file ?? null;
        if (hit !== null) break;
      }
    }
    if (hit === null) missing.push(s); else found.push(hit);
  }
  return { found, missing };
}

export interface SubagentFile { file: string; metaFile: string; agentId: string; meta: { agentType: string | null; toolUseId: string | null; spawnDepth: number | null } | null }

export function subagentFile(transcript: string, agentId: string): SubagentFile | null {
  if (!isSafeId(agentId)) return null;
  const dir = path.join(path.dirname(transcript), path.basename(transcript, '.jsonl'), 'subagents');
  const file = path.join(dir, `agent-${agentId}.jsonl`);
  if (!measureJsonl(file)) return null;
  const metaFile = path.join(dir, `agent-${agentId}.meta.json`);
  let meta: SubagentFile['meta'] = null;
  try {
    const st = statSync(metaFile);
    if (st.isFile() && st.size <= META_MAX_BYTES) {
      const o = JSON.parse(readFileSync(metaFile, 'utf8'));
      if (isRecord(o)) {
        meta = {
          agentType: typeof o.agentType === 'string' ? o.agentType : null,
          toolUseId: typeof o.toolUseId === 'string' ? o.toolUseId : null,
          spawnDepth: typeof o.spawnDepth === 'number' && Number.isInteger(o.spawnDepth) ? o.spawnDepth : null,
        };
      }
    }
  } catch { /* lenient */ }
  return { file, metaFile, agentId, meta };
}
