import { describe, it, expect } from 'vitest';
import { autoApprovable, similarRejected, similarOpen, safeZone } from '../src/forge/policy.js';
import type { ProposalDoc } from '../src/lib/proposals.js';

const doc = (over: Partial<ProposalDoc> = {}): ProposalDoc => ({ ts: '', category: 'quality', risk: 'low', title: 't', rationale: '', evidence: '', pillar: 'p', status: 'proposed', source: 'scout', author: 'a', ...over });

describe('autoApprovable', () => {
  it('tests and quality at low risk', () => {
    expect(autoApprovable(doc({ category: 'tests' }))).toBe(true);
    expect(autoApprovable(doc({ category: 'quality' }))).toBe(true);
  });
  it('perf needs a benchmark in the evidence', () => {
    expect(autoApprovable(doc({ category: 'perf', evidence: 'bench: 40 ms -> 5 ms' }))).toBe(true);
    expect(autoApprovable(doc({ category: 'perf', evidence: '12k ops/s' }))).toBe(true);
    expect(autoApprovable(doc({ category: 'perf', evidence: 'feels faster' }))).toBe(false);
    expect(autoApprovable(doc({ category: 'perf', evidence: 'items 5' }))).toBe(false);
  });
  it('security needs a test in the evidence', () => {
    expect(autoApprovable(doc({ category: 'security', evidence: 'regression test added' }))).toBe(true);
    expect(autoApprovable(doc({ category: 'security', evidence: 'looks risky' }))).toBe(false);
  });
  it('negated or accidental evidence does not count', () => {
    for (const e of ['no benchmark yet', 'workbench', 'takes 40 ms', 'bench-less', 'sin benchmark']) expect(autoApprovable(doc({ category: 'perf', evidence: e }))).toBe(false);
    for (const e of ['no test exists', 'not tested yet', 'sin test', 'falta spec', 'without any test']) expect(autoApprovable(doc({ category: 'security', evidence: e }))).toBe(false);
    expect(autoApprovable(doc({ category: 'security', evidence: 'added regression test' }))).toBe(true);
    expect(autoApprovable(doc({ category: 'perf', evidence: 'bench: 40 ms → 5 ms' }))).toBe(true);
    expect(autoApprovable(doc({ category: 'perf', evidence: '40ms -> 5ms' }))).toBe(true);
    expect(autoApprovable(doc({ category: 'perf', evidence: 'no gain, but benchmark: 3 ops/s' }))).toBe(true);
  });
  it('a negator just after the keyword, or one of the wider negators, also counts', () => {
    for (const e of ['tests missing', 'nothing tested', 'there are zero tests', 'tests: none', 'test absent', 'untested path', 'test pending'])
      expect(autoApprovable(doc({ category: 'security', evidence: e }))).toBe(false);
    for (const e of ['benchmark pending', 'benchmarks would help', 'benchmark: none yet', 'zero benchmarks'])
      expect(autoApprovable(doc({ category: 'perf', evidence: e }))).toBe(false);
    expect(autoApprovable(doc({ category: 'security', evidence: 'regression test added in auth.test.ts' }))).toBe(true);
    expect(autoApprovable(doc({ category: 'perf', evidence: 'benchmark parse.bench.ts: 40 ms -> 5 ms' }))).toBe(true);
    // Only the 3 words after count: a negator further on does not cancel it.
    expect(autoApprovable(doc({ category: 'security', evidence: 'test covers the token check, nothing else' }))).toBe(true);
  });
  it('never feature or deps, never medium/high risk', () => {
    expect(autoApprovable(doc({ category: 'feature' }))).toBe(false);
    expect(autoApprovable(doc({ category: 'deps' }))).toBe(false);
    expect(autoApprovable(doc({ risk: 'medium' }))).toBe(false);
    expect(autoApprovable(doc({ category: 'tests', risk: 'high' }))).toBe(false);
  });
});

