import { expect, mock, test } from 'claude-code/testing';
import type { Engine } from 'claude-code/testing';
import type { On, RenderElement } from 'claude-code';

const SURFACES = ['terminal', 'desktop'] as const;
const PANE = 'lens';
const PANE_PROPS = {
  title: 'lens', isFocused: false, bodyColumns: 60, placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 30 }, view: {},
};
const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 9 }, view: {} };
// The person typing /lens at a fullscreen terminal.
const RUN = { command: 'lens', args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } };
const NOW = Date.parse('2026-10-11T10:05:00.000Z');

// A superpowers run on a file system answered from memory: an older and a newer ledger, and the newer one's plan.
const ROOT = '/repo';
const SESSION_ID = 'conv-1';
const PLAN = ['# Plan', ...Array.from({ length: 9 }, (_, i) => `### Task ${i + 1}: Step ${i + 1}\n- [ ] do it`)].join('\n');
const BASE_FILES: Record<string, { text: string; mtimeMs: number }> = {
  [`${ROOT}/.superpowers/sdd/old/progress.md`]: { text: '# SDD ledger — plan: docs/old.md\n## Progress\nTask 1: complete\n', mtimeMs: 1 },
  [`${ROOT}/.superpowers/sdd/new/progress.md`]: {
    text: '# SDD ledger — plan: docs/superpowers/plans/new.md\n\n## Progress\nTasks 1-2: complete (abc..def)\nTask 3: fix round 1/5 (flaky test)\n',
    mtimeMs: 5,
  },
  [`${ROOT}/docs/superpowers/plans/new.md`]: { text: PLAN, mtimeMs: 2 },
};

const norm = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '');

// Every Box a drawing holds, at any depth.
function boxesOf(n: unknown, out: { props?: Record<string, unknown> }[] = []): { props?: Record<string, unknown> }[] {
  if (Array.isArray(n)) { for (const c of n) boxesOf(c, out); return out; }
  if (!n || typeof n !== 'object') return out;
  const el = n as { type?: string; props?: Record<string, unknown>; children?: unknown };
  if (el.type === 'Box') out.push(el);
  return boxesOf(el.children, out);
}

// The rows a drawing takes, as the terminal lays it out: a column sums its children, a row takes its tallest, a frame
// adds two rows and a margin its size; a Text or a Button is one.
function rowsOf(n: unknown): number {
  if (Array.isArray(n)) return n.reduce((sum: number, c) => sum + rowsOf(c), 0);
  if (!n || typeof n !== 'object') return 0;
  const el = n as { type?: string; props?: Record<string, unknown>; children?: unknown };
  if (el.type === 'Text' || el.type === 'Button') return 1;
  if (el.type !== 'Box') return rowsOf(el.children);
  const kids = Array.isArray(el.children) ? el.children : [el.children];
  const inner = el.props?.flexDirection === 'row' ? Math.max(0, ...kids.map(rowsOf)) : rowsOf(kids);
  return inner + (el.props?.borderStyle ? 2 : 0) + (typeof el.props?.marginTop === 'number' ? el.props.marginTop : 0);
}

type El = { type?: string; props?: Record<string, unknown>; children?: unknown };
const kidsOf = (el: El): unknown[] => (Array.isArray(el.children) ? el.children : [el.children]).filter(c => c !== null && c !== undefined && c !== false);
const frameOf = (p: Record<string, unknown> | undefined): number =>
  Number(p?.paddingLeft ?? 0) + 2 * Number(p?.paddingX ?? 0) + (p?.borderStyle ? 2 : 0);
