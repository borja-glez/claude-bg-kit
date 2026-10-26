import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { run, defaultGit, type Io } from '../src/forge/cli/run.js';
import { appendEvent } from '../src/forge/ledger.js';
import { parseRun, startRun, stopReason, type RunState } from '../src/forge/run.js';
import { runCost, transcriptCost } from '../src/forge/run-cost.js';
import { projectSlug } from '../src/forge/diagnose-sources.js';
import { useTempDirs } from './helpers/tmp.js';
const tmp = useTempDirs();

// FX2: a spending cap for the autonomous modes (--max-usd, budget.usd), from what the run's transcripts record.

const T0 = '2026-10-26T10:00:00.000Z';
const at = (min: number) => new Date(Date.parse(T0) + min * 60_000).toISOString();
// Opus 5.5: $4 input, $20 output, $0.2 cache read, $8 a 1-hour cache write, $5 a 5-minute one (1.25 × input), per million.
const M = 1_000_000;
const usage = (u: { input?: number; output?: number; read?: number; write1h?: number; write5m?: number }) => ({
  input_tokens: u.input ?? 0, output_tokens: u.output ?? 0, cache_read_input_tokens: u.read ?? 0,
  cache_creation_input_tokens: (u.write1h ?? 0) + (u.write5m ?? 0),
  cache_creation: { ephemeral_1h_input_tokens: u.write1h ?? 0, ephemeral_5m_input_tokens: u.write5m ?? 0 },
});
const assistant = (min: number, id: string, model: string, u: Parameters<typeof usage>[0], block = 'text') => JSON.stringify({
  type: 'assistant', timestamp: at(min), message: { id, model, role: 'assistant', content: [{ type: block, text: 'x' }], usage: usage(u) },
});
const lines = (...l: string[]) => l.join('\n') + '\n';
const ctx = (now = new Date(at(60))) => ({ now, stopFile: false, approvedPending: 0, pendingProposals: 0 });

describe('transcriptCost', () => {
  it('prices each message once (its last line), by its model and the cache it wrote, from the run start on', () => {
    const dir = tmp('forge-cost-tx-');
    const file = path.join(dir, 's1.jsonl');
    writeFileSync(file, lines(
      assistant(-5, 'm0', 'claude-opus-5-5', { output: M }), // before the run: not counted
      assistant(1, 'm1', 'claude-opus-5-5', { input: M }),
      assistant(1, 'm1', 'claude-opus-5-5', { input: M, output: M / 10 }, 'tool_use'), // the same message, its last block
      assistant(2, 'm2', 'claude-sonnet-5-5', { read: M, write1h: M, write5m: M }),
      JSON.stringify({ type: 'user', timestamp: at(3), message: { role: 'user', content: 'usage "usage"' } }),
      '{half a line',
    ));
    const c = transcriptCost(file, Date.parse(T0))!;
    // m1: 4 + 2 = 6; m2 (Sonnet 5.5: $0.1 read, $4 1-hour write, $2.5 a 5-minute one): 0.1 + 4 + 2.5 = 6.6
    expect(c.usd).toBeCloseTo(12.6, 6);
    expect(c).toMatchObject({ messages: 2, unpriced: 0, unread: false });
  });
  it('m11: a line past the read limit is skipped, and the cost says part of it was not read', () => {
    const dir = tmp('forge-cost-long-');
    const file = path.join(dir, 's1.jsonl');
    writeFileSync(file, lines(assistant(1, 'm1', 'claude-opus-5-5', { input: M }), assistant(2, 'm2', 'claude-opus-5-5', { input: M }).replace('"x"', `"${'y'.repeat(2000)}"`)));
    expect(transcriptCost(file, Date.parse(T0), { maxLine: 1000 })).toMatchObject({ usd: 4, messages: 1, unread: true });
  });
  it('counts a model it has no price for as unpriced, unless the message used no tokens', () => {
    const dir = tmp('forge-cost-unpriced-');
    const file = path.join(dir, 's1.jsonl');
    writeFileSync(file, lines(assistant(1, 'm1', 'some-new-model', { input: 10 }), assistant(2, 'm2', '<synthetic>', {}), assistant(3, 'm3', 'claude-haiku-4-5', { output: M })));
    expect(transcriptCost(file, Date.parse(T0))).toMatchObject({ usd: 5, messages: 3, unpriced: 1 });
  });
});

