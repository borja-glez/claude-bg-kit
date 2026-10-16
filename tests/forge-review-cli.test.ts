import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run, type Io } from '../src/forge/cli/run.js';
import { appendEvent, readEvents } from '../src/forge/ledger.js';

let root: string;
let wt: string;
let io: Io;
let base: string;
const git = (...a: string[]) => execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', ...a], { cwd: wt, encoding: 'utf8' }).trim();
const work = () => path.join(root, '.forge', 'work', 'T1');
const review = {
  light: false, flags: ['--sensitive'],
  reviewers: [
    { role: 'review-correctness', model: null, effort: 'xhigh', agent: 'forge-review-correctness' },
    { role: 'review-security', model: null, effort: 'high', agent: 'forge-review-security' },
  ],
};

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'forge-review-'));
  wt = path.join(root, 'wt');
  mkdirSync(path.join(wt, '.forge'), { recursive: true });
  writeFileSync(path.join(wt, '.forge', 'config.yaml'), 'detect: false\nvalidators:\n  - name: check\n    cmd: node -e "process.exit(0)"\n');
  writeFileSync(path.join(wt, 'a.txt'), 'one\n');
  writeFileSync(path.join(wt, 'b.txt'), 'b\n'.repeat(30));
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  base = git('rev-parse', 'HEAD');
  writeFileSync(path.join(wt, 'a.txt'), 'one\ntwo\n');
  git('commit', '-q', '-am', 'change');
  mkdirSync(work(), { recursive: true });
  writeFileSync(path.join(work(), 'brief-1.md'), '# T1\n');
  writeFileSync(path.join(work(), 'baseline-1.json'), '[{"validator":"check","ok":true,"flaky":false,"durationMs":1,"failures":[]}]\n');
  io = { cwd: root, now: () => new Date('2026-10-14T10:00:00.000Z'), env: {} };
  appendEvent(root, { ts: '2026-10-14T09:00:00.000Z', kind: 'triage', task: 'T1', path: 'medium', sensitive: ['auth'], review });
});

// A committed gen.txt and a validator that rewrites it, as a build regenerates its committed bundle; `generated` names it
// unless told otherwise. The config change itself is forge's state (.forge), which no restore looks at.
const withGenerated = (generated = 'generated: [gen.txt]\n') => {
  if (!existsSync(path.join(wt, 'gen.txt'))) {
    writeFileSync(path.join(wt, 'gen.txt'), 'committed\n');
    git('add', 'gen.txt');
    git('commit', '-q', '-m', 'gen');
  }
  writeFileSync(path.join(wt, '.forge', 'config.yaml'),
    `${generated}detect: false\nvalidators:\n  - name: check\n    cmd: node -e "require('fs').writeFileSync('gen.txt',String(Date.now()))"\n`);
};

const prep = (...extra: string[]) => run(['review-prep', '--task', 'T1-1', '--path', 'medium', '--base', base, '--baseline', '.forge/work/T1/baseline-1.json',
  '--dir', '.forge/work/T1', '--cwd', wt, ...extra], io);

describe('forge review-prep', () => {
  it('round 1 writes validators, diff, head.txt and review-plan.json and prints spawn with the triage model and effort', () => {
    const r = prep();
    expect(r.stderr).toBe('');
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.round).toBe(1);
    expect(out.validators).toEqual({ ok: true, failing: [], preexisting: [], file: '.forge/work/T1/validators-1.json' });
    expect(out.spawn.map((s: { agent: string; model: unknown; effort: string; mode: string }) => [s.agent, s.model, s.effort, s.mode])).toEqual([
      ['forge-review-correctness', null, 'xhigh', 'full'],
      ['forge-review-security', null, 'high', 'full'],
    ]);
    expect(out.spawn[0].inputs).toEqual({ brief: '.forge/work/T1/brief-1.md', diff: '.forge/work/T1/diff-1.patch', validators: '.forge/work/T1/validators-1.json', out: '.forge/work/T1/reviews-1-1' });

    const validators = JSON.parse(readFileSync(path.join(work(), 'validators-1.json'), 'utf8'));
    expect(validators.map((v: { validator: string; ok: boolean }) => [v.validator, v.ok])).toEqual([['check', true]]);
    expect(readFileSync(path.join(work(), 'diff-1.patch'), 'utf8')).toContain('+two');
    const dir = path.join(work(), 'reviews-1-1');
    expect(readFileSync(path.join(dir, 'head.txt'), 'utf8').trim()).toBe(git('rev-parse', 'HEAD'));
    const plan = JSON.parse(readFileSync(path.join(dir, 'review-plan.json'), 'utf8'));
    expect(plan).toMatchObject({ task: 'T1-1', round: 1, path: 'medium', base, head: git('rev-parse', 'HEAD'), flags: ['--sensitive'], carried: [], shadow: false });
    expect(plan.spawn).toEqual(out.spawn);
    expect(readEvents(root).some(e => e.kind === 'validate' && e.task === 'T1-1' && e.ok === true)).toBe(true);
  });

  it('red validators open a validators round: nobody reviews, no plan, no verdict; the third time it plans the review (C-08)', () => {
    expect(JSON.parse(prep().stdout).spawn).toHaveLength(2);
    expect(existsSync(path.join(work(), 'reviews-1-1', 'review-plan.json'))).toBe(true);
    writeFileSync(path.join(wt, '.forge', 'config.yaml'), 'detect: false\nvalidators:\n  - name: check\n    cmd: node -e "process.exit(1)"\n');
    for (const k of [1, 2]) {
      const out = JSON.parse(prep('--locale', 'en').stdout);
      expect(out.validators).toMatchObject({ ok: false, failing: ['check'] });
      expect(out.spawn).toEqual([]);
      expect(out.validatorsRound).toEqual({ k, max: 2, findings: `.forge/work/T1/validators-fix-1-1-${k}.json` });
      expect(out.say).toContain(`${k} of 2`);
      expect(JSON.parse(readFileSync(path.join(root, out.validatorsRound.findings), 'utf8'))).toMatchObject({ task: 'T1-1', round: 1, validators: [{ validator: 'check', failing: [] }] });
      // The plan an earlier preparation of this round left is gone: review-close cannot close a review nobody did.
      expect(existsSync(path.join(work(), 'reviews-1-1', 'review-plan.json'))).toBe(false);
    }
    const events = readEvents(root);
    expect(events.some(e => e.kind === 'verdict')).toBe(false);
    expect(events.filter(e => e.kind === 'phase' && e.phase === 'fix').map(e => [e.brief, e.round, e.validators])).toEqual([[1, 1, true], [1, 1, true]]);
    const third = JSON.parse(prep().stdout);
    expect(third.validatorsRound).toBeUndefined();
    expect(third.validators).toMatchObject({ ok: false, failing: ['check'] });
    expect(third.spawn).toHaveLength(2);
    expect(existsSync(path.join(work(), 'reviews-1-1', 'review-plan.json'))).toBe(true);
  });

  it('with the shadow test open, round 1 adds an xhigh twin of the high reviewer writing to shadow/', () => {
    mkdirSync(path.join(root, '.forge'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'shadow.json'), JSON.stringify({ remaining: 2, cases: [] }));
    const out = JSON.parse(prep().stdout);
    const twin = out.spawn.find((s: { twin: boolean }) => s.twin);
    expect(twin).toMatchObject({ agent: 'forge-review-security', effort: 'xhigh', mode: 'full' });
    expect(twin.inputs.out).toBe('.forge/work/T1/reviews-1-1/shadow');
    expect(existsSync(path.join(work(), 'reviews-1-1', 'shadow'))).toBe(true);
    expect(JSON.parse(readFileSync(path.join(root, '.forge', 'shadow.json'), 'utf8')).remaining).toBe(1);
    // Preparing the same round again does not spend another brief.
    prep();
    expect(JSON.parse(readFileSync(path.join(root, '.forge', 'shadow.json'), 'utf8')).remaining).toBe(1);
  });

  it('round 2 after a verdict: correctness in delta with its findings, a passing security carried, the fix diff written', () => {
    prep();
    const r1 = path.join(work(), 'reviews-1-1');
    writeFileSync(path.join(r1, 'correctness.json'), JSON.stringify({ verdict: 'fail', confidence: 0.8, findings: [{ severity: 'important', file: 'a.txt', line: 2, problem: 'p' }, { severity: 'minor', problem: 'm' }] }));
    writeFileSync(path.join(r1, 'security.json'), JSON.stringify({ verdict: 'pass', confidence: 0.9, findings: [] }));
    appendEvent(root, { ts: '2026-10-14T10:05:00.000Z', kind: 'verdict', task: 'T1-1', dir: '.forge/work/T1/reviews-1-1', action: 'fix', score: 0.6, signature: 'x' });
    writeFileSync(path.join(wt, 'a.txt'), 'one\ntwo\nthree\n');
    git('commit', '-q', '-am', 'fix');
    const out = JSON.parse(prep().stdout);
    expect(out.round).toBe(2);
    expect(out.spawn.map((s: { role: string; mode: string }) => [s.role, s.mode])).toEqual([['review-correctness', 'delta']]);
    expect(out.spawn[0].inputs).toMatchObject({ fix: '.forge/work/T1/fix-1-2.patch', findings: '.forge/work/T1/reviews-1-2/previous-correctness.json' });
    expect(out.carried).toEqual(['security']);
    const r2 = path.join(work(), 'reviews-1-2');
    expect(readFileSync(path.join(work(), 'fix-1-2.patch'), 'utf8')).toContain('+three');
    expect(JSON.parse(readFileSync(path.join(r2, 'previous-correctness.json'), 'utf8'))).toHaveLength(1);
    expect(JSON.parse(readFileSync(path.join(r2, 'security.json'), 'utf8'))).toMatchObject({ verdict: 'pass', carried: true });
  });

  it('with the shadow test open, a brief whose reviewers are all at xhigh gets no twin and spends no brief', () => {
    appendEvent(root, { ts: '2026-10-14T09:30:00.000Z', kind: 'triage', task: 'T1', path: 'medium', sensitive: ['auth'],
      review: { ...review, reviewers: review.reviewers.map(r => ({ ...r, effort: 'xhigh' })) } });
    mkdirSync(path.join(root, '.forge'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'shadow.json'), JSON.stringify({ remaining: 2, cases: [] }));
    const out = JSON.parse(prep().stdout);
    expect(out.spawn.filter((s: { twin?: boolean }) => s.twin)).toEqual([]);
    expect(JSON.parse(readFileSync(path.join(root, '.forge', 'shadow.json'), 'utf8')).remaining).toBe(2);
    expect(JSON.parse(readFileSync(path.join(work(), 'reviews-1-1', 'review-plan.json'), 'utf8')).shadow).toBe(false);
  });

  it('round 2: a fenced carried file is copied from its parsed result, and an unusable head.txt falls back to the base', () => {
    prep();
    const r1 = path.join(work(), 'reviews-1-1');
    writeFileSync(path.join(r1, 'head.txt'), 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n');
    writeFileSync(path.join(r1, 'correctness.json'), JSON.stringify({ verdict: 'fail', confidence: 0.8, findings: [{ severity: 'important', file: 'a.txt', line: 2, problem: 'p' }] }));
    writeFileSync(path.join(r1, 'security.json'), '```json\n{"verdict":"pass","confidence":0.9,"findings":[]}\n```\n');
    appendEvent(root, { ts: '2026-10-14T10:05:00.000Z', kind: 'verdict', task: 'T1-1', dir: '.forge/work/T1/reviews-1-1', action: 'fix', score: 0.6, signature: 'x' });
    const r = prep();
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).carried).toEqual(['security']);
    expect(JSON.parse(readFileSync(path.join(work(), 'reviews-1-2', 'security.json'), 'utf8'))).toEqual({ verdict: 'pass', confidence: 0.9, findings: [], carried: true });
    expect(readFileSync(path.join(work(), 'fix-1-2.patch'), 'utf8')).toContain('+two');
  });

  it('round 2: a passing security that was a draft or invalid repeats instead of being carried', () => {
    const cases: [string, Record<string, unknown> | string, string][] = [
      ['draft', { verdict: 'pass', confidence: 0.9, findings: [], complete: false }, 'delta'],
      ['dropped', { verdict: 'pass', confidence: 0.9, findings: [{ severity: 'minor', file: 'a.txt', line: 1, problem: 'm' }, { nonsense: true }] }, 'delta'],
      ['unusable', 'the reviewer ran out of time {not json', 'full'],
      ['complete', { verdict: 'pass', confidence: 0.9, findings: [] }, 'carried'],
    ];
    prep();
    const r1 = path.join(work(), 'reviews-1-1');
    writeFileSync(path.join(r1, 'correctness.json'), JSON.stringify({ verdict: 'fail', confidence: 0.8, findings: [{ severity: 'important', file: 'a.txt', line: 2, problem: 'p' }] }));
    appendEvent(root, { ts: '2026-10-14T10:05:00.000Z', kind: 'verdict', task: 'T1-1', dir: '.forge/work/T1/reviews-1-1', action: 'fix', score: 0.6, signature: 'x' });
    for (const [label, security, expected] of cases) {
      writeFileSync(path.join(r1, 'security.json'), typeof security === 'string' ? security : JSON.stringify(security));
      rmSync(path.join(work(), 'reviews-1-2'), { recursive: true, force: true });
      const out = JSON.parse(prep().stdout);
      const sec = out.spawn.find((s: { role: string }) => s.role === 'review-security');
      if (expected === 'carried') {
        expect(out.carried, label).toEqual(['security']);
        expect(sec, label).toBeUndefined();
      } else {
        expect(out.carried, label).toBeUndefined();
        expect(sec?.mode, label).toBe(expected);
        expect(existsSync(path.join(work(), 'reviews-1-2', 'security.json')), label).toBe(false);
        if (expected === 'delta') expect(sec.inputs.findings, label).toBe('.forge/work/T1/reviews-1-2/previous-security.json');
        else expect(sec.inputs.findings, label).toBeUndefined();
      }
    }
  });

  it('round 2 after a redo: every reviewer in full mode, nothing carried', () => {
    prep();
    const r1 = path.join(work(), 'reviews-1-1');
    writeFileSync(path.join(r1, 'correctness.json'), JSON.stringify({ verdict: 'fail', confidence: 0.9, findings: [], approach: 'wrong' }));
    writeFileSync(path.join(r1, 'security.json'), JSON.stringify({ verdict: 'pass', confidence: 0.9, findings: [] }));
    appendEvent(root, { ts: '2026-10-14T10:05:00.000Z', kind: 'verdict', task: 'T1-1', dir: '.forge/work/T1/reviews-1-1', action: 'redo', score: 0.3, signature: 'x' });
    const out = JSON.parse(prep().stdout);
    expect(out.round).toBe(2);
    expect(out.spawn.map((s: { role: string; mode: string }) => [s.role, s.mode])).toEqual([['review-correctness', 'full'], ['review-security', 'full']]);
    expect(out.carried).toBeUndefined();
  });

  it('without a triage review it is a usage error', () => {
    const fresh = mkdtempSync(path.join(tmpdir(), 'forge-review-'));
    const r = run(['review-prep', '--task', 'T1-1', '--path', 'medium', '--base', base, '--baseline', path.join(work(), 'baseline-1.json'), '--dir', 'w', '--cwd', wt], { ...io, cwd: fresh });
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/triage/);
  });

  it("a Medium brief run as a loose task (<id>-<n>) falls back to the parent id's triage", () => {
    // The loose task T1-2's brief 1: its own id has no triage; the Medium task T1 has one.
    const loose = path.join(root, '.forge', 'work', 'T1-2');
    mkdirSync(loose, { recursive: true });
    writeFileSync(path.join(loose, 'brief-1.md'), '# T1-2\n');
    const r = run(['review-prep', '--task', 'T1-2-1', '--path', 'medium', '--base', base, '--baseline', '.forge/work/T1/baseline-1.json',
      '--dir', '.forge/work/T1-2', '--cwd', wt], io);
    expect(r.stderr).toBe('');
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.spawn.map((s: { agent: string; effort: string }) => [s.agent, s.effort])).toEqual([['forge-review-correctness', 'xhigh'], ['forge-review-security', 'high']]);
    expect(JSON.parse(readFileSync(path.join(loose, 'reviews-1-1', 'review-plan.json'), 'utf8')).flags).toEqual(['--sensitive']);
    // A triage of the loose task itself wins over the parent's.
    appendEvent(root, { ts: '2026-10-14T09:40:00.000Z', kind: 'triage', task: 'T1-2', path: 'medium', sensitive: [],
      review: { light: false, flags: [], reviewers: [{ role: 'review-correctness', model: null, effort: 'high', agent: 'forge-review-correctness' }] } });
    rmSync(path.join(loose, 'reviews-1-1'), { recursive: true, force: true });
    const own = JSON.parse(run(['review-prep', '--task', 'T1-2-1', '--path', 'medium', '--base', base, '--baseline', '.forge/work/T1/baseline-1.json',
      '--dir', '.forge/work/T1-2', '--cwd', wt], io).stdout);
    expect(own.spawn.map((s: { agent: string; effort: string }) => [s.agent, s.effort])).toEqual([['forge-review-correctness', 'high']]);
  });

  it('the parent fallback reads only the parent id, not a sibling brief', () => {
    const fresh = mkdtempSync(path.join(tmpdir(), 'forge-review-'));
    appendEvent(fresh, { ts: '2026-10-14T09:00:00.000Z', kind: 'triage', task: 'T1-3', path: 'medium', sensitive: [], review });
    const r = run(['review-prep', '--task', 'T1-2-1', '--path', 'medium', '--base', base, '--baseline', path.join(work(), 'baseline-1.json'), '--dir', 'w', '--cwd', wt], { ...io, cwd: fresh });
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/triage/);
  });

  it('requires its flags', () => {
    expect(run(['review-prep', '--task', 'T1-1'], io).code).toBe(2);
    expect(run(['review-prep', '--task', 'T1', '--path', 'medium', '--base', base, '--baseline', 'b', '--dir', 'd'], io).code).toBe(2);
  });

  it('round 2: each delta reviewer receives only its own blocking findings', () => {
    prep();
    const r1 = path.join(work(), 'reviews-1-1');
    writeFileSync(path.join(r1, 'correctness.json'), JSON.stringify({ verdict: 'fail', confidence: 0.8, findings: [{ severity: 'important', file: 'a.txt', line: 2, problem: 'c-problem' }] }));
    writeFileSync(path.join(r1, 'security.json'), JSON.stringify({ verdict: 'fail', confidence: 0.8, findings: [{ severity: 'critical', file: 'a.txt', line: 1, problem: 's-problem' }, { severity: 'minor', problem: 's-minor' }] }));
    appendEvent(root, { ts: '2026-10-14T10:05:00.000Z', kind: 'verdict', task: 'T1-1', dir: '.forge/work/T1/reviews-1-1', action: 'fix', score: 0.6, signature: 'x' });
    writeFileSync(path.join(wt, 'a.txt'), 'one\ntwo\nthree\n');
    git('commit', '-q', '-am', 'fix');
    const out = JSON.parse(prep().stdout);
    expect(out.spawn.map((s: { role: string; mode: string }) => [s.role, s.mode])).toEqual([['review-correctness', 'delta'], ['review-security', 'delta']]);
    const own = (i: number) => JSON.parse(readFileSync(path.join(root, out.spawn[i].inputs.findings), 'utf8')).map((f: { problem: string }) => f.problem);
    expect(own(0)).toEqual(['c-problem']);
    expect(own(1)).toEqual(['s-problem']);
    for (const s of out.spawn) expect(s.inputs).toMatchObject({ brief: '.forge/work/T1/brief-1.md', diff: '.forge/work/T1/diff-1.patch', fix: '.forge/work/T1/fix-1-2.patch' });
  });

  it('with `generated`, a matching file the validators regenerated is put back and listed in restored', () => {
    withGenerated();
    const r = prep();
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).restored).toEqual(['gen.txt']);
    expect(git('status', '--porcelain', '--', 'gen.txt')).toBe('');
  });

  it('without `generated`, nothing is restored and restored is left out', () => {
    withGenerated('');
    const r = prep();
    expect(JSON.parse(r.stdout)).not.toHaveProperty('restored');
    expect(git('status', '--porcelain', '--', 'gen.txt')).toBe('M gen.txt');
  });

  it('review-close, prep and shadow are dispatched', () => {
    expect(run(['review-close'], io).code).toBe(2);
    expect(run(['review-close'], io).stderr).toMatch(/review-close/);
  });

});

