import { describe, it, expect, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { firstStage, listRoutes, normalizeRoute, pruneRoutes, readRoute, routeAsk, routeOptions, writeRoute } from '../src/forge/route.js';
import { resolvePrefs } from '../src/forge/prefs.js';
import { readLocal } from '../src/forge/local.js';
import { allDecisions } from '../src/forge/decisions.js';
import { run, cleanProbe, type Io } from '../src/forge/cli/run.js';

const PREFS = resolvePrefs({}, {}, {});
const SP = { installed: true, version: '6.4.1' };
const SPEC = { path: 'docs/superpowers/specs/s.md', title: 'S', modified: '2026-10-12T00:00:00.000Z' };
const PLAN = { path: 'docs/superpowers/plans/p.md', title: 'P', tasks: 3, done: 1 };
type Input = Parameters<typeof routeOptions>[0];
const input = (o: Partial<Input> = {}): Input => ({ path: 'medium', prefs: PREFS, superpowers: SP, specs: [], plans: [], runPlan: false, buildSpec: false, ...o });

describe('routeOptions', () => {
  it('without superpowers: forge or no forge, forge recommended', () => {
    const r = routeOptions(input({ path: 'large', superpowers: { installed: false, version: null } }));
    expect(r.options).toEqual(['forge', 'none']);
    expect(r.recommended.option).toBe('forge');
  });
  it('with superpowers: four options, and the recommendation in the order of spec §5.3', () => {
    expect(routeOptions(input()).options).toEqual(['forge', 'superpowers', 'superpowers-design', 'superpowers-plan']);
    expect(routeOptions(input({ plans: [PLAN], runPlan: true, specs: [SPEC] })).recommended).toMatchObject({ option: 'superpowers-plan', plan: PLAN.path });
    expect(routeOptions(input({ plans: [PLAN], specs: [SPEC], buildSpec: true })).recommended).toMatchObject({ option: 'superpowers-design', spec: SPEC.path });
    expect(routeOptions(input({ path: 'large' })).recommended).toEqual({ option: 'superpowers-design', why: expect.stringContaining('brainstorming') });
    expect(routeOptions(input()).recommended.option).toBe('forge');
    // A plan nobody asked to carry out is not recommended.
    expect(routeOptions(input({ plans: [PLAN] })).recommended.option).toBe('forge');
  });
  it('a recent spec the request does not ask to build is listed, never recommended', () => {
    const r = routeOptions(input({ specs: [SPEC] }));
    expect(r.recommended).toEqual({ option: 'forge', why: expect.any(String) });
    expect(r.specs).toEqual([SPEC.path]);
    expect(routeOptions(input({ path: 'large', specs: [SPEC] })).recommended).toEqual({ option: 'superpowers-design', why: expect.stringContaining('brainstorming') });
  });
  it('in auto mode a Large request without a spec goes to forge, whose design loop never asks', () => {
    const auto = resolvePrefs({ autonomy: 'auto' }, {}, {});
    expect(routeOptions(input({ path: 'large', prefs: auto })).recommended).toEqual({ option: 'forge', why: expect.stringContaining('auto mode') });
    expect(routeOptions(input({ path: 'large', prefs: auto, specs: [SPEC], buildSpec: true })).recommended).toMatchObject({ option: 'superpowers-design', spec: SPEC.path });
    expect(routeOptions(input({ path: 'large', prefs: auto, plans: [PLAN], runPlan: true })).recommended).toMatchObject({ option: 'superpowers-plan', plan: PLAN.path });
  });
  it('passes the preferences, their sources and the specs and plans through', () => {
    const r = routeOptions(input({ prefs: resolvePrefs({ autonomy: 'auto' }, { workflow: 'forge' }, {}), specs: [SPEC], plans: [PLAN] }));
    expect(r).toMatchObject({ workflow: 'forge', autonomy: 'auto', sources: { workflow: 'local', autonomy: 'request' }, specs: [SPEC.path], plans: [{ path: PLAN.path, tasks: 3, done: 1 }] });
  });
  it('routeAsk: the method with the recommended option first, and whether to remember it (K1-08)', () => {
    const es = routeAsk(routeOptions(input({ path: 'large' })), 'es');
    expect(es.options.map(o => [o.option, o.recommended])).toEqual([['superpowers-design', true], ['forge', false], ['superpowers', false], ['superpowers-plan', false]]);
    expect(es.options[0].label).toBe('superpowers diseña, forge construye (Recomendado)');
    expect(es.remember.options.map(o => o.remember)).toEqual([true, false]);
    const en = routeAsk(routeOptions(input({ superpowers: { installed: false, version: null } })), 'en');
    expect(en.options.map(o => o.label)).toEqual(['forge (Recommended)', 'without forge']);
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
  it('keeps the session that chose the route, and drops one that is not a plain id', () => {
    const ok = { task: 't1', chosen: 'superpowers-design', by: 'user', stage: 'designing', ts: '2026-10-13T10:00:00.000Z' };
    expect(normalizeRoute({ ...ok, session: 'a1b2-c3d4' })).toEqual({ ...ok, session: 'a1b2-c3d4' });
    expect(normalizeRoute({ ...ok, session: 'x y"' })).toEqual(ok);
  });
});

describe('forge route CLI', () => {
  let root: string;
  let cfg: string;
  let io: Io;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'forge-route-'));
    cfg = mkdtempSync(path.join(tmpdir(), 'forge-route-cfg-'));
    io = { cwd: root, now: () => new Date('2026-10-13T10:00:00.000Z'), env: { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: 'sess-0' } };
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
    expect(readRoute(root, 'sess-0')).toMatchObject({ stage: 'designing', session: 'sess-0' });
    expect(allDecisions(root).at(-1)).toMatchObject({ point: 'route', chosen: 'superpowers-plan', by: 'user', task: 't1', weight: 'major' });
    expect(JSON.parse(run(['route', 'stage', '--stage', 'planning', '--plan', 'docs/superpowers/plans/p.md'], io).stdout)).toMatchObject({ updated: true, stage: 'planning', plan: 'docs/superpowers/plans/p.md' });
    expect(JSON.parse(run(['route', 'stage', '--task', 'other', '--stage', 'done'], io).stdout)).toEqual({ updated: false });
    expect(JSON.parse(run(['route', 'set', '--task', 't2', '--chosen', 'forge', '--by', 'auto'], io).stdout)).toMatchObject({ stage: 'handed-off', by: 'auto' });
    expect(allDecisions(root).at(-1)).toMatchObject({ point: 'route', by: 'auto' });
    for (const bad of [['route', 'set', '--task', 't3', '--chosen', 'magic', '--by', 'user'], ['route', 'set', '--task', 't3', '--chosen', 'forge', '--by', 'robot'],
      ['route', 'stage', '--stage', 'later'], ['route', 'set', '--task', 't3', '--chosen', 'forge', '--by', 'user', '--spec', 'a"b']]) expect(run(bad, io).code).toBe(2);
  });
  it('recommends building a recent spec only with --build-spec', () => {
    installSuperpowers();
    const spec = path.join(root, 'docs', 'superpowers', 'specs', '2026-10-12-cart-design.md');
    mkdirSync(path.dirname(spec), { recursive: true });
    writeFileSync(spec, '# Cart\n\nCoupons.\n');
    utimesSync(spec, io.now(), io.now());
    const rel = 'docs/superpowers/specs/2026-10-12-cart-design.md';
    expect(JSON.parse(run(['route', '--task', 't1', '--path', 'medium'], io).stdout)).toMatchObject({ specs: [rel], recommended: { option: 'forge' } });
    expect(JSON.parse(run(['route', '--task', 't1', '--path', 'medium', '--build-spec'], io).stdout)).toMatchObject({ recommended: { option: 'superpowers-design', spec: rel } });
  });
  it('set keeps the session that chose the route', () => {
    expect(JSON.parse(run(['route', 'set', '--task', 't1', '--chosen', 'superpowers-design', '--by', 'user', '--session', 'sess-1'], io).stdout)).toMatchObject({ session: 'sess-1' });
    expect(readRoute(root, 'sess-1')).toMatchObject({ session: 'sess-1' });
    expect(JSON.parse(run(['route', 'stage', '--stage', 'planning', '--session', 'sess-1'], io).stdout)).toMatchObject({ session: 'sess-1' });
    expect(run(['route', 'set', '--task', 't1', '--chosen', 'forge', '--by', 'user', '--session', 'a b'], io).code).toBe(2);
  });
  it('stage without a route updates nothing', () => {
    expect(JSON.parse(run(['route', 'stage', '--stage', 'done'], io).stdout)).toEqual({ updated: false });
  });
  it('route --text-file probes the request without writing anything and asks once in two parts (K1-01, K1-08)', () => {
    mkdirSync(path.join(root, '.forge', 'work', 't1'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'work', 't1', 'task.txt'), 'redesign the plugin architecture\n');
    const r = JSON.parse(run(['route', '--task', 't1', '--text-file', '.forge/work/t1/task.txt', '--locale', 'es'], io).stdout);
    expect(r.probe).toMatchObject({ path: 'large', sensitive: [], announce: expect.any(String) });
    expect(r).toMatchObject({ stepAside: false, cleaned: true, options: ['forge', 'none'] });
    expect(r.ask.options[0]).toEqual({ label: 'forge (Recomendado)', option: 'forge', recommended: true });
    expect(r.ask.remember.options.map((o: { remember: boolean }) => o.remember)).toEqual([true, false]);
    expect(existsSync(path.join(root, '.forge'))).toBe(false);
  });
  it('a probe never deletes what was there: more files in .forge/, or a text file elsewhere (Review Focus 5)', () => {
    mkdirSync(path.join(root, '.forge', 'work', 't1'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'work', 't1', 'task.txt'), 'fix the typo in a.ts\n');
    writeFileSync(path.join(root, '.forge', 'local.yaml'), 'known: []\n');
    expect(JSON.parse(run(['route', '--task', 't1', '--text-file', '.forge/work/t1/task.txt'], io).stdout)).toMatchObject({ cleaned: false, stepAside: true });
    expect(existsSync(path.join(root, '.forge', 'work', 't1', 'task.txt'))).toBe(true);
    expect(existsSync(path.join(root, '.forge', 'ledger.jsonl'))).toBe(false);
    expect(existsSync(path.join(root, '.forge', 'status.json'))).toBe(false);
    expect(existsSync(path.join(root, '.forge', '.gitignore'))).toBe(false);
    writeFileSync(path.join(root, 'req.txt'), 'fix the typo in a.ts\n');
    expect(JSON.parse(run(['route', '--task', 't2', '--text-file', 'req.txt'], io).stdout).cleaned).toBe(false);
    expect(existsSync(path.join(root, 'req.txt'))).toBe(true);
  });
  it('a probe leaves a .forge/ it did not make as it was: a .gitignore, another file or task, the ledger, status.json and local.yaml (Review Focus 5)', () => {
    const files = (): Record<string, string> => {
      const out: Record<string, string> = {};
      const walk = (d: string, rel: string): void => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          const r = rel ? `${rel}/${e.name}` : e.name;
          if (e.isDirectory()) { out[`${r}/`] = ''; walk(path.join(d, e.name), r); } else out[r] = readFileSync(path.join(d, e.name), 'utf8');
        }
      };
      walk(path.join(root, '.forge'), '');
      return out;
    };
    mkdirSync(path.join(root, '.forge', 'work', 't1'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'work', 't1', 'task.txt'), 'fix the typo in a.ts\n');
    const probe = (task = 't1') => JSON.parse(run(['route', '--task', task, '--text-file', '.forge/work/t1/task.txt'], io).stdout);
    const unchanged = (task = 't1') => {
      const before = files();
      expect(probe(task).cleaned).toBe(false);
      expect(files()).toEqual(before);
    };
    // A .gitignore: .forge/ was there before the probe.
    writeFileSync(path.join(root, '.forge', '.gitignore'), '*\n');
    unchanged();
    rmSync(path.join(root, '.forge', '.gitignore'));
    // Another file next to the task file, or another task's directory.
    writeFileSync(path.join(root, '.forge', 'work', 't1', 'notes.md'), 'x\n');
    unchanged();
    rmSync(path.join(root, '.forge', 'work', 't1', 'notes.md'));
    mkdirSync(path.join(root, '.forge', 'work', 't2'));
    unchanged();
    rmSync(path.join(root, '.forge', 'work', 't2'), { recursive: true });
    // The task file of another task id is not this probe's.
    unchanged('t2');
    // A project with a ledger, status.json and local.yaml: the probe reads the ledger (the ratchet) and writes none of them.
    expect(run(['triage', '--task', 't1', 'redesign the plugin architecture'], io).code).toBe(0);
    writeFileSync(path.join(root, '.forge', 'local.yaml'), 'known: []\nworkflow: ask\n');
    expect(Object.keys(files())).toEqual(expect.arrayContaining(['ledger.jsonl', 'status.json', 'local.yaml', '.gitignore']));
    const before = files();
    expect(probe()).toMatchObject({ cleaned: false, stepAside: false, probe: { path: 'large', reasons: expect.arrayContaining([expect.stringContaining('ratchet')]) } });
    expect(files()).toEqual(before);
  });
  it('the probe follows a fixed workflow: no question, and workflow forge never steps aside', () => {
    writeFileSync(path.join(root, 'req.txt'), 'fix the typo in a.ts\n');
    expect(JSON.parse(run(['route', '--task', 't1', '--text-file', 'req.txt', '--workflow', 'forge'], io).stdout)).toMatchObject({ stepAside: false, ask: null });
    expect(JSON.parse(run(['route', '--task', 't1', '--text-file', 'req.txt', '--autonomy', 'auto'], io).stdout).ask).toBeNull();
    expect(JSON.parse(run(['route', '--task', 't1', '--text-file', 'req.txt', '--path', 'medium'], io).stdout).stepAside).toBe(false);
    expect(run(['route', '--task', 't1', '--text-file'], io).code).toBe(2);
    // In a directory without .forge/, a probe creates nothing.
    expect(existsSync(path.join(root, '.forge'))).toBe(false);
  });
  it('a probe that exits 2 (an empty text, a bad --path, --workflow or --autonomy) leaves no .forge/ behind either', () => {
    for (const [text, extra] of [['', []], ['fix the typo in a.ts\n', ['--path', 'huge']], ['fix the typo in a.ts\n', ['--workflow', 'maybe']], ['fix the typo in a.ts\n', ['--autonomy', 'never']]] as const) {
      mkdirSync(path.join(root, '.forge', 'work', 't1'), { recursive: true });
      writeFileSync(path.join(root, '.forge', 'work', 't1', 'task.txt'), text);
      expect(run(['route', '--task', 't1', '--text-file', '.forge/work/t1/task.txt', ...extra], io).code, extra.join(' ') || 'empty').toBe(2);
      expect(existsSync(path.join(root, '.forge')), extra.join(' ') || 'empty').toBe(false);
    }
  });
  it('cleaned says the task file was deleted even when a directory could not be removed after it', () => {
    mkdirSync(path.join(root, '.forge', 'work', 't1'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'work', 't1', 'task.txt'), 'x\n');
    expect(cleanProbe(root, 't1', '.forge/work/t1/task.txt', () => { throw new Error('EBUSY'); })).toBe(true);
    expect(existsSync(path.join(root, '.forge', 'work', 't1', 'task.txt'))).toBe(false);
  });
  it('a workflow pinned to a superpowers option that is not installed asks the person (route/SKILL.md «ask as below»)', () => {
    writeFileSync(path.join(root, 'req.txt'), 'redesign the plugin architecture\n');
    const probe = () => JSON.parse(run(['route', '--task', 't1', '--text-file', 'req.txt', '--workflow', 'superpowers-design', '--locale', 'en'], io).stdout);
    expect(probe().ask).toMatchObject({ question: expect.any(String), options: expect.arrayContaining([expect.objectContaining({ option: 'forge' })]) });
    installSuperpowers();
    expect(probe().ask).toBeNull();
  });
  it('route set reads --why-file before it writes anything: a missing one leaves local.yaml alone', () => {
    expect(run(['route', 'set', '--task', 't1', '--chosen', 'forge', '--by', 'user', '--remember', '--why-file', 'missing.txt'], io).code).toBe(2);
    expect(existsSync(path.join(root, '.forge'))).toBe(false);
  });
  it('route set --remember keeps the choice in local.yaml; none without it writes nothing (K1-08)', () => {
    expect(JSON.parse(run(['route', 'set', '--task', 't1', '--chosen', 'none', '--by', 'user'], io).stdout)).toEqual({ written: false });
    expect(existsSync(path.join(root, '.forge'))).toBe(false);
    expect(JSON.parse(run(['route', 'set', '--task', 't1', '--chosen', 'forge', '--by', 'user', '--remember'], io).stdout)).toMatchObject({ chosen: 'forge', remembered: 'forge' });
    expect(readLocal(root).workflow).toBe('forge');
    expect(JSON.parse(run(['route', 'set', '--task', 't2', '--chosen', 'none', '--by', 'user', '--remember'], io).stdout)).toEqual({ written: false, remembered: 'off' });
    expect(readLocal(root).workflow).toBe('off');
  });
});

