import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { claudeConfigDir, locateSuperpowers, spPlans, spSkillPath, spSpecs } from '../src/forge/superpowers.js';
import { run, type Io } from '../src/forge/cli/run.js';

let cfg: string;
let project: string;
const mk = (dir: string) => { mkdirSync(dir, { recursive: true }); return dir; };
const install = (version: string, extra: object = {}) => {
  const p = mk(path.join(cfg, 'plugins', 'cache', 'claude-plugins-official', 'superpowers', version));
  mk(path.join(p, 'skills', 'test-driven-development'));
  writeFileSync(path.join(p, 'skills', 'test-driven-development', 'SKILL.md'), '# tdd\n');
  return { scope: 'user', installPath: p, version, ...extra };
};
const registry = (plugins: Record<string, unknown>) => {
  mk(path.join(cfg, 'plugins'));
  writeFileSync(path.join(cfg, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins }));
};
beforeEach(() => {
  cfg = mkdtempSync(path.join(tmpdir(), 'sp-cfg-'));
  project = mkdtempSync(path.join(tmpdir(), 'sp-proj-'));
});

describe('locateSuperpowers', () => {
  it('finds the highest installed version and its skills', () => {
    registry({ 'superpowers@claude-plugins-official': [install('6.3.0'), install('6.4.1')], 'other@claude-plugins-official': [{ scope: 'user', installPath: cfg, version: '9.9.9' }] });
    const sp = locateSuperpowers({ configDir: cfg, projectDir: project });
    expect(sp).toMatchObject({ installed: true, version: '6.4.1' });
    expect(spSkillPath(sp, 'test-driven-development')).toBe(path.join(sp.installPath!, 'skills', 'test-driven-development', 'SKILL.md'));
    expect(spSkillPath(sp, 'brainstorming')).toBeNull();
    expect(spSkillPath(sp, '../x')).toBeNull();
  });
  it('is not installed when turned off, installed for another project, gone, or with an unreadable registry', () => {
    registry({ 'superpowers@m': [install('6.4.1')] });
    writeFileSync(path.join(cfg, 'settings.json'), JSON.stringify({ enabledPlugins: { 'superpowers@m': false } }));
    expect(locateSuperpowers({ configDir: cfg, projectDir: project }).installed).toBe(false);
    // The project's own settings win over the user's.
    mk(path.join(project, '.claude'));
    writeFileSync(path.join(project, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'superpowers@m': true } }));
    expect(locateSuperpowers({ configDir: cfg, projectDir: project }).installed).toBe(true);
    registry({ 'superpowers@m': [install('6.4.1', { scope: 'project', projectPath: path.join(tmpdir(), 'another-project') })] });
    expect(locateSuperpowers({ configDir: cfg, projectDir: project }).installed).toBe(false);
    registry({ 'superpowers@m': [install('6.4.1', { scope: 'project', projectPath: project })] });
    expect(locateSuperpowers({ configDir: cfg, projectDir: project }).installed).toBe(true);
    registry({ 'superpowers@m': [{ scope: 'user', installPath: path.join(cfg, 'gone'), version: '6.4.1' }] });
    expect(locateSuperpowers({ configDir: cfg, projectDir: project }).installed).toBe(false);
    writeFileSync(path.join(cfg, 'plugins', 'installed_plugins.json'), 'garbage');
    expect(locateSuperpowers({ configDir: cfg, projectDir: project })).toEqual({ installed: false, version: null, installPath: null });
    expect(locateSuperpowers({ configDir: path.join(cfg, 'missing'), projectDir: project }).installed).toBe(false);
  });
  it('reads CLAUDE_CONFIG_DIR, else ~/.claude', () => {
    expect(claudeConfigDir({ CLAUDE_CONFIG_DIR: cfg })).toBe(cfg);
    expect(claudeConfigDir({})).toMatch(/\.claude$/);
  });
});

describe('sp-specs and sp-plans', () => {
  const NOW = Date.parse('2026-10-13T10:00:00.000Z');
  const DAY = 24 * 3600_000;
  const file = (rel: string, text: string, daysAgo: number) => {
    const f = path.join(project, rel);
    mk(path.dirname(f));
    writeFileSync(f, text);
    const t = new Date(NOW - daysAgo * DAY);
    utimesSync(f, t, t);
  };
  it('lists the recent specs no design imported, newest first, at most 3', () => {
    for (const [n, d] of [['a', 1], ['b', 2], ['c', 3], ['d', 4], ['old', 20]] as const) file(`docs/superpowers/specs/${n}.md`, `# Spec ${n} — design\n\n## A\n`, d);
    file('docs/waypoint/shop/design.md', '---\ntitle: S\nproject: shop\nsummary: s\nsource: docs/superpowers/specs/a.md\n---\n\n## X\n', 0);
    expect(spSpecs(project, NOW)).toEqual(['b', 'c', 'd'].map((n, i) => ({ path: `docs/superpowers/specs/${n}.md`, title: `Spec ${n}`, modified: new Date(NOW - (i + 2) * DAY).toISOString() })));
    expect(spSpecs(mkdtempSync(path.join(tmpdir(), 'sp-none-')), NOW)).toEqual([]);
  });
  it('lists the recent plans with tasks left, with their counts', () => {
    const plan = (box: string) => `# P Implementation Plan\n\n### Task 1: one\n\n- [x] a\n\n### Task 2: two\n\n- [${box}] b\n`;
    file('docs/superpowers/plans/open.md', plan(' '), 1);
    file('docs/superpowers/plans/done.md', plan('x'), 1);
    file('docs/superpowers/plans/broken.md', '# no tasks\n', 1);
    file('docs/superpowers/plans/old.md', plan(' '), 30);
    expect(spPlans(project, NOW)).toEqual([{ path: 'docs/superpowers/plans/open.md', title: 'P', tasks: 2, done: 1 }]);
  });
  it('the CLI prints them, and sp-path finds a skill through CLAUDE_CONFIG_DIR', () => {
    registry({ 'superpowers@m': [install('6.4.1')] });
    file('docs/superpowers/specs/s.md', '# S\n\n## A\n', 1);
    const io: Io = { cwd: project, now: () => new Date(NOW), env: { CLAUDE_CONFIG_DIR: cfg } };
    expect(JSON.parse(run(['sp-specs'], io).stdout)).toHaveLength(1);
    expect(JSON.parse(run(['sp-plans'], io).stdout)).toEqual([]);
    expect(JSON.parse(run(['sp-path', 'test-driven-development'], io).stdout)).toMatch(/test-driven-development[\\/]SKILL\.md$/);
    expect(JSON.parse(run(['sp-path', 'nope'], io).stdout)).toBeNull();
    expect(run(['sp-path'], io).code).toBe(2);
    expect(JSON.parse(run(['sp-path', 'test-driven-development'], { ...io, env: { CLAUDE_CONFIG_DIR: path.join(cfg, 'none') } }).stdout)).toBeNull();
  });
});
