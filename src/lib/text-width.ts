// F-13: how many terminal cells a text takes, by code point: 0 for controls, combining marks, the zero-width
// characters and the variation selectors (VS16 widens the glyph before it to 2), 2 for the East Asian wide and
// fullwidth ranges and the emoji drawn as emoji by default, 1 for the rest. A table of ranges rather than \p{…}: a mod's
// runtime may lack them. The engine exports no measure of its own. Pure: both bands, the panel and the status line use it.

type Range = readonly [number, number];

// Sorted: within() stops at the first range past the code point.
const ZERO: readonly Range[] = [
  [0x0300, 0x036f], [0x1ab0, 0x1aff], [0x200b, 0x200f], [0x20d0, 0x20ff], [0xfe00, 0xfe0f],
];
const WIDE: readonly Range[] = [
  [0x1100, 0x115f], [0x231a, 0x231b], [0x23e9, 0x23ec], [0x23f0, 0x23f0], [0x23f3, 0x23f3], [0x25fd, 0x25fe],
  [0x2614, 0x2615], [0x2648, 0x2653], [0x267f, 0x267f], [0x2693, 0x2693], [0x26a1, 0x26a1], [0x26aa, 0x26ab],
  [0x26bd, 0x26be], [0x26c4, 0x26c5], [0x26ce, 0x26ce], [0x26d4, 0x26d4], [0x26ea, 0x26ea], [0x26f2, 0x26f3],
  [0x26f5, 0x26f5], [0x26fa, 0x26fa], [0x26fd, 0x26fd], [0x2705, 0x2705], [0x270a, 0x270b], [0x2728, 0x2728],
  [0x274c, 0x274c], [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797], [0x27b0, 0x27b0],
  [0x27bf, 0x27bf], [0x2b1b, 0x2b1c], [0x2b50, 0x2b50], [0x2b55, 0x2b55],
  [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf], [0xac00, 0xd7a3],
  [0xf900, 0xfaff], [0xfe30, 0xfe4f], [0xff00, 0xff60], [0xffe0, 0xffe6],
  [0x1f004, 0x1f004], [0x1f0cf, 0x1f0cf], [0x1f18e, 0x1f18e], [0x1f191, 0x1f19a], [0x1f1e6, 0x1f1ff], [0x1f200, 0x1f2ff],
  [0x1f300, 0x1faff], [0x20000, 0x3fffd],
];
const VS16 = 0xfe0f;

function within(cp: number, ranges: readonly Range[]): boolean {
  for (const [lo, hi] of ranges) {
    if (cp < lo) return false;
    if (cp <= hi) return true;
  }
  return false;
}

/** The cells one code point takes, before any VS16 after it. */
export function charWidth(cp: number): number {
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (within(cp, ZERO)) return 0;
  return within(cp, WIDE) ? 2 : 1;
}

/** The cells `text` takes on a terminal. */
export function stringWidth(text: string): number {
  let width = 0;
  let last = 0;
  for (const ch of String(text)) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === VS16) {
      if (last === 1) { width += 1; last = 2; }
      continue;
    }
    const cells = charWidth(cp);
    width += cells;
    if (cells > 0) last = cells;
  }
  return width;
}

/** `text` cut to at most `max` cells, an ellipsis (one cell) marking the cut; whole when it fits, '' under one cell. */
export function clipWidth(text: string, max: number): string {
  const s = String(text);
  if (stringWidth(s) <= max) return s;
  if (!(max >= 1)) return '';
  let out = '';
  let used = 0;
  for (const ch of s) {
    const cells = stringWidth(ch);
    if (used + cells > max - 1) break;
    out += ch;
    used += cells;
  }
  return `${out}…`;
}
