import { describe, it, expect } from 'vitest';
import { normalizeMeta, normalizePhase, normalizeState, normalizeSession, normalizeEvent, normalizeMessage, normalizeInfinite, normalizeRun, normalizeForgeV1 } from '../src/page/normalize.js';

describe('normalizeRun / execution fields', () => {
  it('normalizeRun keeps valid fields and drops junk', () => {
    expect(normalizeRun({ runId: 'r1', mode: 'subagents', parallel: 3, branch: 'forge/run-x', mergeOnFinish: true, active: true, stopReason: null, coordinator: 'main',
      slots: [{ task: 'T1', stage: 'review', agent: 'a', by: 'main', since: '2026-10-12T12:00:00.000Z' }, { task: 5 }] }))
      .toMatchObject({ runId: 'r1', parallel: 3, slots: [{ task: 'T1', stage: 'review' }] });
    expect(normalizeRun({ mode: 'threads' })).toBeNull();
    expect(normalizeRun({ runId: 'r1', mode: 'subagents', parallel: 99, branch: 'b', coordinator: 'c', active: true, slots: 'x' })).toMatchObject({ parallel: 10, slots: [] });
  });
  it('sessions keep role, runId and leaseUntil; states keep exec', () => {
    expect(normalizeSession({ name: 'm', heartbeatAt: 'x', role: 'coordinator', runId: 'r1', leaseUntil: '2026-10-12T12:10:00.000Z' })).toMatchObject({ role: 'coordinator', runId: 'r1', leaseUntil: '2026-10-12T12:10:00.000Z' });
    expect(normalizeState({ status: 'in_progress', exec: { runId: 'r1', mode: 'subagents', by: 'main', agent: 'x', stage: 'implement', round: 1, since: '2026-10-12T12:00:00.000Z', leaseUntil: '2026-10-12T12:10:00.000Z' } }).exec).toMatchObject({ stage: 'implement', by: 'main' });
  });
  it('drops exec when since or leaseUntil is not a date', () => {
    const exec = { runId: 'r1', mode: 'subagents', by: 'main', agent: 'x', stage: 'implement', round: 1, since: '2026-10-12T12:00:00.000Z', leaseUntil: '2026-10-12T12:10:00.000Z' };
    expect(normalizeState({ status: 'in_progress', exec: { ...exec, since: 'yesterday-ish' } }).exec).toBeUndefined();
    expect(normalizeState({ status: 'in_progress', exec: { ...exec, leaseUntil: 'soon' } }).exec).toBeUndefined();
  });
  it('normalizeRun keeps the kind and the loose tasks of an ephemeral run, and drops junk', () => {
    const run = { runId: 'loose-1', mode: 'subagents', parallel: 2, branch: 'main', coordinator: 'main', active: true, slots: [] };
    const ok = { id: 'fix-cart', title: '  Fix the cart  ', status: 'running', stage: 'implement', agent: 'forge-mech' };
    const r = normalizeRun({ ...run, kind: 'ephemeral', loose: [
      ok,
      { id: 'docs-typo', title: 'Typo', status: 'queued', stage: null, agent: null },
      { id: '../etc', title: 'x', status: 'queued', stage: null, agent: null },
      { id: 'fix-cart', title: 'again', status: 'queued', stage: null, agent: null },
      { id: 'no-title', title: '   ', status: 'queued', stage: null, agent: null },
      { id: 'bad-status', title: 'x', status: 'accepted', stage: null, agent: null },
      { id: 'bad-stage', title: 'x', status: 'running', stage: 'deploy', agent: 7 },
      'junk', null,
    ] })!;
    expect(r.kind).toBe('ephemeral');
    expect(r.loose).toEqual([
      { id: 'fix-cart', title: 'Fix the cart', status: 'running', stage: 'implement', agent: 'forge-mech' },
      { id: 'docs-typo', title: 'Typo', status: 'queued', stage: null, agent: null },
      { id: 'bad-stage', title: 'x', status: 'running', stage: null, agent: null },
    ]);
    expect(normalizeRun({ ...run, kind: 'ephemeral', loose: [{ ...ok, title: 'x'.repeat(300) }] })!.loose[0].title).toHaveLength(200);
    const many = Array.from({ length: 30 }, (_, i) => ({ ...ok, id: `t${i}` }));
    expect(normalizeRun({ ...run, kind: 'ephemeral', loose: many })!.loose).toHaveLength(20);
  });
  it('normalizeRun keeps a loose task seconds only when it is a sane number', () => {
    const run = { runId: 'loose-1', mode: 'subagents', parallel: 2, branch: 'main', coordinator: 'main', active: true, slots: [], kind: 'ephemeral' };
    const t = (seconds: unknown) => ({ id: 'fix-cart', title: 'Fix', status: 'integrated', stage: 'integrate', agent: null, seconds });
    expect(normalizeRun({ ...run, loose: [t(1320.4)] })!.loose[0].seconds).toBe(1320);
    for (const bad of [-5, 'x', NaN, null, 40 * 86400]) expect(normalizeRun({ ...run, loose: [t(bad)] })!.loose[0]).not.toHaveProperty('seconds');
  });
  it('normalizeRun reads an older meta/run as a plan run without loose tasks', () => {
    const run = { runId: 'r1', mode: 'subagents', parallel: 3, branch: 'forge/run-x', coordinator: 'main', active: true, slots: [] };
    expect(normalizeRun(run)).toMatchObject({ kind: 'plan', loose: [] });
    expect(normalizeRun({ ...run, kind: 'weird', loose: 'x' })).toMatchObject({ kind: 'plan', loose: [] });
    expect(normalizeRun({ ...run, kind: 'plan', loose: [{ id: 'a', title: 'a', status: 'queued', stage: null, agent: null }] })!.loose).toEqual([]);
  });
});

