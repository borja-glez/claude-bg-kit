import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  bandFolds, changedFiles, checkCapture, checkPhoto, dotted, fillTemplate, findText, parseArgs, splitIds, stopTriggered,
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
    expect(stopTriggered(capture('folded-60x24.txt'))).toBe(false);
    expect(stopTriggered('Pulsa t otra vez para parar la ejecución')).toBe(true);
    expect(stopTriggered('Press t again to stop the run')).toBe(true);
    expect(stopTriggered('> /forge:stop')).toBe(true);
  });
  it('(b) finds the photo row in the transcript, and says when it is missing', () => {
    expect(checkPhoto(capture('photo-80x24.txt'), { cols: 80 })).toEqual([]);
    expect(checkPhoto('> /lens\n? for shortcuts\n', { cols: 80 })).toEqual(['no photo row in the transcript']);
    // the engine's own line (a stamp without cards) is not a photo drawn
    expect(checkPhoto('lens · 14:02:11 #1 · 3 tareas\n? for shortcuts\n', { cols: 80 })).toEqual(['the photo row has no cards under it']);
  });
  it('(c) fails a photo whose rows wrap or pass the screen width', () => {
    const text = capture('photo-80x24.txt');
    const stamp = text.split('\n').findIndex(row => row.startsWith('lens ·'));
    expect(checkPhoto(text, { cols: 80, wrapped: [0] })).toEqual([]);
    expect(checkPhoto(text, { cols: 80, wrapped: [stamp + 2] })).toEqual([`row ${stamp + 2} of the photo wrapped`]);
    expect(checkPhoto(text, { cols: 60 })).toEqual([`row ${stamp + 1} is wider than 60 columns`, `row ${stamp + 2} is wider than 60 columns`, `row ${stamp + 3} is wider than 60 columns`, `row ${stamp + 4} is wider than 60 columns`]);
  });
  it('(d) finds the engine mark to click, and the files written in a quiet window', () => {
    expect(findText('Now\n  lens ✕  \nrest', '✕')).toEqual({ row: 1, col: 7 });
    expect(findText('nothing here', '✕')).toBeNull();
    expect(changedFiles({ a: 1, b: 2 }, { a: 1, b: 2 })).toEqual([]);
    expect(changedFiles({ a: 1 }, { a: 5, c: 3 })).toEqual(['a', 'c']);
  });
});
