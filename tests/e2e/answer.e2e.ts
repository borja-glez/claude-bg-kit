// A8: the real tool_response of AskUserQuestion against forge's hook answer (see tests/e2e/README.md).
import { describe, expect, it } from 'vitest';
import { findClaude } from './harness/claude-bin.js';
import { all, hasTools, startMessagesServer, toolResults, turn, userHas } from './harness/messages-server.js';
import { failureReport, runClaude, type ControlRequest } from './harness/session.js';
import { makeWorkspace } from './harness/workspace.js';
import { readAuths, writeAuth } from '../../src/forge/auth.js';
import { hookAnswerInput } from '../helpers/hook-answer.js';
import { useTempDirs } from '../helpers/tmp.js';

const CLAUDE = findClaude(process.env);
const tmp = useTempDirs();
const Q = 'Do I merge forge/run-e2e into main? [merge-e2e-r1-ab12]';
const YES = 'Yes, merge it';
const ASK = { questions: [{ question: Q, header: 'Merge', multiSelect: false,
  options: [{ label: YES, description: 'merge the run' }, { label: 'No', description: 'keep it apart' }] }] };

describe.skipIf(!CLAUDE)('AskUserQuestion and forge hook answer against the real claude (A8)', () => {
  it("the host answers AskUserQuestion: PostToolUse carries tool_response with the answers, forge's hook answer records the yes, and the model reads the answer", async () => {
    const ws = makeWorkspace(tmp);
    writeAuth(ws.repo, { authId: 'merge-e2e-r1-ab12', kind: 'merge', runId: 'e2e-r1', target: 'main', question: Q, yes: YES, createdAt: new Date().toISOString(), session: ws.sessionId });
    const server = await startMessagesServer([
      { name: 'ask#0', when: all(hasTools, userHas('E2E-ANSWER'), turn(0)), reply: [{ type: 'tool_use', id: 'toolu_e2e_ask', name: 'AskUserQuestion', input: ASK }] },
      { name: 'ask#1', when: all(hasTools, userHas('E2E-ANSWER'), turn(1)), reply: [{ type: 'text', text: 'answered' }] },
    ]);
    const asked: ControlRequest[] = [];
    try {
      const r = await runClaude(CLAUDE!, { ws, server, turns: ['E2E-ANSWER: ask me'], onControl: c => {
        asked.push(c);
        const input = c.request.input ?? {};
        return c.request.tool_name === 'AskUserQuestion'
          ? { behavior: 'allow', updatedInput: { ...input, answers: { [Q]: YES } } }
          : { behavior: 'allow', updatedInput: input };
      } });
      expect(r.timedOut, failureReport(r, server)).toBe(false);
      // the real binary answers the harness's initialize: otherwise the run only starts after the fallback timer
      expect(r.out.some(l => l.type === 'control_response' && (l.response as { request_id?: string } | undefined)?.request_id === 'e2e-init'), 'no control_response to e2e-init').toBe(true);
      expect(server.log.map(l => l.step).filter(Boolean)).toEqual(['ask#0', 'ask#1']);
      expect(asked.map(c => c.request.tool_name)).toContain('AskUserQuestion');
      const post = r.hooks.find(h => h.event === 'PostToolUse' && h.input.tool_name === 'AskUserQuestion');
      expect(post?.input).toMatchObject({ session_id: ws.sessionId, tool_use_id: 'toolu_e2e_ask', tool_input: { questions: [{ question: Q }] }, tool_response: { answers: { [Q]: YES } } });
      // what the forge tests build with hookAnswerInput is a part of what Claude Code really sends
      const built = hookAnswerInput({ cwd: ws.repo, answers: { [Q]: YES } }).tool_response as Record<string, unknown>;
      for (const k of Object.keys(built)) expect(post?.input.tool_response, k).toHaveProperty(k);
      expect(readAuths(ws.repo)).toMatchObject([{ authId: 'merge-e2e-r1-ab12', answer: 'yes', answeredBy: ws.sessionId }]);
      const back = toolResults(server.log.find(l => l.step === 'ask#1')!.body!).find(t => t.tool_use_id === 'toolu_e2e_ask');
      expect(back).toMatchObject({ is_error: false });
      expect(back?.text).toContain(YES);
    } finally { await server.close(); }
  });
});
