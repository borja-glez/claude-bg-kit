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
    expect([...f.subs.keys()].sort()).toEqual(['events', 'messages', 'meta/infinite', 'meta/project', 'meta/swarm', 'notes', 'plan', 'proposals', 'sessions', 'state']);
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
    expect(root.innerHTML).toContain('Sesiones y coordinación');
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
async function boot(f: ReturnType<typeof fakeDb>, user: unknown) {
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
    click(root, '[data-view="notes"]');
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
    click(root, '[data-view="notes"]');
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
    click(root, '[data-view="notes"]');
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
    click(root, '[data-view="notes"]');
    await settle();
    expect(root.innerHTML).toContain('solo lectura');
    app.stop();
  });

  it('typing does not replace the textarea (IME and mobile keyboards)', async () => {
    const f = fakeDb();
    const { root, app } = await boot(f, fakeUser());
    f.push('notes', { q1: { ts: '2026-10-11T11:00:00Z', type: 'question', author: 'session:backend', text: '?' } });
    click(root, '[data-view="notes"]');
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
    click(root, '[data-view="notes"]');
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
      click(root, '[data-view="notes"]');
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
    click(root, '[data-view="notes"]');
    await settle();
    typeIn(root, 'note-text', 'x');
    click(root, '[data-action="note-add"]');
    await settle();
    expect(app.ui.notice).toBe('failed');
    click(root, '[data-view="tracking"]');
    await settle();
    expect(app.ui.notice).toBeNull();
    app.ui.notice = 'readonly';
    click(root, '[data-view="notes"]');
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
    click(root, '[data-view="notes"]');
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
    click(root, '[data-view="notes"]');
    await settle();
    typeIn(root, 'note-text', 'no se pierde');
    click(root, '[data-action="note-add"]');
    await settle();
    expect(f.add).toHaveBeenCalledTimes(1);
    expect(app.ui.draft.text).toBe('no se pierde');
    expect(root.innerHTML).toContain('no se pierde');
    expect(root.innerHTML).toContain('solo lectura');
    app.stop();
  });

  it('answers an open question: get then update', async () => {
    const f = fakeDb();
    const { root, app } = await boot(f, fakeUser());
    f.push('notes', { q1: { ts: '2026-10-11T11:00:00Z', type: 'question', author: 'session:backend', text: '¿apple pay?' }, bad: { type: 'nope' } });
    click(root, '[data-view="notes"]');
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
    click(root, '[data-view="notes"]');
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
    click(root, '[data-view="notes"]');
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
    click(root, '[data-view="notes"]');
    await settle();
    expect(user.profiles).toHaveBeenCalledWith(['u9']);
    expect(root.innerHTML).toContain('usuario');
    app.stop();
  });

  it('switches views, filters, timeline group and version filters', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const app = await start({ claude: null, snapshot, root, now: () => NOW });
    click(root, '[data-action="tgroup"][data-group="track"]');
    await flush();
    expect(app.ui.timelineGroup).toBe('track');
    expect(root.innerHTML).toContain('data-action="toggle-phase" data-id="backend"');
    click(root, '[data-view="versions"]');
    await flush();
    expect(app.ui.view).toBe('versions');
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
    click(root, '[data-view="notes"]');
    await flush();
    click(root, '[data-action="nfilter"][data-filter="open"]');
    await flush();
    expect(app.ui.noteFilter).toBe('open');
    app.stop();
  });
});

const PROP = { ts: '2026-10-11T10:00:00.000Z', category: 'perf', risk: 'low', title: 'Cache prices', rationale: 'why', evidence: 'bench', pillar: 'Fast checkout', status: 'proposed', source: 'scout', author: 'session:abc' };
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('proposals', () => {
  async function bootProposals(f: ReturnType<typeof fakeDb>, user: unknown = fakeUser()) {
    const r = await boot(f, user);
    f.push('proposals', { p1: PROP, bad: { title: 'x' } });
    click(r.root, '[data-view="proposals"]');
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
    click(root, '[data-view="notes"]');
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
