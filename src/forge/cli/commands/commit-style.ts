import type { Command } from '../context.js';
import { defaultGit } from '../exec.js';
import { mainCheckout } from '../../local.js';
import { commitStyleAt } from '../../../lib/commit-style.js';

/**
 * w9, forge commit-style: the style of the commit titles of the code's repository, `{style, source}`: `conventional` or
 * `plain`, from `commits.style` of the main checkout's `.forge/config.yaml` (`config`), from the recent commits
 * (`history`), or, while those are too few to say, from FORGE_COMMIT_STYLE (`env`), else `plain` (`default`). The skills
 * that compose a commit title themselves (infinite's phases, the decisions) read it once.
 */
export const command: Command = (_args, ctx) => {
  const { io, repoDir, json } = ctx;
  return json(commitStyleAt(mainCheckout(repoDir), io.git ?? defaultGit(repoDir), io.env ?? process.env));
};
