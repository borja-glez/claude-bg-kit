import { describe, it, expect } from 'vitest';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { parseConfig, ConfigError } from '../src/forge/config.js';
import { TDD_VERIFIED_LINE, BUG_LINE } from '../src/forge/brief.js';
import { readEvents } from '../src/forge/ledger.js';
import { isBugTask } from '../src/forge/triage.js';
import { run, type Io } from '../src/forge/cli/run.js';
import { newTestNames, classifyTdd, tddPlan, rootCauseOf, tddRow, readTdd, writeTdd, tddFile, sayTdd, TDD_MAX_FILES, type TddCheck } from '../src/forge/tdd.js';
import { blocking, type Validator } from '../src/forge/validators.js';
import { defaultGit, repoReader } from '../src/forge/cli/exec.js';
import { useTempDirs } from './helpers/tmp.js';
const tmp = useTempDirs();

const git = (dir: string, ...a: string[]) => execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', ...a], { cwd: dir, encoding: 'utf8' }).trim();
/** A committed repository (seven tracked files: never greenfield) with `config` as .forge/config.yaml and the plan fixture. */
function repo(config: string, files: Record<string, string> = {}): { dir: string; io: Io } {
  const dir = tmp('tdd-');
  mkdirSync(path.join(dir, '.forge'), { recursive: true });
  writeFileSync(path.join(dir, '.forge', 'config.yaml'), config);
  copyFileSync(new URL('./fixtures/plan.yaml', import.meta.url), path.join(dir, 'plan.yaml'));
  for (const f of ['a', 'b', 'c', 'd', 'e']) writeFileSync(path.join(dir, `${f}.ts`), `export const ${f} = 1;\n`);
  for (const [f, text] of Object.entries(files)) { mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); writeFileSync(path.join(dir, f), text); }
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  return { dir, io: { cwd: dir, now: () => new Date('2026-10-24T10:00:00.000Z'), env: { CLAUDE_CONFIG_DIR: tmp('cfg-') } } };
}

describe('tdd: verified, its brief line and the base failing by name (A9)', () => {
  it('parses tdd: verified, keeps off as the default and refuses an unknown mode', () => {
    expect(parseConfig('tdd: verified\n').tdd).toBe('verified');
    expect(parseConfig(null).tdd).toBe('off');
    expect(() => parseConfig('tdd: strict\n')).toThrow(ConfigError);
  });
  it('forge tdd and begin give the verified line with no superpowers installed', () => {
    const { io } = repo('tdd: verified\n');
    expect(JSON.parse(run(['tdd'], io).stdout)).toMatchObject({ tdd: 'verified', installed: false, line: TDD_VERIFIED_LINE });
    expect(JSON.parse(run(['begin', '--task', 'cart'], io).stdout).tdd).toEqual({ mode: 'verified', line: TDD_VERIFIED_LINE });
  });
  it('FORGE brief ends with the verified line, and carries no TDD line with tdd: off', () => {
    const on = repo('tdd: verified\n');
    expect(run(['brief', '--plan', 'plan.yaml', '--task', 'T001'], on.io).stdout.trimEnd().endsWith(TDD_VERIFIED_LINE)).toBe(true);
    const off = repo('tdd: off\n');
    expect(run(['brief', '--plan', 'plan.yaml', '--task', 'T001'], off.io).stdout).not.toContain('TDD:');
  });
  it('validate --baseline names the tests already failing on the base, only with tdd: verified', () => {
    const runner = "console.log(' FAIL  tests/a.test.ts > old'); console.log(' FAIL  tests/a.test.ts > new'); process.exit(1);\n";
    const baseline = JSON.stringify([{ validator: 'unit', ok: false, flaky: false, durationMs: 1, failures: ['FAIL tests/a.test.ts > old'], failing: ['tests/a.test.ts > old'], failingKnown: true }]);
    const config = 'detect: false\nvalidators:\n  - name: unit\n    cmd: node fail.mjs\n    kind: test\n';
    const line = (tdd: string) => {
      const { dir, io } = repo(`tdd: ${tdd}\n${config}`, { 'fail.mjs': runner });
      writeFileSync(path.join(dir, '.forge', 'b.json'), baseline);
      const r = run(['validate', '--all', '--baseline', '.forge/b.json'], io);
      expect(r.code).toBe(1);
      return r.stderr.split('\n').find(l => l.startsWith('already failing on the base by name'));
    };
    expect(line('verified')).toBe('already failing on the base by name (not yours): unit: tests/a.test.ts > old');
    expect(line('off')).toBeUndefined();
  });
});

