import { expect, mock, test } from 'claude-code/testing';
import type { On } from 'claude-code';

const PANE = 'lens';
const PANE_PROPS = { title: 'lens', isFocused: false, bodyColumns: 60, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} };
const RUN = { command: 'lens', args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } };
const NOW = Date.parse('2026-10-16T12:00:00.000Z');
const ROOT = '/repo';
const SESSION = 'conv-1';
const at = (min: number) => new Date(NOW - min * 60_000).toISOString();
const status = (task: string, over: object = {}) => JSON.stringify({
  ts: at(1), task, path: 'medium', phase: 'implement', agent: 'forge-impl', validators: [], verdict: null, round: null, cap: null,
  taskStartedAt: at(10), stageSince: at(1), stages: {}, doneAt: null, lastAt: at(1), session: SESSION, runId: null, project: 'shop', ...over,
});
const THREE: Record<string, string> = Object.fromEntries(['T001', 'T002', 'T003'].map(t => [`${ROOT}/.forge/status/shop__${t}.json`, status(t)]));

const norm = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '');

// A file system answered from memory, every file touched a minute ago.
function serveFiles(on: On, files: Record<string, string>) {
  on('session.root', () => ({ value: ROOT }));
  on('fs.read', (_$, e) => { const f = files[norm(e.path)]; return f !== undefined ? { value: f } : { deny: `ENOENT ${e.path}` }; });
  on('fs.exists', (_$, e) => { const p = norm(e.path); return { value: p in files || Object.keys(files).some(f => f.startsWith(`${p}/`)) }; });
  on('fs.stat', (_$, e) => {
    const f = files[norm(e.path)];
    return f !== undefined ? { value: { kind: 'file' as const, size: f.length, mtimeMs: NOW - 60_000, isLink: false } } : { deny: `ENOENT ${e.path}` };
  });
  on('fs.list', (_$, e) => {
    const prefix = `${norm(e.path)}/`;
    const names = new Map<string, { kind: 'file' | 'dir'; size: number }>();
    for (const [path, text] of Object.entries(files)) {
      if (!path.startsWith(prefix)) continue;
      const [head = '', ...rest] = path.slice(prefix.length).split('/');
      names.set(head, rest.length ? { kind: 'dir', size: 0 } : { kind: 'file', size: text.length });
    }
    return names.size
      ? { value: [...names].map(([name, f]) => ({ name, kind: f.kind, size: f.size, mtimeMs: NOW - 60_000, isLink: false })) }
      : { deny: `ENOENT ${e.path}` };
  });
}

function servePanes(on: On) {
  const open = new Set<string>();
  on('ui.open', (_$, e) => { open.add(e.id); return { value: { isPlaced: true as const } }; });
  on('ui.close', (_$, e) => { open.delete(e.id); return { value: undefined }; });
  on('ui.panes', () => ({ value: [...open].map(id => ({ id, title: 'lens', isShown: true, isFocused: false, isPlaced: true })) }));
}

// The engine beneath lens: its clock and session, the agents list `agents.list` answers, and agent.spawn answering the
// next of `ids`.
function start(on: On, agents: { list: unknown[] } = { list: [] }, ids: string[] = []) {
  const clock = mock.clock(on, { now: NOW });
  on('session.start', (_$, e) => ({ cwd: e.cwd }));
  on('session.id', () => ({ value: SESSION }));
  on('agent.list', () => ({ value: agents.list as never }));
  on('classic.SubagentStart', () => ({}));
  let n = 0;
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: ids[n++] ?? `x${n}` }));
  on('turn.complete', () => ({ text: '' }));
  return clock;
}

// The last lens.panel value written to state.
function panelWrites(on: On) {
  const box: { last: Record<string, any> | null } = { last: null };
  on('state.set', (_$, e, next) => {
    if (e.plugin === 'lens' && e.key === 'panel') box.last = e.value as Record<string, any>;
    return next(e);
  });
  return box;
}

// Everything a drawing says, in order: Text strings, Svg alt texts and Button labels.
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

