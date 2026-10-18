// @vitest-environment happy-dom
// R2 (final review I2, carry 4b-1): the page is built from named sections, and a repaint skips the ones whose HTML did not
// change: they reach the morph as stubs, so it neither parses nor diffs them, and the page keeps their nodes as they are.
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { start } from '../src/page/app.js';
import { morphInto } from '../src/page/morph.js';
import { paintSections, section, stripSections } from '../src/page/sections.js';
import { renderApp, renderPage, TALK_FILTERS, VIEWS, type UiState } from '../src/page/render.js';
import { BIG_NOW, bigDocs, bigModel, bigRuns, bigSnapshot } from './fixtures/big-plan.js';

const flush = () => new Promise(r => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 5; i++) await flush(); };
beforeEach(() => { history.replaceState(null, '', location.pathname); });

type Cb = (snap: unknown) => void;
function fakeDb() {
  const subs = new Map<string, Cb>();
  const query = (path: string) => {
    const q = {
      orderBy: () => q, limit: () => q,
      onSnapshot: (cb: Cb) => { subs.set(path, cb); return () => subs.delete(path); },
      get: async () => ({ exists: false, data: () => undefined }), update: async () => {}, set: async () => {}, add: async () => ({ id: 'x' }),
    };
    return q;
  };
  const docs = (rows: Record<string, unknown>) => ({ docs: Object.entries(rows).map(([id, body]) => ({ id, exists: true, data: () => body })) });
  return { db: { doc: query, collection: query }, push: (path: string, rows: Record<string, unknown>) => subs.get(path)?.(path.startsWith('meta/') ? { exists: true, data: () => rows } : docs(rows)) };
}

/** The page on the big plan with every collection in, its clock in `clock.now`, and every HTML the morph was given. */
async function boot(hash: string) {
  history.replaceState(null, '', `${location.pathname}${hash}`);
  const f = fakeDb();
  const root = document.createElement('div');
  document.body.appendChild(root);
  const inputs: string[] = [];
  const clock = { now: BIG_NOW };
  const app = await start({ claude: { use: async (n: string) => (n === 'db' ? f.db : null) }, snapshot: bigSnapshot(BIG_NOW), root, now: () => clock.now, morph: (r, html) => { inputs.push(html); return morphInto(r, html); } });
  const docs = bigDocs(BIG_NOW);
  for (const [path, body] of Object.entries(docs.meta)) f.push(path, body as Record<string, unknown>);
  for (const [path, rows] of Object.entries(docs.coll)) f.push(path, rows);
  await settle();
  inputs.length = 0;
  return { root, app, inputs, clock, f };
}

/** Every change made inside `el` from now on (attributes, text, nodes). */
const watch = (el: Element) => {
  const seen: MutationRecord[] = [];
  const mo = new MutationObserver(recs => { seen.push(...recs); });
  mo.observe(el, { subtree: true, childList: true, attributes: true, characterData: true });
  return () => { seen.push(...mo.takeRecords()); mo.disconnect(); return seen; };
};
const STUB = ' data-morph="skip" data-stub>';