describe('the bug route behind tdd: verified (A9)', () => {
  it('isBugTask reads bug wording in English and Spanish, and not features that only mention failures', () => {
    for (const t of ['Fix the crash when saving an empty cart', 'it crashes when the cart is empty', 'Login is broken after the upgrade', 'the export no longer works with CSV',
      'Regression in the date parser', 'it throws an exception on empty input', 'Bug: totals round the wrong way', 'Saving fails with large files',
      'Arregla el fallo al guardar pedidos vacíos', 'El login no funciona tras el cambio', 'error al exportar el CSV', 'regresión en el parser de fechas',
      'la app se cuelga al abrir el carrito', 'lanza una excepción con la entrada vacía', 'El guardado falla con ficheros grandes']) expect(isBugTask(t), t).toBe(true);
    for (const t of ['fix the typo in the README', 'Add a debug flag to the CLI', 'Handle errors in the parser', 'Add retry on network errors',
      'Add crash reporting to the app', 'Show a message when login fails', 'Si falla la red, reintenta', 'Añade un fallback para el idioma',
      'Document the `bug` label in CONTRIBUTING', 'Añade el botón de exportar',
      'Añade un aviso que no va a salir en móvil', 'Muestra un mensaje de error al guardar']) expect(isBugTask(t), t).toBe(false);
  });
  it('triage gives kind bug and its line from Small up, and logs it, only with tdd: verified', () => {
    const triage = (dir: string, io: Io, task: string, text: string) => {
      writeFileSync(path.join(dir, 'task.txt'), text);
      return JSON.parse(run(['triage', '--task', task, '--text-file', 'task.txt'], io).stdout);
    };
    const on = repo('tdd: verified\n');
    const small = triage(on.dir, on.io, 'b1', 'the export no longer works with an empty cart');
    expect(small).toMatchObject({ path: 'small', kind: 'bug', bugLine: BUG_LINE });
    expect(readEvents(on.dir).filter(e => e.kind === 'triage').at(-1)).toMatchObject({ task: 'b1', bug: true });
    const trivial = triage(on.dir, on.io, 'b2', 'fix the crash in a.ts');
    expect(trivial.path).toBe('trivial');
    expect(trivial).not.toHaveProperty('kind');
    const off = repo('tdd: off\n');
    const plain = triage(off.dir, off.io, 'b1', 'the export no longer works with an empty cart');
    expect(plain).not.toHaveProperty('kind');
    expect(plain).not.toHaveProperty('bugLine');
    expect(readEvents(off.dir).filter(e => e.kind === 'triage').at(-1)).not.toHaveProperty('bug');
  });
  it('FORGE brief adds the bug line after the TDD line to a plan task whose title reads as a bug', () => {
    const { dir, io } = repo('tdd: verified\n');
    const plan = path.join(dir, 'plan.yaml');
    writeFileSync(plan, readFileSync(plan, 'utf8').replace('title: Esquema de pedidos', 'title: Arregla el fallo al guardar pedidos vacíos'));
    expect(run(['brief', '--plan', 'plan.yaml', '--task', 'T001'], io).stdout).toContain(`\n${TDD_VERIFIED_LINE}\n\n${BUG_LINE}\n`);
    expect(run(['brief', '--plan', 'plan.yaml', '--task', 'T002'], io).stdout).not.toContain('Bug:');
    writeFileSync(path.join(dir, '.forge', 'config.yaml'), 'tdd: off\n');
    expect(run(['brief', '--plan', 'plan.yaml', '--task', 'T001'], io).stdout).not.toContain('Bug:');
  });
});

