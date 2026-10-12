import path from 'node:path';

/** The main checkout: the path of the first `worktree` entry of `git worktree list --porcelain`. */
export function mainWorktreeFrom(porcelain: string | null | undefined): string | null {
  if (typeof porcelain !== 'string') return null;
  const line = porcelain.split(/\r?\n/).find(l => l.startsWith('worktree '));
  return line ? line.slice('worktree '.length).trim() || null : null;
}

/** Two paths name the same directory (git prints forward slashes; Windows paths are case-insensitive). */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => {
    const r = path.resolve(p.replace(/\\/g, '/'));
    return process.platform === 'win32' ? r.toLowerCase() : r;
  };
  return norm(a) === norm(b);
}

/** A branch or start point that is safe on a command line: no leading "-", only these characters. */
export const BRANCH_RE = /^[A-Za-z0-9_.\/~:@+][A-Za-z0-9_\-.\/~:@+]{0,199}$/;
