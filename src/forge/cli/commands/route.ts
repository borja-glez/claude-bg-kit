import type { Command } from '../context.js';
import { lstatSync, readFileSync, readdirSync, rmSync, rmdirSync } from 'node:fs';
import path from 'node:path';
import { readExecution } from '../../execution.js';
import { planLocale } from '../../../lib/locale.js';
import { samePath } from '../../../lib/worktree.js';
import { PATH_ORDER, type PathName } from '../../triage.js';
import { loadConfig, WORKFLOWS, AUTONOMIES, type Workflow } from '../../config.js';
import { resolvePrefs, isWorkflow, isAutonomy } from '../../prefs.js';
import { claudeSessionId, noClaudeSession } from '../../../lib/claude-session.js';
import { UsageError } from '../errors.js';
import { readLocal, updateLocal, mainCheckout } from '../../local.js';
import { addDecision } from '../../decisions.js';
import { TASK_ID } from '../../../lib/decisions.js';
import { SP_MAX, spPlanPool, spPlans, spSpecPool, spSpecs, type SpPlanEntry, type SpPool, type SpSpec } from '../../superpowers.js';
import {
  ROUTE_OPTIONS, ROUTE_STAGES, firstStage, isRoutePath, isRouteSession, needsPools, pruneRoutes, readRoute, routeAsk, routeOptions, stagedRoute, writeRoute,
  type RouteDoc, type RouteOption, type RouteStage,
} from '../../route.js';
import { superpowersOf, committedAt, declinedSpecs, spContext, triageCore } from '../shared.js';

/**
 * K1-01: a probe leaves nothing behind. When .forge/ holds only work/<task>/task.txt (the request the skill wrote for
 * it) and no .gitignore, that file and its empty directories go; anything else there, or a text file elsewhere, stays.
 * True once the task file is gone (the skill writes it again for forge:run), even when a directory then stays.
 */
export function cleanProbe(cwd: string, task: string, textFile: string, rmdir: (dir: string) => void = rmdirSync): boolean {
  const dir = path.join(cwd, '.forge');
  const file = path.join(dir, 'work', task, 'task.txt');
  if (!samePath(path.resolve(cwd, textFile), file)) return false;
  try {
    // A .forge/ that is a link (to a shared directory) is not one the probe made.
    if (!lstatSync(dir).isDirectory()) return false;
    const entries: string[] = [];
    const walk = (d: string, rel: string): void => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        entries.push(e.isDirectory() ? `${r}/` : r);
        if (e.isDirectory()) walk(path.join(d, e.name), r);
      }
    };
    walk(dir, '');
    if (entries.sort().join('\n') !== ['work/', `work/${task}/`, `work/${task}/task.txt`].join('\n')) return false;
    rmSync(file);
  } catch { return false; }
  try { for (const d of [path.join(dir, 'work', task), path.join(dir, 'work'), dir]) rmdir(d); } catch { /* an empty directory stays: nothing of the person's */ }
  return true;
}

