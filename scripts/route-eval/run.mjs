// Runs the empirical routing test: every prompt of prompts.json in each configuration (with superpowers, without it,
// without the prompt hint), through `claude -p` with this worktree's forge and waypoint, in a small throwaway Node
// repository. It costs money (README.md has the estimate): run it only after the person who pays agreed.
// Usage: node scripts/route-eval/run.mjs [--dry-run] [--only <id>] [--config with-superpowers|without-superpowers|no-hint] [--keep]
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIGS, DEMO_SHOP, claudeArgs, passes, projectSettingsFor, readStream, settingsFor, summarize, table } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const argv = process.argv.slice(2);
const dry = argv.includes('--dry-run');
const valueOf = name => (argv.includes(name) ? argv[argv.indexOf(name) + 1] ?? null : null);
const keep = argv.includes('--keep');
const only = valueOf('--only');
const configName = valueOf('--config');
const configs = CONFIGS.filter(c => !configName || c.name === configName);
if (!configs.length) {
  console.error(`route-eval: --config must be one of ${CONFIGS.map(c => c.name).join(', ')}`);
  process.exit(2);
}
const prompts = JSON.parse(readFileSync(path.join(here, 'prompts.json'), 'utf8')).filter(p => !only || p.id === only);
if (!prompts.length) {
  console.error(`route-eval: --only ${only} matches no prompt of prompts.json`);
  process.exit(2);
}

// The installed plugins' keys: this kit's installed copies are turned off, and superpowers in one configuration.
const configDir = process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(homedir(), '.claude');
let installed = [];
try { installed = Object.keys(JSON.parse(readFileSync(path.join(configDir, 'plugins', 'installed_plugins.json'), 'utf8')).plugins ?? {}); } catch { /* none */ }

const pluginDirs = [path.join(root, 'plugins', 'forge'), path.join(root, 'plugins', 'waypoint')];
const results = [];

if (dry) {
  // A dry run creates nothing on disk: the commands carry a placeholder for the work folder.
  for (const c of configs) {
    for (const p of prompts) {
      const args = claudeArgs(p.text, { settings: `<work>/${c.name}.json`, pluginDirs });
      console.log(`${c.hint ? '' : 'FORGE_ROUTE_HINT=off '}claude ${args.map(a => JSON.stringify(a)).join(' ')}`);
    }
  }
} else {
  // The small repository the prompts talk about, in a work folder that goes away at the end unless --keep.
  const work = mkdtempSync(path.join(tmpdir(), 'route-eval-'));
  try {
    const repo = path.join(work, 'shop');
    for (const [rel, text] of Object.entries(DEMO_SHOP)) {
      mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
      writeFileSync(path.join(repo, rel), text);
    }
    const git = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'ignore' });
    git('init', '-q');
    git('add', '.');
    git('-c', 'user.name=route-eval', '-c', 'user.email=route-eval@example.com', 'commit', '-qm', 'init');

    for (const c of configs) {
      const settings = path.join(work, `${c.name}.json`);
      writeFileSync(settings, JSON.stringify(settingsFor(installed), null, 2));
      // K1-02: superpowers on or off in the repository's own settings, which the session and forge's CLI both read.
      mkdirSync(path.join(repo, '.claude'), { recursive: true });
      writeFileSync(path.join(repo, '.claude', 'settings.local.json'), JSON.stringify(projectSettingsFor(c.superpowers, installed), null, 2) + '\n');
      // K1-03: the hint off through the environment, which the hooks of the session inherit.
      const env = c.hint ? process.env : { ...process.env, FORGE_ROUTE_HINT: 'off' };
      for (const p of prompts) {
        const args = claudeArgs(p.text, { settings, pluginDirs });
        const r = spawnSync('claude', args, { cwd: repo, env, encoding: 'utf8', timeout: 240_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
        const { firstSkill, plugins, stop, cost } = readStream(r.stdout ?? '');
        // A non-zero exit or an error subtype (error_max_turns) is noted even when a skill loaded first.
        const failed = r.status !== 0 || (stop !== null && stop.startsWith('error'));
        const error = r.error ? r.error.message : failed ? `exit ${r.status}: ${stop ?? (r.stderr ?? '').trim().split(/\r?\n/).pop() ?? ''}` : null;
        results.push({ id: p.id, size: p.size, lang: p.lang, expected: p.expected, config: c.name, firstSkill, plugins, cost, error });
        console.log(`${c.name} ${p.id}: ${firstSkill ?? '—'}${cost === null ? '' : ` ($${cost.toFixed(4)})`}${error ? ` (${error})` : ''}`);
      }
    }
  } finally {
    if (keep) console.log(`route-eval: work folder kept at ${work}`);
    else rmSync(work, { recursive: true, force: true });
  }
}
if (!dry) {
  const summary = summarize(results);
  const out = path.join(here, 'results');
  mkdirSync(out, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '');
  writeFileSync(path.join(out, `${stamp}.json`), JSON.stringify({ results, summary }, null, 2) + '\n');
  writeFileSync(path.join(out, `${stamp}.md`), table(results, summary) + '\n');
  console.log(table(results, summary));
  console.log(passes(summary) ? 'PASS' : 'FAIL');
  process.exitCode = passes(summary) ? 0 : 1;
}
