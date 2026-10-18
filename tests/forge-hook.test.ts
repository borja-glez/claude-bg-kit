import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { startRun, recordCycle } from '../src/forge/run.js';
import { decideStop, decideExecutionStop } from '../src/forge/hook.js';
import type { ExecutionState } from '../src/lib/execution-state.js';
import { run } from '../src/forge/cli/run.js';
import { authDir, readAuths, writeAuth, type AuthRecord } from '../src/forge/auth.js';
import { useTempDirs } from './helpers/tmp.js';
import { hookAnswerInput } from './helpers/hook-answer.js';

const T0 = new Date('2026-10-11T10:00:00.000Z');
const ctx = (over: Partial<{ now: Date; stopFile: boolean; approvedPending: number; pendingProposals: number; ledgerEvents: number }> = {}) =>
  ({ now: T0, stopFile: false, approvedPending: 0, pendingProposals: 0, ledgerEvents: 5, ...over });

// A run is bound to its session when it starts (C1, K5-03): that session's Stop hook input carries its id.
const A = { session_id: 'a' };
const bound = (budget: Parameters<typeof startRun>[1] = {}) => startRun(T0, budget, 10, 'a');

describe('decideStop', () => {
  it('does not block without a run or with an inactive one', () => {
    expect(decideStop(A, null, ctx())).toEqual({ block: false, run: null });
    const off = { ...bound(), active: false };
    expect(decideStop(A, off, ctx())).toEqual({ block: false, run: off });
  });
  it('blocks an active run and records the ledger event count', () => {
    const d = decideStop({ ...A, stop_hook_active: false }, bound({ cycles: 3 }), ctx());
    expect(d.block).toBe(true);
    if (!d.block) return;
    expect(d.run.lastBlockEvents).toBe(5);
    expect(d.reason).toContain('forge infinite mode is active (cycle 1 of 3)');
    expect(d.reason).toContain('.forge/stop');
    expect(d.reason).toContain('/forge:stop');
  });
  it('names the end time for an hours budget', () => {
    const d = decideStop(A, bound({ hours: 2 }), ctx());
    expect(d.block && d.reason).toContain('until 12:00 UTC');
  });
  it('lets the stop through with stop_hook_active when the ledger has no new events', () => {
    const run = { ...bound(), lastBlockEvents: 5 };
    expect(decideStop({ ...A, stop_hook_active: true }, run, ctx())).toEqual({ block: false, run });
  });
  it('blocks again with stop_hook_active when the ledger has new events', () => {
    const run = { ...bound(), lastBlockEvents: 5 };
    const d = decideStop({ ...A, stop_hook_active: true }, run, ctx({ ledgerEvents: 7 }));
    expect(d.block).toBe(true);
    expect(d.run?.lastBlockEvents).toBe(7);
  });
  it('a stop reason marks the run inactive and blocks once to close it', () => {
    const d = decideStop(A, bound(), ctx({ stopFile: true }));
    expect(d.block).toBe(true);
    if (!d.block) return;
    expect(d.ended).toBe('stop-file');
    expect(d.reason).toBe('the forge infinite run ended (stop-file): do step 4 of /forge:infinite (turn off meta/infinite and report), then stop.');
    expect(d.run).toMatchObject({ active: false, stoppedReason: 'stop-file', sessionId: 'a' });
    // Once inactive it never blocks again, whatever the context.
    expect(decideStop(A, d.run, ctx({ stopFile: true }))).toEqual({ block: false, run: d.run });
    expect(decideStop({ ...A, stop_hook_active: true }, d.run, ctx({ ledgerEvents: 99 }))).toEqual({ block: false, run: d.run });
  });
  it('blocks once even with stop_hook_active and an unchanged ledger when the run ends', () => {
    const run = { ...bound({ cycles: 2 }), cycle: 2, lastBlockEvents: 5 };
    const d = decideStop({ ...A, stop_hook_active: true }, run, ctx());
    expect(d.block && d.ended).toBe('budget-cycles');
  });
  it('counts blocks since the last cycle and ends the run with no-cycle after 2', () => {
    let run = bound();
    const first = decideStop(A, run, ctx());
    expect(first.block && first.run.blocksSinceCycle).toBe(1);
    const second = decideStop({ ...A, stop_hook_active: true }, first.run!, ctx({ ledgerEvents: 6 }));
    expect(second.block && second.ended).toBeFalsy();
    expect(second.run?.blocksSinceCycle).toBe(2);
    const third = decideStop({ ...A, stop_hook_active: true }, second.run!, ctx({ ledgerEvents: 7 }));
    expect(third.block && third.ended).toBe('no-cycle');
    // A recorded cycle resets the count.
    run = recordCycle(second.run!, { progress: true });
    expect(run.blocksSinceCycle).toBe(0);
    const next = decideStop(A, run, ctx({ ledgerEvents: 8 }));
    expect(next.block).toBe(true);
    expect(next.run).toMatchObject({ active: true, blocksSinceCycle: 1 });
  });
  it('never blocks another session or a call without a session id', () => {
    const run = bound();
    expect(decideStop({ session_id: 'b' }, run, ctx())).toEqual({ block: false, run });
    expect(decideStop({}, run, ctx())).toEqual({ block: false, run });
    expect(decideStop({ session_id: 'b' }, run, ctx({ stopFile: true }))).toEqual({ block: false, run });
  });
  it('a run without a session (started by forge 0.15) blocks no one and is never bound (K5-03)', () => {
    const run = startRun(T0, { cycles: 3 });
    for (const input of [{}, A, { session_id: 'b', stop_hook_active: true }]) {
      expect(decideStop(input, run, ctx())).toEqual({ block: false, run });
      expect(decideStop(input, run, ctx({ stopFile: true }))).toEqual({ block: false, run });
    }
  });
  it('the bound session still follows the usual rules', () => {
    const run = bound();
    const d = decideStop(A, run, ctx());
    expect(d.block).toBe(true);
    expect(decideStop({ ...A, stop_hook_active: true }, d.run!, ctx())).toEqual({ block: false, run: d.run });
    const ended = decideStop(A, run, ctx({ stopFile: true }));
    expect(ended.block).toBe(true);
    expect(ended.run).toMatchObject({ active: false, stoppedReason: 'stop-file', sessionId: 'a' });
  });
});

