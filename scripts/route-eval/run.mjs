// Runs the empirical routing test (spec §5.1): every prompt of prompts.json with and without superpowers, through
// `claude -p` with this worktree's forge and waypoint, in a small throwaway Node repository. It costs a few dollars per
// pass: run it only after the user agreed. Usage: node scripts/route-eval/run.mjs [--dry-run] [--only <id>]
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { claudeArgs, passes, readStream, settingsFor, summarize, table } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const argv = process.argv.slice(2);
const dry = argv.includes('--dry-run');
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;
const prompts = JSON.parse(readFileSync(path.join(here, 'prompts.json'), 'utf8')).filter(p => !only || p.id === only);

// The installed plugins' keys: this kit's installed copies, and superpowers in one configuration, are turned off.
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
for (const [config, withSuperpowers] of [['with-superpowers', true], ['without-superpowers', false]]) {
  const settings = path.join(work, `${config}.json`);
  writeFileSync(settings, JSON.stringify(settingsFor(withSuperpowers, installed), null, 2));
  for (const p of prompts) {
    const args = claudeArgs(p.text, { settings, pluginDirs });
    if (dry) { console.log(['claude', ...args.map(a => JSON.stringify(a))].join(' ')); continue; }
    const r = spawnSync('claude', args, { cwd: repo, encoding: 'utf8', timeout: 240_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
    const { firstSkill, plugins } = readStream(r.stdout ?? '');
    const error = r.error ? r.error.message : r.status !== 0 && !firstSkill ? `exit ${r.status}: ${(r.stderr ?? '').trim().split(/\r?\n/).pop() ?? ''}` : null;
    results.push({ id: p.id, size: p.size, lang: p.lang, config, firstSkill, plugins, error });
    console.log(`${config} ${p.id}: ${firstSkill ?? '—'}${error ? ` (${error})` : ''}`);
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
