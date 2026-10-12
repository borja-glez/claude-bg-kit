import { expect, mock, test } from 'claude-code/testing';
import type { On, RenderElement } from 'claude-code';
import type { WaypointBand } from '../types';

const SURFACES = ['terminal', 'desktop'] as const;
const PROPS = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 9 }, view: {} };

// The test's $ carries no state noun: the band model is answered beneath the plugin on state.get,
// while every other value (hidden) falls through to the kit's own state.
function serveBand(on: On, band: () => WaypointBand) {
  on('state.get', (_$, e, next) =>
    e.plugin === 'waypoint' && e.key === 'band' ? { value: { value: band(), version: 1 } } : next(e));
}

// Buttons run slash commands through $.command.run; record each as the line the person would type.
function recordCommands(on: On, sent: string[]) {
  on('command.run', (_$, e) => { sent.push(`/${e.command} ${e.args}`.trimEnd()); return { text: '' }; });
}

// What the engine draws of its own beneath the plugin, so a pass (next) is visible.
function engineBand(on: On) {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return h(Text, {}, 'engine band') as RenderElement;
  });
}

const DESIGN: WaypointBand = {
  mode: 'design', project: 'demo', locale: 'en', version: 3, round: 2, proposals: 2, critical: 1,
  designUrl: 'https://claude.ai/artifact/design',
};
const WORK: WaypointBand = {
  mode: 'work', project: 'demo', locale: 'es', sid: 'S1', track: 'core', roadmapUrl: 'https://claude.ai/artifact/roadmap',
  current: { id: 'T3', title: 'A very long task title that goes well beyond forty characters', startedAt: '2026-10-11T10:00:00.000Z', estimateMin: 30 },
  trackDone: 2, trackTotal: 5, percent: 40, inbox: 1, escalation: true, phase: { index: 1, total: 2, name: 'Base' }, cells: 'ddapp', swarm: false,
};
const SWARM: WaypointBand = {
  mode: 'swarm', project: 'demo', locale: 'es', live: 4, parallel: 5, integrated: 2, tracks: 11, percent: 52, conflicts: 1, stalled: false,
  roadmapUrl: 'https://claude.ai/artifact/roadmap',
};

test('the Spanish design band says one proposal and one critical in the singular', async ($, on) => {
  serveBand(on, () => ({ ...DESIGN, locale: 'es', proposals: 1, critical: 1 }) as WaypointBand);
  const ui = await $.ui.mount({ plugin: 'waypoint', surface: 'terminal', component: 'AbovePrompt', props: PROPS });
  expect(await ui.find({ type: 'Text', text: '◆ DISEÑO · demo · v3 · 1 propuesta · 1 crítica' })).toBeDefined();
  await ui.unmount();
});

test('design band shows counts and submits commands', async ($, on) => {
  const sent: string[] = [];
  const filled: string[] = [];
  recordCommands(on, sent);
  on('prompt.fill', (_$, e) => { filled.push(e.text); return { isFilled: true }; });
  serveBand(on, () => DESIGN);
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'waypoint', surface, component: 'AbovePrompt', props: PROPS });
    expect(await ui.find({ type: 'Text', text: '◆ DESIGN · demo · v3 · 2 proposals · 1 critical' })).toBeDefined();
    for (const key of ['apply-all', 'pick', 'round', 'rewrite', 'interview', 'approve']) {
      expect(await ui.find({ key })).toBeDefined();
    }
    expect(await ui.find({ type: 'Link', text: 'View design' })).toBeDefined();
    await ui.press({ key: 'apply-all' });
    expect(sent.at(-1)).toBe('/waypoint:design apply all');
    await ui.press({ key: 'pick' });
    expect(filled.at(-1)).toBe('/waypoint:design apply ');
    await ui.unmount();
  }
});

test('no band model leaves the band to the engine', async ($, on) => {
  engineBand(on);
  serveBand(on, () => ({ mode: 'none' }));
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'waypoint', surface, component: 'AbovePrompt', props: PROPS });
    expect(await ui.find({ text: 'engine band' })).toBeDefined();
    expect(await ui.find({ type: 'Button' })).toBeUndefined();
    await ui.unmount();
  }
});

