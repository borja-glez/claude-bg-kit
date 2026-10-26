import type { Command } from '../context.js';
import { UsageError } from '../errors.js';
import { defaultGit } from '../exec.js';
import { tddFor } from '../shared.js';
import { foreignPaths, foreignSay } from '../../begin.js';
import { AUTONOMIES, loadConfig } from '../../config.js';
import { readLocal } from '../../local.js';
import { isAutonomy, resolvePrefs } from '../../prefs.js';
import { parseStatus } from '../../tree.js';
import { isSafeId } from '../../../lib/execution-state.js';

/**
 * J-12, forge begin: what forge:run reads before a task, in one call. The changes of the tree that are not forge's
 * (`foreign`, and the question in `say`: forge asks, commits and stashes nothing), the snapshot of `tree snapshot` (the
 * first one stands), the TDD line, the resolved autonomy and workflow, and `.forge/.gitignore` while git does not track
 * it. `--cwd`: the code's directory, as for every command.
 */
export const command: Command = (args, ctx) => {
  const { io, repoDir, flag, has, json, run } = ctx;
  const task = flag('task');
  if (!task || !isSafeId(task)) throw new UsageError('begin: --task <id> is required (letters, digits, _ - .; at most 120)');
  const locale = flag('locale');
  if (has('locale') && locale !== 'es' && locale !== 'en') throw new UsageError('begin: --locale must be es or en');
  const autonomy = flag('autonomy');
  if (has('autonomy') && !isAutonomy(autonomy)) throw new UsageError(`begin: --autonomy must be one of ${AUTONOMIES.join('|')}`);
  const git = io.git ?? defaultGit(repoDir);
  const status = git(['status', '--porcelain', '-z', '-uall']);
  if (status === null) throw new UsageError(`begin: git status failed in ${repoDir}`);
  const { modified, untracked } = parseStatus(status);
  const foreign = foreignPaths([...modified, ...untracked]);
  // The snapshot is tree snapshot's, through the CLI itself: the same file and the same rule. T3: without it, its message
  // says why (tree check then lists every path, which is safe).
  const snap = run(['tree', 'snapshot', '--task', task], io);
  const snapshot = snap.code === 0 ? true : null;
  const snapshotError = snapshot ? null : snap.stderr.trim() || `tree snapshot exited ${snap.code}`;
  const tdd = tddFor(io, repoDir);
  const prefs = resolvePrefs(isAutonomy(autonomy) ? { autonomy } : {}, readLocal(io.cwd), loadConfig(repoDir), io.env ?? process.env);
  // forge's .gitignore lives with its state, in the caller's checkout, as triage says.
  const stateGit = io.workdir === undefined ? git : defaultGit(io.cwd);
  const ignore = (stateGit(['ls-files', '--others', '--exclude-standard', '--', '.forge/.gitignore']) ?? '').trim();
  return json({
    foreign, snapshot, ...(snapshotError === null ? {} : { snapshotError }), tdd: { mode: tdd.tdd, line: tdd.line }, autonomy: prefs.autonomy, workflow: prefs.workflow,
    untracked: ignore ? ['.forge/.gitignore'] : [], say: foreign.length ? foreignSay(foreign, locale === 'es' ? 'es' : 'en') : null,
  });
};
