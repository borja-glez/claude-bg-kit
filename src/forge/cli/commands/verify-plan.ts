import type { Command, Ctx, Result } from '../context.js';
import { rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { appendEvent } from '../../ledger.js';
import { planLocale } from '../../../lib/locale.js';
import { PATH_ORDER } from '../../triage.js';
import { UsageError } from '../errors.js';
import { onPath } from '../../validators.js';
import { toolGaps } from '../../tools.js';
import { verifyPlan, type PlanSurface } from '../../verify.js';
import { readExecution, createIfAbsent } from '../../execution.js';
import { readLocal, readLearned, surfacePermissions, mainCheckout } from '../../local.js';
import { readSurfaces, detectDrafts, surfaceFile } from '../../surfaces.js';
import { defaultGit, repoReader } from '../exec.js';
import { mcpOf, surfaceQuestion } from '../shared.js';
import { loadConfig, verifyFlow } from '../../config.js';
import { flowBrief, flowDirName, flowDirs, flowSince, integratedSince } from '../../flow.js';
import { parsePlan } from '../../../lib/plan.js';
import type { PlanTask } from '../../../lib/types.js';

const needsPerson = (s: PlanSurface) => s.permission === 'ask' || s.permission === 'changed';

/** K2-08: a surface the person skipped for this run logs its verify-skip, under `task` (a task id, or a flow pass id). */
function logSkipped(cwd: string, ts: () => string, task: string, surfaces: PlanSurface[]): void {
  for (const s of surfaces.filter(x => x.permission === 'skipped')) {
    appendEvent(cwd, { ts: ts(), kind: 'verify-skip', task, surface: s.name, reason: 'not this time, for this run' });
  }
}

/**
 * K2-08, with nobody to ask: each surface that needs the person logs its verify-skip, and the names that get their
 * question note now are returned. One note per surface and run: a member never writes execution.json, so the first
 * caller to create <main>/.forge/execution/asked/<runId>/<surface>.json leaves the note; the folder goes with the run.
 */
function unattendedNotes(a: { cwd: string; ts: () => string; main: string; task: string; runId: string | null; surfaces: PlanSurface[] }): Set<string> {
  const needs = a.surfaces.filter(needsPerson);
  for (const s of needs) appendEvent(a.cwd, { ts: a.ts(), kind: 'verify-skip', task: a.task, surface: s.name, reason: `unattended: permission ${s.permission}` });
  if (!a.runId || !needs.length) return new Set(needs.map(s => s.name));
  const fresh = new Set<string>();
  for (const s of needs) {
    if (createIfAbsent(path.join(a.main, '.forge', 'execution', 'asked', a.runId, `${s.name}.json`), JSON.stringify({ task: a.task, at: a.ts() }) + '\n')) fresh.add(s.name);
  }
  return fresh;
}

/** The tasks of docs/waypoint/<project>/plan.yaml of the main checkout; none when it does not read. */
function planTasksOf(main: string, project: string): PlanTask[] {
  try { return parsePlan(readFileSync(path.join(main, 'docs', 'waypoint', project, 'plan.yaml'), 'utf8')).tasks; } catch { return []; }
}

/**
 * K2-13: `FORGE verify-plan --run [--since <sha>] [--cwd <the run's checkout>] [--locale es|en]`: the surfaces of a run's
 * integrated result, from the diff since the last flow pass (else since the commit before its first integration) to HEAD
 * of --cwd, every one at depth flow. None with verify.flow off, before any integration, or with nothing new since the
 * last pass. With an eligible surface it opens the pass's folder .forge/work/flow-<runId>-<n>/ (flow.json, brief.md with
 * the tasks integrated since, diff.patch) and prints it as `flow`. An ephemeral run is already closed by the tick that
 * finished it when its pass runs, so only a missing execution is refused.
 */
function runPlan(ctx: Ctx): Result {
  const { io, repoDir, flag, has, json, ts } = ctx;
  const main = mainCheckout(io.cwd);
  const e = readExecution(main);
  if (!e) throw new UsageError('verify-plan --run: no execution in this checkout');
  const loc = flag('locale');
  if (has('locale') && loc !== 'es' && loc !== 'en') throw new UsageError('verify-plan: --locale must be es|en');
  const es = (loc ?? planLocale(io.cwd)) === 'es';
  const none = (reason: string) => json({ eligible: false, surfaces: [], drafts: [], reason, flow: null });
  if (verifyFlow(loadConfig(main)) === 'off') return none('verify.flow is off');
  const sinceArg = flag('since');
  if (has('since') && (!sinceArg || !/^[0-9a-f]{7,64}$/i.test(sinceArg))) throw new UsageError('verify-plan --run: --since takes a commit id');
  const git = io.git ?? defaultGit(repoDir);
  const since = sinceArg ?? flowSince(e, git);
  if (!since) return none('nothing integrated yet');
  const head = (git(['rev-parse', 'HEAD']) ?? '').trim();
  const names = git(['diff', '--name-only', `${since}..HEAD`]);
  if (!head || names === null) throw new UsageError(`verify-plan --run: cannot diff ${since}..HEAD`);
  const changed = names.split('\n').map(s => s.trim()).filter(Boolean);
  if (!changed.length) return none('nothing integrated since the last flow pass');
  const surfaces = readSurfaces(repoDir, readLearned(io.cwd));
  const read = readLocal(io.cwd);
  const local = { ...read, surfaces: surfacePermissions(io.cwd, read) };
  let inventory: Set<string> | null = null;
  const plan = verifyPlan({
    path: 'large', asked: false, changed, surfaces, drafts: [], local, skip: e.verifySkip ?? [],
    tools: s => (s.tools.length ? toolGaps(s.tools, { onPath, inventory: inventory ??= mcpOf(io, repoDir) }) : { missing: [], unknown: [] }),
  });
  // The id the next pass would get: one more than the highest pass number (a folder deleted by hand frees no number).
  const last = flowDirs(io.cwd, e.runId).at(-1);
  const n = last ? Number(/-(\d+)$/.exec(path.basename(last))![1]) + 1 : 1;
  const id = flowDirName(e.runId, n);
  // With nobody to ask, what needs the person is skipped (verify-skip, one note per surface and run); attended, the
  // pass waits until nobody is: every `verify-plan --run` that opened a folder would leave an orphan pass per answer.
  const unattended = has('unattended');
  const waiting = plan.surfaces.filter(needsPerson).map(s => s.name);
  const fresh = unattended ? unattendedNotes({ cwd: io.cwd, ts, main, task: id, runId: e.runId, surfaces: plan.surfaces }) : new Set<string>();
  const opens = plan.eligible && plan.surfaces.some(s => s.permission === 'allowed') && (unattended || !waiting.length);
  let reason: string | undefined;
  if (plan.surfaces.length && !opens) reason = unattended || !waiting.length ? 'no surface is allowed for an unattended pass' : `ask the person first: ${waiting.join(', ')}`;
  let flow: Record<string, unknown> | null = null;
  if (opens) {
    logSkipped(io.cwd, ts, id, plan.surfaces);
    const dir = path.join(io.cwd, '.forge', 'work', id);
    mkdirSync(path.join(io.cwd, '.forge', 'work'), { recursive: true });
    mkdirSync(dir);
    const planTasks = e.kind === 'plan' ? planTasksOf(main, e.project) : [];
    const listed = integratedSince(e, git, since).map(t => {
      const p = planTasks.find(x => x.id === t);
      return { id: t, title: e.tasks[t]?.title ?? p?.title ?? t, done_when: p?.done_when ?? null };
    });
    writeFileSync(path.join(dir, 'brief.md'), flowBrief(e.runId, n, listed));
    writeFileSync(path.join(dir, 'diff.patch'), git(['diff', `${since}..HEAD`]) ?? '');
    const doc = { runId: e.runId, n, id, since, head, at: ts() };
    writeFileSync(path.join(dir, 'flow.json'), JSON.stringify(doc, null, 2) + '\n');
    const rel = (f: string) => path.relative(io.cwd, f).split(path.sep).join('/');
    flow = { ...doc, dir: rel(dir), brief: rel(path.join(dir, 'brief.md')), diff: rel(path.join(dir, 'diff.patch')), evidence: rel(path.join(dir, 'evidence')) };
  }
  // A pass checks the flows of every task it covers: every surface at depth flow.
  const listedSurfaces = plan.surfaces.map(ps => surfaceQuestion({ ...ps, depth: 'flow' }, surfaces.find(s => s.name === ps.name)!,
    local.surfaces[ps.name], git, repoDir, io.cwd, es));
  const noted = listedSurfaces.map((s, i) => (unattended && needsPerson(plan.surfaces[i]) ? { ...s, note: fresh.has(plan.surfaces[i].name) } : s));
  return json({ ...plan, ...(reason ? { reason } : {}), surfaces: noted, flow });
}

/**
 * --unattended (K2-08): with nobody to ask, a surface that needs the person logs its verify-skip, and note: true says to
 * leave the question note (once per surface and run).
 */
export const command: Command = (args, ctx) => {
  if (ctx.has('run')) return runPlan(ctx);
  const { io, repoDir, flag, has, json, ts } = ctx;
  const task = flag('task'), p = flag('path'), base = flag('base');
  if (!task || !p || !base) throw new UsageError('verify-plan: --task, --path and --base are required');
  if (!(PATH_ORDER as readonly string[]).includes(p)) throw new UsageError(`verify-plan: --path must be one of ${PATH_ORDER.join('|')}`);
  const loc = flag('locale');
  if (has('locale') && loc !== 'es' && loc !== 'en') throw new UsageError('verify-plan: --locale must be es|en');
  // I2: --dir <review dir> (reviews-<n>-<round>): swarm step waits there for the verify agent of the surfaces it chose.
  const dirArg = flag('dir');
  const roundDir = dirArg === undefined ? null : path.resolve(io.cwd, dirArg);
  const roundOf = roundDir ? /^reviews-(\d+)-(\d+)$/.exec(path.basename(roundDir)) : null;
  if (has('dir') && !roundOf) throw new UsageError('verify-plan: --dir must be a review dir, .forge/work/<project>/<T>/reviews-<n>-<round> (a loose task: .forge/work/<id>/reviews-<n>-<round>)');
  const es = (loc ?? planLocale(io.cwd)) === 'es';
  const git = io.git ?? defaultGit(io.cwd);
  const diff = git(['diff', '--name-only', `${base}..HEAD`]);
  // The surfaces of the code checked (--cwd: a task's worktree), the permissions of this machine.
  const surfaces = readSurfaces(repoDir, readLearned(io.cwd));
  // A local.yaml git tracks grants no surface (final-carries 7).
  const read = readLocal(io.cwd);
  const local = { ...read, surfaces: surfacePermissions(io.cwd, read) };
  // K2-08: in an active execution, a surface the person answered «No, esta vez» for is skipped for the whole run.
  const main = mainCheckout(io.cwd);
  const exec = readExecution(main);
  const running = exec?.active ? exec : null;
  let inventory: Set<string> | null = null;
  const plan = verifyPlan({
    path: p, asked: has('asked'),
    changed: diff === null ? null : diff.split('\n').map(s => s.trim()).filter(Boolean),
    surfaces, drafts: detectDrafts(repoReader(repoDir)), local,
    skip: running?.verifySkip ?? [],
    tools: s => (s.tools.length ? toolGaps(s.tools, { onPath, inventory: inventory ??= mcpOf(io, repoDir) }) : { missing: [], unknown: [] }),
  });
  appendEvent(io.cwd, { ts: ts(), kind: 'verify', task, planned: plan.eligible, surfaces: plan.surfaces.filter(s => s.permission === 'allowed').map(s => s.name) });
  // K2-08: a skipped surface logs only its verify-skip. With nobody to ask (--unattended), a surface that needs the
  // person is not verified (its verify-skip is logged here) and its question note is asked for once per run (note).
  const unattended = has('unattended');
  logSkipped(io.cwd, ts, task, plan.surfaces);
  const fresh = unattended ? unattendedNotes({ cwd: io.cwd, ts, main, task, runId: running?.runId ?? null, surfaces: plan.surfaces }) : new Set<string>();
  if (roundDir && roundOf) {
    // verify-pending.json: the surfaces it can verify (allowed now) and what a verify agent needs to be spawned
    // again. A surface the coordinator decides not to verify is logged as a verify-skip; with none, no marker.
    const pending = path.join(roundDir, 'verify-pending.json');
    const chosen = plan.surfaces.filter(s => s.permission === 'allowed');
    const rel = (f: string) => path.relative(io.cwd, f).split(path.sep).join('/');
    const work = path.dirname(roundDir);
    const [, n, round] = roundOf;
    if (plan.eligible && chosen.length) {
      mkdirSync(roundDir, { recursive: true });
      writeFileSync(pending, JSON.stringify({
        task, at: ts(), surfaces: chosen.map(s => ({ name: s.name, file: surfaceFile(s.name), depth: s.depth, missing: s.missing, unknown: s.unknown })),
        brief: rel(path.join(work, `brief-${n}.md`)), diff: rel(path.join(work, `diff-${n}.patch`)), dir: rel(roundDir), evidence: rel(path.join(work, 'evidence', `${n}-${round}`)),
      }, null, 2) + '\n');
    } else rmSync(pending, { force: true });
  }
  const note = (ps: PlanSurface) => (unattended && needsPerson(ps) ? { note: fresh.has(ps.name) } : {});
  return json({ ...plan, surfaces: plan.surfaces.map(ps => ({
    ...surfaceQuestion(ps, surfaces.find(s => s.name === ps.name)!, local.surfaces[ps.name], git, repoDir, io.cwd, es), ...note(ps),
  })) });
};
