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
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '{}', stderr: '', interrupted: false } }) as never);
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
// w7 A5: todos no longer bring lens's band. A forge.cjs call that names a task this session works on does, for 10 minutes
// (forgeHeardAt), and draws nothing of its own while that task has no status.
const FORGE_CALL = { tool: 'Bash', command: 'node "/x/dist/forge.cjs" prep --task T009-1 --path medium', tool_use_id: 'f1' } as never;
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
  await $.tool.call(FORGE_CALL);
  expect(await buttons($)).toEqual([[], []]);
});

test('a waypoint project without the waypoint plugin still gets the lens minimal band', async ($, on) => {
  serveFiles(on, WAYPOINT_PROJECT);
  engineBand(on);
  start(on);
  on('command.list', () => ({ value: [] }));
  await $.session.start(SESSION);
  await $.tool.call(FORGE_CALL);
  expect(await buttons($)).toEqual([['panel', 'dismiss'], ['panel', 'dismiss']]);
});

test('a plan without a session still gets the lens minimal band', async ($, on) => {
  serveFiles(on, PLAN_ONLY);
  engineBand(on);
  start(on);
  on('command.list', () => ({ value: [WAYPOINT_COMMAND] }));
  await $.session.start(SESSION);
  await $.tool.call(FORGE_CALL);
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
  await $.tool.call(FORGE_CALL);
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
  await $.tool.call(FORGE_CALL);
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
  await $.tool.call(FORGE_CALL);
  expect(await buttons($)).toEqual([[], []]);
});

test('with the waypoint band closed with ×, lens draws its minimal band (F-16)', async ($, on) => {
  serveFiles(on, WAYPOINT_PROJECT);
  engineBand(on);
  start(on);
  on('command.list', () => ({ value: [WAYPOINT_COMMAND] }));
  serveWaypointState(on, { hidden: true });
  await $.session.start(SESSION);
  await $.tool.call(FORGE_CALL);
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
  await $.tool.call(FORGE_CALL);
  expect(await buttons($)).toEqual([['panel', 'dismiss'], ['panel', 'dismiss']]);
  state.drawn = true;
  expect(await buttons($)).toEqual([[], []]);
});

test("waypoint's own word wins over its × flag: drawn false with hidden set draws lens's band, a later drawn true takes it away (carry 2)", async ($, on) => {
  serveFiles(on, WAYPOINT_PROJECT);
  engineBand(on);
  start(on);
  on('command.list', () => ({ value: [WAYPOINT_COMMAND] }));
  const state = { hidden: true, drawn: false };
  serveWaypointState(on, state);
  await $.session.start(SESSION);
  await $.tool.call(FORGE_CALL);
  expect(await buttons($)).toEqual([['panel', 'dismiss'], ['panel', 'dismiss']]);
  state.drawn = true;
  expect(await buttons($)).toEqual([[], []]);
});

test('a waypoint unloaded mid-session leaves its last drawn behind: within a tick lens takes it as unsaid and draws its band (carry 2)', async ($, on) => {
  serveFiles(on, WAYPOINT_PROJECT);
  engineBand(on);
  const clock = start(on);
  let commands = [WAYPOINT_COMMAND];
  on('command.list', () => ({ value: commands }));
  serveWaypointState(on, { drawn: true });
  await $.session.start(SESSION);
  await $.tool.call(FORGE_CALL);
  expect(await buttons($)).toEqual([[], []]);
  commands = [];
  await clock.advance(30_000);
  expect(await buttons($)).toEqual([['panel', 'dismiss'], ['panel', 'dismiss']]);
});

