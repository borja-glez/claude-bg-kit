import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { run } from '../src/forge/cli/run.js';
import { startRun, saveRun } from '../src/forge/run.js';
import { saveApproval, saveProposal } from '../src/forge/proposals.js';
import { appendEvent } from '../src/forge/ledger.js';
import { IDEA_MERGED } from '../src/forge/ideas.js';
import { proposalDigest, type ApprovalDoc, type ProposalDoc } from '../src/lib/proposals.js';
import { useTempDirs } from './helpers/tmp.js';

const tmp = useTempDirs();
const T0 = new Date('2026-10-22T10:00:00.000Z');
const PLAN = `project: g\nlocale: en\nversion: "0.1"\ntracks:\n  - { id: core, name: Core, color: blue }\nphases:\n  - { id: F1, name: Base }\n  - { id: F2, name: Juice }\n  - { id: F3, name: Empty }\ntasks:\n  - { id: T001, title: a, track: core, phase: F1, done_when: x }\n  - { id: T002, title: b, track: core, phase: F2, done_when: y }\n`;
let root: string;
const state = (id: string, status: string) => { mkdirSync(path.join(root, 'db', 'state'), { recursive: true }); writeFileSync(path.join(root, 'db', 'state', `${id}.json`), JSON.stringify({ status })); };
const phase = (...extra: string[]) => run(['infinite', 'phase', '--plan', 'plan.yaml', '--db', 'db', ...extra], { cwd: root, now: () => T0, env: {} });
const autonomous = (profile: 'product' | 'spike') =>
  ({ profile, name: 'g', runId: `${profile}-g`, worktree: path.join(root, 'wt'), branch: `forge/${profile}-g`, startBranch: 'main', protectedBranches: ['main'] });
// H-6: the reviewed phases are kept per run id in the main checkout, beside start.json and sessions.json.
const phasesFile = () => path.join(root, '.forge', 'autonomous', 'product-g', 'phases.json');
const reviewed = () => JSON.parse(readFileSync(phasesFile(), 'utf8')) as unknown;
beforeEach(() => {
  root = tmp('phase-');
  writeFileSync(path.join(root, 'plan.yaml'), PLAN);
  saveRun(root, { ...startRun(T0, { hours: 1 }, 10, 'c1'), autonomous: autonomous('product') });
});

