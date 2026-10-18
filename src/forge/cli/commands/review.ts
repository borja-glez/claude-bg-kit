import type { Command } from '../context.js';
import { reviewCommand } from '../review.js';
import { defaultExec, defaultGit, repoReader } from '../exec.js';

export const command: Command = (args, ctx) => {
  const { io, repoDir, cmd } = ctx;
  return reviewCommand(cmd, args, {
    cwd: io.cwd, repoDir, now: io.now, git: io.git ?? defaultGit(repoDir), exec: io.exec ?? defaultExec(repoDir), execMany: io.execMany, repo: repoReader(repoDir),
    self: io.scriptPath ?? process.argv[1],
    slot: io.slot,
  });
};
