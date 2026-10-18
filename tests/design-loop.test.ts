import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { run, type Io } from '../src/cli/run.js';
import { useTempDirs } from './helpers/tmp.js';
const tmp = useTempDirs();

/**
 * Re-review N3: the setup every loop below shares: a temporary repository with the fixture design and plan, driven from
 * another folder (Review Focus 3), and the helpers that run the CLI there. `open` makes a fresh one, `close` removes it.
 */
function sandbox(prefix: string) {
  let repo = '';
  let elsewhere = '';
  let io: Io;
  const design = () => path.join(repo, 'docs/waypoint/demo-shop/design.md');
  const plan = () => path.join(repo, 'docs/waypoint/demo-shop/plan.yaml');
  /** The CLI from the other folder; a non-zero exit throws with its stderr. */
  const wp = (...args: string[]) => {
    const r = run(args, io);
    if (r.code !== 0) throw new Error(`waypoint ${args.join(' ')} exited ${r.code}: ${r.stderr}`);
    return r;
  };
  return {
    repo: () => repo,
    elsewhere: () => elsewhere,
    design,
    plan,
    wp,
    /** The CLI from the other folder, whatever its exit code. */
    raw: (...args: string[]) => run(args, io),
    json: (...args: string[]) => JSON.parse(wp(...args).stdout),
    /** Replaces `from` (which must be there) with `to` in the design, or in `file`. */
    edit: (from: string, to: string, file = design()) => {
      const text = readFileSync(file, 'utf8');
      if (!text.includes(from)) throw new Error(`not in ${file}: ${from}`);
      writeFileSync(file, text.replace(from, to));
    },
    open: () => {
      repo = tmp(`${prefix}-`);
      elsewhere = tmp(`${prefix}-cwd-`);
      execFileSync('git', ['init', '-q'], { cwd: repo });
      mkdirSync(path.dirname(design()), { recursive: true });
      copyFileSync(new URL('./fixtures/design.md', import.meta.url), design());
      copyFileSync(new URL('./fixtures/plan.yaml', import.meta.url), plan());
      const assets = path.join(elsewhere, 'assets');
      mkdirSync(assets);
      writeFileSync(path.join(assets, 'design.template.html'), '<title>__TITLE__</title><script type="application/json" id="wp-design-data">__DATA__</script>');
      io = { cwd: elsewhere, now: () => new Date('2026-10-17T10:00:00.000Z'), rand: () => 0, assetsDir: assets, env: {} };
    },
    close: () => {
      rmSync(repo, { recursive: true, force: true });
      rmSync(elsewhere, { recursive: true, force: true });
    },
  };
}

