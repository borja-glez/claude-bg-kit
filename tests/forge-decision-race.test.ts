import { describe, it, expect, vi } from 'vitest';
import { addDecision, allDecisions } from '../src/forge/decisions.js';
import { useTempDirs } from './helpers/tmp.js';
const tmp = useTempDirs();

// The setup file loads trust.ts, which (6b-2) imports decisions.ts: drop that cached copy so this file's own import of it
// meets the mock below (vitest does not mock a module a setup file imported).
vi.hoisted(() => { vi.resetModules(); });
// Another session appends its own decision right after ours, before addDecision reads the ledger back.
vi.mock('../src/forge/ledger.js', async importOriginal => {
  const real = await importOriginal<typeof import('../src/forge/ledger.js')>();
  return {
    ...real,
    appendEvent: (root: string, e: Parameters<typeof real.appendEvent>[1]) => {
      real.appendEvent(root, e);
      if (e.kind === 'decision' && e.what === 'mine') {
        real.appendEvent(root, { ts: e.ts, kind: 'decision', point: 'ruling', what: 'theirs', chosen: 'x', why: 'y', by: 'unattended' });
      }
    },
  };
});

describe('addDecision under a concurrent append', () => {
  it('prints the number of its own event, not the count after the other one', () => {
    const root = tmp('forge-dec-race-');
    const r = addDecision(root, { point: 'ruling', what: 'mine', chosen: 'a', why: 'b', by: 'unattended' }, { ts: '2026-10-13T10:00:00.000Z' });
    expect(allDecisions(root).map(d => d.what)).toEqual(['mine', 'theirs']);
    expect(r.n).toBe(1);
  });
});
