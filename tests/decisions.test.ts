import { describe, it, expect } from 'vitest';
import {
  DECISIONS_MAX, LIMITS, clean, decisionScope, decisionsSummary, nextDecisionsDoc, normalizeAlternative, normalizeDecision, normalizeDecisionsDoc,
  normalizeIfWrong, normalizeUndo, scopeFileName, weightOf, type Decision,
} from '../src/lib/decisions.js';

const TS = '2026-10-13T10:00:00.000Z';
const NEW = {
  ts: TS, kind: 'decision', point: 'design-approve', what: 'diseño aprobado (v4)', chosen: 'approve',
  alternatives: ['another round'], why: 'ronda 2 sin critical', by: 'auto', revert: '/forge:decisions revert 7',
  undo: { type: 'design-reopen', project: 'reparto' }, task: 'reparto',
};
const dec = (o: Partial<Decision> = {}): Decision => ({ ...normalizeDecision(NEW)!, ...o });

describe('normalizeDecision', () => {
  it('reads a new event and gives a major point its weight', () => {
    expect(normalizeDecision(NEW)).toEqual({
      ts: TS, point: 'design-approve', what: 'diseño aprobado (v4)', chosen: 'approve', alternatives: [{ option: 'another round' }], tradeoffs: null,
      why: 'ronda 2 sin critical', by: 'auto', weight: 'major', revert: '/forge:decisions revert 7',
      undo: { type: 'design-reopen', project: 'reparto' }, task: 'reparto', runId: null, safePath: null, revertOf: null,
    });
  });
  it('reads the unattended events written before forge 0.10', () => {
    expect(normalizeDecision({ ts: TS, kind: 'decision', what: 'surface web not allowed', why: 'unattended', safePath: 'verify-skip', task: 'T3' }))
      .toMatchObject({ point: 'safe-path', chosen: 'verify-skip', by: 'unattended', weight: 'minor', task: 'T3' });
    expect(normalizeDecision({ ts: TS, kind: 'decision', what: 'execution not started', why: 'diverged', safePath: 'end the cycle' }))
      .toMatchObject({ point: 'safe-path', chosen: 'end the cycle' });
  });
  it('reads the old takeover as the user\'s decision without taking its session id for `by`', () => {
    expect(normalizeDecision({ ts: TS, kind: 'decision', what: 'takeover', previous: 'old', by: 'new-sid' }))
      .toMatchObject({ point: 'takeover', by: 'user', chosen: 'takeover', why: '' });
    expect(normalizeDecision({ ts: TS, kind: 'decision', what: 'other thing', by: 'some-sid' })).toMatchObject({ by: 'unattended' });
  });
  it('is null without a ts or a usable what, and cleans and clips text', () => {
    expect(normalizeDecision({ kind: 'decision', what: 'x' })).toBeNull();
    expect(normalizeDecision({ ts: TS, what: ' \u0007 ' })).toBeNull();
    const d = normalizeDecision({ ts: TS, what: `a\u001b[31m\nb${'x'.repeat(300)}`, point: 'nope', by: 'robot', weight: 'huge' })!;
    expect(d.what.startsWith('a [31m b')).toBe(true);
    expect(d.what).toHaveLength(200);
    expect(d).toMatchObject({ point: 'other', by: 'unattended', weight: 'minor' });
  });
});

