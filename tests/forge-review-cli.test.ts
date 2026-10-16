import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
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
  io = { cwd: root, now: () => new Date('2026-10-14T10:00:00.000Z') };
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

  it('a failing validator is summarised and review-prep still plans the review', () => {
    writeFileSync(path.join(wt, '.forge', 'config.yaml'), 'detect: false\nvalidators:\n  - name: check\n    cmd: node -e "process.exit(1)"\n');
    const out = JSON.parse(prep().stdout);
    expect(out.validators).toMatchObject({ ok: false, failing: ['check'] });
    expect(out.spawn).toHaveLength(2);
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
});

describe('forge review-close', () => {
  const close = (...extra: string[]) => run(['review-close', '--task', 'T1-1', '--dir', '.forge/work/T1', '--path', 'medium', '--cwd', wt, ...extra], io);
  const r1 = () => path.join(work(), 'reviews-1-1');
  const r2 = () => path.join(work(), 'reviews-1-2');
  const write = (dir: string, name: string, v: unknown) => writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(v));

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
    prep();
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
    prep();
    write(r1(), 'correctness', { verdict: 'fail', confidence: 0.8, findings: [{ severity: 'important', file: 'a.txt', line: 2, problem: 'wrong two' }] });
    write(r1(), 'security', { verdict: 'pass', confidence: 0.9, findings: [] });
    close();
    writeFileSync(path.join(wt, 'a.txt'), 'one\ntwo fixed\n');
    git('commit', '-q', '-am', 'fix');
    prep();
    write(r2(), 'correctness', { verdict: 'fail', confidence: 0.8, findings: [{ severity: 'important', file: path.join(wt, 'a.txt'), line: 2, problem: 'still wrong', origin: 'untouched' }] });
    const out = JSON.parse(close().stdout);
    expect(out.action).toBe('fix');
    expect(out.deferred).toEqual([]);
    expect(JSON.parse(readFileSync(path.join(work(), 'findings-1-2.json'), 'utf8')).findings[0]).toMatchObject({ problem: 'still wrong', origin: 'fix' });
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

  it('a missing twin is listed in review-close output and saves no case', () => {
    mkdirSync(path.join(root, '.forge'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'shadow.json'), JSON.stringify({ remaining: 2, cases: [] }));
    prep();
    write(r1(), 'correctness', { verdict: 'pass', confidence: 0.9, findings: [] });
    write(r1(), 'security', { verdict: 'pass', confidence: 0.9, findings: [] });
    const out = JSON.parse(close().stdout);
    expect(out.shadow).toBeUndefined();
    expect(out.shadowSkipped).toEqual([{ reviewer: 'security', reason: 'missing', file: '.forge/work/T1/reviews-1-1/shadow/security.json' }]);
    expect(JSON.parse(readFileSync(path.join(root, '.forge', 'shadow.json'), 'utf8')).cases).toEqual([]);
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
    prep();
    write(r1(), 'correctness', { verdict: 'fail', confidence: 0.8, findings: [{ severity: 'important', file: 'a.txt', line: 2, problem: 'wrong two' }] });
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

  it('requires its flags and a prepared round', () => {
    expect(run(['review-close', '--task', 'T1-1', '--dir', '.forge/work/T1'], io).code).toBe(2);
    expect(run(['review-close', '--task', 'T1', '--dir', '.forge/work/T1', '--path', 'medium'], io).code).toBe(2);
    const r = close();
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/review-prep/);
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
