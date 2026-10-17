import { describe, it, expect } from 'vitest';
import { bandLevel, controlWidth, fitParts, joinParts, layoutBand, partsWidth, type BandControl, type BandPart } from '../src/mod/band-fit.js';
import { stringWidth } from '../src/lib/text-width.js';
import { bandLine, bandParts } from '../src/mod/band-line.js';
import { NO_VIEWER, type BandModel } from '../src/mod/model.js';

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
  it('without a finite number of columns it has no room: nothing is shown (layoutBand is the one that defaults to 80)', () => {
    for (const cols of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) expect(fitParts(WORK, cols).shown, String(cols)).toEqual([]);
  });
});

describe('fitParts never returns a line wider than its cells (review fix)', () => {
  const slots3 = [1, 2, 3].map(i => P(`slot:T00${i}`, `T00${i} implementar`, 4, { short: `T00${i}` }));
  const tooWide = [P('a', 'aaaaaaaaaaaa', 3), P('b', 'bbbbbbbbbbbb', 5), P('c', 'cccccccccccc', 1)];
  const ties = [P('a', 'aaaa', 4, { short: 'a' }), P('b', 'bbbb', 4, { short: 'b' }), P('c', 'cccc', 4, { short: 'c' }), P('d', 'dddd', 4)];
  const run = [P('head', '► EJECUCIÓN · subagentes 3/3', 5, { short: '► 3/3' }), ...slots3, P('integrated', '3/12 integradas', 5, { short: '3/12' })];
  const sets: Record<string, BandPart[]> = { slots3, tooWide, ties, run, WORK };
  it('sweeps 0 to 6 columns and a few more over several sets', () => {
    for (const [name, parts] of Object.entries(sets)) {
      for (const cols of [0, 1, 2, 3, 4, 5, 6, 8, 12, 20, 40]) {
        const { shown } = fitParts(parts, cols);
        expect(stringWidth(joinParts(shown)), `${name} @ ${cols}`).toBeLessThanOrEqual(Math.max(0, cols));
        expect(partsWidth(shown), `${name} @ ${cols}`).toBeLessThanOrEqual(Math.max(0, cols));
      }
    }
  });
  it('the «+N» takes part in fitting: dropping more to make room for it, none when it alone does not fit', () => {
    expect(fitParts(slots3, 1).shown).toEqual([]);
    expect(fitParts(slots3, 0).shown).toEqual([]);
    expect(line(slots3, 2)).toBe('+3');
    expect(line(slots3, 8)).toBe('+3');
    expect(line(slots3, 9)).toBe('T001 · +2');
  });
  it('a short form is used only when it is narrower than the text', () => {
    const parts = [P('a', 'ab', 5, { short: 'abcdefghijkl' }), P('b', 'cdefghij', 4, { short: 'cd' })];
    expect(line(parts, 12)).toBe('ab · cd');
  });
  it('an empty or zero-width part adds no separator', () => {
    const zero = String.fromCharCode(0x200b);
    const parts = [P('a', 'a', 3), P('e', '', 5), P('z', zero, 5), P('b', 'b', 4)];
    expect(joinParts(parts)).toBe('a · b');
    expect(partsWidth(parts)).toBe(5);
    expect(line(parts, 80)).toBe('a · b');
  });
  it('the part after a «+N» (or after a dropped part) does not keep a glue meant for another neighbour', () => {
    const parts = [P('slot:1', 'T001 implementar', 9), P('slot:2', 'T002 implementar', 9), P('task', 'T019', 4, { glue: ' ' })];
    expect(line(parts, 9)).toBe('+2 · T019');
  });
  it('a NaN priority sorts as the least important, the same way every time', () => {
    const parts = [P('a', 'aaaa', Number.NaN), P('b', 'bbbb', 2), P('c', 'cccc', 3)];
    expect(line(parts, 12)).toBe('bbbb · cccc');
    expect(line([...parts].reverse(), 12)).toBe('cccc · bbbb');
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

describe('bandParts (F-04, F-09, F-10, F-11, the notice band)', () => {
  const NOW = Date.parse('2026-10-11T10:12:30.000Z');
  const RUN = (over: object = {}): BandModel => ({
    mode: 'run', project: 'demo', locale: 'es', executor: 'subagents', running: 2, parallel: 3, integrated: 3, queued: 0, total: 12,
    slots: [{ task: 'T004', stage: 'review', round: 2 }, { task: 'T008', stage: 'implement', round: 1 }], worst: 'alive', stalled: false, roadmapUrl: null,
    sid: 'main', inbox: 0, escalation: false, percent: 25, phase: null, viewer: NO_VIEWER, ...over,
  }) as BandModel;
  const WORKM = (over: object = {}): BandModel => ({
    mode: 'work', project: 'demo', locale: 'es', sid: 'main', track: 'core', roadmapUrl: null,
    current: { id: 'T3', title: 'Esquema', startedAt: new Date(NOW - 598 * 60_000).toISOString(), estimateMin: 30 },
    trackDone: 2, trackTotal: 5, percent: 40, inbox: 2, escalation: true, phase: null, cells: '', swarm: false, run: null, viewer: NO_VIEWER, ...over,
  }) as BandModel;
  const NOTICE = (over: object = {}): BandModel => ({
    mode: 'notice', project: 'demo', locale: 'es', kind: 'previous', subject: 'task', seat: 'main', task: 'T019',
    title: 'Reparto de pedidos con un título bastante más largo', since: new Date(NOW - 2 * 3600_000).toISOString(), runId: null, roadmapUrl: null,
    key: 'task:T019', viewer: NO_VIEWER, ...over,
  }) as BandModel;
  it('the run says its integrated tasks once, «3/12 integradas», and those waiting to integrate apart (F-10)', () => {
    expect(bandLine(RUN(), NOW)).toBe('► EJECUCIÓN · subagentes 2/3 · T004 revisar (r2) · T008 implementar · 3/12 integradas');
    expect(bandParts(RUN(), NOW).filter(p => p.text.includes('/12'))).toHaveLength(1);
    expect(bandParts(RUN({ queued: 2 }), NOW).find(p => p.key === 'queued')).toMatchObject({ text: 'por integrar 2', prio: 8 });
  });
  it('every slot is a part of priority 4 with its short form; at 80 columns those that do not fit are «+N» (E-04, F-09)', () => {
    const slots = Array.from({ length: 8 }, (_, i) => ({ task: `T00${i + 1}`, stage: 'implement', round: 1 }));
    const run = RUN({ running: 8, parallel: 8, slots });
    expect(bandParts(run, NOW).filter(p => p.key.startsWith('slot:')).map(p => [p.prio, p.short])).toEqual(slots.map(s => [4, `${s.task} impl`]));
    expect(joinParts(fitParts(bandParts(run, NOW), 80).shown)).toBe('T001 impl · T002 impl · T003 impl · T004 impl · T005 impl · T006 impl · +2');
  });
  it('598 minutes against an estimate of 30 read «9 h 58 m / 30 m», in amber (F-11)', () => {
    expect(bandParts(WORKM(), NOW).find(p => p.key === 'minutes')).toEqual({ key: 'minutes', text: '9 h 58 m / 30 m', short: '9h58m', prio: 6, hue: 'warn' });
  });
  it('the parts of a work band carry the priorities of the spec', () => {
    const parts = bandParts(WORKM(), NOW);
    expect(parts.map(p => [p.key, p.prio])).toEqual([['progress', 5], ['task', 4], ['minutes', 6], ['percent', 7], ['inbox', 3], ['decision', 1]]);
    expect(parts.find(p => p.key === 'decision')).toMatchObject({ text: '▲ decisión pendiente', short: '▲ decisión', hue: 'alert' });
  });
  it('a notice of a task left behind: the notice (2), the task and its title (4) and how long ago (7), all dim; at 16 columns the age goes before the task', () => {
    const parts = bandParts(NOTICE(), NOW);
    expect(parts.map(p => [p.key, p.prio, p.hue])).toEqual([['notice', 2, 'dim'], ['task', 4, 'dim'], ['ago', 7, 'dim']]);
    expect(bandLine(NOTICE(), NOW)).toBe('◌ quedó a medias: T019 Reparto de pedidos con un título bastan… · hace 2 h');
    expect(fitParts(parts, 16).shown.map(p => p.key)).toEqual(['notice', 'task']);
    expect(joinParts(fitParts(parts, 16).shown)).toBe('◌ a medias T019');
  });
});
