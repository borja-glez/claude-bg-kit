import { expect, mock, test } from 'claude-code/testing';
import type { On } from 'claude-code';

const PANE = 'lens';
const RUN = { command: 'lens', args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } };
const NOW = Date.parse('2026-10-12T12:00:00.000Z');
const ROOT = '/repo';
const SESSION = 'sess-1';

const norm = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '');

// A file system answered from memory; writes land in `written`.
function serveFiles(
  on: On, files: Record<string, string>, written: Record<string, string> = {}, reads: string[] = [],
  beforeWrite: (path: string, text: string) => unknown = () => undefined,
  mtimes: Record<string, number> = {},
) {
  const mtimeOf = (path: string) => mtimes[path] ?? NOW;
  on('session.root', () => ({ value: ROOT }));
  on('fs.read', (_$, e) => {
    reads.push(norm(e.path));
    const f = files[norm(e.path)];
    return f !== undefined ? { value: f } : { deny: `ENOENT ${e.path}` };
  });
  on('fs.exists', (_$, e) => {
    const p = norm(e.path);
    return { value: p in files || Object.keys(files).some(f => f.startsWith(`${p}/`)) };
  });
  on('fs.stat', (_$, e) => {
    const f = files[norm(e.path)];
    return f !== undefined ? { value: { kind: 'file' as const, size: f.length, mtimeMs: mtimeOf(norm(e.path)), isLink: false } } : { deny: `ENOENT ${e.path}` };
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
      ? { value: [...names].map(([name, f]) => ({ name, kind: f.kind, size: f.size, mtimeMs: mtimeOf(`${prefix}${name}`), isLink: false })) }
      : { deny: `ENOENT ${e.path}` };
  });
  on('fs.write', async (_$, e) => {
    await beforeWrite(norm(e.path), e.text);
    written[norm(e.path)] = e.text;
    files[norm(e.path)] = e.text;
    return { value: undefined };
  });
  return written;
}

function servePanes(on: On) {
  const open = new Set<string>();
  on('ui.open', (_$, e) => { open.add(e.id); return { value: { isPlaced: true as const } }; });
  on('ui.close', (_$, e) => { open.delete(e.id); return { value: undefined }; });
  on('ui.panes', () => ({
    value: [...open].map(id => ({ id, title: 'lens', isShown: true, isFocused: false, isPlaced: true })),
  }));
}

function start(on: On, agents: unknown[] = []) {
  const clock = mock.clock(on, { now: NOW });
  on('session.start', (_$, e) => ({ cwd: e.cwd }));
  on('agent.list', () => ({ value: agents as never }));
  on('classic.SubagentStart', () => ({}));
  on('session.id', () => ({ value: SESSION }));
  on('session.usage', () => ({ value: { startedAt: NOW - 60_000, context: {} as never, rateLimits: [], cost: { usd: 4.1 } } }));
  return clock;
}

const stepResult = (usage: Record<string, number>, model: string, turnId = 't1', index = 0) => ({
  turnId, index, answer: 'ok', toolUses: [], stopReason: 'end_turn' as never,
  usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...usage, model },
});

// The model beneath lens answers each turn.step with this result.
function serveSteps(on: On) {
  on('turn.step', async function* (_$, e) {
    return stepResult(e.model.includes('opus') ? { input_tokens: 1_000_000 } : { output_tokens: 10_000 }, e.model, e.turnId, e.index);
  });
}

// Runs a streaming call to its end and returns its result.
async function drain<R>(stream: AsyncGenerator<unknown, R>): Promise<R> {
  for (;;) {
    const x = await stream.next();
    if (x.done) return x.value;
  }
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

test('a main-loop turn.step is measured and passed through unchanged', async ($, on) => {
  serveFiles(on, {});
  servePanes(on);
  const panel = panelWrites(on);
  start(on);
  serveSteps(on);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  const r = await drain($.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 }));
  expect(r).toEqual(stepResult({ input_tokens: 1_000_000 }, 'claude-opus-5-5'));
  await $.command.run(RUN);
  const m = panel.last;
  expect(m?.mainModel).toEqual({ model: 'claude-opus-5-5', effort: 'high' });
  expect(m?.usage.costUsd).toBeGreaterThan(3.99);
  expect(m?.usage.costUsd).toBeLessThan(4.01);
  expect(m?.usage.officialUsd).toBe(4.1);
});

