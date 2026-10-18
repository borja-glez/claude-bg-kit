import type { Command } from '../context.js';
import { spPlans } from '../../superpowers.js';
import { committedAt } from '../shared.js';

export const command: Command = (args, ctx) => {
  const { io, repoDir, json } = ctx;
  return json(spPlans(repoDir, io.now().getTime(), { committedAt: committedAt(io, repoDir) }));
};
