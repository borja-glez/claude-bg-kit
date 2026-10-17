// @vitest-environment happy-dom
// H-06: the page morphs its HTML with morphdom: what did not change keeps its node, its scroll and its focus.
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { start } from '../src/page/app.js';
import { morphInto, nodeKey } from '../src/page/morph.js';
import { renderApp, VIEWS, type UiState } from '../src/page/render.js';
import { BIG_NOW, bigDocs, bigModel, bigSnapshot } from './fixtures/big-plan.js';

const flush = () => new Promise(r => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 5; i++) await flush(); };
// The schedule with phases F2 (T024–T046) and F6 (T116–T138, the running ones) open; before Task 5, the same hash opens
// the old Tracking view, which has the same timeline.
beforeEach(() => { history.replaceState(null, '', `${location.pathname}#v=schedule&o=F2,F6`); });

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
  return { db: { doc: query, collection: query }, push: (path: string, rows: Record<string, unknown>) => subs.get(path)?.(docs(rows)) };
}

async function boot(over: { morph?: (root: HTMLElement, html: string) => void } = {}) {
  const f = fakeDb();
  const root = document.createElement('div');
  document.body.appendChild(root);
  const app = await start({ claude: { use: async (n: string) => (n === 'db' ? f.db : null) }, snapshot: bigSnapshot(BIG_NOW), root, now: () => BIG_NOW, ...over });
  const state = bigDocs(BIG_NOW).coll.state as Record<string, { exec?: Record<string, unknown> }>;
  f.push('state', state);
  await settle();
  /** A new snapshot of state where T121 moved to another stage. */
  const move = (stage: string) => { state.T121 = { ...state.T121, exec: { ...state.T121!.exec, stage } }; f.push('state', { ...state }); };
  return { root, app, move };
}

