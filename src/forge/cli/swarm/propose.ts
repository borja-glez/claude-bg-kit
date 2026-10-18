import type { SwarmCommand } from './context.js';
import { loadConfig } from '../../config.js';
import { runIdOf } from '../../execution.js';
import { widthOf, widthProfile } from '../../schedule.js';
import { planOfLoose } from '../../loose.js';
import { proposeSay } from '../../swarm.js';
import { loadPlanArg, loadTasksArg, localeArg, isSpanish } from './shared.js';

export const subcommand: SwarmCommand = (rest, ctx) => {
  const { io, flag, has, json, now } = ctx;
  const planned = !flag('plan') && has('tasks') ? null : loadPlanArg(io, flag('plan'), 'propose');
  const plan = planned ?? planOfLoose(loadTasksArg(io, flag('tasks'), 'propose'));
  const locale = localeArg(rest, 'propose');
  const p = widthProfile(plan);
  const width = widthOf(plan);
  const config = loadConfig(io.cwd);
  const configured = config.swarm.mode ?? null;
  const parallel = width < 2 ? 1 : Math.min(config.swarm.parallel, width);
  const reasons = [`${plan.tasks.length} tasks`, `up to ${width} at once (dependencies and zones)`];
  // D-19: how wide the plan is wave by wave, its longest chain and the zones that serialize it, said in one line.
  const es = locale ? locale === 'es' : isSpanish((plan as { locale?: string }).locale);
  return json({
    width, configured, recommended: { mode: 'subagents', parallel }, reasons,
    profile: p.profile, chain: p.chain, serializing: p.serializing, mostlySerial: p.mostlySerial, say: proposeSay(es, plan.tasks.length, p),
    // I-03: the id the run gets if it starts now (launch.json keeps it, swarm start --run-id adopts it), so the start
    // question can be tied to it before the run exists; none for loose tasks (an ephemeral run never merges at the end).
    runId: planned ? runIdOf(planned.project, now) : null,
  });
};
