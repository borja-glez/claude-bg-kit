import type { Command } from '../context.js';
import { loadConfig, WORKFLOWS, AUTONOMIES } from '../../config.js';
import { envWorkflowWarning, resolvePrefs, isWorkflow, isAutonomy } from '../../prefs.js';
import { UsageError } from '../errors.js';
import { readLocal } from '../../local.js';

export const command: Command = (args, ctx) => {
  const { io, repoDir, flag, json } = ctx;
  const wf = flag('workflow');
  const au = flag('autonomy');
  if (wf !== undefined && !isWorkflow(wf)) throw new UsageError(`prefs: --workflow must be one of ${WORKFLOWS.join('|')}`);
  if (au !== undefined && !isAutonomy(au)) throw new UsageError(`prefs: --autonomy must be one of ${AUTONOMIES.join('|')}`);
  const env = io.env ?? process.env;
  const prefs = resolvePrefs({ ...(wf ? { workflow: wf } : {}), ...(au ? { autonomy: au } : {}) }, readLocal(io.cwd), loadConfig(repoDir), env);
  // w8 fix round 1: a FORGE_WORKFLOW that is no workflow is said, in the output and on stderr, never silently ignored.
  const warning = envWorkflowWarning(env);
  return warning ? { ...json({ ...prefs, warning }), stderr: `forge: ${warning}\n` } : json(prefs);
};
