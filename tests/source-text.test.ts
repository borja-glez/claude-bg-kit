import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
// Invisible bidi controls (U+202A to U+202E, U+2066 to U+2069) in source text hide what the code says. Built from code
// points, so this file never holds them either.
const cp = (n: number) => String.fromCharCode(n);
const BIDI = new RegExp(`[${cp(0x202a)}-${cp(0x202e)}${cp(0x2066)}-${cp(0x2069)}]`);
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
  it('has no raw bidi control characters', () => {
    const hits = ['src', 'tests', 'plugins/lens/tests', 'plugins/waypoint/tests']
      .flatMap(d => files(path.join(ROOT, d)))
      .filter(f => BIDI.test(readFileSync(f, 'utf8')))
      .map(f => path.relative(ROOT, f).split(path.sep).join('/'));
    expect(hits).toEqual([]);
  });
});
