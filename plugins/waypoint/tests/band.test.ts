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

// The plugin's own store, answered from memory so a test sees what the band keeps; with `fail`, every write is refused.
function memoryStore(on: On, start: Record<string, unknown> = {}, fail = false): Record<string, unknown> {
  const data: Record<string, unknown> = { ...start };
  on('store.get', (_$, e) => ({ value: data[e.key] }));
  on('store.set', (_$, e) => { if (fail) throw new Error('store refused'); data[e.key] = e.value; return { value: undefined }; });
  return data;
}

// What the engine draws of its own beneath the plugin, so a pass (next) is visible.
function engineBand(on: On) {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return h(Text, {}, 'engine band') as RenderElement;
  });
}

// What the real engine answers at the bottom of the chain when nothing draws beneath the plugin.
function engineBottom(on: On) {
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as RenderElement);
}

// Another plugin's band beneath this one, which the band must stack instead of hiding.
function otherBand(on: On) {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return h(Text, {}, 'other band') as RenderElement;
  });
}

// The role of the conversation looking at each band (C3): a seat's owner, the run's coordinator, nobody.
const OWNER: WaypointBand['viewer'] = { role: 'owner', coordinator: false, runId: null };
const COORDINATOR: WaypointBand['viewer'] = { role: 'owner', coordinator: true, runId: 'r1' };
const NOBODY: WaypointBand['viewer'] = { role: 'none', coordinator: false, runId: null };
const DESIGN: WaypointBand = {
  mode: 'design', project: 'demo', locale: 'en', version: 3, round: 2, proposals: 2, critical: 1, pending: 2, pendingCritical: 1,
  designUrl: 'https://claude.ai/artifact/design', viewer: OWNER,
};
const WORK: WaypointBand = {
  mode: 'work', project: 'demo', locale: 'es', sid: 'S1', track: 'core', roadmapUrl: 'https://claude.ai/artifact/roadmap',
  current: { id: 'T3', title: 'A very long task title that goes well beyond forty characters', startedAt: '2026-10-11T10:00:00.000Z', estimateMin: 30 },
  trackDone: 2, trackTotal: 5, percent: 40, inbox: 1, escalation: true, phase: { index: 1, total: 2, name: 'Base' }, cells: 'ddapp', swarm: false, run: null, viewer: OWNER,
};
const RUN: WaypointBand = {
  mode: 'run', project: 'demo', locale: 'es', executor: 'subagents', running: 2, parallel: 3, integrated: 3, total: 12,
  slots: [{ task: 'T004', stage: 'review', round: 2 }, { task: 'T008', stage: 'implement', round: 1 }], worst: 'silent', stalled: false,
  roadmapUrl: 'https://claude.ai/artifact/roadmap', viewer: COORDINATOR,
};
type Notice = Extract<WaypointBand, { mode: 'notice' }>;
const PREVIOUS: WaypointBand['viewer'] = { role: 'previous', coordinator: false, runId: null };
// Another live conversation works T002 on the seat main (C3, spec §4.5); notice(over) varies it.
const NOTICE: Notice = {
  mode: 'notice', project: 'demo', locale: 'es', kind: 'other-live', subject: 'task', seat: 'main', task: 'T002', title: 'API de pedidos',
  since: '2026-10-11T10:00:00.000Z', runId: null, roadmapUrl: 'https://claude.ai/artifact/roadmap', key: 'task:T002',
  viewer: { role: 'other-live', coordinator: false, runId: null },
};
const notice = (over: Partial<Notice> = {}): WaypointBand => ({ ...NOTICE, ...over });
/** The key under which × keeps a notice of project demo in the checkout /repo (K5-08, M7: a JSON list). */
const dismissedKey = (kind: Notice['kind'], key: string) => JSON.stringify(['/repo', 'demo', kind, key]);

test('the Spanish design band says one pending proposal and one critical in the singular', async ($, on) => {
  engineBottom(on);
  serveBand(on, () => ({ ...DESIGN, locale: 'es', pending: 1, pendingCritical: 1 }) as WaypointBand);
  const ui = await $.ui.mount({ plugin: 'waypoint', surface: 'terminal', component: 'AbovePrompt', props: PROPS });
  expect(await ui.find({ type: 'Text', text: '◆ DISEÑO · demo · v3 · 1 pendiente · 1 crítica' })).toBeDefined();
  await ui.unmount();
});

test('the design band counts the proposals still pending from every round, not the latest critique', async ($, on) => {
  engineBottom(on);
  serveBand(on, () => ({ ...DESIGN, proposals: 4, critical: 0, pending: 0, pendingCritical: 0 }) as WaypointBand);
  const ui = await $.ui.mount({ plugin: 'waypoint', surface: 'terminal', component: 'AbovePrompt', props: PROPS });
  expect(await ui.find({ type: 'Text', text: '◆ DESIGN · demo · v3 · nothing pending' })).toBeDefined();
  await ui.unmount();
});

test('design band shows counts and submits commands', async ($, on) => {
  engineBottom(on);
  const sent: string[] = [];
  const filled: string[] = [];
  recordCommands(on, sent);
  on('prompt.fill', (_$, e) => { filled.push(e.text); return { isFilled: true }; });
  serveBand(on, () => DESIGN);
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'waypoint', surface, component: 'AbovePrompt', props: PROPS });
    expect(await ui.find({ type: 'Text', text: '◆ DESIGN · demo · v3 · 2 pending · 1 critical' })).toBeDefined();
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
  serveBand(on, () => ({ mode: 'none', viewer: NOBODY }));
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

