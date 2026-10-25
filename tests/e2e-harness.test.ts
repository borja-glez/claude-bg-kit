import { describe, it, expect } from 'vitest';
import {
  all, hasTools, lastHas, messageBody, not, parseSse, pickStep, sseBody, startMessagesServer, toolResults, turn, userHas,
  type MessagesRequest, type Step,
} from './e2e/harness/messages-server.js';
import { announceLine, OBSERVED_WITH, parseVersion, resolveClaude, spawnSpec, type ClaudeBin } from './e2e/harness/claude-bin.js';
import { claudeArgs, e2eEnv, E2E_MODEL, failureReport, runClaude } from './e2e/harness/session.js';
import { E2E_KEY, makeWorkspace, PLUGIN_DIRS, readHooks, type Workspace } from './e2e/harness/workspace.js';
import { useTempDirs } from './helpers/tmp.js';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const req = (over: Partial<MessagesRequest> = {}): MessagesRequest => ({ model: 'm', stream: true, tools: [{ name: 'Read' }], messages: [{ role: 'user', content: [{ type: 'text', text: 'E2E-X go' }] }], ...over });

describe('the scripted Messages API (A8)', () => {
  it('sseBody streams a text reply: message_start, one text block, message_delta with end_turn, message_stop', () => {
    const ev = parseSse(sseBody([{ type: 'text', text: 'hi' }], 'm', 'msg_1'));
    expect(ev.map(e => e.event)).toEqual(['message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop']);
    expect(ev.every(e => e.data.type === e.event)).toBe(true);
    expect(ev[0].data.message).toMatchObject({ id: 'msg_1', role: 'assistant', model: 'm', content: [], stop_reason: null });
    expect(ev[2].data).toMatchObject({ index: 0, delta: { type: 'text_delta', text: 'hi' } });
    expect(ev[4].data.delta).toEqual({ stop_reason: 'end_turn', stop_sequence: null });
  });
  it('a tool_use block starts with an empty input, sends it whole as one input_json_delta and stops with tool_use', () => {
    const input = { file_path: 'C:\\r\\a b.txt', n: 1 };
    const ev = parseSse(sseBody([{ type: 'tool_use', id: 'toolu_1', name: 'Read', input }], 'm', 'msg_2'));
    expect(ev[1].data.content_block).toEqual({ type: 'tool_use', id: 'toolu_1', name: 'Read', input: {} });
    expect(ev[2].data.delta.type).toBe('input_json_delta');
    expect(JSON.parse(ev[2].data.delta.partial_json)).toEqual(input);
    expect(ev[4].data.delta.stop_reason).toBe('tool_use');
    expect(messageBody([{ type: 'tool_use', id: 'toolu_1', name: 'Read', input }], 'm', 'msg_3'))
      .toMatchObject({ id: 'msg_3', type: 'message', role: 'assistant', content: [{ type: 'tool_use', input }], stop_reason: 'tool_use' });
  });
  it('the predicates: userHas reads every user message and tool_result text, lastHas the last user message, turn counts assistant messages, hasTools needs a tool', () => {
    const r = req({ messages: [
      { role: 'user', content: 'E2E-X go' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { p: 'E2E-IN-INPUT' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'file says E2E-Y' }] }] },
    ] });
    expect([userHas('E2E-X')(r), userHas('E2E-Y')(r), userHas('E2E-IN-INPUT')(r)]).toEqual([true, true, false]);
    expect([lastHas('E2E-Y')(r), lastHas('E2E-X')(r)]).toEqual([true, false]);
    expect([turn(1)(r), turn(0)(r)]).toEqual([true, false]);
    expect([hasTools(r), hasTools(req({ tools: [] })), hasTools(req({ tools: undefined }))]).toEqual([true, false, false]);
    expect(toolResults(r)).toEqual([{ tool_use_id: 't1', is_error: false, text: 'file says E2E-Y' }]);
    expect(all(userHas('E2E-X'), not(userHas('E2E-Z')))(r)).toBe(true);
  });
  it('pickStep takes the first unused step whose predicate holds, each once; a request without tools that carries the prompt never takes a scripted step', () => {
    const when = all(hasTools, userHas('E2E-X'), turn(0));
    const steps: Step[] = [{ name: 'a#0', when, reply: [] }, { name: 'a#1', when, reply: [] }];
    const used = new Set<string>();
    expect(pickStep(steps, used, req({ tools: [] }))).toBeNull();
    expect(pickStep(steps, used, req())?.name).toBe('a#0');
    expect(pickStep(steps, used, req())?.name).toBe('a#1');
    expect(pickStep(steps, used, req())).toBeNull();
  });
  it('the server answers a scripted stream, a plain request, count_tokens and an unknown path, and logs each by its path without the query', async () => {
    const server = await startMessagesServer([{ name: 's#0', when: userHas('E2E-X'), reply: [{ type: 'text', text: 'scripted' }] }]);
    try {
      expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      const post = (p: string, body: unknown) => fetch(server.url + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const a = await post('/v1/messages?beta=true', req());
      expect(a.headers.get('content-type')).toContain('text/event-stream');
      expect(parseSse(await a.text())[2].data.delta.text).toBe('scripted');
      expect(await (await post('/v1/messages', req({ stream: false }))).json())
        .toMatchObject({ type: 'message', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' });
      expect(await (await post('/v1/messages/count_tokens', req())).json()).toEqual({ input_tokens: 1 });
      const d = await fetch(server.url + '/v1/models');
      expect(d.status).toBe(404);
      expect(await d.json()).toMatchObject({ type: 'error', error: { type: 'not_found_error' } });
      expect(server.log.map(l => [l.method, l.path, l.step])).toEqual([
        ['POST', '/v1/messages', 's#0'], ['POST', '/v1/messages', null], ['POST', '/v1/messages/count_tokens', null], ['GET', '/v1/models', null],
      ]);
    } finally { await server.close(); }
  });
  it('an async reply is awaited; a reply that throws answers with its error as text and logs it; a body that is not JSON gets a 400', async () => {
    const server = await startMessagesServer([
      { name: 'a#0', when: turn(0), reply: async () => [{ type: 'text', text: 'later' }] },
      { name: 'b#0', when: turn(0), reply: () => { throw new Error('boom'); } },
    ]);
    try {
      const post = () => fetch(server.url + '/v1/messages', { method: 'POST', body: JSON.stringify(req()) }).then(r => r.text()).then(parseSse);
      expect((await post())[2].data.delta.text).toBe('later');
      expect((await post())[2].data.delta.text).toBe('e2e: step b#0 failed: boom');
      expect(server.log[1]).toMatchObject({ step: 'b#0', error: 'boom' });
      const bad = await fetch(server.url + '/v1/messages', { method: 'POST', body: 'not json' });
      expect(bad.status).toBe(400);
      expect(await bad.json()).toMatchObject({ type: 'error', error: { type: 'invalid_request_error' } });
      expect(server.log[2]).toMatchObject({ method: 'POST', path: '/v1/messages', step: null, body: null });
    } finally { await server.close(); }
  });
  it('duplicate step names are refused, and after close the port answers no more', async () => {
    await expect(startMessagesServer([{ name: 'x', when: hasTools, reply: [] }, { name: 'x', when: hasTools, reply: [] }])).rejects.toThrow('e2e: duplicate step name x');
    const server = await startMessagesServer([]);
    await server.close();
    await expect(fetch(server.url + '/v1/messages', { method: 'POST', body: '{}' })).rejects.toThrow();
  });
});

describe('finding claude (A8)', () => {
  it('on win32 each PATH folder offers claude.exe before claude.cmd, in PATH order; elsewhere claude; none is null', () => {
    const files = new Set(['C:\\a\\claude.cmd', 'C:\\b\\claude.exe', 'C:\\b\\claude.cmd']);
    expect(resolveClaude({ Path: 'C:\\a;C:\\b' }, 'win32', f => files.has(f))).toBe('C:\\a\\claude.cmd');
    expect(resolveClaude({ PATH: 'C:\\b;C:\\a' }, 'win32', f => files.has(f))).toBe('C:\\b\\claude.exe');
    expect(resolveClaude({ PATH: '/usr/bin:/opt/c' }, 'linux', f => f === '/opt/c/claude')).toBe('/opt/c/claude');
    expect(resolveClaude({ PATH: '/usr/bin' }, 'linux', () => false)).toBeNull();
  });
  it('BGKIT_E2E_CLAUDE names the binary; one that is not a file finds none, never another', () => {
    expect(resolveClaude({ BGKIT_E2E_CLAUDE: '/x/claude', PATH: '/opt/c' }, 'linux', f => f === '/x/claude' || f === '/opt/c/claude')).toBe('/x/claude');
    expect(resolveClaude({ BGKIT_E2E_CLAUDE: '/gone', PATH: '/opt/c' }, 'linux', f => f === '/opt/c/claude')).toBeNull();
  });
  it('parseVersion reads x.y.z from claude --version', () => {
    expect(parseVersion('2.1.310 (Claude Code)\n')).toBe('2.1.310');
    expect(parseVersion('error: unknown option')).toBeNull();
  });
  it('an .exe runs without a shell and a path with a space arrives whole; a .cmd goes through cmd.exe and refuses an argument with a space or a quote', () => {
    const exe: ClaudeBin = { file: 'C:\\x\\claude.exe', prefix: [], version: '1.0.0', viaCmd: false };
    expect(spawnSpec(exe, ['--debug-file', 'C:\\Users\\A B\\d.log'])).toEqual({ file: 'C:\\x\\claude.exe', args: ['--debug-file', 'C:\\Users\\A B\\d.log'] });
    const cmd: ClaudeBin = { ...exe, file: 'C:\\x\\claude.cmd', viaCmd: true };
    expect(spawnSpec(cmd, ['-p', '--verbose'], 'C:\\Windows\\cmd.exe')).toEqual({ file: 'C:\\Windows\\cmd.exe', args: ['/d', '/c', 'C:\\x\\claude.cmd', '-p', '--verbose'] });
    expect(() => spawnSpec(cmd, ['C:\\Users\\A B\\d.log'])).toThrow('e2e: claude.cmd cannot take');
    expect(() => spawnSpec(cmd, ['{"a":1}'])).toThrow('e2e: claude.cmd cannot take');
    expect(() => spawnSpec({ ...cmd, file: 'C:\\Program Files\\claude.cmd' }, ['-p'])).toThrow('e2e: claude.cmd cannot take');
  });
  it('announceLine says which claude runs, warns when its version is not the recorded one, or says every scenario is skipped', () => {
    expect(announceLine(null)).toBe('e2e: no claude CLI found (PATH or BGKIT_E2E_CLAUDE): every scenario is skipped');
    const bin: ClaudeBin = { file: '/b/claude', prefix: [], version: OBSERVED_WITH, viaCmd: false };
    expect(announceLine(bin)).toBe(`e2e: claude ${OBSERVED_WITH} (/b/claude)`);
    expect(announceLine({ ...bin, version: '0.0.1' })).toBe(`e2e: claude 0.0.1 (/b/claude); tests/e2e/README.md was recorded with ${OBSERVED_WITH}: a pinned scenario that fails may be a change of Claude Code`);
  });
});

describe('the e2e session (A8)', () => {
  const tmp = useTempDirs();
  const fake: ClaudeBin = { file: process.execPath, prefix: [fileURLToPath(new URL('./e2e/fixtures/fake-claude.mjs', import.meta.url))], version: 'fake', viaCmd: false };

  it("e2eEnv drops the parent session's, vitest's, the proxy's and forge's variables in any case, keeps PATH and the git-bash path, and points the child at the scripted API, the temp config and the temp home", () => {
    const env = e2eEnv({
      PATH: '/bin', CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 's', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_PROJECT_DIR: '/p', CLAUDE_CODE_OAUTH_TOKEN: 't',
      Claude_Config_Dir: '/real', ANTHROPIC_AUTH_TOKEN: 'a', ANTHROPIC_API_KEY: 'real', NODE_ENV: 'test', TEST: 'true', VITEST_POOL_ID: '1',
      HTTPS_PROXY: 'http://p', https_proxy: 'http://p', NODE_OPTIONS: '--inspect', FORGE_ROUTE_HINT: 'off', UserProfile: 'C:\\real', CLAUDE_CODE_GIT_BASH_PATH: 'C:\\g\\bash.exe',
      // Claude Code settings a session hands to its children when settings.json `env` sets them, without the CLAUDE/ANTHROPIC prefix
      ENABLE_TOOL_SEARCH: 'false', MAX_THINKING_TOKENS: '1', DISABLE_PROMPT_CACHING: '1', BASH_DEFAULT_TIMEOUT_MS: '1', BASH_MAX_TIMEOUT_MS: '1',
      MCP_TIMEOUT: '1', API_TIMEOUT_MS: '1', OTEL_METRICS_EXPORTER: 'otlp', otel_service_name: 'x',
    }, { home: '/h', configDir: '/h/.claude', hookLog: '/h/hooks.jsonl' }, 'http://127.0.0.1:9');
    expect(env).toEqual({
      PATH: '/bin', CLAUDE_CODE_GIT_BASH_PATH: 'C:\\g\\bash.exe', ANTHROPIC_BASE_URL: 'http://127.0.0.1:9', ANTHROPIC_API_KEY: E2E_KEY,
      CLAUDE_CONFIG_DIR: '/h/.claude', HOME: '/h', USERPROFILE: '/h', BGKIT_E2E_HOOK_LOG: '/h/hooks.jsonl', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      DISABLE_AUTOUPDATER: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1', NO_PROXY: '127.0.0.1,localhost', CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1',
    });
  });
  it('claudeArgs: print mode with stream-json both ways, hook events, the session, the model, strict MCP, the debug file, each plugin dir, the settings and each permission mode', () => {
    const ws = { sessionId: 'u-1', debugFile: '/h/debug.log' } as Workspace;
    expect(claudeArgs(ws, { plugins: ['/p/waypoint', '/p/forge'], permissions: 'bypass' })).toEqual([
      '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-hook-events',
      '--session-id', 'u-1', '--model', E2E_MODEL, '--strict-mcp-config', '--debug-file', '/h/debug.log',
      '--plugin-dir', '/p/waypoint', '--plugin-dir', '/p/forge', '--permission-mode', 'bypassPermissions', '--permission-prompts', 'none',
    ]);
    expect(claudeArgs(ws, { plugins: [], permissions: 'deny-prompts', settings: '/h/s.json' }).slice(-4)).toEqual(['--settings', '/h/s.json', '--permission-prompts', 'none']);
    expect(claudeArgs(ws, { plugins: [], permissions: 'host' }).slice(-2)).toEqual(['--permission-prompt-tool', 'stdio']);
  });
  it('makeWorkspace: a git repo with one commit on main, a temp home with its config dir and an onboarded .claude.json, and a fresh session UUID', () => {
    const ws = makeWorkspace(tmp);
    const git = (...a: string[]) => execFileSync('git', a, { cwd: ws.repo, encoding: 'utf8' }).trim();
    expect(git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    expect(git('rev-list', '--count', 'HEAD')).toBe('1');
    expect(ws.configDir).toBe(path.join(ws.home, '.claude'));
    expect(JSON.parse(readFileSync(path.join(ws.configDir, '.claude.json'), 'utf8'))).toMatchObject({ hasCompletedOnboarding: true, customApiKeyResponses: { approved: [E2E_KEY.slice(-20)] } });
    expect(ws.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(makeWorkspace(tmp).sessionId).not.toBe(ws.sessionId);
  });
  it('the probe hook appends its stdin to BGKIT_E2E_HOOK_LOG as one {event, input} line, prints nothing, and does nothing without the variable', () => {
    const hookLog = path.join(tmp('e2e-probe-'), 'hooks.jsonl');
    const record = path.join(PLUGIN_DIRS.probe, 'hooks', 'record.mjs');
    const input = { hook_event_name: 'Stop', session_id: 's', stop_hook_active: false };
    const r = spawnSync(process.execPath, [record], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, BGKIT_E2E_HOOK_LOG: hookLog } });
    expect([r.status, r.stdout]).toEqual([0, '']);
    spawnSync(process.execPath, [record], { input: 'not json', env: { ...process.env, BGKIT_E2E_HOOK_LOG: hookLog } });
    expect(readHooks({ hookLog })).toEqual([{ event: 'Stop', input }, { event: 'unparsed', input: { text: 'not json' } }]);
    const { BGKIT_E2E_HOOK_LOG: _no, ...bare } = process.env;
    expect(spawnSync(process.execPath, [record], { input: JSON.stringify(input), env: bare }).status).toBe(0);
    expect(readHooks({ hookLog })).toHaveLength(2);
  });
  it('runClaude sends each turn after the previous result and ends stdin after the last: the child exits 0 and every line is parsed', async () => {
    const ws = makeWorkspace(tmp);
    const server = await startMessagesServer([]);
    try {
      const r = await runClaude(fake, { ws, server, turns: ['one', 'two'], timeoutMs: 20_000, env: { ...process.env, FAKE_CLAUDE_MODE: 'echo' } });
      expect([r.code, r.timedOut]).toEqual([0, false]);
      expect(r.out.find(l => l.subtype === 'init')).toMatchObject({ type: 'system', session_id: ws.sessionId });
      expect(r.out.filter(l => l.type === 'result').map(l => l.result)).toEqual(['one', 'two']);
      expect(r.out.some(l => l.type === 'raw')).toBe(false);
      expect(r.pid).toBeGreaterThan(0);
    } finally { await server.close(); }
  });
  it('with onControl it sends initialize first and answers can_use_tool with what onControl returns', async () => {
    const ws = makeWorkspace(tmp);
    const server = await startMessagesServer([]);
    const seen: (string | undefined)[] = [];
    try {
      const r = await runClaude(fake, {
        ws, server, turns: ['ask'], timeoutMs: 20_000, env: { ...process.env, FAKE_CLAUDE_MODE: 'ask' },
        onControl: c => { seen.push(c.request.tool_name); return { behavior: 'allow', updatedInput: { answers: { 'Q?': 'Yes' } } }; },
      });
      expect([r.code, r.timedOut]).toEqual([0, false]);
      expect(seen).toEqual(['AskUserQuestion']);
      const result = r.out.find(l => l.type === 'result');
      expect(JSON.parse(String(result?.result))).toEqual({ behavior: 'allow', updatedInput: { answers: { 'Q?': 'Yes' } } });
    } finally { await server.close(); }
  });
  it('an onControl that throws is answered with a deny that carries the error, and the error is appended to stderr: the run does not wait for the timeout', async () => {
    const ws = makeWorkspace(tmp);
    const server = await startMessagesServer([]);
    try {
      const r = await runClaude(fake, {
        ws, server, turns: ['ask'], timeoutMs: 20_000, env: { ...process.env, FAKE_CLAUDE_MODE: 'ask' },
        onControl: () => { throw new Error('boom'); },
      });
      expect([r.code, r.timedOut]).toEqual([0, false]);
      expect(r.stderr).toContain('e2e: onControl threw: boom');
      const result = r.out.find(l => l.type === 'result');
      expect(JSON.parse(String(result?.result))).toEqual({ behavior: 'deny', message: 'e2e: onControl threw: boom' });
    } finally { await server.close(); }
  });
  it('a child that never ends is killed by its own pid at the timeout: timedOut, the process is gone, and the report carries the debug tail', async () => {
    const ws = makeWorkspace(tmp);
    const server = await startMessagesServer([]);
    try {
      const t0 = Date.now();
      const r = await runClaude(fake, { ws, server, turns: ['x'], timeoutMs: 1500, env: { ...process.env, FAKE_CLAUDE_MODE: 'hang' } });
      expect(Date.now() - t0).toBeLessThan(10_000);
      expect(r.timedOut).toBe(true);
      const gone = async () => {
        for (let i = 0; i < 20; i++) {
          try { process.kill(r.pid, 0); } catch { return true; }
          await new Promise(res => setTimeout(res, 100));
        }
        return false;
      };
      expect(await gone()).toBe(true);
      expect(r.debugTail).toContain('fake-claude hang');
      const report = failureReport(r, server);
      expect(report).toContain('timedOut: true');
      expect(report).toContain('fake-claude hang');
    } finally { await server.close(); }
  });
});
