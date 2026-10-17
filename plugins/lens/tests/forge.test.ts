import { expect, mock, test } from 'claude-code/testing';
import type { On, RenderElement } from 'claude-code';

const SURFACES = ['terminal', 'desktop'] as const;
const PANE = 'lens';
const PANE_PROPS = {
  title: 'lens', isFocused: false, bodyColumns: 60, placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 30 }, view: {},
};
const RUN = { command: 'lens', args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } };
const NOW = Date.parse('2026-10-11T12:00:00.000Z');
const ROOT = '/repo';
const ID = 'p20261011100000abcd';
const SESSION = 'conv-1';

// The status forge keeps in .forge/status.json; the ledger beside it is never read by lens.
const STATUS = {
  ts: new Date(NOW - 30 * 60_000).toISOString(), session: SESSION, task: 'hash', path: 'medium', phase: 'review', agent: 'forge-review-security',
  validators: [{ name: 'test', ok: true }], verdict: { action: 'accept', score: 0.97 }, round: 0, cap: 3,
};
const LEDGER = '{"ts":"2026-10-11T11:30:00.000Z","kind":"phase","task":"hash","phase":"review"}\n';
const PROPOSAL = JSON.stringify({
  ts: '2026-10-11T10:00:00.000Z', category: 'perf', risk: 'low', title: 'Cache the parser', rationale: 'r', evidence: 'e',
  pillar: '', status: 'proposed', source: 'scout', author: 'scout',
});
const FORGE: Record<string, string> = {
  [`${ROOT}/.forge/ledger.jsonl`]: LEDGER,
  [`${ROOT}/.forge/status.json`]: JSON.stringify(STATUS),
  [`${ROOT}/.forge/proposals/${ID}.json`]: PROPOSAL,
};

const norm = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '');

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

// A file system answered from memory; every path the plugin touches is recorded. Every file's mtime is `mtimeMs` (1 by
// default: older than any window) and the session root is `root`.
function serveFiles(on: On, files: Record<string, string>, touched: string[] = [], opts: { mtimeMs?: number; root?: string } = {}) {
  const mtimeMs = opts.mtimeMs ?? 1;
  on('session.root', () => ({ value: opts.root ?? ROOT }));
  on('fs.read', (_$, e) => {
    touched.push(norm(e.path));
    const f = files[norm(e.path)];
    return f !== undefined ? { value: f } : { deny: `ENOENT ${e.path}` };
  });
  on('fs.exists', (_$, e) => {
    touched.push(norm(e.path));
    const p = norm(e.path);
    return { value: p in files || Object.keys(files).some(f => f.startsWith(`${p}/`)) };
  });
  on('fs.stat', (_$, e) => {
    touched.push(norm(e.path));
    const f = files[norm(e.path)];
    return f !== undefined ? { value: { kind: 'file' as const, size: f.length, mtimeMs, isLink: false } } : { deny: `ENOENT ${e.path}` };
  });
  on('fs.list', (_$, e) => {
    touched.push(norm(e.path));
    const prefix = `${norm(e.path)}/`;
    const names = new Map<string, { kind: 'file' | 'dir'; size: number }>();
    for (const [path, text] of Object.entries(files)) {
      if (!path.startsWith(prefix)) continue;
      const [head = '', ...rest] = path.slice(prefix.length).split('/');
      names.set(head, rest.length ? { kind: 'dir', size: 0 } : { kind: 'file', size: text.length });
    }
    return names.size
      ? { value: [...names].map(([name, f]) => ({ name, kind: f.kind, size: f.size, mtimeMs, isLink: false })) }
      : { deny: `ENOENT ${e.path}` };
  });
}

// What the real engine answers at the bottom of the chain when nothing draws beneath the plugin.
function engineBottom(on: On) {
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as RenderElement);
}

function servePanes(on: On) {
  const open = new Set<string>();
  on('ui.open', (_$, e) => { open.add(e.id); return { value: { isPlaced: true as const } }; });
  on('ui.close', (_$, e) => { open.delete(e.id); return { value: undefined }; });
  on('ui.panes', () => ({
    value: [...open].map(id => ({ id, title: 'lens', isShown: true, isFocused: false, isPlaced: true })),
  }));
  return open;
}

function start(on: On, sessionId: () => string = () => SESSION) {
  const clock = mock.clock(on, { now: NOW });
  on('session.start', (_$, e) => ({ cwd: e.cwd }));
  on('agent.list', () => ({ value: [] }));
  on('session.id', () => ({ value: sessionId() }));
  on('classic.SubagentStart', () => ({}));
  return clock;
}