describe('the page morphs instead of replacing (H-06)', () => {
  it('a snapshot keeps the scroll of the timeline and the node of an unchanged row, and empties the arrows drawn by hand', async () => {
    const { root, app, move } = await boot();
    const tlw = root.querySelector('[data-role="timeline"]') as HTMLElement;
    tlw.scrollTop = 300;
    const row = root.querySelector('[data-k="t:T044"]');
    expect(row).not.toBeNull();
    const arrows = root.querySelector('[data-role="tl-arrows"]')!;
    arrows.innerHTML = '<path class="up" d="M0 0L5 5"/>';
    move('verify');
    await settle();
    expect(root.querySelector('[data-role="timeline"]')).toBe(tlw);
    expect(tlw.scrollTop).toBe(300);
    expect(root.querySelector('[data-k="t:T044"]')).toBe(row);
    // The layer stays, empty: arrows drawn before a repaint point at where the rows were.
    expect(root.querySelector('[data-role="tl-arrows"]')).toBe(arrows);
    expect(arrows.innerHTML).toBe('');
    app.stop();
  });

  it('the arrows of a hovered task and its highlights go with a repaint and come back on the next pointerover (carry 4)', async () => {
    const { root, app, move } = await boot();
    const hover = () => root.querySelector('[data-k="t:T122"] .lab')!.dispatchEvent(new Event('pointerover', { bubbles: true }));
    const lit = () => root.querySelectorAll('.dep-up,.dep-down,.dep-self').length;
    hover();
    const arrows = root.querySelector('[data-role="tl-arrows"]')!;
    expect(arrows.innerHTML).toContain('class="up"');
    expect(lit()).toBeGreaterThan(0);
    move('verify');
    await settle();
    expect(arrows.innerHTML).toBe('');
    expect(lit()).toBe(0);
    hover();
    expect(arrows.innerHTML).toContain('class="up"');
    expect(lit()).toBeGreaterThan(0);
    app.stop();
  });

  it('opening a dependency from a scrolled detail starts the new detail at the top', async () => {
    const { root, app } = await boot();
    (root.querySelector('[data-k="t:T122"]') as HTMLElement).click();
    await settle();
    const overlay = root.querySelector('[data-scroll-key="modal:T122"]') as HTMLElement;
    overlay.scrollTop = 240;
    (root.querySelector('.modal .chip[data-action="open-task"][data-id="T121"]') as HTMLElement).click();
    await settle();
    const now = root.querySelector('.overlay') as HTMLElement;
    expect(now.getAttribute('data-scroll-key')).toBe('modal:T121');
    expect(now).not.toBe(overlay);
    expect(now.scrollTop).toBe(0);
    app.stop();
  });

  it('the search box keeps its focus, its text and its selection across a snapshot', async () => {
    const { root, app, move } = await boot();
    const input = root.querySelector('[data-role="search"]') as HTMLInputElement;
    input.focus();
    input.value = 'Tarea';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    input.setSelectionRange(1, 3);
    move('review');
    await settle();
    expect(root.querySelector('[data-role="search"]')).toBe(input);
    expect(document.activeElement).toBe(input);
    expect([input.value, input.selectionStart, input.selectionEnd]).toEqual(['Tarea', 1, 3]);
    app.stop();
  });

  it('a focused <select> stays the same element, focused, while a snapshot paints around it', async () => {
    const { root, app, move } = await boot();
    const sel = root.querySelector('select[data-action="burn-scope"]') as HTMLSelectElement;
    sel.focus();
    move('verdict');
    await settle();
    expect(root.querySelector('select[data-action="burn-scope"]')).toBe(sel);
    expect(document.activeElement).toBe(sel);
    app.stop();
  });

  it('with the detail of T121 open and scrolled, a snapshot that moves its stage repaints it at once, with no ↻', async () => {
    const { root, app, move } = await boot();
    (root.querySelector('[data-k="t:T121"]') as HTMLElement).click();
    await settle();
    const overlay = root.querySelector('[data-scroll-key="modal:T121"]') as HTMLElement;
    overlay.scrollTop = 240;
    const close = root.querySelector('.modal [data-action="close-modal"]') as HTMLButtonElement;
    close.focus();
    move('verify');
    await settle();
    expect(root.querySelector('.modal')!.textContent).toContain('verificar');
    expect(root.querySelector('[data-scroll-key="modal:T121"]')).toBe(overlay);
    expect(overlay.scrollTop).toBe(240);
    expect(document.activeElement).toBe(close);
    expect(root.querySelector('[data-action="refresh"]')).toBeNull();
    expect(root.innerHTML).not.toContain('↻');
    app.stop();
  });

  it('when morph throws, the page replaces its HTML as before and says so in the console (§4.11)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { root, app } = await boot({ morph: () => { throw new Error('boom'); } });
    expect(root.querySelector('.shell')).not.toBeNull();
    expect(root.innerHTML).toContain('BIG-PLAN');
    expect(err).toHaveBeenCalledWith('[waypoint] morph failed', expect.any(Error));
    err.mockRestore();
    app.stop();
  });

  it('when morph throws, the full replace puts back the scroll of every keyed container, the focus and caret of a text box and the timeline focus', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { root, app, move } = await boot({ morph: () => { throw new Error('boom'); } });
    const first = root.querySelector('[data-role="search"]') as HTMLInputElement;
    first.focus();
    first.value = 'Tarea';
    first.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    const input = root.querySelector('[data-role="search"]') as HTMLInputElement;
    expect(input).not.toBe(first);
    input.setSelectionRange(1, 3);
    const tlw = root.querySelector('[data-role="timeline"]') as HTMLElement;
    tlw.scrollTop = 300;
    move('review');
    await settle();
    const input2 = root.querySelector('[data-role="search"]') as HTMLInputElement;
    const tlw2 = root.querySelector('[data-role="timeline"]') as HTMLElement;
    expect(input2).not.toBe(input);
    expect(tlw2).not.toBe(tlw);
    expect(tlw2.scrollTop).toBe(300);
    expect(document.activeElement).toBe(input2);
    expect([input2.value, input2.selectionStart, input2.selectionEnd]).toEqual(['Tarea', 1, 3]);
    tlw2.focus();
    move('verify');
    await settle();
    const tlw3 = root.querySelector('[data-role="timeline"]') as HTMLElement;
    expect(tlw3).not.toBe(tlw2);
    expect(document.activeElement).toBe(tlw3);
    err.mockRestore();
    app.stop();
  });

  it('with the Forge tab of the detail active and focused, a snapshot keeps the tab, its focus and the overlay scroll', async () => {
    const { root, app, move } = await boot();
    (root.querySelector('[data-k="t:T121"]') as HTMLElement).click();
    await settle();
    (root.querySelector('[data-action="detail-tab"][data-tab="forge"]') as HTMLElement).click();
    await settle();
    const tab = root.querySelector('#dtab-forge') as HTMLElement;
    expect(document.activeElement).toBe(tab);
    const overlay = root.querySelector('[data-scroll-key="modal:T121"]') as HTMLElement;
    overlay.scrollTop = 180;
    move('verdict');
    await settle();
    expect(root.querySelector('#dtab-forge')).toBe(tab);
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tab);
    expect(overlay.scrollTop).toBe(180);
    expect(root.querySelector('#dpanel-summary')!.textContent).toContain('veredicto');
    app.stop();
  });
});

