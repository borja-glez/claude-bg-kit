import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { firstStage, normalizeRoute, readRoute, routeOptions } from '../src/forge/route.js';
import { resolvePrefs } from '../src/forge/prefs.js';
import { allDecisions } from '../src/forge/decisions.js';
import { run, type Io } from '../src/forge/cli/run.js';

const PREFS = resolvePrefs({}, {}, {});
const SP = { installed: true, version: '6.4.1' };
const SPEC = { path: 'docs/superpowers/specs/s.md', title: 'S', modified: '2026-10-12T00:00:00.000Z' };
const PLAN = { path: 'docs/superpowers/plans/p.md', title: 'P', tasks: 3, done: 1 };
type Input = Parameters<typeof routeOptions>[0];
const input = (o: Partial<Input> = {}): Input => ({ path: 'medium', prefs: PREFS, superpowers: SP, specs: [], plans: [], runPlan: false, ...o });

describe('routeOptions', () => {
  it('without superpowers: forge or no forge, forge recommended', () => {
    const r = routeOptions(input({ path: 'large', superpowers: { installed: false, version: null } }));
    expect(r.options).toEqual(['forge', 'none']);
    expect(r.recommended.option).toBe('forge');
  });
  it('with superpowers: four options, and the recommendation in the order of spec §5.3', () => {
    expect(routeOptions(input()).options).toEqual(['forge', 'superpowers', 'superpowers-design', 'superpowers-plan']);
    expect(routeOptions(input({ plans: [PLAN], runPlan: true, specs: [SPEC] })).recommended).toMatchObject({ option: 'superpowers-plan', plan: PLAN.path });
    expect(routeOptions(input({ plans: [PLAN], specs: [SPEC] })).recommended).toMatchObject({ option: 'superpowers-design', spec: SPEC.path });
    expect(routeOptions(input({ path: 'large' })).recommended).toEqual({ option: 'superpowers-design', why: expect.stringContaining('brainstorming') });
    expect(routeOptions(input()).recommended.option).toBe('forge');
    // A plan nobody asked to carry out is not recommended.
    expect(routeOptions(input({ plans: [PLAN] })).recommended.option).toBe('forge');
  });
  it('passes the preferences, their sources and the specs and plans through', () => {
    const r = routeOptions(input({ prefs: resolvePrefs({ autonomy: 'auto' }, { workflow: 'forge' }, {}), specs: [SPEC], plans: [PLAN] }));
    expect(r).toMatchObject({ workflow: 'forge', autonomy: 'auto', sources: { workflow: 'local', autonomy: 'request' }, specs: [SPEC.path], plans: [{ path: PLAN.path, tasks: 3, done: 1 }] });
  });
});

describe('route.json', () => {
  it('a route starts designing until superpowers wrote the spec or the plan', () => {
    expect(firstStage('superpowers-design', {})).toBe('designing');
    expect(firstStage('superpowers-design', { spec: 'x.md' })).toBe('handed-off');
    expect(firstStage('superpowers-plan', {})).toBe('designing');
    expect(firstStage('superpowers-plan', { plan: 'p.md' })).toBe('handed-off');
    expect(firstStage('forge', {})).toBe('handed-off');
  });
  it('normalizes strictly: a bad field is refused, a path with quotes dropped', () => {
    const ok = { task: 't1', chosen: 'superpowers-design', by: 'user', stage: 'designing', ts: '2026-10-13T10:00:00.000Z' };
    expect(normalizeRoute(ok)).toEqual(ok);
    expect(normalizeRoute({ ...ok, chosen: 'magic' })).toBeNull();
    expect(normalizeRoute({ ...ok, spec: 'a"; rm -rf /"' })).toEqual(ok);
  });
});

describe('forge route CLI', () => {
  let root: string;
  let cfg: string;
  let io: Io;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'forge-route-'));
    cfg = mkdtempSync(path.join(tmpdir(), 'forge-route-cfg-'));
    io = { cwd: root, now: () => new Date('2026-10-13T10:00:00.000Z'), env: { CLAUDE_CONFIG_DIR: cfg } };
  });
  const installSuperpowers = () => {
    const p = path.join(cfg, 'plugins', 'cache', 'm', 'superpowers', '6.4.1');
    mkdirSync(p, { recursive: true });
    writeFileSync(path.join(cfg, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'superpowers@m': [{ scope: 'user', installPath: p, version: '6.4.1' }] } }));
  };
  it('prints the options for the triaged path', () => {
    expect(JSON.parse(run(['route', '--task', 't1', '--path', 'large'], io).stdout)).toMatchObject({ options: ['forge', 'none'], superpowers: { installed: false } });
    installSuperpowers();
    expect(JSON.parse(run(['route', '--task', 't1', '--path', 'large'], io).stdout)).toMatchObject({
      options: ['forge', 'superpowers', 'superpowers-design', 'superpowers-plan'], superpowers: { installed: true, version: '6.4.1' }, recommended: { option: 'superpowers-design' },
    });
    expect(run(['route', '--task', 't1'], io).code).toBe(2);
    expect(run(['route', '--task', 't1', '--path', 'huge'], io).code).toBe(2);
    expect(run(['route', '--task', 't1', '--path', 'medium', '--workflow', 'maybe'], io).code).toBe(2);
  });
  it('set writes the route and records the route decision; stage moves it on', () => {
    expect(JSON.parse(run(['route', 'set', '--task', 't1', '--chosen', 'superpowers-plan', '--by', 'user'], io).stdout)).toMatchObject({ task: 't1', chosen: 'superpowers-plan', by: 'user', stage: 'designing' });
    expect(readRoute(root)).toMatchObject({ stage: 'designing' });
    expect(allDecisions(root).at(-1)).toMatchObject({ point: 'route', chosen: 'superpowers-plan', by: 'user', task: 't1', weight: 'major' });
    expect(JSON.parse(run(['route', 'stage', '--stage', 'planning', '--plan', 'docs/superpowers/plans/p.md'], io).stdout)).toMatchObject({ updated: true, stage: 'planning', plan: 'docs/superpowers/plans/p.md' });
    expect(JSON.parse(run(['route', 'stage', '--task', 'other', '--stage', 'done'], io).stdout)).toEqual({ updated: false });
    expect(JSON.parse(run(['route', 'set', '--task', 't2', '--chosen', 'forge', '--by', 'auto'], io).stdout)).toMatchObject({ stage: 'handed-off', by: 'auto' });
    expect(allDecisions(root).at(-1)).toMatchObject({ point: 'route', by: 'auto' });
    for (const bad of [['route', 'set', '--task', 't3', '--chosen', 'magic', '--by', 'user'], ['route', 'set', '--task', 't3', '--chosen', 'forge', '--by', 'robot'],
      ['route', 'stage', '--stage', 'later'], ['route', 'set', '--task', 't3', '--chosen', 'forge', '--by', 'user', '--spec', 'a"b']]) expect(run(bad, io).code).toBe(2);
  });
  it('stage without a route updates nothing', () => {
    expect(JSON.parse(run(['route', 'stage', '--stage', 'done'], io).stdout)).toEqual({ updated: false });
  });
});
