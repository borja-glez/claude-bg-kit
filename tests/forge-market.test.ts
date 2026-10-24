import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readMarket, marketNote, lastMarket, marketDir, saveMarket } from '../src/forge/market.js';
import { run } from '../src/forge/cli/run.js';
import { saveRun, startRun } from '../src/forge/run.js';
import { sha256Hex } from '../src/lib/sha256.js';
import { MAX_NOTE, MAX_SOURCES } from '../src/lib/notes.js';
import { useTempDirs } from './helpers/tmp.js';

const tmp = useTempDirs();
const TS = '2026-10-22T10:00:00.000Z';
const REPORT = { summary: 'Roguelites sell on run variety', findings: [
  { text: 'Players expect 30+ unlocks', sources: [{ title: 'Survey', url: 'https://s.example/r' }] },
  { text: 'uncited claim', sources: [] },
  { text: 'bad link only', sources: [{ title: 'x', url: 'javascript:1' }] },
], noWeb: false };

describe('readMarket', () => {
  it('keeps only cited findings, and needs a summary', () => {
    expect(readMarket(JSON.stringify(REPORT))?.findings).toEqual([{ text: 'Players expect 30+ unlocks', sources: [{ title: 'Survey', url: 'https://s.example/r' }] }]);
    expect(readMarket(JSON.stringify({ findings: [] }))).toBeNull();
    expect(readMarket('nope')).toBeNull();
  });
  it('without web, keeps the summary and no findings', () => {
    expect(readMarket(JSON.stringify({ summary: 'WebSearch is not available here', findings: REPORT.findings, noWeb: true }))).toEqual({ summary: 'WebSearch is not available here', findings: [], noWeb: true });
  });
  it('cleans and cuts its texts: the summary to 600, each finding to 400, at most 12 findings; a leading BOM is no part of the JSON', () => {
    const bom = String.fromCharCode(0xfeff);
    const bell = String.fromCharCode(7);
    const cited = (i: number) => ({ text: `f${i}\n${'z'.repeat(500)}`, sources: [{ title: `s${i}`, url: `https://s.example/${i}` }] });
    const r = readMarket(`${bom}${JSON.stringify({ summary: `a${bell}${'b'.repeat(700)}`, findings: Array.from({ length: 15 }, (_, i) => cited(i)), noWeb: false })}`)!;
    expect(Array.from(r.summary)).toHaveLength(600);
    expect(r.summary.startsWith('a b')).toBe(true);
    expect(r.findings).toHaveLength(12);
    expect(r.findings[0].text).toBe(`f0 ${'z'.repeat(397)}`);
    expect(readMarket(JSON.stringify({ summary: '   ', findings: [] }))).toBeNull();
    expect(readMarket(JSON.stringify([REPORT]))).toBeNull();
  });
});

describe('marketNote', () => {
  it('is a market note of the session with the cited sources, and says when there was no web', () => {
    const w = marketNote(readMarket(JSON.stringify(REPORT))!, TS, 'main', true);
    expect(w).toMatchObject({ op: 'set', collection: 'notes', data: { ts: TS, type: 'market', author: 'session:main', sources: [{ title: 'Survey', url: 'https://s.example/r' }] } });
    expect(w.doc_id).toMatch(/^20261022T100000000Z-main-m[0-9a-f]{10}$/);
    expect((w.data as { text: string }).text).toBe('Roguelites sell on run variety\n- Players expect 30+ unlocks');
    expect((marketNote({ summary: 'sin WebSearch', findings: [], noWeb: true }, TS, 'main', true).data as { text: string }).text).toBe('Sin acceso a la web: sin WebSearch');
  });
  it('takes its id from the time and the sha256 of its text (L-3), cuts the text to MAX_NOTE and keeps each source once, MAX_SOURCES at most', () => {
    const w = marketNote({ summary: 'no web', findings: [], noWeb: true }, TS, 'main', false);
    const text = (w.data as { text: string }).text;
    expect(text).toBe('No web access: no web');
    expect(w.doc_id).toBe(`20261022T100000000Z-main-m${sha256Hex(text).slice(0, 10)}`);
    const src = (i: number) => ({ title: `s${i}`, url: `https://s.example/${i}` });
    // Each finding shares its first source with the one before it: 25 sources once each, the first MAX_SOURCES kept.
    const findings = Array.from({ length: 12 }, (_, i) => ({ text: 'w'.repeat(400), sources: [src(2 * i), src(2 * i + 1), src(2 * i + 2)] }));
    const big = marketNote({ summary: 'x'.repeat(600), findings, noWeb: false }, TS, 'main', false);
    expect(Array.from((big.data as { text: string }).text)).toHaveLength(MAX_NOTE);
    expect((big.data as { sources: unknown[] }).sources).toEqual(Array.from({ length: MAX_SOURCES }, (_, i) => src(i)));
  });
});