test('with .forge/ in the root a refresh writes the session usage file', async ($, on) => {
  const written = serveFiles(on, { [`${ROOT}/.forge/config.yaml`]: 'x: 1\n' });
  servePanes(on);
  start(on);
  serveSteps(on);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await drain($.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 }));
  await $.command.run(RUN);
  const text = written[`${ROOT}/.forge/usage/${SESSION}.json`];
  expect(text).toBeDefined();
  const file = JSON.parse(text!);
  expect(file.v).toBe(1);
  expect(file.session).toBe(SESSION);
  expect(file.worktree).toBe(ROOT);
  expect(file.costUsd).toBe(4.1);
  expect(file.loops.main.model).toBe('claude-opus-5-5');
});

test('without .forge/ no usage file is written', async ($, on) => {
  const written = serveFiles(on, {});
  servePanes(on);
  start(on);
  serveSteps(on);
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }));
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await drain($.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 }));
  await $.command.run(RUN);
  await $.session.end({ reason: 'other', sessionId: SESSION, resume: {} as never });
  expect(Object.keys(written)).toEqual([]);
});

test('the session end writes the usage file even within 30 s of the last write', async ($, on) => {
  const written = serveFiles(on, { [`${ROOT}/.forge/config.yaml`]: 'x: 1\n' });
  servePanes(on);
  start(on);
  serveSteps(on);
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }));
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await drain($.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 }));
  await $.command.run(RUN);
  const path = `${ROOT}/.forge/usage/${SESSION}.json`;
  expect(JSON.parse(written[path]!).loops.main.steps).toBe(1);
  await drain($.turn.step({ turnId: 't1', index: 1, model: 'claude-opus-5-5', messageCount: 2 }));
  await $.session.end({ reason: 'other', sessionId: SESSION, resume: {} as never });
  expect(JSON.parse(written[path]!).loops.main.steps).toBe(2);
});

test('a spawned subagent gets its type, and its own turn.step puts its model on its loop', async ($, on) => {
  serveFiles(on, {});
  servePanes(on);
  const panel = panelWrites(on);
  start(on, [{ id: 'a1', type: 'forge:forge-impl', description: 'Implement T07', status: 'running' }]);
  serveSteps(on);
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }));
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  const spawned = await $.agent.spawn({
    tool_use_id: 'tu1', prompt: 'p', description: 'Implement T07', subagentType: 'forge:forge-impl',
    provider: {} as never, parentModel: 'claude-opus-5-5',
  } as never);
  expect(spawned).toEqual({ model: 'claude-sonnet-5-5', agentId: 'a1' });
  await drain($.turn.step({ turnId: 't2', index: 0, model: 'claude-sonnet-5-5', effort: 'medium', messageCount: 1, agentId: 'a1' }));
  await $.command.run(RUN);
  const m = panel.last;
  expect(m?.subagents[0]).toMatchObject({ id: 'a1', model: 'claude-sonnet-5-5', effort: 'medium' });
  expect(m?.usage.groups.map((g: { id: string }) => g.id)).toContain('impl');
  expect(m?.mainModel).toBeNull();
});

test('a main-loop waypoint call counts as tracking and its result is returned unchanged', async ($, on) => {
  serveFiles(on, {});
  servePanes(on);
  const panel = panelWrites(on);
  start(on);
  serveSteps(on);
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'ok' } as never, text: 'x'.repeat(400) }));
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await drain($.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 }));
  const r = await $.tool.call({ tool: 'Bash', command: 'node waypoint.cjs status' } as never);
  expect(r).toMatchObject({ text: 'x'.repeat(400) });
  await $.command.run(RUN);
  const m = panel.last;
  expect(m?.usage.tracking.tokens).toBeGreaterThanOrEqual(100);
});

