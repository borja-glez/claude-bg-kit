import { spawnSync } from 'node:child_process';
import { OBJECT_ID } from './local.js';

export type MergePrediction = { state: 'clean' } | { state: 'conflict'; paths: string[] } | { state: 'unverified' };
export type GitRun = (args: string[]) => { code: number | null; stdout: string };

/** git in `cwd`, with its exit code: spawnSync, utf8, windowsHide, stdin and stderr ignored; a git that cannot start is code null. */
export function gitRun(cwd: string): GitRun {
  return args => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
    return { code: r.error ? null : r.status, stdout: r.stdout ?? '' };
  };
}

/** What merging branch `from` into branch `into` would give, from git merge-tree; nothing is touched. */
export function predictMerge(run: GitRun, into: string, from: string): MergePrediction {
  const r = run(['-c', 'core.quotePath=false', 'merge-tree', '--write-tree', '--name-only', '--no-messages', `refs/heads/${into}`, `refs/heads/${from}`]);
  if (r.code !== 0 && r.code !== 1) return { state: 'unverified' };
  const lines = r.stdout.split(/\r?\n/);
  if (!OBJECT_ID.test(lines[0] ?? '')) return { state: 'unverified' };
  if (r.code === 0) return { state: 'clean' };
  const paths: string[] = [];
  for (const line of lines.slice(1)) {
    if (line === '') break;
    paths.push(line);
  }
  return { state: 'conflict', paths };
}
