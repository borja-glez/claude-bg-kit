import { describe, it, expect } from 'vitest';
import { isPlanId as fromIds } from '../src/lib/ids.js';
import { isPlanId as fromPlan } from '../src/lib/plan.js';

describe('plan id rule', () => {
  it('is the same function from ids.ts and plan.ts', () => {
    expect(fromPlan).toBe(fromIds);
    for (const s of ['T1', 'fix-cart', 'a.b_c', 'x'.repeat(64)]) expect(fromIds(s)).toBe(true);
    for (const s of ['', '.', '..', '../b', 'a b', 'a/b', 'x'.repeat(65), 'C:x']) expect(fromIds(s)).toBe(false);
  });
});
