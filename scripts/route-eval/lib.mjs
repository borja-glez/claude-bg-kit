// The empirical routing test: the helpers of run.mjs. Plain JavaScript, so `node` runs it as it is.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** M1: the only arguments run.mjs takes (--dry-run, --keep, --only, --config, --reps <1..10> and --resume <file>).
 *  Anything else, a flag without its value or a value that starts with `--` is an `error`, and run.mjs exits 2 before
 *  any work: a mistyped --dry-run must never start the paid pass. */
export function parseArgs(argv) {
  const out = { dry: false, keep: false, only: null, config: null, reps: 1, resume: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dry = true;
    else if (a === '--keep') out.keep = true;
    else if (a === '--only' || a === '--config' || a === '--resume' || a === '--reps') {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) return { error: `${a} needs a value` };
      if (a === '--reps') {
        if (!/^\d+$/.test(v) || Number(v) < 1 || Number(v) > 10) return { error: '--reps must be a whole number from 1 to 10' };
        out.reps = Number(v);
      } else out[a.slice(2)] = v;
      i++;
    } else return { error: `unknown argument ${a}` };
  }
  return out;
}

/** K1-02: the three configurations of a pass. superpowers on and off (off in the test repository's own settings, so the
 *  session and forge's CLI see the same), and the prompt hint off (FORGE_ROUTE_HINT=off, K1-03). */
export const CONFIGS = [
  { name: 'with-superpowers', superpowers: true, hint: true },
  { name: 'without-superpowers', superpowers: false, hint: true },
  { name: 'no-hint', superpowers: true, hint: false },
];

/** The files of the throwaway repository the prompts talk about. Six, not four: forge's triage calls a repository with
 *  fewer than five files greenfield and sends every request to Large, which would hide the Trivial and Small prompts. */
export const DEMO_SHOP = {
  'package.json': JSON.stringify({ name: 'demo-shop', version: '1.0.0', type: 'module', scripts: { test: 'node --test' } }, null, 2) + '\n',
  'src/cart.js': 'export const total = items => items.reduce((s, i) => s + i.price * i.qty, 0);\nexport const withTax = (items, rate) => Math.round(total(items) * (1 + rate));\n',
  'src/index.js': "export { total, withTax } from './cart.js';\n",
  'test/cart.test.js': "import test from 'node:test';\nimport assert from 'node:assert';\nimport { total } from '../src/cart.js';\ntest('total', () => assert.equal(total([{ price: 100, qty: 2 }]), 200));\n",
  'README.md': '# demo-shop\n\nA small shop.\n',
  '.gitignore': 'node_modules/\n',
};

/** M2: the demo shop as a git repository at `repo`, and `reset`, which brings it back to its first commit before each
 *  session: nothing a session changed, committed or left behind (`.forge/` included) reaches the next prompt or
 *  configuration; only `.claude/`, which holds the configuration's settings, stays. Git never looks above the work
 *  folder (`repo`'s parent, GIT_CEILING_DIRECTORIES): a session that deleted the shop's .git makes `reset` throw, never
 *  reset or clean a repository above it. */
