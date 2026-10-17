import { describe, it, expect } from 'vitest';
import { budgetFor, budgetIssues, CritiqueError, formatProposals, parseCritique, scopeFor, selectProposals, verdictOf } from '../src/lib/critique.js';

const ok = {
  round: 2, version: 2, scope: 'changed',
  proposals: [
    { n: 1, category: 'gap', severity: 'major', section: 'riesgos', problem: 'Sin rollback', change: 'Añadir plan de rollback' },
    { n: 2, category: 'done_criteria', severity: 'critical', section: 'alcance', problem: 'No verificable', change: 'Usar tests e2e' },
  ],
};
const issuesOf = (v: unknown) => { try { parseCritique(JSON.stringify(v)); } catch (e) { if (e instanceof CritiqueError) return e.issues; throw e; } throw new Error('expected CritiqueError'); };

describe('parseCritique', () => {
  it('accepts a valid critique', () => {
    expect(parseCritique(JSON.stringify(ok)).proposals).toHaveLength(2);
  });
  it('rejects bad categories, empty fields and numbering gaps', () => {
    const issues = issuesOf({ ...ok, proposals: [{ ...ok.proposals[0], category: 'style', problem: '' }, { ...ok.proposals[1], n: 3 }] });
    expect(issues.some(i => i.includes('category'))).toBe(true);
    expect(issues.some(i => i.includes('problem'))).toBe(true);
    expect(issues).toContain('proposals must be numbered 1..2 without gaps');
  });
  it('rejects non-json', () => {
    expect(() => parseCritique('nope')).toThrow(CritiqueError);
  });
});

describe('selectProposals', () => {
  const c = parseCritique(JSON.stringify(ok));
  it('selects all or a list', () => {
    expect(selectProposals(c, 'all').map(p => p.n)).toEqual([1, 2]);
    expect(selectProposals(c, ' 2 , 1 ').map(p => p.n)).toEqual([1, 2]);
  });
  it('fails on unknown numbers instead of ignoring them', () => {
    expect(() => selectProposals(c, '1,9')).toThrow(/9/);
    expect(() => selectProposals(c, 'x')).toThrow(CritiqueError);
  });
});

describe('formatProposals', () => {
  it('renders numbered lines in the locale', () => {
    const out = formatProposals(parseCritique(JSON.stringify(ok)), 'es');
    expect(out.split('\n')[0]).toBe('1. [Hueco · mayor] «riesgos» — Sin rollback → Añadir plan de rollback');
    expect(out).toContain('2. [Criterio de hecho · crítica]');
    expect(formatProposals(parseCritique(JSON.stringify(ok)), 'fr').split('\n')[0]).toContain('[Gap · major]');
  });
});

describe('fix round 1: selection and formatting', () => {
  const c = parseCritique(JSON.stringify(ok));
  it('rejects empty tokens and leading zeros', () => {
    expect(() => selectProposals(c, '1,,2')).toThrow(CritiqueError);
    expect(() => selectProposals(c, '01')).toThrow(CritiqueError);
    expect(() => selectProposals(c, '1,02')).toThrow(CritiqueError);
  });
  it('falls back to English for prototype-like locales', () => {
    expect(formatProposals(c, 'constructor').split('\n')[0]).toContain('[Gap · major]');
  });
  it('collapses newlines inside problem and change to one space', () => {
    const multi = parseCritique(JSON.stringify({ ...ok, proposals: [{ ...ok.proposals[0], problem: 'Sin\nrollback', change: 'Añadir\r\nplan' }, ok.proposals[1]] }));
    const lines = formatProposals(multi, 'es').split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('1. [Hueco · mayor] «riesgos» — Sin rollback → Añadir plan');
  });
  it('names sections by their heading, and the intro by a word', () => {
    const intro = parseCritique(JSON.stringify({ ...ok, proposals: [{ ...ok.proposals[0], section: '_intro' }, ok.proposals[1]] }));
    const es = formatProposals(intro, 'es', { alcance: 'Alcance y fases' }).split('\n');
    expect(es[0]).toContain('] «Introducción» — ');
    expect(es[1]).toContain('] «Alcance y fases» — ');
    const en = formatProposals(intro, 'en', { alcance: 'Scope' }).split('\n');
    expect(en[0]).toContain('] "Intro" — ');
    expect(en[1]).toContain('] "Scope" — ');
    expect(formatProposals(c, 'es', { constructor: 'x' })).not.toContain('§');
  });
});