describe('normalizeMeta', () => {
  it('rejects non-objects', () => {
    for (const v of [null, undefined, 5, 'x', []]) expect(normalizeMeta(v)).toBeNull();
  });
  it('coerces garbage fields', () => {
    const m = normalizeMeta({ name: 5, locale: null, version: { a: 1 }, tracks: 'x', versions: 3, phaseOrder: null, metrics: 7, syncedAt: undefined })!;
    expect(m.name).toBe('5');
    expect(m.locale).toBe('');
    expect(m.tracks).toEqual([]);
    expect(m.versions).toEqual([]);
    expect(m.phaseOrder).toEqual([]);
    expect(m.metrics).toEqual({});
    expect(m.syncedAt).toBe('');
  });
  it('filters tracks and lastCommit', () => {
    const m = normalizeMeta({ tracks: [{ id: 'a', name: 'A', color: 'blue' }, { id: 1, name: 'B' }, null], metrics: { tests: 3, lastCommit: { sha: 5, ts: 'x' } } })!;
    expect(m.tracks.map(t => t.id)).toEqual(['a']);
    expect(m.metrics.lastCommit).toBeUndefined();
    expect(normalizeMeta({ metrics: { lastCommit: { sha: 'abc', ts: '2026-01-01T00:00:00Z' } } })!.metrics.lastCommit).toEqual({ sha: 'abc', ts: '2026-01-01T00:00:00Z' });
  });
});

describe('normalizePhase', () => {
  it('needs a string id', () => {
    expect(normalizePhase({ id: 4 })).toBeNull();
    expect(normalizePhase(null)).toBeNull();
  });
  it('cleans tasks', () => {
    const p = normalizePhase({ id: 'F1', name: 9, order: 'x', tasks: [{ id: 'T1', title: 'a', depends_on: 'x', zones: [1, 'z'], done_when: 4, track: 't', phase: 'F1' }, { id: 2, title: 'b' }, 'junk'] })!;
    expect(p.order).toBe(0);
    expect(p.tasks).toHaveLength(1);
    expect(p.tasks[0]).toMatchObject({ depends_on: [], zones: ['z'], done_when: '' });
  });
  it('tolerates missing tasks', () => {
    expect(normalizePhase({ id: 'F1', tasks: 'x' })!.tasks).toEqual([]);
  });
});

describe('normalizeState', () => {
  it('drops malformed commits and timestamps', () => {
    const s = normalizeState({ status: 'done', commits: [{ sha: 'a', title: 't', add: 1 }, { sha: 1 }, 'x'], blockedBy: [1, 'T1'], startedAt: 5, doneAt: '2026-01-01' });
    expect(s.commits).toHaveLength(1);
    expect(s.blockedBy).toEqual(['T1']);
    expect(s.startedAt).toBeUndefined();
    expect(s.doneAt).toBe('2026-01-01');
  });
  it('handles garbage', () => {
    expect(normalizeState('x').commits).toBeUndefined();
    expect(normalizeState({ commits: 'x', blockedBy: 'y' })).toMatchObject({ commits: [], blockedBy: undefined });
    expect(normalizeState(null)).toBeTruthy();
  });
});

