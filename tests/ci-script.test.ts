import { describe, it, expect } from 'vitest';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { SKIP_MOD_TYPES, ciSteps, generatedPaths } from '../scripts/ci.mjs';
import { tagCommands } from '../scripts/tag-plugins.mjs';
import { useTempDirs } from './helpers/tmp.js';

const tmp = useTempDirs();
const repo = fileURLToPath(new URL('..', import.meta.url));
const read = (p: string) => readFileSync(path.join(repo, p), 'utf8');
const ci = (env: Record<string, string>, ...args: string[]) =>
  spawnSync(process.execPath, [path.join(repo, 'scripts', 'ci.mjs'), '--dry-run', ...args], { encoding: 'utf8', env: { ...process.env, CI: '', ...env } });
/** A checkout with this repository's .forge/config.yaml and no engine types, as CI has it. */
const bare = () => {
  const root = tmp('ci-');
  mkdirSync(path.join(root, '.forge'));
  copyFileSync(path.join(repo, '.forge', 'config.yaml'), path.join(root, '.forge', 'config.yaml'));
  return root;
};

describe('npm run ci (I-05)', () => {
  it('--dry-run prints the 7 steps in order; the build is checked against the generated paths of .forge/config.yaml', () => {
    const r = ci({});
    expect(r.status).toBe(0);
    const lines = r.stdout.trim().split(/\r?\n/);
    expect(lines.map(l => /^ci: \d+\/7 ([a-z:-]+): /.exec(l)?.[1])).toEqual(['typecheck', 'typecheck:mod', 'test', 'build', 'claude', 'validate', 'plugin-test']);
    const gen = generatedPaths(repo);
    expect(gen.length).toBeGreaterThan(0);
    expect(gen).toEqual(parse(read('.forge/config.yaml')).generated);
    for (const g of gen) expect(lines[3]).toContain(g);
    expect(lines[5]).toContain('claude plugin validate .');
    for (const p of ['waypoint', 'lens', 'forge']) expect(lines[5]).toContain(`claude plugin validate plugins/${p}`);
    expect(lines[6]).toBe('ci: 7/7 plugin-test: claude plugin test plugins/lens && claude plugin test plugins/waypoint');
  });
  it('in CI, without the engine types (never in git), typecheck:mod is skipped with its warning, and npm audit runs after the tests', () => {
    const root = bare();
    const r = ci({ CI: 'true' }, '--root', root);
    expect(r.status).toBe(0);
    const lines = r.stdout.trim().split(/\r?\n/);
    expect(SKIP_MOD_TYPES).toBe('typecheck:mod skipped: engine types missing (not versioned)');
    expect(lines[1]).toBe(`ci: 2/8 typecheck:mod: skipped (${SKIP_MOD_TYPES})`);
    expect(lines[3]).toBe('ci: 4/8 audit: npm audit --audit-level=high');
    // Locally the same checkout runs typecheck:mod (and fails, saying how to get the types) and no audit.
    expect(ciSteps(root, {}).find(s => s.id === 'typecheck:mod')?.skip).toBeUndefined();
    expect(ciSteps(root, {}).some(s => s.id === 'audit')).toBe(false);
  });
  it('.github/workflows/ci.yml runs npm run ci on Ubuntu and Windows, after npm ci, with Node 22 and Claude Code pinned', () => {
    const job = parse(read('.github/workflows/ci.yml')).jobs.ci;
    expect(job.strategy.matrix.os).toEqual(['ubuntu-latest', 'windows-latest']);
    expect(job['runs-on']).toBe('${{ matrix.os }}');
    const steps = job.steps as { run?: string; uses?: string; with?: Record<string, unknown> }[];
    expect(steps.map(s => s.uses).filter(Boolean)).toEqual(['actions/checkout@v4', 'actions/setup-node@v4']);
    expect(steps.find(s => s.uses === 'actions/setup-node@v4')?.with?.['node-version']).toBe(22);
    const cmds = steps.map(s => s.run).filter((x): x is string => !!x);
    expect(cmds.indexOf('npm ci')).toBeGreaterThan(-1);
    expect(cmds.indexOf('npm ci')).toBeLessThan(cmds.indexOf('npm run ci'));
    expect(cmds.some(c => /^npm install -g @anthropic-ai\/claude-code@\d+\.\d+\.\d+$/.test(c))).toBe(true);
    expect(cmds.some(c => /core\.longpaths true/.test(c))).toBe(true);
  });
  it('.github/workflows/ci.yml runs npm run ci with TEMP, TMP and TMPDIR at the runner temp dir (Windows gives an 8.3 TEMP)', () => {
    const steps = parse(read('.github/workflows/ci.yml')).jobs.ci.steps as { run?: string; env?: Record<string, string> }[];
    const env = steps.find(s => s.run === 'npm run ci')?.env ?? {};
    for (const k of ['TEMP', 'TMP', 'TMPDIR']) expect(env[k], k).toBe('${{ runner.temp }}');
  });
  it('.github/workflows/ci.yml loads the forge and waypoint bundles on Node 20, the minimum the plugins promise', () => {
    const job = parse(read('.github/workflows/ci.yml')).jobs.node20;
    const steps = job.steps as { run?: string; uses?: string; with?: Record<string, unknown> }[];
    expect(steps.find(s => s.uses === 'actions/setup-node@v4')?.with?.['node-version']).toBe(20);
    const cmds = steps.map(s => s.run ?? '').join('\n');
    expect(cmds).toContain('node plugins/forge/dist/forge.cjs');
    expect(cmds).toContain('node plugins/waypoint/dist/waypoint.cjs');
  });
  it('package.json runs it as npm run ci', () => {
    expect(JSON.parse(read('package.json')).scripts.ci).toBe('node scripts/ci.mjs');
  });
});

describe('tag-plugins (C8, I-05)', () => {
  it('shows by default, tags with --apply, and never pushes', () => {
    expect(tagCommands(['waypoint', 'forge'])).toEqual({ cmds: [
      ['plugin', 'tag', 'plugins/waypoint', '-m', 'waypoint %s', '--dry-run'],
      ['plugin', 'tag', 'plugins/forge', '-m', 'forge %s', '--dry-run'],
    ] });
    expect(tagCommands(['lens', '--apply'])).toEqual({ cmds: [['plugin', 'tag', 'plugins/lens', '-m', 'lens %s']] });
    for (const bad of [['--push', 'waypoint'], ['waypoint', '--remote', 'origin'], ['nope'], []]) expect(tagCommands(bad), bad.join(' ')).toHaveProperty('error');
    const r = spawnSync(process.execPath, [path.join(repo, 'scripts', 'tag-plugins.mjs'), 'waypoint', '--push'], { encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('never pushes');
  });
});
