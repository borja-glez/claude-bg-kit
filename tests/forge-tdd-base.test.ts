import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, utimesSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { runTdd, sayTdd, sweepStale, tddForBrief, tddPending, tddPlan, tddFile, readTdd, writeTdd, type TddBriefCtx } from '../src/forge/tdd.js';
import { BUG_LINE } from '../src/forge/brief.js';
import { detectValidators } from '../src/forge/validators.js';
import { parseConfig } from '../src/forge/config.js';
import { defaultExec, defaultGit, repoReader } from '../src/forge/cli/exec.js';
import { useTempDirs } from './helpers/tmp.js';
import { run, type Io } from '../src/forge/cli/run.js';
import { appendEvent, readEvents } from '../src/forge/ledger.js';
const tmp = useTempDirs();

const RUNNER = [
  "import { readdirSync } from 'node:fs';", "import path from 'node:path';", "import { pathToFileURL } from 'node:url';",
  "const files = process.argv.length > 2 ? process.argv.slice(2) : readdirSync('tests').filter(f => f.endsWith('.test.mjs')).map(f => `tests/${f}`);",
  'let failed = false;',
  'for (const f of files) {',
  '  const tests = []; globalThis.test = (name, fn) => tests.push([name, fn]);',
  '  try { await import(pathToFileURL(path.resolve(f)).href); } catch (e) { console.log(` FAIL  ${f} [ ${f} ]`); console.log(`Error: ${e.message}`); failed = true; continue; }',
  '  for (const [name, fn] of tests) { try { await fn(); console.log(` ok ${f} > ${name}`); } catch { console.log(` FAIL  ${f} > ${name}`); failed = true; } }',
  '}',
  'process.exit(failed ? 1 : 0);',
].join('\n');
const CONFIG = 'tdd: verified\ndetect: false\nvalidators:\n  - name: unit\n    cmd: node run-tests.mjs\n    kind: test\n    affected_cmd: node run-tests.mjs {tests}\n';
const MATH_BASE = "import * as m from '../src/math.mjs';\ntest('add sums', () => { if (m.add(1, 2) !== 3) throw new Error('add'); });\n";

/**
 * root (forge's state) with wt (the code, its own git) inside. BASE: add, its test and, with `broken`, a test that already
 * fails (the baseline says so). HEAD: mul with a test that fails on BASE, a test that passes on BASE (unless `passing` is
 * false), a new test file whose module BASE lacks, and `broken` edited, so its title line is added again. node_modules
 * (unless `deps` is false) and .venv hold an untracked sentinel.
 */
function fixture(o: { broken?: boolean; passing?: boolean; config?: string; deps?: boolean } = {}) {
  const root = tmp('tdd-base-');
  const wt = path.join(root, 'wt');
  const git = (...a: string[]) => execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', ...a], { cwd: wt, encoding: 'utf8' }).trim();
  const put = (f: string, text: string) => { mkdirSync(path.dirname(path.join(wt, f)), { recursive: true }); writeFileSync(path.join(wt, f), text); };
  put('.forge/config.yaml', o.config ?? CONFIG);
  put('.gitignore', 'node_modules/\n.venv/\n');
  put('run-tests.mjs', RUNNER);
  put('src/math.mjs', 'export const add = (a, b) => a + b;\n');
  put('tests/math.test.mjs', MATH_BASE + (o.broken ? "test('broken', () => { throw new Error('was broken'); });\n" : ''));
  if (o.deps !== false) put('node_modules/sentinel.txt', 'keep me\n');
  put('.venv/sentinel.txt', 'keep me\n');
  git('init', '-q'); git('add', '-A'); git('commit', '-q', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  put('src/math.mjs', 'export const add = (a, b) => a + b;\nexport const mul = (a, b) => a * b;\n');
  put('tests/math.test.mjs', MATH_BASE + "test('mul multiplies', () => { if (m.mul(2, 3) !== 6) throw new Error('mul'); });\n"
    + (o.passing === false ? '' : "test('add still sums', () => { if (m.add(2, 2) !== 4) throw new Error('add'); });\n")
    + (o.broken ? "test('broken', () => { throw new Error('still broken'); });\n" : ''));
  put('src/fresh.mjs', 'export const fresh = () => 1;\n');
  put('tests/fresh.test.mjs', "import { fresh } from '../src/fresh.mjs';\ntest('fresh works', () => { if (fresh() !== 1) throw new Error('fresh'); });\n");
  git('add', '-A'); git('commit', '-q', '-m', 'head');
  const work = path.join(root, '.forge', 'work', 'T1');
  mkdirSync(work, { recursive: true });
  const baseline = o.broken ? [{ validator: 'unit', ok: false, flaky: false, durationMs: 1, failures: ['FAIL tests/math.test.mjs > broken'], failing: ['tests/math.test.mjs > broken'], failingKnown: true }] : [];
  writeFileSync(path.join(work, 'baseline-1.json'), JSON.stringify(baseline));
  const tmpRoot = tmp('tdd-root-');
  const ctx = (over: Partial<TddBriefCtx> = {}): TddBriefCtx => ({
    repoDir: wt, git: defaultGit(wt), execAt: defaultExec, timeoutSec: 60, baseline, tmpRoot, platform: process.platform,
    validators: detectValidators(repoReader(wt), parseConfig(o.config ?? CONFIG)), repo: repoReader(wt), base, dir: work, n: '1', ...over,
  });
  return { root, wt, git, put, base, work, tmpRoot, ctx };
}
const worktrees = (wt: string) => execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: wt, encoding: 'utf8' }).split('\n').filter(l => l.startsWith('worktree '));
const left = (tmpRoot: string) => readdirSync(tmpRoot).filter(f => f.startsWith('forge-tdd-'));

