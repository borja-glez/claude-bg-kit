import { expect, mock, test } from 'claude-code/testing';
import type { Engine } from 'claude-code/testing';
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
  return open;
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
  // Before any forge.cjs call the status that names another session is another's, dim: ownTasks makes the difference.
  expect(panel.last?.activities).toMatchObject([{ key: 'T005', owner: 'other', dim: true }]);
  await $.tool.call({ tool: 'Bash', command: 'node "/x/dist/forge.cjs" prep --task T005 --path medium', tool_use_id: 'b1' } as never);
  await clock.advance(10_000);
  expect(panel.last?.activities).toMatchObject([{ key: 'T005', owner: 'own', dim: false }]);
});

// Now with one live agent of the main loop and no turn open, after a ScheduleWakeup with `input` the engine answers `answer`.
async function wakeAfter($: Engine, on: On, input: Record<string, unknown>, answer: unknown = { result: { scheduledFor: NOW, clampedDelaySeconds: 60, wasClamped: false } }) {
  serveFiles(on, {});
  servePanes(on);
  const panel = panelWrites(on);
  const agents = { list: [] as unknown[] };
  const clock = start(on, agents, ['a1']);
  on('tool.call', { tool: 'ScheduleWakeup' }, () => answer as never);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  await $.agent.spawn(spawnArgs('Look around', { subagentType: 'Explore' }));
  agents.list = [{ id: 'a1', type: 'Explore', description: 'agent', status: 'running' }];
  await $.tool.call({ tool: 'ScheduleWakeup', reason: 'wait', prompt: 'go', tool_use_id: 's1', ...input } as never);
  await clock.advance(10_000);
  return panel.last?.waiting;
}

test('a ScheduleWakeup of 10 s wakes after the minute the engine clamps it to (E-11)', async ($, on) => {
  expect(await wakeAfter($, on, { delaySeconds: 10 })).toEqual({ agents: 1, wakeSeconds: 50 });
});
test('a ScheduleWakeup of a day wakes within the hour (E-11)', async ($, on) => {
  expect(await wakeAfter($, on, { delaySeconds: 86_400 })).toEqual({ agents: 1, wakeSeconds: 3590 });
});
test('a ScheduleWakeup whose delay is not a number wakes at no known time (E-11)', async ($, on) => {
  expect(await wakeAfter($, on, { delaySeconds: 'soon' })).toEqual({ agents: 1, wakeSeconds: null });
});
test('a ScheduleWakeup with stop ends the wake-up (E-11)', async ($, on) => {
  expect(await wakeAfter($, on, { delaySeconds: 240, stop: true })).toEqual({ agents: 1, wakeSeconds: null });
});
test('a ScheduleWakeup the engine refuses leaves no countdown (E-11)', async ($, on) => {
  expect(await wakeAfter($, on, { delaySeconds: 240 }, { deny: 'not now' })).toEqual({ agents: 1, wakeSeconds: null });
});

test('a forge.cjs call the engine refuses does not make its task this session own (E-06)', async ($, on) => {
  serveFiles(on, { [`${ROOT}/.forge/status/T009.json`]: status('T009', { session: null, project: null }) });
  servePanes(on);
  const panel = panelWrites(on);
  const clock = start(on);
  on('tool.call', { tool: 'Bash' }, () => ({ deny: 'refused' }) as never);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  await $.tool.call({ tool: 'Bash', command: 'node "/x/dist/forge.cjs" prep --task T009-1 --path medium', tool_use_id: 'b1' } as never);
  await clock.advance(10_000);
  expect(panel.last?.activities).toMatchObject([{ key: 'T009', owner: 'other' }]);
});

test('/clear forgets the agents, the tasks touched with forge.cjs and the wake-up (E-13)', async ($, on) => {
  serveFiles(on, { [`${ROOT}/.forge/status/T009.json`]: status('T009', { session: null, project: null }) });
  servePanes(on);
  const panel = panelWrites(on);
  const agents = { list: [] as unknown[] };
  const clock = start(on, agents, ['a1']);
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '{}', stderr: '', interrupted: false } }) as never);
  on('tool.call', { tool: 'ScheduleWakeup' }, () => ({ result: { scheduledFor: NOW + 240_000, clampedDelaySeconds: 240, wasClamped: false } }) as never);
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }));
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  await $.agent.spawn(spawnArgs('Look around', { subagentType: 'Explore' }));
  agents.list = [{ id: 'a1', type: 'Explore', description: 'agent', status: 'running' }];
  await $.tool.call({ tool: 'Bash', command: 'node "/x/dist/forge.cjs" prep --task T009-1 --path medium', tool_use_id: 'b1' } as never);
  await $.tool.call({ tool: 'ScheduleWakeup', delaySeconds: 240, reason: 'wait', prompt: 'go', tool_use_id: 's1' } as never);
  await clock.advance(10_000);
  expect(panel.last).toMatchObject({ waiting: { agents: 1, wakeSeconds: 230 }, activities: [{ key: 'T009', owner: 'own' }, { kind: 'adhoc', agents: [{ id: 'a1' }] }] });
  agents.list = [];
  await $.session.end({ reason: 'clear', sessionId: SESSION, resume: {} as never });
  await clock.advance(10_000);
  expect(panel.last).toMatchObject({ waiting: null, activities: [{ key: 'T009', owner: 'other' }] });
});

