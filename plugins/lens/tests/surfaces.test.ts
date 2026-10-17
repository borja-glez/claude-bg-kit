import { expect, mock, test } from 'claude-code/testing';
import type { On, RenderElement } from 'claude-code';

const PANE = 'lens';
const ROOT = '/repo';
const SESSION_ID = 'conv-1';
const NOW = Date.parse('2026-10-11T10:05:00.000Z');
const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 9 }, view: {} };
const RUN = { command: 'lens', args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } };
const MAIN_TURN = { turnId: 't', answer: '', durationMs: 1, isAborted: false, reason: 'answer' } as never;
const SESSION = { cwd: ROOT, surface: 'terminal' as const, isInteractive: true };
const T2 = `${ROOT}/.forge/status/T002.json`;
const at = (min: number) => new Date(NOW - min * 60_000).toISOString();
const norm = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '');
// A forge task status of this conversation, as forge writes it in .forge/status/ (wave 3).
const status = (task: string, over: object = {}) => JSON.stringify({
  ts: at(1), task, path: 'medium', phase: 'implement', agent: 'forge-impl', validators: [], verdict: null, round: null, cap: null,
  taskStartedAt: at(10), stageSince: at(1), stages: {}, doneAt: null, lastAt: at(1), session: SESSION_ID, runId: null, project: null, ...over,
});

// A file system answered from memory: `files` may change between reads; every file was touched a minute ago, with its size.
function serveFiles(on: On, files: Record<string, string>) {
  on('session.root', () => ({ value: ROOT }));
  on('session.id', () => ({ value: SESSION_ID }));
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

function start(on: On) {
  const clock = mock.clock(on, { now: NOW });
  on('session.start', (_$, e) => ({ cwd: e.cwd }));
  on('agent.list', () => ({ value: [] }));
  on('turn.complete', () => ({ text: '' }));
  return clock;
}

function engineRows(on: On) {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return h(Text, {}, 'engine band') as RenderElement;
  });
}

test('outside fullscreen the status line sums up this session\'s forge work, and goes when it ends (step 4)', async ($, on) => {
  const files: Record<string, string> = { [T2]: status('T002', { phase: 'review', round: 2 }) };
  serveFiles(on, files);
  servePanes(on);
  engineRows(on);
  const lines: (string | undefined)[] = [];
  on('ui.status', (_$, e) => { lines.push(e.text); return { value: undefined }; });
  const clock = start(on);
  await $.session.start(SESSION);
  // A render outside fullscreen tells lens where it is drawn.
  const band = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS, viewport: { columns: 105, rows: 30, isFullscreen: false } });
  await band.unmount();
  await $.command.run(RUN);
  await clock.advance(1000);
  expect(lines.at(-1)).toBe('lens · T002 review r2');
  files[T2] = status('T002', { phase: 'stopped', doneAt: at(0), lastAt: at(0) });
  await clock.advance(10_000);
  expect(lines.at(-1)).toBeUndefined();
  expect(lines).toHaveLength(2);
});

test('while a turn runs the spinner names the task when the engine has no message, and the mode labels gain forge auto (step 4)', async ($, on) => {
  serveFiles(on, { [T2]: status('T002', { phase: 'review', round: 2, autonomy: 'auto' }) });
  servePanes(on);
  const messages: (string | null)[] = [];
  const modes: (readonly string[])[] = [];
  on('ui.render', { component: 'Spinner' }, ($, e) => {
    messages.push(e.props.message);
    const { Text } = $.ui.resolve(e);
    return h(Text, {}, e.props.word) as RenderElement;
  });
  on('ui.render', { component: 'SessionMode' }, ($, e) => {
    modes.push(e.props.modes);
    const { Text } = $.ui.resolve(e);
    return h(Text, {}, e.props.modes.join(' & ')) as RenderElement;
  });
  start(on);
  await $.session.start(SESSION);
  await $.command.run(RUN);
  const SPIN = { word: 'Baking', message: null, suffix: '…', mode: 'thinking' as const };
  let ui = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'Spinner', props: SPIN });
  expect(messages.at(-1)).toBe('T002 · review r2');
  await ui.unmount();
  ui = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'Spinner', props: { ...SPIN, message: 'Compacting' } });
  expect(messages.at(-1)).toBe('Compacting');
  await ui.unmount();
  const mode = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'SessionMode', props: { modes: ['focus'] } });
  expect(modes.at(-1)).toEqual(['focus', 'forge auto']);
  await mode.unmount();
});