test('with a forge run, the panel sums every session file updated since the run began, this one from memory', async ($, on) => {
  const other = {
    v: 1, session: 'sess-2', label: 'B', worktree: '/repo-b', startedAt: new Date(NOW - 3600_000).toISOString(),
    updatedAt: new Date(NOW - 60_000).toISOString(), costUsd: null, tracking: { waypoint: 0, forge: 0 },
    loops: { main: { kind: 'main', description: null, model: 'claude-opus-5-5', effort: null, steps: 3, input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 4, unpriced: 0 } },
  };
  const stale = { ...other, session: 'sess-3', updatedAt: new Date(NOW - 3 * 3600_000).toISOString() };
  serveFiles(on, {
    [`${ROOT}/.forge/run.json`]: JSON.stringify({ startedAt: new Date(NOW - 2 * 3600_000).toISOString() }),
    [`${ROOT}/.forge/usage/sess-2.json`]: JSON.stringify(other),
    [`${ROOT}/.forge/usage/sess-3.json`]: JSON.stringify(stale),
    [`${ROOT}/.forge/usage/${SESSION}.json`]: JSON.stringify({ ...other, session: SESSION }),
  });
  servePanes(on);
  const panel = panelWrites(on);
  start(on);
  serveSteps(on);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await drain($.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 }));
  await $.command.run(RUN);
  const m = panel.last;
  expect(m?.usage.scope).toBe('run');
  expect(m?.usage.costUsd).toBeGreaterThan(7.99);
  expect(m?.usage.costUsd).toBeLessThan(8.01);
  expect(m?.usage.session.costUsd).toBeGreaterThan(3.99);
  expect(m?.usage.session.costUsd).toBeLessThan(4.01);
});

const usageFile = (session: string, over: Record<string, unknown> = {}) => JSON.stringify({
  v: 1, session, label: session, worktree: `/w/${session}`, startedAt: new Date(NOW - 60_000).toISOString(),
  updatedAt: new Date(NOW - 30_000).toISOString(), costUsd: null, tracking: { waypoint: 0, forge: 0 },
  loops: { main: { kind: 'main', description: null, model: 'claude-opus-5-5', effort: null, steps: 3, input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 4, unpriced: 0 } },
  ...over,
});

test('a turn.step hands every chunk on unchanged and in order', async ($, on) => {
  serveFiles(on, {});
  servePanes(on);
  start(on);
  const chunks = [{ kind: 'text', index: 0, text: 'a' }, { kind: 'text', index: 0, text: 'b' }];
  on('turn.step', async function* (_$, e) {
    for (const c of chunks) yield c as never;
    return stepResult({ input_tokens: 10 }, e.model, e.turnId, e.index);
  });
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 });
  const seen: unknown[] = [];
  let x = await stream.next();
  while (!x.done) { seen.push(x.value); x = await stream.next(); }
  expect(seen).toEqual(chunks);
  expect(x.value).toEqual(stepResult({ input_tokens: 10 }, 'claude-opus-5-5'));
});

test('classic.SubagentStart labels a loop agent.spawn did not', async ($, on) => {
  serveFiles(on, {});
  servePanes(on);
  const panel = panelWrites(on);
  start(on, [{ id: 'a9', type: 'forge:forge-review-security', status: 'running' }]);
  serveSteps(on);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.classic.SubagentStart({ agent_id: 'a9', agent_type: 'forge:forge-review-security' });
  await drain($.turn.step({ turnId: 't3', index: 0, model: 'claude-sonnet-5-5', messageCount: 1, agentId: 'a9' }));
  await $.command.run(RUN);
  expect(panel.last?.usage.groups.map((g: { id: string }) => g.id)).toContain('review');
});

test('usage files are re-read one by one only when they change, and not on every panel write', async ($, on) => {
  const reads: string[] = [];
  const files: Record<string, string> = {
    [`${ROOT}/.forge/run.json`]: JSON.stringify({ startedAt: new Date(NOW - 3600_000).toISOString() }),
    [`${ROOT}/.forge/usage/sess-2.json`]: usageFile('sess-2'),
    [`${ROOT}/.forge/usage/sess-3.json`]: '{ torn',
  };
  serveFiles(on, files, {}, reads);
  servePanes(on);
  const clock = start(on);
  serveSteps(on);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await drain($.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 }));
  await $.command.run(RUN);
  expect(reads).toContain(`${ROOT}/.forge/usage/sess-2.json`);
  expect(reads).toContain(`${ROOT}/.forge/usage/sess-3.json`);
  // Panel writes between refreshes read no run file.
  reads.length = 0;
  await drain($.turn.step({ turnId: 't1', index: 1, model: 'claude-opus-5-5', messageCount: 2 }));
  await clock.advance(2000);
  expect(reads.filter(p => p.includes('/.forge/'))).toEqual([]);
  // A refresh with nothing changed reads neither file, the unparsable one included.
  await clock.advance(10_000);
  expect(reads).not.toContain(`${ROOT}/.forge/usage/sess-2.json`);
  expect(reads).not.toContain(`${ROOT}/.forge/usage/sess-3.json`);
  // A changed file is read again, alone.
  files[`${ROOT}/.forge/usage/sess-3.json`] = usageFile('sess-3');
  reads.length = 0;
  await clock.advance(10_000);
  expect(reads).toContain(`${ROOT}/.forge/usage/sess-3.json`);
  expect(reads).not.toContain(`${ROOT}/.forge/usage/sess-2.json`);
});

