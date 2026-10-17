import { expect, mock, test } from 'claude-code/testing';
import type { Engine } from 'claude-code/testing';
import type { On, RenderElement } from 'claude-code';

const SURFACES = ['terminal', 'desktop'] as const;
const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 9 }, view: {} };
const NOW = Date.parse('2026-10-11T10:05:00.000Z');
const ROOT = '/repo';
const SESSION_ID = 'conv-1';

const norm = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '');

// A file system answered from memory; every path read, listed or stat'ed is recorded in `reads`.
function serveFiles(on: On, files: Record<string, { text: string; mtimeMs: number }>, reads: string[] = []) {
  on('session.root', () => ({ value: ROOT }));
  on('session.id', () => ({ value: SESSION_ID }));
  on('fs.read', (_$, e) => {
    reads.push(norm(e.path));
    const f = files[norm(e.path)];
    return f ? { value: f.text } : { deny: `ENOENT ${e.path}` };
  });
  on('fs.exists', (_$, e) => ({ value: norm(e.path) in files }));
  on('fs.stat', (_$, e) => {
    reads.push(norm(e.path));
    const f = files[norm(e.path)];
    return f ? { value: { kind: 'file' as const, size: 0, mtimeMs: f.mtimeMs, isLink: false } } : { deny: `ENOENT ${e.path}` };
  });
  on('fs.list', (_$, e) => {
    reads.push(norm(e.path));
    const prefix = `${norm(e.path)}/`;
    const names = new Map<string, { kind: 'file' | 'dir'; size: number; mtimeMs: number }>();
    for (const [path, f] of Object.entries(files)) {
      if (!path.startsWith(prefix)) continue;
      const [head = '', ...rest] = path.slice(prefix.length).split('/');
      names.set(head, rest.length ? { kind: 'dir', size: 0, mtimeMs: 1 } : { kind: 'file', size: f.text.length, mtimeMs: f.mtimeMs });
    }
    return names.size
      ? { value: [...names].map(([name, x]) => ({ name, ...x, isLink: false })) }
      : { deny: `ENOENT ${e.path}` };
  });
}

// What the engine draws of its own beneath the plugin, so a pass (next) is visible.
function engineBand(on: On) {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return h(Text, {}, 'engine band') as RenderElement;
  });
}

function start(on: On) {
  const clock = mock.clock(on, { now: NOW });
  on('session.start', (_$, e) => ({ cwd: e.cwd }));
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [] } }));
  return clock;
}

// waypoint's own flags as lens reads them (any plugin reads any value), answered beneath lens on state.get.
function serveWaypointState(on: On, state: { drawn?: boolean | null; hidden?: boolean }) {
  on('state.get', (_$, e, next) => (e.plugin === 'waypoint' && Object.hasOwn(state, e.key)
    ? { value: { value: (state as Record<string, unknown>)[e.key], version: 1 } }
    : next(e)));
}

// The band's line as drawn: every string under the Box keyed band-line, nested Texts included.
function strings(n: unknown, out: string[] = []): string[] {
  if (typeof n === 'string') out.push(n);
  else if (Array.isArray(n)) for (const c of n) strings(c, out);
  else if (n && typeof n === 'object') strings((n as { children?: unknown }).children, out);
  return out;
}
async function lineOf(ui: { drawn: () => Promise<unknown> }): Promise<string | undefined> {
  const find = (n: unknown): { children?: unknown } | undefined => {
    if (Array.isArray(n)) { for (const c of n) { const hit = find(c); if (hit) return hit; } return undefined; }
    if (!n || typeof n !== 'object') return undefined;
    const el = n as { props?: Record<string, unknown>; children?: unknown };
    return el.props?.key === 'band-line' ? el : find(el.children);
  };
  const box = find(await ui.drawn());
  return box ? strings(box.children).join('') : undefined;
}
// A forge task status of this conversation, as forge writes it in .forge/status/ (wave 3).
const status = (task: string, over: object = {}) => JSON.stringify({
  ts: new Date(NOW - 60_000).toISOString(), task, path: 'medium', phase: 'implement', agent: 'forge-impl', validators: [], verdict: null, round: null, cap: null,
  taskStartedAt: new Date(NOW - 600_000).toISOString(), stageSince: new Date(NOW - 60_000).toISOString(), stages: {}, doneAt: null,
  lastAt: new Date(NOW - 60_000).toISOString(), session: SESSION_ID, runId: null, project: null, ...over,
});