describe('forge prep', () => {
  const head = () => git('rev-parse', 'HEAD');

  it('prints validate, the exact command the implementer runs: the related tests since BASE, in the worktree (J-11)', () => {
    const self = path.join(root, 'plugin dir', 'dist', 'forge.cjs');
    const out = JSON.parse(run(['prep', '--task', 'T1-1', '--path', 'medium', '--cwd', wt], { ...io, scriptPath: self }).stdout);
    const slash = (p: string) => path.resolve(p).split(path.sep).join('/');
    expect(out.validate).toBe(`node "${slash(self)}" validate --affected --base ${head()} --task T1-1 --cwd "${slash(wt)}"`);
  });

  it('writes baseline-<n>.json, logs the phase with the brief and the base, and prints the worktree HEAD', () => {
    rmSync(path.join(work(), 'baseline-1.json'));
    const r = run(['prep', '--task', 'T1-1', '--path', 'medium', '--cwd', wt], io);
    expect(r.stderr).toBe('');
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.base).toBe(head());
    expect(out.baseline).toBe('.forge/work/T1/baseline-1.json');
    const baseline = JSON.parse(readFileSync(path.join(work(), 'baseline-1.json'), 'utf8'));
    expect(baseline.map((v: { validator: string; ok: boolean }) => [v.validator, v.ok])).toEqual([['check', true]]);
    const events = readEvents(root);
    const phase = events.filter(e => e.kind === 'phase').at(-1)!;
    expect(phase).toMatchObject({ task: 'T1', phase: 'implement', brief: 1, base: head() });
    expect(events.some(e => e.kind === 'validate' && e.task === 'T1-1' && e.baseline === true)).toBe(true);
  });

  it('a failing validator on the base is recorded in the baseline and prep still exits 0; --phase and --dir are honoured', () => {
    writeFileSync(path.join(wt, '.forge', 'config.yaml'), 'detect: false\nvalidators:\n  - name: check\n    cmd: node -e "process.exit(1)"\n');
    const r = run(['prep', '--task', 'T1-2', '--path', 'large', '--phase', 'review', '--dir', 'w/x', '--cwd', wt], io);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ base: head(), baseline: 'w/x/baseline-2.json', failing: ['check'] });
    const baseline = JSON.parse(readFileSync(path.join(root, 'w', 'x', 'baseline-2.json'), 'utf8'));
    expect(baseline[0]).toMatchObject({ validator: 'check', ok: false });
    expect(readEvents(root).filter(e => e.kind === 'phase').at(-1)).toMatchObject({ task: 'T1', phase: 'review', brief: 2, base: head() });
  });

  it('the baseline then excuses that failure in review-prep', () => {
    writeFileSync(path.join(wt, '.forge', 'config.yaml'), 'detect: false\nvalidators:\n  - name: check\n    cmd: node -e "process.exit(1)"\n');
    const b = JSON.parse(run(['prep', '--task', 'T1-1', '--path', 'medium', '--cwd', wt], io).stdout).base;
    const out = JSON.parse(run(['review-prep', '--task', 'T1-1', '--path', 'medium', '--base', b, '--baseline', '.forge/work/T1/baseline-1.json',
      '--dir', '.forge/work/T1', '--cwd', wt], io).stdout);
    expect(out.validators).toMatchObject({ ok: true, preexisting: ['check'] });
  });

  it('with `generated`, the baseline run puts back a matching file the validators regenerated and lists it in restored', () => {
    withGenerated();
    const out = JSON.parse(run(['prep', '--task', 'T1-1', '--path', 'medium', '--cwd', wt], io).stdout);
    expect(out).toMatchObject({ base: head(), failing: [], restored: ['gen.txt'] });
    expect(git('status', '--porcelain', '--', 'gen.txt')).toBe('');
    withGenerated('validate:\n  cache: false\n'); // the same command on the same tree would come from the cache
    const bare = JSON.parse(run(['prep', '--task', 'T1-1', '--path', 'medium', '--cwd', wt], io).stdout);
    expect(bare).not.toHaveProperty('restored');
    expect(git('status', '--porcelain', '--', 'gen.txt')).toBe('M gen.txt');
  });

  it('requires --task <id>-<n> and a known --path', () => {
    for (const a of [['prep'], ['prep', '--task', 'T1-1'], ['prep', '--task', 'T1', '--path', 'medium'], ['prep', '--task', 'T1-1', '--path', 'huge']]) {
      const r = run([...a, '--cwd', wt], io);
      expect(r.code).toBe(2);
      expect(r.stderr).toContain('prep');
    }
  });
  it('with a threat model in the config, prep writes threat-model.md and prints its path; review-prep hands it to security only (K4-02)', () => {
    writeFileSync(path.join(wt, '.forge', 'config.yaml'), 'threatModel:\n  protects: ["files outside the repository"]\ndetect: false\nvalidators:\n  - name: check\n    cmd: node -e "process.exit(0)"\n');
    const p = JSON.parse(run(['prep', '--task', 'T1-1', '--path', 'medium', '--cwd', wt], io).stdout);
    expect(p.threatModel).toBe('.forge/work/T1/threat-model.md');
    expect(readFileSync(path.join(work(), 'threat-model.md'), 'utf8')).toBe('## Threat model\n\n- Protects: files outside the repository\n');
    const out = JSON.parse(run(['review-prep', '--task', 'T1-1', '--path', 'medium', '--base', p.base, '--baseline', '.forge/work/T1/baseline-1.json', '--dir', '.forge/work/T1', '--cwd', wt], io).stdout);
    expect(out.spawn.find((s: { role: string }) => s.role === 'review-security').inputs.threatModel).toBe('.forge/work/T1/threat-model.md');
    expect(out.spawn.find((s: { role: string }) => s.role === 'review-correctness').inputs.threatModel).toBeUndefined();
  });
  it('without a threat model prep prints threatModel null and leaves no threat-model.md, also with --no-baseline', () => {
    writeFileSync(path.join(work(), 'threat-model.md'), 'stale\n');
    expect(JSON.parse(run(['prep', '--task', 'T1-1', '--path', 'medium', '--cwd', wt], io).stdout).threatModel).toBeNull();
    expect(existsSync(path.join(work(), 'threat-model.md'))).toBe(false);
    expect(JSON.parse(run(['prep', '--task', 'T1-1', '--path', 'small', '--no-baseline', '--cwd', wt], io).stdout).threatModel).toBeNull();
  });
});

