import type { Command } from '../context.js';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { appendEvent, readEvents } from '../../ledger.js';
import { parseRun, readRunText, saveRun, stopFile } from '../../run.js';
import { decideStop, decideExecutionStop } from '../../hook.js';
import { readExecution, updateExecution, executionTaskFile } from '../../execution.js';
import { planLocale, replyIn, sessionReply } from '../../../lib/locale.js';
import { normalizePublicTask } from '../../../lib/execution-state.js';
import { UsageError } from '../errors.js';
import { hookRoot, mainCheckout } from '../../local.js';
import { memberForHook } from '../../members.js';
import { hookLive } from '../../live.js';
import { hookRoute } from '../../route-hooks.js';
import { hookAnswer } from '../../auth.js';
import { guardOutput, parseGuardInput, shellCommand, targetPath, type GuardCtx, type GuardInput, type GuardVerdict } from '../../guard.js';
import {
  INVALID_RUN, appendBlocked, autonomousFor, guardError, guardRulesFor, judgeGuard, runMainsOf, type AutonomousCtx,
} from '../../autonomous.js';
import { trustPlace } from '../../trust.js';
import { liveJobs } from '../../jobs.js';
import type { Io } from '../run.js';
import { stopContext, runRootOf } from '../shared.js';

/** How long the Stop hook waits for execution.lock: a hook must not hold the session (the CLI waits LOCK_WAIT_MS). */
const HOOK_LOCK_WAIT_MS = 2000;

// The Stop hook: fail-open (any error prints nothing); prints a block or nothing. An active infinite run decides first
// (an execution runs inside its cycles); otherwise an active execution decides.
function hookStop(io: Io): string {
  try {
    const input: unknown = JSON.parse(io.stdin ?? '');
    if (!input || typeof input !== 'object' || Array.isArray(input)) return '';
    const hookInput = input as { stop_hook_active?: boolean; session_id?: unknown };
    const main = mainCheckout(io.cwd);
    // The execution is bound when it starts (C1): the hook only reads it.
    const exec = readExecution(main);
    // A registered member of this run is never blocked on the execution's behalf.
    const sid = typeof hookInput.session_id === 'string' ? hookInput.session_id : null;
    // Members are found by the hook id they recorded at join (Claude's session_id, not their waypoint SID).
    const member = exec?.active && sid ? memberForHook(main, sid, exec.runId) : null;
    if (member) { hookLive(io, 'Stop'); return ''; }
    hookLive(io, 'Stop');
    const sleeping = !!exec?.active && !!exec.sleepUntil && Date.parse(exec.sleepUntil) > io.now().getTime();
    const runRoot = runRootOf(io.cwd);
    const run = parseRun(readRunText(runRoot));
    if (run?.active) {
      const d = decideStop(hookInput, run, { ...stopContext(runRoot, io.now()), ledgerEvents: readEvents(runRoot).length, swarmSleeping: sleeping });
      if (!d.block) return '';
      saveRun(runRoot, d.run);
      if (d.ended) appendEvent(runRoot, { ts: io.now().toISOString(), kind: 'cycle', action: 'stopped', reason: d.ended });
      return JSON.stringify({ decision: 'block', reason: d.reason + (sessionReply(d.run, exec?.active ? exec : null, () => planLocale(runRoot, exec?.project)) ?? replyIn(null)) }) + '\n';
    }
    // C-03: a job this session launched in the background (prep, review-prep, integrate, step) wakes it when it ends;
    // a member's job, with another session, does not.
    const jobs = sid ? liveJobs(main, io.now()).filter(j => j.session === null || j.session === sid) : [];
    // D-15: the public lease of each running task of this run (.forge/execution/<T>.json), which the skill sets for the
    // budget of the agent it dispatches.
    const leases: Record<string, string> = {};
    for (const [id, t] of Object.entries(exec?.active ? exec.tasks : {})) {
      if (t.status !== 'running') continue;
      try {
        const p = normalizePublicTask(JSON.parse(readFileSync(executionTaskFile(main, id), 'utf8')));
        if (p && p.task === id && p.runId === exec!.runId) leases[id] = p.leaseUntil;
      } catch { /* no public file: the default lease */ }
    }
    const d = decideExecutionStop(hookInput, exec, { now: io.now(), stopFile: existsSync(stopFile(main)), jobs, leases });
    if (!d.block) return '';
    // Under the lock, only what the hook decided: a swarm step or an integrate that wrote meanwhile is kept (I-15). A
    // hook never keeps the session waiting: a lock a live process holds for HOOK_LOCK_WAIT_MS lets it stop as if no
    // block were needed (that process is a step or an integrate of this run, and its end wakes the session).
    try {
      updateExecution(main, cur => (cur && cur.runId === d.exec.runId
        ? { ...cur, lastBlockStep: d.exec.lastBlockStep, ...(d.ended ? { active: false, stopReason: d.exec.stopReason, sleepUntil: null } : {}) }
        : null), { now: io.now, sleep: io.sleep, waitMs: HOOK_LOCK_WAIT_MS });
    } catch (e) { if (e instanceof UsageError) return ''; throw e; }
    // Only an active run speaks for the person: here none is (it decides above).
    return JSON.stringify({ decision: 'block', reason: d.reason + (sessionReply(null, d.exec, () => planLocale(main, d.exec.project)) ?? replyIn(null)) }) + '\n';
  } catch { return ''; }
}