test('the run band shows the execution, stops it and offers no per-session work buttons', async ($, on) => {
  engineBottom(on);
  const sent: string[] = [];
  recordCommands(on, sent);
  serveBand(on, () => RUN);
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'waypoint', surface, component: 'AbovePrompt', props: PROPS });
    expect(await ui.find({ type: 'Text', text: '▶ EJECUCIÓN · subagentes 2/3 · T004 revisar (r2) · T008 implementar · 3/12 · integradas 3 · ⚠ sin señal' })).toBeDefined();
    expect(await ui.find({ type: 'Button', text: 'Estado' })).toBeDefined();
    expect(await ui.find({ type: 'Button', text: 'Parar' })).toBeDefined();
    await ui.press({ key: 'stop-run' });
    expect(sent.at(-1)).toBe('/forge:stop');
    expect(await ui.find({ type: 'Button', text: 'Siguiente tarea' })).toBeUndefined();
    expect(await ui.find({ type: 'Button', text: 'Lanzar sesión en un frente…' })).toBeUndefined();
    await ui.unmount();
  }
});

for (const [mode, model, line, button] of [['work', WORK, /^● /, 'next-task'], ['run', RUN, /^▶ /, 'stop-run']] as const) {
  test(`the ${mode} band stacks over another plugin's band beneath, which stays after the cross`, async ($, on) => {
    serveBand(on, () => model);
    otherBand(on);
    mock.clock(on, { now: Date.parse('2026-10-11T10:12:30.000Z') });
    on('session.start', (_$, e) => ({ cwd: e.cwd }));
    for (const surface of SURFACES) {
      await $.session.start({ cwd: '.', surface, isInteractive: true });
      const ui = await $.ui.mount({ plugin: 'waypoint', surface, component: 'AbovePrompt', props: PROPS });
      expect(await ui.find({ key: button })).toBeDefined();
      expect(await ui.find({ key: 'dismiss' })).toBeDefined();
      const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text);
      const ours = texts.findIndex(t => line.test(t));
      expect(ours).toBeGreaterThanOrEqual(0);
      expect(texts.indexOf('other band')).toBeGreaterThan(ours);
      await ui.press({ key: 'dismiss' });
      expect(await ui.find({ key: button })).toBeUndefined();
      expect(await ui.find({ type: 'Button' })).toBeUndefined();
      expect(await ui.find({ text: 'other band' })).toBeDefined();
      await ui.unmount();
    }
  });
}

test('a swarm member work band is marked', async ($, on) => {
  engineBottom(on);
  serveBand(on, () => ({ ...WORK, swarm: true }));
  mock.clock(on, { now: Date.parse('2026-10-11T10:12:30.000Z') });
  const ui = await $.ui.mount({ plugin: 'waypoint', surface: 'terminal', component: 'AbovePrompt', props: PROPS });
  expect((await ui.find({ type: 'Text', text: /^● frente core 2\/5 · ejecución · T3 / }))?.text).toContain('· ejecución · T3 ');
  await ui.unmount();
});

test('a session without a track counts the plan tasks instead of naming a track', async ($, on) => {
  engineBottom(on);
  serveBand(on, () => ({ ...WORK, track: null, sid: 'main', current: null }));
  const ui = await $.ui.mount({ plugin: 'waypoint', surface: 'terminal', component: 'AbovePrompt', props: PROPS });
  const line = await ui.find({ type: 'Text', text: /^● main · / });
  expect(line?.text).toContain('· tareas 2/5 · ');
  expect(line?.text).not.toContain('frente');
  await ui.unmount();
});

test('a command that cannot run is left in the prompt with a toast', async ($, on) => {
  engineBottom(on);
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

test('a command left in the prompt gets the press-Enter toast only when the prompt took it', async ($, on) => {
  engineBottom(on);
  const filled: string[] = [];
  const toasts: string[] = [];
  let takes = true;
  on('command.run', () => { throw new Error('unknown command'); });
  on('prompt.fill', (_$, e) => { filled.push(e.text); return { isFilled: takes }; });
  on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined }; });
  serveBand(on, () => DESIGN);
  const ui = await $.ui.mount({ plugin: 'waypoint', surface: 'terminal', component: 'AbovePrompt', props: PROPS });
  takes = false;
  await ui.press({ key: 'approve' });
  expect(filled.at(-1)).toBe('/waypoint:design approve');
  expect(toasts).toEqual([]);
  takes = true;
  await ui.press({ key: 'approve' });
  expect(toasts.at(-1)).toBe('Command ready in the prompt: press Enter');
  await ui.unmount();
});

