import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { CheckResult, DoctorCheck, DoctorCtx } from './doctor.js';
import { scanJobs, stepLockHeld } from './jobs.js';
import { mergeInFlight } from './merging.js';
import { executionLockState, LOCK_STALE_MS, peekExecution } from './execution.js';
import { ConfigError, loadConfig } from './config.js';
import { configCommands, readTrust, trustOf } from './trust.js';
import { trackedState } from './local.js';
import { readReservations, type EnvReservation } from './verify-env.js';
import { parsePids } from './verify-proc.js';
import { pidAlive } from './pid.js';
import { confinedIn } from './guard.js';
import { swarmCommand } from './cli/swarm.js';
import { defaultExec, defaultGit, repoReader } from './cli/exec.js';

/** A4: the checks of forge's own state, read from the main checkout without writing anything. */
const stepLockCheck: DoctorCheck = {
  id: 'step-lock',
  run(ctx) {
    const held = stepLockHeld(ctx.main, ctx.now);
    if (!held) return { id: 'step-lock', status: 'ok', detail: 'no swarm step is running' };
    return {
      id: 'step-lock', status: 'warn',
      detail: `a swarm step is running (.forge/jobs/step.lock, ${held.pid === null ? 'pid unknown' : `pid ${held.pid}`})`,
      data: { pid: held.pid },
      fix: { do: 'wait for the step to end; the next swarm step takes over a step.lock whose process died', kind: 'manual' },
    };
  },
};

