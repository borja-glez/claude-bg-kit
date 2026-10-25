import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { forgeInvocations, readTranscript } from '../src/forge/diagnose-transcript.js';
import { TX_AT as at, assistantText, compaction, jsonl, toolResult, toolUse, userText } from './helpers/transcript.js';
import { useTempDirs } from './helpers/tmp.js';

const tmp = useTempDirs();
const U1 = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20,
  cache_creation: { ephemeral_1h_input_tokens: 20, ephemeral_5m_input_tokens: 0 } };

describe('the forge calls of a shell command (A6, Review Focus 2)', () => {
  it.each([
    ['node /p/forge.cjs prep --task fix-1 --path medium', [['prep', 'fix-1', null]]],
    ['node "C:/Program Files/x/forge.cjs" --cwd wt review-prep --task fix-1 --out .forge/work/fix/review-prep-1.json',
      [['review-prep', 'fix-1', '.forge/work/fix/review-prep-1.json']]],
    ['& node.exe "C:\\x\\forge.cjs" swarm step --plan p --out .forge/work/run/step.json', [['swarm step', null, '.forge/work/run/step.json']]],
    ["FORGE='node /p/forge.cjs'; $FORGE prefs; echo ---; ${FORGE} tree snapshot --task fix", [['prefs', null, null], ['tree snapshot', 'fix', null]]],
    ['node /p/forge.cjs triage --task a && node /p/forge.cjs begin --task a', [['triage', 'a', null], ['begin', 'a', null]]],
    ['node /p/forge.cjs roadmap-doc fix-login --out f.json', [['roadmap-doc', null, 'f.json']]],
    ['node /p/forge.cjs swarm worktree T001 --member s2', [['swarm worktree', 'T001', null]]],
    ['node /p/forge.cjs swarm sleep 300 --mark', [['swarm sleep', null, null]]],
    ['grep -n "forge.cjs prep" README.md', []],
    // An alias assigned twice is still one alias: each use is one call.
    ["FORGE='node /p/forge.cjs'; FORGE='node /p/forge.cjs'; $FORGE prep --task fix-1", [['prep', 'fix-1', null]]],
    // A flag with no value: the next word is another flag, not its value.
    ['node /p/forge.cjs prep --task --out x', [['prep', null, 'x']]],
    ['node /p/forge.cjs review-prep --out --task fix-1', [['review-prep', 'fix-1', null]]],
  ])('%s', (command, want) => {
    expect(forgeInvocations(command).map(i => [i.name, i.task, i.out])).toEqual(want);
  });
});

describe('the facts of a transcript (A6)', () => {
  it('keeps the calls, their results, the compactions, the usage once per message and the last time; a cut or a junk line is skipped', () => {
    const f = path.join(tmp('tx-'), 's1.jsonl');
    writeFileSync(f, jsonl([
      userText(at(0), 'go'),
      toolUse(at(1), 'b1', 'Bash', { command: 'node /p/forge.cjs prep --task fix-1 --path medium' }, { id: 'm1', usage: U1 }),
      assistantText(at(1), 'ok', { id: 'm1', usage: U1 }),
      toolResult(at(2), 'b1', { text: '{}' }),
      toolUse(at(3), 'b2', 'Bash', { command: 'node /p/forge.cjs review-close --task fix-1 --dir d --path medium' }),
      toolResult(at(4), 'b2', { error: 'Exit code 3\n{"missing":[]}' }),
      toolUse(at(5), 'b3', 'Bash', { command: 'node /p/forge.cjs review-prep --task fix-1 --out .forge/work/fix/review-prep-1.json', run_in_background: true }),
      toolResult(at(5), 'b3', { text: 'Command running in background with ID: bx', toolUseResult: { backgroundTaskId: 'bx' } }),
      compaction(at(6), 'auto', 150000),
      toolUse(at(7), 'g1', 'Agent', { subagent_type: 'forge:forge-review-correctness', description: 'Review brief 1 correctness',
        prompt: 'forge-task: T001-1 @shop\nReview.' }, { id: 'm2', usage: { input_tokens: 1, output_tokens: 2 } }),
      toolResult(at(7), 'g1', { text: 'Async agent launched', toolUseResult: { isAsync: true, status: 'async_launched', agentId: 'a1' } }),
      toolUse(at(8), 'r1', 'Read', { file_path: '/x' }),
      'x'.repeat(5000),
      'not json',
      '{"type":"assistant","timestamp":"',
    ]).replace(/\n$/, ''));
    // Every other line is under 1 000 bytes: only the run of x goes over the cap.
    const facts = readTranscript(f, { maxLine: 2000 })!;
    expect(facts.stats).toMatchObject({ lines: 15, long: [13], truncated: false });
    expect(facts.calls.map(c => [c.line, c.id, c.tool, c.background])).toEqual([[2, 'b1', 'Bash', false], [5, 'b2', 'Bash', false], [7, 'b3', 'Bash', true], [10, 'g1', 'Agent', false], [12, 'r1', 'Read', false]]);
    expect(facts.calls[0]).toMatchObject({ ts: at(1), forge: [{ name: 'prep', task: 'fix-1', out: null }], agent: null });
    expect(facts.calls[3].agent).toEqual({ type: 'forge:forge-review-correctness', description: 'Review brief 1 correctness', task: 'T001-1', project: 'shop' });
    expect(facts.calls[4]).toMatchObject({ forge: [], agent: null });
    expect([...facts.results].map(([id, r]) => [id, r.line, r.exit, r.error, r.launched, r.agentId])).toEqual([
      ['b1', 4, 0, false, false, null], ['b2', 6, 3, true, false, null], ['b3', 8, null, false, true, null], ['g1', 11, null, false, true, 'a1'],
    ]);
    expect(facts.compactions).toEqual([{ line: 9, ts: at(6), trigger: 'auto', preTokens: 150000 }]);
    expect(facts.usageLines).toBe(3);
    expect(facts.messages).toEqual([
      { id: 'm1', line: 3, lines: 2, ts: at(1), tokens: { input: 10, output: 5, cacheRead: 100, cacheWrite: 20, cacheWrite1h: 20 } },
      { id: 'm2', line: 10, lines: 1, ts: at(7), tokens: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0 } },
    ]);
    expect(facts.lastTs).toBe(at(8));
  });
  it('is null for a file the safe reader refuses', () => {
    expect(readTranscript('s1.jsonl')).toBeNull();
  });
});
