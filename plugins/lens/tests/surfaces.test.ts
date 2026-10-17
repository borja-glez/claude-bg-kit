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
// `touched` gets every path read or listed (a status read once is cached, but its folder is listed on each refresh).
function serveFiles(on: On, files: Record<string, string>, touched: string[] = []) {
  on('session.root', () => ({ value: ROOT }));
  on('session.id', () => ({ value: SESSION_ID }));
  on('fs.read', (_$, e) => { touched.push(norm(e.path)); const f = files[norm(e.path)]; return f !== undefined ? { value: f } : { deny: `ENOENT ${e.path}` }; });
  on('fs.exists', (_$, e) => { const p = norm(e.path); return { value: p in files || Object.keys(files).some(f => f.startsWith(`${p}/`)) }; });
  on('fs.stat', (_$, e) => {
    const f = files[norm(e.path)];
    return f !== undefined ? { value: { kind: 'file' as const, size: f.length, mtimeMs: NOW - 60_000, isLink: false } } : { deny: `ENOENT ${e.path}` };
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

const BAND_AT = (viewport: { columns: number; rows: number; isFullscreen: boolean }, maxRows = 10) =>
  ({ plugin: 'lens' as const, surface: 'terminal' as const, component: 'AbovePrompt' as const, props: { ...BAND_PROPS, maxRows }, viewport });

test('the status line follows the view: a first model before any render, then fullscreen and maxRows on a stable stage (fix 1)', async ($, on) => {
  serveFiles(on, { [T2]: status('T002', { phase: 'review', round: 2 }) });
  servePanes(on);
  engineRows(on);
  const lines: (string | undefined)[] = [];
  on('ui.status', (_$, e) => { lines.push(e.text); return { value: undefined }; });
  start(on);
  await $.session.start(SESSION);
  // The model is built before any band render: the view is unknown, so no line yet.
  await $.command.run(RUN);
  expect(lines.at(-1)).toBeUndefined();
  let band = await $.ui.mount(BAND_AT({ columns: 105, rows: 30, isFullscreen: false }));
  await band.unmount();
  expect(lines.at(-1)).toBe('lens · T002 review r2');
  band = await $.ui.mount(BAND_AT({ columns: 160, rows: 40, isFullscreen: true }));
  await band.unmount();
  expect(lines.at(-1)).toBeUndefined();
  band = await $.ui.mount(BAND_AT({ columns: 160, rows: 40, isFullscreen: true }, 2));
  await band.unmount();
  expect(lines.at(-1)).toBe('lens · T002 review r2');
  band = await $.ui.mount(BAND_AT({ columns: 160, rows: 40, isFullscreen: true }, 8));
  await band.unmount();
  expect(lines.at(-1)).toBeUndefined();
});

test('an accept written together with doneAt still makes its toast (fix 2)', async ($, on) => {
  const files: Record<string, string> = { [T2]: status('T002', { phase: 'review', round: 2 }) };
  serveFiles(on, files);
  servePanes(on);
  const toasts: string[] = [];
  on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined }; });
  const clock = start(on);
  await $.session.start(SESSION);
  await $.command.run(RUN);
  files[T2] = status('T002', { phase: 'stopped', round: 2, doneAt: at(0), lastAt: at(0), verdict: { action: 'accept', score: 0.9, round: 2, findings: null } });
  await $.turn.complete(MAIN_TURN);
  await clock.advance(1000);
  expect(toasts).toEqual(['T002 · accepted in round 2']);
});

test('a burst keeps the queue and the joined toast short, and one 5 s gap (fix 3)', async ($, on) => {
  const files: Record<string, string> = {};
  const ids = ['T001', 'T002', 'T003', 'T004', 'T005', 'T006', 'T007', 'T008'];
  for (const id of ids) files[`${ROOT}/.forge/status/${id}.json`] = status(id, { phase: 'review', round: 1 });
  serveFiles(on, files);
  servePanes(on);
  const toasts: { at: number; text: string }[] = [];
  const clock = start(on);
  let elapsed = 0;
  on('ui.toast', (_$, e) => { toasts.push({ at: elapsed, text: e.text }); return { value: undefined }; });
  await $.session.start(SESSION);
  await $.command.run(RUN);
  for (const id of ids) {
    files[`${ROOT}/.forge/status/${id}.json`] = status(id, { phase: 'implement', round: 2, verdict: { action: 'fix', score: 0.4, round: 1, findings: { critical: 1, important: 2, minor: 0 } } });
  }
  await $.turn.complete(MAIN_TURN);
  for (let i = 0; i < 24; i++) { await clock.advance(500); elapsed += 500; }
  expect(toasts.length).toBeGreaterThan(0);
  for (const t of toasts) {
    expect(t.text.length).toBeLessThanOrEqual(200);
  }
  for (let i = 1; i < toasts.length; i++) expect(toasts[i]!.at - toasts[i - 1]!.at).toBeGreaterThanOrEqual(5000);
});

test('the forge.cjs call heard keeps the tick reading for 10 minutes, and no longer (fix 4)', async ($, on) => {
  const touched: string[] = [];
  serveFiles(on, { [T2]: status('T002', { phase: 'stopped', doneAt: at(20), lastAt: at(20) }) }, touched);
  servePanes(on);
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '{}', stderr: '', interrupted: false } }) as never);
  const clock = start(on);
  await $.session.start(SESSION);
  await $.tool.call({ tool: 'Bash', command: 'node "/x/dist/forge.cjs" prep --task T002-1 --path medium', tool_use_id: 'b1' } as never);
  await clock.advance(31_000);
  expect(touched.some(p => p.includes('/.forge'))).toBe(true);
  await clock.advance(11 * 60_000);
  touched.length = 0;
  await clock.advance(90_000);
  expect(touched.filter(p => p.includes('/.forge'))).toEqual([]);
});

