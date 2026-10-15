import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseConfig, loadConfig, configValue, agentFor, ROLES, ConfigError, NAME } from '../src/forge/config.js';
import { selectValidators } from '../src/forge/validators.js';
import { run, type Io } from '../src/forge/cli/run.js';

describe('forge config', () => {
  it('defaults: detect on, nothing excluded, verify limits, evidence upload', () => {
    expect(parseConfig(null)).toEqual({
      profile: 'balanced', detect: true, exclude: [], verify: { limits: { checks: 8, shots: 10, minutes: 10 } },
      evidence: 'upload', validatorTimeoutSec: 600, swarm: { parallel: 3, launcher: 'bg', member: { effort: 'medium' } }, tdd: 'off',
      generated: [],
    });
  });
  it('generated: a list of globs, empty by default, strings only', () => {
    expect(parseConfig(null).generated).toEqual([]);
    expect(parseConfig('profile: economy\n').generated).toEqual([]);
    expect(parseConfig('generated:\n  - plugins/*/dist/**\n  - gen.txt\n').generated).toEqual(['plugins/*/dist/**', 'gen.txt']);
    expect(configValue(parseConfig('generated: [gen.txt]\n'), 'generated')).toEqual(['gen.txt']);
    expect(() => parseConfig('generated: [3]\n')).toThrow(ConfigError);
    expect(() => parseConfig('generated: [""]\n')).toThrow(ConfigError);
    expect(() => parseConfig('generated: gen.txt\n')).toThrow(ConfigError);
  });
  it('workflow and autonomy: optional, and one of their values', () => {
    expect(parseConfig(null)).not.toHaveProperty('workflow');
    expect(parseConfig('workflow: superpowers-design\nautonomy: auto\n')).toMatchObject({ workflow: 'superpowers-design', autonomy: 'auto' });
    expect(() => parseConfig('workflow: maybe\n')).toThrow(ConfigError);
    expect(() => parseConfig('autonomy: always\n')).toThrow(ConfigError);
  });
  it('tdd: off by default, or superpowers', () => {
    expect(parseConfig(null).tdd).toBe('off');
    expect(parseConfig('tdd: superpowers\n').tdd).toBe('superpowers');
    expect(() => parseConfig('tdd: always\n')).toThrow(ConfigError);
  });
  it('swarm: parallel 3 by default, an optional mode and the launcher', () => {
    expect(parseConfig(null).swarm).toEqual({ parallel: 3, launcher: 'bg', member: { effort: 'medium' } });
    expect(parseConfig('swarm:\n  mode: sessions\n  parallel: 2\n').swarm).toEqual({ parallel: 2, mode: 'sessions', launcher: 'bg', member: { effort: 'medium' } });
    expect(() => parseConfig('swarm:\n  mode: threads\n')).toThrow(ConfigError);
    expect(() => parseConfig('swarm:\n  launcher: tmux\n')).toThrow(ConfigError);
  });
  it('swarm.member: effort medium by default, one of the closed list; model optional, one of the launch models', () => {
    expect(parseConfig('swarm:\n  parallel: 2\n').swarm.member).toEqual({ effort: 'medium' });
    expect(parseConfig('swarm:\n  member: {}\n').swarm.member).toEqual({ effort: 'medium' });
    for (const effort of ['low', 'medium', 'high', 'xhigh', 'max']) expect(parseConfig(`swarm:\n  member:\n    effort: ${effort}\n`).swarm.member.effort).toBe(effort);
    expect(parseConfig('swarm:\n  member:\n    effort: high\n    model: sonnet\n').swarm.member).toEqual({ effort: 'high', model: 'sonnet' });
    expect(() => parseConfig('swarm:\n  member:\n    effort: extreme\n')).toThrow(ConfigError);
    expect(() => parseConfig('swarm:\n  member:\n    model: gpt\n')).toThrow(ConfigError);
    expect(() => parseConfig('swarm:\n  member:\n    turns: 3\n')).toThrow(ConfigError);
  });
  it('swarm.setup: an optional command of at most 500 characters', () => {
    expect(parseConfig('swarm:\n  setup: uv sync\n').swarm).toEqual({ parallel: 3, launcher: 'bg', member: { effort: 'medium' }, setup: 'uv sync' });
    expect(() => parseConfig(`swarm:\n  setup: ${'x'.repeat(501)}\n`)).toThrow(ConfigError);
    expect(() => parseConfig('swarm:\n  setup: ""\n')).toThrow(ConfigError);
    expect(() => parseConfig('swarm:\n  setup: 3\n')).toThrow(ConfigError);
  });
  it('kind is free text with the name pattern, when is optional', () => {
    const c = parseConfig('validators:\n  - name: a11y\n    cmd: npm run a11y\n    kind: a11y\n    when: final\n');
    expect(c.validators).toEqual([{ name: 'a11y', cmd: 'npm run a11y', kind: 'a11y', when: 'final' }]);
    expect(() => parseConfig('validators:\n  - name: x\n    cmd: y\n    kind: "has space"\n')).toThrow(ConfigError);
    expect(() => parseConfig('validators:\n  - name: x\n    cmd: y\n    when: sometimes\n')).toThrow(/when/);
  });
  it('detect, exclude, evidence and verify.limits', () => {
    const c = parseConfig('detect: false\nexclude: [build]\nevidence: local\nverify:\n  limits: { checks: 3 }\n');
    expect(c).toMatchObject({ detect: false, exclude: ['build'], evidence: 'local', verify: { limits: { checks: 3, shots: 10, minutes: 10 } } });
    expect(() => parseConfig('verify:\n  limits: { checks: 21 }\n')).toThrow(/checks/);
    expect(() => parseConfig('verify:\n  limits: { shots: 31 }\n')).toThrow(/shots/);
    expect(() => parseConfig('verify:\n  limits: { minutes: 61 }\n')).toThrow(/minutes/);
    expect(() => parseConfig('evidence: cloud\n')).toThrow(/evidence/);
    expect(() => parseConfig('verify:\n  surfaces: []\n')).toThrow(ConfigError); // surfaces live in .forge/verify/, not here
  });
  it('the verify role follows the profile', () => {
    expect(ROLES).toContain('verify');
    expect(agentFor('verify', 'balanced')).toBe('forge-verify');
    expect(agentFor('verify', 'economy')).toBe('forge-verify');
    expect(agentFor('verify', 'quality')).toBe('forge-verify-heavy');
  });
  it('the review-final role is forge-review-final in every profile', () => {
    expect(ROLES).toContain('review-final');
    for (const p of ['balanced', 'economy', 'quality'] as const) expect(agentFor('review-final', p)).toBe('forge-review-final');
  });
  it('each profile resolves the five-rung implementer ladder as the design says', () => {
    expect(ROLES).toContain('impl-high');
    const ladder = ['mech', 'impl-light', 'impl', 'impl-high', 'impl-heavy'] as const;
    const map = (profile: 'balanced' | 'economy' | 'quality') => ladder.map(r => agentFor(r, profile));
    expect(map('balanced')).toEqual(['forge-mech', 'forge-impl-light', 'forge-impl', 'forge-impl-high', 'forge-impl-heavy']);
    expect(map('economy')).toEqual(['forge-mech', 'forge-impl-light', 'forge-impl-light', 'forge-impl', 'forge-impl-high']);
    expect(map('quality')).toEqual(['forge-impl-light', 'forge-impl', 'forge-impl-heavy', 'forge-impl-heavy', 'forge-impl-heavy']);
  });
  it('FORGE agents lists impl-high for the configured profile', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'forge-agents-'));
    expect(JSON.parse(run(['agents'], { cwd: root, now: () => new Date() }).stdout).agents['impl-high']).toBe('forge-impl-high');
    mkdirSync(path.join(root, '.forge'));
    writeFileSync(path.join(root, '.forge', 'config.yaml'), 'profile: economy\n');
    expect(JSON.parse(run(['agents'], { cwd: root, now: () => new Date() }).stdout).agents).toMatchObject({ 'impl-high': 'forge-impl', 'impl-heavy': 'forge-impl-high' });
  });
  it('NAME is the shared name pattern', () => {
    expect(NAME.test('test:e2e')).toBe(true);
    expect(NAME.test('a b')).toBe(false);
  });
  it('configValue reads a key or a dotted path, defaults applied; undefined for an unknown one', () => {
    expect(configValue(parseConfig(null), 'evidence')).toBe('upload');
    expect(configValue(parseConfig('swarm:\n  parallel: 2\n'), 'swarm.parallel')).toBe(2);
    expect(configValue(parseConfig(null), 'nope')).toBeUndefined();
    expect(configValue(parseConfig(null), 'evidence.x')).toBeUndefined();
  });
});

