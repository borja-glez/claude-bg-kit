import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
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

  it('review-close, prep and shadow are dispatched', () => {
    expect(run(['review-close'], io).code).toBe(2);
    expect(run(['review-close'], io).stderr).toMatch(/review-close/);
  });

  it('prep and shadow answer with a usage error until they exist', () => {
    for (const cmd of ['prep', 'shadow']) {
      const r = run([cmd], io);
      expect(r.code).toBe(2);
      expect(r.stderr).toContain(cmd);
      expect(r.stderr).not.toMatch(/^usage: forge </);
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
    expect(out).toMatchObject({ action: 'fix', next: 'resume', last: false, findings: '.forge/work/T1/findings-1-1.json', deferred: [], invalid: [] });
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

  it('requires its flags and a prepared round', () => {
    expect(run(['review-close', '--task', 'T1-1', '--dir', '.forge/work/T1'], io).code).toBe(2);
    expect(run(['review-close', '--task', 'T1', '--dir', '.forge/work/T1', '--path', 'medium'], io).code).toBe(2);
    const r = close();
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/review-prep/);
  });
});