test('a resumed session continues its own usage file when its start matches', async ($, on) => {
  const written = serveFiles(on, { [`${ROOT}/.forge/usage/${SESSION}.json`]: usageFile(SESSION) });
  servePanes(on);
  const panel = panelWrites(on);
  start(on);
  serveSteps(on);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await drain($.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 }));
  await $.command.run(RUN);
  expect(panel.last?.usage.costUsd).toBeGreaterThan(7.99);
  expect(JSON.parse(written[`${ROOT}/.forge/usage/${SESSION}.json`]!).loops.main.steps).toBe(4);
});

test('a session file with another start is not continued', async ($, on) => {
  const old = usageFile(SESSION, { startedAt: new Date(NOW - 7200_000).toISOString() });
  const written = serveFiles(on, { [`${ROOT}/.forge/usage/${SESSION}.json`]: old });
  servePanes(on);
  start(on);
  serveSteps(on);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await drain($.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 }));
  await $.command.run(RUN);
  expect(JSON.parse(written[`${ROOT}/.forge/usage/${SESSION}.json`]!).loops.main.steps).toBe(1);
});

test('an unchanged count is not written again on the tick', async ($, on) => {
  const writes: string[] = [];
  serveFiles(on, { [`${ROOT}/.forge/config.yaml`]: 'x: 1\n' }, {}, [], path => { writes.push(path); });
  servePanes(on);
  const clock = start(on);
  serveSteps(on);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await drain($.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 }));
  await $.command.run(RUN);
  expect(writes).toHaveLength(1);
  await clock.advance(70_000);
  expect(writes).toHaveLength(1);
  await drain($.turn.step({ turnId: 't1', index: 1, model: 'claude-opus-5-5', messageCount: 2 }));
  await clock.advance(30_000);
  expect(writes).toHaveLength(2);
});

test('the session end waits for a write in flight and then writes the final count', async ($, on) => {
  const texts: string[] = [];
  let release = () => {};
  const gate = new Promise<void>(r => { release = r; });
  let started = () => {};
  const inFlight = new Promise<void>(r => { started = r; });
  serveFiles(on, { [`${ROOT}/.forge/config.yaml`]: 'x: 1\n' }, {}, [], async (_path, text) => {
    if (!texts.length) { started(); await gate; }
    texts.push(text);
  });
  servePanes(on);
  start(on);
  serveSteps(on);
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }));
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await drain($.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 }));
  const opened = $.command.run(RUN);
  await inFlight;
  await drain($.turn.step({ turnId: 't1', index: 1, model: 'claude-opus-5-5', messageCount: 2 }));
  const ended = $.session.end({ reason: 'other', sessionId: SESSION, resume: {} as never });
  release();
  await ended;
  await opened;
  expect(texts.map(t => JSON.parse(t).loops.main.steps)).toEqual([1, 2]);
});

// A session whose id and start the test changes, as the engine does after /clear or an in-process resume
// (session.end, then the process goes on under a new id with no session.start).
function startSwitchable(on: On) {
  const clock = mock.clock(on, { now: NOW });
  const cur = { id: SESSION, startedAt: NOW - 60_000 };
  on('session.start', (_$, e) => ({ cwd: e.cwd }));
  on('agent.list', () => ({ value: [] as never }));
  on('session.id', () => ({ value: cur.id }));
  on('session.usage', () => ({ value: { startedAt: cur.startedAt, context: {} as never, rateLimits: [], cost: { usd: 1 } } }));
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }));
  return { clock, cur };
}

