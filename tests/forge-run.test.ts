import { describe, it, expect } from 'vitest';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseRun, startRun, recordCycle, recordExplore, stopReason, saveRun, endRun, type RunState } from '../src/forge/run.js';
import { LEASE_CAP_MINUTES, LEASE_MINUTES } from '../src/lib/coordination.js';
import { infiniteDocOf, seatOf } from '../src/forge/infinite-doc.js';
import { runDocOf } from '../src/forge/run-doc.js';
import { tmpdir } from 'node:os';
import { useTempDirs } from './helpers/tmp.js';
const tmp = useTempDirs();

const T0 = new Date('2026-10-11T10:00:00.000Z');
const ctx = (over: Partial<{ now: Date; stopFile: boolean; approvedPending: number; pendingProposals: number }> = {}) =>
  ({ now: T0, stopFile: false, approvedPending: 0, pendingProposals: 0, ...over });
// 6b-3: the parts of a saturation report the rulings added to the plan's (H-2's openProposals, L-18's waitsOwner and unowned,
// M-10's counts), empty.
const noCounts = { pendingTasks: 0, validatorsFailed: 0, openDefects: 0, openProposals: 0, parked: 0, waitsOwner: 0, unowned: 0 };

describe('parseRun', () => {
  it('reads a valid run', () => {
    const r = startRun(T0, { cycles: 3, hours: 2 });
    expect(parseRun(JSON.stringify(r))).toEqual(r);
    expect(r).toMatchObject({ mode: 'infinite', active: true, startedAt: T0.toISOString(), cycle: 0, noProgress: 0,
      lastError: null, repeatedError: false, lastBlockEvents: null, queueMax: 10, sessionId: null, blocksSinceCycle: 0 });
    const bound = startRun(T0, {}, 10, 'sess-1');
    expect(parseRun(JSON.stringify(bound))).toEqual(bound);
  });
  it('keeps a stoppedReason and a custom queueMax', () => {
    const r = { ...startRun(T0, {}, 4), active: false, stoppedReason: 'stop-file' };
    expect(parseRun(JSON.stringify(r))).toEqual(r);
  });
  it('is null for absent, bad JSON or non-objects', () => {
    expect(parseRun(null)).toBeNull();
    expect(parseRun('{nope')).toBeNull();
    expect(parseRun('[]')).toBeNull();
    expect(parseRun('null')).toBeNull();
  });
  it('is null for a negative, zero, NaN or string budget', () => {
    const base = startRun(T0, {});
    for (const budget of [{ cycles: -1 }, { cycles: 0 }, { hours: -2 }, { cycles: 'x' }, { hours: '3' }, { cycles: 1.5 }, { hours: 'NaN' }, null, []])
      expect(parseRun(JSON.stringify({ ...base, budget }))).toBeNull();
  });
  it('is null when a field is missing or of the wrong type', () => {
    const base = startRun(T0, { cycles: 2 }) as unknown as Record<string, unknown>;
    for (const k of ['mode', 'active', 'startedAt', 'budget', 'cycle', 'noProgress', 'lastError', 'repeatedError', 'lastBlockEvents', 'queueMax', 'sessionId']) {
      const { [k]: _gone, ...rest } = base;
      expect(parseRun(JSON.stringify(rest))).toBeNull();
    }
    expect(parseRun(JSON.stringify({ ...base, cycle: '1' }))).toBeNull();
    expect(parseRun(JSON.stringify({ ...base, cycle: -1 }))).toBeNull();
    expect(parseRun(JSON.stringify({ ...base, startedAt: 'yesterday' }))).toBeNull();
    expect(parseRun(JSON.stringify({ ...base, mode: 'finite' }))).toBeNull();
    expect(parseRun(JSON.stringify({ ...base, queueMax: 0 }))).toBeNull();
    expect(parseRun(JSON.stringify({ ...base, stoppedReason: 3 }))).toBeNull();
    expect(parseRun(JSON.stringify({ ...base, sessionId: 3 }))).toBeNull();
    expect(parseRun(JSON.stringify({ ...base, sessionId: '' }))).toBeNull();
    expect(parseRun(JSON.stringify({ ...base, blocksSinceCycle: -1 }))).toBeNull();
    expect(parseRun(JSON.stringify({ ...base, blocksSinceCycle: '1' }))).toBeNull();
  });
  it('reads a run.json without blocksSinceCycle as 0', () => {
    const { blocksSinceCycle: _b, ...old } = startRun(T0, { cycles: 2 });
    expect(parseRun(JSON.stringify({ ...old }))?.blocksSinceCycle).toBe(0);
    expect(parseRun(JSON.stringify({ ...old, blocksSinceCycle: 1 }))?.blocksSinceCycle).toBe(1);
  });
  it('keeps a valid locale and ignores a missing or invalid one', () => {
    const r = startRun(T0, { cycles: 2 }, 10, null, 'es');
    expect(r.locale).toBe('es');
    expect(parseRun(JSON.stringify(r))).toEqual(r);
    expect(parseRun(JSON.stringify({ ...r, locale: 'pt-BR' }))?.locale).toBe('pt-BR');
    for (const locale of ['', 'spanish', 3, 'es es', null]) {
      const p = parseRun(JSON.stringify({ ...r, locale }));
      expect(p).not.toBeNull();
      expect(p).not.toHaveProperty('locale');
    }
    expect(startRun(T0, { cycles: 2 })).not.toHaveProperty('locale');
  });
  it('keeps explore and saturation when they read, and drops them otherwise (6b-3)', () => {
    const sat = { saturated: false, at: 't', rounds: 2, blocking: ['rounds'], evidence: { pendingTasks: ['T1'], validatorsFailed: [], openFindings: 0, openDefects: [], openProposals: [] },
      waiting: { parked: [], questions: 0, blocked: 0, deferred: 0, waitsOwner: [], unowned: [] }, counts: { ...noCounts, pendingTasks: 1 } };
    const ok = parseRun(JSON.stringify({ ...startRun(T0, { cycles: 3 }), explore: { rounds: 2, dry: 2 }, saturation: sat }))!;
    expect(ok).toMatchObject({ explore: { rounds: 2, dry: 2 }, saturation: sat });
    const bad = parseRun(JSON.stringify({ ...startRun(T0, { cycles: 3 }), explore: { rounds: -1 }, saturation: { saturated: 'yes' } }))!;
    expect(bad).not.toHaveProperty('explore');
    expect(bad).not.toHaveProperty('saturation');
  });
  it('drops a report that does not hold together, never the run (6b-3, M-10)', () => {
    const sat = { saturated: true, at: 't', rounds: 3, blocking: [], evidence: { pendingTasks: [], validatorsFailed: [], openFindings: 0, openDefects: [], openProposals: [] },
      waiting: { parked: [], questions: 0, blocked: 0, deferred: 0, waitsOwner: [], unowned: [] }, counts: noCounts };
    const read = (o: Record<string, unknown>) => parseRun(JSON.stringify({ ...startRun(T0, { cycles: 3 }), ...o }));
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `T${100 + i}`);
    for (const saturation of [
      { ...sat, blocking: ['rounds'] }, { ...sat, saturated: false }, { ...sat, blocking: ['later'] },
      { ...sat, saturated: false, blocking: ['pending-tasks'], evidence: { ...sat.evidence, pendingTasks: ids(21) }, counts: { ...noCounts, pendingTasks: 21 } },
      { ...sat, saturated: false, blocking: ['pending-tasks'], evidence: { ...sat.evidence, pendingTasks: ids(3) } },
      { ...sat, counts: { ...noCounts, unowned: undefined } }, { ...sat, missing: ['--other'] },
      { ...sat, saturated: false, blocking: ['validators'], evidence: { ...sat.evidence, validatorsFailed: [`unit${String.fromCharCode(0x202e)}`] }, counts: { ...noCounts, validatorsFailed: 1 } },
    ]) {
      const r = read({ saturation });
      expect(r, JSON.stringify(saturation)).not.toBeNull();
      expect(r, JSON.stringify(saturation)).not.toHaveProperty('saturation');
    }
    expect(read({ explore: { rounds: 1, dry: 2 } })).not.toHaveProperty('explore');
    // Positive controls: a full list of 20 with its count, a null report and one that names its missing inputs read.
    const full = { ...sat, saturated: false, blocking: ['pending-tasks'], evidence: { ...sat.evidence, pendingTasks: ids(20) }, counts: { ...noCounts, pendingTasks: 31 } };
    expect(read({ saturation: full })?.saturation).toEqual(full);
    // An id is up to 80 code points, an astral one counting once.
    const wide = { ...sat, saturated: false, blocking: ['validators'], evidence: { ...sat.evidence, validatorsFailed: ['v'.repeat(79) + String.fromCodePoint(0x1f600)] },
      counts: { ...noCounts, validatorsFailed: 1 } };
    expect(read({ saturation: wide })?.saturation).toEqual(wide);
    expect(read({ saturation: null })?.saturation).toBeNull();
    const missing = { ...sat, saturated: false, blocking: ['inputs'], missing: ['--plan', '--validate'] };
    expect(read({ saturation: missing })?.saturation).toEqual(missing);
  });
});

