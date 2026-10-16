import { describe, it, expect } from 'vitest';
import { seatsOf } from '../src/mod/model.js';

const NOW = Date.parse('2026-10-15T12:00:00.000Z');
const at = (min: number) => new Date(NOW + min * 60000).toISOString();
const b = (sid: string, claude: string, over: object = {}) =>
  JSON.stringify({ sid, claude, pid: null, via: 'work', since: at(-60), seenAt: at(-1), endedAt: null, endReason: null, ...over });

describe('seatsOf (C3): the seats as the band reads them, as readSeats does on disk', () => {
  it('the checkout seat takes its id from session.json, else from its own binding', () => {
    const session = JSON.stringify({ sessionId: 'backend' });
    expect(seatsOf({ session, bindings: { '.': b('backend', 'A') } }, NOW))
      .toEqual([{ sid: 'backend', checkout: true, bound: JSON.parse(b('backend', 'A')), session }]);
    expect(seatsOf({ bindings: { '.': b('main', 'A') } }, NOW)).toMatchObject([{ sid: 'main', checkout: true, bound: { claude: 'A' } }]);
    expect(seatsOf({ bindings: {} }, NOW)).toEqual([]);
  });
  it('a binding that names another seat, does not read or comes from the future is none; the seat stays', () => {
    const bound = (text: string) => seatsOf({ session: JSON.stringify({ sessionId: 'main' }), bindings: { '.': text } }, NOW)[0]?.bound;
    expect(bound(b('main-9', 'A'))).toBeNull();
    expect(bound('{oops')).toBeNull();
    expect(bound(b('main', 'A', { seenAt: at(10) }))).toBeNull();
  });
  it("extra seats: by name, at most MAX_SEATS, never the checkout seat's own id, each with its session.json", () => {
    const bindings: Record<string, string> = { '.': b('main', 'A'), main: b('main', 'Z') };
    for (let n = 2; n <= 14; n++) bindings[`main-${n}`] = b(`main-${n}`, `C${n}`);
    const seats = seatsOf({ session: JSON.stringify({ sessionId: 'main' }), bindings, seatSessions: { 'main-2': JSON.stringify({ sessionId: 'main-2', track: 'ui' }) } }, NOW);
    expect(seats).toHaveLength(11);
    expect(seats.filter(x => x.sid === 'main')).toEqual([expect.objectContaining({ checkout: true, bound: expect.objectContaining({ claude: 'A' }) })]);
    expect(seats.find(x => x.sid === 'main-2')?.session).toContain('"track":"ui"');
    expect(seatsOf({ bindings: { 'a b': b('a b', 'A') } }, NOW)).toEqual([]);
  });
});