// The cells a drawing takes across when nothing wraps: a Text its strings, a row its children and gaps, a column its
// widest child; a Client its width, or two cells a box. The glyphs drawn here take one cell each.
function widthOf(n: unknown): number {
  if (typeof n === 'string') return [...n].length;
  if (Array.isArray(n)) return n.reduce((w: number, c) => w + widthOf(c), 0);
  if (!n || typeof n !== 'object') return 0;
  const el = n as El;
  if (el.type === 'Client') {
    const own = el.props?.props as { colors?: unknown[] } | undefined;
    return typeof el.props?.width === 'number' ? el.props.width : 2 * (own?.colors?.length ?? 0);
  }
  if (el.type === 'Button') return [...String(el.props?.label ?? '')].length + 4;
  if (el.type !== 'Box') return widthOf(el.children);
  const kids = kidsOf(el);
  if (el.props?.flexDirection !== 'row') return frameOf(el.props) + Math.max(0, ...kids.map(widthOf));
  return frameOf(el.props) + kids.reduce((w: number, c) => w + widthOf(c), 0) + Number(el.props?.columnGap ?? 0) * Math.max(0, kids.length - 1);
}
// The rows a drawing takes at `width` columns, wrapping as the terminal lays it out: a column sums its children, a row
// takes its tallest, a wrapping row breaks its children into lines (each as wide as its content, at most the row), a Text
// that does not truncate wraps; a frame adds two rows and a margin its size.
function rowsAt(n: unknown, width: number): number {
  if (Array.isArray(n)) return n.reduce((sum: number, c) => sum + rowsAt(c, width), 0);
  if (!n || typeof n !== 'object') return 0;
  const el = n as El;
  if (el.type === 'Text') return el.props?.wrap === 'truncate-end' ? 1 : Math.max(1, Math.ceil(widthOf(el) / Math.max(1, width)));
  if (el.type === 'Button') return 1;
  if (el.type === 'Client') return typeof el.props?.height === 'number' ? el.props.height : Math.max(1, Math.ceil(widthOf(el) / Math.max(1, width)));
  if (el.type !== 'Box') return rowsAt(el.children, width);
  const kids = kidsOf(el);
  const inner = Math.max(1, width - frameOf(el.props));
  let rows = 0;
  if (el.props?.flexDirection === 'row' && el.props?.flexWrap === 'wrap') {
    const gap = Number(el.props?.columnGap ?? 0);
    let used = -1;
    let line = 0;
    for (const kid of kids) {
      const w = Math.min(widthOf(kid), inner);
      if (used >= 0 && used + gap + w > inner) { rows += line; used = -1; line = 0; }
      used = used < 0 ? w : used + gap + w;
      line = Math.max(line, rowsAt(kid, w));
    }
    rows += line;
  } else if (el.props?.flexDirection === 'row') rows = Math.max(0, ...kids.map(k => rowsAt(k, inner)));
  else rows = kids.reduce((sum: number, k) => sum + rowsAt(k, inner), 0);
  return rows + (el.props?.borderStyle ? 2 : 0) + (typeof el.props?.marginTop === 'number' ? el.props.marginTop : 0);
}

// Everything a drawing says, in order: Text strings, Svg alt texts (the desktop's cards) and Button labels.
async function said(ui: { drawn: () => Promise<unknown> }): Promise<string> {
  const out: string[] = [];
  const walk = (n: unknown): void => {
    if (typeof n === 'string') { out.push(n); return; }
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!n || typeof n !== 'object') return;
    const el = n as { type?: string; props?: Record<string, unknown>; children?: unknown };
    if (el.type === 'Svg' && typeof el.props?.alt === 'string') out.push(el.props.alt);
    if (el.type === 'Button' && typeof el.props?.label === 'string') out.push(el.props.label);
    walk(el.children);
  };
  walk(await ui.drawn());
  return out.join(' | ');
}

function serveFiles(on: On, reads: string[], extra: Record<string, { text: string; mtimeMs: number }> = {}) {
  const FILES = { ...BASE_FILES, ...extra };
  on('session.root', () => ({ value: ROOT }));
  on('session.id', () => ({ value: SESSION_ID }));
  on('fs.read', (_$, e) => {
    reads.push(norm(e.path));
    const f = FILES[norm(e.path)];
    return f ? { value: f.text } : { deny: `ENOENT ${e.path}` };
  });
  on('fs.exists', (_$, e) => ({ value: norm(e.path) in FILES }));
  on('fs.stat', (_$, e) => {
    const f = FILES[norm(e.path)];
    return f ? { value: { kind: 'file' as const, size: 0, mtimeMs: f.mtimeMs, isLink: false } } : { deny: `ENOENT ${e.path}` };
  });
  on('fs.list', (_$, e) => {
    const prefix = `${norm(e.path)}/`;
    const names = new Map<string, 'file' | 'dir'>();
    for (const path of Object.keys(FILES)) {
      if (!path.startsWith(prefix)) continue;
      const [head = '', ...rest] = path.slice(prefix.length).split('/');
      names.set(head, rest.length ? 'dir' : 'file');
    }
    return names.size
      ? { value: [...names].map(([name, kind]) => ({ name, kind, size: 0, mtimeMs: 1, isLink: false })) }
      : { deny: `ENOENT ${e.path}` };
  });
}

