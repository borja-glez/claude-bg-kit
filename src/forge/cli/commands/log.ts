import type { Command } from '../context.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { appendEvent, readEvents, LEDGER_KINDS, type LedgerKind } from '../../ledger.js';
import { readExecution } from '../../execution.js';
import { isSafeId } from '../../../lib/execution-state.js';
import { parsePlan } from '../../../lib/plan.js';
import { UsageError } from '../errors.js';
import { projectOf } from '../../task-ref.js';
import { mainCheckout } from '../../local.js';

const MAX_WHY = 200;

export const command: Command = (args, ctx) => {
  const { io, flag, ok, ts } = ctx;
  const kind = flag('kind');
  if (!kind || !(LEDGER_KINDS as readonly string[]).includes(kind)) throw new UsageError(`log: --kind must be one of ${LEDGER_KINDS.join('|')}`);
  let data: Record<string, unknown> = {};
  if (flag('data') !== undefined && flag('data-file') !== undefined) throw new UsageError('log: use --data or --data-file, not both');
  if (flag('data') !== undefined || flag('data-file') !== undefined) {
    const label = flag('data-file') !== undefined ? '--data-file' : '--data';
    let parsed: unknown;
    try {
      const raw = flag('data-file') !== undefined ? readFileSync(path.resolve(io.cwd, flag('data-file')!), 'utf8') : flag('data')!;
      parsed = JSON.parse(raw);
    } catch { throw new UsageError(`log: ${label} must be a JSON object`); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new UsageError(`log: ${label} must be a JSON object`);
    data = parsed as Record<string, unknown>;
  }
  // A raise logged by the session may say why; the next triage of the task announces it.
  if (kind === 'triage' && data.why !== undefined) {
    // One line without a trailing stop: the announcement adds its own.
    const why = typeof data.why === 'string' ? data.why.replace(/\s+/g, ' ').trim().replace(/[\s.;:,]+$/, '').trim() : null;
    if (why === null || why.length > MAX_WHY) throw new UsageError(`log: a triage why must be a string of at most ${MAX_WHY} characters`);
    data = { ...data, why };
  }
  // FX1: an agent the session logs is the one it spawned, never one forge named (swarm step's and `agents --task`'s carry
  // `by`): a `by` it brings is dropped.
  if (kind === 'agent' && 'by' in data) { const { by: _by, ...rest } = data; data = rest; }
  const task = flag('task');
  // A plan task's triage only counts the events of its plan's project (ids repeat between plans): a raise without
  // one takes the active plan execution's project when the task is one of its tasks (started, or in its plan
  // docs/waypoint/<project>/plan.yaml, an unreadable plan counting as none), else the project of the task's
  // latest triage, none when that triage was of a loose task (D-08).
  if (kind === 'triage' && task && data.project === undefined) {
    const main = mainCheckout(io.cwd);
    const exec = readExecution(main);
    const inPlan = (project: string) => {
      if (!isSafeId(project)) return false;
      try { return parsePlan(readFileSync(path.join(main, 'docs', 'waypoint', project, 'plan.yaml'), 'utf8')).tasks.some(t => t.id === task); } catch { return false; }
    };
    const project = exec?.active && exec.kind === 'plan' && (Object.hasOwn(exec.tasks, task) || inPlan(exec.project)) ? exec.project
      : projectOf(readEvents(io.cwd), task);
    if (project) data = { ...data, project };
  }
  appendEvent(io.cwd, { ...data, ts: ts(), kind: kind as LedgerKind, ...(task ? { task } : {}) });
  return ok('ok');
};
