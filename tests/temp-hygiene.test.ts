import { describe, it, expect, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { walk } from './helpers/files.js';
import { removeDir, useTempDirs } from './helpers/tmp.js';
import setup, { stamp } from './setup/temp-root.js';

describe('the temp root of a test run (I-01)', () => {
  it('inside a test, os.tmpdir() is the bgkit-vitest-<pid>-<stamp> root of this run', () => {
    expect(path.basename(tmpdir())).toMatch(/^bgkit-vitest-\d+-\d{14}$/);
    expect(process.env.BGKIT_TEMP_ROOT).toBe(tmpdir());
    for (const k of ['TEMP', 'TMP', 'TMPDIR']) expect(process.env[k], k).toBe(tmpdir());
  });
  it('stamp is yyyymmddHHMMss in local time', () => {
    expect(stamp(new Date(2026, 9, 16, 9, 5, 7))).toBe('20261016090507');
  });
  it('the setup makes a bgkit-vitest root and its teardown removes it and restores the environment', () => {
    const before = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR, root: process.env.BGKIT_TEMP_ROOT };
    const teardown = setup();
    const root = process.env.BGKIT_TEMP_ROOT as string;
    try {
      expect(path.basename(root)).toMatch(/^bgkit-vitest-\d+-\d{14}$/);
      expect(existsSync(root)).toBe(true);
      writeFileSync(path.join(root, 'left.txt'), 'x');
    } finally { teardown(); }
    expect(existsSync(root)).toBe(false);
    // the teardown unsets BGKIT_TEMP_ROOT (it was unset before the run); put this worker's back for the other tests
    expect(process.env.BGKIT_TEMP_ROOT).toBeUndefined();
    process.env.BGKIT_TEMP_ROOT = before.root;
    expect({ TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR }).toEqual({ TEMP: before.TEMP, TMP: before.TMP, TMPDIR: before.TMPDIR });
  });
});

const made: string[] = [];
describe('useTempDirs (I-01)', () => {
  const tmp = useTempDirs();
  it('makes bgkit-<prefix><6 characters> directories right under the run root', () => {
    const a = tmp('hyg-');
    const b = tmp('hyg-');
    made.push(a, b);
    expect(a).not.toBe(b);
    for (const d of [a, b]) {
      expect(existsSync(d)).toBe(true);
      expect(path.dirname(d)).toBe(tmpdir());
      expect(path.basename(d)).toMatch(/^bgkit-hyg-[A-Za-z0-9]{6}$/);
    }
    mkdirSync(path.join(a, 'deep', 'er'), { recursive: true });
    writeFileSync(path.join(a, 'deep', 'er', 'f.txt'), 'x');
  });
});
describe('after a block that used useTempDirs (I-01)', () => {
  it('its afterAll removed every directory it made, with what they held', () => {
    expect(made).toHaveLength(2);
    for (const d of made) expect(existsSync(d), d).toBe(false);
  });
});

describe('removeDir (I-01)', () => {
  const tmp = useTempDirs();
  it('removes a directory and says so', () => {
    const d = tmp('rm-');
    expect(removeDir(d)).toBe(true);
    expect(existsSync(d)).toBe(false);
  });
  it('a directory that cannot be removed (EBUSY on Windows) is warned about, never thrown', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const busy = () => { throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' }); };
      expect(removeDir(path.join(tmpdir(), 'bgkit-busy-AbC123'), busy)).toBe(false);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('EBUSY'));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('bgkit-busy-AbC123'));
    } finally { warn.mockRestore(); }
  });
});

describe('no test makes a temp directory by hand (I-01)', () => {
  it('mkdtempSync appears in tests/ only in tests/helpers/tmp.ts', () => {
    const needle = 'mkdtemp' + 'Sync(';
    const root = fileURLToPath(new URL('.', import.meta.url));
    const offenders = walk(root)
      .filter(f => /\.(ts|mts|js|mjs)$/.test(f))
      .map(f => path.relative(root, f).split(path.sep).join('/'))
      .filter(rel => rel !== 'helpers/tmp.ts' && readFileSync(path.join(root, rel), 'utf8').includes(needle));
    expect(offenders).toEqual([]);
  });
});