test('work band runs /waypoint:work, the cross hides it and a new session shows it', async ($, on) => {
  const sent: string[] = [];
  const filled: string[] = [];
  recordCommands(on, sent);
  on('prompt.fill', (_$, e) => { filled.push(e.text); return { isFilled: true }; });
  serveBand(on, () => WORK);
  engineBand(on);
  mock.clock(on, { now: Date.parse('2026-10-11T10:12:30.000Z') });
  on('session.start', (_$, e) => ({ cwd: e.cwd }));
  for (const surface of SURFACES) {
    // A new session shows the band again after a dismiss (no project files here: the model is the served one).
    await $.session.start({ cwd: '.', surface, isInteractive: true });
    const ui = await $.ui.mount({ plugin: 'waypoint', surface, component: 'AbovePrompt', props: PROPS });
    const line = await ui.find({ type: 'Text', text: /^● frente core 2\/5 · T3 / });
    expect(line?.text).toBe('● frente core 2/5 · T3 A very long task title that goes well b… · 12 min/30 · global 40 % · ✉ 1 · ⚠ decisión pendiente');
    expect(await ui.find({ type: 'Link', text: 'Abrir roadmap' })).toBeDefined();
    await ui.press({ key: 'next-task' });
    expect(sent.at(-1)).toBe('/waypoint:work');
    await ui.press({ key: 'status' });
    expect(sent.at(-1)).toBe('/waypoint:status');
    await ui.press({ key: 'launch' });
    expect(filled.at(-1)).toBe('/waypoint:launch ');
    await ui.press({ key: 'dismiss' });
    expect(await ui.find({ key: 'next-task' })).toBeUndefined();
    expect(await ui.find({ text: 'engine band' })).toBeDefined();
    await ui.unmount();
  }
});

test('the swarm band shows the swarm, stops it and offers no per-session work buttons', async ($, on) => {
  const sent: string[] = [];
  recordCommands(on, sent);
  serveBand(on, () => SWARM);
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'waypoint', surface, component: 'AbovePrompt', props: PROPS });
    expect(await ui.find({ type: 'Text', text: '◆ enjambre 4/5 · integrados 2/11 · global 52 % · ⚠ 1 conflicto' })).toBeDefined();
    expect(await ui.find({ type: 'Button', text: 'Estado' })).toBeDefined();
    expect(await ui.find({ type: 'Button', text: 'Parar enjambre' })).toBeDefined();
    await ui.press({ key: 'stop-swarm' });
    expect(sent.at(-1)).toBe('/forge:stop');
    expect(await ui.find({ type: 'Button', text: 'Siguiente tarea' })).toBeUndefined();
    expect(await ui.find({ type: 'Button', text: 'Lanzar sesión en un frente…' })).toBeUndefined();
    await ui.unmount();
  }
});

test('a swarm member work band is marked', async ($, on) => {
  serveBand(on, () => ({ ...WORK, swarm: true }));
  mock.clock(on, { now: Date.parse('2026-10-11T10:12:30.000Z') });
  const ui = await $.ui.mount({ plugin: 'waypoint', surface: 'terminal', component: 'AbovePrompt', props: PROPS });
  expect((await ui.find({ type: 'Text', text: /^● frente core 2\/5 · enjambre · T3 / }))?.text).toContain('· enjambre · T3 ');
  await ui.unmount();
});

test('a session without a track counts the plan tasks instead of naming a track', async ($, on) => {
  serveBand(on, () => ({ ...WORK, track: null, sid: 'main', current: null }));
  const ui = await $.ui.mount({ plugin: 'waypoint', surface: 'terminal', component: 'AbovePrompt', props: PROPS });
  const line = await ui.find({ type: 'Text', text: /^● main · / });
  expect(line?.text).toContain('· tareas 2/5 · ');
  expect(line?.text).not.toContain('frente');
  await ui.unmount();
});

