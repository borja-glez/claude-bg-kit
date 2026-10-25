// w7 integration (A4 R16): the PreToolUse fast path of Read, Grep and Glob. dist/guard-read.cjs lets a call through at
// once unless a forge agent makes it, and for a forge agent hands the input to `forge.cjs hook guard` unchanged.
import { describe, it, expect, beforeEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { READ_TOOLS, isForgeAgent, readPassesAtOnce } from '../src/forge/guard-fast.js';
import * as secrets from '../src/forge/guard-secrets.js';
import { useTempDirs } from './helpers/tmp.js';

const tmp = useTempDirs();
const DIST = fileURLToPath(new URL('../plugins/forge/dist/', import.meta.url));
const FAST = path.join(DIST, 'guard-read.cjs');
const FORGE = path.join(DIST, 'forge.cjs');
const SSH = path.join(os.homedir(), '.ssh', 'id_rsa');
const SILENT = { status: 0, stdout: '', stderr: '' };

const spawn = (args: string[], input: string, cwd: string) => {
  const r = spawnSync(process.execPath, args, { cwd, input, encoding: 'utf8', timeout: 30_000, windowsHide: true });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};

describe('guard-fast: what hookGuard lets through before building guardCtx', () => {
  it('guard-secrets keeps exporting the same READ_TOOLS and isForgeAgent', () => {
    expect(secrets.READ_TOOLS).toBe(READ_TOOLS);
    expect(secrets.isForgeAgent).toBe(isForgeAgent);
    expect(READ_TOOLS).toEqual(['Read', 'Grep', 'Glob']);
  });
  it('passes a Read, Grep or Glob outside a forge agent, and an input that does not parse as an object', () => {
    for (const tool_name of READ_TOOLS) {
      for (const extra of [{}, { agent_type: 'general-purpose' }, { agent_type: 'Explore' }, { agent_type: 'x:forge-impl' }, { agent_type: 7 }]) {
        expect(readPassesAtOnce(JSON.stringify({ tool_name, tool_input: { file_path: SSH }, ...extra })), `${tool_name} ${JSON.stringify(extra)}`).toBe(true);
      }
    }
    for (const raw of ['', 'garbage', '{"tool_name": "Read"', 'null', '42', '"Read"', '[]']) expect(readPassesAtOnce(raw), raw).toBe(true);
  });
  it('hands on a forge agent\'s call, and any call that is not a Read, Grep or Glob', () => {
    for (const agent_type of ['forge:forge-impl', 'forge-verify', 'forge']) {
      expect(readPassesAtOnce(JSON.stringify({ tool_name: 'Read', tool_input: { file_path: 'a.ts' }, agent_type })), agent_type).toBe(false);
    }
    for (const tool_name of ['Bash', 'Edit', 'Globber', 'mcp__x__y', undefined]) {
      expect(readPassesAtOnce(JSON.stringify({ tool_name, tool_input: {} })), String(tool_name)).toBe(false);
    }
  });
});

describe('dist/guard-read.cjs, the PreToolUse hook of Read, Grep and Glob', () => {
  let root: string;
  beforeEach(() => { root = tmp('guard-read-'); execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root }); });
  const hookInput = (input: Record<string, unknown>) => JSON.stringify({
    session_id: 's1', transcript_path: 't.jsonl', cwd: root, permission_mode: 'default', hook_event_name: 'PreToolUse', tool_use_id: 'toolu_1', ...input,
  });
  const fast = (input: string) => spawn([FAST], input, root);
  const guard = (input: string) => spawn([FORGE, 'hook', 'guard'], input, root);

  it('prints nothing and exits 0 for the person\'s session, another agent and a missing agent_type', () => {
    for (const tool_name of READ_TOOLS) {
      const tool_input = tool_name === 'Read' ? { file_path: SSH } : { pattern: 'x', path: path.dirname(SSH) };
      expect(fast(hookInput({ tool_name, tool_input })), tool_name).toEqual(SILENT);
      expect(fast(hookInput({ tool_name, tool_input, agent_id: 'a1', agent_type: 'general-purpose' })), tool_name).toEqual(SILENT);
    }
  });
  it('prints nothing and exits 0 when stdin does not parse', () => {
    for (const raw of ['', 'garbage', '{"tool_name": "Read"']) expect(fast(raw), raw).toEqual(SILENT);
  });
  it('a forge agent denied a secret path gets the same output as forge.cjs hook guard', () => {
    for (const [tool_name, tool_input] of [['Read', { file_path: SSH }], ['Grep', { pattern: 'x', path: path.dirname(SSH) }], ['Glob', { pattern: '*', path: path.dirname(SSH) }]] as const) {
      const input = hookInput({ tool_name, tool_input, agent_id: 'a1', agent_type: 'forge:forge-impl' });
      const r = fast(input);
      expect(r, tool_name).toEqual(guard(input));
      expect(r.status).toBe(0);
      expect(JSON.parse(r.stdout).hookSpecificOutput, tool_name).toMatchObject({ hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: expect.stringMatching(/^forge guard · secrets:/) });
    }
  });
  it('a forge agent reading a normal path is let through, as forge.cjs hook guard lets it', () => {
    const input = hookInput({ tool_name: 'Read', tool_input: { file_path: path.join(root, 'src', 'a.ts') }, agent_id: 'a1', agent_type: 'forge:forge-impl' });
    expect(fast(input)).toEqual(SILENT);
    expect(guard(input)).toEqual(SILENT);
  });
  it('stays a small script: it does not carry the forge CLI', () => {
    expect(statSync(FAST).size).toBeLessThan(8 * 1024);
  });
});
