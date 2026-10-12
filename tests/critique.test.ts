import { describe, it, expect } from 'vitest';
import { CritiqueError, formatProposals, parseCritique, selectProposals } from '../src/lib/critique.js';

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