describe('normalizeUndo', () => {
  it('accepts each kind and refuses bad ids', () => {
    expect(normalizeUndo({ type: 'git-revert', base: 'abc1234', head: 'def5678', cwd: '.claude/worktrees/run' })).toEqual({ type: 'git-revert', base: 'abc1234', head: 'def5678', cwd: '.claude/worktrees/run' });
    expect(normalizeUndo({ type: 'plan-edit', project: 'reparto', tasks: ['T013', '../x', 'T014'] })).toEqual({ type: 'plan-edit', project: 'reparto', tasks: ['T013', 'T014'] });
    expect(normalizeUndo({ type: 'branch-discard', branch: 'forge/auto-1' })).toEqual({ type: 'branch-discard', branch: 'forge/auto-1' });
    expect(normalizeUndo({ type: 'none', reason: 'el ratchet solo sube' })).toEqual({ type: 'none', reason: 'el ratchet solo sube' });
    for (const bad of [null, 'x', { type: 'git-revert', base: 'zz', head: 'def5678' }, { type: 'branch-discard', branch: 'a/../b' },
      { type: 'branch-discard', branch: '-x' }, { type: 'design-reopen', project: '..' }, { type: 'plan-edit', project: 'p', tasks: ['../x'] }, { type: 'rm' }]) {
      expect(normalizeUndo(bad)).toBeNull();
    }
  });
  it('keeps the shas of a git-revert, once each and only commit ids (K2-19)', () => {
    expect(normalizeUndo({ type: 'git-revert', base: 'abc1234', head: 'def5678', shas: ['aaa1111', 'aaa1111', 'nope', 3, 'bbb2222'] }))
      .toEqual({ type: 'git-revert', base: 'abc1234', head: 'def5678', shas: ['aaa1111', 'bbb2222'] });
    expect(normalizeUndo({ type: 'git-revert', base: 'abc1234', head: 'def5678', shas: [] })).toEqual({ type: 'git-revert', base: 'abc1234', head: 'def5678' });
    const many = Array.from({ length: 51 }, (_, i) => i.toString(16).padStart(7, '0'));
    expect((normalizeUndo({ type: 'git-revert', base: 'abc1234', head: 'def5678', shas: many }) as { shas: string[] }).shas).toEqual(many.slice(0, 50));
  });
});

describe('scope', () => {
  it('is the run, else the task without its brief suffix', () => {
    expect(decisionScope({ runId: 'r1', task: 'T001-1' })).toBe('r1');
    expect(decisionScope({ runId: null, task: 'orders-2' })).toBe('orders');
    expect(decisionScope({ runId: null, task: 'fix-login-1234' })).toBe('fix-login-1234');
    expect(decisionScope({ runId: null, task: 'T001' })).toBe('T001');
    expect(decisionScope({ runId: null, task: null })).toBeNull();
  });
  it('turns a scope into a safe file name', () => {
    expect(scopeFileName('a:b/c')).toBe('a-b-c');
    expect(scopeFileName('..')).toBe('forge');
    expect(scopeFileName('reparto')).toBe('reparto');
  });
});