test('a link that is not http(s) is shown as text', async ($, on) => {
  engineBottom(on);
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
const SESSION_ID = 'conv-1';
// The checkout seat S1 bound to the conversation looking at the band, renewed a minute before the tests' clock (10:05),
// as waypoint bind and the band's tick leave it (C3).
const BOUND = (over: Record<string, unknown> = {}) => JSON.stringify({
  sid: 'S1', claude: SESSION_ID, pid: null, via: 'work', since: '2026-10-11T09:00:00.000Z', seenAt: '2026-10-11T10:04:00.000Z',
  endedAt: null, endReason: null, ...over,
});
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
  [`${ROOT}/.waypoint/demo/bound.json`]: BOUND(),
  [`${ROOT}/.waypoint/demo/dbcache/state/T001.json`]: JSON.stringify({ status: 'done', owner: 'S1' }),
  [`${ROOT}/.waypoint/demo/dbcache/state/T002.json`]: JSON.stringify({ status: 'in_progress', owner: 'S1', startedAt: '2026-10-11T10:00:00.000Z' }),
};

// The host hands the hooks absolute paths in the platform's own form (E:\repo\... on Windows); compare them as /repo/...
const norm = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '');

// The conversation looking at the band is `id()` ($.session.id(), which may answer later); what the plugin writes lands
// in `files`, and its path in `written`. $.session.root() answers `root()`, and refuses while it is null.
function serveFiles(on: On, files: Record<string, string> = { ...FILES }, listed: string[] = [], id: () => string | Promise<string> = () => SESSION_ID, written: string[] = [], root: () => string | null = () => ROOT) {
  const entry = (name: string, kind: 'file' | 'dir') => ({ name, kind, size: 0, mtimeMs: 1, isLink: false });
  on('session.root', () => {
    const value = root();
    return value === null ? { deny: 'no root' } : { value };
  });
  on('session.id', async () => ({ value: await id() }));
  on('fs.write', (_$, e) => { written.push(norm(e.path)); files[norm(e.path)] = e.text; return { value: undefined }; });
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
  engineBottom(on);
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
  engineBottom(on);
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
  engineBottom(on);
  const design = '---\ntitle: Demo\nproject: demo\nlocale: en\nsummary: A demo.\nstart_prompt: /waypoint:work\n---\n\nIntro.\n\n## Scope\n\nText.\n';
  serveFiles(on, {
    [`${ROOT}/docs/waypoint/demo/design.md`]: design,
    [`${ROOT}/.waypoint/demo/bound.json`]: BOUND({ sid: 'main', via: 'design' }),
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
  serveFiles(on, { ...FILES }, listed);
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
  engineBottom(on);
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
  engineBottom(on);
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
  engineBottom(on);
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
  engineBottom(on);
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

test('a band with automatic decisions ends with their count and the last major one', async ($, on) => {
  engineBottom(on);
  serveBand(on, () => ({ ...DESIGN, auto: { count: 2, lastMajor: 'design approved (v3)' } }) as WaypointBand);
  const ui = await $.ui.mount({ plugin: 'waypoint', surface: 'terminal', component: 'AbovePrompt', props: PROPS });
  expect(await ui.find({ type: 'Text', text: '◆ DESIGN · demo · v3 · 2 pending · 1 critical · ⚑ auto · 2 · design approved (v3)' })).toBeDefined();
  await ui.unmount();
});

test('a notice of another session at work is drawn dim with Status, Other track and the roadmap, never Stop (B-02, B-08)', async ($, on) => {
  engineBottom(on);
  const sent: string[] = [];
  const filled: string[] = [];
  recordCommands(on, sent);
  on('prompt.fill', (_$, e) => { filled.push(e.text); return { isFilled: true }; });
  serveBand(on, () => notice());
  mock.clock(on, { now: Date.parse('2026-10-11T10:12:30.000Z') });
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'waypoint', surface, component: 'AbovePrompt', props: PROPS });
    const line = await ui.find({ type: 'Text', text: '◦ otra sesión (main) trabaja en T002 · hace 12 min' });
    expect(line?.props.dimColor).toBe(true);
    expect(await ui.find({ type: 'Button', text: 'Otro frente' })).toBeDefined();
    expect(await ui.find({ type: 'Link', text: 'Abrir roadmap' })).toBeDefined();
    await ui.press({ key: 'status' });
    expect(sent.at(-1)).toBe('/waypoint:status');
    await ui.press({ key: 'other-track' });
    expect(filled.at(-1)).toBe('/waypoint:launch ');
    for (const key of ['stop-run', 'next-task', 'resume', 'close']) expect(await ui.find({ key }), key).toBeUndefined();
    await ui.unmount();
  }
});

test('a notice of another session on the design offers Status and the roadmap, not Other track (M3)', async ($, on) => {
  engineBottom(on);
  const sent: string[] = [];
  recordCommands(on, sent);
  serveBand(on, () => notice({ subject: 'design', task: null, title: null, key: 'design:demo' }));
  mock.clock(on, { now: Date.parse('2026-10-11T10:12:30.000Z') });
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'waypoint', surface, component: 'AbovePrompt', props: PROPS });
    const line = await ui.find({ type: 'Text', text: '◦ otra sesión (main) trabaja en el diseño · hace 12 min' });
    expect(line?.props.dimColor).toBe(true);
    expect(await ui.find({ type: 'Link', text: 'Abrir roadmap' })).toBeDefined();
    await ui.press({ key: 'status' });
    expect(sent.at(-1)).toBe('/waypoint:status');
    for (const key of ['other-track', 'resume', 'join', 'stop-run']) expect(await ui.find({ key }), key).toBeUndefined();
    await ui.unmount();
  }
});

