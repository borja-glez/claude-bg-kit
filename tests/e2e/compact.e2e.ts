// A8: /compact against the real claude: the hooks it fires and what Claude Code attaches again afterwards (see tests/e2e/README.md).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findClaude } from './harness/claude-bin.js';
import { COMPACT_TURNS, compacting, skillUse, SUMMARY_REPLY } from './harness/compact.js';
import { all, hasTools, lastHas, requestText, startMessagesServer, turn, userHas } from './harness/messages-server.js';
import { failureReport, runClaude } from './harness/session.js';
import { hookFixture, makeWorkspace, PLUGIN_DIRS } from './harness/workspace.js';
import { useTempDirs } from '../helpers/tmp.js';

const CLAUDE = findClaude(process.env);
const tmp = useTempDirs();

// The values below were read from the server log of a real run (see the README).
const PINNED_COMPACT = { summary: true, skillHead: true, skillTail: true, reference: true };

const lines = (file: string) => readFileSync(file, 'utf8').split('\n').map(l => l.trim()).filter(l => l !== '');

describe.skipIf(!CLAUDE)('/compact against the real claude (A8)', () => {
  it('/compact: PreCompact and SessionStart compact fire with the fixture keys, and the next request shows what Claude Code attached again', async () => {
    const skill = path.join(PLUGIN_DIRS.forge, 'skills', 'run', 'SKILL.md');
    const ref = path.join(PLUGIN_DIRS.forge, 'skills', 'run', 'references', 'large.md');
    const skillLines = lines(skill);
    const head = skillLines[skillLines.indexOf('---', 1) + 1]; // the first non-empty line after the frontmatter
    const tail = skillLines[skillLines.length - 1];
    const skillText = readFileSync(skill, 'utf8');
    const refLine = lines(ref).find(l => !skillText.includes(l))!; // the first line of large.md that SKILL.md does not contain ("# Large" is a substring of its "## Large")
    const ws = makeWorkspace(tmp);
    const step = (n: number) => all(hasTools, userHas('E2E-COMPACT'), turn(n));
    const server = await startMessagesServer([
      { name: 'compact#0', when: step(0), reply: r => [skillUse(r, 'toolu_e2e_compact_0', 'forge:run')] },
      { name: 'compact#1', when: step(1), reply: [{ type: 'tool_use', id: 'toolu_e2e_compact_1', name: 'Read', input: { file_path: ref } }] },
      { name: 'compact#2', when: step(2), reply: [{ type: 'text', text: 'loaded' }] },
      { name: 'compact#summary', when: compacting('E2E-COMPACT'), reply: SUMMARY_REPLY },
      { name: 'after#0', when: all(hasTools, lastHas('E2E-AFTER')), reply: [{ type: 'text', text: 'after' }] },
    ]);
    try {
      const r = await runClaude(CLAUDE!, { ws, server, turns: COMPACT_TURNS('E2E-COMPACT') });
      expect(r.timedOut, failureReport(r, server)).toBe(false);
      expect(server.log.map(l => l.step).filter(Boolean)).toEqual(['compact#0', 'compact#1', 'compact#2', 'compact#summary', 'after#0']);
      expect(r.hooks.find(h => h.event === 'PreCompact')?.input).toMatchObject({ trigger: 'manual', session_id: ws.sessionId });
      const start = r.hooks.find(h => h.event === 'SessionStart' && h.input.source === 'compact');
      expect(start?.input).toMatchObject({ session_id: ws.sessionId });
      for (const k of Object.keys(hookFixture('session-start-compact'))) expect(start?.input, k).toHaveProperty(k);
      const after = requestText(server.log.find(l => l.step === 'after#0')!.body!);
      const observed = { summary: after.includes('E2E compact summary'), skillHead: after.includes(head), skillTail: after.includes(tail), reference: after.includes(refLine) };
      expect(observed).toEqual(PINNED_COMPACT);
    } finally { await server.close(); }
  });
});