describe('similarRejected', () => {
  const rej = [{ ...doc({ status: 'rejected', title: 'Remove dead code from the parser module', rationale: 'unused helpers clutter parser', evidence: 'grep shows 4 unused helpers' }), id: 'p1' }];
  it('hits a similar proposal without new evidence', () => {
    expect(similarRejected({ title: 'Remove dead code from parser module', rationale: 'unused helpers clutter parser', evidence: 'unused helpers' }, rej)).toBe('p1');
  });
  it('misses when the evidence is new', () => {
    expect(similarRejected({ title: 'Remove dead code from parser module', rationale: 'unused helpers clutter parser', evidence: 'coverage report says 9 unused' }, rej)).toBeNull();
  });
  it('threshold: Jaccard 3/5 hits, 2/5 misses; short words ignored; accents count', () => {
    const r = (title: string) => [{ ...doc({ status: 'rejected', title, evidence: 'e' }), id: 'p1' }];
    // words a b c d (as long words) vs a b c e: inter 3, union 5 = 0.6
    expect(similarRejected({ title: 'alpha beta gamma delta', rationale: '', evidence: 'e' }, r('alpha beta gamma omega'))).toBe('p1');
    expect(similarRejected({ title: 'alpha beta gamma delta', rationale: '', evidence: 'e' }, r('alpha beta zeta omega'))).toBeNull();
    expect(similarRejected({ title: 'alpha beta gamma delta', rationale: '', evidence: 'e' }, r('alpha beta gamma delta is of to'))).toBe('p1');
    expect(similarRejected({ title: 'revisar configuración inicial', rationale: '', evidence: 'e' }, r('revisar configuración inicial'))).toBe('p1');
    expect(similarRejected({ title: 'revisar configuracion inicial', rationale: '', evidence: 'e' }, r('revisar configuración inicial'))).toBeNull();
  });
  it('evidence containment ignores case and whitespace', () => {
    const rj = [{ ...doc({ status: 'rejected', title: 'same title words', evidence: 'Grep  shows\n4 Unused' }), id: 'p1' }];
    expect(similarRejected({ title: 'same title words', rationale: '', evidence: 'grep shows 4 unused' }, rj)).toBe('p1');
  });
  it('misses a different proposal', () => {
    expect(similarRejected({ title: 'Cache price lookups', rationale: 'checkout is slow', evidence: 'unused helpers' }, rej)).toBeNull();
  });
});

describe('similarOpen', () => {
  const p = (id: string, status: ProposalDoc['status'], title: string) => ({ ...doc({ status, title }), id });
  it('finds a similar proposed, discussing, approved or auto_approved proposal whatever the evidence', () => {
    for (const status of ['proposed', 'discussing', 'approved', 'auto_approved'] as const)
      expect(similarOpen({ title: 'alpha beta gamma delta', rationale: '' }, [p('p1', status, 'alpha beta gamma omega')])).toBe('p1');
  });
  it('ignores rejected and done proposals and different ideas', () => {
    expect(similarOpen({ title: 'alpha beta gamma delta', rationale: '' }, [p('p1', 'rejected', 'alpha beta gamma delta'), p('p2', 'done', 'alpha beta gamma delta')])).toBeNull();
    expect(similarOpen({ title: 'alpha beta gamma delta', rationale: '' }, [p('p1', 'proposed', 'alpha beta zeta omega')])).toBeNull();
  });
});

describe('safeZone', () => {
  it('accepts plain relative paths and globs', () => {
    expect(safeZone('src/**')).toBe('src/**');
    expect(safeZone('a/b_c-d.ts')).toBe('a/b_c-d.ts');
  });
  it('refuses anything else', () => {
    for (const bad of ['../x', 'a/../x', '/etc', 'C:\\x', 'C:/x', '\\\\srv\\x', 'a;rm -rf', '-rf', '-x/y', '`x`', '$(x)', 'a b', '', undefined]) expect(safeZone(bad)).toBeNull();
  });
});
