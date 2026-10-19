import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Command } from '../context.js';
import { UsageError } from '../errors.js';
import { DEFAULT_VERIFY_PORTS, loadConfig, verifyPorts } from '../../config.js';
import { appendEvent, readEvents } from '../../ledger.js';
import { mainCheckout } from '../../local.js';
import { baseOf, resolveProject } from '../../task-ref.js';
import { envKey, releaseEnv, reserveEnv } from '../../verify-env.js';
import { isSafeId } from '../../../lib/execution-state.js';
import { statusKey } from '../../../lib/forge-status.js';

/**
 * `FORGE verify-env --task <id>-<n> --dir <review dir> [--evidence <dir>] [--project p] [--cwd W]` (K2-07), right before
 * a verify agent is spawned: a port of verify.ports and a browser profile for this round, kept in
 * <main>/.forge/verify-env/. Writes <review dir>/verify-env.json (review-close then waits for verify.json, K2-09), logs
 * a verify-env event and prints {port, profileDir, env: {PORT, FORGE_VERIFY_PORT}}. The same round asking again gets
 * the same port and profile. --evidence defaults to evidence/<n>-<round> next to a reviews-<n>-<round> folder, else
 * <dir>/evidence; verify-cleanup of that folder frees them. Exit 2 when every port of the range is taken.
 */
export const command: Command = (args, ctx) => {
  const { io, flag, json, ts } = ctx;
  const task = flag('task'), dirArg = flag('dir');
  if (!task || !dirArg) throw new UsageError('verify-env: --task <id>-<n> and --dir <review dir> are required');
  if (!isSafeId(task)) throw new UsageError('verify-env: --task is not a task id');
  const dir = path.resolve(io.cwd, dirArg);
  const round = /^reviews-(\d+-\d+)$/.exec(path.basename(dir));
  const evArg = flag('evidence');
  const evidence = evArg ? path.resolve(io.cwd, evArg) : round ? path.join(path.dirname(dir), 'evidence', round[1]) : path.join(dir, 'evidence');
  const base = baseOf(task);
  const project = resolveProject({ flag: flag('project'), dir: dirArg, task: base, events: readEvents(io.cwd) });
  const key = envKey(statusKey(base, project) ?? base, dir);
  if (!key) throw new UsageError('verify-env: the task and its round give no valid reservation name');
  const main = mainCheckout(io.cwd);
  const config = loadConfig(main);
  const r = reserveEnv({ main, key, task, dir, evidence, range: verifyPorts(config), now: io.now(), ttlMs: 2 * config.verify.limits.minutes * 60_000 });
  if (!r) {
    const range = config.verify.ports ?? DEFAULT_VERIFY_PORTS;
    throw new UsageError(`verify-env: every port of verify.ports (${range}) is taken; free one with FORGE verify-cleanup or widen the range`);
  }
  try {
    mkdirSync(dir, { recursive: true });
    mkdirSync(evidence, { recursive: true });
    const doc = { task, port: r.port, profileDir: r.profileDir, startedAt: r.startedAt };
    writeFileSync(path.join(dir, 'verify-env.json'), JSON.stringify(doc, null, 2) + '\n');
    appendEvent(io.cwd, { ts: ts(), kind: 'verify-env', task, port: r.port, profileDir: r.profileDir });
  } catch (e) { releaseEnv(main, evidence); throw e; }
  return json({ port: r.port, profileDir: r.profileDir, env: { PORT: String(r.port), FORGE_VERIFY_PORT: String(r.port) } });
};