describe('what the TDD check reads and decides (A9)', () => {
  const VITEST: Validator = { name: 'test', cmd: 'npx vitest run', kind: 'test', affectedCmd: 'npx vitest related --run --passWithNoTests {files}', source: 'detected' };
  const PYTEST: Validator = { name: 'pytest', cmd: 'python -m pytest -q', kind: 'test', affectedCmd: 'python -m pytest -q {tests}', source: 'detected' };
  const GO: Validator = { name: 'go-test', cmd: 'go test ./...', kind: 'test', affectedCmd: 'go test {packages}', source: 'detected' };
  const PLAIN: Validator = { name: 'unit', cmd: 'node --test', kind: 'test', source: 'manual' };
  const q = (f: string) => (process.platform === 'win32' ? `"${f}"` : `'${f}'`);
  /** BASE with `files`, HEAD with `change` on top: the plan's git and files, and the paths HEAD changed. */
  const planRepo = (files: Record<string, string>, change: Record<string, string>) => {
    const { dir } = repo('tdd: verified\n', files);
    const base = git(dir, 'rev-parse', 'HEAD');
    for (const [f, text] of Object.entries(change)) { mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); writeFileSync(path.join(dir, f), text); }
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'head');
    const at = { git: defaultGit(dir), repo: repoReader(dir), platform: process.platform, repoDir: dir };
    return { dir, base, at, touched: Object.keys(change) };
  };
  const CHECK: TddCheck = { v: 1, key: 'k', base: 'b', validator: 'test', cmd: 'c', files: ['tests/a.test.ts'], red: ['tests/a.test.ts > a'],
    passedOnBase: ['tests/a.test.ts > b'], alreadyFailing: [], unjudged: [], skipped: null, note: null, durationMs: 5 };

  it('newTestNames reads the it/test titles and def test_* a diff adds, file by file', () => {
    const patch = [
      'diff --git a/tests/a.test.ts b/tests/a.test.ts', '--- a/tests/a.test.ts', '+++ b/tests/a.test.ts', '@@ -1,0 +2,9 @@',
      "+  it('adds two', () => {", '+  test("adds three", () => {', "+  it.only('focused', () => {", '+  it(`dyn ${n}`, () => {',
      "+describe('a suite', () => {", "+  // it('commented', () => {", "+  it.each([1, 2])('each %s', n => {", "+  it.skip('skipped', () => {", "-  it('removed', () => {",
      // A title that only moved (re-indented) is not new: the same trimmed line is removed.
      "-it('kept', () => {", "+  it('kept', () => {",
      'diff --git a/tests/test_b.py b/tests/test_b.py', '--- /dev/null', '+++ b/tests/test_b.py', '@@ -0,0 +1,3 @@',
      '+def test_b_one():', '+    async def test_b_two(self):', '+def helper():',
      'diff --git a/tests/gone.test.ts b/tests/gone.test.ts', '--- a/tests/gone.test.ts', '+++ /dev/null', '@@ -1 +0,0 @@', "-it('gone', () => {})",
    ].join('\n');
    expect(Object.fromEntries(newTestNames(patch))).toEqual({ 'tests/a.test.ts': ['adds two', 'adds three', 'focused'], 'tests/test_b.py': ['test_b_one', 'test_b_two'] });
  });
  it('classifyTdd: red by name, passed on BASE, already failing, and a file that does not load (vitest, pytest and jest output)', () => {
    const names = new Map([['tests/a.test.ts', ['adds two', 'still adds', 'old broken']], ['tests/fresh.test.ts', ['fresh works']]]);
    const out = [' FAIL  tests/a.test.ts > math > adds two', ' FAIL  tests/a.test.ts > old broken', ' FAIL  tests/fresh.test.ts [ tests/fresh.test.ts ]', 'Error: Failed to load url ../src/fresh.ts'].join('\n');
    expect(classifyTdd(['tests/a.test.ts', 'tests/fresh.test.ts'], names, { code: 1, output: out, timedOut: false }, 'test', new Set(['tests/a.test.ts > old broken']))).toEqual({
      red: ['tests/a.test.ts > adds two', 'tests/fresh.test.ts > fresh works'], passedOnBase: ['tests/a.test.ts > still adds'],
      alreadyFailing: ['tests/a.test.ts > old broken'], unjudged: [],
    });
    // A vitest workspace prefixes each failure with its project: |unit| tests/a.test.ts > ...
    const project = [' FAIL  |unit| tests/a.test.ts > math > adds two', ' FAIL  |unit| tests/fresh.test.ts [ tests/fresh.test.ts ]'].join('\n');
    expect(classifyTdd(['tests/a.test.ts', 'tests/fresh.test.ts'], names, { code: 1, output: project, timedOut: false }, 'test', new Set())).toMatchObject({
      red: ['tests/a.test.ts > adds two', 'tests/fresh.test.ts > fresh works'], passedOnBase: ['tests/a.test.ts > still adds', 'tests/a.test.ts > old broken'],
    });
    const py = classifyTdd(['tests/test_a.py'], new Map([['tests/test_a.py', ['test_x', 'test_y', 'test_p']]]),
      { code: 1, output: 'FAILED tests/test_a.py::test_x - assert 1 == 2\nFAILED tests/test_a.py::test_p[2] - assert 0\n', timedOut: false }, 'test', new Set());
    expect(py).toMatchObject({ red: ['tests/test_a.py > test_x', 'tests/test_a.py > test_p'], passedOnBase: ['tests/test_a.py > test_y'] });
    // jest: its header names the file (a bare entry, read as the file not loading only when the read is unknown) and ● the case.
    expect(classifyTdd(['src/a.test.js'], new Map([['src/a.test.js', ['adds two', 'still adds']]]), { code: 1, output: ' FAIL  src/a.test.js\n  ● math › adds two\n', timedOut: false }, 'test', new Set()))
      .toMatchObject({ red: ['src/a.test.js > adds two'], passedOnBase: ['src/a.test.js > still adds'] });
    // The same title in two files: a failure that names its file counts only for that file.
    const twice = new Map([['tests/a.test.ts', ['adds two']], ['tests/b.test.ts', ['adds two']]]);
    expect(classifyTdd(['tests/a.test.ts', 'tests/b.test.ts'], twice, { code: 1, output: ' FAIL  tests/b.test.ts > adds two\n', timedOut: false }, 'test', new Set()))
      .toMatchObject({ red: ['tests/b.test.ts > adds two'], passedOnBase: ['tests/a.test.ts > adds two'] });
  });
  it('classifyTdd never says passed on BASE when the run cannot tell: no test ran, a collection error, a timeout, no names', () => {
    const files = ['tests/test_a.py', 'tests/test_b.py'];
    const names = new Map([['tests/test_a.py', ['test_x']], ['tests/test_b.py', ['test_y']]]);
    const judged = (run: { code: number; output: string; timedOut: boolean }) => classifyTdd(files, names, run, 'test', new Set());
    expect(judged({ code: 0, output: 'No test files found, exiting with code 0\n', timedOut: false })).toMatchObject({ red: [], passedOnBase: [], unjudged: files });
    expect(judged({ code: 2, output: 'ERROR collecting tests/test_a.py\nImportError: cannot import name fresh\nInterrupted: 1 error during collection\n', timedOut: false }))
      .toMatchObject({ red: ['tests/test_a.py > test_x'], passedOnBase: [], unjudged: ['tests/test_b.py'] });
    expect(judged({ code: 1, output: 'timeout after 300 s', timedOut: true })).toMatchObject({ red: [], passedOnBase: [], unjudged: files });
    expect(judged({ code: 1, output: 'Error: the runner stopped\n', timedOut: false })).toMatchObject({ red: [], passedOnBase: [], unjudged: files });
    // --continue-on-collection-errors: test_b.py does not load and test_a.py ran. The FAILED line names test_a.py, yet it
    // loaded: test_x is red, and test_w, with the read unknown, leaves test_a.py unjudged (never red, never passed on BASE).
    const mixed = new Map([['tests/test_a.py', ['test_x', 'test_w']], ['tests/test_b.py', ['test_y']]]);
    const collect = '____ ERROR collecting tests/test_b.py ____\nFAILED tests/test_a.py::test_x - assert 1 == 2\nERROR tests/test_b.py\n';
    expect(classifyTdd(files, mixed, { code: 1, output: collect, timedOut: false }, 'test', new Set()))
      .toEqual({ red: ['tests/test_a.py > test_x', 'tests/test_b.py > test_y'], passedOnBase: [], alreadyFailing: [], unjudged: ['tests/test_a.py'] });
    expect(classifyTdd(['tests/c.test.ts'], new Map(), { code: 0, output: '', timedOut: false }, 'test', new Set())).toMatchObject({ passedOnBase: [], unjudged: ['tests/c.test.ts'] });
  });
  it('tddPlan picks the test validator and the changed test files, and keys them by BASE, the command, their content and the lockfiles', () => {
    const js = planRepo({ 'src/a.ts': 'x\n', 'tests/a.test.ts': "it('a', () => {})\n", 'package-lock.json': '{}\n' },
      { 'src/a.ts': 'y\n', 'tests/a.test.ts': "it('a', () => {})\nit('b', () => {})\n", 'tests/helpers/h.ts': 'export {};\n' });
    const p = tddPlan([VITEST], js.touched, js.base, js.at);
    expect(p).toMatchObject({ base: js.base, validator: 'test', kind: 'test', skipped: null, files: ['tests/a.test.ts'],
      overlay: ['tests/a.test.ts', 'tests/helpers/h.ts'], cmd: `npx vitest related --run --passWithNoTests ${q('tests/a.test.ts')}` });
    expect(tddPlan([VITEST], js.touched, js.base, js.at).key).toBe(p.key);
    writeFileSync(path.join(js.dir, 'tests', 'a.test.ts'), "it('a', () => {})\nit('c', () => {})\n");
    git(js.dir, 'commit', '-q', '-am', 'c');
    expect(tddPlan([VITEST], js.touched, js.base, js.at).key).not.toBe(p.key);
    const py = planRepo({ 'pkg/a.py': 'x = 1\n', 'tests/test_a.py': 'def test_a():\n    pass\n' },
      { 'pkg/a.py': 'x = 2\n', 'tests/test_a.py': 'def test_a():\n    pass\ndef test_b():\n    pass\n', 'tests/conftest.py': '\n' });
    expect(tddPlan([PYTEST], py.touched, py.base, py.at)).toMatchObject({
      validator: 'pytest', files: ['tests/test_a.py'], overlay: ['tests/test_a.py', 'tests/conftest.py'],
      cmd: `python -m pytest -q ${q('tests/test_a.py')} --continue-on-collection-errors`,
    });
  });
  it('tddPlan skips with its reason: no test file, Go or Rust, no related-tests command, too many, a changed lockfile, linked code', () => {
    const skip = (files: Record<string, string>, change: Record<string, string>, validators: Validator[] = [VITEST]) => {
      const r = planRepo(files, change);
      return tddPlan(validators, r.touched, r.base, r.at).skipped;
    };
    const T = { 'tests/a.test.ts': "it('a', () => {})\n" };
    const T2 = { 'tests/a.test.ts': "it('a', () => {})\nit('b', () => {})\n" };
    expect(skip({ 'src/a.ts': 'x\n' }, { 'src/a.ts': 'y\n' })).toBe('no-tests');
    expect(skip({ 'go.mod': 'module m\n', 'p/a.go': 'package p\n' }, { 'p/a.go': 'package p\n// x\n', 'p/a_test.go': 'package p\n' }, [GO])).toBe('same-package');
    expect(skip({ 'src/lib.rs': 'fn a() {}\n' }, { 'src/lib.rs': 'fn a() {}\n#[test] fn t() {}\n' }, [])).toBe('same-package');
    expect(skip(T, T2, [PLAIN])).toBe('no-command');
    const many = Object.fromEntries(Array.from({ length: TDD_MAX_FILES + 1 }, (_, i) => [`tests/t${i}.test.ts`, `it('t${i}', () => {})\n`]));
    expect(skip({ 'src/a.ts': 'x\n' }, many)).toBe('too-many');
    expect(skip({ ...T, 'package-lock.json': '{"a":1}\n' }, { ...T2, 'package-lock.json': '{"a":2}\n' })).toBe('lockfile');
    expect(skip({ ...T, 'package.json': '{"workspaces":["packages/*"]}\n' }, T2)).toBe('linked-code');
    for (const dep of ['"dependencies":{"x":"file:../x"}', '"devDependencies":{"x":"link:../x"}', '"optionalDependencies":{"x":"workspace:*"}']) {
      expect(skip({ ...T, 'package.json': `{${dep}}\n` }, T2), dep).toBe('linked-code');
    }
    expect(skip({ ...T, 'pnpm-workspace.yaml': 'packages: ["p/*"]\n' }, T2)).toBe('linked-code');
    // A venv that links the task's code: an editable install or a .pth that names the repository. A venv's own .pth
    // (setuptools' distutils-precedence.pth, in every venv) names no path of it and skips nothing.
    const venv = (site: string[], file: string, text: (dir: string) => string) => {
      const r = planRepo({ ...T, '.gitignore': '.venv/\n' }, T2);
      mkdirSync(path.join(r.dir, '.venv', ...site), { recursive: true });
      writeFileSync(path.join(r.dir, '.venv', ...site, file), text(r.dir));
      return tddPlan([VITEST], r.touched, r.base, r.at).skipped;
    };
    expect(venv(['Lib', 'site-packages'], '__editable__.pkg-0.1.pth', () => 'import __editable___pkg_finder\n')).toBe('linked-code');
    expect(venv(['Lib', 'site-packages'], 'pkg.egg-link', d => `${d}\n.\n`)).toBe('linked-code');
    expect(venv(['lib', 'python3.13', 'site-packages'], 'pkg.pth', d => `${d}\n`)).toBe('linked-code');
    expect(venv(['Lib', 'site-packages', 'pkg-0.1.dist-info'], 'direct_url.json', d => `{"url": "file:///${d.replace(/\\/g, '/')}", "dir_info": {"editable": true}}\n`)).toBe('linked-code');
    expect(venv(['Lib', 'site-packages', 'other-1.0.dist-info'], 'direct_url.json', () => '{"url": "file:///somewhere/else"}\n')).toBeNull();
    expect(venv(['Lib', 'site-packages'], 'distutils-precedence.pth', () => "import os; var = 'SETUPTOOLS_USE_DISTUTILS'\n")).toBeNull();
  });
  it('rootCauseOf reads the Root cause line of a report, and the row never turns the validators red', () => {
    expect(rootCauseOf('did x\nRoot cause: src/a.ts:12 - off by one\n')).toBe('src/a.ts:12 - off by one');
    expect(rootCauseOf('  root cause:   src/b.ts:3 - wrong default')).toBe('src/b.ts:3 - wrong default');
    expect(rootCauseOf('- `Root cause: src/c.ts:4 - bad index`')).toBe('src/c.ts:4 - bad index');
    expect(rootCauseOf('> **Root cause:** src/d.ts:5 - stale cache')).toBe('src/d.ts:5 - stale cache');
    expect(rootCauseOf('no such line')).toBeNull();
    expect(rootCauseOf(null)).toBeNull();
    expect(rootCauseOf(`Root cause: ${'x'.repeat(400)}`)).toHaveLength(300);
    const row = tddRow(CHECK, { rootCause: null });
    expect(row).toMatchObject({ validator: 'tdd', ok: true, flaky: false, durationMs: 5, failing: [], failingKnown: true, tdd: { ...CHECK, bug: { rootCause: null } } });
    expect(blocking(row)).toBe(false);
    expect(tddRow(CHECK, null).tdd).not.toHaveProperty('bug');
  });
  it('tdd-<n>.json round-trips, a broken or foreign one reads as none, and the say names why a check did not run', () => {
    const dir = tmp('tdd-file-');
    writeTdd(tddFile(dir, '1'), CHECK);
    expect(readTdd(tddFile(dir, '1'))).toEqual(CHECK);
    writeFileSync(tddFile(dir, '2'), '{"v":2}');
    writeFileSync(tddFile(dir, '3'), 'not json');
    for (const n of ['2', '3', '4']) expect(readTdd(tddFile(dir, n)), n).toBeNull();
    expect(sayTdd(CHECK, 'es')).not.toBe(sayTdd(CHECK, 'en'));
    expect(sayTdd({ ...CHECK, skipped: 'lockfile' }, 'en')).toContain('lockfile');
  });
});
