import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { forgeDir } from './ledger.js';
import { readSwarm, swarmFile } from './swarm.js';
import { fromSwarm, parseExecution, type ExecutionState, type PublicTask } from '../lib/execution-state.js';

export const executionFile = (root: string) => path.join(root, '.forge', 'execution.json');
export const executionTaskFile = (root: string, task: string) => path.join(root, '.forge', 'execution', `${task}.json`);
export const runBranch = (project: string) => `forge/run-${project}`;
export const taskBranch = (task: string) => `task/${task}`;
export const runWorktree = (root: string) => path.join(root, '.claude', 'worktrees', 'run');
export const taskWorktree = (root: string, task: string) => path.join(root, '.claude', 'worktrees', `task-${task}`);

export type { PublicTask } from '../lib/execution-state.js';

function writeAtomic(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try { writeFileSync(tmp, text); renameSync(tmp, file); } finally { rmSync(tmp, { force: true }); }
}

export function saveExecution(root: string, e: ExecutionState): void {
  forgeDir(root);
  writeAtomic(executionFile(root), JSON.stringify(e, null, 2) + '\n');
}

/** The execution, migrating an older swarm.json once (as a stopped execution; its file is kept as swarm.json.migrated). */
export function readExecution(root: string): ExecutionState | null {
  const file = executionFile(root);
  if (existsSync(file)) {
    try { return parseExecution(readFileSync(file, 'utf8')); } catch { return null; }
  }
  const old = readSwarm(root);
  if (!old) return null;
  const migrated = fromSwarm(old);
  saveExecution(root, migrated);
  renameSync(swarmFile(root), `${swarmFile(root)}.migrated`);
  return migrated;
}

export function writePublicTask(root: string, p: PublicTask): void {
  writeAtomic(executionTaskFile(root, p.task), JSON.stringify(p, null, 2) + '\n');
}
