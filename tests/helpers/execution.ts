import { updateExecution } from '../../src/forge/execution.js';
import type { ExecutionState } from '../../src/lib/execution-state.js';

/** I-15: a test's execution.json, written as every command writes it: under .forge/execution.lock, through the only writer. */
export function seedExecution(root: string, e: ExecutionState): void {
  updateExecution(root, () => e);
}