// The engine's pane bookkeeping beneath the plugin: what is open, and what $.ui.open answers.
function servePanes(on: On, answer: () => { isPlaced: true } | { isPlaced: false; reason: string } = () => ({ isPlaced: true })) {
  const open = new Set<string>();
  on('ui.open', (_$, e) => { open.add(e.id); return { value: answer() }; });
  on('ui.close', (_$, e) => { open.delete(e.id); return { value: undefined }; });
  on('ui.panes', () => ({
    value: [...open].map(id => ({ id, title: 'lens', isShown: true, isFocused: false, isPlaced: true })),
  }));
  return open;
}

// w8 M1: lens hears a subagent start from its spawn and its end from its own turn.complete, never from the classic hooks.
// The engine beneath answers a spawn with the call's tool_use_id as the agent's id, and every turn's end.
function serveSpawns(on: On) {
  on('agent.spawn', (_$, e) => ({ model: 'claude-sonnet-5-5', agentId: e.tool_use_id }));
  on('turn.complete', () => ({ text: '' }));
}
const spawnOf = (id: string, type = 'Explore', description = '') => ({
  tool_use_id: id, prompt: 'Look around', description, subagentType: type, provider: { plugin: 'engine', tier: 'core' },
  parentModel: 'claude-opus-5-5', background: true, fork: false,
}) as never;
const endOf = (agentId: string) => ({ turnId: `t-${agentId}`, agentId, answer: '', durationMs: 1, isAborted: false, reason: 'answer' }) as never;

function start(on: On) {
  const clock = mock.clock(on, { now: NOW });
  on('session.start', (_$, e) => ({ cwd: e.cwd }));
  on('agent.list', () => ({ value: [] }));
  serveSpawns(on);
  return clock;
}

test('the command opens the pane and shows the newest ledger against its plan', async ($, on) => {
  const reads: string[] = [];
  serveFiles(on, reads);
  const open = servePanes(on);
  start(on);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  const ran = await $.command.run(RUN);
  expect(open.has(PANE)).toBe(true);
  expect(ran.text).toBe('Progress panel opened.');
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'lens', surface, component: 'Pane', requestId: PANE, props: PANE_PROPS });
    expect(await said(ui)).toContain('docs/superpowers/plans/new.md');
    expect(await said(ui)).toMatch(/Task 3\/9.*2 done.*round 1\/5/);
    expect(await said(ui)).toContain('Task 3: fix round 1/5 (flaky test)');
    expect(await ui.find({ key: 'close' })).toBeUndefined();
    await ui.unmount();
  }
  expect(reads).not.toContain(`${ROOT}/.superpowers/sdd/old/progress.md`);
});

test('TaskCreate and TaskUpdate calls of any loop fill the Claude Code tasks card; a refused one adds nothing (w8 M1: no classic hook)', async ($, on) => {
  serveFiles(on, []);
  servePanes(on);
  const clock = start(on);
  let n = 0;
  on('tool.call', { tool: 'TaskCreate' }, (_$, e) => (e.subject === 'Refused' ? { deny: 'no' } : { result: { task: { id: String(++n), subject: e.subject } } }));
  on('tool.call', { tool: 'TaskUpdate' }, (_$, e) => ({ result: { success: true, taskId: e.taskId, updatedFields: ['status'] } }));
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  const pane = async () => {
    const ui = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS });
    const text = await said(ui);
    await ui.unmount();
    return text;
  };
  expect(await pane()).not.toContain('Claude Code tasks');
  await $.tool.call({ tool: 'TaskCreate', subject: 'Write the spec', description: 'd', tool_use_id: 'c1' });
  await $.tool.call({ tool: 'TaskCreate', subject: 'Review it', description: 'd', tool_use_id: 'c2', agentId: 'a1' } as never);
  await $.tool.call({ tool: 'TaskCreate', subject: 'Refused', description: 'd', tool_use_id: 'c3' });
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed', tool_use_id: 'u1' });
  await clock.advance(1000);
  const text = await pane();
  expect(text).toContain('Claude Code tasks');
  expect(text).toMatch(/1 open.*1 done/);
  expect(text).toContain('Write the spec');
  expect(text).toContain('Review it');
  expect(text).not.toContain('Refused');
});