export const command: Command = (args, ctx) => {
  const { io, repoDir, flag, has, json, ts } = ctx;
  const [sub] = args;
  const paths = (cmdName: string) => {
    const spec = flag('spec');
    const plan = flag('plan');
    for (const [name, v] of [['spec', spec], ['plan', plan]] as const) if (v !== undefined && !isRoutePath(v)) throw new UsageError(`${cmdName}: --${name} is not a plain path`);
    return { ...(spec ? { spec } : {}), ...(plan ? { plan } : {}) };
  };
  // Carry 8: --session's value, null when it has none or an empty one (C1: the environment's id is used then); one
  // that is not a plain session id exits 2, since it would name the route's file.
  const routeSessionFlag = (cmdName: string): string | null => {
    const v = flag('session');
    if (v === undefined || v.trim() === '') return null;
    if (!isRouteSession(v)) throw new UsageError(`${cmdName}: --session is not a plain session id`);
    return v;
  };
  if (sub === 'set') {
    const task = flag('task');
    const chosen = flag('chosen');
    const by = flag('by');
    if (!task || !TASK_ID.test(task)) throw new UsageError('route set: --task <id> is required');
    if (!(ROUTE_OPTIONS as readonly (string | undefined)[]).includes(chosen)) throw new UsageError(`route set: --chosen must be one of ${ROUTE_OPTIONS.join('|')}`);
    if (by !== 'user' && by !== 'auto') throw new UsageError('route set: --by must be user or auto');
    const files = paths('route set');
    // K1-04, K1-05 (C1): the route is this Claude session's, in .forge/route/<session>.json of the main checkout. It is
    // read with the other inputs, before anything is written; only none, which writes no route, goes without one. A
    // --session without a value, or an empty one (`--session ""`: an empty substitution), counts as absent, as in C1:
    // the environment's id is used.
    const given = routeSessionFlag('route set');
    const session = claudeSessionId(given, io.env ?? process.env);
    if (!session && chosen !== 'none') throw new UsageError(noClaudeSession('route set', '--session'));
    // K1-08: «remember it» keeps the choice as the project's workflow in local.yaml (`off` for none); none without it
    // writes nothing at all: no route file and no decision.
    const remembered: Workflow | null = has('remember') ? (chosen === 'none' ? 'off' : chosen as Workflow) : null;
    // Every input is read before anything is written: a --why-file that cannot be read leaves local.yaml alone.
    let why = by === 'user' ? 'the user chose it' : 'the recommended option for this request';
    if (flag('why-file') !== undefined) {
      try { why = readFileSync(path.resolve(io.cwd, flag('why-file')!), 'utf8').trim() || why; } catch { throw new UsageError('route set: cannot read --why-file'); }
    }
    if (remembered) updateLocal(io.cwd, s => ({ ...s, workflow: remembered }));
    if (chosen === 'none') return json({ written: false, ...(remembered ? { remembered } : {}) });
    // Not none: the session was required above.
    const owner = session!;
    const doc: RouteDoc = { task, chosen: chosen as RouteOption, by, stage: firstStage(chosen as RouteOption, files), ts: ts(), ...files, session: owner };
    const root = mainCheckout(io.cwd);
    writeRoute(root, doc);
    // Routes nobody wrote for a week are neither reminded nor carried: they go, never this session's own.
    pruneRoutes(root, owner, io.now().getTime());
    // The route is a decision like any other: by the user when asked, by auto mode otherwise.
    const exec = readExecution(root);
    const { n } = addDecision(root, {
      point: 'route', what: `route of ${task}`, chosen: doc.chosen, why, by,
      undo: { type: 'none', reason: 'the route only chose who does the work: start the task again to choose another' },
    }, { ts: ts(), task, runId: exec?.active ? exec.runId : null });
    return json({ ...doc, decision: n, ...(remembered ? { remembered } : {}) });
  }
  if (sub === 'stage') {
    const stage = flag('stage');
    if (!(ROUTE_STAGES as readonly (string | undefined)[]).includes(stage)) throw new UsageError(`route stage: --stage must be one of ${ROUTE_STAGES.join('|')}`);
    const files = paths('route stage');
    const session = claudeSessionId(routeSessionFlag('route stage'), io.env ?? process.env);
    if (!session) throw new UsageError(noClaudeSession('route stage', '--session'));
    // K1-04: only this session's route moves; another session's is never touched.
    const main = mainCheckout(io.cwd);
    const cur = readRoute(main, session);
    if (!cur || (flag('task') !== undefined && flag('task') !== cur.task)) return json({ updated: false });
    const next = stagedRoute(cur, stage as RouteStage, ts(), files);
    writeRoute(main, next);
    return json({ updated: true, ...next });
  }
  if (sub !== undefined && !sub.startsWith('--')) {
    throw new UsageError('usage: forge route --task id (--path p | --text-file f [--path p]) [--locale es|en] [--workflow w] [--autonomy a] [--run-plan] [--build-spec] | set --task id --chosen o --by user|auto [--spec f] [--plan f] [--why-file f] [--session s] [--remember] | stage --stage s [--task id] [--spec f] [--plan f] [--session s]');
  }
  const task = flag('task');
  if (!task || !TASK_ID.test(task)) throw new UsageError('route: --task <id> is required');
  const loc = flag('locale');
  if (has('locale') && loc !== 'es' && loc !== 'en') throw new UsageError('route: --locale must be es or en');
  if (has('text-file') && flag('text-file') === undefined) throw new UsageError('route: --text-file needs a file');
  // K1-01: with the request's text, a triage that writes nothing (no ledger, status.json nor local.yaml) gives the path.
  const textFile = flag('text-file');
  const inputs = () => {
    const probed = textFile !== undefined ? triageCore(io, ['--task', task, '--text-file', textFile, ...(loc ? ['--locale', loc] : [])]) : null;
    const p = flag('path') ?? probed?.result.path;
    if (!p || !(PATH_ORDER as readonly string[]).includes(p)) throw new UsageError(`route: --path must be one of ${PATH_ORDER.join('|')}`);
    const wf = flag('workflow');
    const au = flag('autonomy');
    if (wf !== undefined && !isWorkflow(wf)) throw new UsageError(`route: --workflow must be one of ${WORKFLOWS.join('|')}`);
    if (au !== undefined && !isAutonomy(au)) throw new UsageError(`route: --autonomy must be one of ${AUTONOMIES.join('|')}`);
    return { probed, p, wf, au };
  };
  let got: ReturnType<typeof inputs>;
  // A probe that exits 2 (an empty text, a bad --path, --workflow or --autonomy) leaves nothing behind either.
  try { got = inputs(); } catch (e) { if (textFile !== undefined && e instanceof UsageError) cleanProbe(io.cwd, task, textFile); throw e; }
  const { probed, p, wf, au } = got;
  const prefs = resolvePrefs({ ...(wf ? { workflow: wf } : {}), ...(au ? { autonomy: au } : {}) }, readLocal(io.cwd), loadConfig(repoDir), io.env ?? process.env);
  const sp = superpowersOf(io, repoDir);
  const now = io.now().getTime();
  // K1-07: the request names the plan or spec to recommend; the probe already read the file, so it reads.
  const text = textFile !== undefined ? (() => { try { return readFileSync(path.resolve(io.cwd, textFile), 'utf8'); } catch { return ''; } })() : '';
  // K1-07: plans done elsewhere and specs already planned or handed off are no longer offered. I2: when the recommendation
  // can use them (needsPools), the request is matched against all of the pending ones, and the rest of their folders keep
  // a request that names one from getting another; else only the offered ones are read.
  const spc = sp.installed ? spContext(io, repoDir, now) : null;
  const wide = needsPools({ runPlan: has('run-plan'), buildSpec: has('build-spec'), text });
  const specOpts = spc ? { committedAt: committedAt(io, repoDir), declined: declinedSpecs(readLocal(io.cwd)), routed: spc.routed } : null;
  const planOpts = spc ? { committedAt: committedAt(io, repoDir), main: spc.main, subjects: spc.subjects } : null;
  const specPool: SpPool<SpSpec> = !specOpts ? { pending: [], others: [] }
    : wide ? spSpecPool(repoDir, now, specOpts) : { pending: spSpecs(repoDir, now, specOpts), others: [] };
  const planPool: SpPool<SpPlanEntry> = !planOpts ? { pending: [], others: [] }
    : wide ? spPlanPool(repoDir, now, planOpts) : { pending: spPlans(repoDir, now, planOpts), others: [] };
  const options = routeOptions({
    path: p as PathName, prefs, superpowers: { installed: sp.installed, version: sp.version },
    specs: specPool.pending.slice(0, SP_MAX), plans: planPool.pending.slice(0, SP_MAX), pools: { specs: specPool, plans: planPool },
    runPlan: has('run-plan'), buildSpec: has('build-spec'), text,
  });
  if (!probed) return json(options);
  // A raised --path only chooses here; forge:run triages again and records the path it follows.
  const effective = PATH_ORDER.indexOf(p as PathName) > PATH_ORDER.indexOf(probed.result.path) ? p as PathName : probed.result.path;
  const stepAside = PATH_ORDER.indexOf(effective) <= PATH_ORDER.indexOf('small') && prefs.workflow !== 'forge';
  const askLocale: 'es' | 'en' = loc === 'es' || loc === 'en' ? loc : (planLocale(io.cwd) ?? '').toLowerCase().split(/[-_]/)[0] === 'es' ? 'es' : 'en';
  const cleaned = cleanProbe(io.cwd, task, textFile!);
  // A workflow pinned to a superpowers option that is not installed cannot be applied: the person is asked
  // (route/SKILL.md «say so and ask as below»), as when nothing is pinned.
  const unavailable = prefs.workflow.startsWith('superpowers') && !sp.installed;
  return json({
    ...options, probe: { path: probed.result.path, reasons: probed.result.reasons, sensitive: probed.result.sensitive, files: probed.result.files, announce: probed.output.announce },
    stepAside, ask: (prefs.workflow !== 'ask' && !unavailable) || prefs.autonomy === 'auto' ? null : routeAsk(options, askLocale), cleaned,
  });
};