describe('the TDD check on BASE (A9)', () => {
  it('runs only the new test files on BASE: red by name, passing on BASE, already failing, and a file that does not load', () => {
    const f = fixture({ broken: true });
    const { check } = tddForBrief(f.ctx());
    // The files in git's order (touched comes from git diff --name-only).
    expect(check).toMatchObject({
      skipped: null, validator: 'unit', files: ['tests/fresh.test.mjs', 'tests/math.test.mjs'],
      red: ['tests/fresh.test.mjs > fresh works', 'tests/math.test.mjs > mul multiplies'],
      passedOnBase: ['tests/math.test.mjs > add still sums'], alreadyFailing: ['tests/math.test.mjs > broken'], unjudged: [],
    });
    expect(check.durationMs).toBeGreaterThan(0);
  });
  it('a test moved with its renamed file is not new: it never passes on BASE, and the tests HEAD adds are still judged', () => {
    const f = fixture();
    f.git('mv', 'tests/math.test.mjs', 'tests/sum.test.mjs');
    f.git('commit', '-q', '-m', 'rename');
    const { check } = tddForBrief(f.ctx());
    // add sums moved out of the deleted math.test.mjs; mul multiplies and add still sums are new in sum.test.mjs.
    expect(check).toMatchObject({
      skipped: null, files: ['tests/fresh.test.mjs', 'tests/sum.test.mjs'],
      red: ['tests/fresh.test.mjs > fresh works', 'tests/sum.test.mjs > mul multiplies'], passedOnBase: ['tests/sum.test.mjs > add still sums'], unjudged: [],
    });
  });
  it('links the task dependencies and never deletes through the link: after a pass and after a timeout', () => {
    const f = fixture();
    tddForBrief(f.ctx());
    const slow = fixture({ config: CONFIG.replace('affected_cmd: node run-tests.mjs {tests}', 'affected_cmd: node -e "setTimeout(() => {}, 20000)" {tests}') });
    expect(tddForBrief(slow.ctx({ timeoutSec: 1 })).check.skipped).toBe('timeout');
    for (const x of [f, slow]) {
      for (const d of ['node_modules', '.venv']) expect(readFileSync(path.join(x.wt, d, 'sentinel.txt'), 'utf8'), d).toBe('keep me\n');
      expect(left(x.tmpRoot)).toEqual([]);
      expect(worktrees(x.wt)).toHaveLength(1);
    }
  });
  it('another worktree of the clone whose folder is gone keeps its entry: the check removes only its own', () => {
    const f = fixture();
    const other = path.join(f.root, 'other');
    f.git('worktree', 'add', '--detach', '-q', other, f.base);
    rmSync(other, { recursive: true, force: true });
    tddForBrief(f.ctx());
    expect(worktrees(f.wt)).toHaveLength(2);
  });
  it('a stale forge-tdd folder of a check that died is cleared without touching what its link points to', () => {
    const f = fixture();
    const target = tmp('tdd-target-');
    writeFileSync(path.join(target, 'sentinel.txt'), 'keep me\n');
    const stale = path.join(f.tmpRoot, 'forge-tdd-old');
    mkdirSync(path.join(stale, 'base'), { recursive: true });
    symlinkSync(target, path.join(stale, 'base', 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    const old = new Date(Date.now() - 2 * 60 * 60_000);
    utimesSync(stale, old, old);
    expect(sweepStale(f.tmpRoot, Date.now())).toEqual([stale]);
    expect(existsSync(stale)).toBe(false);
    expect(readFileSync(path.join(target, 'sentinel.txt'), 'utf8')).toBe('keep me\n');
  });
  it('a BASE that cannot be checked out is no-checkout, says why in note, leaves nothing behind and names no file', () => {
    const f = fixture();
    const plan = tddPlan(f.ctx().validators, ['tests/math.test.mjs'], f.base, { git: defaultGit(f.wt), repo: repoReader(f.wt), platform: process.platform, repoDir: f.wt });
    const zero = '0'.repeat(40);
    expect(runTdd({ ...plan, base: zero }, f.ctx())).toMatchObject({ skipped: 'no-checkout', note: `git worktree add failed for ${zero}` });
    // The tdd-1.json of an earlier check (another key) stays on disk, and the output names no file: none holds this check.
    expect(tddForBrief(f.ctx()).file).toBe(tddFile(f.work, '1'));
    expect(tddForBrief(f.ctx({ base: '--output=x' }))).toMatchObject({ file: null, check: { skipped: 'no-checkout' } });
    expect(existsSync(tddFile(f.work, '1'))).toBe(true);
    expect(left(f.tmpRoot)).toEqual([]);
    expect(worktrees(f.wt)).toHaveLength(1);
  });
  it('a check that cannot be written names no file', () => {
    const f = fixture();
    mkdirSync(tddFile(f.work, '1'));
    expect(tddForBrief(f.ctx())).toMatchObject({ file: null, reused: false, check: { skipped: null, passedOnBase: ['tests/math.test.mjs > add still sums'] } });
  });
  it('a bare node runs without node_modules: only a package manager, a runner or a script from node_modules needs them', () => {
    const f = fixture({ deps: false });
    expect(tddForBrief(f.ctx()).check).toMatchObject({
      skipped: null, red: ['tests/fresh.test.mjs > fresh works', 'tests/math.test.mjs > mul multiplies'], passedOnBase: ['tests/math.test.mjs > add still sums'],
    });
    const ran: string[] = [];
    const t = fixture({ deps: false, config: CONFIG.replace('affected_cmd: node run-tests.mjs {tests}', 'affected_cmd: node --test {tests}') });
    const check = tddForBrief(t.ctx({ execAt: cwd => { const exec = defaultExec(cwd); return (cmd, s) => { ran.push(cmd); return exec(cmd, s); }; } })).check;
    expect(check).toMatchObject({ skipped: null, cmd: expect.stringMatching(/^node --test /) });
    expect(ran).toEqual([check.cmd]);
  });
  it('reuses tdd-<n>.json while the test files do not change, runs again when one does, and tddPending says when the express review waits', () => {
    const f = fixture();
    let runs = 0;
    const counted = f.ctx({ execAt: cwd => { const exec = defaultExec(cwd); return (cmd, s) => { runs++; return exec(cmd, s); }; } });
    expect(tddPending(counted)).toBe(true);
    expect(tddForBrief(counted).reused).toBe(false);
    expect(tddForBrief(counted).reused).toBe(true);
    expect(runs).toBe(1);
    expect(tddPending(counted)).toBe(true);
    f.put('tests/math.test.mjs', MATH_BASE + "test('mul multiplies', () => { if (m.mul(2, 3) !== 6) throw new Error('mul'); });\n");
    f.git('commit', '-q', '-am', 'drop the test that proves nothing');
    const again = tddForBrief(counted);
    expect(again).toMatchObject({ reused: false, check: { passedOnBase: [] } });
    expect(runs).toBe(2);
    expect(readTdd(tddFile(f.work, '1'))).toEqual(again.check);
    expect(tddPending(counted)).toBe(false);
  });
  it('a check that timed out or could not check out BASE runs once more; the second is kept, with both reasons in note', () => {
    const slow = fixture({ config: CONFIG.replace('affected_cmd: node run-tests.mjs {tests}', 'affected_cmd: node -e "setTimeout(() => {}, 20000)" {tests}') });
    let runs = 0;
    const counted = (over: Partial<TddBriefCtx> = {}) => slow.ctx({ timeoutSec: 1, execAt: cwd => { const exec = defaultExec(cwd); return (cmd, s) => { runs++; return exec(cmd, s); }; }, ...over });
    const file = tddFile(slow.work, '1');
    // The first is written under its key, marked to be retried, and the output names its file.
    const first = tddForBrief(counted());
    expect(first).toMatchObject({ reused: false, file, check: { skipped: 'timeout', retry: true } });
    expect(readTdd(file)).toEqual(first.check);
    expect(tddPending(counted())).toBe(true);
    // The second under the same key, here a no-checkout, is kept like any other result.
    const second = tddForBrief(counted({ tmpRoot: path.join(slow.root, 'no', 'such') }));
    expect(second).toMatchObject({ reused: false, file, check: { skipped: 'no-checkout', note: expect.stringMatching(/^kept after two attempts: timeout, then no-checkout \(ENOENT/) } });
    expect(second.check).not.toHaveProperty('retry');
    expect(readTdd(file)).toEqual(second.check);
    expect(tddPending(counted())).toBe(false);
    expect(tddForBrief(counted())).toMatchObject({ reused: true, file, check: second.check });
    expect(runs).toBe(1);
  });
  it('a first no-checkout keeps its error in note and is run again: a result that holds is written as always', () => {
    const f = fixture();
    const file = tddFile(f.work, '1');
    const missing = { tmpRoot: path.join(f.root, 'no', 'such') };
    const lost = tddForBrief(f.ctx(missing));
    expect(lost).toMatchObject({ file, check: { skipped: 'no-checkout', retry: true, note: expect.stringMatching(/^ENOENT/) } });
    expect(tddPending(f.ctx())).toBe(true);
    const ok = tddForBrief(f.ctx());
    expect(ok).toMatchObject({ reused: false, file, check: { skipped: null, red: ['tests/fresh.test.mjs > fresh works', 'tests/math.test.mjs > mul multiplies'] } });
    expect(readTdd(file)).toEqual(ok.check);
    expect(ok.check).not.toHaveProperty('retry');
    // A first attempt stored under another key does not count: this one is a first attempt too.
    writeTdd(file, { ...lost.check, key: 'another' });
    expect(tddForBrief(f.ctx(missing)).check).toMatchObject({ skipped: 'no-checkout', retry: true, note: expect.stringMatching(/^ENOENT/) });
  });
  it('a runner that stopped early leaves the tests it did not report unjudged, and says why in note', () => {
    const stop = "node -e \"console.log(' FAIL  tests/math.test.mjs > mul multiplies'); console.log('!!! stopping after 1 failures !!!'); process.exit(1)\" {tests}";
    const f = fixture({ config: CONFIG.replace('affected_cmd: node run-tests.mjs {tests}', `affected_cmd: ${stop}`) });
    expect(tddForBrief(f.ctx()).check).toMatchObject({
      skipped: null, red: ['tests/math.test.mjs > mul multiplies'], passedOnBase: [], unjudged: ['tests/fresh.test.mjs', 'tests/math.test.mjs'],
      note: 'not judged: the runner stopped early (stopping after 1 failures)',
    });
  });
  it('a test file in a folder whose name starts with .. is written over BASE and judged', () => {
    const f = fixture();
    f.put('..foo/dots.test.mjs', "test('dots', () => { throw new Error('new'); });\n");
    f.git('add', '-A'); f.git('commit', '-q', '-m', 'dots');
    expect(tddForBrief(f.ctx()).check).toMatchObject({ skipped: null, red: expect.arrayContaining(['..foo/dots.test.mjs > dots']) });
  });
  it('a brief with the Bug: line gets the root cause of its report, null without the line in the report, and none without the Bug: line', () => {
    const f = fixture();
    writeFileSync(path.join(f.work, 'brief-1.md'), `# T1\n\n${BUG_LINE}\n`);
    writeFileSync(path.join(f.work, 'report-1.txt'), 'fixed mul\nRoot cause: src/math.mjs:2 - mul was missing\n');
    expect(tddForBrief(f.ctx()).row.tdd.bug).toEqual({ rootCause: 'src/math.mjs:2 - mul was missing' });
    writeFileSync(path.join(f.work, 'report-1.txt'), 'fixed mul\n');
    expect(tddForBrief(f.ctx()).row.tdd.bug).toEqual({ rootCause: null });
    writeFileSync(path.join(f.work, 'brief-1.md'), '# T1\n');
    expect(tddForBrief(f.ctx()).row.tdd).not.toHaveProperty('bug');
  });
});

describe('forge tdd check (A9)', () => {
  const io = (f: { root: string }): Io => ({ cwd: f.root, now: () => new Date('2026-10-24T10:00:00.000Z'), env: { CLAUDE_CONFIG_DIR: tmp('cfg-') } });
  const args = (f: { base: string; wt: string }) => ['tdd', 'check', '--task', 'T1-1', '--base', f.base, '--dir', '.forge/work/T1', '--cwd', f.wt];
  it('runs the check of a brief, writes tdd-<n>.json and prints it, with its say only under --locale', () => {
    const f = fixture();
    const r = run([...args(f), '--locale', 'en'], io(f));
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out).toMatchObject({ file: '.forge/work/T1/tdd-1.json', reused: false, passedOnBase: ['tests/math.test.mjs > add still sums'] });
    expect(typeof out.say).toBe('string');
    expect(readTdd(path.join(f.work, 'tdd-1.json'))).toMatchObject({ passedOnBase: out.passedOnBase });
    const again = JSON.parse(run(args(f), io(f)).stdout);
    expect(again).toMatchObject({ reused: true });
    expect(again).not.toHaveProperty('say');
  });
  it('prints file null when tdd-<n>.json could not be written', () => {
    const f = fixture();
    mkdirSync(path.join(f.work, 'tdd-1.json'));
    const r = run(args(f), io(f));
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ file: null, reused: false, skipped: null, passedOnBase: ['tests/math.test.mjs > add still sums'] });
  });
  it('refuses without tdd: verified, without its flags, or with a base that is not HEAD or below it, and writes nothing', () => {
    const off = fixture({ config: CONFIG.replace('tdd: verified', 'tdd: off') });
    expect(run(args(off), io(off)).code).toBe(2);
    const f = fixture();
    expect(run(['tdd', 'check', '--task', 'T1-1', '--cwd', f.wt], io(f)).code).toBe(2);
    expect(run(['tdd', 'check', '--task', 'T1', '--base', f.base, '--dir', '.forge/work/T1', '--cwd', f.wt], io(f)).code).toBe(2);
    const loose = f.git('commit-tree', `${f.base}^{tree}`, '-m', 'not below HEAD');
    expect(run(['tdd', 'check', '--task', 'T1-1', '--base', loose, '--dir', '.forge/work/T1', '--cwd', f.wt], io(f)).code).toBe(2);
    for (const x of [off, f]) expect(existsSync(path.join(x.work, 'tdd-1.json'))).toBe(false);
  });
});

