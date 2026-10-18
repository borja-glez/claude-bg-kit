import type { Command } from '../context.js';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseVerifyFile } from '../../verdict.js';
import { UsageError } from '../errors.js';
import { logVerifyResult } from '../shared.js';

export const command: Command = (args, ctx) => {
  const { io, flag, json, ts } = ctx;
  // A verification outside a verdict (Small and Trivial have no review): its result logged as verdict logs it.
  const task = flag('task');
  const dirArg = flag('dir');
  if (!task || !dirArg) throw new UsageError('verify-result: --task and --dir are required');
  const dir = path.resolve(io.cwd, dirArg);
  const verifyPath = path.join(dir, 'verify.json');
  if (!existsSync(verifyPath)) throw new UsageError(`verify-result: no verify.json in ${dirArg}`);
  const verifyFile = parseVerifyFile(readFileSync(verifyPath, 'utf8'));
  if (!verifyFile) throw new UsageError(`verify-result: ${dirArg}/verify.json is not a usable verify result (result pass|fail|blocked, checks, a reason when blocked)`);
  return json({ task, ...logVerifyResult(io.cwd, ts(), task, dir, verifyFile) });
};
