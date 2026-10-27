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

describe('state/T.forge v3 fields: why, red, next, impl, score and the trail (waypoint 0.39)', () => {
  const why = (k: number, sev: 'critical' | 'important' = 'important') => ({ sev, problem: `problem ${k}`, file: `src/f${k}.ts`, line: k, by: 'correctness' });
  const step = (s: string, b?: number, r?: number) => ({ s, at: AT, ...(b ? { b } : {}), ...(r ? { r } : {}) });
  it('the new fields round-trip', () => {
    const d = doc({
      rounds: [round(1, 1, { next: 'fresh-stronger', impl: 'forge-impl-strong', score: 0.42, why: [why(1, 'critical'), why(2)], red: ['test', 'lint'] }), round(1, 2, { action: 'accept', next: 'done', score: 0.9 })],
      trail: [step('triage'), step('implement', 1), step('review', 1, 1), step('fix', 1, 1), step('stopped')],
    });
    expect(parseForgeDocV2(d)).toEqual(d);
  });
  it('a block without the new fields parses exactly as before, and nothing is reported', () => {
    const got: string[] = [];
    const d = doc({ agent: 'forge-impl', verdict: { action: 'fix', score: 0.4 } });
    const p = parseForgeDocV2(d, f => { got.push(f); })!;
    expect(p).toEqual(d);
    expect(p).not.toHaveProperty('trail');
    expect(Object.keys(p.rounds[0]).sort()).toEqual(['action', 'at', 'brief', 'findings', 'n', 'note', 'reviewers']);
    expect(got).toEqual([]);
  });
  it('an invalid why item, next, impl, score or red name is dropped alone, never its round; an invalid trail step is dropped and reported, never the block', () => {
    const got: string[] = [];
    const p = parseForgeDocV2({
      ...doc(),
      rounds: [round(1, 1, {
        next: 'later' as never, impl: '   ', score: 1.5,
        why: [{ sev: 'minor', problem: 'x' }, { sev: 'critical', problem: '  ' }, 'x', null, { sev: 'important', problem: 'kept', file: 5, line: 0, by: '' }] as never,
        red: [5, '', 'test'] as never,
      }), round(1, 2, { score: Number.NaN, why: 'x' as never, red: {} as never })],
      trail: [{ s: 'nap', at: AT }, { s: 'review', at: 'today' }, { s: 'fix', at: AT, b: 0, r: 'x' }, null, { s: 'triage', at: AT }],
    }, (f, a) => { got.push(`${f} · ${a}`); })!;
    expect(p).not.toBeNull();
    expect(p.rounds).toEqual([round(1, 1, { why: [{ sev: 'important', problem: 'kept' }], red: ['test'] }), round(1, 2)]);
    expect(p.trail).toEqual([{ s: 'fix', at: AT }, { s: 'triage', at: AT }]);
    expect(got).toEqual(['forge.trail[0] · dropped', 'forge.trail[1] · dropped', 'forge.trail[3] · dropped']);
    // A trail that is no list is left out and reported; a trail with no valid step is left out.
    const rep: string[] = [];
    expect(parseForgeDocV2({ ...doc(), trail: 'x' }, (f, a) => { rep.push(`${f} · ${a}`); })).not.toHaveProperty('trail');
    expect(rep).toEqual(['forge.trail · coerced']);
    expect(parseForgeDocV2({ ...doc(), trail: [{ s: 'nap', at: AT }] })).not.toHaveProperty('trail');
  });
  it('caps and clips: the first 3 whys of 100 characters, the first 4 red names, the newest 16 steps', () => {
    const p = parseForgeDocV2(doc({
      rounds: [round(1, 1, { why: [1, 2, 3, 4].map(k => ({ ...why(k), problem: `${k}`.repeat(300) })), red: ['a', 'b', 'c', 'd', 'e'] })],
      trail: Array.from({ length: 20 }, (_, k) => step('review', 1, k + 1)),
    }))!;
    expect(p.rounds[0].why!.map(w => w.problem)).toEqual(['1'.repeat(100), '2'.repeat(100), '3'.repeat(100)]);
    expect(p.rounds[0].red).toEqual(['a', 'b', 'c', 'd']);
    expect(p.trail!.map(t => t.r)).toEqual(Array.from({ length: 16 }, (_, k) => k + 5));
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
  const why = (k: number, sev: 'critical' | 'important' = 'important') => ({ sev, problem: `${k}`.repeat(100), file: `src/module-${k}/a-file.ts`, line: 100 + k, by: 'correctness' });
  const steps = (n: number) => Array.from({ length: n }, (_, k) => ({ s: 'review', at: AT, b: 1, r: k + 1 }));
  it('v3: each of its cuts stops once the block fits: the newest 8 steps, one why per round (the first), no trail, then no why nor red', () => {
    const base = doc({ rounds: [round(1, 1, { why: [why(1, 'critical'), why(2), why(3)], red: ['test'], next: 'resume', impl: 'forge-impl', score: 0.4 })], trail: steps(16) });
    const under = (d: ForgeDocV2) => byteLength(JSON.stringify(d)) - 1;
    const eight = fitForgeDoc(base, under(base));
    expect(eight.dropped).toEqual(['trail>8']);
    expect(eight.doc.trail!.map(t => t.r)).toEqual([9, 10, 11, 12, 13, 14, 15, 16]);
    const one = fitForgeDoc(base, under(eight.doc));
    expect(one.dropped).toEqual(['trail>8', 'rounds.why>1']);
    expect(one.doc.rounds[0]).toMatchObject({ why: [why(1, 'critical')], red: ['test'] });
    const noTrail = fitForgeDoc(base, under(one.doc));
    expect(noTrail.dropped).toEqual(['trail>8', 'rounds.why>1', 'trail']);
    expect(noTrail.doc).not.toHaveProperty('trail');
    const bare = fitForgeDoc(base, under(noTrail.doc));
    expect(bare.dropped).toEqual(['trail>8', 'rounds.why>1', 'trail', 'rounds.why']);
    expect(bare.doc.rounds[0]).not.toHaveProperty('why');
    expect(bare.doc.rounds[0]).not.toHaveProperty('red');
    // What the round decided stays one cut longer: the page shows it without the whys.
    expect(bare.doc.rounds[0]).toMatchObject({ next: 'resume', impl: 'forge-impl', score: 0.4, note: 'round note' });
    expect(parseForgeDocV2(bare.doc)).toEqual(bare.doc);
    // Then it goes too, before anything a block carried before v3: the page falls back to the round's note.
    const plain = fitForgeDoc(base, under(bare.doc));
    expect(plain.dropped).toEqual(['trail>8', 'rounds.why>1', 'trail', 'rounds.why', 'rounds.next']);
    for (const k of ['next', 'impl', 'score']) expect(plain.doc.rounds[0]).not.toHaveProperty(k);
    expect(plain.doc.rounds[0]!.note).toBe('round note');
  });
  it('v3: the Large limit case with a full trail and three whys and four red validators on every round fits, cut first by the v3 steps and then as it was before', () => {
    const large = (over: Partial<RoundV2>) => doc({
      path: 'large', cap: 5, round: 5, rounds: [1, 2, 3, 4, 5].map(n => round(1, n, { note: 'x'.repeat(120), reviewers: ['correctness', 'security', 'perf', 'verify'], ...over })),
      validators: Array.from({ length: 10 }, (_, i) => val(i)), deferred: deferred(10, 'y'.repeat(160)),
    });
    const before = fitForgeDoc(large({}));
    const full = { ...large({ next: 'fresh-stronger', impl: 'forge-impl-strong', score: 0.55, why: [why(1, 'critical'), why(2), why(3)], red: ['validator-1', 'validator-3', 'validator-5', 'validator-7'] }), trail: steps(16) };
    expect(parseForgeDocV2(full)).toEqual(full);
    const r = fitForgeDoc(full);
    expect(r.fits).toBe(true);
    expect(r.bytes).toBeLessThanOrEqual(FORGE_DOC_MAX);
    // Every v3 field goes before anything the block carried before v3 (the subagent's finding: without the rounds.next
    // cut, this block lost a deferred finding it kept before): what is left is the block of before, cut as it was.
    expect(r.dropped).toEqual(['trail>8', 'rounds.why>1', 'trail', 'rounds.why', 'rounds.next', ...before.dropped]);
    expect(r.doc.rounds.map(x => [x.brief, x.n])).toEqual([[1, 1], [1, 2], [1, 3], [1, 4], [1, 5]]);
    expect(r.doc).toEqual(before.doc);
  });
  it('a block that already fits is left alone', () => {
    const small = doc();
    expect(fitForgeDoc(small)).toEqual({ doc: small, dropped: [], bytes: byteLength(JSON.stringify(small)), fits: true });
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
  it('the boundary is in bytes: exactly 4096 is kept whole, 4097 is cut', () => {
    const six = deferred(6, 'short');
    const pad = FORGE_DOC_MAX - byteLength(JSON.stringify(doc({ phase: '', deferred: six })));
    const exact = doc({ phase: 'a'.repeat(pad), deferred: six });
    // one 'ñ' (2 bytes) in place of one 'a' (1 byte): one byte over, with the same number of characters
    const over = doc({ phase: `${'a'.repeat(pad - 1)}ñ`, deferred: six });
    expect(byteLength(JSON.stringify(exact))).toBe(FORGE_DOC_MAX);
    expect(byteLength(JSON.stringify(over))).toBe(FORGE_DOC_MAX + 1);
    expect(fitForgeDoc(exact)).toEqual({ doc: exact, dropped: [], bytes: FORGE_DOC_MAX, fits: true });
    expect(fitForgeDoc(over).dropped[0]).toBe('deferred>5');
  });
  it('a maximal block that the five cuts cannot fit is reduced to its core, which fits', () => {
    const cjk = String.fromCharCode(0x4e2d);
    const input = {
      ...doc(), agent: cjk.repeat(80), phase: cjk.repeat(40),
      validators: Array.from({ length: 10 }, (_, i) => ({ name: cjk.repeat(80), ok: i % 2 === 0, skipped: cjk.repeat(80), flaky: true, preexisting: true, ms: 9999, cached: true, failing: 7 })),
      rounds: [1, 2, 3, 4, 5, 6].map(n => round(1, n, { note: 'á'.repeat(120), reviewers: Array.from({ length: 6 }, () => cjk.repeat(40)) })),
      deferred: Array.from({ length: 10 }, () => ({ problem: cjk.repeat(160), file: 'f'.repeat(200), line: 1 })),
      verdict: { action: 'fix', score: 0.5 }, round: 3, cap: 4, brief: 1, stage: 'review', acceptedRound: null,
    };
    const parsed = parseForgeDocV2(input)!;
    expect(parsed).not.toBeNull();
    const r = fitForgeDoc(parsed);
    expect(r.dropped.at(-1)).toBe('core');
    expect(r.fits).toBe(true);
    expect(r.bytes).toBeLessThanOrEqual(FORGE_DOC_MAX);
    expect(r.bytes).toBe(byteLength(JSON.stringify(r.doc)));
    expect(parseForgeDocV2(r.doc)).not.toBeNull();
    expect(r.doc).toMatchObject({ v: 2, path: 'medium', brief: 1, stage: 'review', round: 3, cap: 4, overCap: false, rounds: [], deferred: [], verify: null, integration: null });
    expect(r.doc.validators.every(v => v.ok === false)).toBe(true);
    // Carry 1: the reviewers go with their rounds; none is left anywhere in the core.
    expect(JSON.stringify(r.doc)).not.toContain('reviewers');
  });
  it('fits is false only when even the core exceeds the limit', () => {
    const r = fitForgeDoc(doc(), 50);
    expect(r.fits).toBe(false);
    expect(r.bytes).toBeGreaterThan(50);
  });
});

describe('parseForgeDocV2: hostile input never throws, and coercions are reported', () => {
  const huge = 'x'.repeat(1_000_000);
  const hole = (n: number) => new Array(n);
  const cases: [string, unknown][] = [
    ['null', null], ['array', []], ['bare v', { v: 2 }], ['__proto__ key', JSON.parse('{"__proto__":{"polluted":1},"constructor":{"x":1}}')],
    ['proto in a valid block', { ...JSON.parse(JSON.stringify(doc())), ...JSON.parse('{"__proto__":{"v":3}}') }],
    ['NaN and Infinity in stages', { ...doc(), stages: { implement: NaN, review: Infinity, triage: -1 } }],
    ['non-objects in every list', { ...doc(), validators: [1, null, 'x', []], rounds: [null, 5, []], deferred: ['a', undefined, 3] }],
    ['arrays with holes', { ...doc(), validators: hole(5), rounds: hole(5), deferred: hole(5) }],
    ['verify of the wrong type', { ...doc(), verify: 'x' }], ['integration of the wrong type', { ...doc(), integration: [] }],
    ['verify with bad fields', { ...doc(), verify: { planned: 'yes' } }], ['integration with bad fields', { ...doc(), integration: { branch: 5 } }],
    ['1e6-character texts', { ...doc(), phase: huge, agent: huge, validators: [{ name: huge, ok: true, skipped: huge }], deferred: [{ problem: huge, file: huge }], rounds: [round(1, 1, { note: huge })] }],
    ['verdict and agent of the wrong type', { ...doc(), agent: 7, verdict: 'fix', round: 'x', cap: {} }],
  ];
  it.each(cases)('%s', (_name, input) => {
    let calls = 0;
    expect(() => parseForgeDocV2(input, () => { calls++; })).not.toThrow();
    expect(() => fitForgeDoc(parseForgeDocV2(input) ?? doc())).not.toThrow();
    expect(calls).toBeLessThan(100);
  });
  it('reports as coerced an invalid agent, verdict, round or cap, and a verify or integration with bad fields', () => {
    const got: string[] = [];
    const p = parseForgeDocV2({ ...doc(), agent: 7, verdict: 'fix', round: 'x', cap: {}, verify: { planned: 'yes' }, integration: { branch: 5 } }, (f, a) => { got.push(`${f} · ${a}`); })!;
    expect(p).not.toHaveProperty('agent');
    expect(p).not.toHaveProperty('verdict');
    expect(p.verify).toBeNull();
    expect(p.integration).toBeNull();
    expect(got).toEqual(['forge.verify · coerced', 'forge.integration · coerced', 'forge.agent · coerced', 'forge.verdict · coerced', 'forge.round · coerced', 'forge.cap · coerced']);
  });
  it('a round above the cap is a real state (r5/4): kept, the block marked overCap, and nothing reported', () => {
    const got: string[] = [];
    const p = parseForgeDocV2(doc({ round: 5, cap: 4, overCap: false }), (f, a) => { got.push(`${f} · ${a}`); })!;
    expect(p).toMatchObject({ round: 5, cap: 4, overCap: true });
    expect(got).toEqual([]);
    expect(parseForgeDocV2(doc({ round: 5, cap: 4, overCap: true }))).toMatchObject({ round: 5, cap: 4, overCap: true });
    expect(parseForgeDocV2(doc({ round: 2, cap: 2 }))).toMatchObject({ round: 2, cap: 2, overCap: false });
  });
  it('a clip never splits a surrogate pair', () => {
    const face = String.fromCodePoint(0x1f600);
    const p = parseForgeDocV2(doc({ rounds: [round(1, 1, { note: face.repeat(200) })], deferred: [{ problem: `${'a'.repeat(159)}${face}` }] }))!;
    expect(p.rounds[0].note).toBe(face.repeat(120));
    expect(p.deferred[0].problem).toBe(`${'a'.repeat(159)}${face}`);
    const noted = doc({ rounds: [round(1, 1, { note: `${'a'.repeat(59)}${face}b${'c'.repeat(50)}` })] });
    const cut = fitForgeDoc(noted, byteLength(JSON.stringify(noted)) - 1).doc.rounds[0].note;
    expect(cut).toBe(`${'a'.repeat(59)}${face}`);
    expect(JSON.stringify(cut)).not.toMatch(/\\ud/i);
  });
});
