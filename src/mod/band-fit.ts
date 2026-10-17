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
 * How a band is drawn: its level, its parts, the controls on the parts' row and on a second row, whether ⋯ shows, the
 * labels of the second row's controls clipped so that row fits (by key; a control not named keeps its label), and how
 * many pages ⋯ opens one after another (1 when its row holds every folded button).
 */
export interface BandLayout {
  level: BandLevel; plain: boolean; long: boolean; shown: BandPart[]; inline: string[]; second: string[]; more: boolean;
  labels: Record<string, string>; pages: number;
}

const positive = (v: unknown, fallback: number): number =>
  (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback);

/** The fewest cells a label of a crowded second row keeps, its «…» included. */
export const LABEL_MIN = 1;

/** The lines a row of controls of these widths takes at `cols` cells, wrapped as the engine wraps it: a cell of gap between two. */
export function rowLines(widths: readonly number[], cols: number): number {
  let lines = 0;
  let used = 0;
  for (const w of widths) {
    if (lines && used + 1 + w <= cols) used += 1 + w;
    else { lines++; used = w; }
  }
  return lines;
}

/** What a control shows: outside fullscreen a button with a letter reads «k: label»; a link, a text or a button in fullscreen its label. */
const visibleOf = (c: BandControl, label: string, plain: boolean): string =>
  (plain && c.hotkey && c.kind !== 'link' && c.kind !== 'text' ? `${c.hotkey}: ${label}` : label);

/**
 * Carry 3, re-review m-2: the labels of a row of controls clipped so the row fits in `cols` cells on at most `o.lines`
 * lines (its wrap included), or null when it cannot. The widest label is cut first, to the longest form that makes the
 * row fit or down to the next widest, never under LABEL_MIN; a cut that would show two controls the same is made a cell
 * longer until it does not, and one that cannot be is not made. An empty map when nothing was clipped.
 */
export function fitRow(controls: readonly BandControl[], cols: number, o: { plain: boolean; long: boolean; lines?: number }): Record<string, string> | null {
  const lines = Math.max(1, Math.floor(o.lines ?? 1));
  const base = (c: BandControl) => (o.long ? c.label : c.short ?? c.label);
  const forms = controls.map(c => formsOf(base(c)));
  // The cells asked of each label (its full width to start with); its form and the cells its control takes then.
  const asked = forms.map(f => f.forms.length - 1);
  const labelAt = (i: number, t = asked[i]) => forms[i].forms[t];
  const cellsAt = (i: number, t = asked[i]) => {
    const c = controls[i];
    const w = forms[i].cells[t];
    return c.kind === 'link' || c.kind === 'text' ? w : o.plain ? w + (c.hotkey ? 3 : 0) : w + 4;
  };
  const linesWith = (i: number, t: number) => rowLines(controls.map((_, j) => (j === i ? cellsAt(j, t) : cellsAt(j))), cols);
  const unique = (i: number, t: number) => {
    const seen = visibleOf(controls[i], labelAt(i, t), o.plain);
    return controls.every((c, j) => j === i || visibleOf(c, labelAt(j), o.plain) !== seen);
  };
  while (rowLines(controls.map((_, j) => cellsAt(j)), cols) > lines) {
    const order = controls.map((_, i) => i).filter(i => forms[i].cells[asked[i]] > LABEL_MIN)
      .sort((a, b) => forms[b].cells[asked[b]] - forms[a].cells[asked[a]] || a - b);
    let cut = false;
    for (const i of order) {
      const w = forms[i].cells[asked[i]];
      // Down to the next widest, or a cell at a time while another is as wide: the labels are evened from the top.
      const others = controls.map((_, j) => forms[j].cells[asked[j]]).filter((_, j) => j !== i);
      const floor = Math.max(LABEL_MIN, others.some(x => x === w) ? w - 1 : Math.max(0, ...others.filter(x => x < w)));
      let chosen = -1;
      for (let t = Math.min(asked[i], w) - 1; t >= floor; t--) {
        if (labelAt(i, t) === labelAt(i) || !unique(i, t)) continue;
        chosen = t;
        if (linesWith(i, t) <= lines) break;
      }
      if (chosen < 0) continue;
      asked[i] = chosen;
      cut = true;
      break;
    }
    if (!cut) return null;
  }
  const out: Record<string, string> = {};
  controls.forEach((c, i) => { if (labelAt(i) !== base(c)) out[c.key] = labelAt(i); });
  return out;
}

// The forms a label takes clipped to 0, 1, 2… cells (index: the cells asked) and the cells each takes, kept per label:
// the band asks again for the same few labels at every drawing. At most FORMS_MAX labels are kept.
const FORMS = new Map<string, { forms: string[]; cells: number[] }>();
const FORMS_MAX = 500;
function formsOf(label: string): { forms: string[]; cells: number[] } {
  let hit = FORMS.get(label);
  if (!hit) {
    const full = stringWidth(label);
    const forms: string[] = [];
    const cells: number[] = [];
    for (let t = 0; t <= full; t++) {
      const form = t >= full ? label : clipWidth(label, t);
      forms.push(form);
      cells.push(stringWidth(form));
    }
    hit = { forms, cells };
    if (FORMS.size >= FORMS_MAX) FORMS.clear();
    FORMS.set(label, hit);
  }
  return hit;
}

