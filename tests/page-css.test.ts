// @vitest-environment happy-dom
// theme.css against the page it styles: the rules are matched on the real markup of the views, not read as text.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderApp, type UiState } from '../src/page/render.js';
import { BIG_NOW, bigModel, bigRun, bigRuns } from './fixtures/big-plan.js';

const CSS = readFileSync(join(process.cwd(), 'src', 'page', 'theme.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Every selector of every style rule with the rule's declarations, the ones inside @media included; @keyframes and the
 *  like are left out. */
function rulesOf(css: string): [string, string][] {
  const out: [string, string][] = [];
  let depth = 0, start = 0, open = 0;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') { if (depth === 0) open = i; depth++; }
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) {
        const prelude = css.slice(start, open).trim();
        const body = css.slice(open + 1, i);
        if (prelude.startsWith('@media')) out.push(...rulesOf(body));
        else if (!prelude.startsWith('@')) for (const s of prelude.split(',').map(x => x.trim()).filter(Boolean)) out.push([s, body]);
        start = i + 1;
      }
    }
  }
  return out;
}
const selectorsOf = (css: string): string[] => rulesOf(css).map(([s]) => s);
/** A selector as the static page can match it: without pseudo-classes and pseudo-elements (:hover, ::before…). */
const staticSel = (s: string): string => s.replace(/::?[\w-]+(\([^)]*\))?/g, '').trim();

const ui = (over: Partial<UiState> = {}): UiState => ({
  zoom: '1d', offset: 0, expanded: new Set(), modal: null, search: '', view: 'summary', shot: null,
  noteFilter: 'all', timelineGroup: 'phase',
  draft: { type: 'idea', text: '' }, answering: null, answerDraft: '', notice: null,
  proposalFilter: { status: 'all', category: 'all', risk: 'all' }, commenting: null, commentDraft: '', rejecting: null, reasonDraft: '', ...over,
} as UiState);

/** The big plan's views in one document: Summary with the detail of T121 open (a loose task running in «En curso», the
 *  recent activity, «Te necesita»), the schedule with every phase open, Runs with its loose tasks and with the plan's
 *  run (and the first run of its history open), Plan and Sessions. */
function mountViews(): HTMLElement {
  const m = bigModel();
  m.run = { ...bigRun(BIG_NOW), kind: 'ephemeral', loose: [{ id: 'fix-x', title: 'Arreglar x', status: 'running', stage: 'implement', agent: 'forge-mech' }, { id: 'doc-y', title: 'Doc y', status: 'queued', stage: null, agent: null }] };
  m.states = { ...m.states, T121: { ...m.states.T121!, zonesTouched: ['src/mod0/part0/a.ts', 'otro/sitio.ts'] } };
  const all = new Set(m.plan.phases.map(p => p.id));
  const box = document.createElement('div');
  box.innerHTML = [
    renderApp(m, ui({ modal: 'T121', tab: 'definition' })),
    renderApp(m, ui({ view: 'schedule', expanded: all, layers: ['critical', 'forecast', 'forge'] })),
    renderApp(m, ui({ view: 'runs' })),
    renderApp(bigModel(), ui({ view: 'runs', runsOpen: new Set([bigRuns()[0]!.runId]) })),
    renderApp(m, ui({ view: 'plan' })),
    renderApp(m, ui({ view: 'sessions' })),
  ].map(h => `<section class="view-box">${h}</section>`).join('');
  document.body.appendChild(box);
  return box;
}

describe('theme.css on the page (review M4, carry 10a)', () => {
  // Class names that two components use, each with the container of every use. A rule that mentions one of them must
  // match inside one of its containers only: a rule written for the timeline's «now» marker that also reaches the «En
  // curso» card, or the detail's title rule reaching the time of an activity, is the bug this test is for.
  const SHARED: { cls: string; uses: string[] }[] = [
    { cls: 'now', uses: ['.tl', '.card.now'] }, // the timeline's now marker; Summary's «En curso»
    { cls: 't', uses: ['.mh', '.recent'] }, // the detail's title; the time of an activity entry
    { cls: 'lt', uses: ['section.loose', '.card.now'] }, // a loose task in Runs; a loose task's row in «En curso»
    { cls: 'hint', uses: ['.legend', '.needs'] }, // the timeline's key hint; a hint of «Te necesita»
    { cls: 'lab', uses: ['.tl', 'section.loose'] }, // a row's label in the timeline; a loose task's title
    { cls: 'zt', uses: ['.dpanel', '.zones'] }, // a zone touched in the detail; the touched part of a zone's bar
    { cls: 'pn', uses: ['.tl', 'section.plan'] }, // a phase's name in a timeline row; in a phase's header of Plan
    { cls: 'chev', uses: ['.tl', 'section.plan', '.rhist'] }, // the fold mark of a timeline group; of a phase of Plan; of a run of the history
    { cls: 'c', uses: ['.tl', 'section.plan', '.sessions-view'] }, // a timeline counter; Plan's counts; a session's bar
  ];

  it('a rule for a class two components share reaches only one of them', () => {
    const box = mountViews();
    const sels = selectorsOf(CSS);
    const problems: string[] = [];
    for (const { cls, uses } of SHARED) {
      const scopes = uses.map(u => Array.from(box.querySelectorAll<HTMLElement>(u)));
      scopes.forEach((s, i) => expect(s.length, `${uses[i]} is on the page`).toBeGreaterThan(0));
      const mentions = sels.filter(s => new RegExp(`\\.${cls}(?![\\w-])`).test(s)).map(staticSel).filter(Boolean);
      expect(mentions.length, cls).toBeGreaterThan(0);
      for (const sel of mentions) {
        const reached = scopes.filter(roots => roots.some(r => {
          try { return r.matches(sel) || r.querySelector(sel) !== null; } catch { return false; }
        }));
        if (reached.length > 1) problems.push(`${sel} → ${uses.filter((_, i) => reached.includes(scopes[i]!)).join(' and ')}`);
      }
    }
    box.remove();
    expect(problems).toEqual([]);
  });

  it('every button that opens a task, wherever it is, has a visible focus ring (carry 9)', () => {
    const box = mountViews();
    const rings = rulesOf(CSS).filter(([s, body]) => s.endsWith(':focus-visible') && body.includes('outline:2px solid var(--lavender)')).map(([s]) => staticSel(s));
    const ringed = (el: Element) => rings.some(s => { try { return el.matches(s); } catch { return false; } });
    const buttons = Array.from(box.querySelectorAll('button[data-action="open-task"]'));
    const kinds = new Set(buttons.map(b => b.className.split(' ')[0]));
    for (const k of ['tr', 'nr', 'nxb', 'act', 'cpl', 'pr', 'rtb', 'chip']) expect(kinds.has(k), k).toBe(true);
    const bare = new Set(buttons.filter(b => !ringed(b)).map(b => b.className));
    box.remove();
    expect([...bare]).toEqual([]);
  });
});