const SESSION = { cwd: ROOT, surface: 'terminal' as const, isInteractive: true };
const TODOS = { tool: 'TodoWrite' as const, todos: [{ content: 'a', status: 'in_progress' as const, activeForm: 'a' }] };
// A waypoint project this session has joined, which waypoint draws a band for: a plan and its session.
const SHOP_PLAN = `project: shop
locale: es
version: "0.1"
versions:
  - id: "0.1"
    phases: [F1]
tracks:
  - { id: backend, name: Backend, color: blue }
phases:
  - { id: F1, name: Base, plan_status: committed }
tasks:
  - id: T001
    title: Esquema de pedidos
    track: backend
    phase: F1
    done_when: migración aplicada
    zones: ["src/db/**"]
`;
const PLAN_ONLY = { [`${ROOT}/docs/waypoint/shop/plan.yaml`]: { text: SHOP_PLAN, mtimeMs: 1 } };
const WAYPOINT_PROJECT = {
  ...PLAN_ONLY,
  [`${ROOT}/.waypoint/shop/session.json`]: { text: JSON.stringify({ sessionId: 'S1', track: 'backend' }), mtimeMs: 1 },
  [`${ROOT}/.waypoint/shop/bound.json`]: {
    text: JSON.stringify({ sid: 'S1', claude: SESSION_ID, pid: null, via: 'work', since: '2026-10-11T09:00:00.000Z', seenAt: '2026-10-11T10:04:00.000Z', endedAt: null, endReason: null }),
    mtimeMs: 1,
  },
};
const WAYPOINT_COMMAND = { name: 'waypoint:work', description: 'Work', source: 'plugin' as const, plugin: 'waypoint' };

async function buttons($: Engine) {
  const out: (string | undefined)[][] = [];
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'lens', surface, component: 'AbovePrompt', props: BAND_PROPS });
    out.push((await ui.findAll({ type: 'Button' })).map(b => b.key));
    await ui.unmount();
  }
  return out;
}

test('with a waypoint project and the waypoint plugin, lens leaves the band to waypoint', async ($, on) => {
  serveFiles(on, WAYPOINT_PROJECT);
  engineBand(on);
  start(on);
  on('command.list', () => ({ value: [WAYPOINT_COMMAND] }));
  await $.session.start(SESSION);
  await $.tool.call(TODOS);
  expect(await buttons($)).toEqual([[], []]);
});

test('a waypoint project without the waypoint plugin still gets the lens minimal band', async ($, on) => {
  serveFiles(on, WAYPOINT_PROJECT);
  engineBand(on);
  start(on);
  on('command.list', () => ({ value: [] }));
  await $.session.start(SESSION);
  await $.tool.call(TODOS);
  expect(await buttons($)).toEqual([['panel', 'dismiss'], ['panel', 'dismiss']]);
});

test('a plan without a session still gets the lens minimal band', async ($, on) => {
  serveFiles(on, PLAN_ONLY);
  engineBand(on);
  start(on);
  on('command.list', () => ({ value: [WAYPOINT_COMMAND] }));
  await $.session.start(SESSION);
  await $.tool.call(TODOS);
  expect(await buttons($)).toEqual([['panel', 'dismiss'], ['panel', 'dismiss']]);
});

test('no activity reads no waypoint files for the band', async ($, on) => {
  const reads: string[] = [];
  serveFiles(on, WAYPOINT_PROJECT, reads);
  engineBand(on);
  const clock = start(on);
  on('command.list', () => ({ value: [WAYPOINT_COMMAND] }));
  await $.session.start(SESSION);
  await buttons($);
  await clock.advance(31000);
  await buttons($);
  expect(reads.filter(p => p.includes('/docs/waypoint/'))).toEqual([]);
});

test('the 30 s tick hands the band to waypoint once its project is joined', async ($, on) => {
  const files: Record<string, { text: string; mtimeMs: number }> = {};
  serveFiles(on, files);
  engineBand(on);
  const clock = start(on);
  on('command.list', () => ({ value: [WAYPOINT_COMMAND] }));
  await $.session.start(SESSION);
  await $.tool.call(TODOS);
  expect(await buttons($)).toEqual([['panel', 'dismiss'], ['panel', 'dismiss']]);
  Object.assign(files, WAYPOINT_PROJECT);
  await clock.advance(30000);
  expect(await buttons($)).toEqual([[], []]);
});

test("the lens minimal band stacks over another plugin's band beneath", async ($, on) => {
  serveFiles(on, {});
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return h(Text, {}, 'other band') as RenderElement;
  });
  start(on);
  on('command.list', () => ({ value: [] }));
  await $.session.start(SESSION);
  await $.tool.call(TODOS);
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'lens', surface, component: 'AbovePrompt', props: BAND_PROPS });
    expect(await ui.find({ key: 'panel' })).toBeDefined();
    expect(await ui.find({ text: 'other band' })).toBeDefined();
    // Our band comes first in the column: its Panel button is drawn before the band beneath.
    const order: string[] = [];
    const walk = (n: unknown): void => {
      if (typeof n === 'string') { order.push(n); return; }
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (!n || typeof n !== 'object') return;
      const el = n as { props?: Record<string, unknown>; children?: unknown };
      if (typeof el.props?.key === 'string') order.push(`key:${el.props.key}`);
      walk(el.children);
    };
    walk(await ui.drawn());
    expect(order.indexOf('key:panel')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('other band')).toBeGreaterThan(order.indexOf('key:panel'));
    await ui.unmount();
  }
});

test('a waypoint command the engine does not attribute still counts as the waypoint plugin', async ($, on) => {
  serveFiles(on, WAYPOINT_PROJECT);
  engineBand(on);
  start(on);
  on('command.list', () => ({ value: [{ name: 'waypoint:work', description: 'Work', source: 'plugin' as const }] }));
  await $.session.start(SESSION);
  await $.tool.call(TODOS);
  expect(await buttons($)).toEqual([[], []]);
});

