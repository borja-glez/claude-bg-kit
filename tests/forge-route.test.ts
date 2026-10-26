import { describe, it, expect, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { firstStage, listRoutes, namedOrFirst, needsPools, normalizeRoute, pruneRoutes, readRoute, routeAsk, routeOptions, writeRoute } from '../src/forge/route.js';
import { resolvePrefs } from '../src/forge/prefs.js';
import { readLocal } from '../src/forge/local.js';
import { allDecisions } from '../src/forge/decisions.js';
import { run, cleanProbe, type Io } from '../src/forge/cli/run.js';
import { useTempDirs } from './helpers/tmp.js';
const tmp = useTempDirs();

const PREFS = resolvePrefs({}, {}, {}, {});
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
    expect(routeOptions(input({ path: 'large' })).recommended).toMatchObject({ option: 'forge' });
    expect(routeOptions(input()).recommended.option).toBe('forge');
    // A plan nobody asked to carry out is not recommended.
    expect(routeOptions(input({ plans: [PLAN] })).recommended.option).toBe('forge');
  });
  it('a plan with no trace of progress counts only when the request names it, and its why says to check it (A1)', () => {
    const OPEN = { path: 'docs/superpowers/plans/2026-10-20-search.md', title: 'Search', tasks: 2, done: 1 };
    const FRESH = { path: 'docs/superpowers/plans/2026-10-23-coupons.md', title: 'Coupons', tasks: 2, done: 0 };
    expect(namedOrFirst([OPEN], 'carry out the coupons plan', [], [FRESH])).toBe(FRESH);
    expect(namedOrFirst([OPEN], 'carry out docs/superpowers/plans/2026-10-23-coupons.md', [], [FRESH])).toBe(FRESH);
    expect(namedOrFirst([OPEN], 'carry out 2026-10-23-coupons.md', [], [FRESH])).toBe(FRESH);
    expect(namedOrFirst([OPEN], 'carry out the plan', [], [FRESH])).toBe(OPEN);
    expect(namedOrFirst([], 'carry out the plan', [], [FRESH])).toBeUndefined();
    const pools = { plans: { pending: [OPEN], others: [], untraced: [FRESH] }, specs: { pending: [], others: [] } };
    const named = routeOptions(input({ plans: [OPEN], runPlan: true, text: 'carry out the coupons plan', pools })).recommended;
    expect(named).toMatchObject({ option: 'superpowers-plan', plan: FRESH.path });
    expect(named.why).toContain('no task marked done');
    expect(routeOptions(input({ plans: [OPEN], runPlan: true, text: 'carry out the search plan', pools })).recommended.why).not.toContain('no task marked done');
  });
  it('a recent spec the request does not ask to build is listed, never recommended', () => {
    const r = routeOptions(input({ specs: [SPEC] }));
    expect(r.recommended).toEqual({ option: 'forge', why: expect.any(String) });
    expect(r.specs).toEqual([SPEC.path]);
    expect(routeOptions(input({ path: 'large', specs: [SPEC] })).recommended).toEqual({ option: 'forge', why: expect.any(String) });
  });
  it('Large recommends forge; superpowers designs only to build a spec that exists (K1-06)', () => {
    expect(routeOptions(input({ path: 'large' })).recommended).toEqual({ option: 'forge', why: expect.stringContaining('large') });
    expect(routeOptions(input({ path: 'large', specs: [SPEC], buildSpec: true })).recommended).toMatchObject({ option: 'superpowers-design', spec: SPEC.path });
  });
  it('the plan or the spec the request names is the recommended one, else the most recent (K1-07)', () => {
    const NEW = { path: 'docs/superpowers/plans/2026-10-12-coupons.md', title: 'Coupons', tasks: 2, done: 0 };
    const OLD = { path: 'docs/superpowers/plans/2026-10-02-cart-totals.md', title: 'Cart totals', tasks: 3, done: 1 };
    const rec = (text: string) => routeOptions(input({ plans: [NEW, OLD], runPlan: true, text })).recommended.plan;
    expect(rec('Carry out the cart-totals plan, please')).toBe(OLD.path);
    expect(rec('carry out docs\\superpowers\\plans\\2026-10-02-cart-totals.md')).toBe(OLD.path);
    expect(rec('Run the "Cart totals" plan')).toBe(OLD.path);
    expect(rec('Carry out the plan')).toBe(NEW.path);
    const CHECKOUT = { path: 'docs/superpowers/specs/2026-10-01-checkout-design.md', title: 'Checkout', modified: '2026-10-01T00:00:00.000Z' };
    expect(routeOptions(input({ specs: [SPEC, CHECKOUT], buildSpec: true, text: 'build the checkout-design spec' })).recommended.spec).toBe(CHECKOUT.path);
  });
  it('a short name never decides: "fix the cart" does not pick a plan titled Cart (Review Focus 5)', () => {
    const CART = { path: 'docs/superpowers/plans/2026-10-02-cart.md', title: 'Cart', tasks: 2, done: 0 };
    const NEW = { path: 'docs/superpowers/plans/2026-10-12-coupons.md', title: 'Coupons', tasks: 2, done: 0 };
    expect(routeOptions(input({ plans: [NEW, CART], runPlan: true, text: 'fix the cart and carry out the plan' })).recommended.plan).toBe(NEW.path);
    expect(namedOrFirst([], 'anything')).toBeUndefined();
  });
  it('a named plan or spec that is not pending recommends none, never the newest instead (I2)', () => {
    const NEW = { path: 'docs/superpowers/plans/2026-10-12-coupons.md', title: 'Coupons', tasks: 2, done: 0 };
    const DONE = { path: 'docs/superpowers/plans/2026-10-02-cart-totals.md', title: 'Cart totals' };
    const none = { pending: [], others: [] };
    for (const text of ['Carry out the cart-totals plan', 'Run the "Cart totals" plan', 'carry out 2026-10-02-cart-totals.md', 'carry out docs/superpowers/plans/2026-10-02-cart-totals.md']) {
      expect(namedOrFirst([NEW], text, [DONE]), text).toBeUndefined();
      const pools = { plans: { pending: [NEW], others: [DONE] }, specs: none };
      expect(routeOptions(input({ plans: [NEW], runPlan: true, text, pools })).recommended, text).toEqual({ option: 'forge', why: expect.any(String) });
    }
    // A path into the plans' folder that names no plan at all names none either; one that names nothing still falls back.
    expect(namedOrFirst([NEW], 'carry out docs/superpowers/plans/2026-10-20-nope.md, please')).toBeUndefined();
    expect(namedOrFirst([NEW], 'carry out docs\\superpowers\\plans\\2026-10-12-coupons.md.')).toBe(NEW);
    expect(namedOrFirst([NEW], 'carry out the plan in docs/superpowers/plans/', [DONE])).toBe(NEW);
    expect(namedOrFirst([NEW], 'carry out the plan', [DONE])).toBe(NEW);
    // The spec side, the same way: a spec a plan already cites, named, is not replaced by the newest one.
    const SPEC_NEW = { path: 'docs/superpowers/specs/2026-10-12-coupons-design.md', title: 'Coupons', modified: '2026-10-12T00:00:00.000Z' };
    const pools = { plans: none, specs: { pending: [SPEC_NEW], others: [{ path: 'docs/superpowers/specs/2026-10-01-checkout-design.md', title: 'Checkout' }] } };
    expect(routeOptions(input({ specs: [SPEC_NEW], buildSpec: true, text: 'build the checkout-design spec', pools })).recommended.option).toBe('forge');
    expect(routeOptions(input({ path: 'large', specs: [SPEC_NEW], buildSpec: true, text: 'build the checkout-design spec', pools })).recommended).toEqual({ option: 'forge', why: expect.stringContaining('large') });
  });
  it('a plan or spec not offered stops the fallback by its path, file or stem, or by a title of several words named whole: «Refactor» does not (residual 1)', () => {
    const PENDING = { path: 'docs/superpowers/plans/2026-10-12-cart-refactor.md', title: 'Cart refactor', tasks: 2, done: 0 };
    const DONE = { path: 'docs/superpowers/plans/2026-10-01-refactor.md', title: 'Refactor' };
    expect(namedOrFirst([PENDING], 'run the plan to refactor the cart', [DONE])).toBe(PENDING);
    expect(namedOrFirst([PENDING], 'carry out 2026-10-01-refactor.md', [DONE])).toBeUndefined();
    expect(namedOrFirst([PENDING], 'carry out 2026-10-01-refactor', [DONE])).toBeUndefined();
    expect(namedOrFirst([PENDING], 'carry out docs/superpowers/plans/2026-10-01-refactor.md', [DONE])).toBeUndefined();
    const TOTALS = { path: 'docs/superpowers/plans/2026-10-01-totals.md', title: 'Cart totals' };
    expect(namedOrFirst([PENDING], 'run the «Cart totals» plan', [TOTALS])).toBeUndefined();
    expect(namedOrFirst([PENDING], 'run the plan for the cart totalsheet', [TOTALS])).toBe(PENDING);
    // A pending plan still matches by any name it holds.
    expect(namedOrFirst([{ ...PENDING, title: 'Refactor' }, { ...PENDING, path: 'docs/superpowers/plans/2026-10-13-x.md', title: 'Other' }].reverse(), 'run the refactor plan')!.title)
      .toBe('Refactor');
  });
  it('the recommendation names the plan or the spec it carries in its why, for the question (residual 4)', () => {
    expect(routeOptions(input({ plans: [PLAN], runPlan: true })).recommended.why).toContain(PLAN.path);
    expect(routeOptions(input({ specs: [SPEC], buildSpec: true })).recommended.why).toContain(SPEC.path);
  });
  it('the pools are read only when a recommendation can use them: --run-plan, --build-spec or a docs/superpowers/ path (residual 2)', () => {
    const base = { runPlan: false, buildSpec: false, text: 'add coupons to the cart' };
    expect(needsPools(base)).toBe(false);
    expect(needsPools({ ...base, runPlan: true })).toBe(true);
    expect(needsPools({ ...base, buildSpec: true })).toBe(true);
    expect(needsPools({ ...base, text: 'see Docs\\Superpowers\\plans\\x.md' })).toBe(true);
  });
  it('a request is matched against every pending plan, not only the three offered (I2)', () => {
    const plans = [12, 11, 10, 9].map(d => ({ path: `docs/superpowers/plans/2026-10-${String(d).padStart(2, '0')}-plan-${d}.md`, title: `Plan number ${d}`, tasks: 2, done: 0 }));
    const r = routeOptions(input({ plans: plans.slice(0, 3), runPlan: true, text: 'carry out plan-9', pools: { plans: { pending: plans, others: [] }, specs: { pending: [], others: [] } } }));
    expect(r.recommended.plan).toBe(plans[3].path);
    expect(r.plans.map(p => p.path)).toEqual(plans.slice(0, 3).map(p => p.path));
  });
  it('the longest name the request holds wins, and accents and Unicode forms count for nothing (T8)', () => {
    const BASE = { path: 'docs/superpowers/plans/2026-10-12-cart-totals.md', title: 'Cart totals', tasks: 2, done: 0 };
    const V2 = { path: 'docs/superpowers/plans/2026-10-02-cart-totals-v2.md', title: 'Cart totals v2', tasks: 2, done: 0 };
    expect(namedOrFirst([BASE, V2], 'carry out the cart-totals-v2 plan')).toBe(V2);
    expect(namedOrFirst([BASE, V2], 'run "Cart totals v2"')).toBe(V2);
    expect(namedOrFirst([V2, BASE], 'carry out the cart-totals plan')).toBe(BASE);
    // The longer name is a done plan's: none, not the pending plan whose name it contains.
    expect(namedOrFirst([BASE], 'carry out the cart-totals-v2 plan', [{ path: V2.path, title: V2.title }])).toBeUndefined();
    const ES = { path: 'docs/superpowers/plans/2026-10-02-carrito.md', title: 'Diseño del carrito', tasks: 2, done: 0 };
    const OTHER = { path: 'docs/superpowers/plans/2026-10-12-coupons.md', title: 'Coupons', tasks: 2, done: 0 };
    for (const text of ['ejecuta el plan «diseño del carrito»', 'ejecuta el plan «Diseno del carrito»', 'ejecuta el plan «DISEÑO DEL CARRITO»']) {
      expect(namedOrFirst([OTHER, ES], text), text).toBe(ES);
    }
    expect(namedOrFirst([OTHER, { ...ES, title: 'Diseño del carrito' }], 'ejecuta el plan «diseño del carrito»')!.path).toBe(ES.path);
  });
  it('in auto mode a Large request without a spec goes to forge, whose design loop never asks', () => {
    const auto = resolvePrefs({ autonomy: 'auto' }, {}, {}, {});
    expect(routeOptions(input({ path: 'large', prefs: auto })).recommended).toEqual({ option: 'forge', why: expect.stringContaining('auto mode') });
    expect(routeOptions(input({ path: 'large', prefs: auto, specs: [SPEC], buildSpec: true })).recommended).toMatchObject({ option: 'superpowers-design', spec: SPEC.path });
    expect(routeOptions(input({ path: 'large', prefs: auto, plans: [PLAN], runPlan: true })).recommended).toMatchObject({ option: 'superpowers-plan', plan: PLAN.path });
  });
  it('passes the preferences, their sources and the specs and plans through', () => {
    const r = routeOptions(input({ prefs: resolvePrefs({ autonomy: 'auto' }, { workflow: 'forge' }, {}, {}), specs: [SPEC], plans: [PLAN] }));
    expect(r).toMatchObject({ workflow: 'forge', autonomy: 'auto', sources: { workflow: 'local', autonomy: 'request' }, specs: [SPEC.path], plans: [{ path: PLAN.path, tasks: 3, done: 1 }] });
  });
  it('routeAsk: the method with the recommended option first, and whether to remember it (K1-08)', () => {
    const es = routeAsk(routeOptions(input({ path: 'large', specs: [SPEC], buildSpec: true })), 'es');
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
    root = tmp('forge-route-');
    cfg = tmp('forge-route-cfg-');
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
      options: ['forge', 'superpowers', 'superpowers-design', 'superpowers-plan'], superpowers: { installed: true, version: '6.4.1' }, recommended: { option: 'forge' },
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
  it("a spec handed off from brainstorming on this session's superpowers-design route is recorded as approved; any other is not (w8 FR4)", () => {
    const spec = 'docs/superpowers/specs/2026-10-26-cart-design.md';
    // Fix round 1: the spec brainstorming wrote on this route, so written after the route was set (io.now()).
    const write = (rel: string, at: Date) => {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      writeFileSync(path.join(root, rel), '# Cart\n');
      utimesSync(path.join(root, rel), at, at);
    };
    const later = new Date(io.now().getTime() + 3600_000);
    write(spec, later);
    write('docs/superpowers/specs/other-design.md', later);
    const stage = (...extra: string[]) => JSON.parse(run(['route', 'stage', '--stage', 'handed-off', ...extra], io).stdout);
    run(['route', 'set', '--task', 't1', '--chosen', 'superpowers-design', '--by', 'user'], io);
    expect(stage('--spec', spec)).toMatchObject({ updated: true, stage: 'handed-off', spec, specApproved: true });
    expect(readRoute(root, 'sess-0')).toMatchObject({ spec, specApproved: true });
    // forge:run runs the same command again after a resume: the same spec stays approved, another one is not.
    expect(stage('--spec', spec)).toMatchObject({ specApproved: true });
    expect(stage('--spec', 'docs/superpowers/specs/other-design.md')).not.toHaveProperty('specApproved');
    expect(readRoute(root, 'sess-0')).not.toHaveProperty('specApproved');
    // A route that named its spec when it was set never went through brainstorming.
    expect(JSON.parse(run(['route', 'set', '--task', 't2', '--chosen', 'superpowers-design', '--by', 'user', '--spec', spec], io).stdout)).not.toHaveProperty('specApproved');
    expect(stage('--spec', spec)).not.toHaveProperty('specApproved');
    // Brainstorming that ends without a file hands off with no spec; superpowers-plan never hands a spec to the design.
    run(['route', 'set', '--task', 't3', '--chosen', 'superpowers-design', '--by', 'user'], io);
    expect(stage()).not.toHaveProperty('specApproved');
    run(['route', 'set', '--task', 't4', '--chosen', 'superpowers-plan', '--by', 'user'], io);
    expect(stage('--spec', spec)).not.toHaveProperty('specApproved');
    // A hand-written route file cannot claim it without its spec.
    writeRoute(root, { task: 't5', chosen: 'superpowers-design', by: 'user', stage: 'handed-off', ts: '2026-10-13T10:00:00.000Z', session: 'sess-0', specApproved: true });
    expect(readRoute(root, 'sess-0')).not.toHaveProperty('specApproved');
    // Fix round 1: an older draft the person switched to, written before the route, or a spec that is not there, is not
    // the one brainstorming had approved.
    const old = 'docs/superpowers/specs/2026-09-01-old-design.md';
    write(old, new Date(io.now().getTime() - 24 * 3600_000));
    for (const s of [old, 'docs/superpowers/specs/missing-design.md']) {
      run(['route', 'set', '--task', 't6', '--chosen', 'superpowers-design', '--by', 'user'], io);
      expect(stage('--spec', s), s).toMatchObject({ updated: true, spec: s });
      expect(readRoute(root, 'sess-0'), s).not.toHaveProperty('specApproved');
    }
    // Written in the same second as the route (a coarse file clock) still counts.
    run(['route', 'set', '--task', 't7', '--chosen', 'superpowers-design', '--by', 'user'], io);
    write(old, new Date(io.now().getTime() + 400));
    expect(stage('--spec', old)).toMatchObject({ specApproved: true });
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
  it('route --text-file passes the request to the recommendation: the plan it names (K1-07)', () => {
    installSuperpowers();
    const plan = (name: string, title: string, daysAgo: number) => {
      const f = path.join(root, 'docs', 'superpowers', 'plans', name);
      mkdirSync(path.dirname(f), { recursive: true });
      writeFileSync(f, `# ${title} Implementation Plan\n\n### Task 1: one\n\n- [ ] a\n`);
      const t = new Date(io.now().getTime() - daysAgo * 86_400_000);
      utimesSync(f, t, t);
    };
    plan('2026-10-12-coupons.md', 'Coupons', 1);
    plan('2026-10-02-cart-totals.md', 'Cart totals', 10);
    mkdirSync(path.join(root, '.forge', 'work', 't1'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'work', 't1', 'task.txt'), 'Carry out the cart-totals plan and review each task\n');
    const r = JSON.parse(run(['route', '--task', 't1', '--text-file', '.forge/work/t1/task.txt', '--run-plan'], io).stdout);
    expect(r.recommended).toMatchObject({ option: 'superpowers-plan', plan: 'docs/superpowers/plans/2026-10-02-cart-totals.md' });
  });
  it('route recommends the named plan even 4th in recency, and none when the named one is done (I2)', () => {
    installSuperpowers();
    const plan = (name: string, title: string, daysAgo: number, box = ' ') => {
      const f = path.join(root, 'docs', 'superpowers', 'plans', name);
      mkdirSync(path.dirname(f), { recursive: true });
      writeFileSync(f, `# ${title} Implementation Plan\n\n### Task 1: one\n\n- [x] a\n\n### Task 2: two\n\n- [${box}] b\n`);
      const t = new Date(io.now().getTime() - daysAgo * 86_400_000);
      utimesSync(f, t, t);
    };
    for (const [d, name] of [[1, '12-coupons'], [2, '11-search'], [3, '10-checkout'], [4, '09-invoices']] as const) plan(`2026-10-${name}.md`, name.slice(3), d);
    plan('2026-10-05-cart-totals.md', 'Cart totals', 5, 'x');
    const rec = (text: string) => {
      writeFileSync(path.join(root, 'req.txt'), text);
      return JSON.parse(run(['route', '--task', 't1', '--text-file', 'req.txt', '--path', 'medium', '--run-plan'], io).stdout);
    };
    const fourth = rec('Carry out the invoices plan and review each task\n');
    expect(fourth.plans.map((p: { path: string }) => p.path)).toHaveLength(3);
    expect(fourth.recommended).toMatchObject({ option: 'superpowers-plan', plan: 'docs/superpowers/plans/2026-10-09-invoices.md' });
    const done = rec('Carry out the cart-totals plan and review each task\n');
    expect(done.recommended).toEqual({ option: 'forge', why: expect.any(String) });
    expect(rec('Carry out the plan and review each task\n').recommended).toMatchObject({ plan: 'docs/superpowers/plans/2026-10-12-coupons.md' });
  });
  it('a plan with no trace of progress is recommended only when the request names it, and is not listed (A1)', () => {
    installSuperpowers();
    const f = path.join(root, 'docs', 'superpowers', 'plans', '2026-10-12-coupons.md');
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, '# Coupons Implementation Plan\n\n### Task 1: one\n\n- [ ] a\n');
    utimesSync(f, io.now(), io.now());
    const rec = (text: string) => {
      writeFileSync(path.join(root, 'req.txt'), text);
      return JSON.parse(run(['route', '--task', 't1', '--text-file', 'req.txt', '--path', 'medium', '--run-plan'], io).stdout);
    };
    const named = rec('Carry out the coupons plan and review each task\n');
    expect(named.recommended).toMatchObject({ option: 'superpowers-plan', plan: 'docs/superpowers/plans/2026-10-12-coupons.md', why: expect.stringContaining('no task marked done') });
    expect(named.plans).toEqual([]);
    // Unnamed, forge is recommended, and its why names the plan so the person and the session learn it exists.
    expect(rec('Carry out the plan and review each task\n').recommended).toEqual({ option: 'forge', why: expect.stringContaining('docs/superpowers/plans/2026-10-12-coupons.md') });
    expect(JSON.parse(run(['sp-plans'], io).stdout)).toEqual([]);
  });
});

describe('one route per session (K1-04, K1-05)', () => {
  let root: string;
  let io: Io;
  beforeEach(() => {
    root = tmp('forge-route-sess-');
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
