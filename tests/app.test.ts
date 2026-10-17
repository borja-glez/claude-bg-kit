// @vitest-environment happy-dom
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePlan } from '../src/lib/plan.js';
import { buildDocs } from '../src/lib/sync.js';
import { start, type Snapshot } from '../src/page/app.js';

const plan = parsePlan(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'plan.yaml'), 'utf8'));
const snapshot: Snapshot = buildDocs(plan, '2026-10-11T09:00:00Z');
const NOW = Date.parse('2026-10-11T12:00:00Z');
const flush = () => new Promise(r => setTimeout(r, 0));
// The page keeps its view in the URL hash: each test starts from a clean one.
beforeEach(() => { history.replaceState(null, '', location.pathname); });

type Cb = (snap: unknown) => void;
function fakeDb() {
  const subs = new Map<string, Cb>();
  const errs = new Map<string, (e: unknown) => void>();
  const stored: Record<string, Record<string, unknown>> = {};
  const add = vi.fn(async (_data: unknown) => ({ id: 'new' }));
  const get = vi.fn(async (p: string) => ({ exists: p in stored, data: () => stored[p] }));
  const update = vi.fn(async (_p: string, _data: unknown) => {});
  const query = (path: string) => {
    const q = {
      orderBy: () => q,
      limit: () => q,
      onSnapshot: (cb: Cb, err: (e: unknown) => void) => { subs.set(path, cb); errs.set(path, err); return () => subs.delete(path); },
      add: (data: unknown) => add(data),
      get: () => get(path),
      update: (data: unknown) => update(path, data),
    };
    return q;
  };
  const docs = (rows: Record<string, unknown>) => ({ docs: Object.entries(rows).map(([id, body]) => ({ id, exists: true, data: () => body })) });
  return {
    add, get, update, stored,
    db: { doc: (p: string) => query(p), collection: (p: string) => query(p) },
    push: (path: string, rows: Record<string, unknown>) => subs.get(path)!(path.startsWith('meta/') ? { exists: true, data: () => rows } : docs(rows)),
    fail: (path: string) => errs.get(path)!({ code: 'revoked', message: 'x' }),
    subs,
  };
}

