// Runs the empirical routing test: every prompt of prompts.json in each configuration (with superpowers, without it,
// without the prompt hint), through `claude -p` with this worktree's forge and waypoint, in a small throwaway Node
// repository. It costs money (README.md has the estimate): run it only after the person who pays agreed.
// Each session is appended to results/<stamp>.jsonl as it ends; --resume continues a cut pass, --reps repeats every prompt.
// Usage: node scripts/route-eval/run.mjs [--dry-run] [--only <id>] [--config with-superpowers|without-superpowers|no-hint] [--reps <k>] [--resume <file>] [--keep]
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONFIGS, appendTrial, claudeArgs, demoRepo, foreignPromptHooks, forgeHookRan, isValidTrial, parseArgs, passes, pending, projectSettingsFor, providerError, readStream,
  readTrials, sessionEnv, settingsFor, stopReason, summarize, table,
} from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
// M1: any other argument, or a flag without its value, stops here: a mistyped --dry-run never starts the paid pass.
const args = parseArgs(process.argv.slice(2));
if ('error' in args) {
  console.error(`route-eval: ${args.error}. Usage: node scripts/route-eval/run.mjs [--dry-run] [--only <id>] [--config <name>] [--reps <k>] [--resume <file>] [--keep]`);
  process.exit(2);
}
const { dry, keep, only, config: configName } = args;
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
if (args.resume !== null && !existsSync(args.resume)) {
  console.error(`route-eval: --resume ${args.resume} does not exist`);
  process.exit(2);
}

// The installed plugins' keys: this kit's installed copies are turned off, and superpowers in one configuration.
const configDir = process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(homedir(), '.claude');
let installed = [];
try { installed = Object.keys(JSON.parse(readFileSync(path.join(configDir, 'plugins', 'installed_plugins.json'), 'utf8')).plugins ?? {}); } catch { /* none */ }

const forgeDir = path.join(root, 'plugins', 'forge');
const pluginDirs = [forgeDir, path.join(root, 'plugins', 'waypoint')];
// A7: the UserPromptSubmit hooks outside forge of a configuration, which the stream cannot tell from forge's: forge's
// hook ran only when more of them started. Said on stderr before the configuration's sessions, and by --dry-run.
const foreignOf = c => {
  const foreign = foreignPromptHooks({ configDir, superpowers: c.superpowers, pluginDirs: pluginDirs.filter(d => d !== forgeDir) });
  console.error(`route-eval: ${c.name}: ${foreign.length} UserPromptSubmit hook(s) outside forge${foreign.length ? ` (${foreign.join(', ')})` : ''}; `
    + `forge's counts as run only when more than ${foreign.length} start`);
  return foreign.length;
};
const out = path.join(here, 'results');
const jsonl = args.resume !== null ? path.resolve(args.resume) : path.join(out, `${new Date().toISOString().replace(/[:.]/g, '')}.jsonl`);
const earlier = args.resume !== null ? readTrials(readFileSync(jsonl, 'utf8')) : [];
const todo = pending(prompts, configs, args.reps, earlier);
const mine = [];
let stopped = null;

