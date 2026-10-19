import type { Command } from '../context.js';
import path from 'node:path';
import { UsageError } from '../errors.js';
import { cleanupEvidence } from '../shared.js';

export const command: Command = (args, ctx) => {
  const { io, flag, json } = ctx;
  const dir = flag('dir');
  if (!dir) throw new UsageError('verify-cleanup: --dir is required');
  return json(cleanupEvidence(path.resolve(io.cwd, dir), io.cwd));
};