describe('start', () => {
  it('renders the embedded snapshot offline when db is unavailable', async () => {
    const root = document.createElement('div');
    const app = await start({ claude: null, snapshot, root, now: () => NOW });
    expect(root.innerHTML).toContain('Sin conexión');
    expect(root.innerHTML).toContain('0 %');
    app.stop();
  });

  it('shows a neutral connecting state until the db resolves', async () => {
    const f = fakeDb();
    const root = document.createElement('div');
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const p = start({ claude: { use: async () => { await gate; return f.db; } }, snapshot, root, now: () => NOW });
    await flush();
    expect(root.innerHTML).toContain('Conectando');
    expect(root.innerHTML).not.toContain('Sin conexión');
    release();
    const app = await p;
    await flush();
    expect(root.innerHTML).not.toContain('Conectando');
    expect(root.innerHTML).toContain('EN VIVO');
    app.stop();
  });

  it('survives malformed documents from the db', async () => {
    const f = fakeDb();
    const root = document.createElement('div');
    const app = await start({ claude: { use: async () => f.db }, snapshot, root, now: () => NOW });
    f.push('state', { T001: { status: 'done', commits: 'x' } });
    f.push('meta/project', { name: 'demo', locale: 'es', metrics: { lastCommit: { sha: 5, ts: 1 } } });
    f.push('sessions', { s1: null });
    f.push('events', { e1: { ts: 5, type: 7 } });
    f.push('plan', { F1: { id: 'F1', tasks: 'zzz' }, junk: 5 });
    await flush();
    expect(root.innerHTML).toContain('EN VIVO');
    expect(root.innerHTML).toContain('class="shell"');
    app.stop();
  });

  it('falls back to the offline banner when rendering throws', async () => {
    const f = fakeDb();
    const root = document.createElement('div');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = await start({ claude: { use: async () => f.db }, snapshot, root, now: () => NOW });
    (app.model as { plan: unknown }).plan = null;
    f.push('events', {});
    await flush();
    expect(err).toHaveBeenCalled();
    expect(app.model.offline).toBe(true);
    expect(root.innerHTML).toContain('Sin conexión');
    err.mockRestore();
    app.stop();
  });

  it('subscribes once per collection and re-renders on live updates', async () => {
    const f = fakeDb();
    const root = document.createElement('div');
    const app = await start({ claude: { use: async () => f.db }, snapshot, root, now: () => NOW });
    expect([...f.subs.keys()].sort()).toEqual(['events', 'messages', 'meta/infinite', 'meta/metrics', 'meta/project', 'meta/run', 'notes', 'plan', 'proposals', 'sessions', 'state']);
    f.push('state', { T001: { status: 'done', startedAt: '2026-10-11T10:00:00Z', doneAt: '2026-10-11T10:30:00Z' } });
    await flush();
    expect(root.innerHTML).toContain('17 %');
    expect(root.innerHTML).toContain('EN VIVO');
    f.push('events', { e1: { ts: '2026-10-11T10:30:00Z', type: 'done', sessionId: 'main', taskId: 'T001', text: 'Esquema' } });
    await flush();
    expect(root.innerHTML).toContain('Esquema');
    app.stop();
    expect(f.subs.size).toBe(0);
  });

  it('shows the infinite pill from the meta/infinite snapshot', async () => {
    const f = fakeDb();
    const root = document.createElement('div');
    const app = await start({ claude: { use: async () => f.db }, snapshot, root, now: () => NOW });
    await flush();
    expect(root.innerHTML).not.toContain('∞');
    f.push('meta/infinite', { active: true, cycle: 2, budget: { cycles: 5 }, startedAt: '2026-10-11T09:00:00Z', lastCycleAt: null });
    await flush();
    // meta/infinite.cycle counts the cycles done: the pill shows the one in progress.
    expect(root.innerHTML).toContain('∞ ciclo 3/5');
    f.push('meta/infinite', { active: false, cycle: 5, budget: { cycles: 5 } });
    await flush();
    expect(root.innerHTML).not.toContain('∞');
    f.push('meta/infinite', { active: true, cycle: 1, budget: {} });
    await flush();
    expect(root.innerHTML).toContain('∞ ciclo 2<');
    f.subs.get('meta/infinite')!({ exists: false, data: () => undefined });
    await flush();
    expect(root.innerHTML).not.toContain('∞');
    f.push('meta/infinite', 'junk' as unknown as Record<string, unknown>);
    await flush();
    expect(root.innerHTML).not.toContain('∞');
    expect(root.innerHTML).toContain('EN VIVO');
    app.stop();
  });

  it('switches view and shows pushed messages', async () => {
    const f = fakeDb();
    const root = document.createElement('div');
    document.body.appendChild(root);
    const app = await start({ claude: { use: async () => f.db }, snapshot, root, now: () => NOW });
    f.push('messages', { m1: { ts: '2026-10-11T11:00:00Z', from: 'a', to: 'b', type: 'reply', text: 'ping-xyz', status: 'open' } });
    await flush();
    expect(root.innerHTML).toContain('ping-xyz');
    (root.querySelector('[data-view="sessions"]') as HTMLElement).click();
    await flush();
    expect(app.ui.view).toBe('sessions');
    expect(root.innerHTML).toContain('<h1>Sesiones</h1>');
    app.stop();
  });

  it('switches to offline on a terminal subscription error', async () => {
    const f = fakeDb();
    const root = document.createElement('div');
    const app = await start({ claude: { use: async () => f.db }, snapshot, root, now: () => NOW });
    f.fail('state');
    await flush();
    expect(root.innerHTML).toContain('Sin conexión');
    app.stop();
  });

  it('handles clicks: expand phase, open and close modal, zoom', async () => {
    history.replaceState(null, '', '#v=schedule');
    const root = document.createElement('div');
    document.body.appendChild(root);
    const app = await start({ claude: null, snapshot, root, now: () => NOW });
    (root.querySelector('[data-action="toggle-phase"][data-id="F1"]') as HTMLElement).click();
    await flush();
    expect(root.innerHTML).toContain('Maqueta de carrito');
    (root.querySelector('.tr.tk[data-id="T003"]') as HTMLElement).click();
    await flush();
    expect(root.querySelector('.modal')).not.toBeNull();
    (root.querySelector('.modal [data-action="close-modal"]') as HTMLElement).click();
    await flush();
    expect(root.querySelector('.modal')).toBeNull();
    (root.querySelector('[data-zoom="1w"]') as HTMLElement).click();
    await flush();
    expect(app.ui.zoom).toBe('1w');
    app.stop();
  });

  it('timeline: fit, expand all, free zoom with Ctrl + wheel, keys and back to a preset', async () => {
    history.replaceState(null, '', '#v=schedule');
    const root = document.createElement('div');
    document.body.appendChild(root);
    const app = await start({ claude: null, snapshot, root, now: () => NOW });
    (root.querySelector('[data-action="tl-all"]') as HTMLElement).click();
    await flush();
    expect([...app.ui.expanded].sort()).toEqual(['F1', 'F2']);
    (root.querySelector('[data-action="tl-all"]') as HTMLElement).click();
    await flush();
    expect(app.ui.expanded.size).toBe(0);
    (root.querySelector('[data-action="fit"]') as HTMLElement).click();
    await flush();
    expect(app.ui.span).toBeGreaterThan(0);
    const fitSpan = app.ui.span!;
    const canvas = root.querySelector('[data-role="tl-canvas"]') as HTMLElement;
    const wheel = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true });
    // happy-dom's WheelEvent drops the modifier keys; a browser's carries them.
    Object.defineProperty(wheel, 'ctrlKey', { value: true });
    canvas.dispatchEvent(wheel);
    await new Promise(r => setTimeout(r, 30));
    expect(app.ui.span!).toBeLessThan(fitSpan);
    const before = app.ui.pan!;
    (root.querySelector('[data-role="timeline"]') as HTMLElement).focus();
    root.querySelector('[data-role="timeline"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await new Promise(r => setTimeout(r, 30));
    expect(app.ui.pan!).toBeGreaterThan(before);
    (root.querySelector('[data-zoom="1d"]') as HTMLElement).click();
    await flush();
    expect(app.ui.span).toBeUndefined();
    expect(root.querySelector('[data-zoom="1d"]')!.classList.contains('on')).toBe(true);
    app.stop();
  });

  it('timeline: status filter, layers and grouping go into the URL and come back from it', async () => {
    history.replaceState(null, '', '#v=schedule');
    const root = document.createElement('div');
    document.body.appendChild(root);
    const app = await start({ claude: null, snapshot, root, now: () => NOW });
    (root.querySelector('[data-action="tl-status"][data-key="blocked"]') as HTMLElement).click();
    (root.querySelector('[data-action="tl-layer"][data-key="critical"]') as HTMLElement).click();
    (root.querySelector('[data-action="tgroup"][data-group="session"]') as HTMLElement).click();
    await flush();
    expect(app.ui.statuses).toEqual(['blocked']);
    expect(app.ui.layers).toEqual(['critical']);
    expect(location.hash).toContain('f=blocked');
    expect(location.hash).toContain('l=critical');
    expect(location.hash).toContain('g=session');
    app.stop();
    root.remove();
    const again = document.createElement('div');
    document.body.appendChild(again);
    const app2 = await start({ claude: null, snapshot, root: again, now: () => NOW });
    expect(app2.ui.statuses).toEqual(['blocked']);
    expect(app2.ui.timelineGroup).toBe('session');
    expect(again.querySelector('[data-action="tl-layer"][data-key="critical"]')!.classList.contains('on')).toBe(true);
    app2.stop();
  });

  it('exports the timeline as SVG through the downloads capability', async () => {
    history.replaceState(null, '', '#v=schedule');
    const root = document.createElement('div');
    document.body.appendChild(root);
    const save = vi.fn(async (_r: { filename: string; data: Blob }) => ({ status: 'saved' }));
    const claude = { use: async (name: string) => (name === 'downloads' ? { save } : null) };
    const app = await start({ claude, snapshot, root, now: () => NOW });
    (root.querySelector('[data-action="export"][data-format="svg"]') as HTMLElement).click();
    await new Promise(r => setTimeout(r, 20));
    expect(save).toHaveBeenCalledTimes(1);
    const req = save.mock.calls[0][0];
    expect(req.filename).toMatch(/timeline\.svg$/);
    expect(await req.data.text()).toContain('<svg');
    app.stop();
  });

  it('the burndown scope select changes the analysed tasks', async () => {
    history.replaceState(null, '', '#v=schedule');
    const root = document.createElement('div');
    document.body.appendChild(root);
    const app = await start({ claude: null, snapshot, root, now: () => NOW });
    const sel = root.querySelector('[data-action="burn-scope"]') as HTMLSelectElement;
    sel.value = 'p:F1';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(app.ui.burnScope).toBe('p:F1');
    app.stop();
  });

  it('keeps search focus across re-renders', async () => {
    history.replaceState(null, '', '#v=schedule');
    const root = document.createElement('div');
    document.body.appendChild(root);
    const app = await start({ claude: null, snapshot, root, now: () => NOW });
    const input = root.querySelector('[data-role="search"]') as HTMLInputElement;
    input.focus();
    input.value = 'carr';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
    const again = root.querySelector('[data-role="search"]') as HTMLInputElement;
    expect(document.activeElement).toBe(again);
    expect(again.value).toBe('carr');
    app.stop();
  });
});

const settle = async () => { for (let i = 0; i < 5; i++) await flush(); };
const fakeUser = (over: Record<string, unknown> = {}) => ({
  id: vi.fn(async () => 'u1'),
  can: vi.fn(() => true),
  profiles: vi.fn(async (ids: string[]) => Object.fromEntries(ids.map(i => [i, { name: i === 'u2' ? 'Ana' : '' }]))),
  ...over,
});
async function boot(f: ReturnType<typeof fakeDb>, user: unknown, hash = '') {
  if (hash) history.replaceState(null, '', hash);
  const root = document.createElement('div');
  document.body.appendChild(root);
  const app = await start({ claude: { use: async (n: string) => (n === 'db' ? f.db : n === 'user' ? user : null) }, snapshot, root, now: () => NOW });
  await settle();
  return { root, app };
}
const typeIn = (root: HTMLElement, role: string, value: string) => {
  const el = root.querySelector(`[data-role="${role}"]`) as HTMLTextAreaElement;
  el.focus();
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return el;
};
const click = (root: HTMLElement, sel: string) => (root.querySelector(sel) as HTMLElement).click();

