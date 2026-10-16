import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { BOUND_VIAS, MAX_SEATS, endReasonOf, isBoundVia, normalizeBound, parseBound } from '../src/lib/bound.js';
import { BOUND_LEASE_MS, PREVIOUS_OFFER_MS, bindingLive } from '../src/lib/viewer-role.js';
import { normalizeMember as libMember } from '../src/lib/member-doc.js';
import { normalizeMember as forgeMember } from '../src/forge/members.js';

const NOW = Date.parse('2026-10-15T12:00:00.000Z');
const at = (min: number) => new Date(NOW + min * 60000).toISOString();
const doc = (over: Record<string, unknown> = {}) =>
  ({ sid: 'main', claude: 'c-1', pid: 4242, via: 'work', since: at(-30), seenAt: at(-1), endedAt: null, endReason: null, ...over });

describe('bound.json (C3)', () => {
  it('keeps a valid binding as it is', () => {
    expect(normalizeBound(doc(), NOW)).toEqual(doc());
    expect(BOUND_VIAS).toEqual(['work', 'design', 'forge-run', 'forge-member', 'forge-infinite']);
    expect(isBoundVia('forge-run')).toBe(true);
    expect(isBoundVia('swarm')).toBe(false);
    expect(MAX_SEATS).toBe(10);
  });
  it('is strict: unsafe ids, bad dates, a date from the future, an unknown via or reason invalidate it', () => {
    const bad = [{ sid: '../x' }, { claude: 'a b' }, { claude: undefined }, { since: 'yesterday' }, { seenAt: at(3) }, { endedAt: at(2.5), endReason: 'clear' },
      { via: 'swarm' }, { endedAt: at(-1), endReason: 'crash' }, { endedAt: 'nope', endReason: 'clear' }];
    for (const b of bad) expect(normalizeBound(doc(b), NOW), JSON.stringify(b)).toBeNull();
    expect(normalizeBound(doc({ seenAt: at(1.9) }), NOW)).not.toBeNull();
    expect(normalizeBound([doc()], NOW)).toBeNull();
    expect(normalizeBound(null)).toBeNull();
  });
  it('a pid that is not a positive integer is none, and a reason without an end is dropped', () => {
    expect(normalizeBound(doc({ pid: -3 }), NOW)?.pid).toBeNull();
    expect(normalizeBound(doc({ pid: '12' }), NOW)?.pid).toBeNull();
    expect(normalizeBound(doc({ endReason: 'clear' }), NOW)?.endReason).toBeNull();
    expect(normalizeBound(doc({ endedAt: at(-2), endReason: 'released' }), NOW)).toMatchObject({ endedAt: at(-2), endReason: 'released' });
  });
  it('parseBound reads text: broken JSON or more than 4 KiB is no binding', () => {
    expect(parseBound(JSON.stringify(doc()), NOW)?.sid).toBe('main');
    expect(parseBound('{"sid":', NOW)).toBeNull();
    expect(parseBound(JSON.stringify({ ...doc(), pad: 'x'.repeat(5000) }), NOW)).toBeNull();
    expect(parseBound(null)).toBeNull();
  });
  it("endReasonOf keeps the engine's reasons and stores any other as other", () => {
    for (const r of ['clear', 'resume', 'logout', 'prompt_input_exit', 'other']) expect(endReasonOf(r)).toBe(r);
    for (const r of ['released', 'weird', undefined, 3]) expect(endReasonOf(r)).toBe('other');
  });
  it('a binding is live while it has not ended and was renewed less than 5 minutes ago', () => {
    expect(BOUND_LEASE_MS).toBe(5 * 60_000);
    expect(PREVIOUS_OFFER_MS).toBe(24 * 3600_000);
    const b = normalizeBound(doc({ seenAt: at(-4.99) }), NOW)!;
    expect(bindingLive(b, NOW)).toBe(true);
    expect(bindingLive({ ...b, seenAt: at(-5) }, NOW)).toBe(false);
    expect(bindingLive({ ...b, endedAt: at(-1), endReason: 'clear' }, NOW)).toBe(false);
  });
  it('MemberDoc lives in src/lib, and forge re-exports the same normalizer', () => {
    expect(forgeMember).toBe(libMember);
  });
  it('bound.ts, viewer-role.ts and member-doc.ts are pure: no Node and no forge imports', () => {
    for (const f of ['bound', 'viewer-role', 'member-doc']) {
      const src = readFileSync(new URL(`../src/lib/${f}.ts`, import.meta.url), 'utf8');
      expect(src, f).not.toMatch(/from 'node:/);
      expect(src, f).not.toMatch(/from '\.\.\/forge\//);
    }
  });
});
