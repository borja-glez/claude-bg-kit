// @vitest-environment happy-dom
// H-06: the page morphs its HTML with morphdom: what did not change keeps its node, its scroll and its focus.
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { start } from '../src/page/app.js';
import { BIG_NOW, bigDocs, bigSnapshot } from './fixtures/big-plan.js';

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
  it('a snapshot keeps the scroll of the timeline, the node of an unchanged row and the arrows drawn by hand', async () => {
    const { root, app, move } = await boot();
    const tlw = root.querySelector('[data-role="timeline"]') as HTMLElement;
    tlw.scrollTop = 300;
    const row = root.querySelector('[data-k="t:T044"]');
    expect(row).not.toBeNull();
    root.querySelector('[data-role="tl-arrows"]')!.innerHTML = '<path class="up" d="M0 0L5 5"/>';
    move('verify');
    await settle();
    expect(root.querySelector('[data-role="timeline"]')).toBe(tlw);
    expect(tlw.scrollTop).toBe(300);
    expect(root.querySelector('[data-k="t:T044"]')).toBe(row);
    expect(root.querySelector('[data-role="tl-arrows"]')!.innerHTML).toContain('class="up"');
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
});