test('a command that cannot run is left in the prompt with a toast', async ($, on) => {
  const filled: string[] = [];
  const toasts: string[] = [];
  on('command.run', () => { throw new Error('unknown command'); });
  on('prompt.fill', (_$, e) => { filled.push(e.text); return { isFilled: true }; });
  on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined }; });
  serveBand(on, () => DESIGN);
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'waypoint', surface, component: 'AbovePrompt', props: PROPS });
    await ui.press({ key: 'approve' });
    expect(filled.at(-1)).toBe('/waypoint:design approve');
    expect(toasts.at(-1)).toBe('Command ready in the prompt: press Enter');
    await ui.unmount();
  }
});

test('a link that is not http(s) is shown as text', async ($, on) => {
  serveBand(on, () => ({ ...DESIGN, designUrl: 'javascript:alert(1)' }));
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'waypoint', surface, component: 'AbovePrompt', props: PROPS });
    expect(await ui.find({ type: 'Link' })).toBeUndefined();
    expect(await ui.find({ type: 'Text', text: 'javascript:alert(1)' })).toBeDefined();
    await ui.unmount();
  }
});

// A small project on a file system answered from memory: one plan, a session and two task states.
const ROOT = '/repo';
const PLAN = `project: demo
locale: es
version: "0.1"
versions:
  - id: "0.1"
    phases: [F1]
tracks:
  - { id: backend, name: Backend, color: blue }
  - { id: ui, name: Interfaz, color: mauve }
phases:
  - { id: F1, name: Base, plan_status: committed }
tasks:
  - id: T001
    title: Esquema de pedidos
    track: backend
    phase: F1
    done_when: migración aplicada
    zones: ["src/db/**"]
  - id: T002
    title: API de pedidos
    track: backend
    phase: F1
    done_when: tests de la API en verde
    depends_on: [T001]
    zones: ["src/api/**"]
    estimate_min: 30
  - id: T003
    title: Maqueta de carrito
    track: ui
    phase: F1
    done_when: componente renderiza
    zones: ["web/**"]
`;
const FILES: Record<string, string> = {
  [`${ROOT}/docs/waypoint/demo/plan.yaml`]: PLAN,
  [`${ROOT}/.waypoint/demo/session.json`]: JSON.stringify({ sessionId: 'S1', track: 'backend' }),
  [`${ROOT}/.waypoint/demo/dbcache/state/T001.json`]: JSON.stringify({ status: 'done', owner: 'S1' }),
  [`${ROOT}/.waypoint/demo/dbcache/state/T002.json`]: JSON.stringify({ status: 'in_progress', owner: 'S1', startedAt: '2026-10-11T10:00:00.000Z' }),
};

// The host hands the hooks absolute paths in the platform's own form (E:\repo\... on Windows); compare them as /repo/...
const norm = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '');

function serveFiles(on: On, files: Record<string, string> = FILES, listed: string[] = []) {
  const entry = (name: string, kind: 'file' | 'dir') => ({ name, kind, size: 0, mtimeMs: 1, isLink: false });
  on('session.root', () => ({ value: ROOT }));
  on('fs.read', (_$, e) => {
    const text = files[norm(e.path)];
    return text !== undefined ? { value: text } : { deny: `ENOENT ${e.path}` };
  });
  on('fs.exists', (_$, e) => ({ value: norm(e.path) in files }));
  on('fs.stat', (_$, e) => (norm(e.path) in files
    ? { value: { kind: 'file' as const, size: 0, mtimeMs: 1, isLink: false } }
    : { deny: `ENOENT ${e.path}` }));
  on('fs.list', (_$, e) => {
    listed.push(norm(e.path));
    const prefix = `${norm(e.path)}/`;
    const names = new Map<string, 'file' | 'dir'>();
    for (const path of Object.keys(files)) {
      if (!path.startsWith(prefix)) continue;
      const [head = '', ...rest] = path.slice(prefix.length).split('/');
      names.set(head, rest.length ? 'dir' : 'file');
    }
    return names.size ? { value: [...names].map(([name, kind]) => entry(name, kind)) } : { deny: `ENOENT ${e.path}` };
  });
}

