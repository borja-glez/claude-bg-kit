import { describe, it, expect } from 'vitest';
import { parsePlan } from '../src/lib/plan.js';
import { proposalToTask } from '../src/forge/to-task.js';
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
  it('numbers after the highest T id and uses the first track', () => {
    const { task } = proposalToTask(parsePlan(planText('en')), prop({ path: 'src/**' }), {});
    expect(task).toMatchObject({ id: 'T008', track: 'backend', phase: 'PX', title: 'Cut dead code', done_when: 'Cut dead code — validators pass', zones: ['src/**'], estimate_min: 30, depends_on: [] });
    expect(task.includes).toHaveLength(300);
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