describe('decisions.json', () => {
  it('counts automatic decisions per scope, keeps the last 5 and the last major one', () => {
    let doc = nextDecisionsDoc(null, dec({ point: 'design-approve', weight: 'major' }), 1)!;
    expect(doc).toMatchObject({ scope: 'reparto', count: 1, autonomy: 'auto', lastMajor: { n: 1, what: 'diseño aprobado (v4)' } });
    for (let n = 2; n <= 7; n++) doc = nextDecisionsDoc(doc, dec({ point: 'ruling', weight: 'minor', what: `r${n}`, by: 'unattended' }), n)!;
    expect(doc.count).toBe(7);
    expect(doc.last.map(e => e.n)).toEqual([3, 4, 5, 6, 7]);
    expect(doc.lastMajor?.n).toBe(1);
    expect(doc.autonomy).toBe('unattended');
  });
  it('ignores the user own answers and starts over in another scope', () => {
    const doc = nextDecisionsDoc(null, dec(), 1)!;
    expect(nextDecisionsDoc(doc, dec({ by: 'user' }), 2)).toBe(doc);
    expect(nextDecisionsDoc(doc, dec({ task: 'other' }), 3)).toMatchObject({ scope: 'other', count: 1 });
  });
  it('normalizes a stored doc and refuses a broken one', () => {
    const doc = nextDecisionsDoc(null, dec(), 1)!;
    expect(normalizeDecisionsDoc(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    for (const bad of [null, [], { ...doc, count: -1 }, { ...doc, autonomy: 'user' }, { ...doc, scope: '' }]) expect(normalizeDecisionsDoc(bad)).toBeNull();
  });
  it('summarizes the last day for lens and the band', () => {
    const doc = nextDecisionsDoc(null, dec(), 1)!;
    const now = Date.parse(TS) + 60_000;
    expect(decisionsSummary(JSON.stringify(doc), now)).toEqual({ count: 1, autonomy: 'auto', lastMajor: 'diseño aprobado (v4)' });
    expect(decisionsSummary(JSON.stringify(doc), Date.parse(TS) + 25 * 3600_000)).toBeNull();
    expect(decisionsSummary(JSON.stringify({ ...doc, count: 0 }), now)).toBeNull();
    expect(decisionsSummary('{"ts":', now)).toBeNull();
    expect(decisionsSummary(undefined, now)).toBeNull();
    expect(decisionsSummary(JSON.stringify(doc) + ' '.repeat(DECISIONS_MAX), now)).toBeNull();
    // A clock ahead by a few minutes is fine; a summary dated further in the future never goes stale, so it is refused.
    expect(decisionsSummary(JSON.stringify(doc), Date.parse(TS) - 60_000)).not.toBeNull();
    expect(decisionsSummary(JSON.stringify(doc), Date.parse(TS) - 10 * 60_000)).toBeNull();
  });
  it('clean makes one line', () => {
    expect(clean(` a\n\tb${String.fromCharCode(0x202e)} c `, 10)).toBe('a b c');
  });
});

describe('alternatives with why not and trade-offs (6b-1)', () => {
  it('reads plain and structured alternatives alike, and the chosen option\'s trade-offs', () => {
    const d = normalizeDecision({ ...NEW, alternatives: ['plain', { option: 'redis', whyNot: 'one more service', tradeoffs: 'faster; one more thing to run' }, { option: ' ' }, { whyNot: 'x' }, 3], tradeoffs: 'simple; slower' })!;
    expect(d.alternatives).toEqual([{ option: 'plain' }, { option: 'redis', whyNot: 'one more service', tradeoffs: 'faster; one more thing to run' }]);
    expect(d.tradeoffs).toBe('simple; slower');
  });
  it('cleans and clips each field to its limit, and leaves out the empty ones', () => {
    expect(normalizeAlternative({ option: 'a\u0007b', whyNot: 'x'.repeat(400), tradeoffs: ' ' }))
      .toEqual({ option: 'a b', whyNot: 'x'.repeat(LIMITS.whyNot) });
  });
  it('blocked is a minor point', () => {
    expect(weightOf('blocked')).toBe('minor');
  });
  it('a re-plan and a vision change are major decisions (6b-3)', () => {
    expect(weightOf('replan')).toBe('major');
    expect(weightOf('vision')).toBe('major');
  });
  it('lens reads the summary of a decision with structured alternatives', () => {
    const doc = nextDecisionsDoc(null, normalizeDecision({ ...NEW, alternatives: [{ option: 'redis', whyNot: 'w' }] })!, 1);
    expect(decisionsSummary(JSON.stringify(doc), Date.parse(TS))).toEqual({ count: 1, autonomy: 'auto', lastMajor: 'diseño aprobado (v4)' });
  });
});

describe('the cost if wrong (A7)', () => {
  it('reads ifWrong; an event without it normalizes as before, same keys in the same order (so its note id does not change)', () => {
    const ifWrong = { cost: 'high', note: 'the run builds on a design nobody approved' };
    expect(normalizeDecision({ ...NEW, ifWrong })!.ifWrong).toEqual(ifWrong);
    expect(Object.keys(normalizeDecision(NEW)!)).toEqual(['ts', 'point', 'what', 'chosen', 'alternatives', 'tradeoffs', 'why', 'by', 'weight', 'revert', 'undo', 'task', 'runId', 'safePath', 'revertOf']);
    for (const odd of [{ cost: 'huge', note: 'x' }, { cost: 'low' }, { cost: 'low', note: ' \u0007 ' }, 'high', null])
      expect(normalizeDecision({ ...NEW, ifWrong: odd }), JSON.stringify(odd)).not.toHaveProperty('ifWrong');
    expect(normalizeIfWrong({ cost: 'medium', note: `a\u0007\n${'b'.repeat(300)}` })!.note).toHaveLength(200);
  });
});
