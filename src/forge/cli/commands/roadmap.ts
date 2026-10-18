import type { Command } from '../context.js';
import { roadmapCommand } from '../roadmap.js';

export const command: Command = (args, ctx) => {
  const { io, cmd } = ctx;
  // C7 (wave 4): the roadmap documents the CLI builds; their own exit codes (2, and 3 for a block that does not fit).
  return roadmapCommand(cmd, args, io);
};
