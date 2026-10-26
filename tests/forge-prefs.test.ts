import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { resolvePrefs } from '../src/forge/prefs.js';
import { run, type Io } from '../src/forge/cli/run.js';
import { useTempDirs } from './helpers/tmp.js';
const tmp = useTempDirs();

describe('resolvePrefs', () => {
  it('takes the request, then local.yaml, then config.yaml, then ask, and says where each came from', () => {
    expect(resolvePrefs({}, {}, {}, {})).toEqual({ workflow: 'ask', autonomy: 'ask', sources: { workflow: 'default', autonomy: 'default' } });
    expect(resolvePrefs({}, {}, { workflow: 'forge', autonomy: 'auto' }, {})).toEqual({ workflow: 'forge', autonomy: 'auto', sources: { workflow: 'config', autonomy: 'config' } });
    expect(resolvePrefs({}, { workflow: 'superpowers' }, { workflow: 'forge' }, {})).toMatchObject({ workflow: 'superpowers', sources: { workflow: 'local' } });
    expect(resolvePrefs({ autonomy: 'ask' }, { autonomy: 'auto' }, { autonomy: 'auto' }, {})).toMatchObject({ autonomy: 'ask', sources: { autonomy: 'request' } });
  });
  it('FORGE_WORKFLOW is the person\'s default for every project, below the request, local.yaml and config.yaml (w8 FR1)', () => {
    const env = { FORGE_WORKFLOW: 'off' };
    expect(resolvePrefs({}, {}, {}, env)).toEqual({ workflow: 'off', autonomy: 'ask', sources: { workflow: 'env', autonomy: 'default' } });
    expect(resolvePrefs({}, {}, { workflow: 'forge' }, env)).toMatchObject({ workflow: 'forge', sources: { workflow: 'config' } });
    expect(resolvePrefs({}, { workflow: 'superpowers-plan' }, { workflow: 'forge' }, env)).toMatchObject({ workflow: 'superpowers-plan', sources: { workflow: 'local' } });
    expect(resolvePrefs({ workflow: 'forge' }, { workflow: 'superpowers' }, { workflow: 'off' }, env)).toMatchObject({ workflow: 'forge', sources: { workflow: 'request' } });
    for (const w of ['forge', 'superpowers', 'superpowers-design', 'superpowers-plan', 'off', 'ask']) {
      expect(resolvePrefs({}, {}, {}, { FORGE_WORKFLOW: w }), w).toMatchObject({ workflow: w, sources: { workflow: 'env' } });
    }
    // Spaces and capitals of a hand-written setting are forgiven; anything else is no workflow, and ask decides.
    expect(resolvePrefs({}, {}, {}, { FORGE_WORKFLOW: ' Forge ' })).toMatchObject({ workflow: 'forge', sources: { workflow: 'env' } });
    for (const bad of ['', 'none', 'maybe', undefined]) {
      expect(resolvePrefs({}, {}, {}, { FORGE_WORKFLOW: bad }), String(bad)).toMatchObject({ workflow: 'ask', sources: { workflow: 'default' } });
    }
    // Autonomy has no environment default.
    expect(resolvePrefs({}, {}, {}, { FORGE_WORKFLOW: 'forge', FORGE_AUTONOMY: 'auto' }).autonomy).toBe('ask');
  });
});

