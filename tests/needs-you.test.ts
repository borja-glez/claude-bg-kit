import { describe, it, expect } from 'vitest';
import { AUTH_ID, AUTH_PENDING_MS, NEED_KINDS, needsYou, type NeedsInput, type NeedsRun } from '../src/lib/needs-you.js';
import { MERGE_AUTH_TTL_MS, MOF_LAUNCH_TTL_MS, newAuthId } from '../src/forge/auth.js';
import { isSafeId } from '../src/lib/execution-state.js';

const NOW = Date.parse('2026-10-24T12:00:00.000Z');
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const RUN = (over: Partial<NeedsRun> = {}): NeedsRun => ({ runId: 'r1', active: true, stopReason: null, stallReason: null, startedAt: ago(120), lastStepAt: ago(50), closedAt: null, coordinatorOpen: false, ...over });
const AUTH = (over: object = {}) => ({ authId: 'merge-r1-ab12', kind: 'merge', runId: 'r1', target: 'main', question: 'q', yes: 'Sí', createdAt: ago(30), session: 's1', ...over });
// One of each source waiting for the person, oldest first: the surface (90 min), the question (80), the proposal (70),
// the design (60), the review round's question (40) and the authorization (30).
const ALL = (over: Partial<NeedsInput> = {}): NeedsInput => ({
  now: NOW, run: RUN(),
  asked: { T003: { file: '.forge/work/shop/T003/reviews-1-2/asked.json', doc: JSON.stringify({ at: ago(40), findings: ['F2', 'F5'], next: null }) } },
  auth: { 'merge-r1-ab12': JSON.stringify(AUTH()) },
  surfaces: { docs: { web: JSON.stringify({ task: 'T004', at: ago(90) }) }, decided: [] },
  notes: { n1: { ts: ago(80), type: 'question', author: 'session:main', text: '¿Postgres o SQLite?', taskId: 'T002' } },
  proposals: { p20261024100000abcd: { ts: ago(70), status: 'proposed', title: 'Cache the parser', category: 'perf', risk: 'low' } },
  design: { project: 'shop', read: { version: 4, ready: true, since: ago(60) } },
  ...over,
});