test('a TodoWrite call updates the todos section', async ($, on) => {
  serveFiles(on, []);
  servePanes(on);
  const clock = start(on);
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [] } }));
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  const before = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS });
  expect(await said(before)).not.toContain('Todos');
  await before.unmount();
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'lens', surface, component: 'Pane', requestId: PANE, props: PANE_PROPS });
    await $.tool.call({
      tool: 'TodoWrite',
      todos: [
        { content: 'Write tests', status: 'in_progress', activeForm: `Writing tests ${surface}` },
        { content: 'Ship it', status: 'pending', activeForm: 'Shipping' },
      ],
    });
    await clock.advance(1000);
    await ui.redraw();
    expect(await said(ui)).toContain('Todos');
    expect(await said(ui)).toContain(`Writing tests ${surface}`);
    expect(await said(ui)).toContain('Ship it');
    await ui.unmount();
  }
});

test('with the pane closed no panel state is written, and files are read only while there is activity', async ($, on) => {
  const reads: string[] = [];
  const written: string[] = [];
  serveFiles(on, reads);
  servePanes(on);
  const clock = start(on);
  on('state.set', (_$, e, next) => { written.push(`${e.plugin}.${e.key}`); return next(e); });
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [] } }));
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await clock.advance(60000);
  expect(reads).toEqual([]);
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'a', status: 'pending', activeForm: 'A' }] });
  await $.agent.spawn(spawnOf('a1'));
  await clock.advance(60000);
  expect(reads.length).toBeGreaterThan(0);
  expect(written).not.toContain('lens.panel');
});

test('a surface that places no panes gets a toast with the reason', async ($, on) => {
  const toasts: string[] = [];
  serveFiles(on, []);
  servePanes(on, () => ({ isPlaced: false, reason: 'no attached surface places panes' }));
  on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined }; });
  start(on);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  const ran = await $.command.run(RUN);
  expect(toasts.at(-1)).toBe('The lens panel is open but not shown yet: no attached surface places panes');
  expect(ran.text).toBe('The lens panel is open but not shown yet.');
});

test('without a waypoint project, activity shows the lens minimal band whose Panel button runs /lens as the band measures the screen', async ($, on) => {
  servePanes(on);
  serveFiles(on, []);
  start(on);
  // A plugin's $.command.run does not reach its own command hook in the kit: record what the button runs.
  const ran: string[] = [];
  on('command.run', (_$, e) => { ran.push(`/${e.command} ${e.args}`.trimEnd()); return { text: '' }; });
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [] } }));
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return h(Text, {}, 'engine band') as RenderElement;
  });
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'lens', surface, component: 'AbovePrompt', props: BAND_PROPS });
    expect(await ui.find({ key: 'panel' })).toBeUndefined();
    await ui.unmount();
  }
  await $.agent.spawn(spawnOf('a1'));
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'lens', surface, component: 'AbovePrompt', props: BAND_PROPS });
    expect((await ui.findAll({ type: 'Button' })).map(b => b.key)).toEqual(['panel', 'dismiss']);
    await ui.press({ key: 'panel' });
    expect(ran.splice(0)).toEqual(['/lens foto']);
    await ui.unmount();
  }
  const wide = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'AbovePrompt', props: { ...BAND_PROPS, bodyColumns: 160 }, viewport: { columns: 165, rows: 40, isFullscreen: true } });
  await wide.press({ key: 'panel' });
  expect(ran.splice(0)).toEqual(['/lens live']);
  await wide.unmount();
});

test('a subagent shows until the agents list no longer has it', async ($, on) => {
  serveFiles(on, []);
  servePanes(on);
  const clock = mock.clock(on, { now: NOW });
  on('session.start', (_$, e) => ({ cwd: e.cwd }));
  let agents = [{ id: 'a1', description: 'Find the parser', type: 'Explore', status: 'running' as const }];
  on('agent.list', () => ({ value: agents }));
  serveSpawns(on);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.agent.spawn(spawnOf('a1', 'Explore', 'Find the parser'));
  await $.command.run(RUN);
  const ui = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS });
  expect(await said(ui)).toMatch(/Explore.*Find the parser.*\d+s/);
  agents = [];
  await clock.advance(10000);
  await ui.redraw();
  // It is gone from the running list but kept as finished.
  expect(await said(ui)).toMatch(/✓ Explore · Find the parser/);
  await ui.unmount();
});

function engineBand(on: On) {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return h(Text, {}, 'engine band') as RenderElement;
  });
}

async function bandButtons($: Engine) {
  const out: (string | undefined)[][] = [];
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'lens', surface, component: 'AbovePrompt', props: BAND_PROPS });
    out.push((await ui.findAll({ type: 'Button' })).map(b => b.key));
    await ui.unmount();
  }
  return out;
}

