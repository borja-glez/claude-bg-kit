import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  BAND_READY, bandFolds, changedFiles, checkCapture, checkPhoto, closeVerdict, dotted, fillTemplate, findText, parseArgs,
  sameScreen, splitIds, stopTriggered,
} from '../scripts/tui/checks.mjs';

const capture = (name: string) => readFileSync(new URL(`./fixtures/tui/${name}`, import.meta.url), 'utf8');

describe('the checks of the TUI snapshots (F-17)', () => {
  it('finds a task id split across two rows, and accepts a good capture', () => {
    expect(splitIds(capture('split-80x24.txt'))).toEqual(['T002']);
    expect(splitIds(capture('good-80x24.txt'))).toEqual([]);
    expect(checkCapture(capture('good-80x24.txt'), { cols: 80, rows: 24, mode: 'main', kind: 'band' })).toEqual([]);
    expect(checkCapture(capture('split-80x24.txt'), { cols: 80, rows: 24, mode: 'main', kind: 'band' })).toEqual(['T002 is split across two rows']);
  });
  it('asks for ▲ and ✎ in the band at 80 columns, letters on its buttons outside fullscreen, and ↓ on a cut inline pane', () => {
    expect(checkCapture('► 2/3 · T001 impl', { cols: 80, rows: 24, mode: 'fullscreen', kind: 'band' })).toEqual(['no ▲ at 80 columns', 'no ✎ at 80 columns']);
    expect(checkCapture('► 2/3 · ✎ 1 · ▲ decisión  [ × ]', { cols: 80, rows: 24, mode: 'main', kind: 'band' })).toEqual(['no letter on the buttons outside fullscreen']);
    expect(checkCapture('Now\n  ▸ Opus', { cols: 120, rows: 14, mode: 'main', kind: 'live' })).toEqual(['the inline pane was not cut with ↓']);
    expect(checkCapture('Now\n  ▸ Opus', { cols: 120, rows: 40, mode: 'main', kind: 'live' })).toEqual([]);
  });
  it('reads its options and refuses what it does not know', () => {
    const plain = parseArgs([], '2026-10-16');
    expect(plain).toMatchObject({ out: 'docs/superpowers/notes/tui-2026-10-16', modes: ['fullscreen', 'main'] });
    expect(plain.sizes).toHaveLength(15);
    expect(parseArgs(['--sizes', '80x24,120x40', '--modes', 'main', '--out', 'x'])).toEqual({ out: 'x', sizes: [{ cols: 80, rows: 24 }, { cols: 120, rows: 40 }], modes: ['main'] });
    expect(() => parseArgs(['--sizes', '80by24'])).toThrow(/--sizes/);
    expect(() => parseArgs(['--modes', 'tmux'])).toThrow(/--modes/);
    expect(() => parseArgs(['--fast'])).toThrow(/unknown option/);
    expect(plain).not.toHaveProperty('configDir');
    expect(parseArgs(['--config-dir', '/tmp/cfg', '--no-engine']))
      .toMatchObject({ configDir: '/tmp/cfg', engine: false });
    expect(parseArgs(['--engine-only'])).toMatchObject({ engineOnly: true });
    expect(() => parseArgs(['--config-dir'])).toThrow(/unknown option|--config-dir/);
  });
  it('fills the fixture with the session it launches and times counted from now, and puts its dot folders back', () => {
    const now = Date.parse('2026-10-16T12:00:00.000Z');
    expect(fillTemplate('{"claude":"__SESSION__","seenAt":"__AGO_1__","at":"__NOW__"}', { session: 'abc', now }))
      .toBe('{"claude":"abc","seenAt":"2026-10-16T11:59:00.000Z","at":"2026-10-16T12:00:00.000Z"}');
    expect(dotted('dot-waypoint/demo/bound.json')).toBe('.waypoint/demo/bound.json');
    expect(dotted('dot-forge/status/demo__T001.json')).toBe('.forge/status/demo__T001.json');
    expect(dotted('docs/waypoint/demo/plan.yaml')).toBe('docs/waypoint/demo/plan.yaml');
  });
});

