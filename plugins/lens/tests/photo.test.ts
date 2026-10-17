import { expect, mock, test } from 'claude-code/testing';
import type { On, RenderElement } from 'claude-code';

const PANE = 'lens';
const ROOT = '/repo';
const SESSION_ID = 'conv-1';
const NOW = Date.parse('2026-10-11T10:05:00.000Z');
const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 9 }, view: {} };
const RUN = { command: 'lens', args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } };
const MAIN_SCREEN = { columns: 100, rows: 30, isFullscreen: false };
// A superpowers run on a file system answered from memory, touched a minute ago.
const PLAN = ['# Plan', ...Array.from({ length: 4 }, (_, i) => `### Task ${i + 1}: Step ${i + 1}\n- [ ] do it`)].join('\n');
const FILES: Record<string, string> = {
  [`${ROOT}/.superpowers/sdd/run/progress.md`]: '# SDD ledger — plan: docs/superpowers/plans/run.md\n\n## Progress\nTask 1: complete (abc)\nTask 2: fix round 1/3 (flaky)\n',
  [`${ROOT}/docs/superpowers/plans/run.md`]: PLAN,
};
const norm = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '');

function serveFiles(on: On) {
  const entry = (name: string, kind: 'file' | 'dir', size: number) => ({ name, kind, size, mtimeMs: NOW - 60_000, isLink: false });
  on('session.root', () => ({ value: ROOT }));
  on('session.id', () => ({ value: SESSION_ID }));
  on('fs.read', (_$, e) => { const f = FILES[norm(e.path)]; return f !== undefined ? { value: f } : { deny: `ENOENT ${e.path}` }; });
  on('fs.exists', (_$, e) => ({ value: norm(e.path) in FILES }));
  on('fs.stat', (_$, e) => {
    const f = FILES[norm(e.path)];
    return f !== undefined ? { value: { kind: 'file' as const, size: f.length, mtimeMs: NOW - 60_000, isLink: false } } : { deny: `ENOENT ${e.path}` };
  });
  on('fs.list', (_$, e) => {
    const prefix = `${norm(e.path)}/`;
    const names = new Map<string, ReturnType<typeof entry>>();
    for (const [path, text] of Object.entries(FILES)) {
      if (!path.startsWith(prefix)) continue;
      const [head = '', ...rest] = path.slice(prefix.length).split('/');
      names.set(head, entry(head, rest.length ? 'dir' : 'file', rest.length ? 0 : text.length));
    }
    return names.size ? { value: [...names.values()] } : { deny: `ENOENT ${e.path}` };
  });
}

function servePanes(on: On) {
  const open = new Set<string>();
  on('ui.open', (_$, e) => { open.add(e.id); return { value: { isPlaced: true as const } }; });
  on('ui.close', (_$, e) => { open.delete(e.id); return { value: undefined }; });
  on('ui.panes', () => ({ value: [...open].map(id => ({ id, title: 'lens', isShown: true, isFocused: false, isPlaced: true })) }));
  return open;
}

function start(on: On) {
  mock.clock(on, { now: NOW });
  on('session.start', (_$, e) => ({ cwd: e.cwd }));
  on('agent.list', () => ({ value: [] }));
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [] } }));
}

// The engine's own rows beneath lens: a command's output line and the band, as drawn when no hook draws them.
function engineRows(on: On) {
  on('ui.render', { component: 'CommandOutput' }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return h(Text, {}, `engine: ${e.props.text}`) as RenderElement;
  });
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return h(Text, {}, 'engine band') as RenderElement;
  });
}

// Everything a drawing says, in order: Text strings and Button labels.
async function said(ui: { drawn: () => Promise<unknown> }): Promise<string> {
  const out: string[] = [];
  const walk = (n: unknown): void => {
    if (typeof n === 'string') { out.push(n); return; }
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!n || typeof n !== 'object') return;
    const el = n as { type?: string; props?: Record<string, unknown>; children?: unknown };
    if (el.type === 'Button' && typeof el.props?.label === 'string') out.push(el.props.label);
    walk(el.children);
  };
  walk(await ui.drawn());
  return out.join(' | ');
}