test('a verdict and a new round make one toast without the score, none on the first model, and then at most one every 5 s (step 4, K4-05, Review Focus 5)', async ($, on) => {
  const files: Record<string, string> = { [T2]: status('T002', { phase: 'review', round: 1 }) };
  serveFiles(on, files);
  servePanes(on);
  const toasts: string[] = [];
  on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined }; });
  const clock = start(on);
  await $.session.start(SESSION);
  await $.command.run(RUN);
  expect(toasts).toEqual([]);
  files[T2] = status('T002', { phase: 'implement', round: 2, verdict: { action: 'fix', score: 0.4, round: 1, findings: { critical: 1, important: 2, minor: 0 } } });
  await $.turn.complete(MAIN_TURN);
  await clock.advance(1000);
  expect(toasts).toEqual(['T002 · verdict fix · 1 C · 2 I · T002 · round 2']);
  expect(toasts.join(' ')).not.toMatch(/0[.,]4/);
  // A status is re-read only when its size or mtime changes: this one grows (agent name), as a real write does.
  files[T2] = status('T002', { phase: 'implement', agent: 'forge-impl-2', round: 3, verdict: { action: 'fix', score: 0.3, round: 2, findings: { critical: 0, important: 1, minor: 0 } } });
  await clock.advance(1000);
  await $.turn.complete(MAIN_TURN);
  expect(toasts).toHaveLength(1);
  await clock.advance(4000);
  expect(toasts).toEqual(['T002 · verdict fix · 1 C · 2 I · T002 · round 2', 'T002 · verdict fix · 0 C · 1 I · T002 · round 3']);
});

test('a run this conversation coordinates that stops after 20 minutes is notified once, however often it stops again (step 4, Review Focus 5)', async ($, on) => {
  const PLAN = 'project: shop\nlocale: es\nversion: "0.1"\nversions:\n  - id: "0.1"\n    phases: [F1]\ntracks:\n  - { id: backend, name: Backend, color: blue }\nphases:\n  - { id: F1, name: Base, plan_status: committed }\ntasks:\n  - id: T001\n    title: Esquema\n    track: backend\n    phase: F1\n    done_when: x\n    zones: ["src/**"]\n';
  const exec = (over: object) => JSON.stringify({
    runId: 'r1', kind: 'plan', mode: 'subagents', parallel: 3, project: 'shop', base: 'main', branch: 'forge/run-shop', mergeOnFinish: false, coordinator: 'main',
    hookSession: SESSION_ID, active: true, stopReason: null, stallReason: null, startedAt: at(30), lastStepAt: at(1), lastBlockStep: null, sleepUntil: null,
    tasks: { T001: { status: 'running', stage: 'implement', round: 1, worktree: '/w', branch: 'task/T001', executor: 'subagents', attempts: 0, agent: null, startedAt: at(25), updatedAt: at(1), stageSince: at(1), detail: null } },
    ...over,
  });
  const stalled = { active: false, stopReason: 'stalled', stallReason: 'sin señal 12 min', lastStepAt: at(2) };
  const files: Record<string, string> = { [`${ROOT}/docs/waypoint/shop/plan.yaml`]: PLAN, [`${ROOT}/.forge/execution.json`]: exec({}) };
  serveFiles(on, files);
  servePanes(on);
  const notes: string[] = [];
  on('ui.notify', (_$, e) => { notes.push(e.text); return { value: { isSent: true as const, channel: 'kitty' as const } }; });
  const clock = start(on);
  await $.session.start(SESSION);
  await $.command.run(RUN);
  files[`${ROOT}/.forge/execution.json`] = exec(stalled);
  await clock.advance(10_000);
  expect(notes).toEqual(['Ejecución parada: sin señal 12 min']);
  files[`${ROOT}/.forge/execution.json`] = exec({ lastStepAt: at(0) });
  await clock.advance(10_000);
  files[`${ROOT}/.forge/execution.json`] = exec({ ...stalled, lastStepAt: at(0) });
  await clock.advance(10_000);
  expect(notes).toHaveLength(1);
});

test('a forge task this session runs keeps lens reading with the pane closed: its band and its status line, with no subagent nor todo (§4.6)', async ($, on) => {
  serveFiles(on, { [T2]: status('T002') });
  servePanes(on);
  engineRows(on);
  const lines: (string | undefined)[] = [];
  on('ui.status', (_$, e) => { lines.push(e.text); return { value: undefined }; });
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '{}', stderr: '', interrupted: false } }) as never);
  const clock = start(on);
  const MAIN = { columns: 105, rows: 30, isFullscreen: false };
  await $.session.start(SESSION);
  let band = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS, viewport: MAIN });
  expect(await band.find({ key: 'panel' })).toBeUndefined();
  await band.unmount();
  await $.tool.call({ tool: 'Bash', command: 'node "/x/dist/forge.cjs" prep --task T002-1 --path medium', tool_use_id: 'b1' } as never);
  await clock.advance(30_000);
  band = await $.ui.mount({ plugin: 'lens', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS, viewport: MAIN });
  expect(await band.find({ key: 'panel' })).toBeDefined();
  await band.unmount();
  expect(lines.at(-1)).toBe('lens · T002 implement');
});