test('the pane shows the forge task and its pending proposals', async ($, on) => {
  serveFiles(on, FORGE);
  servePanes(on);
  start(on);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'lens', surface, component: 'Pane', requestId: PANE, props: PANE_PROPS });
    const text = await said(ui);
    for (const part of ['hash', 'medium', 'forge · review', 'security', 'forge-review-security', '✓ test', '✓ accepted', 'round 0/3', 'Cache the parser', 'perf', 'low']) {
      expect(text).toContain(part);
    }
    expect(text).not.toMatch(/0[.,]97/);
    expect(await ui.find({ key: `approve-${ID}` })).toBeDefined();
    expect(await ui.find({ key: `reject-${ID}` })).toBeDefined();
    await ui.unmount();
  }
});

test('the approve and reject buttons run /forge:decide', async ($, on) => {
  const ran: string[] = [];
  serveFiles(on, FORGE);
  servePanes(on);
  start(on);
  on('command.run', { command: 'forge:decide' }, (_$, e) => { ran.push(`${e.command} ${e.args}`); return { text: '' }; });
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  const ui = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS });
  await ui.press({ key: `approve-${ID}` });
  await ui.press({ key: `reject-${ID}` });
  expect(ran).toEqual([`forge:decide ${ID} approve`, `forge:decide ${ID} reject`]);
  await ui.unmount();
});

test('a decision that cannot run is left in the prompt with a toast', async ($, on) => {
  const filled: string[] = [];
  const toasts: string[] = [];
  serveFiles(on, FORGE);
  servePanes(on);
  start(on);
  on('command.run', { command: 'forge:decide' }, () => { throw new Error('unknown command'); });
  on('prompt.fill', (_$, e) => { filled.push(e.text); return { isFilled: true }; });
  on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined }; });
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  const ui = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS });
  await ui.press({ key: `approve-${ID}` });
  expect(filled.at(-1)).toBe(`/forge:decide ${ID} approve`);
  expect(toasts.at(-1)).toBe('Command ready in the prompt: press Enter');
  await ui.unmount();
});

test('without .forge/ there is no forge section', async ($, on) => {
  serveFiles(on, { [`${ROOT}/README.md`]: 'x' });
  servePanes(on);
  start(on);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  const ui = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS });
  expect(await said(ui)).not.toContain('forge');
  await ui.unmount();
});

test('the ledger is never read, and a status.json over 64 KiB is not read either', async ($, on) => {
  const touched: string[] = [];
  serveFiles(on, { ...FORGE, [`${ROOT}/.forge/status.json`]: JSON.stringify(STATUS) + ' '.repeat(64 * 1024) }, touched);
  servePanes(on);
  start(on);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  const ui = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS });
  expect(await said(ui)).not.toContain('forge · review');
  expect(await said(ui)).toContain('Cache the parser');
  await ui.unmount();
  expect(touched).not.toContain(`${ROOT}/.forge/ledger.jsonl`);
  expect(touched).not.toContain(`${ROOT}/.forge/status.json`);
});

test('a verdict shows its action, never its score (K4-05)', async ($, on) => {
  serveFiles(on, { ...FORGE, [`${ROOT}/.forge/status.json`]: JSON.stringify({ ...STATUS, verdict: { action: 'reject', score: 0 } }) });
  servePanes(on);
  start(on);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  const ui = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS });
  const text = await said(ui);
  expect(text).toContain('reject');
  expect(text).not.toMatch(/0[.,]00/);
  await ui.unmount();
});

test('once the pane is closed and nothing is going on, nothing under .forge/ is read', async ($, on) => {
  const touched: string[] = [];
  serveFiles(on, FORGE, touched);
  servePanes(on);
  const clock = start(on);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  expect(touched).toContain(`${ROOT}/.forge/status.json`);
  const pane = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS });
  await pane.press({ key: 'close' });
  await pane.unmount();
  touched.length = 0;
  await clock.advance(60000);
  expect(touched.filter(p => p.includes('/.forge'))).toEqual([]);
});

test('with the pane closed, .forge/ is read only while there is activity, for the band', async ($, on) => {
  const touched: string[] = [];
  serveFiles(on, FORGE, touched);
  servePanes(on);
  const clock = start(on);
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [] } }));
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await clock.advance(60000);
  expect(touched.filter(p => p.includes('/.forge'))).toEqual([]);
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'a', status: 'pending', activeForm: 'A' }] });
  await clock.advance(30000);
  expect(touched).toContain(`${ROOT}/.forge/status.json`);
  expect(touched).not.toContain(`${ROOT}/.forge/ledger.jsonl`);
});

