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

function serveFiles(on: On, reads: string[] = [], extra: Record<string, string> = {}) {
  const FILES_SERVED: Record<string, string> = { ...FILES, ...extra };
  const entry = (name: string, kind: 'file' | 'dir', size: number) => ({ name, kind, size, mtimeMs: NOW - 60_000, isLink: false });
  on('session.root', () => ({ value: ROOT }));
  on('session.id', () => ({ value: SESSION_ID }));
  on('fs.read', (_$, e) => { reads.push(e.path); const f = FILES_SERVED[norm(e.path)]; return f !== undefined ? { value: f } : { deny: `ENOENT ${e.path}` }; });
  on('fs.exists', (_$, e) => ({ value: norm(e.path) in FILES_SERVED }));
  on('fs.stat', (_$, e) => {
    const f = FILES_SERVED[norm(e.path)];
    return f !== undefined ? { value: { kind: 'file' as const, size: f.length, mtimeMs: NOW - 60_000, isLink: false } } : { deny: `ENOENT ${e.path}` };
  });
  on('fs.list', (_$, e) => {
    const prefix = `${norm(e.path)}/`;
    const names = new Map<string, ReturnType<typeof entry>>();
    for (const [path, text] of Object.entries(FILES_SERVED)) {
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
  const clock = mock.clock(on, { now: NOW });
  on('session.start', (_$, e) => ({ cwd: e.cwd }));
  on('agent.list', () => ({ value: [] }));
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [] } }));
  return clock;
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

// The widest bar a drawing holds: a row Box whose Texts are all bar cells, as term.tsx draws a bar without a Client.
function widestBar(n: unknown): number {
  if (Array.isArray(n)) return Math.max(0, ...n.map(widestBar));
  if (!n || typeof n !== 'object') return 0;
  const el = n as { type?: string; props?: Record<string, unknown>; children?: unknown };
  const kids = Array.isArray(el.children) ? el.children : [el.children];
  const texts = kids.map(k => (k && typeof k === 'object' && (k as { type?: string }).type === 'Text' ? (k as { children?: unknown }).children : null));
  const cells = texts.map(c => (Array.isArray(c) ? c.join('') : typeof c === 'string' ? c : null));
  if (el.type === 'Box' && el.props?.flexDirection === 'row' && cells.length && cells.every(c => c !== null && /^[█▏▎▍▌▋▊▉]*$/.test(c))) {
    return cells.reduce((w, c) => w + [...c!].length, 0);
  }
  return widestBar(el.children);
}
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

test("a photo row is drawn only for the line it was taken for: after a reload the counter restarts, and an old #1 line is the engine's (Review Focus 4)", async ($, on) => {
  serveFiles(on);
  servePanes(on);
  engineRows(on);
  start(on);
  await $.session.start(SESSION);
  const taken = (await $.command.run({ ...RUN, args: 'foto' })).text!;
  // The same number with another time: what a transcript row of an earlier process looks like once the counter restarts.
  const old = taken.replace(/\d\d:\d\d:\d\d/, '03:04:05');
  expect(old).not.toBe(taken);
  const stale = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'CommandOutput', props: OUTPUT(old), viewport: MAIN_SCREEN });
  expect(await said(stale)).toContain(`engine: ${old}`);
  await stale.unmount();
  const own = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'CommandOutput', props: OUTPUT(taken), viewport: MAIN_SCREEN });
  expect(await said(own)).not.toContain('engine:');
  await own.unmount();
});

