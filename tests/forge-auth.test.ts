import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  authDir, checkMergeAuth, checkMofAuth, isForgeBranch, mergeAsk, mofAsk, newAuthId, normalizeAuth, pendingAuth, readAuths, retryBusy, useAuth, writeAuth, type AuthRecord,
} from '../src/forge/auth.js';
import { useTempDirs } from './helpers/tmp.js';

const tmp = useTempDirs();
const T = '2026-10-16T10:00:00.000Z';
const at = (min: number) => new Date(Date.parse(T) + min * 60_000).toISOString();
const merge = (over: Partial<AuthRecord> = {}): AuthRecord => ({
  authId: 'merge-shop-r1-ab12', kind: 'merge', runId: 'shop-r1', target: 'main', question: 'q [merge-shop-r1-ab12]', yes: 'Yes, merge it', createdAt: T,
  session: 's1', answeredAt: T, answer: 'yes', answeredBy: 's1', ...over,
});
const mof = (over: Partial<AuthRecord> = {}): AuthRecord => ({
  authId: 'mof-shop-r1-cd34', kind: 'merge-on-finish', runId: 'shop-r1', target: 'main', question: 'q [mof-shop-r1-cd34]', yes: 'Yes, merge it into main', createdAt: T,
  session: null, answeredAt: T, answer: 'yes', answeredBy: 'design', ...over,
});

describe('merge authorizations (I-03)', () => {
  const ok = { runId: 'shop-r1', target: 'main', session: 's1' as string | null, now: Date.parse(at(30)) };
  const why = (recs: AuthRecord[], over: Partial<typeof ok> = {}) => { const r = checkMergeAuth(recs, { ...ok, ...over }); return r.ok ? 'ok' : r.reason; };
  it('a yes of this session, run and branch, less than 60 minutes old and unused, allows the merge', () => {
    expect(checkMergeAuth([merge()], ok)).toEqual({ ok: true, record: merge() });
  });
  it('anything else says why not; the newest answer of this run and branch decides', () => {
    expect(why([merge()], { session: null })).toBe('no session id');
    expect(why([])).toBe('no answer recorded');
    expect(why([merge({ answer: undefined, answeredAt: undefined, answeredBy: undefined })])).toBe('no answer recorded');
    expect(why([merge({ answer: 'no' })])).toBe('answered no');
    expect(why([merge()], { now: Date.parse(at(61)) })).toBe('expired');
    expect(why([merge({ answeredBy: 's2' })])).toBe('other session');
    expect(why([merge({ authId: 'merge-shop-r2-ab12', runId: 'shop-r2' })])).toBe('other run');
    expect(why([merge({ target: 'develop' })])).toBe('other branch');
    expect(why([merge({ usedAt: at(5) })])).toBe('already used');
    expect(why([merge({ answeredAt: at(1) }), merge({ authId: 'merge-shop-r1-zz99', answer: 'no', answeredAt: at(2) })])).toBe('answered no');
  });
  it('a yes and a no answered at the same instant: the no decides, in either order; a merge-on-finish yes is never a merge yes', () => {
    const no = merge({ authId: 'merge-shop-r1-zz99', answer: 'no' });
    expect(why([merge(), no])).toBe('answered no');
    expect(why([no, merge()])).toBe('answered no');
    expect(why([mof({ answeredBy: 's1' })])).toBe('no answer recorded');
  });
  it('a yes with a note of the person is not a yes', () => {
    expect(why([merge({ answer: 'other', note: 'only after CI' })])).toBe('answered no');
  });
  it('a yes dated more than 5 minutes ahead of now allows nothing; a no dated so still decides', () => {
    expect(why([merge({ answeredAt: at(36) })])).toBe('no answer recorded');
    expect(why([merge({ createdAt: at(40), answeredAt: at(30) })])).toBe('no answer recorded');
    expect(why([merge({ answeredAt: at(34) })])).toBe('ok');
    expect(why([merge({ answeredAt: at(2 * 24 * 60) })])).toBe('no answer recorded');
    // Setting the future no aside would let the older yes through: it decides instead.
    expect(why([merge({ answeredAt: at(10) }), merge({ authId: 'merge-shop-r1-zz99', answer: 'no', answeredAt: at(50) })])).toBe('answered no');
  });
});