describe('paintSections (R2)', () => {
  const page = (nav: string, text: string) => `<div class="shell">${section('nav', `<nav class="side" data-scroll-key="side">${nav}</nav>`)}<main>${section('view', `<div class="vw"><p>${text}</p>${section('inner', '<section class="ins"><b>x</b></section>')}</div>`)}</main></div>`;

  it('a section the page holds as it is now goes as a stub of its element; one that changed goes whole, its own sections looked at in turn', () => {
    const one = new Map<string, string>();
    expect(paintSections(page('A', 'B'), new Map(), one)).toBe(stripSections(page('A', 'B')));
    expect([...one.keys()]).toEqual(['nav', 'view', 'inner']);
    const two = new Map<string, string>();
    expect(paintSections(page('A', 'C'), one, two)).toBe(`<div class="shell"><nav class="side" data-scroll-key="side"${STUB}</nav><main><div class="vw"><p>C</p><section class="ins"${STUB}</section></div></main></div>`);
    const three = new Map<string, string>();
    expect(paintSections(page('A', 'C'), two, three)).toBe(`<div class="shell"><nav class="side" data-scroll-key="side"${STUB}</nav><main><div class="vw"${STUB}</div></main></div>`);
    // The sections inside a stub are still in the page, as they were: the next repaint knows them.
    expect(three).toEqual(two);
    expect(three.get('inner')).toBe('<section class="ins"><b>x</b></section>');
  });

  it('renderApp is the page with every section whole and no mark', () => {
    const m = bigModel();
    const u = { zoom: '1d', offset: 0, expanded: new Set(), modal: 'T121', search: '', view: 'schedule', shot: null, timelineGroup: 'phase', fit: true, autoOpen: true, draft: { type: 'idea', text: '' }, answering: null, answerDraft: '', notice: null, proposalFilter: { status: 'all', category: 'all', risk: 'all' }, commenting: null, commentDraft: '', rejecting: null, reasonDraft: '' } as UiState;
    const html = renderApp(m, u);
    expect(html).not.toContain('<!--');
    expect(html).toBe(stripSections(renderPage(m, u)));
  });

  it('in every view, with the detail open, each section is one element: what a stub stands for', () => {
    const m = bigModel();
    const all = new Set(m.plan.phases.map(p => p.id));
    const base = { zoom: '1d' as const, offset: 0, expanded: all, planOpen: all, runsOpen: new Set(bigRuns().map(r => r.runId)), modal: 'T121', search: '', shot: null, timelineGroup: 'phase' as const, draft: { type: 'idea' as const, text: '' }, answering: null, answerDraft: '', notice: null, proposalFilter: { status: 'all' as const, category: 'all' as const, risk: 'all' as const }, commenting: null, commentDraft: '', rejecting: null, reasonDraft: '', layers: ['critical', 'forecast', 'forge'] };
    const names = new Set<string>();
    for (const [view, talk] of [...VIEWS.map(v => [v, 'all'] as const), ...TALK_FILTERS.map(c => ['talk', c] as const)]) {
      for (const fit of [true, false]) {
        const parts = new Map<string, string>();
        paintSections(renderPage(m, { ...base, view, talk, fit } as UiState), new Map(), parts);
        for (const [name, body] of parts) {
          names.add(name);
          const box = document.createElement('div');
          box.innerHTML = stripSections(body);
          expect(body.startsWith('<'), `${view}/${name}`).toBe(true);
          expect(box.children.length, `${view}/${name}`).toBe(1);
          expect(box.childNodes.length, `${view}/${name}`).toBe(1);
        }
      }
    }
    const rows = [...names].filter(n => /^[lr]\.[pt]\./.test(n));
    expect([...names].filter(n => !rows.includes(n)).sort()).toEqual(['detail', 'insights', 'mmbars', 'nav', 'strip', 'tl-bars', 'tl-labels', 'view']);
    expect(rows).toEqual(expect.arrayContaining(['l.p.F1', 'r.p.F1', 'l.t.T001', 'r.t.T001']));
  });
});

describe('morphInto with stubs (R2)', () => {
  it('a stub leaves the node the page has for it untouched, focus and scroll included', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    root.innerHTML = '<nav class="side" data-scroll-key="side"><button>a</button></nav><main><section class="ins"><ul data-scroll-key="zones"><li>z</li></ul><button class="f">f</button></section><p>1</p></main>';
    const ins = root.querySelector('.ins')!;
    const zones = root.querySelector('[data-scroll-key="zones"]') as HTMLElement;
    zones.scrollTop = 40;
    (root.querySelector('.f') as HTMLElement).focus();
    const done = watch(ins);
    morphInto(root, `<nav class="side" data-scroll-key="side"${STUB}</nav><main><section class="ins"${STUB}</section><p>2</p></main>`);
    expect(done()).toEqual([]);
    expect(root.querySelector('.ins')).toBe(ins);
    expect(root.querySelector('main p')!.textContent).toBe('2');
    expect(root.querySelector('nav')!.textContent).toBe('a');
    expect(zones.scrollTop).toBe(40);
    expect(document.activeElement).toBe(root.querySelector('.f'));
    expect(root.querySelector('[data-stub]')).toBeNull();
    root.remove();
  });

  it('a stub that finds no node of its own, or another section’s, makes the morph throw (the page then paints in full)', () => {
    const root = document.createElement('div');
    root.innerHTML = '<main><p>1</p></main>';
    expect(() => morphInto(root, `<main><section class="ins"${STUB}</section></main>`)).toThrow();
    root.innerHTML = '<main><section class="other"><b>x</b></section></main>';
    expect(() => morphInto(root, `<main><section class="ins"${STUB}</section></main>`)).toThrow();
  });

  it('a stub inside a new keyed node placeNew would move in, or a new keyed stub, goes through the same net (re-review N3)', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    for (const html of [
      `<div class="l"><div data-k="x"><section class="ins"${STUB}</section></div><i data-k="a"></i></div>`,
      `<div class="l"><i data-k="y"${STUB}</i><i data-k="a"></i></div>`,
    ]) {
      root.innerHTML = '<div class="l"><i data-k="a"></i></div>';
      expect(() => morphInto(root, html), html).toThrow();
    }
    // A new keyed node without a stub inside is still placed before its anchor, and nothing is left behind.
    root.innerHTML = '<div class="l"><i data-k="a"></i></div>';
    const a = root.querySelector('[data-k="a"]');
    morphInto(root, '<div class="l"><div data-k="x"><b>new</b></div><i data-k="a"></i></div>');
    expect(root.innerHTML).toBe('<div class="l"><div data-k="x"><b>new</b></div><i data-k="a"></i></div>');
    expect(root.querySelector('[data-k="a"]')).toBe(a);
    root.remove();
  });
});