describe('notes', () => {
  it('adds a note with the user author', async () => {
    const f = fakeDb();
    const { root, app } = await boot(f, fakeUser());
    click(root, '[data-view="talk"]');
    await settle();
    typeIn(root, 'note-text', 'nueva idea');
    await settle();
    expect(document.activeElement?.getAttribute('data-role')).toBe('note-text');
    const sel = root.querySelector('[data-action="note-type"]') as HTMLSelectElement;
    sel.value = 'decision';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    click(root, '[data-action="note-add"]');
    await settle();
    expect(f.add).toHaveBeenCalledTimes(1);
    const doc = f.add.mock.calls[0]![0] as Record<string, unknown>;
    expect(doc).toMatchObject({ type: 'decision', author: 'user:u1', text: 'nueva idea' });
    expect(typeof doc.ts).toBe('string');
    expect(app.ui.draft.text).toBe('');
    app.stop();
  });

  it('is read-only without a user and never calls add', async () => {
    const f = fakeDb();
    const { root, app } = await boot(f, null);
    click(root, '[data-view="talk"]');
    await settle();
    expect(root.innerHTML).toContain('solo lectura');
    const ta = root.querySelector('[data-role="note-text"]') as HTMLTextAreaElement | null;
    if (ta) typeIn(root, 'note-text', 'x');
    const btn = root.querySelector('[data-action="note-add"]') as HTMLElement | null;
    btn?.click();
    await settle();
    expect(f.add).not.toHaveBeenCalled();
    app.stop();
  });

  it('does not gate writes on can(data.write), which answers for the root rule', async () => {
    const f = fakeDb();
    const { root, app } = await boot(f, fakeUser({ can: vi.fn(() => false) }));
    click(root, '[data-view="talk"]');
    await settle();
    expect(root.innerHTML).not.toContain('solo lectura');
    typeIn(root, 'note-text', 'contributor');
    click(root, '[data-action="note-add"]');
    await settle();
    expect(f.add).toHaveBeenCalledTimes(1);
    expect(app.model.readOnly).toBe(false);
    app.stop();
  });

  it('is read-only when the user id is null', async () => {
    const f = fakeDb();
    const { root, app } = await boot(f, fakeUser({ id: vi.fn(async () => null) }));
    click(root, '[data-view="talk"]');
    await settle();
    expect(root.innerHTML).toContain('solo lectura');
    app.stop();
  });

  it('typing does not replace the textarea (IME and mobile keyboards)', async () => {
    const f = fakeDb();
    const { root, app } = await boot(f, fakeUser());
    f.push('notes', { q1: { ts: '2026-10-11T11:00:00Z', type: 'question', author: 'session:backend', text: '?' } });
    click(root, '[data-view="talk"]');
    await settle();
    const ta = typeIn(root, 'note-text', 'hol');
    await settle();
    expect(root.querySelector('[data-role="note-text"]')).toBe(ta);
    expect(app.ui.draft.text).toBe('hol');
    click(root, '[data-action="answer-open"][data-id="q1"]');
    await settle();
    const an = typeIn(root, 'answer-text', 'res');
    await settle();
    expect(root.querySelector('[data-role="answer-text"]')).toBe(an);
    expect(app.ui.answerDraft).toBe('res');
    app.stop();
  });

  it('defers renders while an IME composition is active', async () => {
    const f = fakeDb();
    const { root, app } = await boot(f, fakeUser());
    click(root, '[data-view="talk"]');
    await settle();
    const ta = root.querySelector('[data-role="note-text"]') as HTMLTextAreaElement;
    ta.focus();
    ta.dispatchEvent(new Event('compositionstart', { bubbles: true }));
    f.push('notes', { n1: { ts: '2026-10-11T11:00:00Z', type: 'idea', author: 'session:backend', text: 'llega-durante' } });
    await settle();
    expect(root.querySelector('[data-role="note-text"]')).toBe(ta);
    expect(root.innerHTML).not.toContain('llega-durante');
    ta.value = 'にほん';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new Event('compositionend', { bubbles: true }));
    await settle();
    expect(root.innerHTML).toContain('llega-durante');
    expect((root.querySelector('[data-role="note-text"]') as HTMLTextAreaElement).value).toBe('にほん');
    app.stop();
  });

  describe('composition fallbacks', () => {
    const fakeTimers = () => {
      const pending = new Map<number, () => void>();
      let next = 1;
      return {
        pending,
        setTimeout: vi.fn((fn: () => void, ms: number) => { void ms; const id = next++; pending.set(id, fn); return id; }),
        clearTimeout: vi.fn((id: number) => { pending.delete(id); }),
        fire: () => { const fns = [...pending.values()]; pending.clear(); fns.forEach(f => f()); },
      };
    };
    async function bootComposing(t?: ReturnType<typeof fakeTimers>) {
      const f = fakeDb();
      const root = document.createElement('div');
      document.body.appendChild(root);
      const app = await start({ claude: { use: async (n: string) => (n === 'db' ? f.db : n === 'user' ? fakeUser() : null) }, snapshot, root, now: () => NOW, timers: t });
      await settle();
      click(root, '[data-view="talk"]');
      await settle();
      const ta = root.querySelector('[data-role="note-text"]') as HTMLTextAreaElement;
      ta.focus();
      ta.dispatchEvent(new Event('compositionstart', { bubbles: true }));
      f.push('notes', { n1: { ts: '2026-10-11T11:00:00Z', type: 'idea', author: 'session:backend', text: 'llega-durante' } });
      await settle();
      expect(root.innerHTML).not.toContain('llega-durante');
      return { f, root, app, ta };
    }

    it('renders anyway after 3 s of composition without compositionend', async () => {
      const t = fakeTimers();
      const { root, app } = await bootComposing(t);
      expect(t.setTimeout).toHaveBeenCalledWith(expect.any(Function), 3000);
      t.fire();
      await settle();
      expect(root.innerHTML).toContain('llega-durante');
      app.stop();
    });

    it('ends the composition when the textarea loses focus', async () => {
      const t = fakeTimers();
      const { root, app, ta } = await bootComposing(t);
      ta.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      await settle();
      expect(root.innerHTML).toContain('llega-durante');
      expect(t.pending.size).toBe(0);
      app.stop();
    });

    it('click actions render even while composing', async () => {
      const { root, app } = await bootComposing(fakeTimers());
      click(root, '[data-action="nfilter"][data-filter="all"]');
      await settle();
      expect(root.innerHTML).toContain('llega-durante');
      app.stop();
    });

    it('compositionend clears the ceiling timer', async () => {
      const t = fakeTimers();
      const { root, app, ta } = await bootComposing(t);
      ta.dispatchEvent(new Event('compositionend', { bubbles: true }));
      await settle();
      expect(t.pending.size).toBe(0);
      expect(root.innerHTML).toContain('llega-durante');
      app.stop();
    });
  });

  it('clears a transient notice when switching views, but not read-only', async () => {
    const f = fakeDb();
    f.add.mockRejectedValueOnce(new Error('network'));
    const { root, app } = await boot(f, fakeUser());
    click(root, '[data-view="talk"]');
    await settle();
    typeIn(root, 'note-text', 'x');
    click(root, '[data-action="note-add"]');
    await settle();
    expect(app.ui.notice).toBe('failed');
    click(root, '[data-view="summary"]');
    await settle();
    expect(app.ui.notice).toBeNull();
    app.ui.notice = 'readonly';
    click(root, '[data-view="talk"]');
    await settle();
    expect(app.ui.notice).toBe('readonly');
    app.stop();
  });

  it('only answers notes that are open questions', async () => {
    const f = fakeDb();
    const { root, app } = await boot(f, fakeUser());
    f.push('notes', {
      i1: { ts: '2026-10-11T11:00:00Z', type: 'idea', author: 'session:backend', text: 'idea' },
      q2: { ts: '2026-10-11T11:00:00Z', type: 'question', author: 'session:backend', text: '?', answer: 'ya', answeredBy: 'user:u1', answeredAt: '2026-10-11T11:30:00Z' },
    });
    click(root, '[data-view="talk"]');
    await settle();
    app.ui.answerDraft = 'forzada';
    for (const id of ['i1', 'q2']) {
      const b = document.createElement('button');
      b.dataset.action = 'answer-send';
      b.dataset.id = id;
      root.appendChild(b);
      b.click();
      await settle();
    }
    expect(f.get).not.toHaveBeenCalled();
    expect(f.update).not.toHaveBeenCalled();
    app.stop();
  });

  it('keeps the draft and turns read-only when add is rejected', async () => {
    const f = fakeDb();
    f.add.mockRejectedValueOnce(Object.assign(new Error('nope'), { code: 'invalid_argument' }));
    const { root, app } = await boot(f, fakeUser({ can: () => null }));
    click(root, '[data-view="talk"]');
    await settle();
    typeIn(root, 'note-text', 'no se pierde');
    // A real click moves the focus to the button (happy-dom's click() does not): the render puts the draft back in the box.
    (root.querySelector('[data-action="note-add"]') as HTMLButtonElement).focus();
    click(root, '[data-action="note-add"]');
    await settle();
    expect(f.add).toHaveBeenCalledTimes(1);
    expect(app.ui.draft.text).toBe('no se pierde');
    const box = root.querySelector('[data-role="note-text"]') as HTMLTextAreaElement;
    expect([box.value, box.readOnly]).toEqual(['no se pierde', true]);
    expect(root.innerHTML).toContain('solo lectura');
    app.stop();
  });

  it('a refused add with the box still focused keeps its text, focus and caret, and the box turns read-only (H-06)', async () => {
    const f = fakeDb();
    f.add.mockRejectedValueOnce(Object.assign(new Error('nope'), { code: 'invalid_argument' }));
    const { root, app } = await boot(f, fakeUser({ can: () => null }));
    click(root, '[data-view="talk"]');
    await settle();
    const box = typeIn(root, 'note-text', 'no se pierde');
    box.setSelectionRange(3, 5);
    click(root, '[data-action="note-add"]');
    await settle();
    expect(root.querySelector('[data-role="note-text"]')).toBe(box);
    expect(document.activeElement).toBe(box);
    expect([box.value, box.selectionStart, box.selectionEnd, box.readOnly]).toEqual(['no se pierde', 3, 5, true]);
    expect(root.innerHTML).toContain('solo lectura');
    app.stop();
  });

  it('after a successful add the box is empty on screen, whether a click moved the focus to the button or not (H-06)', async () => {
    for (const toButton of [true, false]) {
      const f = fakeDb();
      const { root, app } = await boot(f, fakeUser());
      click(root, '[data-view="talk"]');
      await settle();
      typeIn(root, 'note-text', 'nueva idea');
      await settle();
      if (toButton) (root.querySelector('[data-action="note-add"]') as HTMLButtonElement).focus();
      click(root, '[data-action="note-add"]');
      await settle();
      expect(f.add, `focus on the button: ${toButton}`).toHaveBeenCalledTimes(1);
      expect((root.querySelector('[data-role="note-text"]') as HTMLTextAreaElement).value, `focus on the button: ${toButton}`).toBe('');
      app.stop();
      root.remove();
    }
  });

  it('answers an open question: get then update', async () => {
    const f = fakeDb();
    const { root, app } = await boot(f, fakeUser());
    f.push('notes', { q1: { ts: '2026-10-11T11:00:00Z', type: 'question', author: 'session:backend', text: '¿apple pay?' }, bad: { type: 'nope' } });
    click(root, '[data-view="talk"]');
    await settle();
    expect(app.model.notes.map(n => n.id)).toEqual(['q1']);
    click(root, '[data-action="answer-open"][data-id="q1"]');
    await settle();
    typeIn(root, 'answer-text', 'en la 0.2');
    await settle();
    expect(document.activeElement?.getAttribute('data-role')).toBe('answer-text');
    click(root, '[data-action="answer-send"]');
    await settle();
    expect(f.get).toHaveBeenCalledWith('notes/q1');
    expect(f.update).toHaveBeenCalledTimes(1);
    expect(f.update.mock.calls[0]![0]).toBe('notes/q1');
    expect(f.update.mock.calls[0]![1]).toMatchObject({ answer: 'en la 0.2', answeredBy: 'user:u1' });
    expect(f.get.mock.invocationCallOrder[0]!).toBeLessThan(f.update.mock.invocationCallOrder[0]!);
    app.stop();
  });

  it('does not overwrite an answer that already exists', async () => {
    const f = fakeDb();
    f.stored['notes/q1'] = { ts: '2026-10-11T11:00:00Z', type: 'question', author: 'session:backend', text: '?', answer: 'ya' };
    const { root, app } = await boot(f, fakeUser());
    f.push('notes', { q1: { ts: '2026-10-11T11:00:00Z', type: 'question', author: 'session:backend', text: '¿apple pay?' } });
    click(root, '[data-view="talk"]');
    await settle();
    click(root, '[data-action="answer-open"][data-id="q1"]');
    await settle();
    typeIn(root, 'answer-text', 'otra');
    click(root, '[data-action="answer-send"]');
    await settle();
    expect(f.get).toHaveBeenCalled();
    expect(f.update).not.toHaveBeenCalled();
    expect(root.innerHTML).toContain('ya respondida');
    app.stop();
  });

  it('resolves user names through profiles', async () => {
    const f = fakeDb();
    const user = fakeUser();
    const { root, app } = await boot(f, user);
    f.push('notes', { a: { ts: '2026-10-11T11:00:00Z', type: 'idea', author: 'user:u2', text: 'hola' }, b: { ts: '2026-10-11T11:01:00Z', type: 'idea', author: 'user:u1', text: 'mía' } });
    click(root, '[data-view="talk"]');
    await settle();
    expect(user.profiles).toHaveBeenCalledWith(['u2']);
    expect(root.innerHTML).toContain('Ana');
    expect(root.innerHTML).toContain('tú');
    const before = user.profiles.mock.calls.length;
    click(root, '[data-action="nfilter"][data-filter="open"]');
    await settle();
    expect(user.profiles.mock.calls.length).toBeGreaterThan(before);
    app.stop();
  });

  it('falls back to a generic name when profiles has none', async () => {
    const f = fakeDb();
    const user = fakeUser({ profiles: vi.fn(async () => ({})) });
    const { root, app } = await boot(f, user);
    f.push('notes', { a: { ts: '2026-10-11T11:00:00Z', type: 'idea', author: 'user:u9', text: 'hola' } });
    click(root, '[data-view="talk"]');
    await settle();
    expect(user.profiles).toHaveBeenCalledWith(['u9']);
    expect(root.innerHTML).toContain('usuario');
    app.stop();
  });

  it('switches views, filters, timeline group and version filters', async () => {
    history.replaceState(null, '', '#v=schedule');
    const root = document.createElement('div');
    document.body.appendChild(root);
    // A plan with categories: one with only «—» has no category buttons (H-02).
    const withCats = buildDocs({ ...plan, tasks: plan.tasks.map(t => ({ ...t, category: 'api' })) }, '2026-10-11T09:00:00Z');
    const app = await start({ claude: null, snapshot: withCats, root, now: () => NOW });
    click(root, '[data-action="tgroup"][data-group="track"]');
    await flush();
    expect(app.ui.timelineGroup).toBe('track');
    expect(root.innerHTML).toContain('data-action="toggle-phase" data-id="backend"');
    click(root, '[data-view="plan"]');
    await flush();
    expect(app.ui.view).toBe('plan');
    click(root, '[data-action="vfilter"][data-key="done"]');
    await flush();
    expect(app.ui.versionFilter.statuses).toEqual(['done']);
    click(root, '[data-action="vfilter"][data-key="done"]');
    await flush();
    expect(app.ui.versionFilter.statuses).toEqual([]);
    click(root, '[data-action="vfilter"][data-key="provisional"]');
    await flush();
    expect(app.ui.versionFilter.phaseStatuses).toEqual(['provisional']);
    const tsel = root.querySelector('[data-action="vtrack"]') as HTMLSelectElement;
    tsel.value = 'ui';
    tsel.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(app.ui.versionFilter.track).toBe('ui');
    click(root, '[data-action="collapse-all"]');
    await flush();
    expect(app.ui.collapsed.size).toBeGreaterThan(0);
    click(root, '[data-action="expand-all"]');
    await flush();
    expect(app.ui.collapsed.size).toBe(0);
    click(root, '[data-action="toggle-cat"]');
    await flush();
    expect(app.ui.collapsed.size).toBe(1);
    click(root, '[data-view="talk"]');
    await flush();
    click(root, '[data-action="nfilter"][data-filter="open"]');
    await flush();
    expect(app.ui.noteFilter).toBe('open');
    app.stop();
  });

  it('reads meta/metrics apart and completes it with meta/project.metrics, field by field (A-10)', async () => {
    const f = fakeDb();
    const root = document.createElement('div');
    const app = await start({ claude: { use: async () => f.db }, snapshot, root, now: () => NOW });
    f.push('meta/project', { ...snapshot.meta, metrics: { tests: 41, lastCommit: { sha: '0000000old', ts: '2026-10-10T10:00:00Z' } } });
    f.push('meta/metrics', { lastCommit: { sha: 'abc1234def', ts: '2026-10-11T11:00:00Z' }, updatedAt: '2026-10-11T11:00:00Z' });
    await flush();
    expect(root.innerHTML).toContain('<b>41</b>');
    expect(root.innerHTML).toContain('<b>abc1234</b>');
    expect(root.innerHTML).not.toContain('0000000');
    app.stop();
  });
  it('carry 7: meta/metrics first, its tests over meta/project\'s, and a deleted meta/metrics falls back to meta/project', async () => {
    const f = fakeDb();
    const root = document.createElement('div');
    const app = await start({ claude: { use: async () => f.db }, snapshot, root, now: () => NOW });
    f.push('meta/metrics', { tests: 57, lastCommit: { sha: 'abc1234def', ts: '2026-10-11T11:00:00Z' } });
    f.push('meta/project', { ...snapshot.meta, metrics: { tests: 41, lastCommit: { sha: '0000000old', ts: '2026-10-10T10:00:00Z' } } });
    await flush();
    expect(root.innerHTML).toContain('<b>57</b>');
    expect(root.innerHTML).toContain('<b>abc1234</b>');
    expect(root.innerHTML).not.toContain('<b>41</b>');
    f.subs.get('meta/metrics')!({ exists: false, data: () => undefined });
    await flush();
    expect(root.innerHTML).toContain('<b>41</b>');
    expect(root.innerHTML).toContain('<b>0000000</b>');
    app.stop();
  });
});

