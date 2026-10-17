// F-04, F-05: a band as parts with a priority, fitted to the cells it has, and the level it is drawn at. Pure: waypoint's
// band, lens's band and lens's status line share it. Priority 1 is the most important, 9 the least.
import { clipWidth, stringWidth } from '../lib/text-width.js';

export type BandHue = 'accent' | 'warn' | 'alert' | 'dim';
/**
 * One part of a band's line. `short` is the form it takes when room runs out; `title`, the end of `text` that may be
 * clipped (down to TITLE_MIN cells) before `short` is used; `glue`, what joins it to the part before (SEP when absent).
 * A part keyed `slot:…` is one of several alike: those dropped are counted in one «+N» part, each as `count` (1 when
 * absent: a part that already stands for several, such as the slots a run band does not carry, counts as that many).
 */
export interface BandPart { key: string; text: string; short?: string; title?: string; prio: number; hue?: BandHue; glue?: string; count?: number }

export const SEP = ' · ';
export const TITLE_MIN = 8;
export const DEFAULT_COLUMNS = 80;
const SLOT = 'slot:';

/** The parts that take a cell: an empty or zero-width one adds no separator. */
const visible = (parts: readonly BandPart[]): BandPart[] => parts.filter(p => stringWidth(p.text) > 0);

/** The cells the parts take joined, each glued to the one before. */
export function partsWidth(parts: readonly BandPart[], sep = SEP): number {
  let width = 0;
  visible(parts).forEach((p, i) => { width += stringWidth(p.text) + (i ? stringWidth(p.glue ?? sep) : 0); });
  return width;
}

/** The parts joined as one line. */
export function joinParts(parts: readonly BandPart[], sep = SEP): string {
  return visible(parts).map((p, i) => `${i ? p.glue ?? sep : ''}${p.text}`).join('');
}

// A width that is not a finite number is no room at all (layoutBand is the one that defaults to DEFAULT_COLUMNS).
const columnsOf = (cols: unknown): number =>
  (typeof cols === 'number' && Number.isFinite(cols) ? Math.max(0, Math.floor(cols)) : 0);
/** A priority as a sort key: a NaN one is the least important (past 9). */
const prioKey = (p: BandPart): number => (Number.isNaN(p.prio) ? Number.POSITIVE_INFINITY : p.prio);

/**
 * F-04: the parts that fit in `cols` cells. (1) All of them, when they fit. (2) Else, from the least important (9) up,
 * and the later first within a priority, each part clips its title (down to TITLE_MIN cells) and then takes its short
 * form, until they fit. (3) Else parts are dropped in the same order; the `slot:` parts dropped are counted in a «+N»
 * part where the first of them was (E-04); the «+N» counts in the width, and when it alone does not fit nothing is
 * shown. Never more parts than it got, never a line wider than `cols`; a width that is not a finite number is 0.
 */
export function fitParts(parts: readonly BandPart[], cols: number, sep = SEP): { shown: BandPart[]; dropped: number } {
  const width = columnsOf(cols);
  const cur = parts.map(p => ({ ...p }));
  const gone = new Set<number>();
  const view = (): BandPart[] => {
    const out: BandPart[] = [];
    let more = 0;
    let at = -1;
    let after = false;
    cur.forEach((p, i) => {
      if (!gone.has(i)) {
        // A glue was meant for the part before; once that one is gone, the separator joins it to whatever is now there.
        out.push(after ? { ...p, glue: undefined } : p);
        after = false;
        return;
      }
      after = true;
      if (p.key.startsWith(SLOT)) {
        more += Number.isInteger(p.count) && p.count! > 0 ? p.count! : 1;
        if (at < 0) at = out.length;
      }
    });
    if (more) out.splice(at, 0, { key: 'more', text: `+${more}`, prio: 4 });
    return out;
  };
  const fits = () => partsWidth(view(), sep) <= width;
  const done = () => ({ shown: view(), dropped: gone.size });
  if (fits()) return done();
  const order = cur.map((_, i) => i).sort((a, b) => {
    const ka = prioKey(cur[a]);
    const kb = prioKey(cur[b]);
    return ka === kb ? b - a : kb > ka ? 1 : -1;
  });
  for (const i of order) {
    const p = cur[i];
    if (p.title && p.text.endsWith(p.title)) {
      const lead = p.text.slice(0, p.text.length - p.title.length);
      for (let w = stringWidth(p.title) - 1; w >= TITLE_MIN; w--) {
        cur[i] = { ...p, text: lead + clipWidth(p.title, w) };
        if (fits()) return done();
      }
    }
    if (p.short !== undefined && stringWidth(p.short) < stringWidth(cur[i].text)) {
      cur[i] = { ...cur[i], text: p.short };
      if (fits()) return done();
    }
  }
  for (const i of order) {
    gone.add(i);
    if (fits()) return done();
  }
  // Everything is gone and only the «+N» is left, and it does not fit either: no line at all.
  return { shown: [], dropped: gone.size };
}

export type BandLevel = 'wide' | 'two' | 'one';
export const WIDE_COLUMNS = 140;
export const TWO_COLUMNS = 90;
const ONE_ROW_BELOW = 3;

/**
 * F-05: wide (from 140 columns, with 3 rows or more and in fullscreen) draws the parts and the long buttons in one row;
 * two (from 90) the parts in one row and the short buttons in another; one (narrower, under 3 rows, or outside
 * fullscreen) a single row.
 */
export function bandLevel(o: { bodyColumns: number; maxRows: number; fullscreen: boolean }): BandLevel {
  if (!o.fullscreen || o.maxRows < ONE_ROW_BELOW || o.bodyColumns < TWO_COLUMNS) return 'one';
  return o.bodyColumns >= WIDE_COLUMNS ? 'wide' : 'two';
}