describe('normalizeSession / normalizeEvent', () => {
  it('coerces strings', () => {
    expect(normalizeSession({ name: 5, heartbeatAt: null, status: 'active' })).toMatchObject({ name: '5', heartbeatAt: '' });
    expect(normalizeSession(null)).toMatchObject({ name: '', heartbeatAt: '' });
    expect(normalizeEvent({ ts: 1, type: null, sessionId: 2, text: 5 })).toMatchObject({ ts: '', type: '', sessionId: '', text: '5' });
    expect(normalizeEvent(undefined)).toMatchObject({ ts: '' });
  });
});

describe('normalizeMessage', () => {
  it('keeps a valid message', () => {
    const m = { ts: '2026-10-11T10:00:00Z', from: 'a', to: 'b', type: 'reply', taskId: 'T1', text: 'hi', status: 'resolved', replyTo: 'm1' };
    expect(normalizeMessage(m)).toEqual(m);
  });
  it('rejects non-objects', () => {
    for (const v of [null, 5, 'x']) expect(normalizeMessage(v)).toBeNull();
  });
  it('coerces garbage', () => {
    expect(normalizeMessage({ from: 5, to: null, text: {} })).toMatchObject({ from: '5', to: '', text: '[object Object]', status: 'open' });
    expect(normalizeMessage({ status: 'weird' })!.status).toBe('open');
  });
  it('keeps session extras only when text', () => {
    expect(normalizeSession({ agentName: 'a', branch: 'b', worktree: 5 })).toMatchObject({ agentName: 'a', branch: 'b', worktree: undefined });
    expect(normalizeSession({ busyUntil: '2026-10-11T11:00:00Z' }).busyUntil).toBe('2026-10-11T11:00:00Z');
    expect(normalizeSession({ busyUntil: { __delete__: true } }).busyUntil).toBeUndefined();
  });
});

describe('normalizeNote (page)', () => {
  it('drops invalid notes and trims text', async () => {
    const { normalizeNote } = await import('../src/page/normalize.js');
    expect(normalizeNote({ type: 'nope', author: 'a', text: 'x' })).toBeNull();
    expect(normalizeNote(null)).toBeNull();
    expect(normalizeNote({ type: 'idea', author: 'user:u', text: 'y'.repeat(3000), ts: 5 })).toMatchObject({ ts: '', text: 'y'.repeat(2000) });
  });
});

describe('normalizeState forge', () => {
  it('keeps a forge block with string path and phase, dropping mistyped fields', () => {
    const s = normalizeState({ status: 'in_progress', forge: { path: 'medium', phase: 'implement', round: 'x' } });
    expect(s.forge).toEqual({ path: 'medium', phase: 'implement' });
    expect(normalizeState({ status: 'in_progress', forge: 'bad' }).forge).toBeUndefined();
    expect(normalizeState({ status: 'in_progress', forge: { path: 1, phase: 'x' } }).forge).toBeUndefined();
    const full = normalizeState({ forge: { path: 'large', phase: 'review', agent: 'a', validators: [{ name: 'test', ok: true }, { name: 1, ok: true }, 'x'], verdict: { action: 'fix', score: 0.5 }, round: 2, cap: 4 } });
    expect(full.forge).toEqual({ path: 'large', phase: 'review', agent: 'a', validators: [{ name: 'test', ok: true }, { name: 'x', ok: null }], verdict: { action: 'fix', score: 0.5 }, round: 2, cap: 4 });
    expect(normalizeState({ forge: { path: 'l', phase: 'p', verdict: { action: 'x', score: 'no' } } }).forge?.verdict).toEqual({ action: 'x', score: null });
  });
  it('keeps a valid evidence block and drops unsafe urls and bad entries', () => {
    const s = normalizeState({ status: 'done', evidence: {
      surfaces: ['web', 3], result: 'fail', passed: 1, total: 2, local: '.forge/work/x/evidence/1-1',
      shots: [
        { url: 'https://claude.ai/_blob/abc', id: 'abc', surface: 'web', check: 'adds', ok: true, expected: 'e', observed: 'o' },
        { url: 'javascript:alert(1)', surface: 'web', check: 'removes', ok: false },
        { surface: 'web', ok: 'yes' },
      ],
    } });
    expect(s.evidence).toEqual({ surfaces: ['web'], result: 'fail', passed: 1, total: 2, local: '.forge/work/x/evidence/1-1', shots: [
      { url: 'https://claude.ai/_blob/abc', id: 'abc', surface: 'web', check: 'adds', ok: true, expected: 'e', observed: 'o' },
      { surface: 'web', check: 'removes', ok: false },
    ] });
    expect(normalizeState({ evidence: { result: 'maybe' } }).evidence).toBeUndefined();
    expect(normalizeState({ evidence: { result: 'pass', passed: 1, total: 1, shots: [{ url: '/_blob/id1', surface: 'w', check: 'c', ok: true }] } }).evidence!.shots[0].url).toBe('/_blob/id1');
    const urlOf = (url: string) => normalizeState({ evidence: { result: 'pass', passed: 1, total: 1, shots: [{ url, surface: 'w', check: 'c', ok: true }] } }).evidence!.shots[0].url;
    expect(urlOf('https://evil.example/x.png')).toBeUndefined();
    expect(urlOf('https://claude.ai.evil.example/x.png')).toBeUndefined();
    expect(urlOf('javascript:alert(1)')).toBeUndefined();
  });
});