test('todos alone, open or completed, show no minimal band and keep nothing reading (w7 A5)', async ($, on) => {
  const reads: string[] = [];
  servePanes(on);
  serveFiles(on, reads);
  const clock = start(on);
  engineBand(on);
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [] } }));
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'a', status: 'pending', activeForm: 'A' }, { content: 'b', status: 'completed', activeForm: 'B' }] });
  expect(await bandButtons($)).toEqual([[], []]);
  await clock.advance(30000);
  expect(reads).toEqual([]);
  // Another activity still brings it.
  await $.agent.spawn(spawnOf('a1'));
  expect(await bandButtons($)).toEqual([['panel', 'dismiss'], ['panel', 'dismiss']]);
});

test('a subagent heard of more than an hour ago shows no minimal band', async ($, on) => {
  servePanes(on);
  serveFiles(on, []);
  const clock = start(on);
  engineBand(on);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.agent.spawn(spawnOf('a1'));
  expect(await bandButtons($)).toEqual([['panel', 'dismiss'], ['panel', 'dismiss']]);
  await clock.advance(3600_000 + 1000);
  expect(await bandButtons($)).toEqual([[], []]);
});

test('the cross hides the minimal band until the next session', async ($, on) => {
  servePanes(on);
  serveFiles(on, []);
  start(on);
  engineBand(on);
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [] } }));
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.agent.spawn(spawnOf('a1'));
  const ui = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS });
  await ui.press({ key: 'dismiss' });
  expect(await ui.find({ key: 'panel' })).toBeUndefined();
  expect(await ui.find({ text: 'engine band' })).toBeDefined();
  await ui.unmount();
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.agent.spawn(spawnOf('a1'));
  expect(await bandButtons($)).toEqual([['panel', 'dismiss'], ['panel', 'dismiss']]);
});

test('once the pane is closed no panel state is written, and the band reads files only while there is activity', async ($, on) => {
  const reads: string[] = [];
  const written: string[] = [];
  serveFiles(on, reads);
  const open = servePanes(on);
  const clock = start(on);
  on('state.set', (_$, e, next) => { written.push(`${e.plugin}.${e.key}`); return next(e); });
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [] } }));
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  expect(reads.length).toBeGreaterThan(0);
  expect(written).toContain('lens.panel');
  const pane = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS });
  // The test kit cannot raise ui.close: the engine's own ✕ takes the pane away, and the next refresh sees it gone.
  open.delete(PANE);
  await pane.unmount();
  reads.length = 0;
  written.length = 0;
  await clock.advance(30000);
  expect(reads).toEqual([]);
  await $.agent.spawn(spawnOf('a1'));
  await clock.advance(30000);
  expect(written).not.toContain('lens.panel');
});

// A waypoint project on the served file system: a plan of two phases, a session and its running task.
const SHOP_PLAN = `project: shop
locale: es
version: "0.1"
versions:
  - id: "0.1"
    phases: [F1, F2]
tracks:
  - { id: backend, name: Backend, color: blue }
phases:
  - { id: F1, name: Base, plan_status: committed }
  - { id: F2, name: Entrega, plan_status: committed }
tasks:
  - id: T001
    title: Esquema de pedidos
    track: backend
    phase: F1
    done_when: migración aplicada
    zones: ["src/db/**"]
  - id: T002
    title: Envío
    track: backend
    phase: F2
    done_when: pedido enviado
    depends_on: [T001]
    zones: ["src/ship/**"]
`;
const SHOP: Record<string, { text: string; mtimeMs: number }> = {
  [`${ROOT}/docs/waypoint/shop/plan.yaml`]: { text: SHOP_PLAN, mtimeMs: 1 },
  [`${ROOT}/.waypoint/shop/session.json`]: { text: JSON.stringify({ sessionId: 'S1', track: 'backend' }), mtimeMs: 1 },
  [`${ROOT}/.waypoint/shop/bound.json`]: {
    text: JSON.stringify({ sid: 'S1', claude: SESSION_ID, pid: null, via: 'work', since: '2026-10-11T09:00:00.000Z', seenAt: '2026-10-11T10:04:00.000Z', endedAt: null, endReason: null }),
    mtimeMs: 1,
  },
  [`${ROOT}/.waypoint/shop/dbcache/state/T001.json`]: {
    text: JSON.stringify({ status: 'in_progress', owner: 'S1', startedAt: '2026-10-11T10:00:00.000Z' }), mtimeMs: 1,
  },
};

