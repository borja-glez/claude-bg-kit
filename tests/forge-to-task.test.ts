import { describe, it, expect } from 'vitest';
import { parsePlan } from '../src/lib/plan.js';
import { proposalToTask, checkPlacement, MAX_ESTIMATE_MIN } from '../src/forge/to-task.js';
import type { ProposalDoc } from '../src/lib/proposals.js';

const planText = (locale: string, extraPhase = '') => `project: demo
locale: ${locale}
version: "0.1"
versions:
  - id: "0.1"
    phases: [F1]
tracks:
  - { id: backend, name: Backend, color: blue }
  - { id: ui, name: UI, color: mauve }
phases:
  - { id: F1, name: Base, plan_status: committed }
${extraPhase}tasks:
  - { id: T001, title: a, track: backend, phase: F1, done_when: x }
  - { id: T007, title: b, track: backend, phase: F1, done_when: x }
  - { id: X9, title: c, track: backend, phase: F1, done_when: x }
`;
const prop = (over: Partial<ProposalDoc> = {}): ProposalDoc & { id: string } => ({ id: 'p20261011100000aaaa', ts: '', category: 'quality', risk: 'low', title: 'Cut dead code', rationale: 'r'.repeat(400), evidence: '', pillar: 'p', status: 'approved', source: 'scout', author: 'a', ...over });

describe('proposalToTask', () => {
  it('numbers past the ids a replan retired, so a retired task never comes back as a new one (T6B3-RETIRED-IDS)', () => {
    const { task } = proposalToTask(parsePlan(`${planText('en')}retired: [T009, X3, T004]\n`), prop(), {});
    expect(task.id).toBe('T010');
  });
  it('numbers after the highest T id and uses the first track', () => {
    const { task } = proposalToTask(parsePlan(planText('en')), prop({ path: 'src/**' }), {});
    expect(task).toMatchObject({ id: 'T008', track: 'backend', phase: 'PX', title: 'Cut dead code', done_when: 'Cut dead code — validators pass', zones: ['src/**'], estimate_min: 30, depends_on: [] });
    expect(task.includes).toBe(`${'r'.repeat(400)}\n\n(proposal p20261011100000aaaa)`);
  });
  it('keeps the whole rationale, then the evidence and the proposal reference', () => {
    const rationale = `${'El aviso de vencimiento se calcula mal cuando el usuario cambia de zona horaria; '.repeat(4)}y hay que ordenar el apunte por fecha`;
    expect(Array.from(rationale).length).toBeGreaterThan(300);
    const es = proposalToTask(parsePlan(planText('es')), prop({ rationale, evidence: 'src/due.ts:40 usa la hora local' }), {}).task;
    expect(es.includes).toBe(`${rationale}\n\nEvidencia: src/due.ts:40 usa la hora local\n\n(propuesta p20261011100000aaaa)`);
    expect(es.includes).toContain('…apunte por fecha'.slice(1));
    const en = proposalToTask(parsePlan(planText('en')), prop({ rationale: 'why', evidence: 'grep: 3 hits' }), {}).task;
    expect(en.includes).toBe('why\n\nEvidence: grep: 3 hits\n\n(proposal p20261011100000aaaa)');
    expect(proposalToTask(parsePlan(planText('en')), prop({ rationale: '', evidence: 'only this' }), {}).task.includes).toBe('Evidence: only this\n\n(proposal p20261011100000aaaa)');
  });
  it('keeps only the reference to the proposal in includes when rationale and evidence are blank', () => {
    const { task } = proposalToTask(parsePlan(planText('en')), prop({ rationale: '', evidence: '  ' }), {});
    expect(task.includes).toBe('(proposal p20261011100000aaaa)');
  });
  it('maps a simple estimate to minutes, else 30', () => {
    const est = (estimate?: string) => proposalToTask(parsePlan(planText('en')), prop({ estimate }), {}).task.estimate_min;
    expect(est('2h')).toBe(120);
    expect(est('45 min')).toBe(45);
    expect(est('1.5 h')).toBe(90);
    expect(est('a while')).toBe(30);
    expect(est(undefined)).toBe(30);
    expect(est('0 min')).toBe(30);
    expect(est('0.4 min')).toBe(30);
    expect(est('3000000000h')).toBe(30);
    expect(est('169h')).toBe(30);
    expect(est('10080 min')).toBe(10080);
    expect(est('0.6 min')).toBe(1);
  });
  it('honours --track and drops an unsafe path', () => {
    const { task } = proposalToTask(parsePlan(planText('en')), prop({ path: '../x' }), { track: 'ui' });
    expect(task.track).toBe('ui');
    expect(task.zones).toEqual([]);
  });
  it('creates PX once, named by locale', () => {
    expect(proposalToTask(parsePlan(planText('en')), prop(), {}).phase).toEqual({ id: 'PX', name: 'Improvements', plan_status: 'provisional' });
    const es = proposalToTask(parsePlan(planText('es')), prop(), {});
    expect(es.phase?.name).toBe('Mejoras');
    expect(es.task.done_when).toBe('Cut dead code — los validadores pasan');
    expect(proposalToTask(parsePlan(planText('en', '  - { id: PX, name: Improvements, plan_status: provisional }\n')), prop(), {}).phase).toBeNull();
  });
});

