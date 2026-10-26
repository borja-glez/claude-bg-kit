// forge's preferences: who does a coding request (`workflow`) and whether forge asks at its gates
// (`autonomy`). What the request says wins, then .forge/local.yaml (personal), then .forge/config.yaml (the team's), then
// for the workflow the person's default for every project (FORGE_WORKFLOW, w8 FR1), then `ask`.
import { AUTONOMIES, WORKFLOWS, type Autonomy, type ForgeConfig, type Workflow } from './config.js';
import type { LocalState } from './local.js';

export type PrefSource = 'request' | 'local' | 'config' | 'env' | 'default';
export interface Prefs { workflow: Workflow; autonomy: Autonomy; sources: { workflow: PrefSource; autonomy: PrefSource } }

export const isWorkflow = (x: unknown): x is Workflow => (WORKFLOWS as readonly unknown[]).includes(x);
export const isAutonomy = (x: unknown): x is Autonomy => (AUTONOMIES as readonly unknown[]).includes(x);

/** w8 FR1: the workflow the person set for every project, `FORGE_WORKFLOW` (the `env` of ~/.claude/settings.json); a
 *  value that is not a workflow is none. */
export function envWorkflow(env: Record<string, string | undefined>): Workflow | undefined {
  const v = env.FORGE_WORKFLOW?.trim().toLowerCase();
  return isWorkflow(v) ? v : undefined;
}

/** w8 fix round 1: what `forge prefs` says of a FORGE_WORKFLOW that is set but is no workflow (an empty one is unset). */
export function envWorkflowWarning(env: Record<string, string | undefined>): string | null {
  const raw = env.FORGE_WORKFLOW;
  if (raw === undefined || !raw.trim() || envWorkflow(env)) return null;
  const shown = JSON.stringify(raw.length > 40 ? `${raw.slice(0, 40)}…` : raw);
  return `FORGE_WORKFLOW=${shown} is not a workflow, so it is ignored; it can be ${WORKFLOWS.slice(0, -1).join(', ')} or ${WORKFLOWS.at(-1)}`;
}

function pick<T>(levels: [T | undefined, PrefSource][], dflt: T): [T, PrefSource] {
  for (const [v, source] of levels) if (v !== undefined) return [v, source];
  return [dflt, 'default'];
}

export function resolvePrefs(request: { workflow?: Workflow; autonomy?: Autonomy }, local: Pick<LocalState, 'workflow' | 'autonomy'>,
  config: Pick<ForgeConfig, 'workflow' | 'autonomy'>, env: Record<string, string | undefined>): Prefs {
  const [workflow, wSource] = pick<Workflow>([[request.workflow, 'request'], [local.workflow, 'local'], [config.workflow, 'config'], [envWorkflow(env), 'env']], 'ask');
  const [autonomy, aSource] = pick<Autonomy>([[request.autonomy, 'request'], [local.autonomy, 'local'], [config.autonomy, 'config']], 'ask');
  return { workflow, autonomy, sources: { workflow: wSource, autonomy: aSource } };
}
