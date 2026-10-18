import { UsageError } from '../errors.js';
import type { Result } from '../context.js';
import type { ExecResult, Io } from '../run.js';
import type { ExecMany, RepoReader } from '../../validators.js';
import { readExecution, updateExecution, type LockDeps } from '../../execution.js';
import { mainCheckout } from '../../local.js';
import { readMember, isMemberId } from '../../members.js';
import { isPlanId } from '../../../lib/plan.js';
import type { ExecutionState } from '../../../lib/execution-state.js';

export interface GitDeps { git: (args: string[]) => string | null; exec: (cmd: string, timeoutSec: number) => ExecResult; execMany?: ExecMany; repo: RepoReader }
export interface SwarmDeps extends GitDeps { at: (dir: string) => GitDeps }
/** What run.ts gives swarm for `swarm step` (cli/step.ts), so this folder never imports run.ts. */
export type SwarmExt = { step?: (rest: string[]) => Result };

/** I-12: what every swarm subcommand gets besides its arguments: the prologue of swarmCommand, built once per call. */
export function swarmCtx(sub: string, rest: string[], io: Io, deps: SwarmDeps, ext: SwarmExt) {
  const flag = (name: string) => {
    const i = rest.indexOf(`--${name}`);
    const v = i >= 0 ? rest[i + 1] : undefined;
    return v === undefined || v.startsWith('--') ? undefined : v;
  };
  const has = (name: string) => rest.includes(`--${name}`);
  const json = (v: unknown): Result => ({ code: 0, stdout: JSON.stringify(v, null, 2) + '\n', stderr: '' });
  const ok = (): Result => ({ code: 0, stdout: 'ok\n', stderr: '' });
  const now = io.now();
  const iso = now.toISOString();
  const current = () => {
    const e = readExecution(io.cwd);
    if (!e) throw new UsageError(`swarm ${sub}: no execution (forge swarm start)`);
    return e;
  };
  // K2-02: an execution forge stop stopped, or one closed, stays as it is: a step or an agent still at work when the person
  // stopped it records nothing more. One that is only inactive (stalled) still moves: swarm retry revives it.
  const notEnded = (x: ExecutionState): ExecutionState => {
    if (x.closedAt) throw new UsageError(`swarm ${sub}: the execution ${x.runId} is closed; nothing of it moves any more`);
    if (!x.active && x.stopReason === 'stopped') throw new UsageError(`swarm ${sub}: the execution ${x.runId} is stopped (forge stop); nothing of it moves any more`);
    return x;
  };
  // I-15: every write of execution.json reads it again under its lock and changes only what this command changes.
  const lockDeps: LockDeps = { now: io.now, sleep: io.sleep };
  const update = (fn: (cur: ExecutionState | null) => ExecutionState | null) => updateExecution(io.cwd, fn, lockDeps);
  const taskArg = () => {
    const t = rest[0];
    if (!t || !isPlanId(t)) throw new UsageError(`swarm ${sub}: a task id is required`);
    return t;
  };
  // Members read the execution of the main checkout from any worktree and never write execution.json.
  const memberCtx = (needMember: boolean) => {
    const main = mainCheckout(io.cwd);
    const e = readExecution(main);
    if (!e?.active) throw new UsageError(`swarm ${sub}: no active execution`);
    if (e.kind === 'ephemeral') throw new UsageError(`swarm ${sub}: an ephemeral run takes no members`);
    const session = flag('session') ?? flag('member');
    if (!session) throw new UsageError(`swarm ${sub}: --session is required`);
    if (!isMemberId(session)) throw new UsageError(`swarm ${sub}: --session ${session.slice(0, 130)} is not a valid session id (letters, digits, _ - .; max 120)`);
    const m = needMember ? readMember(main, session) : null;
    if (needMember && (!m || m.runId !== e.runId)) throw new UsageError(`swarm ${sub}: ${session} has not joined this execution`);
    return { main, e, session, m };
  };
  return { sub, rest, io, deps, ext, flag, has, json, ok, now, iso, current, notEnded, lockDeps, update, taskArg, memberCtx };
}
export type SwarmCtx = ReturnType<typeof swarmCtx>;
/** A swarm subcommand: its arguments after the subcommand's name, and the context of the call. */
export type SwarmCommand = (rest: string[], ctx: SwarmCtx) => Result;
