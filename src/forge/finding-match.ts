import type { Finding } from './verdict.js';

// When two findings are the same one. The shadow trial pairs a twin's blockers with its high reviewer's (shadow.ts), and
// review-close gives a finding of a fix round the stable id of the open one it pairs with (findings-index.ts, J-06).
// Moved from shadow.ts without changing the rule.

export const LINE_WINDOW = 10;
export const OVERLAP = 0.3;

export const words = (s: string): Set<string> => new Set((s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(w => w.length >= 3));

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

const normPath = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '');

/** Same file within ±LINE_WINDOW lines. */
export function nearby(a: Finding, b: Finding): boolean {
  return !!a.file && !!b.file && normPath(a.file) === normPath(b.file)
    && Number.isFinite(a.line) && Number.isFinite(b.line) && Math.abs(a.line! - b.line!) <= LINE_WINDOW;
}

/** Problem word overlap (Jaccard over words of 3 letters or more) of at least OVERLAP. */
export const overlapping = (a: Finding, b: Finding): boolean => jaccard(words(a.problem), words(b.problem)) >= OVERLAP;

/** Same file within ±10 lines, or problem word overlap (Jaccard) >= 0.3. */
export const findingsMatch = (a: Finding, b: Finding): boolean => nearby(a, b) || overlapping(a, b);

/**
 * Pairs the findings of `a` with those of `b`, one to one: location pairs first (nearby), then word overlap, each finding
 * of `a` taking the first free one of `b` that matches. Returns, for each finding of `a`, the index of its pair in `b`, or -1.
 */
export function pairFindings(a: Finding[], b: Finding[]): number[] {
  const pairOf = new Array<number>(a.length).fill(-1);
  const used = new Set<number>();
  for (const test of [nearby, overlapping]) {
    a.forEach((x, i) => {
      if (pairOf[i] >= 0) return;
      const j = b.findIndex((y, k) => !used.has(k) && test(x, y));
      if (j >= 0) { pairOf[i] = j; used.add(j); }
    });
  }
  return pairOf;
}