test('SubagentStart shows a subagent lens did not see spawn, and SubagentStop ends it and keeps it as finished', async ($, on) => {
  serveFiles(on, {});
  servePanes(on);
  const panel = panelWrites(on);
  const agents = { list: [] as unknown[] };
  const clock = start(on, agents);
  on('classic.SubagentStop', () => ({}));
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  await $.classic.SubagentStart({ agent_id: 'a9', agent_type: 'Explore' });
  agents.list = [{ id: 'a9', type: 'Explore', description: '', status: 'running' }];
  await clock.advance(10_000);
  expect(panel.last?.subagents).toMatchObject([{ id: 'a9', type: 'Explore' }]);
  expect(panel.last?.activities).toMatchObject([{ kind: 'adhoc', agents: [{ id: 'a9' }] }]);
  await $.classic.SubagentStop({ agent_id: 'a9', agent_type: 'Explore' } as never);
  agents.list = [];
  await clock.advance(10_000);
  expect(panel.last?.subagents).toEqual([]);
  expect(panel.last?.subagentsDone).toMatchObject([{ id: 'a9', type: 'Explore' }]);
  expect(panel.last?.activities).toEqual([]);
});

test("a workflow agent whose turn ends before its spawn is answered is ended once it is linked (E-09)", async ($, on) => {
  serveFiles(on, {});
  servePanes(on);
  const panel = panelWrites(on);
  const clock = mock.clock(on, { now: NOW });
  on('session.start', (_$, e) => ({ cwd: e.cwd }));
  on('session.id', () => ({ value: SESSION }));
  on('agent.list', () => ({ value: [] as never }));
  on('turn.complete', () => ({ text: '' }));
  // The engine beneath answers the spawn only when the test says so.
  const gate: { open?: () => void } = {};
  on('agent.spawn', () => new Promise<never>(resolve => { gate.open = () => resolve({ model: 'claude-sonnet-5-5', agentId: 'wf-a1' } as never); }));
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  const spawned = $.agent.spawn(spawnArgs('Survey the docs', { subagentType: 'general-purpose', description: 'survey', workflow: { runId: 'wf_1', agentIndex: 1 } }));
  for (let i = 0; i < 1000 && !gate.open; i++) await Promise.resolve();
  expect(gate.open).toBeDefined();
  // The agent's whole turn ends while its spawn is still being answered.
  await $.turn.complete({ turnId: 'w', agentId: 'wf-a1', answer: '', durationMs: 1, isAborted: false, reason: 'answer' } as never);
  gate.open!();
  await spawned;
  await clock.advance(10_000);
  expect(panel.last?.activities).toMatchObject([{ key: 'wf:wf_1', done: true, agents: [] }]);
  expect(panel.last?.waiting).toBeNull();
});

test("a subagent's two tools at once: the first to return leaves the other shown (E-11)", async ($, on) => {
  serveFiles(on, THREE);
  servePanes(on);
  const panel = panelWrites(on);
  const agents = { list: [] as unknown[] };
  const clock = start(on, agents, ['a1']);
  const gates: Record<string, () => void> = {};
  on('tool.call', (_$, e) => new Promise<never>(resolve => { gates[String(e.tool_use_id)] = () => resolve({ result: {} } as never); }));
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  await $.agent.spawn(spawnArgs('forge-task: T001-1 @shop'));
  agents.list = [{ id: 'a1', type: 'forge:forge-impl', description: 'agent', status: 'running' }];
  const read = $.tool.call({ tool: 'Read', agentId: 'a1', tool_use_id: 'r1', file_path: '/repo/x' } as never);
  const grep = $.tool.call({ tool: 'Grep', agentId: 'a1', tool_use_id: 'g1', pattern: 'x' } as never);
  await clock.advance(10_000);
  const agentOf = () => panel.last?.activities.find((a: { task: string }) => a.task === 'T001')?.agents[0];
  expect(agentOf()).toMatchObject({ id: 'a1', tool: 'Grep' });
  gates.g1();
  await grep;
  await clock.advance(10_000);
  expect(agentOf()).toMatchObject({ id: 'a1', tool: 'Read' });
  gates.r1();
  await read;
  await clock.advance(10_000);
  expect(agentOf()?.tool).toBeNull();
});

