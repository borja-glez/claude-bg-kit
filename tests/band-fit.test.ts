import { describe, it, expect } from 'vitest';
import { bandLevel, controlWidth, fitParts, joinParts, layoutBand, partsWidth, type BandControl, type BandPart } from '../src/mod/band-fit.js';
import { stringWidth } from '../src/lib/text-width.js';

const P = (key: string, text: string, prio: number, o: Partial<BandPart> = {}): BandPart => ({ key, text, prio, ...o });
const TITLE = 'A very long task title that goes well b…';
// A work band's parts as bandParts gives them (Task 3), with their priorities and short forms.
const WORK: BandPart[] = [
  P('progress', '● frente core 2/5', 5, { short: '● 2/5' }),
  P('task', `T3 ${TITLE}`, 4, { short: 'T3', title: TITLE }),
  P('minutes', '12 m / 30 m', 6, { short: '12m' }),
  P('percent', 'global 40 %', 7, { short: '40%' }),
  P('inbox', '✎ 2', 3),
  P('decision', '▲ decisión pendiente', 1, { short: '▲ decisión', hue: 'alert' }),
];
const line = (parts: BandPart[], cols: number) => joinParts(fitParts(parts, cols).shown);

describe('fitParts (F-04)', () => {
  it('shortens from the least important part up, clips the task title before its id, and drops last what asks for you', () => {
    expect(line(WORK, 120)).toBe('● frente core 2/5 · T3 A very long task title that goes well b… · 12 m / 30 m · global 40 % · ✎ 2 · ▲ decisión pendiente');
    expect(line(WORK, 100)).toBe('● 2/5 · T3 A very long task title that goes well b… · 12m · 40% · ✎ 2 · ▲ decisión pendiente');
    expect(line(WORK, 80)).toBe('● 2/5 · T3 A very long task title that… · 12m · 40% · ✎ 2 · ▲ decisión pendiente');
    expect(line(WORK, 60)).toBe('● 2/5 · T3 A very … · 12m · 40% · ✎ 2 · ▲ decisión pendiente');
    expect(line(WORK, 40)).toBe('● 2/5 · T3 · 12m · ✎ 2 · ▲ decisión');
    expect(line(WORK, 20)).toBe('✎ 2 · ▲ decisión');
  });
  it('respects the measured width at 60, 80, 100, 120 and 160 columns, and keeps the inbox and the decision', () => {
    for (const cols of [60, 80, 100, 120, 160]) {
      const { shown } = fitParts(WORK, cols);
      expect(partsWidth(shown), String(cols)).toBeLessThanOrEqual(cols);
      expect(shown.map(p => p.key), String(cols)).toEqual(expect.arrayContaining(['inbox', 'decision']));
    }
  });
  it('counts the slots it drops in one «+N» where the first of them was, and never returns more parts than it got (E-04)', () => {
    const slots = Array.from({ length: 8 }, (_, i) => P(`slot:T00${i + 1}`, `T00${i + 1} implementar`, 4, { short: `T00${i + 1} impl` }));
    const run = [P('head', '► EJECUCIÓN · subagentes 8/8', 5, { short: '► 8/8' }), ...slots, P('integrated', '3/12 integradas', 5, { short: '3/12' })];
    expect(line(run, 120)).toBe('► 8/8 · T001 implementar · T002 impl · T003 impl · T004 impl · T005 impl · T006 impl · T007 impl · T008 impl · 3/12');
    expect(line(run, 80)).toBe('T001 impl · T002 impl · T003 impl · T004 impl · T005 impl · T006 impl · +2');
    expect(line(run, 40)).toBe('T001 impl · T002 impl · T003 impl · +5');
    for (const cols of [200, 120, 80, 60, 40, 20, 5]) expect(fitParts(run, cols).shown.length, String(cols)).toBeLessThanOrEqual(run.length);
  });
  it('joins a glued part with its own glue, so a notice reads as a sentence', () => {
    const notice = [P('notice', '◌ quedó a medias:', 2, { short: '◌ a medias' }), P('task', 'T019 Reparto', 4, { short: 'T019', title: 'Reparto', glue: ' ' }), P('ago', 'hace 2 h', 7, { short: '2h' })];
    expect(line(notice, 60)).toBe('◌ quedó a medias: T019 Reparto · hace 2 h');
    expect(line(notice, 30)).toBe('◌ quedó a medias: T019 · 2h');
    expect(line(notice, 20)).toBe('◌ a medias T019 · 2h');
    expect(line(notice, 15)).toBe('◌ a medias T019');
  });
  it('counts cells: a wide title is clipped by cells and never runs past the width (Review Focus 1)', () => {
    const wide = [P('task', 'T7 漢字のタイトルがとても長いタスク', 4, { short: 'T7', title: '漢字のタイトルがとても長いタスク' }), P('inbox', '✎ 1', 3)];
    for (const cols of [40, 30, 20, 16, 12]) expect(stringWidth(line(wide, cols)), String(cols)).toBeLessThanOrEqual(cols);
    expect(line(wide, 20)).toBe('T7 漢字のタイ… · ✎ 1');
    expect(line(wide, 12)).toBe('T7 · ✎ 1');
  });
  it('without a number of columns it fits in 80 (Review Focus 2)', () => {
    expect(line(WORK, Number.NaN)).toBe(line(WORK, 80));
  });
});

