import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parsePlan } from '../src/lib/plan.js';
import { buildDocs } from '../src/lib/sync.js';
import { dictFor } from '../src/page/i18n.js';
import { esc, renderApp, timelineSvg, type Model, type UiState } from '../src/page/render.js';
import type { MessageDoc, EventType, NoteDoc, PlanTrack, TaskStatus } from '../src/lib/types.js';
import type { ProposalDoc } from '../src/lib/proposals.js';

const plan = parsePlan(readFileSync(new URL('./fixtures/plan.yaml', import.meta.url), 'utf8'));
const NOW = Date.parse('2026-10-11T12:00:00Z');
const base = (): Model => ({
  meta: buildDocs(plan, '2026-10-11T09:00:00Z').meta,
  plan,
  states: {
    T001: { status: 'done', startedAt: '2026-10-11T10:00:00Z', doneAt: '2026-10-11T10:20:00Z', commits: [{ sha: 'abcdef1234', ts: '2026-10-11T10:20:00Z', title: 'T001: x', add: 10, del: 2 }] },
    T002: { status: 'in_progress', owner: 'main', startedAt: '2026-10-11T11:45:00Z' },
  },
  sessions: { main: { name: 'main', track: 'backend', currentTask: 'T002', heartbeatAt: '2026-10-11T11:59:00Z', status: 'active', agentName: 'wp-demo-shop-backend', branch: 'track/backend' } },
  events: [{ id: 'e1', ts: '2026-10-11T10:20:00Z', type: 'done', sessionId: 'main', taskId: 'T001', text: 'Esquema <b>', add: 10, del: 2 }],
  messages: [],
  notes: [],
  proposals: [],
  me: null,
  profiles: {},
  readOnly: false,
  now: NOW,
  offline: false,
  connecting: false,
});
const ui = (over: Partial<UiState> = {}): UiState => ({
  zoom: '1d', offset: 0, expanded: new Set(), modal: null, search: '', view: 'tracking',
  versionFilter: { statuses: [], phaseStatuses: [], track: null }, collapsed: new Set(), noteFilter: 'all', timelineGroup: 'phase',
  draft: { type: 'idea', text: '' }, answering: null, answerDraft: '', notice: null,
  proposalFilter: { status: 'all', category: 'all', risk: 'all' }, commenting: null, commentDraft: '', rejecting: null, reasonDraft: '', shot: null, ...over,
});

describe('dictFor', () => {
  it('falls back to the base language and then to English', () => {
    expect(dictFor('es-ES').live).toBe(dictFor('es').live);
    expect(dictFor('fr').live).toBe('LIVE');
    expect(dictFor(undefined).live).toBe('LIVE');
    expect(dictFor('es').status.in_progress).toBe('En curso');
  });
});

