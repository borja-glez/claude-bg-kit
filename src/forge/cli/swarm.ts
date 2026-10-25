import { UsageError } from './errors.js';
import type { Result } from './context.js';
import type { Io } from './run.js';
import { mainWorktreeFrom, samePath } from '../../lib/worktree.js';
import { swarmCtx, type SwarmDeps } from './swarm/context.js';
import { SUBCOMMANDS } from './swarm/index.js';
import { activeProfileAt, NO_EXECUTION } from '../profile.js';

// I-12: what moved out of this file keeps its import path for the other modules and the tests.
export type { GitDeps, SwarmDeps } from './swarm/context.js';
export { setupFor, runSetup, restoringRegenerated, type SetupPlan, type SetupResult } from './swarm/setup.js';
export { checkPlanProject, releaseWrites } from './swarm/shared.js';
export { commitInfo, integratedPublish } from './swarm/integration.js';
export { SUBCOMMANDS } from './swarm/index.js';

const SWARM_USAGE = 'usage: forge swarm <start --project P --session SID --hook-session ID [--plan P] [--mode M] [--parallel N] [--run-id R] [--merge-on-finish] [--branch B] [--kind plan|ephemeral] [--tasks F] [--locale CODE]|status|propose --plan P|--tasks F [--locale es|en]|worktree <T>|task <T> --stage S [--agent A|--no-agent] [--round N] [--status S] [--detail-file F] [--lease ISO] [--lease-minutes N] [--claim]|task <T> --drop|tick [--plan P --db DIR] [--agents F]|step --plan P --db DIR [--agents F] [--returned T1,T2] [--versions F] [--locale es|en]|relaunch <T> --plan P|nudge <T> [--plan P]|integrate <T> [--locale es|en] [--retry-deps] [--no-cache]|merge [--yes] [--hook-session ID] [--locale es|en] [--retry-deps]|retry <T> [--adopt] [--hook-session ID]|sleep <seconds> [--mark]|stop [--reason stopped|budget]|close|cleanup [--dry-run]|join --session SID --role executor|manual [--task T] [--name N] [--hook-session ID]|report <T> --session SID --stage S [--agent A|--no-agent] [--round N] [--status S] [--lease ISO] [--claim]|worktree <T> --member SID|next --plan P --db DIR --session SID|takeover --session SID --hook-session ID>';

export function swarmCommand(args: string[], io: Io, deps: SwarmDeps, ext: { step?: (rest: string[]) => Result } = {}): Result {
  const [sub, ...rest] = args;
  const ctx = swarmCtx(sub, rest, io, deps, ext);
  const { has } = ctx;
  // T6B2-NO-EXECUTION: swarm start says why it does not run inside an active profile's worktree, before the main-checkout
  // rule below, whose advice (run it from the main checkout) would move the execution onto the person's checkout.
  if (sub === 'start' && activeProfileAt(io.cwd)) throw new UsageError(`swarm start: ${NO_EXECUTION}`);
  if (['start', 'tick', 'integrate', 'merge', 'sleep', 'worktree', 'retry', 'relaunch', 'nudge', 'takeover', 'step', 'cleanup'].includes(sub ?? '') && !(sub === 'worktree' && has('member'))) {
    const top = deps.git(['rev-parse', '--show-toplevel'])?.trim();
    const main = mainWorktreeFrom(deps.git(['worktree', 'list', '--porcelain']));
    if (!top || !main || !samePath(top, main)) {
      throw new UsageError(`swarm ${sub}: run it from the main checkout${main ? ` (${main})` : ''}, not from a worktree`);
    }
  }
  const fn = sub !== undefined && Object.hasOwn(SUBCOMMANDS, sub) ? SUBCOMMANDS[sub] : undefined;
  if (!fn) throw new UsageError(SWARM_USAGE);
  return fn(rest, ctx);
}