if (dry) {
  // A dry run creates nothing on disk: the commands carry a placeholder for the work folder.
  for (const c of configs) if (todo.some(t => t.config.name === c.name)) foreignOf(c);
  for (const { config: c, prompt: p } of todo) {
    const a = claudeArgs(p.text, { settings: `<work>/${c.name}.json`, pluginDirs });
    console.log(`${c.hint ? '' : 'FORGE_ROUTE_HINT=off '}claude ${a.map(x => JSON.stringify(x)).join(' ')}`);
  }
} else {
  mkdirSync(out, { recursive: true });
  // The small repository the prompts talk about, in a work folder that goes away at the end unless --keep.
  const work = mkdtempSync(path.join(tmpdir(), 'route-eval-'));
  try {
    const repo = path.join(work, 'shop');
    const { reset } = demoRepo(repo);

    outer: for (const c of configs) {
      const entries = todo.filter(t => t.config.name === c.name);
      if (!entries.length) continue;
      const settings = path.join(work, `${c.name}.json`);
      writeFileSync(settings, JSON.stringify(settingsFor(installed), null, 2));
      // K1-02: superpowers on or off in the repository's own settings, which the session and forge's CLI both read.
      mkdirSync(path.join(repo, '.claude'), { recursive: true });
      writeFileSync(path.join(repo, '.claude', 'settings.local.json'), JSON.stringify(projectSettingsFor(c.superpowers, installed), null, 2) + '\n');
      // K1-03, M3: the hint off through the environment, which the hooks of the session inherit; on, whatever was exported.
      const env = sessionEnv(c, process.env);
      const foreign = foreignOf(c);
      for (const { prompt: p, rep } of entries) {
        // M2: every session starts from the same tree, whatever the one before it edited or committed.
        reset();
        const a = claudeArgs(p.text, { settings, pluginDirs });
        const r = spawnSync('claude', a, { cwd: repo, env, encoding: 'utf8', timeout: 240_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
        const { firstSkill, plugins, stop, cost, isError, apiStatus, promptHooks } = readStream(r.stdout ?? '');
        const provider = providerError({ spawnError: r.error?.message ?? null, stop, isError, apiStatus });
        // A non-zero exit or an error subtype (error_max_turns) is noted even when a skill loaded first.
        const failed = r.status !== 0 || (stop !== null && stop.startsWith('error'));
        const error = r.error ? r.error.message : failed ? `exit ${r.status}: ${stop ?? (r.stderr ?? '').trim().split(/\r?\n/).pop() ?? ''}` : null;
        const row = { id: p.id, size: p.size, lang: p.lang, expected: p.expected, competing: p.competing ?? null, config: c.name, rep, firstSkill, plugins, cost, error,
          provider, hookRan: forgeHookRan(promptHooks, foreign) };
        appendTrial(jsonl, row);
        mine.push(row);
        const invalid = provider ?? (isValidTrial(row) ? null : 'no hook');
        console.log(`${c.name} ${p.id} #${rep}: ${firstSkill ?? '—'}${cost === null ? '' : ` ($${cost.toFixed(4)})`}${error ? ` (${error})` : ''}${invalid ? ` [${invalid}]` : ''}`);
        stopped = stopReason(mine);
        if (stopped) break outer;
      }
    }
  } finally {
    if (keep) console.log(`route-eval: work folder kept at ${work}`);
    else rmSync(work, { recursive: true, force: true });
  }
}
if (!dry) {
  const all = readTrials(readFileSync(jsonl, 'utf8'));
  const summary = summarize(all);
  const base = jsonl.replace(/\.jsonl$/, '');
  writeFileSync(`${base}.json`, JSON.stringify({ results: all, summary }, null, 2) + '\n');
  writeFileSync(`${base}.md`, table(all, summary) + '\n');
  console.log(table(all, summary));
  // M3: a configuration whose sessions did not load what it says measured something else.
  const wrong = summary.filter(s => s.plugins === 'contradicts').map(s => s.config);
  if (wrong.length) console.error(`route-eval: the init plugins contradict ${wrong.join(', ')}: that part of the pass is not valid`);
  const left = pending(prompts, configs, args.reps, all).length;
  if (stopped || left) {
    const flags = [only ? ` --only ${only}` : '', configName ? ` --config ${configName}` : '', args.reps > 1 ? ` --reps ${args.reps}` : ''].join('');
    console.error(`route-eval: ${stopped ?? `${left} session(s) left`}. Resume: node scripts/route-eval/run.mjs --resume ${path.relative(process.cwd(), jsonl)}${flags}`);
    console.log('INCOMPLETE');
    process.exitCode = 1;
  } else {
    console.log(passes(summary) ? 'PASS' : 'FAIL');
    process.exitCode = passes(summary) ? 0 : 1;
  }
}