test('after /clear the old file is kept and the new session gets its own, the timers still running', async ($, on) => {
  const written = serveFiles(on, { [`${ROOT}/.forge/config.yaml`]: 'x: 1\n' });
  servePanes(on);
  const { clock, cur } = startSwitchable(on);
  serveSteps(on);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await drain($.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 }));
  await $.command.run(RUN);
  await drain($.turn.step({ turnId: 't1', index: 1, model: 'claude-opus-5-5', messageCount: 2 }));
  await $.session.end({ reason: 'clear', sessionId: SESSION, resume: {} as never });
  const oldPath = `${ROOT}/.forge/usage/${SESSION}.json`;
  const oldText = written[oldPath];
  expect(JSON.parse(oldText!).loops.main.steps).toBe(2);
  cur.id = 'sess-new';
  cur.startedAt = NOW + 1000;
  await drain($.turn.step({ turnId: 't2', index: 0, model: 'claude-opus-5-5', messageCount: 1 }));
  await clock.advance(30_000);
  expect(written[oldPath]).toBe(oldText);
  const fresh = JSON.parse(written[`${ROOT}/.forge/usage/sess-new.json`]!);
  expect(fresh.session).toBe('sess-new');
  expect(fresh.startedAt).toBe(new Date(NOW + 1000).toISOString());
  expect(fresh.loops.main.steps).toBe(1);
});

test('after an in-process resume the resumed session continues its own file and the old one is kept', async ($, on) => {
  const written = serveFiles(on, {
    [`${ROOT}/.forge/config.yaml`]: 'x: 1\n',
    [`${ROOT}/.forge/usage/sess-old.json`]: usageFile('sess-old', { startedAt: new Date(NOW - 7200_000).toISOString() }),
  });
  servePanes(on);
  const { clock, cur } = startSwitchable(on);
  serveSteps(on);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await drain($.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 }));
  await $.command.run(RUN);
  await $.session.end({ reason: 'resume', sessionId: SESSION, resume: {} as never });
  const ownPath = `${ROOT}/.forge/usage/${SESSION}.json`;
  const ownText = written[ownPath];
  expect(JSON.parse(ownText!).loops.main.steps).toBe(1);
  cur.id = 'sess-old';
  cur.startedAt = NOW - 7200_000;
  await drain($.turn.step({ turnId: 't2', index: 0, model: 'claude-opus-5-5', messageCount: 1 }));
  await clock.advance(30_000);
  expect(written[ownPath]).toBe(ownText);
  // The resumed file had 3 steps; one more since the resume.
  expect(JSON.parse(written[`${ROOT}/.forge/usage/sess-old.json`]!).loops.main.steps).toBe(4);
});

test('no usage file is written before the session start is known', async ($, on) => {
  const written = serveFiles(on, { [`${ROOT}/.forge/config.yaml`]: 'x: 1\n' });
  servePanes(on);
  mock.clock(on, { now: NOW });
  on('session.start', (_$, e) => ({ cwd: e.cwd }));
  on('agent.list', () => ({ value: [] as never }));
  on('session.id', () => ({ value: SESSION }));
  on('session.usage', () => ({ deny: 'no usage here' }));
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }));
  serveSteps(on);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await drain($.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 }));
  await $.command.run(RUN);
  await $.session.end({ reason: 'other', sessionId: SESSION, resume: {} as never });
  expect(Object.keys(written)).toEqual([]);
});

// I2: forge's run in a checkout without a roadmap, coordinated by this session: its band names the run as this session's.
const execution = (over: Record<string, unknown> = {}) => JSON.stringify({
  runId: 'e1', kind: 'ephemeral', mode: 'subagents', parallel: 2, project: 'loose', base: 'main', branch: 'forge/run-e1', mergeOnFinish: false,
  coordinator: 'main', hookSession: SESSION, active: true, stopReason: null, stallReason: null, startedAt: new Date(NOW - 3600_000).toISOString(),
  lastStepAt: new Date(NOW - 60_000).toISOString(), lastBlockStep: null, sleepUntil: null, tasks: {}, ...over,
});

test('with the pane closed and nothing going on, the usage file names no run until the tick reads the band, then the run (I2)', async ($, on) => {
  const files: Record<string, string> = { [`${ROOT}/.forge/config.yaml`]: 'x: 1\n' };
  const texts: string[] = [];
  serveFiles(on, files, {}, [], (_path, text) => { texts.push(text); });
  servePanes(on);
  const clock = start(on);
  serveSteps(on);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await drain($.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 }));
  const path = `${ROOT}/.forge/usage/${SESSION}.json`;
  // No run yet, and the band was never read: the file says nothing of a run (not that it has none).
  await clock.advance(30_000);
  expect(JSON.parse(files[path]!)).not.toHaveProperty('runKey');
  // The run starts: the next tick reads the band once, the file names the run, and its baseline is taken now.
  files[`${ROOT}/.forge/execution.json`] = execution();
  await clock.advance(30_000);
  expect(JSON.parse(files[path]!)).toMatchObject({ runKey: 'e1', runBaseline: { runKey: 'e1' } });
  expect(texts.map(t => JSON.parse(t)).filter(f => 'runKey' in f && f.runKey === null)).toEqual([]);
});

