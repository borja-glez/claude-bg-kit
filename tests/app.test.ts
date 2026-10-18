// @vitest-environment happy-dom
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePlan } from '../src/lib/plan.js';
import { buildDocs } from '../src/lib/sync.js';
import { normalizeApproval, normalizeProposal, ownerApproved, ownerCheck, proposalDigest } from '../src/lib/proposals.js';
import { run as forgeCli } from '../src/forge/cli/run.js';
import { start, type Snapshot } from '../src/page/app.js';
import { morphInto } from '../src/page/morph.js';
import { fitWindow } from '../src/lib/timeline.js';
import { timelineWindow } from '../src/page/render.js';
import { decodeView } from '../src/page/urlstate.js';

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
  const set = vi.fn(async (_p: string, _data: unknown) => {});
  const query = (path: string) => {
    const q = {
      orderBy: () => q,
      limit: () => q,
      onSnapshot: (cb: Cb, err: (e: unknown) => void) => { subs.set(path, cb); errs.set(path, err); return () => subs.delete(path); },
      add: (data: unknown) => add(data),
      get: () => get(path),
      update: (data: unknown) => update(path, data),
      set: (data: unknown) => set(path, data),
    };
    return q;
  };
  const docs = (rows: Record<string, unknown>) => ({ docs: Object.entries(rows).map(([id, body]) => ({ id, exists: true, data: () => body })) });
  return {
    add, get, update, set, stored,
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
    // Carry 10d: the repaint lands on the next frame.
    await flush();
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
    expect([...f.subs.keys()].sort()).toEqual(['approvals', 'events', 'messages', 'meta/infinite', 'meta/metrics', 'meta/project', 'meta/run', 'notes', 'plan', 'proposals', 'runs', 'sessions', 'state']);
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
    expect([app.ui.fit, app.ui.autoOpen]).toEqual([true, true]);
    (root.querySelector('[data-action="tl-all"]') as HTMLElement).click();
    await flush();
    expect([...app.ui.expanded].sort()).toEqual(['F1', 'F2']);
    expect(app.ui.autoOpen).toBe(false);
    (root.querySelector('[data-action="tl-all"]') as HTMLElement).click();
    await flush();
    expect(app.ui.expanded.size).toBe(0);
    (root.querySelector('[data-zoom="1w"]') as HTMLElement).click();
    await flush();
    expect([app.ui.fit, app.ui.zoom]).toEqual([false, '1w']);
    (root.querySelector('[data-action="fit"]') as HTMLElement).click();
    await flush();
    expect([app.ui.fit, app.ui.span]).toEqual([true, undefined]);
    const fit = timelineWindow(app.model, app.ui);
    const canvas = root.querySelector('[data-role="tl-canvas"]') as HTMLElement;
    const wheel = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true });
    // happy-dom's WheelEvent drops the modifier keys; a browser's carries them.
    Object.defineProperty(wheel, 'ctrlKey', { value: true });
    canvas.dispatchEvent(wheel);
    await new Promise(r => setTimeout(r, 30));
    expect(app.ui.fit).toBe(false);
    expect(app.ui.span!).toBeLessThan(fit.to - fit.from);
    const before = app.ui.pan!;
    (root.querySelector('[data-role="timeline"]') as HTMLElement).focus();
    root.querySelector('[data-role="timeline"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await new Promise(r => setTimeout(r, 30));
    expect(app.ui.pan!).toBeGreaterThan(before);
    root.querySelector('[data-role="timeline"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: '0', bubbles: true }));
    await new Promise(r => setTimeout(r, 30));
    expect([app.ui.fit, app.ui.span]).toEqual([true, undefined]);
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

  it('switches views, plan filters and folds, and the timeline group', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    // A plan with categories: each phase groups its tasks by them (G-09).
    const withCats = buildDocs({ ...plan, tasks: plan.tasks.map(t => ({ ...t, category: 'api' })) }, '2026-10-11T09:00:00Z');
    history.replaceState(null, '', '#v=schedule');
    const app = await start({ claude: null, snapshot: withCats, root, now: () => NOW });
    click(root, '[data-action="tgroup"][data-group="track"]');
    await flush();
    expect(app.ui.timelineGroup).toBe('track');
    expect(root.innerHTML).toContain('data-action="toggle-phase" data-id="backend"');
    click(root, '[data-view="plan"]');
    await flush();
    expect(app.ui.view).toBe('plan');
    expect(root.innerHTML).toContain('class="pcat"');
    click(root, '[data-action="plan-filter"][data-key="free"]');
    await flush();
    expect(app.ui.planFilter).toEqual({ tasks: ['free'], phases: [], forge: [], track: null });
    expect(location.hash).toBe('#v=plan&pf=free');
    click(root, '[data-action="plan-filter"][data-key="free"]');
    await flush();
    expect(app.ui.planFilter).toBeUndefined();
    click(root, '[data-action="plan-filter"][data-key="provisional"]');
    await flush();
    expect(app.ui.planFilter!.phases).toEqual(['provisional']);
    const tsel = root.querySelector('[data-action="plan-track"]') as HTMLSelectElement;
    tsel.value = 'ui';
    tsel.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(app.ui.planFilter!.track).toBe('ui');
    expect(decodeView(location.hash).pf).toEqual(['provisional', 'tr:ui']);
    (root.querySelector('[data-action="plan-clear"]') as HTMLElement).focus();
    click(root, '[data-action="plan-clear"]');
    await flush();
    expect(app.ui.planFilter).toBeUndefined();
    // The clear button is gone with the filters: the focus goes to the view, not to the body.
    expect(root.querySelector('[data-action="plan-clear"]')).toBeNull();
    expect(document.activeElement).toBe(root.querySelector('main'));
    click(root, '[data-action="plan-all"][data-open="1"]');
    await flush();
    expect([...app.ui.planOpen!].sort()).toEqual(['F1', 'F2']);
    click(root, '[data-action="plan-phase"][data-id="F2"]');
    await flush();
    expect([...app.ui.planOpen!]).toEqual(['F1']);
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
/** C2: the digest of PROP as p1, over its normalized content, as forge computes it. */
const DIG1 = proposalDigest('p1', normalizeProposal(PROP)!);

describe('proposals', () => {
  async function bootProposals(f: ReturnType<typeof fakeDb>, user: unknown = fakeUser({ isOwner: vi.fn(async () => true) })) {
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
    // §4.1: the owner's mark first, then the proposal; C2: it carries the digest of the text it approves.
    expect(f.set).toHaveBeenCalledWith('approvals/p1', { status: 'approved', decidedAt: expect.stringMatching(ISO), by: 'page', digest: DIG1 });
    expect(f.set.mock.invocationCallOrder[0]!).toBeLessThan(f.update.mock.invocationCallOrder[0]!);
    expect((f.set.mock.calls[0]![1] as { decidedAt: string }).decidedAt).toBe((f.update.mock.calls[0]![1] as { decidedAt: string }).decidedAt);
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
    expect(f.set).toHaveBeenCalledWith('approvals/p1', { status: 'rejected', decidedAt: expect.stringMatching(ISO), by: 'page', digest: DIG1 });
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
    for (const action of ['p-approve', 'p-reject-send', 'p-comment-send', 'p-confirm']) {
      for (const id of ['../meta/project', 'p9', 'p1/x']) { inject(root, action, id); await settle(); }
    }
    expect(f.get).not.toHaveBeenCalled();
    expect(f.update).not.toHaveBeenCalled();
    expect(f.set).not.toHaveBeenCalled();
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
    expect(f.set).not.toHaveBeenCalled();
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

  it('someone who is not the owner sees no Approve or Reject, and a forged click writes nothing (§4.1)', async () => {
    const f = fakeDb();
    f.stored['proposals/p1'] = { ...PROP };
    const { root, app } = await bootProposals(f, fakeUser());
    expect(app.model.isOwner).toBe(false);
    expect(root.innerHTML).not.toContain('data-action="p-approve"');
    expect(root.innerHTML).toContain('data-action="p-comment-open"');
    expect(root.innerHTML).toContain('Solo el dueño del roadmap decide');
    inject(root, 'p-approve', 'p1');
    await settle();
    expect(f.get).not.toHaveBeenCalled();
    expect(f.set).not.toHaveBeenCalled();
    expect(f.update).not.toHaveBeenCalled();
    app.ui.reasonDraft = 'x';
    inject(root, 'p-reject-send', 'p1');
    await settle();
    f.push('proposals', { p1: { ...PROP, status: 'approved' } });
    f.push('approvals', {});
    await settle();
    expect(root.innerHTML).toContain('sin la marca del dueño');
    expect(root.innerHTML).not.toContain('data-action="p-confirm"');
    inject(root, 'p-confirm', 'p1');
    await settle();
    expect(f.get).not.toHaveBeenCalled();
    expect(f.set).not.toHaveBeenCalled();
    expect(f.update).not.toHaveBeenCalled();
    app.stop();
  });

  it('isOwner that throws or says something else counts as not the owner', async () => {
    for (const isOwner of [vi.fn(async () => { throw new Error('x'); }), vi.fn(async () => 'yes'), vi.fn(() => null)]) {
      const { app } = await bootProposals(fakeDb(), fakeUser({ isOwner }));
      expect(app.model.isOwner).toBe(false);
      app.stop();
    }
  });

  it('when the database refuses the mark, the proposal is not touched and the page says only the owner decides (§4.11)', async () => {
    const f = fakeDb();
    f.stored['proposals/p1'] = { ...PROP };
    f.set.mockRejectedValueOnce(Object.assign(new Error('nope'), { code: 'invalid_argument' }));
    const { root, app } = await bootProposals(f);
    click(root, '[data-action="p-approve"][data-id="p1"]');
    await settle();
    expect(f.set).toHaveBeenCalledTimes(1);
    expect(f.update).not.toHaveBeenCalled();
    expect(app.ui.notice).toBe('owner');
    expect(root.innerHTML).toContain('Solo el dueño del roadmap decide las propuestas');
    expect(app.model.proposalsReadOnly).toBeFalsy();
    app.stop();
  });

  it('any other failure of the mark leaves the proposal alone too, and says it could not save', async () => {
    const f = fakeDb();
    f.stored['proposals/p1'] = { ...PROP };
    f.set.mockRejectedValueOnce(new Error('network'));
    const { root, app } = await bootProposals(f);
    click(root, '[data-action="p-approve"][data-id="p1"]');
    await settle();
    expect(f.set).toHaveBeenCalledTimes(1);
    expect(f.update).not.toHaveBeenCalled();
    expect(app.ui.notice).toBe('failed');
    app.stop();
  });

  it('the owner confirms an approval of before this wave: only approvals/ is written, with the proposal’s status', async () => {
    const f = fakeDb();
    const { root, app } = await bootProposals(f);
    f.push('proposals', { p1: { ...PROP, status: 'auto_approved' } });
    f.push('approvals', {});
    await settle();
    expect(root.innerHTML).toContain('sin la marca del dueño');
    click(root, '[data-action="p-confirm"][data-id="p1"]');
    await settle();
    expect(f.set).toHaveBeenCalledWith('approvals/p1', { status: 'auto_approved', decidedAt: expect.stringMatching(ISO), by: 'page', digest: DIG1 });
    expect(f.get).not.toHaveBeenCalled();
    expect(f.update).not.toHaveBeenCalled();
    // The mark it wrote is one the page's own subscription keeps.
    f.push('approvals', { p1: f.set.mock.calls[0]![1] });
    await settle();
    expect(root.innerHTML).not.toContain('sin la marca del dueño');
    expect(root.innerHTML).not.toContain('data-action="p-confirm"');
    // Confirmed already: a forged second click writes nothing.
    inject(root, 'p-confirm', 'p1');
    await settle();
    expect(f.set).toHaveBeenCalledTimes(1);
    app.stop();
  });

  it('an approval edited after the owner’s mark says so, has no one-click confirm, and is decided again with its text in view (review I2)', async () => {
    const f = fakeDb();
    const { root, app } = await bootProposals(f);
    const edited = { ...PROP, status: 'approved', decidedBy: 'user:u1', rationale: 'why, edited after the approval' };
    f.stored['proposals/p1'] = edited;
    f.push('proposals', { p1: edited });
    f.push('approvals', { p1: { status: 'approved', decidedAt: '2026-10-11T10:00:00.000Z', by: 'page', digest: DIG1 } });
    await settle();
    expect(app.model.approvals?.p1?.digest).toBe(DIG1);
    expect(root.innerHTML).toContain('cambió después de tu decisión: revisa el texto y decide');
    expect(root.innerHTML).not.toContain('sin la marca del dueño');
    expect(root.innerHTML).not.toContain('data-action="p-confirm"');
    // A forged one-click confirm writes nothing.
    inject(root, 'p-confirm', 'p1');
    await settle();
    expect(f.set).not.toHaveBeenCalled();
    // The owner decides it again: Approve re-reads the text and binds the mark to the text as it is now.
    click(root, '[data-action="p-approve"][data-id="p1"]');
    await settle();
    const now = proposalDigest('p1', normalizeProposal(edited)!);
    expect(now).not.toBe(DIG1);
    expect(f.get).toHaveBeenCalledWith('proposals/p1');
    expect(f.set).toHaveBeenCalledWith('approvals/p1', { status: 'approved', decidedAt: expect.stringMatching(ISO), by: 'page', digest: now });
    expect(f.update).toHaveBeenCalledWith('proposals/p1', { status: 'approved', decidedBy: 'user:u1', decidedAt: expect.stringMatching(ISO) });
    f.push('approvals', { p1: f.set.mock.calls[0]![1] });
    await settle();
    expect(root.innerHTML).not.toContain('cambió después de tu decisión');
    expect(root.innerHTML).not.toContain('data-action="p-approve"');
    app.stop();
  });

  it('an approval edited after the owner’s mark can be rejected again, and the rejection replaces the mark (review I2)', async () => {
    const f = fakeDb();
    const { root, app } = await bootProposals(f);
    const edited = { ...PROP, status: 'auto_approved', path: 'src/everything/**' };
    f.stored['proposals/p1'] = edited;
    f.push('proposals', { p1: edited });
    f.push('approvals', { p1: { status: 'auto_approved', decidedAt: '2026-10-11T10:00:00.000Z', by: 'forge:policy', digest: DIG1 } });
    await settle();
    click(root, '[data-action="p-reject-open"][data-id="p1"]');
    await settle();
    typeIn(root, 'reason-text', 'la ruta cambió');
    click(root, '[data-action="p-reject-send"][data-id="p1"]');
    await settle();
    const now = proposalDigest('p1', normalizeProposal(edited)!);
    expect(f.set).toHaveBeenCalledWith('approvals/p1', { status: 'rejected', decidedAt: expect.stringMatching(ISO), by: 'page', digest: now });
    expect(f.update.mock.calls[0]![1]).toEqual({ status: 'rejected', decidedBy: 'user:u1', decidedAt: expect.stringMatching(ISO), reason: 'la ruta cambió' });
    app.stop();
  });

  it('a mark that landed with a proposal update that failed says the mark is saved, and the retry re-runs only the update (review M6)', async () => {
    const f = fakeDb();
    f.stored['proposals/p1'] = { ...PROP };
    f.update.mockRejectedValueOnce(new Error('network'));
    const { root, app } = await bootProposals(f);
    click(root, '[data-action="p-approve"][data-id="p1"]');
    await settle();
    expect(f.set).toHaveBeenCalledTimes(1);
    expect(f.update).toHaveBeenCalledTimes(1);
    expect(app.ui.notice).toBe('markSaved');
    expect(root.innerHTML).toContain('La marca está guardada; falta actualizar la propuesta');
    expect(root.innerHTML).not.toContain('No se pudo guardar');
    const first = f.update.mock.calls[0]![1];
    click(root, '[data-action="p-retry"]');
    await settle();
    expect(f.set).toHaveBeenCalledTimes(1);
    expect(f.get).toHaveBeenCalledTimes(1);
    expect(f.update).toHaveBeenCalledTimes(2);
    expect(f.update.mock.calls[1]).toEqual(['proposals/p1', first]);
    expect(app.ui.notice).toBeNull();
    expect(root.innerHTML).not.toContain('data-action="p-retry"');
    // Nothing left to retry: a forged click writes nothing.
    inject(root, 'p-retry', '');
    await settle();
    expect(f.update).toHaveBeenCalledTimes(2);
    app.stop();
  });

  it('a retry that fails again keeps the notice and its retry (review M6)', async () => {
    const f = fakeDb();
    f.stored['proposals/p1'] = { ...PROP };
    f.update.mockRejectedValueOnce(new Error('network')).mockRejectedValueOnce(new Error('network'));
    const { root, app } = await bootProposals(f);
    click(root, '[data-action="p-approve"][data-id="p1"]');
    await settle();
    click(root, '[data-action="p-retry"]');
    await settle();
    expect(f.update).toHaveBeenCalledTimes(2);
    expect(app.ui.notice).toBe('markSaved');
    expect(root.innerHTML).toContain('data-action="p-retry"');
    app.stop();
  });

  it('while isOwner resolves, neither the owner’s buttons nor «only the owner decides» show (carry 5)', async () => {
    const f = fakeDb();
    let answer: (v: unknown) => void = () => {};
    const user = fakeUser({ isOwner: vi.fn(() => new Promise(r => { answer = r; })) });
    const root = document.createElement('div');
    document.body.appendChild(root);
    const started = start({ claude: { use: async (n: string) => (n === 'db' ? f.db : n === 'user' ? user : null) }, snapshot, root, now: () => NOW });
    await settle();
    f.push('proposals', { p1: PROP });
    click(root, '[data-view="talk"]');
    await settle();
    click(root, '[data-action="talk-c"][data-c="proposals"]');
    await settle();
    expect(root.innerHTML).toContain('data-action="p-comment-open" data-id="p1"');
    expect(root.innerHTML).not.toContain('data-action="p-approve"');
    expect(root.innerHTML).not.toContain('tu comentario le llega');
    answer(true);
    const app = await started;
    await settle();
    expect(app.model.isOwner).toBe(true);
    expect(root.innerHTML).toContain('data-action="p-approve" data-id="p1"');
    expect(root.innerHTML).not.toContain('tu comentario le llega');
    app.stop();
  });

  it('a runtime that refuses the ordered query of the marks falls back once to the whole collection, bounded on the page, and the page stays live (residual 2)', async () => {
    for (const refusal of ['throws', 'errors'] as const) {
      const f = fakeDb();
      const plain: string[] = [];
      const collection = f.db.collection;
      f.db.collection = (p: string) => {
        const q = collection(p);
        if (p !== 'approvals') return q;
        return {
          ...q,
          orderBy: () => {
            if (refusal === 'throws') throw new Error('orderBy is not supported');
            return { limit: () => ({ onSnapshot: (_cb: unknown, err: (e: unknown) => void) => { setTimeout(() => err({ code: 'failed_precondition', message: 'no index' }), 0); return () => {}; } }) };
          },
          onSnapshot: (cb: Cb, err: (e: unknown) => void) => { plain.push('plain'); return q.onSnapshot(cb, err); },
        } as never;
      };
      const { root, app } = await bootProposals(f);
      expect(plain, refusal).toEqual(['plain']);
      expect(app.model.offline, refusal).toBe(false);
      expect(root.innerHTML, refusal).toContain('EN VIVO');
      // More than 1000 marks: the newest 1000 by decidedAt are kept.
      const rows: Record<string, unknown> = {};
      for (let i = 0; i < 1005; i++) rows[`q${i}`] = { status: 'approved', decidedAt: new Date(Date.UTC(2026, 9, 1) + i * 60000).toISOString(), by: 'page', digest: DIG1 };
      f.push('approvals', rows);
      await settle();
      expect(Object.keys(app.model.approvals!)).toHaveLength(1000);
      expect(app.model.approvals!.q1004).toBeDefined();
      expect(app.model.approvals!.q4).toBeUndefined();
      expect(app.model.approvals!.q5).toBeDefined();
      app.stop();
    }
  });

  it('the marks are read like the other collections, newest first and bounded (carry 5)', async () => {
    const f = fakeDb();
    const calls: unknown[][] = [];
    const collection = f.db.collection;
    f.db.collection = (p: string) => {
      const q = collection(p);
      if (p !== 'approvals') return q;
      return { ...q, orderBy: (...a: unknown[]) => { calls.push(['orderBy', ...a]); return { limit: (n: number) => { calls.push(['limit', n]); return q; } }; } } as never;
    };
    const { app } = await bootProposals(f);
    expect(calls).toEqual([['orderBy', 'decidedAt', 'desc'], ['limit', 1000]]);
    f.push('approvals', { p1: { status: 'approved', decidedAt: '2026-10-11T10:00:00.000Z', by: 'page', digest: DIG1 } });
    await settle();
    expect(app.model.approvals?.p1?.digest).toBe(DIG1);
    app.stop();
  });

  it('an approval edited and flipped to auto_approved after the owner approved it is decided again, never confirmed in one click (re-review N1)', async () => {
    const f = fakeDb();
    const { root, app } = await bootProposals(f);
    const t2 = { ...PROP, status: 'auto_approved', path: 'src/**' };
    f.stored['proposals/p1'] = t2;
    f.push('proposals', { p1: t2, p2: { ...PROP, ts: '2026-10-11T09:00:00.000Z' } });
    f.push('approvals', { p1: { status: 'approved', decidedAt: '2026-10-11T10:00:00.000Z', by: 'page', digest: DIG1 } });
    await settle();
    expect(root.innerHTML).toContain('cambió después de tu decisión: revisa el texto y decide');
    expect(root.innerHTML).not.toContain('sin la marca del dueño');
    expect(root.innerHTML).not.toContain('data-action="p-confirm"');
    // A forged one-click confirm writes nothing, for it or for a proposed one.
    for (const id of ['p1', 'p2']) { inject(root, 'p-confirm', id); await settle(); }
    expect(f.set).not.toHaveBeenCalled();
    click(root, '[data-action="p-approve"][data-id="p1"]');
    await settle();
    const now = proposalDigest('p1', normalizeProposal(t2)!);
    expect(now).not.toBe(DIG1);
    expect(f.set).toHaveBeenCalledWith('approvals/p1', { status: 'approved', decidedAt: expect.stringMatching(ISO), by: 'page', digest: now });
    expect(f.update).toHaveBeenCalledWith('proposals/p1', { status: 'approved', decidedBy: 'user:u1', decidedAt: expect.stringMatching(ISO) });
    app.stop();
  });

  it('a rejection someone turned into an approval is decided again: Reject writes a rejected mark, Approve one of the text now (re-review N1)', async () => {
    for (const decision of ['reject', 'approve'] as const) {
      const f = fakeDb();
      const { root, app } = await bootProposals(f);
      const flipped = { ...PROP, status: 'approved', path: 'src/**' };
      f.stored['proposals/p1'] = flipped;
      f.push('proposals', { p1: flipped });
      f.push('approvals', { p1: { status: 'rejected', decidedAt: '2026-10-11T10:00:00.000Z', by: 'page', digest: DIG1 } });
      await settle();
      expect(root.innerHTML).toContain('cambió después de tu decisión');
      expect(root.innerHTML).not.toContain('sin la marca del dueño');
      expect(root.innerHTML).not.toContain('data-action="p-confirm"');
      const now = proposalDigest('p1', normalizeProposal(flipped)!);
      if (decision === 'reject') {
        click(root, '[data-action="p-reject-open"][data-id="p1"]');
        await settle();
        click(root, '[data-action="p-reject-send"][data-id="p1"]');
        await settle();
        expect(f.set).toHaveBeenCalledWith('approvals/p1', { status: 'rejected', decidedAt: expect.stringMatching(ISO), by: 'page', digest: now });
        expect(f.update).toHaveBeenCalledWith('proposals/p1', { status: 'rejected', decidedBy: 'user:u1', decidedAt: expect.stringMatching(ISO) });
      } else {
        click(root, '[data-action="p-approve"][data-id="p1"]');
        await settle();
        expect(f.set).toHaveBeenCalledWith('approvals/p1', { status: 'approved', decidedAt: expect.stringMatching(ISO), by: 'page', digest: now });
      }
      expect(f.set).toHaveBeenCalledTimes(1);
      app.stop();
    }
  });

  it('the mark the page writes is the one forge computes and counts (C2)', async () => {
    const pid = 'p20261011100000abcd';
    // Whitespace the normalizer collapses: the digest is of the normalized proposal, never of the raw document.
    const doc = { ...PROP, title: '  Cache\n  prices ', status: 'approved', decidedBy: 'user:u1', decidedAt: '2026-10-11T10:30:00.000Z', estimate: '2h', path: 'src/prices.ts' };
    const f = fakeDb();
    const { root, app } = await bootProposals(f);
    f.push('proposals', { [pid]: doc });
    f.push('approvals', {});
    await settle();
    click(root, `[data-action="p-confirm"][data-id="${pid}"]`);
    await settle();
    expect(f.set).toHaveBeenCalledTimes(1);
    expect(f.set.mock.calls[0]![0]).toBe(`approvals/${pid}`);
    const written = f.set.mock.calls[0]![1] as Record<string, unknown>;
    expect(written.digest).toMatch(/^[0-9a-f]{64}$/);
    // forge's own `proposals decide <pid> confirm --from <doc>` on the same document.
    const dir = mkdtempSync(join(tmpdir(), 'page-mark-'));
    let r: ReturnType<typeof forgeCli>;
    try {
      writeFileSync(join(dir, 'db.json'), JSON.stringify(doc));
      r = forgeCli(['proposals', 'decide', pid, 'confirm', '--from', 'db.json'], { cwd: dir, now: () => new Date(NOW), env: {} });
    } finally {
      // Carry 5: the test leaves nothing behind.
      rmSync(dir, { recursive: true, force: true });
    }
    expect(existsSync(dir)).toBe(false);
    expect(r.code).toBe(0);
    const forge = (JSON.parse(r.stdout) as { approval: { data: { status: string; digest: string } } }).approval.data;
    expect(written.digest).toBe(forge.digest);
    expect(written.status).toBe(forge.status);
    const p = normalizeProposal(doc)!;
    expect(written.digest).toBe(proposalDigest(pid, p));
    expect(written.digest).not.toBe(proposalDigest(pid, doc as never));
    // A mark forge counts, and one normalizeApproval keeps as it is.
    const mark = normalizeApproval(written);
    expect(mark).toEqual(written);
    expect(ownerCheck(pid, p, mark)).toBe('ok');
    expect(ownerApproved(pid, p, mark)).toBe(true);
    f.push('approvals', { [pid]: written });
    await settle();
    expect(app.model.approvals?.[pid]).toEqual(written);
    expect(root.innerHTML).not.toContain('sin la marca del dueño');
    app.stop();
  });

  it('deciding binds the normalized text it re-read, and that mark is one forge counts (C2)', async () => {
    const f = fakeDb();
    f.stored['proposals/p1'] = { ...PROP, title: '  Cache\n  prices ' };
    const { root, app } = await bootProposals(f);
    click(root, '[data-action="p-approve"][data-id="p1"]');
    await settle();
    const written = f.set.mock.calls[0]![1] as Record<string, unknown>;
    expect(written).toEqual({ status: 'approved', decidedAt: expect.stringMatching(ISO), by: 'page', digest: DIG1 });
    const decided = normalizeProposal({ ...f.stored['proposals/p1'], ...(f.update.mock.calls[0]![1] as object) })!;
    expect(decided.status).toBe('approved');
    expect(ownerCheck('p1', decided, normalizeApproval(written))).toBe('ok');
    app.stop();
  });

  it('a proposal whose text changed since the page showed it is not decided: the owner decides only what they read', async () => {
    const f = fakeDb();
    f.stored['proposals/p1'] = { ...PROP, evidence: 'other evidence, written meanwhile' };
    const { root, app } = await bootProposals(f);
    click(root, '[data-action="p-approve"][data-id="p1"]');
    await settle();
    expect(f.get).toHaveBeenCalledWith('proposals/p1');
    expect(f.set).not.toHaveBeenCalled();
    expect(f.update).not.toHaveBeenCalled();
    expect(app.ui.notice).toBe('changed');
    expect(root.innerHTML).toContain('Esta propuesta ha cambiado mientras la leías');
    app.stop();
  });

  it('a rejection replaces the whole mark: an older auto_approved one leaves nothing behind', async () => {
    const f = fakeDb();
    // A proposal reopened after forge's policy auto-approved it: proposed again, with the old mark still there.
    f.stored['proposals/p1'] = { ...PROP };
    f.stored['approvals/p1'] = { status: 'auto_approved', decidedAt: '2026-10-11T09:00:00.000Z', by: 'forge:policy', digest: DIG1, extra: 'x' };
    f.set.mockImplementation(async (p: string, data: unknown) => { f.stored[p] = data as Record<string, unknown>; });
    const { root, app } = await bootProposals(f);
    f.push('approvals', { p1: f.stored['approvals/p1'] });
    await settle();
    click(root, '[data-action="p-reject-open"][data-id="p1"]');
    await settle();
    click(root, '[data-action="p-reject-send"][data-id="p1"]');
    await settle();
    expect(f.set).toHaveBeenCalledTimes(1);
    expect(f.stored['approvals/p1']).toEqual({ status: 'rejected', decidedAt: expect.stringMatching(ISO), by: 'page', digest: DIG1 });
    expect(f.update.mock.calls.map(c => c[0])).toEqual(['proposals/p1']);
    // Read back, the rejected mark backs no approval: a later auto_approved status would still lack the owner's mark.
    const mark = normalizeApproval(f.stored['approvals/p1']);
    expect(ownerCheck('p1', { ...normalizeProposal(PROP)!, status: 'auto_approved' }, mark)).toBe('no-mark');
    app.stop();
  });

  it('only well-formed marks under an id without a path separator count', async () => {
    const f = fakeDb();
    const { app } = await bootProposals(f);
    const ok = { status: 'approved', decidedAt: '2026-10-11T10:00:00.000Z', by: 'page', digest: DIG1 };
    f.push('approvals', {
      p1: ok,
      'p1/x': ok,
      p2: { ...ok, digest: undefined },
      p3: { ...ok, digest: 'ABC' },
      p4: { ...ok, by: 'user:u1' },
      p5: { ...ok, status: 'discussing' },
      p6: null,
    });
    await settle();
    expect(app.model.approvals).toEqual({ p1: ok });
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
    // Plan is a vertical list without a scroll of its own (G-09): the side bar is the keyed container that scrolls here,
    // and the phase in progress is the same node after the snapshot.
    const before = root.querySelector('[data-scroll-key="side"]') as HTMLElement;
    const phase = root.querySelector('[data-k="pl:F1"]');
    before.scrollTop = 900;
    f.push('state', { T001: { status: 'done' } });
    await settle();
    const after = root.querySelector('[data-scroll-key="side"]') as HTMLElement;
    expect(after).toBe(before);
    expect(after.scrollTop).toBe(900);
    expect(phase).not.toBeNull();
    expect(root.querySelector('[data-k="pl:F1"]')).toBe(phase);
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
    // §4.1: Approve is the owner's.
    const { root, app } = await boot(f, fakeUser({ isOwner: vi.fn(async () => true) }));
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

  it('Back to a schedule entry without parameters shows the defaults, not what the last entry had: «Ajustar» and the phases in progress (H-25, H-14)', async () => {
    const f = fakeDb();
    const { root, app } = await boot(f, fakeUser(), '#v=schedule&z=1w&g=track&o=ui&f=blocked&l=critical');
    f.push('state', { T002: { status: 'in_progress', owner: 'main', startedAt: '2026-10-11T11:45:00Z' } });
    await settle();
    expect([app.ui.fit, app.ui.autoOpen, app.ui.zoom, app.ui.timelineGroup, [...app.ui.expanded], app.ui.statuses, app.ui.layers]).toEqual([false, false, '1w', 'track', ['ui'], ['blocked'], ['critical']]);
    history.replaceState(null, '', '#v=schedule');
    window.dispatchEvent(new Event('popstate'));
    await settle();
    expect([app.ui.fit, app.ui.autoOpen, app.ui.span, app.ui.timelineGroup, [...app.ui.expanded], app.ui.statuses, app.ui.layers]).toEqual([true, true, undefined, 'phase', [], [], []]);
    expect(root.querySelector('[data-action="fit"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('[data-action="zoom"].on')).toBeNull();
    expect(root.querySelector('[data-action="toggle-phase"][data-id="F1"]')!.getAttribute('aria-expanded')).toBe('true');
    expect(root.querySelector('[data-action="toggle-phase"][data-id="F2"]')!.getAttribute('aria-expanded')).toBe('false');
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

  it('a hash edited with a pan far outside any date shows the schedule, never «Sin conexión» (Review Focus 3, review M5)', async () => {
    history.replaceState(null, '', '#v=schedule&s=1440&p=99999999999999');
    const root = document.createElement('div');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = await start({ claude: null, snapshot, root, now: () => NOW });
    // The render-failure banner («Sin conexión» alone) would replace the whole page, its header included.
    expect(root.innerHTML).toContain('<h1>Cronograma</h1>');
    expect(root.querySelector('[data-role="timeline"]')).not.toBeNull();
    expect(Math.abs(app.ui.pan!)).toBeLessThanOrEqual(10 * 365 * 24 * 3600000);
    // The same edit after the page loaded (hashchange), the other way.
    history.replaceState(null, '', '#v=schedule&s=1440&p=-99999999999999');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await settle();
    expect(root.innerHTML).toContain('<h1>Cronograma</h1>');
    expect(root.querySelector('[data-role="timeline"]')).not.toBeNull();
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
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

describe('one repaint per animation frame (carry 10d)', () => {
  it('a keystroke repaints once, and the keys, inputs and snapshots that come before the next frame repaint together', async () => {
    const frames: (() => void)[] = [];
    vi.stubGlobal('requestAnimationFrame', (fn: () => void) => { frames.push(fn); return frames.length; });
    try {
      const f = fakeDb();
      let paints = 0;
      history.replaceState(null, '', '#v=schedule&o=F1,F2');
      const root = document.createElement('div');
      document.body.appendChild(root);
      const app = await start({ claude: { use: async (n: string) => (n === 'db' ? f.db : n === 'user' ? fakeUser() : null) }, snapshot, root, now: () => NOW, morph: (r, h) => { paints++; morphInto(r, h); } });
      const frame = async () => { await settle(); while (frames.length) frames.shift()!(); await settle(); };
      await frame();
      paints = 0;
      const box = root.querySelector('[data-role="search"]') as HTMLInputElement;
      box.focus();
      // One key: keydown, keypress, input and keyup, each its own task.
      for (const type of ['keydown', 'keypress']) { box.dispatchEvent(new KeyboardEvent(type, { key: 'T', bubbles: true })); await flush(); }
      box.value = 'T';
      box.dispatchEvent(new Event('input', { bubbles: true }));
      await flush();
      box.dispatchEvent(new KeyboardEvent('keyup', { key: 'T', bubbles: true }));
      await flush();
      expect(paints).toBe(0);
      await frame();
      expect(paints).toBe(1);
      // Two more keys and a snapshot before the next frame: one repaint, with all of them.
      paints = 0;
      box.value = 'T0';
      box.dispatchEvent(new Event('input', { bubbles: true }));
      await flush();
      box.value = 'T00';
      box.dispatchEvent(new Event('input', { bubbles: true }));
      await flush();
      f.push('state', { T001: { status: 'done' } });
      await settle();
      expect(paints).toBe(0);
      await frame();
      expect(paints).toBe(1);
      expect(app.ui.search).toBe('T00');
      expect(root.querySelector('[data-k="t:T001"] .sd')!.className).toContain('st-done');
      app.stop();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a frame that does not come (a hidden page) is not waited for long: the page still repaints', async () => {
    vi.stubGlobal('requestAnimationFrame', () => 0);
    try {
      const f = fakeDb();
      const { root, app } = await boot(f, fakeUser());
      f.push('notes', { n1: { ts: '2026-10-11T11:00:00Z', type: 'idea', author: 'session:backend', text: 'sin marcos' } });
      await new Promise(r => setTimeout(r, 250));
      click(root, '[data-view="talk"]');
      await new Promise(r => setTimeout(r, 250));
      expect(root.innerHTML).toContain('sin marcos');
      app.stop();
    } finally {
      vi.unstubAllGlobals();
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

describe('the timeline scroll, edge cases (H-06)', () => {
  const open = async (o?: string) => {
    const { bigSnapshot } = await import('./fixtures/big-plan.js');
    const big = bigSnapshot(NOW);
    history.replaceState(null, '', `#v=schedule&o=${o ?? big.phases.map(p => p.id).join(',')}`);
    const root = document.createElement('div');
    document.body.appendChild(root);
    const app = await start({ claude: null, snapshot: big, root, now: () => NOW });
    await settle();
    const tl = () => root.querySelector('[data-role="timeline"]') as HTMLElement;
    const scrollTo = async (row: number) => {
      const el = tl();
      Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 358 * 28 });
      Object.defineProperty(el, 'clientHeight', { configurable: true, value: 560 });
      el.scrollTop = row * 28;
      el.dispatchEvent(new Event('scroll'));
      await new Promise(r => setTimeout(r, 60));
      await settle();
    };
    return { app, root, tl, scrollTo };
  };

  it('a small scroll updates ui.tl but does not repaint', async () => {
    const { app, tl, scrollTo } = await open();
    await scrollTo(5);
    expect(app.ui.tl).toEqual({ first: 5, count: 21 });
    expect(tl().dataset.start).toBe('0');
    expect(tl().dataset.end).toBe('55');
    app.stop();
  });

  it('scrolling back to the top repaints from row 0 with no rows above', async () => {
    const { app, root, tl, scrollTo } = await open();
    await scrollTo(200);
    expect(tl().dataset.start).toBe('180');
    await scrollTo(0);
    expect(tl().dataset.start).toBe('0');
    expect(tl().dataset.end).toBe('41');
    expect(root.innerHTML).not.toContain('* 180)');
    app.stop();
  });

  // Review I1: what the person sees, not how: a timeline that grows past the limit paints around the row in view.
  const toBottom = async (el: HTMLElement, rows: number) => {
    Object.defineProperty(el, 'scrollHeight', { configurable: true, value: rows * 28 });
    Object.defineProperty(el, 'clientHeight', { configurable: true, value: 560 });
    el.scrollTop = rows * 28 - 560;
    el.dispatchEvent(new Event('scroll'));
    await new Promise(r => setTimeout(r, 60));
    await settle();
  };
  const paintsTheRowInView = (el: HTMLElement) => {
    const first = Math.floor(el.scrollTop / 28);
    expect(Number(el.dataset.rows)).toBeGreaterThan(150);
    expect(Number(el.dataset.start)).toBeLessThanOrEqual(first);
    expect(first).toBeLessThan(Number(el.dataset.end));
  };

  it('a 130-row timeline scrolled to its bottom paints the rows in view after «Desplegar todo» (review I1)', async () => {
    const { app, root, tl } = await open('F1,F2,F3,F4,F5');
    expect(tl().dataset.rows).toBe('130');
    expect(tl().dataset.start).toBeUndefined();
    await toBottom(tl(), 130);
    click(root, '[data-action="tl-all"]');
    await settle();
    expect(tl().dataset.rows).toBe('358');
    paintsTheRowInView(tl());
    app.stop();
  });

  it('clearing a search that had narrowed the timeline to 150 rows or fewer paints the rows in view (review I1)', async () => {
    const { app, root, tl } = await open();
    typeIn(root, 'search', 'T0');
    await settle();
    const narrowed = Number(tl().dataset.rows);
    expect(narrowed).toBeLessThanOrEqual(150);
    await toBottom(tl(), narrowed);
    typeIn(root, 'search', '');
    await settle();
    expect(tl().dataset.rows).toBe('358');
    paintsTheRowInView(tl());
    app.stop();
  });

  it('a focused row that the repaint no longer paints leaves the focus on the timeline, never on the body (review M1)', async () => {
    const { app, root, tl, scrollTo } = await open();
    const row = root.querySelector('[data-k="t:T010"]') as HTMLElement;
    row.focus();
    expect(document.activeElement).toBe(row);
    // End or PageDown: the browser scrolls the timeline (happy-dom does not, so the scroll is set by hand).
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    await scrollTo(250);
    expect(tl().dataset.start).toBe('230');
    expect(root.contains(row)).toBe(false);
    expect(document.activeElement).toBe(tl());
    // The arrow keys still pan: the focus is in the timeline.
    const pan = app.ui.pan ?? 0;
    tl().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await settle();
    expect(app.ui.pan).toBeGreaterThan(pan);
    app.stop();
  });
});

describe('«Te necesita»: the deferred findings seen in this browser (G-24)', () => {
  const KEY = 'wp-seen-deferred:demo-shop';
  const doneAt = (days: number) => new Date(NOW - days * 86_400_000).toISOString();
  const done = (days: number, merged = false) => ({ status: 'done', doneAt: doneAt(days), forge: { v: 2, path: 'medium', phase: 'done', validators: [], brief: 1, stage: 'done',
    rounds: [], verify: null, stages: {}, integration: { branch: 'forge/run-x', sha: 'abc1234', merged, target: 'main' }, deferred: [{ problem: 'no index' }, { problem: 'n+1' }],
    acceptedRound: 1, overCap: false, updatedAt: doneAt(days) } });
  beforeEach(() => { localStorage.clear(); });

  it('[Visto] keeps a mark in this browser only and the entry goes; nothing is written to the roadmap', async () => {
    const f = fakeDb();
    const { root, app } = await boot(f, fakeUser());
    f.push('state', { T001: done(1) });
    await settle();
    expect(root.innerHTML).toContain('2 hallazgos aplazados en 1 tarea');
    click(root, '[data-action="seen-deferred"]');
    await settle();
    expect(root.innerHTML).not.toContain('hallazgos aplazados');
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ T001: doneAt(1) });
    expect(f.add).not.toHaveBeenCalled();
    expect(f.update).not.toHaveBeenCalled();
    expect(f.set).not.toHaveBeenCalled();
    app.stop();
  });

  it('when the states arrive, the marks of a merged task or of one done 8 days ago are cleaned; a good one still hides its entry', async () => {
    localStorage.setItem(KEY, JSON.stringify({ T001: doneAt(1), T002: doneAt(8), T003: doneAt(2) }));
    const f = fakeDb();
    const { root, app } = await boot(f, fakeUser());
    f.push('state', { T001: done(1, true), T002: done(8), T003: done(2) });
    await settle();
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ T003: doneAt(2) });
    expect(root.innerHTML).not.toContain('hallazgos aplazados');
    app.stop();
  });

  it('with a localStorage that throws, the entry shows, and [Visto] hides it for this visit (Review Focus 4)', async () => {
    const get = vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    const put = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    const f = fakeDb();
    const { root, app } = await boot(f, fakeUser());
    f.push('state', { T001: done(1) });
    await settle();
    expect(root.innerHTML).toContain('hallazgos aplazados');
    click(root, '[data-action="seen-deferred"]');
    await settle();
    expect(root.innerHTML).not.toContain('hallazgos aplazados');
    get.mockRestore();
    put.mockRestore();
    app.stop();
  });

  it('without a project name no key is read or written: the marks last this visit (carry 7)', async () => {
    const get = vi.spyOn(localStorage, 'getItem');
    const put = vi.spyOn(localStorage, 'setItem');
    const f = fakeDb();
    const root = document.createElement('div');
    document.body.appendChild(root);
    const app = await start({ claude: { use: async (n: string) => (n === 'db' ? f.db : n === 'user' ? fakeUser() : null) }, snapshot: null, root, now: () => NOW });
    await settle();
    f.push('state', { T001: done(1) });
    await settle();
    const b = document.createElement('button');
    b.dataset.action = 'seen-deferred';
    b.dataset.ids = 'T001';
    root.appendChild(b);
    b.click();
    await settle();
    expect(app.model.seenDeferred).toEqual({ T001: doneAt(1) });
    const seenKeys = (calls: unknown[][]) => calls.map(c => String(c[0])).filter(k => k.startsWith('wp-seen-deferred'));
    expect(seenKeys(get.mock.calls)).toEqual([]);
    expect(seenKeys(put.mock.calls)).toEqual([]);
    get.mockRestore();
    put.mockRestore();
    app.stop();
  });

  it('a stored value that is not a map of dates counts as no mark (Review Focus 4)', async () => {
    localStorage.setItem(KEY, '{"T001": 5');
    const f = fakeDb();
    const { root, app } = await boot(f, fakeUser());
    f.push('state', { T001: done(1) });
    await settle();
    expect(root.innerHTML).toContain('hallazgos aplazados');
    app.stop();
  });
});

describe('the task detail: its URL, its tabs and its focus (H-25, §4.7, G-15)', () => {
  const RUNNING = { T003: { status: 'in_progress', owner: 'main', startedAt: '2026-10-11T11:30:00Z', forge: { path: 'medium', phase: 'review' } } };
  const openFromSummary = async (f: ReturnType<typeof fakeDb>, root: HTMLElement) => {
    f.push('state', RUNNING);
    await settle();
    click(root, '[data-k="t:T003"]');
    await settle();
  };

  it('opening a task pushes #t=…, a tab rewrites it with tt, and Back closes the detail', async () => {
    const f = fakeDb();
    const { root, app } = await boot(f, fakeUser());
    const push = vi.spyOn(history, 'pushState');
    await openFromSummary(f, root);
    expect(push).toHaveBeenLastCalledWith(null, '', '#t=T003');
    click(root, '[data-action="detail-tab"][data-tab="forge"]');
    await settle();
    expect(push).toHaveBeenCalledTimes(1);
    expect(location.hash).toBe('#t=T003&tt=forge');
    expect(root.querySelector('#dtab-forge')!.getAttribute('aria-selected')).toBe('true');
    history.replaceState(null, '', location.pathname);
    window.dispatchEvent(new Event('popstate'));
    await settle();
    expect(app.ui.modal).toBeNull();
    expect(root.querySelector('.modal')).toBeNull();
    expect(document.documentElement.classList.contains('wp-modal')).toBe(false);
    push.mockRestore();
    app.stop();
  });

  it('closing goes back over every entry the detail pushed; a detail opened from a link rewrites the URL without t', async () => {
    const f = fakeDb();
    const { root, app } = await boot(f, fakeUser());
    const go = vi.spyOn(history, 'go').mockImplementation(() => {});
    await openFromSummary(f, root);
    click(root, '.modal [data-action="open-task"][data-id="T005"]');
    await settle();
    expect(app.ui.modal).toBe('T005');
    click(root, '.modal [data-action="close-modal"]');
    await settle();
    expect(go).toHaveBeenCalledWith(-2);
    expect(app.ui.modal).toBeNull();
    go.mockClear();
    app.stop();
    const again = await boot(fakeDb(), fakeUser(), '#t=T003&tt=definition');
    expect([again.app.ui.modal, again.app.ui.tab]).toEqual(['T003', 'definition']);
    expect(again.root.querySelector('#dtab-definition')!.getAttribute('aria-selected')).toBe('true');
    click(again.root, '.modal [data-action="close-modal"]');
    await settle();
    expect(go).not.toHaveBeenCalled();
    expect(location.hash).toBe('');
    go.mockRestore();
    again.app.stop();
  });

  it('#t=…&tt=forge opens the Forge tab once the task has forge data; a task not in the plan opens nothing (Review Focus 3)', async () => {
    const f = fakeDb();
    const { root, app } = await boot(f, fakeUser(), '#t=T003&tt=forge');
    expect(root.querySelector('#dtab-summary')!.getAttribute('aria-selected')).toBe('true');
    f.push('state', RUNNING);
    await settle();
    expect(root.querySelector('#dtab-forge')!.getAttribute('aria-selected')).toBe('true');
    app.stop();
    const none = await boot(fakeDb(), fakeUser(), '#t=T999&tt=forge');
    expect(none.app.ui.modal).toBeNull();
    expect(none.root.querySelector('.modal')).toBeNull();
    none.app.stop();
  });

  it('focus: the active tab on opening, Tab and Shift+Tab stay in the dialog, Escape closes and the focus goes back to the row', async () => {
    const f = fakeDb();
    const { root, app } = await boot(f, fakeUser());
    const go = vi.spyOn(history, 'go').mockImplementation(() => {});
    await openFromSummary(f, root);
    expect(document.activeElement?.id).toBe('dtab-summary');
    const close = root.querySelector('.modal [data-action="close-modal"]') as HTMLElement;
    const panel = root.querySelector('#dpanel-summary') as HTMLElement;
    panel.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(close);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    expect(document.activeElement).toBe(panel);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(root.querySelector('.modal')).toBeNull();
    expect(document.activeElement).toBe(root.querySelector('[data-k="t:T003"]'));
    expect(go).toHaveBeenCalledWith(-1);
    go.mockRestore();
    app.stop();
  });

  it('the arrows, Home and End move between the tabs, and the focus goes with them', async () => {
    const f = fakeDb();
    const { root, app } = await boot(f, fakeUser());
    await openFromSummary(f, root);
    const key = (k: string) => { (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); return settle(); };
    await key('ArrowRight');
    expect([app.ui.tab, document.activeElement?.id]).toEqual(['definition', 'dtab-definition']);
    await key('End');
    expect([app.ui.tab, document.activeElement?.id]).toEqual(['talk', 'dtab-talk']);
    await key('ArrowRight');
    expect(app.ui.tab).toBe('summary');
    await key('ArrowLeft');
    expect(app.ui.tab).toBe('talk');
    await key('Home');
    expect([app.ui.tab, document.activeElement?.id]).toEqual(['summary', 'dtab-summary']);
    app.stop();
  });

  it('a snapshot of the plan that drops the open task closes its detail and unlocks the page (Review Focus 2)', async () => {
    const f = fakeDb();
    const { root, app } = await boot(f, fakeUser());
    await openFromSummary(f, root);
    expect(document.documentElement.classList.contains('wp-modal')).toBe(true);
    f.push('meta/project', snapshot.meta as unknown as Record<string, unknown>);
    f.push('plan', Object.fromEntries(snapshot.phases.map(p => [p.id, { ...p, tasks: p.tasks.filter(t => t.id !== 'T003') }])));
    await settle();
    expect(app.ui.modal).toBeNull();
    expect(root.querySelector('.modal')).toBeNull();
    expect(document.documentElement.classList.contains('wp-modal')).toBe(false);
    expect(location.hash).not.toContain('t=');
    app.stop();
  });

  it('the gallery takes the focus, keeps Tab, and gives the focus back to its screenshot on Escape', async () => {
    const f = fakeDb();
    const { root, app } = await boot(f, fakeUser());
    f.push('state', { T003: { ...RUNNING.T003, evidence: { surfaces: ['web'], result: 'pass', passed: 1, total: 1, shots: [{ surface: 'web', check: 'home', ok: true, url: 'https://claude.ai/_blob/a' }] } } });
    await settle();
    click(root, '[data-k="t:T003"]');
    await settle();
    click(root, '[data-action="detail-tab"][data-tab="forge"]');
    await settle();
    click(root, '[data-action="open-shot"][data-i="0"]');
    await settle();
    expect(document.activeElement).toBe(root.querySelector('.lightbox'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(root.querySelector('.lightbox'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(root.querySelector('.lightbox')).toBeNull();
    expect(document.activeElement).toBe(root.querySelector('[data-k="shot:0"]'));
    expect(app.ui.modal).toBe('T003');
    app.stop();
  });

  it('closing never goes back over an entry it did not push: after Back, after Forward, after a push the browser refused (H-25)', async () => {
    const f = fakeDb();
    const { root, app } = await boot(f, fakeUser());
    const go = vi.spyOn(history, 'go').mockImplementation(() => {});
    await openFromSummary(f, root);
    // A traversal brings back the entry's own history state (the mark the page gave it): the simulations carry it.
    const at3: unknown = history.state;
    click(root, '.modal [data-action="open-task"][data-id="T005"]');
    await settle();
    const at5: unknown = history.state;
    // The person goes Back once; a browser fires popstate and then hashchange for that one entry.
    history.replaceState(at3, '', '#t=T003');
    window.dispatchEvent(new Event('popstate'));
    window.dispatchEvent(new Event('hashchange'));
    await settle();
    expect(app.ui.modal).toBe('T003');
    click(root, '.modal [data-action="close-modal"]');
    await settle();
    expect(go).toHaveBeenLastCalledWith(-1);
    go.mockClear();
    // Forward onto T005's entry: its mark and its hash say it is the second entry this visit pushed.
    history.replaceState(at5, '', '#t=T005');
    window.dispatchEvent(new Event('popstate'));
    await settle();
    expect(app.ui.modal).toBe('T005');
    click(root, '.modal [data-action="close-modal"]');
    await settle();
    expect(go).toHaveBeenLastCalledWith(-2);
    go.mockClear();
    // An entry with t and no mark of this visit (a hand edit, a reload's, another visit's): closing rewrites the URL.
    for (const state of [null, { wp: 'another-visit', d: 1, b: '' }]) {
      history.replaceState(state, '', '#t=T003');
      window.dispatchEvent(new Event('popstate'));
      await settle();
      expect(app.ui.modal).toBe('T003');
      click(root, '.modal [data-action="close-modal"]');
      await settle();
      expect(go).not.toHaveBeenCalled();
      expect(location.hash).toBe('');
    }
    // A push the browser refuses (a sandboxed frame) is no entry to go back over.
    const push = vi.spyOn(history, 'pushState').mockImplementation(() => { throw new Error('denied'); });
    click(root, '[data-k="t:T003"]');
    await settle();
    expect(app.ui.modal).toBe('T003');
    click(root, '.modal [data-action="close-modal"]');
    await settle();
    expect(go).not.toHaveBeenCalled();
    expect(app.ui.modal).toBeNull();
    push.mockRestore();
    go.mockRestore();
    app.stop();
  });

  it('when what opened the detail is gone, or a link opened it, closing leaves the focus on the main element, never on the body', async () => {
    const f = fakeDb();
    const { root, app } = await boot(f, fakeUser());
    const go = vi.spyOn(history, 'go').mockImplementation(() => {});
    await openFromSummary(f, root);
    // T003 is done: its row leaves «En curso».
    f.push('state', { T003: { status: 'done', startedAt: '2026-10-11T11:30:00Z', doneAt: '2026-10-11T11:50:00Z' } });
    await settle();
    expect(root.querySelector('[data-k="t:T003"]')).toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(root.querySelector('.modal')).toBeNull();
    expect(document.activeElement).toBe(root.querySelector('main'));
    // A browser focuses <main> only with a tabindex; -1 keeps it out of the Tab order.
    expect(root.querySelector('main')!.getAttribute('tabindex')).toBe('-1');
    app.stop();
    const again = await boot(fakeDb(), fakeUser(), '#t=T003');
    expect(document.activeElement?.id).toBe('dtab-summary');
    click(again.root, '.modal [data-action="close-modal"]');
    await settle();
    expect(document.activeElement).toBe(again.root.querySelector('main'));
    go.mockRestore();
    again.app.stop();
  });

  it('keys with modifiers stay the browser’s: Alt+arrow on a tab, Ctrl+Escape and Ctrl+Tab leave the detail as it is', async () => {
    const f = fakeDb();
    const { root, app } = await boot(f, fakeUser());
    await openFromSummary(f, root);
    const tab = document.activeElement as HTMLElement;
    expect(tab.id).toBe('dtab-summary');
    const alt = new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true, cancelable: true });
    tab.dispatchEvent(alt);
    await settle();
    expect([app.ui.tab, alt.defaultPrevented, document.activeElement]).toEqual(['summary', false, tab]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', ctrlKey: true, bubbles: true }));
    await settle();
    expect(app.ui.modal).toBe('T003');
    (root.querySelector('.modal [data-action="close-modal"]') as HTMLElement).focus();
    const ctrlTab = new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(ctrlTab);
    expect(ctrlTab.defaultPrevented).toBe(false);
    app.stop();
  });

  it('Back onto another task’s entry shows that task and closes the gallery of the one that was open', async () => {
    const f = fakeDb();
    const { root, app } = await boot(f, fakeUser());
    const evidence = { surfaces: ['web'], result: 'pass', passed: 1, total: 1, shots: [{ surface: 'web', check: 'home', ok: true, url: 'https://claude.ai/_blob/a' }] };
    f.push('state', { T003: { ...RUNNING.T003, evidence }, T005: { status: 'free', evidence } });
    await settle();
    click(root, '[data-k="t:T003"]');
    await settle();
    click(root, '[data-action="detail-tab"][data-tab="forge"]');
    await settle();
    click(root, '[data-action="open-shot"][data-i="0"]');
    await settle();
    expect(app.ui.shot).toBe(0);
    history.replaceState(null, '', '#t=T005');
    window.dispatchEvent(new Event('popstate'));
    await settle();
    expect([app.ui.modal, app.ui.tab, app.ui.shot]).toEqual(['T005', 'summary', null]);
    expect(root.querySelector('.lightbox')).toBeNull();
    expect(document.activeElement?.id).toBe('dtab-summary');
    app.stop();
  });

  it('a Back by several entries at once (the history menu) leaves only the entries under that one to go back over (review I1)', async () => {
    const f = fakeDb();
    const { root, app } = await boot(f, fakeUser());
    const go = vi.spyOn(history, 'go').mockImplementation(() => {});
    const push = vi.spyOn(history, 'pushState');
    await openFromSummary(f, root);
    click(root, '[data-action="detail-tab"][data-tab="forge"]');
    await settle();
    expect(location.hash).toBe('#t=T003&tt=forge');
    const first: unknown = history.state;
    click(root, '.modal [data-action="open-task"][data-id="T005"]');
    await settle();
    click(root, '.modal [data-action="open-task"][data-id="T004"]');
    await settle();
    expect([app.ui.modal, push.mock.calls.length]).toEqual(['T004', 3]);
    // The menu jumps two entries back at once: one popstate, onto the first detail's entry (with its own state).
    history.replaceState(first, '', '#t=T003&tt=forge');
    window.dispatchEvent(new Event('popstate'));
    await settle();
    expect([app.ui.modal, app.ui.tab]).toEqual(['T003', 'forge']);
    click(root, '.modal [data-action="close-modal"]');
    await settle();
    // One entry under it was this visit's: Back over it, never over the page's own first entry.
    expect(go.mock.calls).toEqual([[-1]]);
    expect(app.ui.modal).toBeNull();
    push.mockRestore();
    go.mockRestore();
    app.stop();
  });

  it('a link to a task the embedded plan lacks keeps t in the URL until the database’s plan is in, then opens on its tab (review I2)', async () => {
    const f = fakeDb();
    const { root, app } = await boot(f, fakeUser(), '#t=T007&tt=definition');
    expect([app.ui.modal, root.querySelector('.modal')]).toEqual([null, null]);
    expect(location.hash).toBe('#t=T007&tt=definition');
    f.push('state', { T001: { status: 'done' } });
    await settle();
    expect(location.hash).toBe('#t=T007&tt=definition');
    const T007 = { ...snapshot.phases[0]!.tasks[0]!, id: 'T007', title: 'Tarea-nueva-T007', depends_on: [] };
    f.push('plan', Object.fromEntries(snapshot.phases.map((p, i) => [p.id, i === 0 ? { ...p, tasks: [...p.tasks, T007] } : p])));
    await settle();
    expect([app.ui.modal, app.ui.tab]).toEqual(['T007', 'definition']);
    expect(root.querySelector('.modal')!.textContent).toContain('Tarea-nueva-T007');
    expect(document.activeElement?.id).toBe('dtab-definition');
    expect(location.hash).toBe('#t=T007&tt=definition');
    app.stop();
  });

  it('a link to a task in neither plan loses t once the database’s plan is in, and at once offline (review I2)', async () => {
    const f = fakeDb();
    const { app } = await boot(f, fakeUser(), '#t=T999&tt=forge');
    expect(app.ui.modal).toBeNull();
    expect(location.hash).toBe('#t=T999&tt=forge');
    f.push('plan', Object.fromEntries(snapshot.phases.map(p => [p.id, p])));
    await settle();
    expect(app.ui.modal).toBeNull();
    expect(location.hash).toBe('');
    app.stop();
    history.replaceState(null, '', '#t=T999');
    const offline = await start({ claude: null, snapshot, root: document.createElement('div'), now: () => NOW });
    await settle();
    expect([offline.ui.modal, location.hash]).toEqual([null, '']);
    offline.stop();
  });

  it('with no embedded plan, a link waits for both the plan and the meta it is built with (review I2)', async () => {
    const f = fakeDb();
    history.replaceState(null, '', '#t=T003');
    const root = document.createElement('div');
    document.body.appendChild(root);
    const app = await start({ claude: { use: async (n: string) => (n === 'db' ? f.db : n === 'user' ? fakeUser() : null) }, snapshot: null, root, now: () => NOW });
    await settle();
    expect(location.hash).toBe('#t=T003');
    f.push('plan', Object.fromEntries(snapshot.phases.map(p => [p.id, p])));
    await settle();
    expect([app.ui.modal, location.hash]).toEqual([null, '#t=T003']);
    f.push('meta/project', snapshot.meta as unknown as Record<string, unknown>);
    await settle();
    expect(app.ui.modal).toBe('T003');
    expect(location.hash).toBe('#t=T003');
    app.stop();
  });

  it('a dependency opened from a detail a link opened closes back to the linked task; closing that leaves the view without t (review M1)', async () => {
    const f = fakeDb();
    const go = vi.spyOn(history, 'go').mockImplementation(() => {});
    const { root, app } = await boot(f, fakeUser(), '#t=T003');
    click(root, '.modal [data-action="open-task"][data-id="T005"]');
    await settle();
    expect([app.ui.modal, location.hash]).toEqual(['T005', '#t=T005']);
    click(root, '.modal [data-action="close-modal"]');
    await settle();
    // Back lands on the link's entry: the page shows its detail at once, never the bare view in between.
    expect(go).toHaveBeenLastCalledWith(-1);
    expect(app.ui.modal).toBe('T003');
    expect(document.activeElement?.id).toBe('dtab-summary');
    // Where Back lands (the link's entry has no state): nothing changes.
    history.replaceState(null, '', '#t=T003');
    window.dispatchEvent(new Event('popstate'));
    await settle();
    expect(app.ui.modal).toBe('T003');
    go.mockClear();
    click(root, '.modal [data-action="close-modal"]');
    await settle();
    expect(go).not.toHaveBeenCalled();
    expect([app.ui.modal, location.hash]).toEqual([null, '']);
    expect(document.activeElement).toBe(root.querySelector('main'));
    go.mockRestore();
    app.stop();
  });

  it('an opener whose data-k holds quotes, brackets and a newline gets the focus back, with no CSS.escape; the page never goes offline (review M2)', async () => {
    vi.stubGlobal('CSS', {});
    const go = vi.spyOn(history, 'go').mockImplementation(() => {});
    try {
      const f = fakeDb();
      const { root, app } = await boot(f, fakeUser());
      const id = 'e"]\n[x';
      f.push('events', { [id]: { ts: '2026-10-11T11:00:00Z', type: 'done', sessionId: 'main', taskId: 'T003', text: 'evento-raro' } });
      await settle();
      const act = root.querySelector('button.act[data-id="T003"]') as HTMLElement;
      expect(act.dataset.k).toBe(`e:${id}`);
      act.click();
      await settle();
      expect(app.ui.modal).toBe('T003');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await settle();
      expect(app.model.offline).toBe(false);
      expect(root.querySelector('.modal')).toBeNull();
      expect(document.activeElement).toBe(root.querySelector('button.act[data-id="T003"]'));
      app.stop();
    } finally {
      vi.unstubAllGlobals();
      go.mockRestore();
    }
  });

  it('Escape during an IME composition is the composition’s, Safari’s last keydown (keyCode 229) too (review M3, M4)', async () => {
    const f = fakeDb();
    const { root, app } = await boot(f, fakeUser());
    const go = vi.spyOn(history, 'go').mockImplementation(() => {});
    await openFromSummary(f, root);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 229, bubbles: true }));
    await settle();
    expect(app.ui.modal).toBe('T003');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(app.ui.modal).toBeNull();
    go.mockRestore();
    app.stop();
  });

  it('when the plan drops the open task, the focus goes to what opened the detail, or to the main element when that went too (review M4)', async () => {
    const f = fakeDb();
    const { root, app } = await boot(f, fakeUser());
    const go = vi.spyOn(history, 'go').mockImplementation(() => {});
    const without = (id: string) => Object.fromEntries(snapshot.phases.map(p => [p.id, { ...p, tasks: p.tasks.filter(t => t.id !== id) }]));
    await openFromSummary(f, root);
    click(root, '.modal [data-action="open-task"][data-id="T005"]');
    await settle();
    f.push('plan', without('T005'));
    await settle();
    expect(app.ui.modal).toBeNull();
    expect(document.activeElement).toBe(root.querySelector('[data-k="t:T003"]'));
    f.push('plan', Object.fromEntries(snapshot.phases.map(p => [p.id, p])));
    await settle();
    click(root, '[data-k="t:T003"]');
    await settle();
    expect(app.ui.modal).toBe('T003');
    f.push('plan', without('T003'));
    await settle();
    expect(app.ui.modal).toBeNull();
    expect(root.querySelector('[data-k="t:T003"]')).toBeNull();
    expect(document.activeElement).toBe(root.querySelector('main'));
    go.mockRestore();
    app.stop();
  });

  it('closing the detail with ✕, Escape or Back changes only the detail: the schedule keeps its ‹ › offset, zoom and search, and the URL keeps them (review N1)', async () => {
    const f = fakeDb();
    const { root, app } = await boot(f, fakeUser(), '#v=schedule&z=1w&q=Maqueta&o=F1');
    // Back is a real one here (happy-dom moves the URL to the entry under it, without events).
    const go = vi.spyOn(history, 'go');
    click(root, '[data-action="shift"][data-dir="-1"]');
    await settle();
    const base = location.hash;
    expect(base).toBe('#v=schedule&z=1w&o=F1&q=Maqueta');
    const view = () => [app.ui.view, app.ui.offset, app.ui.zoom, app.ui.search, [...app.ui.expanded]];
    const before = view();
    expect(before).toEqual(['schedule', -1, '1w', 'Maqueta', ['F1']]);
    const closes: [string, () => void][] = [
      ['✕', () => click(root, '.modal [data-action="close-modal"]')],
      ['Escape', () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))],
      // The person's own Back onto the entry under the detail.
      ['Back', () => { history.replaceState(null, '', base); window.dispatchEvent(new Event('popstate')); }],
    ];
    for (const [how, close] of closes) {
      click(root, '.tr.tk[data-id="T003"]');
      await settle();
      expect(app.ui.modal, how).toBe('T003');
      expect(location.hash, how).toBe(`${base}&t=T003`);
      close();
      await settle();
      expect(app.ui.modal, how).toBeNull();
      expect(view(), how).toEqual(before);
      expect(location.hash, how).toBe(base);
    }
    expect(go.mock.calls).toEqual([[-1], [-1]]);
    go.mockRestore();
    app.stop();
  });

  it('a pending link settles on the plan’s first snapshot or the plan’s own error, never on another subscription’s error (review N2)', async () => {
    const f = fakeDb();
    const { root, app } = await boot(f, fakeUser(), '#t=T007&tt=definition');
    f.fail('events');
    f.fail('approvals');
    await settle();
    expect([app.ui.modal, location.hash]).toEqual([null, '#t=T007&tt=definition']);
    const T007 = { ...snapshot.phases[0]!.tasks[0]!, id: 'T007', title: 'Tarea-nueva-T007', depends_on: [] };
    f.push('plan', Object.fromEntries(snapshot.phases.map((p, i) => [p.id, i === 0 ? { ...p, tasks: [...p.tasks, T007] } : p])));
    await settle();
    expect([app.ui.modal, app.ui.tab]).toEqual(['T007', 'definition']);
    expect(root.querySelector('#dtab-definition')!.getAttribute('aria-selected')).toBe('true');
    app.stop();
    const g = fakeDb();
    const failed = await boot(g, fakeUser(), '#t=T007');
    expect(location.hash).toBe('#t=T007');
    g.fail('plan');
    await settle();
    expect([failed.app.ui.modal, location.hash]).toEqual([null, '']);
    failed.app.stop();
  });
});

describe('the bars of the timeline (G-15)', () => {
  it('a click on a bar opens its task like its row does', async () => {
    history.replaceState(null, '', '#v=schedule&o=F1');
    const root = document.createElement('div');
    document.body.appendChild(root);
    const app = await start({ claude: null, snapshot, root, now: () => NOW });
    const bar = root.querySelector('.gb[data-id="T001"]') as HTMLElement;
    expect(bar.getAttribute('aria-hidden')).toBe('true');
    bar.click();
    await settle();
    expect(app.ui.modal).toBe('T001');
    app.stop();
  });
});

describe('the task chip of a note (Task 11 carry)', () => {
  it('opening the detail from it and closing with Escape gives the focus back to the chip', async () => {
    const f = fakeDb();
    const { root, app } = await boot(f, fakeUser());
    const go = vi.spyOn(history, 'go').mockImplementation(() => {});
    f.push('notes', { n1: { ts: '2026-10-11T11:00:00Z', type: 'idea', author: 'session:backend', text: 'con tarea', taskId: 'T003' } });
    click(root, '[data-view="talk"]');
    await settle();
    click(root, '[data-k="tk:n1"]');
    await settle();
    expect(app.ui.modal).toBe('T003');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(root.querySelector('.modal')).toBeNull();
    expect(document.activeElement).toBe(root.querySelector('[data-k="tk:n1"]'));
    go.mockRestore();
    app.stop();
  });

  it('two notes about the same task: the focus goes back to the chip of the note the detail was opened from (review M2)', async () => {
    const f = fakeDb();
    const { root, app } = await boot(f, fakeUser());
    const go = vi.spyOn(history, 'go').mockImplementation(() => {});
    const n = (ts: string, text: string) => ({ ts, type: 'idea', author: 'session:backend', text, taskId: 'T003' });
    f.push('notes', { a: n('2026-10-11T10:00:00Z', 'la vieja'), b: n('2026-10-11T11:00:00Z', 'la nueva') });
    click(root, '[data-view="talk"]');
    await settle();
    expect(root.querySelectorAll('[data-k^="tk:"]')).toHaveLength(2);
    const older = root.querySelector('[data-k="n:a"] [data-action="open-task"]') as HTMLElement;
    expect(older.dataset.k).toBe('tk:a');
    older.click();
    await settle();
    expect(app.ui.modal).toBe('T003');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(document.activeElement).toBe(root.querySelector('[data-k="tk:a"]'));
    expect((document.activeElement as HTMLElement).closest('[data-k^="n:"]')?.getAttribute('data-k')).toBe('n:a');
    go.mockRestore();
    app.stop();
  });
});

describe('the schedule opens fitted, with the phases in progress open (H-14)', () => {
  it('without a hash it fits the whole plan and opens the phases in progress; a fold and a zoom of the person stay', async () => {
    const f = fakeDb();
    const { root, app } = await boot(f, fakeUser());
    f.push('state', { T001: { status: 'done', startedAt: '2026-10-11T10:00:00Z', doneAt: '2026-10-11T10:20:00Z' }, T002: { status: 'in_progress', owner: 'main', startedAt: '2026-10-11T11:45:00Z' } });
    await settle();
    click(root, '[data-view="schedule"]');
    await settle();
    expect([app.ui.fit, app.ui.autoOpen]).toEqual([true, true]);
    expect(timelineWindow(app.model, app.ui)).toEqual(fitWindow(app.model.plan, app.model.states, NOW));
    expect(root.querySelector('[data-action="fit"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('[data-action="toggle-phase"][data-id="F1"]')!.getAttribute('aria-expanded')).toBe('true');
    expect(root.querySelector('[data-action="toggle-phase"][data-id="F2"]')!.getAttribute('aria-expanded')).toBe('false');
    expect(location.hash).toBe('#v=schedule');
    click(root, '[data-action="toggle-phase"][data-id="F2"]');
    await settle();
    expect(app.ui.autoOpen).toBe(false);
    expect([...app.ui.expanded].sort()).toEqual(['F1', 'F2']);
    click(root, '[data-zoom="1w"]');
    await settle();
    expect(app.ui.fit).toBe(false);
    expect(decodeView(location.hash)).toMatchObject({ view: 'schedule', zoom: '1w', open: ['F1', 'F2'] });
    click(root, '[data-action="fit"]');
    await settle();
    expect(app.ui.fit).toBe(true);
    expect(decodeView(location.hash).zoom).toBeUndefined();
    app.stop();
  });

  it('a hash with a zoom wins over the fit, and one with o= closes every group (Review Focus 3)', async () => {
    const one = await boot(fakeDb(), fakeUser(), '#v=schedule&z=1w');
    expect([one.app.ui.fit, one.app.ui.zoom, one.app.ui.autoOpen]).toEqual([false, '1w', true]);
    expect(one.root.querySelector('[data-zoom="1w"]')!.classList.contains('on')).toBe(true);
    one.app.stop();
    const two = await boot(fakeDb(), fakeUser(), '#v=schedule&o=');
    expect([two.app.ui.fit, two.app.ui.autoOpen, two.app.ui.expanded.size]).toEqual([true, false, 0]);
    two.app.stop();
  });

  it('a click on a bar keeps «Ajustar» and writes no span; only a drag past 4 px ends it (C8)', async () => {
    const one = await boot(fakeDb(), fakeUser(), '#v=schedule&o=F1');
    const bar = one.root.querySelector('.gb[data-id="T001"]') as HTMLElement;
    bar.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 300, bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointerup', { button: 0, clientX: 301, bubbles: true }));
    bar.click();
    await settle();
    expect(one.app.ui.modal).toBe('T001');
    expect([one.app.ui.fit, one.app.ui.span, one.app.ui.pan]).toEqual([true, undefined, undefined]);
    expect(location.hash).toBe('#v=schedule&o=F1&t=T001');
    one.app.stop();
    const two = await boot(fakeDb(), fakeUser(), '#v=schedule');
    const canvas = two.root.querySelector('[data-role="tl-canvas"]') as HTMLElement;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 200, width: 1000, height: 200, x: 0, y: 0, toJSON: () => ({}) });
    const fit = timelineWindow(two.app.model, two.app.ui);
    canvas.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 500, bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 502, bubbles: true }));
    await settle();
    expect([two.app.ui.fit, two.app.ui.span]).toEqual([true, undefined]);
    expect(location.hash).toBe('#v=schedule');
    // 100 px of 1000 to the left: the window moves a tenth of its span later, and is no longer the fit.
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 400, bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 400, bubbles: true }));
    await new Promise(r => setTimeout(r, 30));
    await settle();
    expect(two.app.ui.fit).toBe(false);
    expect(two.app.ui.span).toBe(fit.to - fit.from);
    expect(timelineWindow(two.app.model, two.app.ui).from - fit.from).toBeCloseTo((fit.to - fit.from) * 0.1, -3);
    expect(decodeView(location.hash).span).toBeGreaterThan(0);
    two.app.stop();
  });
});

describe('the burndown at its real width (H-26)', () => {
  it('a ResizeObserver gives the burndown its width, and the chart redraws at it', async () => {
    let report!: (entries: { contentRect: { width: number } }[]) => void;
    const observed: Element[] = [];
    vi.stubGlobal('ResizeObserver', class {
      constructor(cb: (entries: { contentRect: { width: number } }[]) => void) { report = cb; }
      observe(el: Element) { observed.push(el); }
      unobserve() {}
      disconnect() {}
    });
    history.replaceState(null, '', '#v=schedule');
    const root = document.createElement('div');
    document.body.appendChild(root);
    const app = await start({ claude: null, snapshot, root, now: () => NOW });
    await settle();
    expect(observed[0]).toBe(root.querySelector('[data-role="burndown"]'));
    report([{ contentRect: { width: 900 } }]);
    await new Promise(r => setTimeout(r, 60));
    await settle();
    expect(app.ui.width).toBe(900);
    expect(root.querySelector('.bd')!.getAttribute('viewBox')).toBe('0 0 900 160');
    // A change under 8 px is not worth a redraw.
    report([{ contentRect: { width: 905 } }]);
    await new Promise(r => setTimeout(r, 60));
    expect(app.ui.width).toBe(900);
    app.stop();
    vi.unstubAllGlobals();
  });
});

describe('the plan in the URL (H-18, G-24)', () => {
  it('pf= in the address sets the filter, and the link of «Te necesita» opens Plan on the deferred findings', async () => {
    const one = await boot(fakeDb(), fakeUser(), '#v=plan&pf=free,evil,tr:ui');
    expect(one.app.ui.planFilter).toEqual({ tasks: ['free'], phases: [], forge: [], track: 'ui' });
    one.app.stop();
    // The second page opens on the summary, where «Te necesita» is: not on the plan the first one left in the address.
    history.replaceState(null, '', location.pathname);
    const f = fakeDb();
    const { root, app } = await boot(f, fakeUser());
    f.push('state', { T001: { status: 'done', doneAt: '2026-10-11T11:00:00.000Z', forge: { v: 2, path: 'medium', phase: 'done', validators: [], brief: 1, stage: 'done', rounds: [], verify: null, stages: {},
      integration: { branch: 'forge/run-x', sha: 'abc1234', merged: false, target: 'main' }, deferred: [{ problem: 'falta un índice' }], acceptedRound: 1, overCap: false, updatedAt: '2026-10-11T11:00:00.000Z' } } });
    await settle();
    click(root, '[data-action="view"][data-view="plan"][data-pf="deferred"]');
    await settle();
    expect([app.ui.view, app.ui.planFilter?.forge]).toEqual(['plan', ['deferred']]);
    expect(location.hash).toBe('#v=plan&pf=deferred');
    expect(root.innerHTML).toContain('data-id="T001"');
    app.stop();
  });
});

describe('the history of runs/ (G-07)', () => {
  const RUN = { v: 1, runId: 'shop-20261010T090000000Z', kind: 'plan', mode: 'subagents', parallel: 3, branch: 'forge/run-shop', target: 'main', coordinator: 'main',
    startedAt: '2026-10-10T09:00:00.000Z', endedAt: '2026-10-10T11:05:00.000Z', stopReason: 'finished', closedBy: 'merge', merged: true,
    tasks: [{ id: 'T001', status: 'integrated', seconds: 1500 }], loose: false, finalReview: null, decisions: 0, deferred: 0 };
  it('listens to runs/; one that is not a run summary is dropped and listed once with ?debug=1, and a run opens and folds on click (Review Focus 2)', async () => {
    const f = fakeDb();
    const root = document.createElement('div');
    document.body.appendChild(root);
    const app = await start({ claude: { use: async (n: string) => (n === 'db' ? f.db : null) }, snapshot, root, now: () => NOW, debug: true });
    f.push('runs', { [RUN.runId]: RUN, older: { ...RUN, runId: 'shop-20261009T090000000Z', startedAt: '2026-10-09T09:00:00.000Z', endedAt: '2026-10-09T11:00:00.000Z' }, bad: { v: 2 },
      spaced: { ...RUN, runId: 'shop 20261008' } });
    click(root, '[data-view="runs"]');
    await settle();
    expect(app.model.runs!.map(r => r.runId)).toEqual(['shop-20261010T090000000Z', 'shop-20261009T090000000Z']);
    const dbg = root.querySelector('.dbg')!.textContent ?? '';
    // C20: the normalizer's own report, once; the subscription adds none.
    expect(dbg).toContain('runs/bad · run · dropped · no v: 1');
    expect(dbg.match(/runs\/bad/g)).toHaveLength(1);
    // Review Focus 2: a runId with spaces is no run id.
    expect(dbg).toContain('runs/spaced · run · dropped · runId');
    expect(root.innerHTML).not.toContain('shop 20261008');
    click(root, '[data-action="run-toggle"][data-id="shop-20261010T090000000Z"]');
    await settle();
    expect([...app.ui.runsOpen!]).toEqual(['shop-20261010T090000000Z']);
    expect(root.querySelector('[data-action="run-toggle"][data-id="shop-20261010T090000000Z"]')!.getAttribute('aria-expanded')).toBe('true');
    expect(root.innerHTML).toContain('data-k="rt:shop-20261010T090000000Z:T001"');
    click(root, '[data-action="run-toggle"][data-id="shop-20261010T090000000Z"]');
    await settle();
    expect(app.ui.runsOpen!.size).toBe(0);
    app.stop();
  });
  /** 55 runs, r-00 to r-54, each ending an hour after the one before. */
  const manyRuns = () => Object.fromEntries(Array.from({ length: 55 }, (_, i) => {
    const runId = `r-${String(i).padStart(2, '0')}`;
    return [runId, { ...RUN, runId, endedAt: new Date(Date.parse('2026-10-01T00:00:00.000Z') + i * 3600000).toISOString() }];
  }));
  it('a runtime that serves more than the 50 asked for leaves the page with the 50 newest', async () => {
    const f = fakeDb();
    const calls: unknown[][] = [];
    const collection = f.db.collection;
    f.db.collection = (p: string) => {
      const q = collection(p);
      if (p !== 'runs') return q;
      return { ...q, orderBy: (...a: unknown[]) => { calls.push(['orderBy', ...a]); return { limit: (n: number) => { calls.push(['limit', n]); return q; } }; } } as never;
    };
    const root = document.createElement('div');
    const app = await start({ claude: { use: async (n: string) => (n === 'db' ? f.db : null) }, snapshot, root, now: () => NOW });
    expect(calls).toEqual([['orderBy', 'endedAt', 'desc'], ['limit', 50]]);
    f.push('runs', manyRuns());
    await settle();
    expect(app.model.runs).toHaveLength(50);
    expect([app.model.runs![0]!.runId, app.model.runs![49]!.runId]).toEqual(['r-54', 'r-05']);
    app.stop();
  });
  it('a runtime that refuses the ordered query of runs/ falls back once to the whole collection, keeps the newest 50 and stays live (review minor 1)', async () => {
    for (const refusal of ['throws', 'errors'] as const) {
      const f = fakeDb();
      const plain: string[] = [];
      const collection = f.db.collection;
      f.db.collection = (p: string) => {
        const q = collection(p);
        if (p !== 'runs') return q;
        return {
          ...q,
          orderBy: () => {
            if (refusal === 'throws') throw new Error('orderBy is not supported');
            return { limit: () => ({ onSnapshot: (_cb: unknown, err: (e: unknown) => void) => { setTimeout(() => err({ code: 'failed_precondition', message: 'no index' }), 0); return () => {}; } }) };
          },
          onSnapshot: (cb: Cb, err: (e: unknown) => void) => { plain.push('plain'); return q.onSnapshot(cb, err); },
        } as never;
      };
      const root = document.createElement('div');
      const app = await start({ claude: { use: async (n: string) => (n === 'db' ? f.db : null) }, snapshot, root, now: () => NOW });
      await settle();
      expect(plain, refusal).toEqual(['plain']);
      expect(app.model.offline, refusal).toBe(false);
      expect(root.innerHTML, refusal).toContain('EN VIVO');
      f.push('runs', manyRuns());
      await settle();
      expect(app.model.runs, refusal).toHaveLength(50);
      expect([app.model.runs![0]!.runId, app.model.runs![49]!.runId], refusal).toEqual(['r-54', 'r-05']);
      app.stop();
      expect(f.subs.has('runs'), refusal).toBe(false);
    }
  });
  it('two documents that say one runId are one run, the newer, the other listed once with ?debug=1; a task listed twice is one row: one toggle, every key once (review I1)', async () => {
    const older = { ...RUN, endedAt: '2026-10-09T11:00:00.000Z', merged: false };
    const twice = { ...RUN, tasks: [{ id: 'T001', status: 'integrated', seconds: 1500 }, { id: 'T001', status: 'stopped' }] };
    // Either order in the snapshot: the newer stays.
    for (const [rows, gone] of [[{ a: twice, b: older }, 'runs/b'], [{ b: older, a: twice }, 'runs/b'], [{ a: older, b: twice }, 'runs/a']] as const) {
      history.replaceState(null, '', location.pathname);
      const f = fakeDb();
      const root = document.createElement('div');
      document.body.appendChild(root);
      const app = await start({ claude: { use: async (n: string) => (n === 'db' ? f.db : null) }, snapshot, root, now: () => NOW, debug: true });
      f.push('runs', rows);
      click(root, '[data-view="runs"]');
      await settle();
      expect(app.model.runs!.map(r => [r.runId, r.merged]), gone).toEqual([[RUN.runId, true]]);
      const dbg = root.querySelector('.dbg')!.textContent ?? '';
      expect(dbg, gone).toContain(`${gone} · runId · dropped · repeated runId`);
      expect(dbg.match(/repeated runId/g), gone).toHaveLength(1);
      expect(root.querySelectorAll('[data-action="run-toggle"]'), gone).toHaveLength(1);
      click(root, '[data-action="run-toggle"]');
      await settle();
      expect(root.querySelectorAll('.rhist [aria-expanded="true"]'), gone).toHaveLength(1);
      expect(root.querySelectorAll(`[data-k="rt:${RUN.runId}:T001"]`), gone).toHaveLength(1);
      const keys = Array.from(root.querySelectorAll('[data-k]')).map(e => e.getAttribute('data-k'));
      expect(keys.filter((k, i) => keys.indexOf(k) !== i), gone).toEqual([]);
      app.stop();
      root.remove();
    }
  });
  it('a toggle for a run the page did not receive changes nothing', async () => {
    const f = fakeDb();
    const root = document.createElement('div');
    document.body.appendChild(root);
    const app = await start({ claude: { use: async (n: string) => (n === 'db' ? f.db : null) }, snapshot, root, now: () => NOW });
    f.push('runs', { [RUN.runId]: RUN });
    click(root, '[data-view="runs"]');
    await settle();
    const fake = document.createElement('button');
    fake.dataset.action = 'run-toggle';
    fake.dataset.id = 'not-a-run';
    root.querySelector('main')!.appendChild(fake);
    fake.click();
    await settle();
    expect(app.ui.runsOpen).toBeUndefined();
    app.stop();
  });
});
