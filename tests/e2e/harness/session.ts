// A8: drives a real `claude -p` session against the scripted Messages API. Isolation, in three lines:
// the config dir and HOME are temp directories; the environment is clean of the parent session's, vitest's and the proxy's variables;
// the only address the child can reach is 127.0.0.1 (ANTHROPIC_BASE_URL), with a fictional key.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { treeKill } from '../../../scripts/tui/checks.mjs';
import { spawnSpec, type ClaudeBin } from './claude-bin.js';
import type { ScriptedServer } from './messages-server.js';
import { E2E_KEY, PLUGIN_DIRS, readHooks, type HookRecord, type Workspace } from './workspace.js';

export const E2E_MODEL = 'claude-sonnet-4-5';
export type Permissions = 'bypass' | 'deny-prompts' | 'host';

const DROPPED_PREFIXES = ['CLAUDE', 'ANTHROPIC', 'FORGE_', 'WAYPOINT_', 'VITEST'];
const DROPPED_NAMES = ['NODE_ENV', 'TEST', 'NODE_OPTIONS', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'HOME', 'USERPROFILE'];
const KEPT = 'CLAUDE_CODE_GIT_BASH_PATH';

/** The child's environment: `base` without the parent session's, vitest's, forge's and the proxy's variables (in any case:
 *  NODE_ENV=test changes Claude Code, CLAUDECODE makes it refuse to start inside another session), pointed at the server. */
export function e2eEnv(base: Record<string, string | undefined>, ws: Pick<Workspace, 'home' | 'configDir' | 'hookLog'>, serverUrl: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined) continue;
    const up = k.toUpperCase();
    if (k !== KEPT && DROPPED_PREFIXES.some(p => up.startsWith(p))) continue;
    if (DROPPED_NAMES.includes(up)) continue;
    env[k] = v;
  }
  return {
    ...env,
    ANTHROPIC_BASE_URL: serverUrl,
    ANTHROPIC_API_KEY: E2E_KEY,
    CLAUDE_CONFIG_DIR: ws.configDir,
    HOME: ws.home,
    USERPROFILE: ws.home,
    BGKIT_E2E_HOOK_LOG: ws.hookLog,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_AUTOUPDATER: '1',
    DISABLE_TELEMETRY: '1',
    DISABLE_ERROR_REPORTING: '1',
    NO_PROXY: '127.0.0.1,localhost',
  };
}

export function claudeArgs(ws: Workspace, o: { plugins: readonly string[]; permissions: Permissions; settings?: string }): string[] {
  const args = [
    '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-hook-events',
    '--session-id', ws.sessionId, '--model', E2E_MODEL, '--strict-mcp-config', '--debug-file', ws.debugFile,
  ];
  for (const dir of o.plugins) args.push('--plugin-dir', dir);
  if (o.settings) args.push('--settings', o.settings);
  // PreToolUse hooks deny even under bypassPermissions: the guard scenarios use it.
  if (o.permissions === 'bypass') args.push('--permission-mode', 'bypassPermissions', '--permission-prompts', 'none');
  else if (o.permissions === 'deny-prompts') args.push('--permission-prompts', 'none');
  else args.push('--permission-prompt-tool', 'stdio');
  return args;
}

export interface StreamLine { type: string; subtype?: string; [k: string]: unknown }
export interface ControlRequest { type: 'control_request'; request_id: string; request: { subtype: string; tool_name?: string; input?: Record<string, unknown>; [k: string]: unknown } }
export interface RunOptions {
  ws: Workspace; server: ScriptedServer; turns: readonly string[];
  plugins?: readonly string[];
  permissions?: Permissions;
  settings?: string;
  onControl?: (c: ControlRequest) => Record<string, unknown>;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}
export interface RunResult { pid: number; code: number | null; timedOut: boolean; out: StreamLine[]; stderr: string; hooks: HookRecord[]; debugTail: string }

export function userLine(text: string): string {
  return JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }) + '\n';
}

function debugTail(ws: Workspace): string {
  try {
    if (!existsSync(ws.debugFile)) return '';
    return readFileSync(ws.debugFile, 'utf8').split('\n').slice(-60).join('\n');
  } catch { return ''; }
}

