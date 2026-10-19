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
  let flow: Record<string, unknown> | null = null;
  if (plan.eligible) {
    // One more than the highest pass number (a folder deleted by hand frees no number), in a folder that must be new.
    const last = flowDirs(io.cwd, e.runId).at(-1);
    const n = last ? Number(/-(\d+)$/.exec(path.basename(last))![1]) + 1 : 1;
    const id = flowDirName(e.runId, n);
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
  return json({ ...plan, surfaces: listedSurfaces, flow });
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
  const needs = plan.surfaces.filter(s => s.permission === 'ask' || s.permission === 'changed');
  for (const s of plan.surfaces.filter(x => x.permission === 'skipped')) {
    appendEvent(io.cwd, { ts: ts(), kind: 'verify-skip', task, surface: s.name, reason: 'not this time, for this run' });
  }
  const fresh = new Set(unattended ? needs.map(s => s.name) : []);
  if (unattended) {
    for (const s of needs) appendEvent(io.cwd, { ts: ts(), kind: 'verify-skip', task, surface: s.name, reason: `unattended: permission ${s.permission}` });
    // K2-08: one question note per surface and run. A member never writes execution.json: the first caller to create
    // <main>/.forge/execution/asked/<runId>/<surface>.json leaves the note; the folder goes with the run.
    if (running && needs.length) {
      fresh.clear();
      for (const s of needs) {
        if (createIfAbsent(path.join(main, '.forge', 'execution', 'asked', running.runId, `${s.name}.json`), JSON.stringify({ task, at: ts() }) + '\n')) fresh.add(s.name);
      }
    }
  }
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
  const note = (ps: PlanSurface) => (unattended && (ps.permission === 'ask' || ps.permission === 'changed') ? { note: fresh.has(ps.name) } : {});
  return json({ ...plan, surfaces: plan.surfaces.map(ps => ({
    ...surfaceQuestion(ps, surfaces.find(s => s.name === ps.name)!, local.surfaces[ps.name], git, repoDir, io.cwd, es), ...note(ps),
  })) });
};
