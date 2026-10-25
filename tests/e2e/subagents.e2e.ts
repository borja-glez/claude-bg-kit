// A8: nested subagents and permissions.deny inside a subagent against the real claude (see tests/e2e/README.md).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { agentTool, agentUse } from './harness/agents.js';
import { findClaude } from './harness/claude-bin.js';
import { all, hasTools, not, startMessagesServer, toolResults, turn, userHas, type ReplyBlock } from './harness/messages-server.js';
import { failureReport, runClaude } from './harness/session.js';
import { makeWorkspace } from './harness/workspace.js';
import { liveFile } from '../../src/forge/live.js';
import { normalizeLive } from '../../src/lib/execution-state.js';
import { seedExecution } from '../helpers/execution.js';
import { useTempDirs } from '../helpers/tmp.js';

const CLAUDE = findClaude(process.env);
const tmp = useTempDirs();

// The values below were read from the server log and the probe's hook log of a real run (see the README).
const PINNED_NESTED = {
  agentTool: 'Agent',
  nestedOffered: true,
  levelTwoRan: true,
  subagentStarts: ['general-purpose', 'general-purpose'],
  startsInSession: true,
  distinctAgentIds: true,
  readAgentTypes: ['general-purpose', 'general-purpose', null],
  liveAtL1: 1,
  liveAtL2: 2,
};
const PINNED_DENY = { subagentDenied: true };

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

