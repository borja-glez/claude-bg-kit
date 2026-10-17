// The page's state in the URL hash, so a link opens the same thing (spec §4.6, H-25): the view, the kind of the
// conversation, the open task and its tab, and in the schedule its grouping, zoom (a preset or a free span and pan), open
// groups, status filter, search and layers. Only what is set is written; links of before wave 4 still open the right view.
import type { Zoom } from '../lib/timeline.js';

export interface ViewState {
  view?: string; group?: string; zoom?: Zoom; span?: number; pan?: number;
  open?: string[]; status?: string[]; q?: string; layers?: string[]; debug?: boolean;
  /** H-25: the task whose detail is open (`t`) and its tab (`tt`); the kind of the conversation view (`c`). */
  task?: string; tab?: string; c?: string;
}

const ZOOMS: readonly string[] = ['6h', '1d', '3d', '1w', '1m'];
const ID = /^[\w.:@+-]{1,64}$/;
/** The schedule's parameters. A hash with some of them and no view is a link of the old default view, Tracking. */
const TIMELINE = ['s', 'z', 'o', 'f', 'l', 'g'];
const list = (v: string | null, max = 100) => (v ? v.split(',').filter(x => ID.test(x)).slice(0, max) : undefined);
const int = (v: string | null) => {
  if (v === null || !/^-?\d{1,14}$/.test(v)) return undefined;
  return Number(v);
};

export function encodeView(v: ViewState): string {
  const p = new URLSearchParams();
  if (v.view && v.view !== 'summary') p.set('v', v.view);
  if (v.view === 'talk' && v.c && v.c !== 'notes') p.set('c', v.c);
  if (v.view === 'schedule') {
    if (v.group && v.group !== 'phase') p.set('g', v.group);
    if (v.span) { p.set('s', String(Math.round(v.span / 60000))); if (v.pan) p.set('p', String(Math.round(v.pan / 60000))); }
    else if (v.zoom && v.zoom !== '1d') p.set('z', v.zoom);
    if (v.open?.length) p.set('o', v.open.join(','));
    if (v.status?.length) p.set('f', v.status.join(','));
    if (v.q) p.set('q', v.q.slice(0, 100));
    if (v.layers?.length) p.set('l', v.layers.join(','));
  }
  if (v.task) {
    p.set('t', v.task);
    if (v.tab && v.tab !== 'summary') p.set('tt', v.tab);
  }
  if (v.debug) p.set('debug', '1');
  const s = p.toString();
  return s ? `#${s}` : '';
}

export function decodeView(hash: string): ViewState {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const out: ViewState = {};
  const timeline = TIMELINE.some(k => p.has(k));
  const v = p.get('v');
  if (v && ID.test(v)) {
    // §4.6: the views of before wave 4.
    if (v === 'tracking') out.view = timeline ? 'schedule' : 'summary';
    else if (v === 'versions') out.view = 'plan';
    else if (v === 'notes' || v === 'proposals') { out.view = 'talk'; out.c = v; }
    else out.view = v;
  } else if (timeline) out.view = 'schedule';
  const c = p.get('c');
  if (!out.c && c && ID.test(c)) out.c = c;
  const g = p.get('g');
  if (g && ID.test(g)) out.group = g;
  const z = p.get('z');
  if (z && ZOOMS.includes(z)) out.zoom = z as Zoom;
  const s = int(p.get('s'));
  if (s && s > 0) { out.span = s * 60000; const pan = int(p.get('p')); if (pan !== undefined) out.pan = pan * 60000; }
  out.open = list(p.get('o'));
  out.status = list(p.get('f'), 10);
  const q = p.get('q');
  if (q) out.q = q.slice(0, 100);
  out.layers = list(p.get('l'), 10);
  const t = p.get('t');
  if (t && ID.test(t)) out.task = t;
  const tt = p.get('tt');
  if (out.task && tt && ID.test(tt)) out.tab = tt;
  if (p.get('debug') === '1') out.debug = true;
  for (const k of Object.keys(out) as (keyof ViewState)[]) if (out[k] === undefined) delete out[k];
  return out;
}