const ex = (over: Partial<ExecutionState> = {}): ExecutionState => ({
  runId: 'r1', kind: 'plan', mode: 'subagents', parallel: 3, project: 'shop', base: 'main', branch: 'forge/run-shop', mergeOnFinish: false,
  coordinator: 'main', hookSession: 's1', active: true, stopReason: null, stallReason: null, startedAt: '2026-10-12T11:00:00.000Z',
  lastStepAt: '2026-10-12T11:59:00.000Z', lastBlockStep: null, sleepUntil: null, tasks: {}, ...over,
});
const xnow = new Date('2026-10-12T12:00:00.000Z');
const xtask = (agent: string | null, updatedAt: string) => ({ T1: { status: 'running' as const, stage: 'implement' as const, round: 1, worktree: '/w', branch: 'task/T1', executor: 'subagents' as const, attempts: 0, agent, startedAt: updatedAt, stageSince: updatedAt, updatedAt, detail: null } });

describe('decideExecutionStop', () => {
  it('blocks the bound session of an active execution once per step, and no other session', () => {
    const d = decideExecutionStop({ session_id: 's1' }, ex(), { now: xnow, stopFile: false, jobs: [] });
    expect(d.block).toBe(true);
    if (d.block) expect(d.reason).toContain('forge execution is active (0/3 running)');
    expect(decideExecutionStop({ session_id: 's2' }, ex(), { now: xnow, stopFile: false, jobs: [] }).block).toBe(false);
    expect(decideExecutionStop({}, ex(), { now: xnow, stopFile: false, jobs: [] }).block).toBe(false);
    expect(decideExecutionStop({ session_id: 's1', stop_hook_active: true }, ex({ lastBlockStep: '2026-10-12T11:59:00.000Z' }), { now: xnow, stopFile: false, jobs: [] }).block).toBe(false);
  });
  it('never blocks while an agent of a task is running (it wakes the session)', () => {
    expect(decideExecutionStop({ session_id: 's1' }, ex({ tasks: xtask('forge-impl', '2026-10-12T11:58:00.000Z') }), { now: xnow, stopFile: false, jobs: [] }).block).toBe(false);
    // An agent that has not reported for longer than a lease does not hold the block back.
    expect(decideExecutionStop({ session_id: 's1' }, ex({ tasks: xtask('forge-impl', '2026-10-12T11:40:00.000Z') }), { now: xnow, stopFile: false, jobs: [] }).block).toBe(true);
  });
  it('an unbound execution (started by forge 0.15) blocks no session and comes back unchanged (D-01)', () => {
    const unbound = ex({ hookSession: null });
    for (const input of [{}, { session_id: 's1' }, { session_id: 's1', stop_hook_active: true }]) {
      expect(decideExecutionStop(input, unbound, { now: xnow, stopFile: false, jobs: [] })).toEqual({ block: false, exec: unbound });
      expect(decideExecutionStop(input, unbound, { now: xnow, stopFile: true, jobs: [] })).toEqual({ block: false, exec: unbound });
    }
  });
  it('does not block while sleeping, and ends with one block when the stop file appears', () => {
    expect(decideExecutionStop({ session_id: 's1' }, ex({ sleepUntil: '2026-10-12T12:03:00.000Z' }), { now: xnow, stopFile: false, jobs: [] }).block).toBe(false);
    const d = decideExecutionStop({ session_id: 's1' }, ex(), { now: xnow, stopFile: true, jobs: [] });
    expect(d).toMatchObject({ block: true, ended: 'stopped', exec: { active: false, stopReason: 'stopped' } });
  });
  it('never blocks while the session has a live job in the background, which wakes it when it ends (C-03)', () => {
    const job = { name: 'integrate-T1-42', cmd: 'integrate', task: 'T1', pid: 42, startedAt: '2026-10-12T11:59:00.000Z', out: '.forge/work/run/integrate-T1.json', session: 's1' };
    expect(decideExecutionStop({ session_id: 's1' }, ex(), { now: xnow, stopFile: false, jobs: [job] }).block).toBe(false);
    expect(decideExecutionStop({ session_id: 's1' }, ex(), { now: xnow, stopFile: false, jobs: [] }).block).toBe(true);
    // The stop file still ends the execution.
    expect(decideExecutionStop({ session_id: 's1' }, ex(), { now: xnow, stopFile: true, jobs: [job] })).toMatchObject({ block: true, ended: 'stopped' });
  });
});