describe('renderApp', () => {
  it('shows the infinite pill in the tracking header and the nav only while the run is active', () => {
    const inf = { active: true, cycle: 3, budget: { cycles: 10 }, startedAt: '2026-10-11T09:00:00Z', lastCycleAt: null };
    const html = renderApp({ ...base(), infinite: inf }, ui());
    expect(html.match(/class="pill inf"/g)?.length).toBe(2);
    expect(html).toContain('∞ ciclo 4/10');
    expect(renderApp({ ...base(), infinite: { ...inf, cycle: 0 } }, ui())).toContain('∞ ciclo 1/10');
    expect(renderApp({ ...base(), infinite: { ...inf, cycle: 10 } }, ui())).toContain('∞ ciclo 10/10');
    const en = renderApp({ ...base(), meta: { ...base().meta!, locale: 'en' }, infinite: { ...inf, budget: { hours: 2 } } }, ui());
    expect(en).toContain('∞ cycle 4<');
    expect(en).not.toContain('∞ cycle 4/');
    expect(renderApp({ ...base(), infinite: { ...inf, active: false } }, ui())).not.toContain('∞');
    expect(renderApp({ ...base(), infinite: null }, ui())).not.toContain('∞');
    expect(renderApp(base(), ui())).not.toContain('∞');
  });

  it('escapes the infinite pill', () => {
    const inf = { active: true, cycle: '<script>' as unknown as number, budget: { cycles: '"><img>' as unknown as number }, startedAt: '', lastCycleAt: null };
    const html = renderApp({ ...base(), infinite: inf }, ui());
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('"><img>');
    expect(html.match(/<span class="pill inf">([^<]*)<\/span>/g)).toEqual(Array(2).fill('<span class="pill inf">∞ ciclo 1</span>'));
  });

  it('renders header, cards, sessions and timeline in the plan locale', () => {
    const html = renderApp(base(), ui());
    expect(html).toContain('EN VIVO');
    expect(html).toContain('demo-shop');
    expect(html).toContain('17 %'); // 1 of 6
    expect(html).toContain('<em>T002</em> API de pedidos');
    expect(html).toContain('15 min / est. 30');
    expect(html).toContain('data-action="toggle-phase" data-id="F1"');
    expect(html).toContain('class="now"');
  });

  it('escapes user-controlled text', () => {
    const html = renderApp(base(), ui());
    expect(html).toContain('Esquema &lt;b&gt;');
    expect(html).not.toContain('Esquema <b>');
    expect(esc(`"'&`)).toBe('&quot;&#39;&amp;');
  });

  it('shows the offline banner', () => {
    expect(renderApp({ ...base(), offline: true }, ui())).toContain('Sin conexión');
  });

  it('shows the connecting state', () => {
    const html = renderApp({ ...base(), connecting: true }, ui());
    expect(html).toContain('Conectando');
    expect(html).not.toContain('EN VIVO');
  });

  it('expands phases and filters by search', () => {
    const html = renderApp(base(), ui({ search: 'carrito' }));
    expect(html).toContain('Maqueta de carrito');
    expect(html).not.toContain('>API de pedidos<');
  });

  it('renders the task modal with done_when, commits and unlocks', () => {
    const html = renderApp(base(), ui({ modal: 'T001' }));
    expect(html).toContain('class="modal"');
    expect(html).toContain('migración aplicada y test de modelo en verde');
    expect(html).toContain('abcdef1');
    expect(html).toContain('T002'); // unlocks
  });

  it('draws the analysis row: burndown, critical path and code zones', () => {
    const html = renderApp(base(), ui());
    expect(html).toContain('class="insights"');
    expect(html).toContain('data-action="burn-scope"');
    expect(html).toContain('class="chain"');
    expect(html).toContain('src/db/**');
  });

  it('survives an empty model', () => {
    const html = renderApp({ ...base(), meta: null, states: {}, sessions: {}, events: [], messages: [] }, ui());
    expect(html).toContain('0 %');
  });

  it('neutralises hostile values from shared data', () => {
    const m = base();
    const hostile: Model = {
      ...m,
      plan: { ...plan, tracks: plan.tracks.map(t => ({ ...t, color: 'blue" onmouseover="x' as unknown as PlanTrack['color'] })) },
      states: { ...m.states, T001: { ...m.states.T001!, status: 'done" onclick="z' as unknown as TaskStatus, commits: [{ sha: 'abcdef1234', ts: '2026-10-11T10:20:00Z', title: 'x', add: '<img src=x>' as unknown as number, del: 0 }] } },
      events: [{ id: 'e2', ts: '2026-10-11T10:20:00Z', type: 'x" onclick="y' as unknown as EventType, sessionId: 'main', taskId: 'T001', add: '<img src=x>' as unknown as number, del: 0 }],
      meta: { ...m.meta!, metrics: { tests: '<script>' as unknown as number } },
    };
    hostile.plan = { ...hostile.plan, tasks: hostile.plan.tasks.map(t => (t.id === 'T001' ? { ...t, estimate_min: '<img src=x onerror=alert(1)>' as unknown as number } : t)) };
    const html = renderApp(hostile, ui({ modal: 'T001', layers: ['critical', 'forecast', 'forge'] }));
    const svg = timelineSvg({ ...hostile, plan: { ...hostile.plan, tasks: hostile.plan.tasks.map(t => ({ ...t, title: '<img src=x onerror=alert(1)>' })) } }, ui({ expanded: new Set(['F1', 'F2']) }));
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).not.toContain('<img');
    expect(svg).not.toContain('NaN');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('onmouseover=');
    expect(html).not.toContain('onclick=');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>');
  });
});

const msg = (o: Partial<MessageDoc> & { id: string }): MessageDoc & { id: string } => ({ ts: '2026-10-11T11:00:00Z', from: 'main', to: 'ui', type: 'overlap_warning', taskId: 'T002', text: 'hola', status: 'open', ...o });

describe('sessions view', () => {
  it('renders a card per session with track progress', () => {
    const html = renderApp(base(), ui({ view: 'sessions' }));
    expect(html).toContain('Sesiones y coordinación');
    expect(html).toContain('wp-demo-shop-backend');
    expect(html).toContain('track/backend');
    expect(html).toContain('1/4');
    expect(html).toContain('class="sc');
  });
  it('flags escalated sessions as needing a decision', () => {
    const messages = [1, 2, 3, 4].map(i => msg({ id: `m${i}`, ts: `2026-10-11T11:0${i}:00Z`, from: i % 2 ? 'main' : 'ui' , to: i % 2 ? 'ui' : 'main' }));
    const html = renderApp({ ...base(), messages }, ui({ view: 'sessions' }));
    expect(html).toMatch(/class="sc[^"]*warn/);
    expect(html).toContain('Necesita tu decisión');
  });
  it('shows recent messages in the tracking feed', () => {
    const html = renderApp({ ...base(), messages: [msg({ id: 'm1', text: 'cuidado con el esquema' })] }, ui());
    expect(html).toContain('✉');
    expect(html).toContain('main → ui');
    expect(html).toContain('cuidado con el esquema');
  });
  it('neutralises hostile messages in both views', () => {
    const messages = [msg({ id: 'h', text: '<img src=x onerror=1>', from: '"><script>', type: 'x" onclick="y' as unknown as MessageDoc['type'] }), msg({ id: 'h2', from: 'main', to: '"><script>', text: '<img src=x onerror=1>' })];
    for (const view of ['tracking', 'sessions'] as const) {
      const html = renderApp({ ...base(), messages }, ui({ view }));
      expect(html).not.toContain('<img');
      expect(html).not.toContain('<script');
      expect(html).not.toContain('onclick=');
    }
  });
  it('renders five nav buttons with the active one marked', () => {
    for (const view of ['tracking', 'versions', 'sessions', 'notes', 'proposals'] as const) {
      const html = renderApp(base(), ui({ view }));
      expect(html.match(/data-action="view"/g)).toHaveLength(5);
      expect(html).toMatch(new RegExp(`class="nav on"[^>]*data-view="${view}"`));
    }
  });
});