describe('recordCycle', () => {
  it('counts cycles and consecutive cycles without progress', () => {
    let r = startRun(T0, {});
    r = recordCycle(r, { progress: false });
    r = recordCycle(r, { progress: false });
    expect(r).toMatchObject({ cycle: 2, noProgress: 2 });
    r = recordCycle(r, { progress: true });
    expect(r).toMatchObject({ cycle: 3, noProgress: 0 });
    expect(recordCycle({ ...r, blocksSinceCycle: 2 }, { progress: false }).blocksSinceCycle).toBe(0);
  });
  it('flags the same non-empty error twice in a row', () => {
    let r = startRun(T0, {});
    r = recordCycle(r, { progress: false, error: 'boom' });
    expect(r).toMatchObject({ lastError: 'boom', repeatedError: false });
    r = recordCycle(r, { progress: false, error: 'boom' });
    expect(r.repeatedError).toBe(true);
    r = recordCycle(r, { progress: false, error: 'other' });
    expect(r).toMatchObject({ lastError: 'other', repeatedError: false });
    r = recordCycle(r, { progress: true });
    expect(r).toMatchObject({ lastError: null, repeatedError: false });
    r = recordCycle(recordCycle(r, { progress: false, error: '  ' }), { progress: false, error: '  ' });
    expect(r.repeatedError).toBe(false);
  });
});

