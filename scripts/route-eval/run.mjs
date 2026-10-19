// Runs the empirical routing test: every prompt of prompts.json in each configuration (with superpowers, without it,
// without the prompt hint), through `claude -p` with this worktree's forge and waypoint, in a small throwaway Node
// repository. It costs money (README.md has the estimate): run it only after the person who pays agreed.
// Usage: node scripts/route-eval/run.mjs [--dry-run] [--only <id>] [--config with-superpowers|without-superpowers|no-hint]
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIGS, claudeArgs, passes, projectSettingsFor, readStream, settingsFor, summarize, table } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const argv = process.argv.slice(2);
const dry = argv.includes('--dry-run');
const valueOf = name => (argv.includes(name) ? argv[argv.indexOf(name) + 1] ?? null : null);
const only = valueOf('--only');
const configName = valueOf('--config');
const configs = CONFIGS.filter(c => !configName || c.name === configName);
if (!configs.length) {
  console.error(`route-eval: --config must be one of ${CONFIGS.map(c => c.name).join(', ')}`);
  process.exit(2);
}
const prompts = JSON.parse(readFileSync(path.join(here, 'prompts.json'), 'utf8')).filter(p => !only || p.id === only);

// The installed plugins' keys: this kit's installed copies are turned off, and superpowers in one configuration.
const configDir = process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(homedir(), '.claude');
let installed = [];
try { installed = Object.keys(JSON.parse(readFileSync(path.join(configDir, 'plugins', 'installed_plugins.json'), 'utf8')).plugins ?? {}); } catch { /* none */ }

// The small repository the prompts talk about.
const work = mkdtempSync(path.join(tmpdir(), 'route-eval-'));
const repo = path.join(work, 'shop');
mkdirSync(path.join(repo, 'src'), { recursive: true });
mkdirSync(path.join(repo, 'test'), { recursive: true });
writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'demo-shop', version: '1.0.0', type: 'module', scripts: { test: 'node --test' } }, null, 2) + '\n');
writeFileSync(path.join(repo, 'src', 'cart.js'), 'export const total = items => items.reduce((s, i) => s + i.price * i.qty, 0);\nexport const withTax = (items, rate) => Math.round(total(items) * (1 + rate));\n');
writeFileSync(path.join(repo, 'test', 'cart.test.js'), "import test from 'node:test';\nimport assert from 'node:assert';\nimport { total } from '../src/cart.js';\ntest('total', () => assert.equal(total([{ price: 100, qty: 2 }]), 200));\n");
writeFileSync(path.join(repo, 'README.md'), '# demo-shop\n\nA small shop.\n');
const git = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'ignore' });
git('init', '-q');
git('add', '.');
git('-c', 'user.name=route-eval', '-c', 'user.email=route-eval@example.com', 'commit', '-qm', 'init');

const pluginDirs = [path.join(root, 'plugins', 'forge'), path.join(root, 'plugins', 'waypoint')];
const results = [];
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
    if (dry) { console.log(`${c.hint ? '' : 'FORGE_ROUTE_HINT=off '}claude ${args.map(a => JSON.stringify(a)).join(' ')}`); continue; }
    const r = spawnSync('claude', args, { cwd: repo, env, encoding: 'utf8', timeout: 240_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
    const { firstSkill, plugins, stop, cost } = readStream(r.stdout ?? '');
    const error = r.error ? r.error.message : r.status !== 0 && !firstSkill ? `exit ${r.status}: ${stop ?? (r.stderr ?? '').trim().split(/\r?\n/).pop() ?? ''}` : null;
    results.push({ id: p.id, size: p.size, lang: p.lang, expected: p.expected, config: c.name, firstSkill, plugins, cost, error });
    console.log(`${c.name} ${p.id}: ${firstSkill ?? '—'}${cost === null ? '' : ` ($${cost.toFixed(4)})`}${error ? ` (${error})` : ''}`);
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