describe('sessions keyed by SID (final fix)', () => {
  const named = (): Model => {
    const m = base();
    return { ...m, sessions: { backend: { ...m.sessions.main, name: 'Backend' }, ui: { name: 'Interfaz', track: 'ui', heartbeatAt: '2026-10-11T11:59:00Z', status: 'active' } } };
  };
  it('matches escalations and threads by session id, not display name', () => {
    const messages = [msg({ id: 'e', from: 'backend', to: 'ui', type: 'escalation', text: 'decide ya' })];
    for (const view of ['tracking', 'sessions'] as const) {
      const html = renderApp({ ...named(), messages }, ui({ view }));
      expect(html).toContain('Backend');
      expect(html.match(/class="(s|sc) [^"]*warn/g)?.length).toBe(2);
    }
    const sv = renderApp({ ...named(), messages }, ui({ view: 'sessions' }));
    expect(sv.match(/decide ya/g)?.length).toBe(2);
  });
  it('shows a dash for an invalid heartbeat instead of NaN', () => {
    const m = base();
    const bad = { ...m, sessions: { main: { ...m.sessions.main, heartbeatAt: 'garbage' } } };
    for (const view of ['tracking', 'sessions'] as const) {
      const html = renderApp(bad, ui({ view }));
      expect(html).not.toContain('NaN');
    }
    expect(renderApp(bad, ui())).toContain('T002 · latido —');
  });
});

type N = NoteDoc & { id: string };
const note = (o: Partial<N> & { id: string }): N => ({ ts: '2026-10-11T11:30:00Z', type: 'idea', author: 'session:backend', text: 'texto', ...o });
const HOSTILE = `<img src=x onerror=alert(1)>"'`;
const clean = (html: string) => {
  expect(html).not.toContain('<img');
  expect(html).not.toContain(`>"'`); // attribute breakout from HOSTILE
  expect(html).not.toContain('<script');
  expect(html).not.toContain('onclick=');
};

describe('versions view', () => {
  it('renders columns, categories, task cards and a no-version column in es', () => {
    const m = { ...base(), plan: { ...plan, versions: [{ id: '0.1', phases: ['F1'] }] } };
    const html = renderApp(m, ui({ view: 'versions' }));
    expect(html).toContain('Vista de versiones');
    expect(html).toContain('Versión 0.1');
    expect(html).toContain('Sin versión');
    expect(html).toContain('Fase 1');
    expect(html).toContain('Fase 2');
    expect(html).toContain('data-action="toggle-cat"');
    expect(html).toContain('data-action="open-task" data-id="T002"');
    expect(html).toContain('data-action="vfilter"');
    expect(html).toContain('data-action="vtrack"');
    expect(html).toContain('Desplegar categorías');
    expect(html).toContain('Hecho · 1');
    expect(html).toContain('Provisional · 3');
  });
  it('filters by task status, phase status and track and hides collapsed categories', () => {
    const html = renderApp(base(), ui({ view: 'versions', versionFilter: { statuses: ['done'], phaseStatuses: [], track: null } }));
    expect(html).toContain('data-id="T001"');
    expect(html).not.toContain('data-id="T003"');
    const byTrack = renderApp(base(), ui({ view: 'versions', versionFilter: { statuses: [], phaseStatuses: [], track: 'ui' } }));
    expect(byTrack).toContain('data-id="T003"');
    expect(byTrack).not.toContain('data-id="T001"');
    const byPhase = renderApp(base(), ui({ view: 'versions', versionFilter: { statuses: [], phaseStatuses: ['provisional'], track: null } }));
    expect(byPhase).toContain('data-id="T004"');
    expect(byPhase).not.toContain('data-id="T001"');
    const collapsed = renderApp(base(), ui({ view: 'versions', collapsed: new Set(['F1|—']) }));
    expect(collapsed).not.toContain('data-action="open-task" data-id="T001"');
    expect(collapsed).toContain('data-action="open-task" data-id="T004"');
  });
  it('escapes hostile plan values in the versions view', () => {
    const m = base();
    const h = { ...m, plan: { ...plan, versions: [{ id: HOSTILE, phases: ['F1'] }], tasks: plan.tasks.map(t => ({ ...t, title: HOSTILE, category: HOSTILE })) } };
    clean(renderApp(h, ui({ view: 'versions' })));
  });
});

