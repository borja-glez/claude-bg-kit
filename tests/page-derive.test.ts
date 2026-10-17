import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

// The spy: derive.ts and render.ts call the real computeMetrics through it.
vi.mock('../src/lib/metrics.js', async importOriginal => {
  const mod = await importOriginal<typeof import('../src/lib/metrics.js')>();
  return { ...mod, computeMetrics: vi.fn(mod.computeMetrics) };
});

import { computeMetrics } from '../src/lib/metrics.js';
import { parsePlan } from '../src/lib/plan.js';
import { buildDocs } from '../src/lib/sync.js';
import { computeDerived, derive, deriveKey } from '../src/page/derive.js';
import { renderApp, type Model, type UiState } from '../src/page/render.js';

const plan = parsePlan(readFileSync(new URL('./fixtures/plan.yaml', import.meta.url), 'utf8'));
const NOW = Date.parse('2026-10-11T12:00:00Z');
const model = (over: Partial<Model> = {}): Model => ({
  meta: buildDocs(plan, '2026-10-11T09:00:00Z').meta, plan,
  states: { T001: { status: 'done', startedAt: '2026-10-11T10:00:00Z', doneAt: '2026-10-11T10:20:00Z' }, T002: { status: 'in_progress', owner: 'main', startedAt: '2026-10-11T11:45:00Z' } },
  sessions: { main: { name: 'main', heartbeatAt: '2026-10-11T11:59:00Z', status: 'active' } }, events: [], messages: [], notes: [], proposals: [],
  me: null, profiles: {}, readOnly: false, now: NOW, offline: false, connecting: false, rev: 1, ...over,
});

describe('derive: the derived data once per revision of the data (H-06)', () => {
  beforeEach(() => { vi.mocked(computeMetrics).mockClear(); });

  it('the same revision and minute compute once; a new revision or a new minute compute again', () => {
    const m = model();
    const first = derive(m);
    m.now = NOW + 30_000;
    expect(derive(m)).toBe(first);
    expect(computeMetrics).toHaveBeenCalledTimes(1);
    m.rev = 2;
    expect(derive(m)).not.toBe(first);
    expect(computeMetrics).toHaveBeenCalledTimes(2);
    m.now = NOW + 60_000;
    derive(m);
    expect(computeMetrics).toHaveBeenCalledTimes(3);
    expect(deriveKey(m)).toBe(`2:${Math.floor((NOW + 60_000) / 60000)}`);
  });

  it('two models never share an entry, and a model without rev counts as revision 0', () => {
    expect(derive(model())).not.toBe(derive(model()));
    expect(computeMetrics).toHaveBeenCalledTimes(2);
    expect(deriveKey(model({ rev: undefined }))).toBe(`0:${Math.floor(NOW / 60000)}`);
  });

  it('has what the views read: metrics, versions, forecast, critical path and zones', () => {
    const dv = computeDerived(model());
    expect(dv.metrics).toMatchObject({ done: 1, total: 6 });
    expect(dv.byVersion).toEqual(dv.metrics.byVersion);
    expect(dv.critical.ids.length).toBeGreaterThan(0);
    expect(dv.forecast).not.toBeNull();
    expect(dv.zones.map(z => z.zone)).toContain('src/db/**');
  });

  it('a render computes the metrics once, with the forecast and critical path layers on', () => {
    const ui: UiState = {
      zoom: '1d', offset: 0, expanded: new Set(['F1']), modal: null, search: '', view: 'tracking', shot: null, layers: ['critical', 'forecast'],
      versionFilter: { statuses: [], phaseStatuses: [], track: null }, collapsed: new Set(), noteFilter: 'all', timelineGroup: 'phase',
      draft: { type: 'idea', text: '' }, answering: null, answerDraft: '', notice: null,
      proposalFilter: { status: 'all', category: 'all', risk: 'all' }, commenting: null, commentDraft: '', rejecting: null, reasonDraft: '',
    };
    renderApp(model(), ui);
    expect(computeMetrics).toHaveBeenCalledTimes(1);
  });
});
