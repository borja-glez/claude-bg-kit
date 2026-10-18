import type { Command } from '../context.js';
import { swarmCommand } from '../swarm.js';
import { swarmStep } from '../step.js';
import { defaultExec, defaultExecMany, defaultGit, repoReader } from '../exec.js';

export const command: Command = (args, ctx) => {
  const { io, repoDir, run } = ctx;
  return swarmCommand(args, io, {
    git: io.git ?? defaultGit(io.cwd), exec: io.exec ?? defaultExec(io.cwd), execMany: io.execMany, repo: repoReader(repoDir),
    at: dir => ({ git: defaultGit(dir), exec: defaultExec(dir), execMany: defaultExecMany(dir), repo: repoReader(dir) }),
  }, { step: rest => swarmStep(rest, io, { cli: argv => run(argv, io), gitAt: dir => defaultGit(dir) }) });
};
