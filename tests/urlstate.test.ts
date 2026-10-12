import { describe, it, expect } from 'vitest';
import { decodeView, encodeView } from '../src/page/urlstate.js';

describe('view state in the URL', () => {
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