describe('the budget of a round and the verdict (K3-04)', () => {
  const crit = (round: number, sevs: ('critical' | 'major' | 'minor')[], verdict?: string) => JSON.stringify({
    round, version: round, scope: 'full', ...(verdict ? { verdict } : {}),
    proposals: sevs.map((severity, i) => ({ n: i + 1, category: 'gap', severity, section: 'a', problem: 'p', change: 'c' })),
  });
  it('budgetFor: 12 of any severity, then 6 critical or major, then 3 critical; a verification is always 3 critical', () => {
    expect(budgetFor(1)).toEqual({ max: 12, severities: ['critical', 'major', 'minor'] });
    expect(budgetFor(2)).toEqual({ max: 6, severities: ['critical', 'major'] });
    expect(budgetFor(3)).toEqual({ max: 3, severities: ['critical'] });
    expect(budgetFor(7)).toEqual(budgetFor(3));
    expect(budgetFor(1, true)).toEqual({ max: 3, severities: ['critical'] });
    expect(budgetFor(2, true)).toEqual({ max: 3, severities: ['critical'] });
  });
  it('budgetFor: a round that is 0, negative, fractional or not a number is round 1 (clamped, never an accident of the comparisons)', () => {
    for (const bad of [0, -1, -7, NaN, 0.5, Infinity - Infinity]) expect(budgetFor(bad)).toEqual(budgetFor(1));
    expect(budgetFor(0, true)).toEqual({ max: 3, severities: ['critical'] });
  });
  it('budgetIssues names the extra proposals and every severity the round does not allow', () => {
    const seven = parseCritique(crit(2, ['major', 'major', 'major', 'major', 'major', 'major', 'major']));
    expect(budgetIssues(seven, budgetFor(2))).toEqual(['7 proposals, but this round allows at most 6']);
    expect(budgetIssues(parseCritique(crit(2, ['minor'])), budgetFor(2))).toEqual(['proposal 1 is minor, but this round allows only critical and major']);
    expect(budgetIssues(parseCritique(crit(3, ['critical', 'major'])), budgetFor(3))).toEqual(['proposal 2 is major, but this round allows only critical']);
    expect(budgetIssues(parseCritique(crit(1, ['minor'])), budgetFor(1))).toEqual([]);
  });
  it('a ready verdict with no proposal is valid; one that contradicts the proposals is refused; an old critique deduces it', () => {
    expect(parseCritique(crit(2, [], 'ready')).verdict).toBe('ready');
    expect(parseCritique(crit(2, [], 'ready')).proposals).toEqual([]);
    expect(issuesOf(JSON.parse(crit(2, ['minor', 'major'], 'ready')))).toEqual(['verdict is "ready" but proposal 2 is major']);
    expect(issuesOf(JSON.parse(crit(1, ['minor'], 'changes')))).toEqual(['verdict is "changes" but no proposal is critical or major']);
    expect(issuesOf(JSON.parse(crit(1, [], 'done'))).some(i => i.startsWith('verdict'))).toBe(true);
    expect(parseCritique(crit(1, ['critical'])).verdict).toBe('changes');
    expect(parseCritique(crit(1, ['minor'])).verdict).toBe('ready');
    expect(verdictOf({ proposals: [] })).toBe('ready');
  });
  it('scopeFor: round 1 everything; round 2 what changed unless more than half did; round 3 and verifications what changed; after a reopen round 1 is like round 2', () => {
    const s = (round: number, changed: number, extra: Partial<{ verify: boolean; reopened: boolean }> = {}) =>
      scopeFor({ round, verify: false, reopened: false, changed, total: 4, ...extra });
    expect(s(1, 0)).toBe('full');
    expect(s(2, 2)).toBe('changed');
    expect(s(2, 3)).toBe('full');
    expect(s(3, 4)).toBe('changed');
    expect(s(2, 3, { verify: true })).toBe('changed');
    expect(s(1, 1, { reopened: true })).toBe('changed');
    expect(s(1, 3, { reopened: true })).toBe('full');
    expect(scopeFor({ round: 2, verify: false, reopened: false, changed: 0, total: 0 })).toBe('full');
  });
});