describe('notes view', () => {
  const notes = [
    note({ id: 'n1', type: 'decision', text: 'usar redis', taskId: 'T001' }),
    note({ id: 'n2', type: 'question', text: '¿apple pay?', ts: '2026-10-11T11:40:00Z' }),
    note({ id: 'n3', type: 'question', text: '¿stripe?', answer: 'sí, stripe', answeredBy: 'user:u1', answeredAt: '2026-10-11T11:50:00Z' }),
    note({ id: 'n4', type: 'idea', author: 'user:u1', text: 'mi idea' }),
    note({ id: 'n5', type: 'debt', author: 'user:u2', text: 'deuda ajena' }),
  ];
  it('renders counts, composer, filters and note cards in es', () => {
    const html = renderApp({ ...base(), notes, me: 'user:u1', profiles: { u2: 'Ana' } }, ui({ view: 'notes' }));
    expect(html).toContain('Notas y decisiones');
    expect(html).toContain('<b>1</b> decisiones');
    expect(html).toContain('<b>1</b> preguntas abiertas');
    expect(html).toContain('data-role="note-text"');
    expect(html).toContain('maxlength="2000"');
    expect(html).toContain('data-action="note-add"');
    expect(html).toContain('data-action="note-type"');
    for (const f of ['all', 'decision', 'idea', 'debt', 'open', 'mine']) expect(html).toContain(`data-action="nfilter" data-filter="${f}"`);
    expect(html).toContain('Claude · backend');
    expect(html).toContain('tú');
    expect(html).toContain('Ana');
    expect(html).toContain('data-action="answer-open" data-id="n2"');
    expect(html).not.toContain('data-action="answer-open" data-id="n3"');
    expect(html).toContain('sí, stripe');
    expect(html).toContain('data-action="open-task" data-id="T001"');
  });
  it('filters mine and shows the answer box and read-only notice', () => {
    const html = renderApp({ ...base(), notes, me: 'user:u1' }, ui({ view: 'notes', noteFilter: 'mine' }));
    expect(html).toContain('mi idea');
    expect(html).not.toContain('deuda ajena');
    const open = renderApp({ ...base(), notes, me: 'user:u1' }, ui({ view: 'notes', answering: 'n2' }));
    expect(open).toContain('data-role="answer-text"');
    expect(open).toContain('data-action="answer-send"');
    const ro = renderApp({ ...base(), notes, readOnly: true }, ui({ view: 'notes' }));
    expect(ro).toContain('solo lectura');
    expect(renderApp({ ...base(), notes, profiles: {} }, ui({ view: 'notes' }))).toContain('usuario');
  });
  it('marks an automatic decision with what was chosen, why and how to undo it, escaped', () => {
    const dec = note({ id: 'd1', type: 'decision', text: 'diseño aprobado', decision: { point: 'design-approve', what: 'diseño aprobado (v4)', chosen: 'approve', alternatives: ['another round'], why: 'sin critical', revert: '/forge:decisions revert 7', auto: true } });
    const html = renderApp({ ...base(), notes: [dec] }, ui({ view: 'notes' }));
    expect(html).toContain('<span class="nauto">auto</span>');
    expect(html).toContain('Elegido:</span> approve');
    expect(html).toContain('(another round)');
    expect(html).toContain('Por qué:</span> sin critical');
    expect(html).toContain('Cómo revertir:</span> /forge:decisions revert 7');
    const evil = note({ id: 'd2', type: 'decision', decision: { point: 'other', what: 'w', chosen: '<script>x</script>', why: '<img onerror=1>', auto: true } });
    const bad = renderApp({ ...base(), notes: [evil] }, ui({ view: 'notes' }));
    expect(bad).not.toContain('<script>x');
    expect(bad).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(renderApp({ ...base(), notes: [note({ id: 'p', type: 'decision' })] }, ui({ view: 'notes' }))).not.toContain('class="nauto"');
  });
  it('escapes hostile notes in every view', () => {
    const bad = [
      note({ id: 'h"><script>', type: 'question', author: HOSTILE, text: HOSTILE, taskId: 'T001' }),
      note({ id: 'h2', author: `session:${HOSTILE}`, text: HOSTILE, answer: HOSTILE, type: 'question', taskId: 'T001' }),
      note({ id: 'h3', author: 'user:x"><script>', text: HOSTILE, taskId: '"><script>' }),
    ];
    for (const view of ['tracking', 'versions', 'sessions', 'notes'] as const) {
      clean(renderApp({ ...base(), notes: bad, me: 'user:u1', profiles: { 'x"><script>': HOSTILE } }, ui({ view, modal: 'T001', draft: { type: 'idea', text: HOSTILE }, answering: 'h"><script>', answerDraft: HOSTILE })));
    }
  });
  it('mixes notes into recent changes and lists task notes in the modal', () => {
    const html = renderApp({ ...base(), notes: [note({ id: 'n9', ts: '2026-10-11T11:55:00Z', type: 'decision', text: 'nota reciente', taskId: 'T001' })] }, ui());
    expect(html).toContain('nota reciente');
    const modal = renderApp({ ...base(), notes: [note({ id: 'n9', type: 'decision', text: 'nota de ficha', taskId: 'T001' })] }, ui({ modal: 'T001' }));
    expect(modal).toMatch(/Notas<\/div>[\s\S]*nota de ficha/);
  });
});

