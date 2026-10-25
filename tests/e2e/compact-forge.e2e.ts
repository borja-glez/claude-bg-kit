// A8: after /compact against the real claude, the text forge's SessionStart gives the model for what the session has in
// progress (w7 A2), for a loose forge task and for an infinite run (see tests/e2e/README.md).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findClaude } from './harness/claude-bin.js';
import { COMPACT_TURNS, compacting, SUMMARY_REPLY } from './harness/compact.js';
import { all, hasTools, lastHas, requestText, startMessagesServer, turn, userHas, type ScriptedServer, type Step } from './harness/messages-server.js';
import { failureReport, runClaude } from './harness/session.js';
import { makeWorkspace, type Workspace } from './harness/workspace.js';
import { COMPACT_INFINITE, COMPACT_RUN } from '../../src/forge/route-hooks.js';
import { saveRun, startRun } from '../../src/forge/run.js';
import { useTempDirs } from '../helpers/tmp.js';

const CLAUDE = findClaude(process.env);
const tmp = useTempDirs();

/** The three steps of a compaction session for `marker`: some work, the summary, and the first request after /compact. */
const compactSteps = (marker: string): Step[] => [
  { name: `${marker}#0`, when: all(hasTools, userHas(marker), turn(0)), reply: [{ type: 'text', text: 'working' }] },
  { name: `${marker}#summary`, when: compacting(marker), reply: SUMMARY_REPLY },
  { name: `${marker}#after`, when: all(hasTools, lastHas('E2E-AFTER')), reply: [{ type: 'text', text: 'after' }] },
];

/** Runs the compaction session for `marker` in ws, checks it ran its three steps and fired SessionStart compact, and returns
 *  the text of the first request after /compact. */
async function afterCompact(ws: Workspace, server: ScriptedServer, marker: string): Promise<string> {
  const r = await runClaude(CLAUDE!, { ws, server, turns: COMPACT_TURNS(marker) });
  expect(r.timedOut, failureReport(r, server)).toBe(false);
  expect(server.log.map(l => l.step).filter(Boolean)).toEqual([`${marker}#0`, `${marker}#summary`, `${marker}#after`]);
  expect(r.hooks.find(h => h.event === 'SessionStart' && h.input.source === 'compact')?.input).toMatchObject({ session_id: ws.sessionId });
  return requestText(server.log.find(l => l.step === `${marker}#after`)!.body!);
}

describe.skipIf(!CLAUDE)("forge's text after /compact against the real claude (A8, w7 A2)", () => {
  it("a loose forge task of this session: after /compact the model reads A2's text, with the task, path, phase, brief and round, and to invoke forge:run again", async () => {
    const ws = makeWorkspace(tmp);
    const now = new Date().toISOString();
    // .forge/status.json as the status() of A2's test in tests/forge-route-hooks.test.ts writes it, for this session
    mkdirSync(path.join(ws.repo, '.forge'), { recursive: true });
    writeFileSync(path.join(ws.repo, '.forge', 'status.json'), JSON.stringify({
      ts: now, task: 'cart', path: 'medium', phase: 'review', agent: null, validators: [], verdict: null, round: 2, cap: 3, brief: 2,
      accepted: [], verify: null, taskStartedAt: now, stageSince: now, stages: {}, doneAt: null, lastAt: now,
      session: ws.sessionId, runId: null, project: null,
    }));
    const server = await startMessagesServer(compactSteps('E2E-LOOSE'));
    try {
      const after = await afterCompact(ws, server, 'E2E-LOOSE');
      expect(after).toContain(`forge: this session has the forge task cart open (path medium, phase review, brief 2, round 2 of 3). After the compaction, ${COMPACT_RUN}, and go on from where the task is.`);
    } finally { await server.close(); }
  });

  it("an active infinite run of this session: after /compact the model reads A2's text with forge:infinite", async () => {
    const ws = makeWorkspace(tmp);
    saveRun(ws.repo, startRun(new Date(), { cycles: 3 }, 10, ws.sessionId));
    // the Stop hook blocks the turn ends (stop.e2e.ts): those requests take the fallback, and every scripted step keys on lastHas or turn
    const server = await startMessagesServer(compactSteps('E2E-INF'));
    try {
      const after = await afterCompact(ws, server, 'E2E-INF');
      expect(after).toContain(`forge: this session runs the forge infinite mode (cycle 0). After the compaction, ${COMPACT_INFINITE}, and go on from where the cycle is.`);
    } finally { await server.close(); }
  });
});
