// I-05: the one definition of «the suite is green». The CI workflow and the close of every plan run `npm run ci`.
// Steps, in order: typecheck; typecheck:mod (in CI, without the engine types, which git never holds, it is skipped with
// a warning; locally it fails and says how to get them); the tests; in CI only, npm audit at level high (it needs the
// network); the build, after which git must list no change under the `generated` paths of .forge/config.yaml (the
// committed bundles are the built ones); the claude CLI (missing: in CI a failure, locally the last two steps are
// skipped with a warning); claude plugin validate of the marketplace and of each plugin; claude plugin test of lens and
// waypoint. Usage: node scripts/ci.mjs [--dry-run] [--root <dir>]   (--root: another checkout, for the tests)
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

export const ENGINE_TYPES = 'types/claude-code/index.d.ts';
export const SKIP_MOD_TYPES = 'typecheck:mod skipped: engine types missing (not versioned)';
export const PLUGINS = ['waypoint', 'lens', 'forge', 'web'];

export const isCi = env => env.CI === 'true' || env.CI === '1';

/** The `generated` globs of .forge/config.yaml: what `npm run build` rewrites. */
export function generatedPaths(root) {
  let doc;
  try { doc = parse(readFileSync(path.join(root, '.forge', 'config.yaml'), 'utf8')); } catch { return []; }
  return doc && Array.isArray(doc.generated) ? doc.generated.filter(g => typeof g === 'string' && g) : [];
}

export function ciSteps(root, env) {
  const ci = isCi(env);
  const types = existsSync(path.join(root, ENGINE_TYPES));
  return [
    { id: 'typecheck', cmds: [['npm', 'run', 'typecheck']] },
    { id: 'typecheck:mod', cmds: [['npm', 'run', 'typecheck:mod']], ...(ci && !types ? { skip: SKIP_MOD_TYPES } : {}) },
    { id: 'test', cmds: [['npm', 'test']] },
    ...(ci ? [{ id: 'audit', cmds: [['npm', 'audit', '--audit-level=high']] }] : []),
    { id: 'build', cmds: [['npm', 'run', 'build']], fresh: generatedPaths(root) },
    { id: 'claude', cmds: [['claude', '--version']], probe: true },
    { id: 'validate', cmds: [['claude', 'plugin', 'validate', '.'], ...PLUGINS.map(p => ['claude', 'plugin', 'validate', `plugins/${p}`])], claude: true },
    { id: 'plugin-test', cmds: [['claude', 'plugin', 'test', 'plugins/lens'], ['claude', 'plugin', 'test', 'plugins/waypoint']], claude: true },
  ];
}

export function describeStep(s, i, n) {
  const what = s.skip
    ? `skipped (${s.skip})`
    : s.cmds.map(c => c.join(' ')).join(' && ') + (s.fresh ? ` && git status --porcelain -- ${s.fresh.join(' ')}` : '');
  return `ci: ${i + 1}/${n} ${s.id}: ${what}`;
}

// npm and claude are .cmd shims on Windows: they go through the shell, and no argument here needs quoting.
const sh = (argv, cwd, inherit = true) => spawnSync(argv.join(' '), { cwd, shell: true, stdio: inherit ? 'inherit' : 'ignore' }).status ?? 1;

/** What git lists as changed or new under the generated paths (empty: the committed bundles are the built ones). */
export function stalePaths(root, fresh) {
  if (!fresh.length) return [];
  const r = spawnSync('git', ['status', '--porcelain', '--untracked-files=all', '--', ...fresh.map(g => `:(glob)${g}`)], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) return [`git status failed: ${(r.stderr ?? '').trim()}`];
  return (r.stdout ?? '').split(/\r?\n/).filter(Boolean);
}

function main(argv, env) {
  const at = argv.indexOf('--root');
  if (at >= 0 && (!argv[at + 1] || argv[at + 1].startsWith('--'))) { process.stderr.write('usage: node scripts/ci.mjs [--dry-run] [--root <dir>]\n'); return 2; }
  const root = at >= 0 ? path.resolve(argv[at + 1]) : fileURLToPath(new URL('..', import.meta.url));
  const steps = ciSteps(root, env);
  if (argv.includes('--dry-run')) {
    steps.forEach((s, k) => process.stdout.write(`${describeStep(s, k, steps.length)}\n`));
    return 0;
  }
  const t0 = Date.now();
  let noClaude = false;
  for (const [k, s] of steps.entries()) {
    const head = `ci: ${k + 1}/${steps.length} ${s.id}`;
    if (s.skip) { process.stdout.write(`${head}: ${s.skip}\n`); continue; }
    if (s.claude && noClaude) { process.stdout.write(`${head}: skipped (no claude CLI)\n`); continue; }
    if (s.probe) {
      if (sh(s.cmds[0], root, false) === 0) { process.stdout.write(`${head}: ok\n`); continue; }
      if (isCi(env)) { process.stdout.write(`${head}: the claude CLI is missing\nci: failed at ${s.id}\n`); return 1; }
      noClaude = true;
      process.stdout.write(`${head}: no claude CLI here: validate and plugin-test are skipped (in CI this fails)\n`);
      continue;
    }
    const t = Date.now();
    process.stdout.write(`${head}: ${s.cmds.map(c => c.join(' ')).join(' && ')}\n`);
    for (const c of s.cmds) if (sh(c, root) !== 0) { process.stdout.write(`ci: failed at ${s.id}\n`); return 1; }
    if (s.fresh) {
      const stale = stalePaths(root, s.fresh);
      if (stale.length) {
        process.stdout.write(`${head}: the committed bundles are not the built ones:\n${stale.map(l => `  ${l}`).join('\n')}\nci: failed at ${s.id}\n`);
        return 1;
      }
    }
    process.stdout.write(`${head}: ok (${((Date.now() - t) / 1000).toFixed(1)} s)\n`);
  }
  process.stdout.write(`ci: ok (${((Date.now() - t0) / 1000).toFixed(1)} s)\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2), process.env);
