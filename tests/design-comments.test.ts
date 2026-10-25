import { describe, it, expect, beforeEach } from 'vitest';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { run, type Io } from '../src/cli/run.js';
import { markSeen, markTaken, parseCommentsSeen, threadIds, unseenOf } from '../src/lib/design-comments.js';
import { useTempDirs } from './helpers/tmp.js';
const tmp = useTempDirs();

describe('the record of the design comments (w7 A2)', () => {
  it('markSeen keeps the first round, markTaken the latest version, unseenOf names the threads no critic got', () => {
    let s = markSeen(markSeen({}, ['t1', 't2'], 1), ['t2', 't3'], 2);
    expect(s).toEqual({ t1: { round: 1, taken: null }, t2: { round: 1, taken: null }, t3: { round: 2, taken: null } });
    s = markTaken(markTaken(s, ['t1'], 3), ['t1'], 4);
    expect(s.t1).toEqual({ round: 1, taken: 4 });
    expect(unseenOf(s, ['t1', 'x'])).toEqual(['x']);
    expect(Object.keys(markSeen({}, ['__proto__'], 1))).toEqual(['__proto__']);
  });
  it('threadIds splits on commas and refuses a space, an empty list or an id too long', () => {
    expect(threadIds(' t1, c:42 ,')).toEqual(['t1', 'c:42']);
    for (const bad of ['', ',', 'a b', 'x'.repeat(201)]) expect(threadIds(bad), bad).toBeNull();
  });
  it('parseCommentsSeen keeps only well-formed entries and reads junk as empty', () => {
    for (const junk of ['nope', '[1]', 'null']) expect(parseCommentsSeen(junk)).toEqual({});
    expect(parseCommentsSeen(JSON.stringify({ ok: { round: 1, taken: null }, 'a b': { round: 1, taken: null }, bad: { round: 'x', taken: null } })))
      .toEqual({ ok: { round: 1, taken: null } });
    // Review Focus 3: a thread id `__proto__` read back is one more key.
    expect(Object.keys(parseCommentsSeen('{"__proto__": {"round": 1, "taken": 2}}'))).toEqual(['__proto__']);
    // Only round and taken are kept from an entry.
    const kept = parseCommentsSeen('{"t1": {"round": 1, "taken": null, "text": "secret"}}');
    expect(Object.keys(kept.t1).sort()).toEqual(['round', 'taken']);
  });
});

describe('waypoint design-comments (w7 A2)', () => {
  let repo: string;
  let io: Io;
  const design = () => path.join(repo, 'docs/waypoint/demo-shop/design.md');
  const file = () => path.join(repo, 'docs/waypoint/demo-shop/design/critiques/comments.json');
  const wp = (...args: string[]) => run(['design-comments', ...args], io);
  beforeEach(() => {
    repo = tmp('wp-comments-');
    const elsewhere = tmp('wp-comments-cwd-');
    mkdirSync(path.dirname(design()), { recursive: true });
    copyFileSync(new URL('./fixtures/design.md', import.meta.url), design());
    io = { cwd: elsewhere, now: () => new Date('2026-10-24T10:00:00.000Z'), assetsDir: elsewhere, env: {} };
  });

  it('prints the record and writes design/critiques/comments.json only with --seen or --taken', () => {
    expect(JSON.parse(wp(design()).stdout)).toEqual({ threads: {} });
    expect(existsSync(file())).toBe(false);
    expect(JSON.parse(wp(design(), '--seen', 't1,t2', '--round', '1').stdout).threads).toEqual({ t1: { round: 1, taken: null }, t2: { round: 1, taken: null } });
    expect(JSON.parse(wp(design(), '--seen', 't3', '--round', '2', '--taken', 't1,t3', '--version', '4').stdout).threads)
      .toEqual({ t1: { round: 1, taken: 4 }, t2: { round: 1, taken: null }, t3: { round: 2, taken: 4 } });
    const doc = JSON.parse(readFileSync(file(), 'utf8'));
    expect(Object.keys(doc)).toEqual(['t1', 't2', 't3']);
    // Review Focus 5: no comment text reaches the repository.
    for (const v of Object.values(doc)) expect(Object.keys(v as object).sort()).toEqual(['round', 'taken']);
  });
  it('exits 2 and writes nothing for a bad id, a missing number or a thread no critic got (Review Focus 3)', () => {
    wp(design(), '--seen', 't1', '--round', '1');
    const before = readFileSync(file(), 'utf8');
    for (const args of [['--seen', 'a b', '--round', '2'], ['--seen', ',', '--round', '2'], ['--seen', 't9'], ['--seen', 't9', '--round', '0'], ['--seen', '--round', '2'],
      ['--taken', 't1'], ['--taken', 't9', '--version', '2'], ['--seen', 't9', '--round', '2', '--taken', 't8', '--version', '2']]) {
      expect(wp(design(), ...args).code, args.join(' ')).toBe(2);
    }
    expect(wp(design(), '--taken', 't9', '--version', '2').stderr).toContain('t9');
    expect(readFileSync(file(), 'utf8')).toBe(before);
    expect(wp(path.join(repo, 'missing.md')).code).toBe(2);
    expect(wp().code).toBe(2);
  });
  it('reads a junk comments.json as empty and replaces it on the next write', () => {
    mkdirSync(path.dirname(file()), { recursive: true });
    writeFileSync(file(), '{"t1": ');
    expect(JSON.parse(wp(design()).stdout)).toEqual({ threads: {} });
    expect(JSON.parse(wp(design(), '--seen', 't2', '--round', '1').stdout).threads).toEqual({ t2: { round: 1, taken: null } });
  });
});
