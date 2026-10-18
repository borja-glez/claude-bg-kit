import type { Command } from '../context.js';
import { appendEvent, readEvents } from '../../ledger.js';
import { executionHolding } from '../../execution.js';
import { loadConfig } from '../../config.js';
import { UsageError } from '../errors.js';
import { roundDecision } from '../../round.js';
import { baseOf, resolveProject } from '../../task-ref.js';

export const command: Command = (args, ctx) => {
  const { io, repoDir, flag, json, ts } = ctx;
  const task = flag('task');
  const p = flag('path');
  if (!task || (p !== 'medium' && p !== 'large')) throw new UsageError('round: --task and --path medium|large are required');
  const ledger = readEvents(io.cwd);
  const project = resolveProject({ flag: flag('project'), task, events: ledger });
  // Carry 3: in an execution, only its own verdicts count.
  const d = roundDecision(ledger, task, p, loadConfig(repoDir).profile, project, executionHolding(io.cwd, { project, task: baseOf(task) })?.startedAt ?? null);
  appendEvent(io.cwd, { ts: ts(), kind: 'round', task, ...d });
  return json(d);
};