describe.skipIf(!CLAUDE)('subagents against the real claude (A8)', () => {
  it('nested subagents: which levels fire SubagentStart, what PreToolUse says inside each, and what forge\'s live signal lists while level two runs', async () => {
    const ws = makeWorkspace(tmp);
    const now = new Date();
    seedExecution(ws.repo, { // the literal of tests/forge-live.test.ts, for this run and session
      runId: 'e2e-r1', kind: 'plan', mode: 'subagents', parallel: 1, project: 'e2e', base: 'main', branch: 'forge/run-e2e', mergeOnFinish: false,
      coordinator: 'main', hookSession: ws.sessionId, active: true, stopReason: null, stallReason: null, startedAt: now.toISOString(), lastStepAt: null,
      lastBlockStep: null, sleepUntil: new Date(now.getTime() + 3600_000).toISOString(), tasks: {},
    });
    const readme = path.join(ws.repo, 'README.md');
    const read = (id: string): ReplyBlock => ({ type: 'tool_use', id, name: 'Read', input: { file_path: readme } });
    // the live signal of the coordinator: the agent ids it lists, waiting up to 3 s for `n` of them
    const snapshot = async (n: number): Promise<string[]> => {
      let ids: string[] = [];
      for (let i = 0; i < 30; i++) {
        const file = liveFile(ws.repo, ws.sessionId);
        if (existsSync(file)) {
          try { ids = normalizeLive(JSON.parse(readFileSync(file, 'utf8')))?.agents.map(a => a.id) ?? []; } catch { ids = []; }
        }
        if (ids.length >= n) break;
        await sleep(100);
      }
      return ids;
    };
    let liveAtL1: string[] = [];
    let liveAtL2: string[] = [];
    let nestedOffered = false;
    const nest = (n: number) => all(hasTools, userHas('E2E-NEST'), not(userHas('E2E-L1')), turn(n));
    const l1 = (n: number) => all(hasTools, userHas('E2E-L1'), not(userHas('E2E-L2')), turn(n));
    const l2 = (n: number) => all(hasTools, userHas('E2E-L2'), turn(n));
    const server = await startMessagesServer([
      { name: 'nest#0', when: nest(0), reply: r => [agentUse(r, 'toolu_e2e_nest_0', 'E2E-L1: read the README, then start one more agent')] },
      { name: 'l1#0', when: l1(0), reply: async () => { liveAtL1 = await snapshot(1); return [read('toolu_e2e_l1_0')]; } },
      { name: 'l1#1', when: l1(1), reply: r => {
        nestedOffered = agentTool(r) !== null;
        return nestedOffered ? [agentUse(r, 'toolu_e2e_l1_1', 'E2E-L2: read the README')] : [{ type: 'text', text: 'no agent tool here' }];
      } },
      { name: 'l2#0', when: l2(0), reply: async () => { liveAtL2 = await snapshot(2); return [read('toolu_e2e_l2_0')]; } },
      { name: 'l2#1', when: l2(1), reply: [{ type: 'text', text: 'level two finished' }] },
      { name: 'l1#2', when: l1(2), reply: [{ type: 'text', text: 'level one finished' }] },
      // the agent tool starts agents in the background, so the main session would read at once: wait for level one to finish,
      // so that the three reads happen in the order level one, level two, main
      { name: 'nest#1', when: nest(1), reply: async () => { for (let i = 0; i < 200 && !server.log.some(l => l.step === 'l1#2'); i++) await sleep(100); return [read('toolu_e2e_nest_1')]; } },
      { name: 'nest#2', when: nest(2), reply: [{ type: 'text', text: 'nest done' }] },
    ]);
    try {
      const nestTool = (() => { const b = server.log.find(l => l.step === 'nest#0')?.body; return b ? agentTool(b) : null; });
      const r = await runClaude(CLAUDE!, { ws, server, turns: ['E2E-NEST: start one agent'] });
      expect(r.timedOut, failureReport(r, server)).toBe(false);
      const starts = r.hooks.filter(h => h.event === 'SubagentStart');
      const observed = {
        agentTool: nestTool(),
        nestedOffered,
        levelTwoRan: server.log.some(l => l.step === 'l2#0'),
        subagentStarts: starts.map(h => h.input.agent_type ?? null),
        startsInSession: starts.every(h => h.input.session_id === ws.sessionId),
        distinctAgentIds: new Set(starts.map(h => h.input.agent_id)).size === starts.length,
        readAgentTypes: r.hooks.filter(h => h.event === 'PreToolUse' && h.input.tool_name === 'Read').map(h => h.input.agent_type ?? null),
        liveAtL1: liveAtL1.length, liveAtL2: liveAtL2.length,
      };
      expect(observed).toEqual(PINNED_NESTED);
      // the agents of each snapshot are the agent_ids SubagentStart carried: level one's, then both levels'
      const startIds = starts.map(h => String(h.input.agent_id));
      expect({ liveAtL1, liveAtL2: [...liveAtL2].sort() }, 'the live signal lists the agent_ids of SubagentStart')
        .toEqual({ liveAtL1: startIds.slice(0, 1), liveAtL2: [...startIds].sort() });
    } finally { await server.close(); }
  });

  it('permissions.deny of --settings: the main session, as the control, and a subagent read the same denied file', async () => {
    const ws = makeWorkspace(tmp);
    writeFileSync(path.join(ws.repo, 'e2e-denied.txt'), 'E2E-DENIED-CONTENT\n');
    const settings = path.join(ws.home, 'deny.json');
    writeFileSync(settings, JSON.stringify({ permissions: { deny: ['Read(**/e2e-denied.txt)'] } }));
    const target = path.join(ws.repo, 'e2e-denied.txt');
    const read = (id: string): ReplyBlock => ({ type: 'tool_use', id, name: 'Read', input: { file_path: target } });
    // 'E2E-DENY' is inside 'E2E-DENY-L1': the main steps exclude the subagent's prompt
    const main = (n: number) => all(hasTools, userHas('E2E-DENY'), not(userHas('E2E-DENY-L1')), turn(n));
    const sub = (n: number) => all(hasTools, userHas('E2E-DENY-L1'), turn(n));
    const server = await startMessagesServer([
      { name: 'deny#0', when: main(0), reply: [read('toolu_e2e_deny_main')] },
      { name: 'deny#1', when: main(1), reply: r => [agentUse(r, 'toolu_e2e_deny_agent', 'E2E-DENY-L1: read e2e-denied.txt')] },
      { name: 'dl1#0', when: sub(0), reply: [read('toolu_e2e_deny_sub')] },
      { name: 'dl1#1', when: sub(1), reply: [{ type: 'text', text: 'sub done' }] },
      { name: 'deny#2', when: main(2), reply: [{ type: 'text', text: 'deny done' }] },
    ]);
    try {
      const r = await runClaude(CLAUDE!, { ws, server, turns: ['E2E-DENY: read e2e-denied.txt'], permissions: 'deny-prompts', settings });
      expect(r.timedOut, failureReport(r, server)).toBe(false);
      // denied(id): the tool_result of id, in the next request of its thread, is an error and lacks the file's content
      const denied = (id: string): boolean => {
        const res = server.log.flatMap(l => (l.body ? toolResults(l.body) : [])).find(t => t.tool_use_id === id);
        return res !== undefined && res.is_error && !res.text.includes('E2E-DENIED-CONTENT');
      };
      expect(denied('toolu_e2e_deny_main'), 'the control: the rule must deny the main session first').toBe(true);
      expect({ subagentDenied: denied('toolu_e2e_deny_sub') }).toEqual(PINNED_DENY);
    } finally { await server.close(); }
  });
});
