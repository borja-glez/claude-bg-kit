import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseConfig, loadConfig, configValue, agentFor, ROLES, ConfigError, NAME, verifyFlow, verifyPorts } from '../src/forge/config.js';
import { selectValidators } from '../src/forge/validators.js';
import { cacheable } from '../src/forge/validate-cache.js';
import { run, type Io } from '../src/forge/cli/run.js';
import { useTempDirs } from './helpers/tmp.js';
const tmp = useTempDirs();

describe('forge config', () => {
  it('defaults: detect on, nothing excluded, verify limits, evidence upload', () => {
    expect(parseConfig(null)).toEqual({
      profile: 'balanced', detect: true, exclude: [], verify: { limits: { checks: 8, shots: 10, minutes: 10 } },
      evidence: 'upload', validatorTimeoutSec: 600, validate: { cache: true, parallel: 3, retry: 'flaky' }, review: { express: true, personDocs: ['README.md', 'README.*.md', '**/README.md', '**/README.*.md', 'CHANGELOG.md', '**/CHANGELOG.md'] }, swarm: { parallel: 3, launcher: 'bg', member: { effort: 'medium' }, validateJobs: 2 }, tdd: 'off',
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
  it('threatModel: optional; protects 1 to 10, trusted and untrusted up to 10, outOfScope up to 20, strings up to 200, notes up to 1000 (K4-02)', () => {
    expect(parseConfig(null)).not.toHaveProperty('threatModel');
    expect(parseConfig('threatModel:\n  protects: ["files outside the repo"]\n  untrusted: ["web pages"]\n').threatModel)
      .toEqual({ protects: ['files outside the repo'], trusted: [], untrusted: ['web pages'], outOfScope: [] });
    expect(parseConfig('threatModel:\n  protects: [a]\n  notes: a local tool\n').threatModel?.notes).toBe('a local tool');
    // Only outOfScope (what a skill would add to a config without a threatModel) is not a threat model: protects is required.
    for (const bad of ['threatModel:\n  outOfScope: ["Windows 8.3 short names"]\n', 'threatModel:\n  protects: []\n', `threatModel:\n  protects: ["${'x'.repeat(201)}"]\n`, 'threatModel:\n  trusted: [a]\n',
      'threatModel:\n  protects: [a]\n  owner: me\n', `threatModel:\n  protects: [a]\n  notes: "${'n'.repeat(1001)}"\n`,
      `threatModel:\n  protects: [a]\n  outOfScope: [${Array.from({ length: 21 }, (_, i) => `o${i}`).join(', ')}]\n`]) {
      expect(() => parseConfig(bad), bad).toThrow(ConfigError);
    }
  });
  it('review: express on by default and personDocs the READMEs and changelogs; both can be set (K4-09, measure 7)', () => {
    expect(parseConfig(null).review).toEqual({ express: true, personDocs: ['README.md', 'README.*.md', '**/README.md', '**/README.*.md', 'CHANGELOG.md', '**/CHANGELOG.md'] });
    expect(parseConfig('review:\n  express: false\n').review).toMatchObject({ express: false, personDocs: expect.arrayContaining(['README.md']) });
    expect(parseConfig('review:\n  personDocs: ["docs/guide/**"]\n').review.personDocs).toEqual(['docs/guide/**']);
    expect(configValue(parseConfig('review:\n  express: false\n'), 'review.express')).toBe(false);
    for (const bad of ['review:\n  express: maybe\n', 'review:\n  personDocs: README.md\n', 'review:\n  other: 1\n']) expect(() => parseConfig(bad), bad).toThrow(ConfigError);
  });
  it('validate: parallel 3 and retry flaky by default; parallel from 1 to 8; retry flaky, always or never (C-12)', () => {
    expect(parseConfig(null).validate).toEqual({ cache: true, parallel: 3, retry: 'flaky' });
    expect(parseConfig('validate:\n  parallel: 1\n  retry: always\n').validate).toEqual({ cache: true, parallel: 1, retry: 'always' });
    expect(configValue(parseConfig('validate:\n  retry: never\n'), 'validate.retry')).toBe('never');
    for (const bad of ['validate:\n  parallel: 0\n', 'validate:\n  parallel: 9\n', 'validate:\n  retry: sometimes\n', 'validate:\n  nope: 1\n']) {
      expect(() => parseConfig(bad)).toThrow(ConfigError);
    }
  });
  it('validate.cache is true by default; a validator takes an optional cache flag (C6)', () => {
    expect(parseConfig('validate:\n  cache: false\n').validate).toEqual({ cache: false, parallel: 3, retry: 'flaky' });
    expect(parseConfig('validators:\n  - name: e2e\n    cmd: npm run e2e\n    kind: e2e\n    cache: true\n').validators?.[0]).toMatchObject({ cache: true });
    expect(() => parseConfig('validators:\n  - name: e2e\n    cmd: x\n    cache: maybe\n')).toThrow(ConfigError);
  });
  it('a validator affected_cmd must hold {files}, {tests} or {packages}, in at most 500 characters (C-02)', () => {
    expect(parseConfig('validators:\n  - name: unit\n    cmd: make test\n    affected_cmd: make test-files {files}\n').validators?.[0]).toMatchObject({ affected_cmd: 'make test-files {files}' });
    expect(() => parseConfig('validators:\n  - name: unit\n    cmd: make test\n    affected_cmd: make test\n')).toThrow(ConfigError);
    expect(() => parseConfig(`validators:\n  - name: unit\n    cmd: x\n    affected_cmd: ${'x'.repeat(500)} {files}\n`)).toThrow(ConfigError);
  });
  it('swarm: parallel 3 by default, an optional mode and the launcher', () => {
    expect(parseConfig(null).swarm).toEqual({ parallel: 3, launcher: 'bg', member: { effort: 'medium' }, validateJobs: 2 });
    expect(parseConfig('swarm:\n  mode: sessions\n  parallel: 2\n').swarm).toEqual({ parallel: 2, mode: 'sessions', launcher: 'bg', member: { effort: 'medium' }, validateJobs: 2 });
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
    expect(parseConfig('swarm:\n  setup: uv sync\n').swarm).toEqual({ parallel: 3, launcher: 'bg', member: { effort: 'medium' }, validateJobs: 2, setup: 'uv sync' });
    expect(() => parseConfig(`swarm:\n  setup: ${'x'.repeat(501)}\n`)).toThrow(ConfigError);
    expect(() => parseConfig('swarm:\n  setup: ""\n')).toThrow(ConfigError);
    expect(() => parseConfig('swarm:\n  setup: 3\n')).toThrow(ConfigError);
  });
  it('swarm.validateJobs: 2 by default, an integer from 1 to 8 (C-03)', () => {
    expect(parseConfig(null).swarm.validateJobs).toBe(2);
    expect(parseConfig('swarm:\n  validateJobs: 4\n').swarm.validateJobs).toBe(4);
    for (const bad of ['0', '9', '1.5', 'many']) expect(() => parseConfig(`swarm:\n  validateJobs: ${bad}\n`)).toThrow(ConfigError);
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
    const root = tmp('forge-agents-');
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

  it('route.hint: on or off (true and false too), none by default; anything else is a config error (K1-03, Review Focus 4)', () => {
    expect(parseConfig(null).route).toBeUndefined();
    expect(parseConfig('route:\n  hint: off\n').route).toEqual({ hint: 'off' });
    expect(parseConfig('route:\n  hint: false\n').route).toEqual({ hint: 'off' });
    expect(parseConfig('route:\n  hint: true\n').route).toEqual({ hint: 'on' });
    expect(parseConfig('route: {}\n').route).toEqual({ hint: 'on' });
    expect(() => parseConfig('route:\n  hint: maybe\n')).toThrow(ConfigError);
    expect(() => parseConfig('route:\n  other: 1\n')).toThrow(ConfigError);
  });
  it('w9: commits.style is auto, conventional or plain, auto when the section is empty; anything else is a config error', () => {
    expect(parseConfig(null).commits).toBeUndefined();
    expect(parseConfig('commits:\n  style: conventional\n').commits).toEqual({ style: 'conventional' });
    expect(parseConfig('commits: {}\n').commits).toEqual({ style: 'auto' });
    expect(() => parseConfig('commits:\n  style: angular\n')).toThrow(/commits\.style/);
    expect(() => parseConfig('commits:\n  scope: none\n')).toThrow(ConfigError);
  });
});

describe('forge config get', () => {
  let root: string;
  let io: Io;
  const git = (...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const writeConfig = (text: string) => { mkdirSync(path.join(root, '.forge'), { recursive: true }); writeFileSync(path.join(root, '.forge', 'config.yaml'), text); };
  beforeEach(() => {
    root = tmp('forge-config-');
    io = { cwd: root, now: () => new Date('2026-10-11T10:00:00.000Z') };
  });
  it('prints evidence upload with no file, and local once the person creates it mid-run', () => {
    expect(run(['config', 'get', 'evidence'], io)).toEqual({ code: 0, stdout: 'upload\n', stderr: '' });
    writeConfig('evidence: local\n');
    expect(run(['config', 'get', 'evidence'], io).stdout).toBe('local\n');
    expect(JSON.parse(run(['config', 'get', 'verify.limits'], io).stdout)).toEqual({ checks: 8, shots: 10, minutes: 10 });
  });
  it('FC4: a known key without a value prints its default, or nothing, and exits 0', () => {
    for (const key of ['swarm.setup', 'swarm.mode', 'swarm.nested', 'swarm.member.model', 'workflow', 'autonomy', 'verify.ports', 'verify.flow', 'threatModel', 'validators', 'route', 'commits']) {
      expect(run(['config', 'get', key], io), key).toEqual({ code: 0, stdout: '', stderr: '' });
    }
    // A key whose section is unset has the default the section would give it.
    expect(run(['config', 'get', 'route.hint'], io)).toEqual({ code: 0, stdout: 'on\n', stderr: '' });
    expect(run(['config', 'get', 'commits.style'], io)).toEqual({ code: 0, stdout: 'auto\n', stderr: '' });
    expect(run(['config', 'get', 'threatModel.trusted'], io)).toEqual({ code: 0, stdout: '[]\n', stderr: '' });
    expect(run(['config', 'get', 'threatModel.notes'], io)).toEqual({ code: 0, stdout: '', stderr: '' });
    // Set, it prints the value; an unknown key, or one below a value, is still not a key.
    writeConfig('swarm:\n  setup: npm ci\nroute:\n  hint: off\n');
    expect(run(['config', 'get', 'swarm.setup'], io).stdout).toBe('npm ci\n');
    expect(run(['config', 'get', 'route.hint'], io).stdout).toBe('off\n');
    for (const key of ['swarm.nope', 'evidence.x', 'route.hint.x', 'threatModel.nope', 'validators.0', 'nope.x']) {
      expect(run(['config', 'get', key], io), key).toMatchObject({ code: 2, stderr: expect.stringContaining('is not a config key') });
    }
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
  it('config get threatModel is the check after editing it: exit 2 without protects, the section as JSON with it (I5)', () => {
    writeConfig('threatModel:\n  outOfScope: ["Windows 8.3 short names"]\n');
    const r = run(['config', 'get', 'threatModel'], io);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('protects');
    writeConfig('threatModel:\n  protects: ["the person\'s files and git history outside the task\'s worktree"]\n  outOfScope: ["Windows 8.3 short names"]\n');
    expect(JSON.parse(run(['config', 'get', 'threatModel'], io).stdout)).toEqual({
      protects: ["the person's files and git history outside the task's worktree"], trusted: [], untrusted: [], outOfScope: ['Windows 8.3 short names'] });
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
  it('mod-tests uses the tree cache (cache: true): its result depends only on the tree, the bundles it builds and the claude CLI', () => {
    const mt = manual().find(v => v.name === 'mod-tests')!;
    expect(mt).toMatchObject({ kind: 'e2e', cache: true });
    expect(cacheable(mt)).toBe(true);
  });
  it('typecheck-mod never uses it (cache: false): it reads types/claude-code, which git ignores and the key never sees', () => {
    const tm = manual().find(v => v.name === 'typecheck-mod')!;
    expect(tm.cache).toBe(false);
    expect(cacheable(tm)).toBe(false);
  });
});

describe('verify.ports and verify.flow (K2-07, K2-13)', () => {
  it('default to 41000-41999 and final, read what the config says, and leave the default verify block as it was', () => {
    expect(verifyPorts(parseConfig(null))).toEqual({ from: 41000, to: 41999 });
    expect(verifyFlow(parseConfig(null))).toBe('final');
    const c = parseConfig('verify:\n  ports: "47100-47109"\n  flow: phase\n');
    expect(verifyPorts(c)).toEqual({ from: 47100, to: 47109 });
    expect(verifyFlow(c)).toBe('phase');
    expect(parseConfig(null).verify).toEqual({ limits: { checks: 8, shots: 10, minutes: 10 } });
  });
  it('a range that is not two ports in order, or an unknown flow, is a config error that names it', () => {
    for (const bad of ['verify:\n  ports: "80-90"\n', 'verify:\n  ports: "42000-41000"\n', 'verify:\n  ports: 41000\n', 'verify:\n  ports: "41000-70000"\n']) {
      expect(() => parseConfig(bad), bad).toThrow(/verify\.ports/);
    }
    expect(() => parseConfig('verify:\n  flow: always\n')).toThrow(/verify\.flow/);
  });
});
