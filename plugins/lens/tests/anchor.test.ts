import { expect, mock, test } from 'claude-code/testing';
import type { Engine } from 'claude-code/testing';
import type { On } from 'claude-code';

// The lens project anchor (docs/superpowers/specs/2026-10-27-lens-project-anchor-design.md): a session started in a
// central folder of repositories reads this conversation's project wherever it is, a shell cd moves nothing, and a
// conversation with no anchor shows nothing read from project files.
const PANE = 'lens';
const PANE_PROPS = { title: 'lens', isFocused: false, bodyColumns: 60, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} };
const RUN = { command: 'lens', args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } };
const NOW = Date.parse('2026-10-11T10:05:00.000Z');
const CENTRAL = '/c';
const REPO = '/c/a';
const SIBLING = '/c/b';
const SESSION_ID = 'conv-1';
const OTHER = 'conv-9';
const AT = (min: number) => new Date(NOW + min * 60_000).toISOString();
const norm = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '');

// The waypoint project of panel.test.ts: a plan of two phases, its session and its running task.
const SHOP_PLAN = `project: shop
locale: es
version: "0.1"
versions:
  - id: "0.1"
    phases: [F1, F2]
tracks:
  - { id: backend, name: Backend, color: blue }
phases:
  - { id: F1, name: Base, plan_status: committed }
  - { id: F2, name: Entrega, plan_status: committed }
tasks:
  - id: T001
    title: Esquema de pedidos
    track: backend
    phase: F1
    done_when: migración aplicada
    zones: ["src/db/**"]
  - id: T002
    title: Envío
    track: backend
    phase: F2
    done_when: pedido enviado
    depends_on: [T001]
    zones: ["src/ship/**"]
`;
// The run's tasks, by the titles forge gave them: what a conversation sees of the run and its tasks.
const RUN_TITLES = ['Migrate the orders', 'Ship the orders'];
const EXEC = (hookSession: string, titles: readonly string[] = RUN_TITLES) => JSON.stringify({
  runId: 'r1', kind: 'plan', mode: 'subagents', parallel: 3, project: 'shop', base: 'main', branch: 'forge/run-shop', mergeOnFinish: false,
  coordinator: 'main', hookSession, active: true, stopReason: null, stallReason: null, startedAt: AT(-60), lastStepAt: AT(-1), lastBlockStep: null, sleepUntil: null,
  tasks: Object.fromEntries(titles.map((title, i) => [`T00${i + 1}`, {
    status: 'running', stage: 'implement', round: 0, worktree: '/w', branch: `task/T00${i + 1}`, executor: 'subagents', attempts: 0, agent: 'forge-impl',
    startedAt: AT(-20), stageSince: AT(-3), updatedAt: AT(-1), detail: null, title,
  }])),
});
const STATUS = (task: string, session: string, over: object = {}) => JSON.stringify({
  ts: AT(-1), task, path: 'medium', phase: 'implement', agent: 'forge-impl', validators: [], verdict: null, round: null, cap: null,
  taskStartedAt: AT(-10), stageSince: AT(-1), stages: {}, doneAt: null, lastAt: AT(-1), session, runId: 'r1', project: 'shop', ...over,
});
const BOUND = (claude: string) => JSON.stringify({ sid: 'S1', claude, pid: null, via: 'work', since: AT(-65), seenAt: AT(-1), endedAt: null, endReason: null });
// Another conversation's superpowers run in the repository: its ledger and its plan, both moving.
const OTHER_LEDGER = '# SDD ledger — plan: docs/superpowers/plans/other.md\n\n## Progress\nTasks 1-2: complete (abc..def)\nTask 3: fix round 1/5 (flaky test)\n';
const OTHER_PLAN = ['# Other plan', ...Array.from({ length: 4 }, (_, i) => `### Task ${i + 1}: Step ${i + 1}\n- [x] do it`)].join('\n');
// The plan this conversation runs inline: executing-plans ticks its checkboxes and writes no ledger.
const OWN_PLAN = '# Shop inline plan\n### Task 1: Step 1\n- [x] do it\n### Task 2: Step 2\n- [ ] do it\n';