test('proposal files are re-read only when the proposals listing changes', async ($, on) => {
  const touched: string[] = [];
  const files = { ...FORGE };
  serveFiles(on, files, touched);
  servePanes(on);
  const clock = start(on);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  const file = `${ROOT}/.forge/proposals/${ID}.json`;
  expect(touched).toContain(file);
  touched.length = 0;
  await clock.advance(30000);
  expect(touched).toContain(`${ROOT}/.forge/proposals`);
  expect(touched).not.toContain(file);
  files[file] = JSON.stringify({ ...JSON.parse(PROPOSAL), title: 'Cache the parser twice' });
  touched.length = 0;
  await clock.advance(30000);
  expect(touched).toContain(file);
  const ui = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS });
  expect(await said(ui)).toContain('Cache the parser twice');
  await ui.unmount();
});

const RUN_STATE = {
  mode: 'infinite', active: true, startedAt: new Date(NOW - 90 * 60_000).toISOString(), budget: { cycles: 10, hours: 3 }, cycle: 3,
  noProgress: 0, lastError: null, repeatedError: false, lastBlockEvents: null, queueMax: 10, sessionId: null,
};
const AUTO_ID = 'p20261011110000abcd';
const AUTO = JSON.stringify({ ...JSON.parse(PROPOSAL), title: 'Fix the flaky test', category: 'tests', status: 'auto_approved' });

test('the forge section shows the infinite run and its auto-approved proposals', async ($, on) => {
  serveFiles(on, { ...FORGE, [`${ROOT}/.forge/run.json`]: JSON.stringify(RUN_STATE), [`${ROOT}/.forge/proposals/${AUTO_ID}.json`]: AUTO });
  servePanes(on);
  start(on);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'lens', surface, component: 'Pane', requestId: PANE, props: PANE_PROPS });
    expect(await said(ui)).toContain('4/10 · 1.5h left');
    expect(await said(ui)).toMatch(/auto.*Fix the flaky test/);
    expect(await ui.find({ key: `approve-${AUTO_ID}` })).toBeUndefined();
    await ui.unmount();
  }
});

test('an inactive run, or a run.json over 16 KiB, shows no infinite line', async ($, on) => {
  const touched: string[] = [];
  const files: Record<string, string> = { ...FORGE, [`${ROOT}/.forge/run.json`]: JSON.stringify({ ...RUN_STATE, active: false }) };
  serveFiles(on, files, touched);
  servePanes(on);
  const clock = start(on);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  let ui = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS });
  expect(await said(ui)).not.toContain('1.5h left');
  expect(await said(ui)).toContain('forge · review');
  await ui.unmount();
  files[`${ROOT}/.forge/run.json`] = JSON.stringify(RUN_STATE) + ' '.repeat(16 * 1024);
  touched.length = 0;
  await clock.advance(10000);
  expect(touched).not.toContain(`${ROOT}/.forge/run.json`);
  ui = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS });
  expect(await said(ui)).not.toContain('1.5h left');
  await ui.unmount();
});

test('without a cycle budget the infinite line shows the cycle alone, even with no status', async ($, on) => {
  serveFiles(on, { [`${ROOT}/.forge/run.json`]: JSON.stringify({ ...RUN_STATE, budget: { hours: 3 } }) });
  servePanes(on);
  start(on);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  const ui = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS });
  expect(await said(ui)).toContain('forge');
  expect(await said(ui)).toMatch(/∞ cycle \|\s+4 · 1\.5h left/);
  await ui.unmount();
});

test('the band shows the forge task with its bar while there is activity, as cells on the terminal and SVG on the desktop', async ($, on) => {
  engineBottom(on);
  serveFiles(on, { ...FORGE, [`${ROOT}/.forge/work/hash/brief-1.md`]: 'b', [`${ROOT}/.forge/work/hash/brief-2.md`]: 'b' });
  servePanes(on);
  const clock = start(on);
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [] } }));
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'a', status: 'pending', activeForm: 'A' }] });
  await clock.advance(30000);
  const props = { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 9 }, view: {} };
  const term = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'AbovePrompt', props });
  const text = await said(term);
  expect(text).toContain('hash');
  expect(text).toContain('0/2');
  expect(text).toContain('medium · review');
  expect(await term.find({ key: 'panel' })).toBeDefined();
  await term.unmount();
  const desk = await $.ui.mount({ plugin: 'lens', surface: 'desktop', component: 'AbovePrompt', props });
  expect(await desk.find({ type: 'Svg' })).toBeDefined();
  expect(await said(desk)).toContain('hash · 0/2 · medium · review');
  expect(await desk.find({ key: 'panel' })).toBeDefined();
  await desk.unmount();
});