const spawnArgs = (prompt: string, over: Record<string, unknown> = {}) => ({
  tool_use_id: 'tu-1', prompt, description: 'agent', subagentType: 'forge:forge-impl', provider: { plugin: 'forge', tier: 'plugin' },
  parentModel: 'claude-opus-5-5', background: true, fork: false, ...over,
}) as never;

test('three implementers with the task line give three task rows, each with its own agent, drawn once (E-02)', async ($, on) => {
  serveFiles(on, THREE);
  servePanes(on);
  const panel = panelWrites(on);
  const agents = { list: [] as unknown[] };
  const clock = start(on, agents, ['a1', 'a2', 'a3']);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  for (const t of ['T001', 'T002', 'T003']) await $.agent.spawn(spawnArgs(`forge-task: ${t}-1 @shop\nImplement ${t}.`, { description: `implement ${t}` }));
  agents.list = ['a1', 'a2', 'a3'].map((id, i) => ({ id, type: 'forge:forge-impl', description: `implement T00${i + 1}`, status: 'running' }));
  await clock.advance(10_000);
  const rows = (panel.last?.activities ?? []).filter((a: { kind: string }) => a.kind === 'forge')
    .map((a: { task: string; agents: { id: string }[] }) => [a.task, a.agents.map(g => g.id)]).sort();
  expect(rows).toEqual([['T001', ['a1']], ['T002', ['a2']], ['T003', ['a3']]]);
  const ui = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS });
  const text = await said(ui);
  expect(text).toContain('Tasks in progress · 3');
  expect(text.match(/implement T001/g)).toHaveLength(1);
  await ui.unmount();
});

test('a workflow agent shows although the agents list never names it, and goes with its turn end (E-09)', async ($, on) => {
  serveFiles(on, {});
  servePanes(on);
  const panel = panelWrites(on);
  const clock = start(on, { list: [] }, ['wf-a1']);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  await $.agent.spawn(spawnArgs('Survey the docs', { subagentType: 'general-purpose', description: 'survey', workflow: { runId: 'wf_1', agentIndex: 1 } }));
  await clock.advance(10_000);
  expect(panel.last?.activities).toMatchObject([{ key: 'wf:wf_1', kind: 'workflow', done: false, agents: [{ id: 'wf-a1' }] }]);
  await $.turn.complete({ turnId: 'w', agentId: 'wf-a1', answer: '', durationMs: 1, isAborted: false, reason: 'answer' } as never);
  await clock.advance(10_000);
  expect(panel.last?.activities).toMatchObject([{ key: 'wf:wf_1', done: true, agents: [] }]);
});

test('a teammate idle between turns is waiting, not finished (E-09)', async ($, on) => {
  serveFiles(on, {});
  servePanes(on);
  start(on, { list: [{ id: 'tm', type: 'teammate', description: 'Helper mate', status: 'idle' }] });
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  const ui = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS });
  const text = await said(ui);
  expect(text).toContain('Helper mate');
  expect(text).toContain('waiting');
  expect(text).not.toContain('✓ teammate');
  await ui.unmount();
});

test("a subagent's tool shows on its agent until it returns (E-11)", async ($, on) => {
  serveFiles(on, THREE);
  servePanes(on);
  const panel = panelWrites(on);
  const agents = { list: [] as unknown[] };
  const clock = start(on, agents, ['a1']);
  const gate: { open?: () => void } = {};
  on('tool.call', { tool: 'Edit' }, () => new Promise<never>(resolve => { gate.open = () => resolve({ result: {} } as never); }));
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  await $.agent.spawn(spawnArgs('forge-task: T001-1 @shop'));
  agents.list = [{ id: 'a1', type: 'forge:forge-impl', description: 'agent', status: 'running' }];
  const call = $.tool.call({ tool: 'Edit', agentId: 'a1', tool_use_id: 'e1', file_path: '/repo/x', old_string: 'a', new_string: 'b' } as never);
  await clock.advance(10_000);
  const agentOf = () => panel.last?.activities.find((a: { task: string }) => a.task === 'T001')?.agents[0];
  expect(agentOf()).toMatchObject({ id: 'a1', tool: 'Edit' });
  gate.open!();
  await call;
  await clock.advance(10_000);
  expect(agentOf()?.tool).toBeNull();
});