describe('infinite phase (6b-3)', () => {
  it('names the first phase all done and not reviewed yet, once; an empty phase never closes', () => {
    state('T001', 'done'); state('T002', 'in_progress');
    // T6B3-REPLAN-HELD: `held` names the tasks a re-plan may not change, here the done one; final fix F-M4: `reviewed` the
    // phases already reviewed.
    expect(JSON.parse(phase().stdout)).toEqual({ closed: 'F1', phases: [{ id: 'F1', done: 1, total: 1 }, { id: 'F2', done: 0, total: 1 }, { id: 'F3', done: 0, total: 0 }],
      held: [{ task: 'T001', reason: 'T001 is done' }], reviewed: [] });
    expect(JSON.parse(phase('--mark', 'F1').stdout)).toMatchObject({ closed: null, reviewed: ['F1'] });
    expect(reviewed()).toEqual({ reviewed: ['F1'] });
    expect(JSON.parse(phase().stdout).closed).toBeNull();
  });
  it('refuses a phase that is not the plan\'s, and any use outside an autonomous run', () => {
    state('T001', 'pending');
    const r = phase('--mark', 'F9');
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('F9');
    expect(existsSync(phasesFile())).toBe(false);
    saveRun(root, startRun(T0, { hours: 1 }, 10, 'c1'));
    expect(phase().code).toBe(2);
  });
  it('a later start of the same profile does not review a phase again: run.json is rebuilt, phases.json is not (H-6)', () => {
    state('T001', 'done'); state('T002', 'done');
    expect(JSON.parse(phase('--mark', 'F1').stdout).closed).toBe('F2');
    saveRun(root, { ...startRun(new Date('2026-10-22T12:00:00.000Z'), { hours: 2 }, 10, 'c2'), autonomous: autonomous('product') });
    expect(JSON.parse(phase().stdout).closed).toBe('F2');
    expect(JSON.parse(phase('--mark', 'F2').stdout).closed).toBeNull();
    // Marked twice, a phase is kept once.
    expect(phase('--mark', 'F1').code).toBe(0);
    expect(reviewed()).toEqual({ reviewed: ['F1', 'F2'] });
    expect(readFileSync(path.join(root, '.forge', 'run.json'), 'utf8')).not.toContain('reviewed');
  });
  it('refuses a spike run (L-16), a stopped run, a missing state listing (M-11) and a call without --plan or --db', () => {
    expect(phase().code, 'no state listing').toBe(2);
    expect(phase().stderr).toContain('list state first');
    state('T001', 'done');
    expect(phase().code, 'control').toBe(0);
    for (const args of [['--plan', 'plan.yaml'], ['--db', 'db'], ['--plan', 'plan.yaml', '--db']]) {
      expect(run(['infinite', 'phase', ...args], { cwd: root, now: () => T0, env: {} }).code, args.join(' ')).toBe(2);
    }
    saveRun(root, { ...startRun(T0, { hours: 1 }, 10, 'c1'), active: false, autonomous: autonomous('product') });
    expect(phase().code, 'stopped').toBe(2);
    saveRun(root, { ...startRun(T0, { hours: 1 }, 10, 'c1'), autonomous: autonomous('spike') });
    const spike = phase();
    expect(spike.code).toBe(2);
    expect(spike.stderr).toContain('spike');
  });
  it('a plan that does not parse, or a phases.json that does not read, is refused and nothing is marked', () => {
    state('T001', 'done');
    writeFileSync(path.join(root, 'broken.yaml'), 'project: g\nphases: [\n');
    expect(run(['infinite', 'phase', '--plan', 'broken.yaml', '--db', 'db', '--mark', 'F1'], { cwd: root, now: () => T0, env: {} }).code).toBe(2);
    expect(existsSync(phasesFile())).toBe(false);
    mkdirSync(path.dirname(phasesFile()), { recursive: true });
    writeFileSync(phasesFile(), '{"reviewed": "F1"}');
    const r = phase('--mark', 'F1');
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('phases.json');
    expect(readFileSync(phasesFile(), 'utf8')).toBe('{"reviewed": "F1"}');
  });
});

