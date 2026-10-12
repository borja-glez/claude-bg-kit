import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkTools, missingTools } from '../src/forge/tools.js';
import { run, type Io } from '../src/forge/cli/run.js';
import { readLocal } from '../src/forge/local.js';
import { surfaceHash } from '../src/forge/surfaces.js';

const exec = (out: string, code = 0) => () => ({ code, output: out, ms: 1, timedOut: false });

describe('checkTools', () => {
  it('found, missing, unknown for -mcp names', () => {
    const r = checkTools(['node', 'nope', 'chrome-mcp'], { onPath: n => n === 'node', exec: exec('') });
    expect(r).toEqual({ tools: { node: 'found', nope: 'missing', 'chrome-mcp': 'unknown' } });
  });
  it('adb lists its devices, ignores offline and unauthorized ones', () => {
    const out = 'List of devices attached\nemulator-5554\tdevice\nR58M\tunauthorized\nZX1\toffline\n\n';
    expect(checkTools(['adb'], { onPath: () => true, exec: exec(out) }).adb).toEqual({ devices: ['emulator-5554'] });
  });
  it('adb failing or timing out means no devices', () => {
    expect(checkTools(['adb'], { onPath: () => true, exec: exec('error', 1) }).adb).toEqual({ devices: [] });
    expect(checkTools(['adb'], { onPath: () => true, exec: () => ({ code: 1, output: '', ms: 5000, timedOut: true }) }).adb).toEqual({ devices: [] });
  });
  it('adb not on PATH is not run', () => {
    let ran = false;
    expect(checkTools(['adb'], { onPath: () => false, exec: () => { ran = true; return { code: 0, output: '', ms: 1, timedOut: false }; } })).toEqual({ tools: { adb: 'missing' } });
    expect(ran).toBe(false);
  });
  it('missingTools skips -mcp names', () => {
    expect(missingTools(['adb', 'chrome-mcp', 'node'], n => n === 'node')).toEqual(['adb']);
  });
});

describe('forge local', () => {
  let root: string; let io: Io;
  beforeEach(() => { root = mkdtempSync(path.join(tmpdir(), 'forge-localcli-')); io = { cwd: root, now: () => new Date('2026-10-12T10:00:00Z') }; });
  it('set and get a surface permission tied to its content; none removes it', () => {
    mkdirSync(path.join(root, '.forge', 'verify'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'verify', 'web.md'), '# Web\nRun it.\n');
    expect(run(['local', 'set', 'surfaces.web', 'allowed'], io).code).toBe(0);
    expect(JSON.parse(run(['local', 'get', 'surfaces.web'], io).stdout)).toEqual({ state: 'allowed', hash: surfaceHash('# Web\nRun it.\n') });
    expect(run(['local', 'set', 'surfaces.nope', 'allowed'], io).code).toBe(2); // allowing needs the file, to hash it
    expect(run(['local', 'set', 'surfaces.nope', 'denied'], io).code).toBe(0);
    expect(run(['local', 'set', 'surfaces.web', 'none'], io).code).toBe(0);
    expect(readLocal(root).surfaces).toEqual({ nope: { state: 'denied', hash: null } });
    expect(JSON.parse(run(['local', 'get'], io).stdout)).toEqual({ surfaces: { nope: { state: 'denied', hash: null } }, known: [], proposed: [] });
  });
  it('refuses other paths and values', () => {
    expect(run(['local', 'set', 'known', 'x'], io).code).toBe(2);
    expect(run(['local', 'set', 'surfaces.web', 'maybe'], io).code).toBe(2);
    expect(run(['local', 'set', 'surfaces.bad name', 'allowed'], io).code).toBe(2);
  });
  it('tools reports the tools of every surface, or of one', () => {
    mkdirSync(path.join(root, '.forge', 'verify'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'verify', 'web.md'), '---\ntools: [chrome-mcp]\n---\n');
    writeFileSync(path.join(root, '.forge', 'verify', 'app.md'), '---\ntools: [definitely-not-a-tool-xyz]\n---\n');
    expect(JSON.parse(run(['tools'], io).stdout).tools).toEqual({ 'chrome-mcp': 'unknown', 'definitely-not-a-tool-xyz': 'missing' });
    expect(JSON.parse(run(['tools', '--surface', 'web'], io).stdout).tools).toEqual({ 'chrome-mcp': 'unknown' });
    expect(run(['tools', '--surface', 'nope'], io).code).toBe(2);
  });
});