// Repository A: the project shop, a run coordinated by `run`, its task statuses by `tasks`, a binding of `bound` when
// given, and another conversation's superpowers run.
function repoA(o: { run: string; tasks: string; bound?: string }): Record<string, string> {
  return {
    [`${REPO}/docs/waypoint/shop/plan.yaml`]: SHOP_PLAN,
    [`${REPO}/.waypoint/shop/session.json`]: JSON.stringify({ sessionId: 'S1', track: 'backend' }),
    ...(o.bound ? { [`${REPO}/.waypoint/shop/bound.json`]: BOUND(o.bound) } : {}),
    [`${REPO}/.waypoint/shop/dbcache/state/T001.json`]: JSON.stringify({ status: 'in_progress', owner: 'S1', startedAt: AT(-5) }),
    [`${REPO}/.forge/execution.json`]: EXEC(o.run),
    [`${REPO}/.forge/status/shop__T001.json`]: STATUS('T001', o.tasks),
    [`${REPO}/.forge/status/shop__T002.json`]: STATUS('T002', o.tasks),
    [`${REPO}/.superpowers/sdd/other/progress.md`]: OTHER_LEDGER,
    [`${REPO}/docs/superpowers/plans/other.md`]: OTHER_PLAN,
  };
}

// The session's folders and id, its shell's directory, and a file system answered from memory: every file touched a
// minute ago, with its size; writes land in `files` and their paths in `writes`.
type World = { root: string; cwd: string; id: string; files: Record<string, string>; writes: string[] };
function serveWorld(on: On, world: World) {
  const at = NOW - 60_000;
  on('session.root', () => ({ value: world.root }));
  on('session.cwd', () => ({ value: world.cwd }));
  on('session.id', () => ({ value: world.id }));
  on('fs.read', (_$, e) => { const f = world.files[norm(e.path)]; return f !== undefined ? { value: f } : { deny: `ENOENT ${e.path}` }; });
  on('fs.exists', (_$, e) => { const p = norm(e.path); return { value: p in world.files || Object.keys(world.files).some(f => f.startsWith(`${p}/`)) }; });
  on('fs.stat', (_$, e) => {
    const f = world.files[norm(e.path)];
    return f !== undefined ? { value: { kind: 'file' as const, size: f.length, mtimeMs: at, isLink: false } } : { deny: `ENOENT ${e.path}` };
  });
  on('fs.list', (_$, e) => {
    const prefix = `${norm(e.path)}/`;
    const names = new Map<string, { kind: 'file' | 'dir'; size: number }>();
    for (const [path, text] of Object.entries(world.files)) {
      if (!path.startsWith(prefix)) continue;
      const [head = '', ...rest] = path.slice(prefix.length).split('/');
      names.set(head, rest.length ? { kind: 'dir', size: 0 } : { kind: 'file', size: text.length });
    }
    return names.size
      ? { value: [...names].map(([name, f]) => ({ name, kind: f.kind, size: f.size, mtimeMs: at, isLink: false })) }
      : { deny: `ENOENT ${e.path}` };
  });
  on('fs.write', (_$, e) => { world.writes.push(norm(e.path)); world.files[norm(e.path)] = e.text; return { value: undefined }; });
}

function servePanes(on: On) {
  const open = new Set<string>();
  on('ui.open', (_$, e) => { open.add(e.id); return { value: { isPlaced: true as const } }; });
  on('ui.close', (_$, e) => { open.delete(e.id); return { value: undefined }; });
  on('ui.panes', () => ({ value: [...open].map(id => ({ id, title: 'lens', isShown: true, isFocused: false, isPlaced: true })) }));
}

// The engine beneath lens: its clock, the session's start and cost, an empty agents list, the tools a test calls and the
// model answering each turn.step.
function start(on: On) {
  const clock = mock.clock(on, { now: NOW });
  on('session.start', (_$, e) => ({ cwd: e.cwd }));
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }));
  on('session.usage', () => ({ value: { startedAt: NOW - 60_000, context: {} as never, rateLimits: [], cost: { usd: 1 } } }));
  on('agent.list', () => ({ value: [] }));
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '{}', stderr: '', interrupted: false } }) as never);
  on('turn.step', async function* (_$, e) {
    return {
      turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn' as never,
      usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: e.model },
    };
  });
  return clock;
}

// One main-loop model request, run to its end: the Now card's model and the Usage card come from it.
async function step($: Engine): Promise<void> {
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 });
  for (;;) if ((await stream.next()).done) return;
}