describe('one route per session (K1-04, K1-05)', () => {
  let root: string;
  let io: Io;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'forge-route-sess-'));
    io = { cwd: root, now: () => new Date('2026-10-13T10:00:00.000Z'), env: {} };
  });
  it('route set of A and B leave two files, and route stage of B never touches the route of A', () => {
    expect(run(['route', 'set', '--task', 't1', '--chosen', 'superpowers-design', '--by', 'user', '--session', 'A'], io).code).toBe(0);
    expect(run(['route', 'set', '--task', 't2', '--chosen', 'superpowers-plan', '--by', 'user', '--session', 'B'], io).code).toBe(0);
    expect(readdirSync(path.join(root, '.forge', 'route')).sort()).toEqual(['A.json', 'B.json']);
    expect(JSON.parse(run(['route', 'stage', '--stage', 'done'], { ...io, env: { CLAUDE_CODE_SESSION_ID: 'B' } }).stdout)).toMatchObject({ updated: true, task: 't2', stage: 'done' });
    expect(JSON.parse(run(['route', 'stage', '--stage', 'done', '--task', 't1', '--session', 'B'], io).stdout)).toEqual({ updated: false });
    expect(readRoute(root, 'A')).toMatchObject({ task: 't1', stage: 'designing' });
  });
  it('without a session set and stage exit 2; an older route.json without one counts for nobody, and with one it moves to that session', () => {
    expect(run(['route', 'set', '--task', 't1', '--chosen', 'forge', '--by', 'user'], io).code).toBe(2);
    expect(run(['route', 'stage', '--stage', 'done'], io).code).toBe(2);
    expect(JSON.parse(run(['route', 'set', '--task', 't1', '--chosen', 'none', '--by', 'user'], io).stdout)).toEqual({ written: false });
    const legacy = path.join(root, '.forge', 'route.json');
    const doc = { task: 't1', chosen: 'superpowers-design', by: 'user', stage: 'designing', ts: '2026-10-13T10:00:00.000Z' };
    mkdirSync(path.dirname(legacy), { recursive: true });
    writeFileSync(legacy, JSON.stringify(doc));
    expect(readRoute(root, 'A')).toBeNull();
    writeFileSync(legacy, JSON.stringify({ ...doc, session: 'A' }));
    expect(readRoute(root, 'B')).toBeNull();
    expect(readRoute(root, 'A')).toMatchObject({ task: 't1', session: 'A' });
    expect(existsSync(legacy)).toBe(false);
    expect(existsSync(path.join(root, '.forge', 'route', 'A.json'))).toBe(true);
    for (const bad of [null, '', '../x', 'a b']) expect(readRoute(root, bad)).toBeNull();
  });
  it('a session id that is not safe never names a file: set and stage exit 2, writeRoute refuses it, and a file that names another session is not this one', () => {
    for (const bad of ['../x', 'a b', '..', 'a:b']) {
      expect(run(['route', 'set', '--task', 't1', '--chosen', 'forge', '--by', 'user', '--session', bad], io).code, bad).toBe(2);
      expect(run(['route', 'set', '--task', 't1', '--chosen', 'none', '--by', 'user', '--session', bad], io).code, bad).toBe(2);
      expect(run(['route', 'stage', '--stage', 'done', '--session', bad], io).code, bad).toBe(2);
    }
    expect(existsSync(path.join(root, '.forge'))).toBe(false);
    const doc = { task: 't1', chosen: 'forge' as const, by: 'user' as const, stage: 'handed-off' as const, ts: '2026-10-13T10:00:00.000Z' };
    expect(() => writeRoute(root, doc)).toThrow(/session/);
    expect(() => writeRoute(root, { ...doc, session: '../x' })).toThrow(/session/);
    // A file named for A that says B (copied by hand) is neither A's nor B's.
    mkdirSync(path.join(root, '.forge', 'route'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'route', 'A.json'), JSON.stringify({ ...doc, session: 'B' }));
    expect(readRoute(root, 'A')).toBeNull();
    expect(readRoute(root, 'B')).toBeNull();
    expect(listRoutes(root)).toEqual([]);
  });
  it('an empty --session falls back to CLAUDE_CODE_SESSION_ID, as in C1; a --session that is not safe still exits 2', () => {
    const s9 = { ...io, env: { CLAUDE_CODE_SESSION_ID: 'S9' } };
    expect(JSON.parse(run(['route', 'set', '--task', 't1', '--chosen', 'superpowers-plan', '--by', 'user', '--session'], s9).stdout)).toMatchObject({ session: 'S9', stage: 'designing' });
    const r = run(['route', 'stage', '--stage', 'planning', '--session', '--plan', 'docs/p.md'], s9);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ updated: true, session: 'S9', stage: 'planning', plan: 'docs/p.md' });
    expect(readRoute(root, 'S9')).toMatchObject({ stage: 'planning', plan: 'docs/p.md' });
    // A quoted empty value (`--session ""`, an empty substitution in a shell) is no id either (carry 8).
    expect(JSON.parse(run(['route', 'set', '--task', 't2', '--chosen', 'superpowers-plan', '--by', 'user', '--session', ''], s9).stdout)).toMatchObject({ task: 't2', session: 'S9' });
    expect(JSON.parse(run(['route', 'stage', '--stage', 'planning', '--session', '', '--plan', 'docs/q.md'], s9).stdout)).toMatchObject({ updated: true, session: 'S9', plan: 'docs/q.md' });
    expect(run(['route', 'stage', '--stage', 'planning', '--session', ''], io)).toMatchObject({ code: 2, stderr: expect.stringContaining('no Claude session id') });
    expect(run(['route', 'stage', '--stage', 'done', '--session', '../x'], s9).code).toBe(2);
    expect(run(['route', 'set', '--task', 't1', '--chosen', 'forge', '--by', 'user', '--session', '../x'], s9).code).toBe(2);
    expect(readRoute(root, 'S9')).toMatchObject({ stage: 'planning' });
  });
  it('route set prunes route files not written for 7 days, never its own session\'s', () => {
    const day = 24 * 3600_000;
    const now = io.now().getTime();
    const doc = (session: string) => ({ task: 't1', chosen: 'forge' as const, by: 'user' as const, stage: 'handed-off' as const, ts: io.now().toISOString(), session });
    const file = (s: string) => path.join(root, '.forge', 'route', `${s}.json`);
    const age = (s: string, days: number) => { const t = new Date(now - days * day); utimesSync(file(s), t, t); };
    writeRoute(root, doc('OLD')); age('OLD', 8);
    writeRoute(root, doc('WEEK')); age('WEEK', 6);
    expect(run(['route', 'set', '--task', 't2', '--chosen', 'forge', '--by', 'user', '--session', 'NEW'], io).code).toBe(0);
    expect(existsSync(file('OLD'))).toBe(false);
    expect(existsSync(file('WEEK'))).toBe(true);
    expect(existsSync(file('NEW'))).toBe(true);
    // Its own file stays, however old; a stale temporary file goes too.
    age('NEW', 30);
    writeFileSync(path.join(root, '.forge', 'route', 'X.json.123.tmp'), '{');
    utimesSync(path.join(root, '.forge', 'route', 'X.json.123.tmp'), new Date(now - 9 * day), new Date(now - 9 * day));
    pruneRoutes(root, 'NEW', now);
    expect(existsSync(file('NEW'))).toBe(true);
    expect(readdirSync(path.join(root, '.forge', 'route')).sort()).toEqual(['NEW.json', 'WEEK.json']);
  });
  it('route set --remember without a session leaves local.yaml alone: every input is read before anything is written', () => {
    expect(run(['route', 'set', '--task', 't1', '--chosen', 'forge', '--by', 'user', '--remember'], io).code).toBe(2);
    expect(existsSync(path.join(root, '.forge'))).toBe(false);
  });
  it('from a linked worktree, set and stage keep the route in the main checkout', () => {
    const git = (...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
    git('init', '-q', '-b', 'main'); git('config', 'user.email', 'a@b.c'); git('config', 'user.name', 't');
    writeFileSync(path.join(root, 'x.txt'), 'x'); git('add', '.'); git('commit', '-qm', 'init');
    const wt = path.join(root, 'wt');
    git('worktree', 'add', '-q', wt, '-b', 'w');
    const inWt = { ...io, cwd: wt, env: { CLAUDE_CODE_SESSION_ID: 'W1' } };
    expect(run(['route', 'set', '--task', 't1', '--chosen', 'superpowers-design', '--by', 'user'], inWt).code).toBe(0);
    expect(existsSync(path.join(root, '.forge', 'route', 'W1.json'))).toBe(true);
    expect(existsSync(path.join(wt, '.forge', 'route'))).toBe(false);
    expect(JSON.parse(run(['route', 'stage', '--stage', 'done'], inWt).stdout)).toMatchObject({ updated: true, stage: 'done' });
    expect(readRoute(root, 'W1')).toMatchObject({ stage: 'done' });
  });
});
