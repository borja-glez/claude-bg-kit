import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// WCAG 2 contrast between two #rrggbb colors.
const channels = (hex: string) => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`not a #rrggbb color: ${hex}`);
  return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255);
};
const luminance = (hex: string) => {
  const [r, g, b] = channels(hex).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const tokensOf = (block: string) => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;}]+)/g)].map(m => [m[1], m[2].trim()]));
/** A token's color, following `var(--other)` references. */
const resolve = (tokens: Record<string, string>, name: string): string => {
  let v = tokens[name];
  for (let i = 0; i < 5 && v !== undefined; i++) {
    const m = /^var\(--([\w-]+)\)$/.exec(v);
    if (!m) return v;
    v = tokens[m[1]];
  }
  return v;
};
const TEXT = ['mute', 't-peach', 't-yellow', 't-green', 't-blue', 't-lav', 't-teal', 't-red', 't-mauve', 't-pink', 'sub0', 'sub1', 'text'];
// Per file: its text tokens, the text-on-fill tokens it must define as plain colours in light, and a rule that must be among the pairs checked.
// The roadmap (4c) also writes sapphire (done tasks, ideas), sky and flamingo (tracks) as text: three tokens more, and its fills (buttons, chips,
// the badge, the now label, the run pill) take their own `--on-*` text colour.
const FILES: Record<string, { tokens: readonly string[]; onFill: readonly string[]; rule: string }> = {
  'src/design-page/theme.css': { tokens: TEXT, onFill: ['on-peach'], rule: '.cp' },
  'src/page/theme.css': {
    tokens: [...TEXT, 't-sapphire', 't-sky', 't-flamingo'],
    onFill: ['on-lav', 'on-peach', 'on-red', 'on-teal', 'on-yellow'],
    rule: '.btn.pri',
  },
};

const themesOf = (css: string) => {
  const dark = tokensOf(/^:root\{([^}]*)\}/m.exec(css)?.[1] ?? '');
  const forced = tokensOf(/:root\[data-theme="light"\]\{([^}]*)\}/.exec(css)?.[1] ?? '');
  const preferred = tokensOf(/@media \(prefers-color-scheme: light\)\{:root:not\(\[data-theme="dark"\]\)\{([^}]*)\}\}/.exec(css)?.[1] ?? '');
  return { dark, forced, preferred };
};
// A light block lists only what differs from :root, so an alias there (--done, --cur, --blk, --now) resolves through the light palette.
const R = (tokens: Record<string, string>, name: string, base: Record<string, string> = {}) => resolve({ ...base, ...tokens }, name);

describe('text tokens reach 4.5:1 on --base and --mantle in both themes (K3-11, H-19)', () => {
  for (const [file, { tokens, onFill, rule }] of Object.entries(FILES)) {
    const css = readFileSync(path.join(process.cwd(), file), 'utf8');
    const { dark, forced, preferred } = themesOf(css);
    it(`${file} light`, () => {
      for (const t of [...tokens, ...onFill]) {
        expect(forced[t], `${file} [data-theme=light] --${t}`).toMatch(/^#[0-9a-f]{6}$/i);
        expect(preferred[t], `${file} prefers-color-scheme: light --${t}`).toBe(forced[t]);
      }
      for (const t of tokens) for (const bg of ['base', 'mantle']) expect(contrast(forced[t], forced[bg]), `--${t} on --${bg}`).toBeGreaterThanOrEqual(4.5);
    });
    it(`${file} dark`, () => {
      for (const t of tokens) for (const bg of ['base', 'mantle']) expect(contrast(R(dark, t), R(dark, bg)), `dark --${t} on --${bg}`).toBeGreaterThanOrEqual(4.5);
    });
    it(`${file}: every rule that sets a text color and a fill reaches 4.5:1 in both themes (buttons, chips)`, () => {
      const pairs: [string, string, string][] = [];
      for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const fg = /(?:^|[;\s])color:var\(--([\w-]+)\)/.exec(m[2])?.[1];
        const bg = /(?:^|[;\s])background:var\(--([\w-]+)\)/.exec(m[2])?.[1];
        if (fg && bg) pairs.push([m[1].trim(), fg, bg]);
      }
      expect(pairs.map(p => p[0])).toContain(rule);
      for (const [sel, fg, bg] of pairs) {
        expect(contrast(R(dark, fg), R(dark, bg)), `dark ${sel}: --${fg} on --${bg}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(R(forced, fg, dark), R(forced, bg, dark)), `light ${sel}: --${fg} on --${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    });
    // Final carry 6: text on a surface other than --base and --mantle (inline code on --s0, a card on --crust) does not
    // inherit a colour checked only against those two: the rule that writes text there names its colour, which the pairs
    // above then check.
    it(`${file}: a rule that writes text over --crust, --s0 or --s1 names its text colour`, () => {
      for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (!/(?:^|[;\s])background:var\(--(?:crust|s0|s1)\)/.test(m[2]) || !/(?:^|[;\s])font(?:-size)?:/.test(m[2])) continue;
        expect(m[2], m[1].trim()).toMatch(/(?:^|[;\s])color:var\(--[\w-]+\)/);
      }
    });
  }
});
