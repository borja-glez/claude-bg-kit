import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parsePlan } from '../src/lib/plan.js';
import { stateDoc } from '../src/page/normalize.js';
import { saturationOf, SATURATION_ROUNDS } from '../src/forge/saturation.js';
import { proposalDigest, type ProposalDoc } from '../src/lib/proposals.js';
import { run } from '../src/forge/cli/run.js';
import { startRun, saveRun, parseRun, readRunText } from '../src/forge/run.js';
import { appendEvent, readEvents } from '../src/forge/ledger.js';
import { saveProposal } from '../src/forge/proposals.js';
import { appendBlocked } from '../src/forge/autonomous.js';
import { useTempDirs } from './helpers/tmp.js';

const plan = parsePlan(`project: g\nlocale: en\nversion: "0.1"\ntracks:\n  - { id: core, name: Core, color: blue }\nphases:\n  - { id: F1, name: Base }\ntasks:\n  - { id: T001, title: a, track: core, phase: F1, done_when: x }\n  - { id: T002, title: b, track: core, phase: F1, done_when: y }\n`);
const done = { T001: stateDoc({ status: 'done' })!, T002: stateDoc({ status: 'done' })! };
const green = [{ validator: 'unit', ok: true, flaky: false, durationMs: 1, failures: [] }];
const P = (o: Partial<ProposalDoc> & { id: string }): ProposalDoc & { id: string } => ({ ts: '', category: 'quality', risk: 'low', title: 't', rationale: 'r', evidence: '', pillar: '', status: 'proposed', source: 'scout', author: 'a', ...o });
const base = { dry: SATURATION_ROUNDS, at: '2026-10-22T10:00:00.000Z', plan, states: done, validators: green, proposals: [], notes: [], blocked: 0 };

describe('saturationOf (6b-3)', () => {
  it('is saturated after three dry rounds with nothing pending, green validators and nothing open', () => {
    expect(saturationOf(base)).toMatchObject({ saturated: true, rounds: 3, blocking: [], evidence: { pendingTasks: [], validatorsFailed: [], openFindings: 0, openDefects: [] } });
  });
  it('says what keeps it from being saturated', () => {
    expect(saturationOf({ ...base, dry: 2 }).blocking).toEqual(['rounds']);
    expect(saturationOf({ ...base, states: { T001: done.T001 } })).toMatchObject({ saturated: false, blocking: ['pending-tasks'], evidence: { pendingTasks: ['T002'] } });
    expect(saturationOf({ ...base, validators: [{ ...green[0], ok: false }] }).evidence.validatorsFailed).toEqual(['unit']);
    expect(saturationOf({ ...base, validators: null }).blocking).toEqual(['validators']);
    expect(saturationOf({ ...base, proposals: [P({ id: 'p1', source: 'verify' })] })).toMatchObject({ blocking: ['defects'], evidence: { openDefects: ['p1'] } });
  });
  it('lists what waits for the person apart, without blocking', () => {
    const parked = P({ id: 'p2', source: 'user', status: 'discussing', parked: { why: 'w', loses: 'l', at: 'a' } });
    const q = { ts: 't', type: 'question' as const, author: 'session:S', text: '?' };
    const r = saturationOf({ ...base, proposals: [parked], notes: [q], blocked: 2 });
    expect(r).toMatchObject({ saturated: true, waiting: { parked: ['p2'], questions: 1, blocked: 2, deferred: 0 } });
  });
  it('counts the open findings of a round that was not accepted, and the deferred ones apart', () => {
    const forge = (action: string) => ({ v: 2, path: 'medium', phase: 'done', validators: [], brief: 1, stage: 'done', verify: null, stages: {}, integration: null,
      rounds: [{ brief: 1, n: 1, action, note: '', findings: { critical: 1, important: 1, minor: 0, deferred: 0 }, reviewers: ['correctness'], at: '2026-10-22T09:00:00.000Z' }],
      deferred: [{ problem: 'falta un índice' }], acceptedRound: null, overCap: false, updatedAt: '2026-10-22T09:00:00.000Z' });
    const open = saturationOf({ ...base, states: { ...done, T002: stateDoc({ status: 'done', forge: forge('fix') })! } });
    expect(open).toMatchObject({ saturated: false, blocking: ['findings'], evidence: { openFindings: 2 }, waiting: { deferred: 1 } });
    expect(saturationOf({ ...base, states: { ...done, T002: stateDoc({ status: 'done', forge: forge('accept') })! } })).toMatchObject({ saturated: true, waiting: { deferred: 1 } });
    // A state the plan no longer has (a retired task) blocks nothing, but its open findings are told (fix 1, orphanFindings).
    expect(saturationOf({ ...base, states: { ...done, T009: stateDoc({ status: 'orphaned', forge: forge('fix') })! } }))
      .toMatchObject({ saturated: true, blocking: [], evidence: { openFindings: 0 }, waiting: { deferred: 0, orphanFindings: ['T009'] }, counts: { orphanFindings: 1 } });
    expect(saturationOf({ ...base, states: { ...done, T009: stateDoc({ status: 'orphaned', forge: forge('accept') })! } }).waiting.orphanFindings).toEqual([]);
  });
});