test('the notices of a run and of what an earlier conversation left send their commands (B-07, C2)', async ($, on) => {
  engineBottom(on);
  const sent: string[] = [];
  recordCommands(on, sent);
  let band = notice();
  serveBand(on, () => band);
  mock.clock(on, { now: Date.parse('2026-10-11T10:12:30.000Z') });
  const run = { subject: 'run', seat: null, task: null, title: null, runId: 'r1', integrated: 3, total: 12, key: 'run:r1' } as const;
  const cases: { model: WaypointBand; line: string; labels: string[]; presses: [string, string][]; absent?: string[] }[] = [
    { model: notice({ ...run, joinable: true }), line: '◦ ejecución de forge en curso, la coordina otra sesión · 3/12', labels: ['Ver', 'Unirme'],
      presses: [['view', '/waypoint:status'], ['join', '/forge:run --join']] },
    // I1: an ephemeral run takes no members (swarm join refuses it), so its notice offers no Join.
    { model: notice({ ...run, joinable: false }), line: '◦ ejecución de forge en curso, la coordina otra sesión · 3/12', labels: ['Ver'],
      presses: [['view', '/waypoint:status']], absent: ['join'] },
    { model: notice({ kind: 'previous', viewer: PREVIOUS }), line: '◌ quedó a medias: T002 API de pedidos (hace 12 min)', labels: ['Retomar', 'Liberar T002'],
      presses: [['resume', '/waypoint:work resume'], ['release', '/waypoint:work release T002']] },
    { model: notice({ kind: 'previous', subject: 'design', task: null, title: null, key: 'design:demo', viewer: PREVIOUS }), line: '◌ diseño a medias: demo (hace 12 min)', labels: ['Retomar'],
      presses: [['resume', '/waypoint:design resume']] },
    { model: notice({ ...run, kind: 'previous', stopReason: 'stalled', viewer: PREVIOUS }), line: '◌ ejecución parada: 3/12 integradas (hace 12 min)', labels: ['Ver', 'Retomar', 'Cerrar'],
      presses: [['view', '/waypoint:status'], ['resume', '/forge:run --resume'], ['close', '/forge:stop']] },
  ];
  for (const c of cases) {
    band = c.model;
    const ui = await $.ui.mount({ plugin: 'waypoint', surface: 'terminal', component: 'AbovePrompt', props: PROPS });
    expect(await ui.find({ type: 'Text', text: c.line }), c.line).toBeDefined();
    for (const label of c.labels) expect(await ui.find({ type: 'Button', text: label }), label).toBeDefined();
    for (const [key, command] of c.presses) {
      await ui.press({ key });
      expect(sent.at(-1), key).toBe(command);
    }
    for (const key of c.absent ?? []) expect(await ui.find({ key }), key).toBeUndefined();
    expect(await ui.find({ key: 'stop-run' })).toBeUndefined();
    await ui.unmount();
  }
});

test("Stop is the coordinator's: a member's leaves /forge:stop in the prompt with a toast, a seat's owner has none (B-08)", async ($, on) => {
  engineBottom(on);
  const sent: string[] = [];
  const filled: string[] = [];
  const toasts: string[] = [];
  recordCommands(on, sent);
  on('prompt.fill', (_$, e) => { filled.push(e.text); return { isFilled: true }; });
  on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined }; });
  let band: WaypointBand = RUN;
  serveBand(on, () => band);
  mock.clock(on, { now: Date.parse('2026-10-11T10:12:30.000Z') });
  const member = { ...WORK, run: { coordinator: 'main', stage: 'implement' }, viewer: { role: 'owner', coordinator: false, runId: 'r1' } } as WaypointBand;
  for (const surface of SURFACES) {
    band = RUN;
    let ui = await $.ui.mount({ plugin: 'waypoint', surface, component: 'AbovePrompt', props: PROPS });
    await ui.press({ key: 'stop-run' });
    expect(sent.at(-1)).toBe('/forge:stop');
    await ui.unmount();
    band = member;
    sent.length = 0;
    ui = await $.ui.mount({ plugin: 'waypoint', surface, component: 'AbovePrompt', props: PROPS });
    expect(await ui.find({ type: 'Button', text: 'Parar' })).toBeDefined();
    await ui.press({ key: 'stop-run' });
    expect(sent).toEqual([]);
    expect(filled.at(-1)).toBe('/forge:stop');
    expect(toasts.at(-1)).toContain('/forge:stop');
    await ui.unmount();
    band = WORK;
    ui = await $.ui.mount({ plugin: 'waypoint', surface, component: 'AbovePrompt', props: PROPS });
    expect(await ui.find({ key: 'stop-run' })).toBeUndefined();
    await ui.unmount();
  }
});

