import { describe, it, expect, beforeEach } from 'vitest';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, utimesSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { claudeConfigDir, locateSuperpowers, spPlans, spSkillPath, spSpecs } from '../src/forge/superpowers.js';
import { run, type Io } from '../src/forge/cli/run.js';
import { parsePlan } from '../src/lib/plan.js';
import { tmpdir } from 'node:os';
import { useTempDirs } from './helpers/tmp.js';
const tmp = useTempDirs();

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
  cfg = tmp('sp-cfg-');
  project = tmp('sp-proj-');
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
  it('from a worktree, superpowers installed for that checkout or for its main checkout counts, as the MCP servers do (carry 2)', () => {
    const g = (...a: string[]) => execFileSync('git', a, { cwd: project, encoding: 'utf8' });
    g('init', '-q', '-b', 'main'); g('config', 'user.email', 'a@b.c'); g('config', 'user.name', 't');
    g('commit', '-q', '--allow-empty', '-m', 'init');
    const wt = path.join(project, '.claude', 'worktrees', 'run');
    g('worktree', 'add', '-q', '-b', 'forge/run-x', wt);
    const io: Io = { cwd: wt, now: () => new Date(), env: { CLAUDE_CONFIG_DIR: cfg } };
    const found = () => JSON.parse(run(['sp-path', 'test-driven-development'], io).stdout) as string | null;
    for (const projectPath of [wt, project]) {
      registry({ 'superpowers@m': [install('6.4.1', { scope: 'project', projectPath })] });
      expect(found(), projectPath).toMatch(/SKILL\.md$/);
    }
    registry({ 'superpowers@m': [install('6.4.1', { scope: 'project', projectPath: path.join(tmpdir(), 'another-project') })] });
    expect(found()).toBeNull();
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
    expect(spSpecs(tmp('sp-none-'), NOW)).toEqual([]);
  });
  it('lists the recent plans with tasks left, with their counts', () => {
    const plan = (box: string) => `# P Implementation Plan\n\n### Task 1: one\n\n- [x] a\n\n### Task 2: two\n\n- [${box}] b\n`;
    file('docs/superpowers/plans/open.md', plan(' '), 1);
    file('docs/superpowers/plans/done.md', plan('x'), 1);
    file('docs/superpowers/plans/broken.md', '# no tasks\n', 1);
    file('docs/superpowers/plans/old.md', plan(' '), 30);
    expect(spPlans(project, NOW)).toEqual([{ path: 'docs/superpowers/plans/open.md', title: 'P', tasks: 2, done: 1 }]);
    // A plan superpowers finished with its own executor (ledger lines, boxes never ticked) is not listed.
    file('.superpowers/sdd/open/progress.md', '# SDD ledger — plan: docs/superpowers/plans/open.md\n\nTask 2: complete (commits a..b, tests: x → 1/1 pass)\n', 0);
    expect(spPlans(project, NOW)).toEqual([]);
  });
  it('times a tracked file by its last commit, and leaves out declined specs', () => {
    file('docs/superpowers/specs/fresh-clone.md', '# Old spec\n\n## A\n', 0);
    file('docs/superpowers/specs/recent.md', '# Recent spec\n\n## A\n', 30);
    file('docs/superpowers/specs/declined.md', '# Declined\n\n## A\n', 1);
    // A fresh clone gives every file a new mtime: git's commit time tells the real age.
    const committedAt = (rel: string) => (rel.endsWith('fresh-clone.md') ? NOW - 20 * DAY : rel.endsWith('recent.md') ? NOW - DAY : null);
    expect(spSpecs(project, NOW, { committedAt, declined: ['docs/superpowers/specs/declined.md'] }).map(s => s.path)).toEqual(['docs/superpowers/specs/recent.md']);
  });
  it('names a spec by its first title outside code', () => {
    file('docs/superpowers/specs/s.md', '```md\n# Not this\n```\n\n# Real — design\n\n## A\n', 1);
    expect(spSpecs(project, NOW)[0].title).toBe('Real');
  });
  it('sp-specs --decline remembers a spec the user turned down', () => {
    file('docs/superpowers/specs/a.md', '# A\n\n## X\n', 1);
    const io: Io = { cwd: project, now: () => new Date(NOW), env: { CLAUDE_CONFIG_DIR: cfg } };
    expect(JSON.parse(run(['sp-specs', '--decline', 'docs/superpowers/specs/a.md'], io).stdout)).toEqual({ declined: 'docs/superpowers/specs/a.md' });
    expect(JSON.parse(run(['sp-specs'], io).stdout)).toEqual([]);
    expect(run(['sp-specs', '--decline', '../x.md'], io).code).toBe(2);
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

describe('tdd: superpowers', () => {
  const config = (text: string) => { mk(path.join(project, '.forge')); writeFileSync(path.join(project, '.forge', 'config.yaml'), text); };
  it('forge tdd gives the line only with tdd: superpowers and the TDD skill installed', () => {
    registry({ 'superpowers@m': [install('6.4.1')] });
    const io: Io = { cwd: project, now: () => new Date(), env: { CLAUDE_CONFIG_DIR: cfg } };
    expect(JSON.parse(run(['tdd'], io).stdout)).toMatchObject({ tdd: 'off', installed: true, version: '6.4.1', line: null });
    config('tdd: superpowers\n');
    const on = JSON.parse(run(['tdd'], io).stdout);
    expect(on).toMatchObject({ tdd: 'superpowers', installed: true });
    expect(on.line).toBe(`TDD: required. Read and follow \`${on.skill}\`. Report the failing run and then the passing run of the new tests.`);
    expect(JSON.parse(run(['tdd'], { ...io, env: { CLAUDE_CONFIG_DIR: path.join(cfg, 'none') } }).stdout))
      .toEqual({ tdd: 'superpowers', installed: false, version: null, skill: null, line: null });
  });
  it('a brief never fails on the TDD lookup: an invalid config leaves the line out', () => {
    registry({ 'superpowers@m': [install('6.4.1')] });
    copyFileSync(new URL('./fixtures/plan.yaml', import.meta.url), path.join(project, 'plan.yaml'));
    config('tdd: always\n');
    const io: Io = { cwd: project, now: () => new Date(), env: { CLAUDE_CONFIG_DIR: cfg } };
    const id = parsePlan(readFileSync(path.join(project, 'plan.yaml'), 'utf8')).tasks[0].id;
    const r = run(['brief', '--plan', 'plan.yaml', '--task', id], io);
    expect(r.code).toBe(0);
    expect(r.stdout).not.toContain('TDD');
    expect(run(['tdd'], io).code).toBe(2);
  });
  it('both briefs carry the line with tdd: superpowers, and none with tdd: off', () => {
    registry({ 'superpowers@m': [install('6.4.1')] });
    config('tdd: superpowers\n');
    copyFileSync(new URL('./fixtures/plan.yaml', import.meta.url), path.join(project, 'plan.yaml'));
    copyFileSync(new URL('./fixtures/sp-plan.md', import.meta.url), path.join(project, 'sp.md'));
    const io: Io = { cwd: project, now: () => new Date(), env: { CLAUDE_CONFIG_DIR: cfg } };
    const id = parsePlan(readFileSync(path.join(project, 'plan.yaml'), 'utf8')).tasks[0].id;
    expect(run(['brief', '--plan', 'plan.yaml', '--task', id], io).stdout).toMatch(/\nTDD: required\. Read and follow `.+SKILL\.md`\. Report the failing run/);
    expect(run(['brief', '--superpowers-plan', 'sp.md', '--task', '2'], io).stdout).toContain('\nTDD: required. Read and follow `');
    config('tdd: off\n');
    expect(run(['brief', '--plan', 'plan.yaml', '--task', id], io).stdout).not.toContain('TDD');
    expect(run(['brief', '--superpowers-plan', 'sp.md', '--task', '2'], io).stdout).not.toContain('TDD: required');
  });
});