describe('stopReason', () => {
  const r = startRun(T0, { cycles: 3, hours: 2 });
  it('is null while nothing stops the run', () => {
    expect(stopReason(r, ctx())).toBeNull();
    expect(stopReason(r, ctx({ approvedPending: 1, pendingProposals: 20 }))).toBeNull();
    expect(stopReason(startRun(T0, {}), ctx({ now: new Date('2027-01-01T00:00:00Z') }))).toBeNull();
  });
  it('stops on the stop file', () => expect(stopReason(r, ctx({ stopFile: true }))).toBe('stop-file'));
  it('stops when the cycles are spent', () => {
    expect(stopReason({ ...r, cycle: 2 }, ctx())).toBeNull();
    expect(stopReason({ ...r, cycle: 3 }, ctx())).toBe('budget-cycles');
  });
  it('stops when the hours have elapsed', () => {
    expect(stopReason(r, ctx({ now: new Date('2026-10-11T11:59:59.000Z') }))).toBeNull();
    expect(stopReason(r, ctx({ now: new Date('2026-10-11T12:00:00.000Z') }))).toBe('budget-hours');
  });
  it('stops after 3 cycles without progress', () => {
    expect(stopReason({ ...r, noProgress: 2 }, ctx())).toBeNull();
    expect(stopReason({ ...r, noProgress: 3 }, ctx())).toBe('no-progress');
  });
  it('stops after 2 blocks without a recorded cycle', () => {
    expect(stopReason({ ...r, blocksSinceCycle: 1 }, ctx())).toBeNull();
    expect(stopReason({ ...r, blocksSinceCycle: 2 }, ctx())).toBe('no-cycle');
  });
  it('stops on a repeated error', () => expect(stopReason({ ...r, repeatedError: true } as RunState, ctx())).toBe('repeated-error'));
  it('stops when nothing is approved and the pending queue is full', () => {
    expect(stopReason(r, ctx({ pendingProposals: 9 }))).toBeNull();
    expect(stopReason(r, ctx({ pendingProposals: 10 }))).toBe('queue-full');
    expect(stopReason(r, ctx({ pendingProposals: 10, approvedPending: 1 }))).toBeNull();
  });
  it('stops on saturated only in an autonomous run, after the budgets and before no-progress (6b-3)', () => {
    const auto = { profile: 'spike' as const, name: 'x', runId: 'spike-x', worktree: path.resolve('/w'), branch: 'forge/spike-x', startBranch: 'main', protectedBranches: ['main'] };
    const sat = { saturated: true, at: 't', rounds: 3, blocking: [], evidence: { pendingTasks: [], validatorsFailed: [], openFindings: 0, openDefects: [], openProposals: [] },
      waiting: { parked: [], questions: 0, blocked: 0, deferred: 0, waitsOwner: [], unowned: [] }, counts: noCounts };
    expect(stopReason({ ...r, autonomous: auto, saturation: sat, noProgress: 3 }, ctx())).toBe('saturated');
    expect(stopReason({ ...r, saturation: sat }, ctx())).toBeNull();
    expect(stopReason({ ...r, autonomous: auto, saturation: sat, cycle: 3 }, ctx())).toBe('budget-cycles');
  });
  it('recordExplore counts dry rounds and starts over when one passes (6b-3)', () => {
    const once = recordExplore(r, 0);
    expect(once.explore).toEqual({ rounds: 1, dry: 1 });
    expect(recordExplore(recordExplore(once, 0), 2).explore).toEqual({ rounds: 3, dry: 0 });
  });
});

