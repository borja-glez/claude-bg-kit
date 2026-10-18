// @vitest-environment happy-dom
// C31 (carry 4b-1): Cronograma's analysis and minimap are built once per data revision and minute (the analysis also per
// burndown scope, width and locale): a search key, a pan step or «Desplegar todo» repaints with what was already built.
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Each builder's own call, counted: the analysis calls burndown once per build, the minimap planRange.
vi.mock('../src/lib/insights.js', async importOriginal => {
  const real = await importOriginal<typeof import('../src/lib/insights.js')>();
  return { ...real, burndown: vi.fn(real.burndown) };
});
vi.mock('../src/lib/timeline.js', async importOriginal => {
  const real = await importOriginal<typeof import('../src/lib/timeline.js')>();
  return { ...real, planRange: vi.fn(real.planRange) };
});

import { burndown } from '../src/lib/insights.js';
import { panFor, planRange } from '../src/lib/timeline.js';
import { parsePlan } from '../src/lib/plan.js';
import { buildDocs } from '../src/lib/sync.js';
import { derive } from '../src/page/derive.js';
import { renderApp, timelineWindow, type Model, type UiState } from '../src/page/render.js';
import { start, type Snapshot } from '../src/page/app.js';

const plan = parsePlan(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'plan.yaml'), 'utf8'));
const snapshot: Snapshot = buildDocs(plan, '2026-10-11T09:00:00Z');
const NOW = Date.parse('2026-10-11T12:00:00Z');
const model = (): Model => ({
  meta: buildDocs(plan, '2026-10-11T09:00:00Z').meta,
  plan,
  states: {
    T001: { status: 'done', startedAt: '2026-10-11T10:00:00Z', doneAt: '2026-10-11T10:20:00Z' },
    T002: { status: 'in_progress', owner: 'main', startedAt: '2026-10-11T11:45:00Z' },
  },
  sessions: {}, events: [], messages: [], notes: [], proposals: [], me: null, profiles: {}, readOnly: false, now: NOW, offline: false, connecting: false, rev: 1,
});
const ui = (over: Partial<UiState> = {}): UiState => ({
  zoom: '1d', offset: 0, expanded: new Set(), modal: null, search: '', view: 'schedule', fit: true, autoOpen: true,
  timelineGroup: 'phase',
  draft: { type: 'idea', text: '' }, answering: null, answerDraft: '', notice: null,
  proposalFilter: { status: 'all', category: 'all', risk: 'all' }, commenting: null, commentDraft: '', rejecting: null, reasonDraft: '', shot: null, ...over,
});
/** How many times the analysis and the minimap were built so far. */
const builds = (): [number, number] => [vi.mocked(burndown).mock.calls.length, vi.mocked(planRange).mock.calls.length];
/** What one call added to the builds. */
const added = (f: () => unknown): [number, number] => {
  const [b, r] = builds();
  f();
  const [b2, r2] = builds();
  return [b2 - b, r2 - r];
};
const minimapOf = (html: string) => html.slice(html.indexOf('<div class="mm"'), html.indexOf('</svg>', html.indexOf('<div class="mm"')));

beforeEach(() => { history.replaceState(null, '', location.pathname); });

describe('the analysis and the minimap are built once per key (C31, carry 4b-1)', () => {
  it('a search key, a pan step and «Desplegar todo» repaint with what was built, and it is what a fresh render draws', () => {
    const m = model();
    const dv = derive(m);
    const first = renderApp(m, ui(), dv);
    const fit = timelineWindow(m, ui());
    const span = fit.to - fit.from;
    const repaints = [
      ui({ search: 'carrito' }),
      ui({ fit: false, span, pan: panFor(fit.from, span, NOW) + 0.15 * span }),
      ui({ autoOpen: false, expanded: new Set(['F1', 'F2']) }),
    ];
    let pages: string[] = [];
    expect(added(() => { pages = repaints.map(u => renderApp(m, u, dv)); })).toEqual([0, 0]);
    // A fresh Derived (renderApp without one) builds both again, and draws the same page.
    repaints.forEach((u, i) => expect(pages[i], `repaint ${i}`).toBe(renderApp(m, u)));
    // The pan moved the window over the bars, which a window past the plan scales into its wider box.
    expect(minimapOf(pages[1]!)).not.toBe(minimapOf(first));
    expect(minimapOf(pages[1]!)).toContain('<g transform="translate(');
    expect(minimapOf(first)).not.toContain('<g transform');
  });

  it('any part of the key builds the analysis again: the scope, the width, the locale, the revision and the minute', () => {
    const m = model();
    let dv = derive(m);
    renderApp(m, ui(), dv);
    let html = '';
    expect(added(() => { html = renderApp(m, ui({ burnScope: 'p:F1' }), dv); })).toEqual([1, 0]);
    expect(html).toContain('<option value="p:F1" selected>');
    expect(added(() => { html = renderApp(m, ui({ burnScope: 'p:F1', width: 900 }), dv); })).toEqual([1, 0]);
    expect(html).toContain('viewBox="0 0 900 160"');
    m.meta = { ...m.meta!, locale: 'en' };
    expect(added(() => { html = renderApp(m, ui({ burnScope: 'p:F1', width: 900 }), dv); })).toEqual([1, 0]);
    expect(html).toContain('No ideal line: the version has no target date');
    // The data: a new revision or a new minute is a new Derived, which builds the minimap too.
    m.rev = 2;
    dv = derive(m);
    expect(added(() => renderApp(m, ui({ burnScope: 'p:F1', width: 900 }), dv))).toEqual([1, 1]);
    m.now = NOW + 1000;
    expect(derive(m)).toBe(dv);
    m.now = NOW + 60000;
    dv = derive(m);
    expect(added(() => renderApp(m, ui({ burnScope: 'p:F1', width: 900 }), dv))).toEqual([1, 1]);
    expect(added(() => renderApp(m, ui({ burnScope: 'p:F1', width: 900, search: 'x' }), dv))).toEqual([0, 0]);
  });

  it('through the page: a search key, a pan step and «Desplegar todo» build neither again; a scope builds the analysis', async () => {
    const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); };
    history.replaceState(null, '', '#v=schedule');
    const root = document.createElement('div');
    document.body.appendChild(root);
    const app = await start({ claude: null, snapshot, root, now: () => NOW });
    await settle();
    const at = builds();
    (root.querySelector('[data-action="tl-all"]') as HTMLElement).click();
    await settle();
    expect(app.ui.autoOpen).toBe(false);
    (root.querySelector('[data-role="timeline"]') as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await settle();
    expect(app.ui.span).toBeGreaterThan(0);
    const box = root.querySelector('[data-role="search"]') as HTMLInputElement;
    box.value = 'carrito';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(root.innerHTML).toContain('Maqueta de carrito');
    expect(builds()).toEqual(at);
    const sel = root.querySelector('[data-action="burn-scope"]') as HTMLSelectElement;
    sel.value = 'p:F1';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(app.ui.burnScope).toBe('p:F1');
    expect(builds()).toEqual([at[0] + 1, at[1]]);
    app.stop();
    root.remove();
  });
});
