import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { withEventContext, type EventContext } from '../ledger.js';
import { isSafeId } from '../../lib/execution-state.js';
import { loadConfig, ConfigError } from '../config.js';
import { claudeSessionId } from '../../lib/claude-session.js';
import { UsageError } from './errors.js';
import { makeCtx, ownArgs, type Result } from './context.js';
import type { fitForgeDoc } from '../../lib/roadmap-doc.js';
import { projectOfDir } from '../task-ref.js';
import type { ExecMany } from '../validators.js';
import { mainCheckout } from '../local.js';
import { UntrustedCommandsError } from '../trust.js';
import { slotFor, withJob, writeJsonAtomic, type Slot } from '../jobs.js';
import { sleepSync } from '../pid.js';
import { defaultExec, defaultExecMany, defaultGit } from './exec.js';
import { COMMANDS } from './commands/index.js';

export interface ExecResult { code: number; output: string; ms: number; timedOut: boolean }
export interface Io {
  cwd: string; workdir?: string; now: () => Date; exec?: (cmd: string, timeoutSec: number) => ExecResult; execMany?: ExecMany;
  git?: (args: string[]) => string | null; scriptPath?: string; rand?: () => number; stdin?: string; sleep?: (ms: number) => void;
  env?: Record<string, string | undefined>; slot?: Slot; roadmapFit?: typeof fitForgeDoc;
}

// I-12: what moved out of this file keeps its import path for the other modules and the tests.
export { defaultExec, defaultExecMany, defaultGit, repoReader } from './exec.js';
export { findWaypointCli } from './commands/waypoint-cli.js';
export { roundDecision } from '../round.js';
export { cleanProbe } from './commands/route.js';

const USAGE = 'usage: forge <triage|brief|validate|stats|verdict|round|review-prep|review-close|prep|shadow|log|decision|agents|last|proposals|surfaces|tools|local|prefs|begin|route|verify-plan|verify-result|verify-cleanup|verify-close|verify-spawn|waypoint-cli|sp-path|sp-specs|sp-plans|sp-plan|tdd|tree|config|infinite|cycle|authorize|swarm|setup|stop|hook|roadmap-doc|roadmap-run> ...';

/** C-03: the commands that run as a job with --out, and the task each works on. */
function jobOf(argv: string[]): { cmd: string; task: string | null } | null {
  const [cmd, sub, third] = argv;
  const value = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    const v = i >= 0 ? argv[i + 1] : undefined;
    return v !== undefined && !v.startsWith('--') ? v : null;
  };
  if (cmd === 'prep' || cmd === 'review-prep' || cmd === 'validate') return { cmd, task: value('task') };
  if (cmd === 'swarm' && sub === 'integrate') return { cmd: 'integrate', task: third !== undefined && !third.startsWith('--') ? third : null };
  if (cmd === 'swarm' && sub === 'step') return { cmd: 'step', task: null };
  return null;
}

/**
 * The forge CLI. `--out <file>` on prep, review-prep, validate, swarm integrate and swarm step (C-03): the command runs
 * as a job of .forge/jobs/ (the coordinator launched it with run_in_background and its end wakes it), waits for a
 * validation slot before its validators (swarm.validateJobs) and writes its JSON to the file atomically, with
 * `waitedMs` when it is an object; one that failed writes `{error, code}`. Any other command runs as it is.
 */
function runOrJob(argv: string[], io: Io): Result {
  const job = ownArgs(argv).includes('--out') ? jobOf(ownArgs(argv)) : null;
  if (!job) return runCommand(argv, io);
  const at = argv.indexOf('--out');
  const file = argv[at + 1];
  if (file === undefined || file.startsWith('--')) return { code: 2, stdout: '', stderr: `${job.cmd}: --out needs a file\n` };
  const outFile = path.resolve(io.cwd, file);
  const main = mainCheckout(io.cwd);
  let max = 2;
  try { max = loadConfig(main).swarm.validateJobs; } catch { max = 2; }
  const spec = { cmd: job.cmd, task: job.task, out: file.replace(/\\/g, '/'), session: claudeSessionId(null, io.env ?? process.env), startedAt: io.now().toISOString() };
  return withJob(main, spec, j => {
    const slots = slotFor(main, j, max, { now: io.now, sleep: io.sleep ?? sleepSync });
    const r = runCommand([...argv.slice(0, at), ...argv.slice(at + 2)], { ...io, slot: slots.slot });
    let parsed: unknown;
    try { parsed = JSON.parse(r.stdout); } catch { parsed = undefined; }
    const value = parsed === undefined ? { error: (r.stderr || r.stdout).trim() || `exit ${r.code}`, code: r.code }
      : parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { ...(parsed as Record<string, unknown>), waitedMs: slots.waited() } : parsed;
    try { writeJsonAtomic(outFile, value); } catch (e) { return { ...r, stderr: `${r.stderr}forge: could not write ${file}: ${(e as Error).message}\n` }; }
    return parsed !== undefined && value !== parsed ? { ...r, stdout: JSON.stringify(value, null, 2) + '\n' } : r;
  });
}