describe('forge prefs and local set', () => {
  let root: string;
  let io: Io;
  beforeEach(() => {
    root = tmp('forge-prefs-');
    io = { cwd: root, now: () => new Date('2026-10-13T10:00:00.000Z') };
  });
  it('prints the resolved preferences and their sources', () => {
    mkdirSync(path.join(root, '.forge'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'config.yaml'), 'workflow: forge\n');
    expect(JSON.parse(run(['prefs'], io).stdout)).toEqual({ workflow: 'forge', autonomy: 'ask', sources: { workflow: 'config', autonomy: 'default' } });
    expect(run(['local', 'set', 'workflow', 'superpowers-plan'], io).code).toBe(0);
    expect(run(['local', 'set', 'autonomy', 'auto'], io).code).toBe(0);
    expect(JSON.parse(run(['prefs'], io).stdout)).toMatchObject({ workflow: 'superpowers-plan', autonomy: 'auto', sources: { workflow: 'local', autonomy: 'local' } });
    expect(JSON.parse(run(['prefs', '--autonomy', 'ask'], io).stdout)).toMatchObject({ autonomy: 'ask', sources: { autonomy: 'request' } });
    expect(run(['local', 'set', 'workflow', 'none'], io).code).toBe(0);
    expect(JSON.parse(run(['prefs'], io).stdout)).toMatchObject({ workflow: 'forge', sources: { workflow: 'config' } });
  });
  it('saves «sin forge» as workflow: off, in local.yaml and in config.yaml', () => {
    expect(run(['local', 'set', 'workflow', 'off'], io).code).toBe(0);
    expect(JSON.parse(run(['prefs'], io).stdout)).toMatchObject({ workflow: 'off', sources: { workflow: 'local' } });
    expect(readFileSync(path.join(root, '.forge', 'local.yaml'), 'utf8')).toMatch(/^workflow: off$/m);
    writeFileSync(path.join(root, '.forge', 'config.yaml'), 'workflow: off\n');
    expect(run(['local', 'set', 'workflow', 'none'], io).code).toBe(0);
    expect(JSON.parse(run(['prefs'], io).stdout)).toMatchObject({ workflow: 'off', sources: { workflow: 'config' } });
  });
  it('forge prefs, begin and the route probe read FORGE_WORKFLOW from the environment, under the project\'s files (w8 FR1)', () => {
    const env = { FORGE_WORKFLOW: 'superpowers-design', CLAUDE_CONFIG_DIR: tmp('forge-prefs-cfg-') };
    expect(JSON.parse(run(['prefs'], { ...io, env }).stdout)).toEqual({ workflow: 'superpowers-design', autonomy: 'ask', sources: { workflow: 'env', autonomy: 'default' } });
    expect(JSON.parse(run(['prefs'], { ...io, env: {} }).stdout)).toMatchObject({ workflow: 'ask', sources: { workflow: 'default' } });
    mkdirSync(path.join(root, '.forge', 'work', 't1'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'work', 't1', 'task.txt'), 'Add coupon support to the cart with validation\n');
    const probe = JSON.parse(run(['route', '--task', 't1', '--text-file', '.forge/work/t1/task.txt'], { ...io, env, git: () => null }).stdout);
    expect(probe).toMatchObject({ workflow: 'superpowers-design', sources: { workflow: 'env' } });
    execFileSync('git', ['init', '-q'], { cwd: root });
    expect(JSON.parse(run(['begin', '--task', 'b1'], { ...io, env: { FORGE_WORKFLOW: 'forge' } }).stdout)).toMatchObject({ workflow: 'forge' });
    writeFileSync(path.join(root, '.forge', 'config.yaml'), 'workflow: off\n');
    expect(JSON.parse(run(['prefs'], { ...io, env }).stdout)).toMatchObject({ workflow: 'off', sources: { workflow: 'config' } });
  });
  it('forge prefs says when FORGE_WORKFLOW is not a workflow and which ones are (fix round 1)', () => {
    const r = run(['prefs'], { ...io, env: { FORGE_WORKFLOW: 'of' } });
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out).toMatchObject({ workflow: 'ask', sources: { workflow: 'default' } });
    expect(out.warning).toBe('FORGE_WORKFLOW="of" is not a workflow, so it is ignored; it can be ask, forge, superpowers, superpowers-design, superpowers-plan or off');
    expect(r.stderr).toBe(`forge: ${out.warning}\n`);
    // Also when the project's files decide: the setting is still wrong.
    mkdirSync(path.join(root, '.forge'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'config.yaml'), 'workflow: forge\n');
    expect(JSON.parse(run(['prefs'], { ...io, env: { FORGE_WORKFLOW: 'Superpower' } }).stdout)).toMatchObject({ workflow: 'forge', warning: expect.stringContaining('"Superpower"') });
    for (const fine of ['forge', ' OFF ', '', '  ']) expect(JSON.parse(run(['prefs'], { ...io, env: { FORGE_WORKFLOW: fine } }).stdout), JSON.stringify(fine)).not.toHaveProperty('warning');
    expect(run(['prefs'], { ...io, env: {} }).stderr).toBe('');
  });
  it('refuses bad values, and a broken config.yaml', () => {
    expect(run(['local', 'set', 'workflow', 'maybe'], io).code).toBe(2);
    expect(run(['local', 'set', 'autonomy', 'always'], io).code).toBe(2);
    expect(run(['prefs', '--workflow', 'maybe'], io).code).toBe(2);
    mkdirSync(path.join(root, '.forge'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'config.yaml'), 'workflow: maybe\n');
    expect(run(['prefs'], io).code).toBe(2);
  });
});
