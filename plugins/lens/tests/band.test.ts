import { expect, mock, test } from 'claude-code/testing';
import type { Engine } from 'claude-code/testing';
import type { On, RenderElement } from 'claude-code';

const SURFACES = ['terminal', 'desktop'] as const;
const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 9 }, view: {} };
const NOW = Date.parse('2026-10-11T10:05:00.000Z');
const ROOT = '/repo';

const norm = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '');

// A file system answered from memory; every path read, listed or stat'ed is recorded in `reads`.
function serveFiles(on: On, files: Record<string, { text: string; mtimeMs: number }>, reads: string[] = []) {
  on('session.root', () => ({ value: ROOT }));
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
    const names = new Map<string, 'file' | 'dir'>();
    for (const path of Object.keys(files)) {
      if (!path.startsWith(prefix)) continue;
      const [head = '', ...rest] = path.slice(prefix.length).split('/');
      names.set(head, rest.length ? 'dir' : 'file');
    }
    return names.size
      ? { value: [...names].map(([name, kind]) => ({ name, kind, size: 0, mtimeMs: 1, isLink: false })) }
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
