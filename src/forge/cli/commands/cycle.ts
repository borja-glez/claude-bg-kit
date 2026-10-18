import type { Command } from '../context.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { appendEvent } from '../../ledger.js';
import { parseRun, recordCycle, readRunText, saveRun } from '../../run.js';
import { UsageError } from '../errors.js';
import { infinitePublish } from '../../infinite-doc.js';
import { mainCheckout } from '../../local.js';
import { runRootOf, runReply } from '../shared.js';

export const command: Command = (args, ctx) => {
  const { io, flag, json, ts } = ctx;
  const progress = flag('progress');
  if (progress !== 'yes' && progress !== 'no') throw new UsageError('cycle: --progress yes|no is required');
  let error: string | undefined;
  if (flag('error-file') !== undefined) {
    try { error = readFileSync(path.resolve(io.cwd, flag('error-file')!), 'utf8'); } catch { throw new UsageError('cycle: cannot read --error-file'); }
  }
  const runRoot = runRootOf(io.cwd);
  const current = parseRun(readRunText(runRoot));
  if (!current?.active) throw new UsageError('cycle: no active run (forge infinite start)');
  const next = recordCycle(current, { progress: progress === 'yes', ...(error !== undefined ? { error } : {}) });
  saveRun(runRoot, next);
  appendEvent(runRoot, { ts: ts(), kind: 'cycle', cycle: next.cycle, progress: progress === 'yes', ...(next.lastError ? { error: next.lastError } : {}) });
  return json({ ...next, reply: runReply(runRoot, next), publish: { infinite: infinitePublish(mainCheckout(io.cwd), next, io.now()) } });
};
