import type { Command } from '../context.js';
import { UsageError } from '../errors.js';
import { spSkillPath } from '../../superpowers.js';
import { superpowersOf } from '../shared.js';

export const command: Command = (args, ctx) => {
  const { io, repoDir, json } = ctx;
  const skill = args[0];
  if (!skill || skill.startsWith('--')) throw new UsageError('sp-path: the name of a superpowers skill is required');
  return json(spSkillPath(superpowersOf(io, repoDir), skill));
};