describe('timeline tabs', () => {
  it('renders track rows with groupBy track', () => {
    const html = renderApp(base(), ui({ timelineGroup: 'track', expanded: new Set(['ui']) }));
    expect(html).toContain('data-action="tgroup" data-group="track"');
    expect(html).toContain('Por frentes');
    expect(html).toContain('data-action="toggle-phase" data-id="backend"');
    expect(html).toContain('data-action="toggle-phase" data-id="ui"');
    expect(html).toContain('Maqueta de carrito');
    expect(html).not.toContain('data-id="F1"');
  });
});

describe('theme.css', () => {
  const css = readFileSync(new URL('../src/page/theme.css', import.meta.url), 'utf8');
  it('keeps selects inside narrow screens (no page scroll at 390px)', () => {
    expect(css).toMatch(/(^|[\s}])select\{[^}]*max-width:100%/);
    expect(css).toMatch(/\.f\.trk select\{[^}]*max-width:100%/);
    expect(css).toMatch(/\.f\.trk\{[^}]*max-width:100%/);
  });
});

const P = (over: Partial<ProposalDoc & { id: string }> = {}) => ({ id: 'p1', ts: '2026-10-11T10:00:00.000Z', category: 'perf' as const, risk: 'low' as const,
  title: 'Cache prices', rationale: 'why', evidence: 'bench', pillar: 'Fast checkout', status: 'proposed' as const, source: 'scout' as const, author: 'session:abc', ...over });

describe('proposals view', () => {
  it('proposals view lists cards with decision buttons for proposed items', () => {
    const html = renderApp({ ...base(), proposals: [P(), P({ id: 'p2', status: 'approved', title: 'Done one' })] }, { ...ui(), view: 'proposals' });
    expect(html).toContain('data-view="proposals"');
    expect(html).toContain('Cache prices');
    expect((html.match(/data-action="p-approve"/g) ?? []).length).toBe(1);
    expect(html).toContain('risk-low');
  });
  it('escapes proposal text and hides buttons when read-only', () => {
    const html = renderApp({ ...base(), readOnly: true, proposals: [P({ title: '<img src=x onerror=alert(1)>', evidence: '"><script>' })] }, { ...ui(), view: 'proposals' });
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('data-action="p-approve"');
  });
  it('filters by status, category and risk', () => {
    const ps = [P(), P({ id: 'p2', category: 'security', risk: 'high' })];
    const html = renderApp({ ...base(), proposals: ps }, { ...ui(), view: 'proposals', proposalFilter: { status: 'all', category: 'security', risk: 'all' } });
    expect(html).toContain('data-id="p2"');
    expect(html).not.toContain('data-id="p1"');
  });
  it('a bare "user" decidedBy shows the translated "a user" label', () => {
    const m = { ...base(), proposals: [P({ status: 'approved', decidedBy: 'user', decidedAt: '2026-10-11T11:00:00.000Z' })] };
    expect(renderApp(m, { ...ui(), view: 'proposals' })).toContain('un usuario');
    const en = { ...m, meta: { ...m.meta!, locale: 'en' } };
    expect(renderApp(en, { ...ui(), view: 'proposals' })).toMatch(/a user/);
    expect(dictFor('en').aUser).toBe('a user');
  });
  it('an unknown proposal status falls back to a non-decidable one', () => {
    const html = renderApp({ ...base(), proposals: [P({ status: 'weird' as never })] }, { ...ui(), view: 'proposals' });
    expect(html).toContain('data-id="p1"');
    expect(html).not.toContain('data-action="p-approve"');
    expect(html).not.toContain('data-action="p-reject-open"');
  });
  it('proposalsReadOnly hides proposal buttons but leaves the notes composer writable', () => {
    const m = { ...base(), proposalsReadOnly: true, proposals: [P()] };
    const props = renderApp(m, { ...ui(), view: 'proposals' });
    expect(props).not.toContain('data-action="p-approve"');
    expect(props).toContain('solo lectura');
    const notes = renderApp(m, { ...ui(), view: 'notes' });
    expect(notes).toContain('data-action="note-add"');
    expect(notes).not.toContain('solo lectura');
  });
  it('task card shows the forge block', () => {
    const m = base();
    m.states.T001 = { status: 'in_progress', forge: { path: 'large', phase: 'review', agent: 'forge-impl', validators: [{ name: 'test', ok: true }], verdict: { action: 'fix', score: 0.55 }, round: 2, cap: 4 } };
    const html = renderApp(m, { ...ui(), modal: 'T001' });
    for (const s of ['large', 'review', 'forge-impl', 'test ✓', 'fix', '0.55', '2/4']) expect(html).toContain(s);
  });
  it('escapes hostile text in the forge block', () => {
    const m = base();
    m.states.T001 = { status: 'in_progress', forge: { path: '<b>x', phase: '"><script>', agent: '<img src=x>', validators: [{ name: '<i>', ok: false }], verdict: { action: '<u>', score: null } } };
    const html = renderApp(m, { ...ui(), modal: 'T001' });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x>');
    expect(html).toContain('&lt;i&gt; ✗');
  });
  it('nav shows the count of open proposals', () => {
    const html = renderApp({ ...base(), proposals: [P(), P({ id: 'p2', status: 'discussing' }), P({ id: 'p3', status: 'rejected' })] }, ui());
    expect(html).toMatch(/data-view="proposals"[^]*?>2</);
  });
  it('shows comments oldest first, the decided line and the reject and comment composers', () => {
    const notes = [
      { id: 'c2', ts: '2026-10-11T11:10:00Z', type: 'idea' as const, author: 'user:u1', text: 'segundo <b>', proposalId: 'p1' },
      { id: 'c1', ts: '2026-10-11T11:00:00Z', type: 'idea' as const, author: 'session:x', text: 'primero', proposalId: 'p1' },
    ];
    const ps = [P(), P({ id: 'p2', status: 'rejected', decidedBy: 'user:u1', decidedAt: '2026-10-11T11:00:00Z', reason: 'no <ahora>' })];
    const html = renderApp({ ...base(), me: 'user:u1', notes, proposals: ps }, { ...ui(), view: 'proposals', rejecting: 'p1', commenting: 'p1', reasonDraft: 'r<', commentDraft: 'c<' });
    expect(html.indexOf('primero')).toBeGreaterThan(-1);
    expect(html.indexOf('primero')).toBeLessThan(html.indexOf('segundo &lt;b&gt;'));
    expect(html).toContain('no &lt;ahora&gt;');
    expect(html).toContain('data-role="reason-text"');
    expect(html).toContain('data-role="comment-text"');
    expect(html).toContain('data-action="p-reject-send" data-id="p1"');
    expect(html).toContain('data-action="p-comment-send" data-id="p1"');
    expect(html).toContain('r&lt;');
    expect(html).toContain('data-action="pfilter" data-kind="status" data-value="auto_approved"');
  });
});

