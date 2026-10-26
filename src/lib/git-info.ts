// The files git keeps per repository that forge and waypoint write without a commit: info/exclude and info/attributes
// of the common git directory, shared by every worktree. They came from forge's swarm.ts so that waypoint's launch
// can use them too (A-08). Also the one rule for the repository's default branch.
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/** Runs git with these arguments where the caller decided; null when git fails. */
export type GitRun = (args: string[]) => string | null;

export const hasLine = (text: string, line: string): boolean => text.split(/\r?\n/).some(l => l.trim() === line);

/** Appends `line` to `file` unless a line of it already says it; whatever else the file holds stays. */
export function appendOnce(file: string, line: string): void {
  let text = '';
  try { text = readFileSync(file, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  if (hasLine(text, line)) return;
  appendFileSync(file, `${text && !text.endsWith('\n') ? '\n' : ''}${line}\n`);
}

/** The top level of the worktree git runs in; null when git cannot say. */
export const gitToplevel = (git: GitRun): string | null => git(['rev-parse', '--show-toplevel'])?.trim() || null;

/**
 * The repository's default branch, by the one rule forge uses for it: origin's HEAD; without one, main when it exists,
 * else master when it exists; null when none.
 */
export function defaultBranchOf(git: GitRun): string | null {
  const origin = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])?.trim().replace(/^origin\//, '');
  if (origin) return origin;
  for (const b of ['main', 'master']) if (git(['rev-parse', '--verify', '-q', `refs/heads/${b}`]) !== null) return b;
  return null;
}

/**
 * The repository's common git directory (shared by every worktree), absolute. git prints it relative to the directory
 * it runs in, so it is asked for an absolute path; a git older than 2.31 echoes that flag back instead, and then it runs
 * at the top level and the answer is resolved from there. Null unless the directory exists and holds HEAD: nothing
 * here creates a git directory, nor writes into a guessed one.
 */
export function commonDir(git: GitRun): string | null {
  const holdsHead = (d: string) => existsSync(path.join(d, 'HEAD'));
  const lines = (s: string | null | undefined) => (s ?? '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const first = lines(git(['rev-parse', '--path-format=absolute', '--git-common-dir']));
  if (first.length === 1 && path.isAbsolute(first[0]) && holdsHead(first[0])) return path.resolve(first[0]);
  const top = gitToplevel(git);
  const rel = top ? lines(git(['-C', top, 'rev-parse', '--git-common-dir'])) : [];
  const dir = top && rel.length === 1 ? path.resolve(top, rel[0]) : null;
  return dir && holdsHead(dir) ? dir : null;
}

/**
 * w8 FR5: the common git directory of the repository `dir` is in, found without running git (forge's every write asks
 * it): the nearest `.git` up the tree, a directory, or a file whose `gitdir:` names a worktree's git directory, whose
 * `commondir` names the common one (a submodule's has none: it is its own). Null outside a repository, and when what it
 * finds does not hold HEAD.
 */
export function commonDirOf(dir: string): string | null {
  const holdsHead = (d: string) => (existsSync(path.join(d, 'HEAD')) ? d : null);
  for (let at = path.resolve(dir); ; at = path.dirname(at)) {
    const dotGit = path.join(at, '.git');
    let isDir: boolean | null = null;
    try { isDir = statSync(dotGit).isDirectory(); } catch { /* none here: look further up */ }
    if (isDir === true) return holdsHead(dotGit);
    if (isDir === false) {
      let text = '';
      try { text = readFileSync(dotGit, 'utf8'); } catch { return null; }
      const m = /^gitdir:\s*(.+?)\s*$/m.exec(text);
      if (!m) return null;
      const gitDir = path.resolve(at, m[1]);
      let common = gitDir;
      try { common = path.resolve(gitDir, readFileSync(path.join(gitDir, 'commondir'), 'utf8').trim()); } catch { /* its own */ }
      return holdsHead(common);
    }
    if (path.dirname(at) === at) return null;
  }
}

/** `<common dir>/info/<name>`; creates only info/ inside an existing git directory. Null without one; throws on fs errors. */
export function infoFile(git: GitRun, name: string): string | null {
  const dir = commonDir(git);
  if (!dir) return null;
  const info = path.join(dir, 'info');
  if (!existsSync(info)) mkdirSync(info);
  return path.join(info, name);
}

/** Where forge and waypoint create worktrees, under the main checkout. */
export const WORKTREES_DIR = '.claude/worktrees/';

/**
 * A-08: .claude/worktrees/ goes to info/exclude when nothing ignores it yet (no .gitignore entry and no global one),
 * once, so the worktrees never show as untracked in `git status`. A failure changes nothing.
 */
export function excludeWorktrees(git: GitRun): void {
  try {
    if (git(['check-ignore', '-q', WORKTREES_DIR]) !== null) return;
    const file = infoFile(git, 'exclude');
    if (file) appendOnce(file, WORKTREES_DIR);
  } catch { /* the next git status lists them, as before */ }
}