describe('placement (6b-3)', () => {
  const plan = parsePlan(planText('en', '  - { id: F2, name: Polish, plan_status: committed }\n'));
  const placement = { phase: 'F2', doneWhen: 'the combo meter doubles the score in the match test', dependsOn: ['T007'], estimateMin: 45 };
  it('puts the task in its phase with its done_when, dependencies and estimate, and no PX', () => {
    const { task, phase } = proposalToTask(plan, prop(), { placement });
    expect(phase).toBeNull();
    expect(task).toMatchObject({ phase: 'F2', done_when: placement.doneWhen, depends_on: ['T007'], estimate_min: 45 });
  });
  it('checkPlacement says what is wrong; an empty phase is a valid target, a done one is not', () => {
    expect(checkPlacement(plan, 'Combo', placement, new Set())).toEqual([]);
    expect(checkPlacement(plan, 'Combo', { ...placement, phase: 'F9' }, new Set()).join()).toContain('F9');
    expect(checkPlacement(plan, 'Combo', { ...placement, dependsOn: ['T099'] }, new Set()).join()).toContain('T099');
    expect(checkPlacement(plan, 'Combo', { ...placement, doneWhen: ' combo ' }, new Set()).length).toBeGreaterThan(0);
    expect(checkPlacement(plan, 'Combo', { ...placement, doneWhen: 'short' }, new Set()).length).toBeGreaterThan(0);
    expect(checkPlacement(plan, 'Combo', { ...placement, estimateMin: 0 }, new Set()).length).toBeGreaterThan(0);
    expect(checkPlacement(plan, 'Combo', { ...placement, phase: 'F1' }, new Set(['T001', 'T007', 'X9'])).join()).toContain('F1');
  });
  it('a done_when that is the title with other capitals and spaces is refused; no dependency is fine; the estimate has a ceiling', () => {
    const title = 'Combo meter doubles the score';
    expect(checkPlacement(plan, title, { ...placement, doneWhen: '  combo METER   doubles the score ' }, new Set()).length).toBeGreaterThan(0);
    expect(checkPlacement(plan, title, { ...placement, dependsOn: [] }, new Set())).toEqual([]);
    expect(checkPlacement(plan, title, { ...placement, estimateMin: MAX_ESTIMATE_MIN + 1 }, new Set()).length).toBeGreaterThan(0);
    expect(checkPlacement(plan, title, { ...placement, estimateMin: 2.5 }, new Set()).length).toBeGreaterThan(0);
    // A phase with one task left open is still a target.
    expect(checkPlacement(plan, title, { ...placement, phase: 'F1' }, new Set(['T001', 'T007']))).toEqual([]);
  });
  it('in a product run the improvements phase is never a placement (L-6)', () => {
    const withPx = parsePlan(planText('en', '  - { id: PX, name: Improvements, plan_status: provisional }\n'));
    const px = { ...placement, phase: 'PX' };
    expect(checkPlacement(withPx, 'Combo', px, new Set(), { product: true }).join()).toContain('PX');
    expect(checkPlacement(withPx, 'Combo', px, new Set())).toEqual([]);
    expect(checkPlacement(withPx, 'Combo', { ...placement, phase: 'F1' }, new Set(), { product: true })).toEqual([]);
  });
});
