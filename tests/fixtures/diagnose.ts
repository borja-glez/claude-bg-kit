// A6: the known case of forge diagnose: the loose Medium task fix-login in two briefs, run by session s1. Brief 1: no begin, a
// prep repeated after a compaction, reviewers spawned before review-prep ended, a review-close that failed once. Brief 2: a
// review-prep job whose --out holds {error, code}, then reviewers and a review-close on top of it, and a reviewer with no result.
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { projectSlug } from '../../src/forge/diagnose-sources.js';
import { TX_AT as at, assistantText, compaction, jsonl, toolResult, toolUse, userText } from '../helpers/transcript.js';

export const DIAG_NOW = at(120);
const F = 'node /p/forge.cjs';
const U1 = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20,
  cache_creation: { ephemeral_1h_input_tokens: 20, ephemeral_5m_input_tokens: 0 } };
const prep = (n: number) => `${F} prep --task fix-login-${n} --path medium`;
const rp = (n: number, more = '') => `${F} review-prep --task fix-login-${n} --path medium --base abc1234 --baseline .forge/work/fix-login/baseline-${n}.json --dir .forge/work/fix-login${more}`;
const rc = (n: number) => `${F} review-close --task fix-login-${n} --dir .forge/work/fix-login --path medium`;
const agent = (type: string, description: string, n: number) => ({ subagent_type: `forge:${type}`, description, prompt: `forge-task: fix-login-${n}\nGo.` });
const launched = (agentId: string) => ({ text: 'Async agent launched successfully.', toolUseResult: { isAsync: true, status: 'async_launched', agentId } });

export const DIAG_LEDGER = [
  /* 1 */ { ts: at(1), kind: 'triage', task: 'fix-login', path: 'medium', reasons: ['size'], session: 's1' },
  /* 2 */ { ts: at(2), kind: 'triage', task: 'other', path: 'small', reasons: [], session: 's1' },
  /* 3 */ { ts: at(3), kind: 'phase', task: 'fix-login-1', phase: 'implement', brief: 1, base: 'abc1234', session: 's1' },
  /* 4 */ { ts: at(20), kind: 'phase', task: 'fix-login-1', phase: 'review', brief: 1, round: 1, session: 's1' },
  /* 5 */ { ts: at(30.5), kind: 'verdict', task: 'fix-login-1', action: 'accept', score: 9, dir: '.forge/work/fix-login/reviews-1-1', session: 's1' },
  /* 6 */ { ts: at(40), kind: 'phase', task: 'fix-login-2', phase: 'implement', brief: 2, base: 'abc1234', session: 's1' },
  /* 7 */ { ts: at(70), kind: 'verdict', task: 'fix-login-2', action: 'accept', score: 8, dir: '.forge/work/fix-login/reviews-2-1', session: 's1' },
];

