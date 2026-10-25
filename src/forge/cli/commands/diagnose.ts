import path from 'node:path';
import type { Command } from '../context.js';
import { UsageError } from '../errors.js';
import { diagnose } from '../../diagnose.js';
import { ledgerLines } from '../../diagnose-sources.js';
import { measureJsonl } from '../../transcript-file.js';
import { mainCheckout } from '../../local.js';
import { claudeConfigDir } from '../../superpowers.js';
import { resolveProject } from '../../task-ref.js';
import { isSafeId } from '../../../lib/execution-state.js';

/** A6: forge diagnose (--task <id> [--project <p>] | --execution <runId>) [--transcript <file>]. Reads only. */
export const command: Command = (_args, ctx) => {
  const { io, flag, json } = ctx;
  const task = flag('task');
  const execution = flag('execution');
  if ((task === undefined) === (execution === undefined)) throw new UsageError('diagnose: give --task <id> or --execution <runId>');
  const id = task ?? execution!;
  if (!isSafeId(id)) throw new UsageError('diagnose: --task and --execution take a task or run id');

  let transcript: string | undefined;
  const given = flag('transcript');
  if (given !== undefined) {
    transcript = path.resolve(io.cwd, given);
    if (!measureJsonl(transcript)) throw new UsageError('diagnose: --transcript must be a .jsonl file');
  }

  const main = mainCheckout(io.cwd);
  const configDir = claudeConfigDir(io.env ?? process.env);
  const opts = { configDir, transcript, now: io.now() };
  const d = task !== undefined
    ? diagnose(main, { kind: 'task', task, project: resolveProject({ flag: flag('project'), task, events: ledgerLines(main).lines.map(l => l.event) }) }, opts)
    : diagnose(main, { kind: 'execution', runId: id }, opts);
  if (d === null) throw new UsageError(task !== undefined ? `diagnose: forge has no record of task ${id}` : `diagnose: forge has no record of execution ${id}`);
  return json(d);
};