test('a photo reads the files once, writes no state, starts no timer, and its rows fit the viewport (cost zero)', async ($, on) => {
  const reads: string[] = [];
  const written: string[] = [];
  serveFiles(on, reads);
  servePanes(on);
  const clock = start(on);
  on('state.set', (_$, e, next) => { written.push(`${e.plugin}.${e.key}`); return next(e); });
  await $.session.start(SESSION);
  reads.length = 0;
  written.length = 0;
  const first = (await $.command.run({ ...RUN, args: 'foto' })).text!;
  const readsOne = reads.length;
  expect(readsOne).toBeGreaterThan(0);
  // A second photo reads the same again, not more: nothing accumulates between commands.
  reads.length = 0;
  await $.command.run({ ...RUN, args: 'foto' });
  expect(reads.length).toBeLessThanOrEqual(readsOne);
  expect(written).toEqual([]);
  reads.length = 0;
  await clock.advance(600_000);
  expect(reads).toEqual([]);
  expect(written).toEqual([]);
  // Every row of the drawing fits the viewport, however narrow: measured on what is drawn, the bar's cells two in from the
  // edge (carry 7: the props alone may hold no width to check).
  for (const columns of [30, 60]) {
    const row = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'CommandOutput', props: OUTPUT(first), viewport: { columns, rows: 30, isFullscreen: false } });
    const drawn = await row.drawn();
    expect(JSON.stringify(drawn)).toContain('docs/superpowers/plans/run.md'.slice(0, 10));
    expect(widestBar(drawn), `bar at ${columns} columns`).toBeGreaterThan(0);
    expect(widestBar(drawn) + 2, `bar at ${columns} columns`).toBeLessThanOrEqual(columns);
    await row.unmount();
  }
});

test('a photo taken with the pane closed asks the agents list first: a subagent that ended is not drawn as running (carry 7)', async ($, on) => {
  serveFiles(on);
  servePanes(on);
  engineRows(on);
  start(on);
  on('classic.SubagentStart', () => ({}));
  await $.session.start(SESSION);
  await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'Explore' } as never);
  // The agents list (empty) says it ended; nothing asked it while the pane was closed.
  const shot = (await $.command.run({ ...RUN, args: 'foto' })).text!;
  const row = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'CommandOutput', props: OUTPUT(shot), viewport: MAIN_SCREEN });
  expect(await said(row)).toMatch(/✓ /);
  await row.unmount();
});

test('the photo counts the tasks in progress, not the ones done or stopped (carry 7)', async ($, on) => {
  const status = (task: string, over: object) => JSON.stringify({
    ts: new Date(NOW - 60_000).toISOString(), task, path: 'medium', phase: 'implement', agent: 'forge-impl', validators: [], verdict: null, round: null, cap: null,
    taskStartedAt: new Date(NOW - 600_000).toISOString(), stageSince: new Date(NOW - 60_000).toISOString(), stages: {}, doneAt: null,
    lastAt: new Date(NOW - 60_000).toISOString(), session: SESSION_ID, runId: null, project: null, ...over,
  });
  serveFiles(on, [], {
    [`${ROOT}/.forge/status/T001.json`]: status('T001', {}),
    [`${ROOT}/.forge/status/T002.json`]: status('T002', { doneAt: new Date(NOW - 120_000).toISOString() }),
    [`${ROOT}/.forge/status/T003.json`]: status('T003', { phase: 'stopped', doneAt: new Date(NOW - 120_000).toISOString() }),
  });
  servePanes(on);
  start(on);
  await $.session.start(SESSION);
  expect((await $.command.run({ ...RUN, args: 'foto' })).text).toMatch(/ · 1 task$/);
});

test('on the desktop a photo is drawn as the SVG cards the pane draws there, not as terminal cells (carry 7)', async ($, on) => {
  serveFiles(on);
  servePanes(on);
  engineRows(on);
  start(on);
  await $.session.start(SESSION);
  const shot = (await $.command.run({ ...RUN, args: 'foto' })).text!;
  const desktop = await $.ui.mount({ plugin: 'lens', surface: 'desktop', component: 'CommandOutput', props: OUTPUT(shot), viewport: { columns: 120, rows: 40 } });
  expect((await desktop.findAll({ type: 'Svg' })).length).toBeGreaterThan(0);
  expect(await desktop.find({ text: shot })).toBeDefined();
  await desktop.unmount();
  const terminal = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'CommandOutput', props: OUTPUT(shot), viewport: MAIN_SCREEN });
  expect(await terminal.findAll({ type: 'Svg' })).toEqual([]);
  await terminal.unmount();
});