test('[Close] on a run still active without its coordinator only fills /forge:stop, with a toast once the prompt holds it (B-08)', async ($, on) => {
  engineBottom(on);
  const sent: string[] = [];
  const filled: string[] = [];
  const toasts: string[] = [];
  let takes = true;
  recordCommands(on, sent);
  on('prompt.fill', (_$, e) => { filled.push(e.text); return { isFilled: takes }; });
  on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined }; });
  serveBand(on, () => notice({ subject: 'run', seat: null, task: null, title: null, runId: 'r1', integrated: 3, total: 12, key: 'run:r1', kind: 'previous', stopReason: null, viewer: PREVIOUS }));
  mock.clock(on, { now: Date.parse('2026-10-11T10:12:30.000Z') });
  for (const surface of SURFACES) {
    takes = true;
    sent.length = 0;
    toasts.length = 0;
    const ui = await $.ui.mount({ plugin: 'waypoint', surface, component: 'AbovePrompt', props: PROPS });
    expect(await ui.find({ type: 'Text', text: '◌ ejecución sin coordinadora: 3/12 integradas (hace 12 min)' })).toBeDefined();
    for (const label of ['Ver', 'Retomar', 'Cerrar']) expect(await ui.find({ type: 'Button', text: label }), label).toBeDefined();
    await ui.press({ key: 'close' });
    expect(sent).toEqual([]);
    expect(filled.at(-1)).toBe('/forge:stop');
    expect(toasts.at(-1)).toContain('/forge:stop');
    // A prompt that does not take the text (a dialog, headless) gets no toast.
    takes = false;
    toasts.length = 0;
    await ui.press({ key: 'close' });
    expect(sent).toEqual([]);
    expect(toasts).toEqual([]);
    await ui.unmount();
  }
});

test('a /clear or a resume keeps the refresh timer, and the next conversation is drawn with its own role at once (K5-07)', async ($, on) => {
  engineBottom(on);
  const listed: string[] = [];
  const files = { ...FILES };
  let id = SESSION_ID;
  serveFiles(on, files, listed, () => id);
  const clock = mock.clock(on, { now: Date.parse('2026-10-11T10:05:00.000Z') });
  on('session.start', (_$, e) => ({ cwd: e.cwd }));
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }));
  on('classic.SessionStart', () => ({}));
  const docsListed = () => listed.filter(p => p === `${ROOT}/docs/waypoint`).length;
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  const ui = await $.ui.mount({ plugin: 'waypoint', surface: 'terminal', component: 'AbovePrompt', props: PROPS });
  expect(await ui.find({ key: 'next-task' })).toBeDefined();
  for (const reason of ['resume', 'clear'] as const) {
    await $.session.end({ reason, sessionId: id, resume: {} as never });
    const before = docsListed();
    await clock.advance(30000);
    expect(docsListed() - before, reason).toBe(1);
  }
  // SessionEnd closed the binding; the process goes on as the conversation conv-2, with no session.start.
  files[`${ROOT}/.waypoint/demo/bound.json`] = BOUND({ seenAt: '2026-10-11T10:05:30.000Z', endedAt: '2026-10-11T10:06:00.000Z', endReason: 'clear' });
  id = 'conv-2';
  await $.classic.SessionStart({ source: 'clear' });
  await ui.redraw();
  expect(await ui.find({ key: 'resume' })).toBeDefined();
  expect(await ui.find({ key: 'next-task' })).toBeUndefined();
  await ui.unmount();
});

test('a conversation that starts in a process whose timer an end stopped gets one timer back (K5-07)', async ($, on) => {
  const listed: string[] = [];
  serveFiles(on, { ...FILES }, listed);
  const clock = mock.clock(on, { now: Date.parse('2026-10-11T10:05:00.000Z') });
  on('session.start', (_$, e) => ({ cwd: e.cwd }));
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }));
  on('classic.SessionStart', () => ({}));
  const docsListed = () => listed.filter(p => p === `${ROOT}/docs/waypoint`).length;
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.session.end({ reason: 'logout', sessionId: SESSION_ID, resume: {} as never });
  let before = docsListed();
  await clock.advance(30000);
  expect(docsListed() - before).toBe(0);
  await $.classic.SessionStart({ source: 'startup' });
  await $.classic.SessionStart({ source: 'compact' });
  // Let the refreshes the starts launched finish, short of the timer's 30 s.
  await clock.advance(1);
  before = docsListed();
  await clock.advance(30000);
  expect(docsListed() - before).toBe(1);
});

test('a /clear while a refresh still runs with the old id gets one more refresh after it, with the new conversation (K5-07)', async ($, on) => {
  engineBottom(on);
  const files = { ...FILES };
  let id = SESSION_ID;
  // While `held`, $.session.id() answers the id of the moment it was asked, once released; `asked` says it was.
  let held: Promise<void> | null = null;
  let release = () => {};
  let asked = () => {};
  serveFiles(on, files, [], () => {
    const then = id;
    if (!held) return then;
    asked();
    return held.then(() => then);
  });
  const clock = mock.clock(on, { now: Date.parse('2026-10-11T10:05:00.000Z') });
  on('session.start', (_$, e) => ({ cwd: e.cwd }));
  on('turn.complete', () => ({ text: '' }));
  on('classic.SessionStart', () => ({}));
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  const ui = await $.ui.mount({ plugin: 'waypoint', surface: 'terminal', component: 'AbovePrompt', props: PROPS });
  expect(await ui.find({ key: 'next-task' })).toBeDefined();
  held = new Promise(r => { release = r; });
  const askedOnce = new Promise<void>(r => { asked = r; });
  // A turn's refresh asks the id, gets conv-1 and waits; meanwhile SessionEnd closes the binding and /clear starts conv-2.
  const turn = $.turn.complete({ answer: '', durationMs: 1, isAborted: false, reason: 'answer', turnId: 't1' });
  await askedOnce;
  held = null;
  files[`${ROOT}/.waypoint/demo/bound.json`] = BOUND({ endedAt: '2026-10-11T10:05:00.000Z', endReason: 'clear' });
  id = 'conv-2';
  await $.classic.SessionStart({ source: 'clear' });
  release();
  await turn;
  await clock.advance(1);
  await ui.redraw();
  expect(await ui.find({ key: 'resume' })).toBeDefined();
  expect(await ui.find({ key: 'next-task' })).toBeUndefined();
  await ui.unmount();
});