describe('saveRun', () => {
  it('removes its temp file when the write fails', () => {
    const root = tmp('forge-run-');
    mkdirSync(path.join(root, '.forge', 'run.json'), { recursive: true });
    expect(() => saveRun(root, startRun(T0, {}))).toThrow();
    expect(readdirSync(path.join(root, '.forge')).filter(n => n.endsWith('.tmp'))).toEqual([]);
  });
});

describe('infiniteDocOf: meta/infinite with its coordinator (G-08)', () => {
  const now = new Date('2026-10-16T10:00:00.000Z');
  // One lease rule: the coordination lease, whatever its value.
  const lease = new Date(now.getTime() + LEASE_MINUTES * 60_000).toISOString();
  const base = { ...startRun(new Date('2026-10-16T09:00:00.000Z'), { cycles: 5 }, 10, 'c1'), cycle: 2 };
  it('a lease of 10 minutes, or the expected sleep plus 5', () => {
    expect(infiniteDocOf(base, { now, sid: 'main', sleepUntil: null, lastCycleAt: '2026-10-16T09:55:00.000Z' })).toEqual({
      active: true, cycle: 2, budget: { cycles: 5 }, startedAt: '2026-10-16T09:00:00.000Z', lastCycleAt: '2026-10-16T09:55:00.000Z', stopReason: null,
      coordinator: { sid: 'main', claude: 'c1', seenAt: '2026-10-16T10:00:00.000Z', leaseUntil: lease },
    });
    expect(infiniteDocOf(base, { now, sid: null, sleepUntil: '2026-10-16T10:20:00.000Z', lastCycleAt: null }).coordinator!.leaseUntil).toBe('2026-10-16T10:25:00.000Z');
    expect(infiniteDocOf(base, { now, sid: null, sleepUntil: '2026-10-16T09:00:00.000Z', lastCycleAt: null }).coordinator!.leaseUntil).toBe(lease);
    // Carry 4: a sleep far ahead never stretches the lease past the cap.
    expect(infiniteDocOf(base, { now, sid: null, sleepUntil: '2099-01-01T00:00:00.000Z', lastCycleAt: null }).coordinator!.leaseUntil)
      .toBe(new Date(now.getTime() + LEASE_CAP_MINUTES * 60_000).toISOString());
  });
  it('carry 3: meta/run carries its stall reason as one clean line', () => {
    const rlo = String.fromCharCode(0x202e), bell = String.fromCharCode(7);
    const e = { runId: 'r1', kind: 'plan', mode: 'subagents', parallel: 3, project: 'shop', base: 'main', branch: 'forge/run-shop', mergeOnFinish: false, coordinator: 'main',
      hookSession: 'h1', active: false, stopReason: 'stalled', stallReason: `T2${rlo} is${bell}blocked`, startedAt: '2026-10-16T09:00:00.000Z', lastStepAt: null,
      lastBlockStep: null, sleepUntil: null, tasks: {}, closedAt: null, closedBy: null } as unknown as Parameters<typeof runDocOf>[1];
    expect(runDocOf(path.join(tmpdir(), 'no-such-forge-root'), e).stallReason).toBe('T2 is blocked');
  });
  it('carry 4: the stop reason is one clean line', () => {
    const rlo = String.fromCharCode(0x202e), bell = String.fromCharCode(7);
    expect(infiniteDocOf(endRun(base, `budget${rlo}-hours${bell}`), { now, sid: null, sleepUntil: null, lastCycleAt: null }).stopReason).toBe('budget-hours');
  });
  it('an inactive run says why it stopped; a run of forge 0.15 (no session) has no coordinator', () => {
    expect(infiniteDocOf(endRun(base, 'budget-cycles'), { now, sid: null, sleepUntil: null, lastCycleAt: null })).toMatchObject({ active: false, stopReason: 'budget-cycles' });
    expect(infiniteDocOf({ ...base, sessionId: null }, { now, sid: null, sleepUntil: null, lastCycleAt: null }).coordinator).toBeNull();
  });
  it('an autonomous run adds its profile and its saturation report, null until there is one (6b-3, L-20)', () => {
    const auto = { profile: 'product' as const, name: 'x', runId: 'product-x', worktree: path.resolve('/w'), branch: 'forge/product-x', startBranch: 'main', protectedBranches: ['main'] };
    const o = { now, sid: null, sleepUntil: null, lastCycleAt: null };
    expect(infiniteDocOf({ ...base, autonomous: auto }, o)).toMatchObject({ profile: 'product', saturation: null });
    const sat = { saturated: false, at: 't', rounds: 3, blocking: ['pending-tasks' as const], evidence: { pendingTasks: ['T1'], validatorsFailed: [], openFindings: 0, openDefects: [], openProposals: [] },
      waiting: { parked: [], questions: 0, blocked: 0, deferred: 0, waitsOwner: [], unowned: [] }, counts: { ...noCounts, pendingTasks: 1 } };
    expect(infiniteDocOf({ ...base, autonomous: auto, saturation: sat }, o).saturation).toEqual(sat);
    // Positive control: a run without a profile carries neither key (the exact object above).
    expect(infiniteDocOf({ ...base, saturation: sat }, o)).not.toHaveProperty('saturation');
    expect(infiniteDocOf(base, o)).not.toHaveProperty('profile');
  });
});