describe('forge review-close', () => {
  const close = (...extra: string[]) => run(['review-close', '--task', 'T1-1', '--dir', '.forge/work/T1', '--path', 'medium', '--cwd', wt, ...extra], io);
  const r1 = () => path.join(work(), 'reviews-1-1');
  const r2 = () => path.join(work(), 'reviews-1-2');
  const write = (dir: string, name: string, v: unknown) => writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(v));
  // A review 2 with one or two important findings left (green validators, none from security) is an express one by default
  // (measure 7): the tests of the normal review 2 turn it off.
  const noExpress = () => writeFileSync(path.join(wt, '.forge', 'config.yaml'),
    'review:\n  express: false\ndetect: false\nvalidators:\n  - name: check\n    cmd: node -e "process.exit(0)"\n');

  it('a reviewer that left no file: code 3 with missing, no verdict logged', () => {
    prep();
    write(r1(), 'correctness', { verdict: 'pass', confidence: 0.9, findings: [] });
    const r = close();
    expect(r.code).toBe(3);
    expect(JSON.parse(r.stdout).missing).toEqual(['.forge/work/T1/reviews-1-1/security.json']);
    expect(readEvents(root).some(e => e.kind === 'verdict')).toBe(false);
  });

  it('a fix writes the findings for the implementer and prints implementer and last', () => {
    writeFileSync(path.join(wt, '.forge', 'config.yaml'), 'detect: false\nvalidators:\n  - name: check\n    cmd: node -e "console.log(\'boom\');process.exit(1)"\n');
    for (let i = 0; i < 3; i++) prep(); // two validators rounds first (C-08), then the review
    write(r1(), 'correctness', { verdict: 'fail', confidence: 0.8, findings: [{ severity: 'important', file: 'a.txt', line: 2, problem: 'wrong two' }, { severity: 'minor', file: 'a.txt', problem: 'style' }] });
    write(r1(), 'security', { verdict: 'pass', confidence: 0.9, findings: [] });
    const r = close();
    expect(r.stderr).toBe('');
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out).toMatchObject({ action: 'fix', next: 'resume', last: false, findings: '.forge/work/T1/findings-1-1.json', deferred: [], invalid: [], incomplete: [] });
    expect(typeof out.score).toBe('number');
    expect(out.implementer).toMatchObject({ role: expect.any(String), agent: expect.any(String) });
    const findings = JSON.parse(readFileSync(path.join(work(), 'findings-1-1.json'), 'utf8'));
    expect(findings.findings.map((f: { problem: string }) => f.problem)).toEqual(['wrong two']);
    expect(findings.validators.map((v: { validator: string }) => v.validator)).toEqual(['check']);
    const events = readEvents(root);
    // The verdict ran with review-plan.json's flags and is logged on the round's dir, so FORGE round counts it.
    expect(events.find(e => e.kind === 'verdict')).toMatchObject({ task: 'T1-1', dir: '.forge/work/T1/reviews-1-1', action: 'fix' });
    expect(events.find(e => e.kind === 'round')).toMatchObject({ task: 'T1-1', next: 'resume' });
    expect(events.find(e => e.kind === 'ruling')).toMatchObject({ task: 'T1-1', minor: [{ problem: 'style' }] });
  });

  it('a reviewer whose file is a draft (complete: false) is listed in incomplete and still counts as written', () => {
    prep();
    write(r1(), 'correctness', { verdict: 'fail', confidence: 0.8, findings: [{ severity: 'important', file: 'a.txt', line: 2, problem: 'wrong two' }], complete: false });
    write(r1(), 'security', { verdict: 'pass', confidence: 0.9, findings: [], complete: true });
    const r = close();
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ action: 'fix', invalid: [], incomplete: ['correctness'] });
  });

  it('round 2: an accept with a deferred finding logs the ruling; the carried security counts as before', () => {
    noExpress();
    prep();
    write(r1(), 'correctness', { verdict: 'fail', confidence: 0.8, findings: [{ severity: 'important', file: 'a.txt', line: 2, problem: 'wrong two' }] });
    write(r1(), 'security', { verdict: 'pass', confidence: 0.9, findings: [] });
    expect(JSON.parse(close().stdout).action).toBe('fix');
    writeFileSync(path.join(wt, 'a.txt'), 'one\ntwo fixed\n');
    git('commit', '-q', '-am', 'fix');
    const p2 = JSON.parse(prep().stdout);
    expect(p2.round).toBe(2);
    expect(p2.carried).toEqual(['security']);
    write(r2(), 'correctness', { verdict: 'fail', confidence: 0.8, findings: [{ severity: 'important', file: path.join(wt, 'b.txt'), line: 25, problem: 'old smell', origin: 'untouched' }] });
    const r = close();
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out).toMatchObject({ action: 'accept', next: 'done', implementer: null, findings: null });
    expect(out.deferred.map((f: { problem: string }) => f.problem)).toEqual(['old smell']);
    expect(existsSync(path.join(work(), 'findings-1-2.json'))).toBe(false);
    const ruling = readEvents(root).filter(e => e.kind === 'ruling').at(-1);
    expect(ruling).toMatchObject({ task: 'T1-1', round: 2, deferred: [{ problem: 'old smell' }] });
  });

  it('round 2: an untouched finding given as an absolute path inside the fix diff is fix and blocks', () => {
    noExpress();
    prep();
    write(r1(), 'correctness', { verdict: 'fail', confidence: 0.8, findings: [{ severity: 'important', file: 'b.txt', line: 25, problem: 'old smell in the loop' }] });
    write(r1(), 'security', { verdict: 'pass', confidence: 0.9, findings: [] });
    close();
    writeFileSync(path.join(wt, 'a.txt'), 'one\ntwo fixed\n');
    git('commit', '-q', '-am', 'fix');
    prep();
    write(r2(), 'correctness', { verdict: 'fail', confidence: 0.8, findings: [{ severity: 'important', file: path.join(wt, 'a.txt'), line: 2, problem: 'still wrong', origin: 'untouched' }] });
    const out = JSON.parse(close().stdout);
    expect(out.action).toBe('fix');
    expect(out.deferred).toEqual([]);
    expect(JSON.parse(readFileSync(path.join(work(), 'findings-1-2.json'), 'utf8')).findings[0]).toMatchObject({ problem: 'still wrong', origin: 'fix', file: 'a.txt', id: 'F2' });
  });

  it('closing the same round again uses the same round and dir', () => {
    prep();
    write(r1(), 'correctness', { verdict: 'pass', confidence: 0.9, findings: [] });
    write(r1(), 'security', { verdict: 'pass', confidence: 0.9, findings: [] });
    expect(JSON.parse(close().stdout).action).toBe('accept');
    const again = JSON.parse(close().stdout);
    expect(again).toMatchObject({ action: 'accept', round: 1 });
    expect(new Set(readEvents(root).filter(e => e.kind === 'verdict').map(e => e.dir))).toEqual(new Set(['.forge/work/T1/reviews-1-1']));
  });

  it('with the shadow test open: the twin does not change the verdict, the case is saved once, round 2 has no twin', () => {
    mkdirSync(path.join(root, '.forge'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'shadow.json'), JSON.stringify({ remaining: 2, cases: [] }));
    const p1 = JSON.parse(prep().stdout);
    expect(p1.spawn.filter((s: { twin?: boolean }) => s.twin).map((s: { role: string; effort: string; inputs: { out: string } }) => [s.role, s.effort, s.inputs.out]))
      .toEqual([['review-security', 'xhigh', '.forge/work/T1/reviews-1-1/shadow']]);
    write(r1(), 'correctness', { verdict: 'fail', confidence: 0.8, findings: [{ severity: 'important', file: 'a.txt', line: 2, problem: 'wrong two' }, { severity: 'minor', problem: 'style' }] });
    write(r1(), 'security', { verdict: 'pass', confidence: 0.9, findings: [{ severity: 'important', file: 'a.txt', line: 1, problem: 'token logged in plain text' }] });
    // Without the twin's file the round still closes; no case is saved.
    const without = close();
    expect(without.code).toBe(0);
    const a = JSON.parse(without.stdout);
    expect(JSON.parse(readFileSync(path.join(root, '.forge', 'shadow.json'), 'utf8')).cases).toEqual([]);
    // With the twin's file (a critical high missed and the same token finding), the verdict is the same.
    write(path.join(r1(), 'shadow'), 'security', { verdict: 'fail', confidence: 0.9, findings: [
      { severity: 'critical', file: 'b.txt', line: 20, problem: 'path traversal in upload' },
      { severity: 'important', file: 'a.txt', line: 2, problem: 'token logged in plain text' },
    ] });
    const b = JSON.parse(close().stdout);
    expect({ action: b.action, score: b.score, findings: b.findings }).toEqual({ action: a.action, score: a.score, findings: a.findings });
    expect(b.shadow).toEqual(['security']);
    const findings = JSON.parse(readFileSync(path.join(work(), 'findings-1-1.json'), 'utf8')).findings.map((f: { problem: string }) => f.problem);
    expect(findings).toEqual(['wrong two', 'token logged in plain text']);
    const cases = () => JSON.parse(readFileSync(path.join(root, '.forge', 'shadow.json'), 'utf8')).cases;
    expect(cases()).toHaveLength(1);
    expect(cases()[0]).toMatchObject({ task: 'T1-1', reviewer: 'security', recovered: [{ problem: 'token logged in plain text' }],
      missedCritical: [{ problem: 'path traversal in upload' }], highOnly: [] });
    // Closing the same round again replaces the case and does not log the ruling twice.
    close();
    expect(cases()).toHaveLength(1);
    expect(readEvents(root).filter(e => e.kind === 'ruling')).toHaveLength(1);

    writeFileSync(path.join(wt, 'a.txt'), 'one\ntwo fixed\n');
    git('commit', '-q', '-am', 'fix');
    const p2 = JSON.parse(prep().stdout);
    expect(p2.round).toBe(2);
    expect(p2.spawn.filter((s: { twin?: boolean }) => s.twin)).toEqual([]);
    expect(JSON.parse(readFileSync(path.join(root, '.forge', 'shadow.json'), 'utf8')).remaining).toBe(1);
  });

  it('review-close does not wait for a twin: one still out is listed in shadowPending, and shadow collect saves it when it is back (C-11)', () => {
    mkdirSync(path.join(root, '.forge'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'shadow.json'), JSON.stringify({ remaining: 2, cases: [] }));
    prep();
    write(r1(), 'correctness', { verdict: 'pass', confidence: 0.9, findings: [] });
    write(r1(), 'security', { verdict: 'pass', confidence: 0.9, findings: [] });
    const out = JSON.parse(close().stdout);
    expect(out.action).toBe('accept');
    expect(out.shadow).toBeUndefined();
    expect(out.shadowSkipped).toBeUndefined();
    expect(out.shadowPending).toEqual([{ reviewer: 'security', file: '.forge/work/T1/reviews-1-1/shadow/security.json' }]);
    expect(JSON.parse(readFileSync(path.join(root, '.forge', 'shadow.json'), 'utf8')).cases).toEqual([]);
    write(path.join(r1(), 'shadow'), 'security', { verdict: 'fail', confidence: 0.9, findings: [{ severity: 'critical', file: 'a.txt', line: 1, problem: 'path traversal' }] });
    const late = run(['shadow', 'collect', '--task', 'T1-1', '--dir', '.forge/work/T1/reviews-1-1'], io);
    expect(late.code).toBe(0);
    expect(JSON.parse(late.stdout)).toEqual({ shadow: ['security'], shadowSkipped: [], shadowPending: [] });
    expect(JSON.parse(readFileSync(path.join(root, '.forge', 'shadow.json'), 'utf8')).cases)
      .toEqual([expect.objectContaining({ task: 'T1-1', reviewer: 'security', missedCritical: [expect.objectContaining({ problem: 'path traversal' })] })]);
  });

  it('an unparseable twin or high review saves no case and review-close says so', () => {
    mkdirSync(path.join(root, '.forge'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'shadow.json'), JSON.stringify({ remaining: 2, cases: [] }));
    prep();
    write(r1(), 'correctness', { verdict: 'pass', confidence: 0.9, findings: [] });
    write(r1(), 'security', { verdict: 'pass', confidence: 0.9, findings: [] });
    writeFileSync(path.join(r1(), 'shadow', 'security.json'), 'the twin ran out of time {not json');
    const cases = () => JSON.parse(readFileSync(path.join(root, '.forge', 'shadow.json'), 'utf8')).cases;
    const a = JSON.parse(close().stdout);
    expect(a.shadow).toBeUndefined();
    expect(a.shadowSkipped).toEqual([{ reviewer: 'security', reason: 'unparseable', file: '.forge/work/T1/reviews-1-1/shadow/security.json' }]);
    expect(cases()).toEqual([]);
    // A readable twin but an unparseable high review: still no case.
    write(path.join(r1(), 'shadow'), 'security', { verdict: 'fail', confidence: 0.9, findings: [{ severity: 'critical', problem: 'path traversal' }] });
    writeFileSync(path.join(r1(), 'security.json'), 'garbage');
    const b = JSON.parse(close().stdout);
    expect(b.shadow).toBeUndefined();
    expect(b.shadowSkipped).toEqual([{ reviewer: 'security', reason: 'unparseable', file: '.forge/work/T1/reviews-1-1/security.json' }]);
    expect(cases()).toEqual([]);
  });

  it('a draft twin or high review saves no case and is listed as incomplete', () => {
    mkdirSync(path.join(root, '.forge'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'shadow.json'), JSON.stringify({ remaining: 2, cases: [] }));
    prep();
    write(r1(), 'correctness', { verdict: 'pass', confidence: 0.9, findings: [] });
    write(r1(), 'security', { verdict: 'pass', confidence: 0.9, findings: [] });
    write(path.join(r1(), 'shadow'), 'security', { verdict: 'fail', confidence: 0.5, findings: [{ severity: 'critical', problem: 'half read' }], complete: false });
    const cases = () => JSON.parse(readFileSync(path.join(root, '.forge', 'shadow.json'), 'utf8')).cases;
    const a = JSON.parse(close().stdout);
    expect(a.shadow).toBeUndefined();
    expect(a.shadowSkipped).toEqual([{ reviewer: 'security', reason: 'incomplete', file: '.forge/work/T1/reviews-1-1/shadow/security.json' }]);
    expect(cases()).toEqual([]);
    write(path.join(r1(), 'shadow'), 'security', { verdict: 'fail', confidence: 0.9, findings: [{ severity: 'critical', problem: 'path traversal' }] });
    write(r1(), 'security', { verdict: 'pass', confidence: 0.9, findings: [], complete: false });
    const b = JSON.parse(close().stdout);
    expect(b.shadow).toBeUndefined();
    expect(b.shadowSkipped).toEqual([{ reviewer: 'security', reason: 'incomplete', file: '.forge/work/T1/reviews-1-1/security.json' }]);
    expect(cases()).toEqual([]);
  });

  it('closing a round again with an accept removes the findings file the earlier fix left', () => {
    prep();
    write(r1(), 'correctness', { verdict: 'fail', confidence: 0.8, findings: [{ severity: 'important', file: 'a.txt', line: 2, problem: 'wrong two' }] });
    write(r1(), 'security', { verdict: 'pass', confidence: 0.9, findings: [] });
    expect(JSON.parse(close().stdout).action).toBe('fix');
    expect(existsSync(path.join(work(), 'findings-1-1.json'))).toBe(true);
    write(r1(), 'correctness', { verdict: 'pass', confidence: 0.9, findings: [] });
    expect(JSON.parse(close().stdout)).toMatchObject({ action: 'accept', findings: null });
    expect(existsSync(path.join(work(), 'findings-1-1.json'))).toBe(false);
  });

  it.skipIf(process.platform !== 'win32')('round 2: a Git Bash style /c/... finding path is made repo-relative', () => {
    noExpress();
    prep();
    write(r1(), 'correctness', { verdict: 'fail', confidence: 0.8, findings: [{ severity: 'important', file: 'b.txt', line: 25, problem: 'old smell in the loop' }] });
    write(r1(), 'security', { verdict: 'pass', confidence: 0.9, findings: [] });
    close();
    writeFileSync(path.join(wt, 'a.txt'), 'one\ntwo fixed\n');
    git('commit', '-q', '-am', 'fix');
    prep();
    const bash = '/' + wt[0].toLowerCase() + wt.slice(2).replace(/\\/g, '/') + '/a.txt';
    write(r2(), 'correctness', { verdict: 'fail', confidence: 0.8, findings: [{ severity: 'important', file: bash, line: 2, problem: 'still wrong', origin: 'untouched' }] });
    const out = JSON.parse(close().stdout);
    expect(out.action).toBe('fix');
    expect(out.deferred).toEqual([]);
  });

  it('logs the phases of a brief in order, with its brief, round and reviewers, the verdict phase before the verdict (E-03, C4)', () => {
    run(['prep', '--task', 'T1-1', '--path', 'medium', '--cwd', wt], io);
    prep();
    write(r1(), 'correctness', { verdict: 'fail', confidence: 0.8, findings: [{ severity: 'important', file: 'a.txt', line: 2, problem: 'wrong two' }] });
    write(r1(), 'security', { verdict: 'pass', confidence: 0.9, findings: [] });
    expect(JSON.parse(close().stdout).action).toBe('fix');
    const events = readEvents(root);
    const phases = events.filter(e => e.kind === 'phase' && e.task === 'T1');
    expect(phases.map(e => [e.phase, e.brief, e.round ?? null])).toEqual([['implement', 1, null], ['validate', 1, 1], ['review', 1, 1], ['verdict', 1, 1], ['fix', 1, 1]]);
    expect(phases[2].reviewers).toEqual([
      { agent: 'forge-review-correctness', role: 'review-correctness', effort: 'xhigh', model: null, mode: 'full' },
      { agent: 'forge-review-security', role: 'review-security', effort: 'high', model: null, mode: 'full' },
    ]);
    const kinds = events.map(e => (e.kind === 'phase' ? `phase:${e.phase}` : e.kind));
    expect(kinds.indexOf('phase:verdict')).toBeLessThan(kinds.indexOf('verdict'));
  });
  it('an accept logs the verdict phase and no fix', () => {
    prep();
    write(r1(), 'correctness', { verdict: 'pass', confidence: 0.9, findings: [] });
    write(r1(), 'security', { verdict: 'pass', confidence: 0.9, findings: [] });
    expect(JSON.parse(close().stdout).action).toBe('accept');
    expect(readEvents(root).filter(e => e.kind === 'phase' && e.task === 'T1').map(e => e.phase)).toEqual(['validate', 'review', 'verdict']);
  });
  it('requires its flags and a prepared round', () => {
    expect(run(['review-close', '--task', 'T1-1', '--dir', '.forge/work/T1'], io).code).toBe(2);
    expect(run(['review-close', '--task', 'T1', '--dir', '.forge/work/T1', '--path', 'medium'], io).code).toBe(2);
    const r = close();
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/review-prep/);
  });

  it('review-prep and review-close count reviews n of max (4 on Medium, 5 on Large) in their output, the say and the verdict and round events (C-13)', () => {
    expect(JSON.parse(prep('--locale', 'en').stdout)).toMatchObject({ round: 1, reviews: { n: 1, max: 4 } });
    expect(JSON.parse(prep('--locale', 'en').stdout).say).toMatch(/^Review 1 of 4: /);
    expect(JSON.parse(prep('--locale', 'es').stdout).say).toMatch(/^Revisión 1 de 4: /);
    write(r1(), 'correctness', { verdict: 'fail', confidence: 0.8, findings: [{ severity: 'important', file: 'a.txt', line: 2, problem: 'wrong two' }] });
    write(r1(), 'security', { verdict: 'pass', confidence: 0.9, findings: [] });
    expect(JSON.parse(close().stdout).reviews).toEqual({ n: 1, max: 4 });
    const events = readEvents(root);
    expect(events.filter(e => e.kind === 'verdict').at(-1)!.reviews).toEqual({ n: 1, max: 4 });
    expect(events.filter(e => e.kind === 'round').at(-1)).toMatchObject({ reviews: { n: 1, max: 4 }, round: 1, cap: 3 });
    expect(JSON.parse(run(['review-close', '--task', 'T1-1', '--dir', '.forge/work/T1', '--path', 'large', '--cwd', wt], io).stdout).reviews).toEqual({ n: 1, max: 5 });
    expect(readEvents(root).filter(e => e.kind === 'round').at(-1)).toMatchObject({ reviews: { n: 1, max: 5 }, cap: 4 });
    expect(JSON.parse(close().stdout)).toMatchObject({ next: 'resume', handover: null, revert: null });
  });

  it('gives each critical and important finding a stable id: kept when the delta reviewer copies it, inherited by a reworded previous one, new otherwise (J-06)', () => {
    noExpress();
    prep();
    write(r1(), 'correctness', { verdict: 'fail', confidence: 0.8, findings: [
      { severity: 'important', file: 'a.txt', line: 2, problem: 'wrong two' },
      { severity: 'important', file: 'b.txt', line: 20, problem: 'loop never ends on empty input' },
      { severity: 'minor', file: 'a.txt', problem: 'style' }] });
    write(r1(), 'security', { verdict: 'pass', confidence: 0.9, findings: [] });
    expect(JSON.parse(close().stdout).action).toBe('fix');
    const index1 = JSON.parse(readFileSync(path.join(work(), 'findings-index-1.json'), 'utf8'));
    expect(index1.rounds[0].findings.map((f: { id: string; reviewer: string; status: string }) => [f.id, f.reviewer, f.status]))
      .toEqual([['F1', 'correctness', 'open'], ['F2', 'correctness', 'open']]);
    expect(JSON.parse(readFileSync(path.join(work(), 'findings-1-1.json'), 'utf8')).findings.map((f: { id: string }) => f.id)).toEqual(['F1', 'F2']);
    writeFileSync(path.join(wt, 'a.txt'), 'one\ntwo fixed\n');
    git('commit', '-q', '-am', 'fix');
    prep();
    expect(JSON.parse(readFileSync(path.join(r2(), 'previous-correctness.json'), 'utf8')).map((f: { id: string }) => f.id)).toEqual(['F1', 'F2']);
    write(r2(), 'correctness', { verdict: 'fail', confidence: 0.8, findings: [
      { severity: 'important', file: 'a.txt', line: 2, problem: 'still wrong', origin: 'previous', id: 'F1' },
      { severity: 'important', file: 'b.txt', line: 22, problem: 'the empty input case spins forever', origin: 'previous' },
      { severity: 'important', file: 'b.txt', line: 5, problem: 'new header parse bug', origin: 'fix' }] });
    expect(JSON.parse(close().stdout).action).toBe('fix');
    expect(JSON.parse(readFileSync(path.join(work(), 'findings-1-2.json'), 'utf8')).findings.map((f: { id: string }) => f.id)).toEqual(['F1', 'F2', 'F3']);
    const index2 = JSON.parse(readFileSync(path.join(work(), 'findings-index-1.json'), 'utf8'));
    expect(index2.rounds.map((r: { round: number }) => r.round)).toEqual([1, 2]);
  });

  it('the same blocking ids as the previous review, in other words and with another score, stall the loop (C-05)', () => {
    noExpress();
    prep();
    write(r1(), 'correctness', { verdict: 'fail', confidence: 0.8, findings: [{ severity: 'important', file: 'a.txt', line: 2, problem: 'wrong two' }] });
    write(r1(), 'security', { verdict: 'pass', confidence: 0.9, findings: [] });
    expect(JSON.parse(close().stdout).next).toBe('resume');
    writeFileSync(path.join(wt, 'a.txt'), 'one\ntwo again\n');
    git('commit', '-q', '-am', 'fix');
    prep();
    write(r2(), 'correctness', { verdict: 'fail', confidence: 0.6, findings: [{ severity: 'important', file: 'a.txt', line: 2, problem: 'the second line is still not right', origin: 'previous', id: 'F1' }] });
    expect(JSON.parse(close().stdout)).toMatchObject({ action: 'fix', next: 'stalled' });
    const verdicts = readEvents(root).filter(e => e.kind === 'verdict');
    expect(verdicts[1].signature).toBe(verdicts[0].signature);
    expect(verdicts[1].score).not.toBe(verdicts[0].score);
    expect(String(verdicts[1].signature)).toMatch(/^v2:/);
  });

  it('a new finding of the fix that matches one the same reviewer closes is hardening: residual, and the brief is accepted (C-04)', () => {
    noExpress();
    prep();
    write(r1(), 'correctness', { verdict: 'fail', confidence: 0.8, findings: [{ severity: 'important', file: 'a.txt', line: 2, problem: 'the second line is not validated' }] });
    write(r1(), 'security', { verdict: 'pass', confidence: 0.9, findings: [] });
    close();
    writeFileSync(path.join(wt, 'a.txt'), 'one\ntwo checked\n');
    git('commit', '-q', '-am', 'fix');
    prep();
    write(r2(), 'correctness', { verdict: 'fail', confidence: 0.8, findings: [{ severity: 'important', file: 'a.txt', line: 2, problem: 'the second line is not validated when it is empty', origin: 'fix' }] });
    const out = JSON.parse(close().stdout);
    expect(out).toMatchObject({ action: 'accept', next: 'done', ask: null });
    expect(out.deferred).toEqual([expect.objectContaining({ id: 'F2', reviewer: 'correctness', residual: 'hardening' })]);
    const index = JSON.parse(readFileSync(path.join(work(), 'findings-index-1.json'), 'utf8'));
    expect(index.rounds[1].findings.map((f: { id: string; status: string }) => [f.id, f.status])).toEqual([['F2', 'residual'], ['F1', 'closed']]);
  });

  it('security finding another variant of a closed one asks the person; --out-of-model closes the same review again with it as minor and keeps it (K4-02)', () => {
    prep();
    write(r1(), 'correctness', { verdict: 'pass', confidence: 0.9, findings: [] });
    write(r1(), 'security', { verdict: 'fail', confidence: 0.8, findings: [{ severity: 'important', file: 'a.txt', line: 2, problem: 'the path from the input is joined without a check' }] });
    expect(JSON.parse(close().stdout).action).toBe('fix');
    writeFileSync(path.join(wt, 'a.txt'), 'one\ntwo checked\n');
    git('commit', '-q', '-am', 'fix');
    prep();
    write(r2(), 'correctness', { verdict: 'pass', confidence: 0.9, findings: [] });
    write(r2(), 'security', { verdict: 'fail', confidence: 0.8, findings: [{ severity: 'important', file: 'a.txt', line: 2, problem: 'the path from the input is joined without a check for 8.3 short names', origin: 'fix' }] });
    const asked = JSON.parse(close('--locale', 'es').stdout);
    expect(asked.action).toBe('fix');
    expect(asked.ask).toMatchObject({ kind: 'repeat-theme', findings: [{ id: 'F2', severity: 'important', file: 'a.txt', line: 2, earlier: { id: 'F1', round: 1 } }] });
    expect(asked.ask.question).toContain('F1 → F2');
    expect(asked.ask.options.map((o: { option: string }) => o.option)).toEqual(['fix', 'out-of-model']);
    expect(readEvents(root).filter(e => e.kind === 'verdict').at(-1)).toMatchObject({ ask: 1 });
    const ruled = JSON.parse(close('--out-of-model', 'F2').stdout);
    expect(ruled).toMatchObject({ action: 'accept', next: 'done', ask: null });
    expect(JSON.parse(readFileSync(path.join(r2(), 'overrides.json'), 'utf8'))).toEqual({ outOfModel: ['F2'], defer: [] });
    // Closing again without the flag still honours it, and logs the ruling once.
    expect(JSON.parse(close().stdout).action).toBe('accept');
    const rulings = readEvents(root).filter(e => e.kind === 'ruling');
    expect(rulings).toHaveLength(1);
    expect(rulings[0].minor).toEqual([expect.objectContaining({ id: 'F2', severity: 'minor', declared: 'important', outOfModel: true, residual: 'out-of-model' })]);
    expect(close('--out-of-model', 'nope').code).toBe(2);
    expect(close('--defer').code).toBe(2);
  });

  it('a finding out of the threat model stays minor in the verdict and is listed in deferred with residual out-of-model (M1)', () => {
    prep();
    write(r1(), 'correctness', { verdict: 'pass', confidence: 0.9, findings: [] });
    write(r1(), 'security', { verdict: 'fail', confidence: 0.8, findings: [{ severity: 'important', file: 'a.txt', line: 2, problem: 'an attacker with a shell can edit the file', outOfModel: true }] });
    const out = JSON.parse(close().stdout);
    expect(out).toMatchObject({ action: 'accept', next: 'done' });
    expect(out.deferred).toEqual([expect.objectContaining({ id: 'F1', reviewer: 'security', file: 'a.txt', line: 2, residual: 'out-of-model', severity: 'minor', declared: 'important' })]);
    const ruling = readEvents(root).filter(e => e.kind === 'ruling').at(-1)!;
    expect(ruling.minor).toEqual([expect.objectContaining({ id: 'F1', residual: 'out-of-model' })]);
    expect(ruling.deferred).toBeUndefined();
  });

  it('--defer and --out-of-model refuse an id that is neither in this review nor left open by the previous one, and write nothing (M2)', () => {
    prep();
    write(r1(), 'correctness', { verdict: 'fail', confidence: 0.8, findings: [{ severity: 'important', file: 'a.txt', line: 2, problem: 'the state should live in the store' }] });
    write(r1(), 'security', { verdict: 'pass', confidence: 0.9, findings: [] });
    expect(JSON.parse(close().stdout).action).toBe('fix');
    const verdicts = () => readEvents(root).filter(e => e.kind === 'verdict').length;
    const before = verdicts();
    for (const flag of ['--defer', '--out-of-model']) {
      const r = close(flag, 'F9');
      expect(r.code, flag).toBe(2);
      expect(r.stderr, flag).toContain('F9');
      expect(r.stderr, flag).toContain('F1');
      expect(existsSync(path.join(r1(), 'overrides.json')), flag).toBe(false);
    }
    expect(close('--defer', 'F1,F9').code).toBe(2);
    expect(existsSync(path.join(r1(), 'overrides.json'))).toBe(false);
    expect(verdicts()).toBe(before);
    expect(close('--defer', 'F1').code).toBe(0);
  });

  it('a draft (complete: false) closes nothing: the finding it did not reach stays open (M3)', () => {
    noExpress();
    prep();
    write(r1(), 'correctness', { verdict: 'fail', confidence: 0.8, findings: [{ severity: 'important', file: 'a.txt', line: 2, problem: 'wrong two' }] });
    write(r1(), 'security', { verdict: 'pass', confidence: 0.9, findings: [] });
    close();
    writeFileSync(path.join(wt, 'a.txt'), 'one\ntwo fixed\n');
    git('commit', '-q', '-am', 'fix');
    prep();
    write(r2(), 'correctness', { verdict: 'pass', confidence: 0.9, findings: [], complete: false });
    expect(JSON.parse(close().stdout).incomplete).toEqual(['correctness']);
    const index = JSON.parse(readFileSync(path.join(work(), 'findings-index-1.json'), 'utf8'));
    expect(index.rounds[1].findings.map((f: { id: string; status: string }) => [f.id, f.status])).toEqual([['F1', 'open']]);
  });

  it('--defer leaves a finding as residual architecture and closes the same review again (§4.8)', () => {
    prep();
    write(r1(), 'correctness', { verdict: 'fail', confidence: 0.8, findings: [{ severity: 'important', file: 'a.txt', line: 2, problem: 'the state should live in the store' }] });
    write(r1(), 'security', { verdict: 'pass', confidence: 0.9, findings: [] });
    expect(JSON.parse(close().stdout).action).toBe('fix');
    const out = JSON.parse(close('--defer', 'f1').stdout);
    expect(out).toMatchObject({ action: 'accept', next: 'done' });
    expect(out.deferred).toEqual([expect.objectContaining({ id: 'F1', residual: 'architecture' })]);
    expect(JSON.parse(readFileSync(path.join(r1(), 'overrides.json'), 'utf8'))).toEqual({ outOfModel: [], defer: ['F1'] });
  });

  it('an important finding only in the person docs (README.md) is residual docs and the brief is accepted (K4-09)', () => {
    prep();
    write(r1(), 'correctness', { verdict: 'fail', confidence: 0.8, findings: [{ severity: 'important', file: 'README.md', line: 3, problem: 'the usage line is out of date' }] });
    write(r1(), 'security', { verdict: 'pass', confidence: 0.9, findings: [] });
    const out = JSON.parse(close().stdout);
    expect(out).toMatchObject({ action: 'accept', findings: null });
    expect(out.deferred).toEqual([expect.objectContaining({ id: 'F1', residual: 'docs', file: 'README.md' })]);
  });

  it('the last review (4 of 4 on Medium) accepts a fix with green validators and no critical; what is open stays as residual cap (C-04)', () => {
    for (const k of [1, 2, 3]) appendEvent(root, { ts: `2026-10-14T09:0${k}:00.000Z`, kind: 'verdict', task: 'T1-1', dir: `.forge/work/T1/reviews-1-${k}`, action: 'fix', score: 0.6, signature: `v2:s${k}` });
    expect(JSON.parse(prep().stdout)).toMatchObject({ round: 4, reviews: { n: 4, max: 4 } });
    const r4 = path.join(work(), 'reviews-1-4');
    write(r4, 'correctness', { verdict: 'fail', confidence: 0.8, findings: [{ severity: 'important', file: 'a.txt', line: 2, problem: 'still wrong' }] });
    write(r4, 'security', { verdict: 'pass', confidence: 0.9, findings: [] });
    const out = JSON.parse(close().stdout);
    expect(out).toMatchObject({ action: 'accept', next: 'done' });
    expect(out.reasons).toContain('accepted at the cap with 1 open finding(s)');
    expect(out.deferred).toEqual([expect.objectContaining({ problem: 'still wrong', residual: 'cap' })]);
  });

  it('a brief begun before forge 0.18 (no findings index, a text signature): the delta reviewer gets its parsed findings and the old signature never stalls', () => {
    prep();
    write(r1(), 'correctness', { verdict: 'fail', confidence: 0.8, findings: [{ severity: 'important', file: 'a.txt', line: 2, problem: 'wrong two' }] });
    write(r1(), 'security', { verdict: 'pass', confidence: 0.9, findings: [] });
    appendEvent(root, { ts: '2026-10-14T10:05:00.000Z', kind: 'verdict', task: 'T1-1', dir: '.forge/work/T1/reviews-1-1', action: 'fix', score: 0.6, signature: '3f2a9c0d1e5b7a64' });
    writeFileSync(path.join(wt, 'a.txt'), 'one\ntwo again\n');
    git('commit', '-q', '-am', 'fix');
    prep();
    expect(existsSync(path.join(work(), 'findings-index-1.json'))).toBe(false);
    expect(JSON.parse(readFileSync(path.join(r2(), 'previous-correctness.json'), 'utf8'))).toEqual([{ severity: 'important', file: 'a.txt', line: 2, problem: 'wrong two' }]);
    write(r2(), 'correctness', { verdict: 'fail', confidence: 0.8, findings: [{ severity: 'important', file: 'a.txt', line: 2, problem: 'wrong two', origin: 'previous' }] });
    expect(JSON.parse(close().stdout)).toMatchObject({ action: 'fix', next: 'resume' });
    expect(JSON.parse(readFileSync(path.join(work(), 'findings-index-1.json'), 'utf8')).rounds.map((r: { round: number }) => r.round)).toEqual([2]);
  });

  it('a reviewer that breaks the rubric closes nothing: its finding left open stays open in the index (I3)', () => {
    noExpress();
    prep();
    write(r1(), 'correctness', { verdict: 'fail', confidence: 0.8, findings: [{ severity: 'important', file: 'a.txt', line: 2, problem: 'wrong two' }] });
    write(r1(), 'security', { verdict: 'pass', confidence: 0.9, findings: [] });
    close();
    writeFileSync(path.join(wt, 'a.txt'), 'one\ntwo fixed\n');
    git('commit', '-q', '-am', 'fix');
    prep();
    write(r2(), 'correctness', { verdict: 'fail', confidence: 0.9, findings: [{ severity: 'critical', problem: 'vague' }] });
    write(r2(), 'security', { verdict: 'pass', confidence: 0.9, findings: [] });
    expect(JSON.parse(close().stdout).invalid).toEqual(['correctness']);
    const index = JSON.parse(readFileSync(path.join(work(), 'findings-index-1.json'), 'utf8'));
    expect(index.rounds[1].findings.map((f: { id: string; status: string }) => [f.id, f.status])).toEqual([['F1', 'open']]);
  });

  it('round 2: a finding still open whose reviewer copies its id but calls it untouched is previous and blocks (J-06)', () => {
    noExpress();
    prep();
    write(r1(), 'correctness', { verdict: 'fail', confidence: 0.8, findings: [{ severity: 'important', file: 'b.txt', line: 25, problem: 'old smell in the loop' }] });
    write(r1(), 'security', { verdict: 'pass', confidence: 0.9, findings: [] });
    close();
    writeFileSync(path.join(wt, 'a.txt'), 'one\ntwo fixed\n');
    git('commit', '-q', '-am', 'fix');
    prep();
    // b.txt is outside the fix diff: only the id the reviewer copied says it is the open F1.
    write(r2(), 'correctness', { verdict: 'fail', confidence: 0.8, findings: [{ severity: 'important', file: 'b.txt', line: 25, problem: 'old smell in the loop', origin: 'untouched', id: 'F1' }] });
    const out = JSON.parse(close().stdout);
    expect(out).toMatchObject({ action: 'fix', deferred: [] });
    const sent = JSON.parse(readFileSync(path.join(work(), 'findings-1-2.json'), 'utf8')).findings;
    expect(sent).toEqual([expect.objectContaining({ id: 'F1', origin: 'untouched' })]);
    expect(sent[0].residual).toBeUndefined();
  });

  it('a fix can defer too: the hardening finding is reported, logged and indexed as residual, and not sent to the implementer (C-04)', () => {
    noExpress();
    prep();
    write(r1(), 'correctness', { verdict: 'fail', confidence: 0.8, findings: [
      { severity: 'important', file: 'a.txt', line: 2, problem: 'the second line is not validated' },
      { severity: 'important', file: 'b.txt', line: 20, problem: 'loop never ends on empty input' }] });
    write(r1(), 'security', { verdict: 'pass', confidence: 0.9, findings: [] });
    close();
    writeFileSync(path.join(wt, 'a.txt'), 'one\ntwo checked\n');
    git('commit', '-q', '-am', 'fix');
    prep();
    write(r2(), 'correctness', { verdict: 'fail', confidence: 0.8, findings: [
      { severity: 'important', file: 'b.txt', line: 20, problem: 'loop never ends on empty input', origin: 'previous', id: 'F2' },
      { severity: 'important', file: 'a.txt', line: 2, problem: 'the second line is not validated when it is empty', origin: 'fix' }] });
    const out = JSON.parse(close().stdout);
    expect(out.action).toBe('fix');
    expect(out.deferred).toEqual([expect.objectContaining({ id: 'F3', reviewer: 'correctness', residual: 'hardening' })]);
    expect(JSON.parse(readFileSync(path.join(work(), 'findings-1-2.json'), 'utf8')).findings.map((f: { id: string }) => f.id)).toEqual(['F2']);
    expect(readEvents(root).filter(e => e.kind === 'verdict').at(-1)).toMatchObject({ action: 'fix', deferred: 1 });
    expect(readEvents(root).filter(e => e.kind === 'ruling').at(-1)).toMatchObject({ round: 2, deferred: [{ id: 'F3', residual: 'hardening' }] });
    const index = JSON.parse(readFileSync(path.join(work(), 'findings-index-1.json'), 'utf8'));
    expect(index.rounds[1].findings.map((f: { id: string; status: string }) => [f.id, f.status])).toEqual([['F2', 'open'], ['F3', 'residual'], ['F1', 'closed']]);
  });

  it('a finding deferred as architecture at a fix review stays residual through a review that cannot see it, and the accept lists it in deferred (I1)', () => {
    noExpress();
    prep();
    write(r1(), 'correctness', { verdict: 'fail', confidence: 0.8, findings: [
      { severity: 'important', file: 'b.txt', line: 20, problem: 'the state should live in the store' },
      { severity: 'important', file: 'a.txt', line: 2, problem: 'wrong two' }] });
    write(r1(), 'security', { verdict: 'pass', confidence: 0.9, findings: [] });
    close();
    const deferred = JSON.parse(close('--defer', 'F1').stdout);
    expect(deferred).toMatchObject({ action: 'fix', deferred: [expect.objectContaining({ id: 'F1', residual: 'architecture' })] });
    writeFileSync(path.join(wt, 'a.txt'), 'one\ntwo fixed\n');
    git('commit', '-q', '-am', 'fix');
    prep();
    expect(JSON.parse(readFileSync(path.join(r2(), 'previous-correctness.json'), 'utf8')).map((f: { id: string }) => f.id)).toEqual(['F2']);
    write(r2(), 'correctness', { verdict: 'pass', confidence: 0.9, findings: [] });
    const out = JSON.parse(close().stdout);
    expect(out).toMatchObject({ action: 'accept', next: 'done' });
    expect(out.deferred).toEqual([expect.objectContaining({ id: 'F1', reviewer: 'correctness', residual: 'architecture', file: 'b.txt', line: 20 })]);
    const index = JSON.parse(readFileSync(path.join(work(), 'findings-index-1.json'), 'utf8'));
    expect(index.rounds[1].findings.map((f: { id: string; status: string }) => [f.id, f.status])).toEqual([['F2', 'closed'], ['F1', 'residual']]);
    expect(readEvents(root).filter(e => e.kind === 'ruling').at(-1)).toMatchObject({ round: 2, deferred: [{ id: 'F1', residual: 'architecture' }] });
    expect(readEvents(root).filter(e => e.kind === 'verdict').at(-1)).toMatchObject({ action: 'accept', deferred: 1 });
  });

  it('a hardening residual of review 2 is still listed when review 3 accepts (I1)', () => {
    noExpress();
    prep();
    write(r1(), 'correctness', { verdict: 'fail', confidence: 0.8, findings: [
      { severity: 'important', file: 'a.txt', line: 2, problem: 'the second line is not validated' },
      { severity: 'important', file: 'b.txt', line: 20, problem: 'loop never ends on empty input' }] });
    write(r1(), 'security', { verdict: 'pass', confidence: 0.9, findings: [] });
    close();
    writeFileSync(path.join(wt, 'a.txt'), 'one\ntwo checked\n');
    git('commit', '-q', '-am', 'fix');
    prep();
    write(r2(), 'correctness', { verdict: 'fail', confidence: 0.8, findings: [
      { severity: 'important', file: 'b.txt', line: 20, problem: 'loop never ends on empty input', origin: 'previous', id: 'F2' },
      { severity: 'important', file: 'a.txt', line: 2, problem: 'the second line is not validated when it is empty', origin: 'fix' }] });
    expect(JSON.parse(close().stdout)).toMatchObject({ action: 'fix', deferred: [expect.objectContaining({ id: 'F3', residual: 'hardening' })] });
    writeFileSync(path.join(wt, 'b.txt'), 'b\n'.repeat(29) + 'end\n');
    git('commit', '-q', '-am', 'fix 2');
    prep();
    write(path.join(work(), 'reviews-1-3'), 'correctness', { verdict: 'pass', confidence: 0.9, findings: [] });
    const out = JSON.parse(close().stdout);
    expect(out).toMatchObject({ action: 'accept', next: 'done' });
    expect(out.deferred).toEqual([expect.objectContaining({ id: 'F3', residual: 'hardening' })]);
    const index = JSON.parse(readFileSync(path.join(work(), 'findings-index-1.json'), 'utf8'));
    expect(index.rounds[2].findings.map((f: { id: string; status: string }) => [f.id, f.status])).toEqual([['F2', 'closed'], ['F3', 'residual']]);
  });

  it('an unreadable findings index is set aside as .corrupt-<timestamp> before the new one is written, never overwritten', () => {
    prep();
    writeFileSync(path.join(work(), 'findings-index-1.json'), '{"rounds": [oops');
    write(r1(), 'correctness', { verdict: 'fail', confidence: 0.8, findings: [{ severity: 'important', file: 'a.txt', line: 2, problem: 'wrong two' }] });
    write(r1(), 'security', { verdict: 'pass', confidence: 0.9, findings: [] });
    expect(JSON.parse(close().stdout).action).toBe('fix');
    const aside = () => readdirSync(work()).filter(f => f.startsWith('findings-index-1.json.corrupt-'));
    expect(aside()).toEqual(['findings-index-1.json.corrupt-2026-10-14T10-00-00-000Z']);
    expect(readFileSync(path.join(work(), aside()[0]), 'utf8')).toBe('{"rounds": [oops');
    expect(JSON.parse(readFileSync(path.join(work(), 'findings-index-1.json'), 'utf8')).rounds.map((r: { round: number }) => r.round)).toEqual([1]);
    // A readable index is rewritten in place: closing again sets nothing else aside.
    close();
    expect(aside()).toHaveLength(1);
  });

  it('a redo prints revert, the git args that undo the attempt, and writes the handover for the new implementer (J-08, C-15)', () => {
    prep();
    const wrong = { verdict: 'fail', confidence: 0.9, approach: 'wrong', findings: [{ severity: 'important', file: 'a.txt', line: 2, problem: 'a counter cannot work here: use a queue' }] };
    write(r1(), 'correctness', wrong);
    write(r1(), 'security', { ...wrong, findings: [{ severity: 'important', file: 'a.txt', line: 1, problem: 'the state is shared between requests' }] });
    const out = JSON.parse(close().stdout);
    expect(out).toMatchObject({ action: 'redo', next: 'redo', handover: '.forge/work/T1/handover-1-1.md' });
    expect(out.revert).toEqual({ base, head: git('rev-parse', 'HEAD'), args: ['-C', wt, 'revert', '--no-edit', `${base}..HEAD`] });
    const note = readFileSync(path.join(work(), 'handover-1-1.md'), 'utf8');
    expect(note.split('\n')[0]).toBe('# Handover: T1-1, review 1 of 4 (the attempt was reverted: start again from the brief with another approach)');
    expect(note).toContain('"a counter cannot work here: use a queue"');
    expect(note).toContain('.forge/work/T1/report-1.txt');
  });

  it('the first review after a redo is judged as a first review: a new important near a finding of the reverted attempt blocks under a new id (I4)', () => {
    noExpress();
    prep();
    write(r1(), 'correctness', { verdict: 'fail', confidence: 0.8, findings: [{ severity: 'important', file: 'a.txt', line: 2, problem: 'wrong two' }] });
    write(r1(), 'security', { verdict: 'pass', confidence: 0.9, findings: [] });
    close();
    writeFileSync(path.join(wt, 'a.txt'), 'one\ntwo again\n');
    git('commit', '-q', '-am', 'fix');
    prep();
    const wrong = { verdict: 'fail', confidence: 0.9, approach: 'wrong' };
    write(r2(), 'correctness', { ...wrong, findings: [{ severity: 'important', file: 'a.txt', line: 2, problem: 'still wrong: a counter cannot work', origin: 'previous', id: 'F1' }] });
    write(r2(), 'security', { ...wrong, findings: [{ severity: 'important', file: 'a.txt', line: 1, problem: 'shared state', origin: 'fix' }] });
    const redo = JSON.parse(close().stdout);
    expect(redo).toMatchObject({ action: 'redo', next: 'redo' });
    git(...redo.revert.args);
    writeFileSync(path.join(wt, 'a.txt'), 'one\nTWO with a queue\n');
    git('commit', '-q', '-am', 'redo');
    expect(JSON.parse(prep().stdout).spawn.map((s: { role: string; mode: string }) => [s.role, s.mode])).toEqual([['review-correctness', 'full'], ['review-security', 'full']]);
    const r3 = path.join(work(), 'reviews-1-3');
    write(r3, 'correctness', { verdict: 'fail', confidence: 0.8, findings: [{ severity: 'important', file: 'a.txt', line: 2, problem: 'the queue drops the last item' }] });
    write(r3, 'security', { verdict: 'pass', confidence: 0.9, findings: [] });
    const out = JSON.parse(close().stdout);
    expect(out).toMatchObject({ action: 'fix', reviews: { n: 3, max: 4 }, deferred: [] });
    expect(JSON.parse(readFileSync(path.join(work(), 'findings-1-3.json'), 'utf8')).findings.map((f: { id: string }) => f.id)).toEqual(['F3']);
    const index = JSON.parse(readFileSync(path.join(work(), 'findings-index-1.json'), 'utf8'));
    expect(index.rounds[2].findings.map((f: { id: string; status: string }) => [f.id, f.status])).toEqual([['F3', 'open']]);
    // Closing it again (the verdict of this review is now the last one logged) still judges it as a first review.
    expect(JSON.parse(close().stdout)).toMatchObject({ action: 'fix', deferred: [] });
  });

  it('revert is null when HEAD is still BASE or the plan does not say what BASE was; the handover is written anyway', () => {
    run(['review-prep', '--task', 'T1-1', '--path', 'medium', '--base', git('rev-parse', 'HEAD'), '--baseline', '.forge/work/T1/baseline-1.json', '--dir', '.forge/work/T1', '--cwd', wt], io);
    const wrong = { verdict: 'fail', confidence: 0.9, approach: 'wrong', findings: [{ severity: 'important', file: 'a.txt', line: 2, problem: 'start over' }] };
    write(r1(), 'correctness', wrong);
    write(r1(), 'security', wrong);
    expect(JSON.parse(close().stdout)).toMatchObject({ next: 'redo', revert: null, handover: '.forge/work/T1/handover-1-1.md' });
    const planFile = path.join(r1(), 'review-plan.json');
    const plan = JSON.parse(readFileSync(planFile, 'utf8'));
    plan.base = undefined;
    writeFileSync(planFile, JSON.stringify(plan));
    expect(JSON.parse(close().stdout)).toMatchObject({ next: 'redo', revert: null });
    expect(readFileSync(path.join(work(), 'handover-1-1.md'), 'utf8')).toContain('(base unknown, head ');
    // A BASE that is not a commit hash, or does not resolve, is never printed as git args (option injection).
    for (const bad of ['--abort', '-x', 'HEAD~1', 'deadbeefdeadbeef']) {
      writeFileSync(planFile, JSON.stringify({ ...plan, base: bad }));
      expect(JSON.parse(close().stdout)).toMatchObject({ next: 'redo', revert: null });
      expect(readFileSync(path.join(work(), 'handover-1-1.md'), 'utf8')).toContain('(base unknown, head ');
    }
  });

  it('a later close of the round that sends nobody to a new implementer removes the stale handover', () => {
    prep();
    const wrong = { verdict: 'fail', confidence: 0.9, approach: 'wrong', findings: [{ severity: 'important', file: 'a.txt', line: 2, problem: 'start over' }] };
    write(r1(), 'correctness', wrong);
    write(r1(), 'security', wrong);
    expect(JSON.parse(close().stdout).handover).toBe('.forge/work/T1/handover-1-1.md');
    write(r1(), 'correctness', { verdict: 'pass', confidence: 0.9, findings: [] });
    write(r1(), 'security', { verdict: 'pass', confidence: 0.9, findings: [] });
    expect(JSON.parse(close().stdout)).toMatchObject({ action: 'accept', handover: null });
    expect(existsSync(path.join(work(), 'handover-1-1.md'))).toBe(false);
  });

  it('fresh-stronger writes the handover: the open findings to fix and the reviews so far; resume writes none (C-15)', () => {
    for (const k of [1, 2]) appendEvent(root, { ts: `2026-10-14T09:0${k}:00.000Z`, kind: 'verdict', task: 'T1-1', dir: `.forge/work/T1/reviews-1-${k}`, action: 'fix', score: 0.6, signature: `v2:s${k}` });
    prep();
    const r3 = path.join(work(), 'reviews-1-3');
    write(r3, 'correctness', { verdict: 'fail', confidence: 0.8, findings: [{ severity: 'important', file: 'a.txt', line: 2, problem: 'two is still wrong', fix: 'compare with the spec' }] });
    write(r3, 'security', { verdict: 'pass', confidence: 0.9, findings: [] });
    const out = JSON.parse(close().stdout);
    expect(out).toMatchObject({ action: 'fix', next: 'fresh-stronger', last: true, handover: '.forge/work/T1/handover-1-3.md', revert: null });
    const note = readFileSync(path.join(work(), 'handover-1-3.md'), 'utf8');
    expect(note.split('\n')[0]).toBe('# Handover: T1-1, review 3 of 4');
    expect(note).toContain('  - F1 [important] a.txt:2 — "two is still wrong" — "compare with the spec"');
    expect(note).toContain('- Reviews so far: 3: F1 open');
    expect(note).toContain('- Validators now: green');
  });
});