describe('runCost', () => {
  let root: string; let config: string;
  const projects = () => path.join(config, 'projects', projectSlug(root));
  const run0 = (over: Partial<RunState> = {}): RunState => ({ ...startRun(new Date(T0), { cycles: 5, usd: 10 }, 10, 's1'), ...over });
  beforeEach(() => {
    root = tmp('forge-cost-root-');
    config = tmp('forge-cost-config-');
    mkdirSync(projects(), { recursive: true });
  });
  it("adds the run's session, its subagents at any depth and the members of the run's executions since the start", () => {
    writeFileSync(path.join(projects(), 's1.jsonl'), lines(assistant(1, 'a', 'claude-opus-5-5', { input: M })));
    mkdirSync(path.join(projects(), 's1', 'subagents', 'nested'), { recursive: true });
    writeFileSync(path.join(projects(), 's1', 'subagents', 'agent-x.jsonl'), lines(assistant(2, 'b', 'claude-opus-5-5', { output: M / 10 })));
    writeFileSync(path.join(projects(), 's1', 'subagents', 'nested', 'agent-y.jsonl'), lines(assistant(3, 'c', 'claude-opus-5-5', { input: M / 2 })));
    // a member session of the run's execution e1 (its coordinator, s1, logged in it), in another project folder (its worktree)
    mkdirSync(path.join(config, 'projects', 'other'), { recursive: true });
    writeFileSync(path.join(config, 'projects', 'other', 's2.jsonl'), lines(assistant(4, 'd', 'claude-opus-5-5', { input: M })));
    appendEvent(root, { ts: at(2), kind: 'phase', task: 'T1', phase: 'brief', session: 's1', runId: 'e1' });
    appendEvent(root, { ts: at(4), kind: 'phase', task: 'T1', phase: 'implement', session: 's2', runId: 'e1' });
    // m7: another forge session of the person in the same checkout, outside the run's executions, is not the run's
    writeFileSync(path.join(config, 'projects', 'other', 's3.jsonl'), lines(assistant(4, 'e', 'claude-opus-5-5', { input: 25 * M })));
    appendEvent(root, { ts: at(5), kind: 'phase', task: 'fix-x', phase: 'implement', session: 's3' });
    appendEvent(root, { ts: at(5), kind: 'phase', task: 'U1', phase: 'implement', session: 's3', runId: 'other-run' });
    // a session that logged only before the run started is not the run's
    appendEvent(root, { ts: at(-10), kind: 'phase', task: 'T0', phase: 'implement', session: 's0', runId: 'e1' });
    const c = runCost({ main: root, runRoot: root, run: run0(), configDir: config, now: new Date(at(10)) });
    expect(c).toEqual({ usd: 4 + 2 + 2 + 4, partial: false, at: at(10) });
  });
  it('is a lower bound (partial) when a session has no transcript, and unknown when none has one', () => {
    writeFileSync(path.join(projects(), 's1.jsonl'), lines(assistant(1, 'a', 'claude-opus-5-5', { input: M })));
    appendEvent(root, { ts: at(3), kind: 'phase', task: 'T1', phase: 'brief', session: 's1', runId: 'e1' });
    appendEvent(root, { ts: at(4), kind: 'phase', task: 'T1', phase: 'implement', session: 'gone', runId: 'e1' });
    expect(runCost({ main: root, runRoot: root, run: run0(), configDir: config, now: new Date(at(10)) })).toEqual({ usd: 4, partial: true, at: at(10) });
    expect(runCost({ main: root, runRoot: root, run: run0({ sessionId: 'nobody' }), configDir: tmp('forge-cost-empty-'), now: new Date(at(10)) }))
      .toEqual({ usd: null, partial: true, at: at(10) });
  });
});

