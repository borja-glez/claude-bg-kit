import type { Command } from '../context.js';
import { loadConfig, WORKFLOWS, AUTONOMIES } from '../../config.js';
import { resolvePrefs, isWorkflow, isAutonomy } from '../../prefs.js';
import { UsageError } from '../errors.js';
import { readLocal } from '../../local.js';

export const command: Command = (args, ctx) => {
  const { io, repoDir, flag, json } = ctx;
  const wf = flag('workflow');
  const au = flag('autonomy');
  if (wf !== undefined && !isWorkflow(wf)) throw new UsageError(`prefs: --workflow must be one of ${WORKFLOWS.join('|')}`);
  if (au !== undefined && !isAutonomy(au)) throw new UsageError(`prefs: --autonomy must be one of ${AUTONOMIES.join('|')}`);
  return json(resolvePrefs({ ...(wf ? { workflow: wf } : {}), ...(au ? { autonomy: au } : {}) }, readLocal(io.cwd), loadConfig(repoDir)));
};
