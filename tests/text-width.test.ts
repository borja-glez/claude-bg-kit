import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { charWidth, clipWidth, stringWidth } from '../src/lib/text-width.js';
import { GLYPHS } from '../src/lens/view.js';

// Invisible characters are built from their code points, so this file never holds them raw.
const cc = (...n: number[]) => String.fromCharCode(...n);
const ZWJ = cc(0x200d);
const VS16 = cc(0xfe0f);
const ACUTE = cc(0x0301);

// The reference the spec asks for, from Node's own Unicode properties: marks, controls and format characters take no
// cell, nor do the variation selectors; Emoji_Presentation and the CJK blocks take two; VS16 widens the glyph before it.
function reference(text: string): number {
  let width = 0;
  let last = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code === 0xfe0f) { if (last === 1) { width += 1; last = 2; } continue; }
    const cells = /[\p{Mn}\p{Me}\p{Cc}\p{Cf}]/u.test(ch) || (code >= 0xfe00 && code <= 0xfe0f) ? 0
      : /\p{Emoji_Presentation}/u.test(ch) || /[\u{1100}-\u{115F}\u{2E80}-\u{303E}\u{3041}-\u{33FF}\u{3400}-\u{4DBF}\u{4E00}-\u{9FFF}\u{AC00}-\u{D7A3}\u{FF00}-\u{FF60}]/u.test(ch) ? 2 : 1;
    width += cells;
    if (cells) last = cells;
  }
  return width;
}

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('stringWidth and clipWidth (F-13)', () => {
  it('agrees with the reference on wide, combining, joined and widened text', () => {
    const samples = ['T001 Esquema', '漢字', '👍', '✓', 'é', `e${ACUTE}`, `a${ZWJ}b`, `👩${ZWJ}💻`, `✓${VS16}`, `☺${VS16}`, 'Ａｂ', 'ok · …', '●◆▲✎◷►'];
    for (const s of samples) expect(stringWidth(s), JSON.stringify(s)).toBe(reference(s));
    expect(stringWidth('漢字')).toBe(4);
    expect(stringWidth('👍')).toBe(2);
    expect(stringWidth(`e${ACUTE}`)).toBe(1);
    expect(stringWidth(`✓${VS16}`)).toBe(2);
  });
  it('one code point: controls and zero-width ones take none, emoji two, the rest one', () => {
    expect([charWidth(0x07), charWidth(0x200b), charWidth(0x41), charWidth(0x25b2), charWidth(0x1f44d), charWidth(0x4e00)]).toEqual([0, 0, 1, 1, 2, 2]);
  });
  it('cuts by cells, the ellipsis taking one, and never splits a wide glyph', () => {
    expect(clipWidth('abcdef', 4)).toBe('abc…');
    expect(clipWidth('abc', 3)).toBe('abc');
    expect(clipWidth('漢字かな', 5)).toBe('漢字…');
    expect(clipWidth('漢字かな', 4)).toBe('漢…');
    expect(clipWidth('abc', 1)).toBe('…');
    expect(clipWidth('abc', 0)).toBe('');
  });
});

describe('the glyphs of the band and the panel (F-13)', () => {
  it('no character under src/mod or src/lens has an emoji form, comments included', () => {
    const hits: string[] = [];
    for (const f of [...sources('src/mod'), ...sources('src/lens')]) {
      for (const ch of new Set(readFileSync(f, 'utf8'))) {
        const code = ch.codePointAt(0)!;
        if (code > 0x7f && (/\p{Emoji}/u.test(ch) || /\p{Extended_Pictographic}/u.test(ch))) hits.push(`${f.split(path.sep).join('/')}: U+${code.toString(16)}`);
      }
    }
    expect(hits).toEqual([]);
  });
  it('every glyph in GLYPHS takes one cell and has no emoji form', () => {
    for (const g of ['▲', '✎', '◷', '►', '⋯', '◦', '◌']) expect(GLYPHS).toContain(g);
    for (const g of GLYPHS) {
      expect(stringWidth(g), g).toBe(1);
      expect(/\p{Emoji}|\p{Extended_Pictographic}/u.test(g), g).toBe(false);
    }
  });
});
