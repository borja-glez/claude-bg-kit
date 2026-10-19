// The empirical routing test: pure helpers for run.mjs. Plain JavaScript, so `node` runs it as it is.

/** K1-02: the three configurations of a pass. superpowers on and off (off in the test repository's own settings, so the
 *  session and forge's CLI see the same), and the prompt hint off (FORGE_ROUTE_HINT=off, K1-03). */
export const CONFIGS = [
  { name: 'with-superpowers', superpowers: true, hint: true },
  { name: 'without-superpowers', superpowers: false, hint: true },
  { name: 'no-hint', superpowers: true, hint: false },
];

/** The first skill a Skill tool_use loads, the plugins the init message lists, why the session stopped (the result
 *  message's subtype, e.g. `error_max_turns`) and what it cost (its `total_cost_usd`), from `claude -p` stream-json. */
export function readStream(text) {
  let firstSkill = null;
  let plugins = null;
  let stop = null;
  let cost = null;
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
    if (ev.type === 'result') {
      if (typeof ev.subtype === 'string') stop = ev.subtype;
      if (typeof ev.total_cost_usd === 'number' && Number.isFinite(ev.total_cost_usd)) cost = ev.total_cost_usd;
    }
  }
  return { firstSkill, plugins, stop, cost };
}

/** The arguments of one `claude -p` run: two turns are enough to see which skill loads first. */
export function claudeArgs(prompt, { settings, pluginDirs }) {
  return ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--max-turns', '2', '--settings', settings, ...pluginDirs.flatMap(d => ['--plugin-dir', d])];
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
 *  negatives, the false positives among the rest (Trivial, Small, questions and agent messages) and the cost. */
export function summarize(results) {
  return [...new Set(results.map(r => r.config))].map(config => {
    const mine = results.filter(r => r.config === config);
    const fired = r => r.firstSkill === 'forge:route';
    const routable = mine.filter(r => r.expected === 'route');
    const others = mine.filter(r => r.expected !== 'route');
    const routed = routable.filter(fired).length;
    const costs = mine.map(r => r.cost).filter(c => typeof c === 'number');
    return {
      config, routed, routable: routable.length, rate: routable.length ? routed / routable.length : 0,
      falseNegatives: routable.length - routed, falsePositives: others.filter(fired).length, others: others.length,
      cost: costs.length ? Math.round(costs.reduce((a, b) => a + b, 0) * 10000) / 10000 : null,
    };
  });
}

/** The target: forge:route first in 90 % or more of the prompts that expect it and in none of the rest, in every configuration. */
export const passes = summary => summary.length > 0 && summary.every(s => s.routable > 0 && s.rate >= 0.9 && s.falsePositives === 0);

export function table(results, summary) {
  const usd = (n, digits) => (n === null ? '—' : `$${n.toFixed(digits)}`);
  const lines = ['| prompt | size | lang | expected | config | first skill | cost | error |', '|---|---|---|---|---|---|---|---|'];
  for (const r of results) {
    lines.push(`| ${r.id} | ${r.size} | ${r.lang} | ${r.expected} | ${r.config} | ${r.firstSkill ?? '—'} | ${usd(r.cost, 4)} | ${r.error ?? ''} |`);
  }
  lines.push('');
  for (const s of summary) {
    lines.push(`- ${s.config}: forge:route first in ${s.routed}/${s.routable} that expect it (${Math.round(s.rate * 100)} %), ${s.falseNegatives} false negatives, `
      + `${s.falsePositives}/${s.others} false positives (Trivial, Small, questions and agent messages); cost ${usd(s.cost, 2)}`);
  }
  return lines.join('\n');
}
