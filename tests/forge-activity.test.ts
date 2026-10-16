import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { forgeActivityFrom, forgeRoleOf, memberOfHook, activityMember } from '../src/lib/forge-activity.js';

const T = '2026-10-12T12:00:00.000Z';
const exec = (over: Record<string, unknown> = {}) => JSON.stringify({
  runId: 'r1', kind: 'plan', mode: 'subagents', parallel: 3, project: 'shop', base: 'main', branch: 'forge/run-shop', mergeOnFinish: false,
  coordinator: 'main', hookSession: 'claude-coord', active: true, stopReason: null, stallReason: null, startedAt: T, lastStepAt: null,
  lastBlockStep: null, sleepUntil: null, tasks: {}, ...over,
});
const member = (over: Record<string, unknown> = {}) => JSON.stringify({ sessionId: 'backend', role: 'executor', runId: 'r1', task: 'T2', name: null, since: T, hookSession: 'claude-member', ...over });
const run = (over: Record<string, unknown> = {}) => JSON.stringify({
  mode: 'infinite', active: true, startedAt: T, budget: { cycles: 3 }, cycle: 0, noProgress: 0, lastError: null, repeatedError: false,
  lastBlockEvents: null, queueMax: 10, sessionId: 'claude-inf', blocksSinceCycle: 0, ...over,
});

describe('forge activity, read by waypoint without importing forge (A-07)', () => {
  it('forgeRoleOf gives the coordinator, a member and the infinite run of a session', () => {
    const a = forgeActivityFrom({ execution: exec(), members: [member(), null, '{oops'], run: run() });
    expect(forgeRoleOf(a, 'claude-coord')).toBe('coordinator');
    expect(forgeRoleOf(a, 'claude-member')).toBe('member');
    expect(forgeRoleOf(a, 'claude-inf')).toBe('infinite');
    expect(forgeRoleOf(a, 'someone-else')).toBeNull();
    expect(forgeRoleOf(a, null)).toBeNull();
    expect(forgeRoleOf(a, '../x')).toBeNull();
  });
  it('an inactive execution or run, a member of another run and broken JSON give no role', () => {
    const off = forgeActivityFrom({ execution: exec({ active: false, stopReason: 'stopped' }), members: [member()], run: run({ active: false }) });
    for (const s of ['claude-coord', 'claude-member', 'claude-inf']) expect(forgeRoleOf(off, s)).toBeNull();
    expect(forgeRoleOf(forgeActivityFrom({ execution: exec(), members: [member({ runId: 'r0' })], run: null }), 'claude-member')).toBeNull();
    const broken = forgeActivityFrom({ execution: '{"runId":', members: [], run: 'nope' });
    expect(broken).toEqual({ execution: null, members: [], infinite: null });
  });
  it('memberOfHook finds a member by its hook id, or by its SID when it recorded no other hook id', () => {
    const list = [activityMember(JSON.parse(member()))!, activityMember(JSON.parse(member({ sessionId: 'same', hookSession: null })))!];
    expect(memberOfHook(list, 'claude-member', 'r1')?.sessionId).toBe('backend');
    expect(memberOfHook(list, 'same', 'r1')?.sessionId).toBe('same');
    expect(memberOfHook(list, 'backend', 'r1')).toBeNull();
    expect(memberOfHook(list, 'claude-member', 'r2')).toBeNull();
    expect(activityMember({ sessionId: 'a b', runId: 'r1' })).toBeNull();
  });
  it('waypoint reads forge only through src/lib: src/cli/run.ts gains no import of src/forge', () => {
    const src = readFileSync(new URL('../src/cli/run.ts', import.meta.url), 'utf8');
    expect([...src.matchAll(/from '(\.\.\/forge\/[^']+)'/g)].map(m => m[1])).toEqual(['../forge/config.js']);
    const lib = readFileSync(new URL('../src/lib/forge-activity.ts', import.meta.url), 'utf8');
    expect(lib).not.toMatch(/from 'node:/);
    expect(lib).not.toMatch(/from '\.\.\/forge\//);
  });
});
