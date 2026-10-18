import type { Command } from '../context.js';
import { UsageError } from '../errors.js';
import { onPath } from '../../validators.js';
import { checkTools } from '../../tools.js';
import { readSurfaces } from '../../surfaces.js';
import { defaultExec } from '../exec.js';
import { mcpOf } from '../shared.js';

export const command: Command = (args, ctx) => {
  const { io, repoDir, flag, json } = ctx;
  // The surfaces of the code checked (--cwd: a task's worktree).
  const all = readSurfaces(repoDir);
  const one = flag('surface');
  const picked = one === undefined ? all : all.filter(s => s.name === one);
  if (one !== undefined && !picked.length) throw new UsageError(`tools: no surface ${one} in .forge/verify/`);
  const names = picked.flatMap(s => s.tools);
  return json(checkTools(names, { onPath, inventory: names.length ? mcpOf(io, repoDir) : new Set(), exec: io.exec ?? defaultExec(io.cwd) }));
};
