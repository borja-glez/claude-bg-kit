import type { Command } from '../context.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { readEvents, forgeDir } from '../../ledger.js';
import { isSafeId } from '../../../lib/execution-state.js';
import { samePath } from '../../../lib/worktree.js';
import { parseStatus, parseSnapshot, treeCheck, type TreeSnapshot } from '../../tree.js';
import { UsageError } from '../errors.js';
import { readWorkDir, resolveProject } from '../../task-ref.js';
import { defaultGit } from '../exec.js';

export const command: Command = (args, ctx) => {
  const { io, repoDir, flag, has, ok, json, ts } = ctx;
  // The work tree of the code (--cwd) against the snapshot kept with forge's state (the caller's directory).
  const sub = args[0];
  const task = flag('task');
  const usage = 'usage: forge tree snapshot --task <id> [--force] [--cwd <dir>] | check --task <id> --base <sha> [--cwd <dir>] (the same --cwd as the snapshot; --base is the task\'s own base)';
  if ((sub !== 'snapshot' && sub !== 'check') || !task) throw new UsageError(usage);
  if (!isSafeId(task)) throw new UsageError(`tree ${sub}: --task must use letters, digits, _ - . (at most 120)`);
  const git = io.git ?? defaultGit(repoDir);
  const top = git(['rev-parse', '--show-toplevel'])?.trim();
  if (!top) throw new UsageError(`tree ${sub}: ${repoDir} is not a git work tree`);
  const treeRoot = path.resolve(top);
  // D-08: the task's work folder: its project's, or the older one the ledger still gives it.
  const ledger = readEvents(io.cwd);
  const file = path.join(readWorkDir(io.cwd, { project: resolveProject({ flag: flag('project'), task, events: ledger }), task }, ledger), 'tree-start.json');
  let text: string | null = null;
  try { text = readFileSync(file, 'utf8'); } catch { text = null; }
  const stored = parseSnapshot(text);
  if (sub === 'snapshot') {
    // The first snapshot stands: a later one would absorb the files the person created in between.
    if (stored && !has('force')) return ok(`${file} (already taken at ${stored.at}; --force replaces it)`);
    // .forge/ first, so the .gitignore forgeDir may create is in the snapshot, never a file that "appeared".
    forgeDir(io.cwd);
    const status = git(['status', '--porcelain', '-z', '-uall']);
    if (status === null) throw new UsageError(`tree snapshot: git status failed in ${repoDir}`);
    const head = git(['rev-parse', '--verify', '-q', 'HEAD'])?.trim() || null;
    const snap: TreeSnapshot = { task, root: treeRoot, at: ts(), head, ...parseStatus(status) };
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(snap, null, 2) + '\n');
    return ok(file);
  }
  const base = flag('base');
  if (!base) throw new UsageError(usage);
  if (base.startsWith('-') || git(['rev-parse', '--verify', '-q', `${base}^{commit}`]) === null) throw new UsageError(`tree check: --base ${base} is not a commit`);
  const status = git(['status', '--porcelain', '-z', '-uall']);
  if (status === null) throw new UsageError(`tree check: git status failed in ${repoDir}`);
  // The task's files: what its commits added or changed (a path it deleted is not its file).
  const diff = git(['diff', '--name-only', '-z', '--diff-filter=d', `${base}..HEAD`]);
  if (diff === null) throw new UsageError(`tree check: cannot diff ${base}..HEAD`);
  // A snapshot of another tree or another task is no baseline: everything is listed (fail safe).
  const snapshot = stored && stored.task === task && samePath(stored.root, treeRoot) ? stored : null;
  const out = treeCheck(snapshot, parseStatus(status), diff.split('\0').filter(Boolean));
  if (snapshot?.head && git(['merge-base', '--is-ancestor', base, snapshot.head]) === null) {
    out.warning = `--base ${base} is not an ancestor of the snapshot's head ${snapshot.head}: task may list commits that are not the task's`;
  }
  return json(out);
};
