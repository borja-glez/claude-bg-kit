import { describe, it, expect } from 'vitest';
import { isPlanId as fromIds } from '../src/lib/ids.js';
import { isPlanId as fromPlan } from '../src/lib/plan.js';
import { sessionIdFrom } from '../src/lib/ids.js';
import { isSafeId } from '../src/lib/execution-state.js';

describe('plan id rule', () => {
  it('is the same function from ids.ts and plan.ts', () => {
    expect(fromPlan).toBe(fromIds);
    for (const s of ['T1', 'fix-cart', 'a.b_c', 'x'.repeat(64)]) expect(fromIds(s)).toBe(true);
    for (const s of ['', '.', '..', '../b', 'a b', 'a/b', 'x'.repeat(65), 'C:x']) expect(fromIds(s)).toBe(false);
  });
});

describe('sessionIdFrom (A-18)', () => {
  it('keeps only what isSafeId accepts: anything else becomes -', () => {
    expect(sessionIdFrom('Ana@trabajo:1~x')).toBe('ana-trabajo-1-x');
    expect(sessionIdFrom('José María')).toBe('jose-maria');
    expect(sessionIdFrom('C++ dev')).toBe('c-dev');
    expect(sessionIdFrom('front.end_2')).toBe('front.end_2');
  });
  it('a cut that lands on a separator loses it, and a long run of separators is linear', () => {
    expect(sessionIdFrom('a'.repeat(39) + '-b')).toBe('a'.repeat(39));
    expect(sessionIdFrom('a'.repeat(39) + '.b')).toBe('a'.repeat(39));
    const t = performance.now();
    expect(sessionIdFrom('a' + '-'.repeat(100000) + 'b')).toBe('a');
    expect(performance.now() - t).toBeLessThan(500);
  });
  it('a name that reduces to nothing or to dots is main, and every result is a safe id of at most 40 (Review Focus 5)', () => {
    for (const s of ['.', '..', '...', '日本語', '@@@', '', '   ']) expect(sessionIdFrom(s), JSON.stringify(s)).toBe('main');
    const names = ['Ana@trabajo:1~x', 'José María', 'Ünïcödé', 'a/b\\c', '  spaces  ', '.hidden', 'trailing.', '-dash-', 'x'.repeat(100),
      'tab\tname', 'emoji 🎉 name', 'node@20+lts', `${'a'.repeat(39)}.b`];
    // The battery has a backslash (M12): 'a/b\\c' is five characters, the fourth a backslash.
    expect(names.find(n => n.startsWith('a/b'))).toBe(`a/b${String.fromCharCode(92)}c`);
    for (const n of names) {
      const sid = sessionIdFrom(n);
      expect(isSafeId(sid), `${n} → ${sid}`).toBe(true);
      expect(sid.length, n).toBeLessThanOrEqual(40);
      expect(sid, n).not.toMatch(/^[.-]|[.-]$/);
    }
  });
});
