// A8: the first scripted turn of the real claude (see tests/e2e/README.md).
import { describe, expect, it } from 'vitest';
import { findClaude } from './harness/claude-bin.js';
import { all, hasTools, requestText, startMessagesServer, turn, userHas } from './harness/messages-server.js';
import { failureReport, runClaude } from './harness/session.js';
import { FIXTURE_KEYS_NOT_SENT, hookFixture, makeWorkspace } from './harness/workspace.js';
import { useTempDirs } from '../helpers/tmp.js';

const CLAUDE = findClaude(process.env);
const tmp = useTempDirs();

describe.skipIf(!CLAUDE)('claude against the scripted API (smoke, A8)', () => {
  it("one scripted turn: forge's SessionStart text reaches the model, the result is a success, and the probe sees SessionStart startup, with the fixture's keys but model, and Stop", async () => {
    const ws = makeWorkspace(tmp);
    const server = await startMessagesServer([{ name: 'smoke#0', when: all(hasTools, userHas('E2E-SMOKE'), turn(0)), reply: [{ type: 'text', text: 'smoke done' }] }]);
    try {
      const r = await runClaude(CLAUDE!, { ws, server, turns: ['E2E-SMOKE: reply with one line'] });
      expect(r.timedOut, failureReport(r, server)).toBe(false);
      expect(r.code).toBe(0);
      const used = server.log.filter(l => l.step === 'smoke#0');
      expect(used).toHaveLength(1);
      expect(requestText(used[0].body!)).toContain('<FORGE-ROUTING>');
      expect(requestText(used[0].body!)).not.toMatch(/\(project instructions|\(user's private global instructions/);
      const init = r.out.find(l => l.type === 'system' && l.subtype === 'init');
      expect(init).toMatchObject({ session_id: ws.sessionId, mcp_servers: [] });
      const plugins = (init?.plugins ?? []) as { name: string; path?: string }[];
      expect(plugins.filter(p => p.path !== 'builtin').map(p => p.name).sort()).toEqual(['bgkit-e2e-probe', 'forge', 'waypoint']);
      expect(r.out.filter(l => l.type === 'result')).toMatchObject([{ subtype: 'success', is_error: false, result: 'smoke done' }]);
      const start = r.hooks.find(h => h.event === 'SessionStart');
      expect(start?.input).toMatchObject({ source: 'startup', session_id: ws.sessionId, cwd: expect.any(String) });
      for (const k of Object.keys(hookFixture('session-start-startup')).filter(k => !FIXTURE_KEYS_NOT_SENT.includes(k))) expect(start?.input, k).toHaveProperty(k);
      for (const k of FIXTURE_KEYS_NOT_SENT) expect(start?.input, `${k} now arrives: take it out of FIXTURE_KEYS_NOT_SENT and the README smoke row`).not.toHaveProperty(k);
      expect(r.hooks.some(h => h.event === 'Stop' && h.input.session_id === ws.sessionId)).toBe(true);
    } finally { await server.close(); }
  });
});