export function demoRepo(repo) {
  for (const [rel, text] of Object.entries(DEMO_SHOP)) {
    mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    writeFileSync(path.join(repo, rel), text);
  }
  const env = { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(path.resolve(repo)) };
  // stderr is kept, so a failure says why (it lands in the error's message).
  const git = (...a) => execFileSync('git', a, { cwd: repo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q');
  git('add', '.');
  git('-c', 'user.name=route-eval', '-c', 'user.email=route-eval@example.com', 'commit', '-qm', 'init');
  const first = git('rev-parse', 'HEAD').trim();
  return { reset: () => { git('reset', '-q', '--hard', first); git('clean', '-fdxq', '-e', '.claude'); } };
}

/** M3: the environment of a session. no-hint turns the hint off; the configurations with the hint drop a
 *  FORGE_ROUTE_HINT the person exported, which would make them no-hint too. */
export function sessionEnv(config, env) {
  const out = { ...env };
  delete out.FORGE_ROUTE_HINT;
  if (!config.hint) out.FORGE_ROUTE_HINT = 'off';
  return out;
}

/** The first skill a Skill tool_use loads, the plugins the init message lists, why the session stopped (the result
 *  message's subtype, e.g. `error_max_turns`), what it cost (its `total_cost_usd`), whether the result is an error
 *  (`isError`, null without a result) with its `apiStatus`, and the events of the hooks that ran (`hooks`, in order,
 *  without repeats), from `claude -p` stream-json. */
export function readStream(text) {
  let firstSkill = null;
  let plugins = null;
  let stop = null;
  let cost = null;
  let isError = null;
  let apiStatus = null;
  const hooks = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (!ev || typeof ev !== 'object') continue;
    if (plugins === null && ev.type === 'system' && ev.subtype === 'init' && Array.isArray(ev.plugins)) {
      plugins = ev.plugins.map(p => (typeof p === 'string' ? p : p && typeof p.name === 'string' ? p.name : null)).filter(p => p !== null);
    }
    if (firstSkill === null && ev.type === 'assistant' && Array.isArray(ev.message?.content)) {
      const use = ev.message.content.find(c => c && c.type === 'tool_use' && c.name === 'Skill' && typeof c.input?.skill === 'string');
      if (use) firstSkill = use.input.skill;
    }
    if (ev.type === 'system' && (ev.subtype === 'hook_started' || ev.subtype === 'hook_response') && typeof ev.hook_event === 'string' && !hooks.includes(ev.hook_event)) {
      hooks.push(ev.hook_event);
    }
    if (ev.type === 'result') {
      if (typeof ev.subtype === 'string') stop = ev.subtype;
      if (typeof ev.total_cost_usd === 'number' && Number.isFinite(ev.total_cost_usd)) cost = ev.total_cost_usd;
      isError = ev.is_error === true;
      apiStatus = typeof ev.api_error_status === 'number' && Number.isFinite(ev.api_error_status) ? ev.api_error_status : null;
    }
  }
  return { firstSkill, plugins, stop, cost, isError, apiStatus, hooks };
}

/** A7: why a session is a provider error and not a trial, or null when it is a valid one. A `claude` that did not start
 *  or timed out, a session without a result message, a refused login (401, 403) and any other API error are; an
 *  `error_max_turns` is not (it is what a Trivial prompt does when it starts editing). */
export function providerError({ spawnError, stop, isError, apiStatus }) {
  if (spawnError) return /ETIMEDOUT|timed out/i.test(spawnError) ? 'timeout' : 'spawn';
  if (stop === null) return 'no-result';
  if (apiStatus === 401 || apiStatus === 403) return 'auth';
  if (apiStatus !== null || (isError === true && stop !== 'error_max_turns')) return 'api';
  return null;
}

/** A7: the key of a trial: configuration, prompt and repetition (absent reads as 1). */
export const trialKey = ({ config, id, rep }) => `${config}/${id}/${rep ?? 1}`;

/** A7: the trials of a results JSONL; a line that is not the JSON of an object with a string `id` and `config` (a cut
 *  last line, say) is skipped. */
export function readTrials(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    if (r && typeof r === 'object' && !Array.isArray(r) && typeof r.id === 'string' && typeof r.config === 'string') out.push(r);
  }
  return out;
}

/** Appends one trial as a JSONL line; a file whose last line was cut (no final newline) gets one first, so the new line stands alone. */
export function appendTrial(file, row) {
  if (existsSync(file)) {
    const text = readFileSync(file, 'utf8');
    if (text.length && !text.endsWith('\n')) appendFileSync(file, '\n');
  }
  appendFileSync(file, JSON.stringify(row) + '\n');
}