test('in a linked worktree the card counts the decisions of the main checkout', async ($, on) => {
  const at = new Date(NOW - 10 * 60_000).toISOString();
  const doc = (count: number) => JSON.stringify({ ts: at, scope: 'r1', count, autonomy: 'unattended', last: [], lastMajor: null });
  serveFiles(on, {
    ...FORGE,
    [`${ROOT}/.git`]: 'gitdir: /main/.git/worktrees/task-T1\n',
    [`/main/.forge/decisions.json`]: doc(4),
    [`${ROOT}/.forge/decisions.json`]: doc(9),
  });
  servePanes(on);
  start(on);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  const ui = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS });
  const text = await said(ui);
  expect(text).toContain('4 automatic decisions');
  expect(text).not.toContain('9 automatic decisions');
  await ui.unmount();
});

test('the forge card counts the automatic decisions from .forge/decisions.json', async ($, on) => {
  const at = new Date(NOW - 10 * 60_000).toISOString();
  const DECISIONS = JSON.stringify({ ts: at, scope: 'hash', count: 2, autonomy: 'auto', last: [], lastMajor: { n: 4, point: 'design-approve', what: 'design approved (v3)', chosen: 'approve', ts: at } });
  serveFiles(on, { ...FORGE, [`${ROOT}/.forge/decisions.json`]: DECISIONS });
  servePanes(on);
  start(on);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'lens', surface, component: 'Pane', requestId: PANE, props: PANE_PROPS });
    const text = await said(ui);
    expect(text).toContain('2 automatic decisions');
    expect(text).toContain('design approved (v3)');
    await ui.unmount();
  }
});

test('at 40 columns an execution row keeps its dot, tag and right text whole: only its title shrinks (F-03)', async ($, on) => {
  const at = (min: number) => new Date(NOW + min * 60_000).toISOString();
  const TITLE = 'A task title long enough to overflow a pane';
  const exec = {
    runId: 'r1', kind: 'plan', mode: 'subagents', parallel: 3, project: 'shop', base: 'main', branch: 'forge/run-shop', mergeOnFinish: false,
    coordinator: 'main', hookSession: 's1', active: true, stopReason: null, stallReason: null, startedAt: at(-60), lastStepAt: at(-1), lastBlockStep: null, sleepUntil: null,
    tasks: { T4: { status: 'running', stage: 'review', round: 2, worktree: '/w', branch: 'task/T4', executor: 'subagents', attempts: 0, agent: 'forge-review-correctness', startedAt: at(-20), stageSince: at(-3), updatedAt: at(-1), detail: null, title: TITLE } },
  };
  serveFiles(on, { [`${ROOT}/.forge/execution.json`]: JSON.stringify(exec) });
  servePanes(on);
  start(on);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  const ui = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'Pane', requestId: PANE, props: { ...PANE_PROPS, bodyColumns: 40 } });
  type El = { type?: string; props?: Record<string, unknown>; children?: unknown };
  const kids = (el: El): El[] => (Array.isArray(el.children) ? el.children : el.children ? [el.children] : []).filter((c): c is El => !!c && typeof c === 'object');
  const textOf = (n: unknown): string => (typeof n === 'string' ? n : Array.isArray(n) ? n.map(textOf).join('') : n && typeof n === 'object' ? textOf((n as El).children) : '');
  const boxes: El[] = [];
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!n || typeof n !== 'object') return;
    const el = n as El;
    if (el.type === 'Box') boxes.push(el);
    walk(el.children);
  };
  walk(await ui.drawn());
  // The slot row: a row whose middle part is the task title.
  const row = boxes.find(b => b.props?.flexDirection === 'row' && b.props?.columnGap === 1 && kids(b).some(c => textOf(c) === TITLE));
  expect(row).toBeDefined();
  const parts = kids(row!);
  expect(parts).toHaveLength(4);
  const middle = parts.find(c => textOf(c) === TITLE)!;
  expect(middle).toMatchObject({ type: 'Box', props: { flexGrow: 1, flexShrink: 1, minWidth: 0 } });
  for (const c of parts.filter(c => c !== middle)) expect(c).toMatchObject({ type: 'Box', props: { flexShrink: 0 } });
  // The execution card header: icon and chip whole, the title shrinks.
  const head = boxes.find(b => b.props?.flexDirection === 'row' && kids(b).length === 3 && textOf(kids(b)[0]) === '▶');
  expect(head).toBeDefined();
  expect(kids(head!).map(c => c.props?.flexShrink)).toEqual([0, 1, 0]);
  expect(kids(head!)[1].props?.minWidth).toBe(0);
  await ui.unmount();
});

