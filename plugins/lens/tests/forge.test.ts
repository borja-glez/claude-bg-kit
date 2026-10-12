import { expect, mock, test } from 'claude-code/testing';
import type { On } from 'claude-code';

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

// The status forge keeps in .forge/status.json; the ledger beside it is never read by lens.
const STATUS = {
  ts: new Date(NOW - 30 * 60_000).toISOString(), task: 'hash', path: 'medium', phase: 'review', agent: 'forge-review-security',
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

// A file system answered from memory; every path the plugin touches is recorded.
function serveFiles(on: On, files: Record<string, string>, touched: string[] = []) {
  on('session.root', () => ({ value: ROOT }));
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
    return f !== undefined ? { value: { kind: 'file' as const, size: f.length, mtimeMs: 1, isLink: false } } : { deny: `ENOENT ${e.path}` };
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
      ? { value: [...names].map(([name, f]) => ({ name, kind: f.kind, size: f.size, mtimeMs: 1, isLink: false })) }
      : { deny: `ENOENT ${e.path}` };
  });
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

function start(on: On) {
  const clock = mock.clock(on, { now: NOW });
  on('session.start', (_$, e) => ({ cwd: e.cwd }));
  on('agent.list', () => ({ value: [] }));
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
    for (const part of ['hash', 'medium', 'forge · review', 'security', 'forge-review-security', '✓ test', 'accept 0.97', 'round 0/3', 'Cache the parser', 'perf', 'low']) {
      expect(text).toContain(part);
    }
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

test('a verdict score of 0 shows as 0', async ($, on) => {
  serveFiles(on, { ...FORGE, [`${ROOT}/.forge/status.json`]: JSON.stringify({ ...STATUS, verdict: { action: 'reject', score: 0 } }) });
  servePanes(on);
  start(on);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  const ui = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS });
  expect(await said(ui)).toContain('reject 0.00');
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
