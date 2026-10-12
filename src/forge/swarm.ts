import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { forgeDir } from './ledger.js';
import { parseSwarm, type SwarmState } from '../lib/swarm-state.js';

export const swarmFile = (root: string) => path.join(root, '.forge', 'swarm.json');

export function readSwarm(root: string): SwarmState | null {
  const file = swarmFile(root);
  if (!existsSync(file)) return null;
  try { return parseSwarm(readFileSync(file, 'utf8')); } catch { return null; }
}

export function saveSwarm(root: string, s: SwarmState): void {
  forgeDir(root);
  const file = swarmFile(root);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(s, null, 2) + '\n');
    renameSync(tmp, file);
  } finally { rmSync(tmp, { force: true }); }
}