const runDoc = (over: object = {}) => ({ runId: 'r1', mode: 'subagents' as const, parallel: 3, branch: 'forge/run-demo-shop', mergeOnFinish: false, active: true, stopReason: null, coordinator: 'main',
  slots: [{ task: 'T002', stage: 'implement' as const, agent: 'forge-impl-heavy', by: 'main', since: new Date(NOW - 7 * 60000).toISOString() }], kind: 'plan' as const, loose: [], ...over });
const looseRun = (over: object = {}) => runDoc({
  runId: 'loose-1', kind: 'ephemeral' as const, branch: 'main', parallel: 2,
  slots: [{ task: 'fix-cart', stage: 'implement' as const, agent: 'forge-mech', by: 'main', since: new Date(NOW - 3 * 60000).toISOString() }],
  loose: [
    { id: 'fix-cart', title: 'Fix the cart', status: 'running' as const, stage: 'implement' as const, agent: 'forge-mech' },
    { id: 'docs-typo', title: 'Typo in the README', status: 'queued' as const, stage: null, agent: null },
    { id: 'bump', title: 'Bump the version', status: 'integrated' as const, stage: 'integrate' as const, agent: null },
  ],
  ...over,
});
const looseSection = (html: string) => { const i = html.indexOf('<section class="loose'); return i < 0 ? '' : html.slice(i, html.indexOf('</section>', i)); };