describe('seatOf: the seat of the run\'s Claude session (G-08)', () => {
  const NOW = Date.parse('2026-10-16T10:00:00.000Z');
  const min = (n: number) => new Date(NOW - n * 60_000).toISOString();
  // A seat of project `proj` in a temp main checkout; the checkout seat is the first one, the others live under seats/.
  const mk = () => tmp('seat-of-');
  const bind = (main: string, proj: string, sid: string, o: { claude?: string; seenAt?: string; endedAt?: string | null; pid?: number | null; checkout?: boolean }) => {
    const wp = path.join(main, '.waypoint', proj);
    const dir = o.checkout ? wp : path.join(wp, 'seats', sid);
    mkdirSync(dir, { recursive: true });
    if (o.checkout) writeFileSync(path.join(wp, 'session.json'), JSON.stringify({ sessionId: sid }));
    writeFileSync(path.join(dir, 'bound.json'), JSON.stringify({ sid, claude: o.claude ?? 'c1', pid: o.pid ?? null, via: 'forge-infinite',
      since: min(30), seenAt: o.seenAt ?? min(1), endedAt: o.endedAt ?? null, endReason: null }));
  };
  it('the binding renewed last wins, whatever its project or seat sorts first', () => {
    const main = mk();
    bind(main, 'a-old', 'old', { seenAt: min(4) });
    bind(main, 'z-new', 'new', { seenAt: min(1) });
    expect(seatOf(main, 'c1', NOW)).toBe('new');
  });
  it('an ended binding, an expired one, a dead-pid one and another Claude id\'s are not the seat', () => {
    const main = mk();
    bind(main, 'a', 'ended', { endedAt: min(2), seenAt: min(1) });
    bind(main, 'b', 'expired', { seenAt: min(20) });
    bind(main, 'c', 'dead', { pid: 4242, seenAt: min(1) });
    bind(main, 'd', 'other', { claude: 'c2', seenAt: min(1) });
    expect(seatOf(main, 'c1', NOW, () => false)).toBeNull();
    expect(seatOf(main, 'c2', NOW, () => false)).toBe('other');
    expect(seatOf(main, 'c1', NOW, () => true)).toBe('dead');
  });
  it('no .waypoint folder, no seat', () => {
    expect(seatOf(mk(), 'c1', NOW)).toBeNull();
  });
});

