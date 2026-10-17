import { describe, it, expect } from 'vitest';
import { cardRows, cellsMax, fitCards, fitCells, innerWidth, panelLayout, paneRows } from '../src/lens/layout.js';
import type { Block, Card, CardId } from '../src/lens/svg.js';
import type { CellState } from '../src/lens/view.js';

const card = (id: CardId, blocks: Block[]): Card => ({ id, icon: '▸', title: id, hue: 'sky', blocks });
const row = (text: string): Block => ({ kind: 'row', dot: 'sky', text });
const dimText = (text: string): Block => ({ kind: 'text', text, dim: true });

describe('panelLayout (F-08)', () => {
  it('docked and wide: framed and uncut; inline: compact and cut to its rows; narrow or outside fullscreen: compact', () => {
    expect(panelLayout({ bodyColumns: 60, placement: 'dock', scroll: { bodyRows: 30 }, view: {} }))
      .toEqual({ cols: 60, rows: null, placement: 'dock', compact: false, boxed: true, focusAgent: null });
    expect(panelLayout({ bodyColumns: 80, placement: 'inline', scroll: { bodyRows: 8 }, view: {} })).toMatchObject({ rows: 8, compact: true, boxed: false });
    expect(panelLayout({ bodyColumns: 50, placement: 'dock', scroll: { bodyRows: 30 }, view: {} })).toMatchObject({ rows: null, compact: true });
    expect(panelLayout({ bodyColumns: 80, placement: 'dock', scroll: { bodyRows: 30 }, view: {} }, { isFullscreen: false })).toMatchObject({ compact: true });
    expect(panelLayout({ bodyColumns: 80, placement: 'dock', scroll: { bodyRows: 30 }, view: { agentId: 'a1' } }).focusAgent).toBe('a1');
  });
  it('props that are not what they should be give the minimum: 20 columns, compact, uncut (Review Focus 2)', () => {
    for (const junk of [{ bodyColumns: Number.NaN }, { bodyColumns: 'x' }, {}, null, undefined]) {
      expect(panelLayout(junk as never), JSON.stringify(junk)).toMatchObject({ cols: 20, rows: null, compact: true, boxed: false, focusAgent: null });
    }
  });
});

describe('cardRows, fitCards and paneRows (F-01)', () => {
  const INLINE = panelLayout({ bodyColumns: 60, placement: 'inline', scroll: { bodyRows: 8 } });
  const now = card('now', [row('Opus'), row('tool')]);
  const tasks = card('tasks', [row('T1'), row('T2'), dimText('a note')]);
  const usage = card('usage', [row('Main'), dimText('prices as of')]);
  it('a card takes its header, its subtitle, its blocks (a bar with a label two) and its frame', () => {
    expect(cardRows(now, INLINE)).toBe(3);
    expect(cardRows(now, panelLayout({ bodyColumns: 60, placement: 'dock' }))).toBe(5);
    expect(cardRows({ ...now, subtitle: 's', blocks: [{ kind: 'bar', ratio: 0.5, hue: 'sky', label: 'x' }] }, INLINE)).toBe(4);
  });
  it('inline it drops the dim texts first, then the least important cards, keeps a row for «↓» and counts the rows it left out', () => {
    expect(fitCards([now, tasks, usage], INLINE)).toEqual({ cards: [now, { ...tasks, blocks: [row('T1'), row('T2')] }], hidden: 4 });
  });
  it('docked nothing is cut, and a card it cannot measure leaves them all as they were', () => {
    const dock = panelLayout({ bodyColumns: 60, placement: 'dock', scroll: { bodyRows: 3 } });
    expect(fitCards([now, tasks, usage], dock)).toEqual({ cards: [now, tasks, usage], hidden: 0 });
    const broken = { ...usage, blocks: null } as unknown as Card;
    expect(fitCards([now, broken], INLINE)).toEqual({ cards: [now, broken], hidden: 0 });
  });
  it('asks for the rows its cards take and the «↓» one, between 6 and a third of the screen', () => {
    expect([paneRows(30, 60), paneRows(3, 60), paneRows(30, null), paneRows(30, 12)]).toEqual([20, 6, 8, 6]);
  });
});

describe('fitCells (F-14)', () => {
  it('74 cells at 40 columns take two rows at most, around the first active one, the rest counted by glyph', () => {
    const cells: CellState[] = [...Array<CellState>(40).fill('done'), 'active', ...Array<CellState>(33).fill('pending')];
    const fit = fitCells(cells, cellsMax(36));
    expect(fit.cells).toHaveLength(28);
    expect(fit.cells[2]).toBe('active');
    expect(fit.more).toBe('+38 ■ · 8 □');
    expect(Math.ceil((fit.cells.length * 2 + fit.more!.length + 1) / 36)).toBeLessThanOrEqual(2);
    expect(fitCells(cells.slice(0, 10), 36)).toEqual({ cells: cells.slice(0, 10), more: null });
    expect(innerWidth(panelLayout({ bodyColumns: 40, placement: 'dock' }))).toBe(38);
  });
});
