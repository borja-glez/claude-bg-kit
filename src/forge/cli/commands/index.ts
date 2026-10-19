import type { Command } from '../context.js';
import { command as agents } from './agents.js';
import { command as authorize } from './authorize.js';
import { command as brief } from './brief.js';
import { command as config } from './config.js';
import { command as cycle } from './cycle.js';
import { command as decision } from './decision.js';
import { command as hook } from './hook.js';
import { command as infinite } from './infinite.js';
import { command as last } from './last.js';
import { command as local } from './local.js';
import { command as log } from './log.js';
import { command as prefs } from './prefs.js';
import { command as begin } from './begin.js';
import { command as proposals } from './proposals.js';
import { command as review } from './review.js';
import { command as roadmap } from './roadmap.js';
import { command as round } from './round.js';
import { command as route } from './route.js';
import { command as setup } from './setup.js';
import { command as spPath } from './sp-path.js';
import { command as spPlan } from './sp-plan.js';
import { command as spPlans } from './sp-plans.js';
import { command as spSpecs } from './sp-specs.js';
import { command as stats } from './stats.js';
import { command as stop } from './stop.js';
import { command as surfaces } from './surfaces.js';
import { command as swarm } from './swarm.js';
import { command as tdd } from './tdd.js';
import { command as tools } from './tools.js';
import { command as tree } from './tree.js';
import { command as triage } from './triage.js';
import { command as validate } from './validate.js';
import { command as verdict } from './verdict.js';
import { command as verifyCleanup } from './verify-cleanup.js';
import { command as verifyClose } from './verify-close.js';
import { command as verifyPlan } from './verify-plan.js';
import { command as verifyResult } from './verify-result.js';
import { command as waypointCli } from './waypoint-cli.js';

/** I-12: every forge command by the name it is called with, the same names as USAGE in ../run.ts (tests/forge-cli-modules). */
export const COMMANDS: Readonly<Record<string, Command>> = {
  triage, brief, validate, stats, verdict, round,
  'review-prep': review, 'review-close': review, prep: review, shadow: review,
  log, decision, agents, last, proposals, surfaces, tools, local, prefs, begin, route,
  'verify-plan': verifyPlan, 'verify-result': verifyResult, 'verify-cleanup': verifyCleanup, 'verify-close': verifyClose,
  'waypoint-cli': waypointCli, 'sp-path': spPath, 'sp-specs': spSpecs, 'sp-plans': spPlans, 'sp-plan': spPlan,
  tdd, tree, config, infinite, cycle, authorize, swarm, setup, stop, hook,
  'roadmap-doc': roadmap, 'roadmap-run': roadmap,
};