test('session start reads the project files and shows the work band', async ($, on) => {
  serveFiles(on);
  mock.clock(on, { now: Date.parse('2026-10-11T10:05:00.000Z') });
  on('session.start', (_$, e) => ({ cwd: e.cwd }));
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'waypoint', surface, component: 'AbovePrompt', props: PROPS });
    const line = await ui.find({ type: 'Text', text: /^● / });
    expect(line?.text).toBe('● frente backend 1/2 · T002 API de pedidos · 5 min/30 · global 33 %');
    expect(await ui.find({ key: 'next-task' })).toBeDefined();
    await ui.unmount();
  }
});

test('the periodic refresh redraws a running task with its new minutes', async ($, on) => {
  serveFiles(on);
  const clock = mock.clock(on, { now: Date.parse('2026-10-11T10:05:00.000Z') });
  on('session.start', (_$, e) => ({ cwd: e.cwd }));
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'waypoint', surface, component: 'AbovePrompt', props: PROPS });
    const before = clock.now();
    await clock.advance(60000);
    const minutes = Math.floor((before + 60000 - Date.parse('2026-10-11T10:00:00.000Z')) / 60000);
    expect((await ui.find({ type: 'Text', text: /^● / }))?.text).toContain(`· ${minutes} min/30 ·`);
    await ui.unmount();
  }
});

test('a root without docs/waypoint leaves the band to the engine', async ($, on) => {
  serveFiles(on, {});
  engineBand(on);
  mock.clock(on, { now: Date.parse('2026-10-11T10:05:00.000Z') });
  on('session.start', (_$, e) => ({ cwd: e.cwd }));
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'waypoint', surface, component: 'AbovePrompt', props: PROPS });
    expect(await ui.find({ text: 'engine band' })).toBeDefined();
    expect(await ui.find({ type: 'Button' })).toBeUndefined();
    await ui.unmount();
  }
});

test('a folder without plan.yaml or design.md is not a project, even with a session', async ($, on) => {
  const design = '---\ntitle: Demo\nproject: demo\nlocale: en\nsummary: A demo.\nstart_prompt: /waypoint:work\n---\n\nIntro.\n\n## Scope\n\nText.\n';
  serveFiles(on, {
    [`${ROOT}/docs/waypoint/demo/design.md`]: design,
    [`${ROOT}/docs/waypoint/notes/README.md`]: '# notes',
    [`${ROOT}/.waypoint/notes/session.json`]: JSON.stringify({ sessionId: 'S9' }),
  });
  mock.clock(on, { now: Date.parse('2026-10-11T10:05:00.000Z') });
  on('session.start', (_$, e) => ({ cwd: e.cwd }));
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  const ui = await $.ui.mount({ plugin: 'waypoint', surface: 'terminal', component: 'AbovePrompt', props: PROPS });
  expect((await ui.find({ type: 'Text', text: /^◆ / }))?.text).toBe('◆ DESIGN · demo · v0 · no critique yet');
  await ui.unmount();
});

test('a second session start keeps one refresh timer, and session end stops it', async ($, on) => {
  const listed: string[] = [];
  serveFiles(on, FILES, listed);
  const clock = mock.clock(on, { now: Date.parse('2026-10-11T10:05:00.000Z') });
  on('session.start', (_$, e) => ({ cwd: e.cwd }));
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }));
  const docsListed = () => listed.filter(p => p === `${ROOT}/docs/waypoint`).length;
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  let before = docsListed();
  await clock.advance(30000);
  expect(docsListed() - before).toBe(1);
  await $.session.end({ reason: 'other', sessionId: 'S', resume: {} as never });
  before = docsListed();
  await clock.advance(60000);
  expect(docsListed() - before).toBe(0);
});

const LENS = { name: 'lens', description: 'Show the lens progress panel', source: 'plugin' as const, plugin: 'lens' };

