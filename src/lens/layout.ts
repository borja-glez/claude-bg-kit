// F-01, F-08, F-14: how the panel fits where the engine seats it: the pane's layout from its props, the cards that fit
// in its rows (the rest counted as «↓ N more»), the boxes of a long plan cut to two rows, and the rows to ask for.
// Pure: register.tsx and term.tsx use it.
import type { Block, Card, CardId } from './svg.js';
import type { CellState } from './view.js';

export interface PanelLayout {
  cols: number; rows: number | null; placement: 'dock' | 'inline';
  compact: boolean;   // inline, under 56 columns, or the engine outside fullscreen
  boxed: boolean;     // !compact
  focusAgent: string | null;   // props.view.agentId
}
/** Under this many columns a card goes without its frame. */
export const COMPACT_BELOW = 56;
/** The columns the pane asks for where it docks. */
export const DOCK_COLUMNS = 56;
/** The terminal width from which a pane docks beside a fullscreen transcript; under it `/lens` gives a photo. */
export const DOCK_MIN_COLUMNS = 110;
/** The fewest rows the pane asks for inline. */
export const PANE_ROWS_MIN = 6;
const MIN_COLUMNS = 20;
// The cells kept for the summary after a window of boxes («+42 ■ · 12 □» fits in sixteen columns).
const SUMMARY_CELLS = 8;
/** F-01: which cards go first when the rows run out; the last ones are left out first. */
export const CARD_PRIORITY: readonly CardId[] = ['now', 'tasks', 'execution', 'roadmap', 'agents', 'superpowers', 'todos', 'ccTasks', 'usage'];

type PaneProps = { bodyColumns?: unknown; placement?: unknown; scroll?: { bodyRows?: unknown } | null; view?: { agentId?: unknown } | null };

/** F-08: the pane's layout from its props and the viewport; props that are not what they should be give the minimum. */
export function panelLayout(props: PaneProps | null | undefined, viewport?: { isFullscreen?: boolean } | null): PanelLayout {
  const placement = props?.placement === 'inline' ? 'inline' : 'dock';
  const fallback: PanelLayout = { cols: MIN_COLUMNS, rows: null, placement, compact: true, boxed: false, focusAgent: null };
  try {
    const raw = Number(props?.bodyColumns);
    if (!Number.isFinite(raw) || raw <= 0) return fallback;
    const cols = Math.max(MIN_COLUMNS, Math.floor(raw));
    const bodyRows = Number(props?.scroll?.bodyRows);
    const rows = placement === 'inline' && Number.isFinite(bodyRows) && bodyRows > 0 ? Math.floor(bodyRows) : null;
    const compact = placement === 'inline' || cols < COMPACT_BELOW || viewport?.isFullscreen === false;
    const agent = props?.view?.agentId;
    return { cols, rows, placement, compact, boxed: !compact, focusAgent: typeof agent === 'string' && agent ? agent : null };
  } catch {
    return fallback;
  }
}

/** The cells a card's blocks have: a frame and its padding take 4, the indent of a card without one 2. */
export const innerWidth = (layout: PanelLayout): number => Math.max(6, layout.cols - (layout.boxed ? 4 : 2));
/** F-14: the most boxes two rows hold, each box taking two columns. */
export const cellsMax = (inner: number): number => 2 * Math.max(1, Math.floor(inner / 2));

/** F-14: a window of at most `max` boxes around the first active or pending one; the rest summed up by glyph. */
export function fitCells(cells: readonly CellState[], max: number): { cells: CellState[]; more: string | null } {
  const limit = Math.max(1, Math.floor(max));
  if (cells.length <= limit) return { cells: [...cells], more: null };
  const size = Math.max(1, limit - SUMMARY_CELLS);
  const first = cells.findIndex(c => c === 'active' || c === 'pending');
  const focus = first < 0 ? cells.length - size : first;
  const start = Math.max(0, Math.min(focus - 2, cells.length - size));
  const left = [...cells.slice(0, start), ...cells.slice(start + size)];
  const empty = left.filter(c => c === 'pending').length;
  const filled = left.length - empty;
  const counts = [filled ? `${filled} ■` : '', empty ? `${empty} □` : ''].filter(Boolean);
  return { cells: cells.slice(start, start + size), more: counts.length ? `+${counts.join(' · ')}` : null };
}

function blockRows(b: Block, inner: number): number {
  if (b.kind === 'bar') return b.label || b.right ? 2 : 1;
  if (b.kind === 'cells') return b.cells.length ? Math.min(2, Math.ceil((b.cells.length * 2) / Math.max(2, inner))) : 0;
  return 1;
}

/** F-01: the rows a card takes: its header, its subtitle, its blocks (a bar with a label two) and its frame. */
export function cardRows(card: Card, layout: PanelLayout): number {
  const inner = innerWidth(layout);
  return 1 + (card.subtitle ? 1 : 0) + (layout.boxed ? 2 : 0) + card.blocks.reduce((n, b) => n + blockRows(b, inner), 0);
}

/**
 * F-01: the cards that fit in the pane's rows, keeping one row for «↓ N more»: first the dim text blocks go (from the
 * last card up), then whole cards, the least important first (CARD_PRIORITY); at least one card stays. `hidden` is the
 * rows left out. Docked (rows null) nothing is cut; on any failure the cards come back untouched.
 */
export function fitCards(cards: Card[], layout: PanelLayout): { cards: Card[]; hidden: number } {
  try {
    if (layout.rows === null) return { cards, hidden: 0 };
    const total = (cs: readonly Card[]) => cs.reduce((n, c) => n + cardRows(c, layout), 0);
    const before = total(cards);
    if (before <= layout.rows) return { cards, hidden: 0 };
    const budget = Math.max(0, layout.rows - 1);
    const out = cards.map(c => ({ ...c, blocks: [...c.blocks] }));
    for (let i = out.length - 1; i >= 0 && total(out) > budget; i--) {
      out[i] = { ...out[i], blocks: out[i].blocks.filter(b => !(b.kind === 'text' && b.dim)) };
    }
    const rank = (c: Card) => { const k = c.id ? CARD_PRIORITY.indexOf(c.id) : -1; return k < 0 ? CARD_PRIORITY.length : k; };
    while (out.length > 1 && total(out) > budget) {
      let worst = 0;
      out.forEach((c, i) => { if (rank(c) >= rank(out[worst])) worst = i; });
      out.splice(worst, 1);
    }
    return { cards: out, hidden: Math.max(0, before - total(out)) };
  } catch {
    return { cards, hidden: 0 };
  }
}

/** F-01: the rows to ask for inline: the compact cards' rows and the «↓» one, between 6 and a third of the screen. */
export function paneRows(estimate: number, viewportRows: number | null): number {
  const third = Math.floor((viewportRows && viewportRows > 0 ? viewportRows : 24) / 3);
  const want = Number.isFinite(estimate) ? Math.ceil(estimate) + 1 : PANE_ROWS_MIN;
  return Math.max(PANE_ROWS_MIN, Math.min(want, third));
}