describe('normalizeInfinite', () => {
  it('rejects non-objects', () => {
    for (const v of [null, undefined, 5, 'x', []]) expect(normalizeInfinite(v)).toBeNull();
  });
  it('keeps a valid doc', () => {
    expect(normalizeInfinite({ active: true, cycle: 3, budget: { cycles: 10, hours: 2.5 }, startedAt: '2026-10-11T09:00:00Z', lastCycleAt: '2026-10-11T11:00:00Z' }))
      .toEqual({ active: true, cycle: 3, budget: { cycles: 10, hours: 2.5 }, startedAt: '2026-10-11T09:00:00Z', lastCycleAt: '2026-10-11T11:00:00Z' });
  });
  it('coerces garbage: active only when true, cycle a non-negative integer, budget numbers dropped when invalid, dates ISO or empty', () => {
    expect(normalizeInfinite({ active: 'yes', cycle: -2, budget: { cycles: 0, hours: 'x' }, startedAt: 'nope', lastCycleAt: 5 }))
      .toEqual({ active: false, cycle: 0, budget: {}, startedAt: '', lastCycleAt: null });
    expect(normalizeInfinite({ active: true, cycle: 2.5, budget: { cycles: 1.5, hours: Infinity } })).toEqual({ active: true, cycle: 0, budget: {}, startedAt: '', lastCycleAt: null });
    expect(normalizeInfinite({ active: true, cycle: 4, budget: 'x' })!.budget).toEqual({});
  });
});

describe('report (H-04, G-03)', () => {
  it('a validator written as a string has no result yet; junk is dropped; the report says each', () => {
    const got: string[] = [];
    const s = normalizeState({ forge: { path: 'medium', phase: 'review', validators: ['test', { name: 'lint', ok: true }, 7, { name: 'e2e', ok: null }] } }, (f, a, d) => got.push(`${f} · ${a} · ${d}`));
    expect(s.forge!.validators).toEqual([{ name: 'test', ok: null }, { name: 'lint', ok: true }, { name: 'e2e', ok: null }]);
    expect(got).toEqual(['forge.validators[0] · coerced · string', 'forge.validators[2] · dropped · number']);
  });
  it('a numeric check is kept as text', () => {
    const got: string[] = [];
    const s = normalizeState({ evidence: { result: 'pass', passed: 1, total: 1, shots: [{ surface: 'web', check: 1, ok: true }] } }, (f, a) => got.push(`${f} · ${a}`));
    expect(s.evidence!.shots[0].check).toBe('1');
    expect(got).toEqual(['evidence.shots[0].check · coerced']);
  });
  it('reports a dropped commit, exec, phase task, run slot and last commit; without a report it only drops', () => {
    const got: string[] = [];
    const rep = (f: string, a: string) => { got.push(`${f} · ${a}`); };
    normalizeState({ exec: { by: 'main' }, commits: [{ sha: 'a', title: 't' }, 5] }, rep);
    normalizePhase({ id: 'F1', tasks: [{ id: 'T1', title: 't' }, { id: 7 }] }, rep);
    normalizeRun({ runId: 'r1', mode: 'subagents', branch: 'b', coordinator: 'c', slots: [{ task: 5 }] }, rep);
    normalizeMeta({ name: 'x', metrics: { lastCommit: { sha: 5 } } }, rep);
    expect(got).toEqual(['commits[1] · dropped', 'exec · dropped', 'tasks[1] · dropped', 'slots[0] · dropped', 'metrics.lastCommit · dropped']);
    expect(normalizeState({ exec: { by: 'main' } })).not.toHaveProperty('exec');
  });
});

