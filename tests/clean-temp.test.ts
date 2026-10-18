import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prefixOf, removeOld, scan } from '../scripts/clean-temp.mjs';
import { useTempDirs } from './helpers/tmp.js';

const tmp = useTempDirs();
const script = fileURLToPath(new URL('../scripts/clean-temp.mjs', import.meta.url));
const clean = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
const DAY = 24 * 3600_000;

/** A fake temp dir: four old entries of the tests' prefixes, a recent one, an old file that only looks like one and a foreign one. */
function fake(): string {
  const root = tmp('clean-');
  const old = new Date(Date.now() - 2 * DAY);
  const entry = (name: string, at: Date | null, file = false) => {
    const p = path.join(root, name);
    if (file) writeFileSync(p, 'keep');
    else { mkdirSync(path.join(p, 'sub'), { recursive: true }); writeFileSync(path.join(p, 'sub', 'f.txt'), 'x'); }
    if (at) utimesSync(p, at, at);
  };
  entry('forge-cli-AbC123', old);
  entry('wp-Zz9yX8', old);
  entry('bgkit-vitest-4242-20261001120000', old);
  entry('bgkit-hyg-Qw3rTy', old);
  entry('forge-cli-Recnt1', null);
  entry('forge-cli-keep.txt', old, true);
  entry('other-AbC123', old);
  return root;
}

describe('clean-temp (I-01)', () => {
  it("prefixOf knows the tests' prefixes followed by mkdtemp's 6 characters, and nothing else", () => {
    expect(prefixOf('forge-cli-AbC123')).toBe('forge-cli');
    expect(prefixOf('forge-dec-race-a1b2c3')).toBe('forge-dec-race');
    expect(prefixOf('forge-AbC123')).toBe('forge');
    expect(prefixOf('wpAbC123')).toBe('wp');
    expect(prefixOf('wp-else-AbC123')).toBe('wp-else');
    expect(prefixOf('mod-types-AbC123')).toBe('mod-types');
    expect(prefixOf('route-eval-ZGHV34')).toBe('route-eval');
    expect(prefixOf('bgkit-hyg-Qw3rTy')).toBe('bgkit-hyg');
    expect(prefixOf('bgkit-vitest-4242-20261001120000')).toBe('bgkit-vitest');
    expect(prefixOf('band-disk-AbC123')).toBe('band-disk');
    expect(prefixOf('seat-of-AbC123')).toBe('seat-of');
    expect(prefixOf('page-mark-AbC123')).toBe('page-mark');
    for (const n of ['forge-cli-keep.txt', 'forge-cli-AbC1234', 'other-AbC123', 'wpsettings', 'forge-cli-', 'bgkit-vitest-x', 'band-AbC123', 'page-AbC123', 'seat-AbC123']) expect(prefixOf(n), n).toBeNull();
  });
  it('without --apply it counts by prefix, most first, and deletes nothing', () => {
    const root = fake();
    const r = clean('--root', root);
    expect(r.status).toBe(0);
    const lines = r.stdout.trim().split(/\r?\n/);
    expect(lines[0]).toBe('forge-cli: 2 (1 older than 24h)');
    expect(lines).toEqual(expect.arrayContaining([
      'wp: 1 (1 older than 24h)', 'bgkit-vitest: 1 (1 older than 24h)', 'bgkit-hyg: 1 (1 older than 24h)', 'total: 5 (4 older than 24h)',
    ]));
    for (const n of ['forge-cli-AbC123', 'wp-Zz9yX8', 'bgkit-vitest-4242-20261001120000', 'bgkit-hyg-Qw3rTy', 'forge-cli-Recnt1', 'forge-cli-keep.txt', 'other-AbC123']) {
      expect(existsSync(path.join(root, n)), n).toBe(true);
    }
  });
  it('with --apply it deletes only the old entries of a known prefix: never a file that looks like one, a foreign name or a recent entry', () => {
    const root = fake();
    const r = clean('--root', root, '--apply');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('deleted: 4, errors: 0');
    for (const n of ['forge-cli-AbC123', 'wp-Zz9yX8', 'bgkit-vitest-4242-20261001120000', 'bgkit-hyg-Qw3rTy']) expect(existsSync(path.join(root, n)), n).toBe(false);
    for (const n of ['forge-cli-Recnt1', 'forge-cli-keep.txt', 'other-AbC123']) expect(existsSync(path.join(root, n)), n).toBe(true);
  });
  it('--older-than-hours 0 counts the recent entry too; a missing root counts nothing; a bad option exits 2', () => {
    const root = fake();
    expect(scan(root, Date.now() + 1000, 0).old).toHaveLength(5);
    expect(clean('--root', path.join(root, 'missing')).stdout).toContain('total: 0 (0 older than 24h)');
    for (const bad of [['--older-than-hours', '-1'], ['--older-than-hours', 'x'], ['--root'], ['--push']]) expect(clean(...bad).status, bad.join(' ')).toBe(2);
  });
  it('a file it cannot delete (EBUSY) is warned about and counted, never thrown, and the rest go on', () => {
    const warnings: string[] = [];
    const tried: string[] = [];
    const rm = (p: string) => {
      tried.push(path.basename(p));
      if (p.endsWith('wp-Zz9yX8')) throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
    };
    const r = removeOld('/x', ['forge-cli-AbC123', 'wp-Zz9yX8', 'bgkit-hyg-Qw3rTy'], w => warnings.push(w), rm);
    expect(r).toEqual({ deleted: 2, errors: 1 });
    expect(tried).toEqual(['forge-cli-AbC123', 'wp-Zz9yX8', 'bgkit-hyg-Qw3rTy']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('wp-Zz9yX8');
    expect(warnings[0]).toContain('EBUSY');
  });
});
