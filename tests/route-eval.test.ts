import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { CONFIGS, claudeArgs, passes, projectSettingsFor, readStream, settingsFor, summarize, table, type EvalPrompt, type EvalResult } from '../scripts/route-eval/lib.mjs';
import { locateSuperpowers } from '../src/forge/superpowers.js';
import { useTempDirs } from './helpers/tmp.js';

const tmp = useTempDirs();
const line = (o: unknown) => JSON.stringify(o);

describe('route-eval', () => {
  it('reads the first Skill tool_use and the plugins of the init message', () => {
    const stream = [
      line({ type: 'system', subtype: 'init', plugins: [{ name: 'forge', path: '/x' }, 'waypoint'] }),
      'not json',
      line({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }, { type: 'tool_use', name: 'Read', input: { file_path: 'a' } }] } }),
      line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'forge:route' } }] } }),
      line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'superpowers:brainstorming' } }] } }),
    ].join('\n');
    expect(readStream(stream)).toEqual({ firstSkill: 'forge:route', plugins: ['forge', 'waypoint'], stop: null, cost: null });
    expect(readStream('')).toEqual({ firstSkill: null, plugins: null, stop: null, cost: null });
  });
  it('reads why the session stopped and what it cost from its result message (K1-02)', () => {
    const stream = [
      line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: 'a' } }] } }),
      line({ type: 'result', subtype: 'error_max_turns', is_error: true, total_cost_usd: 0.0123 }),
    ].join('\n');
    expect(readStream(stream)).toEqual({ firstSkill: null, plugins: null, stop: 'error_max_turns', cost: 0.0123 });
  });
  it('builds the claude arguments, the --settings of every configuration and the repository settings of each (K1-02)', () => {
    expect(claudeArgs('Add X', { settings: 's.json', pluginDirs: ['/p/forge', '/p/waypoint'] })).toEqual(
      ['-p', 'Add X', '--output-format', 'stream-json', '--verbose', '--max-turns', '2', '--settings', 's.json', '--plugin-dir', '/p/forge', '--plugin-dir', '/p/waypoint']);
    const keys = ['forge@bg-kit', 'waypoint@bg-kit', 'lens@bg-kit', 'superpowers@claude-plugins-official', 'context7@claude-plugins-official'];
    expect(settingsFor(keys)).toEqual({ enabledPlugins: { 'forge@bg-kit': false, 'waypoint@bg-kit': false, 'lens@bg-kit': false } });
    expect(projectSettingsFor(false, keys)).toEqual({ enabledPlugins: { 'superpowers@claude-plugins-official': false } });
    expect(projectSettingsFor(true, keys)).toEqual({ enabledPlugins: {} });
    expect(CONFIGS.map(c => [c.name, c.superpowers, c.hint])).toEqual([['with-superpowers', true, true], ['without-superpowers', false, true], ['no-hint', true, false]]);
  });
  it("without superpowers, the test repository turns it off in its own settings, so forge's CLI sees it off too (K1-02)", () => {
    const cfg = tmp('route-eval-cfg-');
    const repo = tmp('route-eval-repo-');
    const install = path.join(cfg, 'plugins', 'cache', 'm', 'superpowers', '6.4.1');
    mkdirSync(install, { recursive: true });
    writeFileSync(path.join(cfg, 'plugins', 'installed_plugins.json'),
      JSON.stringify({ version: 2, plugins: { 'superpowers@m': [{ scope: 'user', installPath: install, version: '6.4.1' }] } }));
    expect(locateSuperpowers({ configDir: cfg, projectDir: repo }).installed).toBe(true);
    mkdirSync(path.join(repo, '.claude'), { recursive: true });
    writeFileSync(path.join(repo, '.claude', 'settings.local.json'), JSON.stringify(projectSettingsFor(false, ['superpowers@m'])));
    expect(locateSuperpowers({ configDir: cfg, projectDir: repo }).installed).toBe(false);
  });
  it('summarizes per configuration by what each prompt expects: hits, false negatives and positives, and the cost (K1-02)', () => {
    const r = (id: string, expected: EvalResult['expected'], firstSkill: string | null, cost: number | null = 0.01): EvalResult =>
      ({ id, size: expected === 'route' ? 'medium' : 'question', lang: 'en', expected, config: 'with', firstSkill, plugins: null, cost, error: null });
    const ok = [...Array.from({ length: 10 }, (_, i) => r(`m${i}`, 'route', 'forge:route')), r('q', 'none', null), r('a', 'none', null, null)];
    expect(summarize(ok)).toEqual([{ config: 'with', routed: 10, routable: 10, rate: 1, falseNegatives: 0, falsePositives: 0, others: 2, cost: 0.11 }]);
    expect(passes(summarize(ok))).toBe(true);
    expect(passes(summarize([...ok.slice(0, 9), r('m9', 'route', 'superpowers:brainstorming'), ...ok.slice(10)]))).toBe(true);
    const missed = [...ok.slice(0, 8), r('m8', 'route', null), r('m9', 'route', null), ...ok.slice(10)];
    expect(summarize(missed)[0]).toMatchObject({ routed: 8, falseNegatives: 2 });
    expect(passes(summarize(missed))).toBe(false);
    const fired = [...ok.slice(0, 10), r('q', 'none', 'forge:route'), ok[11]];
    expect(summarize(fired)[0].falsePositives).toBe(1);
    expect(passes(summarize(fired))).toBe(false);
    expect(passes([])).toBe(false);
    expect(summarize([r('q', 'none', null, null)])[0].cost).toBeNull();
    expect(table(ok, summarize(ok))).toContain('| m0 | medium | en | route | with | forge:route | $0.0100 |');
  });
  it('has 16 prompts: Medium and Large expect forge:route; Trivial, Small, questions and agent messages do not (K1-02)', () => {
    const prompts = JSON.parse(readFileSync(new URL('../scripts/route-eval/prompts.json', import.meta.url), 'utf8')) as EvalPrompt[];
    const count = (size: string, lang?: string) => prompts.filter(p => p.size === size && (!lang || p.lang === lang)).length;
    expect(prompts).toHaveLength(16);
    expect([count('medium', 'es'), count('medium', 'en'), count('large', 'es'), count('large', 'en')]).toEqual([2, 2, 2, 2]);
    expect([count('trivial'), count('small'), count('question'), count('agent')]).toEqual([2, 2, 2, 2]);
    for (const p of prompts) expect(p.expected, p.id).toBe(p.size === 'medium' || p.size === 'large' ? 'route' : 'none');
    expect(prompts.every(p => !/forge|superpowers/i.test(p.text))).toBe(true);
    expect(prompts.filter(p => p.size === 'agent').every(p => /^<[a-z]/i.test(p.text))).toBe(true);
    expect(new Set(prompts.map(p => p.id)).size).toBe(prompts.length);
  });
  it('--dry-run prints one claude command per prompt and configuration, --config picks one, and no-hint turns the hint off (K1-02)', () => {
    const dry = (...extra: string[]) => spawnSync(process.execPath, ['scripts/route-eval/run.mjs', '--dry-run', ...extra], { encoding: 'utf8', timeout: 60000 });
    const all = dry();
    expect(all.status, all.stderr).toBe(0);
    expect(all.stdout.trim().split(/\r?\n/).filter(l => /^(FORGE_ROUTE_HINT=off )?claude /.test(l))).toHaveLength(48);
    const noHint = dry('--config', 'no-hint').stdout.trim().split(/\r?\n/).filter(l => l.includes('claude '));
    expect(noHint).toHaveLength(16);
    expect(noHint.every(l => l.startsWith('FORGE_ROUTE_HINT=off claude '))).toBe(true);
    expect(dry('--config', 'nope').status).toBe(2);
  });
});
