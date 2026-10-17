import { describe, it, expect } from 'vitest';
import { byteLength, fitForgeDoc, parseForgeDocV2, FORGE_DOC_MAX, type ForgeDocV2, type RoundV2 } from '../src/lib/roadmap-doc.js';

const AT = '2026-10-16T10:00:00.000Z';
const round = (brief: number, n: number, over: Partial<RoundV2> = {}): RoundV2 => ({
  brief, n, action: 'fix', note: 'round note', findings: { critical: 1, important: 0, minor: 0, deferred: 0 }, reviewers: ['correctness', 'security'], at: AT, ...over,
});
const doc = (over: Partial<ForgeDocV2> = {}): ForgeDocV2 => ({
  v: 2, path: 'medium', phase: 'review', validators: [{ name: 'test', ok: true }], round: 1, cap: 4,
  brief: 1, stage: 'review', rounds: [round(1, 1)], verify: null, stages: { implement: 300 }, integration: null, deferred: [], acceptedRound: null, overCap: false, updatedAt: AT,
  ...over,
});

describe('state/T.forge v2: parseForgeDocV2 (C7)', () => {
  it('parses a well-formed block and keeps every v1 field', () => {
    const d = doc({ agent: 'forge-impl', verdict: { action: 'fix', score: 0.4 } });
    expect(parseForgeDocV2(d)).toEqual(d);
  });
  it('a block without v: 2 or with a bad required field is null, and the report says why', () => {
    const got: string[] = [];
    const rep = (f: string, a: string, w: string) => { got.push(`${f} · ${a} · ${w}`); };
    expect(parseForgeDocV2({ ...doc(), v: 1 }, rep)).toBeNull();
    expect(parseForgeDocV2({ ...doc(), stage: 'dreaming' }, rep)).toBeNull();
    expect(parseForgeDocV2({ ...doc(), brief: 0 }, rep)).toBeNull();
    expect(parseForgeDocV2({ ...doc(), updatedAt: 'today' }, rep)).toBeNull();
    expect(parseForgeDocV2('x', rep)).toBeNull();
    expect(got).toEqual(['forge.v · dropped · no v: 2', 'forge.v · dropped · stage', 'forge.v · dropped · brief', 'forge.v · dropped · overCap or updatedAt', 'forge.v · dropped · string']);
  });
  it('drops bad items of its lists, reports each one, and clips long text', () => {
    const got: string[] = [];
    const p = parseForgeDocV2({
      ...doc(), validators: [{ name: 'test', ok: true }, { name: 'x', ok: 'yes' }], rounds: [round(1, 1, { note: 'n'.repeat(300) }), { brief: 1 }],
      deferred: [{ problem: 'p'.repeat(400), file: 'src/a.ts', line: 3 }, { file: 'x' }], stages: { implement: 10.4, nap: 5 },
    }, (f, a) => { got.push(`${f} · ${a}`); })!;
    expect(p.validators).toEqual([{ name: 'test', ok: true }]);
    expect(p.rounds[0].note).toHaveLength(120);
    expect(p.deferred).toEqual([{ problem: 'p'.repeat(160), file: 'src/a.ts', line: 3 }]);
    expect(p.stages).toEqual({ implement: 10 });
    expect(got).toEqual(['forge.validators[1] · dropped', 'forge.rounds[1] · dropped', 'forge.deferred[1] · dropped']);
  });
  it('control and bidi characters never reach the page', () => {
    const rlo = String.fromCharCode(0x202e), bell = String.fromCharCode(7);
    const p = parseForgeDocV2(doc({ rounds: [round(1, 1, { note: `a${bell}b${rlo}c` })] }))!;
    expect(p.rounds[0].note).toBe('a bc');
  });
});

describe('fitForgeDoc: at most 4 KB (C7)', () => {
  const val = (i: number) => ({ name: `validator-${i}`, ok: i % 2 === 0, ms: 1234, cached: true as const, failing: 3 });
  const deferred = (n: number, text: string) => Array.from({ length: n }, (_, i) => ({ file: `src/module-${i}/file.ts`, line: 100 + i, problem: text }));
  it('the limit case of a Large (5 rounds, 10 validators, 10 deferred of 160 characters) fits without cutting the rounds of its brief', () => {
    const big = doc({
      path: 'large', cap: 5, round: 5, rounds: [1, 2, 3, 4, 5].map(n => round(1, n, { note: 'x'.repeat(120), reviewers: ['correctness', 'security', 'perf', 'verify'] })),
      validators: Array.from({ length: 10 }, (_, i) => val(i)), deferred: deferred(10, 'y'.repeat(160)),
    });
    const r = fitForgeDoc(big);
    expect(r.bytes).toBeLessThanOrEqual(FORGE_DOC_MAX);
    expect(r.bytes).toBe(byteLength(JSON.stringify(r.doc)));
    expect(r.doc.rounds).toHaveLength(5);
    expect(r.dropped).not.toContain('rounds:earlier-briefs');
  });
  it('an inflated block is cut in the order of the spec and says so in dropped', () => {
    const order = ['deferred>5', 'rounds:earlier-briefs', 'validators.failing', 'rounds.note:60', 'deferred.problem:80'];
    const inflated = doc({
      brief: 2, rounds: [round(1, 1), round(1, 2), round(1, 3), round(2, 1), round(2, 2), round(2, 3)].map(r => ({ ...r, note: 'z'.repeat(120) })),
      validators: Array.from({ length: 10 }, (_, i) => ({ ...val(i), name: `${'v'.repeat(70)}${i}` })), deferred: deferred(10, 'w'.repeat(160)),
    });
    const r = fitForgeDoc(inflated);
    expect(r.dropped.length).toBeGreaterThanOrEqual(2);
    expect(r.dropped).toEqual(order.slice(0, r.dropped.length));
    expect(r.doc.rounds.every(x => x.brief === 2)).toBe(true);
    expect(r.doc.deferred).toHaveLength(5);
  });
  it('a block that already fits is left alone', () => {
    const small = doc();
    expect(fitForgeDoc(small)).toEqual({ doc: small, dropped: [], bytes: byteLength(JSON.stringify(small)) });
  });
  it('counts UTF-8 bytes, not characters: accented text over 4 KB in bytes is cut (Review Focus 2)', () => {
    const accented = doc({ deferred: deferred(10, 'ñ'.repeat(160)), rounds: [round(1, 1, { note: 'á'.repeat(120) })] });
    const text = JSON.stringify(accented);
    expect(text.length).toBeLessThan(FORGE_DOC_MAX);
    expect(byteLength(text)).toBeGreaterThan(FORGE_DOC_MAX);
    const r = fitForgeDoc(accented);
    expect(r.dropped[0]).toBe('deferred>5');
    expect(r.bytes).toBeLessThanOrEqual(FORGE_DOC_MAX);
  });
});
