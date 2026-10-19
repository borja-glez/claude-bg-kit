import type { Command } from '../context.js';
import { spPlans } from '../../superpowers.js';
import { committedAt, spContext } from '../shared.js';

export const command: Command = (args, ctx) => {
  const { io, repoDir, json } = ctx;
  const now = io.now().getTime();
  const { main, subjects } = spContext(io, repoDir, now);
  return json(spPlans(repoDir, now, { committedAt: committedAt(io, repoDir), main, subjects }));
};
