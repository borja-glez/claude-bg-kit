import { describe, it, expect } from 'vitest';
import { describeViewer, viewerRole, BOUND_LEASE_MS, PREVIOUS_OFFER_MS, type ViewerInput } from '../src/lib/viewer-role.js';
import type { BoundDoc } from '../src/lib/bound.js';
import type { ExecutionState } from '../src/lib/execution-state.js';
import type { MemberDoc } from '../src/lib/member-doc.js';

const NOW = Date.parse('2026-10-15T12:00:00.000Z');
const at = (min: number) => new Date(NOW + min * 60000).toISOString();
const bound = (over: Partial<BoundDoc> = {}): BoundDoc =>
  ({ sid: 'main', claude: 'A', pid: null, via: 'work', since: at(-60), seenAt: at(-1), endedAt: null, endReason: null, ...over });
const exec = (over: Partial<ExecutionState> = {}): ExecutionState => ({
  runId: 'r1', kind: 'plan', mode: 'subagents', parallel: 2, project: 'shop', base: 'main', branch: 'forge/run-shop', mergeOnFinish: false,
  coordinator: 'main', hookSession: 'C', active: true, stopReason: null, stallReason: null, startedAt: at(-90), lastStepAt: at(-2),
  lastBlockStep: null, sleepUntil: null, tasks: {}, ...over,
});
const member = (over: Partial<MemberDoc> = {}): MemberDoc =>
  ({ sessionId: 'T2', role: 'executor', runId: 'r1', task: 'T2', name: null, since: at(-20), hookSession: 'M', ...over });
const input = (over: Partial<ViewerInput> = {}): ViewerInput => ({ bound: null, execution: null, members: [], sessionId: 'A', now: NOW, ...over });

describe('describeViewer (C3, spec §4.2)', () => {
  it('rule 1: the session bound to a visible execution is its coordinator, also once it ended and until it is closed', () => {
    expect(describeViewer(input({ sessionId: 'C', execution: exec(), bound: bound() })))
      .toEqual({ role: 'owner', subject: 'execution', binding: null, member: null, coordinator: true, since: at(-2), task: null });
    expect(viewerRole(input({ sessionId: 'C', execution: exec({ active: false, stopReason: 'stopped', lastStepAt: at(-40 * 60) }) }))).toBe('owner');
  });
  it('rule 2: a member of the run, found by its hook id', () => {
    const m = member();
    expect(describeViewer(input({ sessionId: 'M', execution: exec(), members: [m] })))
      .toEqual({ role: 'owner', subject: 'execution', binding: null, member: m, coordinator: false, since: at(-20), task: 'T2' });
    expect(viewerRole(input({ sessionId: 'M', execution: exec(), members: [member({ runId: 'r0' })] }))).toBe('other-live');
  });
  it('rule 3: its own binding, also once it ended (the same conversation resumed), with the task of its seat', () => {
    const b = bound({ endedAt: at(-120), endReason: 'resume' });
    expect(describeViewer(input({ bound: [b], openTasks: { main: 'T019' } })))
      .toEqual({ role: 'owner', subject: 'binding', binding: b, member: null, coordinator: false, since: at(-60), task: 'T019' });
  });
  it("rules 4 and 5: someone else's execution, running or left behind", () => {
    expect(describeViewer(input({ sessionId: 'B', execution: exec() }))).toMatchObject({ role: 'other-live', subject: 'execution', since: at(-2), task: null });
    expect(viewerRole(input({ sessionId: 'B', execution: exec(), coordinatorEnded: true }))).toBe('previous');
    expect(viewerRole(input({ sessionId: 'B', execution: exec({ active: false, stopReason: 'stalled' }) }))).toBe('previous');
    expect(viewerRole(input({ sessionId: 'B', execution: exec({ active: false, stopReason: 'stopped', lastStepAt: at(-25 * 60) }) }))).toBe('none');
  });
  it('rule 6: another live binding, the newest seen, with the task of its seat', () => {
    const v = describeViewer(input({ sessionId: 'B', bound: [bound({ sid: 'main-2', claude: 'D', seenAt: at(-3) }), bound()], openTasks: { main: 'T019' } }));
    expect(v).toMatchObject({ role: 'other-live', subject: 'binding', since: at(-1), task: 'T019' });
    expect(v.binding?.sid).toBe('main');
  });
  it('rule 7: a binding that ended or lapsed, offered for 24 hours from its end or last renewal', () => {
    expect(describeViewer(input({ sessionId: 'B', bound: bound({ endedAt: at(-60), endReason: 'clear' }) }))).toMatchObject({ role: 'previous', subject: 'binding', since: at(-60) });
    expect(describeViewer(input({ sessionId: 'B', bound: bound({ seenAt: at(-10) }) }))).toMatchObject({ role: 'previous', since: at(-10) });
  });
  it('rule 7 prefers the newest binding left with a task over a newer one without, and falls back to the newest (I3)', () => {
    const left = bound({ sid: 'main-2', claude: 'W', seenAt: at(-60), endedAt: at(-60), endReason: 'clear' });
    const newer = bound({ sid: 'main-3', claude: 'X', seenAt: at(-5), endedAt: at(-5), endReason: 'clear' });
    expect(describeViewer(input({ sessionId: 'C', bound: [left, newer], openTasks: { 'main-2': 'T003' } }))).toMatchObject({ role: 'previous', binding: left, since: at(-60), task: 'T003' });
    expect(describeViewer(input({ sessionId: 'C', bound: [left, newer] }))).toMatchObject({ role: 'previous', binding: newer, task: null });
  });
  it('rule 8: nothing else is none', () => {
    expect(describeViewer(input())).toEqual({ role: 'none', subject: null, binding: null, member: null, coordinator: false, since: null, task: null });
  });
  it('edges: a lease of exactly 5 minutes has lapsed, an offer of exactly 24 hours is gone, a null session is never the owner', () => {
    const lease = (ms: number) => viewerRole(input({ sessionId: 'B', bound: bound({ seenAt: new Date(NOW - ms).toISOString() }) }));
    expect(lease(BOUND_LEASE_MS - 1)).toBe('other-live');
    expect(lease(BOUND_LEASE_MS)).toBe('previous');
    const offer = (ms: number) => viewerRole(input({ sessionId: 'B', bound: bound({ endedAt: new Date(NOW - ms).toISOString(), endReason: 'other' }) }));
    expect(offer(PREVIOUS_OFFER_MS - 1)).toBe('previous');
    expect(offer(PREVIOUS_OFFER_MS)).toBe('none');
    expect(viewerRole(input({ sessionId: null, bound: bound(), execution: exec({ hookSession: null }) }))).toBe('other-live');
    expect(viewerRole(input({ sessionId: null, bound: bound({ seenAt: at(-30) }) }))).toBe('previous');
  });
  it('the order: an execution comes before the bindings, and the own binding before anyone else', () => {
    expect(viewerRole(input({ sessionId: 'B', execution: exec(), bound: bound() }))).toBe('other-live');
    expect(describeViewer(input({ sessionId: 'A', execution: exec(), bound: bound() })).subject).toBe('binding');
  });
});
