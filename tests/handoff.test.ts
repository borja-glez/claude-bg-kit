import { describe, it, expect, beforeEach } from 'vitest';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { handoff, type Detected, type HandoffInput } from '../src/lib/handoff.js';
import { run, type Io } from '../src/cli/run.js';
import { useTempDirs } from './helpers/tmp.js';
const tmp = useTempDirs();

const ON: Detected = { on: true, version: '0.35.0', from: 'installed' };
const SP: Detected = { on: true, version: '7.0.0', from: 'session' };
const OFF: Detected = { on: false, version: null, from: null };
const input = (over: Partial<HandoffInput> = {}): HandoffInput => ({
  stage: 'design', project: 'demo-shop', es: true, forge: OFF, superpowers: OFF, tasks: null, tracks: null, started: false, running: false, ...over,
});
const ids = (i: HandoffInput) => handoff(i).options.map(o => o.id);

describe('handoff: the question after an approved design or a ready plan', () => {
  it('with forge and superpowers, after the design: forge recommended first, «Dejarlo planificado» last, no launch (four at most)', () => {
    const h = handoff(input({ forge: ON, superpowers: SP }));
    expect(ids(input({ forge: ON, superpowers: SP }))).toEqual(['forge', 'work', 'superpowers', 'later']);
    expect(h.recommended).toBe('forge');
    expect(h.ask).toMatchObject({ question: 'Diseño aprobado. ¿Cómo seguimos?', header: 'Siguiente', multiSelect: false });
    expect(h.ask!.options[0].label).toBe('Ejecutar con forge (Recomendado)');
    expect(h.ask!.options.slice(1).every(o => !o.label.includes('Recomendado'))).toBe(true);
    expect(h.options[0].command).toBe('/forge:run --handoff demo-shop');
    // forge executes superpowers' plan, and «later» writes the plan with forge's planner and starts nothing.
    expect(h.options[2].description).toContain('forge lo ejecuta');
    expect(h.options[3]).toMatchObject({ label: 'Dejarlo planificado', command: '/forge:run --handoff demo-shop --plan-only' });
    expect(h.options[3].description).toMatch(/^forge escribe el plan y el roadmap y no empieza nada/);
    expect(h.say[0]).toBe('Disponibles: forge 0.35.0 y superpowers 7.0.0.');
    expect(h.say.at(-1)).toMatch(/^Te recomiendo forge/);
  });

  it('without forge nor superpowers: working here is recommended, with the sessions per track and «later» by waypoint', () => {
    const h = handoff(input());
    expect(h.options.map(o => o.id)).toEqual(['work', 'launch', 'later']);
    expect(h.recommended).toBe('work');
    expect(h.ask!.options[0].label).toBe('Trabajar aquí, tarea a tarea (Recomendado)');
    expect(h.options[2]).toMatchObject({ command: '/waypoint:plan demo-shop' });
    expect(h.options[2].description).toMatch(/^waypoint escribe el plan/);
    expect(h.say[0]).toBe('Ni forge ni superpowers están disponibles en esta sesión.');
  });

  it('with superpowers alone: superpowers runs its own plan with subagents', () => {
    const h = handoff(input({ superpowers: SP }));
    expect(h.options.map(o => o.id)).toEqual(['work', 'superpowers', 'launch', 'later']);
    expect(h.options[1].description).toContain('lo ejecuta con subagentes');
    expect(h.say[0]).toBe('Disponible: superpowers 7.0.0. forge no está disponible.');
  });

  it('once the plan exists: no superpowers, sessions per track only with two tracks, and «later» runs nothing', () => {
    const one = input({ stage: 'plan', forge: ON, superpowers: SP, tasks: 1, tracks: 1 });
    expect(ids(one)).toEqual(['forge', 'work', 'later']);
    const h = handoff(one);
    expect(h.ask!.question).toBe('El plan está listo. ¿Cómo seguimos?');
    expect(h.options.at(-1)!.command).toBeNull();
    expect(h.say).toContain('El plan tiene 1 tarea en 1 frente.');
    expect(ids(input({ stage: 'plan', tasks: 6, tracks: 2 }))).toEqual(['work', 'launch', 'later']);
  });

  it('asks nothing while forge runs the plan, or once the plan has started', () => {
    const running = handoff(input({ stage: 'plan', forge: ON, tasks: 6, tracks: 2, running: true }));
    expect(running).toMatchObject({ ask: null, options: [], recommended: null });
    expect(running.say).toEqual(['Hay una ejecución de forge activa del plan de demo-shop: las tareas nuevas las coge ella. Si su sesión ya no está, retómala con /forge:run --resume o párala con /forge:stop.']);
    const started = handoff(input({ stage: 'plan', forge: ON, tasks: 6, tracks: 2, started: true }));
    expect(started.ask).toBeNull();
    expect(started.say).toEqual(['El plan ya está en marcha: para seguir, /waypoint:work o /forge:run --handoff demo-shop para ejecutarlo con forge.']);
  });

  it('a forge too old for the handoff is not offered, and says so', () => {
    const h = handoff(input({ forge: { on: false, version: '0.34.1', from: 'installed', tooOld: true } }));
    expect(h.recommended).toBe('work');
    expect(h.options.some(o => o.id === 'forge')).toBe(false);
    expect(h.say).toContain('forge 0.34.1 todavía no ofrece este paso (necesita 0.35.0): actualízalo para ejecutar desde aquí con forge.');
  });

  it('speaks English when the person does', () => {
    const h = handoff(input({ es: false, forge: ON }));
    expect(h.ask).toMatchObject({ question: 'Design approved. How do we go on?', header: 'Next step' });
    expect(h.ask!.options.map(o => o.label)).toEqual(['Run it with forge (Recommended)', 'Work here, task by task', 'Background session', 'Plan it, start later']);
    expect(h.say[0]).toBe('Available: forge 0.35.0. superpowers is not available.');
  });
});

