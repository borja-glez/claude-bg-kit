// No Node imports here: lens's mod bundle (platform neutral) imports this through usage-file.ts.

/** The main checkout of a session root: `<repo>` for a worktree whose .git file says `gitdir: <repo>/.git/worktrees/<x>`. */
export function mainCheckoutFrom(root: string, gitFileText: string | null): string {
  const m = gitFileText ? /^gitdir:\s*(.+?)[\\/]\.git[\\/]worktrees[\\/][^\\/\r\n]+\s*$/m.exec(gitFileText) : null;
  const dir = m ? m[1] : null;
  return dir && (/^[A-Za-z]:/.test(dir) || dir.startsWith('/')) ? dir : root;
}