// §7.3 of the spec: a whole design loop on tests/fixtures/design.md in a temporary repository, run from another folder
// (Review Focus 3): round 1, apply, round --verify, approve --auto and amend, and the design page that tells it.
describe('the design loop end to end (§7.3)', () => {
  const box = sandbox('wp-loop');
  const { design, plan, wp, json, edit } = box;
  const prop = (n: number, severity: string, section: string, problem: string, change: string) => ({ n, category: 'gap', severity, section, problem, change });
  beforeAll(box.open);
  afterAll(box.close);

  it('round 1, apply, round --verify, approve --auto and amend, and the design page tells each round', () => {
    wp('design-snapshot', design(), '--note', 'borrador', '--round', '0', '--kind', 'draft');

    // Round 1: everything, with the full budget.
    const r1 = json('critique-next', design());
    expect(r1).toMatchObject({ round: 1, version: 1, scope: 'full', budget: { max: 12, severities: ['critical', 'major', 'minor'] } });
    expect(r1.out).toBe(path.join(box.repo(), 'docs/waypoint/demo-shop/design/critiques/r1.json'));
    mkdirSync(path.dirname(r1.out), { recursive: true });
    writeFileSync(r1.out, JSON.stringify({ round: 1, version: 1, scope: 'full', verdict: 'changes', proposals: [
      prop(1, 'critical', 'riesgos', 'La migración no tiene rollback', 'Añadir un plan de rollback probado'),
      prop(2, 'major', 'alcance', 'El pago no dice cuántos reintentos', 'Fijar 3 reintentos'),
      prop(3, 'minor', 'arquitectura', 'Falta un diagrama', 'Añadir un diagrama'),
    ] }));
    wp('critique-check', r1.out, '--round', '1', '--version', '1', '--design', design());

    // Apply the critical and the major one; dismiss the minor one with its reason, as auto mode does.
    edit('La migración de reembolsos no tiene rollback.', 'La migración de reembolsos tiene un plan de rollback probado.');
    edit('La versión 0.1 cubre pedidos, carrito y pago con Stripe.', 'La versión 0.1 cubre pedidos, carrito y pago con Stripe, con 3 reintentos.');
    wp('design-snapshot', design(), '--note', 'ronda 1', '--round', '1', '--kind', 'apply', '--applied', 'r1:1,2');
    writeFileSync(path.join(box.elsewhere(), 'reason.txt'), 'auto: minor');
    wp('critique-dismiss', design(), '--round', '1', '3', '--reason-file', 'reason.txt');
    expect(json('design-gate', design())).toMatchObject({ pending: [], needsVerify: true, canAutoApprove: false });

    // round --verify: only what changed, at most 3 critical.
    const r2 = json('critique-next', design(), '--verify');
    expect(r2).toMatchObject({ round: 2, version: 2, scope: 'changed', since: 1, budget: { max: 3, severities: ['critical'] }, review: ['alcance', 'riesgos'] });
    writeFileSync(r2.out, JSON.stringify({ round: 2, version: 2, scope: 'changed', verdict: 'ready', proposals: [] }));
    wp('critique-check', r2.out, '--round', '2', '--version', '2', '--verify', '--changed', r2.review.join(','), '--design', design());
    const gate = json('design-gate', design());
    expect(gate).toMatchObject({ rounds: 2, criticalPending: [], majorPending: [], needsVerify: false, canAutoApprove: true });
    expect(gate.dismissed).toEqual([{ round: 1, n: 3, section: 'arquitectura', problem: 'Falta un diagrama', reason: 'auto: minor' }]);
    expect(gate.applied.map((a: { n: number }) => a.n)).toEqual([1, 2]);

    // approve --auto: the status first, then the snapshot; an approval changes no body.
    edit('start_prompt: /waypoint:work backend', 'start_prompt: /waypoint:work backend\nstatus: approved');
    wp('design-snapshot', design(), '--note', 'aprobado (auto)', '--kind', 'approve');
    expect(json('design-gate', design())).toMatchObject({ version: 3, needsVerify: false, canAutoApprove: true });

    // The plan follows the approved design.
    edit('version: "0.1"\n', 'version: "0.1"\ndesign_version: 3\n', plan());
    edit('    title: Esquema de pedidos\n', '    title: Esquema de pedidos\n    design_ref: riesgos\n', plan());
    edit('    title: API de pedidos\n', '    title: API de pedidos\n    design_ref: arquitectura\n', plan());
    const linked = wp('validate', plan(), '--design', design()).stdout;
    expect(linked).not.toContain('warning: design_version');
    expect(linked).not.toContain('design_ref(s) not in the design');

    // amend: a small change that keeps it approved; the impact names the task of that section.
    edit('Backend en Node y frontend web.', 'Backend en Node 22 y frontend web.');
    expect(json('design-snapshot', design(), '--note', 'enmienda: Node 22', '--kind', 'amend')).toMatchObject({ version: 4, kind: 'amend' });
    expect(json('design-impact', design(), '--plan', plan())).toEqual({
      since: 3, changed: ['arquitectura'], removed: [], tasks: [{ id: 'T002', ref: 'arquitectura', status: null }], unref: 4,
    });
    expect(wp('validate', plan(), '--design', design()).stdout).toContain('warning: design_version is 3 but the approved design is v4: set design_version: 4');

    // The page: approved and amended, two rounds, what became of each proposal, what the amendment changed.
    const out = path.join(box.elsewhere(), 'design-page.html');
    wp('design-page', design(), '--out', out);
    const data = JSON.parse(/id="wp-design-data">(.*?)<\/script>/s.exec(readFileSync(out, 'utf8'))![1]);
    expect(data).toMatchObject({ status: 'approved', amended: true, rounds: 2, current: 4, source: 'docs/waypoint/demo-shop/' });
    expect(data.critiques[0].proposals.map((p: { fate: string }) => p.fate)).toEqual(['applied', 'applied', 'dismissed']);
    expect(data.critiques[0].proposals[0].appliedIn).toBe(2);
    expect(data.critiques[0].proposals[2].reason).toBe('auto: minor');
    expect(data.critiques[1]).toMatchObject({ round: 2, verdict: 'ready', proposals: [] });
    expect(data.versions.at(-1).diff).toEqual({ changed: ['Arquitectura'], added: [], removed: [] });
  });
});