describe('saturationOf: what still moves, what waits, and how much it keeps (6b-3 H-2, L-15, L-18, M-10)', () => {
  it('a proposal still to judge, or an approval of any source without its task, blocks as proposals (H-2)', () => {
    expect(saturationOf({ ...base, toJudge: ['p3'] })).toMatchObject({ saturated: false, blocking: ['proposals'], evidence: { openProposals: ['p3'] } });
    const approved = P({ id: 'p4', status: 'auto_approved' });
    expect(saturationOf({ ...base, proposals: [approved] })).toMatchObject({ saturated: false, blocking: ['proposals'], evidence: { openProposals: ['p4'] } });
    // Positive control: once it has its task, nothing is left.
    expect(saturationOf({ ...base, proposals: [{ ...approved, taskId: 'T002' }] }).saturated).toBe(true);
  });
  it('the ideas that wait for the owner\'s mark and the approvals without it are listed apart and never block (L-18)', () => {
    const idea = P({ id: 'p5', source: 'user' });
    const unmarked = P({ id: 'p6', status: 'approved' });
    const defect = P({ id: 'p7', source: 'verify' });
    const r = saturationOf({ ...base, proposals: [idea, unmarked, defect], waitsOwner: ['p5', 'p7'], unowned: ['p6'] });
    expect(r).toMatchObject({ saturated: true, blocking: [], evidence: { openDefects: [], openProposals: [] }, waiting: { waitsOwner: ['p5', 'p7'], unowned: ['p6'] } });
    // Positive control: the same proposals, not waiting for anyone, block.
    expect(saturationOf({ ...base, proposals: [idea, unmarked, defect] })).toMatchObject({ blocking: ['defects', 'proposals'], evidence: { openDefects: ['p7'], openProposals: ['p6'] } });
  });
  it('a product with no validator is not green (L-15)', () => {
    expect(saturationOf({ ...base, validators: [] })).toMatchObject({ saturated: false, blocking: ['validators'], evidence: { validatorsFailed: ['(no validators)'] } });
    expect(saturationOf({ ...base, validators: null }).evidence.validatorsFailed).toEqual(['(no validate output)']);
  });
  it('each list keeps 20 ids, with its full count beside it (M-10)', () => {
    const ids = Array.from({ length: 25 }, (_, i) => `T${String(i + 1).padStart(3, '0')}`);
    const big = parsePlan(`project: g\nlocale: en\nversion: "0.1"\ntracks:\n  - { id: core, name: Core, color: blue }\nphases:\n  - { id: F1, name: Base }\ntasks:\n`
      + ids.map(id => `  - { id: ${id}, title: ${id}, track: core, phase: F1, done_when: x }\n`).join(''));
    const toJudge = Array.from({ length: 30 }, (_, i) => `p20261022100000a${String(i).padStart(3, '0')}`);
    const r = saturationOf({ ...base, plan: big, states: {}, toJudge });
    expect(r.evidence.pendingTasks).toEqual(ids.slice(0, 20));
    expect(r.evidence.openProposals).toEqual(toJudge.slice(0, 20));
    expect(r.counts).toEqual({ pendingTasks: 25, validatorsFailed: 0, openDefects: 0, openProposals: 30, parked: 0, waitsOwner: 0, unowned: 0,
      blockedTasks: 0, unplaced: 0, orphanFindings: 0 });
  });
});