/** C4: the context the events of one command are stamped with: Claude's session from io.env (a test passes {}) and, for a
 *  command with --task, the project its --project or its --dir (.forge/work/<project>/<T>) names. */
function eventContextOf(argv: string[], io: Io): EventContext {
  const value = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    const v = i >= 0 ? argv[i + 1] : undefined;
    return v !== undefined && !v.startsWith('--') ? v : undefined;
  };
  const task = value('task'), flagged = value('project'), dir = value('dir');
  const project = !task ? undefined : flagged !== undefined ? (isSafeId(flagged) ? flagged : undefined) : dir ? projectOfDir(dir, task) ?? undefined : undefined;
  return { env: io.env ?? {}, ...(project !== undefined ? { project } : {}) };
}

/** The forge CLI (see runOrJob): every event a command appends carries its session, run and project (C4). A command a
 *  swarm step runs (its deps.cli) that names no project keeps the step's (withEventContext). */
export function run(argv: string[], io: Io): Result {
  return withEventContext(eventContextOf(ownArgs(argv), io), () => runOrJob(argv, io));
}

function runCommand(argv: string[], io: Io): Result {
  // --cwd <dir>: the code lives there (validators, git and the project's files), so a coordinator never has to cd
  // into a worktree (a cd outside a subshell sticks). forge's own state (ledger, .forge/work, the execution) and
  // every file flag stay with the caller's directory.
  const cwdAt = ownArgs(argv).indexOf('--cwd');
  if (cwdAt >= 0) {
    const dir = argv[cwdAt + 1];
    if (!dir || dir.startsWith('--')) return { code: 2, stdout: '', stderr: 'forge: --cwd needs a directory\n' };
    const abs = path.resolve(io.cwd, dir);
    if (!existsSync(abs)) return { code: 2, stdout: '', stderr: `forge: --cwd ${abs} does not exist\n` };
    if (!statSync(abs).isDirectory()) return { code: 2, stdout: '', stderr: `forge: --cwd ${abs} is not a directory\n` };
    argv = [...argv.slice(0, cwdAt), ...argv.slice(cwdAt + 2)];
    io = { ...io, workdir: abs, git: defaultGit(abs), exec: defaultExec(abs), execMany: defaultExecMany(abs) };
  }
  const repoDir = io.workdir ?? io.cwd;
  const [cmd, ...args] = argv;
  const ctx = makeCtx(cmd, args, io, repoDir, run);
  const { flag, has } = ctx;
  try {
    // D-08: a --project names a work folder and reaches every event of the command: a safe id only (swarm has its own rules).
    if (cmd !== 'swarm' && has('project') && !isSafeId(flag('project'))) throw new UsageError(`${cmd}: --project must use letters, digits, _ - . (at most 120)`);
    const command = cmd !== undefined && Object.hasOwn(COMMANDS, cmd) ? COMMANDS[cmd] : undefined;
    if (!command) return { code: 2, stdout: '', stderr: `${USAGE}\n` };
    return command(args, ctx);
  } catch (e) {
    if (e instanceof UntrustedCommandsError) return { code: 2, stdout: '', stderr: `${e.message}\n` };
    if (e instanceof UsageError || e instanceof ConfigError) return { code: 2, stdout: '', stderr: `${e.message}\n` };
    return { code: 1, stdout: '', stderr: `forge: ${(e as Error).message}\n` };
  }
}
