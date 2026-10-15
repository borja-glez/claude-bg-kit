// The engine's TypeScript declarations for mods, copied to types/claude-code/index.d.ts (ignored by git): `npm run
// typecheck:mod` compiles waypoint's band and lens against that copy. The engine writes its own copy into
// plugins/<name>/.claude-plugin/types/claude-code/index.d.ts when it loads a mod folder in a session, and a new worktree
// has neither, so `update` also takes the copy of the main checkout. Plain JavaScript, so `node` runs it as it is.
// Usage, from the repo root: node scripts/mod-types.mjs check|update
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const COPY = path.join('types', 'claude-code', 'index.d.ts');
export const MISSING = 'engine types missing: run `npm run mod-types:update` after opening a session with `claude --plugin-dir plugins/waypoint`';

/** The version of a copy from its first line (`// Written by Claude Code X.Y.Z.`) as [x, y, z]; null when unreadable. */
export function versionOf(file) {
  let line;
  try { line = readFileSync(file, 'utf8').split(/\r?\n/, 1)[0]; } catch { return null; }
  const m = /^\/\/ Written by Claude Code (\d+)\.(\d+)\.(\d+)/.exec(line ?? '');
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
export const compareVersions = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** The copies the engine wrote in `root`: plugins/<name>/.claude-plugin/types/claude-code/index.d.ts. */
export function engineCopies(root) {
  const plugins = path.join(root, 'plugins');
  if (!existsSync(plugins)) return [];
  return readdirSync(plugins).map(p => path.join(plugins, p, '.claude-plugin', 'types', 'claude-code', 'index.d.ts')).filter(f => existsSync(f));
}

/** The main checkout of `root` when `root` is a linked worktree, else null (src/forge/local.ts mainCheckout, without a build). */
export function mainCheckoutOf(root) {
  try {
    const [gitDir, common] = execFileSync('git', ['rev-parse', '--git-dir', '--git-common-dir'], { cwd: root, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
      .split(/\r?\n/).map(l => l.trim());
    if (!gitDir || !common) return null;
    const commonDir = path.resolve(root, common);
    if (path.resolve(root, gitDir) === commonDir || path.basename(commonDir) !== '.git') return null;
    return path.dirname(commonDir);
  } catch { return null; }
}

const withVersion = files => files.map(f => ({ f, v: versionOf(f) })).filter(c => c.v !== null);

/** `check`: exit 1 without the copy; 0 with it, warning when the engine wrote a newer one. */
export function check(root) {
  const mine = versionOf(path.join(root, COPY));
  if (!mine) return { code: 1, out: '', err: `${MISSING}\n` };
  const newer = withVersion(engineCopies(root)).filter(c => compareVersions(c.v, mine) > 0);
  const warn = newer.length
    ? `engine types: ${path.relative(root, newer[0].f)} is newer (${newer[0].v.join('.')}) than ${COPY} (${mine.join('.')}): run \`npm run mod-types:update\`\n`
    : '';
  return { code: 0, out: `engine types ${mine.join('.')}\n`, err: warn };
}

/** `update`: the newest of this copy, the engine's copies and the main checkout's copy goes to types/claude-code. */
export function update(root) {
  const target = path.join(root, COPY);
  const main = mainCheckoutOf(root);
  const sources = withVersion([target, ...engineCopies(root), ...(main ? [path.join(main, COPY)] : [])]);
  if (!sources.length) {
    return { code: 1, out: '', err: 'engine types: no copy to take: open a session with `claude --plugin-dir plugins/waypoint` (the engine writes plugins/waypoint/.claude-plugin/types/claude-code/index.d.ts), or run this in a worktree whose main checkout has types/claude-code/\n' };
  }
  const best = sources.reduce((a, b) => (compareVersions(b.v, a.v) > 0 ? b : a));
  if (path.resolve(best.f) !== path.resolve(target)) {
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(best.f, target);
  }
  return { code: 0, out: `engine types ${best.v.join('.')} (${best.f})\n`, err: '' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2];
  const r = cmd === 'check' ? check(process.cwd()) : cmd === 'update' ? update(process.cwd()) : { code: 2, out: '', err: 'usage: node scripts/mod-types.mjs check|update\n' };
  process.stdout.write(r.out);
  process.stderr.write(r.err);
  process.exit(r.code);
}