test('with the waypoint band closed with ×, lens draws its minimal band (F-16)', async ($, on) => {
  serveFiles(on, WAYPOINT_PROJECT);
  engineBand(on);
  start(on);
  on('command.list', () => ({ value: [WAYPOINT_COMMAND] }));
  serveWaypointState(on, { hidden: true });
  await $.session.start(SESSION);
  await $.tool.call(TODOS);
  expect(await buttons($)).toEqual([['panel', 'dismiss'], ['panel', 'dismiss']]);
});

test('waypoint says whether it draws: a dismissed notice (drawn false) leaves the band to lens, its own band (drawn true) does not (F-16)', async ($, on) => {
  serveFiles(on, WAYPOINT_PROJECT);
  engineBand(on);
  start(on);
  on('command.list', () => ({ value: [WAYPOINT_COMMAND] }));
  const state = { drawn: false };
  serveWaypointState(on, state);
  await $.session.start(SESSION);
  await $.tool.call(TODOS);
  expect(await buttons($)).toEqual([['panel', 'dismiss'], ['panel', 'dismiss']]);
  state.drawn = true;
  expect(await buttons($)).toEqual([[], []]);
});

test("lens's band names this session's tasks in progress, each as short as a band says it (F-09)", async ($, on) => {
  const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
  const touched = NOW - 60_000;
  serveFiles(on, {
    [`${ROOT}/.forge/status/T001.json`]: { text: status('T001', { lastAt: ago(1) }), mtimeMs: touched },
    [`${ROOT}/.forge/status/T002.json`]: { text: status('T002', { phase: 'review', round: 2, lastAt: ago(2) }), mtimeMs: touched },
    [`${ROOT}/.forge/status/T003.json`]: { text: status('T003', { phase: 'validate', lastAt: ago(3) }), mtimeMs: touched },
  });
  engineBand(on);
  const clock = start(on);
  on('command.list', () => ({ value: [] }));
  await $.session.start(SESSION);
  await $.tool.call(TODOS);
  await clock.advance(30_000);
  const ui = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS });
  expect(await lineOf(ui)).toBe('T001 impl · T002 rev r2 · T003 val');
  await ui.unmount();
});

test("lens's band fits the width: at 80 columns its parts and measured buttons stay within it, at 160 it adds its bar and boxes (F-12)", async ($, on) => {
  serveFiles(on, {});
  engineBand(on);
  const clock = start(on);
  on('command.list', () => ({ value: [] }));
  await $.session.start(SESSION);
  await $.tool.call({ tool: 'TodoWrite', todos: [
    { content: 'a', status: 'completed', activeForm: 'A' },
    { content: 'b', status: 'in_progress', activeForm: 'Writing the parser for every configuration file of the whole project' },
    { content: 'c', status: 'pending', activeForm: 'C' },
  ] });
  await clock.advance(30_000);
  const mount = (bodyColumns: number) => $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'AbovePrompt', props: { ...BAND_PROPS, bodyColumns } });
  let ui = await mount(80);
  const line = (await lineOf(ui)) ?? '';
  expect(line).toContain('1/3');
  expect(2 + line.length + 1 + '[ Panel ]'.length + 1 + '[ × ]'.length).toBeLessThanOrEqual(80);
  expect(await ui.find({ key: 'band-bar' })).toBeUndefined();
  expect(await ui.find({ key: 'band-cells' })).toBeUndefined();
  await ui.unmount();
  ui = await mount(160);
  expect(await lineOf(ui)).toBe('Writing the parser for every configuration file of the whole project · 1/3');
  expect(await ui.find({ key: 'band-bar' })).toBeDefined();
  expect(await ui.find({ key: 'band-cells' })).toBeDefined();
  await ui.unmount();
});

test("lens's band buttons have their letters, plain outside fullscreen, and the hint line says ctrl+x tab (F-06)", async ($, on) => {
  serveFiles(on, {});
  engineBand(on);
  start(on);
  on('command.list', () => ({ value: [] }));
  const tails: (string | undefined)[] = [];
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    tails.push(e.props.tail);
    const { Text } = $.ui.resolve(e);
    return h(Text, {}, e.props.hint) as RenderElement;
  });
  await $.session.start(SESSION);
  await $.tool.call(TODOS);
  for (const isFullscreen of [true, false]) {
    const viewport = { columns: 105, rows: 30, isFullscreen };
    const ui = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS, viewport });
    const plain = isFullscreen ? undefined : true;
    expect((await ui.findAll({ type: 'Button' })).map(b => [b.key, b.props.hotkey, b.props.plain])).toEqual([['panel', 'p', plain], ['dismiss', 'x', plain]]);
    const hint = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'PromptHint', props: { isDraft: false, isWorking: false, hint: '?' }, viewport });
    expect(tails.at(-1), String(isFullscreen)).toBe(isFullscreen ? undefined : 'ctrl+x tab · band');
    await hint.unmount();
    await ui.unmount();
  }
});
