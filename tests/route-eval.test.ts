import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { claudeArgs, passes, readStream, settingsFor, summarize, table, type EvalResult } from '../scripts/route-eval/lib.mjs';

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
    expect(readStream(stream)).toEqual({ firstSkill: 'forge:route', plugins: ['forge', 'waypoint'], stop: null });
    expect(readStream('')).toEqual({ firstSkill: null, plugins: null, stop: null });
  });
  it('reads why the session stopped from its result message', () => {
    const stream = [
      line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: 'a' } }] } }),
      line({ type: 'result', subtype: 'error_max_turns', is_error: true }),
    ].join('\n');
    expect(readStream(stream)).toEqual({ firstSkill: null, plugins: null, stop: 'error_max_turns' });
  });
  it('builds the claude arguments and the settings of each configuration', () => {
    expect(claudeArgs('Add X', { settings: 's.json', pluginDirs: ['/p/forge', '/p/waypoint'] })).toEqual(
      ['-p', 'Add X', '--output-format', 'stream-json', '--verbose', '--max-turns', '2', '--settings', 's.json', '--plugin-dir', '/p/forge', '--plugin-dir', '/p/waypoint']);
    const keys = ['forge@bg-kit', 'waypoint@bg-kit', 'lens@bg-kit', 'superpowers@claude-plugins-official', 'context7@claude-plugins-official'];
    expect(settingsFor(true, keys)).toEqual({ enabledPlugins: { 'forge@bg-kit': false, 'waypoint@bg-kit': false, 'lens@bg-kit': false } });
    expect(settingsFor(false, keys).enabledPlugins).toEqual({ 'forge@bg-kit': false, 'waypoint@bg-kit': false, 'lens@bg-kit': false, 'superpowers@claude-plugins-official': false });
  });
  it('summarizes per configuration and passes only at 90 % with no trivial routed', () => {
    const r = (id: string, size: EvalResult['size'], firstSkill: string | null): EvalResult => ({ id, size, lang: 'en', config: 'with', firstSkill, plugins: null, error: null });
    const ok = [...Array.from({ length: 10 }, (_, i) => r(`m${i}`, 'medium', 'forge:route')), r('t', 'trivial', null)];
    expect(summarize(ok)).toEqual([{ config: 'with', routed: 10, routable: 10, rate: 1, trivialFired: 0, trivial: 1 }]);
    expect(passes(summarize(ok))).toBe(true);
    expect(passes(summarize([...ok.slice(0, 9), r('m9', 'medium', 'superpowers:brainstorming'), ok[10]]))).toBe(true);
    expect(passes(summarize([...ok.slice(0, 8), r('m8', 'medium', null), r('m9', 'medium', null), ok[10]]))).toBe(false);
    expect(passes(summarize([...ok.slice(0, 10), r('t', 'trivial', 'forge:route')]))).toBe(false);
    expect(passes([])).toBe(false);
    expect(table(ok, summarize(ok))).toContain('| m0 | medium | en | with | forge:route |');
  });
  it('has the prompts of spec §5.1: two Medium and two Large in each language, and two Trivial, none naming the method', () => {
    const prompts = JSON.parse(readFileSync(new URL('../scripts/route-eval/prompts.json', import.meta.url), 'utf8')) as { id: string; size: string; lang: string; text: string }[];
    const count = (size: string, lang?: string) => prompts.filter(p => p.size === size && (!lang || p.lang === lang)).length;
    expect([count('medium', 'es'), count('medium', 'en'), count('large', 'es'), count('large', 'en'), count('trivial')]).toEqual([2, 2, 2, 2, 2]);
    expect(prompts.every(p => !/forge|superpowers/i.test(p.text))).toBe(true);
    expect(new Set(prompts.map(p => p.id)).size).toBe(prompts.length);
  });
  it('--dry-run prints one claude command per prompt and configuration without running claude', () => {
    const r = spawnSync(process.execPath, ['scripts/route-eval/run.mjs', '--dry-run'], { encoding: 'utf8', timeout: 60000 });
    expect(r.status).toBe(0);
    expect(r.stdout.trim().split(/\r?\n/).filter(l => l.startsWith('claude '))).toHaveLength(20);
  });
});