test('the pane shows the roadmap phase', async ($, on) => {
  serveFiles(on, [], SHOP);
  servePanes(on);
  start(on);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'lens', surface, component: 'Pane', requestId: PANE, props: PANE_PROPS });
    expect(await said(ui)).toContain('Fase 1/2 · Base');
    await ui.unmount();
  }
});

test('parallel tool calls keep the most recent one still running under Now', async ($, on) => {
  serveFiles(on, []);
  servePanes(on);
  const clock = start(on);
  const gates: Record<string, () => void> = {};
  const held = (name: string) => () => new Promise<never>(resolve => { gates[name] = () => resolve({ result: {} } as never); });
  on('tool.call', { tool: 'Read' }, held('Read'));
  on('tool.call', { tool: 'Grep' }, held('Grep'));
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  const first = $.tool.call({ tool: 'Read', file_path: '/repo/a' } as never);
  await clock.advance(1000);
  const second = $.tool.call({ tool: 'Grep', pattern: 'x' } as never);
  await clock.advance(1000);
  gates.Grep();
  await second;
  await clock.advance(1000);
  const ui = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS });
  expect(await said(ui)).toMatch(/tool\s+\| Read/);
  gates.Read();
  await first;
  await clock.advance(1000);
  await ui.redraw();
  expect(await said(ui)).not.toMatch(/tool\s+\|/);
  await ui.unmount();
});

test("a subagent's turn end leaves the main turn under Now", async ($, on) => {
  serveFiles(on, []);
  servePanes(on);
  const clock = start(on);
  on('turn.start', (_$, e) => ({ turnId: e.turnId }));
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  await $.turn.start({ text: 'go', turnId: 'main-1' });
  await clock.advance(1000);
  const end = { answer: '', durationMs: 1, isAborted: false, reason: 'answer' as const };
  await $.turn.complete({ ...end, turnId: 'sub-1', agentId: 'a1' });
  await clock.advance(1000);
  const ui = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS });
  expect(await said(ui)).toMatch(/turn \| \d+s/);
  await $.turn.complete({ ...end, turnId: 'main-1' });
  await clock.advance(1000);
  await ui.redraw();
  expect(await said(ui)).not.toMatch(/turn \|/);
  await ui.unmount();
});

test('a finished subagent stays listed with ✓ and its time for five minutes; a stop never started adds nothing', async ($, on) => {
  serveFiles(on, []);
  servePanes(on);
  const clock = mock.clock(on, { now: NOW });
  on('session.start', (_$, e) => ({ cwd: e.cwd }));
  // The agents list is the truth on each refresh: it holds the subagent while it runs.
  let agents = [{ id: 'a1', description: '', type: 'Explore', status: 'running' as const }];
  on('agent.list', () => ({ value: agents }));
  serveSpawns(on);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  await $.agent.spawn(spawnOf('a1'));
  await clock.advance(65_000);
  agents = [];
  await $.turn.complete(endOf('a1'));
  await $.turn.complete(endOf('ghost'));
  await clock.advance(1000);
  const ui = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS });
  expect(await said(ui)).toMatch(/✓ Explore · 1m 05s/);
  expect(await said(ui)).not.toMatch(/✓ Plan/);
  // Past the five minutes, and one more panel refresh (every 10 s) builds the model without it.
  await clock.advance(5 * 60_000 + 10_000);
  await ui.redraw();
  expect(await said(ui)).not.toMatch(/✓ Explore/);
  await ui.unmount();
});

test('a subagent the list drops before its stop is kept as finished once; the late stop adds nothing', async ($, on) => {
  serveFiles(on, []);
  servePanes(on);
  const clock = mock.clock(on, { now: NOW });
  on('session.start', (_$, e) => ({ cwd: e.cwd }));
  let agents = [{ id: 'a1', description: 'Find the parser', type: 'Explore', status: 'running' as const }];
  on('agent.list', () => ({ value: agents }));
  serveSpawns(on);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  await $.agent.spawn(spawnOf('a1', 'Explore', 'Find the parser'));
  await clock.advance(30_000);
  agents = [];
  await clock.advance(10_000);
  await $.turn.complete(endOf('a1'));
  await clock.advance(1000);
  const ui = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS });
  const text = await said(ui);
  expect(text.match(/✓ Explore/g)).toHaveLength(1);
  expect(text).toMatch(/✓ Explore · Find the parser · \d+m? ?\d*s/);
  await ui.unmount();
});

