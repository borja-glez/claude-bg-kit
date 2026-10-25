// A8: forge's guard B (w7 A4) against the real claude: forge's agents keep off the machine's secrets and off .env files,
// and the main session is unchanged (see tests/e2e/README.md). Every secret here is a fake file in the temp home and repo.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { agentUse, resultOf } from './harness/agents.js';
import { findClaude } from './harness/claude-bin.js';
import { all, hasTools, not, startMessagesServer, toolNames, turn, userHas, type ReplyBlock } from './harness/messages-server.js';
import { failureReport, runClaude } from './harness/session.js';
import { makeWorkspace } from './harness/workspace.js';
import { useTempDirs } from '../helpers/tmp.js';

const CLAUDE = findClaude(process.env);
const tmp = useTempDirs();

// The values below were read from the probe's hook log of a real run (see the README).
const PINNED_AGENT_TYPES = ['forge:forge-impl', 'forge:forge-verify'];

describe.skipIf(!CLAUDE)("forge's guard B against the real claude (A8, w7 A4)", () => {
  it("guard B against the real claude: a forge implementer reads no secret and no .env, forge-verify reads only the repo's .env, and the main session is unchanged", async () => {
    const ws = makeWorkspace(tmp);
    const key = path.join(ws.home, '.ssh', 'id_e2e');
    mkdirSync(path.dirname(key), { recursive: true });
    writeFileSync(key, 'E2E-FAKE-SSH-KEY\n');
    const repoEnv = path.join(ws.repo, '.env');
    writeFileSync(repoEnv, 'E2E_REPO_ENV=1\n');
    const outsideEnv = path.join(tmp('e2e-outside-'), '.env');
    writeFileSync(outsideEnv, 'E2E_OUTSIDE_ENV=1\n');
    const read = (id: string, file: string): ReplyBlock => ({ type: 'tool_use', id, name: 'Read', input: { file_path: file } });
    let bashOffered = false;
    // 'E2E-GUARD' is the main session's marker; each subagent's prompt carries its own 'E2E-GB-' marker
    const main = (n: number) => all(hasTools, userHas('E2E-GUARD'), not(userHas('E2E-GB-')), turn(n));
    const impl = (n: number) => all(hasTools, userHas('E2E-GB-IMPL'), turn(n));
    const verify = (n: number) => all(hasTools, userHas('E2E-GB-VERIFY'), turn(n));
    const server = await startMessagesServer([
      { name: 'gb#0', when: main(0), reply: r => [agentUse(r, 'toolu_gb_impl', 'E2E-GB-IMPL: read the files', 'forge:forge-impl')] },
      { name: 'impl#0', when: impl(0), reply: [read('toolu_gb_impl_ssh', key)] },
      { name: 'impl#1', when: impl(1), reply: [read('toolu_gb_impl_env', repoEnv)] },
      { name: 'impl#2', when: impl(2), reply: [read('toolu_gb_impl_out', outsideEnv)] },
      { name: 'impl#3', when: impl(3), reply: r => {
        bashOffered = toolNames(r).includes('Bash');
        return bashOffered ? [{ type: 'tool_use', id: 'toolu_gb_impl_bash', name: 'Bash', input: { command: `cat "${key}"` } }] : [{ type: 'text', text: 'no Bash here' }];
      } },
      { name: 'impl#4', when: impl(4), reply: [{ type: 'text', text: 'impl done' }] },
      { name: 'gb#1', when: main(1), reply: r => [agentUse(r, 'toolu_gb_verify', 'E2E-GB-VERIFY: read the env', 'forge:forge-verify')] },
      { name: 'verify#0', when: verify(0), reply: [read('toolu_gb_verify_env', repoEnv)] },
      { name: 'verify#1', when: verify(1), reply: [read('toolu_gb_verify_ssh', key)] },
      { name: 'verify#2', when: verify(2), reply: [{ type: 'text', text: 'verify done' }] },
      { name: 'gb#2', when: main(2), reply: [read('toolu_gb_main_ssh', key)] },
      { name: 'gb#3', when: main(3), reply: [{ type: 'text', text: 'guard done' }] },
    ]);
    try {
      const r = await runClaude(CLAUDE!, { ws, server, turns: ['E2E-GUARD: check the guard'] });
      expect(r.timedOut, failureReport(r, server)).toBe(false);
      // the agents run in the background, so the threads interleave: the steps used, in any order
      expect(server.log.map(l => l.step).filter(Boolean).sort()).toEqual([
        'gb#0', 'gb#1', 'gb#2', 'gb#3', 'impl#0', 'impl#1', 'impl#2', 'impl#3', ...(bashOffered ? ['impl#4'] : []), 'verify#0', 'verify#1', 'verify#2',
      ].sort());
      // result(id): the tool_result of id, in the next request of its thread
      const result = (id: string): { is_error: boolean; text: string } => {
        const found = resultOf(server.log, id);
        expect(found, `no tool_result for ${id}`).not.toBeNull();
        return found!;
      };
      for (const id of ['toolu_gb_impl_ssh', 'toolu_gb_impl_env', 'toolu_gb_impl_out', 'toolu_gb_verify_ssh', ...(bashOffered ? ['toolu_gb_impl_bash'] : [])]) {
        expect(result(id), id).toMatchObject({ is_error: true });
        expect(result(id).text, id).toContain('forge guard · secrets:');
        expect(result(id).text, id).not.toMatch(/E2E-FAKE-SSH-KEY|E2E_REPO_ENV|E2E_OUTSIDE_ENV/);
      }
      expect(result('toolu_gb_verify_env').text).toContain('E2E_REPO_ENV=1');
      expect(result('toolu_gb_main_ssh').text).toContain('E2E-FAKE-SSH-KEY');
      const types = r.hooks.filter(h => h.event === 'PreToolUse').map(h => h.input.agent_type ?? null);
      expect(types.filter(t => t !== null).every(t => String(t).startsWith('forge'))).toBe(true);
      expect(types).toContain(null); // the main session's calls (its Agent calls and its Read) carry no agent_type
      expect([...new Set(types.filter(t => t !== null))].sort()).toEqual(PINNED_AGENT_TYPES);
    } finally { await server.close(); }
  });
});