// Everything the pane says, in order: Text strings, Svg alt texts and Button labels.
async function pane($: Engine): Promise<string> {
  const ui = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS });
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
  await ui.unmount();
  return out.join(' | ');
}

const world = (root: string, files: Record<string, string>): World => ({ root, cwd: root, id: SESSION_ID, files, writes: [] });

test('a coordinator started in the central folder sees its roadmap, run and tasks', async ($, on) => {
  serveWorld(on, world(CENTRAL, repoA({ run: SESSION_ID, tasks: SESSION_ID })));
  servePanes(on);
  const clock = start(on);
  await $.session.start({ cwd: CENTRAL, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  await clock.advance(0);
  const text = await pane($);
  expect(text).toContain('Fase 1/2 · Base');
  for (const title of RUN_TITLES) expect(text).toContain(title);
});

test('a shell cd to a sibling repository changes nothing', async ($, on) => {
  const w = world(CENTRAL, {
    ...repoA({ run: SESSION_ID, tasks: SESSION_ID }),
    // Repository B: another conversation's run, which the shell's directory must not bring in.
    [`${SIBLING}/.forge/execution.json`]: EXEC(OTHER, ['Rewrite the cart']),
    [`${SIBLING}/.forge/status/shop__T001.json`]: STATUS('T001', OTHER),
  });
  w.cwd = SIBLING;
  serveWorld(on, w);
  servePanes(on);
  const clock = start(on);
  await $.session.start({ cwd: CENTRAL, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  await clock.advance(0);
  const before = await pane($);
  await $.tool.call({ tool: 'Bash', command: `cd ${SIBLING} && node "/x/dist/forge.cjs" status`, tool_use_id: 'b1' } as never);
  await clock.advance(30_000);
  const after = await pane($);
  for (const text of [before, after]) {
    expect(text).toContain('Fase 1/2 · Base');
    for (const title of RUN_TITLES) expect(text).toContain(title);
    expect(text).not.toContain('Rewrite the cart');
  }
  // The same cards, whatever the clock moved.
  expect(after.replace(/\d+/g, '#')).toBe(before.replace(/\d+/g, '#'));
});

test('a clean conversation in the central folder shows only its own cards', async ($, on) => {
  serveWorld(on, world(CENTRAL, repoA({ run: OTHER, tasks: OTHER, bound: OTHER })));
  servePanes(on);
  const clock = start(on);
  await $.session.start({ cwd: CENTRAL, surface: 'terminal', isInteractive: true });
  await step($);
  await $.command.run(RUN);
  await clock.advance(10_000);
  const text = await pane($);
  expect(text).not.toContain('Fase');
  for (const title of RUN_TITLES) expect(text).not.toContain(title);
  expect(text).not.toMatch(/te toca|waiting for you/i);
  expect(text).not.toMatch(/other\.md|Other plan|flaky test/);
  // Its own cards, from this session alone. With no project read there is no plan to take the language from: English.
  expect(text).toContain('Now');
  expect(text).toContain('Usage');
});

test('a clean conversation started inside the repository shows none of the other conversation\'s work', async ($, on) => {
  serveWorld(on, world(REPO, repoA({ run: OTHER, tasks: OTHER, bound: OTHER })));
  servePanes(on);
  const clock = start(on);
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true });
  await step($);
  await $.command.run(RUN);
  await clock.advance(10_000);
  const text = await pane($);
  for (const title of RUN_TITLES) expect(text).not.toContain(title);
  expect(text).not.toMatch(/Execution|Ejecución/);
  expect(text).not.toMatch(/Tasks in progress|Tareas en curso/);
  expect(text).not.toMatch(/other\.md|Other plan|flaky test/);
  expect(text).toContain('Now');
});

test('binding later anchors it', async ($, on) => {
  const w = world(CENTRAL, repoA({ run: OTHER, tasks: OTHER }));
  serveWorld(on, w);
  servePanes(on);
  const clock = start(on);
  await $.session.start({ cwd: CENTRAL, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  await clock.advance(0);
  expect(await pane($)).not.toContain('Fase');
  // The binding appears: the ordinary refresh does not search (decision 4), the waypoint call that wrote it does.
  w.files[`${REPO}/.waypoint/shop/bound.json`] = BOUND(SESSION_ID);
  await clock.advance(10_000);
  expect(await pane($)).not.toContain('Fase');
  await $.tool.call({ tool: 'Bash', command: 'node "/x/dist/waypoint.cjs" bind --task T001', tool_use_id: 'b1' } as never);
  await clock.advance(10_000);
  expect(await pane($)).toContain('Fase 1/2 · Base');
});

test('a lone forge task of its own shows that task and nothing of the run', async ($, on) => {
  serveWorld(on, world(CENTRAL, {
    [`${SIBLING}/.forge/execution.json`]: EXEC(OTHER),
    [`${SIBLING}/.forge/status/shop__T001.json`]: STATUS('T001', OTHER),
    [`${SIBLING}/.forge/status/T050.json`]: STATUS('T050', SESSION_ID, { runId: null, project: null }),
  }));
  servePanes(on);
  const clock = start(on);
  await $.session.start({ cwd: CENTRAL, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  await clock.advance(0);
  const text = await pane($);
  expect(text).toContain('T050');
  expect(text).toContain('Tasks in progress · 1');
  expect(text).not.toContain('T001');
  for (const title of RUN_TITLES) expect(text).not.toContain(title);
  expect(text).not.toContain('Execution');
});

test("its own superpowers plan shows; another conversation's ledger does not", async ($, on) => {
  const w = world(CENTRAL, repoA({ run: OTHER, tasks: OTHER }));
  serveWorld(on, w);
  servePanes(on);
  const clock = start(on);
  on('tool.call', { tool: 'Write' }, (_$, e) => { w.files[norm(String(e.file_path))] = String(e.content); return { result: { type: 'create' } } as never; });
  await $.session.start({ cwd: CENTRAL, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  await clock.advance(0);
  expect(await pane($)).not.toMatch(/other\.md|Other plan|flaky test|Shop inline plan/);
  await $.tool.call({ tool: 'Write', file_path: `${REPO}/docs/superpowers/plans/new.md`, content: OWN_PLAN, tool_use_id: 'w1' } as never);
  await clock.advance(10_000);
  const text = await pane($);
  // The card of the plan it runs inline, by its checkboxes; never the other conversation's ledger nor its plan.
  expect(text).toMatch(/Shop inline plan.*Task 2\/2.*1 done/);
  expect(text).not.toMatch(/other\.md|Other plan|flaky test/);
});

test('the usage file is written only with an anchor, in the anchored repository', async ($, on) => {
  const w = world(CENTRAL, repoA({ run: OTHER, tasks: OTHER }));
  serveWorld(on, w);
  servePanes(on);
  const clock = start(on);
  await $.session.start({ cwd: CENTRAL, surface: 'terminal', isInteractive: true });
  await step($);
  await clock.advance(31_000);
  await clock.advance(31_000);
  expect(w.writes.filter(p => p.includes('/.forge/usage/'))).toEqual([]);
  // This conversation coordinates the run now; the forge call it made searches again.
  w.files[`${REPO}/.forge/execution.json`] = EXEC(SESSION_ID);
  await $.tool.call({ tool: 'Bash', command: 'node "/x/dist/forge.cjs" step', tool_use_id: 'b1' } as never);
  await clock.advance(31_000);
  expect(w.writes.filter(p => p.includes('/.forge/usage/'))).toEqual([`${REPO}/.forge/usage/${SESSION_ID}.json`]);
});

test("/clear gives a new conversation that is not anchored by the old one's binding", async ($, on) => {
  const w = world(CENTRAL, repoA({ run: OTHER, tasks: OTHER, bound: SESSION_ID }));
  serveWorld(on, w);
  servePanes(on);
  const clock = start(on);
  await $.session.start({ cwd: CENTRAL, surface: 'terminal', isInteractive: true });
  await $.command.run(RUN);
  await clock.advance(0);
  expect(await pane($)).toContain('Fase 1/2 · Base');
  await $.session.end({ reason: 'clear', sessionId: SESSION_ID, resume: {} as never });
  w.id = 'conv-2';
  await clock.advance(1000);
  expect(await pane($)).not.toContain('Fase');
  await clock.advance(10_000);
  expect(await pane($)).not.toContain('Fase');
});