describe('the tree cache (C6), with forge in the worktree itself', () => {
  // forge runs in wt itself (no --cwd, which would swap the test's exec for the real one), so `calls` counts every run.
  let calls: string[];
  let wio: Io;
  beforeEach(() => {
    calls = [];
    wio = {
      cwd: wt, now: () => new Date('2026-10-14T10:00:00.000Z'), env: {}, scriptPath: path.join(root, 'forge', 'dist', 'forge.cjs'),
      exec: cmd => { calls.push(cmd); return { code: 0, output: '', ms: 40, timedOut: false }; },
    };
    appendEvent(wt, { ts: '2026-10-14T09:00:00.000Z', kind: 'triage', task: 'T1', path: 'medium', sensitive: [], review });
  });
  const reviewPrepArgs = (base: string) => ['review-prep', '--task', 'T1-1', '--path', 'medium', '--base', base, '--baseline', '.forge/work/T1/baseline-1.json', '--dir', '.forge/work/T1', '--locale', 'en'];

  it("prep, the implementer's commit, review-prep and the next brief's prep run the validators twice, not three times", () => {
    const first = JSON.parse(run(['prep', '--task', 'T1-1', '--path', 'medium'], wio).stdout);
    expect(first).toMatchObject({ cached: [], durationMs: expect.any(Number) });
    writeFileSync(path.join(wt, 'a.txt'), 'one\ntwo\nthree\n');
    git('commit', '-q', '-am', 'work');
    expect(JSON.parse(run(reviewPrepArgs(first.base), wio).stdout).cached).toEqual([]);
    const second = JSON.parse(run(['prep', '--task', 'T1-2', '--path', 'medium'], wio).stdout);
    expect(second.cached).toEqual(['check']);
    expect(calls).toHaveLength(2);
    const events = readEvents(wt).filter(e => e.kind === 'validate');
    expect(events.map(e => [e.task, e.baseline ?? false, e.cached, e.scope])).toEqual([['T1-1', true, false, 'heavy'], ['T1-1', false, false, 'heavy'], ['T1-2', true, true, 'heavy']]);
    for (const e of events) expect(typeof e.durationMs).toBe('number');
    expect((events[2].results as Record<string, unknown>[])[0]).toMatchObject({ validator: 'check', cached: true, durationMs: 40, failing: [], failingKnown: true });
  });

  it('review-prep again on the same tree reads the cache and says so', () => {
    const base = JSON.parse(run(['prep', '--task', 'T1-1', '--path', 'medium'], wio).stdout).base;
    writeFileSync(path.join(wt, 'a.txt'), 'one\ntwo\nthree\n');
    git('commit', '-q', '-am', 'work');
    expect(JSON.parse(run(reviewPrepArgs(base), wio).stdout).say).not.toContain('cached');
    const again = JSON.parse(run(reviewPrepArgs(base), wio).stdout);
    expect(again.cached).toEqual(['check']);
    expect(again.say).toContain('(1 cached)');
    expect(calls).toHaveLength(2);
  });

  it('prep --no-baseline records BASE and the phase without validating (J-13)', () => {
    const r = run(['prep', '--task', 'T1-1', '--path', 'small', '--no-baseline'], wio);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out).toMatchObject({ base: git('rev-parse', 'HEAD'), baseline: null, failing: [], cached: [] });
    expect(out.validate).toContain(` validate --affected --base ${out.base} --task T1-1`);
    expect(out.validate).not.toContain('--cwd');
    expect(calls).toEqual([]);
    expect(readEvents(wt).some(e => e.kind === 'validate')).toBe(false);
    expect(readEvents(wt).filter(e => e.kind === 'phase').at(-1)).toMatchObject({ task: 'T1', phase: 'implement', brief: 1, base: out.base });
  });

  it('a dirty tree is neither read nor written', () => {
    writeFileSync(path.join(wt, 'untracked.txt'), 'x\n');
    run(['prep', '--task', 'T1-1', '--path', 'medium'], wio);
    run(['prep', '--task', 'T1-2', '--path', 'medium'], wio);
    expect(calls).toHaveLength(2);
    expect(existsSync(path.join(wt, '.forge', 'cache', 'validate'))).toBe(false);
  });

  it('--no-cache: prep and review-prep neither read nor write it (a cached red result may be flaky)', () => {
    const dir = path.join(wt, '.forge', 'cache', 'validate');
    const entries = () => (existsSync(dir) ? readdirSync(dir).length : 0);
    const base = JSON.parse(run(['prep', '--task', 'T1-1', '--path', 'medium', '--no-cache'], wio).stdout).base;
    expect(entries()).toBe(0);
    run(['prep', '--task', 'T1-1', '--path', 'medium'], wio);
    expect(entries()).toBe(1);
    expect(JSON.parse(run(['prep', '--task', 'T1-1', '--path', 'medium', '--no-cache'], wio).stdout).cached).toEqual([]);
    expect(calls).toHaveLength(3);
    writeFileSync(path.join(wt, 'a.txt'), 'one\ntwo\nthree\n');
    git('commit', '-q', '-am', 'work');
    expect(JSON.parse(run([...reviewPrepArgs(base), '--no-cache'], wio).stdout).cached).toEqual([]);
    expect(entries()).toBe(1);
    expect(JSON.parse(run(reviewPrepArgs(base), wio).stdout).cached).toEqual([]);
    expect(JSON.parse(run([...reviewPrepArgs(base), '--no-cache'], wio).stdout).cached).toEqual([]);
    expect(calls).toHaveLength(6);
  });
});