test('a plan task counts its briefs in .forge/work/<project>/<task> (D-08)', async ($, on) => {
  engineBottom(on);
  serveFiles(on, {
    ...FORGE, [`${ROOT}/.forge/status.json`]: JSON.stringify({ ...STATUS, project: 'shop' }),
    [`${ROOT}/.forge/work/shop/hash/brief-1.md`]: 'b', [`${ROOT}/.forge/work/shop/hash/brief-2.md`]: 'b', [`${ROOT}/.forge/work/hash/brief-1.md`]: 'b',
  });
  servePanes(on);
  const clock = start(on);
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [] } }));
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'a', status: 'pending', activeForm: 'A' }] });
  await clock.advance(30000);
  const props = { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 9 }, view: {} };
  const term = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'AbovePrompt', props });
  expect(await said(term)).toContain('0/2');
  await term.unmount();
});

test('a project id as long as forge allows (120 characters) still finds its briefs folder', async ($, on) => {
  const project = 'p'.repeat(120);
  engineBottom(on);
  serveFiles(on, {
    ...FORGE, [`${ROOT}/.forge/status.json`]: JSON.stringify({ ...STATUS, project }),
    [`${ROOT}/.forge/work/${project}/hash/brief-1.md`]: 'b', [`${ROOT}/.forge/work/${project}/hash/brief-3.md`]: 'b', [`${ROOT}/.forge/work/hash/brief-1.md`]: 'b',
  });
  servePanes(on);
  const clock = start(on);
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [] } }));
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'a', status: 'pending', activeForm: 'A' }] });
  await clock.advance(30000);
  const props = { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 9 }, view: {} };
  const term = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'AbovePrompt', props });
  expect(await said(term)).toContain('0/3');
  await term.unmount();
});

test('every task status of .forge/status/ is a row of Tasks in progress; another session one is marked; a job says it validates (C5, E-06)', async ($, on) => {
  const at = (min: number) => new Date(NOW - min * 60_000).toISOString();
  const st = (task: string, over: object = {}) => JSON.stringify({ ...STATUS, ts: at(1), lastAt: at(1), task, ...over });
  serveFiles(on, {
    [`${ROOT}/.forge/status/T001.json`]: st('T001'),
    [`${ROOT}/.forge/status/T002.json`]: st('T002', { phase: 'implement', agent: 'forge-impl' }),
    [`${ROOT}/.forge/status/T003.json`]: st('T003', { session: 'another-conversation' }),
    [`${ROOT}/.forge/jobs/review-prep-T002-1-42.json`]: JSON.stringify({ name: 'review-prep-T002-1-42', cmd: 'review-prep', task: 'T002-1', pid: 42, startedAt: at(1.5), out: 'x.json', session: SESSION }),
  }, [], { mtimeMs: NOW - 60_000 });
  servePanes(on);
  start(on);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  const ui = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS });
  const text = await said(ui);
  expect(text).toContain('Tasks in progress · 3');
  expect(text).toMatch(/T002[^]*validating · 1m/);
  expect(text).toContain('other session');
  await ui.unmount();
});

test("the lens of a forge task worktree reads the statuses beside the main checkout's ledger (C5, D-10)", async ($, on) => {
  const WT = `${ROOT}/.claude/worktrees/task-T002`;
  serveFiles(on, {
    [`${WT}/.git`]: 'gitdir: /repo/.git/worktrees/task-T002\n',
    [`${ROOT}/.forge/status/shop__T002.json`]: JSON.stringify({ ...STATUS, task: 'T002', project: 'shop', lastAt: new Date(NOW - 60_000).toISOString() }),
  }, [], { mtimeMs: NOW - 60_000, root: WT });
  servePanes(on);
  start(on);
  await $.session.start({ cwd: WT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  const ui = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS });
  expect(await said(ui)).toContain('Tasks in progress · 1');
  await ui.unmount();
});