test('a photo is laid out at the transcript width: the screen undocked, narrower beside a docked pane (final review m-2)', async ($, on) => {
  serveFiles(on);
  const open = servePanes(on);
  engineRows(on);
  const clock = start(on);
  await $.session.start(SESSION);
  const shot = (await $.command.run({ ...RUN, args: 'foto' })).text!;
  const SCREEN = { columns: 160, rows: 40, isFullscreen: true };
  // Cards without a frame are indented by two: their bar is the row's width less two.
  const bar = async () => {
    const row = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'CommandOutput', props: OUTPUT(shot), viewport: SCREEN });
    const width = widestBar(await row.drawn());
    await row.unmount();
    return width;
  };
  expect(await bar()).toBe(160 - 2);
  // lens's pane docked beside the transcript, before any band measured it: the screen less the pane.
  await $.command.run({ ...RUN, args: 'live' });
  const pane = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'Pane', requestId: PANE, viewport: SCREEN,
    props: { title: 'lens', isFocused: false, bodyColumns: 52, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} } });
  await pane.unmount();
  expect(await bar()).toBe(160 - 56 - 2);
  open.delete(PANE); // the person closes the pane; the next refresh sees it gone
  await clock.advance(10_000);
  expect(await bar()).toBe(160 - 2);
  // The band measures the transcript's column: beside a docked pane its bodyColumns, plus the engine's five.
  const band = async (bodyColumns: number) => {
    const ui = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'AbovePrompt', props: { ...BAND_PROPS, bodyColumns }, viewport: SCREEN });
    await ui.unmount();
  };
  await band(99);
  expect(await bar()).toBe(99 + 5 - 2);
  await band(155);
  expect(await bar()).toBe(155 + 5 - 2);
});

test("in fullscreen the band's Panel button runs /lens foto at 109 columns and /lens live from 110 (carry 6)", async ($, on) => {
  serveFiles(on);
  servePanes(on);
  engineRows(on);
  start(on);
  const ran: string[] = [];
  on('command.run', (_$, e) => { ran.push(`/${e.command} ${e.args}`.trimEnd()); return { text: '' }; });
  await $.session.start(SESSION);
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'a', status: 'pending', activeForm: 'A' }] });
  for (const columns of [109, 110]) {
    const band = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'AbovePrompt', props: { ...BAND_PROPS, bodyColumns: columns - 5 }, viewport: { columns, rows: 30, isFullscreen: true } });
    await band.press({ key: 'panel' });
    await band.unmount();
  }
  expect(ran).toEqual(['/lens foto', '/lens live']);
});

test('a Panel press that cannot run /lens leaves it in the prompt and says to press Enter (carry 6)', async ($, on) => {
  serveFiles(on);
  servePanes(on);
  engineRows(on);
  start(on);
  on('command.run', () => { throw new Error('not from here'); });
  const filled: string[] = [];
  const toasts: string[] = [];
  on('prompt.fill', (_$, e) => { filled.push(e.text); return { isFilled: true }; });
  on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined }; });
  await $.session.start(SESSION);
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'a', status: 'pending', activeForm: 'A' }] });
  const band = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS, viewport: { columns: 105, rows: 30, isFullscreen: false } });
  await band.press({ key: 'panel' });
  await band.unmount();
  expect(filled).toEqual(['/lens foto']);
  expect(toasts).toEqual(['Command ready in the prompt: press Enter']);
});

test("outside fullscreen the band's Panel button runs /lens foto (§4.6, step 2)", async ($, on) => {
  serveFiles(on);
  servePanes(on);
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
});
