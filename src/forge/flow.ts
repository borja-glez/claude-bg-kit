// K2-13: the flow passes of a run, each in its folder .forge/work/flow-<runId>-<n>/ of forge's own state (the
// coordinator's main checkout): what a pass plans and when a phase asks for one live here too.
import { readdirSync } from 'node:fs';
import path from 'node:path';

export const flowDirName = (runId: string, n: number): string => `flow-${runId}-${n}`;

/** The folders of a run's flow passes under `root`, oldest first. */
export function flowDirs(root: string, runId: string): string[] {
  const re = new RegExp(`^flow-${runId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`);
  let names: string[] = [];
  try { names = readdirSync(path.join(root, '.forge', 'work')); } catch { return []; }
  return names.map(name => ({ name, m: re.exec(name) }))
    .filter((x): x is { name: string; m: RegExpExecArray } => x.m !== null)
    .sort((a, b) => Number(a.m[1]) - Number(b.m[1]))
    .map(x => path.join(root, '.forge', 'work', x.name));
}