describe('forge config get', () => {
  let root: string;
  let io: Io;
  const git = (...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const writeConfig = (text: string) => { mkdirSync(path.join(root, '.forge'), { recursive: true }); writeFileSync(path.join(root, '.forge', 'config.yaml'), text); };
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'forge-config-'));
    io = { cwd: root, now: () => new Date('2026-10-11T10:00:00.000Z') };
  });
  it('prints evidence upload with no file, and local once the person creates it mid-run', () => {
    expect(run(['config', 'get', 'evidence'], io)).toEqual({ code: 0, stdout: 'upload\n', stderr: '' });
    writeConfig('evidence: local\n');
    expect(run(['config', 'get', 'evidence'], io).stdout).toBe('local\n');
    expect(JSON.parse(run(['config', 'get', 'verify.limits'], io).stdout)).toEqual({ checks: 8, shots: 10, minutes: 10 });
  });
  it('an invalid config or an unknown key exits 2', () => {
    writeConfig('evidence: cloud\n');
    const r = run(['config', 'get', 'evidence'], io);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('evidence');
    writeConfig('evidence: local\n');
    expect(run(['config', 'get', 'nope'], io).code).toBe(2);
    expect(run(['config', 'get'], io).code).toBe(2);
  });
  it('--cwd into a worktree still reads the config of the main checkout', () => {
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
    writeFileSync(path.join(root, 'a.txt'), 'a\n');
    git('add', '.'); git('commit', '-q', '-m', 'init');
    const wt = path.join(root, 'wt');
    git('worktree', 'add', '-q', '-b', 'side', wt);
    writeConfig('evidence: local\n');
    expect(run(['config', 'get', 'evidence', '--cwd', wt], io).stdout).toBe('local\n');
    // From inside the worktree too: the hand-made untracked config exists only in the main checkout.
    expect(run(['config', 'get', 'evidence'], { ...io, cwd: wt }).stdout).toBe('local\n');
  });
});

