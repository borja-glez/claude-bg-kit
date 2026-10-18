import type { Command } from '../context.js';
import { samePath } from '../../../lib/worktree.js';
import { runSetup } from '../swarm.js';
import { mainCheckout } from '../../local.js';
import { defaultExec, defaultGit, repoReader } from '../exec.js';

export const command: Command = (args, ctx) => {
  const { io, repoDir, json } = ctx;
  // J-17: the dependencies of a directory (--cwd: a worktree) installed as swarm installs a task worktree's:
  // swarm.setup of the main checkout's config, else the install command of the directory's lockfile.
  const main = mainCheckout(io.cwd);
  const defaults = (dir: string) => ({ git: defaultGit(dir), exec: defaultExec(dir), repo: repoReader(dir) });
  const setup = runSetup({
    git: io.git ?? defaultGit(repoDir), exec: io.exec ?? defaultExec(repoDir), repo: repoReader(repoDir),
    at: dir => (samePath(dir, repoDir) ? { git: io.git ?? defaultGit(dir), exec: io.exec ?? defaultExec(dir), repo: repoReader(dir) } : defaults(dir)),
  }, repoDir, main);
  return json({ setup });
};