describe('execution', () => {
  it('an ephemeral run reads as loose tasks in the pill and the sessions run block, with the loose titles in its slots', () => {
    const m = base();
    m.run = looseRun();
    m.sessions.main = { ...m.sessions.main, role: 'coordinator', leaseUntil: new Date(NOW + 5 * 60000).toISOString() };
    expect(renderApp(m, ui())).toContain('▶ tareas sueltas · subagentes 1/2');
    const sv = renderApp(m, ui({ view: 'sessions' }));
    expect(sv).toMatch(/<section class="run"><div class="lbl">▶ tareas sueltas · subagentes 1\/2 · coordinadora: main/);
    expect(sv).not.toContain('▶ ejecución');
    expect(sv).toContain('Fix the cart');
    expect(sv).toContain('libre'); // parallel 2, one slot: one free place
    const en = { ...m, meta: { ...m.meta!, locale: 'en' } };
    expect(renderApp(en, ui())).toContain('▶ loose tasks · subagents 1/2');
    expect(renderApp(en, ui({ view: 'sessions' }))).toContain('▶ loose tasks · subagents 1/2 · coordinator: main');
  });
  it('a loose id equal to a plan task id shows the loose title and the coordinator liveness, not the plan task', () => {
    const m = base();
    const planTask = m.plan.tasks[0];
    m.states = { ...m.states, [planTask.id]: { ...(m.states[planTask.id] ?? {}), status: 'in_progress', exec: { leaseUntil: new Date(NOW + 5 * 60000).toISOString() } } as never };
    m.run = looseRun({
      slots: [{ task: planTask.id, stage: 'implement' as const, agent: 'forge-mech', by: 'main', since: new Date(NOW - 3 * 60000).toISOString() }],
      loose: [{ id: planTask.id, title: 'Loose namesake', status: 'running' as const, stage: 'implement' as const, agent: 'forge-mech' }],
    });
    m.sessions.main = { ...m.sessions.main, leaseUntil: new Date(NOW - 20 * 60000).toISOString() };
    const sv = renderApp(m, ui({ view: 'sessions' }));
    const slot = sv.slice(sv.indexOf('<div class="sc slot"'), sv.indexOf('</h3>', sv.indexOf('<div class="sc slot"')));
    expect(slot).toContain('Loose namesake');
    expect(slot).not.toContain(planTask.title);
    expect(slot).toContain('live-stopped');
  });
  it('the tracking view lists the loose tasks with status, stage, agent and the slot liveness dot', () => {
    const m = base();
    m.run = looseRun();
    m.sessions.main = { ...m.sessions.main, leaseUntil: new Date(NOW + 5 * 60000).toISOString() };
    const sec = looseSection(renderApp(m, ui()));
    expect(sec).toContain('Tareas sueltas');
    expect(sec).toMatch(/live-alive[^]*fix-cart[^]*Fix the cart[^]*en curso · implementar · forge-mech/);
    expect(sec).toMatch(/docs-typo[^]*Typo in the README[^]*en cola/);
    expect(sec).toMatch(/bump[^]*Bump the version[^]*integrada · integrar/);
    m.sessions.main = { ...m.sessions.main, leaseUntil: new Date(NOW - 20 * 60000).toISOString() };
    expect(looseSection(renderApp(m, ui()))).toContain('live-stopped');
    expect(looseSection(renderApp({ ...m, meta: { ...m.meta!, locale: 'en' } }, ui()))).toMatch(/Loose tasks[^]*running · implement · forge-mech/);
    // Only while an ephemeral run is active.
    expect(looseSection(renderApp({ ...m, run: runDoc() }, ui()))).toBe('');
    expect(looseSection(renderApp({ ...m, run: looseRun({ active: false }) }, ui()))).toBe('');
  });
  it('loose tasks do not count in the plan progress, filters or timeline, and never show as orphaned', () => {
    const m = base();
    const open = ui({ expanded: new Set(['F1', 'F2']) });
    const progress = (h: string) => h.match(/<b>\d+<\/b>\/\d+ (tareas|tasks)/)![0];
    const before = renderApp(m, open);
    m.run = looseRun();
    m.sessions.main = { ...m.sessions.main, leaseUntil: new Date(NOW - 20 * 60000).toISOString() };
    const html = renderApp(m, open);
    expect(progress(html)).toBe(progress(before));
    expect(html.match(/\d+ %/)![0]).toBe(before.match(/\d+ %/)![0]);
    expect(html).not.toContain('data-task="fix-cart"');
    expect(html).not.toContain('data-id="fix-cart"');
    expect(html).not.toContain('huérfana');
    expect(timelineSvg(m, ui())).not.toContain('fix-cart');
    expect(renderApp(m, ui({ view: 'versions' }))).not.toContain('fix-cart');
    expect(renderApp(m, ui({ statuses: ['in_progress'] }))).not.toContain('data-task="fix-cart"');
  });
  it('escapes everything a loose task carries', () => {
    const m = base();
    m.run = looseRun({
      coordinator: HOSTILE,
      slots: [{ task: 'fix-cart', stage: 'implement', agent: HOSTILE, by: 'main', since: new Date(NOW - 60000).toISOString() }],
      loose: [{ id: 'fix-cart', title: HOSTILE, status: 'running', stage: 'implement', agent: HOSTILE }],
    });
    for (const view of ['tracking', 'sessions'] as const) {
      const html = renderApp(m, ui({ view }));
      expect(html).not.toContain('<img src=x');
      expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    }
  });
  it('run pill: active, then silent and stopped by the coordinator lease', () => {
    const m = base();
    m.run = runDoc();
    m.sessions.main = { ...m.sessions.main, leaseUntil: new Date(NOW + 5 * 60000).toISOString() };
    expect(renderApp(m, ui())).toContain('▶ ejecución · subagentes 1/3');
    m.sessions.main = { ...m.sessions.main, leaseUntil: new Date(NOW - 2 * 60000).toISOString() };
    expect(renderApp(m, ui())).toMatch(/sin señal desde \d\d:\d\d/);
    m.sessions.main = { ...m.sessions.main, leaseUntil: new Date(NOW - 20 * 60000).toISOString() };
    expect(renderApp(m, ui())).toMatch(/parada desde \d\d:\d\d/);
  });
  it('sessions view: run block with slots and free places; session cards show role and stopped state', () => {
    const m = base();
    m.run = runDoc();
    m.sessions.main = { ...m.sessions.main, role: 'coordinator', leaseUntil: new Date(NOW - 20 * 60000).toISOString() };
    const html = renderApp(m, ui({ view: 'sessions' }));
    expect(html).toContain('1/3 plazas');
    expect(html).toContain('libre');
    expect(html).toContain('coordinadora');
    expect(html).toMatch(/parada · última señal \d\d:\d\d/);
  });
  it('a task whose executor lease stopped is drawn as orphaned, not in progress', () => {
    const m = base();
    m.states.T002 = { status: 'in_progress', owner: 'main', exec: { runId: 'r1', mode: 'subagents', by: 'main', agent: 'forge-impl-heavy', stage: 'implement', round: 1, since: new Date(NOW - 30 * 60000).toISOString(), leaseUntil: new Date(NOW - 20 * 60000).toISOString() } };
    const html = renderApp(m, ui());
    expect(html).toContain('orphan');
    expect(html).toContain('huérfana');
  });
  it('speaks English with an English plan', () => {
    const m = { ...base(), meta: { ...base().meta!, locale: 'en' }, run: runDoc() };
    expect(renderApp(m, ui({ view: 'sessions' }))).toContain('▶ execution · subagents 1/3');
  });
  it('the timeline track rows carry no swarm mark', () => {
    expect(timelineSvg(base(), ui({ timelineGroup: 'track' }))).not.toContain('● ');
  });
  it('renders the Verification block with thumbnails, local-only and blocked states', () => {
    const m = base();
    m.states.T001 = { ...m.states.T001!, evidence: { surfaces: ['web'], result: 'fail', passed: 1, total: 2, shots: [
      { url: 'https://claude.ai/_blob/a', surface: 'web', check: 'adds <b>', ok: true },
      { url: 'https://claude.ai/_blob/b', surface: 'web', check: 'removes', ok: false },
    ] } };
    const html = renderApp(m, { ...ui(), modal: 'T001' });
    expect(html).toContain('✗ 1/2');
    expect(html).toContain('data-action="open-shot" data-i="1"');
    expect(html).toContain('src="https://claude.ai/_blob/b"');
    expect(html).toContain('adds &lt;b&gt;');
    const local = [{ surface: 'web', check: 'a', ok: true }, { surface: 'web', check: 'b', ok: true }];
    m.states.T001.evidence = { surfaces: ['web'], result: 'pass', passed: 6, total: 6, local: '.forge/work/x/evidence/1-1', shots: local };
    expect(renderApp(m, { ...ui(), modal: 'T001' })).toMatch(/2 (capturas|shots) \((solo en local|local only)\)/);
    m.states.T001.evidence = { ...m.states.T001.evidence, pending: true };
    const pending = renderApp(m, { ...ui(), modal: 'T001' });
    expect(pending).toMatch(/upload pending|subida pendiente/);
    expect(pending).not.toMatch(/local only|solo en local/);
    m.states.T001.evidence = { surfaces: ['app'], result: 'blocked', passed: 0, total: 0, reason: 'no emulator', shots: [] };
    expect(renderApp(m, { ...ui(), modal: 'T001' })).toContain('no emulator');
  });
  it('opens a screenshot in a lightbox with its check, expected and observed', () => {
    const m = base();
    m.states.T001 = { ...m.states.T001!, evidence: { surfaces: ['web'], result: 'fail', passed: 0, total: 1, shots: [
      { url: 'https://claude.ai/_blob/b', surface: 'web', check: 'removes', ok: false, expected: 'empty', observed: '1 item' },
    ] } };
    const html = renderApp(m, { ...ui(), modal: 'T001', shot: 0 });
    expect(html).toContain('class="lightbox"');
    expect(html).toContain('empty');
    expect(html).toContain('1 item');
  });
  it('renders no lightbox for an out-of-range shot', () => {
    const m = base();
    m.states.T001 = { ...m.states.T001!, evidence: { surfaces: ['web'], result: 'pass', passed: 1, total: 1, shots: [{ url: 'https://claude.ai/_blob/b', surface: 'web', check: 'c', ok: true }] } };
    expect(renderApp(m, { ...ui(), modal: 'T001', shot: 99 })).not.toContain('class="lightbox"');
  });
  it('marks tasks with evidence in the tracking cards', () => {
    const m = base();
    m.states.T001 = { ...m.states.T001!, evidence: { surfaces: ['web'], result: 'fail', passed: 0, total: 1, shots: [] } };
    expect(renderApp(m, ui({ expanded: new Set(['F1', 'F2']) }))).toContain('class="evi del"');
    expect(renderApp(m, ui({ view: 'versions' }))).toContain('class="evi del"');
  });
});

describe('track help', () => {
  it('explains what a track is where the roadmap names them', () => {
    const html = renderApp(base(), ui());
    expect(html).toContain('title="Frente: línea de trabajo que avanza en paralelo, con su propia sesión, worktree y rama"');
    const versions = renderApp(base(), ui({ view: 'versions' }));
    expect(versions).toContain('class="f trk" title="Frente: línea de trabajo');
  });
});