test("an x within 5 s of waypoint's band going does not close lens's band, which took its place; a later one does (final review m-4)", async ($, on) => {
  serveFiles(on, WAYPOINT_PROJECT);
  engineBand(on);
  const clock = start(on);
  on('command.list', () => ({ value: [WAYPOINT_COMMAND] }));
  const state = { drawn: true };
  serveWaypointState(on, state);
  await $.session.start(SESSION);
  await $.tool.call(FORGE_CALL);
  const mount = () => $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS });
  let ui = await mount();
  expect(await ui.find({ key: 'panel' })).toBeUndefined();
  await ui.unmount();
  // waypoint's × takes its band away; lens's takes the site, and the second x of a double tap lands on it.
  state.drawn = false;
  ui = await mount();
  expect(await ui.find({ key: 'panel' })).toBeDefined();
  await ui.press({ key: 'dismiss' });
  await ui.unmount();
  ui = await mount();
  expect(await ui.find({ key: 'panel' })).toBeDefined();
  await clock.advance(5_000);
  await ui.press({ key: 'dismiss' });
  await ui.unmount();
  ui = await mount();
  expect(await ui.find({ key: 'panel' })).toBeUndefined();
  await ui.unmount();
});

test("lens's × closes its band for what it is about: todos that move on keep it closed, a task of this session brings it back (final review m-4)", async ($, on) => {
  const files: Record<string, { text: string; mtimeMs: number }> = {};
  serveFiles(on, files);
  engineBand(on);
  const clock = start(on);
  on('command.list', () => ({ value: [] }));
  await $.session.start(SESSION);
  await $.tool.call(FORGE_CALL);
  // The same list throughout (re-review m-4 keys it by its items): only its statuses move on.
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'a', status: 'in_progress', activeForm: 'a' }, { content: 'b', status: 'pending', activeForm: 'b' }] });
  await clock.advance(30_000);
  const mount = () => $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS });
  let ui = await mount();
  await ui.press({ key: 'dismiss' });
  await ui.unmount();
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'a', status: 'completed', activeForm: 'a' }, { content: 'b', status: 'in_progress', activeForm: 'b' }] });
  await clock.advance(30_000);
  ui = await mount();
  expect(await ui.find({ key: 'panel' })).toBeUndefined();
  await ui.unmount();
  files[`${ROOT}/.forge/status/T002.json`] = { text: status('T002'), mtimeMs: NOW };
  await $.tool.call({ tool: 'Bash', command: 'node "/x/dist/forge.cjs" prep --task T002-1 --path medium', tool_use_id: 'b1' } as never);
  await clock.advance(30_000);
  ui = await mount();
  expect(await ui.find({ key: 'panel' })).toBeDefined();
  expect(await lineOf(ui)).toContain('T002');
  await ui.unmount();
});

test("lens's × on the todos holds while the list moves on, and a new todo brings the band back (re-review m-4)", async ($, on) => {
  serveFiles(on, {});
  engineBand(on);
  const clock = start(on);
  on('command.list', () => ({ value: [] }));
  const todo = (content: string, status: 'pending' | 'in_progress' | 'completed') => ({ content, status, activeForm: content });
  const mount = () => $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS });
  await $.session.start(SESSION);
  await $.tool.call(FORGE_CALL);
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('a', 'in_progress'), todo('b', 'pending')] });
  await clock.advance(30_000);
  let ui = await mount();
  await ui.press({ key: 'dismiss' });
  await ui.unmount();
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('a', 'completed'), todo('b', 'in_progress')] });
  await clock.advance(30_000);
  ui = await mount();
  expect(await ui.find({ key: 'panel' })).toBeUndefined();
  await ui.unmount();
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('a', 'completed'), todo('b', 'in_progress'), todo('c', 'pending')] });
  await clock.advance(30_000);
  ui = await mount();
  expect(await ui.find({ key: 'panel' })).toBeDefined();
  await ui.unmount();
});

