// What this machine has for the surfaces' tools. Names ending in -mcp are MCP servers the CLI cannot see: the session
// resolves them. adb also lists the devices that are ready (`device` state).
import type { ExecResult } from './cli/run.js';

export interface ToolsReport { tools: Record<string, 'found' | 'missing' | 'unknown'>; adb?: { devices: string[] } }

export function checkTools(names: string[], deps: { onPath: (n: string) => boolean; exec: (cmd: string, timeoutSec: number) => ExecResult }): ToolsReport {
  const tools: ToolsReport['tools'] = {};
  for (const n of [...new Set(names)]) tools[n] = n.endsWith('-mcp') ? 'unknown' : deps.onPath(n) ? 'found' : 'missing';
  const report: ToolsReport = { tools };
  if (tools.adb === 'found') {
    const r = deps.exec('adb devices', 5);
    report.adb = { devices: r.code === 0 && !r.timedOut ? r.output.split(/\r?\n/).map(l => l.trim().split(/\s+/)).filter(p => p.length === 2 && p[1] === 'device').map(p => p[0]) : [] };
  }
  return report;
}

export const missingTools = (names: string[], onPath: (n: string) => boolean): string[] =>
  [...new Set(names)].filter(n => !n.endsWith('-mcp') && !onPath(n));