const OUTPUT = (text: string) => ({ command: 'lens', args: '', text, isErrored: false });
const SESSION = { cwd: ROOT, surface: 'terminal' as const, isInteractive: true };

test('outside fullscreen /lens leaves a photo: one stamped line, no pane, and its row draws the cards still (steps 2 and 3, F-15)', async ($, on) => {
  serveFiles(on);
  const open = servePanes(on);
  engineRows(on);
  start(on);
  await $.session.start(SESSION);
  const ran = await $.command.run({ ...RUN, presentation: { isFullscreen: false, columns: 160 } });
  expect(ran.text).toMatch(/^lens · \d\d:\d\d:\d\d #1 · no tasks$/);
  expect(open.has(PANE)).toBe(false);
  const row = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'CommandOutput', props: OUTPUT(ran.text!), viewport: MAIN_SCREEN });
  const text = await said(row);
  expect(text).toContain(ran.text!);
  expect(text).toContain('docs/superpowers/plans/run.md');
  expect(text).not.toContain('engine:');
  await row.unmount();
});

test('/lens live opens the pane anywhere, /lens foto gives a photo anywhere, and in fullscreen at 100 columns /lens gives a photo (F-01)', async ($, on) => {
  serveFiles(on);
  const open = servePanes(on);
  start(on);
  await $.session.start(SESSION);
  expect((await $.command.run({ ...RUN, args: 'live', presentation: { isFullscreen: false, columns: 80 } })).text).toBe('Progress panel opened.');
  expect(open.has(PANE)).toBe(true);
  open.delete(PANE); // the test kit has no $.ui.close: the person closes the pane
  expect((await $.command.run({ ...RUN, args: 'foto' })).text).toMatch(/^lens · .+ #\d+ · /);
  expect((await $.command.run({ ...RUN, args: 'photo' })).text).toMatch(/^lens · .+ #\d+ · /);
  expect((await $.command.run({ ...RUN, presentation: { isFullscreen: true, columns: 100 } })).text).toMatch(/^lens · .+ #\d+ · /);
  expect(open.has(PANE)).toBe(false);
});

test("a /lens line lens does not hold stays the engine's row, and only the newest 20 photos are kept (Review Focus 4)", async ($, on) => {
  serveFiles(on);
  servePanes(on);
  engineRows(on);
  start(on);
  await $.session.start(SESSION);
  const made: string[] = [];
  for (let i = 0; i < 21; i++) made.push((await $.command.run({ ...RUN, args: 'foto' })).text!);
  for (const [text, engine] of [['lens · 10:00:00 #999 · 3 tasks', true], [made[0], true], [made[20], false]] as const) {
    const row = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'CommandOutput', props: OUTPUT(text), viewport: MAIN_SCREEN });
    expect((await said(row)).includes(`engine: ${text}`), text).toBe(engine);
    await row.unmount();
  }
});

test("outside fullscreen the band's Panel button takes a photo instead of opening the pane (§4.6, step 2)", async ($, on) => {
  serveFiles(on);
  const open = servePanes(on);
  engineRows(on);
  start(on);
  // The kit does not route a plugin's own $.command.run to its hook: the press is recorded, then the command is run as
  // the engine would run it with that presentation.
  const ran: string[] = [];
  on('command.run', (_$, e) => { ran.push(`/${e.command} ${e.args}`.trimEnd()); return { text: '' }; });
  await $.session.start(SESSION);
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'a', status: 'pending', activeForm: 'A' }] });
  const band = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS, viewport: { columns: 105, rows: 30, isFullscreen: false } });
  await band.press({ key: 'panel' });
  await band.unmount();
  expect(ran).toEqual(['/lens foto']);
  expect(open.has(PANE)).toBe(false);
});