describe('the tree cache (C6), with forge in a subdirectory of the checkout', () => {
  it('a change outside the subdirectory is seen: the next prep is not served from the cache', () => {
    const sub = path.join(wt, 'sub');
    mkdirSync(path.join(sub, '.forge'), { recursive: true });
    writeFileSync(path.join(sub, '.forge', 'config.yaml'), 'detect: false\nvalidators:\n  - name: check\n    cmd: node -e "process.exit(0)"\n');
    writeFileSync(path.join(wt, '.git', 'info', 'exclude'), 'sub/.forge/\n'); // forge's own state in sub is not a change
    const calls: string[] = [];
    const sio: Io = {
      cwd: sub, now: () => new Date('2026-10-14T10:00:00.000Z'), env: {},
      exec: cmd => { calls.push(cmd); return { code: 0, output: '', ms: 5, timedOut: false }; },
    };
    expect(JSON.parse(run(['prep', '--task', 'T1-1', '--path', 'medium'], sio).stdout).cached).toEqual([]);
    expect(JSON.parse(run(['prep', '--task', 'T1-2', '--path', 'medium'], sio).stdout).cached).toEqual(['check']);
    expect(calls).toHaveLength(1);
    writeFileSync(path.join(wt, 'a.txt'), 'changed outside sub\n');
    expect(JSON.parse(run(['prep', '--task', 'T1-3', '--path', 'medium'], sio).stdout).cached).toEqual([]);
    expect(calls).toHaveLength(2);
  });
});