test('a pane never opened costs no pane checks on the panel cadence', async ($, on) => {
  serveFiles(on, []);
  const clock = start(on);
  let checks = 0;
  on('ui.panes', () => { checks++; return { value: [] }; });
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  const after = checks;
  await clock.advance(60000);
  expect(checks).toBe(after);
});

test('/lens is registered to run at once, even mid-turn', async ($, on) => {
  serveFiles(on, []);
  servePanes(on);
  start(on);
  const registered: { name: string; immediate?: true }[] = [];
  on('command.register', (_$, e) => { registered.push(e); return { value: { command: e.name } }; });
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  expect(registered).toContainEqual(expect.objectContaining({ name: 'lens', immediate: true }));
});

test('/clear empties the todos and the subagents of the panel (E-13)', async ($, on) => {
  serveFiles(on, []);
  servePanes(on);
  const clock = start(on);
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }));
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [] } }));
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'Write the parser', status: 'in_progress', activeForm: 'Writing the parser' }] });
  await $.agent.spawn(spawnOf('a1'));
  await $.command.run(RUN);
  const pane = async () => {
    const ui = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS });
    const text = await said(ui);
    await ui.unmount();
    return text;
  };
  // The control: the same pane shows both before the clear.
  const before = await pane();
  expect(before).toContain('Writing the parser');
  expect(before).toContain('Explore');
  await $.session.end({ reason: 'clear', sessionId: 'old-conversation', resume: {} as never });
  await $.command.run(RUN);
  await clock.advance(1000);
  const after = await pane();
  expect(after).not.toContain('Writing the parser');
  expect(after).not.toContain('Explore');
});

test('inline, the pane draws its cards without a frame and says how many rows it left out; docked, framed and whole (F-01, F-07)', async ($, on) => {
  serveFiles(on, []);
  servePanes(on);
  const clock = start(on);
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [] } }));
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  await $.tool.call({ tool: 'TodoWrite', todos: Array.from({ length: 6 }, (_, i) => ({ content: `Step ${i}`, status: i === 0 ? 'in_progress' : 'pending', activeForm: `Doing step ${i}` })) });
  await clock.advance(1000);
  const inline = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'Pane', requestId: PANE, props: { ...PANE_PROPS, placement: 'inline' as const, scroll: { offset: 0, bodyRows: 8 } } });
  expect(await inline.find({ key: 'close' })).toBeUndefined();
  expect(boxesOf(await inline.drawn()).some(b => b.props?.borderStyle)).toBe(false);
  expect(await said(inline)).toMatch(/↓ \d+ more · \/lens photo/);
  await inline.unmount();
  const docked = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS });
  expect(boxesOf(await docked.drawn()).some(b => b.props?.borderStyle === 'round')).toBe(true);
  expect(await said(docked)).not.toContain('↓');
  await docked.unmount();
});

test('the first /lens, with no model yet, asks for the rows its cards take, reading the files once (carry 5)', async ($, on) => {
  const reads: string[] = [];
  serveFiles(on, reads);
  const opened: { rows?: number }[] = [];
  const open = new Set<string>();
  on('ui.open', (_$, e) => { open.add(e.id); opened.push({ rows: e.rows }); return { value: { isPlaced: true as const } }; });
  on('ui.panes', () => ({ value: [...open].map(id => ({ id, title: 'lens', isShown: true, isFocused: false, isPlaced: true })) }));
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return h(Text, {}, 'engine band') as RenderElement;
  });
  start(on);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  // A terminal of 60 rows on the main screen: a third of it is 20.
  const band = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS, viewport: { columns: 100, rows: 60, isFullscreen: false } });
  await band.unmount();
  reads.length = 0;
  await $.command.run({ ...RUN, args: 'live', presentation: { isFullscreen: false, columns: 100 } });
  expect(opened.at(-1)?.rows).toBeGreaterThan(6);
  expect(reads.filter(p => p.endsWith('/new/progress.md'))).toHaveLength(1);
  expect(open.has(PANE)).toBe(true);
});

test('/lens asks for the rows its compact cards take, between 6 and a third of the screen, and 56 columns where it docks (F-01)', async ($, on) => {
  serveFiles(on, []);
  const opened: { rows?: number; columns?: number }[] = [];
  on('ui.open', (_$, e) => { opened.push({ rows: e.rows, columns: e.columns }); return { value: { isPlaced: true as const } }; });
  on('ui.panes', () => ({ value: [] }));
  start(on);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  expect(opened.at(-1)?.columns).toBe(56);
  expect(opened.at(-1)?.rows).toBeGreaterThanOrEqual(6);
});