describe('morph keys (review M2)', () => {
  it('in every view, with the detail open, no two nodes share a morph key (morphdom keeps only one of them)', () => {
    const m = bigModel();
    m.notes = [...m.notes, { id: 'na', ts: '2026-10-16T10:00:00.000Z', type: 'idea', author: 'session:main', text: 'una', taskId: 'T121' }, { id: 'nb', ts: '2026-10-16T10:05:00.000Z', type: 'idea', author: 'session:main', text: 'otra', taskId: 'T121' }];
    m.proposals = [...m.proposals, { ...m.proposals[0]!, id: 'p2', evidence: 'más' }];
    const all = new Set(m.plan.phases.map(p => p.id));
    const base = { zoom: '1d' as const, offset: 0, expanded: all, modal: 'T121', search: '', shot: null, versionFilter: { statuses: [], phaseStatuses: [], track: null }, collapsed: new Set<string>(), noteFilter: 'all' as const, timelineGroup: 'phase' as const, draft: { type: 'idea' as const, text: '' }, answering: null, answerDraft: '', notice: null, proposalFilter: { status: 'all' as const, category: 'all' as const, risk: 'all' as const }, commenting: null, commentDraft: '', rejecting: null, reasonDraft: '', layers: ['critical', 'forge'] };
    for (const [view, talk] of [...VIEWS.map(v => [v, 'notes'] as const), ['talk', 'proposals'] as const]) {
      const box = document.createElement('div');
      box.innerHTML = renderApp(m, { ...base, view, talk } as UiState);
      const keys = Array.from(box.querySelectorAll('*')).map(nodeKey).filter((k): k is string => !!k);
      const twice = keys.filter((k, i) => keys.indexOf(k) !== i);
      expect(twice, `${view}/${talk}`).toEqual([]);
      expect(keys.length, view).toBeGreaterThan(5);
    }
  });
});