describe('the express review (measure 7)', () => {
  const close = (...extra: string[]) => run(['review-close', '--task', 'T1-1', '--dir', '.forge/work/T1', '--path', 'medium', '--cwd', wt, ...extra], io);
  const write = (dir: string, name: string, v: unknown) => writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(v));
  const r1 = () => path.join(work(), 'reviews-1-1');
  const r2 = () => path.join(work(), 'reviews-1-2');
  // Review 1 asks to fix one important correctness finding with green validators; the implementer commits a fix.
  const firstReview = () => {
    prep();
    write(r1(), 'correctness', { verdict: 'fail', confidence: 0.8, findings: [{ severity: 'important', file: 'a.txt', line: 2, problem: 'wrong two' }] });
    write(r1(), 'security', { verdict: 'pass', confidence: 0.9, findings: [] });
    expect(JSON.parse(close().stdout)).toMatchObject({ action: 'fix', next: 'resume' });
    writeFileSync(path.join(wt, 'a.txt'), 'one\ntwo fixed\n');
    git('commit', '-q', '-am', 'fix');
  };
  const slash = (p: string) => path.resolve(p).split(path.sep).join('/');

  it('one correctness reviewer on Sonnet at medium checks the open findings while the validators run apart; review-close waits for their file', () => {
    firstReview();
    const validates = () => readEvents(root).filter(e => e.kind === 'validate').length;
    const before = validates();
    const self = path.join(root, 'plugin', 'dist', 'forge.cjs');
    const out = JSON.parse(run(['review-prep', '--task', 'T1-1', '--path', 'medium', '--base', base, '--baseline', '.forge/work/T1/baseline-1.json', '--dir', '.forge/work/T1',
      '--cwd', wt, '--locale', 'en'], { ...io, scriptPath: self }).stdout);
    expect(out).toMatchObject({ round: 2, reviews: { n: 2, max: 4 }, express: true, carried: ['security'], delegated: ['correctness'] });
    expect(out.spawn).toEqual([expect.objectContaining({ role: 'review-correctness', model: 'sonnet', effort: 'medium', mode: 'delta', express: true })]);
    expect(out.spawn[0].inputs.findings).toBe('.forge/work/T1/reviews-1-2/previous-express.json');
    expect(out.validators).toEqual({ pending: true, file: '.forge/work/T1/validators-1.json',
      cmd: `node "${slash(self)}" validate --all --path medium --base ${base} --baseline "${slash(path.join(work(), 'baseline-1.json'))}" --task T1-1 --out "${slash(path.join(work(), 'validators-1.json'))}" --cwd "${slash(wt)}"` });
    expect(out.say).toMatch(/^Review 2 of 4, express: /);
    expect(existsSync(path.join(work(), 'validators-1.json'))).toBe(false);
    expect(validates()).toBe(before);
    expect(JSON.parse(readFileSync(path.join(r2(), 'previous-express.json'), 'utf8'))).toEqual([{ id: 'F1', reviewer: 'correctness', severity: 'important', file: 'a.txt', line: 2, problem: 'wrong two' }]);
    expect(JSON.parse(readFileSync(path.join(r2(), 'review-plan.json'), 'utf8'))).toMatchObject({ express: true, delegated: ['correctness'], validatorsPending: true, base });
    expect(readEvents(root).filter(e => e.kind === 'phase' && e.phase === 'review').at(-1)).toMatchObject({ express: true, round: 2 });
    write(r2(), 'correctness', { verdict: 'pass', confidence: 0.9, findings: [] });
    const waiting = close();
    expect(waiting.code).toBe(3);
    expect(JSON.parse(waiting.stdout).missing).toEqual(['.forge/work/T1/validators-1.json']);
    expect(run(['validate', '--all', '--path', 'medium', '--base', base, '--baseline', '.forge/work/T1/baseline-1.json', '--task', 'T1-1', '--out', '.forge/work/T1/validators-1.json', '--cwd', wt], io).code).toBe(0);
    const closed = JSON.parse(close().stdout);
    expect(closed).toMatchObject({ action: 'accept', next: 'done', reviews: { n: 2, max: 4 }, express: true });
    expect(readEvents(root).filter(e => e.kind === 'verdict').at(-1)).toMatchObject({ express: true });
    const index = JSON.parse(readFileSync(path.join(work(), 'findings-index-1.json'), 'utf8'));
    expect(index.rounds[1].findings).toEqual([expect.objectContaining({ id: 'F1', status: 'closed' })]);
  });

  it('when the background validation comes out red, the express review is a fix by validators and counts against the cap', () => {
    firstReview();
    expect(JSON.parse(prep().stdout).express).toBe(true);
    write(r2(), 'correctness', { verdict: 'pass', confidence: 0.9, findings: [] });
    writeFileSync(path.join(work(), 'validators-1.json'), JSON.stringify([{ validator: 'check', ok: false, flaky: false, durationMs: 1, failures: ['boom'], failing: [], failingKnown: false }]));
    const out = JSON.parse(close().stdout);
    expect(out).toMatchObject({ action: 'fix', next: 'resume', reviews: { n: 2, max: 4 } });
    expect(out.reasons).toContain('validators failing');
    expect(readEvents(root).filter(e => e.kind === 'verdict' && e.task === 'T1-1')).toHaveLength(2);
  });

  it('is not used with review.express: false', () => {
    firstReview();
    writeFileSync(path.join(wt, '.forge', 'config.yaml'), 'review:\n  express: false\ndetect: false\nvalidators:\n  - name: check\n    cmd: node -e "process.exit(0)"\n');
    const out = JSON.parse(prep().stdout);
    expect(out.express).toBeUndefined();
    expect(out.validators).toMatchObject({ ok: true });
    expect(out.spawn.map((s: { role: string; mode: string }) => [s.role, s.mode])).toEqual([['review-correctness', 'delta']]);
  });

  it('is used on review 3 of 4 but never on the last one', () => {
    // Review k asked for a fix of F1 with green validators, as review-close leaves it.
    const fixReview = (k: number) => {
      const dir = path.join(work(), `reviews-1-${k}`);
      mkdirSync(dir, { recursive: true });
      write(dir, 'correctness', { verdict: 'fail', confidence: 0.8, findings: [{ severity: 'important', file: 'a.txt', line: 2, problem: 'wrong two' }] });
      write(dir, 'security', { verdict: 'pass', confidence: 0.9, findings: [] });
      appendEvent(root, { ts: `2026-10-14T09:0${k}:00.000Z`, kind: 'verdict', task: 'T1-1', dir: `.forge/work/T1/reviews-1-${k}`, action: 'fix', score: 0.6, signature: `v2:s${k}` });
      writeFileSync(path.join(work(), `findings-1-${k}.json`), JSON.stringify({ task: 'T1-1', round: k, action: 'fix', findings: [], validators: [] }));
      const open = { id: 'F1', reviewer: 'correctness', severity: 'important', file: 'a.txt', line: 2, problem: 'wrong two', status: 'open' };
      writeFileSync(path.join(work(), 'findings-index-1.json'), JSON.stringify({ task: 'T1-1', next: 2, rounds: Array.from({ length: k }, (_, i) => ({ round: i + 1, findings: [open] })) }));
    };
    fixReview(1);
    fixReview(2);
    expect(JSON.parse(prep().stdout)).toMatchObject({ round: 3, reviews: { n: 3, max: 4 }, express: true });
    fixReview(3);
    const last = JSON.parse(prep().stdout);
    expect(last).toMatchObject({ round: 4, reviews: { n: 4, max: 4 } });
    expect(last.express).toBeUndefined();
  });

  it('is not used when --base is not a commit id: the validate command it prints carries BASE unquoted', () => {
    firstReview();
    git('tag', 'start', base);
    const out = JSON.parse(run(['review-prep', '--task', 'T1-1', '--path', 'medium', '--base', 'start', '--baseline', '.forge/work/T1/baseline-1.json',
      '--dir', '.forge/work/T1', '--cwd', wt], io).stdout);
    expect(out.express).toBeUndefined();
    expect(out.validators).toMatchObject({ ok: true });
  });

  it('is not used when the finding left open comes from security', () => {
    prep();
    write(r1(), 'correctness', { verdict: 'pass', confidence: 0.9, findings: [] });
    write(r1(), 'security', { verdict: 'fail', confidence: 0.8, findings: [{ severity: 'important', file: 'a.txt', line: 2, problem: 'unchecked path' }] });
    expect(JSON.parse(close().stdout).action).toBe('fix');
    writeFileSync(path.join(wt, 'a.txt'), 'one\ntwo checked\n');
    git('commit', '-q', '-am', 'fix');
    const out = JSON.parse(prep().stdout);
    expect(out.express).toBeUndefined();
    expect(out.spawn.map((s: { role: string }) => s.role)).toEqual(['review-correctness', 'review-security']);
  });

  const green = () => writeFileSync(path.join(work(), 'validators-1.json'), JSON.stringify([{ validator: 'check', ok: true, flaky: false, durationMs: 1, failures: [] }]));
  const indexRound = (k: number) => JSON.parse(readFileSync(path.join(work(), 'findings-index-1.json'), 'utf8')).rounds.find((r: { round: number }) => r.round === k).findings;

  for (const [label, file] of [
    ['abstains', JSON.stringify({ verdict: 'abstain', confidence: 0, findings: [] })],
    ['is a draft', JSON.stringify({ verdict: 'pass', confidence: 0.9, findings: [], complete: false })],
    ['is invalid', 'the reviewer ran out of time {not json'],
  ] as const) {
    it(`when the express correctness ${label}, the review never accepts: the delegated finding stays open and the next review is a normal one`, () => {
      firstReview();
      expect(JSON.parse(prep().stdout).express).toBe(true);
      writeFileSync(path.join(r2(), 'correctness.json'), file);
      green();
      const out = JSON.parse(close().stdout);
      expect(out).toMatchObject({ action: 'fix', express: true, reviews: { n: 2, max: 4 } });
      expect(out.reasons.some((x: string) => /correctness did not answer/.test(x))).toBe(true);
      expect(indexRound(2)).toEqual([expect.objectContaining({ id: 'F1', reviewer: 'correctness', status: 'open' })]);
      expect(JSON.parse(readFileSync(path.join(work(), 'findings-1-2.json'), 'utf8')).findings).toEqual([expect.objectContaining({ id: 'F1', reviewer: 'correctness' })]);
      const next = JSON.parse(prep().stdout);
      expect(next).toMatchObject({ round: 3, validators: { ok: true } });
      expect(next.express).toBeUndefined();
      expect(next.spawn.map((s: { role: string; model: unknown; effort: string }) => [s.role, s.model, s.effort])).toEqual([['review-correctness', null, 'xhigh']]);
    });
  }

  it('a passing express correctness answers for perf, delegated to it: the finding perf left open closes in the index', () => {
    appendEvent(root, { ts: '2026-10-14T09:30:00.000Z', kind: 'triage', task: 'T1', path: 'medium', sensitive: ['auth'],
      review: { ...review, flags: ['--sensitive', '--perf'], reviewers: [...review.reviewers, { role: 'review-perf', model: null, effort: 'medium', agent: 'forge-review-perf' }] } });
    prep();
    write(r1(), 'correctness', { verdict: 'pass', confidence: 0.9, findings: [] });
    write(r1(), 'security', { verdict: 'pass', confidence: 0.9, findings: [] });
    write(r1(), 'perf', { verdict: 'fail', confidence: 0.8, findings: [{ severity: 'important', file: 'a.txt', line: 2, problem: 'slow two' }] });
    expect(JSON.parse(close().stdout).action).toBe('fix');
    writeFileSync(path.join(wt, 'a.txt'), 'one\ntwo faster\n');
    git('commit', '-q', '-am', 'fix');
    expect(JSON.parse(prep().stdout)).toMatchObject({ express: true, carried: ['security'], delegated: ['perf'] });
    expect(JSON.parse(readFileSync(path.join(r2(), 'previous-express.json'), 'utf8'))).toEqual([expect.objectContaining({ id: 'F1', reviewer: 'perf' })]);
    write(r2(), 'correctness', { verdict: 'pass', confidence: 0.9, findings: [] });
    green();
    expect(JSON.parse(close().stdout)).toMatchObject({ action: 'accept', express: true });
    expect(indexRound(2)).toEqual([expect.objectContaining({ id: 'F1', reviewer: 'perf', status: 'closed' })]);
  });

  // A triage with perf as a third reviewer; review 1 has perf fail with F1 on b.txt:20 (correctness and security pass).
  const withPerf = () => appendEvent(root, { ts: '2026-10-14T09:30:00.000Z', kind: 'triage', task: 'T1', path: 'medium', sensitive: ['auth'],
    review: { ...review, flags: ['--sensitive', '--perf'], reviewers: [...review.reviewers, { role: 'review-perf', model: null, effort: 'medium', agent: 'forge-review-perf' }] } });

  it('an express correctness that breaks the rubric (a fail whose only finding is a critical without a file) answers nothing: held, never an accept (I3)', () => {
    withPerf();
    prep();
    write(r1(), 'correctness', { verdict: 'pass', confidence: 0.9, findings: [] });
    write(r1(), 'security', { verdict: 'pass', confidence: 0.9, findings: [] });
    write(r1(), 'perf', { verdict: 'fail', confidence: 0.8, findings: [{ severity: 'important', file: 'b.txt', line: 20, problem: 'slow loop over b' }] });
    expect(JSON.parse(close().stdout).action).toBe('fix');
    writeFileSync(path.join(wt, 'a.txt'), 'one\ntwo faster\n');
    git('commit', '-q', '-am', 'fix');
    expect(JSON.parse(prep().stdout)).toMatchObject({ express: true, delegated: ['perf'] });
    write(r2(), 'correctness', { verdict: 'fail', confidence: 0.9, findings: [{ severity: 'critical', problem: 'something looks off somewhere' }] });
    green();
    const out = JSON.parse(close().stdout);
    expect(out).toMatchObject({ action: 'fix', express: true, invalid: ['correctness'] });
    expect(out.reasons.some((x: string) => /correctness did not answer/.test(x))).toBe(true);
    expect(indexRound(2)).toEqual([expect.objectContaining({ id: 'F1', reviewer: 'perf', status: 'open' })]);
  });

  // Review 1: correctness F1 on a.txt:2, security passes, perf F2 on b.txt:20; then the express review 2 (delegated:
  // correctness and perf) and its fix commit, with `express2` the express correctness's file.
  const afterExpress = (express2: unknown) => {
    withPerf();
    prep();
    write(r1(), 'correctness', { verdict: 'fail', confidence: 0.8, findings: [{ severity: 'important', file: 'a.txt', line: 2, problem: 'wrong two' }] });
    write(r1(), 'security', { verdict: 'pass', confidence: 0.9, findings: [] });
    write(r1(), 'perf', { verdict: 'fail', confidence: 0.8, findings: [{ severity: 'important', file: 'b.txt', line: 20, problem: 'slow loop over b' }] });
    expect(JSON.parse(close().stdout).action).toBe('fix');
    writeFileSync(path.join(wt, 'a.txt'), 'one\ntwo fixed\n');
    git('commit', '-q', '-am', 'fix');
    expect(JSON.parse(prep().stdout)).toMatchObject({ express: true, carried: ['security'], delegated: ['correctness', 'perf'] });
    write(r2(), 'correctness', express2);
    green();
    expect(JSON.parse(close().stdout)).toMatchObject({ action: 'fix', express: true });
    writeFileSync(path.join(wt, 'a.txt'), 'one\ntwo fixed again\n');
    git('commit', '-q', '-am', 'fix 2');
  };
  const r3 = () => path.join(work(), 'reviews-1-3');

  it('after an express review asks for a fix, a reviewer delegated to it with a finding still open repeats in delta with it, never in full (I2)', () => {
    afterExpress({ verdict: 'fail', confidence: 0.8, findings: [{ severity: 'important', file: 'b.txt', line: 20, problem: 'slow loop over b', origin: 'previous', id: 'F2' }] });
    expect(indexRound(2).map((f: { id: string; reviewer: string; status: string }) => [f.id, f.reviewer, f.status])).toEqual([['F2', 'perf', 'open'], ['F1', 'correctness', 'closed']]);
    // Express again (one important left open, green validators): perf is delegated again, not reviewing in full.
    const express = JSON.parse(prep().stdout);
    expect(express).toMatchObject({ round: 3, express: true });
    expect(express.delegated).toContain('perf');
    expect(JSON.parse(readFileSync(path.join(r3(), 'previous-express.json'), 'utf8'))).toEqual([expect.objectContaining({ id: 'F2', reviewer: 'perf' })]);
    // A normal review 3: perf in delta with its open finding.
    writeFileSync(path.join(wt, '.forge', 'config.yaml'), 'review:\n  express: false\ndetect: false\nvalidators:\n  - name: check\n    cmd: node -e "process.exit(0)"\n');
    const normal = JSON.parse(prep().stdout);
    const perf = normal.spawn.find((s: { role: string }) => s.role === 'review-perf');
    expect(perf).toMatchObject({ mode: 'delta' });
    expect(perf.inputs.findings).toBe('.forge/work/T1/reviews-1-3/previous-perf.json');
    expect(JSON.parse(readFileSync(path.join(r3(), 'previous-perf.json'), 'utf8'))).toEqual([{ id: 'F2', severity: 'important', file: 'b.txt', line: 20, problem: 'slow loop over b', origin: 'previous' }]);
  });

  it('after an express review asks for a fix, a reviewer delegated to it whose findings it closed is carried as a pass (I2)', () => {
    afterExpress({ verdict: 'fail', confidence: 0.7, findings: [{ severity: 'important', file: 'a.txt', line: 2, problem: 'still wrong two', origin: 'previous', id: 'F1' }] });
    expect(indexRound(2).map((f: { id: string; status: string }) => [f.id, f.status])).toEqual([['F1', 'open'], ['F2', 'closed']]);
    const out = JSON.parse(prep().stdout);
    expect(out.carried).toEqual(expect.arrayContaining(['security', 'perf']));
    expect(out.spawn.map((s: { role: string }) => s.role)).not.toContain('review-perf');
    expect(JSON.parse(readFileSync(path.join(r3(), 'perf.json'), 'utf8'))).toEqual({ verdict: 'pass', confidence: 0.7, findings: [], carried: true });
    write(r3(), 'correctness', { verdict: 'pass', confidence: 0.9, findings: [] });
    green();
    expect(JSON.parse(close().stdout)).toMatchObject({ action: 'accept', next: 'done' });
  });

  it('with --no-cache the validate command it prints skips the cache too', () => {
    firstReview();
    const out = JSON.parse(prep('--no-cache').stdout);
    expect(out.express).toBe(true);
    expect(out.validators.cmd).toMatch(/ --cwd "[^"]+" --no-cache$/);
  });
});