test("lens's × on the subagents holds for those agents, and a new one brings the band back (re-review m-4)", async ($, on) => {
  serveFiles(on, {});
  engineBand(on);
  const clock = start(on);
  on('command.list', () => ({ value: [] }));
  // w8 M1: a subagent starts at its spawn (the engine answers with the call's tool_use_id as its id).
  on('agent.spawn', (_$, e) => ({ model: 'claude-sonnet-5-5', agentId: e.tool_use_id }));
  const spawn = (id: string) => $.agent.spawn({
    tool_use_id: id, prompt: 'Look around', description: '', subagentType: 'Explore', provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5', background: true, fork: false,
  } as never);
  const mount = () => $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS });
  await $.session.start(SESSION);
  await spawn('a1');
  await clock.advance(30_000);
  let ui = await mount();
  expect(await ui.find({ key: 'panel' })).toBeDefined();
  await ui.press({ key: 'dismiss' });
  await ui.unmount();
  await clock.advance(30_000);
  ui = await mount();
  expect(await ui.find({ key: 'panel' })).toBeUndefined();
  await ui.unmount();
  await spawn('a2');
  await clock.advance(30_000);
  ui = await mount();
  expect(await ui.find({ key: 'panel' })).toBeDefined();
  await ui.unmount();
});

test('a command listing that fails keeps waypoint loaded: its own drawn still keeps lens off the site (re-review m-5)', async ($, on) => {
  serveFiles(on, WAYPOINT_PROJECT);
  engineBand(on);
  const clock = start(on);
  let fails = false;
  on('command.list', () => {
    if (fails) throw new Error('listing refused');
    return { value: [WAYPOINT_COMMAND] };
  });
  serveWaypointState(on, { drawn: true });
  await $.session.start(SESSION);
  await $.tool.call(FORGE_CALL);
  expect(await buttons($)).toEqual([[], []]);
  fails = true;
  await clock.advance(30_000);
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
  await $.tool.call(FORGE_CALL);
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
  await $.tool.call(FORGE_CALL);
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

test("under 30 columns lens's band still draws its two buttons, and what is left of its line fits beside them (carry 6)", async ($, on) => {
  serveFiles(on, {});
  engineBand(on);
  start(on);
  on('command.list', () => ({ value: [] }));
  await $.session.start(SESSION);
  await $.tool.call(FORGE_CALL);
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'a', status: 'in_progress', activeForm: 'Writing the parser for every configuration file' }] });
  for (const bodyColumns of [12, 16, 20, 24, 28]) {
    for (const isFullscreen of [true, false]) {
      const ui = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'AbovePrompt', props: { ...BAND_PROPS, bodyColumns }, viewport: { columns: bodyColumns + 5, rows: 30, isFullscreen } });
      const where = `${bodyColumns} ${isFullscreen}`;
      expect((await ui.findAll({ type: 'Button' })).map(b => b.key), where).toEqual(['panel', 'dismiss']);
      const buttons = isFullscreen ? 1 + '[ Panel ]'.length + 1 + '[ × ]'.length : 1 + 'p: Panel'.length + 1 + 'x: ×'.length;
      const line = (await lineOf(ui)) ?? '';
      if (line) expect(2 + [...line].length + buttons, where).toBeLessThanOrEqual(bodyColumns);
      await ui.unmount();
    }
  }
});

test("lens's hint follows its band's state, not its last drawing: there before any drawing, gone once × closes it (carry 3)", async ($, on) => {
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
  await $.tool.call(FORGE_CALL);
  const viewport = { columns: 105, rows: 30, isFullscreen: false };
  const HINT = { plugin: 'lens' as const, surface: 'terminal' as const, component: 'PromptHint' as const, props: { isDraft: false, isWorking: false, hint: '?' }, viewport };
  let hint = await $.ui.mount(HINT);
  expect(tails.at(-1)).toBe('ctrl+x tab · band');
  await hint.unmount();
  const ui = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS, viewport });
  await ui.press({ key: 'dismiss' });
  await ui.unmount();
  hint = await $.ui.mount(HINT);
  expect(tails.at(-1)).toBeUndefined();
  await hint.unmount();
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
  await $.tool.call(FORGE_CALL);
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