const PROP = { ts: '2026-10-11T10:00:00.000Z', category: 'perf', risk: 'low', title: 'Cache prices', rationale: 'why', evidence: 'bench', pillar: 'Fast checkout', status: 'proposed', source: 'scout', author: 'session:abc' };
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('proposals', () => {
  async function bootProposals(f: ReturnType<typeof fakeDb>, user: unknown = fakeUser()) {
    const r = await boot(f, user);
    f.push('proposals', { p1: PROP, bad: { title: 'x' } });
    click(r.root, '[data-view="talk"]');
    await settle();
    click(r.root, '[data-action="talk-c"][data-c="proposals"]');
    await settle();
    return r;
  }
  const inject = (root: HTMLElement, action: string, id: string) => {
    const b = document.createElement('button');
    b.dataset.action = action;
    b.dataset.id = id;
    root.appendChild(b);
    b.click();
  };

  it('approving re-reads the proposal and writes the decision', async () => {
    const f = fakeDb();
    f.stored['proposals/p1'] = { ...PROP };
    const { root, app } = await bootProposals(f);
    expect(app.model.proposals.map(p => p.id)).toEqual(['p1']);
    click(root, '[data-action="p-approve"][data-id="p1"]');
    await settle();
    expect(f.get).toHaveBeenCalledWith('proposals/p1');
    expect(f.update).toHaveBeenCalledTimes(1);
    expect(f.update.mock.calls[0]![0]).toBe('proposals/p1');
    expect(f.update.mock.calls[0]![1]).toEqual({ status: 'approved', decidedBy: 'user:u1', decidedAt: expect.stringMatching(ISO) });
    expect(f.get.mock.invocationCallOrder[0]!).toBeLessThan(f.update.mock.invocationCallOrder[0]!);
    expect(app.ui.notice).toBeNull();
    app.stop();
  });

  it('a proposal decided meanwhile is not overwritten and the notice says so', async () => {
    const f = fakeDb();
    f.stored['proposals/p1'] = { ...PROP, status: 'approved', decidedBy: 'user:u2' };
    const { root, app } = await bootProposals(f);
    click(root, '[data-action="p-approve"][data-id="p1"]');
    await settle();
    expect(f.get).toHaveBeenCalledWith('proposals/p1');
    expect(f.update).not.toHaveBeenCalled();
    expect(app.ui.notice).toBe('decided');
    expect(root.innerHTML).toContain('ya estaba decidida');
    app.stop();
  });

  it('a missing proposal is not written either', async () => {
    const f = fakeDb();
    const { root, app } = await bootProposals(f);
    click(root, '[data-action="p-approve"][data-id="p1"]');
    await settle();
    expect(f.update).not.toHaveBeenCalled();
    expect(app.ui.notice).toBe('decided');
    app.stop();
  });

  it('rejecting sends the reason, commenting adds a note with proposalId', async () => {
    const f = fakeDb();
    f.stored['proposals/p1'] = { ...PROP };
    const { root, app } = await bootProposals(f);
    click(root, '[data-action="p-reject-open"][data-id="p1"]');
    await settle();
    const ta = typeIn(root, 'reason-text', 'no ahora');
    await settle();
    expect(root.querySelector('[data-role="reason-text"]')).toBe(ta);
    expect(app.ui.reasonDraft).toBe('no ahora');
    click(root, '[data-action="p-reject-send"][data-id="p1"]');
    await settle();
    expect(f.update).toHaveBeenCalledTimes(1);
    expect(f.update.mock.calls[0]![1]).toEqual({ status: 'rejected', decidedBy: 'user:u1', decidedAt: expect.stringMatching(ISO), reason: 'no ahora' });
    expect(app.ui.rejecting).toBeNull();
    expect(app.ui.reasonDraft).toBe('');
    click(root, '[data-action="p-comment-open"][data-id="p1"]');
    await settle();
    typeIn(root, 'comment-text', 'mira el bench');
    await settle();
    expect(document.activeElement?.getAttribute('data-role')).toBe('comment-text');
    click(root, '[data-action="p-comment-send"][data-id="p1"]');
    await settle();
    expect(f.add).toHaveBeenCalledTimes(1);
    expect(f.add.mock.calls[0]![0]).toEqual({ ts: expect.stringMatching(ISO), type: 'idea', author: 'user:u1', text: 'mira el bench', proposalId: 'p1' });
    expect(app.ui.commenting).toBeNull();
    expect(app.ui.commentDraft).toBe('');
    app.stop();
  });

  it('keeps the draft on failure and turns read-only on invalid_argument', async () => {
    const f = fakeDb();
    f.add.mockRejectedValueOnce(new Error('network'));
    f.add.mockRejectedValueOnce(Object.assign(new Error('nope'), { code: 'invalid_argument' }));
    const { root, app } = await bootProposals(f);
    click(root, '[data-action="p-comment-open"][data-id="p1"]');
    await settle();
    typeIn(root, 'comment-text', 'se conserva');
    click(root, '[data-action="p-comment-send"][data-id="p1"]');
    await settle();
    expect(app.ui.notice).toBe('failed');
    expect(app.ui.commentDraft).toBe('se conserva');
    click(root, '[data-action="p-comment-send"][data-id="p1"]');
    await settle();
    expect(app.model.readOnly).toBe(false);
    expect(app.model.proposalsReadOnly).toBe(true);
    expect(root.innerHTML).toContain('solo lectura');
    expect(root.innerHTML).not.toContain('data-action="p-approve"');
    app.stop();
  });

  it('a refused proposal decision locks only the proposals view; notes keep working', async () => {
    const f = fakeDb();
    f.stored['proposals/p1'] = { ...PROP };
    f.update.mockRejectedValueOnce(Object.assign(new Error('nope'), { code: 'invalid_argument' }));
    const { root, app } = await bootProposals(f);
    click(root, '[data-action="p-approve"][data-id="p1"]');
    await settle();
    expect(app.model.proposalsReadOnly).toBe(true);
    expect(app.model.readOnly).toBe(false);
    expect(root.innerHTML).not.toContain('data-action="p-approve"');
    inject(root, 'p-approve', 'p1');
    await settle();
    expect(f.update).toHaveBeenCalledTimes(1);
    click(root, '[data-action="talk-c"][data-c="notes"]');
    await settle();
    expect(root.innerHTML).not.toContain('solo lectura');
    typeIn(root, 'note-text', 'sigue funcionando');
    await settle();
    click(root, '[data-action="note-add"]');
    await settle();
    expect(f.add).toHaveBeenCalledTimes(1);
    expect(f.add.mock.calls[0]![0]).toMatchObject({ author: 'user:u1', text: 'sigue funcionando' });
    app.stop();
  });

  it('an id not received in the snapshot is never written', async () => {
    const f = fakeDb();
    f.stored['meta/project'] = { ...PROP };
    const { root, app } = await bootProposals(f);
    app.ui.reasonDraft = 'x';
    app.ui.commentDraft = 'x';
    for (const action of ['p-approve', 'p-reject-send', 'p-comment-send']) {
      for (const id of ['../meta/project', 'p9', 'p1/x']) { inject(root, action, id); await settle(); }
    }
    expect(f.get).not.toHaveBeenCalled();
    expect(f.update).not.toHaveBeenCalled();
    expect(f.add).not.toHaveBeenCalled();
    app.stop();
  });

  it('is read-only without a user: no buttons and no writes', async () => {
    const f = fakeDb();
    f.stored['proposals/p1'] = { ...PROP };
    const { root, app } = await bootProposals(f, null);
    expect(root.innerHTML).not.toContain('data-action="p-approve"');
    inject(root, 'p-approve', 'p1');
    await settle();
    expect(f.get).not.toHaveBeenCalled();
    expect(f.update).not.toHaveBeenCalled();
    app.stop();
  });

  it('filters by status, category and risk', async () => {
    const f = fakeDb();
    const { root, app } = await bootProposals(f);
    click(root, '[data-action="pfilter"][data-kind="category"][data-value="security"]');
    await settle();
    expect(app.ui.proposalFilter).toEqual({ status: 'all', category: 'security', risk: 'all' });
    click(root, '[data-action="pfilter"][data-kind="risk"][data-value="high"]');
    await settle();
    click(root, '[data-action="pfilter"][data-kind="status"][data-value="done"]');
    await settle();
    expect(app.ui.proposalFilter).toEqual({ status: 'done', category: 'security', risk: 'high' });
    const b = document.createElement('button');
    b.dataset.action = 'pfilter';
    b.dataset.kind = 'risk';
    b.dataset.value = 'evil';
    root.appendChild(b);
    b.click();
    await settle();
    expect(app.ui.proposalFilter.risk).toBe('high');
    app.stop();
  });

  it('ends a composition when the comment textarea loses focus', async () => {
    const f = fakeDb();
    const { root, app } = await bootProposals(f);
    click(root, '[data-action="p-comment-open"][data-id="p1"]');
    await settle();
    const ta = root.querySelector('[data-role="comment-text"]') as HTMLTextAreaElement;
    ta.focus();
    ta.dispatchEvent(new Event('compositionstart', { bubbles: true }));
    f.push('proposals', { p1: PROP, p2: { ...PROP, title: 'llega-durante' } });
    await settle();
    expect(root.innerHTML).not.toContain('llega-durante');
    ta.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await settle();
    expect(root.innerHTML).toContain('llega-durante');
    app.stop();
  });
});