describe('the engine checks of the TUI snapshots (carried from tasks 5, 8, 9 and 7)', () => {
  it('(a) knows a band with its buttons folded into ⋯, and whether a Stop press did anything', () => {
    expect(bandFolds(capture('folded-60x24.txt'))).toBe(true);
    expect(bandFolds(capture('good-80x24.txt'))).toBe(false);
    expect(bandFolds('► 3/3 · [ ⋯ ]  t: Parar')).toBe(false);
    const folded = capture('folded-60x24.txt');
    expect(stopTriggered(folded, folded)).toBe(false);
    expect(stopTriggered(folded, `${folded}Pulsa t otra vez para parar la ejecución\n`)).toBe(true);
    expect(stopTriggered(folded, `${folded}Press t again to stop the run\n`)).toBe(true);
    expect(stopTriggered(folded, `${folded}> /forge:stop\n`)).toBe(true);
    // text that was already on the screen before the press is not an effect of it
    expect(stopTriggered('/forge:stop está en el prompt', '/forge:stop está en el prompt')).toBe(false);
  });
  it('(a) compares screens ignoring clocks and elapsed times, to tell a press that did something from one that did not', () => {
    expect(sameScreen('► 3/3 · 12 m  14:02:11', '► 3/3 · 13 m  14:02:15')).toBe(true);
    expect(sameScreen('► 3/3 · [ ⋯ ]', '► 3/3 · [ ⋯ ]  p: Panel  t: Parar')).toBe(false);
  });
  it('knows when the band is up, including its short header at narrow widths', () => {
    expect(BAND_READY.test('► EJECUCIÓN · subagentes 2/3')).toBe(true);
    expect(BAND_READY.test('► 2/3 · ✎ 1')).toBe(true);
    expect(BAND_READY.test('> hello\n? for shortcuts')).toBe(false);
  });
  it('(b) finds the photo row in the transcript, and says when it is missing', () => {
    expect(checkPhoto(capture('photo-80x24.txt'), { cols: 80 })).toEqual([]);
    expect(checkPhoto('> /lens\n? for shortcuts\n', { cols: 80 })).toEqual(['no photo row in the transcript']);
    // the engine's own line (a stamp without cards) is not a photo drawn
    expect(checkPhoto('lens · 14:02:11 #1 · 3 tareas\n? for shortcuts\n', { cols: 80 })).toEqual(['the photo row has no cards under it']);
    expect(checkPhoto('lens · 14:02:11 #1 · 3 tareas\n\n> next\n', { cols: 80 })).toEqual(['the photo row has no cards under it']);
  });
  it('(c) fails a photo whose rows wrap or pass the screen width', () => {
    // photo-80x24.txt is the unboxed inline photo, rendered by term.tsx and layout.ts (see the report)
    const text = capture('photo-80x24.txt');
    const stamp = text.split('\n').findIndex(row => row.startsWith('lens ·'));
    expect(stamp).toBe(1);
    expect(checkPhoto(text, { cols: 80, wrapped: [0] })).toEqual([]);
    expect(checkPhoto(text, { cols: 80, wrapped: [stamp + 4] })).toEqual([`row ${stamp + 4} of the photo wrapped`]);
    expect(checkPhoto(text, { cols: 60 })).toEqual(['row 5 is wider than 60 columns']);
  });
  it('(d) says inconclusive unless a write was seen before the close, and never passes two empty observations', () => {
    expect(closeVerdict({}, {}).verdict).toBe('inconclusive');
    expect(closeVerdict({ 'u.json': 1 }, { 'u.json': 1 }).verdict).toBe('pass');
    expect(closeVerdict({ 'u.json': 1 }, { 'u.json': 2 })).toMatchObject({ verdict: 'fail', detail: ['lens wrote u.json after the pane was closed'] });
  });
  it('(d) finds the engine mark to click, and the files written in a quiet window', () => {
    expect(findText('Now\n  lens ✕  \nrest', '✕')).toEqual({ row: 1, col: 7 });
    expect(findText('nothing here', '✕')).toBeNull();
    expect(changedFiles({ a: 1, b: 2 }, { a: 1, b: 2 })).toEqual([]);
    expect(changedFiles({ a: 1 }, { a: 5, c: 3 })).toEqual(['a', 'c']);
  });
});