export const DIAG_TRANSCRIPT = [
  /* 1 */ userText(at(0), 'forge: fix the login'),
  /* 2 */ toolUse(at(0.5), 'b1', 'Bash', { command: `${F} triage --task fix-login --text-file .forge/work/fix-login/task.txt` }),
  /* 3 */ toolResult(at(1), 'b1', { text: '{"path":"medium"}' }),
  /* 4 */ toolUse(at(2), 'b2', 'Bash', { command: prep(1) }, { id: 'm2', usage: U1 }),
  /* 5 */ assistantText(at(2), 'Prepared.', { id: 'm2', usage: U1 }),
  /* 6 */ toolResult(at(3), 'b2', { text: '{"base":"abc1234"}' }),
  /* 7 */ compaction(at(5), 'auto', 150000),
  /* 8 */ toolUse(at(6), 'b3', 'Bash', { command: prep(1) }),
  /* 9 */ toolResult(at(7), 'b3', { text: '{"base":"abc1234"}' }),
  /* 10 */ toolUse(at(8), 'g1', 'Agent', { ...agent('forge-impl', 'Implement brief 1', 1), run_in_background: true }, { id: 'm4', usage: { input_tokens: 1, output_tokens: 2 } }),
  /* 11 */ toolResult(at(8), 'g1', launched('a1')),
  /* 12 */ toolUse(at(15), 'g2', 'Agent', agent('forge-review-correctness', 'Review brief 1 correctness', 1)),
  /* 13 */ toolUse(at(15), 'b4', 'Bash', { command: rp(1) }),
  /* 14 */ toolResult(at(15), 'g2', launched('a2')),
  /* 15 */ toolResult(at(20), 'b4', { text: '{"round":1}' }),
  /* 16 */ toolUse(at(29), 'b5', 'Bash', { command: rc(1) }),
  /* 17 */ toolResult(at(29.5), 'b5', { error: 'Exit code 3\n{"missing":["correctness.json"]}' }),
  /* 18 */ toolUse(at(30), 'b6', 'Bash', { command: rc(1) }),
  /* 19 */ toolResult(at(30.5), 'b6', { text: '{"action":"accept"}' }),
  /* 20 */ toolUse(at(39), 'b7', 'Bash', { command: prep(2) }),
  /* 21 */ toolResult(at(40), 'b7', { text: '{"base":"abc1234"}' }),
  /* 22 */ toolUse(at(41), 'g3', 'Agent', { ...agent('forge-impl', 'Implement brief 2', 2), run_in_background: true }),
  /* 23 */ toolResult(at(41), 'g3', launched('a3')),
  /* 24 */ toolUse(at(55), 'b8', 'Bash', { command: rp(2, ' --out .forge/work/fix-login/review-prep-2.json'), run_in_background: true }),
  /* 25 */ toolResult(at(55), 'b8', { text: 'Command running in background with ID: bx1', toolUseResult: { backgroundTaskId: 'bx1' } }),
  /* 26 */ toolUse(at(60), 'g4', 'Agent', agent('forge-review-correctness', 'Review brief 2 correctness', 2)),
  /* 27 */ toolResult(at(60), 'g4', launched('a4')),
  /* 28 */ toolUse(at(69), 'b9', 'Bash', { command: rc(2) }),
  /* 29 */ toolResult(at(70), 'b9', { text: '{"action":"accept"}' }),
  /* 30 */ toolUse(at(75), 'g5', 'Agent', agent('forge-review-security', 'Review brief 2 security', 2)),
];

/** The implementer of brief 1 (agent a1): it ran the validate command prep printed. */
export const DIAG_SUBAGENT = [
  /* 1 */ userText(at(8), 'forge-task: fix-login-1\nGo.'),
  /* 2 */ toolUse(at(12), 'sb1', 'Bash', { command: `${F} validate --all --task fix-login-1` }, { id: 'sm1', usage: { input_tokens: 3, output_tokens: 4 } }),
  /* 3 */ toolResult(at(14), 'sb1', { text: '{"ok":true}' }),
];

const put = (file: string, text: string) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); return file; };

/** Writes the fixture's .forge/ under `root` and its transcripts under `configDir`, as CLAUDE_CONFIG_DIR keeps them. */
export function writeDiagnoseFixture(root: string, configDir: string): { transcript: string; subagent: string } {
  put(path.join(root, '.forge', 'ledger.jsonl'), jsonl(DIAG_LEDGER.map(e => JSON.stringify(e))));
  put(path.join(root, '.forge', 'work', 'fix-login', 'brief-1.md'), '# brief 1\n');
  const out = put(path.join(root, '.forge', 'work', 'fix-login', 'review-prep-2.json'), '{"error":"forge: boom","code":1}\n');
  utimesSync(out, new Date(at(56)), new Date(at(56)));
  const transcript = put(path.join(configDir, 'projects', projectSlug(root), 's1.jsonl'), jsonl(DIAG_TRANSCRIPT));
  const subagent = put(path.join(path.dirname(transcript), 's1', 'subagents', 'agent-a1.jsonl'), jsonl(DIAG_SUBAGENT));
  put(path.join(path.dirname(subagent), 'agent-a1.meta.json'), JSON.stringify({ agentType: 'forge:forge-impl', description: 'Implement brief 1', toolUseId: 'g1', spawnDepth: 1 }));
  return { transcript, subagent };
}
