import path from 'node:path';

// Kept in a module of its own with no Node imports, so lens's neutral mod bundle can import it.
export { mainCheckoutFrom } from './main-checkout.js';

/** Every checkout of `git worktree list --porcelain`: the path of each `worktree` entry, in order (the main checkout
 *  first); none for no output. */
export function worktreeDirs(porcelain: string | null | undefined): string[] {
  if (typeof porcelain !== 'string') return [];
  return porcelain.split(/\r?\n/).filter(l => l.startsWith('worktree ')).map(l => l.slice('worktree '.length).trim()).filter(Boolean);
}

/** The main checkout: the path of the first `worktree` entry of `git worktree list --porcelain`. */
export const mainWorktreeFrom = (porcelain: string | null | undefined): string | null => worktreeDirs(porcelain)[0] ?? null;

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
