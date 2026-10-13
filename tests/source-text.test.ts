import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
// Invisible characters in source text hide what the code says: the bidi controls (U+202A to U+202E, U+2066 to U+2069),
// the BOM (U+FEFF) and the zero-width ones (U+200B to U+200F). Built from code points, so this file never holds them.
const cp = (n: number) => String.fromCharCode(n);
const INVISIBLE = new RegExp(`[${cp(0x202a)}-${cp(0x202e)}${cp(0x2066)}-${cp(0x2069)}${cp(0xfeff)}${cp(0x200b)}-${cp(0x200f)}]`);
function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('source text', () => {
  it('has no raw invisible characters (bidi controls, BOM, zero-width)', () => {
    const hits = ['src', 'tests', 'plugins/lens/tests', 'plugins/waypoint/tests']
      .flatMap(d => files(path.join(ROOT, d)))
      .filter(f => INVISIBLE.test(readFileSync(f, 'utf8')))
      .map(f => path.relative(ROOT, f).split(path.sep).join('/'));
    expect(hits).toEqual([]);
  });
});
