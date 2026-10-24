import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { run } from '../src/forge/cli/run.js';
import { startRun, saveRun } from '../src/forge/run.js';
import { saveApproval, saveProposal } from '../src/forge/proposals.js';
import { appendEvent } from '../src/forge/ledger.js';
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
    expect(JSON.parse(phase().stdout)).toEqual({ closed: 'F1', phases: [{ id: 'F1', done: 1, total: 1 }, { id: 'F2', done: 0, total: 1 }, { id: 'F3', done: 0, total: 0 }] });
    expect(JSON.parse(phase('--mark', 'F1').stdout).closed).toBeNull();
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
    chat: 'p20261022100000ffff', held: 'p20261022100000gggg', policy: 'p20261022100000hhhh' };
  const link = (id: string) => `includes: "(proposal ${id})"`;
  const task = (id: string, phaseId: string, extra = '') => `  - id: ${id}\n    title: task ${id}\n    track: core\n    phase: ${phaseId}\n    done_when: the check of ${id} passes\n${extra ? `    ${extra}\n` : ''}`;
  const PLAN2 = `project: g\nlocale: en\nversion: "0.1"\ntracks:\n  - { id: core, name: Core, color: blue }\nphases:\n  - { id: F1, name: Base }\n  - { id: F2, name: Juice }\ntasks:\n`
    + task('T001', 'F1', link(P.run)) + task('T002', 'F1', link(P.user)) + task('T003', 'F2', link(P.owner)) + task('T004', 'F2', link(P.run))
    + task('T005', 'F2') + task('T006', 'F2', link(P.gone)) + task('T007', 'F2', link(P.bare)) + task('T008', 'F2', link(P.chat)) + task('T009', 'F2')
    + task('T010', 'F2', link(P.policy));
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
    put(P.run, doc());
    // A person's idea the run judged keeps `source: user`: the mark of forge:auto does not make it the run's.
    put(P.user, doc({ source: 'user', author: 'borja' }));
    put(P.owner, doc({ status: 'approved', decidedBy: 'user' }), 'page');
    put(P.bare, doc(), null);
    put(P.chat, doc());
    appendEvent(root, { ts: T0.toISOString(), kind: 'proposal', action: 'add', id: P.chat, from: 'chat', owner: true });
    put(P.held, doc({ source: 'user', taskId: 'T009' }));
    put(P.policy, doc({ decidedBy: 'forge:policy' }), 'forge:policy');
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
  it('a person\'s idea is known by its ledger too, and a proposal holds the task its taskId names', () => {
    expect(check([{ op: 'retire', task: 'T008', why: 'w' }]).stderr).toContain(P.chat);
    expect(check([{ op: 'move', task: 'T009', phase: 'F1' }]).stderr).toContain(P.held);
  });
  it('fails closed: a task whose proposal is not here, or holds no mark, is not the run\'s to change', () => {
    expect(check([{ op: 'retire', task: 'T006', why: 'w' }]).stderr).toContain(P.gone);
    expect(check([{ op: 'move', task: 'T007', phase: 'F1' }]).stderr).toContain(P.bare);
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
    writeFileSync(path.join(root, 'ops.json'), 'not json');
    expect(run(['proposals', 'replan-check', '--ops', 'ops.json', '--plan', 'plan.yaml', '--db', 'db'], { cwd: root, now: () => T0, env: {} }).code, 'no JSON').toBe(2);
    // A UTF-8 BOM, as waypoint replan reads it, is no part of the JSON.
    writeFileSync(path.join(root, 'ops.json'), String.fromCharCode(0xfeff) + JSON.stringify({ ops: op }));
    expect(run(['proposals', 'replan-check', '--ops', 'ops.json', '--plan', 'plan.yaml', '--db', 'db'], { cwd: root, now: () => T0, env: {} }).code, 'BOM').toBe(0);
  });
});
