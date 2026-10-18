import type { Command } from '../context.js';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isPlanId } from '../../../lib/plan.js';
import { renderBrief, parsePrior, priorSection, type PriorCommit } from '../../brief.js';
import { renderThreatModel } from '../../threat-model.js';
import { loadConfig } from '../../config.js';
import { UsageError } from '../errors.js';
import { renderSpBrief, SpPlanError } from '../../../lib/sp-plan.js';
import type { Io } from '../run.js';
import { planTask, spTaskNumber, tddFor } from '../shared.js';

// The TDD line of a brief: an invalid config or a missing superpowers leaves it out (the brief never fails on it), and
// superpowers is looked for only with tdd: superpowers.
function briefTdd(io: Io, dir: string): string | null {
  try { return loadConfig(dir).tdd === 'superpowers' ? tddFor(io, dir).line : null; } catch { return null; }
}

// K4-02: the threat model section a plan task's brief carries, from the config of the code's checkout (none on any error).
function briefThreatModel(dir: string): string | null {
  try { const tm = loadConfig(dir).threatModel; return tm ? renderThreatModel(tm) : null; } catch { return null; }
}

export const command: Command = (args, ctx) => {
  const { io, repoDir, flag, has, ok } = ctx;
  // D-02: the earlier attempt of a task resumed on its branch (the `prior` swarm worktree printed).
  let prior: PriorCommit[] | null = null;
  let priorTotal: number | null = null;
  if (has('prior-file')) {
    const f = flag('prior-file');
    if (!f) throw new UsageError('brief: --prior-file needs a file');
    let raw: unknown;
    try { raw = JSON.parse(readFileSync(path.resolve(io.cwd, f), 'utf8')); } catch { throw new UsageError(`brief: cannot read ${f}`); }
    prior = parsePrior(raw);
    if (!prior) throw new UsageError(`brief: ${f} is not the prior list swarm worktree prints ([{sha, title}])`);
    // Carry 3: an attempt longer than the list (`priorTotal` of swarm worktree) says how many commits it has.
    if (has('prior-total')) {
      const n = Number(flag('prior-total'));
      if (!Number.isInteger(n) || n < prior.length) throw new UsageError('brief: --prior-total must be the whole number of commits swarm worktree printed as priorTotal');
      priorTotal = n;
    }
    // Without a plan (a loose task's brief is written by hand), only the section, to append to it.
    if (!has('plan') && !has('superpowers-plan')) {
      const task = flag('task');
      if (!task || !isPlanId(task)) throw new UsageError('brief: --prior-file without --plan needs --task <id>');
      return { code: 0, stdout: prior.length ? priorSection(task, prior, priorTotal) : '', stderr: '' };
    }
    // A superpowers plan's brief has no task branch of its own: never drop the section silently.
    if (has('superpowers-plan')) throw new UsageError('brief: --prior-file goes with --plan, or alone with --task <id>');
  }
  if (has('superpowers-plan')) {
    const file = flag('superpowers-plan');
    if (!file) throw new UsageError('brief: --superpowers-plan needs a plan file');
    const n = spTaskNumber(flag('task'));
    let text: string;
    try { text = readFileSync(path.resolve(io.cwd, file), 'utf8'); } catch { throw new UsageError(`brief: cannot read ${file}`); }
    try { return ok(renderSpBrief(text, n, { planPath: file.replace(/\\/g, '/'), tdd: briefTdd(io, repoDir) })); } catch (e) {
      if (e instanceof SpPlanError) throw new UsageError(`brief: ${file}: ${e.message}`);
      throw e;
    }
  }
  const { plan, task } = planTask(io.cwd, flag('plan'), flag('task'));
  const design = flag('design') ?? path.join(path.dirname(flag('plan')!), 'design.md');
  const designPath = existsSync(path.resolve(io.cwd, design)) ? design.replace(/\\/g, '/') : null;
  return ok(renderBrief(plan, task, { planPath: flag('plan')!.replace(/\\/g, '/'), designPath, tdd: briefTdd(io, repoDir), threatModel: briefThreatModel(repoDir), prior, priorTotal }));
};
