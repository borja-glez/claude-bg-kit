// H-06: what the page paints with the plan of 343 tasks, measured without a browser (spec §4.5, §6.2).
import { describe, it, expect } from 'vitest';
import { renderApp, type UiState } from '../src/page/render.js';
import { BIG_NOW, BIG_TASKS, bigModel, bigPlan, bigSnapshot, harnessHtml } from './fixtures/big-plan.js';

const ui = (over: Partial<UiState> = {}): UiState => ({
  zoom: '1d', offset: 0, expanded: new Set(), modal: null, search: '', view: 'summary', shot: null,
  noteFilter: 'all', timelineGroup: 'phase',
  draft: { type: 'idea', text: '' }, answering: null, answerDraft: '', notice: null,
  proposalFilter: { status: 'all', category: 'all', risk: 'all' }, commenting: null, commentDraft: '', rejecting: null, reasonDraft: '', ...over,
});
const kb = (s: string) => new TextEncoder().encode(s).length / 1024;
const rowsOf = (html: string) => (html.match(/class="tr (tk|ph)/g) ?? []).length;
const allPhases = () => new Set(bigPlan().phases.map(p => p.id));

describe('the page with the plan of 343 tasks (H-06)', () => {
  it('the schedule with every phase open paints at most 120 rows and measures less than 120 KB', () => {
    const html = renderApp(bigModel(), ui({ view: 'schedule', expanded: allPhases() }));
    expect(html).toContain('data-rows="358" data-start="0" data-end="55"');
    expect(rowsOf(html)).toBe(55);
    expect(rowsOf(html)).toBeLessThanOrEqual(120);
    expect(kb(html)).toBeLessThan(120);
  });

  it('scrolled, it paints the rows around the viewport between two spacers of the height of the rest', () => {
    const html = renderApp(bigModel(), ui({ view: 'schedule', expanded: allPhases(), tl: { first: 200, count: 20 } }));
    expect(html).toContain('data-rows="358" data-start="180" data-end="240"');
    expect(html).toContain('<div class="vpad" style="height:calc(var(--rh) * 180)"></div>');
    expect(html).toContain('<div class="vpad" style="height:calc(var(--rh) * 118)"></div>');
    expect(rowsOf(html)).toBe(60);
  });

  it('149 rows are all painted; 151 are virtualized', () => {
    const onePhase = (n: number) => {
      const p = bigPlan();
      return { ...bigModel(), plan: { ...p, phases: [p.phases[0]!], tasks: p.tasks.slice(0, n).map(t => ({ ...t, phase: 'F1', depends_on: [] })) } };
    };
    const at149 = renderApp(onePhase(148), ui({ view: 'schedule', expanded: new Set(['F1']) }));
    expect(rowsOf(at149)).toBe(149);
    expect(at149).not.toContain('class="vpad"');
    expect(at149).not.toContain('data-start=');
    const at151 = renderApp(onePhase(150), ui({ view: 'schedule', expanded: new Set(['F1']) }));
    expect(at151).toContain('class="vpad"');
    expect(rowsOf(at151)).toBe(55);
  });

  it('a row lists in its title what it needs and what it unlocks, since their arrows may be out of the painted range', () => {
    const html = renderApp(bigModel(), ui({ view: 'schedule', expanded: new Set(['F2']) }));
    const at = html.indexOf('data-k="t:T044"');
    const row = html.slice(html.lastIndexOf('class="tr tk', at), html.indexOf('>', at));
    expect(row).toContain('Necesita: T043');
    expect(row).toContain('Desbloquea: T045');
  });

  it('the summary measures less than 60 KB', () => {
    expect(kb(renderApp(bigModel(), ui()))).toBeLessThan(60);
  });

  it('the harness page carries the snapshot and a fake database before the page script, and no stray </script', () => {
    const tpl = '<title>__TITLE__</title>\n<script type="application/json" id="wp-snapshot">__SNAPSHOT__</script>\n<script>PAGE()</script>';
    const html = harnessHtml(tpl, BIG_NOW);
    expect(html).toContain('<title>big-plan Roadmap</title>');
    expect(JSON.parse(html.match(/id="wp-snapshot">([\s\S]*?)<\/script>/)![1]!).states.T044).toBe('done');
    expect(html.indexOf('window.claude')).toBeGreaterThan(-1);
    expect(html.indexOf('window.claude')).toBeLessThan(html.indexOf('PAGE()'));
    expect(html.match(/<\/script/g)).toHaveLength(3);
  });

  it('the harness page opens in standards mode, in the plan’s language, with the head the publisher adds (carry 10c)', () => {
    const tpl = '<title>__TITLE__</title>\n<script type="application/json" id="wp-snapshot">__SNAPSHOT__</script>\n<script>PAGE()</script>';
    const head = '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">';
    const html = harnessHtml(tpl, BIG_NOW);
    expect(html.startsWith(head)).toBe(true);
    expect(html.indexOf('<title>big-plan Roadmap</title>')).toBe(head.length);
    const snap = bigSnapshot(BIG_NOW);
    expect(harnessHtml(tpl, BIG_NOW, { ...snap, meta: { ...snap.meta, locale: 'en' } })).toMatch(/^<!doctype html><html lang="en"><head>/);
    expect(harnessHtml(tpl, BIG_NOW, { ...snap, meta: { ...snap.meta, locale: 'es"><script>' } })).toMatch(/^<!doctype html><html lang="esscript"><head>/);
  });

  it('a task title with </script> cannot break out of the harness page, and reads back the same', () => {
    const tpl = '<title>__TITLE__</title>\n<script type="application/json" id="wp-snapshot">__SNAPSHOT__</script>\n<script>PAGE()</script>';
    const evil = '</script><img src=x onerror=alert(1)>';
    const snap = bigSnapshot(BIG_NOW);
    const phases = snap.phases.map((p, i) => (i === 0 ? { ...p, tasks: p.tasks.map((t, j) => (j === 0 ? { ...t, title: evil } : t)) } : p));
    const html = harnessHtml(tpl, BIG_NOW, { ...snap, phases });
    expect(html.match(/<\/script/g)).toHaveLength(3);
    expect(html).not.toContain('<img');
    expect(JSON.parse(html.match(/id="wp-snapshot">([\s\S]*?)<\/script>/)![1]!).phases[0].tasks[0].title).toBe(evil);
  });

  it('the plan measures less than 40 KB with the phase in progress open, and less than 120 KB with every phase open', () => {
    expect(kb(renderApp(bigModel(), ui({ view: 'plan' })))).toBeLessThan(40);
    const all = renderApp(bigModel(), ui({ view: 'plan', planOpen: allPhases() }));
    expect((all.match(/class="pr"/g) ?? []).length).toBe(BIG_TASKS);
    expect(kb(all)).toBeLessThan(120);
  });
});