test('a band hidden with × before /clear does not hide what the next conversation is offered (Review Focus 4)', async ($, on) => {
  engineBottom(on);
  const files = { ...FILES };
  let id = SESSION_ID;
  serveFiles(on, files, [], () => id);
  mock.clock(on, { now: Date.parse('2026-10-11T10:05:00.000Z') });
  on('session.start', (_$, e) => ({ cwd: e.cwd }));
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }));
  on('classic.SessionStart', () => ({}));
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  const ui = await $.ui.mount({ plugin: 'waypoint', surface: 'terminal', component: 'AbovePrompt', props: PROPS });
  await ui.press({ key: 'dismiss' });
  expect(await ui.find({ key: 'next-task' })).toBeUndefined();
  await $.session.end({ reason: 'clear', sessionId: id, resume: {} as never });
  files[`${ROOT}/.waypoint/demo/bound.json`] = BOUND({ endedAt: '2026-10-11T10:05:00.000Z', endReason: 'clear' });
  id = 'conv-2';
  await $.classic.SessionStart({ source: 'clear' });
  await ui.redraw();
  expect(await ui.find({ key: 'resume' })).toBeDefined();
  await ui.unmount();
});

test('× on its own band does not hide that another session took the seat over: the next tick shows the notice (M2)', async ($, on) => {
  engineBottom(on);
  const files = { ...FILES };
  serveFiles(on, files);
  const clock = mock.clock(on, { now: Date.parse('2026-10-11T10:05:00.000Z') });
  on('session.start', (_$, e) => ({ cwd: e.cwd }));
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  const ui = await $.ui.mount({ plugin: 'waypoint', surface: 'terminal', component: 'AbovePrompt', props: PROPS });
  await ui.press({ key: 'dismiss' });
  expect(await ui.find({ key: 'next-task' })).toBeUndefined();
  // The same band on the next tick stays hidden.
  await clock.advance(30000);
  await ui.redraw();
  expect(await ui.find({ key: 'next-task' })).toBeUndefined();
  // Another conversation runs bind --takeover on the seat.
  files[`${ROOT}/.waypoint/demo/bound.json`] = BOUND({ claude: 'conv-9', since: '2026-10-11T10:05:40.000Z', seenAt: '2026-10-11T10:05:40.000Z' });
  await clock.advance(30000);
  await ui.redraw();
  expect(await ui.find({ type: 'Text', text: '◦ otra sesión (S1) trabaja en T002 · hace 1 min' })).toBeDefined();
  expect(await ui.find({ key: 'other-track' })).toBeDefined();
  await ui.unmount();
});

test("the 30 s tick renews this conversation's binding once a minute, and no other (C3)", async ($, on) => {
  engineBottom(on);
  const files: Record<string, string> = { ...FILES, [`${ROOT}/.waypoint/demo/seats/main-2/bound.json`]: BOUND({ sid: 'main-2', claude: 'conv-2', seenAt: '2026-10-11T10:00:00.000Z' }) };
  const written: string[] = [];
  serveFiles(on, files, [], () => SESSION_ID, written);
  const clock = mock.clock(on, { now: Date.parse('2026-10-11T10:05:00.000Z') });
  on('session.start', (_$, e) => ({ cwd: e.cwd }));
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await clock.advance(30000);
  expect(written).toEqual([`${ROOT}/.waypoint/demo/bound.json`]);
  expect(JSON.parse(files[`${ROOT}/.waypoint/demo/bound.json`]).seenAt).toBe('2026-10-11T10:05:30.000Z');
  await clock.advance(30000);
  expect(written).toHaveLength(1);
  await clock.advance(30000);
  expect(written).toHaveLength(2);
  expect(JSON.parse(files[`${ROOT}/.waypoint/demo/seats/main-2/bound.json`]).seenAt).toBe('2026-10-11T10:00:00.000Z');
});

test('a tick whose reads fail leaves the band as it was, and the next one renews again (C3)', async ($, on) => {
  engineBottom(on);
  let rootFails = false;
  const written: string[] = [];
  serveFiles(on, { ...FILES }, [], () => SESSION_ID, written, () => (rootFails ? null : ROOT));
  const clock = mock.clock(on, { now: Date.parse('2026-10-11T10:05:00.000Z') });
  on('session.start', (_$, e) => ({ cwd: e.cwd }));
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  const ui = await $.ui.mount({ plugin: 'waypoint', surface: 'terminal', component: 'AbovePrompt', props: PROPS });
  rootFails = true;
  await clock.advance(60000);
  await ui.redraw();
  expect(written).toEqual([]);
  expect((await ui.find({ type: 'Text', text: /^● / }))?.text).toMatch(/^● frente backend 1\/2 · T002 API de pedidos · /);
  expect(await ui.find({ key: 'next-task' })).toBeDefined();
  rootFails = false;
  await clock.advance(30000);
  expect(written).toEqual([`${ROOT}/.waypoint/demo/bound.json`]);
  await ui.unmount();
});