test('a session counts in its run only what it spent once its band names the run: its baseline is taken then (E-07)', async ($, on) => {
  const files: Record<string, string> = { [`${ROOT}/.forge/config.yaml`]: 'x: 1\n' };
  serveFiles(on, files);
  servePanes(on);
  const panel = panelWrites(on);
  const clock = start(on);
  serveSteps(on);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  // $4 before the run, then the run starts and the tick reads the band: the baseline is that $4.
  await drain($.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 }));
  files[`${ROOT}/.forge/execution.json`] = execution();
  await clock.advance(30_000);
  // $4 more within the run.
  await drain($.turn.step({ turnId: 't1', index: 1, model: 'claude-opus-5-5', messageCount: 2 }));
  await $.command.run(RUN);
  const u = panel.last?.usage;
  expect(u).toMatchObject({ scope: 'run', partial: false });
  expect(u.costUsd).toBeGreaterThan(3.99);
  expect(u.costUsd).toBeLessThan(4.01);
  expect(u.session.costUsd).toBeGreaterThan(7.99);
  expect(u.session.costUsd).toBeLessThan(8.01);
});

test("a compaction of the main conversation stops the re-read of the tracking gathered before it; a subagent's does not (E-08)", async ($, on) => {
  serveFiles(on, {});
  servePanes(on);
  const panel = panelWrites(on);
  const clock = start(on);
  serveSteps(on);
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'ok' } as never, text: 'x'.repeat(400) }));
  const summary = [{ role: 'user' as const, text: 'summary', toolUses: [] }];
  on('session.compact', () => ({ messages: summary }));
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  await $.tool.call({ tool: 'Bash', command: 'node waypoint.cjs status' } as never);
  // Each main step re-reads the tracking gathered since the last compaction of the main conversation.
  const stepThen = async (index: number) => {
    await drain($.turn.step({ turnId: 't1', index, model: 'claude-opus-5-5', messageCount: index + 1 }));
    await clock.advance(1000);
    return panel.last?.usage.tracking.tokens as number;
  };
  const once = await stepThen(0);
  expect(once).toBeGreaterThan(0);
  await $.session.compact({ trigger: 'auto', agentId: 'a1', messages: summary });
  expect(await stepThen(1)).toBe(once * 1.5);
  await $.session.compact({ trigger: 'manual', messages: summary });
  expect(await stepThen(2)).toBe(once * 1.5);
});

test('a run that is neither active nor touched within 12 hours is over: only this session shows', async ($, on) => {
  const files = {
    [`${ROOT}/.forge/run.json`]: JSON.stringify({ active: false, startedAt: new Date(NOW - 20 * 3600_000).toISOString() }),
    [`${ROOT}/.forge/usage/sess-2.json`]: usageFile('sess-2'),
  };
  serveFiles(on, files, {}, [], () => undefined, { [`${ROOT}/.forge/run.json`]: NOW - 13 * 3600_000 });
  servePanes(on);
  const panel = panelWrites(on);
  start(on);
  serveSteps(on);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await drain($.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 }));
  await $.command.run(RUN);
  expect(panel.last?.usage.scope).toBe('session');
});

test('a resumed session checks /cost against what it spent since the seed, not against the seeded file too (E-12)', async ($, on) => {
  const seeded = { main: { kind: 'main', description: null, model: 'claude-opus-5-5', effort: null, steps: 3, input: 25_000_000, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 100, unpriced: 0 } };
  serveFiles(on, { [`${ROOT}/.forge/usage/${SESSION}.json`]: usageFile(SESSION, { loops: seeded }) });
  servePanes(on);
  const panel = panelWrites(on);
  start(on);
  serveSteps(on);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await drain($.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 }));
  await $.command.run(RUN);
  expect(panel.last?.usage.costUsd).toBeGreaterThan(103.99);
  expect(panel.last?.usage.officialUsd).toBe(4.1);
  expect(panel.last?.usage.drift).toBe(false);
});