describe('scroll, tick and live repaints (G-01, H-06)', () => {
  const openT003 = async (root: HTMLElement) => {
    click(root, '[data-view="schedule"]');
    await settle();
    click(root, '[data-action="toggle-phase"][data-id="F1"]');
    await settle();
    click(root, '.tr.tk[data-id="T003"]');
    await settle();
  };
  it('a data snapshot repaints in place and keeps the scroll of every keyed container (H-06)', async () => {
    const f = fakeDb();
    const { root, app } = await boot(f, fakeUser());
    click(root, '[data-view="plan"]');
    await settle();
    const before = root.querySelector('[data-scroll-key="vcols"]') as HTMLElement;
    before.scrollLeft = 900;
    f.push('state', { T001: { status: 'done' } });
    await settle();
    const after = root.querySelector('[data-scroll-key="vcols"]') as HTMLElement;
    expect(after).toBe(before);
    expect(after.scrollLeft).toBe(900);
    app.stop();
  });
  it('with the modal open a snapshot repaints it at once and keeps the overlay and its scroll (H-06)', async () => {
    const f = fakeDb();
    const { root, app } = await boot(f, fakeUser());
    await openT003(root);
    expect(document.documentElement.classList.contains('wp-modal')).toBe(true);
    const overlay = root.querySelector('[data-scroll-key="modal:T003"]') as HTMLElement;
    overlay.scrollTop = 240;
    f.push('state', { T003: { status: 'in_progress', owner: 'main', summary: 'llega-con-modal' } });
    await settle();
    expect(root.innerHTML).toContain('llega-con-modal');
    expect(root.querySelector('[data-scroll-key="modal:T003"]')).toBe(overlay);
    expect(overlay.scrollTop).toBe(240);
    expect(root.querySelector('[data-action="refresh"]')).toBeNull();
    app.stop();
  });
  it('stopping the app with the modal open removes the wp-modal class', async () => {
    const { root, app } = await boot(fakeDb(), fakeUser());
    await openT003(root);
    expect(document.documentElement.classList.contains('wp-modal')).toBe(true);
    app.stop();
    expect(document.documentElement.classList.contains('wp-modal')).toBe(false);
  });
  it('with the modal open, the data behind it paints too; closing it leaves it there (H-06)', async () => {
    const f = fakeDb();
    const { root, app } = await boot(f, fakeUser());
    await openT003(root);
    // Task 5: the detail opens over the schedule, which draws rows, not the feed: the data behind is T001's state.
    const dot = () => root.querySelector('[data-k="t:T001"] .sd')!.className;
    expect(dot()).not.toContain('st-blocked');
    f.push('state', { T001: { status: 'blocked' } });
    await settle();
    expect(dot()).toContain('st-blocked');
    click(root, '.modal [data-action="close-modal"]');
    await settle();
    expect(dot()).toContain('st-blocked');
    expect(document.documentElement.classList.contains('wp-modal')).toBe(false);
    app.stop();
  });
  it('the 30 s tick rewrites the relative times in place and keeps the DOM', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const f = fakeDb();
      let clock = NOW;
      const root = document.createElement('div');
      document.body.appendChild(root);
      const app = await start({ claude: { use: async (n: string) => (n === 'db' ? f.db : n === 'user' ? fakeUser() : null) }, snapshot, root, now: () => clock });
      await settle();
      f.push('sessions', { main: { name: 'main', status: 'active', heartbeatAt: new Date(NOW - 2 * 60000).toISOString(), leaseUntil: new Date(NOW + 8 * 60000).toISOString() } });
      await settle();
      const rel = root.querySelector('[data-rel="hb"]') as HTMLElement;
      expect(rel.textContent).toBe('hace 2 min');
      const shell = root.querySelector('.shell');
      clock = NOW + 10 * 60000;
      vi.advanceTimersByTime(30000);
      expect(root.querySelector('.shell')).toBe(shell);
      expect(rel.textContent).toBe('hace 12 min');
      app.stop();
    } finally {
      vi.useRealTimers();
    }
  });
  it('a newer proposal arriving above a focused Approve leaves the focus on the Approve of its own proposal (H-06)', async () => {
    const f = fakeDb();
    const { root, app } = await boot(f, fakeUser());
    f.push('proposals', { p1: PROP });
    click(root, '[data-view="talk"]');
    await settle();
    click(root, '[data-action="talk-c"][data-c="proposals"]');
    await settle();
    const approve = root.querySelector('[data-action="p-approve"][data-id="p1"]') as HTMLButtonElement;
    approve.focus();
    f.push('proposals', { p1: PROP, p0: { ...PROP, ts: '2026-10-11T11:00:00.000Z', title: 'nueva-p0' } });
    await settle();
    expect(Array.from(root.querySelectorAll('.prop h3'), x => x.textContent)).toEqual(['nueva-p0', 'Cache prices']);
    expect(document.activeElement).toBe(approve);
    expect(approve.dataset.id).toBe('p1');
    expect(approve.closest('.prop')!.querySelector('h3')!.textContent).toBe('Cache prices');
    app.stop();
  });
  it('a note landing above a focused answer box keeps the box, its focus and its caret (H-06)', async () => {
    const f = fakeDb();
    const { root, app } = await boot(f, fakeUser());
    const Q = { ts: '2026-10-11T10:00:00Z', type: 'question', author: 'session:main', text: 'pregunta-q1' };
    f.push('notes', { q1: Q });
    click(root, '[data-view="talk"]');
    await settle();
    click(root, '[data-action="answer-open"][data-id="q1"]');
    await settle();
    const box = typeIn(root, 'answer-text', 'hola mundo');
    await settle();
    box.setSelectionRange(2, 4);
    f.push('notes', { q1: Q, n2: { ts: '2026-10-11T11:00:00Z', type: 'idea', author: 'session:main', text: 'otra-nota' } });
    await settle();
    expect(root.innerHTML).toContain('otra-nota');
    expect(root.querySelector('[data-role="answer-text"]')).toBe(box);
    expect(document.activeElement).toBe(box);
    expect([box.value, box.selectionStart, box.selectionEnd]).toEqual(['hola mundo', 2, 4]);
    app.stop();
  });
  it('with a select focused a snapshot paints, and the select stays the same element with its focus (H-06)', async () => {
    const f = fakeDb();
    const { root, app } = await boot(f, fakeUser());
    click(root, '[data-view="schedule"]');
    await settle();
    const sel = root.querySelector('select[data-action="burn-scope"]') as HTMLSelectElement;
    sel.focus();
    // Task 5: the schedule draws no feed; what paints is F1's counter.
    const counter = () => root.querySelector('[data-k="p:F1"] .c')!.textContent;
    expect(counter()).toBe('0/3');
    f.push('state', { T001: { status: 'done' } });
    await settle();
    expect(counter()).toBe('1/3');
    expect(root.querySelector('select[data-action="burn-scope"]')).toBe(sel);
    expect(document.activeElement).toBe(sel);
    app.stop();
  });
});