/** A7: a trial counts unless the provider failed it or its configuration needs forge's hook and it did not run. */
export function isValidTrial(r, configs = CONFIGS) {
  return !r.provider && !(configs.find(c => c.name === r.config)?.hint === true && r.hookRan === false);
}

/** A7: the sessions still to run, by configuration, prompt and repetition, in that order: those without a valid trial in `done`. */
export function pending(prompts, configs, reps, done) {
  const have = new Set(done.filter(r => isValidTrial(r)).map(trialKey));
  const out = [];
  for (const config of configs) {
    for (const prompt of prompts) {
      for (let rep = 1; rep <= reps; rep++) if (!have.has(trialKey({ config: config.name, id: prompt.id, rep }))) out.push({ config, prompt, rep });
    }
  }
  return out;
}

/** A7: why the pass stops now, from the trials so far: a refused login, three provider errors in a row, or a
 *  configuration with the hint whose hook did not run; null otherwise. */
export function stopReason(trials, configs = CONFIGS) {
  const last = trials[trials.length - 1];
  if (!last) return null;
  if (last.provider === 'auth') return 'the provider refused the credentials: log in with claude, then resume';
  const tail = trials.slice(-3);
  if (tail.length === 3 && tail.every(r => r.provider)) {
    return `three provider errors in a row (${tail.map(r => r.provider).join(', ')}): the provider is failing, so the pass stops; resume it later`;
  }
  if (!last.provider && !isValidTrial(last, configs)) {
    return `forge's UserPromptSubmit hook did not run in ${last.config}: that configuration measures nothing; check that --plugin-dir loads plugins/forge, then resume`;
  }
  return null;
}

/** A7: the Wilson interval of `k` hits in `n` (z 1.96 by default), each end clamped to [0, 1] and rounded to four decimals; null without trials. */
export function wilson(k, n, z = 1.96) {
  if (!n) return null;
  const p = k / n;
  const d = 1 + z * z / n;
  const centre = (p + z * z / (2 * n)) / d;
  const half = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  const end = v => Math.round(Math.min(1, Math.max(0, v)) * 10000) / 10000;
  return { low: end(centre - half), high: end(centre + half) };
}

/** The arguments of one `claude -p` run: two turns are enough to see which skill loads first. */
export function claudeArgs(prompt, { settings, pluginDirs }) {
  return ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--include-hook-events', '--max-turns', '2', '--settings', settings, ...pluginDirs.flatMap(d => ['--plugin-dir', d])];
}

/** The --settings of every configuration: this kit's installed copies off (the worktree's load with --plugin-dir). */
export function settingsFor(installedKeys) {
  const enabledPlugins = {};
  for (const k of installedKeys) if (/^(forge|waypoint|lens)@/.test(k)) enabledPlugins[k] = false;
  return { enabledPlugins };
}

/** K1-02: the test repository's .claude/settings.local.json. superpowers is off there in the configuration without it, so
 *  the session and forge's installedPlugins (which reads the project's settings, never --settings) agree. */
export function projectSettingsFor(withSuperpowers, installedKeys) {
  const enabledPlugins = {};
  if (!withSuperpowers) for (const k of installedKeys) if (/^superpowers@/.test(k)) enabledPlugins[k] = false;
  return { enabledPlugins };
}

/** Per configuration: forge:route first in how many of the prompts that expect it (Medium and Large), the false
 *  negatives, the false positives among those that expect none (Trivial, questions and agent messages), the Small ones
 *  apart (`either`: forge's rules load forge:route for them and it steps aside, so loading it or not are both right; I1),
 *  the competing ones apart (A7: their text pushes against forge:route; they count for neither the rate nor PASS),
 *  whether the init plugins agree with the configuration (`plugins`, M3: `contradicts` when a session lists superpowers
 *  where it is off, or lacks it where it is on; null when no session listed them or the configuration is not one of
 *  `configs`) and the cost.
 *  A7: the rates come from the valid trials, the last one of each key (config/prompt/rep); the cost adds every row, the
 *  invalid ones too, which were paid; `providerErrors` and `hookMissing` count the rows that are not trials, and `ci` is
 *  the Wilson interval of the rate. */