describe('the usd budget in run.json and the stop', () => {
  const base = startRun(new Date(T0), { cycles: 5, usd: 10 }, 10, 's1');
  it('reads back the usd budget and the cost; a bad usd invalidates the run, a bad cost is dropped', () => {
    expect(base.budget).toEqual({ cycles: 5, usd: 10 });
    const withCost = { ...base, cost: { usd: 3.5, partial: false, at: at(5) } };
    expect(parseRun(JSON.stringify(withCost))).toEqual(withCost);
    expect(parseRun(JSON.stringify({ ...base, cost: { usd: null, partial: true, at: at(5) } }))!.cost).toEqual({ usd: null, partial: true, at: at(5) });
    for (const usd of [0, -1, '5', null]) expect(parseRun(JSON.stringify({ ...base, budget: { cycles: 5, usd } }))).toBeNull();
    for (const cost of [{ usd: -1, partial: false, at: at(5) }, { usd: 'x', partial: false, at: at(5) }, { usd: 1, at: at(5) }, 'x'])
      expect(parseRun(JSON.stringify({ ...base, cost }))).not.toHaveProperty('cost');
  });
  it('stops at budget-usd once the counted cost reaches the cap; an unknown cost never stops it', () => {
    expect(stopReason(base, ctx())).toBeNull();
    expect(stopReason({ ...base, cost: { usd: 9.99, partial: false, at: at(5) } }, ctx())).toBeNull();
    expect(stopReason({ ...base, cost: { usd: 10, partial: false, at: at(5) } }, ctx())).toBe('budget-usd');
    // a lower bound already over the cap stops it too
    expect(stopReason({ ...base, cost: { usd: 12, partial: true, at: at(5) } }, ctx())).toBe('budget-usd');
    expect(stopReason({ ...base, cost: { usd: null, partial: true, at: at(5) } }, ctx())).toBeNull();
    // the cycles budget still comes first
    expect(stopReason({ ...base, cycle: 5, cost: { usd: 12, partial: false, at: at(5) } }, ctx())).toBe('budget-cycles');
  });
});

