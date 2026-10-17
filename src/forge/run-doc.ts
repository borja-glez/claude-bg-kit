// J-15: meta/run, the roadmap's RunDoc, built by the CLI from the execution (swarm status, swarm step). The skills send
// it as it is: no skill composes meta/run.
import { readFileSync } from 'node:fs';
import { executionTaskFile } from './execution.js';
import { readLoose } from './loose.js';
import { normalizePublicTask, type ExecutionState } from '../lib/execution-state.js';
import { cleanText } from '../lib/batches.js';
import type { LooseRunTask, LooseStatus, RunDoc } from '../lib/types.js';

const STALL_MAX = 200;

/** Who runs a task: the coordinator for its subagents; for a member, the session of its public file. */
function byOf(root: string, e: ExecutionState, task: string): string {
  if (e.tasks[task]?.executor === 'subagents') return e.coordinator;
  try {
    const p = normalizePublicTask(JSON.parse(readFileSync(executionTaskFile(root, task), 'utf8')));
    if (p && p.task === task && p.runId === e.runId) return p.by;
  } catch { /* none yet */ }
  return e.coordinator;
}

/** meta/run.loose of an ephemeral run: one entry per task of .forge/loose.json, in its order (stopped is published as blocked). */
function looseOf(root: string, e: ExecutionState): LooseRunTask[] {
  return (readLoose(root, e.runId)?.tasks ?? []).map(l => {
    const t = e.tasks[l.id];
    const status: LooseStatus = !t ? 'queued' : t.status === 'accepted' ? 'running' : t.status === 'stopped' ? 'blocked' : t.status;
    const from = t ? Date.parse(t.startedAt) : NaN, to = t?.finishedAt ? Date.parse(t.finishedAt) : NaN;
    return {
      id: l.id, title: cleanText(l.title, 200) || l.id, status, stage: t ? t.stage : null, agent: t?.agent ?? null,
      ...(Number.isFinite(from) && Number.isFinite(to) && to >= from ? { seconds: Math.round((to - from) / 1000) } : {}),
    };
  });
}

/** The RunDoc of an execution: one slot per running task, its start, last step, stall reason and closing (wave 4). */
export function runDocOf(root: string, e: ExecutionState): RunDoc {
  const slots = Object.entries(e.tasks).filter(([, t]) => t.status === 'running')
    .map(([task, t]) => ({ task, stage: t.stage, agent: t.agent, by: byOf(root, e, task), since: t.stageSince }));
  const doc: RunDoc = {
    runId: e.runId, mode: e.mode, parallel: e.parallel, branch: e.branch, mergeOnFinish: e.mergeOnFinish, active: e.active,
    stopReason: e.active ? null : e.stopReason, coordinator: e.coordinator, slots, kind: e.kind, loose: e.kind === 'ephemeral' ? looseOf(root, e) : [],
    startedAt: e.startedAt,
  };
  if (e.lastStepAt) doc.lastStepAt = e.lastStepAt;
  // Carry 3: one clean line, as the page keeps it.
  const stall = e.stallReason ? cleanText(e.stallReason, STALL_MAX) : '';
  if (stall) doc.stallReason = stall;
  if (e.closedAt) doc.closedAt = e.closedAt;
  return doc;
}