test('a task this session touched with forge.cjs is its own although its status names no session (E-06)', async ($, on) => {
  serveFiles(on, { [`${ROOT}/.forge/status/T009.json`]: status('T009', { session: null, project: null, ts: at(40), lastAt: at(40) }) });
  servePanes(on);
  const panel = panelWrites(on);
  const clock = start(on);
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '{}', stderr: '', interrupted: false } }) as never);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  expect(panel.last?.activities).toEqual([]);
  await $.tool.call({ tool: 'Bash', command: 'node "/x/dist/forge.cjs" prep --task T009-1 --path medium', tool_use_id: 'b1' } as never);
  await clock.advance(10_000);
  expect(panel.last?.activities).toMatchObject([{ key: 'T009', owner: 'own' }]);
});

test('with no turn open, Now waits on the main loop agents and wakes with the last ScheduleWakeup (E-11)', async ($, on) => {
  serveFiles(on, {});
  servePanes(on);
  const panel = panelWrites(on);
  const agents = { list: [] as unknown[] };
  const clock = start(on, agents, ['a1']);
  on('tool.call', { tool: 'ScheduleWakeup' }, () => ({ result: { scheduledFor: NOW + 240_000, clampedDelaySeconds: 240, wasClamped: false } }) as never);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  await $.agent.spawn(spawnArgs('Look around', { subagentType: 'Explore' }));
  agents.list = [{ id: 'a1', type: 'Explore', description: 'agent', status: 'running' }];
  await $.tool.call({ tool: 'ScheduleWakeup', delaySeconds: 240, reason: 'wait', prompt: 'go', tool_use_id: 's1' } as never);
  await clock.advance(10_000);
  expect(panel.last?.waiting).toEqual({ agents: 1, wakeSeconds: 230 });
});

test('a spawn goes ahead with its answer when the agents list fails (I-11)', async ($, on) => {
  serveFiles(on, {});
  servePanes(on);
  mock.clock(on, { now: NOW });
  on('session.start', (_$, e) => ({ cwd: e.cwd }));
  on('session.id', () => ({ value: SESSION }));
  on('agent.list', () => { throw new Error('no list'); });
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a7' }));
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  expect(await $.agent.spawn(spawnArgs('forge-task: T001-1'))).toMatchObject({ agentId: 'a7' });
});

test('forge.cjs --task T001-1 makes the T001 row own when its status names no session (E-06)', async ($, on) => {
  serveFiles(on, { [`${ROOT}/.forge/status/T001.json`]: status('T001', { session: null, project: null }) });
  servePanes(on);
  const panel = panelWrites(on);
  const clock = start(on);
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '{}', stderr: '', interrupted: false } }) as never);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  expect(panel.last?.activities).toMatchObject([{ key: 'T001', owner: 'other' }]);
  await $.tool.call({ tool: 'Bash', command: 'node "/x/dist/forge.cjs" prep --task T001-1 --path medium', tool_use_id: 'b1' } as never);
  await clock.advance(10_000);
  expect(panel.last?.activities).toMatchObject([{ key: 'T001', owner: 'own' }]);
});

test('with the session id unreadable, a task this session touched stays own and nothing throws (Review Focus 5)', async ($, on) => {
  serveFiles(on, { [`${ROOT}/.forge/status/T005.json`]: status('T005', { session: 'other-conv', project: null }) });
  servePanes(on);
  const panel = panelWrites(on);
  const clock = mock.clock(on, { now: NOW });
  on('session.start', (_$, e) => ({ cwd: e.cwd }));
  on('session.id', () => { throw new Error('no id'); });
  on('agent.list', () => ({ value: [] as never }));
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '{}', stderr: '', interrupted: false } }) as never);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  await $.tool.call({ tool: 'Bash', command: 'node "/x/dist/forge.cjs" prep --task T005 --path medium', tool_use_id: 'b1' } as never);
  await clock.advance(10_000);
  expect(panel.last?.activities).toMatchObject([{ key: 'T005', owner: 'own', dim: false }]);
});
