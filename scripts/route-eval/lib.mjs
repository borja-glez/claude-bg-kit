// The empirical routing test (spec §5.1): pure helpers for run.mjs. Plain JavaScript, so `node` runs it as it is.

/** The first skill a Skill tool_use loads and the plugins the init message lists, from `claude -p` stream-json. */
export function readStream(text) {
  let firstSkill = null;
  let plugins = null;
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
  }
  return { firstSkill, plugins };
}

/** The arguments of one `claude -p` run: two turns are enough to see which skill loads first. */
export function claudeArgs(prompt, { settings, pluginDirs }) {
  return ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--max-turns', '2', '--settings', settings, ...pluginDirs.flatMap(d => ['--plugin-dir', d])];
}

/** One configuration's settings: this kit's installed copies off (the worktree's are loaded with --plugin-dir), and
 *  superpowers off too in the configuration without it. */
export function settingsFor(withSuperpowers, installedKeys) {
  const enabledPlugins = {};
  for (const k of installedKeys) {
    if (/^(forge|waypoint|lens)@/.test(k) || (!withSuperpowers && /^superpowers@/.test(k))) enabledPlugins[k] = false;
  }
  return { enabledPlugins };
}

/** Per configuration: how many Medium and Large prompts loaded forge:route first, and how many Trivial ones did. */
export function summarize(results) {
  return [...new Set(results.map(r => r.config))].map(config => {
    const mine = results.filter(r => r.config === config);
    const routable = mine.filter(r => r.size !== 'trivial');
    const trivial = mine.filter(r => r.size === 'trivial');
    const routed = routable.filter(r => r.firstSkill === 'forge:route').length;
    return { config, routed, routable: routable.length, rate: routable.length ? routed / routable.length : 0, trivialFired: trivial.filter(r => r.firstSkill === 'forge:route').length, trivial: trivial.length };
  });
}

/** The target of spec §5.1: at least 90 % of Medium and Large, no Trivial, in every configuration. */
export const passes = summary => summary.length > 0 && summary.every(s => s.routable > 0 && s.rate >= 0.9 && s.trivialFired === 0);

export function table(results, summary) {
  const lines = ['| prompt | size | lang | config | first skill | error |', '|---|---|---|---|---|---|'];
  for (const r of results) lines.push(`| ${r.id} | ${r.size} | ${r.lang} | ${r.config} | ${r.firstSkill ?? '—'} | ${r.error ?? ''} |`);
  lines.push('');
  for (const s of summary) lines.push(`- ${s.config}: forge:route first in ${s.routed}/${s.routable} Medium and Large (${Math.round(s.rate * 100)} %), in ${s.trivialFired}/${s.trivial} Trivial`);
  return lines.join('\n');
}
