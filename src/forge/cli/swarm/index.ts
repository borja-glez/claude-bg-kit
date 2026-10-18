import type { SwarmCommand } from './context.js';
import { subcommand as cleanup } from './cleanup.js';
import { subcommand as close } from './close.js';
import { subcommand as integrate } from './integrate.js';
import { subcommand as join } from './join.js';
import { subcommand as merge } from './merge.js';
import { subcommand as next } from './next.js';
import { subcommand as propose } from './propose.js';
import { subcommand as relaunch } from './relaunch.js';
import { subcommand as report } from './report.js';
import { subcommand as retry } from './retry.js';
import { subcommand as sleep } from './sleep.js';
import { subcommand as start } from './start.js';
import { subcommand as status } from './status.js';
import { subcommand as step } from './step.js';
import { subcommand as stop } from './stop.js';
import { subcommand as takeover } from './takeover.js';
import { subcommand as task } from './task.js';
import { subcommand as tick } from './tick.js';
import { subcommand as worktree } from './worktree.js';

/** I-12: every swarm subcommand by its name, the alternatives of SWARM_USAGE in ../swarm.ts (tests/forge-cli-modules). */
export const SUBCOMMANDS: Readonly<Record<string, SwarmCommand>> = {
  join, report, next, start, status, propose, worktree, task, tick, retry, relaunch, nudge: relaunch,
  sleep, stop, close, cleanup, takeover, step, integrate, merge,
};
