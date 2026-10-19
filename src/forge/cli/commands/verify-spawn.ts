import path from 'node:path';
import type { Command } from '../context.js';
import { UsageError } from '../errors.js';
import { defaultProcDeps, spawnVerified } from '../../verify-proc.js';

/**
 * `FORGE verify-spawn --dir <evidence dir> [--cwd W] -- <cmd…>` (K2-03, K2-20): starts what a verify agent needs in the
 * background (a dev server, an emulator bridge) detached, in the code checked (--cwd), its output in <dir>/logs/<n>.log,
 * and records it in <dir>/logs/<n>.pid.json with its identity for verify-cleanup. Prints {started, pid, log, running},
 * plus code and logTail when it ended within 1 s with a code other than 0. A command that ends within that second with 0
 * is started and done: what it leaves running on its own (`adb start-server`, `docker compose up -d`) is not recorded,
 * so verify-cleanup does not stop it. On Windows the command runs through cmd.exe: a `%NAME%` in an argument becomes that
 * environment variable, and an argument with a line break is refused (cmd.exe would end the command there).
 */
export const command: Command = (args, ctx) => {
  const { io, repoDir, flag, json } = ctx;
  const dir = flag('dir');
  const at = args.indexOf('--');
  const cmd = at < 0 ? [] : args.slice(at + 1);
  if (!dir || !cmd.length) throw new UsageError('verify-spawn: --dir <evidence dir> and -- <command> are required');
  if (process.platform === 'win32' && cmd.some(a => /[\r\n]/.test(a))) {
    throw new UsageError('verify-spawn: on Windows the command runs through cmd.exe, which ends it at a line break: pass no argument with one');
  }
  const r = spawnVerified(path.resolve(io.cwd, dir), repoDir, cmd, defaultProcDeps());
  return json({ ...r, log: path.relative(io.cwd, r.log).split(path.sep).join('/') });
};