describe('the autonomous block of run.json (6b)', () => {
  const wt = path.resolve('/repo/.claude/worktrees/spike-tetris');
  const auto = { profile: 'spike', name: 'tetris', runId: 'spike-tetris', worktree: wt, branch: 'forge/spike-tetris', startBranch: 'main', protectedBranches: ['main'] };
  const text = (a: unknown) => JSON.stringify({ ...startRun(new Date('2026-10-22T10:00:00Z'), { hours: 2 }, 10, 's1'), autonomous: a });
  const named = (name: string) => ({ ...auto, name, runId: `spike-${name}`, branch: `forge/spike-${name}` });
  it('keeps a valid block, and only its seven fields (L6)', () => {
    expect(parseRun(text(auto))?.autonomous).toEqual(auto);
    expect(parseRun(text({ ...auto, idea: 'a later field' }))?.autonomous).toEqual(auto);
  });
  it('refuses the whole run when the block does not hold together', () => {
    for (const bad of [{ ...auto, profile: 'prod' }, { ...auto, runId: 'spike-other' }, { ...auto, branch: 'main' }, { ...auto, worktree: 'rel/path' },
      { ...auto, name: 'Tetris' }, { ...auto, protectedBranches: [] }, { ...auto, startBranch: 'a..b' }, named('a--b'), named('a-'), named('x'.repeat(41)), 'spike']) {
      expect(parseRun(text(bad)), JSON.stringify(bad)).toBeNull();
    }
  });
  it('refuses a branch name git would read as an option, or with whitespace or control characters', () => {
    for (const b of ['-x', 'a b', 'a\nb', 'a\tb', 'a\u0000b', 'a\u007fb']) {
      expect(parseRun(text({ ...auto, startBranch: b })), JSON.stringify(b)).toBeNull();
      expect(parseRun(text({ ...auto, protectedBranches: ['main', b] })), JSON.stringify(b)).toBeNull();
    }
  });
  it('a run without the block is read as before', () => {
    expect(parseRun(JSON.stringify(startRun(new Date('2026-10-22T10:00:00Z'), { cycles: 3 }, 10, 's1')))).not.toHaveProperty('autonomous');
  });
});