/**
 * Re-review m-2: the folded buttons on the pages ⋯ opens one after another: each page as many of them as fit their row
 * with labels all told apart, in their order, so the less important fold onto a later page. A button alone that cannot
 * fit is clipped to the floor on a page of its own.
 */
export function pageRow(controls: readonly BandControl[], cols: number, o: { plain: boolean; long: boolean; lines?: number }): { pages: string[][]; labels: Record<string, string> } {
  const pages: string[][] = [];
  const labels: Record<string, string> = {};
  let rest = [...controls];
  while (rest.length) {
    // All of them most of the time; else the most that fit, found by halves (fewer always fit when more do).
    let n = rest.length;
    let fit = fitRow(rest, cols, o);
    if (fit === null) {
      let lo = 1;
      let hi = rest.length - 1;
      n = 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const tried = fitRow(rest.slice(0, mid), cols, o);
        if (tried === null) hi = mid - 1;
        else { fit = tried; n = mid; lo = mid + 1; }
      }
    }
    const page = rest.slice(0, n);
    if (fit === null) {
      const only = page[0];
      const label = o.long ? only.label : only.short ?? only.label;
      fit = stringWidth(label) > LABEL_MIN ? { [only.key]: clipWidth(label, LABEL_MIN) } : {};
    }
    pages.push(page.map(c => c.key));
    Object.assign(labels, fit);
    rest = rest.slice(n);
  }
  return { pages, labels };
}

/**
 * F-05: the band's layout. `lead` is what goes before the parts (an icon and its gap). wide falls back to two when the
 * parts of priority 1 to 4, whole, do not fit beside the long buttons; in one, the buttons fold into ⋯ (m) when those
 * parts, whole, do not fit beside the short ones, and come back on a second row while `moreOpen`. × always stays on the
 * parts' row. Each control takes one cell of gap before it. A second row is fitted to the width (fitRow): with 3 rows or
 * more it may take a second line before a label is clipped, and its labels always tell the controls apart; at level two
 * a row that cannot folds into ⋯, and the ⋯ row puts what does not fit on its next page (`page`, from 0).
 */
export function layoutBand(parts: readonly BandPart[], controls: readonly BandControl[], o: { bodyColumns: unknown; maxRows: unknown; fullscreen: boolean; moreOpen: boolean; page?: number; lead?: number }): BandLayout {
  const cols = positive(o.bodyColumns, DEFAULT_COLUMNS);
  const maxRows = positive(o.maxRows, 10);
  const plain = !o.fullscreen;
  const lead = o.lead ?? 0;
  // Re-review m-2: the second row takes two lines where the band has three rows or more, one otherwise.
  const lines = maxRows >= ONE_ROW_BELOW ? 2 : 1;
  const width = (cs: readonly BandControl[], long: boolean) =>
    cs.reduce((n, c) => n + 1 + controlWidth(long ? c.label : c.short ?? c.label, { plain, hotkey: c.hotkey, kind: c.kind }), 0);
  const keys = (cs: readonly BandControl[]) => cs.map(c => c.key);
  const core = parts.filter(p => p.prio <= 4);
  let level = bandLevel({ bodyColumns: cols, maxRows, fullscreen: o.fullscreen });
  if (level === 'wide') {
    const room = cols - lead - width(controls, true);
    if (partsWidth(core) <= room) return { level, plain, long: true, shown: fitParts(parts, room).shown, inline: keys(controls), second: [], more: false, labels: {}, pages: 1 };
    level = 'two';
  }
  if (level === 'two') {
    const labels = fitRow(controls, cols, { plain, long: false, lines });
    if (labels) return { level, plain, long: false, shown: fitParts(parts, cols - lead).shown, inline: [], second: keys(controls), more: false, labels, pages: 1 };
    level = 'one';
  }
  const room = cols - lead - width(controls, false);
  if (partsWidth(core) <= room) return { level, plain, long: false, shown: fitParts(parts, room).shown, inline: keys(controls), second: [], more: false, labels: {}, pages: 1 };
  const dismiss = controls.filter(c => c.key === DISMISS_KEY);
  const rest = controls.filter(c => c.key !== DISMISS_KEY);
  const folded = cols - lead - (1 + controlWidth(MORE_LABEL, { plain, hotkey: MORE_HOTKEY })) - width(dismiss, false);
  const paged = pageRow(rest, cols, { plain, long: false, lines });
  const page = paged.pages[Math.min(paged.pages.length - 1, Math.max(0, Math.floor(Number(o.page) || 0)))] ?? [];
  return {
    level, plain, long: false, shown: fitParts(parts, folded).shown, inline: keys(dismiss), second: o.moreOpen ? page : [], more: true,
    labels: o.moreOpen ? Object.fromEntries(Object.entries(paged.labels).filter(([k]) => page.includes(k))) : {}, pages: Math.max(1, paged.pages.length),
  };
}