describe('?debug=1 (H-04)', () => {
  it('lists, per document, what the normalizers dropped or coerced; a new snapshot replaces the list of its collection', async () => {
    const f = fakeDb();
    const root = document.createElement('div');
    document.body.appendChild(root);
    const app = await start({ claude: { use: async (n: string) => (n === 'db' ? f.db : null) }, snapshot, root, now: () => NOW, debug: true });
    f.push('state', { T1: { status: 'in_progress', forge: { path: 'medium', phase: 'review', validators: ['test', 7] }, exec: { by: 'main' } } });
    await settle();
    const text = () => root.querySelector('.dbg')?.textContent ?? '';
    expect(text()).toContain('state/T1 · forge.validators[0] · coerced · string');
    expect(text()).toContain('state/T1 · forge.validators[1] · dropped · number');
    expect(text()).toContain('state/T1 · exec · dropped · no runId');
    f.push('state', { T1: { status: 'done' } });
    await settle();
    expect(text()).not.toContain('forge.validators');
    app.stop();
  });
  it('debug=1 in the hash turns it on and survives the hash rewrites; without it there is no list', async () => {
    const plain = document.createElement('div');
    const off = await start({ claude: null, snapshot, root: plain, now: () => NOW });
    expect(plain.querySelector('.dbg')).toBeNull();
    off.stop();
    history.replaceState(null, '', '#debug=1');
    const root = document.createElement('div');
    document.body.appendChild(root);
    const app = await start({ claude: null, snapshot, root, now: () => NOW });
    expect(root.querySelector('.dbg')).not.toBeNull();
    click(root, '[data-view="talk"]');
    await settle();
    expect(location.hash).toContain('debug=1');
    app.stop();
  });
});