describe('normalizeState: forge v2, evidence v2 and blockedReason (C7, wave 4)', () => {
  const v2 = {
    v: 2, path: 'medium', phase: 'done', validators: [{ name: 'test', ok: true, ms: 900, cached: true }], verdict: { action: 'accept', score: 0.9 }, round: 2, cap: 4,
    brief: 1, stage: 'done',
    rounds: [{ brief: 1, n: 2, action: 'accept', note: 'accepted', findings: { critical: 0, important: 1, minor: 3, deferred: 2 }, reviewers: ['correctness'], at: '2026-10-16T10:40:00.000Z' }],
    verify: null, stages: { implement: 540 }, integration: { branch: 'forge/run-shop', sha: 'abc1234', merged: false, target: 'main' },
    deferred: [{ problem: 'no index' }], acceptedRound: 2, overCap: false, updatedAt: '2026-10-16T11:00:00.000Z',
  };
  const v1Of = { path: 'medium', phase: 'done', validators: [{ name: 'test', ok: true }], verdict: { action: 'accept', score: 0.9 }, round: 2, cap: 4 };
  it('a v2 block is read whole, with nothing reported', () => {
    const got: string[] = [];
    expect(normalizeState({ status: 'done', forge: v2 }, f => { got.push(f); }).forge).toEqual(v2);
    expect(got).toEqual([]);
  });
  it('a v2 block that does not parse falls back to its v1 fields, and ?debug=1 lists it', () => {
    const got: string[] = [];
    expect(normalizeState({ forge: { ...v2, rounds: 'x' } }, (f, a) => { got.push(`${f} · ${a}`); }).forge).toEqual(v1Of);
    expect(got).toEqual(['forge.v · dropped']);
  });
  it('the v1 normalizer keeps path, phase, every validator, verdict, round and cap of a v2 block (a page published before wave 4)', () => {
    expect(normalizeForgeV1(v2)).toEqual(v1Of);
  });
  it('evidence v2 keeps v, reason, unchecked and the round of each shot', () => {
    const ev = {
      v: 2, surfaces: ['web'], result: 'blocked', passed: 1, total: 3, reason: 'the server did not start', unchecked: ['checkout', 'refund'], local: '.forge/work/shop/T1/evidence/1-2',
      shots: [
        { surface: 'web', check: 'home', ok: true, round: 2, url: 'https://claude.ai/_blob/a1', id: 'a1' },
        { surface: 'web', check: 'cart', ok: false, round: 2, expected: 'e', observed: 'o' },
      ],
    };
    expect(normalizeState({ evidence: ev }).evidence).toEqual(ev);
    expect(normalizeState({ evidence: { ...ev, unchecked: ['a', 3, ...Array(12).fill('b')], shots: [{ surface: 'w', check: 'c', ok: true, round: 0 }] } }).evidence)
      .toMatchObject({ unchecked: ['a', ...Array(9).fill('b')], shots: [{ surface: 'w', check: 'c', ok: true }] });
  });
  it('each unchecked item is one clean line of at most 200 characters, and an empty one goes', () => {
    const bell = String.fromCharCode(7), rlo = String.fromCharCode(0x202e);
    const ev = { surfaces: [], result: 'blocked', passed: 0, total: 0, unchecked: [`a${bell}b${rlo}c`, 'z'.repeat(500), bell, ''], shots: [] };
    expect(normalizeState({ evidence: ev }).evidence!.unchecked).toEqual(['a bc', 'z'.repeat(200)]);
  });
  it('blockedReason: one clean line of at most 300 characters; anything else is dropped and reported', () => {
    const bell = String.fromCharCode(7), rlo = String.fromCharCode(0x202e);
    const s = normalizeState({ status: 'blocked', blockedReason: `Waits for the${bell} payments${rlo} API ${'.'.repeat(400)}` });
    expect(s.blockedReason!.startsWith('Waits for the payments API')).toBe(true);
    expect(s.blockedReason).toHaveLength(300);
    const got: string[] = [];
    expect(normalizeState({ status: 'blocked', blockedReason: 7 }, (f, a) => { got.push(`${f} · ${a}`); })).not.toHaveProperty('blockedReason');
    expect(got).toEqual(['blockedReason · dropped']);
  });
});