describe('decideStop with a sleeping swarm', () => {
  it('does not block the infinite run while the swarm sleeps', () => {
    const run = bound({ cycles: 3 });
    expect(decideStop(A, run, { ...ctx(), swarmSleeping: true }).block).toBe(false);
    expect(decideStop(A, run, { ...ctx(), swarmSleeping: false }).block).toBe(true);
  });
});

describe("decideExecutionStop and the agents' leases (D-15)", () => {
  const ctx = (leases?: Record<string, string>) => ({ now: xnow, stopFile: false, jobs: [], ...(leases ? { leases } : {}) });
  it("an agent counts as alive while its task's lease runs, never more than 90 minutes after its last report", () => {
    const fifteen = ex({ tasks: xtask('forge-impl', '2026-10-12T11:45:00.000Z') });
    // No lease: 10 minutes after the last report, as before.
    expect(decideExecutionStop({ session_id: 's1' }, fifteen, ctx()).block).toBe(true);
    expect(decideExecutionStop({ session_id: 's1' }, fifteen, ctx({ T1: '2026-10-12T12:45:00.000Z' })).block).toBe(false);
    expect(decideExecutionStop({ session_id: 's1' }, fifteen, ctx({ T1: '2026-10-12T11:55:00.000Z' })).block).toBe(true);
    expect(decideExecutionStop({ session_id: 's1' }, fifteen, ctx({ T1: 'not a date' })).block).toBe(true);
    // A lease three hours long: the cap of 90 minutes after the last report wins.
    expect(decideExecutionStop({ session_id: 's1' }, ex({ tasks: xtask('forge-impl', '2026-10-12T10:00:00.000Z') }), ctx({ T1: '2026-10-12T15:00:00.000Z' })).block).toBe(true);
    expect(decideExecutionStop({ session_id: 's1' }, ex({ tasks: xtask('forge-impl', '2026-10-12T11:00:00.000Z') }), ctx({ T1: '2026-10-12T15:00:00.000Z' })).block).toBe(false);
    // A task without an agent holds nothing back, whatever its lease.
    expect(decideExecutionStop({ session_id: 's1' }, ex({ tasks: xtask(null, '2026-10-12T11:58:00.000Z') }), ctx({ T1: '2026-10-12T12:45:00.000Z' })).block).toBe(true);
  });
});

