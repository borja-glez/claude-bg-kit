import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import {
  CONFIGS, DEMO_SHOP, appendTrial, claudeArgs, demoRepo, foreignPromptHooks, forgeHookRan, parseArgs, passes, pending, projectSettingsFor, providerError, readStream,
  readTrials, sessionEnv, settingsFor, stopReason, summarize, table, trialKey, wilson, type EvalPrompt, type EvalResult,
} from '../scripts/route-eval/lib.mjs';
import { locateSuperpowers } from '../src/forge/superpowers.js';
import { run, type Io } from '../src/forge/cli/run.js';
import { useTempDirs } from './helpers/tmp.js';

const tmp = useTempDirs();
const line = (o: unknown) => JSON.stringify(o);
const row = (config: string, id: string, rep: number, o: Partial<EvalResult> = {}): EvalResult => ({ id, size: 'medium', lang: 'en', expected: 'route', competing: null,
  config, rep, firstSkill: 'forge:route', plugins: null, cost: 0.01, error: null, provider: null, hookRan: true, ...o });

describe('route-eval', () => {
  it('reads the first Skill tool_use and the plugins of the init message', () => {
    const stream = [
      line({ type: 'system', subtype: 'init', plugins: [{ name: 'forge', path: '/x' }, 'waypoint'] }),
      'not json',
      line({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }, { type: 'tool_use', name: 'Read', input: { file_path: 'a' } }] } }),
      line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'forge:route' } }] } }),
      line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'superpowers:brainstorming' } }] } }),
    ].join('\n');
    expect(readStream(stream)).toEqual({ firstSkill: 'forge:route', plugins: ['forge', 'waypoint'], stop: null, cost: null, isError: null, apiStatus: null, hooks: [],
      promptHooks: 0 });
    expect(readStream('')).toEqual({ firstSkill: null, plugins: null, stop: null, cost: null, isError: null, apiStatus: null, hooks: [], promptHooks: 0 });
  });
  it('reads why the session stopped and what it cost from its result message (K1-02)', () => {
    const stream = [
      line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: 'a' } }] } }),
      line({ type: 'result', subtype: 'error_max_turns', is_error: true, total_cost_usd: 0.0123 }),
    ].join('\n');
    expect(readStream(stream)).toEqual({ firstSkill: null, plugins: null, stop: 'error_max_turns', cost: 0.0123, isError: true, apiStatus: null, hooks: [], promptHooks: 0 });
  });
  it('builds the claude arguments, the --settings of every configuration and the repository settings of each (K1-02)', () => {
    expect(claudeArgs('Add X', { settings: 's.json', pluginDirs: ['/p/forge', '/p/waypoint'] })).toEqual(
      ['-p', 'Add X', '--output-format', 'stream-json', '--verbose', '--include-hook-events', '--max-turns', '2', '--settings', 's.json', '--plugin-dir', '/p/forge', '--plugin-dir', '/p/waypoint']);
    const keys = ['forge@bg-kit', 'waypoint@bg-kit', 'lens@bg-kit', 'superpowers@claude-plugins-official', 'context7@claude-plugins-official'];
    // w8 FR1: the person's FORGE_WORKFLOW (their settings' env) would silence or pin the routing measured here.
    expect(settingsFor(keys)).toEqual({ enabledPlugins: { 'forge@bg-kit': false, 'waypoint@bg-kit': false, 'lens@bg-kit': false }, env: { FORGE_WORKFLOW: 'ask' } });
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
    expect(summarize(ok)).toEqual([{ config: 'with', routed: 10, routable: 10, rate: 1, falseNegatives: 0, falsePositives: 0, others: 2, either: 0, eitherRouted: 0, competing: 0, competingRouted: 0, plugins: null, cost: 0.11,
      ci: { low: 0.7225, high: 1 }, providerErrors: 0, hookMissing: 0 }]);
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
    expect(table(ok, summarize(ok))).toContain('| m0 | medium | en | route |  | with | 1 | forge:route | $0.0100 |');
  });
  it("a Small prompt expects either: forge's rules load forge:route, which steps aside, so it is neither a false positive nor a miss (I1)", () => {
    const r = (id: string, expected: EvalResult['expected'], firstSkill: string | null): EvalResult =>
      ({ id, size: expected === 'either' ? 'small' : expected === 'route' ? 'medium' : 'trivial', lang: 'en', expected, config: 'with', firstSkill, plugins: null, cost: null, error: null });
    const routed = Array.from({ length: 8 }, (_, i) => r(`m${i}`, 'route', 'forge:route'));
    const results = [...routed, r('t', 'none', null), r('s1', 'either', 'forge:route'), r('s2', 'either', null)];
    const [s] = summarize(results);
    expect(s).toMatchObject({ routed: 8, routable: 8, falseNegatives: 0, falsePositives: 0, others: 1, either: 2, eitherRouted: 1 });
    expect(passes([s])).toBe(true);
    expect(passes(summarize([...routed, r('t', 'none', null), r('s1', 'either', 'forge:route'), r('s2', 'either', 'forge:route')]))).toBe(true);
    const out = table(results, [s]);
    expect(out).toContain('| s1 | small | en | either |  | with | 1 | forge:route |');
    const head = out.split('\n').find(l => l.startsWith('| config |'))!;
    const row = out.split('\n').find(l => l.startsWith('| with |'))!;
    const cell = (name: string) => row.split('|').map(c => c.trim())[head.split('|').map(c => c.trim()).indexOf(name)];
    expect(cell('Small (either)')).toBe('1/2');
    expect(cell('false positives')).toBe('0/1');
  });
  it('a competing prompt counts in its own column, never in the rate nor in PASS (A7)', () => {
    const r = (id: string, competing: EvalResult['competing'], firstSkill: string | null): EvalResult =>
      ({ id, size: 'medium', lang: 'en', expected: 'route', competing, config: 'with', firstSkill, plugins: null, cost: null, error: null });
    const results = [...Array.from({ length: 8 }, (_, i) => r(`m${i}`, null, 'forge:route')), r('c1', 'direct', 'superpowers:brainstorming'), r('c2', 'brainstorming', 'forge:route')];
    const [s] = summarize(results);
    expect(s).toMatchObject({ routed: 8, routable: 8, falseNegatives: 0, competing: 2, competingRouted: 1 });
    expect(passes([s])).toBe(true);
    const out = table(results, [s]);
    expect(out).toContain('| c1 | medium | en | route | direct | with | 1 | superpowers:brainstorming |');
    const head = out.split('\n').find(l => l.startsWith('| config |'))!.split('|').map(c => c.trim());
    expect(out.split('\n').find(l => l.startsWith('| with |'))!.split('|').map(c => c.trim())[head.indexOf('competing')]).toBe('1/2');
  });
  it('flags a configuration whose init plugins contradict it: superpowers listed when it is off, or missing when it is on (M3)', () => {
    const r = (config: string, plugins: string[] | null): EvalResult =>
      ({ id: 'm', size: 'medium', lang: 'en', expected: 'route', config, firstSkill: 'forge:route', plugins, cost: null, error: null });
    const flags = (results: EvalResult[]) => summarize(results).map(s => [s.config, s.plugins]);
    expect(flags([r('with-superpowers', ['forge', 'waypoint', 'superpowers']), r('without-superpowers', ['forge', 'waypoint']), r('no-hint', ['superpowers@m', 'forge'])]))
      .toEqual([['with-superpowers', 'ok'], ['without-superpowers', 'ok'], ['no-hint', 'ok']]);
    expect(flags([r('without-superpowers', ['forge', 'superpowers']), r('with-superpowers', ['forge', 'waypoint']), r('no-hint', null)]))
      .toEqual([['without-superpowers', 'contradicts'], ['with-superpowers', 'contradicts'], ['no-hint', null]]);
    // One session out of line is enough; a configuration this script does not know is not checked.
    expect(flags([r('without-superpowers', ['forge']), r('without-superpowers', ['forge', 'superpowers'])])).toEqual([['without-superpowers', 'contradicts']]);
    expect(flags([r('other', ['superpowers'])])).toEqual([['other', null]]);
    const results = [r('without-superpowers', ['forge', 'superpowers'])];
    const out = table(results, summarize(results)).split('\n');
    const head = out.find(l => l.startsWith('| config |'))!.split('|').map(c => c.trim());
    expect(out.find(l => l.startsWith('| without-superpowers |'))!.split('|').map(c => c.trim())[head.indexOf('plugins')]).toBe('contradicts');
  });
  it('the configurations with the hint drop a FORGE_ROUTE_HINT the person exported; no-hint sets it off (M3)', () => {
    const [withSp, withoutSp, noHint] = CONFIGS;
    expect(sessionEnv(withSp, { PATH: 'p', FORGE_ROUTE_HINT: 'off' })).toEqual({ PATH: 'p' });
    expect(sessionEnv(withoutSp, { PATH: 'p', FORGE_ROUTE_HINT: 'on' })).toEqual({ PATH: 'p' });
    expect(sessionEnv(noHint, { PATH: 'p' })).toEqual({ PATH: 'p', FORGE_ROUTE_HINT: 'off' });
    // w8 FR1: and the FORGE_WORKFLOW they exported, which would silence the hooks or pin the route.
    expect(sessionEnv(withSp, { PATH: 'p', FORGE_WORKFLOW: 'off' })).toEqual({ PATH: 'p' });
  });
  it('takes only --dry-run, --keep, --only <v> and --config <v> (M1)', () => {
    expect(parseArgs([])).toEqual({ dry: false, keep: false, only: null, config: null, reps: 1, resume: null });
    expect(parseArgs(['--keep', '--only', 'm-es-1', '--config', 'no-hint', '--dry-run'])).toEqual({ dry: true, keep: true, only: 'm-es-1', config: 'no-hint', reps: 1, resume: null });
    for (const bad of [['--dryrun'], ['--dry_run'], ['-n'], ['dry-run'], ['--only'], ['--config'], ['--only', '--dry-run'], ['--config', '--keep']]) {
      expect(parseArgs(bad), bad.join(' ')).toHaveProperty('error');
    }
  });
  it('reads the hooks that ran and the API error of the result message (A7)', () => {
    const stream = [
      line({ type: 'system', subtype: 'hook_started', hook_id: 'h1', hook_name: 'UserPromptSubmit', hook_event: 'UserPromptSubmit' }),
      line({ type: 'system', subtype: 'hook_response', hook_id: 'h1', hook_name: 'UserPromptSubmit', hook_event: 'UserPromptSubmit', exit_code: 0, stdout: '' }),
      line({ type: 'system', subtype: 'hook_response', hook_event: 'SessionStart' }),
      line({ type: 'result', subtype: 'success', is_error: true, api_error_status: 529, total_cost_usd: 0 }),
    ].join('\n');
    expect(readStream(stream)).toMatchObject({ hooks: ['UserPromptSubmit', 'SessionStart'], promptHooks: 1, isError: true, apiStatus: 529, stop: 'success' });
  });
  it("a UserPromptSubmit hook outside forge alone does not read as forge's: hookRan needs more of them than run outside forge (A7)", () => {
    // claude names every one of them UserPromptSubmit; only hook_id tells them apart.
    const started = (id?: string) => line({ type: 'system', subtype: 'hook_started', ...(id ? { hook_id: id } : {}), hook_name: 'UserPromptSubmit', hook_event: 'UserPromptSubmit' });
    const answered = (id: string) => line({ type: 'system', subtype: 'hook_response', hook_id: id, hook_name: 'UserPromptSubmit', hook_event: 'UserPromptSubmit', exit_code: 0, stdout: '{}' });
    const result = line({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.01 });
    const foreignOnly = readStream([started('orca'), answered('orca'), result].join('\n'));
    expect(foreignOnly).toMatchObject({ hooks: ['UserPromptSubmit'], promptHooks: 1 });
    expect(forgeHookRan(foreignOnly.promptHooks, 1)).toBe(false);
    const both = readStream([started('orca'), started('forge'), answered('forge'), answered('orca'), result].join('\n'));
    expect(both.promptHooks).toBe(2);
    expect(forgeHookRan(both.promptHooks, 1)).toBe(true);
    expect(forgeHookRan(foreignOnly.promptHooks, 0)).toBe(true);
    expect(readStream([started(), started(), result].join('\n')).promptHooks).toBe(2);
    expect(forgeHookRan(readStream(result).promptHooks, 0)).toBe(false);
  });
  it('counts the UserPromptSubmit hooks outside forge of each configuration: the settings, the enabled installed plugins and the other plugin dirs (A7)', () => {
    const cfg = tmp('route-eval-hooks-');
    const prompt = (command: string) => ({ UserPromptSubmit: [{ hooks: [{ type: 'command', command }] }] });
    const plugin = (dir: string, hooks: object | null, manifest?: object) => {
      mkdirSync(path.join(dir, 'hooks'), { recursive: true });
      mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
      if (hooks) writeFileSync(path.join(dir, 'hooks', 'hooks.json'), JSON.stringify({ hooks }));
      if (manifest) writeFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify(manifest));
      return dir;
    };
    const at = (name: string) => path.join(cfg, 'plugins', 'cache', 'm', name);
    plugin(at('forge'), prompt('forge route-prompt'));
    plugin(at('superpowers'), prompt('superpowers prompt'));
    plugin(at('notes'), { SessionStart: [{ hooks: [{ type: 'command', command: 'start' }] }] }, { name: 'notes', hooks: ['./extra.json'] });
    writeFileSync(path.join(at('notes'), 'extra.json'), JSON.stringify({ hooks: prompt('notes prompt') }));
    plugin(at('off'), prompt('off prompt'));
    const installed = (name: string) => [{ scope: 'project', projectPath: '/x', installPath: path.join(cfg, 'nowhere') }, { scope: 'user', installPath: at(name) }];
    writeFileSync(path.join(cfg, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: {
      'forge@bg-kit': installed('forge'), 'superpowers@m': installed('superpowers'), 'notes@m': installed('notes'), 'off@m': installed('off') } }));
    writeFileSync(path.join(cfg, 'settings.json'), JSON.stringify({
      hooks: { ...prompt('orca-hook || echo {}'), SessionStart: [{ hooks: [{ type: 'command', command: 'orca-hook' }] }] },
      enabledPlugins: { 'forge@bg-kit': true, 'superpowers@m': true, 'notes@m': true, 'off@m': false, 'builtin@builtin': true },
    }));
    const waypoint = plugin(path.join(cfg, 'checkout', 'waypoint'), null, { name: 'waypoint', hooks: { hooks: prompt('waypoint prompt') } });
    expect(foreignPromptHooks({ configDir: cfg, superpowers: true })).toEqual(['settings.json', 'superpowers@m', 'notes@m']);
    expect(foreignPromptHooks({ configDir: cfg, superpowers: false, pluginDirs: [waypoint] })).toEqual(['settings.json', 'notes@m', 'waypoint']);
    expect(foreignPromptHooks({ configDir: path.join(cfg, 'missing'), superpowers: true })).toEqual([]);
  });
  it('takes --reps <1..10> and --resume <file>, and refuses any other value (A7)', () => {
    expect(parseArgs(['--reps', '3', '--resume', 'r.jsonl'])).toEqual({ dry: false, keep: false, only: null, config: null, reps: 3, resume: 'r.jsonl' });
    for (const bad of [['--reps'], ['--reps', '0'], ['--reps', '11'], ['--reps', 'x'], ['--reps', '1.5'], ['--resume'], ['--resume', '--keep']])
      expect(parseArgs(bad), bad.join(' ')).toHaveProperty('error');
  });
  it('tells a provider error from a valid trial: error_max_turns is a valid one (A7)', () => {
    const e = (o: Partial<Parameters<typeof providerError>[0]>) => providerError({ spawnError: null, stop: 'success', isError: false, apiStatus: null, ...o });
    expect(e({ spawnError: 'spawnSync claude ETIMEDOUT', stop: null })).toBe('timeout');
    expect(e({ spawnError: 'spawnSync claude ENOENT', stop: null })).toBe('spawn');
    expect(e({ stop: null, isError: null })).toBe('no-result');
    expect(e({ isError: true, apiStatus: 401 })).toBe('auth');
    expect(e({ isError: true, apiStatus: 403 })).toBe('auth');
    expect(e({ isError: true, apiStatus: 529 })).toBe('api');
    expect(e({ stop: 'error_during_execution', isError: true })).toBe('api');
    expect(e({ stop: 'error_max_turns', isError: true })).toBeNull();
    expect(e({})).toBeNull();
  });
  it('resumes by key: a valid trial is done, a provider error or a missing hook runs again, a broken line is skipped, more reps add only the new ones (A7)', () => {
    const prompts = [{ id: 'm1', size: 'medium', lang: 'en', expected: 'route', text: 'x' }, { id: 't1', size: 'trivial', lang: 'en', expected: 'none', text: 'y' }] as EvalPrompt[];
    const rows = [row('with-superpowers', 'm1', 1), row('with-superpowers', 't1', 1, { provider: 'api' }), row('without-superpowers', 'm1', 1, { hookRan: false }),
      row('no-hint', 'm1', 1, { hookRan: false })];
    const done = readTrials([JSON.stringify(rows[0]), '{"id": "m1", "con', ...rows.slice(1).map(r => JSON.stringify(r)), ''].join('\n'));
    expect(done).toEqual(rows);
    const keys = (reps: number) => pending(prompts, CONFIGS, reps, done).map(t => trialKey({ config: t.config.name, id: t.prompt.id, rep: t.rep }));
    expect(keys(1)).toEqual(['with-superpowers/t1/1', 'without-superpowers/m1/1', 'without-superpowers/t1/1', 'no-hint/t1/1']);
    expect(keys(2)).toEqual(['with-superpowers/m1/2', 'with-superpowers/t1/1', 'with-superpowers/t1/2', 'without-superpowers/m1/1', 'without-superpowers/m1/2',
      'without-superpowers/t1/1', 'without-superpowers/t1/2', 'no-hint/m1/2', 'no-hint/t1/1', 'no-hint/t1/2']);
    expect(readTrials('')).toEqual([]);
    expect(trialKey({ config: 'no-hint', id: 'a' })).toBe('no-hint/a/1');
    // A pass killed while writing leaves a cut last line: the next trial still gets its own line.
    const file = path.join(tmp('route-eval-append-'), 'r.jsonl');
    writeFileSync(file, `${JSON.stringify(rows[0])}\n{"id": "m1", "con`);
    appendTrial(file, rows[1]);
    expect(readTrials(readFileSync(file, 'utf8'))).toEqual([rows[0], rows[1]]);
  });
  it('stops on a refused login, on three provider errors in a row and on a configuration whose hook did not run (A7)', () => {
    const t = (o: Partial<EvalResult> = {}) => row('with-superpowers', 'm1', 1, o);
    expect(stopReason([t()])).toBeNull();
    expect(stopReason([t({ provider: 'auth' })])).toMatch(/credentials/);
    expect(stopReason([t({ provider: 'api' }), t({ provider: 'timeout' })])).toBeNull();
    expect(stopReason([t({ provider: 'api' }), t({ provider: 'timeout' }), t({ provider: 'api' })])).toMatch(/three provider errors in a row/);
    expect(stopReason([t({ provider: 'api' }), t(), t({ provider: 'api' }), t({ provider: 'api' })])).toBeNull();
    expect(stopReason([t({ hookRan: false })])).toMatch(/UserPromptSubmit hook did not run in with-superpowers/);
    expect(stopReason([row('no-hint', 'm1', 1, { hookRan: false })])).toBeNull();
    // A session the provider failed ran no hook either: that is a provider error, not a missing hook.
    expect(stopReason([t({ provider: 'timeout', hookRan: false })])).toBeNull();
    expect(summarize([t({ provider: 'timeout', hookRan: false })])[0]).toMatchObject({ providerErrors: 1, hookMissing: 0 });
  });
  it('wilson: the 95 % interval of a rate, clamped and rounded to four decimals (A7)', () => {
    expect(wilson(8, 8)).toEqual({ low: 0.6756, high: 1 });
    expect(wilson(5, 10)).toEqual({ low: 0.2366, high: 0.7634 });
    expect(wilson(0, 4)).toEqual({ low: 0, high: 0.4899 });
    expect(wilson(0, 0)).toBeNull();
  });
  it('summarizes the last valid trial of each key, with Wilson, and counts provider errors and missing hooks apart (A7)', () => {
    const rows = [row('with-superpowers', 'm1', 1), row('with-superpowers', 'm1', 2, { firstSkill: null }),
      row('with-superpowers', 'm2', 1, { provider: 'api', firstSkill: null, cost: 0.002, error: 'exit 1: success' }), row('with-superpowers', 'm2', 1),
      row('with-superpowers', 'm3', 1, { hookRan: false, firstSkill: null })];
    const [s] = summarize(rows);
    expect(s).toMatchObject({ routed: 2, routable: 3, falseNegatives: 1, providerErrors: 1, hookMissing: 1, ci: { low: 0.2077, high: 0.9385 }, cost: 0.042 });
    const out = table(rows, [s]).split('\n');
    expect(out).toContain('| m2 | medium | en | route |  | with-superpowers | 1 | — | $0.0020 | api | exit 1: success |');
    expect(out).toContain('| m3 | medium | en | route |  | with-superpowers | 1 | — | $0.0100 | no hook |  |');
    const head = out.find(l => l.startsWith('| config |'))!.split('|').map(c => c.trim());
    const cells = out.find(l => l.startsWith('| with-superpowers |'))!.split('|').map(c => c.trim());
    expect([cells[head.indexOf('Wilson 95 %')], cells[head.indexOf('provider errors')], cells[head.indexOf('no hook')]]).toEqual(['21–94 %', '1', '1']);
  });
  it('a --dry-run prints one command per pending session: --reps multiplies them, --resume leaves out what is done (A7)', () => {
    const dry = (...extra: string[]) => spawnSync(process.execPath, ['scripts/route-eval/run.mjs', '--dry-run', ...extra], { encoding: 'utf8', timeout: 60000 });
    const cmds = (r: ReturnType<typeof dry>) => r.stdout.trim().split(/\r?\n/).filter(l => /^(FORGE_ROUTE_HINT=off )?claude /.test(l));
    expect(cmds(dry('--only', 'm-es-1', '--reps', '2'))).toHaveLength(6);
    const file = path.join(tmp('route-eval-resume-'), 'r.jsonl');
    writeFileSync(file, JSON.stringify({ ...row('with-superpowers', 'm-es-1', 1), lang: 'es' }) + '\n');
    expect(cmds(dry('--only', 'm-es-1', '--resume', file))).toHaveLength(2);
    for (const bad of [['--resume', path.join(path.dirname(file), 'missing.jsonl')], ['--reps', '0'], ['--reps', 'x']]) {
      const r = dry(...bad);
      expect(r.status, bad.join(' ')).toBe(2);
      expect(r.stdout, bad.join(' ')).toBe('');
    }
    expect(readFileSync(file, 'utf8').split('\n').filter(Boolean)).toHaveLength(1);
  });
  it('resets the demo shop before each session: its first commit, and nothing else on disk but .claude/ (M2)', () => {
    const repo = tmp('route-eval-reset-');
    const { reset } = demoRepo(repo);
    const g = (...a: string[]) => execFileSync('git', a, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const first = g('rev-parse', 'HEAD').trim();
    const read = (rel: string) => readFileSync(path.join(repo, rel), 'utf8').replace(/\r\n/g, '\n');
    expect(read('src/cart.js')).toBe(DEMO_SHOP['src/cart.js']);
    // A session renamed withTax, committed it, left forge's state and a note, and the configuration wrote its settings.
    writeFileSync(path.join(repo, 'src', 'cart.js'), 'export const totalWithTax = 1;\n');
    g('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qam', 'rename');
    writeFileSync(path.join(repo, 'src', 'index.js'), 'changed\n');
    mkdirSync(path.join(repo, '.forge', 'work', 's'), { recursive: true });
    writeFileSync(path.join(repo, '.forge', 'work', 's', 'task.txt'), 'x\n');
    writeFileSync(path.join(repo, 'notes.md'), 'x\n');
    mkdirSync(path.join(repo, '.claude'));
    writeFileSync(path.join(repo, '.claude', 'settings.local.json'), '{}\n');
    reset();
    expect(g('rev-parse', 'HEAD').trim()).toBe(first);
    expect(read('src/cart.js')).toBe(DEMO_SHOP['src/cart.js']);
    expect(read('src/index.js')).toBe(DEMO_SHOP['src/index.js']);
    expect([existsSync(path.join(repo, '.forge')), existsSync(path.join(repo, 'notes.md'))]).toEqual([false, false]);
    expect(g('status', '--porcelain', '-uall', '--ignored', '--', '.', ':!.claude').trim()).toBe('');
    expect(existsSync(path.join(repo, '.claude', 'settings.local.json'))).toBe(true);
  });
  it('a reset never reaches a repository above the work folder, even when a session deleted the shop\'s .git (residual 5)', () => {
    const outer = tmp('route-eval-outer-');
    const g = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    g(outer, 'init', '-q');
    writeFileSync(path.join(outer, 'junk.txt'), 'the person\'s\n');
    const repo = path.join(outer, 'work', 'shop');
    const { reset } = demoRepo(repo);
    rmSync(path.join(repo, '.git'), { recursive: true, force: true });
    writeFileSync(path.join(repo, 'left.txt'), 'x\n');
    expect(() => reset()).toThrow(/not a git repository/);
    expect([existsSync(path.join(outer, 'junk.txt')), existsSync(path.join(repo, 'left.txt'))]).toEqual([true, true]);
  });
  it('has 20 prompts: Medium and Large expect forge:route, Small either, the rest none; 4 competing ones push against it (K1-02, I1, A7)', () => {
    const prompts = JSON.parse(readFileSync(new URL('../scripts/route-eval/prompts.json', import.meta.url), 'utf8')) as EvalPrompt[];
    expect(prompts).toHaveLength(20);
    const plain = prompts.filter(p => !p.competing);
    const competing = prompts.filter(p => p.competing);
    const count = (size: string, lang?: string) => plain.filter(p => p.size === size && (!lang || p.lang === lang)).length;
    expect([count('medium', 'es'), count('medium', 'en'), count('large', 'es'), count('large', 'en')]).toEqual([2, 2, 2, 2]);
    expect([count('trivial'), count('small'), count('question'), count('agent')]).toEqual([2, 2, 2, 2]);
    for (const p of plain) expect(p.expected, p.id).toBe(p.size === 'medium' || p.size === 'large' ? 'route' : p.size === 'small' ? 'either' : 'none');
    expect(plain.every(p => !/forge|superpowers/i.test(p.text))).toBe(true);
    expect(competing.map(p => [p.id, p.size, p.lang, p.competing, p.expected])).toEqual([
      ['c-m-es', 'medium', 'es', 'direct', 'route'], ['c-m-en', 'medium', 'en', 'brainstorming', 'route'],
      ['c-l-es', 'large', 'es', 'brainstorming', 'route'], ['c-l-en', 'large', 'en', 'direct', 'route'],
    ]);
    for (const p of competing) {
      if (p.competing === 'direct') expect(p.text, p.id).toMatch(/(?:directamente, sin planes|directly, no plans)/i);
      else expect(p.text, p.id).toContain('superpowers:brainstorming');
      if (p.competing === 'direct') expect(/forge|superpowers/i.test(p.text), p.id).toBe(false);
    }
    expect(prompts.filter(p => p.size === 'agent').every(p => /^<[a-z]/i.test(p.text))).toBe(true);
    expect(new Set(prompts.map(p => p.id)).size).toBe(prompts.length);
  });
  it('--dry-run prints one claude command per prompt and configuration, --config picks one, and no-hint turns the hint off (K1-02)', () => {
    const dry = (...extra: string[]) => spawnSync(process.execPath, ['scripts/route-eval/run.mjs', '--dry-run', ...extra], { encoding: 'utf8', timeout: 60000 });
    const all = dry();
    expect(all.status, all.stderr).toBe(0);
    expect(all.stdout.trim().split(/\r?\n/).filter(l => /^(FORGE_ROUTE_HINT=off )?claude /.test(l))).toHaveLength(60);
    const noHint = dry('--config', 'no-hint').stdout.trim().split(/\r?\n/).filter(l => l.includes('claude '));
    expect(noHint).toHaveLength(20);
    expect(noHint.every(l => l.startsWith('FORGE_ROUTE_HINT=off claude '))).toBe(true);
    expect(dry('--config', 'nope').status).toBe(2);
    expect(dry('--only', 'nope').status).toBe(2);
    expect(dry('--only', 'm-es-1').stdout.trim().split(/\r?\n/)).toHaveLength(3);
    // M1: a mistyped flag or a flag without its value stops before any work (here behind a --dry-run, so nothing is paid).
    for (const bad of [['--dryrun'], ['--only'], ['--config'], ['--only', '--keep'], ['-n']]) {
      const r = dry(...bad);
      expect(r.status, bad.join(' ')).toBe(2);
      expect(r.stdout, bad.join(' ')).toBe('');
    }
  });
  it('a --dry-run creates nothing on disk: no work folder under the temp root', () => {
    const temp = tmp('route-eval-tmproot-');
    const env = { ...process.env, TMPDIR: temp, TMP: temp, TEMP: temp };
    const r = spawnSync(process.execPath, ['scripts/route-eval/run.mjs', '--dry-run'], { encoding: 'utf8', timeout: 60000, env });
    expect(r.status, r.stderr).toBe(0);
    expect(readdirSync(temp)).toEqual([]);
  });
  it("forge's own triage agrees with what each prompt expects in the demo shop: Medium and Large route, Trivial and Small step aside (K1-02)", () => {
    const repo = tmp('route-eval-shop-');
    const cfg = tmp('route-eval-shop-cfg-');
    demoRepo(repo);
    const io: Io = { cwd: repo, now: () => new Date('2026-10-15T10:00:00.000Z'), env: { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: 'sess-0' } };
    const prompts = JSON.parse(readFileSync(new URL('../scripts/route-eval/prompts.json', import.meta.url), 'utf8')) as EvalPrompt[];
    const paths: Record<string, string> = {};
    for (const p of prompts.filter(p => ['trivial', 'small', 'medium', 'large'].includes(p.size))) {
      writeFileSync(path.join(repo, 'req.txt'), p.text + '\n');
      paths[p.id] = JSON.parse(run(['route', '--task', 't1', '--text-file', 'req.txt'], io).stdout).probe.path;
    }
    const wrong = Object.entries(paths).filter(([id, got]) => {
      const want = prompts.find(p => p.id === id)!.expected === 'route' ? ['medium', 'large'] : ['trivial', 'small'];
      return !want.includes(got);
    });
    expect(wrong).toEqual([]);
  });
});
