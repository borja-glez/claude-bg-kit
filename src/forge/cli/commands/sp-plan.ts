import type { Command } from '../context.js';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { UsageError } from '../errors.js';
import { checkSpTask, SpPlanError } from '../../../lib/sp-plan.js';
import { spPlanDone, spTaskNumber } from '../shared.js';

export const command: Command = (args, ctx) => {
  const { io, repoDir, flag, json } = ctx;
  const [sub, file] = args;
  if ((sub !== 'tasks' && sub !== 'check') || !file || file.startsWith('--')) throw new UsageError('usage: forge sp-plan tasks <plan.md> | check <plan.md> --task N');
  const abs = path.resolve(io.cwd, file);
  let text: string;
  try { text = readFileSync(abs, 'utf8'); } catch { throw new UsageError(`sp-plan: cannot read ${file}`); }
  try {
    if (sub === 'tasks') { const { plan, tasks } = spPlanDone(text, abs, repoDir); return json({ plan, tasks }); }
    const n = spTaskNumber(flag('task'));
    const r = checkSpTask(text, n);
    if (r.checked) writeFileSync(abs, r.text);
    return json({ task: n, checked: r.checked });
  } catch (e) {
    if (e instanceof SpPlanError) throw new UsageError(`sp-plan: ${file}: ${e.message}`);
    throw e;
  }
};
