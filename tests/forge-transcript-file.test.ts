import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { measureJsonl, readTail, scanLines, type ScanOpts } from '../src/forge/transcript-file.js';
import { useTempDirs } from './helpers/tmp.js';

const tmp = useTempDirs();
const file = (text: string) => {
  const f = path.join(tmp('jsonl-'), 't.jsonl');
  writeFileSync(f, text);
  return f;
};
const scan = (f: string, opts?: ScanOpts) => {
  const got: [number, string][] = [];
  const stats = scanLines(f, (line, n) => got.push([n, line]), opts);
  return { got, stats };
};

describe('the safe JSONL reader (A6)', () => {
  it('measures only an absolute .jsonl that is a regular file', () => {
    const dir = tmp('jsonl-');
    const f = path.join(dir, 'a.jsonl');
    writeFileSync(f, '{"a":1}\n');
    writeFileSync(path.join(dir, 'a.json'), '{}\n');
    mkdirSync(path.join(dir, 'd.jsonl'));
    expect(measureJsonl(f)).toEqual({ file: f, bytes: 8 });
    for (const bad of ['a.jsonl', path.join(dir, 'a.json'), path.join(dir, 'd.jsonl'), path.join(dir, 'none.jsonl'), 42, null]) {
      expect(measureJsonl(bad), String(bad)).toBeNull();
    }
    expect(scanLines(path.join(dir, 'd.jsonl'), () => {})).toBeNull();
    expect(readTail(path.join(dir, 'none.jsonl'), 10)).toBeNull();
  });
  it('gives each line with its 1-based number across chunk boundaries, trims a CR and passes a last line without newline', () => {
    const { got, stats } = scan(file('abcdef\r\n\nxyz\nlast'), { chunk: 4 });
    expect(got).toEqual([[1, 'abcdef'], [2, ''], [3, 'xyz'], [4, 'last']]);
    expect(stats).toEqual({ bytes: 17, lines: 4, long: [], longCount: 0, truncated: false });
  });
  it('skips a line over maxLine, keeps the numbers of the next ones and counts it (Review Focus 5)', () => {
    const { got, stats } = scan(file(`a\n${'x'.repeat(50)}\nb\n`), { chunk: 8, maxLine: 10 });
    expect(got).toEqual([[1, 'a'], [3, 'b']]);
    expect(stats).toMatchObject({ lines: 3, long: [2], longCount: 1, truncated: false });
  });
  it('stops at maxBytes, says truncated and never passes the line the cap cut', () => {
    const { got, stats } = scan(file('one\ntwo\nthree\n'), { chunk: 2, maxBytes: 6 });
    expect(got).toEqual([[1, 'one']]);
    expect(stats).toMatchObject({ truncated: true });
  });
  it('decodes each line whole: a multibyte character cut by a chunk boundary is not broken', () => {
    expect(scan(file('ñandú €\n'), { chunk: 1 }).got).toEqual([[1, 'ñandú €']]);
  });
  it('readTail gives the last bytes of the file', () => {
    expect(readTail(file('one\ntwo\nthree\n'), 6)).toBe('three\n');
  });
});
