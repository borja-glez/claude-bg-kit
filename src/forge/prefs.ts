// forge's preferences (spec §5.4): who does a coding request (`workflow`) and whether forge asks at its gates
// (`autonomy`). What the request says wins, then .forge/local.yaml (personal), then .forge/config.yaml (the team's), then
// `ask`.
import { AUTONOMIES, WORKFLOWS, type Autonomy, type ForgeConfig, type Workflow } from './config.js';
import type { LocalState } from './local.js';

export type PrefSource = 'request' | 'local' | 'config' | 'default';
export interface Prefs { workflow: Workflow; autonomy: Autonomy; sources: { workflow: PrefSource; autonomy: PrefSource } }

export const isWorkflow = (x: unknown): x is Workflow => (WORKFLOWS as readonly unknown[]).includes(x);
export const isAutonomy = (x: unknown): x is Autonomy => (AUTONOMIES as readonly unknown[]).includes(x);

function pick<T>(request: T | undefined, local: T | undefined, config: T | undefined, dflt: T): [T, PrefSource] {
  if (request !== undefined) return [request, 'request'];
  if (local !== undefined) return [local, 'local'];
  if (config !== undefined) return [config, 'config'];
  return [dflt, 'default'];
}

export function resolvePrefs(request: { workflow?: Workflow; autonomy?: Autonomy }, local: Pick<LocalState, 'workflow' | 'autonomy'>,
  config: Pick<ForgeConfig, 'workflow' | 'autonomy'>): Prefs {
  const [workflow, wSource] = pick<Workflow>(request.workflow, local.workflow, config.workflow, 'ask');
  const [autonomy, aSource] = pick<Autonomy>(request.autonomy, local.autonomy, config.autonomy, 'ask');
  return { workflow, autonomy, sources: { workflow: wSource, autonomy: aSource } };
}