describe('saturationOf: what waits for the person never blocks, and a missing input leaves the rest computed (6b-3 fix 1)', () => {
  const chain = parsePlan('project: g\nlocale: en\nversion: "0.1"\ntracks:\n  - { id: core, name: Core, color: blue }\nphases:\n  - { id: F1, name: Base }\ntasks:\n'
    + '  - { id: T001, title: a, track: core, phase: F1, done_when: x }\n  - { id: T002, title: b, track: core, phase: F1, done_when: x, depends_on: [T001] }\n'
    + '  - { id: T003, title: c, track: core, phase: F1, done_when: x }\n  - { id: T004, title: d, track: core, phase: F1, done_when: x, depends_on: [T001, T003] }\n');
  const s = (o: Record<string, unknown>) => stateDoc(o)!;
  it('a task blocked for the person, and every task that waits only on it, waits apart (T6B3-SAT-WAITING)', () => {
    const external = s({ status: 'blocked', blockedBy: ['external'] });
    const r = saturationOf({ ...base, plan: chain, states: { T001: external, T002: s({ status: 'free' }), T003: s({ status: 'done' }), T004: s({ status: 'free' }) } });
    expect(r).toMatchObject({ saturated: true, blocking: [], evidence: { pendingTasks: [] }, waiting: { blockedTasks: ['T001', 'T002', 'T004'] }, counts: { blockedTasks: 3 } });
    // A task that also waits on open work is open work, and so is that work.
    const open = saturationOf({ ...base, plan: chain, states: { T001: external, T002: s({ status: 'free' }), T003: s({ status: 'free' }), T004: s({ status: 'free' }) } });
    expect(open).toMatchObject({ saturated: false, blocking: ['pending-tasks'], evidence: { pendingTasks: ['T003', 'T004'] }, waiting: { blockedTasks: ['T001', 'T002'] } });
    // Positive control: a task blocked by a task id, not by the person, still blocks, with what waits on it.
    const byTask = saturationOf({ ...base, plan: chain, states: { T001: s({ status: 'blocked', blockedBy: ['T003'] }), T002: s({ status: 'free' }), T003: s({ status: 'done' }), T004: s({ status: 'done' }) } });
    expect(byTask).toMatchObject({ saturated: false, blocking: ['pending-tasks'], evidence: { pendingTasks: ['T001', 'T002'] }, waiting: { blockedTasks: [] } });
  });
  it('an approval the run could not place, named in the proposalId of its own debt note, waits apart; nothing else moves it (T6B3-SAT-WAITING, fix 2)', () => {
    const id = 'p20261022100000aaaa';
    const approved = P({ id, status: 'auto_approved' });
    const debt = (author: string, proposalId?: string, text = 'could not be placed') => ({ ts: 't', type: 'debt' as const, author, text, ...(proposalId ? { proposalId } : {}) });
    expect(saturationOf({ ...base, proposals: [approved], notes: [debt('session:S', id)] }))
      .toMatchObject({ saturated: true, evidence: { openProposals: [] }, waiting: { unplaced: [id] } });
    // Positive controls: the id only in the text, the same note by a person, or a note of another proposal leave it open work.
    for (const note of [debt('session:S', undefined, `${id} could not be placed`), debt('user:u1', id), debt('session:S', 'p20261022100000bbbb')]) {
      expect(saturationOf({ ...base, proposals: [approved], notes: [note] }), JSON.stringify(note)).toMatchObject({ blocking: ['proposals'], waiting: { unplaced: [] } });
    }
  });
  it('a proposed proposal that holds the owner\'s approving mark of its present text is open work (fix 1, fix 2)', () => {
    const p = P({ id: 'p9' });
    const mark = (status: 'approved' | 'rejected', digest = proposalDigest('p9', p)) => ({ status, decidedAt: 't', by: 'page' as const, digest });
    expect(saturationOf({ ...base, proposals: [p], marks: { p9: mark('approved') } })).toMatchObject({ saturated: false, blocking: ['proposals'], evidence: { openProposals: ['p9'] } });
    // A mark of an earlier text waits for the owner to mark the present one: listed apart, it never blocks.
    expect(saturationOf({ ...base, proposals: [p], marks: { p9: mark('approved', 'f'.repeat(64)) } }))
      .toMatchObject({ saturated: true, evidence: { openProposals: [] }, waiting: { waitsOwner: ['p9'] } });
    // Positive control: a rejecting mark is the owner's no, and no work.
    expect(saturationOf({ ...base, proposals: [p], marks: { p9: mark('rejected') } })).toMatchObject({ saturated: true, waiting: { waitsOwner: [] } });
  });
  it('only an exploration round concludes saturated: a cycle without the scout keeps rounds in blocking (T6B3-SAT-EXPLORE-ONLY)', () => {
    expect(saturationOf({ ...base, explored: false })).toMatchObject({ saturated: false, blocking: ['rounds'] });
    expect(saturationOf({ ...base, explored: true })).toMatchObject({ saturated: true, blocking: [] });
  });
  it('a missing input is named and blocks; what does not need it is still computed (L-10, fix 1)', () => {
    expect(saturationOf({ ...base, validators: null, missing: ['--validate'] })).toMatchObject({ saturated: false, blocking: ['inputs'], missing: ['--validate'], evidence: { validatorsFailed: [] } });
    expect(saturationOf({ ...base, states: {}, notes: [{ ts: 't', type: 'question', author: 'session:S', text: '?' }], missing: ['--db'] }))
      .toMatchObject({ blocking: ['inputs'], evidence: { pendingTasks: [] }, waiting: { questions: 0 } });
    expect(saturationOf({ ...base, missing: ['--plan'], toJudge: ['p3'] })).toMatchObject({ blocking: ['proposals', 'inputs'], evidence: { openProposals: ['p3'] } });
  });
});