describe('needsYou (w7 A5)', () => {
  it('lists what waits in each source, oldest first, with its kind, what, where, since and how', () => {
    const items = needsYou(ALL());
    expect(items.map(n => n.kind)).toEqual(['surface', 'question', 'proposal', 'design-approval', 'review-question', 'authorization']);
    expect(items[0]).toEqual({ kind: 'surface', id: 'web', what: 'web', task: 'T004', runId: 'r1', file: '.forge/execution/asked/r1/web.json', since: ago(90), command: '/forge:run --resume', place: null });
    expect(items[1]).toEqual({ kind: 'question', id: 'n1', what: '¿Postgres o SQLite?', task: 'T002', runId: null, file: null, since: ago(80), command: null, place: 'roadmap' });
    expect(items[2]).toMatchObject({ id: 'p20261024100000abcd', what: 'Cache the parser', file: '.forge/proposals/p20261024100000abcd.json', command: '/forge:decide p20261024100000abcd', place: null });
    expect(items[3]).toMatchObject({ id: 'shop', what: 'v4', file: 'docs/waypoint/shop/design.md', since: ago(60), command: '/waypoint:design approve' });
    expect(items[4]).toMatchObject({ id: 'T003', what: 'F2, F5', task: 'T003', runId: 'r1', file: '.forge/work/shop/T003/reviews-1-2/asked.json', command: '/forge:run --resume', place: null });
    expect(items[5]).toMatchObject({ id: 'merge-r1-ab12', what: 'main', runId: 'r1', file: '.forge/execution/auth/merge-r1-ab12.json', since: ago(30), command: '/forge:run --resume' });
    expect(NEED_KINDS).toHaveLength(8);
    // A parked proposal waits for the person too; a merge-on-finish asked at launch is answered where it was asked.
    expect(needsYou({ now: NOW, proposals: { p: { ts: ago(5), status: 'discussing', title: 't', parked: { why: 'w', loses: 'l', at: ago(5) } } } })).toMatchObject([{ kind: 'proposal' }]);
    expect(needsYou({ now: NOW, auth: { x: AUTH({ authId: 'mof-launch-ab12', kind: 'merge-on-finish', runId: null }) } }))
      .toMatchObject([{ kind: 'authorization', runId: null, command: null, place: 'conversation' }]);
  });
  it("2c: what belongs to a run whose coordinator's conversation is open is answered there; else with /forge:run --resume", () => {
    const stalled = RUN({ active: false, stopReason: 'stalled', stallReason: 'T2 sigue bloqueada', lastStepAt: ago(20) });
    expect(needsYou({ now: NOW, run: { ...stalled, coordinatorOpen: true } })).toEqual([
      { kind: 'run', id: 'r1', what: 'stalled: T2 sigue bloqueada', task: null, runId: 'r1', file: '.forge/execution.json', since: ago(20), command: null, place: 'coordinator' },
    ]);
    expect(needsYou({ now: NOW, run: stalled })).toMatchObject([{ kind: 'run', command: '/forge:run --resume', place: null }]);
    expect(needsYou({ now: NOW, run: { ...stalled, coordinatorOpen: null } })).toMatchObject([{ kind: 'run', command: '/forge:run --resume' }]);
    expect(needsYou({ now: NOW, run: { ...stalled, stallReason: 'untrusted-commands' } }).map(n => [n.kind, n.file])).toEqual([['untrusted-commands', '.forge/config.yaml']]);
    const open = needsYou(ALL({ run: RUN({ coordinatorOpen: true }) })).filter(n => n.runId === 'r1');
    expect(open.map(n => [n.kind, n.place, n.command])).toEqual([['surface', 'coordinator', null], ['review-question', 'coordinator', null], ['authorization', 'coordinator', null]]);
  });
  it('nothing read, or sources with nothing waiting, list nothing', () => {
    expect(needsYou({ now: NOW })).toEqual([]);
    expect(needsYou({ now: NOW, run: RUN(), asked: {}, auth: {}, surfaces: { docs: {}, decided: [] }, notes: {}, proposals: {} })).toEqual([]);
  });
  it('what was answered, used, decided, closed or let lapse lists nothing (Review Focus 3)', () => {
    const none = (over: Partial<NeedsInput>) => expect(needsYou({ now: NOW, run: RUN(), ...over }), JSON.stringify(over).slice(0, 120)).toEqual([]);
    none({ asked: { T003: { file: 'f', doc: { at: ago(5), findings: [], ruling: { kind: 'fix' } } } } });
    none({ auth: { a: AUTH({ answer: 'yes', answeredAt: ago(1) }) } });
    none({ auth: { a: AUTH({ usedAt: ago(1) }) } });
    none({ auth: { a: AUTH({ createdAt: ago(61) }) } });
    none({ auth: { a: AUTH({ authId: 'mof-r1-ab12', kind: 'merge-on-finish', createdAt: ago(24 * 60 + 1) }) } });
    none({ auth: { a: AUTH({ runId: 'r0' }) } });
    none({ run: RUN({ closedAt: ago(1) }), auth: { a: AUTH() } });
    none({ run: undefined, auth: { a: AUTH() } });
    none({ notes: { n: { ts: ago(5), type: 'question', author: 'a', text: 't', answer: 'sí' } } });
    none({ notes: { n: { ts: ago(5), type: 'question', author: 'a', text: 't', answeredByNote: 'e1' } } });
    none({ notes: { n: { ts: ago(5), type: 'idea', author: 'a', text: 't' } } });
    for (const status of ['approved', 'rejected', 'auto_approved', 'done']) none({ proposals: { p: { ts: ago(5), status, title: 't' } } });
    none({ surfaces: { docs: { web: { task: 'T1', at: ago(5) } }, decided: ['web'] } });
    none({ run: RUN({ active: false, stopReason: 'stalled', stallReason: 'x', closedAt: ago(1) }), surfaces: { docs: { web: { task: 'T1', at: ago(5) } }, decided: [] } });
    none({ run: RUN({ active: false, stopReason: 'stalled', stallReason: 'x', lastStepAt: ago(24 * 60) }) });
    none({ run: RUN({ active: false, stopReason: 'finished' }) });
    none({ design: { project: 'shop', read: { version: 2, ready: false, since: ago(5) } } });
  });
  it('an unreadable source is one unverified item of its kind, after the rest, and never fails the list', () => {
    const items = needsYou(ALL({
      auth: { 'merge-r1-ab12': JSON.stringify(AUTH()), 'merge-r1-yy88': '{nope', 'merge-r1-zz99': null },
      proposals: { p1: { ts: ago(70), status: 'proposed', title: 'Cache the parser' }, p2: 42 },
      notes: { n1: 'not json' },
    }));
    const bad = items.filter(n => n.unverified);
    expect(bad.map(n => [n.kind, n.file])).toEqual([['authorization', '.forge/execution/auth/merge-r1-yy88.json'], ['question', null], ['proposal', '.forge/proposals/p2.json']]);
    expect(bad.every(n => n.id === '' && n.what === '' && n.since === null && n.command === null && n.place === null)).toBe(true);
    expect(items.slice(-3)).toEqual(bad);
    expect(items.filter(n => !n.unverified).map(n => n.kind)).toEqual(['surface', 'proposal', 'design-approval', 'review-question', 'authorization']);
    expect(needsYou({ now: NOW, run: null, design: { project: 'shop', read: null } }).map(n => [n.kind, n.file, n.unverified]))
      .toEqual([['run', '.forge/execution.json', true], ['design-approval', 'docs/waypoint/shop/design.md', true]]);
  });
  it('free text comes as one clean line of at most 200 characters, and an id that is no safe id leaves no task (Review Focus 4)', () => {
    // Built from its code point: tests/source-text.test.ts forbids a raw bidi control in a source file.
    const rlo = String.fromCharCode(0x202e);
    const [n] = needsYou({ now: NOW, notes: { n1: { ts: ago(1), type: 'question', author: 'a', text: `a\nb${rlo}${'x'.repeat(400)}`, taskId: '../T1' } } });
    expect(n.what).toBe(`a b${'x'.repeat(197)}`);
    expect(n.task).toBeNull();
    // The rule of isSafeId, which needs-you.ts keeps a copy of so the roadmap page bundles no execution-state.ts.
    for (const id of ['T002', 'a.b_c-1', 'x'.repeat(120), 'x'.repeat(121), '../T1', '.', '..', 'a b', 'a:b']) {
      const [m] = needsYou({ now: NOW, notes: { n1: { ts: ago(1), type: 'question', author: 'a', text: 't', taskId: id } } });
      expect(m.task, id).toBe(isSafeId(id) ? id : null);
    }
  });
  it('a file path comes from the record key, not from the id cleaned and cut at 120', () => {
    const long = `merge-${'r'.repeat(150)}-ab12`;
    const [a] = needsYou({ now: NOW, auth: { [long]: AUTH({ runId: null, kind: 'merge-on-finish' }) } });
    expect(a.id).toHaveLength(120);
    expect(a.file).toBe(`.forge/execution/auth/${long}.json`);
    const [p] = needsYou({ now: NOW, proposals: { 'p x': { ts: ago(1), status: 'proposed', title: 't' } } });
    expect(p.file).toBe('.forge/proposals/p x.json');
    expect(p.command).toBeNull();
  });
  it('an id cut at 120 never leaves half of a surrogate pair (A5.m8)', () => {
    const [a] = needsYou({ now: NOW, auth: { [`merge-${"r".repeat(113)}😀`]: AUTH({ runId: null, kind: 'merge-on-finish' }) } });
    expect(a.id).toBe(`merge-${"r".repeat(113)}😀`);
    expect(a.id).not.toMatch(/[�-�](?![�-�])/);
  });
  it('a date ahead of the clock or unreadable counts as none, after the dated ones (Review Focus 5)', () => {
    const q = (ts: string, text: string) => ({ ts, type: 'question', author: 'x', text });
    const items = needsYou({ now: NOW, notes: { a: q(new Date(NOW + 10 * 60_000).toISOString(), 'future'), b: q('yesterday', 'junk date'), c: q(ago(5), 'dated') } });
    expect(items.map(n => [n.what, n.since])).toEqual([['dated', ago(5)], ['future', null], ['junk date', null]]);
  });
  it("the pending windows and the record ids are forge's own (src/forge/auth.ts)", () => {
    expect(AUTH_PENDING_MS).toEqual({ merge: MERGE_AUTH_TTL_MS, 'merge-on-finish': MOF_LAUNCH_TTL_MS });
    for (const kind of ['merge', 'merge-on-finish'] as const) for (const run of ['run-shop-1', null]) expect(newAuthId(kind, run, () => 0.5)).toMatch(AUTH_ID);
  });
});
