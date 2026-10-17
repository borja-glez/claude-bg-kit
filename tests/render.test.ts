import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parsePlan } from '../src/lib/plan.js';
import { buildDocs } from '../src/lib/sync.js';
import { dictFor } from '../src/page/i18n.js';
import { esc, relText, renderApp, timelineSvg, VIEWS, type Model, type UiState } from '../src/page/render.js';
import type { MessageDoc, EventType, NoteDoc, PlanTrack, TaskStatus } from '../src/lib/types.js';
import { proposalDigest, type ApprovalDoc, type ProposalDoc } from '../src/lib/proposals.js';
import { unmarked, unmarkedReason } from '../src/page/html.js';

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
  zoom: '1d', offset: 0, expanded: new Set(), modal: null, search: '', view: 'summary',
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
  it('shows one infinite pill, in the strip, only while the run is active (H-22)', () => {
    const inf = { active: true, cycle: 3, budget: { cycles: 10 }, startedAt: '2026-10-11T09:00:00Z', lastCycleAt: null };
    const html = renderApp({ ...base(), infinite: inf }, ui());
    expect(html.match(/class="pill inf"/g)?.length).toBe(1);
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
    expect(html.match(/<span class="pill inf">([^<]*)<\/span>/g)).toEqual(['<span class="pill inf">∞ ciclo 1</span>']);
  });

  it('renders the strip, the summary and the schedule in the plan locale', () => {
    const html = renderApp(base(), ui());
    expect(html).toContain('EN VIVO');
    expect(html).toContain('demo-shop');
    expect(html).toContain('17 %'); // 1 of 6
    expect(html).toContain('<h1>Resumen</h1>');
    const schedule = renderApp(base(), ui({ view: 'schedule' }));
    expect(schedule).toContain('<h1>Cronograma</h1>');
    expect(schedule).toContain('data-action="toggle-phase" data-id="F1"');
    expect(schedule).toContain('class="now"');
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
    const html = renderApp(base(), ui({ view: 'schedule', search: 'carrito' }));
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

  it('the task modal says how long a done task took against its estimate, and how long one in progress has run', () => {
    const done = renderApp(base(), ui({ modal: 'T001' }));
    expect(done).toContain('tardó 20 min · estimado 20');
    expect(done).not.toMatch(/class="ye">tardó/);
    const over = base();
    over.states.T001 = { ...over.states.T001, doneAt: '2026-10-11T10:31:00Z' } as never;
    expect(renderApp(over, ui({ modal: 'T001' }))).toMatch(/<span class="ye">tardó 31 min · estimado 20 min<\/span>/);
    expect(renderApp(base(), ui({ modal: 'T002' }))).toContain('lleva 15 min');
    const en = { ...base(), meta: { ...base().meta!, locale: 'en' } };
    expect(renderApp(en, ui({ modal: 'T001' }))).toContain('took 20 min · estimated 20');
    expect(renderApp(en, ui({ modal: 'T002' }))).toContain('running for 15 min');
  });
  it('the task modal shows no duration for junk, future or reversed dates', () => {
    const m = base();
    m.states.T001 = { ...m.states.T001, doneAt: '2026-10-11T09:00:00Z' } as typeof m.states.T001;
    m.states.T002 = { ...m.states.T002, startedAt: '2026-10-11T13:00:00Z' } as never;
    expect(renderApp(m, ui({ modal: 'T001' }))).not.toContain('tardó');
    expect(renderApp(m, ui({ modal: 'T002' }))).not.toContain('lleva');
    m.states.T001 = { ...m.states.T001, startedAt: 'nope', claimedAt: undefined } as never;
    expect(renderApp(m, ui({ modal: 'T001' }))).not.toContain('tardó');
  });

  it('draws the analysis row: burndown, critical path and code zones', () => {
    const html = renderApp(base(), ui({ view: 'schedule' }));
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
    const html = ['summary', 'schedule'].map(view => renderApp(hostile, ui({ view: view as UiState['view'], modal: 'T001', expanded: new Set(['F1', 'F2']), layers: ['critical', 'forecast', 'forge'] }))).join('');
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
    expect(html).toContain('<h1>Sesiones</h1>');
    expect(html).toContain('wp-demo-shop-backend');
    expect(html).toContain('track/backend');
    expect(html).toContain('1/4');
    expect(html).toContain('class="sc');
  });
  it('a task without zones reads «whole repository» in its session card and in its detail (carry 1)', () => {
    const open = { ...plan, tasks: plan.tasks.map(t => (t.id === 'T002' ? { ...t, zones: [] } : t)) };
    const zonesOf = (html: string, start: string) => html.slice(html.indexOf(start)).match(/>Zonas(?: planificadas)?<\/(?:dt|div)>\s*<(?:dd|div)>([\s\S]*?)<\/(?:dd|div)>/)?.[1];
    for (const [view, start] of [[ui({ view: 'sessions' }), 'class="sc'], [ui({ modal: 'T002' }), 'class="modal"']] as const) {
      expect(zonesOf(renderApp({ ...base(), plan: open }, view), start)).toBe('todo el repositorio');
      expect(renderApp({ ...base(), plan: open, meta: { ...base().meta!, locale: 'en' } }, view)).toContain('whole repository');
    }
    expect(renderApp({ ...base(), plan: open }, ui({ view: 'sessions' }))).not.toContain('<dd>**</dd>');
    // A task with zones keeps them.
    expect(zonesOf(renderApp(base(), ui({ view: 'sessions' })), 'class="sc')).toBe('src/api/orders/**');
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
    for (const view of ['summary', 'sessions'] as const) {
      const html = renderApp({ ...base(), messages }, ui({ view }));
      expect(html).not.toContain('<img');
      expect(html).not.toContain('<script');
      expect(html).not.toContain('onclick=');
    }
  });
  it('renders six nav buttons with the active one marked, and every view its h1 and the strip (§4.6)', () => {
    const h1 = { summary: 'Resumen', plan: 'Plan', schedule: 'Cronograma', runs: 'Ejecuciones', sessions: 'Sesiones', talk: 'Conversación' } as const;
    for (const view of VIEWS) {
      const html = renderApp(base(), ui({ view }));
      expect(html.match(/<button type="button" class="nav/g)).toHaveLength(6);
      expect(html).toMatch(new RegExp(`class="nav on" data-action="view" data-view="${view}" aria-current="page"`));
      expect(html).toContain(`<h1>${h1[view]}</h1>`);
      expect(html).toContain('<div class="strip">');
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
    for (const view of ['summary', 'sessions'] as const) {
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
    for (const view of ['summary', 'sessions'] as const) {
      const html = renderApp(bad, ui({ view }));
      expect(html).not.toContain('NaN');
    }
    expect(renderApp(bad, ui())).toContain('+1 inactiva');
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
    const m = { ...base(), plan: { ...plan, versions: [{ id: '0.1', phases: ['F1'] }], tasks: plan.tasks.map((t, i) => ({ ...t, category: i % 2 ? 'api' : 'ui' })) } };
    const html = renderApp(m, ui({ view: 'plan' }));
    expect(html).toContain('<h1>Plan</h1>');
    expect(html).toContain('Versión 0.1');
    expect(html).toContain('Sin versión');
    expect(html).toContain('Fase 1');
    expect(html).toContain('Fase 2');
    expect(html).toContain('data-action="toggle-cat"');
    // Carry 9: the category toggles are buttons of their own type, never a form's submit.
    expect(html).toMatch(/<button type="button" class="cat" data-action="toggle-cat"/);
    expect(html).not.toMatch(/<button class="cat"/);
    expect(html).toContain('data-action="open-task" data-id="T002"');
    expect(html).toContain('data-action="vfilter"');
    expect(html).toContain('data-action="vtrack"');
    expect(html).toContain('Desplegar categorías');
    expect(html).toContain('Hecha · 1');
    expect(html).toContain('Provisional · 3');
  });
  it('filters by task status, phase status and track and hides collapsed categories', () => {
    const html = renderApp(base(), ui({ view: 'plan', versionFilter: { statuses: ['done'], phaseStatuses: [], track: null } }));
    expect(html).toContain('data-id="T001"');
    expect(html).not.toContain('data-id="T003"');
    const byTrack = renderApp(base(), ui({ view: 'plan', versionFilter: { statuses: [], phaseStatuses: [], track: 'ui' } }));
    expect(byTrack).toContain('data-id="T003"');
    expect(byTrack).not.toContain('data-id="T001"');
    const byPhase = renderApp(base(), ui({ view: 'plan', versionFilter: { statuses: [], phaseStatuses: ['provisional'], track: null } }));
    expect(byPhase).toContain('data-id="T004"');
    expect(byPhase).not.toContain('data-id="T001"');
    const cats = { ...base(), plan: { ...plan, tasks: plan.tasks.map(t => ({ ...t, category: 'api' })) } };
    const collapsed = renderApp(cats, ui({ view: 'plan', collapsed: new Set(['F1|api']) }));
    expect(collapsed).not.toContain('data-action="open-task" data-id="T001"');
    expect(collapsed).toContain('data-action="open-task" data-id="T004"');
  });
  it('draws a proportional segmented bar per category, in status order, and no pips (H-02)', () => {
    const m = { ...base(), plan: { ...plan, tasks: plan.tasks.map(t => ({ ...t, category: 'api' })) } };
    m.states = { ...m.states, T003: { status: 'claimed' }, T004: { status: 'blocked' } };
    const html = renderApp(m, ui({ view: 'plan' }));
    const seg = html.slice(html.indexOf('<span class="seg"'), html.indexOf('</span>', html.indexOf('<span class="seg"')));
    expect(seg).toMatch(/^<span class="seg" role="img" aria-label="[^"]+">/);
    expect([...seg.matchAll(/<i class="st-(\w+)" style="flex-grow:(\d+)">/g)].map(x => `${x[1]}:${x[2]}`)).toEqual(['done:1', 'in_progress:2']);
    expect(html).not.toContain('pips');
  });
  it('a column whose only category is «—» lists its tasks without a category button (H-02)', () => {
    const html = renderApp(base(), ui({ view: 'plan' }));
    expect(html).not.toContain('data-action="toggle-cat"');
    expect(html).toContain('data-action="open-task" data-id="T001"');
  });
  it('escapes hostile plan values in the versions view', () => {
    const m = base();
    const h = { ...m, plan: { ...plan, versions: [{ id: HOSTILE, phases: ['F1'] }], tasks: plan.tasks.map(t => ({ ...t, title: HOSTILE, category: HOSTILE })) } };
    clean(renderApp(h, ui({ view: 'plan' })));
  });
});

describe('notes view', () => {
  it('labels a decision the person took as theirs, and only an automatic one as auto (H-05)', () => {
    const mk = (auto: boolean) => note({ id: `d-${auto}`, type: 'decision', decision: { point: 'design-approve', what: 'w', chosen: 'c', why: 'y', auto } });
    const es = renderApp({ ...base(), notes: [mk(false)] }, ui({ view: 'talk' }));
    expect(es).toContain('<span class="nauto">tuya</span>');
    expect(es).not.toContain('<span class="nauto">auto</span>');
    expect(renderApp({ ...base(), notes: [mk(true)] }, ui({ view: 'talk' }))).toContain('<span class="nauto">auto</span>');
    expect(renderApp({ ...base(), meta: { ...base().meta!, locale: 'en' }, notes: [mk(false)] }, ui({ view: 'talk' }))).toContain('<span class="nauto">yours</span>');
  });
  const notes = [
    note({ id: 'n1', type: 'decision', text: 'usar redis', taskId: 'T001' }),
    note({ id: 'n2', type: 'question', text: '¿apple pay?', ts: '2026-10-11T11:40:00Z' }),
    note({ id: 'n3', type: 'question', text: '¿stripe?', answer: 'sí, stripe', answeredBy: 'user:u1', answeredAt: '2026-10-11T11:50:00Z' }),
    note({ id: 'n4', type: 'idea', author: 'user:u1', text: 'mi idea' }),
    note({ id: 'n5', type: 'debt', author: 'user:u2', text: 'deuda ajena' }),
  ];
  it('renders counts, composer, filters and note cards in es', () => {
    const html = renderApp({ ...base(), notes, me: 'user:u1', profiles: { u2: 'Ana' } }, ui({ view: 'talk' }));
    expect(html).toContain('<h1>Conversación</h1>');
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
    const html = renderApp({ ...base(), notes, me: 'user:u1' }, ui({ view: 'talk', noteFilter: 'mine' }));
    expect(html).toContain('mi idea');
    expect(html).not.toContain('deuda ajena');
    const open = renderApp({ ...base(), notes, me: 'user:u1' }, ui({ view: 'talk', answering: 'n2' }));
    expect(open).toContain('data-role="answer-text"');
    expect(open).toContain('data-action="answer-send"');
    const ro = renderApp({ ...base(), notes, readOnly: true }, ui({ view: 'talk' }));
    expect(ro).toContain('solo lectura');
    expect(renderApp({ ...base(), notes, profiles: {} }, ui({ view: 'talk' }))).toContain('usuario');
  });
  it('marks an automatic decision with what was chosen, why and how to undo it, escaped', () => {
    const dec = note({ id: 'd1', type: 'decision', text: 'diseño aprobado', decision: { point: 'design-approve', what: 'diseño aprobado (v4)', chosen: 'approve', alternatives: ['another round'], why: 'sin critical', revert: '/forge:decisions revert 7', auto: true } });
    const html = renderApp({ ...base(), notes: [dec] }, ui({ view: 'talk' }));
    expect(html).toContain('<span class="nauto">auto</span>');
    expect(html).toContain('Elegido:</span> approve');
    expect(html).toContain('(another round)');
    expect(html).toContain('Por qué:</span> sin critical');
    expect(html).toContain('Cómo revertir:</span> /forge:decisions revert 7');
    const evil = note({ id: 'd2', type: 'decision', decision: { point: 'other', what: 'w', chosen: '<script>x</script>', why: '<img onerror=1>', auto: true } });
    const bad = renderApp({ ...base(), notes: [evil] }, ui({ view: 'talk' }));
    expect(bad).not.toContain('<script>x');
    expect(bad).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(renderApp({ ...base(), notes: [note({ id: 'p', type: 'decision' })] }, ui({ view: 'talk' }))).not.toContain('class="nauto"');
  });
  it('escapes hostile notes in every view', () => {
    const bad = [
      note({ id: 'h"><script>', type: 'question', author: HOSTILE, text: HOSTILE, taskId: 'T001' }),
      note({ id: 'h2', author: `session:${HOSTILE}`, text: HOSTILE, answer: HOSTILE, type: 'question', taskId: 'T001' }),
      note({ id: 'h3', author: 'user:x"><script>', text: HOSTILE, taskId: '"><script>' }),
      note({ id: 'h4', type: 'decision', text: HOSTILE, taskId: 'T001', decision: { point: 'other', what: HOSTILE, chosen: HOSTILE, alternatives: [HOSTILE], why: HOSTILE, revert: HOSTILE, auto: true } }),
    ];
    for (const view of ['summary', 'plan', 'sessions', 'talk'] as const) {
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
    const html = renderApp(base(), ui({ view: 'schedule', timelineGroup: 'track', expanded: new Set(['ui']) }));
    expect(html).toContain('data-action="tgroup" data-group="track"');
    expect(html).toContain('Por frentes');
    expect(html).toContain('data-action="toggle-phase" data-id="backend"');
    expect(html).toContain('data-action="toggle-phase" data-id="ui"');
    expect(html).toContain('Maqueta de carrito');
    expect(html).not.toContain('data-id="F1"');
  });
});

/** theme.css without comments, and its top-level blocks: [prelude, body] (an @media body holds its own rules). */
const CSS = readFileSync(new URL('../src/page/theme.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const cssBlocks = (css: string): [string, string][] => {
  const out: [string, string][] = [];
  let depth = 0, start = 0, open = 0;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') { if (depth === 0) open = i; depth++; }
    else if (css[i] === '}') { depth--; if (depth === 0) { out.push([css.slice(start, open).trim(), css.slice(open + 1, i)]); start = i + 1; } }
  }
  return out;
};
/** Every declaration of the rules whose selector list includes `selector`, joined. */
const cssRule = (css: string, selector: string): string =>
  cssBlocks(css).filter(([p]) => !p.startsWith('@') && p.split(',').map(s => s.trim()).includes(selector)).map(([, b]) => b).join(';');
/** The bodies of the @media blocks whose query includes `query`, joined. */
const cssMedia = (css: string, query: string): string =>
  cssBlocks(css).filter(([p]) => p.startsWith('@media') && p.replace(/\s/g, '').includes(query)).map(([, b]) => b).join('\n');

describe('theme.css', () => {
  const css = readFileSync(new URL('../src/page/theme.css', import.meta.url), 'utf8');
  it('keeps selects inside narrow screens (no page scroll at 390px)', () => {
    expect(css).toMatch(/(^|[\s}])select\{[^}]*max-width:100%/);
    expect(css).toMatch(/\.f\.trk select\{[^}]*max-width:100%/);
    expect(css).toMatch(/\.f\.trk\{[^}]*max-width:100%/);
  });
  it('no grid of fixed-width columns overflows a 390 px screen: every auto-fill column fits its box (carry 10b)', () => {
    const mins = [...CSS.matchAll(/repeat\(auto-(?:fill|fit),\s*minmax\((min\([^)]*\)|[^,)]+),/g)].map(x => x[1]);
    expect(mins.length).toBeGreaterThanOrEqual(5);
    for (const min of mins) expect(min).toMatch(/^min\(\d+px,100%\)$/);
    // Summary's live sessions: the section is a block (its title over the cards), the cards are the grid.
    const phone = cssMedia(CSS, '(max-width:760px)');
    expect(cssRule(CSS, '.sess')).not.toContain('grid-template-columns');
    expect(cssRule(phone, '.sess')).not.toContain('grid-template-columns');
    expect(cssRule(CSS, '.sess .sgrid2')).toContain('grid-template-columns:repeat(auto-fill,minmax(min(220px,100%),1fr))');
  });
  it('a run slot reads like the session cards it replaced, and only the slot buttons make their lines blocks (carry 9)', () => {
    expect(cssRule(CSS, '.slot .sh')).toContain('font:700 20px');
    expect(cssRule(CSS, '.slot .mono')).toBe('');
    expect(cssRule(CSS, 'button.slot .mono')).toContain('display:block');
  });
  it('keeps no dead selectors of the summary of before (carry 6)', () => {
    expect(CSS).not.toContain('.s.idle');
  });
});

const P = (over: Partial<ProposalDoc & { id: string }> = {}) => ({ id: 'p1', ts: '2026-10-11T10:00:00.000Z', category: 'perf' as const, risk: 'low' as const,
  title: 'Cache prices', rationale: 'why', evidence: 'bench', pillar: 'Fast checkout', status: 'proposed' as const, source: 'scout' as const, author: 'session:abc', ...over });

describe('proposals view', () => {
  it('proposals view lists cards with decision buttons for proposed items', () => {
    const html = renderApp({ ...base(), isOwner: true, proposals: [P(), P({ id: 'p2', status: 'approved', title: 'Done one' })] }, { ...ui(), view: 'talk', talk: 'proposals' });
    expect(html).toContain('data-action="talk-c" data-c="proposals" aria-pressed="true"');
    expect(html).toContain('Cache prices');
    expect((html.match(/data-action="p-approve"/g) ?? []).length).toBe(1);
    expect(html).toContain('risk-low');
  });
  it('escapes proposal text and hides buttons when read-only', () => {
    const html = renderApp({ ...base(), readOnly: true, proposals: [P({ title: '<img src=x onerror=alert(1)>', evidence: '"><script>' })] }, { ...ui(), view: 'talk', talk: 'proposals' });
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('data-action="p-approve"');
  });
  it('filters by status, category and risk', () => {
    const ps = [P(), P({ id: 'p2', category: 'security', risk: 'high' })];
    const html = renderApp({ ...base(), proposals: ps }, { ...ui(), view: 'talk', talk: 'proposals', proposalFilter: { status: 'all', category: 'security', risk: 'all' } });
    expect(html).toContain('data-id="p2"');
    expect(html).not.toContain('data-id="p1"');
  });
  it('a bare "user" decidedBy shows the translated "a user" label', () => {
    const m = { ...base(), proposals: [P({ status: 'approved', decidedBy: 'user', decidedAt: '2026-10-11T11:00:00.000Z' })] };
    expect(renderApp(m, { ...ui(), view: 'talk', talk: 'proposals' })).toContain('un usuario');
    const en = { ...m, meta: { ...m.meta!, locale: 'en' } };
    expect(renderApp(en, { ...ui(), view: 'talk', talk: 'proposals' })).toMatch(/a user/);
    expect(dictFor('en').aUser).toBe('a user');
  });
  it('an unknown proposal status falls back to a non-decidable one', () => {
    const html = renderApp({ ...base(), proposals: [P({ status: 'weird' as never })] }, { ...ui(), view: 'talk', talk: 'proposals' });
    expect(html).toContain('data-id="p1"');
    expect(html).not.toContain('data-action="p-approve"');
    expect(html).not.toContain('data-action="p-reject-open"');
  });
  it('proposalsReadOnly hides proposal buttons but leaves the notes composer writable', () => {
    const m = { ...base(), proposalsReadOnly: true, proposals: [P()] };
    const props = renderApp(m, { ...ui(), view: 'talk', talk: 'proposals' });
    expect(props).not.toContain('data-action="p-approve"');
    expect(props).toContain('solo lectura');
    const notes = renderApp(m, { ...ui(), view: 'talk' });
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
    expect(html).toMatch(/data-view="talk"[^]*?>2</);
  });
  it('shows comments oldest first, the decided line and the reject and comment composers', () => {
    const notes = [
      { id: 'c2', ts: '2026-10-11T11:10:00Z', type: 'idea' as const, author: 'user:u1', text: 'segundo <b>', proposalId: 'p1' },
      { id: 'c1', ts: '2026-10-11T11:00:00Z', type: 'idea' as const, author: 'session:x', text: 'primero', proposalId: 'p1' },
    ];
    const ps = [P(), P({ id: 'p2', status: 'rejected', decidedBy: 'user:u1', decidedAt: '2026-10-11T11:00:00Z', reason: 'no <ahora>' })];
    const html = renderApp({ ...base(), isOwner: true, me: 'user:u1', notes, proposals: ps }, { ...ui(), view: 'talk', talk: 'proposals', rejecting: 'p1', commenting: 'p1', reasonDraft: 'r<', commentDraft: 'c<' });
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
  it('only the owner sees Approve and Reject; anyone else comments and is told why (§4.1)', () => {
    const other = renderApp({ ...base(), isOwner: false, proposals: [P()] }, { ...ui(), view: 'talk', talk: 'proposals' });
    expect(other).not.toContain('data-action="p-approve"');
    expect(other).not.toContain('data-action="p-reject-open"');
    expect(other).toContain('data-action="p-comment-open" data-id="p1"');
    expect(other).toContain('Solo el dueño del roadmap decide las propuestas; tu comentario le llega');
    const owner = renderApp({ ...base(), isOwner: true, proposals: [P()] }, { ...ui(), view: 'talk', talk: 'proposals' });
    expect(owner).toContain('data-action="p-approve" data-id="p1"');
    expect(owner).not.toContain('tu comentario le llega');
    const en = renderApp({ ...base(), isOwner: false, meta: { ...base().meta!, locale: 'en' }, proposals: [P()] }, { ...ui(), view: 'talk', talk: 'proposals' });
    expect(en).toContain('Only the roadmap’s owner decides proposals; your comment reaches them');
    // Carry 5: while isOwner resolves (undefined), neither the buttons nor the line.
    const resolving = renderApp({ ...base(), proposals: [P()] }, { ...ui(), view: 'talk', talk: 'proposals' });
    expect(resolving).not.toContain('data-action="p-approve"');
    expect(resolving).not.toContain('tu comentario le llega');
    expect(resolving).toContain('data-action="p-comment-open" data-id="p1"');
  });
  it('an approval without the owner’s mark says it will not become a task; only the owner can confirm it (§4.1)', () => {
    const ps = [P({ status: 'approved' }), P({ id: 'p2', status: 'auto_approved' }), P({ id: 'p3', status: 'approved' })];
    const approvals = { p3: { status: 'approved' as const, decidedAt: '2026-10-11T10:00:00.000Z', by: 'page' as const, digest: proposalDigest('p3', ps[2]!) } };
    const owner = renderApp({ ...base(), isOwner: true, proposals: ps, approvals }, { ...ui(), view: 'talk', talk: 'proposals' });
    expect(owner.match(/sin la marca del dueño · no se convertirá en tarea/g)).toHaveLength(2);
    expect(owner).toContain('data-action="p-confirm" data-id="p1"');
    expect(owner).toContain('data-action="p-confirm" data-id="p2"');
    expect(owner).not.toContain('data-action="p-confirm" data-id="p3"');
    const other = renderApp({ ...base(), isOwner: false, proposals: ps, approvals }, { ...ui(), view: 'talk', talk: 'proposals' });
    expect(other.match(/sin la marca del dueño/g)).toHaveLength(2);
    expect(other).not.toContain('data-action="p-confirm"');
  });
  it('only a mark of this very text and status counts: without one the owner confirms; a mark of other text or another status means the decision changed, to decide again (§4.1, review I2, re-review N1)', () => {
    const now = P({ id: 'p1', status: 'approved', title: 'Cache prices v2' });
    const older = proposalDigest('p1', P({ id: 'p1', status: 'approved', title: 'Cache prices' }));
    const at = '2026-10-11T10:00:00.000Z';
    const ps = [now, P({ id: 'p2', status: 'approved' }), P({ id: 'p3', status: 'auto_approved', taskId: 'T020' }), P({ id: 'p4', status: 'approved' })];
    const approvals = {
      p1: { status: 'approved' as const, decidedAt: at, by: 'page' as const, digest: older },
      p2: { status: 'auto_approved' as const, decidedAt: at, by: 'forge:policy' as const, digest: proposalDigest('p2', ps[1]!) },
      // Another proposal's mark (a digest binds its pid) does not count for p4.
      p4: { status: 'approved' as const, decidedAt: at, by: 'page' as const, digest: proposalDigest('p2', ps[3]!) },
    };
    const html = renderApp({ ...base(), isOwner: true, proposals: ps, approvals }, { ...ui(), view: 'talk', talk: 'proposals' });
    // p1 (older text), p2 (a mark of another status) and p4 (a digest of another pid): the decision changed after the owner
    // took it; no one-click confirm, Approve and Reject with the text in view.
    expect(html).not.toContain('sin la marca del dueño');
    expect(html.match(/cambió después de tu decisión: revisa el texto y decide/g)).toHaveLength(3);
    for (const id of ['p1', 'p2', 'p4']) {
      expect(html).not.toContain(`data-action="p-confirm" data-id="${id}"`);
      expect(html).toContain(`data-action="p-approve" data-id="${id}"`);
      expect(html).toContain(`data-action="p-reject-open" data-id="${id}"`);
    }
    // A proposal that already has its task is not one that «will not become a task».
    expect(html).not.toContain('data-action="p-confirm" data-id="p3"');
    expect(html).not.toContain('data-action="p-approve" data-id="p3"');
    // Until the marks arrive the page does not know: no warning and no [Confirmar].
    const loading = renderApp({ ...base(), isOwner: true, proposals: ps }, { ...ui(), view: 'talk', talk: 'proposals' });
    expect(loading).not.toContain('sin la marca del dueño');
    expect(loading).not.toContain('cambió después');
    expect(loading).not.toContain('data-action="p-confirm"');
    expect(loading).not.toContain('data-action="p-approve"');
    // Read-only: the lines stay, the buttons go.
    const ro = renderApp({ ...base(), isOwner: true, proposalsReadOnly: true, proposals: ps, approvals }, { ...ui(), view: 'talk', talk: 'proposals' });
    expect(ro.match(/cambió después de tu decisión/g)).toHaveLength(3);
    expect(ro).not.toContain('data-action="p-confirm"');
    expect(ro).not.toContain('data-action="p-approve"');
    // To someone else: the owner's decision changed, and who decides; no buttons and no «tu».
    const other = renderApp({ ...base(), isOwner: false, proposals: ps, approvals }, { ...ui(), view: 'talk', talk: 'proposals' });
    expect(other.match(/cambió después de la decisión del dueño · no se convertirá en tarea/g)).toHaveLength(3);
    expect(other).not.toContain('tu decisión');
    expect(other).not.toContain('data-action="p-approve"');
    expect(other.match(/tu comentario le llega/g)).toHaveLength(3);
    const en = renderApp({ ...base(), meta: { ...base().meta!, locale: 'en' }, isOwner: true, proposals: ps, approvals }, { ...ui(), view: 'talk', talk: 'proposals' });
    expect(en.match(/changed after your decision: review the text and decide/g)).toHaveLength(3);
  });
  it('a decision changed after the owner took it never offers a one-click confirm: the two ways round the edit guard (re-review N1)', () => {
    const t1 = P({ id: 'p1', status: 'approved', path: 'src/cache/**' });
    const approvedT1: ApprovalDoc = { status: 'approved', decidedAt: '2026-10-11T10:30:00.000Z', by: 'page', digest: proposalDigest('p1', t1) };
    const cases: [string, ProposalDoc & { id: string }, ApprovalDoc][] = [
      ['approved T1, then T2 and auto_approved', P({ id: 'p1', status: 'auto_approved', path: 'src/**' }), approvedT1],
      ['auto_approved T1, then T2 and approved', P({ id: 'p1', status: 'approved', path: 'src/**' }), { ...approvedT1, status: 'auto_approved' }],
      ['rejected T1, then approved', P({ id: 'p1', status: 'approved', path: 'src/cache/**' }), { ...approvedT1, status: 'rejected' }],
      ['rejected T1, then T2 and approved', P({ id: 'p1', status: 'approved', path: 'src/**' }), { ...approvedT1, status: 'rejected' }],
    ];
    for (const [name, p, mark] of cases) {
      expect(unmarkedReason('p1', p, { p1: mark }), name).toBe('changed');
      const html = renderApp({ ...base(), isOwner: true, proposals: [p], approvals: { p1: mark } }, { ...ui(), view: 'talk', talk: 'proposals' });
      expect(html, name).not.toContain('data-action="p-confirm"');
      expect(html, name).not.toContain('sin la marca del dueño');
      expect(html, name).toContain('cambió después de tu decisión');
      expect(html, name).toContain('data-action="p-approve" data-id="p1"');
      expect(html, name).toContain('data-action="p-reject-open" data-id="p1"');
    }
  });
  it('unmarked is the one rule the card and «Te necesita» share (§4.1)', () => {
    const p = P({ status: 'approved' });
    const mark = { status: 'approved' as const, decidedAt: '2026-10-11T10:00:00.000Z', by: 'page' as const, digest: proposalDigest('p1', p) };
    expect(unmarked('p1', p, undefined)).toBe(false);
    expect(unmarked('p1', p, {})).toBe(true);
    expect(unmarked('p1', p, { p1: mark })).toBe(false);
    expect(unmarked('p1', { ...p, rationale: 'other' }, { p1: mark })).toBe(true);
    expect(unmarked('p1', { ...p, status: 'auto_approved' }, { p1: mark })).toBe(true);
    expect(unmarked('p1', { ...p, taskId: 'T020' }, {})).toBe(false);
    for (const status of ['proposed', 'discussing', 'rejected', 'done'] as const) expect(unmarked('p1', { ...p, status }, {})).toBe(false);
    // Only an own key counts: nothing inherited from Object.prototype passes for a mark.
    expect(unmarked('constructor', p, {})).toBe(true);
    expect(unmarked('toString', p, {})).toBe(true);
    // Review I2, re-review N1: the reason. No mark at all is 'no-mark'; a mark of another status or of other text is
    // 'changed' (the decision changed after the owner took it).
    expect(unmarkedReason('p1', p, {})).toBe('no-mark');
    expect(unmarkedReason('p1', { ...p, status: 'auto_approved' }, { p1: mark })).toBe('changed');
    expect(unmarkedReason('p1', p, { p1: { ...mark, status: 'rejected' } })).toBe('changed');
    expect(unmarkedReason('p1', { ...p, rationale: 'other' }, { p1: mark })).toBe('changed');
    expect(unmarkedReason('constructor', p, {})).toBe('no-mark');
    expect(unmarkedReason('p1', p, { p1: mark })).toBeNull();
    expect(unmarkedReason('p1', p, undefined)).toBeNull();
    expect(unmarkedReason('p1', { ...p, rationale: 'other', taskId: 'T020' }, { p1: mark })).toBeNull();
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
  it('an ephemeral run reads as loose tasks in the pill and the runs view, with the loose titles in its slots', () => {
    const m = base();
    m.run = looseRun();
    m.sessions.main = { ...m.sessions.main, role: 'coordinator', leaseUntil: new Date(NOW + 5 * 60000).toISOString() };
    expect(renderApp(m, ui())).toContain('▶ tareas sueltas · subagentes 1/2');
    const sv = renderApp(m, ui({ view: 'runs' }));
    expect(sv).toMatch(/<section class="exec-sec"><div class="lbl">▶ tareas sueltas · subagentes 1\/2 · coordinadora: main/);
    expect(sv).not.toContain('▶ ejecución');
    expect(sv).toContain('Fix the cart');
    expect(sv).toContain('libre'); // parallel 2, one slot: one free place
    const en = { ...m, meta: { ...m.meta!, locale: 'en' } };
    expect(renderApp(en, ui())).toContain('▶ loose tasks · subagents 1/2');
    expect(renderApp(en, ui({ view: 'runs' }))).toContain('▶ loose tasks · subagents 1/2 · coordinator: main');
  });
  it('a loose id equal to a plan task id shows the loose title and the coordinator liveness, not the plan task', () => {
    const m = base();
    const planTask = m.plan.tasks[0];
    m.states = { ...m.states, [planTask.id]: { ...(m.states[planTask.id] ?? {}), status: 'in_progress', exec: { leaseUntil: new Date(NOW + 5 * 60000).toISOString() } } as never };
    m.run = looseRun({
      slots: [{ task: planTask.id, stage: 'implement' as const, agent: 'forge-mech', by: 'main', since: new Date(NOW - 3 * 60000).toISOString() }],
      loose: [{ id: planTask.id, title: 'Loose namesake', status: 'running' as const, stage: 'implement' as const, agent: 'forge-mech' }],
    });
    m.sessions.main = { ...m.sessions.main, heartbeatAt: new Date(NOW - 40 * 60000).toISOString(), leaseUntil: new Date(NOW - 20 * 60000).toISOString() };
    const sv = renderApp(m, ui({ view: 'runs' }));
    const slot = sv.slice(sv.indexOf('<div class="sc slot"'), sv.indexOf('</h3>', sv.indexOf('<div class="sc slot"')));
    expect(slot).toContain('Loose namesake');
    expect(slot).not.toContain(planTask.title);
    expect(slot).toContain('live-stopped');
  });
  it('the runs view lists the loose tasks with status, stage, agent and the slot liveness dot', () => {
    const m = base();
    m.run = looseRun();
    m.sessions.main = { ...m.sessions.main, leaseUntil: new Date(NOW + 5 * 60000).toISOString() };
    const sec = looseSection(renderApp(m, ui({ view: 'runs' })));
    expect(sec).toContain('Tareas sueltas');
    expect(sec).toMatch(/live-alive[^]*fix-cart[^]*Fix the cart[^]*en curso · implementar · forge-mech/);
    expect(sec).toMatch(/docs-typo[^]*Typo in the README[^]*en cola/);
    expect(sec).toMatch(/bump[^]*Bump the version[^]*integrada · integrar/);
    m.sessions.main = { ...m.sessions.main, heartbeatAt: new Date(NOW - 40 * 60000).toISOString(), leaseUntil: new Date(NOW - 20 * 60000).toISOString() };
    expect(looseSection(renderApp(m, ui({ view: 'runs' })))).toContain('live-stopped');
    expect(looseSection(renderApp({ ...m, meta: { ...m.meta!, locale: 'en' } }, ui({ view: 'runs' })))).toMatch(/Loose tasks[^]*running · implement · forge-mech/);
    // Only while an ephemeral run is active.
    expect(looseSection(renderApp({ ...m, run: runDoc() }, ui({ view: 'runs' })))).toBe('');
    expect(looseSection(renderApp({ ...m, run: looseRun({ active: false }) }, ui({ view: 'runs' })))).toBe('');
  });
  it('a slot reads its time as a duration; an invalid or future since shows none', () => {
    const m = base();
    m.run = runDoc();
    // The first busy slot's markup (free slots are `sc slot free`).
    const slotOf = (html: string) => { const i = html.indexOf('class="sc slot"'); return html.slice(i, html.indexOf('</button>', i)); };
    expect(slotOf(renderApp(m, ui({ view: 'runs' })))).toContain('lleva 7 min');
    m.run = runDoc({ slots: [{ task: 'T002', stage: 'implement' as const, agent: null, by: 'main', since: new Date(NOW + 30 * 60000).toISOString() }] });
    const future = slotOf(renderApp(m, ui({ view: 'runs' })));
    expect(future).toContain('T002');
    expect(future).not.toContain('lleva');
    expect(future).not.toContain('hace');
    m.run = runDoc({ slots: [{ task: 'T002', stage: 'implement' as const, agent: null, by: 'main', since: 'garbage' }] });
    const junk = slotOf(renderApp(m, ui({ view: 'runs' })));
    expect(junk).toContain('T002');
    expect(junk).not.toContain('lleva');
    expect(junk).not.toContain('NaN');
    expect(junk).not.toContain('hace');
  });
  it('a finished loose task shows how long it took when meta/run carries it', () => {
    const m = base();
    m.run = looseRun({ loose: [
      { id: 'bump', title: 'Bump the version', status: 'integrated' as const, stage: 'integrate' as const, agent: null, seconds: 1320 },
      { id: 'fix-cart', title: 'Fix the cart', status: 'running' as const, stage: 'implement' as const, agent: 'forge-mech', seconds: 999 },
    ] });
    const sec = looseSection(renderApp(m, ui({ view: 'runs' })));
    expect(sec).toMatch(/bump[^]*integrada · integrar · tardó 22 min/);
    expect(sec).not.toContain('tardó 16 min');
  });
  it('a loose task under a minute shows <1 min, in both languages', () => {
    const m = base();
    m.run = looseRun({ loose: [{ id: 'bump', title: 'Bump', status: 'integrated' as const, stage: 'integrate' as const, agent: null, seconds: 20 }] });
    const es = looseSection(renderApp(m, ui({ view: 'runs' })));
    expect(es).toContain('tardó &lt;1 min');
    expect(es).not.toContain('0 min');
    const en = { ...m, meta: { ...m.meta!, locale: 'en' } };
    expect(looseSection(renderApp(en, ui({ view: 'runs' })))).toContain('took &lt;1 min');
  });
  it('the task detail exec line shows no time for a future or invalid since', () => {
    const mk = (since: string) => {
      const m = base();
      m.states.T002 = { status: 'in_progress', owner: 'main', exec: { runId: 'r1', mode: 'subagents', by: 'main', agent: 'forge-impl-heavy', stage: 'implement', round: 1, since, leaseUntil: new Date(NOW + 5 * 60000).toISOString() } };
      return renderApp(m, ui({ modal: 'T002' }));
    };
    const execOf = (html: string) => { const i = html.indexOf('class="mono exec"'); return html.slice(i, html.indexOf('</div>', i)); };
    expect(execOf(mk(new Date(NOW - 7 * 60000).toISOString()))).toContain('lleva 7 min');
    for (const bad of [new Date(NOW + 30 * 60000).toISOString(), 'garbage']) {
      const line = execOf(mk(bad));
      expect(line).toContain('forge-impl-heavy');
      expect(line).not.toContain('lleva');
      expect(line).not.toContain('hace');
      expect(line).not.toContain('NaN');
    }
  });
  it('loose tasks do not count in the plan progress, filters or timeline, and never show as orphaned', () => {
    const m = base();
    const progress = (h: string) => h.match(/<b>\d+<\/b>\/\d+ (tareas|tasks)/)![0];
    const percent = (h: string) => h.match(/\d+ %/)![0];
    const before = renderApp(m, ui());
    m.run = looseRun();
    m.sessions.main = { ...m.sessions.main, heartbeatAt: new Date(NOW - 40 * 60000).toISOString(), leaseUntil: new Date(NOW - 20 * 60000).toISOString() };
    const after = renderApp(m, ui());
    expect(progress(after)).toBe(progress(before));
    expect(percent(after)).toBe(percent(before));
    const schedule = renderApp(m, ui({ view: 'schedule', expanded: new Set(['F1', 'F2']) }));
    expect(schedule).not.toContain('data-task="fix-cart"');
    expect(schedule).not.toContain('data-id="fix-cart"');
    expect(schedule).not.toContain('Sin ejecutor');
    expect(timelineSvg(m, ui())).not.toContain('fix-cart');
    expect(renderApp(m, ui({ view: 'plan' }))).not.toContain('fix-cart');
    expect(renderApp(m, ui({ view: 'schedule', statuses: ['in_progress'] }))).not.toContain('data-task="fix-cart"');
  });
  it('escapes everything a loose task carries', () => {
    const m = base();
    m.run = looseRun({
      coordinator: HOSTILE,
      slots: [{ task: 'fix-cart', stage: 'implement', agent: HOSTILE, by: 'main', since: new Date(NOW - 60000).toISOString() }],
      loose: [{ id: 'fix-cart', title: HOSTILE, status: 'running', stage: 'implement', agent: HOSTILE }],
    });
    for (const view of ['summary', 'runs'] as const) {
      const html = renderApp(m, ui({ view }));
      expect(html).not.toContain('<img src=x');
    }
    for (const view of ['summary', 'runs'] as const) {
      expect(renderApp(m, ui({ view }))).toContain('&lt;img src=x onerror=alert(1)&gt;');
    }
  });
  it('run pill: active, then silent and stopped by the coordinator lease', () => {
    const m = base();
    m.run = runDoc();
    m.sessions.main = { ...m.sessions.main, leaseUntil: new Date(NOW + 5 * 60000).toISOString() };
    expect(renderApp(m, ui())).toContain('▶ ejecución · subagentes 1/3');
    m.sessions.main = { ...m.sessions.main, heartbeatAt: new Date(NOW - 40 * 60000).toISOString(), leaseUntil: new Date(NOW - 2 * 60000).toISOString() };
    expect(renderApp(m, ui())).toMatch(/sin señal desde \d\d:\d\d/);
    m.sessions.main = { ...m.sessions.main, heartbeatAt: new Date(NOW - 40 * 60000).toISOString(), leaseUntil: new Date(NOW - 20 * 60000).toISOString() };
    expect(renderApp(m, ui())).toMatch(/parada desde \d\d:\d\d/);
  });
  it('the runs view has the run block with slots and free places; session cards show role and stopped state', () => {
    const m = base();
    m.run = runDoc();
    m.sessions.main = { ...m.sessions.main, role: 'coordinator', heartbeatAt: new Date(NOW - 40 * 60000).toISOString(), leaseUntil: new Date(NOW - 20 * 60000).toISOString() };
    const runs = renderApp(m, ui({ view: 'runs' }));
    expect(runs).toContain('1/3 plazas');
    expect(runs).toContain('libre');
    const sessions = renderApp(m, ui({ view: 'sessions' }));
    expect(sessions).toContain('coordinadora');
    expect(sessions).toMatch(/parada · última señal \d\d:\d\d/);
    expect(sessions).not.toContain('exec-sec');
  });
  it('a task whose executor lease stopped is drawn as orphaned, not in progress', () => {
    const m = base();
    m.states.T002 = { status: 'in_progress', owner: 'main', exec: { runId: 'r1', mode: 'subagents', by: 'main', agent: 'forge-impl-heavy', stage: 'implement', round: 1, since: new Date(NOW - 30 * 60000).toISOString(), leaseUntil: new Date(NOW - 20 * 60000).toISOString() } };
    const html = renderApp(m, ui());
    expect(html).toContain('orphan');
    expect(html).toContain('Sin ejecutor');
    // G-19: a task the plan dropped is «Retirada del plan», never «Sin ejecutor».
    const dropped = renderApp({ ...base(), states: { ...base().states, T003: { status: 'orphaned' } } }, ui({ view: 'plan' }));
    expect(dropped).toContain('Retirada del plan');
  });
  it('speaks English with an English plan', () => {
    const m = { ...base(), meta: { ...base().meta!, locale: 'en' }, run: runDoc() };
    expect(renderApp(m, ui({ view: 'runs' }))).toContain('▶ execution · subagents 1/3');
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
  it('a screenshot reaches <img> and the lightbox only from https or the roadmap’s own store, whatever the model holds (carry 8)', () => {
    const m = base();
    const urls = ['javascript:alert(1)', 'http://x.io/a.png', 'data:image/svg+xml,<svg onload=alert(1)>', ' https://x.io/b.png', 'https://claude.ai/_blob/ok', '/_blob/abc-1'];
    m.states.T001 = { ...m.states.T001!, evidence: { surfaces: ['web'], result: 'fail', passed: 0, total: urls.length, shots: urls.map((url, i) => ({ url, surface: 'web', check: `c${i}`, ok: false })) } };
    const html = renderApp(m, { ...ui(), modal: 'T001' });
    expect([...html.matchAll(/<img src="([^"]*)"/g)].map(x => x[1])).toEqual(['https://claude.ai/_blob/ok', '/_blob/abc-1']);
    expect(html.match(/data-action="open-shot"/g)).toHaveLength(2);
    for (const i of [0, 1, 2, 3]) expect(renderApp(m, { ...ui(), modal: 'T001', shot: i })).not.toContain('class="lightbox"');
    expect(renderApp(m, { ...ui(), modal: 'T001', shot: 4 })).toContain('<img src="https://claude.ai/_blob/ok"');
  });
  it('renders no lightbox for an out-of-range shot', () => {
    const m = base();
    m.states.T001 = { ...m.states.T001!, evidence: { surfaces: ['web'], result: 'pass', passed: 1, total: 1, shots: [{ url: 'https://claude.ai/_blob/b', surface: 'web', check: 'c', ok: true }] } };
    expect(renderApp(m, { ...ui(), modal: 'T001', shot: 99 })).not.toContain('class="lightbox"');
  });
  it('marks tasks with evidence in the tracking cards', () => {
    const m = base();
    m.states.T001 = { ...m.states.T001!, evidence: { surfaces: ['web'], result: 'fail', passed: 0, total: 1, shots: [] } };
    expect(renderApp(m, ui({ view: 'schedule', expanded: new Set(['F1', 'F2']) }))).toContain('class="evi del"');
    expect(renderApp(m, ui({ view: 'plan' }))).toContain('class="evi del"');
  });
});

describe('track help', () => {
  it('explains what a track is where the roadmap names them', () => {
    const html = renderApp(base(), ui());
    expect(html).toContain('title="Frente: línea de trabajo que avanza en paralelo, con su propia sesión, worktree y rama"');
    const versions = renderApp(base(), ui({ view: 'plan' }));
    expect(versions).toContain('class="f trk" title="Frente: línea de trabajo');
  });
});

describe('scroll keys and relative times (G-01)', () => {
  const keys = (html: string) => [...html.matchAll(/data-scroll-key="([^"]+)"/g)].map(x => x[1]);
  it('every view renders unique scroll keys, and the modal overlay is keyed by its task', () => {
    const m = { ...base(), proposals: [P(), P({ id: 'p2' })] };
    for (const view of VIEWS) {
      const k = keys(renderApp(m, ui({ view, modal: 'T002' })));
      expect(new Set(k).size, view).toBe(k.length);
    }
    const schedule = keys(renderApp(m, ui({ view: 'schedule', modal: 'T002' })));
    for (const k of ['side', 'timeline', 'chips:status', 'chips:layers', 'zoom', 'chain', 'modal:T002']) expect(schedule).toContain(k);
    expect(keys(renderApp(m, ui({ view: 'plan' })))).toContain('vcols');
    expect(keys(renderApp(m, ui({ view: 'talk', talk: 'proposals' })))).toEqual(expect.arrayContaining(['evid:p1', 'evid:p2']));
  });
  it('relText is what the tick writes, and rel marks the text with its kind and time', () => {
    const d = dictFor('es');
    expect(relText(d, 'ago', new Date(NOW - 5 * 60000).toISOString(), NOW)).toBe('hace 5 min');
    expect(relText(d, 'lasts', new Date(NOW - 7 * 60000).toISOString(), NOW)).toBe('lleva 7 min');
    expect(relText(d, 'hb', 'garbage', NOW)).toBe('—');
    expect(relText(d, 'lasts', new Date(NOW + 30 * 60000).toISOString(), NOW)).toBe('');
    expect(renderApp(base(), ui())).toContain('<span data-rel="hb" data-ts="2026-10-11T11:59:00Z">hace 1 min</span>');
  });
  it('the modal has no ↻: it repaints live (H-06)', () => {
    const html = renderApp(base(), ui({ modal: 'T002' }));
    expect(html).not.toContain('data-action="refresh"');
    expect(html).not.toContain('↻');
  });
  it('the rows of the timeline carry stable keys, and the arrows drawn by hand are left alone (H-06)', () => {
    const html = renderApp(base(), ui({ view: 'schedule', expanded: new Set(['F1']) }));
    expect(html).toContain('data-k="p:F1"');
    expect(html).toContain('data-k="t:T001"');
    expect(html).toContain('<svg class="arrows" data-role="tl-arrows" data-morph="skip" aria-hidden="true"></svg>');
  });
  it('note and proposal cards carry their keys, escaped, so a morph never hands one card\'s focus to another (H-06)', () => {
    const m = { ...base(), notes: [{ id: 'n"1', ts: '2026-10-11T10:00:00Z', type: 'idea' as const, author: 'session:main', text: 'x' }], proposals: [P({ id: 'p<1' })] };
    expect(renderApp(m, ui({ view: 'talk' }))).toContain('<div class="note nb-idea" data-k="n:n&quot;1">');
    expect(renderApp(m, ui({ view: 'talk', talk: 'proposals' }))).toContain('<div class="note prop pr-low" data-id="p&lt;1" data-k="pr:p&lt;1">');
  });
});

describe('theme.css: the modal, the side bar and the detail (H-01, H-11, §4.7)', () => {
  const phone = cssMedia(CSS, '(max-width:760px)');
  const zIndex = (rule: string) => Number(/z-index:(\d+)/.exec(rule)?.[1] ?? NaN);
  it('the modal sits above the sticky side bar, its header sticks and the page does not scroll under it (H-01)', () => {
    expect(zIndex(cssRule(CSS, '.overlay'))).toBeGreaterThan(zIndex(cssRule(phone, '.side')));
    expect(cssRule(CSS, '.overlay')).toContain('overscroll-behavior:contain');
    expect(cssRule(CSS, '.mh')).toMatch(/position:sticky;top:0/);
    expect(cssRule(phone, '.mh')).toContain('margin:-14px -14px 0');
    expect(cssRule(CSS, 'html.wp-modal')).toContain('overflow:hidden');
    expect(cssRule(CSS, 'html.wp-modal body')).toContain('overflow:hidden');
  });
  it('the side bar sticks at window height on a desktop and is a tab bar at the bottom on a phone (H-11, H-22)', () => {
    const side = cssRule(CSS, '.side');
    for (const d of ['position:sticky', 'top:0', 'align-self:start', 'height:calc(100dvh / var(--z,1))', 'overflow-y:auto']) expect(side).toContain(d);
    for (const d of ['height:auto', 'overflow-y:visible', 'align-self:auto']) expect(cssRule(phone, '.side')).toContain(d);
    for (const d of ['position:fixed', 'bottom:0', 'top:auto']) expect(cssRule(phone, '.side'), d).toContain(d);
    expect(cssRule(phone, '.nav .nl')).toContain('display:none');
    expect(cssRule(phone, '.nav .ns')).toContain('display:block');
    expect(cssRule(phone, '.main')).toContain('padding:12px 12px calc(68px + env(safe-area-inset-bottom))');
    expect(cssRule(CSS, '.strip')).toMatch(/position:sticky;top:0/);
  });
  it('the detail is full screen up to 760 px and its panels can shrink below their content (§4.7)', () => {
    expect(cssRule(phone, '.modal')).toContain('min-height:100dvh');
    expect(cssRule(phone, '.overlay')).toContain('padding:0');
    expect(cssRule(CSS, '.dpanel')).toContain('min-width:0;overflow-wrap:anywhere');
    expect(CSS).not.toContain('.mgrid');
  });
});

describe('validators without a result and ?debug=1 (H-04)', () => {
  it('a validator without a result is drawn neutral', () => {
    const m = base();
    m.states.T002 = { ...m.states.T002!, forge: { path: 'medium', phase: 'review', validators: [{ name: 'test', ok: null }, { name: 'lint', ok: true }] } };
    const html = renderApp(m, ui({ modal: 'T002' }));
    expect(html).toContain('<span class="muted" title="sin resultado">test ·</span>');
    expect(html).toContain('<span class="ok">lint ✓</span>');
  });
  it('with debug the page lists what was dropped or coerced, escaped; without it, nothing', () => {
    const m = { ...base(), debug: true, dropped: { state: [{ doc: 'state/T1', field: 'forge.validators[0]', action: 'coerced' as const, detail: 'string' }] } };
    const html = renderApp(m, ui());
    expect(html).toContain('<details class="dbg" open><summary>debug · 1</summary>');
    expect(html).toContain('state/T1 · forge.validators[0] · coerced · string');
    expect(renderApp(base(), ui())).not.toContain('class="dbg"');
    const evil = { ...m, dropped: { state: [{ doc: 'state/<b>', field: 'x', action: 'dropped' as const, detail: '<img src=x>' }] } };
    expect(renderApp(evil, ui())).not.toContain('<img src=x>');
  });
});

describe('the execution of the runs view (H-10)', () => {
  it('is an exec-sec section; plan slots open their task, loose slots do not', () => {
    const m = base();
    m.run = runDoc();
    const sv = renderApp(m, ui({ view: 'runs' }));
    expect(sv).toContain('<section class="exec-sec">');
    expect(sv).not.toContain('<section class="run"');
    expect(sv).toContain('<button type="button" class="sc slot" data-action="open-task" data-id="T002" data-k="slot:T002">');
    m.run = looseRun();
    expect(renderApp(m, ui({ view: 'runs' }))).not.toMatch(/class="sc slot" data-action/);
  });
  it('theme.css has no .runs and no bare .run, and makes plan slots clickable (H-07, H-10)', () => {
    expect(CSS).not.toMatch(/(^|[\s,}])\.run[{:\s]/);
    expect(CSS).not.toContain('.runs');
    expect(cssRule(CSS, '.exec-sec .slot[data-action]')).toContain('cursor:pointer');
    expect(cssRule(CSS, '.seg')).toContain('display:flex');
    expect(CSS).not.toContain('.pips');
  });
});

describe('timeline phases, labels, ticks and minimap (G-21, H-13, H-12, G-22, H-03)', () => {
  const rowOf = (html: string, id: string) => {
    const at = html.indexOf(`<div class="rr" data-task="${id}">`);
    const next = html.indexOf('<div class="rr', at + 5);
    return html.slice(at, next < 0 ? undefined : next);
  };
  it('a phase row shows its id once, the name apart, and the phase header sticks (G-21, H-13)', () => {
    const m = { ...base(), plan: { ...plan, phases: plan.phases.map(p => ({ ...p, name: `${p.id} · ${p.name}` })) } };
    const html = renderApp(m, ui({ view: 'schedule' }));
    expect(html).toContain('<span class="k">F1</span> <span class="pn">Base</span>');
    expect(html).not.toContain('F1 · F1');
    expect(cssRule(CSS, '.tr.ph')).toContain('text-transform:none');
    expect(cssRule(CSS, '.tr.ph .pn')).toContain('text-transform:uppercase');
    expect(cssRule(CSS, '.rr.ph')).toMatch(/position:sticky;top:26px/);
  });
  it('hides the tick next to now and pins the edge ticks to the edges (H-12)', () => {
    const html = renderApp(base(), ui({ view: 'schedule' }));
    const at = html.indexOf('<div class="ticks">');
    const spans = [...html.slice(at, html.indexOf('</div>', at)).matchAll(/<span(?: class="([^"]*)")? style="left:([\d.e-]+)%">/g)].map(x => ({ cls: x[1] ?? '', p: Number(x[2]) }));
    expect(spans.length).toBeGreaterThan(3);
    for (const s of spans) {
      expect(s.cls.includes('edge-l')).toBe(s.p < 3);
      expect(s.cls.includes('edge-r')).toBe(s.p > 97);
      // A 1d window puts now at 75 %.
      expect(s.cls.includes('near-now')).toBe(Math.abs(s.p - 75) < 6);
    }
  });
  it('a label of a bar that ended before now stops before the line, and under 4 points there is none (H-12)', () => {
    const m = base();
    const html = renderApp(m, ui({ view: 'schedule', expanded: new Set(['F1']) }));
    const gl = /<div class="gl" style="left:([\d.]+)%;max-width:([\d.]+)%">/.exec(rowOf(html, 'T001'))!;
    expect(Number(gl[1]) + Number(gl[2])).toBeLessThanOrEqual(75 - 0.6 + 0.05);
    m.states.T001 = { ...m.states.T001!, startedAt: '2026-10-11T11:00:00Z', doneAt: '2026-10-11T11:40:00Z' };
    expect(rowOf(renderApp(m, ui({ view: 'schedule', expanded: new Set(['F1']) })), 'T001')).not.toContain('class="gl"');
  });
  it('the forge badge sits in the left row; an estimated bar gets no label for it (H-12)', () => {
    const m = base();
    m.states.T003 = { status: 'free', forge: { path: 'medium', phase: 'review', verdict: { action: 'accept', score: 0.97 } } };
    const html = renderApp(m, ui({ view: 'schedule', expanded: new Set(['F1']), layers: ['forge'] }));
    const at = html.indexOf('<button type="button" class="tr tk" data-action="open-task" data-id="T003"');
    expect(html.slice(at, html.indexOf('</button>', at))).toContain('class="fg ok"');
    expect(rowOf(html, 'T003')).not.toContain('class="gl"');
    expect(rowOf(html, 'T003')).not.toContain('class="fg');
    for (const [sel, decl] of [['.tl', 'grid-template-columns:clamp(150px,28%,340px) minmax(0,1fr)'], ['.ticks span.edge-l', 'transform:none'],
      ['.ticks span.edge-r', 'transform:translateX(-100%)'], ['.ticks span.near-now', 'visibility:hidden'], ['.gl', 'text-overflow:ellipsis'], ['.tr .fg', 'margin-left:auto']]) {
      expect(cssRule(CSS, sel), sel).toContain(decl);
    }
  });
  it('the minimap draws one row per phase, or per track past 24 phases, in a 48-high box (G-22, H-03)', () => {
    const big = (nPhases: number, nTasks: number) => ({
      ...plan,
      versions: [],
      phases: Array.from({ length: nPhases }, (_, i) => ({ ...plan.phases[0]!, id: `P${i + 1}`, name: `Phase ${i + 1}` })),
      tasks: Array.from({ length: nTasks }, (_, i) => ({ ...plan.tasks[0]!, id: `T${String(i + 1).padStart(3, '0')}`, title: `t${i}`, phase: `P${(i % nPhases) + 1}`, depends_on: [] })),
    });
    const mm = (html: string) => html.slice(html.indexOf('<div class="mm"'), html.indexOf('</svg>', html.indexOf('<div class="mm"')));
    const fifteen = mm(renderApp({ ...base(), plan: big(15, 343), states: {} }, ui({ view: 'schedule' })));
    expect(fifteen).toContain('data-group="phase" data-rows="15"');
    expect(fifteen).toContain('viewBox="0 0 1000 48"');
    expect(mm(renderApp({ ...base(), plan: big(30, 343), states: {} }, ui({ view: 'schedule' })))).toContain(`data-group="track" data-rows="${plan.tracks.length}"`);
    // A single phase is one thin bar, not a 35px slab in the 48px box.
    const one = mm(renderApp({ ...base(), plan: big(1, 5), states: {} }, ui({ view: 'schedule' })));
    const heights = [...one.matchAll(/class="mb [^"]*"[^>]*height="([\d.]+)"/g)].map(x => Number(x[1]));
    expect(heights.length).toBeGreaterThan(0);
    for (const hh of heights) expect(hh).toBeLessThanOrEqual(6.4 + 1e-9);
  });
});

describe('the status strip (§4.6, H-22, G-08, G-11, G-14, G-25)', () => {
  const strip = (html: string) => { const at = html.indexOf('<div class="strip">'); return html.slice(at, html.indexOf('</div>', at)); };

  it('one run pill and one ∞ pill in the whole page, both in the strip (H-22)', () => {
    const inf = { active: true, cycle: 0, budget: {}, startedAt: '2026-10-11T09:00:00Z', lastCycleAt: null };
    const m = { ...base(), infinite: inf, run: runDoc() };
    m.sessions.main = { ...m.sessions.main, leaseUntil: new Date(NOW + 5 * 60000).toISOString() };
    for (const view of VIEWS) {
      const html = renderApp(m, ui({ view }));
      expect(html.match(/class="pill run/g), view).toHaveLength(1);
      expect(html.match(/class="pill inf/g), view).toHaveLength(1);
      expect(strip(html)).toContain('class="pill run');
    }
  });

  it('shows the percent of the current version, not the plan’s (G-11)', () => {
    const m = { ...base(), plan: { ...plan, versions: [{ id: '0.1', phases: ['F1'] }, { id: '0.2', phases: ['F2'] }] } };
    const s = strip(renderApp(m, ui()));
    expect(s).toMatch(/<span class="sv" title="Versión 0\.1: 1 de 3 tareas hechas">v0\.1 · 33 %<\/span>/);
    expect(s).not.toContain('17 %');
    expect(strip(renderApp({ ...base(), plan: { ...plan, versions: [] } }, ui()))).toContain('<span class="sv">17 %</span>');
  });

  it('the ∞ pill reads its coordinator’s lease: silent, stopped, and gone 24 h after it (G-08)', () => {
    const inf = (leaseMin: number) => ({ active: true, cycle: 1, budget: {}, startedAt: '2026-10-11T09:00:00Z', lastCycleAt: null,
      coordinator: { sid: 'main', claude: 'c1', seenAt: new Date(NOW - 20 * 60000).toISOString(), leaseUntil: new Date(NOW + leaseMin * 60000).toISOString() } });
    expect(renderApp({ ...base(), infinite: inf(5) }, ui())).toContain('<span class="pill inf">∞ ciclo 2</span>');
    expect(renderApp({ ...base(), infinite: inf(-2) }, ui())).toMatch(/<span class="pill inf warn">∞ ciclo 2 · sin señal desde \d\d:\d\d<\/span>/);
    expect(renderApp({ ...base(), infinite: inf(-20) }, ui())).toMatch(/<span class="pill inf stopped">∞ ciclo 2 · parada desde \d\d:\d\d<\/span>/);
    expect(renderApp({ ...base(), infinite: inf(-25 * 60) }, ui())).not.toContain('∞');
    // Carry 7: one rule with «Te necesita» and the runs view: shown while less than 24 h passed, gone at 24 h.
    expect(renderApp({ ...base(), infinite: inf(-24 * 60 + 1) }, ui())).toContain('pill inf stopped');
    expect(renderApp({ ...base(), infinite: inf(-24 * 60) }, ui())).not.toContain('∞');
  });

  it('says when the snapshot states were listed until the database answers, then when state synced (G-14)', () => {
    const snap = strip(renderApp({ ...base(), connecting: true, statesAt: '2026-10-11T09:45:00Z', syncedAt: null }, ui()));
    expect(snap).toContain('Conectando');
    expect(snap).toContain('instantánea de');
    expect(strip(renderApp({ ...base(), offline: true, statesAt: '2026-10-11T09:45:00Z' }, ui()))).toMatch(/Sin conexión[^]*instantánea de/);
    const live = strip(renderApp({ ...base(), statesAt: null, syncedAt: NOW - 2 * 60000 }, ui()));
    expect(live).toContain('sincronizado <span data-rel="ago"');
    expect(live).toContain('hace 2 min');
    expect(live).not.toContain('instantánea');
  });

  it('links the design when the plan has one, escaped (G-25)', () => {
    const meta = { ...base().meta!, links: { design: 'https://claude.ai/artifact/abc?x="1"', designVersion: 7 } };
    expect(strip(renderApp({ ...base(), meta }, ui()))).toContain('<a class="sdl" href="https://claude.ai/artifact/abc?x=&quot;1&quot;" target="_blank" rel="noopener noreferrer">Diseño v7</a>');
    expect(strip(renderApp(base(), ui()))).not.toContain('class="sdl"');
    // The normalizer keeps only https links; the strip checks it again.
    const evil = { ...base().meta!, links: { design: 'javascript:alert(1)', designVersion: 7 } };
    expect(strip(renderApp({ ...base(), meta: evil }, ui()))).not.toContain('javascript:');
  });
});

describe('the summary (§4.6.1, §4.6.2)', () => {
  const v2 = (over: object = {}) => ({
    v: 2 as const, path: 'medium' as const, phase: 'review', agent: 'forge-impl', round: 2, cap: 4, brief: 1, stage: 'review' as const,
    validators: [{ name: 'test', ok: true }, { name: 'lint', ok: true }, { name: 'e2e', ok: true, flaky: true as const }, { name: 'types', ok: false }],
    rounds: [], verify: null, stages: {}, integration: null, deferred: [], acceptedRound: null, overCap: false, updatedAt: '2026-10-11T11:50:00.000Z', ...over,
  });
  const exec = (stage: string, over: object = {}) => ({ runId: 'r1', mode: 'subagents' as const, by: 'main', agent: 'forge-impl-heavy', stage: stage as never, round: 1,
    since: new Date(NOW - 7 * 60000).toISOString(), leaseUntil: new Date(NOW + 5 * 60000).toISOString(), ...over });
  const running = (): Model => {
    const m = base();
    m.run = runDoc({ slots: [] });
    m.states = {
      T001: m.states.T001!,
      T002: { status: 'in_progress', owner: 'main', startedAt: new Date(NOW - 65 * 60000).toISOString(), exec: exec('verify'), forge: v2() },
      T003: { status: 'in_progress', owner: 'main', startedAt: new Date(NOW - 30 * 60000).toISOString(), exec: exec('implement'), forge: v2({ overCap: true, round: 5 }) },
      T004: { status: 'in_progress', owner: 'main', startedAt: new Date(NOW - 10 * 60000).toISOString(), exec: exec('review') },
    };
    return m;
  };
  const section = (html: string, cls: string) => { const at = html.indexOf(`<section class="${cls}`); return at < 0 ? '' : html.slice(at, html.indexOf('</section>', at)); };

  it('«En curso» has one row per task under a single header of the run, each with stage, round, validators, time and agent (H-08)', () => {
    const now = section(renderApp(running(), ui()), 'card now');
    expect(now.match(/<button type="button" class="nr/g)).toHaveLength(3);
    expect(now.match(/class="rh"/g)).toHaveLength(1);
    expect(now).toContain('Ejecución r1 · subagentes · 0/3 plazas · coordinadora main · rama forge/run-demo-shop');
    // By stage: implement, verify, review.
    expect([...now.matchAll(/data-k="t:(T\d+)"/g)].map(x => x[1])).toEqual(['T003', 'T002', 'T004']);
    expect(now).toContain('r2/4 · brief 1');
    expect(now).toMatch(/<span class="del">r5\/4 · brief 1<\/span>/);
    expect(now).toContain('<span class="ok">✓2</span> <span class="del">✗1</span> <span class="warn">~1</span>');
    expect(now).toMatch(/<span data-rel="dur" data-ts="[^"]+">7 min<\/span> · <span data-rel="dur" data-ts="[^"]+">1 h 05 min<\/span>/);
    expect(now).toContain('forge-impl-heavy');
    expect(now).toContain('implementar');
    expect(now).not.toMatch(/overflow/);
  });

  it('the role comes from the session, or else from the run mode: subagents, sessions and manual (H-09)', () => {
    const m = running();
    m.states.T002 = { ...m.states.T002!, exec: exec('verify', { mode: 'sessions', by: 'be' }) };
    m.states.T003 = { ...m.states.T003!, exec: exec('implement', { mode: 'manual', by: 'ana' }) };
    const now = section(renderApp(m, ui()), 'card now');
    expect(now).toContain('ejecutora · be');
    expect(now).toContain('manual · ana');
    expect(now).toContain('coordinadora · main');
    m.sessions.be = { name: 'be', heartbeatAt: new Date(NOW).toISOString(), status: 'active', role: 'manual' };
    expect(section(renderApp(m, ui()), 'card now')).toContain('manual · be');
    expect(renderApp(m, ui({ modal: 'T002' }))).toMatch(/class="mono exec">[^]*manual · sesiones/);
  });

  it('a task claimed by a session without forge shows dashes for the stage and the round; old forge blocks still read (Review Focus 1)', () => {
    const m = base();
    m.states.T002 = { status: 'claimed', owner: 'main', claimedAt: new Date(NOW - 5 * 60000).toISOString() };
    m.states.T003 = { status: 'in_progress', owner: 'main', forge: { path: 'medium', phase: 'review', validators: [{ name: 'test', ok: true }, { name: 'lint', ok: null }], round: 2, cap: 4 } };
    const now = section(renderApp(m, ui()), 'card now');
    expect(now.match(/<button type="button" class="nr/g)).toHaveLength(2);
    expect(now).not.toContain('class="rh"');
    expect(now).toContain('r2/4');
    expect(now).not.toContain('brief');
    expect(now).toContain('<span class="ok">✓1</span> <span class="del">✗0</span>');
    expect(now).toMatch(/c-stage"><span class="dot live-\w+">●<\/span> —/);
  });

  it('with nothing running it says which free task is next; «Siguiente» lists the first five free ones (H-24)', () => {
    const m = base();
    m.states = { T001: m.states.T001! };
    const html = renderApp(m, ui());
    expect(section(html, 'card now')).toContain('Nada en curso. La siguiente libre es T002 · API de pedidos');
    expect([...section(html, 'card next').matchAll(/data-k="nx:(T\d+)"/g)].map(x => x[1])).toEqual(['T002', 'T003']);
    const all = { ...base(), states: Object.fromEntries(plan.tasks.map(t => [t.id, { status: 'done' as const }])) };
    expect(section(renderApp(all, ui()), 'card now')).toContain('Nada en curso.');
    expect(renderApp(all, ui())).not.toContain('class="card next"');
  });

  it('the loose tasks of an ephemeral run that are running show under its header, without a button', () => {
    const m = base();
    m.states = { T001: m.states.T001! };
    m.run = looseRun();
    const now = section(renderApp(m, ui()), 'card now');
    expect(now).toContain('Tareas sueltas loose-1 · subagentes · 1/2 plazas · coordinadora main');
    expect(now).toContain('<div class="nr lt">');
    expect(now).toContain('Fix the cart');
    expect(now).not.toContain('Typo in the README');
    expect(now).not.toContain('data-id="fix-cart"');
  });

  it('the header names the version in progress as the strip and the progress do, and the plan’s own version apart, labelled (carry 10e)', () => {
    const header = (html: string) => html.slice(html.indexOf('<header class="hd">'), html.indexOf('</header>'));
    const m = { ...base(), meta: { ...base().meta!, version: '0.3' }, plan: { ...plan, versions: [{ id: '0.1', phases: ['F1'] }, { id: '0.2', phases: ['F2'] }] } };
    const html = renderApp(m, ui());
    expect(header(html)).toContain('Versión en curso <b>v0.1</b> · versión del plan <b>0.3</b>');
    expect(html.slice(html.indexOf('<div class="strip">'), html.indexOf('<header'))).toContain('>v0.1 · 33 %</span>');
    expect(section(html, 'card prog')).toContain('<div class="big">v0.1 · 33 %</div>');
    // The same version: said once.
    expect(header(renderApp({ ...m, meta: { ...m.meta, version: 'v0.1' } }, ui()))).toMatch(/Versión en curso <b>v0\.1<\/b> · Fase/);
    // Without versions there is no version in progress: the plan's own, as before.
    const none = header(renderApp({ ...base(), plan: { ...plan, versions: [] } }, ui()));
    expect(none).toContain('Versión <b>0.1</b>');
    expect(none).not.toContain('en curso');
    const en = header(renderApp({ ...m, meta: { ...m.meta, locale: 'en' } }, ui()));
    expect(en).toContain('Version in progress <b>v0.1</b> · plan version <b>0.3</b>');
  });

  it('the progress shows the current version, a table of versions and one segment per phase (G-11, H-27)', () => {
    const m = { ...base(), plan: { ...plan, versions: [{ id: '0.1', phases: ['F1'] }, { id: '0.2', phases: ['F2'] }] } };
    const prog = section(renderApp(m, ui()), 'card prog');
    expect(prog).toContain('<div class="big">v0.1 · 33 %</div>');
    expect(prog).toContain('<tr class="cur"><td>0.1</td><td>1/3</td><td>33 %</td></tr>');
    expect(prog).toContain('<tr><td>0.2</td><td>0/3</td><td>0 %</td></tr>');
    expect(prog.match(/class="phseg/g)).toHaveLength(2);
    expect(prog).toMatch(/class="phseg ph-in_progress cur"[^>]*><i style="width:33%"><\/i><b>F1<\/b> 33 %/);
    expect(prog).toContain('Fin previsto');
  });

  it('the recent activity: two lines, the time with the date when it is not today, the full text in its title (H-21)', () => {
    const long = 'x'.repeat(300);
    const m = { ...base(), events: [
      // At now exactly, so it is today in any time zone; the other is more than a day before.
      { id: 'e1', ts: '2026-10-11T12:00:00Z', type: 'done' as const, sessionId: 'main', taskId: 'T001', text: 'hoy', add: 3, del: 1 },
      { id: 'e2', ts: '2026-10-10T09:15:00Z', type: 'note' as const, sessionId: 'ui', text: long },
    ] };
    const recent = section(renderApp(m, ui()), 'card recent');
    expect(recent).toContain('<button type="button" class="act" data-action="open-task" data-id="T001" data-k="e:e1">');
    expect(recent).toContain(`<span class="tx" title="${long}">${long}</span>`);
    const times = [...recent.matchAll(/<span class="mono t">([^<]*)<\/span>/g)].map(x => x[1]!);
    expect(times[0]).toMatch(/^\d\d:\d\d$/);
    expect(times[1]).toMatch(/10/);
    expect(times[1]!.length).toBeGreaterThan(5);
    expect(recent).toContain('<span class="nums"><span class="ok">+3</span><span class="del">−1</span></span>');
    expect(recent).toContain('<div class="act">');
    expect(renderApp({ ...base(), events: [], messages: [], notes: [] }, ui())).not.toContain('class="card recent"');
  });

  it('only the live sessions, and «+N inactivas» that leads to Sesiones (G-04)', () => {
    const m = base();
    m.sessions = { a: { name: 'a', heartbeatAt: new Date(NOW).toISOString(), leaseUntil: new Date(NOW + 9 * 60000).toISOString(), status: 'active' },
      b: { name: 'b', heartbeatAt: new Date(NOW).toISOString(), leaseUntil: new Date(NOW + 9 * 60000).toISOString(), status: 'active' } };
    for (let i = 0; i < 29; i++) m.sessions[`old${i}`] = { name: `old${i}`, heartbeatAt: '2026-10-01T10:00:00Z', status: 'active' };
    const sess = section(renderApp(m, ui()), 'sess');
    expect(sess.match(/<div class="s /g)).toHaveLength(2);
    expect(sess).toContain('<button type="button" class="more" data-action="view" data-view="sessions">+29 inactivas</button>');
    expect(renderApp({ ...m, sessions: {} }, ui())).not.toContain('<section class="sess"');
  });

  it('escapes what the rows carry (Review Focus 5)', () => {
    const m = running();
    m.plan = { ...m.plan, tasks: m.plan.tasks.map(t => ({ ...t, title: HOSTILE })) };
    m.states.T002 = { ...m.states.T002!, exec: exec('verify', { agent: HOSTILE, by: HOSTILE }) };
    m.events = [{ id: 'h', ts: '2026-10-11T11:00:00Z', type: 'note', sessionId: HOSTILE, taskId: 'T001', text: HOSTILE }];
    m.sessions[HOSTILE] = { name: HOSTILE, heartbeatAt: new Date(NOW).toISOString(), leaseUntil: new Date(NOW + 60000).toISOString(), status: 'active' };
    clean(renderApp(m, ui()));
  });
});

describe('one scroll for the page and one for the timeline (H-07)', () => {
  it('no container of the summary scrolls on its own, and .runs and .vcols are not in it', () => {
    const html = renderApp({ ...base(), run: runDoc() }, ui());
    expect(html).not.toMatch(/overflow:\s*auto/);
    expect(html).not.toContain('class="runs"');
    expect(html).not.toContain('class="vcols"');
    expect(html).not.toContain('data-scroll-key="events"');
  });
  it('theme.css: the timeline contains only its horizontal overscroll; the lists have no scroll of their own', () => {
    const tlw = cssRule(CSS, '.tlw');
    expect(tlw).toContain('overscroll-behavior-x:contain');
    expect(tlw).not.toContain('overscroll-behavior-y');
    expect(tlw).not.toMatch(/overscroll-behavior:/);
    expect(tlw).toContain('dvh');
    for (const sel of ['.events', '.chain', '.zones']) expect(cssRule(CSS, sel), sel).not.toMatch(/max-height|overflow:auto/);
  });
  it('on a phone each row of «En curso» is a two-line card with grid areas, without the header', () => {
    const phone = cssMedia(CSS, '(max-width:760px)');
    expect(cssRule(phone, '.nr')).toContain('grid-template-areas');
    expect(cssRule(phone, '.nrh')).toContain('display:none');
  });
});

describe('«Te necesita» (G-24, G-13, G-08)', () => {
  const at = (min: number) => new Date(NOW + min * 60000).toISOString();
  const needs = (html: string) => { const i = html.indexOf('<section class="card needs"'); return i < 0 ? '' : html.slice(i, html.indexOf('</section>', i)); };
  const forgeDone = (merged: boolean) => ({ v: 2 as const, path: 'medium' as const, phase: 'done', validators: [], brief: 1, stage: 'done' as const, rounds: [], verify: null, stages: {},
    integration: { branch: 'forge/run-x', sha: 'abc1234', merged, target: 'main' }, deferred: [{ problem: 'no index' }], acceptedRound: 1, overCap: false, updatedAt: at(-60) });
  const everything = (): Model => {
    const m = base();
    m.isOwner = true;
    m.notes = [note({ id: 'q1', type: 'question', text: '¿A o B?', taskId: 'T003' }), note({ id: 'q2', type: 'question', text: 'cerrada por decisión', answeredByNote: 'd9' })];
    m.proposals = [P(), P({ id: 'p2', status: 'approved' }), P({ id: 'p3', status: 'approved', rationale: 'editada después' }), P({ id: 'p4', status: 'approved' })];
    // p3: the owner's mark is of the text before an edit (review I2); p4: the owner rejected it, someone approved it since
    // (re-review N1). Both are decisions that changed after the owner took them.
    m.approvals = {
      p3: { status: 'approved', decidedAt: at(-90), by: 'page', digest: proposalDigest('p3', P({ id: 'p3', status: 'approved' })) },
      p4: { status: 'rejected', decidedAt: at(-90), by: 'page', digest: proposalDigest('p4', P({ id: 'p4' })) },
    };
    m.messages = [msg({ id: 'm1', type: 'escalation', from: 'be', to: 'ui', text: 'decide el esquema' })];
    m.states = { ...m.states, T001: { status: 'done', doneAt: at(-60), forge: forgeDone(false) }, T003: { status: 'blocked', blockedBy: ['external'], blockedReason: 'Espera las credenciales' } };
    m.run = { ...runDoc({ active: false, stopReason: 'stalled' }), lastStepAt: at(-30), stallReason: 'T2 sigue bloqueada' };
    m.infinite = { active: true, cycle: 1, budget: {}, startedAt: at(-300), lastCycleAt: null, coordinator: { sid: 'main', claude: 'c1', seenAt: at(-40), leaseUntil: at(-30) } };
    m.meta = { ...m.meta!, waypointVersion: '99.0.0' };
    return m;
  };

  it('each entry shows with its condition, in the order of the spec, and says what to do', () => {
    const s = needs(renderApp(everything(), ui()));
    expect(s).toContain('<h2 class="lbl" id="needs-h">Te necesita</h2>');
    expect(s).toContain('¿A o B?');
    expect(s).not.toContain('cerrada por decisión');
    expect(s).toContain('data-action="answer-open" data-id="q1"');
    expect(s).toContain('1 propuesta por decidir');
    expect(s).toContain('data-action="view" data-view="talk" data-c="proposals"');
    expect(s).toContain('1 aprobada sin tu marca: confírmala para que cuente');
    // Review I2, re-review N1: the decisions that changed after the owner took them are their own entry, not counted with
    // those without a mark.
    expect(s).toContain('2 propuestas cambiaron después de tu decisión: revisa el texto y decide');
    expect(s).toContain('be → ui');
    expect(s).toContain('Respóndelo en la sesión ui o con /waypoint:work');
    expect(s).toContain('Espera las credenciales');
    expect(s).toContain('Cuando esté resuelto, /waypoint:work T003 la desbloquea');
    expect(s).toContain('1 hallazgo aplazado en 1 tarea');
    expect(s).toContain('data-action="seen-deferred" data-ids="T001"');
    expect(s).toContain('La ejecución r1 se atascó: T2 sigue bloqueada');
    expect(s).toContain('Reanúdala con /forge:run o ciérrala con /forge:stop');
    expect(s).toMatch(/El modo infinito está sin coordinadora desde las \d\d:\d\d/);
    expect(s).toContain('Reanuda con /forge:infinite o para con /forge:stop');
    expect(s).toMatch(/Esta página es de waypoint \d+\.\d+\.\d+ y el plan se sincronizó con 99\.0\.0: republica con \/waypoint:plan/);
    expect([...s.matchAll(/class="need nd-([\w-]+)"/g)].map(x => x[1])).toEqual(['question', 'proposals', 'unowned', 'changed', 'escalation', 'external', 'deferred', 'stalled', 'infinite', 'stale-page']);
    const en = needs(renderApp({ ...everything(), meta: { ...everything().meta!, locale: 'en' } }, ui()));
    expect(en).toContain('Needs you');
    expect(en).toContain('1 deferred finding in 1 task');
    expect(en).toContain('2 proposals changed after your decision: review the text and decide');
    const one = needs(renderApp({ ...everything(), proposals: everything().proposals.slice(0, 3) }, ui()));
    expect(one).toContain('1 propuesta cambió después de tu decisión: revisa el texto y decide');
  });

  it('C3: the unmarked approvals use the shared predicate (a valid mark, a task, or no snapshot yet hide the entry)', () => {
    const ps = [P({ id: 'p2', status: 'approved' }), P({ id: 'p3', status: 'approved' }), P({ id: 'p4', status: 'approved', taskId: 'T002' })];
    const mark = { status: 'approved' as const, decidedAt: '2026-10-11T10:00:00.000Z', by: 'page' as const, digest: proposalDigest('p3', ps[1]!) };
    const shown = (over: Partial<Model>) => needs(renderApp({ ...base(), isOwner: true, proposals: ps, ...over }, ui()));
    // p2 has no mark, p3 a good one, p4 already has a task: only p2 counts.
    expect(shown({ approvals: { p3: mark } })).toContain('1 aprobada sin tu marca');
    expect(shown({ approvals: { p3: mark, p2: { ...mark, digest: proposalDigest('p2', ps[0]!) } } })).toBe('');
    // A mark of another text, or of another status, does not back it: the decision changed (review I2, re-review N1).
    const edited = shown({ approvals: { p3: { ...mark, digest: 'bad' }, p2: { ...mark, digest: proposalDigest('p2', ps[0]!) } } });
    expect(edited).toContain('1 propuesta cambió después de tu decisión');
    expect(edited).not.toContain('sin tu marca');
    const flipped = shown({ approvals: { p3: mark, p2: { ...mark, status: 'rejected', digest: proposalDigest('p2', ps[0]!) } } });
    expect(flipped).toContain('1 propuesta cambió después de tu decisión');
    expect(flipped).not.toContain('sin tu marca');
    // Until the approvals snapshot arrives the page does not warn.
    expect(shown({})).toBe('');
  });

  it('without entries there is no section, and no entry has a button that changes shared state', () => {
    expect(renderApp(base(), ui())).not.toContain('class="card needs"');
    const s = needs(renderApp(everything(), ui({ answering: 'q1' })));
    expect(s).toContain('data-role="answer-text"');
    for (const a of [...s.matchAll(/data-action="([^"]+)"/g)].map(x => x[1]!)) expect(['answer-open', 'answer-send', 'open-task', 'view', 'seen-deferred'], a).toContain(a);
  });

  it('to someone who is not the owner: no approvals without the mark, and who decides', () => {
    const s = needs(renderApp({ ...everything(), isOwner: false }, ui()));
    expect(s).not.toContain('sin tu marca');
    expect(s).not.toContain('cambió después');
    expect(s).toContain('Solo el dueño del roadmap decide');
    // Carry 5: while isOwner resolves, the line waits too.
    expect(needs(renderApp({ ...everything(), isOwner: undefined }, ui()))).not.toContain('Solo el dueño del roadmap decide');
  });

  it('keeps out: an answered question, a resolved escalation, a merged, old or seen task, a closed run, a live or 25 h old lease, the same version (Review Focus 1)', () => {
    const m = everything();
    m.notes = [note({ id: 'q3', type: 'question', text: 'ya', answer: 'sí' })];
    m.proposals = [];
    m.messages = [msg({ id: 'm1', type: 'escalation', status: 'resolved' })];
    m.states = {
      T001: { status: 'done', doneAt: at(-60), forge: forgeDone(true) },
      T002: { status: 'done', doneAt: at(-8 * 1440), forge: forgeDone(false) },
      T004: { status: 'done', doneAt: at(-120), forge: forgeDone(false) },
      T005: { status: 'blocked', blockedBy: ['T004'] },
    };
    m.seenDeferred = { T004: at(-120) };
    m.run = { ...m.run!, closedAt: at(-10) };
    m.infinite = { ...m.infinite!, coordinator: { ...m.infinite!.coordinator!, leaseUntil: at(5) } };
    m.meta = { ...base().meta! };
    expect(renderApp(m, ui())).not.toContain('class="card needs"');
    // A run and an infinite run of before 4a (no startedAt, no lastStepAt, no coordinator) never show.
    const old = { ...m, run: runDoc({ active: false, stopReason: 'stalled' }), infinite: { active: true, cycle: 1, budget: {}, startedAt: at(-300), lastCycleAt: null } };
    expect(renderApp(old, ui())).not.toContain('class="card needs"');
    const late = { ...m, infinite: { ...everything().infinite!, coordinator: { ...everything().infinite!.coordinator!, leaseUntil: at(-25 * 60) } } };
    expect(renderApp(late, ui())).not.toContain('class="card needs"');
  });

  it('escapes what the entries carry (Review Focus 5)', () => {
    const m = everything();
    m.notes = [note({ id: 'q"><script>', type: 'question', text: HOSTILE })];
    m.messages = [msg({ id: 'm1', type: 'escalation', from: HOSTILE, to: HOSTILE, text: HOSTILE })];
    m.states = { ...m.states, T003: { status: 'blocked', blockedBy: ['external'], blockedReason: HOSTILE } };
    m.run = { ...m.run!, stallReason: HOSTILE };
    clean(renderApp(m, ui()));
  });
});

describe('the task detail in four tabs (§4.7)', () => {
  const modalOf = (html: string) => html.slice(html.indexOf('<div class="overlay"'));
  const forgeV2 = (over: object = {}) => ({
    v: 2 as const, path: 'large' as const, phase: 'review', agent: 'forge-impl', round: 6, cap: 5, brief: 1, stage: 'review' as const, verdict: { action: 'accept' as const, score: 0.91 },
    validators: [{ name: 'test', ok: true, ms: 41200, cached: true as const }, { name: 'e2e', ok: true, flaky: true as const }, { name: 'lint', ok: true, skipped: 'no config' }, { name: 'types', ok: false, preexisting: true as const, failing: 3 }],
    rounds: [
      { brief: 1, n: 5, action: 'fix' as const, note: 'cerrar el caso', findings: { critical: 1, important: 2, minor: 0, deferred: 0 }, reviewers: ['correctness', 'security'], at: '2026-10-11T11:00:00.000Z' },
      { brief: 1, n: 6, action: 'accept' as const, note: 'listo', findings: { critical: 0, important: 1, minor: 3, deferred: 1 }, reviewers: ['correctness'], at: '2026-10-11T11:40:00.000Z' },
    ],
    verify: { planned: true, result: null, passed: null, total: null, skipped: 'sin emulador', surfaces: ['app'] },
    stages: { brief: 120, implement: 1500, review: 600 }, integration: null, deferred: [{ file: 'src/a.ts', line: 12, problem: 'falta un índice' }],
    acceptedRound: 6, overCap: true, updatedAt: '2026-10-11T11:50:00.000Z', ...over,
  });

  it('is a dialog labelled by its title, with ARIA tabs (Forge only with forge data) and every panel, the inactive ones hidden', () => {
    const html = modalOf(renderApp(base(), ui({ modal: 'T001' })));
    expect(html).toContain('<div class="modal" role="dialog" aria-modal="true" aria-labelledby="dtitle">');
    expect(html).toContain('<span class="t" id="dtitle">Esquema de pedidos</span>');
    expect(html).toContain('<div class="dtabs" role="tablist" aria-label="Secciones de la tarea">');
    expect(html.match(/role="tab"/g)).toHaveLength(3);
    expect(html).toContain('<button type="button" role="tab" id="dtab-summary" class="dtab on" aria-selected="true" aria-controls="dpanel-summary" tabindex="0" data-action="detail-tab" data-tab="summary">Resumen</button>');
    expect(html).toContain('id="dtab-definition" class="dtab" aria-selected="false" aria-controls="dpanel-definition" tabindex="-1"');
    expect(html).toContain('<div class="dpanel" role="tabpanel" id="dpanel-definition" aria-labelledby="dtab-definition" tabindex="0" hidden>');
    expect(html).toContain('>Conversación (0)</button>');
    const m = base();
    m.states.T001 = { ...m.states.T001!, forge: { path: 'medium', phase: 'review' } };
    const forge = modalOf(renderApp(m, ui({ modal: 'T001', tab: 'forge' })));
    expect(forge.match(/role="tab"/g)).toHaveLength(4);
    expect(forge).toContain('id="dtab-forge" class="dtab on" aria-selected="true"');
    expect(forge).toContain('<div class="dpanel" role="tabpanel" id="dpanel-forge" aria-labelledby="dtab-forge" tabindex="0">');
    expect(modalOf(renderApp(base(), ui({ modal: 'T001', tab: 'forge' })))).toContain('id="dtab-summary" class="dtab on"');
  });

  it('the pill says «hecha · sin fusionar» while the integration is not merged, and «Sin ejecutor» when the lease stopped', () => {
    const m = base();
    m.states.T001 = { ...m.states.T001!, forge: forgeV2({ stage: 'done', integration: { branch: 'forge/run-x', sha: 'abc1234', merged: false, target: 'main' } }) };
    expect(modalOf(renderApp(m, ui({ modal: 'T001' })))).toContain('<span class="pill st-done">hecha · sin fusionar</span>');
    m.states.T001 = { ...m.states.T001!, forge: forgeV2({ stage: 'done', integration: { branch: 'forge/run-x', sha: 'abc1234', merged: true, target: 'main' } }) };
    expect(modalOf(renderApp(m, ui({ modal: 'T001' })))).toContain('<span class="pill st-done">Hecha</span>');
  });

  it('Resumen: why it is blocked on top, who runs it, and the commits the events carry that are not in commits yet (H-15, G-18)', () => {
    const m = base();
    m.states.T003 = { status: 'blocked', blockedBy: ['external'], blockedReason: 'Espera la API de pagos' };
    expect(modalOf(renderApp(m, ui({ modal: 'T003' })))).toContain('<div class="warnbox" role="note"><b>Bloqueada por</b> external · Espera la API de pagos</div>');
    m.events = [
      { id: 'c1', ts: '2026-10-11T10:10:00Z', type: 'commit', sessionId: 'main', taskId: 'T001', text: 'T001: paso intermedio', sha: 'fff0001aaa', add: 4, del: 1 },
      { id: 'c2', ts: '2026-10-11T10:20:00Z', type: 'commit', sessionId: 'main', taskId: 'T001', text: 'ya en commits', sha: 'abcdef1234' },
    ];
    const html = modalOf(renderApp(m, ui({ modal: 'T001' })));
    expect(html).toMatch(/Commits intermedios<\/div><div><div class="mono"><span class="c-blue">fff0001<\/span> T001: paso intermedio <span class="ok">\+4<\/span>/);
    expect(html).not.toContain('ya en commits');
    m.states.T002 = { status: 'in_progress', owner: 'be', startedAt: '2026-10-11T11:45:00Z', exec: { runId: 'r1', mode: 'sessions', by: 'be', agent: 'forge-impl', stage: 'implement', since: '2026-10-11T11:50:00Z', leaseUntil: '2026-10-11T12:05:00Z' } };
    expect(modalOf(renderApp(m, ui({ modal: 'T002' })))).toContain('be · ejecutora · Agente: forge-impl');
  });

  it('Definición: inline markdown, the design section, the zones touched out of the plan, and the dependencies with their state (G-16, G-25, H-15, G-23)', () => {
    const m = base();
    m.meta = { ...m.meta!, links: { design: 'https://claude.ai/artifact/d1', designVersion: 7 } };
    m.plan = { ...m.plan, tasks: m.plan.tasks.map(t => (t.id === 'T005' ? { ...t, design_ref: 'checkout', includes: 'usa `stripe` y **3DS**', done_when: 'ver https://x.io/a' } : t)) };
    m.states = { ...m.states, T003: { status: 'done' }, T005: { status: 'free', zonesTouched: ['web/checkout/form.ts', 'src/payments/key.ts'] } };
    const html = modalOf(renderApp(m, ui({ modal: 'T005', tab: 'definition' })));
    expect(html).toContain('usa <code>stripe</code> y <strong>3DS</strong>');
    expect(html).toContain('<a href="https://x.io/a" target="_blank" rel="noopener noreferrer">https://x.io/a</a>');
    expect(html).toContain('<a href="https://claude.ai/artifact/d1#checkout" target="_blank" rel="noopener noreferrer">checkout</a> <span class="mono">v7</span>');
    expect(html).toContain('<span class="zt">web/checkout/form.ts</span>');
    expect(html).toContain('<span class="zt out">src/payments/key.ts · fuera del plan</span>');
    expect(html).toContain('1/2 hechas · faltan T004');
    expect(html).toContain('<button type="button" class="chip st-done" data-action="open-task" data-id="T003" data-k="dep:T003" title="Hecha">T003</button>');
    expect(html).toContain('<button type="button" class="chip st-free" data-action="open-task" data-id="T004" data-k="dep:T004" title="Libre">T004</button>');
    const three = { ...m, plan: { ...m.plan, tasks: m.plan.tasks.map(t => (t.id === 'T006' ? { ...t, depends_on: ['T001', 'T002', 'T003'] } : t)) }, states: { ...m.states, T003: { status: 'free' as const } } };
    expect(modalOf(renderApp(three, ui({ modal: 'T006' })))).toContain('1/3 hechas · faltan T002, T003');
  });

  it('Definición: a task with no zones says «todo el repositorio» (2c wording kept)', () => {
    const m = base();
    m.plan = { ...m.plan, tasks: m.plan.tasks.map(t => (t.id === 'T002' ? { ...t, zones: [] } : t)) };
    expect(modalOf(renderApp(m, ui({ modal: 'T002', tab: 'definition' })))).toContain('todo el repositorio');
  });

  it('Forge: the stages, the rounds with the one over the cap highlighted, every validator, the accepted round with its score only in the title, deferred, verification by round (K4-05, K2-14)', () => {
    const m = base();
    m.states.T002 = { ...m.states.T002!, forge: forgeV2(), evidence: { v: 2, surfaces: ['web'], result: 'fail', passed: 1, total: 3, unchecked: ['refund'], local: '.forge/work/x/evidence/1-6',
      shots: [{ surface: 'web', check: 'home', ok: true, round: 5, url: 'https://claude.ai/_blob/a' }, { surface: 'web', check: 'cart', ok: false, round: 6 }] } };
    const html = modalOf(renderApp(m, ui({ modal: 'T002', tab: 'forge' })));
    expect(html).toContain('<b>grande</b> · revisar · brief 1 · r6/5');
    expect(html).toContain('Etapas: brief 2 min · implementar 25 min · revisar 10 min');
    expect(html).toContain('<tr class="over"><td>1·6</td><td>aceptada</td><td>0 C · 1 I · 3 m</td><td>correctness</td><td>listo</td></tr>');
    expect(html).toContain('<tr><td>1·5</td><td>arreglo</td><td>1 C · 2 I · 0 m</td><td>correctness, security</td><td>cerrar el caso</td></tr>');
    expect(html).toContain('<div class="ok" title="Veredicto: 0.91">Aceptada en la ronda 6</div>');
    expect(html).not.toMatch(/>[^<]*0\.91/);
    expect(html).toContain('<span class="ok">test ✓</span> <span class="mono">41.2 s</span> <span class="mono">caché</span>');
    expect(html).toContain('<span class="ok">e2e ✓</span> <span class="mono">flaky</span>');
    expect(html).toContain('<span class="muted">lint ⊘</span> <span class="mono">saltado: no config</span>');
    expect(html).toContain('<span class="del">types ✗</span> <span class="mono">ya fallaba</span> <span class="mono">3 fallan</span>');
    expect(html).toContain('src/a.ts:12 — falta un índice');
    expect(html).toContain('Verificación saltada: sin emulador');
    expect(html).toContain('<div class="lbl">Ronda 5</div><div class="shots"><button type="button" class="shot ok" data-action="open-shot" data-i="0" data-k="shot:0"');
    expect(html).toContain('<div class="lbl">Ronda 6</div><div class="shots"><div class="shot-row del">✗ cart</div></div>');
    expect(html).toContain('Sin comprobar: refund');
    m.states.T002 = { ...m.states.T002!, forge: forgeV2({ stage: 'stopped' }) };
    expect(modalOf(renderApp(m, ui({ modal: 'T002', tab: 'forge' })))).toContain('parada con /forge:stop');
  });

  it('Conversación: the task’s notes with Reply, decisions with their structure and the proposal it came from, with its count', () => {
    const m = base();
    m.notes = [
      note({ id: 'q1', type: 'question', text: '¿`A` o B?', taskId: 'T002' }),
      note({ id: 'd1', type: 'decision', taskId: 'T002', text: 'elegido A', decision: { point: 'other', what: 'w', chosen: 'A', alternatives: ['B'], why: 'más simple', revert: 'cambiar a B', auto: false } }),
      note({ id: 'c1', type: 'idea', taskId: 'T002', text: 'comentario de propuesta', proposalId: 'p1' }),
    ];
    m.proposals = [P({ id: 'p1', status: 'done', taskId: 'T002', title: 'Origen de T002' })];
    const html = modalOf(renderApp(m, ui({ modal: 'T002', tab: 'talk' })));
    expect(html).toContain('>Conversación (3)</button>');
    expect(html).toContain('¿<code>A</code> o B?');
    expect(html).toContain('data-action="answer-open" data-id="q1"');
    expect(html).toContain('<span class="nauto">tuya</span>');
    expect(html).toContain('Elegido:</span> A');
    expect(html).toContain('Cómo revertir:</span> cambiar a B');
    expect(html).not.toContain('comentario de propuesta');
    expect(html).toContain('Propuesta de origen');
    expect(html).toContain('Origen de T002');
    expect(html).toContain('data-action="view" data-view="talk" data-c="proposals"');
    expect(modalOf(renderApp(m, ui({ modal: 'T002', tab: 'talk', answering: 'q1' })))).toContain('data-role="answer-text"');
  });

  it('escapes everything the detail shows, and never links anything that is not http(s) (Review Focus 5)', () => {
    const m = base();
    m.meta = { ...m.meta!, links: { design: 'https://claude.ai/artifact/d1', designVersion: 7 } };
    m.plan = { ...m.plan, tasks: m.plan.tasks.map(t => (t.id === 'T002' ? { ...t, title: HOSTILE, includes: `${HOSTILE} javascript:alert(1)`, done_when: HOSTILE, verification: HOSTILE, design_ref: HOSTILE } : t)) };
    m.states.T002 = { status: 'blocked', blockedBy: [HOSTILE], blockedReason: HOSTILE, summary: `${HOSTILE} [x](javascript:alert(1))`, zonesTouched: [HOSTILE],
      forge: forgeV2({ agent: HOSTILE, rounds: [{ brief: 1, n: 6, action: 'accept', note: HOSTILE, findings: { critical: 0, important: 0, minor: 0, deferred: 0 }, reviewers: [HOSTILE], at: '2026-10-11T11:40:00.000Z' }], deferred: [{ file: HOSTILE, problem: HOSTILE }] }) };
    m.notes = [note({ id: 'n1', taskId: 'T002', text: HOSTILE })];
    for (const tab of ['summary', 'definition', 'forge', 'talk'] as const) {
      const html = renderApp(m, ui({ modal: 'T002', tab }));
      clean(html);
      expect(html).not.toContain('href="javascript');
    }
  });

  // Task 2 carry: every inlineMd call site (summary, includes, done_when, verification, note text) gets hostile raw text.
  describe('inlineMd call sites with hostile raw text', () => {
    // Carry 8: hostile text inside a code span and inside bold too, so those branches are guarded.
    const RAW = '<img src=x onerror=alert(1)> [js](javascript:alert(1)) [q"q](https://x.io/a"onmouseover="alert(1)) **b** `<img src=y onerror=alert(2)>` **<svg onload=alert(3)>**';
    const never = (html: string) => {
      expect(html).not.toContain('<img');
      expect(html).not.toContain('<svg');
      expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
      expect(html).toContain('<code>&lt;img src=y onerror=alert(2)&gt;</code>');
      expect(html).toContain('<strong>&lt;svg onload=alert(3)&gt;</strong>');
      expect(html).not.toMatch(/<a [^>]*href="javascript/i);
      expect(html).not.toMatch(/<a [^>]*onmouseover/i);
      expect(html).not.toMatch(/href="[^"]*&quot;/);
      expect(html).not.toMatch(/href="[^"]*"onmouseover/);
    };
    const withTask = (over: object) => {
      const m = base();
      m.plan = { ...m.plan, tasks: m.plan.tasks.map(t => (t.id === 'T002' ? { ...t, ...over } : t)) };
      return m;
    };
    it('summary', () => {
      const m = base();
      m.states.T002 = { ...m.states.T002!, summary: RAW };
      never(modalOf(renderApp(m, ui({ modal: 'T002', tab: 'summary' }))));
    });
    it('includes', () => never(modalOf(renderApp(withTask({ includes: RAW }), ui({ modal: 'T002', tab: 'definition' })))));
    it('done_when', () => never(modalOf(renderApp(withTask({ done_when: RAW }), ui({ modal: 'T002', tab: 'definition' })))));
    it('verification', () => never(modalOf(renderApp(withTask({ verification: RAW }), ui({ modal: 'T002', tab: 'definition' })))));
    it('note text', () => {
      const m = base();
      m.notes = [note({ id: 'n1', taskId: 'T002', text: RAW })];
      never(modalOf(renderApp(m, ui({ modal: 'T002', tab: 'talk' }))));
    });
  });
});

describe('everything that opens a task is a button (G-15, H-19)', () => {
  it('in every view, the detail included, no element with data-action="open-task" is a div or a li', () => {
    const m = { ...base(), run: runDoc(), notes: [note({ id: 'n1', taskId: 'T001' })], states: { ...base().states, T005: { status: 'blocked' as const, blockedBy: ['external'] } } };
    for (const view of VIEWS) {
      const html = renderApp(m, ui({ view, modal: 'T002', expanded: new Set(['F1', 'F2']), layers: ['critical', 'forge'] }));
      const tags = [...html.matchAll(/<(\w+)[^>]*data-action="open-task"/g)].map(x => x[1]);
      expect(tags.length, view).toBeGreaterThan(0);
      expect([...new Set(tags)], view).toEqual(['button']);
    }
  });
  it('the Conversation task chip is a button keyed by its note: two notes on one task give two keys (review M2)', () => {
    const m = { ...base(), notes: [note({ id: 'n1', taskId: 'T001' }), note({ id: 'n2', taskId: 'T001' })] };
    const html = renderApp(m, ui({ view: 'talk' }));
    expect(html).toContain('<button type="button" class="chip" data-action="open-task" data-id="T001" data-k="tk:n1">');
    expect(html).toContain('<button type="button" class="chip" data-action="open-task" data-id="T001" data-k="tk:n2">');
  });
  it('the bars are hidden from assistive technology and open their task with a click of their own; groups say whether they are open', () => {
    const html = renderApp(base(), ui({ view: 'schedule', expanded: new Set(['F1']) }));
    expect(html).toMatch(/<div class="gb [^"]*"[^>]* data-action="open-bar" data-id="T001" data-task="T001" aria-hidden="true">/);
    expect(html).not.toMatch(/class="gb[^>]*data-action="open-task"/);
    expect(html).toContain('<button type="button" class="tr ph" data-action="toggle-phase" data-id="F1" data-k="p:F1" aria-expanded="true"');
    expect(html).toContain('data-id="F2" data-k="p:F2" aria-expanded="false"');
    expect(renderApp(base(), ui({ view: 'schedule' }))).toMatch(/<li><button type="button" class="cpl" data-action="open-task" data-id="T00\d" data-k="cp:T00\d">/);
    expect(renderApp(base(), ui({ view: 'plan' }))).toContain('<button type="button" class="tc" data-action="open-task" data-id="T001" data-k="t:T001">');
  });
  it('theme.css: a row button fills its line and is aligned to the left, with a visible focus', () => {
    expect(cssRule(CSS, '.tr')).toContain('width:100%');
    expect(cssRule(CSS, '.tr')).toContain('text-align:left');
    expect(cssRule(CSS, 'button.tr:focus-visible')).toContain('outline:2px solid var(--lavender)');
  });
});

describe('the forge mark of the timeline (K4-05)', () => {
  it('an accepted task reads its round and findings by severity; the score goes only in the title', () => {
    const m = base();
    m.states.T001 = { ...m.states.T001!, forge: {
      v: 2, path: 'medium', phase: 'done', validators: [], verdict: { action: 'accept', score: 0.91 }, round: 2, cap: 4, brief: 1, stage: 'done',
      rounds: [
        { brief: 1, n: 1, action: 'fix', note: 'n', findings: { critical: 1, important: 0, minor: 0, deferred: 0 }, reviewers: [], at: '2026-10-11T10:05:00.000Z' },
        { brief: 1, n: 2, action: 'accept', note: 'ok', findings: { critical: 0, important: 1, minor: 3, deferred: 0 }, reviewers: [], at: '2026-10-11T10:15:00.000Z' },
      ],
      verify: null, stages: {}, integration: null, deferred: [], acceptedRound: 2, overCap: false, updatedAt: '2026-10-11T10:20:00.000Z' } };
    const html = renderApp(m, ui({ view: 'schedule', expanded: new Set(['F1']), layers: ['forge'] }));
    expect(html).toContain('<span class="fg ok" title="Veredicto: 0.91">✓ r2 · 0 C · 1 I · 3 m</span>');
    expect(html).not.toMatch(/>[^<]*0\.91/);
  });
  it('a task under review reads its stage or its last action and the round; a v1 block too, its score in the title', () => {
    const m = base();
    m.states.T002 = { ...m.states.T002!, forge: { path: 'medium', phase: 'review', verdict: { action: 'fix', score: 0.4 }, round: 2, cap: 4 } };
    const html = renderApp(m, ui({ view: 'schedule', expanded: new Set(['F1']), layers: ['forge'] }));
    expect(html).toContain('<span class="fg warn" title="Veredicto: 0.40">⚒ arreglo · r2/4</span>');
  });
});