const jobsCheck: DoctorCheck = {
  id: 'jobs',
  run(ctx) {
    const live = scanJobs(ctx.main, ctx.now).live;
    return { id: 'jobs', status: 'ok', detail: `${live.length} background forge command(s) running`, data: { jobs: live.map(j => ({ cmd: j.cmd, task: j.task })) } };
  },
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

const mergingCheck: DoctorCheck = {
  id: 'merging',
  run(ctx) {
    const live = mergeInFlight(ctx.main, ctx.now.getTime());
    if (!live) return { id: 'merging', status: 'ok', detail: 'no integration is merging' };
    // A marker still being written has no doc yet: the pid and the task are left out.
    const who = live.doc ? `, pid ${live.doc.pid}${live.doc.task ? `, ${live.doc.task}` : ''}` : '';
    return {
      id: 'merging', status: 'warn',
      detail: `an integration is merging (.forge/execution/merging.json${who})`,
      fix: { do: 'wait for it to end', kind: 'manual' },
    };
  },
};

const executionLockCheck: DoctorCheck = {
  id: 'execution-lock',
  run(ctx) {
    const s = executionLockState(ctx.main, ctx.now);
    if (s.held && s.stale) {
      return {
        id: 'execution-lock', status: 'warn',
        detail: `.forge/execution.lock was left by ${s.pid === null ? 'pid unknown' : `pid ${s.pid}`}, gone or holding it past ${LOCK_STALE_MS / 1000} s`,
        fix: { do: 'nothing to remove by hand: the next forge command that writes the execution takes a lock this old over', kind: 'manual' },
      };
    }
    return s.held
      ? { id: 'execution-lock', status: 'ok', detail: 'a live process holds the execution lock' }
      : { id: 'execution-lock', status: 'ok', detail: 'no execution lock' };
  },
};

const trustCheck: DoctorCheck = {
  id: 'trust',
  run(ctx) {
    let config;
    try { config = loadConfig(ctx.main); } catch (e) {
      if (!(e instanceof ConfigError)) throw e;
      return { id: 'trust', status: 'fail', detail: `.forge/config.yaml does not parse: ${e.message}`, fix: { do: 'fix .forge/config.yaml', kind: 'manual' } };
    }
    if (!configCommands(config).length) return { id: 'trust', status: 'ok', detail: 'the config has no commands to trust' };
    const { state } = trustOf(config, readTrust(ctx.main));
    if (state === 'ask' || state === 'changed') {
      return {
        id: 'trust', status: 'warn',
        detail: `the commands of .forge/config.yaml are not trusted yet (${state})`,
        fix: { do: 'run forge triage; it asks you to trust them', kind: 'manual' },
      };
    }
    if (state === 'denied') return { id: 'trust', status: 'ok', detail: 'the commands of .forge/config.yaml are not trusted (you said no)' };
    return { id: 'trust', status: 'ok', detail: 'the commands of .forge/config.yaml are trusted' };
  },
};

const trackedCheck: DoctorCheck = {
  id: 'tracked-state',
  run(ctx) {
    const names = ['local.yaml', 'learned.jsonl'] as const;
    const states = names.map(name => ({ name, state: trackedState(ctx.main, name) }));
    const tracked = states.filter(s => s.state === 'tracked').map(s => s.name);
    if (tracked.length) {
      return {
        id: 'tracked-state', status: 'warn',
        detail: `git tracks .forge/${tracked[0]}, so a repository could ship it; it grants nothing`,
        data: { tracked },
        fix: { do: `git rm --cached ${tracked.map(n => `.forge/${n}`).join(' ')}`, kind: 'manual' },
      };
    }
    const unknown = states.find(s => s.state === 'unknown');
    if (unknown) return { id: 'tracked-state', status: 'unverified', detail: `git could not say whether it tracks .forge/${unknown.name}` };
    return { id: 'tracked-state', status: 'ok', detail: 'git tracks no forge state file' };
  },
};

/** Whether the evidence folder of a reservation records a process that still lives; a folder outside the main checkout reads as none. */
function evidenceHasProcess(evidence: string, main: string): boolean {
  if (!confinedIn(evidence, main)) return false;
  const texts: string[] = [];
  try {
    const logs = path.join(evidence, 'logs');
    for (const f of readdirSync(logs).filter(n => /^\d+\.pid\.json$/.test(n))) {
      try { texts.push(readFileSync(path.join(logs, f), 'utf8')); } catch { /* unreadable: no pid from it */ }
    }
  } catch { /* no logs folder */ }
  try { texts.push(readFileSync(path.join(evidence, 'pids.json'), 'utf8')); } catch { /* no pids.json */ }
  return texts.some(t => parsePids(t).some(e => pidAlive(e.pid)));
}

const verifyEnvCheck: DoctorCheck = {
  id: 'verify-env',
  run(ctx) {
    let minutes: number;
    try { minutes = loadConfig(ctx.main).verify.limits.minutes; } catch (e) {
      if (!(e instanceof ConfigError)) throw e;
      return { id: 'verify-env', status: 'unverified', detail: `.forge/config.yaml does not parse: ${e.message}` };
    }
    const now = ctx.now.getTime();
    const idle: EnvReservation[] = readReservations(ctx.main, now, 2 * minutes * 60000)
      .filter(r => now - Date.parse(r.startedAt) > minutes * 60000 && !evidenceHasProcess(r.evidence, ctx.main));
    if (!idle.length) return { id: 'verify-env', status: 'ok', detail: 'no verify-env reservation without a live process' };
    return {
      id: 'verify-env', status: 'warn',
      detail: `${idle.length} verify-env reservation(s) with no live process (ports ${idle.map(r => r.port).join(', ')})`,
      data: { reservations: idle.map(r => ({ key: r.key, task: r.task, port: r.port, evidence: r.evidence })) },
      fix: { do: 'forge verify-cleanup --dir <evidence> frees each', kind: 'confirm' },
    };
  },
};

/** defaultGit with --no-optional-locks: a plain git status refreshes a worktree's index and rewrites it under index.lock, and doctor writes nothing. */
const readOnlyGit = (cwd: string) => {
  const git = defaultGit(cwd);
  return (args: string[]) => git(['--no-optional-locks', ...args]);
};

function worktreesCheck(ctx: DoctorCtx): CheckResult {
  const peek = peekExecution(ctx.main);
  const skip = peek.exec?.active ? 'a run is active'
    : peek.migratable ? 'a legacy swarm.json is not migrated yet'
    : mergeInFlight(ctx.main, ctx.now.getTime()) ? 'an integration is merging'
    : scanJobs(ctx.main, ctx.now).live.length ? 'a forge command is running'
    : stepLockHeld(ctx.main, ctx.now) ? 'a swarm step is running'
    : null;
  if (skip) return { id: 'worktrees', status: 'ok', detail: `skipped: ${skip}` };
  try {
    const r = swarmCommand(['cleanup', '--dry-run'], { cwd: ctx.main, now: () => ctx.now, env: ctx.env }, {
      git: readOnlyGit(ctx.main), exec: defaultExec(ctx.main), repo: repoReader(ctx.main),
      at: dir => ({ git: readOnlyGit(dir), exec: defaultExec(dir), repo: repoReader(dir) }),
    });
    if (r.code !== 0) return { id: 'worktrees', status: 'unverified', detail: (r.stderr || r.stdout).trim() || `swarm cleanup --dry-run exited ${r.code}` };
    const { removed } = JSON.parse(r.stdout) as { removed?: { worktrees?: string[]; branches?: string[] } };
    const worktrees = removed?.worktrees ?? [], branches = removed?.branches ?? [];
    if (!worktrees.length && !branches.length) return { id: 'worktrees', status: 'ok', detail: 'nothing to clean up' };
    return {
      id: 'worktrees', status: 'warn',
      detail: `${worktrees.length} merged forge worktree(s) and ${branches.length} branch(es) can be cleaned up`,
      data: { worktrees, branches },
      fix: { do: 'forge swarm cleanup removes them', kind: 'confirm' },
    };
  } catch (e) {
    return { id: 'worktrees', status: 'unverified', detail: message(e) };
  }
}

const worktreesDoctorCheck: DoctorCheck = { id: 'worktrees', run: worktreesCheck };

export const STATE_CHECKS: readonly DoctorCheck[] = [
  stepLockCheck, jobsCheck, mergingCheck, executionLockCheck, trustCheck, trackedCheck, verifyEnvCheck, worktreesDoctorCheck,
];