/** The nearest folder that exists, from the folder of a path: where git can be asked about a file that may not exist yet. */
function existingDir(p: string): string {
  let dir = path.dirname(path.resolve(p));
  while (!existsSync(dir) && path.dirname(dir) !== dir) dir = path.dirname(dir);
  return dir;
}

/** `answer` for each folder once: the answers of mainOf and gitCommonDirOf are memoized by the nearest folder that exists. */
function perDir<T>(answer: (dir: string) => T): (p: string) => T {
  const memo = new Map<string, T>();
  return p => {
    const dir = existingDir(p);
    if (!memo.has(dir)) memo.set(dir, answer(dir));
    return memo.get(dir) as T;
  };
}

/**
 * The guard's context for a PreToolUse call (D9), from the hook's directory (hookRoot): the main checkout, the git common
 * dir (absolute: trustPlace resolves git's answer against the directory it ran in; null outside git), and the autonomous
 * run of the session (null when attended), found first and without git: runMainsOf walks up from the hook's directory and
 * from the session's cwd (H1, CARRY-3). `mainOf` and `gitCommonDirOf` answer for the repository that holds a path, so a
 * CLAUDE_PROJECT_DIR outside the session's repository does not hide a protected file (CARRY-5).
 * H4: lazy, so only a file rule that met a protected name asks git; a call that meets none starts no git process,
 * also with an autonomous run (autonomous is a plain property). The literal is built once: a spread would read the getters.
 */
export function guardCtx(io: Io, input: GuardInput): GuardCtx {
  const dir = hookRoot(io, input);
  const starts = typeof input.cwd === 'string' && input.cwd !== '' ? [dir, input.cwd] : [dir];
  let autonomous: GuardCtx['autonomous'] = null;
  for (const m of runMainsOf(starts)) {
    autonomous = autonomousFor(m, input);
    if (autonomous) break;
  }
  let main: string | undefined;
  let common: string | null | undefined;
  return {
    get main() { return (main ??= mainCheckout(dir)); },
    get gitCommonDir() {
      if (common === undefined) { const f = trustPlace(dir).file; common = f ? path.dirname(path.dirname(f)) : null; }
      return common;
    },
    mainOf: perDir(mainCheckout),
    gitCommonDirOf: perDir(d => { const f = trustPlace(d).file; return f ? path.dirname(path.dirname(f)) : null; }),
    autonomous,
  };
}

/** The target of a denied call for blocked.jsonl: the file, the command cut to 300 characters, or the MCP tool's name. */
function blockedTarget(input: GuardInput, auto: AutonomousCtx): string {
  const plain: GuardCtx = { main: auto.main, gitCommonDir: null, autonomous: auto };
  return targetPath(input, plain) ?? shellCommand(input)?.slice(0, 300) ?? input.tool_name;
}

/** Prints the deny, and for an autonomous run records it in blocked.jsonl; stderr says so when it could not. */
function deliver(v: GuardVerdict, input: GuardInput, auto: AutonomousCtx | null, io: Io): { stdout: string; stderr: string } {
  const out = { stdout: guardOutput(v), stderr: '' };
  if (v.decision !== 'deny' || !auto || auto.runId === INVALID_RUN) return out;
  let failed: string | null;
  try {
    failed = appendBlocked(auto.main, auto.runId, {
      ts: io.now().toISOString(), rule: v.rule, tool: input.tool_name, target: blockedTarget(input, auto), reason: v.reason, session: input.session_id ?? null,
    });
  } catch (e) { failed = e instanceof Error ? e.message : String(e); }
  return failed === null ? out : { ...out, stderr: `forge guard: could not record the denial (${failed})\n` };
}

// The PreToolUse hook (D9): Claude Code's deny for a call the rules deny, nothing for any other call. The rules of an
// autonomous run are added only for its sessions, which fail closed (guard-error) on any error; every other session fails open.
function hookGuard(io: Io): { stdout: string; stderr: string } {
  let input: GuardInput | null = null;
  let auto: AutonomousCtx | null = null;
  try {
    input = parseGuardInput(JSON.parse(io.stdin ?? ''));
    if (!input) return { stdout: '', stderr: '' };
    const ctx = guardCtx(io, input);
    auto = ctx.autonomous;
    return deliver(judgeGuard(input, ctx, guardRulesFor(ctx)), input, auto, io);
  } catch (e) {
    if (!input || !auto) return { stdout: '', stderr: '' };
    return deliver(guardError(e instanceof Error ? e.message : String(e)), input, auto, io);
  }
}

export const command: Command = (args, ctx) => {
  const { io } = ctx;
  const which = args[0];
  if (which === 'guard') return { code: 0, ...hookGuard(io) };
  const out = which === 'stop' ? hookStop(io) : which === 'answer' ? hookAnswer(io) : which === 'live' ? hookLive(io)
    : which === 'route-session' ? hookRoute(io, 'session') : which === 'route-prompt' ? hookRoute(io, 'prompt') : '';
  return { code: 0, stdout: out, stderr: '' };
};