// Carry 9: the same loop for a project whose first round was written before 0.27.0, in .waypoint/<project>/ with a
// dismissed.json of numbers, run from another folder: the new rounds go to docs/, and the gate and the page read both.
describe('the design loop through the .waypoint/ route of a project from before 0.27.0 (carry 9)', () => {
  const box = sandbox('wp-legacy');
  const { design, wp, json, edit } = box;
  beforeAll(box.open);
  afterAll(box.close);

  it('round 1 from .waypoint/, apply, round --verify in docs/, approve: the gate and the page tell both rounds', () => {
    wp('design-snapshot', design(), '--note', 'Borrador inicial', '--round', '0');
    const legacy = path.join(box.repo(), '.waypoint/demo-shop');
    mkdirSync(legacy, { recursive: true });
    writeFileSync(path.join(legacy, 'critique-r1.json'), JSON.stringify({ round: 1, version: 1, scope: 'full', proposals: [
      { n: 1, category: 'risk', severity: 'critical', section: 'riesgos', problem: 'Sin rollback', change: 'Añadir rollback' },
      { n: 2, category: 'gap', severity: 'minor', section: 'arquitectura', problem: 'Sin diagrama', change: 'Añadir diagrama' },
    ] }));
    writeFileSync(path.join(legacy, 'dismissed.json'), JSON.stringify({ 1: [2] }));
    expect(json('design-gate', design())).toMatchObject({ rounds: 1, latestRound: 1, criticalPending: [{ round: 1, n: 1 }], pendingCounts: { critical: 1, major: 0, minor: 0 } });

    edit('no tiene rollback', 'tiene un plan de rollback');
    wp('design-snapshot', design(), '--note', 'ronda 1', '--kind', 'apply', '--applied', 'r1:1');
    const r2 = json('critique-next', design(), '--verify');
    expect(r2).toMatchObject({ round: 2, version: 2, scope: 'changed', review: ['riesgos'], out: path.join(box.repo(), 'docs/waypoint/demo-shop/design/critiques/r2.json') });
    mkdirSync(path.dirname(r2.out), { recursive: true });
    writeFileSync(r2.out, JSON.stringify({ round: 2, version: 2, scope: 'changed', verdict: 'ready', proposals: [] }));
    wp('critique-check', r2.out, '--round', '2', '--version', '2', '--verify', '--changed', 'riesgos', '--design', design());
    expect(json('design-gate', design())).toMatchObject({ rounds: 2, pending: [], needsVerify: false, canAutoApprove: true });

    edit('start_prompt: /waypoint:work backend', 'start_prompt: /waypoint:work backend\nstatus: approved');
    wp('design-snapshot', design(), '--note', 'aprobado (auto)', '--kind', 'approve');
    const out = path.join(box.elsewhere(), 'page.html');
    wp('design-page', design(), '--out', out);
    const data = JSON.parse(/id="wp-design-data">(.*?)<\/script>/s.exec(readFileSync(out, 'utf8'))![1]);
    expect(data).toMatchObject({ status: 'approved', rounds: 2, pending: 0, current: 3 });
    expect(data.critiques.map((c: { round: number; proposals: { fate: string }[] }) => [c.round, c.proposals.map(p => p.fate)])).toEqual([[1, ['applied', 'dismissed']], [2, []]]);
  });
});

