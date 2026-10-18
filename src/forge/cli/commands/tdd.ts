import type { Command } from '../context.js';
import { tddFor } from '../shared.js';

export const command: Command = (args, ctx) => {
  const { io, repoDir, json } = ctx;
  return json(tddFor(io, repoDir));
};