test('lens reads at most the 20 newest statuses, none over 64 KiB, and reads one again only when it changes', async ($, on) => {
  const touched: string[] = [];
  const files: Record<string, string> = {};
  for (let i = 0; i < 25; i++) files[`${ROOT}/.forge/status/T${i}.json`] = JSON.stringify({ ...STATUS, task: `T${i}`, lastAt: new Date(NOW - 60_000).toISOString() });
  files[`${ROOT}/.forge/status/BIG.json`] = JSON.stringify({ ...STATUS, task: 'BIG', pad: 'x'.repeat(70 * 1024) });
  serveFiles(on, files, touched, { mtimeMs: NOW - 60_000 });
  servePanes(on);
  const clock = start(on);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  const reads = () => touched.filter(p => /\/\.forge\/status\/[^/]+\.json$/.test(p));
  expect(reads()).toHaveLength(20);
  expect(reads()).not.toContain(`${ROOT}/.forge/status/BIG.json`);
  touched.length = 0;
  await clock.advance(10_000);
  expect(reads()).toEqual([]);
});

test('junk in .forge/status/ and .forge/jobs/ hides only that task and never throws', async ($, on) => {
  const at = new Date(NOW - 60_000).toISOString();
  const good = (task: string) => JSON.stringify({ ...STATUS, task, lastAt: at });
  serveFiles(on, {
    [`${ROOT}/.forge/status/T001.json`]: good('T001'),
    [`${ROOT}/.forge/status/notjson.json`]: 'not json {',
    [`${ROOT}/.forge/status/big.json`]: JSON.stringify({ ...STATUS, task: 'big', pad: 'x'.repeat(70 * 1024) }),
    [`${ROOT}/.forge/status/invalid.json`]: JSON.stringify({ hello: 'world' }),
    [`${ROOT}/.forge/status/x.json/inner.json`]: good('inner'),
    [`${ROOT}/.forge/jobs/step.lock`]: 'lock',
    [`${ROOT}/.forge/jobs/step-run-1.json`]: 'not json {',
    [`${ROOT}/.forge/jobs/validate-T001-2.json`]: JSON.stringify({ hello: 'world' }),
    [`${ROOT}/.forge/jobs/integrate-T001-3.json`]: JSON.stringify({ name: 'integrate-T001-3', cmd: 'integrate', task: 'T001', pid: 3, startedAt: at, out: 'x.json' }),
    [`${ROOT}/.forge/jobs/prep-T001-4.json`]: JSON.stringify({ name: 'prep-T001-4', cmd: 'prep', task: 'T001', pid: 4, startedAt: at, out: 'x.json', pad: 'x'.repeat(5000) }),
  }, [], { mtimeMs: NOW - 60_000 });
  servePanes(on);
  start(on);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  const ui = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS });
  const text = await said(ui);
  expect(text).toContain('Tasks in progress · 1');
  expect(text).toContain('T001');
  await ui.unmount();
});

test("after an in-process resume the next turn still draws this session's tasks as its own (M1)", async ($, on) => {
  serveFiles(on, { [`${ROOT}/.forge/status/T001.json`]: JSON.stringify({ ...STATUS, task: 'T001', lastAt: new Date(NOW - 60_000).toISOString() }) }, [], { mtimeMs: NOW - 60_000 });
  servePanes(on);
  const clock = start(on);
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }));
  on('turn.start', (_$, e) => ({ turnId: e.turnId }));
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  const pane = async () => {
    const ui = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS });
    const text = await said(ui);
    await ui.unmount();
    return text;
  };
  expect(await pane()).toContain('Tasks in progress · 1');
  expect(await pane()).not.toContain('other session');
  // The resume forgets the usage meter's session id; the first turn after it writes the panel before any refresh.
  await $.session.end({ reason: 'resume', sessionId: SESSION, resume: {} as never });
  await $.turn.start({ text: 'go', turnId: 'main-1' });
  await clock.advance(1000);
  expect(await pane()).toContain('Tasks in progress · 1');
  expect(await pane()).not.toContain('other session');
});

test('when the session id cannot be read, the panel still draws (E-06)', async ($, on) => {
  serveFiles(on, { [`${ROOT}/.forge/status/T001.json`]: JSON.stringify({ ...STATUS, task: 'T001', lastAt: new Date(NOW - 60_000).toISOString() }) }, [], { mtimeMs: NOW - 60_000 });
  servePanes(on);
  start(on, () => { throw new Error('no id'); });
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  const ui = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS });
  expect(await said(ui)).toContain('Tasks in progress · 1');
  await ui.unmount();
});