describe('morphInto (H-06)', () => {
  const mount = (html: string) => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    root.innerHTML = html;
    return root;
  };

  it('a focused field keeps its value and selection; the render\'s readonly, disabled, placeholder, maxlength and aria-* reach it', () => {
    const root = mount('<textarea data-role="note-text" placeholder="a" maxlength="10" aria-invalid="true"></textarea>');
    const box = root.querySelector('textarea')!;
    box.focus();
    box.value = 'borrador';
    box.setSelectionRange(2, 5);
    morphInto(root, '<textarea data-role="note-text" placeholder="b" maxlength="20" readonly disabled aria-label="Nota">otro</textarea>');
    expect(root.querySelector('textarea')).toBe(box);
    expect([box.value, box.selectionStart, box.selectionEnd]).toEqual(['borrador', 2, 5]);
    expect([box.readOnly, box.disabled, box.placeholder, box.maxLength]).toEqual([true, true, 'b', 20]);
    expect([box.getAttribute('aria-label'), box.hasAttribute('aria-invalid')]).toEqual(['Nota', false]);
    root.remove();
  });

  it('fields the person changed are set back to the render even when the markup did not change', () => {
    const html = '<div class="c"><textarea data-role="note-text"></textarea><input data-role="search" value="q"><select><option value="a">a</option><option value="b" selected>b</option></select></div>';
    const root = mount(html);
    const [box, input, sel] = [root.querySelector('textarea')!, root.querySelector('input')!, root.querySelector('select')!];
    box.value = 'escrito';
    input.value = 'otra';
    sel.value = 'a';
    morphInto(root, html);
    expect([root.querySelector('textarea'), root.querySelector('input'), root.querySelector('select')]).toEqual([box, input, sel]);
    expect([box.value, input.value, sel.value]).toEqual(['', 'q', 'b']);
    root.remove();
  });

  // Review M3: morphdom, given a keyed node it does not find in the page, walks on through the following siblings, sets
  // each one aside and appends them again after the new one: an item new at the top of a list moved every item under it.
  it('a keyed item inserted above keyed siblings leaves them in place: never removed, and a focused textarea keeps its focus with no blur (review M3)', async () => {
    const card = (id: string) => `<div class="note" data-k="n:${id}"><p>${id}</p><pre class="evid" data-scroll-key="evid:${id}">x</pre><textarea data-role="answer-text"></textarea></div>`;
    const list = (ids: string[]) => `<div class="ngrid">${ids.map(card).join('')}</div>`;
    const root = mount(list(['a', 'b', 'c', 'd']));
    const before = Array.from(root.querySelectorAll('.note'));
    const box = root.querySelector('[data-k="n:c"] textarea') as HTMLTextAreaElement;
    box.focus();
    box.value = 'escribiendo';
    let blurs = 0;
    box.addEventListener('blur', () => { blurs++; });
    const removed: string[] = [];
    const mo = new MutationObserver(recs => { for (const r of recs) for (const n of Array.from(r.removedNodes)) removed.push((n as Element).getAttribute?.('data-k') ?? n.nodeName); });
    mo.observe(root, { childList: true, subtree: true });
    morphInto(root, list(['new', 'a', 'b', 'c', 'd']));
    await new Promise(r => setTimeout(r, 0));
    mo.disconnect();
    expect(removed).toEqual([]);
    const after = Array.from(root.querySelectorAll('.note'));
    expect(after.map(n => n.getAttribute('data-k'))).toEqual(['n:new', 'n:a', 'n:b', 'n:c', 'n:d']);
    expect(after.slice(1)).toEqual(before);
    expect(document.activeElement).toBe(box);
    expect(box.value).toBe('escribiendo');
    expect(blurs).toBe(0);
    root.remove();
  });

  it('whatever the change of a keyed list, the page ends up exactly as the render says, with no stand-in left (review M3)', () => {
    const item = (id: string, inner = '') => `<div data-k="k:${id}"><b>${id}</b>${inner}</div>`;
    const ul = (ids: string[], key = 'l') => `<section data-scroll-key="${key}">${ids.map(i => item(i)).join('')}</section>`;
    const cases: [string, string][] = [
      [ul(['a', 'b', 'c']), ul(['x', 'y', 'a', 'b', 'c'])],
      [ul(['a', 'b', 'c']), ul(['a', 'x', 'b', 'c'])],
      [ul(['a', 'b', 'c']), ul(['a', 'b', 'c', 'x'])],
      [ul(['a', 'b', 'c']), ul(['x', 'a', 'c'])],
      [ul(['a', 'b', 'c']), ul(['c', 'x', 'a'])],
      [ul(['a', 'b', 'c']), ul(['b', 'a', 'c'])],
      [ul(['a', 'b']), `<p>texto</p>${ul(['x', 'a', 'b'])}`],
      [ul(['a', 'b']) + ul(['c'], 'm'), ul(['b']) + ul(['x', 'a', 'c'], 'm')],
      [ul(['a', 'b']), `<section data-scroll-key="l">${item('w', item('x') + item('a'))}${item('b')}</section>`],
      [ul(['a', 'b', 'c']), `<section data-scroll-key="l">${item('w', item('x') + item('b'))}${item('c')}</section>`],
      [ul(['a', 'b', 'c']), `<section data-scroll-key="l">${item('y')}${item('w', item('x') + item('b'))}${item('a')}${item('c')}</section>`],
      [ul(['a', 'b']), `<section data-scroll-key="l"><div>${item('x')}${item('a')}</div>${item('b')}</section>`],
      [ul(['a', 'b']), `<section data-scroll-key="l"><i>u</i>${item('x')}<i>v</i>${item('a')}${item('b')}</section>`],
      [ul(['a', 'b']), `<section data-scroll-key="l">${item('x')} ${item('a')} ${item('b')}</section>`],
      [ul(['a', 'b']), `<section data-scroll-key="other">${item('x')}${item('a')}</section>`],
      ['<div data-morph="skip"></div>' + ul(['a']), '<div data-morph="skip"></div>' + ul(['x', 'a'])],
    ];
    for (const [from, to] of cases) {
      const root = mount(from);
      morphInto(root, to);
      const want = document.createElement('div');
      want.innerHTML = to;
      expect(root.innerHTML, `${from} → ${to}`).toBe(want.innerHTML);
      root.remove();
    }
  });

  it('the live state of the fields is read once per morph, not once per unchanged node (carry 4)', () => {
    const m = bigModel();
    const all = new Set(m.plan.phases.map(p => p.id));
    const ui = { zoom: '1d' as const, offset: 0, expanded: all, modal: null, search: '', view: 'schedule' as const, shot: null, versionFilter: { statuses: [], phaseStatuses: [], track: null }, collapsed: new Set<string>(), noteFilter: 'all' as const, timelineGroup: 'phase' as const, draft: { type: 'idea' as const, text: '' }, answering: null, answerDraft: '', notice: null, proposalFilter: { status: 'all' as const, category: 'all' as const, risk: 'all' as const }, commenting: null, commentDraft: '', rejecting: null, reasonDraft: '' } as UiState;
    const root = mount(renderApp(m, ui));
    // One row's title changes: every other row, card and section is equal to its render.
    const changed = { ...m, plan: { ...m.plan, tasks: m.plan.tasks.map(t => (t.id === 'T030' ? { ...t, title: 'otro título' } : t)) } };
    const spy = vi.spyOn(Element.prototype, 'querySelectorAll');
    morphInto(root, renderApp(changed, ui));
    const calls = spy.mock.calls.length;
    spy.mockRestore();
    expect(root.querySelector('[data-k="t:T030"]')!.textContent).toContain('otro título');
    expect(calls).toBeLessThanOrEqual(4);
    root.remove();
  });

  it('nodes are matched by data-k, else by data-scroll-key, never by position', () => {
    const root = mount('<div class="l"><div data-k="pr:p1"><button>p1</button></div></div><div data-scroll-key="modal:T1">uno</div>');
    const [card, overlay] = [root.querySelector('[data-k="pr:p1"]'), root.querySelector('[data-scroll-key]')];
    morphInto(root, '<div class="l"><div data-k="pr:p0"><button>p0</button></div><div data-k="pr:p1"><button>p1</button></div></div><div data-scroll-key="modal:T2">dos</div>');
    expect(root.querySelector('[data-k="pr:p1"]')).toBe(card);
    expect(root.querySelector('[data-k="pr:p0"]')).not.toBe(card);
    expect(root.querySelector('[data-scroll-key="modal:T2"]')).not.toBe(overlay);
    expect(nodeKey(overlay!)).toBe('modal:T1');
    root.remove();
  });
});
