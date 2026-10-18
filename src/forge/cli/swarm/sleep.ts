import type { SwarmCommand } from './context.js';
import { UsageError } from '../errors.js';
import { parseRun, readRunText } from '../../run.js';
import { readExecution } from '../../execution.js';
import { sleepSync } from '../../pid.js';
import { planLocale, sessionReply } from '../../../lib/locale.js';

const MAX_SLEEP_S = 900;

export const subcommand: SwarmCommand = (rest, ctx) => {
  const { io, has, ok, now, current, update } = ctx;
  const seconds = Number(rest[0]);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_SLEEP_S) throw new UsageError(`swarm sleep: seconds must be an integer from 1 to ${MAX_SLEEP_S}`);
  const e = current();
  const until = new Date(now.getTime() + seconds * 1000).toISOString();
  update(cur => cur && { ...cur, sleepUntil: until });
  if (has('mark')) return ok();
  (io.sleep ?? sleepSync)(seconds * 1000);
  // A newer sleep (or a --mark) may have replaced it meanwhile: only clear the value this call set.
  const after = readExecution(io.cwd);
  if (after && after.sleepUntil === until) update(cur => (cur && cur.sleepUntil === until ? { ...cur, sleepUntil: null } : null));
  // The coordinator wakes on this output: it repeats the language to answer in, when one is known.
  const run = parseRun(readRunText(io.cwd));
  const reply = sessionReply(run?.active ? run : null, after ?? e, () => planLocale(io.cwd, e.project));
  return reply ? { code: 0, stdout: `woke.${reply}\n`, stderr: '' } : ok();
};
