import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { checkTools, mcpInventory, toolGaps, toolKeys } from '../src/forge/tools.js';
import { run, type Io } from '../src/forge/cli/run.js';
import { readLocal } from '../src/forge/local.js';
import { surfaceHash } from '../src/forge/surfaces.js';
import { tmpdir } from 'node:os';
import { useTempDirs } from './helpers/tmp.js';
const tmp = useTempDirs();

const exec = (out: string, code = 0) => () => ({ code, output: out, ms: 1, timedOut: false });

describe('checkTools', () => {
  it('found on PATH or in the MCP inventory; missing only for a known program or a path; unknown otherwise', () => {
    const r = checkTools(['node', 'flutter', './gradlew', 'nope', 'chrome-mcp', 'chrome-devtools'], { onPath: n => n === 'node', exec: exec(''), inventory: new Set(['chrome-devtools']) });
    expect(r).toEqual({ tools: { node: 'found', flutter: 'missing', './gradlew': 'missing', nope: 'unknown', 'chrome-mcp': 'unknown', 'chrome-devtools': 'found' } });
    // Without an inventory nothing is an MCP server.
    expect(checkTools(['chrome-devtools'], { onPath: () => false, exec: exec('') }).tools).toEqual({ 'chrome-devtools': 'unknown' });
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
  it('toolGaps splits what is not found into missing and unknown', () => {
    expect(toolGaps(['adb', 'chrome-mcp', 'node', 'chrome-devtools-mcp', 'Docker', 'C:\\tools\\x.exe'], { onPath: n => n === 'node', inventory: new Set(['chrome-devtools']) }))
      .toEqual({ missing: ['adb', 'Docker', 'C:\\tools\\x.exe'], unknown: ['chrome-mcp'] });
  });
});

describe('toolKeys', () => {
  it('lowercases and drops @marketplace, a trailing -mcp/_mcp and a leading mcp-', () => {
    for (const n of ['chrome-devtools', 'chrome-devtools-mcp', 'chrome-devtools-mcp@claude-plugins-official', 'Chrome-DevTools', 'mcp-chrome-devtools', 'chrome-devtools_mcp']) {
      expect(toolKeys(n)).toEqual(['chrome-devtools']);
    }
  });
  it('a plugin tool prefix counts as the plugin and as the server, an MCP tool prefix as the server', () => {
    expect(toolKeys('mcp__plugin_devkit_browser')).toEqual(['devkit', 'browser']);
    expect(toolKeys('mcp__plugin_chrome-devtools-mcp_chrome-devtools')).toEqual(['chrome-devtools']);
    expect(toolKeys('mcp__plugin_devkit_browser__click')).toEqual(['devkit', 'browser']);
    expect(toolKeys('mcp__pencil')).toEqual(['pencil']);
    expect(toolKeys('mcp__pencil__open_document')).toEqual(['pencil']);
  });
});

describe('mcpInventory', () => {
  let cfg: string; let home: string; let project: string;
  const mk = (dir: string) => { mkdirSync(dir, { recursive: true }); return dir; };
  const json = (file: string, v: unknown) => { mk(path.dirname(file)); writeFileSync(file, typeof v === 'string' ? v : JSON.stringify(v)); };
  // A plugin in the cache with its manifest and its .mcp.json (either may be left out).
  const plugin = (name: string, files: { manifest?: unknown; mcp?: unknown; other?: [string, unknown] } = {}) => {
    const p = mk(path.join(cfg, 'plugins', 'cache', 'm', name, '1.0.0'));
    if (files.manifest !== undefined) json(path.join(p, '.claude-plugin', 'plugin.json'), files.manifest);
    if (files.mcp !== undefined) json(path.join(p, '.mcp.json'), files.mcp);
    if (files.other) json(path.join(p, files.other[0]), files.other[1]);
    return { scope: 'user', installPath: p, version: '1.0.0' };
  };
  const registry = (plugins: Record<string, unknown>) => json(path.join(cfg, 'plugins', 'installed_plugins.json'), { version: 2, plugins });
  const inv = () => mcpInventory({ configDir: cfg, homeDir: home, projectDir: project });
  const fwd = (p: string) => path.resolve(p).replace(/\\/g, '/');
  beforeEach(() => {
    cfg = tmp('mcp-cfg-');
    home = tmp('mcp-home-');
    project = tmp('mcp-proj-');
  });
  it('enabled plugins give their name and their servers, from plugin.json and .mcp.json', () => {
    registry({
      'chrome-devtools-mcp@claude-plugins-official': [plugin('chrome-devtools-mcp', { manifest: { name: 'chrome-devtools-mcp', mcpServers: { 'chrome-devtools': { command: 'npx', env: { TOKEN: 'secret-1' } } } } })],
      'tools@m': [plugin('tools', { mcp: { mcpServers: { figma_mcp: { url: 'https://x' } } } })],
      'flat@m': [plugin('flat', { mcp: { context7: { command: 'npx' } } })],
      'byfile@m': [plugin('byfile', { manifest: { name: 'byfile', mcpServers: './servers.json' }, other: ['servers.json', { mcpServers: { linear: {} } }] })],
      'off@m': [plugin('off', { mcp: { mcpServers: { offserver: {} } } })],
      'elsewhere@m': [{ ...plugin('elsewhere', { mcp: { mcpServers: { faraway: {} } } }), scope: 'project', projectPath: path.join(tmpdir(), 'another-project') }],
    });
    json(path.join(cfg, 'settings.json'), { enabledPlugins: { 'off@m': false } });
    const s = inv();
    for (const n of ['chrome-devtools', 'tools', 'figma', 'flat', 'context7', 'byfile', 'linear']) expect(s.has(n), n).toBe(true);
    for (const n of ['off', 'offserver', 'elsewhere', 'faraway']) expect(s.has(n), n).toBe(false);
    // Only the names are read, never the values.
    expect([...s].join(' ')).not.toMatch(/secret|npx|https/);
  });
  it('.claude.json: the user servers and this project\'s; the project\'s .mcp.json servers the person approved and did not turn off', () => {
    json(path.join(home, '.claude.json'), {
      mcpServers: { stitch: { headers: { Authorization: 'Bearer secret-2' } } },
      projects: {
        [fwd(project)]: { mcpServers: { pencil: {} }, enabledMcpjsonServers: ['figma-mcp', 'off-server'], disabledMcpjsonServers: ['off-server'] },
        'Z:/other': { mcpServers: { faraway: {} }, enableAllProjectMcpServers: true },
      },
    });
    json(path.join(project, '.mcp.json'), { mcpServers: { 'figma-mcp': {}, 'off-server': {}, pending: {} } });
    expect([...inv()].sort()).toEqual(['figma', 'pencil', 'stitch']);
  });
  it('approving every project server comes from this machine\'s settings, never from the shared project settings', () => {
    json(path.join(project, '.mcp.json'), { mcpServers: { linear: {}, pending: {} } });
    // .claude/settings.json is in git: a commit could set it.
    json(path.join(project, '.claude', 'settings.json'), { enableAllProjectMcpServers: true, enabledMcpjsonServers: ['linear'] });
    expect(inv().size).toBe(0);
    json(path.join(project, '.claude', 'settings.local.json'), { enabledMcpjsonServers: ['linear'] });
    expect([...inv()]).toEqual(['linear']);
    json(path.join(cfg, 'settings.json'), { enableAllProjectMcpServers: true });
    expect([...inv()].sort()).toEqual(['linear', 'pending']);
    json(path.join(home, '.claude.json'), { projects: { [fwd(project)]: { disabledMcpjsonServers: ['pending'] } } });
    expect([...inv()]).toEqual(['linear']);
  });
  it('reads the legacy .config.json of the config dir first, as Claude Code does', () => {
    json(path.join(home, '.claude.json'), { mcpServers: { fromhome: {} } });
    json(path.join(cfg, '.config.json'), { mcpServers: { legacy: {} } });
    expect([...inv()]).toEqual(['legacy']);
  });
  it('fail-open: missing or malformed files give what can be read, or nothing', () => {
    expect(inv().size).toBe(0);
    json(path.join(cfg, 'plugins', 'installed_plugins.json'), 'garbage');
    json(path.join(home, '.claude.json'), '{ not json');
    json(path.join(project, '.mcp.json'), { mcpServers: { ok: {} } });
    json(path.join(project, '.claude', 'settings.local.json'), { enableAllProjectMcpServers: true });
    expect([...inv()]).toEqual(['ok']);
    json(path.join(project, '.mcp.json'), { mcpServers: ['not', 'a', 'map'] });
    expect(inv().size).toBe(0);
  });
});

describe('forge local', () => {
  let root: string; let io: Io;
  beforeEach(() => { root = tmp('forge-localcli-'); io = { cwd: root, now: () => new Date('2026-10-12T10:00:00Z') }; });
  it('set and get a surface permission tied to its content, in .forge/local.yaml; none removes it', () => {
    mkdirSync(path.join(root, '.forge', 'verify'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'verify', 'web.md'), '# Web\nRun it.\n');
    expect(run(['local', 'set', 'surfaces.web', 'allowed'], io).code).toBe(0);
    expect(JSON.parse(run(['local', 'get', 'surfaces.web'], io).stdout)).toMatchObject({ state: 'allowed', hash: surfaceHash('# Web\nRun it.\n') });
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
    const cfg = tmp('forge-tools-cfg-');
    io = { ...io, env: { CLAUDE_CONFIG_DIR: cfg } };
    mkdirSync(path.join(root, '.forge', 'verify'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'verify', 'web.md'), '---\ntools: [chrome-mcp]\n---\n');
    writeFileSync(path.join(root, '.forge', 'verify', 'app.md'), '---\ntools: [definitely-not-a-tool-xyz, ./definitely-not-a-tool-xyz]\n---\n');
    expect(JSON.parse(run(['tools'], io).stdout).tools).toEqual({ 'chrome-mcp': 'unknown', 'definitely-not-a-tool-xyz': 'unknown', './definitely-not-a-tool-xyz': 'missing' });
    expect(JSON.parse(run(['tools', '--surface', 'web'], io).stdout).tools).toEqual({ 'chrome-mcp': 'unknown' });
    expect(run(['tools', '--surface', 'nope'], io).code).toBe(2);
    expect(JSON.parse(run(['tools'], io).stdout)).not.toHaveProperty('warning');
  });
  it('tools --cwd reads the surfaces of that directory', () => {
    const other = tmp('forge-tools-other-');
    io = { ...io, env: { CLAUDE_CONFIG_DIR: tmp('forge-tools-cfg-') } };
    mkdirSync(path.join(root, '.forge', 'verify'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'verify', 'web.md'), '---\ntools: [chrome-mcp]\n---\n');
    mkdirSync(path.join(other, '.forge', 'verify'), { recursive: true });
    writeFileSync(path.join(other, '.forge', 'verify', 'app.md'), '---\ntools: [xcrun-not-here]\n---\n');
    expect(JSON.parse(run(['tools', '--cwd', other], io).stdout).tools).toEqual({ 'xcrun-not-here': 'unknown' });
    expect(run(['tools', '--cwd', other, '--surface', 'web'], io).code).toBe(2);
  });
  it('tools finds an MCP server of an installed plugin through CLAUDE_CONFIG_DIR, and .claude.json inside it', () => {
    const cfg = tmp('forge-tools-cfg-');
    const p = path.join(cfg, 'plugins', 'cache', 'claude-plugins-official', 'chrome-devtools-mcp', '1.0.0');
    mkdirSync(path.join(p, '.claude-plugin'), { recursive: true });
    writeFileSync(path.join(p, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'chrome-devtools-mcp', mcpServers: { 'chrome-devtools': { command: 'npx' } } }));
    writeFileSync(path.join(cfg, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'chrome-devtools-mcp@claude-plugins-official': [{ scope: 'user', installPath: p, version: '1.0.0' }] } }));
    writeFileSync(path.join(cfg, '.claude.json'), JSON.stringify({ mcpServers: { stitch: {} } }));
    mkdirSync(path.join(root, '.forge', 'verify'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'verify', 'web.md'), '---\ntools: [chrome-devtools, stitch-mcp, claude-in-chrome]\n---\n');
    expect(JSON.parse(run(['tools'], { ...io, env: { CLAUDE_CONFIG_DIR: cfg } }).stdout).tools).toEqual({ 'chrome-devtools': 'found', 'stitch-mcp': 'found', 'claude-in-chrome': 'unknown' });
  });
});
