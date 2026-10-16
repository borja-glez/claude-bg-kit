import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, readdirSync, existsSync, writeFileSync, type PathLike } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run, type Io } from '../src/cli/run.js';
import { checkoutSid, readBinding } from '../src/lib/bound-fs.js';
import type { BoundDoc } from '../src/lib/bound.js';

const race = vi.hoisted(() => ({ rival: null as string | null, failRenames: 0, boundReads: 0, emptyAt: [] as number[] }));

// Windows refuses a rename onto a file that another process renames at that same instant (EPERM). The reads of a
// bound.json are counted from 0, and those in `emptyAt` find it empty, as the band's $.fs.write (not atomic) can leave
// it for an instant.
vi.mock('node:fs', async importOriginal => {
  const real = await importOriginal<typeof import('node:fs')>();
  return {
    ...real,
    renameSync: (from: PathLike, to: PathLike) => {
      if (race.failRenames > 0 && String(to).endsWith('bound.json')) {
        race.failRenames--;
        throw Object.assign(new Error(`EPERM: operation not permitted, rename '${String(from)}' -> '${String(to)}'`), { code: 'EPERM' });
      }
      return real.renameSync(from, to);
    },
    readFileSync: ((file: Parameters<typeof real.readFileSync>[0], options?: Parameters<typeof real.readFileSync>[1]) => {
      if (String(file).endsWith('bound.json')) {
        if (race.emptyAt.includes(race.boundReads++)) return '';
      }
      return real.readFileSync(file, options);
    }) as typeof real.readFileSync,
  };
});
// Another conversation binds the same seat at the same time: its rename lands right after ours, before bind reads back.
vi.mock('../src/lib/bound-fs.js', async importOriginal => {
  const real = await importOriginal<typeof import('../src/lib/bound-fs.js')>();
  return {
    ...real,
    writeBinding: (file: string, doc: BoundDoc) => {
      real.writeBinding(file, doc);
      if (race.rival && doc.claude !== race.rival) real.writeBinding(file, { ...doc, claude: race.rival, pid: null });
    },
  };
});

const NOW = Date.parse('2026-10-15T12:00:00.000Z');
const at = (min: number) => new Date(NOW + min * 60000).toISOString();
const PLAN = 'docs/waypoint/demo-shop/plan.yaml';
let dir: string;
let io: Io;
const wp = (...p: string[]) => path.join(dir, '.waypoint', 'demo-shop', ...p);
const json = (f: string) => JSON.parse(readFileSync(f, 'utf8'));
const bind = (claude: string, ...flags: string[]) => run(['bind', PLAN, '--via', 'work', '--claude', claude, ...flags], io);
const tmpLeft = (d: string): string[] => readdirSync(d).filter(f => f.endsWith('.tmp'));

beforeEach(() => {
  race.rival = null;
  race.failRenames = 0;
  race.boundReads = 0;
  race.emptyAt = [];
  dir = mkdtempSync(path.join(tmpdir(), 'wp-bind-race-'));
  mkdirSync(path.join(dir, 'docs', 'waypoint', 'demo-shop'), { recursive: true });
  copyFileSync(new URL('./fixtures/plan.yaml', import.meta.url), path.join(dir, PLAN));
  io = { cwd: dir, now: () => new Date(NOW), rand: () => 0, assetsDir: dir, env: {} };
});

describe('two binds on one seat at once (spec §4.10)', () => {
  it('the one that reads the other back lost: exit 3 naming the winner, and it writes nothing else', () => {
    race.rival = 'R';
    const r = bind('B');
    expect(r.code).toBe(3);
    expect(JSON.parse(r.stdout)).toEqual({ held: { sid: 'main', claude: 'R', via: 'work', seenAt: at(0), task: null }, options: ['worktree', 'second-seat', 'takeover'], secondSeat: 'main-2' });
    expect(json(wp('bound.json')).claude).toBe('R');
    expect(existsSync(wp('session.json'))).toBe(false);
    expect(existsSync(wp('last-head.json'))).toBe(false);
  });
  it('a takeover and a second seat lose the same way', () => {
    mkdirSync(wp(), { recursive: true });
    writeFileSync(wp('bound.json'), JSON.stringify({ sid: 'main', claude: 'A', pid: null, via: 'work', since: at(-60), seenAt: at(-1), endedAt: null, endReason: null }));
    race.rival = 'R';
    expect(bind('B', '--takeover').code).toBe(3);
    expect(json(wp('bound.json')).claude).toBe('R');
    expect(bind('B', '--second-seat').code).toBe(3);
    expect(json(wp('seats', 'main-2', 'bound.json')).claude).toBe('R');
    expect(existsSync(wp('seats', 'main-2', 'session.json'))).toBe(false);
  });
  it('a rename refused while another is in flight is tried again: bind binds', () => {
    race.failRenames = 5;
    expect(bind('B').code).toBe(0);
    expect(race.failRenames).toBe(0);
    expect(json(wp('bound.json')).claude).toBe('B');
    expect(tmpLeft(wp())).toEqual([]);
  });
  it('a rename that keeps failing is an error that leaves the old binding whole and no temporary file', () => {
    mkdirSync(wp(), { recursive: true });
    const old = JSON.stringify({ sid: 'main', claude: 'A', pid: null, via: 'work', since: at(-60), seenAt: at(-30), endedAt: at(-30), endReason: 'clear' });
    writeFileSync(wp('bound.json'), old);
    race.failRenames = 1000;
    const r = bind('B');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('EPERM');
    expect(readFileSync(wp('bound.json'), 'utf8')).toBe(old);
    expect(tmpLeft(wp())).toEqual([]);
  });
});

describe('a binding caught while the band writes it (spec §4.10)', () => {
  const live: BoundDoc = { sid: 'main', claude: 'A', pid: null, via: 'work', since: at(-60), seenAt: at(-1), endedAt: null, endReason: null };
  const seat = (text: string) => {
    mkdirSync(wp(), { recursive: true });
    writeFileSync(wp('bound.json'), text);
  };
  it('a reader that finds bound.json empty reads it once more and gets the binding', () => {
    seat(JSON.stringify(live));
    race.emptyAt = [0, 2];
    expect(readBinding(wp(), 'main', NOW)).toEqual(live);
    expect(race.boundReads).toBe(2);
    expect(checkoutSid(wp(), NOW)).toBe('main');
    expect(race.boundReads).toBe(4);
  });
  it('waypoint bind does not take a live seat as a new one when the read it decides on finds it empty', () => {
    seat(JSON.stringify(live));
    writeFileSync(wp('session.json'), JSON.stringify({ sessionId: 'main' }));
    // Read 0 lists the seats; read 1 is the seat's binding just before bind writes its own.
    race.emptyAt = [1];
    const r = bind('B');
    expect(r.code).toBe(3);
    expect(JSON.parse(r.stdout).held).toMatchObject({ sid: 'main', claude: 'A' });
    expect(json(wp('bound.json')).claude).toBe('A');
  });
  it('a file still empty or broken on the second read is no binding, after one more read only', () => {
    for (const text of ['', '{"sid":"main","claude":"A",', 'null']) {
      seat(text);
      race.boundReads = 0;
      expect(readBinding(wp(), 'main', NOW), text).toBeNull();
      expect(race.boundReads, text).toBe(2);
      expect(checkoutSid(wp(), NOW), text).toBeNull();
      expect(race.boundReads, text).toBe(4);
    }
  });
});
