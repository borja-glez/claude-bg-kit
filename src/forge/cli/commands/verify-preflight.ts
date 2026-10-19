import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Command } from '../context.js';
import { UsageError } from '../errors.js';
import { defaultGit } from '../exec.js';
import { surfaceQuestion } from '../shared.js';
import { NAME } from '../../config.js';
import { readExecution, updateExecution } from '../../execution.js';
import { ledgerRoot } from '../../ledger.js';
import { mainCheckout, readLearned, readLocal, surfacePermissions } from '../../local.js';
import { readSurfaces } from '../../surfaces.js';
import { preflight, type PlanSurface } from '../../verify.js';
import { parsePlan, PlanError } from '../../../lib/plan.js';
import { planLocale } from '../../../lib/locale.js';
import { samePath } from '../../../lib/worktree.js';
import type { PlanTask } from '../../../lib/types.js';

/**
 * K2-08, once when an execution starts: `FORGE verify-preflight --plan <plan> [--locale es|en]` lists the surfaces whose
 * permission the person must give (ask, or changed since they gave it) that the plan's tasks may use, each with the
 * question verify-plan would ask and the tasks it serves. `FORGE verify-preflight --skip <name>` records «No, esta vez»
 * for this checkout's execution, active or finished: verify-plan skips that surface until another run replaces it. Only the coordinator writes
 * execution.json, so --skip refuses to run from a task worktree.
 */
export const command: Command = (args, ctx) => {
  const { io, repoDir, flag, has, json } = ctx;
  const main = mainCheckout(io.cwd);
  if (has('skip')) {
    if (!samePath(ledgerRoot(io.cwd), io.cwd)) throw new UsageError('verify-preflight: --skip is the coordinator\'s, from the main checkout');
    const name = flag('skip');
    if (!name || !NAME.test(name)) throw new UsageError('verify-preflight: --skip needs the name of a surface');
    const exec = readExecution(main);
    // Active, finished or an ephemeral run closed by its tick: the final flow pass is asked about after the run ended.
    if (!exec) throw new UsageError('verify-preflight: --skip needs an execution in this checkout (outside one, «No, esta vez» records nothing)');
    const next = updateExecution(main, cur => {
      if (!cur || cur.runId !== exec.runId || (cur.verifySkip ?? []).includes(name)) return null;
      return { ...cur, verifySkip: [...(cur.verifySkip ?? []), name] };
    });
    return json({ runId: exec.runId, skip: (next ?? readExecution(main))?.verifySkip ?? [] });
  }
  const planArg = flag('plan');
  if (!planArg) throw new UsageError('verify-preflight: --plan <plan> or --skip <name> is required');
  const loc = flag('locale');
  if (has('locale') && loc !== 'es' && loc !== 'en') throw new UsageError('verify-preflight: --locale must be es|en');
  let tasks: PlanTask[];
  try { tasks = parsePlan(readFileSync(path.resolve(io.cwd, planArg), 'utf8')).tasks; } catch (e) {
    throw new UsageError(`verify-preflight: cannot read the plan ${planArg}${e instanceof PlanError ? `: ${e.issues.join('; ')}` : ''}`);
  }
  const git = io.git ?? defaultGit(repoDir);
  const tracked = (git(['-c', 'core.quotePath=false', 'ls-files']) ?? '').split('\n').map(s => s.trim()).filter(Boolean);
  const surfaces = readSurfaces(repoDir, readLearned(io.cwd));
  // A local.yaml git tracks grants no surface (final-carries 7), here as in verify-plan.
  const read = readLocal(io.cwd);
  const local = { ...read, surfaces: surfacePermissions(io.cwd, read) };
  const es = (loc ?? planLocale(io.cwd)) === 'es';
  const listed = preflight({ tasks, tracked, surfaces, local }).map(p => {
    const s = surfaces.find(x => x.name === p.name)!;
    const ps: PlanSurface = { name: p.name, permission: p.permission, match: null, depth: 'smoke', missing: [], unknown: [], hash: s.hash };
    const q = surfaceQuestion(ps, s, local.surfaces[p.name], git, repoDir, io.cwd, es);
    return {
      name: q.name, permission: q.permission, hash: q.hash, tasks: p.tasks, ...(q.diff !== undefined ? { diff: q.diff } : {}),
      ...(q.diffTruncated ? { diffTruncated: true } : {}), ...(q.diffFile !== undefined ? { diffFile: q.diffFile } : {}), ...(q.commits ? { commits: q.commits } : {}), ask: q.ask,
    };
  });
  const names = listed.map(x => x.name).join(', ');
  const say = es
    ? (listed.length ? `Antes de empezar, ${listed.length} superficie(s) piden permiso: ${names}.` : 'Ninguna superficie pide permiso para esta ejecución.')
    : (listed.length ? `Before starting, ${listed.length} surface(s) ask for permission: ${names}.` : 'No surface asks for permission for this run.');
  return json({ surfaces: listed, say });
};