describe('hook answer (I-03)', () => {
  const tmp = useTempDirs();
  const NOW = new Date('2026-10-16T10:00:00.000Z');
  const Q = 'Do I merge forge/run-shop into main? [merge-shop-r1-ab12]';
  const rec = (over: Partial<AuthRecord> = {}): AuthRecord => ({
    authId: 'merge-shop-r1-ab12', kind: 'merge', runId: 'shop-r1', target: 'main', question: Q, yes: 'Yes, merge it', createdAt: NOW.toISOString(), session: 's1', ...over,
  });
  const hook = (root: string, stdin: unknown) =>
    run(['hook', 'answer'], { cwd: root, now: () => NOW, env: {}, stdin: typeof stdin === 'string' ? stdin : JSON.stringify(stdin) });
  const input = (root: string, answers: Record<string, string> | null, questions = [Q], session = 's1', extra?: Record<string, unknown>) =>
    hookAnswerInput({ cwd: root, answers, questions, session, extra });
  const files = (root: string) => readdirSync(authDir(root)).sort().map(f => readFileSync(path.join(authDir(root), f), 'utf8'));
  const SILENT = { code: 0, stdout: '', stderr: '' };

  it('records the yes label of the question asked word for word, with when and by whom, and prints nothing', () => {
    const root = tmp('forge-answer-');
    writeAuth(root, rec());
    expect(hook(root, input(root, { [Q]: 'Yes, merge it' }))).toEqual(SILENT);
    expect(readAuths(root)).toEqual([{ ...rec(), answer: 'yes', answeredAt: NOW.toISOString(), answeredBy: 's1' }]);
  });
  it("the no, or the person's own text (Other), is a no", () => {
    for (const a of ['No', 'sí, pero mañana']) {
      const root = tmp('forge-answer-');
      writeAuth(root, rec());
      hook(root, input(root, { [Q]: a }));
      expect(readAuths(root)[0], a).toMatchObject({ answer: 'no', answeredBy: 's1' });
    }
  });
  it('only the yes label itself is a yes: another case, other spacing, more words or another yes label is a no', () => {
    const root = tmp('forge-answer-');
    for (const a of ['yes, merge it', 'Yes, merge it ', ' Yes, merge it', 'Yes,  merge it', `Yes,${String.fromCharCode(160)}merge it`, 'Yes, merge it, No',
      'Yes, merge it into main', 'Sí, intégrala', '']) {
      writeAuth(root, rec());
      hook(root, input(root, { [Q]: a }));
      expect(readAuths(root)[0], JSON.stringify(a)).toMatchObject({ answer: 'no', answeredBy: 's1' });
    }
  });
  it('is silent and writes nothing with junk stdin, without records, with a question that differs, and on an answered record', () => {
    const root = tmp('forge-answer-');
    expect(hook(root, 'not json')).toEqual(SILENT);
    expect(hook(root, input(root, { [Q]: 'Yes, merge it' }))).toEqual(SILENT);
    expect(existsSync(authDir(root))).toBe(false);
    writeAuth(root, rec());
    const before = files(root);
    const other = Q.replace('main?', 'main ?');
    const variants = [`${Q} `, ` ${Q}`, Q.replace('Do I', 'Do  I'), Q.replace('Do I', `Do${String.fromCharCode(160)}I`), Q.toLowerCase(), Q.replace(' [merge-shop-r1-ab12]', '')];
    for (const stdin of ['', 'null', '[]', JSON.stringify({ tool_input: { questions: 'x' } }), input(root, { [`${Q} `]: 'Yes, merge it' }, [`${Q} `]), input(root, { [other]: 'Yes, merge it' }, [other]),
      ...variants.map(v => input(root, { [v]: 'Yes, merge it' }, [v])),
      input(root, { 'Mode?': 'Yes, merge it' }, ['Mode?', Q]), input(root, { [Q]: 'Yes, merge it' }, ['Mode?']), input(root, {}, [Q])]) {
      expect(hook(root, stdin)).toEqual(SILENT);
    }
    expect(files(root)).toEqual(before);
    hook(root, input(root, { [Q]: 'No' }));
    const answered = files(root);
    hook(root, input(root, { [Q]: 'Yes, merge it' }));
    expect(files(root)).toEqual(answered);
  });
  it('answers only after AskUserQuestion ran: another tool or another hook event records nothing', () => {
    const root = tmp('forge-answer-');
    writeAuth(root, rec());
    const before = files(root);
    for (const extra of [{ tool_name: 'mcp__x__AskUserQuestion' }, { tool_name: 'Bash' }, { tool_name: undefined }, { hook_event_name: 'PreToolUse' }, { hook_event_name: undefined }]) {
      expect(hook(root, input(root, { [Q]: 'Yes, merge it' }, [Q], 's1', extra)), JSON.stringify(extra)).toEqual(SILENT);
    }
    expect(files(root)).toEqual(before);
  });
  it('with two questions in one AskUserQuestion it records only the one that matches a pending record', () => {
    const root = tmp('forge-answer-');
    writeAuth(root, rec());
    hook(root, input(root, { 'Mode?': 'Secuencial', [Q]: 'Yes, merge it' }, ['Mode?', Q]));
    expect(readAuths(root)).toHaveLength(1);
    expect(readAuths(root)[0].answer).toBe('yes');
  });
  it('with two questions, each record takes the answer to its own question: the yes label given to another question is not its yes', () => {
    const root = tmp('forge-answer-');
    writeAuth(root, rec());
    hook(root, input(root, { 'Mode?': 'Yes, merge it', [Q]: 'No' }, ['Mode?', Q]));
    expect(readAuths(root)[0].answer).toBe('no');
    const Q2 = 'Do I merge forge/run-shop into main? [merge-shop-r1-cd34]';
    writeAuth(root, rec());
    writeAuth(root, rec({ authId: 'merge-shop-r1-cd34', question: Q2 }));
    hook(root, input(root, { [Q]: 'No', [Q2]: 'Yes, merge it' }, [Q, Q2]));
    expect(readAuths(root).map(r => [r.authId, r.answer])).toEqual([['merge-shop-r1-ab12', 'no'], ['merge-shop-r1-cd34', 'yes']]);
  });
  it('a corrupt record, or one whose file name is not its authId, is ignored and left as it is', () => {
    const root = tmp('forge-answer-');
    mkdirSync(authDir(root), { recursive: true });
    writeFileSync(path.join(authDir(root), 'merge-shop-r1-zz99.json'), '{ broken');
    writeFileSync(path.join(authDir(root), 'merge-shop-r1-yy88.json'), JSON.stringify(rec()));
    expect(readAuths(root)).toEqual([]);
    hook(root, input(root, { [Q]: 'Yes, merge it' }));
    expect(readFileSync(path.join(authDir(root), 'merge-shop-r1-yy88.json'), 'utf8')).toBe(JSON.stringify(rec()));
    expect(readdirSync(authDir(root)).sort()).toEqual(['merge-shop-r1-yy88.json', 'merge-shop-r1-zz99.json']);
  });
  it('a bad file beside a pending record neither stops its answer nor decides it', () => {
    const root = tmp('forge-answer-');
    writeAuth(root, rec());
    const dir = authDir(root);
    // A copy under another name whose yes label is "No": it is not the record, so "No" stays a no.
    const forged = JSON.stringify(rec({ yes: 'No' }));
    writeFileSync(path.join(dir, 'merge-shop-r1-yy88.json'), forged);
    writeFileSync(path.join(dir, 'merge-shop-r1-zz99.json'), '{ broken');
    hook(root, input(root, { [Q]: 'No' }));
    expect(readAuths(root)).toEqual([{ ...rec(), answer: 'no', answeredAt: NOW.toISOString(), answeredBy: 's1' }]);
    expect(readFileSync(path.join(dir, 'merge-shop-r1-yy88.json'), 'utf8')).toBe(forged);
    expect(readFileSync(path.join(dir, 'merge-shop-r1-zz99.json'), 'utf8')).toBe('{ broken');
    expect(readdirSync(dir).sort()).toEqual(['merge-shop-r1-ab12.json', 'merge-shop-r1-yy88.json', 'merge-shop-r1-zz99.json']);
  });
  it('reads the answer from the transcript when the hook input carries none', () => {
    const root = tmp('forge-answer-');
    writeAuth(root, rec());
    const transcript = path.join(root, 't.jsonl');
    writeFileSync(transcript, `${JSON.stringify({ type: 'user', toolUseResult: { questions: [{ question: Q }], answers: { [Q]: 'Yes, merge it' }, annotations: {} } })}\n`);
    hook(root, { ...input(root, null), transcript_path: transcript });
    expect(readAuths(root)[0].answer).toBe('yes');
  });
  it('in the transcript only the result of this AskUserQuestion counts, and only from a .jsonl file given by its full path', () => {
    const root = tmp('forge-answer-');
    writeAuth(root, rec());
    const line = (id: string | null, result: Record<string, unknown>) => JSON.stringify({
      type: 'user', ...(id ? { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'x' }] } } : {}), toolUseResult: result,
    });
    const yes = { questions: [{ question: Q }], answers: { [Q]: 'Yes, merge it' }, annotations: {} };
    const transcript = path.join(root, 't.jsonl');
    const before = files(root);
    // An earlier call answered yes; the result of this one is not in the transcript yet.
    writeFileSync(transcript, `${line('toolu_old', yes)}\n`);
    hook(root, { ...input(root, null), transcript_path: transcript, tool_use_id: 'toolu_new' });
    // A result of another tool that carries `answers`.
    writeFileSync(transcript, `${line(null, { answers: { [Q]: 'Yes, merge it' } })}\n`);
    hook(root, { ...input(root, null), transcript_path: transcript });
    // The right lines, but not in a .jsonl file given by its full path.
    writeFileSync(path.join(root, 't.txt'), `${line(null, yes)}\n`);
    mkdirSync(path.join(root, 'd.jsonl'));
    for (const p of [path.join(root, 't.txt'), path.relative(process.cwd(), transcript), path.join(root, 'd.jsonl'), path.join(root, 'none.jsonl'), 7]) {
      hook(root, { ...input(root, null), transcript_path: p });
    }
    expect(files(root)).toEqual(before);
    // This call's result decides, wherever it is: here before the earlier one.
    writeFileSync(transcript, `${line('toolu_new', { ...yes, answers: { [Q]: 'No' } })}\n${line('toolu_old', yes)}\n`);
    hook(root, { ...input(root, null), transcript_path: transcript, tool_use_id: 'toolu_new' });
    expect(readAuths(root)[0]).toMatchObject({ answer: 'no', answeredBy: 's1' });
  });
});
