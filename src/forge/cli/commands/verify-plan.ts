import type { Command } from '../context.js';
import { rmSync, writeFileSync, mkdirSync } from 'node:fs';
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

/**
 * --unattended (K2-08): with nobody to ask, a surface that needs the person logs its verify-skip, and note: true says to
 * leave the question note (once per surface and run).
 */
export const command: Command = (args, ctx) => {
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
