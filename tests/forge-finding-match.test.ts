import { describe, it, expect } from 'vitest';
import { pairFindings, findingsMatch } from '../src/forge/finding-match.js';
import { findingsMatch as fromShadow } from '../src/forge/shadow.js';
import type { Finding } from '../src/forge/verdict.js';

const f = (problem: string, file?: string, line?: number): Finding => ({ severity: 'important', problem, file, line });

describe('pairFindings', () => {
  it('pairs one to one, location first, then word overlap; -1 when nothing matches', () => {
    const a = [f('alpha beta gamma', 'x.ts', 50), f('totally different words', 'y.ts', 10), f('nothing here at all', 'z.ts', 1)];
    const b = [f('unrelated', 'y.ts', 12), f('alpha beta gamma delta', 'q.ts', 1)];
    expect(pairFindings(a, b)).toEqual([1, 0, -1]);
  });
  it('a finding of b pairs once: a second one of a that matches it stays unpaired', () => {
    expect(pairFindings([f('p', 'a.ts', 1), f('q', 'a.ts', 2)], [f('r', 'a.ts', 3)])).toEqual([0, -1]);
    expect(pairFindings([], [f('r', 'a.ts', 3)])).toEqual([]);
  });
  it('shadow.ts re-exports the same matcher', () => {
    expect(fromShadow).toBe(findingsMatch);
  });
});