export type ControlKind = 'button' | 'link' | 'text';
/** A control of a band as the layout measures it: its long and short labels, its letter and what draws it. */
export interface BandControl { key: string; label: string; short?: string; hotkey?: string; kind?: ControlKind }

/** F-12: the cells a control takes: `[ label ]` w+4, plain «k: label» w+3 (w without a letter), a link or a text w. */
export function controlWidth(label: string, o: { plain: boolean; hotkey?: string; kind?: ControlKind }): number {
  const w = stringWidth(label);
  if (o.kind === 'link' || o.kind === 'text') return w;
  return o.plain ? w + (o.hotkey ? 3 : 0) : w + 4;
}

export const MORE_KEY = 'more';
export const MORE_LABEL = '⋯';
export const MORE_HOTKEY = 'm';
export const DISMISS_KEY = 'dismiss';

/**
 * How a band is drawn: its level, its parts, the controls on the parts' row and on a second row, whether ⋯ shows, and
 * the labels of the second row's controls clipped so that row fits (by key; a control not named keeps its label).
 */
export interface BandLayout { level: BandLevel; plain: boolean; long: boolean; shown: BandPart[]; inline: string[]; second: string[]; more: boolean; labels: Record<string, string> }

const positive = (v: unknown, fallback: number): number =>
  (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback);

/** The fewest cells a label of a crowded second row keeps, its «…» included. */
export const LABEL_MIN = 1;

/**
 * Carry 3: the labels of a second row's controls clipped so the row, one cell of gap between two controls, fits in `cols`
 * cells and never wraps onto a third: the widest label is cut first, to what the row needs or down to the next widest,
 * never under LABEL_MIN. A row that fits, or one that cannot even at the floor, keeps what it got that far; an empty map
 * when nothing was clipped.
 */
export function fitRow(controls: readonly BandControl[], cols: number, o: { plain: boolean; long: boolean }): Record<string, string> {
  const base = (c: BandControl) => (o.long ? c.label : c.short ?? c.label);
  const cur = controls.map(base);
  for (;;) {
    const widths = cur.map(label => stringWidth(label));
    const used = cur.reduce((n, label, i) => n + controlWidth(label, { plain: o.plain, hotkey: controls[i].hotkey, kind: controls[i].kind }), 0)
      + Math.max(0, controls.length - 1);
    const excess = used - cols;
    if (excess <= 0) break;
    let at = -1;
    widths.forEach((w, i) => { if (w > LABEL_MIN && (at < 0 || w > widths[at])) at = i; });
    if (at < 0) break;
    const next = Math.max(0, ...widths.filter((_, i) => i !== at));
    cur[at] = clipWidth(base(controls[at]), Math.min(widths[at] - 1, Math.max(LABEL_MIN, widths[at] - excess, next)));
  }
  const out: Record<string, string> = {};
  controls.forEach((c, i) => { if (cur[i] !== base(c)) out[c.key] = cur[i]; });
  return out;
}

/**
 * F-05: the band's layout. `lead` is what goes before the parts (an icon and its gap). wide falls back to two when the
 * parts of priority 1 to 4, whole, do not fit beside the long buttons; in one, the buttons fold into ⋯ (m) when those
 * parts, whole, do not fit beside the short ones, and come back on a second row while `moreOpen`. × always stays on the
 * parts' row. Each control takes one cell of gap before it. A second row is fitted to the width (fitRow), so the band
 * is never taller than its two rows.
 */
export function layoutBand(parts: readonly BandPart[], controls: readonly BandControl[], o: { bodyColumns: unknown; maxRows: unknown; fullscreen: boolean; moreOpen: boolean; lead?: number }): BandLayout {
  const cols = positive(o.bodyColumns, DEFAULT_COLUMNS);
  const maxRows = positive(o.maxRows, 10);
  const plain = !o.fullscreen;
  const lead = o.lead ?? 0;
  const width = (cs: readonly BandControl[], long: boolean) =>
    cs.reduce((n, c) => n + 1 + controlWidth(long ? c.label : c.short ?? c.label, { plain, hotkey: c.hotkey, kind: c.kind }), 0);
  const keys = (cs: readonly BandControl[]) => cs.map(c => c.key);
  const core = parts.filter(p => p.prio <= 4);
  let level = bandLevel({ bodyColumns: cols, maxRows, fullscreen: o.fullscreen });
  if (level === 'wide') {
    const room = cols - lead - width(controls, true);
    if (partsWidth(core) <= room) return { level, plain, long: true, shown: fitParts(parts, room).shown, inline: keys(controls), second: [], more: false, labels: {} };
    level = 'two';
  }
  if (level === 'two') {
    return { level, plain, long: false, shown: fitParts(parts, cols - lead).shown, inline: [], second: keys(controls), more: false, labels: fitRow(controls, cols, { plain, long: false }) };
  }
  const room = cols - lead - width(controls, false);
  if (partsWidth(core) <= room) return { level, plain, long: false, shown: fitParts(parts, room).shown, inline: keys(controls), second: [], more: false, labels: {} };
  const dismiss = controls.filter(c => c.key === DISMISS_KEY);
  const rest = controls.filter(c => c.key !== DISMISS_KEY);
  const folded = cols - lead - (1 + controlWidth(MORE_LABEL, { plain, hotkey: MORE_HOTKEY })) - width(dismiss, false);
  return {
    level, plain, long: false, shown: fitParts(parts, folded).shown, inline: keys(dismiss), second: o.moreOpen ? keys(rest) : [], more: true,
    labels: o.moreOpen ? fitRow(rest, cols, { plain, long: false }) : {},
  };
}