export function summarize(results, configs = CONFIGS) {
  return [...new Set(results.map(r => r.config))].map(config => {
    const all = results.filter(r => r.config === config);
    const last = new Map();
    for (const r of all) if (isValidTrial(r, configs)) { const k = trialKey(r); last.set(k, r); }
    const mine = [...last.values()];
    const fired = r => r.firstSkill === 'forge:route';
    const routable = mine.filter(r => r.expected === 'route' && !r.competing);
    const competing = mine.filter(r => r.expected === 'route' && r.competing);
    const others = mine.filter(r => r.expected === 'none');
    const either = mine.filter(r => r.expected === 'either');
    const routed = routable.filter(fired).length;
    const costs = all.map(r => r.cost).filter(c => typeof c === 'number');
    const want = configs.find(c => c.name === config)?.superpowers;
    const listed = all.filter(r => Array.isArray(r.plugins));
    const hasSuperpowers = r => r.plugins.some(p => /^superpowers(?:@|$)/.test(p));
    return {
      config, routed, routable: routable.length, rate: routable.length ? routed / routable.length : 0,
      falseNegatives: routable.length - routed, falsePositives: others.filter(fired).length, others: others.length,
      either: either.length, eitherRouted: either.filter(fired).length,
      competing: competing.length, competingRouted: competing.filter(fired).length,
      plugins: want === undefined || !listed.length ? null : listed.some(r => hasSuperpowers(r) !== want) ? 'contradicts' : 'ok',
      cost: costs.length ? Math.round(costs.reduce((a, b) => a + b, 0) * 10000) / 10000 : null,
      ci: wilson(routed, routable.length),
      providerErrors: all.filter(r => r.provider).length,
      hookMissing: all.filter(r => !r.provider && !isValidTrial(r, configs)).length,
    };
  });
}

/** The target: forge:route first in 90 % or more of the prompts that expect it and in none of those that expect none, in
 *  every configuration. The Small ones (`either`) count for neither. */
export const passes = summary => summary.length > 0 && summary.every(s => s.routable > 0 && s.rate >= 0.9 && s.falsePositives === 0);

export function table(results, summary) {
  const usd = (n, digits) => (n === null ? '—' : `$${n.toFixed(digits)}`);
  const lines = ['| prompt | size | lang | expected | competing | config | rep | first skill | cost | invalid | error |', '|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const r of results) {
    const invalid = r.provider ? r.provider : isValidTrial(r) ? '' : 'no hook';
    lines.push(`| ${r.id} | ${r.size} | ${r.lang} | ${r.expected} | ${r.competing ?? ''} | ${r.config} | ${r.rep ?? 1} | ${r.firstSkill ?? '—'} | ${usd(r.cost, 4)} | ${invalid} | ${r.error ?? ''} |`);
  }
  lines.push('', '| config | forge:route first | Wilson 95 % | false negatives | false positives | Small (either) | competing | provider errors | no hook | plugins | cost |',
    '|---|---|---|---|---|---|---|---|---|---|---|');
  for (const s of summary) {
    const ci = s.ci ? `${Math.round(s.ci.low * 100)}–${Math.round(s.ci.high * 100)} %` : '—';
    lines.push(`| ${s.config} | ${s.routed}/${s.routable} (${Math.round(s.rate * 100)} %) | ${ci} | ${s.falseNegatives} | ${s.falsePositives}/${s.others} | `
      + `${s.eitherRouted}/${s.either} | ${s.competingRouted}/${s.competing} | ${s.providerErrors} | ${s.hookMissing} | ${s.plugins ?? '—'} | ${usd(s.cost, 2)} |`);
  }
  return lines.join('\n');
}
