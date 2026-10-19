import path from 'node:path';
import type { Command } from '../context.js';
import { UsageError } from '../errors.js';
import { defaultProcDeps, spawnVerified } from '../../verify-proc.js';

/**
 * `FORGE verify-spawn --dir <evidence dir> [--cwd W] -- <cmd…>` (K2-03, K2-20): starts what a verify agent needs in the
 * background (a dev server, an emulator bridge) detached, in the code checked (--cwd), its output in <dir>/logs/<n>.log,
 * and records it in <dir>/pids.json with its identity for verify-cleanup. Prints {started, pid, log, running}, plus
 * code and logTail when it ended within 1 s with a code other than 0.
 */
export const command: Command = (args, ctx) => {
  const { io, repoDir, flag, json } = ctx;
  const dir = flag('dir');
  const at = args.indexOf('--');
  const cmd = at < 0 ? [] : args.slice(at + 1);
  if (!dir || !cmd.length) throw new UsageError('verify-spawn: --dir <evidence dir> and -- <command> are required');
  const r = spawnVerified(path.resolve(io.cwd, dir), repoDir, cmd, defaultProcDeps());
  return json({ ...r, log: path.relative(io.cwd, r.log).split(path.sep).join('/') });
};