describe('the views and the URL (§4.6, H-25)', () => {
  it('changing view pushes a history entry; zoom and filters rewrite it; Back and a hash edited by hand change the view', async () => {
    const push = vi.spyOn(history, 'pushState');
    const root = document.createElement('div');
    document.body.appendChild(root);
    const app = await start({ claude: null, snapshot, root, now: () => NOW });
    expect(app.ui.view).toBe('summary');
    click(root, '[data-view="schedule"]');
    await settle();
    expect(push).toHaveBeenCalledTimes(1);
    expect(location.hash).toBe('#v=schedule');
    click(root, '[data-zoom="1w"]');
    await settle();
    expect(push).toHaveBeenCalledTimes(1);
    expect(location.hash).toBe('#v=schedule&z=1w');
    history.replaceState(null, '', '#v=plan');
    window.dispatchEvent(new Event('hashchange'));
    await settle();
    expect(app.ui.view).toBe('plan');
    expect(root.innerHTML).toContain('<h1>Plan</h1>');
    history.replaceState(null, '', '#v=talk&c=proposals');
    window.dispatchEvent(new Event('popstate'));
    await settle();
    expect([app.ui.view, app.ui.talk]).toEqual(['talk', 'proposals']);
    push.mockRestore();
    app.stop();
  });

  it('Back to a schedule entry without parameters shows the defaults, not what the last entry had (H-25)', async () => {
    const { root, app } = await boot(fakeDb(), fakeUser(), '#v=schedule&z=1w&g=track&o=ui&f=blocked&l=critical');
    expect([app.ui.zoom, app.ui.timelineGroup, [...app.ui.expanded], app.ui.statuses, app.ui.layers]).toEqual(['1w', 'track', ['ui'], ['blocked'], ['critical']]);
    history.replaceState(null, '', '#v=schedule');
    window.dispatchEvent(new Event('popstate'));
    await settle();
    expect([app.ui.zoom, app.ui.timelineGroup, [...app.ui.expanded], app.ui.statuses, app.ui.layers]).toEqual(['1d', 'phase', [], [], []]);
    expect(root.querySelector('[data-zoom="1d"]')!.classList.contains('on')).toBe(true);
    expect(location.hash).toBe('#v=schedule');
    app.stop();
  });

  it('a hash edited to a preset zoom wins over a free span set by Ctrl + wheel (H-25)', async () => {
    const { root, app } = await boot(fakeDb(), fakeUser(), '#v=schedule');
    const canvas = root.querySelector('[data-role="tl-canvas"]') as HTMLElement;
    const wheel = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true });
    // happy-dom's WheelEvent drops the modifier keys; a browser's carries them.
    Object.defineProperty(wheel, 'ctrlKey', { value: true });
    canvas.dispatchEvent(wheel);
    await new Promise(r => setTimeout(r, 30));
    expect(app.ui.span).toBeGreaterThan(0);
    expect(location.hash).toMatch(/^#v=schedule&s=\d+/);
    history.replaceState(null, '', '#v=schedule&z=1w');
    window.dispatchEvent(new Event('hashchange'));
    await settle();
    expect([app.ui.zoom, app.ui.span, app.ui.pan]).toEqual(['1w', undefined, undefined]);
    expect(root.querySelector('[data-zoom="1w"]')!.classList.contains('on')).toBe(true);
    expect(location.hash).toBe('#v=schedule&z=1w');
    app.stop();
  });

  it('a hash edited without q clears the search, in the focused box too, and q is not written back (H-25)', async () => {
    const { root, app } = await boot(fakeDb(), fakeUser(), '#v=schedule&q=carrito');
    const box = root.querySelector('[data-role="search"]') as HTMLInputElement;
    expect([app.ui.search, box.value]).toEqual(['carrito', 'carrito']);
    box.focus();
    history.replaceState(null, '', '#v=schedule');
    window.dispatchEvent(new Event('hashchange'));
    await settle();
    expect(app.ui.search).toBe('');
    expect(root.querySelector('[data-role="search"]')).toBe(box);
    expect(box.value).toBe('');
    expect(location.hash).toBe('#v=schedule');
    app.stop();
  });

  it('an old link opens the view that replaced its own, and the URL is rewritten to the new one', async () => {
    for (const [hash, view, talk, canon] of [['#v=versions', 'plan', undefined, '#v=plan'], ['#v=notes', 'talk', 'notes', '#v=talk'], ['#v=proposals', 'talk', 'proposals', '#v=talk&c=proposals'], ['#v=tracking&z=1w', 'schedule', undefined, '#v=schedule&z=1w']] as const) {
      history.replaceState(null, '', hash);
      const root = document.createElement('div');
      const app = await start({ claude: null, snapshot, root, now: () => NOW });
      expect(app.ui.view, hash).toBe(view);
      if (talk) expect(app.ui.talk).toBe(talk);
      expect(location.hash, hash).toBe(canon);
      app.stop();
    }
  });

  it('a hash edited with junk falls back to the summary and opens nothing (Review Focus 3)', async () => {
    history.replaceState(null, '', '#v=evil&c=evil&t=../x&tt=evil');
    const root = document.createElement('div');
    const app = await start({ claude: null, snapshot, root, now: () => NOW });
    expect([app.ui.view, app.ui.modal]).toEqual(['summary', null]);
    expect(root.querySelector('.modal')).toBeNull();
    expect(root.innerHTML).toContain('<h1>Resumen</h1>');
    app.stop();
  });

  it('the page speaks the plan’s language', async () => {
    const root = document.createElement('div');
    const app = await start({ claude: null, snapshot, root, now: () => NOW });
    expect(document.documentElement.lang).toBe('es');
    app.stop();
  });

  it('before the database answers, the page shows the snapshot’s states and when they were listed (G-14)', async () => {
    const f = fakeDb();
    const root = document.createElement('div');
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const snap = { ...snapshot, states: { T001: 'done', T002: 'in_progress', T099: 'done', 'bad/id': 'done', T003: 'lost' }, statesAt: '2026-10-11T09:45:00.000Z' } as unknown as Snapshot;
    const p = start({ claude: { use: async () => { await gate; return f.db; } }, snapshot: snap, root, now: () => NOW });
    await flush();
    expect(root.innerHTML).toContain('<b>1</b>/6 tareas');
    expect(root.innerHTML).toContain('instantánea de');
    release();
    const app = await p;
    expect(app.model.states.T003).toBeUndefined();
    f.push('state', { T001: { status: 'done' }, T002: { status: 'done' } });
    await settle();
    expect(root.innerHTML).toContain('<b>2</b>/6 tareas');
    expect(root.innerHTML).not.toContain('instantánea de');
    expect(root.innerHTML).toContain('sincronizado');
    app.stop();
  });

  it('a snapshot statesAt that is not a date of at most 40 characters is left out: the states show, the strip names no snapshot (C8)', async () => {
    // The last one parses as a date (the form of Date#toString), but it is longer than 40 characters.
    const long = 'Sun Oct 11 2026 09:45:00 GMT+0000 (Coordinated Universal Time)';
    expect(long.length).toBeGreaterThan(40);
    expect(Number.isFinite(Date.parse(long))).toBe(true);
    for (const junk of [1760175900000, { at: '2026-10-11T09:45:00.000Z' }, 'not a date', long]) {
      const root = document.createElement('div');
      const snap = { ...snapshot, states: { T001: 'done' }, statesAt: junk } as unknown as Snapshot;
      const app = await start({ claude: null, snapshot: snap, root, now: () => NOW });
      expect(root.innerHTML, String(junk)).toContain('<b>1</b>/6 tareas');
      expect(root.innerHTML, String(junk)).not.toContain('instantánea de');
      expect(app.model.statesAt, String(junk)).toBeNull();
      app.stop();
    }
  });
});

