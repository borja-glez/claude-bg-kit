import type { Command } from '../context.js';
import { loadConfig, agentFor, ROLES } from '../../config.js';

export const command: Command = (args, ctx) => {
  const { io, json } = ctx;
  const { profile } = loadConfig(io.cwd);
  return json({ profile, agents: Object.fromEntries(ROLES.map(r => [r, agentFor(r, profile)])) });
};