describe('forge market', () => {
  it('note keeps the report for the scout and prints the note; last finds it', () => {
    const root = tmp('market-');
    writeFileSync(path.join(root, 'm.json'), JSON.stringify(REPORT));
    const r = JSON.parse(run(['market', 'note', '--file', 'm.json', '--session', 'main', '--locale', 'en'], { cwd: root, now: () => new Date(TS), env: {} }).stdout);
    expect(r).toMatchObject({ findings: 1, noWeb: false, publish: [{ collection: 'notes', data: { type: 'market' } }] });
    expect(JSON.parse(run(['market', 'last'], { cwd: root, now: () => new Date(TS), env: {} }).stdout)).toEqual({ file: r.file });
    expect(lastMarket(root)).toBe(r.file);
    writeFileSync(path.join(root, 'bad.json'), '{}');
    expect(run(['market', 'note', '--file', 'bad.json', '--session', 'main'], { cwd: root, now: () => new Date(TS), env: {} }).code).toBe(2);
  });
  it('keeps the read report in .forge/market/<compactTs>.json, and last is the newest; none is null', () => {
    const root = tmp('market-last-');
    expect(JSON.parse(run(['market', 'last'], { cwd: root, now: () => new Date(TS), env: {} }).stdout)).toEqual({ file: null });
    const first = saveMarket(root, readMarket(JSON.stringify(REPORT))!, TS);
    expect(first).toBe(path.join(marketDir(root), '20261022T100000000Z.json'));
    expect(marketDir(root)).toBe(path.join(root, '.forge', 'market'));
    expect(JSON.parse(readFileSync(first, 'utf8'))).toEqual(readMarket(JSON.stringify(REPORT)));
    writeFileSync(path.join(marketDir(root), 'zz-not-a-report.json'), '{}');
    const second = saveMarket(root, { summary: 'later', findings: [], noWeb: false }, '2026-10-23T08:00:00.000Z');
    expect(lastMarket(root)).toBe(second);
  });
  it('without --locale, the note takes the run\'s locale (L-7); --session, --file and --locale are checked', () => {
    const root = tmp('market-locale-');
    saveRun(root, startRun(new Date(TS), {}, undefined, null, 'es'));
    writeFileSync(path.join(root, 'n.json'), JSON.stringify({ summary: 'WebSearch falló', findings: [], noWeb: true }));
    const io = { cwd: root, now: () => new Date(TS), env: {} };
    const text = (argv: string[]) => JSON.parse(run(argv, io).stdout).publish[0].data.text;
    expect(text(['market', 'note', '--file', 'n.json', '--session', 'main'])).toBe('Sin acceso a la web: WebSearch falló');
    expect(text(['market', 'note', '--file', 'n.json', '--session', 'main', '--locale', 'en'])).toBe('No web access: WebSearch falló');
    for (const argv of [['market', 'note', '--file', 'n.json'], ['market', 'note', '--file', 'n.json', '--session', 'a/b'], ['market', 'note', '--session', 'main'],
      ['market', 'note', '--file', 'missing.json', '--session', 'main'], ['market', 'note', '--file', 'n.json', '--session', 'main', '--locale', 'fr'], ['market', 'nope']]) {
      expect(run(argv, io).code, argv.join(' ')).toBe(2);
    }
  });
});