describe('merge-on-finish authorizations (I-03)', () => {
  const why = (recs: AuthRecord[], o = { runId: 'shop-r1', target: 'main', session: 'x' as string | null }) => { const r = checkMofAuth(recs, o); return r.ok ? 'ok' : r.reason; };
  it('tied to the run id: from any session, at any time', () => {
    expect(checkMofAuth([mof({ answeredAt: at(-600) })], { runId: 'shop-r1', target: 'main', session: 'other' })).toMatchObject({ ok: true });
    expect(why([])).toBe('no answer recorded');
    expect(why([mof({ answer: 'no' })])).toBe('answered no');
    expect(why([mof({ authId: 'mof-shop-r2-cd34', runId: 'shop-r2' })])).toBe('other run');
    expect(why([mof({ target: 'develop' })])).toBe('other branch');
    expect(why([mof({ usedAt: at(1) })])).toBe('already used');
  });
  it('one asked before the run existed (auto mode at launch) counts only for the session that asked, and using it ties it to the run', () => {
    const root = tmp('forge-auth-');
    const launch = mof({ authId: 'mof-launch-ef56', runId: null, session: 'auto-1' });
    expect(checkMofAuth([launch], { runId: 'shop-r9', target: 'main', session: 'auto-1' })).toMatchObject({ ok: true });
    expect(checkMofAuth([launch], { runId: 'shop-r9', target: 'main', session: 'auto-2' })).toEqual({ ok: false, reason: 'no answer recorded' });
    writeAuth(root, launch);
    useAuth(root, launch, at(3), 'shop-r9');
    expect(readAuths(root)).toEqual([{ ...launch, runId: 'shop-r9', usedAt: at(3) }]);
  });
  it('a launch record without the session that asked counts for nobody, and a merge yes is never a merge-on-finish yes', () => {
    expect(checkMofAuth([mof({ authId: 'mof-launch-ef56', runId: null, session: null })], { runId: 'shop-r9', target: 'main', session: null }))
      .toEqual({ ok: false, reason: 'no answer recorded' });
    expect(why([merge()])).toBe('no answer recorded');
  });
  it('a yes with a note, or dated more than 5 minutes ahead of now (the clock by default), is not a yes', () => {
    expect(why([mof({ answer: 'other', note: 'only on Friday' })])).toBe('answered no');
    const o = { runId: 'shop-r1', target: 'main', session: 'x' };
    expect(checkMofAuth([mof({ answeredAt: at(10) })], { ...o, now: Date.parse(at(0)) })).toEqual({ ok: false, reason: 'no answer recorded' });
    expect(checkMofAuth([mof()], { ...o, now: Date.parse(at(-10)) })).toEqual({ ok: false, reason: 'no answer recorded' });
    expect(checkMofAuth([mof()], { ...o, now: Date.parse(at(-4)) })).toMatchObject({ ok: true });
    expect(checkMofAuth([mof({ answeredAt: new Date(Date.now() + 3_600_000).toISOString() })], o)).toEqual({ ok: false, reason: 'no answer recorded' });
    expect(checkMofAuth([mof({ answeredAt: at(-1) }), mof({ authId: 'mof-shop-r1-zz99', answer: 'no', answeredAt: at(10) })], { ...o, now: Date.parse(at(0)) }))
      .toEqual({ ok: false, reason: 'answered no' });
  });
});

