// K2-13: the flow passes of a run, each in its folder .forge/work/flow-<runId>-<n>/ of forge's own state (the
// coordinator's main checkout): what a pass plans and when a phase asks for one live here too.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { loadConfig, verifyFlow, type FlowMode } from './config.js';
import { readExecution } from './execution.js';
import { parsePlan } from '../lib/plan.js';
import type { ExecutionState } from '../lib/execution-state.js';
import type { PlanTask } from '../lib/types.js';

export const flowDirName = (runId: string, n: number): string => `flow-${runId}-${n}`;

/** The folders of a run's flow passes under `root`, oldest first. */
export function flowDirs(root: string, runId: string): string[] {
  const re = new RegExp(`^flow-${runId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`);
  let names: string[] = [];
  try { names = readdirSync(path.join(root, '.forge', 'work')); } catch { return []; }
  return names.map(name => ({ name, m: re.exec(name) }))
    .filter((x): x is { name: string; m: RegExpExecArray } => x.m !== null)
    .sort((a, b) => Number(a.m[1]) - Number(b.m[1]))
    .map(x => path.join(root, '.forge', 'work', x.name));
}

/**
 * The commit a flow pass diffs from: the last pass's (execution.flow); else the first parent of the run's first
 * integration on HEAD. That integration is the oldest merge among the shas the run recorded for its tasks; with none
 * recorded, the oldest merge titled `forge: integrate <T>` of one of its tasks since the run started (the run branch
 * is reused across runs, and plan ids repeat). Null before any.
 */
export function flowSince(
  e: Pick<ExecutionState, 'flow' | 'tasks'> & { startedAt?: string }, git: (args: string[]) => string | null,
): string | null {
  if (e.flow?.sha) return e.flow.sha;
  const recorded = Object.values(e.tasks).map(t => t.sha).filter((s): s is string => typeof s === 'string' && s.length > 0);
  if (recorded.length) {
    for (const line of (git(['log', '--merges', '--reverse', '--format=%H %P', 'HEAD']) ?? '').split('\n')) {
      const [sha, parent] = line.trim().split(' ');
      if (sha && parent && recorded.some(r => sha === r || (r.length >= 7 && sha.startsWith(r)))) return parent;
    }
    // None of them is in HEAD's history (a rewritten one, for example): fall back to the scan.
  }
  const ids = new Set(Object.keys(e.tasks));
  const args = ['log', '--merges', '--reverse', '--format=%H %P%x09%s'];
  if (e.startedAt) args.push(`--since=${e.startedAt}`);
  for (const line of (git([...args, 'HEAD']) ?? '').split('\n')) {
    const [shas, subject] = line.split('\t');
    const m = /^forge: integrate (.+)$/.exec((subject ?? '').trim());
    const parent = shas?.trim().split(' ')[1];
    if (m && ids.has(m[1]) && parent) return parent;
  }
  return null;
}

/** The run's tasks whose integration (`forge: integrate <T>`) is in since..HEAD, oldest first. */
export function integratedSince(e: Pick<ExecutionState, 'tasks'>, git: (args: string[]) => string | null, since: string): string[] {
  const ids = new Set(Object.keys(e.tasks));
  const out: string[] = [];
  for (const subject of (git(['log', '--merges', '--reverse', '--format=%s', `${since}..HEAD`]) ?? '').split('\n')) {
    const m = /^forge: integrate (.+)$/.exec(subject.trim());
    if (m && ids.has(m[1]) && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** The brief of a flow pass, for the verify agent (in English, for the model; the titles are the plan's): the run branch
 *  as it is, at depth flow, and what each task integrated since the last pass was meant to do. */
export function flowBrief(runId: string, n: number, tasks: { id: string; title: string; done_when: string | null }[]): string {
  return [
    `# Flow pass ${n} of ${runId}`, '',
    'Verify the run branch as it is now, at depth flow: the flows these integrated tasks were meant to deliver, together.',
    'A failed check is a finding of the run, not of one task.', '',
    ...tasks.map(t => `- ${t.id}: ${t.title}${t.done_when ? ` — done when ${t.done_when}` : ''}`), '',
  ].join('\n');
}

/** A pass's flow.json, written by verify-plan --run. */
export interface FlowDoc { runId: string; n: number; id: string; since: string; head: string; at: string }

/** The flow.json of a pass's folder, or null when there is none or it is not one. */
export function readFlow(dir: string): FlowDoc | null {
  try {
    const o = JSON.parse(readFileSync(path.join(dir, 'flow.json'), 'utf8')) as Partial<FlowDoc>;
    const ok = typeof o.runId === 'string' && Number.isInteger(o.n) && typeof o.id === 'string' && typeof o.since === 'string'
      && typeof o.head === 'string' && typeof o.at === 'string';
    return ok ? o as FlowDoc : null;
  } catch { return null; }
}

/** The phase of `task` when every task of that phase is finished; null otherwise. */
export function closedPhase(tasks: Pick<PlanTask, 'id' | 'phase'>[], task: string, finished: (id: string) => boolean): string | null {
  const phase = tasks.find(t => t.id === task)?.phase;
  return phase && tasks.filter(t => t.phase === phase).every(t => finished(t.id)) ? phase : null;
}

/**
 * K2-13, verify.flow `phase`: the phase whose last task this integration finished (every task of it integrated in the run,
 * or done on the roadmap: `<db>/state/<T>.json`), so the coordinator runs a flow pass; null otherwise, or when the config
 * or the plan does not read.
 */
export function phaseToVerify(root: string, planFile: string, db: string, task: string): string | null {
  let mode: FlowMode;
  try { mode = verifyFlow(loadConfig(root)); } catch { return null; }
  if (mode !== 'phase') return null;
  let tasks: PlanTask[];
  try { tasks = parsePlan(readFileSync(path.resolve(root, planFile), 'utf8')).tasks; } catch { return null; }
  const e = readExecution(root);
  const done = (id: string): boolean => {
    try { return (JSON.parse(readFileSync(path.resolve(root, db, 'state', `${id}.json`), 'utf8')) as { status?: unknown } | null)?.status === 'done'; } catch { return false; }
  };
  return closedPhase(tasks, task, id => e?.tasks[id]?.status === 'integrated' || done(id));
}
