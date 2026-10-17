// F-13: how many terminal cells a text takes, by grapheme cluster: 0 for a cluster of only controls, combining marks,
// zero-width or format characters and variation selectors; 2 for one holding an East Asian wide or fullwidth character, an
// emoji drawn as emoji by default, a VS16, or a ZWJ sequence or flag (which take their parts as one glyph); 1 for the rest.
// Clusters come from Intl.Segmenter when the runtime has it, else from splitClusters(). The engine exports no measure of
// its own. Pure: the band's clip() (src/mod/band-line.ts, which lens shares) uses it.

type Range = readonly [number, number];

const ZERO = /[\p{Mn}\p{Me}\p{Cf}]/u;
// Sorted: within() stops at the first range past the code point.
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
const ZWJ = 0x200d;

function within(cp: number, ranges: readonly Range[]): boolean {
  for (const [lo, hi] of ranges) {
    if (cp < lo) return false;
    if (cp <= hi) return true;
  }
  return false;
}

/** The cells one code point takes alone. */
export function charWidth(cp: number): number {
  if (cp < 0x7f) return cp < 0x20 ? 0 : 1;
  if (cp < 0xa0) return 0;
  if (ZERO.test(String.fromCodePoint(cp))) return 0;
  return within(cp, WIDE) ? 2 : 1;
}

const isRegional = (cp: number) => cp >= 0x1f1e6 && cp <= 0x1f1ff;
const isTone = (cp: number) => cp >= 0x1f3fb && cp <= 0x1f3ff;

/** The grapheme clusters of `text` without Intl.Segmenter: what follows a base (VS15/VS16, marks, tags, skin tones, a ZWJ and the code point after it) stays with it, and so does the second regional indicator of a pair. */
export function splitClusters(text: string): string[] {
  const out: string[] = [];
  let joined = false;
  let regionals = 0; // regional indicators in the current cluster
  for (const ch of String(text)) {
    const cp = ch.codePointAt(0) ?? 0;
    const sticks = out.length > 0 && ((joined && /\p{Extended_Pictographic}/u.test(ch)) || cp === ZWJ || isTone(cp) || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0020 && cp <= 0xe007f)
      || (cp >= 0xa0 && /[\p{Mn}\p{Me}]/u.test(ch)) || (isRegional(cp) && regionals === 1));
    if (sticks) out[out.length - 1] += ch;
    else { out.push(ch); regionals = 0; }
    if (isRegional(cp)) regionals += 1;
    joined = cp === ZWJ;
  }
  return out;
}

const segmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

function clustersOf(text: string): string[] {
  const s = String(text);
  return segmenter ? Array.from(segmenter.segment(s), part => part.segment) : splitClusters(s);
}

/** The cells one cluster takes. */
function clusterWidth(cluster: string): number {
  let widest = 0;
  for (const ch of cluster) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === VS16) { if (widest > 0) return 2; continue; }
    widest = Math.max(widest, charWidth(cp));
  }
  return widest;
}

/** The cells `text` takes on a terminal. */
export function stringWidth(text: string): number {
  let width = 0;
  for (const cluster of clustersOf(text)) width += clusterWidth(cluster);
  return width;
}

/** `text` cut to at most `max` cells, an ellipsis (one cell) marking the cut, never inside a cluster; whole when it fits, '' under one cell. */
export function clipWidth(text: string, max: number): string {
  const s = String(text);
  if (stringWidth(s) <= max) return s;
  if (!(max >= 1)) return '';
  let out = '';
  let used = 0;
  for (const cluster of clustersOf(s)) {
    const cells = clusterWidth(cluster);
    if (used + cells > max - 1) break;
    out += cluster;
    used += cells;
  }
  return `${out}…`;
}
