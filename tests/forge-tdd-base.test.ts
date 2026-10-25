import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, utimesSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { runTdd, sweepStale, tddForBrief, tddPending, tddPlan, tddFile, readTdd, type TddBriefCtx } from '../src/forge/tdd.js';
import { BUG_LINE } from '../src/forge/brief.js';
import { detectValidators } from '../src/forge/validators.js';
import { parseConfig } from '../src/forge/config.js';
import { defaultExec, defaultGit, repoReader } from '../src/forge/cli/exec.js';
import { useTempDirs } from './helpers/tmp.js';
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
 * and .venv hold an untracked sentinel.
 */
function fixture(o: { broken?: boolean; passing?: boolean; config?: string } = {}) {
  const root = tmp('tdd-base-');
  const wt = path.join(root, 'wt');
  const git = (...a: string[]) => execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', ...a], { cwd: wt, encoding: 'utf8' }).trim();
  const put = (f: string, text: string) => { mkdirSync(path.dirname(path.join(wt, f)), { recursive: true }); writeFileSync(path.join(wt, f), text); };
  put('.forge/config.yaml', o.config ?? CONFIG);
  put('.gitignore', 'node_modules/\n.venv/\n');
  put('run-tests.mjs', RUNNER);
  put('src/math.mjs', 'export const add = (a, b) => a + b;\n');
  put('tests/math.test.mjs', MATH_BASE + (o.broken ? "test('broken', () => { throw new Error('was broken'); });\n" : ''));
  put('node_modules/sentinel.txt', 'keep me\n');
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
  it('a BASE that cannot be checked out is no-checkout, with nothing left behind', () => {
    const f = fixture();
    const plan = tddPlan(f.ctx().validators, ['tests/math.test.mjs'], f.base, { git: defaultGit(f.wt), repo: repoReader(f.wt), platform: process.platform, repoDir: f.wt });
    expect(runTdd({ ...plan, base: '0'.repeat(40) }, f.ctx()).skipped).toBe('no-checkout');
    expect(tddForBrief(f.ctx({ base: '--output=x' })).check.skipped).toBe('no-checkout');
    expect(left(f.tmpRoot)).toEqual([]);
    expect(worktrees(f.wt)).toHaveLength(1);
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