test('a tool call that fails beneath lens throws out of its hook: the .catch replays it, the call fails as it would without lens, and Now goes on (I-11)', async ($, on) => {
  serveFiles(on, {});
  servePanes(on);
  const panel = panelWrites(on);
  const clock = start(on);
  let runs = 0;
  on('tool.call', { tool: 'Read' }, () => { runs++; throw new Error('the tool failed'); });
  on('tool.call', { tool: 'Grep' }, () => ({ result: { ok: true } }) as never);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  let failed = '';
  try { await $.tool.call({ tool: 'Read', tool_use_id: 'r1', file_path: '/repo/x' } as never); } catch (err) { failed = (err as Error).message; }
  // The engine's own failure, reached once: the replay ran nothing beneath again.
  expect(failed).toContain('tool.call');
  expect(failed).not.toContain('lens');
  expect(runs).toBe(1);
  expect(await $.tool.call({ tool: 'Grep', tool_use_id: 'g1', pattern: 'x' } as never)).toMatchObject({ result: { ok: true } });
  await clock.advance(10_000);
  expect(panel.last?.tool).toBeNull();
});

const ES_PLAN = `project: shop
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

test('with a Spanish plan the pane speaks Spanish: the tasks in progress, a job and the wait on one subagent (task 8 review)', async ($, on) => {
  serveFiles(on, {
    [`${ROOT}/docs/waypoint/shop/plan.yaml`]: ES_PLAN,
    [`${ROOT}/.forge/status/shop__T001.json`]: status('T001'),
    [`${ROOT}/.forge/jobs/review-prep-T001-1-42.json`]: JSON.stringify({ name: 'review-prep-T001-1-42', cmd: 'review-prep', task: 'T001-1', pid: 42, startedAt: at(2), out: 'x.json', session: SESSION }),
  });
  servePanes(on);
  const agents = { list: [] as unknown[] };
  const clock = start(on, agents, ['a1']);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  await $.agent.spawn(spawnArgs('Look around', { subagentType: 'Explore' }));
  agents.list = [{ id: 'a1', type: 'Explore', description: 'agent', status: 'running' }];
  await clock.advance(10_000);
  const ui = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS });
  const text = await said(ui);
  expect(text).toContain('Tareas en curso · 1');
  expect(text).toMatch(/T001[^]*validando · 2m/);
  expect(text).toContain('esperando a 1 subagente');
  expect(text).not.toContain('esperando a 1 subagentes');
  await ui.unmount();
});

test('the agent the person looks at expands its task and puts it first (F-08)', async ($, on) => {
  serveFiles(on, {
    [`${ROOT}/.forge/status/shop__T001.json`]: status('T001', { ts: at(50), lastAt: at(50) }),
    [`${ROOT}/.forge/status/shop__T002.json`]: status('T002'),
  });
  const open = servePanes(on);
  const panel = panelWrites(on);
  const agents = { list: [] as unknown[] };
  const clock = start(on, agents, ['a1']);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  await $.agent.spawn(spawnArgs('forge-task: T001-1 @shop'));
  agents.list = [{ id: 'a1', type: 'forge:forge-impl', description: 'agent', status: 'running' }];
  await clock.advance(10_000);
  expect(panel.last?.activities.filter((a: { expanded: boolean }) => a.expanded).map((a: { task: string }) => a.task)).toEqual(['T002']);
  const ui = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'Pane', requestId: PANE, props: { ...PANE_PROPS, view: { agentId: 'a1' } } });
  await clock.advance(2_000);
  expect(panel.last?.activities[0]).toMatchObject({ task: 'T001', expanded: true });
  await ui.unmount();
  // Closed (the kit has no $.ui.close: the engine's ✕ takes the pane away and the next refresh sees it gone), the pane
  // forgets the agent it showed: opened again, the newest task is the one expanded (carry 5).
  open.delete(PANE);
  await clock.advance(10_000);
  await $.command.run(RUN);
  await clock.advance(2_000);
  expect(panel.last?.activities.filter((a: { expanded: boolean }) => a.expanded).map((a: { task: string }) => a.task)).toEqual(['T002']);
});
