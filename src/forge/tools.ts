// What this machine has for the surfaces' tools: a program on PATH, or an MCP server Claude Code is configured with
// (mcpInventory). A tool found in neither is missing when it is a program forge knows or a path, and unknown otherwise:
// some servers cannot be seen from config files (claude-in-chrome, claude.ai connectors), so the session resolves them.
// adb also lists the devices that are ready (`device` state).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ExecResult } from './cli/run.js';
import { installedPlugins } from './superpowers.js';

export type ToolState = 'found' | 'missing' | 'unknown';
export interface ToolsReport { tools: Record<string, ToolState>; adb?: { devices: string[] } }
export interface ToolDeps { onPath: (n: string) => boolean; inventory?: ReadonlySet<string> }

// Programs a surface names that are never MCP servers: not finding one is a real miss.
const KNOWN_BINARIES = new Set(['adb', 'xcrun', 'xcodebuild', 'emulator', 'flutter', 'node', 'npx', 'npm', 'pnpm', 'yarn', 'bun', 'java', 'gradle',
  'docker', 'playwright', 'chromium', 'google-chrome', 'python', 'python3', 'curl', 'git']);

const unMcp = (n: string) => n.replace(/^mcp[-_]/, '').replace(/[-_]mcp$/, '');

/**
 * The names a tool or an MCP server matches by: lowercase, without `@<marketplace>`, a trailing -mcp/_mcp or a leading
 * mcp-. A tool name of a plugin's server, `mcp__plugin_<plugin>_<server>[__<tool>]`, gives both the plugin and the
 * server; `mcp__<server>[__<tool>]` gives the server.
 */
export function toolKeys(name: string): string[] {
  const n = name.trim().toLowerCase().replace(/(.)@[^@]*$/, '$1');
  const plugin = /^mcp__plugin_([^_]+)_(.+?)(?:__.*)?$/.exec(n);
  const server = plugin ? null : /^mcp__(.+?)(?:__.*)?$/.exec(n);
  const keys = plugin ? [plugin[1], plugin[2]] : server ? [server[1]] : [n];
  return [...new Set(keys.map(unMcp).filter(Boolean))];
}

export function toolState(name: string, deps: ToolDeps): ToolState {
  if (deps.onPath(name) || toolKeys(name).some(k => deps.inventory?.has(k))) return 'found';
  const bin = name.trim().toLowerCase().replace(/\.(exe|cmd|bat)$/, '');
  return /[\\/]/.test(name) || KNOWN_BINARIES.has(bin) ? 'missing' : 'unknown';
}

export function checkTools(names: string[], deps: ToolDeps & { exec: (cmd: string, timeoutSec: number) => ExecResult }): ToolsReport {
  const tools: ToolsReport['tools'] = {};
  for (const n of [...new Set(names)]) tools[n] = toolState(n, deps);
  const report: ToolsReport = { tools };
  if (tools.adb === 'found') {
    const r = deps.exec('adb devices', 5);
    report.adb = { devices: r.code === 0 && !r.timedOut ? r.output.split(/\r?\n/).map(l => l.trim().split(/\s+/)).filter(p => p.length === 2 && p[1] === 'device').map(p => p[0]) : [] };
  }
  return report;
}

/** The tools of a surface that were not found: missing (a known program or a path) and unknown (anything else). */
export function toolGaps(names: string[], deps: ToolDeps): { missing: string[]; unknown: string[] } {
  const out = { missing: [] as string[], unknown: [] as string[] };
  for (const n of [...new Set(names)]) {
    const s = toolState(n, deps);
    if (s !== 'found') out[s].push(n);
  }
  return out;
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const readJson = (file: string): unknown => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };
// The server names of an MCP config: the keys of its mcpServers, or (`flat`, as some plugins write theirs) its own keys.
const serverNames = (x: unknown, flat: boolean): string[] => (!isObj(x) ? [] : isObj(x.mcpServers) ? Object.keys(x.mcpServers) : flat && !('mcpServers' in x) ? Object.keys(x) : []);

// The servers a plugin declares: plugin.json `mcpServers` (inline, a file of the plugin, or a list of these) and its .mcp.json.
function pluginServers(root: string): string[] {
  const out: string[] = [];
  const fromFile = (rel: string) => {
    const f = path.resolve(root, rel.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, '.'));
    const r = path.relative(root, f);
    if (!r.startsWith('..') && !path.isAbsolute(r)) out.push(...serverNames(readJson(f), true));
  };
  const manifest = readJson(path.join(root, '.claude-plugin', 'plugin.json'));
  const decl = isObj(manifest) ? manifest.mcpServers : undefined;
  for (const d of Array.isArray(decl) ? decl : [decl]) {
    if (typeof d === 'string') fromFile(d);
    else out.push(...serverNames(d, true));
  }
  fromFile('.mcp.json');
  return out;
}

const strs = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []);

/**
 * The MCP servers Claude Code is configured with for this project, as toolKeys: the enabled plugins (their names and the
 * servers they declare), .claude.json (the user's servers and this project's, keyed by its path with forward slashes;
 * the legacy `<configDir>/.config.json` first when it exists, as Claude Code does) and the project's .mcp.json minus the
 * servers the project turned off (disabledMcpjsonServers). `homeDir` is where .claude.json lives (claudeJsonDir).
 * Only names are read, never the values (they can hold tokens). Fail-open: an unreadable file adds nothing.
 */
export function mcpInventory(opts: { configDir: string; homeDir: string; projectDir: string }): Set<string> {
  const names: string[] = [];
  for (const p of installedPlugins(opts)) {
    names.push(p.name);
    try { names.push(...pluginServers(p.installPath)); } catch { /* unreadable plugin */ }
  }
  const legacy = path.join(opts.configDir, '.config.json');
  const global = readJson(existsSync(legacy) ? legacy : path.join(opts.homeDir, '.claude.json'));
  const disabled = new Set<string>();
  if (isObj(global)) {
    names.push(...serverNames(global, false));
    const key = path.resolve(opts.projectDir).replace(/\\/g, '/');
    const same = (k: string) => (process.platform === 'win32' ? k.replace(/\\/g, '/').toLowerCase() === key.toLowerCase() : k === key);
    const projects = isObj(global.projects) ? global.projects : {};
    for (const [k, v] of Object.entries(projects)) {
      if (!same(k) || !isObj(v)) continue;
      names.push(...serverNames(v, false));
      for (const d of strs(v.disabledMcpjsonServers)) disabled.add(d);
    }
  }
  for (const f of [path.join(opts.projectDir, '.claude', 'settings.local.json'), path.join(opts.projectDir, '.claude', 'settings.json')]) {
    const s = readJson(f);
    if (isObj(s)) for (const d of strs(s.disabledMcpjsonServers)) disabled.add(d);
  }
  names.push(...serverNames(readJson(path.join(opts.projectDir, '.mcp.json')), false).filter(n => !disabled.has(n)));
  return new Set(names.flatMap(toolKeys));
}