test('an own task left in progress keeps the tick reading only while its status moved within 30 minutes (final review m-3)', async ($, on) => {
  const touched: string[] = [];
  serveFiles(on, { [T2]: status('T002', { lastAt: at(1) }) }, touched);
  servePanes(on);
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '{}', stderr: '', interrupted: false } }) as never);
  const clock = start(on);
  await $.session.start(SESSION);
  await $.tool.call({ tool: 'Bash', command: 'node "/x/dist/forge.cjs" prep --task T002-1 --path medium', tool_use_id: 'b1' } as never);
  await clock.advance(31_000);
  expect(touched.some(p => p.includes('/.forge')), 'while the call is heard').toBe(true);
  // Past the 10 minutes of the forge.cjs call, a task that moved 12 minutes ago still keeps it reading.
  await clock.advance(11 * 60_000);
  touched.length = 0;
  await clock.advance(60_000);
  expect(touched.some(p => p.includes('/.forge')), 'a task that moved 13 minutes ago').toBe(true);
  // Once its status has not moved for 30 minutes the reads stop, though the task still shows in progress.
  await clock.advance(20 * 60_000);
  touched.length = 0;
  await clock.advance(90_000);
  expect(touched.filter(p => p.includes('/.forge'))).toEqual([]);
});

test('each surface keeps its own view: a fullscreen desktop beside a terminal on the main screen does not flip the status line (final review m-5)', async ($, on) => {
  serveFiles(on, { [T2]: status('T002', { phase: 'review', round: 2 }) });
  servePanes(on);
  engineRows(on);
  const lines: (string | undefined)[] = [];
  on('ui.status', (_$, e) => { lines.push(e.text); return { value: undefined }; });
  start(on);
  await $.session.start(SESSION);
  await $.command.run(RUN);
  const draw = async (surface: 'terminal' | 'desktop', isFullscreen: boolean) => {
    const band = await $.ui.mount({ plugin: 'lens', surface, component: 'AbovePrompt', props: BAND_PROPS, viewport: { columns: 105, rows: 30, isFullscreen } });
    await band.unmount();
  };
  for (let i = 0; i < 3; i++) {
    await draw('terminal', false);
    await draw('desktop', true);
  }
  expect(lines).toEqual(['lens · T002 review r2']);
  // The reverse: a terminal in fullscreen beside a surface that says it is not: the terminal's view decides, once.
  await draw('terminal', true);
  for (let i = 0; i < 3; i++) {
    await draw('desktop', false);
    await draw('terminal', true);
  }
  expect(lines).toEqual(['lens · T002 review r2', undefined]);
});

test('/clear takes the status line away (fix 4)', async ($, on) => {
  serveFiles(on, { [T2]: status('T002', { phase: 'review', round: 2 }) });
  servePanes(on);
  engineRows(on);
  const lines: (string | undefined)[] = [];
  on('ui.status', (_$, e) => { lines.push(e.text); return { value: undefined }; });
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }));
  start(on);
  await $.session.start(SESSION);
  const band = await $.ui.mount(BAND_AT({ columns: 105, rows: 30, isFullscreen: false }));
  await band.unmount();
  await $.command.run(RUN);
  expect(lines.at(-1)).toBe('lens · T002 review r2');
  await $.session.end({ reason: 'clear', sessionId: SESSION_ID, resume: {} as never });
  expect(lines.at(-1)).toBeUndefined();
});

test('a notification the terminal cannot send falls back to a toast (fix 4)', async ($, on) => {
  const PLAN = 'project: shop\nlocale: es\nversion: "0.1"\nversions:\n  - id: "0.1"\n    phases: [F1]\ntracks:\n  - { id: backend, name: Backend, color: blue }\nphases:\n  - { id: F1, name: Base, plan_status: committed }\ntasks:\n  - id: T001\n    title: Esquema\n    track: backend\n    phase: F1\n    done_when: x\n    zones: ["src/**"]\n';
  const exec = (over: object) => JSON.stringify({
    runId: 'r1', kind: 'plan', mode: 'subagents', parallel: 3, project: 'shop', base: 'main', branch: 'forge/run-shop', mergeOnFinish: false, coordinator: 'main',
    hookSession: SESSION_ID, active: true, stopReason: null, stallReason: null, startedAt: at(30), lastStepAt: at(1), lastBlockStep: null, sleepUntil: null,
    tasks: { T001: { status: 'running', stage: 'implement', round: 1, worktree: '/w', branch: 'task/T001', executor: 'subagents', attempts: 0, agent: null, startedAt: at(25), updatedAt: at(1), stageSince: at(1), detail: null } },
    ...over,
  });
  const files: Record<string, string> = { [`${ROOT}/docs/waypoint/shop/plan.yaml`]: PLAN, [`${ROOT}/.forge/execution.json`]: exec({}) };
  serveFiles(on, files);
  servePanes(on);
  const toasts: string[] = [];
  on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined }; });
  on('ui.notify', () => ({ value: { isSent: false as const } }) as never);
  const clock = start(on);
  await $.session.start(SESSION);
  await $.command.run(RUN);
  files[`${ROOT}/.forge/execution.json`] = exec({ active: false, stopReason: 'stalled', stallReason: 'sin señal 12 min', lastStepAt: at(2) });
  await clock.advance(10_000);
  expect(toasts).toEqual(['Ejecución parada: sin señal 12 min']);
});
