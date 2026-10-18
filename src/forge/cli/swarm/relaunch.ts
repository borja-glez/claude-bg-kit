import type { SwarmCommand } from './context.js';
import { statSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { UsageError } from '../errors.js';
import { taskWorktree } from '../../execution.js';
import { relaunchOrBlock, RELAUNCH_CAP } from '../../schedule.js';
import { planLocale } from '../../../lib/locale.js';
import { pickWorkDir, workDir, workRel } from '../../task-ref.js';
import { loadPlanArg, memberLaunch } from './shared.js';

export const subcommand: SwarmCommand = (rest, ctx) => {
  const { sub, io, deps, flag, has, json, iso, current, update, taskArg } = ctx;
  const task = taskArg();
  const e = current();
  const t = e.tasks[task];
  if (!t || t.status !== 'running' || t.executor !== 'sessions') throw new UsageError(`swarm ${sub}: ${task} is not a running sessions task`);
  const planArg = flag('plan');
  if (has('plan') && (!planArg || planArg.startsWith('-'))) throw new UsageError(`swarm ${sub}: --plan needs a file`);
  if (planArg) {
    const isFile = (() => { try { return statSync(path.resolve(io.cwd, planArg)).isFile(); } catch { return false; } })();
    if (planArg.startsWith('-') || !isFile) throw new UsageError(`swarm ${sub}: --plan ${planArg} is not a plan file`);
  }
  if (sub === 'nudge') {
    // The text (and so the plan) is read before anything is saved.
    const es = (planArg ? loadPlanArg(io, planArg, 'nudge').locale : planLocale(io.cwd, e.project)) === 'es';
    const text = es ? `[forge run] ${task}: continúa con ${t.stage}; si estás bloqueado, márcalo como bloqueado`
      : `[forge run] ${task}: continue with ${t.stage}; if you are blocked, mark it blocked`;
    update(cur => cur && { ...cur, tasks: { ...cur.tasks, [task]: { ...(cur.tasks[task] ?? t), nudgedAt: iso } } });
    return json({ task, name: `wp-${e.project}-${task}`, text });
  }
  const planPath = planArg;
  if (!planPath) throw new UsageError('swarm relaunch: --plan is required');
  // The cap and the reason live in schedule.ts: one rule for the scheduler and this command.
  const verdict = relaunchOrBlock(task, t.attempts);
  if (verdict.type === 'block') {
    update(cur => cur && { ...cur, tasks: { ...cur.tasks, [task]: { ...(cur.tasks[task] ?? t), status: 'blocked', detail: verdict.reason, updatedAt: iso, finishedAt: iso } } });
    return json({ task, blocked: true, reason: verdict.reason });
  }
  const attempt = verdict.attempt;
  const log = deps.git(['log', '--oneline', '-n', '20', `${e.branch}..${t.branch}`])?.trim();
  const commits = log ? log.split(/\r?\n/).map(l => `  - ${l}`).join('\n') : '  - none';
  // D-08: the task's work folder, by project; the note goes to the main checkout's, the member works in its worktree's.
  const ref = { project: e.kind === 'plan' ? e.project : null, task };
  const note = path.join(workDir(io.cwd, ref), 'handover.md');
  // A run member keeps its work files (brief-<n>.md, report-<n>.txt, validators-<n>.json, reviews-<n>-<round>/)
  // in .forge/work/<project>/<T>/ of its own task worktree, where it runs; only this note lives in the main checkout.
  // A member started before D-08 has them in the older .forge/work/<T>/ there: the folder with its brief is named.
  const memberRoot = t.worktree || taskWorktree(io.cwd, task);
  const memberWork = pickWorkDir(workDir(memberRoot, ref), workDir(memberRoot, { project: null, task }));
  mkdirSync(path.dirname(note), { recursive: true });
  writeFileSync(note, [
    `# Handover: ${task} (attempt ${attempt} of ${RELAUNCH_CAP + 1})`, '',
    `- Run: ${e.runId} · coordinator ${e.coordinator} · run branch ${e.branch}`,
    `- Last stage: ${t.stage} · round ${t.round} · agent ${t.agent ?? 'none'} · since ${t.stageSince}`,
    `- Detail: ${t.detail ?? 'none'}`,
    `- Commits on ${t.branch} not yet on ${e.branch}:`, commits, '',
    `- This note: ${note} (main checkout ${io.cwd})`,
    `- Work files of the earlier attempts: ${memberWork} (the brief is brief-<n>.md there, with report-<n>.txt, validators-<n>.json and reviews-<n>-<round>/)`, '',
    `Resume from ${t.branch} in this worktree: read the brief in ${memberWork} if it exists (else write it as the brief stage says), `
      + `do not redo a step whose output file is already written, and continue from the last stage.`, '',
  ].join('\n'));
  update(cur => cur && { ...cur, tasks: { ...cur.tasks, [task]: { ...(cur.tasks[task] ?? t), attempts: attempt, startedAt: iso, nudgedAt: null, updatedAt: iso } } });
  return json({ task, attempt, note, work: workRel(ref), launch: memberLaunch(io.cwd, planPath, task, e) });
};