test('× on a notice is kept per checkout, project, kind and subject until the notice would end (K5-08)', async ($, on) => {
  engineBand(on);
  serveFiles(on, {});
  const store = memoryStore(on);
  mock.clock(on, { now: Date.parse('2026-10-11T10:12:30.000Z') });
  on('session.start', (_$, e) => ({ cwd: e.cwd }));
  let band = notice({ kind: 'previous', viewer: PREVIOUS });
  serveBand(on, () => band);
  const mount = () => $.ui.mount({ plugin: 'waypoint', surface: 'terminal', component: 'AbovePrompt', props: PROPS });
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  let ui = await mount();
  await ui.press({ key: 'dismiss' });
  await ui.redraw();
  expect(store.dismissed).toEqual({ [dismissedKey('previous', 'task:T002')]: '2026-10-12T10:00:00.000Z' });
  expect(await ui.find({ key: 'resume' })).toBeUndefined();
  expect(await ui.find({ text: 'engine band' })).toBeDefined();
  await ui.unmount();
  // A new start reads the store again: still hidden. Another task shows.
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  ui = await mount();
  expect(await ui.find({ key: 'resume' })).toBeUndefined();
  await ui.unmount();
  band = notice({ kind: 'previous', task: 'T003', title: 'Maqueta de carrito', key: 'task:T003', viewer: PREVIOUS });
  ui = await mount();
  expect(await ui.find({ key: 'resume' })).toBeDefined();
  await ui.unmount();
  // The same task worked by another live session is another notice: it shows.
  band = notice();
  ui = await mount();
  expect(await ui.find({ key: 'other-track' })).toBeDefined();
  await ui.unmount();
  // Another live session's notice: hidden for a day from now.
  band = notice({ task: null, title: null, key: 'seat:main' });
  ui = await mount();
  await ui.press({ key: 'dismiss' });
  await ui.redraw();
  expect(store.dismissed).toMatchObject({ [dismissedKey('other-live', 'seat:main')]: '2026-10-12T10:12:30.000Z' });
  await ui.unmount();
});

test('a notice dismissed in an earlier session stays hidden; an expired dismissal or a junk store hides nothing (K5-08, Review Focus 5)', async ($, on) => {
  engineBand(on);
  serveFiles(on, {});
  const store = memoryStore(on, { dismissed: { [dismissedKey('previous', 'task:T002')]: '2026-10-12T10:00:00.000Z', [dismissedKey('other-live', 'seat:main')]: '2026-10-11T10:00:00.000Z' } });
  mock.clock(on, { now: Date.parse('2026-10-11T10:12:30.000Z') });
  on('session.start', (_$, e) => ({ cwd: e.cwd }));
  let band = notice({ kind: 'previous', viewer: PREVIOUS });
  serveBand(on, () => band);
  const mount = () => $.ui.mount({ plugin: 'waypoint', surface: 'terminal', component: 'AbovePrompt', props: PROPS });
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  let ui = await mount();
  expect(await ui.find({ key: 'resume' })).toBeUndefined();
  await ui.unmount();
  band = notice({ task: null, title: null, key: 'seat:main' });
  ui = await mount();
  expect(await ui.find({ key: 'other-track' })).toBeDefined();
  await ui.unmount();
  // An earlier version's |-joined key is junk too (M7): its notice shows once more.
  for (const junk of [[dismissedKey('previous', 'task:T002')], 'nope', { [dismissedKey('previous', 'task:T002')]: 'tomorrow' }, { '/repo|demo|previous|task:T002': '2026-10-12T10:00:00.000Z' }]) {
    store.dismissed = junk;
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
    band = notice({ kind: 'previous', viewer: PREVIOUS });
    ui = await mount();
    expect(await ui.find({ key: 'resume' }), JSON.stringify(junk)).toBeDefined();
    await ui.unmount();
  }
  // Dismissing another live session's work on T002 does not hide the offer it leaves once it ends.
  store.dismissed = { [dismissedKey('other-live', 'task:T002')]: '2026-10-12T10:12:30.000Z' };
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  band = notice();
  ui = await mount();
  expect(await ui.find({ key: 'other-track' })).toBeUndefined();
  await ui.unmount();
  band = notice({ kind: 'previous', viewer: PREVIOUS });
  ui = await mount();
  expect(await ui.find({ key: 'resume' })).toBeDefined();
  await ui.unmount();
});

test('a notice dismissed before a hot reload stays hidden though no session start reads the store again (M6)', async ($, on) => {
  engineBand(on);
  serveFiles(on, {});
  const store = memoryStore(on, { dismissed: { [dismissedKey('previous', 'task:T009')]: '2026-10-12T10:00:00.000Z' } });
  mock.clock(on, { now: Date.parse('2026-10-11T10:12:30.000Z') });
  let band = notice({ kind: 'previous', task: 'T009', title: 'Pagos', key: 'task:T009', viewer: PREVIOUS });
  serveBand(on, () => band);
  const mount = () => $.ui.mount({ plugin: 'waypoint', surface: 'terminal', component: 'AbovePrompt', props: PROPS });
  let ui = await mount();
  expect(await ui.find({ key: 'resume' })).toBeUndefined();
  expect(await ui.find({ text: 'engine band' })).toBeDefined();
  await ui.unmount();
  // Read once: another notice still shows, and the store is not asked again on every draw.
  store.dismissed = {};
  band = notice({ kind: 'previous', viewer: PREVIOUS });
  ui = await mount();
  expect(await ui.find({ key: 'resume' })).toBeDefined();
  await ui.unmount();
  band = notice({ kind: 'previous', task: 'T009', title: 'Pagos', key: 'task:T009', viewer: PREVIOUS });
  ui = await mount();
  expect(await ui.find({ key: 'resume' })).toBeUndefined();
  await ui.unmount();
});