/** Runs one session. It never rejects: a spawn error resolves with code null and the message in stderr. */
export function runClaude(bin: ClaudeBin, o: RunOptions): Promise<RunResult> {
  const { ws } = o;
  const permissions = o.permissions ?? (o.onControl ? 'host' : 'bypass');
  const plugins = o.plugins ?? [PLUGIN_DIRS.waypoint, PLUGIN_DIRS.forge, PLUGIN_DIRS.probe];
  const timeoutMs = o.timeoutMs ?? 120_000;
  const env = o.env ?? e2eEnv(process.env, ws, o.server.url);
  const out: StreamLine[] = [];
  let stderr = '';

  return new Promise<RunResult>(resolve => {
    const finish = (pid: number, code: number | null, timedOut: boolean) =>
      resolve({ pid, code, timedOut, out, stderr, hooks: readHooks(ws), debugTail: debugTail(ws) });

    let spec: { file: string; args: string[] };
    let child: ReturnType<typeof spawn>;
    try {
      spec = spawnSpec(bin, claudeArgs(ws, { plugins, permissions, settings: o.settings }));
      child = spawn(spec.file, spec.args, { cwd: ws.repo, env, stdio: 'pipe', windowsHide: true });
    } catch (e) {
      stderr = (e as Error).message;
      finish(0, null, false);
      return;
    }
    const pid = child.pid ?? 0;
    let timedOut = false;
    let settled = false;
    let next = 0;
    let started = false;
    let initTimer: NodeJS.Timeout | undefined;

    const write = (s: string) => { if (child.stdin && !child.stdin.destroyed && child.stdin.writable) child.stdin.write(s); };
    const sendNext = () => {
      if (next < o.turns.length) write(userLine(o.turns[next++]));
      else child.stdin?.end();
    };
    const start = () => {
      if (started) return;
      started = true;
      if (initTimer) clearTimeout(initTimer);
      sendNext();
    };
    const respond = (requestId: string, body: Record<string, unknown>) =>
      write(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response: body } }) + '\n');

    const onLine = (line: string) => {
      if (line.trim() === '') return;
      let msg: StreamLine;
      try { msg = JSON.parse(line) as StreamLine; } catch { out.push({ type: 'raw', text: line }); return; }
      out.push(msg);
      if (msg.type === 'control_response') {
        const inner = msg.response as { request_id?: string } | undefined;
        if (inner?.request_id === 'e2e-init') start();
      } else if (msg.type === 'control_request') {
        const c = msg as unknown as ControlRequest;
        if (c.request?.subtype === 'can_use_tool') {
          respond(c.request_id, o.onControl ? o.onControl(c) : { behavior: 'deny', message: 'e2e: no host answer' });
        } else {
          write(JSON.stringify({ type: 'control_response', response: { subtype: 'error', request_id: c.request_id, error: 'e2e: unsupported' } }) + '\n');
        }
      } else if (msg.type === 'result') {
        sendNext();
      }
    };

    let buf = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) { onLine(buf.slice(0, i)); buf = buf.slice(i + 1); }
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => { stderr += chunk; });
    child.stdin?.on('error', () => { /* the child is gone */ });

    const timer = setTimeout(() => {
      timedOut = true;
      const kill = treeKill(process.platform, pid);
      if (kill) spawnSync(kill.file, kill.args, { stdio: 'ignore', windowsHide: true });
      else child.kill('SIGKILL');
    }, timeoutMs);

    const done = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (initTimer) clearTimeout(initTimer);
      if (buf.trim() !== '') onLine(buf);
      finish(pid, code, timedOut);
    };
    child.on('error', e => { stderr += (stderr ? '\n' : '') + e.message; done(null); });
    child.on('close', code => done(code));

    if (o.onControl) {
      write(JSON.stringify({ type: 'control_request', request_id: 'e2e-init', request: { subtype: 'initialize' } }) + '\n');
      initTimer = setTimeout(start, 15_000);
    } else {
      start();
    }
  });
}

/** The state of a failed run, one `<name>: <value>` per line: the message of the first expect of a scenario. */
export function failureReport(r: RunResult, server: ScriptedServer): string {
  return [
    `timedOut: ${r.timedOut}`,
    `code: ${r.code}`,
    `steps: ${JSON.stringify(server.log.map(l => l.step))}`,
    `out: ${JSON.stringify(r.out.slice(-15).map(l => (l.subtype ? `${l.type}/${l.subtype}` : l.type)))}`,
    `stderr: ${r.stderr.slice(-2000)}`,
    `debugTail: ${r.debugTail}`,
  ].join('\n');
}