describe('FORGE cycle --explore (6b-3)', () => {
  const tmp = useTempDirs();
  const PLAN = 'project: g\nlocale: en\nversion: "0.1"\ntracks:\n  - { id: core, name: Core, color: blue }\nphases:\n  - { id: F1, name: Base }\n'
    + 'tasks:\n  - { id: T001, title: a, track: core, phase: F1, done_when: x }\n';
  const inputs = ['--plan', 'plan.yaml', '--db', 'db', '--validate', 'validate.json'];
  let root: string;
  let clock: number;
  const io = () => ({ cwd: root, now: () => new Date(clock), env: {} });
  const at = () => new Date(clock).toISOString();
  const auto = (worktree: string) => ({ profile: 'product' as const, name: 'g', runId: 'product-g', worktree, branch: 'forge/product-g', startBranch: 'main', protectedBranches: ['main'] });
  const start = (worktree = root) => saveRun(root, { ...startRun(new Date(clock), { cycles: 50 }, 10, 's1'), autonomous: auto(worktree) });
  // Each cycle a minute after the last event, so the ledger's times tell one round from the next. A fresh cycle has its
  // validate file written in it, as the scout's step writes one: newer than the last exploration round (fix 1).
  const cycle = (extra: string[], fresh = true) => {
    clock += 60_000;
    const written = new Date(clock - 1000);
    if (fresh) utimesSync(path.join(root, 'validate.json'), written, written);
    return run(['cycle', '--progress', 'yes', ...extra], io());
  };
  const explore = (extra = inputs) => {
    const r = cycle(['--explore', ...extra]);
    expect(r.code, r.stderr).toBe(0);
    return JSON.parse(r.stdout);
  };
  const status = () => JSON.parse(run(['infinite', 'status'], io()).stdout);
  const readRun = () => parseRun(readRunText(root))!;
  const cycles = () => readEvents(root).filter(e => e.kind === 'cycle');
  beforeEach(() => {
    root = tmp('saturation-');
    clock = Date.parse('2026-10-22T10:00:00.000Z');
    writeFileSync(path.join(root, 'plan.yaml'), PLAN);
    mkdirSync(path.join(root, 'db', 'state'), { recursive: true });
    mkdirSync(path.join(root, 'db', 'notes'), { recursive: true });
    writeFileSync(path.join(root, 'db', 'state', 'T001.json'), JSON.stringify({ status: 'done' }));
    writeFileSync(path.join(root, 'validate.json'), JSON.stringify(green));
  });

  it('--explore is a bare flag and its inputs belong to an autonomous run; a --db without its state listing is refused (H-2, M-11)', () => {
    saveRun(root, startRun(new Date(clock), { cycles: 50 }, 10, 's1'));
    expect(cycle(['--explore']).code).toBe(2);
    expect(cycle(['--plan', 'plan.yaml']).code).toBe(2);
    start();
    expect(cycle(['--explore', '2']).code).toBe(2);
    expect(cycle(['--explore', '--db']).code).toBe(2);
    const noState = cycle(['--explore', '--plan', 'plan.yaml', '--db', 'nodb', '--validate', 'validate.json']);
    expect(noState.code).toBe(2);
    expect(noState.stderr).toContain('list state first');
    expect(readRun().cycle).toBe(0);
    expect(readRun()).not.toHaveProperty('explore');
    expect(cycles()).toEqual([]);
    // Positive control: the bare flag records the round, and a round below the count stores no report.
    expect(explore()).toMatchObject({ cycle: 1, explore: { rounds: 1, dry: 1 }, saturation: null });
    expect(cycles().at(-1)).toMatchObject({ cycle: 1, explore: { passed: 0, dry: 1 } });
  });

  it('three dry rounds in a row with nothing left stop the run as saturated; a round that approves starts the count again', () => {
    start();
    expect(explore()).toMatchObject({ explore: { rounds: 1, dry: 1 }, saturation: null });
    // H-2: what passed, the CLI reads from the ledger of the run's proposals: here a judge's approval since the last cycle.
    clock += 1000;
    appendEvent(root, { ts: at(), kind: 'proposal', action: 'judge', id: 'p20261022100000aaaa', status: 'auto_approved', verdict: 'keep' });
    expect(explore()).toMatchObject({ explore: { rounds: 2, dry: 0 }, saturation: null });
    expect(explore()).toMatchObject({ explore: { rounds: 3, dry: 1 } });
    expect(explore()).toMatchObject({ explore: { rounds: 4, dry: 2 } });
    expect(status().stopReason).toBeNull();
    const last = explore();
    expect(last).toMatchObject({ explore: { rounds: 5, dry: 3 }, saturation: { saturated: true, rounds: 3, blocking: [], at: at() } });
    // meta/infinite carries the profile and the report (L-20).
    expect(last.publish.infinite).toMatchObject({ profile: 'product', saturation: { saturated: true, rounds: 3 } });
    expect(cycles().map(e => e.explore)).toEqual([{ passed: 0, dry: 1 }, { passed: 1, dry: 0 }, { passed: 0, dry: 1 }, { passed: 0, dry: 2 }, { passed: 0, dry: 3 }]);
    expect(status()).toMatchObject({ stopReason: 'saturated', run: { saturation: { saturated: true } } });
    // The Stop hook of the run's session ends it there.
    const hook = JSON.parse(run(['hook', 'stop'], { ...io(), stdin: '{"session_id":"s1"}' }).stdout);
    expect(hook.reason).toContain('the forge infinite run ended (saturated)');
    expect(readRun()).toMatchObject({ active: false, stoppedReason: 'saturated' });
  });

  it('reads the run\'s worktree: its ledger since the last cycle, its proposals, and the actions the guard blocked (L-12, L-18)', () => {
    const wt = tmp('saturation-wt-');
    start(wt);
    expect(explore().explore).toEqual({ rounds: 1, dry: 1 });
    // A v2 written after an adapt passes: it is a proposal that passes with changes (an add with revises).
    clock += 1000;
    appendEvent(wt, { ts: at(), kind: 'proposal', action: 'add', id: 'p20261022100000bbbb', revises: 'p20261022100000aaaa' });
    expect(explore().explore).toEqual({ rounds: 2, dry: 0 });
    // What came before the last cycle counts no more, and a judge that rejects passes nothing.
    clock += 1000;
    appendEvent(wt, { ts: at(), kind: 'proposal', action: 'judge', id: 'p20261022100000cccc', status: 'rejected', verdict: 'drop' });
    expect(explore().explore).toEqual({ rounds: 3, dry: 1 });
    expect(explore().explore).toEqual({ rounds: 4, dry: 2 });
    // In the worktree: one to judge, one with no add event (it waits for the owner), and an approval without the owner's mark.
    const doc = (status: ProposalDoc['status']): ProposalDoc => ({ ts: at(), category: 'quality', risk: 'low', title: `t ${status}`, rationale: 'r', evidence: 'e', pillar: '', status, source: 'scout', author: 'a' });
    saveProposal(wt, 'p20261022100000dddd', doc('proposed'));
    appendEvent(wt, { ts: at(), kind: 'proposal', action: 'add', id: 'p20261022100000dddd', digest: proposalDigest('p20261022100000dddd', doc('proposed')) });
    saveProposal(wt, 'p20261022100000eeee', { ...doc('proposed'), title: 'pulled' });
    saveProposal(wt, 'p20261022100000ffff', doc('approved'));
    appendBlocked(root, 'product-g', { ts: at(), rule: 'files', tool: 'Write', target: '/x', reason: 'outside the worktree', session: 's1' });
    // None of them is in the main checkout: there the run would look saturated.
    expect(explore()).toMatchObject({ explore: { rounds: 5, dry: 3 }, saturation: {
      saturated: false, blocking: ['proposals'], evidence: { openProposals: ['p20261022100000dddd'] },
      waiting: { waitsOwner: ['p20261022100000eeee'], unowned: ['p20261022100000ffff'], blocked: 1 },
    } });
    expect(status().stopReason).toBeNull();
  });

  it('a pass in a cycle without the scout counts for the next round (T6B3-SAT-WINDOW)', () => {
    start();
    explore();
    explore();
    // The critic judges every cycle: here it approves in a cycle where the scout did not run.
    clock += 1000;
    appendEvent(root, { ts: at(), kind: 'proposal', action: 'judge', id: 'p20261022100000aaaa', status: 'auto_approved', verdict: 'keep' });
    expect(JSON.parse(cycle([]).stdout)).toMatchObject({ explore: { rounds: 2, dry: 2 }, saturation: null });
    expect(explore().explore).toEqual({ rounds: 3, dry: 0 });
    expect(cycles().at(-1)).toMatchObject({ explore: { passed: 1, dry: 0 } });
    // Positive control: the round after it, with nothing new, is dry again.
    expect(explore().explore).toEqual({ rounds: 4, dry: 1 });
  });

  it('a cycle without the scout refreshes the report past the count and keeps the dry count (fix 1)', () => {
    start();
    writeFileSync(path.join(root, 'db', 'state', 'T001.json'), JSON.stringify({ status: 'in_progress' }));
    explore();
    explore();
    expect(explore()).toMatchObject({ explore: { rounds: 3, dry: 3 }, saturation: { saturated: false, blocking: ['pending-tasks'], evidence: { pendingTasks: ['T001'] } } });
    // T001 is done in a cycle without the scout: the report says so at once, with this cycle's time.
    writeFileSync(path.join(root, 'db', 'state', 'T001.json'), JSON.stringify({ status: 'done' }));
    const r = cycle(inputs, false);
    expect(r.code, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ explore: { rounds: 3, dry: 3 }, saturation: { saturated: false, at: at(), evidence: { pendingTasks: [] } } });
    // Its validate file is the round's, from an earlier cycle: a missing input. And a cycle without the scout never concludes.
    expect(JSON.parse(r.stdout).saturation).toMatchObject({ blocking: ['rounds', 'inputs'], missing: ['--validate'] });
    expect(status().stopReason).toBeNull();
    // T6B3-SAT-EXPLORE-ONLY: even with its own green validate file and nothing open, it is no round: not saturated.
    const own = cycle(inputs);
    expect(JSON.parse(own.stdout)).toMatchObject({ explore: { rounds: 3, dry: 3 }, saturation: { saturated: false, blocking: ['rounds'] } });
    expect(JSON.parse(own.stdout).saturation).not.toHaveProperty('missing');
    expect(status().stopReason).toBeNull();
    // Positive control: the next exploration round, with nothing left, concludes.
    expect(explore()).toMatchObject({ explore: { rounds: 4, dry: 4 }, saturation: { saturated: true, blocking: [] } });
    expect(status().stopReason).toBe('saturated');
  });

  it('the validate file must be this cycle\'s: one written in an earlier cycle, even after the last round, is a missing input (T6B3-SAT-EXPLORE-ONLY)', () => {
    start();
    writeFileSync(path.join(root, 'db', 'state', 'T001.json'), JSON.stringify({ status: 'in_progress' }));
    explore();
    explore();
    expect(explore()).toMatchObject({ explore: { dry: 3 }, saturation: { saturated: false, blocking: ['pending-tasks'] } });
    // A cycle without the scout writes the validate file; T001 is done after it.
    cycle([]);
    writeFileSync(path.join(root, 'db', 'state', 'T001.json'), JSON.stringify({ status: 'done' }));
    // The next round reuses that file: newer than the last round, but from the cycle before this one.
    const reused = cycle(['--explore', ...inputs], false);
    expect(JSON.parse(reused.stdout)).toMatchObject({ explore: { rounds: 4, dry: 4 }, saturation: { saturated: false, blocking: ['inputs'], missing: ['--validate'] } });
    expect(status().stopReason).toBeNull();
    // Positive control: the round's own file concludes.
    expect(explore().saturation).toMatchObject({ saturated: true, blocking: [] });
  });

  it('a round past the count without its inputs is recorded, with a report that names what is missing (L-10, fix 1)', () => {
    start();
    // An unreadable plan is a missing input, never a refusal.
    expect(explore(['--plan', 'missing.yaml', '--db', 'db', '--validate', 'validate.json'])).toMatchObject({ explore: { dry: 1 }, saturation: null });
    explore([]);
    const r = cycle(['--explore', '--plan', 'plan.yaml', '--db', 'db']);
    expect(r.code, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ cycle: 3, explore: { dry: 3 }, saturation: { saturated: false, blocking: ['inputs'], missing: ['--validate'] } });
    expect(status().stopReason).toBeNull();
    expect(explore(['--plan', 'missing.yaml', '--db', 'db', '--validate', 'validate.json']).saturation)
      .toMatchObject({ saturated: false, blocking: ['inputs'], missing: ['--plan'] });
    // A validate file from before the last round is a missing input: a stale file never reads green.
    const stale = cycle(['--explore', ...inputs], false);
    expect(JSON.parse(stale.stdout).saturation).toMatchObject({ saturated: false, blocking: ['inputs'], missing: ['--validate'], evidence: { validatorsFailed: [] } });
    // A validate file that does not read is no green.
    writeFileSync(path.join(root, 'validate.json'), 'not json');
    expect(explore()).toMatchObject({ saturation: { saturated: false, blocking: ['validators'], evidence: { validatorsFailed: ['(no validate output)'] } } });
    // Positive control: green validators, written with a BOM, and nothing left: saturated.
    writeFileSync(path.join(root, 'validate.json'), String.fromCharCode(0xfeff) + JSON.stringify(green));
    expect(explore().saturation).toMatchObject({ saturated: true, blocking: [] });
  });
});