test('the Panel button shows only when /lens exists, and runs it', async ($, on) => {
  serveFiles(on);
  mock.clock(on, { now: Date.parse('2026-10-11T10:05:00.000Z') });
  on('session.start', (_$, e) => ({ cwd: e.cwd }));
  let commands = [LENS];
  on('command.list', () => ({ value: commands }));
  const ran: string[] = [];
  on('command.run', (_$, e) => { ran.push(e.command); return { text: '' }; });
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  const ui = await $.ui.mount({ plugin: 'waypoint', surface: 'terminal', component: 'AbovePrompt', props: PROPS });
  await ui.press({ key: 'panel' });
  expect(ran).toContain('lens');
  await ui.unmount();

  commands = [];
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  const again = await $.ui.mount({ plugin: 'waypoint', surface: 'terminal', component: 'AbovePrompt', props: PROPS });
  expect(await again.find({ key: 'next-task' })).toBeDefined();
  expect(await again.find({ key: 'panel' })).toBeUndefined();
  await again.unmount();
});

test('with no waypoint project and open todos, waypoint draws nothing', async ($, on) => {
  serveFiles(on, {});
  engineBand(on);
  mock.clock(on, { now: Date.parse('2026-10-11T10:05:00.000Z') });
  on('session.start', (_$, e) => ({ cwd: e.cwd }));
  on('command.list', () => ({ value: [LENS] }));
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [] } }));
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'a', status: 'in_progress', activeForm: 'a' }] });
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'waypoint', surface, component: 'AbovePrompt', props: PROPS });
    expect(await ui.find({ key: 'panel' })).toBeUndefined();
    expect(await ui.find({ text: 'engine band' })).toBeDefined();
    await ui.unmount();
  }
});

test('a /lens registered after the session start shows the Panel button a second later', async ($, on) => {
  serveFiles(on);
  const clock = mock.clock(on, { now: Date.parse('2026-10-11T10:05:00.000Z') });
  on('session.start', (_$, e) => ({ cwd: e.cwd }));
  let commands: typeof LENS[] = [];
  on('command.list', () => ({ value: commands }));
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  const ui = await $.ui.mount({ plugin: 'waypoint', surface: 'terminal', component: 'AbovePrompt', props: PROPS });
  expect(await ui.find({ key: 'next-task' })).toBeDefined();
  expect(await ui.find({ key: 'panel' })).toBeUndefined();
  commands = [LENS];
  await clock.advance(1000);
  expect(await ui.find({ key: 'panel' })).toBeDefined();
  await ui.unmount();
});

test('a /lens of another plugin is not taken for lens', async ($, on) => {
  serveFiles(on);
  mock.clock(on, { now: Date.parse('2026-10-11T10:05:00.000Z') });
  on('session.start', (_$, e) => ({ cwd: e.cwd }));
  on('command.list', () => ({ value: [{ ...LENS, plugin: 'other' }] }));
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  const ui = await $.ui.mount({ plugin: 'waypoint', surface: 'terminal', component: 'AbovePrompt', props: PROPS });
  expect(await ui.find({ key: 'next-task' })).toBeDefined();
  expect(await ui.find({ key: 'panel' })).toBeUndefined();
  await ui.unmount();
});

test('a turn end looks for /lens again', async ($, on) => {
  serveFiles(on);
  mock.clock(on, { now: Date.parse('2026-10-11T10:05:00.000Z') });
  on('session.start', (_$, e) => ({ cwd: e.cwd }));
  on('turn.complete', () => ({ text: '' }));
  let commands: typeof LENS[] = [];
  on('command.list', () => ({ value: commands }));
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  const ui = await $.ui.mount({ plugin: 'waypoint', surface: 'terminal', component: 'AbovePrompt', props: PROPS });
  expect(await ui.find({ key: 'panel' })).toBeUndefined();
  commands = [LENS];
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, reason: 'answer', turnId: 't1' });
  await ui.redraw();
  expect(await ui.find({ key: 'panel' })).toBeDefined();
  await ui.unmount();
});
