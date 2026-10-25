// A8: forge's Stop hook against the real claude (see tests/e2e/README.md).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findClaude } from './harness/claude-bin.js';
import { all, hasTools, lastHas, startMessagesServer, turn, userHas } from './harness/messages-server.js';
import { failureReport, runClaude } from './harness/session.js';
import { makeWorkspace } from './harness/workspace.js';
import { runFile, saveRun, startRun } from '../../src/forge/run.js';
import { useTempDirs } from '../helpers/tmp.js';

const CLAUDE = findClaude(process.env);
const tmp = useTempDirs();
const REASON = 'forge infinite mode is active (cycle 1 of 3)';

describe.skipIf(!CLAUDE)("forge's Stop hook against the real claude (A8)", () => {
  it('an active infinite run bound to the session blocks the first stop: the model gets the reason, and the second Stop carries stop_hook_active and lets the session end', async () => {
    const ws = makeWorkspace(tmp);
    saveRun(ws.repo, startRun(new Date(), { cycles: 3 }, 10, ws.sessionId));
    const server = await startMessagesServer([
      { name: 'stop#0', when: all(hasTools, userHas('E2E-STOP'), turn(0)), reply: [{ type: 'text', text: 'first stop' }] },
      { name: 'stop#1', when: all(hasTools, userHas('E2E-STOP'), lastHas(REASON)), reply: [{ type: 'text', text: 'second stop' }] },
    ]);
    try {
      const r = await runClaude(CLAUDE!, { ws, server, turns: ['E2E-STOP: say done'] });
      expect(r.timedOut, failureReport(r, server)).toBe(false);
      expect(r.code).toBe(0);
      expect(server.log.map(l => l.step).filter(Boolean)).toEqual(['stop#0', 'stop#1']);
      expect(r.hooks.filter(h => h.event === 'Stop').map(h => h.input.stop_hook_active ?? false)).toEqual([false, true]);
      expect(JSON.parse(readFileSync(runFile(ws.repo), 'utf8'))).toMatchObject({ active: true, sessionId: ws.sessionId, lastBlockEvents: 0, blocksSinceCycle: 1 });
      expect(r.out.filter(l => l.type === 'result')).toMatchObject([{ subtype: 'success', result: 'second stop' }]);
    } finally { await server.close(); }
  });

  it('the same run bound to another session never blocks this one (C1)', async () => {
    const ws = makeWorkspace(tmp);
    saveRun(ws.repo, startRun(new Date(), { cycles: 3 }, 10, 'another-session'));
    const server = await startMessagesServer([
      { name: 'other#0', when: all(hasTools, userHas('E2E-STOP-OTHER'), turn(0)), reply: [{ type: 'text', text: 'only stop' }] },
    ]);
    try {
      const r = await runClaude(CLAUDE!, { ws, server, turns: ['E2E-STOP-OTHER: say done'] });
      expect(r.timedOut, failureReport(r, server)).toBe(false);
      expect(r.code).toBe(0);
      expect(server.log.map(l => l.step).filter(Boolean)).toEqual(['other#0']);
      expect(r.hooks.filter(h => h.event === 'Stop')).toHaveLength(1);
      expect(JSON.parse(readFileSync(runFile(ws.repo), 'utf8'))).toMatchObject({ active: true, sessionId: 'another-session', lastBlockEvents: null, blocksSinceCycle: 0 });
      expect(r.out.filter(l => l.type === 'result')).toMatchObject([{ subtype: 'success', result: 'only stop' }]);
    } finally { await server.close(); }
  });
});