// The dismissals of notice task:T009, kept until far ahead of any clock.
const T009_DISMISSED = { [dismissedKey('previous', 'task:T009')]: '2999-01-01T00:00:00.000Z' };
const T009 = () => notice({ kind: 'previous', task: 'T009', title: 'Pagos', key: 'task:T009', viewer: PREVIOUS });
// Real time, for a wait the engine's clock does not drive (the mod types know no timers: reached through globalThis).
const timers = globalThis as unknown as { setTimeout(fn: () => void, ms: number): unknown };
const sleepMs = (ms: number) => new Promise<void>(r => { timers.setTimeout(r, ms); });

test('the dismissals two surfaces wait for are read once, and both are drawn again when the read ends (M6, round 2)', async ($, on) => {
  // What the engine draws beneath the plugin, counted: one per draw of the band.
  let draws = 0;
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    draws++;
    const { Text } = $.ui.resolve(e);
    return h(Text, {}, 'engine band') as RenderElement;
  });
  serveFiles(on, {});
  mock.clock(on, { now: Date.parse('2026-10-11T10:12:30.000Z') });
  // The store answers only once released; `asked` counts its reads.
  let release = () => {};
  const held = new Promise<void>(r => { release = r; });
  let asked = 0;
  on('store.get', async (_$, e) => {
    asked++;
    await held;
    return { value: e.key === 'dismissed' ? T009_DISMISSED : undefined };
  });
  serveBand(on, T009);
  // Two surfaces draw the notice at once, before any session start (a hot reload).
  const terminal = $.ui.mount({ plugin: 'waypoint', surface: 'terminal', component: 'AbovePrompt', props: PROPS });
  const desktop = $.ui.mount({ plugin: 'waypoint', surface: 'desktop', component: 'AbovePrompt', props: PROPS });
  for (let i = 0; i < 200 && asked === 0; i++) await sleepMs(5);
  await sleepMs(50);
  const before = draws;
  release();
  const uis = await Promise.all([terminal, desktop]);
  for (let i = 0; i < 100 && draws < before + 2; i++) await sleepMs(5);
  // With no redraw asked here, neither surface shows the dismissed notice: each waited for the one read, or was drawn
  // again when it ended.
  for (const [n, ui] of uis.entries()) {
    expect(await ui.find({ key: 'resume' }), SURFACES[n]).toBeUndefined();
    expect(await ui.find({ text: 'engine band' }), SURFACES[n]).toBeDefined();
  }
  expect(asked).toBe(1);
  expect(draws).toBeGreaterThanOrEqual(before + 2);
  for (const ui of uis) await ui.unmount();
});

test('a first read of the dismissals that fails is tried again on the next draw, and nothing loops on it (M6, round 2)', async ($, on) => {
  engineBand(on);
  serveFiles(on, {});
  mock.clock(on, { now: Date.parse('2026-10-11T10:12:30.000Z') });
  let fails = true;
  let asked = 0;
  on('store.get', (_$, e) => {
    asked++;
    return fails ? { deny: 'store busy' } : { value: e.key === 'dismissed' ? T009_DISMISSED : undefined };
  });
  serveBand(on, T009);
  const ui = await $.ui.mount({ plugin: 'waypoint', surface: 'terminal', component: 'AbovePrompt', props: PROPS });
  // Nothing could be read: the notice shows, and nothing asks the store again until the next draw.
  expect(await ui.find({ key: 'resume' })).toBeDefined();
  await sleepMs(50);
  expect(asked).toBe(1);
  fails = false;
  await ui.redraw();
  expect(await ui.find({ key: 'resume' })).toBeUndefined();
  expect(asked).toBe(2);
  await ui.unmount();
});

test('a store that refuses the write still hides the dismissed notice in this process (Review Focus 5)', async ($, on) => {
  engineBand(on);
  serveFiles(on, {});
  memoryStore(on, {}, true);
  mock.clock(on, { now: Date.parse('2026-10-11T10:12:30.000Z') });
  on('session.start', (_$, e) => ({ cwd: e.cwd }));
  serveBand(on, () => notice({ kind: 'previous', viewer: PREVIOUS }));
  const mount = () => $.ui.mount({ plugin: 'waypoint', surface: 'terminal', component: 'AbovePrompt', props: PROPS });
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  let ui = await mount();
  await ui.press({ key: 'dismiss' });
  await ui.redraw();
  expect(await ui.find({ key: 'resume' })).toBeUndefined();
  await ui.unmount();
  ui = await mount();
  expect(await ui.find({ key: 'resume' })).toBeUndefined();
  await ui.unmount();
});
