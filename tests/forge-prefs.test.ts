import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolvePrefs } from '../src/forge/prefs.js';
import { run, type Io } from '../src/forge/cli/run.js';

describe('resolvePrefs', () => {
  it('takes the request, then local.yaml, then config.yaml, then ask, and says where each came from', () => {
    expect(resolvePrefs({}, {}, {})).toEqual({ workflow: 'ask', autonomy: 'ask', sources: { workflow: 'default', autonomy: 'default' } });
    expect(resolvePrefs({}, {}, { workflow: 'forge', autonomy: 'auto' })).toEqual({ workflow: 'forge', autonomy: 'auto', sources: { workflow: 'config', autonomy: 'config' } });
    expect(resolvePrefs({}, { workflow: 'superpowers' }, { workflow: 'forge' })).toMatchObject({ workflow: 'superpowers', sources: { workflow: 'local' } });
    expect(resolvePrefs({ autonomy: 'ask' }, { autonomy: 'auto' }, { autonomy: 'auto' })).toMatchObject({ autonomy: 'ask', sources: { autonomy: 'request' } });
  });
});

describe('forge prefs and local set', () => {
  let root: string;
  let io: Io;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'forge-prefs-'));
    io ={ cwd: root, now: () => new Date('2026-10-13T10:00:00.000Z') };
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
  it('refuses bad values, and a broken config.yaml', () => {
    expect(run(['local', 'set', 'workflow', 'maybe'], io).code).toBe(2);
    expect(run(['local', 'set', 'autonomy', 'always'], io).code).toBe(2);
    expect(run(['prefs', '--workflow', 'maybe'], io).code).toBe(2);
    mkdirSync(path.join(root, '.forge'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'config.yaml'), 'workflow: maybe\n');
    expect(run(['prefs'], io).code).toBe(2);
  });
});