describe('waypoint handoff', () => {
  const FIXTURE = new URL('./fixtures/plan.yaml', import.meta.url);
  const DESIGN = (status: string) => `---\ntitle: Tienda\nproject: demo-shop\nlocale: es\nsummary: Una tienda.\nstatus: ${status}\n---\n\n## Alcance\n\nTexto.\n`;
  let dir: string, config: string, io: Io;
  const docs = () => path.join(dir, 'docs', 'waypoint', 'demo-shop');
  const handoffOf = (...a: string[]) => {
    const r = run(['handoff', 'demo-shop', ...a], io);
    return { ...r, json: r.code === 0 ? JSON.parse(r.stdout) : null };
  };
  const install = (name: string, version: string, enabled?: boolean) => {
    const p = path.join(config, 'plugins', 'cache', 'bg-kit', name, version);
    mkdirSync(p, { recursive: true });
    const file = path.join(config, 'plugins', 'installed_plugins.json');
    writeFileSync(file, JSON.stringify({ version: 2, plugins: { [`${name}@bg-kit`]: [{ scope: 'user', installPath: p, version }] } }));
    writeFileSync(path.join(config, 'settings.json'), JSON.stringify(enabled === undefined ? {} : { enabledPlugins: { [`${name}@bg-kit`]: enabled } }));
  };

  beforeEach(() => {
    dir = tmp('wp-handoff-');
    config = tmp('wp-handoff-config-');
    mkdirSync(docs(), { recursive: true });
    io = { cwd: dir, now: () => new Date('2026-10-27T10:00:00.000Z'), assetsDir: dir, env: { CLAUDE_CONFIG_DIR: config } };
  });

  it('refuses a bad project, one with no files and a design that is not approved', () => {
    expect(run(['handoff', '../x'], io).code).toBe(2);
    expect(run(['handoff'], io).code).toBe(2);
    expect(handoffOf()).toMatchObject({ code: 2, stderr: expect.stringContaining('has neither') });
    writeFileSync(path.join(docs(), 'design.md'), DESIGN('draft'));
    expect(handoffOf()).toMatchObject({ code: 2, stderr: expect.stringContaining('not approved (status: draft)') });
  });

  it('after an approved design: the session lists its skills, and the installed plugins give their versions', () => {
    writeFileSync(path.join(docs(), 'design.md'), DESIGN('approved'));
    install('forge', '0.35.0');
    const { json } = handoffOf('--skills', 'forge:run,superpowers:writing-plans,waypoint:plan');
    expect(json.stage).toBe('design');
    expect(json.detected).toEqual({ forge: { on: true, version: '0.35.0', from: 'both' }, superpowers: { on: true, version: null, from: 'session' } });
    expect(json.options.map((o: { id: string }) => o.id)).toEqual(['forge', 'work', 'superpowers', 'later']);
    // Installed but not listed: not loaded in this session (installed after it started), so not offered.
    expect(handoffOf('--skills', 'superpowers:writing-plans').json.detected.forge).toEqual({ on: false, version: '0.35.0', from: 'installed' });
    expect(handoffOf('--skills', 'none').json.recommended).toBe('work');
    // Without --skills, installed and enabled is enough.
    expect(handoffOf().json.detected.forge).toEqual({ on: true, version: '0.35.0', from: 'installed' });
    // The person's language wins over the design's; es_ES is Spanish.
    expect(handoffOf('--locale', 'en').json.ask.question).toBe('Design approved. How do we go on?');
    expect(handoffOf('--locale', 'es_ES').json.ask.header).toBe('Siguiente');
  });

  it('a forge turned off in the settings, or older than the handoff, is not offered', () => {
    writeFileSync(path.join(docs(), 'design.md'), DESIGN('approved'));
    install('forge', '0.35.0', false);
    expect(handoffOf().json.detected.forge).toEqual({ on: false, version: null, from: null });
    install('forge', '0.34.1');
    const { json } = handoffOf('--skills', 'forge:run');
    expect(json.detected.forge).toEqual({ on: false, version: '0.34.1', from: 'both', tooOld: true });
    expect(json.recommended).toBe('work');
  });

  it('with a plan: its size, a started plan from the roadmap states, and a running forge execution', () => {
    copyFileSync(FIXTURE, path.join(docs(), 'plan.yaml'));
    const fresh = handoffOf('--skills', 'forge:run').json;
    expect(fresh).toMatchObject({ stage: 'plan', recommended: 'forge' });
    expect(fresh.say).toContain('El plan tiene 6 tareas en 2 frentes.');
    const st = path.join(dir, 'st');
    mkdirSync(st);
    writeFileSync(path.join(st, 'T001.json'), JSON.stringify({ status: 'free' }));
    expect(handoffOf('--states', 'st').json.ask).not.toBeNull();
    writeFileSync(path.join(st, 'T002.json'), JSON.stringify({ status: 'done' }));
    expect(handoffOf('--states', 'st').json).toMatchObject({ ask: null, options: [] });
    expect(handoffOf('--states', 'missing').code).toBe(1);
    writeFileSync(path.join(st, 'T002.json'), JSON.stringify({ status: 'free' }));
    mkdirSync(path.join(dir, '.forge'));
    const exec = { runId: 'r1', kind: 'plan', mode: 'subagents', parallel: 3, project: 'demo-shop', base: 'main', branch: 'forge/run-demo-shop', mergeOnFinish: false,
      coordinator: 'main', hookSession: null, active: true, stopReason: null, stallReason: null, startedAt: '2026-10-27T09:00:00.000Z', lastStepAt: null,
      lastBlockStep: null, sleepUntil: null, tasks: {} };
    writeFileSync(path.join(dir, '.forge', 'execution.json'), JSON.stringify(exec));
    expect(handoffOf().json.say[0]).toMatch(/^Hay una ejecución de forge activa del plan de demo-shop/);
    writeFileSync(path.join(dir, '.forge', 'execution.json'), JSON.stringify({ ...exec, project: 'other' }));
    expect(handoffOf().json.ask).not.toBeNull();
  });
});
