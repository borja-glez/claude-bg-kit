import type { Command } from '../context.js';
import { hasRunStamp } from '../../execution.js';
import { isRunBranch } from '../../../lib/execution-state.js';
import { defaultBranchOf, type GitRun } from '../../../lib/git-info.js';
import { claudeSessionId, noClaudeSession } from '../../../lib/claude-session.js';
import { UsageError } from '../errors.js';
import { mofAsk, pendingAuth } from '../../auth.js';
import { defaultGit } from '../exec.js';

/** I-03: whether `b` is the repository's default branch, by the rule swarm start refuses it as a run branch with. */
const isDefaultBranch = (git: GitRun, b: string): boolean => defaultBranchOf(git) === b;

export const command: Command = (args, ctx) => {
  const { io, flag, has, json } = ctx;
  // I-03: the start question of a run that may merge by itself at the end. The skill asks `ask` as printed and the
  // hook `answer` records the person's answer, which `swarm start --merge-on-finish` checks. With --run (the id
  // swarm propose printed) it is tied to that run; without it (auto mode at launch, before any plan) to this session
  // and to the project --project names (the question says it), for 24 hours.
  const usage = 'usage: forge authorize merge-on-finish --branch <b> [--run <runId> | --project <P> [--hook-session <id>]] [--locale es|en]';
  if (args[0] !== 'merge-on-finish') throw new UsageError(usage);
  const branch = flag('branch');
  if (!branch || !isRunBranch(branch)) throw new UsageError(`authorize merge-on-finish: --branch must be the branch the run merges into; ${usage}`);
  if (has('run') && !hasRunStamp(flag('run'))) throw new UsageError('authorize merge-on-finish: --run must be the run id swarm propose printed (<project>-<stamp>)');
  const loc = flag('locale');
  if (has('locale') && loc !== 'es' && loc !== 'en') throw new UsageError('authorize merge-on-finish: --locale must be es or en');
  const runId = flag('run') ?? null;
  const project = runId ? undefined : flag('project');
  if (!runId && !project) throw new UsageError(`authorize merge-on-finish: --project <P> is required without --run (a yes asked before the run exists counts for that project only); ${usage}`);
  const session = runId ? null : claudeSessionId(flag('hook-session'), io.env ?? process.env);
  if (!runId && !session) throw new UsageError(noClaudeSession('authorize merge-on-finish', '--hook-session'));
  const isDefault = isDefaultBranch(io.git ?? defaultGit(io.cwd), branch);
  const p = pendingAuth(io.cwd, {
    kind: 'merge-on-finish', runId, target: branch, session, now: io.now(), rand: io.rand ?? Math.random, project,
    build: id => mofAsk(id, branch, loc === 'es', isDefault, project),
  });
  return json({ authId: p.authId, runId, ask: p.ask });
};