describe('authorization records (I-03)', () => {
  it('normalizeAuth keeps a good record and drops a bad one or a bad field; ids and asks', () => {
    expect(normalizeAuth(merge())).toEqual(merge());
    for (const bad of [null, [], { ...merge(), authId: '../x' }, { ...merge(), kind: 'push' }, { ...merge(), runId: 'a/b' }, { ...merge(), target: '-main' },
      { ...merge(), createdAt: 'x' }, { ...merge(), question: '' }]) {
      expect(normalizeAuth(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(normalizeAuth({ ...merge(), answer: 'maybe', answeredBy: 'a b' })).toEqual({ ...merge(), answer: undefined, answeredBy: undefined });
    expect(isForgeBranch('forge/infinite-20261016')).toBe(true);
    expect(isForgeBranch('main')).toBe(false);
    expect(newAuthId('merge', 'shop-r1', () => 0)).toBe('merge-shop-r1-0000');
    expect(newAuthId('merge-on-finish', null, () => 0.5)).toMatch(/^mof-launch-[0-9a-z]{4}$/);
    expect(mergeAsk('merge-x-0000', 'forge/run-shop', 'main', true).ask.question).toBe('¿Integro forge/run-shop en main? [merge-x-0000]');
    const m = mofAsk('mof-x-0000', 'main', false, true);
    expect(m.ask.options.map(o => o.label)).toEqual(['No, I will review it (Recommended)', 'Yes, merge it into main']);
    expect(m.yes).toBe('Yes, merge it into main');
    expect(m.ask.options[1].description).toContain('default branch');
    for (const a of [m.ask, mofAsk('mof-x-0000', 'main', true, false).ask, mergeAsk('merge-x-0000', 'b', 'main', false).ask]) expect(a.header.length).toBeLessThanOrEqual(12);
  });
  it('normalizeAuth: an id of the other kind, a date that is not an ISO instant, a long label or a bad session is not kept', () => {
    for (const bad of [{ ...merge(), authId: 'mof-shop-r1-ab12' }, { ...mof(), authId: 'merge-shop-r1-cd34' }, { ...merge(), authId: 'merge-shop-r1-AB12' },
      { ...merge(), createdAt: '2026-13-45T99:00:00.000Z' }, { ...merge(), createdAt: 'October 16, 2026' }, { ...merge(), yes: 'y'.repeat(201) },
      { ...merge(), question: 'q'.repeat(4001) }, { ...merge(), target: 'a..b' }, { ...merge(), runId: 'x'.repeat(121) }]) {
      expect(normalizeAuth(bad), JSON.stringify(bad).slice(0, 120)).toBeNull();
    }
    expect(normalizeAuth({ ...merge(), session: '../s', answeredAt: 'yesterday', usedAt: 7 })).toEqual({ ...merge(), session: null, answeredAt: undefined, usedAt: undefined });
    expect(normalizeAuth(merge({ answer: 'other', note: 'only after CI' }))).toEqual(merge({ answer: 'other', note: 'only after CI' }));
    expect(normalizeAuth({ ...merge(), note: 'n'.repeat(2001) })).toEqual(merge());
    expect(normalizeAuth({ ...merge(), note: 7 })).toEqual(merge());
  });
  it('retryBusy tries again while the file is busy (Windows), never on another error, and gives up after a few tries', () => {
    const busy = (code: string, times: number) => {
      let n = 0;
      return () => { if (n++ < times) throw Object.assign(new Error(code), { code }); return n; };
    };
    const waits: number[] = [];
    const wait = (ms: number) => { waits.push(ms); };
    expect(retryBusy(busy('EPERM', 2), wait)).toBe(3);
    expect(retryBusy(busy('EBUSY', 1), wait)).toBe(2);
    expect(retryBusy(busy('EACCES', 1), wait)).toBe(2);
    expect(waits).toEqual([15, 30, 15, 15]);
    expect(() => retryBusy(busy('ENOENT', 1), wait)).toThrow('ENOENT');
    expect(() => retryBusy(busy('EPERM', 99), wait)).toThrow('EPERM');
    expect(waits).toHaveLength(4 + 5);
  });
  it('writeAuth refuses a record that does not read back, and writes nothing', () => {
    const root = tmp('forge-auth-');
    for (const bad of [{ ...merge(), authId: '../../x' }, { ...merge(), authId: 'merge-a/../../b-0000' }, { ...merge(), target: '-x' }]) {
      expect(() => writeAuth(root, bad as AuthRecord), bad.authId).toThrow();
    }
    expect(existsSync(authDir(root)) ? readdirSync(authDir(root)) : []).toEqual([]);
    expect(readdirSync(root)).toEqual([]);
  });
  it('readAuths skips a file too big, a directory and a name that is no authId, and with many records reads the newest written', () => {
    const root = tmp('forge-auth-');
    const dir = authDir(root);
    mkdirSync(path.join(dir, 'merge-shop-r1-dir1.json'), { recursive: true });
    writeFileSync(path.join(dir, 'merge-shop-r1-big1.json'), JSON.stringify({ ...merge({ authId: 'merge-shop-r1-big1' }), pad: 'x'.repeat(70_000) }));
    writeFileSync(path.join(dir, 'notes.json'), JSON.stringify(merge()));
    expect(readAuths(root)).toEqual([]);
    // 210 records written a day ago, named after the one written now (a sort by name would keep them and drop it).
    const old = new Date(Date.now() - 86_400_000);
    for (let i = 0; i < 210; i++) {
      const id = `mof-shop-r${i}-0000`;
      const f = path.join(dir, `${id}.json`);
      writeFileSync(f, JSON.stringify(mof({ authId: id, runId: `shop-r${i}` })));
      utimesSync(f, old, old);
    }
    writeAuth(root, merge({ answer: undefined, answeredAt: undefined, answeredBy: undefined }));
    const recs = readAuths(root);
    expect(recs.length).toBe(200);
    expect(recs.map(r => r.authId)).toContain('merge-shop-r1-ab12');
  });
  it('pendingAuth reuses the open question of the same run, branch and session, and makes a new one once it is answered', () => {
    const root = tmp('forge-auth-');
    const o = { kind: 'merge' as const, runId: 'shop-r1', target: 'main', session: 's1', now: new Date(T), rand: () => 0.25, build: (id: string) => mergeAsk(id, 'forge/run-shop', 'main', false) };
    const a = pendingAuth(root, o);
    expect(a.ask.question).toBe(`Do I merge forge/run-shop into main? [${a.authId}]`);
    expect(pendingAuth(root, { ...o, now: new Date(at(10)) })).toEqual(a);
    expect(readAuths(root)).toHaveLength(1);
    writeAuth(root, { ...readAuths(root)[0], answer: 'no', answeredAt: at(11), answeredBy: 's1' });
    const b = pendingAuth(root, { ...o, rand: () => 0.75 });
    expect(b.authId).not.toBe(a.authId);
    expect(pendingAuth(root, { ...o, session: 's2', rand: () => 0.5 }).authId).not.toBe(b.authId);
    expect(pendingAuth(root, { ...o, now: new Date(at(80)), rand: () => 0.125 }).authId).not.toBe(b.authId);
  });
  it('pendingAuth does not reuse an open question dated more than 5 minutes ahead of now', () => {
    const root = tmp('forge-auth-');
    const build = (id: string) => mergeAsk(id, 'forge/run-shop', 'main', false);
    const ahead = merge({ authId: 'merge-shop-r1-0000', question: build('merge-shop-r1-0000').ask.question, createdAt: at(600), answer: undefined, answeredAt: undefined, answeredBy: undefined });
    writeAuth(root, ahead);
    const p = pendingAuth(root, { kind: 'merge', runId: 'shop-r1', target: 'main', session: 's1', now: new Date(T), rand: () => 0.5, build });
    expect(p.authId).not.toBe('merge-shop-r1-0000');
    expect(readAuths(root)).toContainEqual(ahead);
  });
  it('pendingAuth never writes over a record whose id it drew again', () => {
    const root = tmp('forge-auth-');
    writeAuth(root, merge({ authId: 'merge-shop-r1-0000', question: 'q [merge-shop-r1-0000]', answer: 'no' }));
    const before = readFileSync(path.join(authDir(root), 'merge-shop-r1-0000.json'), 'utf8');
    const p = pendingAuth(root, { kind: 'merge', runId: 'shop-r1', target: 'main', session: 's1', now: new Date(T), rand: () => 0, build: id => mergeAsk(id, 'forge/run-shop', 'main', false) });
    expect(p.authId).not.toBe('merge-shop-r1-0000');
    expect(readFileSync(path.join(authDir(root), 'merge-shop-r1-0000.json'), 'utf8')).toBe(before);
    expect(readAuths(root)).toHaveLength(2);
  });
});