// Final review I1: the skill passes no --round to the approval nor to the reopen, so design-snapshot takes the newest
// critique round itself; the first round after a reopen then gets round 1's budget, as critique-next and
// critique-check --design both count it. No command here passes --round.
describe('a reopen restarts the budget in the normal flow, with no --round anywhere (final review I1)', () => {
  const box = sandbox('wp-reopen');
  const { design, wp, json, edit } = box;
  const prop = (n: number, severity: string, section: string) => ({ n, category: 'gap', severity, section, problem: `p${n}`, change: `c${n}` });
  const critique = (out: string, c: object) => { mkdirSync(path.dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(c)); };
  const rounds = () => JSON.parse(readFileSync(path.join(box.repo(), 'docs/waypoint/demo-shop/design/changelog.json'), 'utf8')).map((e: { round: number }) => e.round);
  beforeEach(box.open);
  afterEach(box.close);
  // approve (--kind approve), then a reopen whose change is a new section, as /forge:infinite does for a Large task.
  const approveAndReopen = () => {
    edit('start_prompt: /waypoint:work backend', 'start_prompt: /waypoint:work backend\nstatus: approved');
    wp('design-snapshot', design(), '--note', 'aprobado (auto)', '--kind', 'approve');
    edit('status: approved', 'status: draft');
    writeFileSync(design(), `${readFileSync(design(), 'utf8')}\n## T009: Nueva tarea\n\nUna tarea Large nueva con bastante texto.\n`);
    wp('design-snapshot', design(), '--note', 'reabierto para T009', '--kind', 'reopen');
  };
  // The first round after the reopen: the budget of round 1 (12, every severity) on what changed, and the check agrees.
  const firstRoundAfterReopen = (round: number) => {
    const next = json('critique-next', design());
    expect(next).toMatchObject({ round, budget: { max: 12, severities: ['critical', 'major', 'minor'] }, scope: 'changed', review: ['t009-nueva-tarea'] });
    critique(next.out, { round, version: next.version, scope: 'changed', verdict: 'ready', proposals: [prop(1, 'minor', 't009-nueva-tarea')] });
    const check = box.raw('critique-check', next.out, '--version', String(next.version), '--design', design(), '--changed', next.review.join(','));
    expect(check.stderr).toBe('');
    expect(check.code).toBe(0);
  };

  it('round 1, apply, round --verify (ready), approve and reopen: round 3 has the budget of round 1, and critique-check --design accepts a minor', () => {
    wp('design-snapshot', design(), '--note', 'borrador', '--kind', 'draft');
    const r1 = json('critique-next', design());
    critique(r1.out, { round: 1, version: 1, scope: 'full', verdict: 'changes', proposals: [prop(1, 'critical', 'riesgos'), prop(2, 'minor', 'alcance')] });
    wp('critique-check', r1.out, '--version', '1', '--design', design());
    edit('no tiene rollback', 'tiene un rollback probado');
    wp('design-snapshot', design(), '--note', 'ronda 1', '--kind', 'apply', '--applied', 'r1:1');
    const r2 = json('critique-next', design(), '--verify');
    expect(r2).toMatchObject({ round: 2, budget: { max: 3, severities: ['critical'] } });
    critique(r2.out, { round: 2, version: 2, scope: 'changed', verdict: 'ready', proposals: [] });
    wp('critique-check', r2.out, '--version', '2', '--verify', '--design', design());
    approveAndReopen();
    // The approval and the reopen carry the round of the r2 critique that no snapshot recorded.
    expect(rounds()).toEqual([0, 1, 2, 2]);
    firstRoundAfterReopen(3);
  });

  it('two critiques with no snapshot between them (round, round, approve, reopen): the first round after the reopen is round 1 of the budget', () => {
    wp('design-snapshot', design(), '--note', 'borrador', '--kind', 'draft');
    const r1 = json('critique-next', design());
    critique(r1.out, { round: 1, version: 1, scope: 'full', verdict: 'ready', proposals: [prop(1, 'minor', 'alcance')] });
    wp('critique-check', r1.out, '--version', '1', '--design', design());
    const r2 = json('critique-next', design(), '--full');
    expect(r2).toMatchObject({ round: 2, scope: 'full' });
    critique(r2.out, { round: 2, version: 1, scope: 'full', verdict: 'ready', proposals: [] });
    wp('critique-check', r2.out, '--version', '1', '--design', design());
    approveAndReopen();
    expect(rounds()).toEqual([0, 2, 2]);
    firstRoundAfterReopen(3);
  });

  it('a second reopen restarts the budget again', () => {
    wp('design-snapshot', design(), '--note', 'borrador', '--kind', 'draft');
    const r1 = json('critique-next', design());
    critique(r1.out, { round: 1, version: 1, scope: 'full', verdict: 'ready', proposals: [] });
    approveAndReopen();
    firstRoundAfterReopen(2);
    // Approved again and reopened for another task: the next round is round 1 of the budget once more.
    edit('status: draft', 'status: approved');
    wp('design-snapshot', design(), '--note', 'aprobado', '--kind', 'approve');
    edit('status: approved', 'status: draft');
    edit('Una tarea Large nueva con bastante texto.', 'Una tarea Large nueva con bastante texto y un criterio de hecho.');
    wp('design-snapshot', design(), '--note', 'reabierto para T010', '--kind', 'reopen');
    expect(json('critique-next', design())).toMatchObject({ round: 3, budget: { max: 12, severities: ['critical', 'major', 'minor'] }, review: ['t009-nueva-tarea'] });
  });
});