describe('the timeline paints what is in view (H-06)', () => {
  it('scrolling the timeline far enough repaints the rows around the new position', async () => {
    const { bigSnapshot } = await import('./fixtures/big-plan.js');
    const big = bigSnapshot(NOW);
    history.replaceState(null, '', `#v=schedule&o=${big.phases.map(p => p.id).join(',')}`);
    const root = document.createElement('div');
    document.body.appendChild(root);
    const app = await start({ claude: null, snapshot: big, root, now: () => NOW });
    await settle();
    const tlw = root.querySelector('[data-role="timeline"]') as HTMLElement;
    expect(tlw.dataset.start).toBe('0');
    Object.defineProperty(tlw, 'scrollHeight', { configurable: true, value: 358 * 28 });
    Object.defineProperty(tlw, 'clientHeight', { configurable: true, value: 560 });
    tlw.scrollTop = 200 * 28;
    tlw.dispatchEvent(new Event('scroll'));
    await new Promise(r => setTimeout(r, 60));
    await settle();
    expect(app.ui.tl).toEqual({ first: 200, count: 21 });
    expect((root.querySelector('[data-role="timeline"]') as HTMLElement).dataset.start).toBe('180');
    click(root, '[data-view="summary"]');
    await settle();
    expect(app.ui.tl).toBeUndefined();
    app.stop();
  });
});
