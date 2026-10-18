import type { SwarmCommand } from './context.js';
import { UsageError } from '../errors.js';
import { readExecution } from '../../execution.js';

export const subcommand: SwarmCommand = (rest, ctx) => {
  const { io, flag, ok, update } = ctx;
  const reason = flag('reason') ?? 'stopped';
  if (reason !== 'stopped' && reason !== 'budget') throw new UsageError('swarm stop: --reason must be stopped or budget');
  const e = readExecution(io.cwd);
  if (e?.active) update(cur => (cur?.active ? { ...cur, active: false, stopReason: reason, sleepUntil: null } : null));
  return ok();
};
