import type { Command } from '../context.js';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { readEvents } from '../../ledger.js';
import { parsePlan } from '../../../lib/plan.js';
import type { PlanTask } from '../../../lib/types.js';
import { UsageError } from '../errors.js';
import { computeStats, renderStats, type PlanStates } from '../../stats.js';
import { mainCheckout } from '../../local.js';

/** Each docs/waypoint/<p>/plan.yaml of `main` with its roadmap states cached in .waypoint/<p>/dbcache/state (FORGE stats).
 *  An unreadable plan is skipped; a corrupt state doc counts as none. */
function planStates(main: string): PlanStates[] {
  const docs = path.join(main, 'docs', 'waypoint');
  let projects: string[];
  try { projects = readdirSync(docs); } catch { return []; }
  const out: PlanStates[] = [];
  for (const p of projects) {
    let tasks: PlanTask[];
    try { tasks = parsePlan(readFileSync(path.join(docs, p, 'plan.yaml'), 'utf8')).tasks; } catch { continue; }
    const dir = path.join(main, '.waypoint', p, 'dbcache', 'state');
    const states: Record<string, unknown> = {};
    let names: string[] = [];
    try { names = readdirSync(dir).filter(f => f.endsWith('.json')); } catch { names = []; }
    for (const f of names) { try { states[f.slice(0, -5)] = JSON.parse(readFileSync(path.join(dir, f), 'utf8')); } catch { /* skipped */ } }
    out.push({ project: p, tasks, states });
  }
  return out;
}

export const command: Command = (args, ctx) => {
  const { io, flag, has, ok, json } = ctx;
  // C-09: the clock of the accepted briefs of the main checkout's ledger (where every worktree's forge writes).
  if (has('days') && has('since')) throw new UsageError('stats: use --days or --since, not both');
  let from: number | null = null;
  if (has('days')) {
    const d = Number(flag('days'));
    if (!Number.isInteger(d) || d < 1 || d > 3650) throw new UsageError('stats: --days must be a whole number of days from 1 to 3650');
    from = io.now().getTime() - d * 86400000;
  }
  if (has('since')) {
    const t = Date.parse(flag('since') ?? '');
    if (Number.isNaN(t)) throw new UsageError('stats: --since must be an ISO date');
    from = t;
  }
  const locale = flag('locale') ?? 'en';
  if (locale !== 'es' && locale !== 'en') throw new UsageError('stats: --locale must be es or en');
  const main = mainCheckout(io.cwd);
  const s = computeStats({ events: readEvents(main), plans: planStates(main), from });
  return has('json') ? json(s) : ok(renderStats(s, locale));
};