describe('a repaint skips the sections that did not change (R2)', () => {
  it('a search key: the nav, the strip, the analysis and the minimap bars go as stubs and keep their nodes; the timeline updates', async () => {
    const { root, app, inputs } = await boot('#v=schedule');
    const kept = ['nav.side', '.strip', 'section.insights', 'g.mmb'].map(s => root.querySelector(s)!);
    const done = kept.map(watch);
    const box = root.querySelector('[data-role="search"]') as HTMLInputElement;
    box.value = 'Tarea sintética 12';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(inputs).toHaveLength(1);
    const html = inputs[0]!;
    expect(html).toMatch(/<nav class="side"[^>]* data-morph="skip" data-stub><\/nav>/);
    expect(html).toContain(`<div class="strip"${STUB}</div>`);
    expect(html).toContain(`<section class="insights"${STUB}</section>`);
    expect(html).toContain(`<g class="mmb"${STUB}</g>`);
    expect(html).not.toContain('data-role="burndown"');
    expect(html).not.toContain('<rect class="mb ');
    // A row the search keeps, on both sides, is not parsed again either; one it brings in is.
    const row = root.querySelector('[data-k="t:T121"]');
    expect(html).toContain(`<button class="tr tk" data-k="t:T121"${STUB}</button>`);
    expect(html).toContain(`<div class="rr" data-k="b:t:T121"${STUB}</div>`);
    expect(html).toContain('data-k="t:T012" title="');
    expect(root.querySelector('[data-k="t:T121"]')).toBe(row);
    expect(['nav.side', '.strip', 'section.insights', 'g.mmb'].map(s => root.querySelector(s))).toEqual(kept);
    expect(done.map(f => f())).toEqual([[], [], [], []]);
    expect(root.querySelector('[data-role="burndown"]')).not.toBeNull();
    expect(root.querySelectorAll('rect.mb').length).toBeGreaterThan(0);
    expect(root.querySelector('[data-stub]')).toBeNull();
    const rows = Array.from(root.querySelectorAll('.tr.tk .lab'), x => x.textContent ?? '');
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.every(t => t.includes('Tarea sintética 12'))).toBe(true);
    app.stop();
  });

  it('a pan step: the window moves over the bars the minimap kept; the analysis, the strip and the nav are not parsed', async () => {
    const { root, app, inputs } = await boot('#v=schedule');
    const ins = root.querySelector('section.insights');
    const bars = root.querySelector('g.mmb');
    const view = root.querySelector('.mm .mv')!.getAttribute('x');
    (root.querySelector('[data-action="shift"][data-dir="1"]') as HTMLElement).click();
    await settle();
    expect(app.ui.span).toBeGreaterThan(0);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toContain(`<section class="insights"${STUB}</section>`);
    expect(inputs[0]).toContain(`<g class="mmb"${STUB}</g>`);
    expect(inputs[0]).toContain(`<div class="strip"${STUB}</div>`);
    // The labels of the rows do not move with the window.
    expect(inputs[0]).toContain(`<div class="l"${STUB}</div>`);
    expect(root.querySelector('section.insights')).toBe(ins);
    expect(root.querySelector('g.mmb')).toBe(bars);
    expect(root.querySelector('.mm .mv')!.getAttribute('x')).not.toBe(view);
    expect(root.querySelector('[data-stub]')).toBeNull();
    app.stop();
  });

  it('opening a task from Plan and from the schedule paints the detail alone: the view goes as a stub', async () => {
    for (const hash of ['#v=plan', '#v=schedule']) {
      const { root, app, inputs, f } = await boot(hash);
      const view = root.querySelector('.vw')!;
      const done = watch(view);
      (root.querySelector('.vw [data-action="open-task"][data-id="T121"]') as HTMLElement).click();
      await settle();
      expect(app.ui.modal, hash).toBe('T121');
      expect(inputs, hash).toHaveLength(1);
      expect(inputs[0], hash).toContain(`<div class="vw"${STUB}</div>`);
      expect(inputs[0], hash).toContain(`<div class="strip"${STUB}</div>`);
      expect(inputs[0], hash).toContain('role="dialog"');
      expect(root.querySelector('.vw'), hash).toBe(view);
      expect(done(), hash).toEqual([]);
      expect(document.activeElement, hash).toBe(root.querySelector('#dtab-summary'));
      // A snapshot that changes nothing the page shows paints nothing: the detail goes as a stub too, focus kept.
      inputs.length = 0;
      const overlay = root.querySelector('.overlay');
      f.push('state', bigDocs(BIG_NOW).coll.state);
      await settle();
      expect(inputs, hash).toHaveLength(1);
      expect(inputs[0], hash).toContain(`<div class="overlay" data-scroll-key="modal:T121"${STUB}</div>`);
      expect(root.querySelector('.overlay'), hash).toBe(overlay);
      expect(document.activeElement, hash).toBe(root.querySelector('#dtab-summary'));
      app.stop();
      root.remove();
    }
  });

  it('a snapshot that changes the plan’s progress repaints the strip; the sections it does not touch stay stubs', async () => {
    const { root, app, inputs, f } = await boot('#v=schedule');
    const before = root.querySelector('.strip .sv')!.textContent;
    const state = bigDocs(BIG_NOW).coll.state as Record<string, { status: string }>;
    f.push('state', { ...state, T121: { status: 'done' }, T122: { status: 'done' }, T123: { status: 'done' } });
    await settle();
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).not.toContain(`<div class="strip"${STUB}`);
    expect(inputs[0]).toMatch(/<nav class="side"[^>]* data-morph="skip" data-stub><\/nav>/);
    expect(root.querySelector('.strip .sv')!.textContent).not.toBe(before);
    expect(root.querySelector('[data-stub]')).toBeNull();
    app.stop();
  });

  it('the focus and the scroll inside a skipped section survive the repaint around it', async () => {
    const { root, app, inputs } = await boot('#v=schedule');
    const link = root.querySelector('section.insights [data-k^="cp:"]') as HTMLElement;
    const zones = root.querySelector('[data-scroll-key="zones"]') as HTMLElement;
    link.focus();
    zones.scrollTop = 40;
    (root.querySelector('[data-action="shift"][data-dir="1"]') as HTMLElement).click();
    await settle();
    expect(inputs[0]).toContain(`<section class="insights"${STUB}</section>`);
    expect(document.activeElement).toBe(link);
    expect(root.querySelector('[data-scroll-key="zones"]')).toBe(zones);
    expect(zones.scrollTop).toBe(40);
    app.stop();
  });

  it('a field focused while its section repainted takes what the render says once it loses the focus (re-review N1)', async () => {
    const { root, app, inputs, f } = await boot('#v=schedule');
    const sel = root.querySelector('select[data-action="burn-scope"]') as HTMLSelectElement;
    const labels = () => Array.from(sel.options, o => o.textContent ?? '');
    sel.focus();
    const plan = bigDocs(BIG_NOW).coll.plan as Record<string, { name: string }>;
    f.push('plan', { ...plan, F1: { ...plan.F1!, name: 'Fase uno renombrada' } });
    await settle();
    // While focused, the select keeps the options the person has open; its section is painted (not a stub).
    expect(root.querySelector('select[data-action="burn-scope"]')).toBe(sel);
    expect(document.activeElement).toBe(sel);
    expect(inputs.at(-1)).not.toContain(`<section class="insights"${STUB}`);
    expect(labels().some(l => l.includes('Fase uno renombrada'))).toBe(false);
    inputs.length = 0;
    sel.blur();
    await settle();
    // One repaint, which does not skip the section that held it.
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).not.toContain(`<section class="insights"${STUB}`);
    expect(labels().some(l => l.includes('Fase uno renombrada'))).toBe(true);
    // The strip, which did not hold it, is still skipped.
    expect(inputs[0]).toContain(`<div class="strip"${STUB}</div>`);
    // A field whose section never changed while focused costs nothing on blur.
    const box = root.querySelector('[data-role="search"]') as HTMLInputElement;
    box.focus();
    inputs.length = 0;
    box.blur();
    await settle();
    expect(inputs).toHaveLength(0);
    app.stop();
  });

  it('the 30 s tick keeps rewriting the times inside a skipped section, and the next repaint that changes it agrees', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const { root, app, inputs, clock } = await boot('#v=runs');
      const dur = () => root.querySelector('.vw [data-k="t:T121"] [data-rel="dur"]') as HTMLElement;
      const synced = () => root.querySelector('.strip [data-rel="ago"]') as HTMLElement;
      const first = dur().textContent;
      (root.querySelector('.vw [data-k="t:T121"]') as HTMLElement).click();
      await settle();
      expect(inputs[0]).toContain(`<div class="vw"${STUB}</div>`);
      expect(inputs[0]).toContain(`<div class="strip"${STUB}</div>`);
      const cell = dur();
      clock.now = BIG_NOW + 10 * 60000;
      vi.advanceTimersByTime(30000);
      expect(dur()).toBe(cell);
      expect(cell.textContent).not.toBe(first);
      expect(synced().textContent).toBe('hace 10 min');
      const ticked = cell.textContent;
      // Closing the detail repaints the view at the new time: the text the render gives is the one the tick wrote.
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await settle();
      expect(app.ui.modal).toBeNull();
      expect(dur().textContent).toBe(ticked);
      app.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