describe('review-prep with tdd: verified (A9)', () => {
  const REVIEW = { light: false, flags: [], reviewers: [{ role: 'review-correctness', model: null, effort: 'high', agent: 'forge-review-correctness' }] };
  const setup = (o: Parameters<typeof fixture>[0] = {}) => {
    const f = fixture(o);
    writeFileSync(path.join(f.work, 'brief-1.md'), '# T1\n');
    const io: Io = { cwd: f.root, now: () => new Date('2026-10-24T10:00:00.000Z'), env: { CLAUDE_CONFIG_DIR: tmp('cfg-') } };
    appendEvent(f.root, { ts: '2026-10-24T09:00:00.000Z', kind: 'triage', task: 'T1', path: 'medium', sensitive: [], review: REVIEW });
    const prep = (...extra: string[]) => JSON.parse(run(['review-prep', '--task', 'T1-1', '--path', 'medium', '--base', f.base, '--baseline', '.forge/work/T1/baseline-1.json',
      '--dir', '.forge/work/T1', '--cwd', f.wt, ...extra], io).stdout);
    const close = () => JSON.parse(run(['review-close', '--task', 'T1-1', '--dir', '.forge/work/T1', '--path', 'medium', '--cwd', f.wt], io).stdout);
    return { ...f, io, prep, close };
  };
  const rows = (work: string) => JSON.parse(readFileSync(path.join(work, 'validators-1.json'), 'utf8')) as { validator: string; ok: boolean }[];

  it('appends the tdd row to validators-<n>.json and prints it; the ledger validate event and the validators verdict do not change', () => {
    const f = setup();
    const out = f.prep('--locale', 'en');
    expect(out.validators).toMatchObject({ ok: true, failing: [], preexisting: [] });
    expect(out.tdd).toMatchObject({ file: '.forge/work/T1/tdd-1.json', red: 2, passedOnBase: ['tests/math.test.mjs > add still sums'], skipped: null, reused: false });
    expect(out.say).toContain(sayTdd(readTdd(tddFile(f.work, '1'))!, 'en'));
    expect(rows(f.work).map(r => [r.validator, r.ok])).toEqual([['unit', true], ['tdd', true]]);
    expect(readEvents(f.root).filter(e => e.kind === 'validate').at(-1)!.results).toEqual([expect.objectContaining({ validator: 'unit' })]);
    expect(out.spawn[0].inputs.report).toBeUndefined();
  });
  it('prints tdd.file null when tdd-<n>.json could not be written', () => {
    const f = setup();
    mkdirSync(path.join(f.work, 'tdd-1.json'));
    expect(f.prep().tdd).toMatchObject({ file: null, red: 2, skipped: null, reused: false });
  });
  it('without the option nothing changes: no tdd row, no tdd output, no tdd-<n>.json', () => {
    const f = setup({ config: CONFIG.replace('tdd: verified', 'tdd: off') });
    expect(f.prep()).not.toHaveProperty('tdd');
    expect(rows(f.work).map(r => r.validator)).toEqual(['unit']);
    expect(existsSync(path.join(f.work, 'tdd-1.json'))).toBe(false);
  });
  it('a validators round runs no TDD check', () => {
    const f = setup({ config: CONFIG.replace('cmd: node run-tests.mjs\n', 'cmd: node -e "process.exit(1)"\n') });
    const out = f.prep();
    expect(out.validatorsRound).toBeDefined();
    expect(out).not.toHaveProperty('tdd');
    expect(existsSync(path.join(f.work, 'tdd-1.json'))).toBe(false);
  });
  it('a later round reuses the check while the test files did not change, and runs it again when one did', () => {
    const f = setup();
    expect(f.prep().tdd.reused).toBe(false);
    appendEvent(f.root, { ts: '2026-10-24T10:30:00.000Z', kind: 'verdict', task: 'T1-1', dir: '.forge/work/T1/reviews-1-1', action: 'fix' });
    expect(f.prep()).toMatchObject({ round: 2, tdd: { reused: true } });
    f.put('tests/math.test.mjs', MATH_BASE + "test('mul multiplies', () => { if (m.mul(2, 3) !== 6) throw new Error('mul'); });\n");
    f.git('commit', '-q', '-am', 'drop the test that proves nothing');
    expect(f.prep().tdd).toMatchObject({ reused: false, passedOnBase: [] });
  });
  it('no express review while a test passes on BASE; with every new test red and the tests unchanged, the express review is back', () => {
    // As firstReview of describe('the express review (measure 7)') in tests/forge-review-cli.test.ts: review 1 asks to fix
    // one important finding with green validators, and the implementer commits a fix that touches no test file.
    const second = (passing: boolean) => {
      const f = setup({ passing });
      f.prep();
      writeFileSync(path.join(f.work, 'reviews-1-1', 'correctness.json'),
        JSON.stringify({ verdict: 'fail', confidence: 0.8, findings: [{ severity: 'important', file: 'src/math.mjs', line: 2, problem: 'mul is wrong' }] }));
      expect(f.close()).toMatchObject({ action: 'fix', next: 'resume' });
      f.put('src/math.mjs', 'export const add = (a, b) => a + b;\nexport const mul = (a, b) => a * b; // checked\n');
      f.git('commit', '-q', '-am', 'fix');
      return f.prep();
    };
    expect(second(true)).not.toHaveProperty('express');
    expect(second(false)).toMatchObject({ express: true });
  });
  it('correctness gets the report for a brief with the Bug: line, and the row carries its root cause', () => {
    const f = setup();
    writeFileSync(path.join(f.work, 'brief-1.md'), `# T1\n\n${BUG_LINE}\n`);
    writeFileSync(path.join(f.work, 'report-1.txt'), 'Root cause: src/math.mjs:2 - mul was missing\n');
    const out = f.prep();
    expect(out.spawn[0].inputs.report).toBe('.forge/work/T1/report-1.txt');
    expect(rows(f.work).at(-1)).toMatchObject({ validator: 'tdd', tdd: { bug: { rootCause: 'src/math.mjs:2 - mul was missing' } } });
  });
});