describe('this repo validates its mods (I-02)', () => {
  const repo = fileURLToPath(new URL('..', import.meta.url));
  const manual = () => (loadConfig(repo).validators ?? []).map(v => ({ ...v, kind: v.kind ?? 'other', source: 'manual' as const }));
  it('declares typecheck-mod and mod-tests, with the mod paths in affects', () => {
    const tm = manual().find(v => v.name === 'typecheck-mod');
    const mt = manual().find(v => v.name === 'mod-tests');
    expect(tm).toMatchObject({ cmd: 'npm run typecheck:mod', kind: 'typecheck' });
    expect(mt).toMatchObject({ cmd: 'npm run build && claude plugin test plugins/lens && claude plugin test plugins/waypoint', kind: 'e2e' });
    for (const v of [tm!, mt!]) for (const g of ['src/mod/**', 'src/lens/**', 'src/lib/**', 'types/claude-code/**']) expect(v.affects).toContain(g);
    expect(JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8')).scripts['typecheck:mod']).toBe('tsc -p tsconfig.mod.json');
  });
  it('mod-tests runs in a Medium or Large review only when the diff touches a mod, and always in the final review', () => {
    const names = (changed: string[]) => selectValidators(manual(), { mode: 'heavy', changed }).map(v => v.name);
    expect(names(['src/lens/term.tsx'])).toContain('mod-tests');
    expect(names(['src/page/app.ts'])).not.toContain('mod-tests');
    expect(names(['src/page/app.ts'])).toContain('typecheck-mod');
    expect(selectValidators(manual(), { mode: 'final' }).map(v => v.name)).toContain('mod-tests');
  });
});
