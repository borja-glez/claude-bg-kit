import type { SwarmCommand } from './context.js';
import { UsageError } from '../errors.js';

export const subcommand: SwarmCommand = (rest, ctx) => {
  const { ext } = ctx;
  // D-12: cli/step.ts, given by run.ts (it calls the CLI itself: no import of run.ts here).
  if (!ext.step) throw new UsageError('swarm step: not available here');
  return ext.step(rest);
};
