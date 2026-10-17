import { describe, it, expect } from 'vitest';
import { decodeView, encodeView } from '../src/page/urlstate.js';
import { MAX_PAN, MAX_SPAN, MIN_SPAN } from '../src/lib/timeline.js';

describe('view state in the URL (§4.6, H-25)', () => {
  it('keeps debug=1 when the hash is rewritten (H-04)', () => {
    expect(encodeView({ view: 'talk', debug: true })).toBe('#v=talk&debug=1');
    expect(decodeView('#v=talk&debug=1')).toEqual({ view: 'talk', debug: true });
    expect(decodeView('#debug=0')).toEqual({});
  });
  it('round-trips what is set and writes nothing for the defaults', () => {
    expect(encodeView({ view: 'summary', group: 'phase', zoom: '1d', c: 'notes' })).toBe('');
    const v = { view: 'schedule', group: 'session', span: 90 * 60000, pan: -30 * 60000, open: ['F1', 'S1'], status: ['blocked'], q: 'carrito', layers: ['critical'] };
    expect(decodeView(encodeView(v))).toEqual(v);
    expect(decodeView(encodeView({ view: 'schedule', zoom: '1w' }))).toEqual({ view: 'schedule', zoom: '1w' });
    expect(decodeView(encodeView({ view: 'talk', c: 'proposals' }))).toEqual({ view: 'talk', c: 'proposals' });
  });
  it('writes the timeline only in the schedule, and the open task with its tab anywhere', () => {
    expect(encodeView({ view: 'summary', zoom: '1w', open: ['F1'], q: 'x' })).toBe('');
    expect(encodeView({ view: 'summary', task: 'T044' })).toBe('#t=T044');
    expect(encodeView({ view: 'plan', task: 'T044', tab: 'forge' })).toBe('#v=plan&t=T044&tt=forge');
    expect(encodeView({ view: 'summary', task: 'T044', tab: 'summary' })).toBe('#t=T044');
    expect(decodeView('#t=T044&tt=forge')).toEqual({ task: 'T044', tab: 'forge' });
  });
  it('an old link opens the view that replaced its own', () => {
    expect(decodeView('#v=versions')).toEqual({ view: 'plan' });
    expect(decodeView('#v=tracking&z=1w')).toEqual({ view: 'schedule', zoom: '1w' });
    expect(decodeView('#v=tracking')).toEqual({ view: 'summary' });
    expect(decodeView('#v=notes')).toEqual({ view: 'talk', c: 'notes' });
    expect(decodeView('#v=proposals&debug=1')).toEqual({ view: 'talk', c: 'proposals', debug: true });
    // The old default view (Tracking) wrote no v: its timeline parameters still open the schedule.
    expect(decodeView('#g=track&o=F1')).toEqual({ view: 'schedule', group: 'track', open: ['F1'] });
  });
  it('bounds a hand-edited span and pan: the span within the zoom limits, the pan within ten years (review M5)', () => {
    expect(decodeView('#v=schedule&s=1440&p=99999999999999')).toEqual({ view: 'schedule', span: 1440 * 60000, pan: MAX_PAN });
    expect(decodeView('#v=schedule&s=1440&p=-99999999999999').pan).toBe(-MAX_PAN);
    expect(decodeView('#v=schedule&s=1&p=0')).toEqual({ view: 'schedule', span: MIN_SPAN, pan: 0 });
    expect(decodeView('#v=schedule&s=99999999999999').span).toBe(MAX_SPAN);
    expect(MAX_PAN).toBe(10 * 365 * 24 * 3600000);
  });
  it('ignores junk and unknown values', () => {
    expect(decodeView('#z=9y&s=abc&o=<b>,F1&v=a%20b')).toEqual({ view: 'schedule', open: ['F1'] });
    expect(decodeView('#t=../x&tt=a%20b&c=<i>')).toEqual({});
    expect(decodeView('')).toEqual({});
  });
});
