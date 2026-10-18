// I-03 (carry 5): the rename that writes an authorization record is tried again while Windows reports the file busy.
// node:fs is mocked in this file only, so its renameSync can fail the way a reader holding the file makes it fail.
import { describe, it, expect, vi } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { authDir, readAuths, writeAuth, type AuthRecord } from '../src/forge/auth.js';
import { useTempDirs } from './helpers/tmp.js';

const busy = vi.hoisted(() => ({ left: 0, code: 'EBUSY', calls: 0 }));
vi.mock('node:fs', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs')>();
  const renameSync = (from: import('node:fs').PathLike, to: import('node:fs').PathLike) => {
    busy.calls++;
    if (busy.left > 0) { busy.left--; throw Object.assign(new Error(`${busy.code}: rename`), { code: busy.code }); }
    return fs.renameSync(from, to);
  };
  return { ...fs, renameSync, default: { ...fs, renameSync } };
});

const tmp = useTempDirs();
const T = '2026-10-16T10:00:00.000Z';
const rec: AuthRecord = {
  authId: 'mof-shop-r1-cd34', kind: 'merge-on-finish', runId: 'shop-r1', target: 'main', question: 'q [mof-shop-r1-cd34]', yes: 'Yes, merge it into main', createdAt: T,
  session: null,
};

describe('the rename of an authorization record (I-03)', () => {
  it('a rename that fails for a moment with EBUSY or EPERM is tried again, and the record lands whole', () => {
    for (const code of ['EBUSY', 'EPERM']) {
      const root = tmp('forge-auth-rename-');
      Object.assign(busy, { left: 2, code, calls: 0 });
      writeAuth(root, rec);
      expect(busy.calls, code).toBe(3);
      expect(readAuths(root), code).toEqual([rec]);
      expect(readdirSync(authDir(root)), code).toEqual(['mof-shop-r1-cd34.json']);
    }
  });
  it('a rename that stays busy throws after the retries and leaves neither the record nor its temporary file', () => {
    const root = tmp('forge-auth-rename-');
    Object.assign(busy, { left: 99, code: 'EBUSY', calls: 0 });
    try {
      expect(() => writeAuth(root, rec)).toThrow('EBUSY');
    } finally { busy.left = 0; }
    expect(busy.calls).toBe(6);
    expect(existsSync(authDir(root)) ? readdirSync(authDir(root)) : []).toEqual([]);
  });
  it('another error is not tried again', () => {
    const root = tmp('forge-auth-rename-');
    Object.assign(busy, { left: 1, code: 'ENOSPC', calls: 0 });
    expect(() => writeAuth(root, rec)).toThrow('ENOSPC');
    expect(busy.calls).toBe(1);
    expect(readdirSync(authDir(root))).toEqual([]);
  });
});
