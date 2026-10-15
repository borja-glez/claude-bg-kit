import { describe, it, expect } from 'vitest';
import { decodeView, encodeView } from '../src/page/urlstate.js';

describe('view state in the URL', () => {
  it('keeps debug=1 when the hash is rewritten (H-04)', () => {
    expect(encodeView({ view: 'notes', debug: true })).toBe('#v=notes&debug=1');
    expect(decodeView('#v=notes&debug=1')).toEqual({ view: 'notes', debug: true });
    expect(decodeView('#debug=0')).toEqual({});
  });
  it('round-trips what is set and writes nothing for the defaults', () => {
    expect(encodeView({ view: 'tracking', group: 'phase', zoom: '1d' })).toBe('');
    const v = { view: 'versions', group: 'session', span: 90 * 60000, pan: -30 * 60000, open: ['F1', 'S1'], status: ['blocked'], q: 'carrito', layers: ['critical'] };
    expect(decodeView(encodeView(v))).toEqual(v);
    expect(decodeView(encodeView({ zoom: '1w' }))).toEqual({ zoom: '1w' });
  });
  it('ignores junk and unknown values', () => {
    expect(decodeView('#z=9y&s=abc&o=<b>,F1&v=a%20b')).toEqual({ open: ['F1'] });
    expect(decodeView('')).toEqual({});
  });
});