// B-2, M-8 and T6B3-RETIRED-IDS: the check the skill runs before every `waypoint replan --check` and `waypoint replan`.
describe('proposals replan-check (6b-3)', () => {
  const P = { run: 'p20261022100000aaaa', user: 'p20261022100000bbbb', owner: 'p20261022100000cccc', gone: 'p20261022100000dddd', bare: 'p20261022100000eeee',
    chat: 'p20261022100000ffff', held: 'p20261022100000gggg', policy: 'p20261022100000hhhh', decide: 'p20261022100000iiii', reopened: 'p20261022100000jjjj',
    edited: 'p20261022100000kkkk', merged: 'p20261022100000llll' };
  const link = (id: string) => `includes: "(proposal ${id})"`;
  const task = (id: string, phaseId: string, extra = '') => `  - id: ${id}\n    title: task ${id}\n    track: core\n    phase: ${phaseId}\n    done_when: the check of ${id} passes\n${extra ? `    ${extra}\n` : ''}`;
  const PLAN2 = `project: g\nlocale: en\nversion: "0.1"\ntracks:\n  - { id: core, name: Core, color: blue }\nphases:\n  - { id: F1, name: Base }\n  - { id: F2, name: Juice }\ntasks:\n`
    + task('T001', 'F1', link(P.run)) + task('T002', 'F1', link(P.user)) + task('T003', 'F2', link(P.owner)) + task('T004', 'F2', link(P.run))
    + task('T005', 'F2') + task('T006', 'F2', link(P.gone)) + task('T007', 'F2', link(P.bare)) + task('T008', 'F2', link(P.chat)) + task('T009', 'F2')
    + task('T010', 'F2', link(P.policy)) + task('T011', 'F2', link(P.decide))
    // Two links, one of them the person's: the YAML escape \n gives two lines of includes.
    + task('T012', 'F2', `includes: "(proposal ${P.run})\\n\\n(proposal ${P.user})"`)
    + task('T013', 'F2', link(P.reopened)) + task('T014', 'F2', link(P.edited)) + task('T015', 'F2', link(P.merged));
  const doc = (over: Partial<ProposalDoc> = {}): ProposalDoc => ({ ts: T0.toISOString(), category: 'feature', risk: 'low', title: 'An idea', rationale: 'r', evidence: 'e',
    pillar: 'fun', status: 'auto_approved', source: 'scout', author: 'session', decidedBy: 'forge:auto', decidedAt: T0.toISOString(), ...over });
  const put = (id: string, d: ProposalDoc, by: ApprovalDoc['by'] | null = 'forge:auto') => {
    saveProposal(root, id, d);
    if (by) saveApproval(root, id, { status: d.status === 'approved' ? 'approved' : 'auto_approved', decidedAt: T0.toISOString(), by, digest: proposalDigest(id, d) });
  };
  const check = (ops: unknown[], extra: string[] = []) => {
    writeFileSync(path.join(root, 'ops.json'), JSON.stringify({ summary: 's', findings: [], ops, vision: null }));
    return run(['proposals', 'replan-check', '--ops', 'ops.json', '--plan', 'plan.yaml', '--db', 'db', ...extra], { cwd: root, now: () => T0, env: {} });
  };
  beforeEach(() => {
    writeFileSync(path.join(root, 'plan.yaml'), PLAN2);
    state('T001', 'done'); state('T002', 'in_progress');
    // A run task as to-task leaves it: the proposal keeps its status and gains its taskId, which the mark's digest leaves out.
    put(P.run, doc({ taskId: 'T004' }));
    // A person's idea the run judged keeps `source: user`: the mark of forge:auto does not make it the run's.
    put(P.user, doc({ source: 'user', author: 'borja' }));
    put(P.owner, doc({ status: 'approved', decidedBy: 'user' }), 'page');
    put(P.bare, doc(), null);
    put(P.chat, doc());
    appendEvent(root, { ts: T0.toISOString(), kind: 'proposal', action: 'add', id: P.chat, from: 'chat', owner: true });
    put(P.held, doc({ source: 'user', taskId: 'T009' }));
    put(P.policy, doc({ decidedBy: 'forge:policy' }), 'forge:policy');
    // The person's answer to a parked idea, or /forge:decide: a mark by forge:decide.
    put(P.decide, doc({ status: 'approved', decidedBy: 'forge:decide' }), 'forge:decide');
    // T6B3-REPLAN-MARK-OK: a run's mark left behind by a reopen on the page, and one of a text edited after it.
    put(P.reopened, doc());
    saveProposal(root, P.reopened, doc({ status: 'proposed', decidedBy: undefined, decidedAt: undefined }));
    put(P.edited, doc());
    saveProposal(root, P.edited, doc({ rationale: 'the person rewrote it on the page' }));
    // T6B3-REPLAN-MERGED: a person's note that said what this run proposal says joined it.
    put(P.merged, doc());
    appendEvent(root, { ts: T0.toISOString(), kind: 'proposal', action: IDEA_MERGED, id: P.merged, from: 'note:n20261022100000abcd' });
  });

  it('refuses a retire, an edit of the title or done_when, and a move of a task of the person\'s idea or of the owner\'s decision (B-2)', () => {
    const before = readFileSync(path.join(root, 'plan.yaml'), 'utf8');
    for (const op of [{ op: 'retire', task: 'T002', why: 'no longer needed' }, { op: 'edit', task: 'T002', title: 'something else' },
      { op: 'move', task: 'T003', phase: 'F1' }, { op: 'edit', task: 'T003', done_when: 'a new check that shows it works' }]) {
      const r = check([op]);
      expect(r.code, JSON.stringify(op)).toBe(2);
      expect(r.stderr).toContain(op.task);
      expect(r.stderr).toContain(op.task === 'T002' ? P.user : P.owner);
    }
    expect(readFileSync(path.join(root, 'plan.yaml'), 'utf8')).toBe(before);
    const all = check([{ op: 'retire', task: 'T002', why: 'w' }, { op: 'move', task: 'T004', phase: 'F1' }, { op: 'move', task: 'T003', phase: 'F1' }]);
    expect(all.code).toBe(2);
    expect(all.stderr).toContain('ops[0]');
    expect(all.stderr).toContain('ops[2]');
    expect(all.stderr).not.toContain('ops[1]');
  });
  /** The refusal of one operation: exit 2, and stderr naming each of `words`. */
  const refused = (op: Record<string, unknown>, ...words: string[]) => {
    const r = check([op]);
    expect(r.code, JSON.stringify(op)).toBe(2);
    for (const w of words) expect(r.stderr, w).toContain(w);
    return r.stderr;
  };
  it('a person\'s idea is known by its ledger too, and a proposal holds the task its taskId names', () => {
    refused({ op: 'retire', task: 'T008', why: 'w' }, P.chat);
    refused({ op: 'move', task: 'T009', phase: 'F1' }, P.held);
  });
  it('fails closed: a task whose proposal is not here, or holds no mark, is not the run\'s to change', () => {
    refused({ op: 'retire', task: 'T006', why: 'w' }, P.gone);
    refused({ op: 'move', task: 'T007', phase: 'F1' }, P.bare);
  });
  it('a mark of forge:decide is the person\'s, and one protected link of two holds the task', () => {
    refused({ op: 'move', task: 'T011', phase: 'F1' }, P.decide, 'forge:decide');
    // T012 links P.run (the run's) and P.user (the person's): the person's link refuses.
    expect(refused({ op: 'retire', task: 'T012', why: 'w' }, P.user)).not.toContain(P.run);
  });
  it('a run\'s mark holds a task only while it matches its proposal (T6B3-REPLAN-MARK-OK)', () => {
    refused({ op: 'retire', task: 'T013', why: 'w' }, P.reopened, 'no longer matches');
    refused({ op: 'edit', task: 'T014', title: 'another title' }, P.edited, 'no longer matches');
    // A normal run task, placed by to-task with its taskId, still passes.
    expect(check([{ op: 'move', task: 'T004', phase: 'F1' }]).code).toBe(0);
  });
  it('a proposal a person\'s note was merged into holds its task (T6B3-REPLAN-MERGED)', () => {
    refused({ op: 'move', task: 'T015', phase: 'F1' }, P.merged, 'merged');
  });
  it('a merged note\'s origin is cleaned and clipped in the reason, as the other reasons are (final fix T5-a)', () => {
    appendEvent(root, { ts: T0.toISOString(), kind: 'proposal', action: IDEA_MERGED, id: P.run, from: `note:${'n'.repeat(300)}` });
    appendEvent(root, { ts: T0.toISOString(), kind: 'proposal', action: IDEA_MERGED, id: P.policy, from: `note:a${String.fromCharCode(0x202e)}b` });
    const held = (JSON.parse(phase().stdout) as { held: { task: string; reason: string }[] }).held;
    expect(held.find(h => h.task === 'T004')?.reason).toContain(`(note:${'n'.repeat(75)})`);
    expect(held.find(h => h.task === 'T010')?.reason).toContain('(note:a b)');
    expect(refused({ op: 'retire', task: 'T004', why: 'w' }, 'merged')).not.toContain('n'.repeat(76));
  });
  it('a task blocked for the person is held, in replan-check and in infinite phase\'s held (final fix F-M3)', () => {
    mkdirSync(path.join(root, 'db', 'state'), { recursive: true });
    writeFileSync(path.join(root, 'db', 'state', 'T005.json'), JSON.stringify({ status: 'blocked', blockedBy: ['external'] }));
    for (const op of [{ op: 'retire', task: 'T005', why: 'w' }, { op: 'move', task: 'T005', phase: 'F1' }, { op: 'edit', task: 'T005', title: 'renamed' }]) {
      refused(op, 'T005 waits for the person');
    }
    expect((JSON.parse(phase().stdout) as { held: unknown[] }).held).toContainEqual({ task: 'T005', reason: 'T005 waits for the person' });
    // Positive control: a task blocked by another task is the run's to re-plan.
    writeFileSync(path.join(root, 'db', 'state', 'T005.json'), JSON.stringify({ status: 'blocked', blockedBy: ['T004'] }));
    expect(check([{ op: 'retire', task: 'T005', why: 'w' }]).code).toBe(0);
  });
  it('refuses a move into a phase already reviewed, and infinite phase lists the reviewed phases (final fix F-M4)', () => {
    state('T002', 'done');
    expect(phase('--mark', 'F1').code).toBe(0);
    const r = refused({ op: 'move', task: 'T004', phase: 'F1' }, 'ops[0] move T004 to F1: F1 was already reviewed');
    expect(r).not.toContain('ops[1]');
    expect((JSON.parse(phase().stdout) as { reviewed: string[] }).reviewed).toEqual(['F1']);
    // Positive control: a move into a phase not reviewed, a new one included, passes; one into the phase it is in changes nothing.
    expect(check([{ op: 'add-phase', id: 'F3', name: 'Polish', goal: 'what a serious product needs' }, { op: 'move', task: 'T004', phase: 'F3' }]).code).toBe(0);
    expect(check([{ op: 'move', task: 'T004', phase: 'F2' }]).code).toBe(0);
  });
  it('runs only inside an active product run: the reviewed phases are that run\'s (final fix F-M4)', () => {
    saveRun(root, { ...startRun(T0, { hours: 1 }, 10, 'c1'), autonomous: autonomous('spike') });
    const spike = check([{ op: 'move', task: 'T004', phase: 'F1' }]);
    expect(spike.code).toBe(2);
    expect(spike.stderr).toContain('spike');
    saveRun(root, startRun(T0, { hours: 1 }, 10, 'c1'));
    expect(check([{ op: 'move', task: 'T004', phase: 'F1' }]).code).toBe(2);
  });
  it('infinite phase lists as held exactly what replan-check refuses to change, with the same reason (T6B3-REPLAN-HELD)', () => {
    const held = (JSON.parse(phase().stdout) as { held: { task: string; reason: string }[] }).held;
    expect(held.map(h => h.task)).toEqual(['T001', 'T002', 'T003', 'T006', 'T007', 'T008', 'T009', 'T011', 'T012', 'T013', 'T014', 'T015']);
    for (let n = 1; n <= 15; n++) {
      const id = `T${String(n).padStart(3, '0')}`;
      const r = check([{ op: 'retire', task: id, why: 'w' }]);
      const h = held.find(x => x.task === id);
      expect(r.code, id).toBe(h ? 2 : 0);
      if (h) expect(r.stderr, id).toContain(`ops[0] retire ${id}: ${h.reason}`);
    }
  });
  it('refuses a move or a retire of a done task, and an edit of its title or done_when (M-8, T6B3-RETIRED-IDS)', () => {
    for (const op of [{ op: 'move', task: 'T001', phase: 'F2' }, { op: 'retire', task: 'T001', why: 'w' }, { op: 'edit', task: 'T001', title: 'renamed' },
      { op: 'edit', task: 'T001', done_when: 'another check that shows it' }]) {
      const r = check([op]);
      expect(r.code, JSON.stringify(op)).toBe(2);
      expect(r.stderr).toContain('T001');
      expect(r.stderr).toContain('done');
    }
  });
  it('passes what overrides nobody: the run\'s own tasks, plain tasks, order, phases, and the dependencies or estimate of any task', () => {
    const r = check([
      { op: 'add-phase', id: 'F3', name: 'Polish', goal: 'what a serious product needs' }, { op: 'move', task: 'T004', phase: 'F3' },
      { op: 'retire', task: 'T005', why: 'the provider sends it' }, { op: 'edit', task: 'T010', title: 'a clearer title' },
      { op: 'edit', task: 'T002', depends_on: ['T001'], estimate_min: 45 }, { op: 'edit', task: 'T001', estimate_min: 30 },
      { op: 'order-tasks', phase: 'F1', tasks: ['T002', 'T001'] }, { op: 'order-phases', phases: ['F2', 'F1', 'F3'] },
      // What changes nothing changes no one's task: the same title, the same phase.
      { op: 'edit', task: 'T002', title: 'task T002' }, { op: 'move', task: 'T003', phase: 'F2' },
    ]);
    expect(r.stderr).toBe('');
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ ok: true, ops: 10 });
  });
  it('needs its three flags, a state listing (M-11) and operations waypoint reads', () => {
    const op = [{ op: 'move', task: 'T004', phase: 'F1' }];
    expect(check(op).code, 'control').toBe(0);
    for (const drop of ['--ops', '--plan', '--db']) {
      const args = ['--ops', 'ops.json', '--plan', 'plan.yaml', '--db', 'db'];
      const i = args.indexOf(drop);
      args.splice(i, 2);
      expect(run(['proposals', 'replan-check', ...args], { cwd: root, now: () => T0, env: {} }).code, drop).toBe(2);
    }
    writeFileSync(path.join(root, 'ops.json'), JSON.stringify({ ops: op }));
    const noState = run(['proposals', 'replan-check', '--ops', 'ops.json', '--plan', 'plan.yaml', '--db', 'nodb'], { cwd: root, now: () => T0, env: {} });
    expect(noState.code).toBe(2);
    expect(noState.stderr).toContain('list state first');
    expect(check([]).code, 'an empty list').toBe(2);
    expect(check([{ op: 'delete-phase', id: 'F1' }]).code, 'an unknown op').toBe(2);
    // Minor 7: a plan that does not parse is named under the subcommand (with operations that read).
    writeFileSync(path.join(root, 'ops.json'), JSON.stringify({ ops: op }));
    writeFileSync(path.join(root, 'broken.yaml'), 'project: g\nphases: [\n');
    const broken = run(['proposals', 'replan-check', '--ops', 'ops.json', '--plan', 'broken.yaml', '--db', 'db'], { cwd: root, now: () => T0, env: {} });
    expect(broken.code).toBe(2);
    expect(broken.stderr.startsWith('proposals replan-check: broken.yaml: ')).toBe(true);
    writeFileSync(path.join(root, 'ops.json'), 'not json');
    expect(run(['proposals', 'replan-check', '--ops', 'ops.json', '--plan', 'plan.yaml', '--db', 'db'], { cwd: root, now: () => T0, env: {} }).code, 'no JSON').toBe(2);
    // A UTF-8 BOM, as waypoint replan reads it, is no part of the JSON.
    writeFileSync(path.join(root, 'ops.json'), String.fromCharCode(0xfeff) + JSON.stringify({ ops: op }));
    expect(run(['proposals', 'replan-check', '--ops', 'ops.json', '--plan', 'plan.yaml', '--db', 'db'], { cwd: root, now: () => T0, env: {} }).code, 'BOM').toBe(0);
  });
});