test('with fewer rows than the one card it keeps, the pane clips that card to its rows and marks it with «…»', async ($, on) => {
  serveFiles(on, []);
  servePanes(on);
  const clock = start(on);
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [] } }));
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  await $.tool.call({ tool: 'TodoWrite', todos: Array.from({ length: 6 }, (_, i) => ({ content: `Step ${i}`, status: i === 0 ? 'in_progress' : 'pending', activeForm: `Doing step ${i}` })) });
  await clock.advance(1000);
  // Two rows: the kept card's header ending on the marker, then «↓ N more»: two rows, no more.
  const two = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'Pane', requestId: PANE, props: { ...PANE_PROPS, placement: 'inline' as const, scroll: { offset: 0, bodyRows: 2 } } });
  const rows2 = (await said(two)).split(' | ');
  expect(rows2).toHaveLength(3); // icon and title share the header row
  expect(rows2[1]!.endsWith('…')).toBe(true);
  expect(rows2[2]).toMatch(/^↓ \d+ more/);
  await two.unmount();
  // Three rows: the header, the marker, «↓ N more».
  const three = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'Pane', requestId: PANE, props: { ...PANE_PROPS, placement: 'inline' as const, scroll: { offset: 0, bodyRows: 3 } } });
  const rows3 = (await said(three)).split(' | ');
  expect(rows3.slice(-2)[0]).toBe('…');
  expect(rows3.at(-1)).toMatch(/^↓ \d+ more/);
  await three.unmount();
});

test('inline, a card with 53 task boxes or more takes its summary row too, so «↓ N more» stays in view (final review m-1)', async ($, on) => {
  const BIG = ['# Plan', ...Array.from({ length: 60 }, (_, i) => `### Task ${i + 1}: Step ${i + 1}\n- [ ] do it`)].join('\n');
  serveFiles(on, [], {
    [`${ROOT}/.superpowers/sdd/big/progress.md`]: { text: '# SDD ledger — plan: docs/superpowers/plans/big.md\n\n## Progress\nTasks 1-20: complete (abc..def)\nTask 21: fix round 1/3 (flaky)\n', mtimeMs: 9 },
    [`${ROOT}/docs/superpowers/plans/big.md`]: { text: BIG, mtimeMs: 9 },
  });
  servePanes(on);
  const clock = start(on);
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [] } }));
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  await $.tool.call({ tool: 'TodoWrite', todos: Array.from({ length: 6 }, (_, i) => ({ content: `Step ${i}`, status: i === 0 ? 'in_progress' : 'pending', activeForm: `Doing step ${i}` })) });
  await clock.advance(1000);
  // 54 columns inline: the cards' blocks have 52 cells, two rows of 26 boxes, so the 60 of the plan are summed up.
  const summed: boolean[] = [];
  for (const bodyRows of [6, 8, 10, 12, 14]) {
    const ui = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'Pane', requestId: PANE, props: { ...PANE_PROPS, bodyColumns: 54, placement: 'inline' as const, scroll: { offset: 0, bodyRows } } });
    const text = await said(ui);
    summed.push(/\+\d+ ■/.test(text));
    expect(rowsAt(await ui.drawn(), 54), `${bodyRows} rows`).toBeLessThanOrEqual(bodyRows);
    expect(text, `${bodyRows} rows`).toMatch(/↓ \d+ more · \/lens photo$/);
    await ui.unmount();
  }
  expect(summed).toContain(true);
});

test('inline at one row the pane draws one row: the kept card clipped, its title ending on «…», and no «↓» row (F-01)', async ($, on) => {
  serveFiles(on, []);
  servePanes(on);
  const clock = start(on);
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [] } }));
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  await $.tool.call({ tool: 'TodoWrite', todos: Array.from({ length: 6 }, (_, i) => ({ content: `Step ${i}`, status: i === 0 ? 'in_progress' : 'pending', activeForm: `Doing step ${i}` })) });
  await clock.advance(1000);
  const ui = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'Pane', requestId: PANE, props: { ...PANE_PROPS, placement: 'inline' as const, scroll: { offset: 0, bodyRows: 1 } } });
  const text = await said(ui);
  expect(text).not.toContain('↓');
  expect(text.endsWith('…')).toBe(true);
  expect(rowsOf(await ui.drawn())).toBe(1);
  await ui.unmount();
});