describe('bandLevel and controlWidth (F-05, F-12)', () => {
  it('wide from 140 columns, two from 90, one when narrower, under 3 rows or outside fullscreen', () => {
    const lv = (bodyColumns: number, maxRows = 10, fullscreen = true) => bandLevel({ bodyColumns, maxRows, fullscreen });
    expect([lv(160), lv(140), lv(139), lv(90), lv(89), lv(160, 2), lv(160, 10, false)]).toEqual(['wide', 'wide', 'two', 'two', 'one', 'one', 'one']);
  });
  it('measures a control: [ label ] takes w+4, plain «k: label» w+3 (w without a letter), a link or a text w', () => {
    expect(controlWidth('Siguiente', { plain: false, hotkey: 'n' })).toBe(13);
    expect(controlWidth('Siguiente', { plain: true, hotkey: 'n' })).toBe(12);
    expect(controlWidth('Siguiente', { plain: true })).toBe(9);
    expect(controlWidth('Abrir roadmap', { plain: false, kind: 'link' })).toBe(13);
    expect(controlWidth('×', { plain: false, hotkey: 'x' })).toBe(5);
  });
});

describe('layoutBand (F-02, F-05, F-15)', () => {
  const controls = (fullscreen: boolean): BandControl[] => [
    { key: 'next-task', label: 'Siguiente tarea', short: 'Siguiente', hotkey: 'n' },
    { key: 'status', label: 'Estado', hotkey: 's' },
    { key: 'launch', label: 'Lanzar sesión en un frente…', short: 'Lanzar…', hotkey: 'l' },
    fullscreen ? { key: 'roadmap', label: 'Abrir roadmap', short: 'Roadmap', kind: 'link' } : { key: 'roadmap', label: 'Abrir roadmap', short: 'Roadmap', hotkey: 'r' },
    { key: 'dismiss', label: '×', hotkey: 'x' },
  ];
  const lay = (bodyColumns: unknown, maxRows: unknown = 10, fullscreen = true, moreOpen = false) =>
    layoutBand(WORK, controls(fullscreen), { bodyColumns, maxRows, fullscreen, moreOpen });
  const all = ['next-task', 'status', 'launch', 'roadmap', 'dismiss'];
  it('at 160 columns: one row, the long buttons beside the parts', () => {
    expect(lay(160)).toMatchObject({ level: 'wide', long: true, plain: false, inline: all, second: [], more: false });
    expect(joinParts(lay(160).shown)).toBe('● 2/5 · T3 A very long task title t… · 12m · 40% · ✎ 2 · ▲ decisión pendiente');
  });
  it('at 120 columns: the parts whole on their row, the short buttons on a second one', () => {
    expect(lay(120)).toMatchObject({ level: 'two', long: false, inline: [], second: all, more: false });
    expect(joinParts(lay(120).shown)).toBe(line(WORK, 120));
  });
  it('at 80 columns, or 100 with 2 rows: one row, the buttons folded into ⋯ and × still there; ⋯ open brings them back (F-02)', () => {
    for (const l of [lay(80), lay(100, 2)]) expect(l).toMatchObject({ level: 'one', inline: ['dismiss'], second: [], more: true });
    expect(lay(80, 10, true, true).second).toEqual(['next-task', 'status', 'launch', 'roadmap']);
    expect(joinParts(lay(80).shown)).toBe('● 2/5 · T3 A very long tas… · 12m · 40% · ✎ 2 · ▲ decisión pendiente');
  });
  it('outside fullscreen at 160 columns: one row with the plain short buttons (F-15)', () => {
    expect(lay(160, 40, false)).toMatchObject({ level: 'one', plain: true, long: false, inline: all, second: [], more: false });
  });
  it('props that are not numbers lay out as 80 columns and 10 rows (Review Focus 2)', () => {
    expect(lay('x', null)).toEqual(lay(80, 10));
  });
});