describe('forge infinite start --max-usd and the cycle that measures it', () => {
  let root: string; let config: string; let io: Io;
  const readRun = () => JSON.parse(readFileSync(path.join(root, '.forge', 'run.json'), 'utf8'));
  const tx = (...l: string[]) => writeFileSync(path.join(config, 'projects', projectSlug(root), 's1.jsonl'), lines(...l));
  beforeEach(() => {
    root = tmp('forge-cost-cli-');
    config = tmp('forge-cost-cli-config-');
    mkdirSync(path.join(config, 'projects', projectSlug(root)), { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
    io = { cwd: root, now: () => new Date(T0), git: defaultGit(root), env: { CLAUDE_CONFIG_DIR: config } };
  });
  it('takes --max-usd, or budget.usd from the config, and refuses one that is not a positive number', () => {
    for (const v of ['0', '-3', 'abc']) expect(run(['infinite', 'start', '--cycles', '3', '--max-usd', v, '--session', 's1'], io).code).toBe(2);
    mkdirSync(path.join(root, '.forge'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'config.yaml'), 'budget:\n  usd: 7.5\n');
    expect(run(['infinite', 'start', '--cycles', '3', '--session', 's1'], io).code).toBe(0);
    expect(readRun().budget).toEqual({ cycles: 3, usd: 7.5 });
    run(['stop'], io);
    expect(run(['infinite', 'start', '--hours', '2', '--max-usd', '20', '--session', 's1'], io).code).toBe(0);
    expect(readRun().budget).toEqual({ hours: 2, usd: 20 });
    // a cap alone is no budget: an unknown cost would never stop the run
    run(['stop'], io);
    const alone = run(['infinite', 'start', '--max-usd', '20', '--session', 's1'], io);
    expect(alone.code).toBe(2);
    expect(alone.stderr).toContain('--cycles');
    // m9: a config that does not load is refused with or without the cap: the first cycle would fail on it anyway
    writeFileSync(path.join(root, '.forge', 'config.yaml'), 'budget:\n  usd: -1\n');
    for (const cap of [[], ['--max-usd', '4']]) {
      const broken = run(['infinite', 'start', '--cycles', '3', ...cap, '--session', 's1'], io);
      expect(broken.code).toBe(2);
      expect(broken.stderr).toContain('fix `.forge/config.yaml`');
      expect(broken.stderr).not.toContain('--max-usd');
    }
  });
  it('m10: a start with a cap says once that it is a lower bound checked between cycles', () => {
    const out = JSON.parse(run(['infinite', 'start', '--cycles', '3', '--max-usd', '5', '--session', 's1'], io).stdout);
    expect(out.costNote).toMatch(/lower bound/);
    expect(out.costNote).toMatch(/after each cycle/);
    run(['stop'], io);
    expect(JSON.parse(run(['infinite', 'start', '--cycles', '3', '--session', 's1'], io).stdout)).not.toHaveProperty('costNote');
  });
  it('each cycle records what the run spent; at the cap the run stops cleanly with budget-usd', () => {
    expect(run(['infinite', 'start', '--cycles', '9', '--max-usd', '5', '--session', 's1'], io).code).toBe(0);
    tx(assistant(1, 'a', 'claude-opus-5-5', { input: M / 2 }));
    io = { ...io, now: () => new Date(at(10)) };
    const first = JSON.parse(run(['cycle', '--progress', 'yes'], io).stdout);
    expect(first.cost).toEqual({ usd: 2, partial: false, at: at(10) });
    expect(first).not.toHaveProperty('costNote');
    expect(JSON.parse(run(['infinite', 'status'], io).stdout).stopReason).toBeNull();
    tx(assistant(1, 'a', 'claude-opus-5-5', { input: M / 2 }), assistant(12, 'b', 'claude-opus-5-5', { output: M / 5 }));
    io = { ...io, now: () => new Date(at(20)) };
    expect(JSON.parse(run(['cycle', '--progress', 'yes'], io).stdout).cost.usd).toBeCloseTo(6, 6);
    expect(JSON.parse(run(['infinite', 'status'], io).stdout).stopReason).toBe('budget-usd');
    const hook = JSON.parse(run(['hook', 'stop'], { ...io, stdin: JSON.stringify({ session_id: 's1' }) }).stdout);
    expect(hook.reason).toContain('the forge infinite run ended (budget-usd)');
    expect(readRun()).toMatchObject({ active: false, stoppedReason: 'budget-usd' });
  });
  it('says so when the cost cannot be counted, and the run goes on to its other limits', () => {
    expect(run(['infinite', 'start', '--cycles', '2', '--max-usd', '5', '--session', 's1'], io).code).toBe(0);
    const out = JSON.parse(run(['cycle', '--progress', 'yes'], io).stdout);
    expect(out.cost).toMatchObject({ usd: null, partial: true });
    expect(out.costNote).toMatch(/^cost unknown: /);
    expect(JSON.parse(run(['infinite', 'status'], io).stdout)).toMatchObject({ stopReason: null, costNote: expect.stringMatching(/^cost unknown: /) });
    // without a usd cap, the cycle measures nothing
    run(['stop'], io);
    run(['infinite', 'start', '--cycles', '2', '--session', 's1'], io);
    expect(JSON.parse(run(['cycle', '--progress', 'yes'], io).stdout)).not.toHaveProperty('cost');
  });
  it("m9: a profile takes budget.usd from its worktree's config, the one its run trusts, and tolerates one that does not load", () => {
    const g = (...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    g('config', 'user.email', 'a@b.c'); g('config', 'user.name', 't'); g('config', 'core.autocrlf', 'false');
    writeFileSync(path.join(root, 'a.txt'), 'a'); g('add', 'a.txt'); g('commit', '-qm', 'a');
    const prepared = JSON.parse(run(['infinite', 'prepare', '--profile', 'spike', '--name', 'tetris'], io).stdout) as { worktree: string };
    mkdirSync(path.join(root, '.forge'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'config.yaml'), 'budget:\n  usd: 9\n');
    mkdirSync(path.join(prepared.worktree, '.forge'), { recursive: true });
    writeFileSync(path.join(prepared.worktree, '.forge', 'config.yaml'), 'budget:\n  usd: 3\n');
    const wt = { ...io, cwd: prepared.worktree, git: defaultGit(prepared.worktree) };
    expect(run(['infinite', 'start', '--profile', 'spike', '--name', 'tetris', '--hours', '2', '--session', 'c1'], wt).code).toBe(0);
    expect(readRun().budget).toEqual({ hours: 2, usd: 3 });
    run(['stop'], io);
    writeFileSync(path.join(prepared.worktree, '.forge', 'config.yaml'), 'budget:\n  usd: -1\n');
    expect(run(['infinite', 'start', '--profile', 'spike', '--name', 'tetris', '--hours', '2', '--session', 'c2'], wt).code).toBe(0);
    expect(readRun().budget).toEqual({ hours: 2 });
  });
  it('the Stop hook block shows what was spent of the cap', () => {
    run(['infinite', 'start', '--cycles', '9', '--max-usd', '5', '--session', 's1'], io);
    tx(assistant(1, 'a', 'claude-opus-5-5', { input: M / 4 }));
    run(['cycle', '--progress', 'yes'], io);
    expect(JSON.parse(run(['hook', 'stop'], { ...io, stdin: JSON.stringify({ session_id: 's1' }) }).stdout).reason).toContain('$1.00 of $5 spent');
  });
});
