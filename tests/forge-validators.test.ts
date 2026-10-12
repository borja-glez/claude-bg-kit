import { describe, it, expect } from 'vitest';
import { detectValidators, selectValidators, runValidators, failureLines, globMatch, markPreexisting, blocking, type RepoReader, type Validator, type Scope } from '../src/forge/validators.js';
import { parseConfig } from '../src/forge/config.js';

// list(dir) returns the direct entries of dir, like readdirSync.
const repo = (files: Record<string, string>): RepoReader => ({
  exists: f => f in files, read: f => files[f] ?? null,
  list: dir => [...new Set(Object.keys(files).filter(k => !dir || k.startsWith(`${dir}/`)).map(k => (dir ? k.slice(dir.length + 1) : k).split('/')[0]))],
});
const cfg = parseConfig(null);

describe('detectValidators', () => {
  it('npm scripts in a fixed order, npm by default', () => {
    const v = detectValidators(repo({ 'package.json': JSON.stringify({ scripts: { build: 'x', test: 'vitest run', lint: 'eslint .', typecheck: 'tsc' } }) }), cfg);
    expect(v.map(x => [x.name, x.cmd, x.kind])).toEqual([
      ['typecheck', 'npm run typecheck', 'typecheck'], ['lint', 'npm run lint', 'lint'], ['test', 'npm test', 'test'], ['build', 'npm run build', 'build'],
    ]);
  });
  it('pnpm and yarn lockfiles pick the runner', () => {
    const pkg = JSON.stringify({ scripts: { test: 'x' } });
    expect(detectValidators(repo({ 'package.json': pkg, 'pnpm-lock.yaml': '' }), cfg)[0].cmd).toBe('pnpm test');
    expect(detectValidators(repo({ 'package.json': pkg, 'yarn.lock': '' }), cfg)[0].cmd).toBe('yarn test');
  });
  it('ignores the npm placeholder test script', () => {
    expect(detectValidators(repo({ 'package.json': JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }) }), cfg)).toEqual([]);
  });
  it('python, rust, go, dotnet and make', () => {
    expect(detectValidators(repo({ 'pyproject.toml': '[tool.pytest.ini_options]\n' }), cfg, () => false).map(v => v.cmd)).toEqual(['python -m pytest -q']);
    expect(detectValidators(repo({ 'Cargo.toml': '' }), cfg).map(v => v.cmd)).toEqual(['cargo test']);
    expect(detectValidators(repo({ 'go.mod': '' }), cfg).map(v => v.cmd)).toEqual(['go vet ./...', 'go test ./...']);
    expect(detectValidators(repo({ 'App.sln': '' }), cfg).map(v => v.cmd)).toEqual(['dotnet test App.sln']);
    expect(detectValidators(repo({ Makefile: 'build:\n\tcc x\ntest:\n\t./t\n' }), cfg).map(v => v.cmd)).toEqual(['make test']);
  });
  it('pytest prefers the project .venv, then python3 on PATH, then python', () => {
    const py = { 'pytest.ini': '' };
    const none = () => false;
    expect(detectValidators(repo({ ...py, '.venv/bin/python': '' }), cfg, none)[0].cmd).toBe('.venv/bin/python -m pytest -q');
    expect(detectValidators(repo({ ...py, '.venv/Scripts/python.exe': '' }), cfg, none)[0].cmd).toBe('.venv\\Scripts\\python.exe -m pytest -q');
    const asked: string[] = [];
    expect(detectValidators(repo(py), cfg, n => { asked.push(n); return n === 'python3'; })[0].cmd).toBe('python3 -m pytest -q');
    expect(asked).toEqual(['python3']);
    expect(detectValidators(repo(py), cfg, none)[0].cmd).toBe('python -m pytest -q');
  });
  it('make test needs a rule, not a variable assignment, in any makefile spelling', () => {
    expect(detectValidators(repo({ Makefile: 'test := unit\ntest ?= x\ntest:= y\n' }), cfg)).toEqual([]);
    expect(detectValidators(repo({ makefile: 'test :\n\t./t\n' }), cfg).map(v => v.cmd)).toEqual(['make test']);
    expect(detectValidators(repo({ GNUmakefile: 'test: build\n\t./t\n' }), cfg).map(v => v.cmd)).toEqual(['make test']);
  });
  it('dotnet: one root solution (.sln or .slnx), else one root project, else none', () => {
    const cmds = (files: Record<string, string>) => detectValidators(repo(files), cfg).map(v => v.cmd);
    expect(cmds({ 'App.slnx': '' })).toEqual(['dotnet test App.slnx']);
    expect(cmds({ 'App.sln': '', 'src/Lib/Lib.csproj': '', 'Tool.csproj': '' })).toEqual(['dotnet test App.sln']);
    expect(cmds({ 'Lib.csproj': '' })).toEqual(['dotnet test Lib.csproj']);
    expect(cmds({ 'My App.sln': '' })).toEqual(['dotnet test "My App.sln"']);
    expect(cmds({ 'A.sln': '', 'B.slnx': '' })).toEqual([]);
    expect(cmds({ 'A.csproj': '', 'B.csproj': '' })).toEqual([]);
    expect(cmds({ 'src/Lib/Lib.csproj': '' })).toEqual([]);
  });
  it('bun lockfiles pick bun', () => {
    const pkg = JSON.stringify({ scripts: { test: 'x', lint: 'y' } });
    expect(detectValidators(repo({ 'package.json': pkg, 'bun.lock': '' }), cfg).map(v => v.cmd)).toEqual(['bun run lint', 'bun test']);
    expect(detectValidators(repo({ 'package.json': pkg, 'bun.lockb': '' }), cfg).map(v => v.cmd)).toEqual(['bun run lint', 'bun test']);
  });
  it('pytest also from setup.cfg, conftest.py or tests/test_*.py', () => {
    const none = () => false;
    const has = (files: Record<string, string>) => detectValidators(repo(files), cfg, none).map(v => v.name);
    expect(has({ 'setup.cfg': '[metadata]\nname = x\n\n[tool:pytest]\naddopts = -q\n' })).toEqual(['pytest']);
    expect(has({ 'setup.cfg': '[metadata]\nname = x\n' })).toEqual([]);
    expect(has({ 'conftest.py': '' })).toEqual(['pytest']);
    expect(has({ 'tests/test_core.py': '' })).toEqual(['pytest']);
    expect(has({ 'tests/helpers.py': '', 'tests/deep/test_x.py': '' })).toEqual([]);
  });
  const pkg = (scripts: Record<string, string>) => JSON.stringify({ scripts });
  it('detect: false with an empty list means none (0.5.x behaviour)', () => {
    const c = parseConfig('detect: false\nvalidators: []\n');
    expect(detectValidators(repo({ 'package.json': pkg({ test: 'x' }) }), c)).toEqual([]);
  });
  it('detect: false keeps only the manual list', () => {
    const c = parseConfig('detect: false\nvalidators:\n  - name: e2e\n    cmd: npm run e2e\n');
    expect(detectValidators(repo({ 'package.json': pkg({ test: 'x' }) }), c)).toEqual([{ name: 'e2e', cmd: 'npm run e2e', kind: 'other', source: 'manual' }]);
  });
  it('a manual list no longer turns detection off: both are used, manual wins by name', () => {
    const c = parseConfig('validators:\n  - name: test\n    cmd: npm run test:ci\n    kind: test\n  - name: unit\n    cmd: npm run unit\n');
    expect(detectValidators(repo({ 'package.json': pkg({ lint: 'eslint .', test: 'vitest' }) }), c).map(v => [v.name, v.cmd, v.source])).toEqual([
      ['lint', 'npm run lint', 'detected'], ['test', 'npm run test:ci', 'manual'], ['unit', 'npm run unit', 'manual'],
    ]);
  });
  it('a detected validator with the same command as a manual one is dropped', () => {
    const c = parseConfig('validators:\n  - name: unit\n    cmd: "  npm   test "\n');
    expect(detectValidators(repo({ 'package.json': pkg({ lint: 'eslint .', test: 'vitest' }) }), c).map(v => v.name)).toEqual(['lint', 'unit']);
  });
  it('exclude drops detected validators by name', () => {
    const c = parseConfig('exclude: [build, nope]\n');
    expect(detectValidators(repo({ 'package.json': pkg({ test: 'x', build: 'y' }) }), c).map(v => v.name)).toEqual(['test']);
  });
  it('e2e and bench scripts', () => {
    const v = detectValidators(repo({ 'package.json': pkg({ test: 'x', 'test:e2e': 'playwright test', bench: 'node b.js' }), 'playwright.config.ts': '' }), cfg);
    expect(v.map(x => [x.name, x.cmd, x.kind])).toEqual([
      ['test', 'npm test', 'test'], ['test:e2e', 'npm run test:e2e', 'e2e'], ['bench', 'npm run bench', 'bench'],
    ]);
  });
  it('playwright, cypress and detox configs when no e2e script exists', () => {
    const cmds = (files: Record<string, string>) => detectValidators(repo({ 'package.json': pkg({}), ...files }), cfg).map(v => [v.name, v.cmd, v.kind]);
    expect(cmds({ 'playwright.config.mjs': '' })).toEqual([['playwright', 'npx playwright test', 'e2e']]);
    expect(cmds({ 'cypress.config.js': '' })).toEqual([['cypress', 'npx cypress run', 'e2e']]);
    expect(cmds({ '.detoxrc.json': '' })).toEqual([['detox', 'npx detox test', 'e2e']]);
    expect(cmds({ 'detox.config.js': '' })).toEqual([['detox', 'npx detox test', 'e2e']]);
  });
  it('flutter', () => {
    expect(detectValidators(repo({ 'pubspec.yaml': 'name: app\n' }), cfg).map(v => [v.name, v.cmd, v.kind])).toEqual([
      ['flutter-analyze', 'flutter analyze', 'lint'], ['flutter-test', 'flutter test', 'test'],
    ]);
  });
  it('flutter with an android folder gets no gradle validators', () => {
    const files = { 'pubspec.yaml': 'name: app\n', 'android/gradlew': '', 'android/app/build.gradle': "plugins { id 'com.android.application' }" };
    expect(detectValidators(repo(files), cfg, () => false, 'linux').map(v => v.name)).toEqual(['flutter-analyze', 'flutter-test']);
  });
  it('native android with gradle, gradlew.bat on Windows, nothing when package.json exists', () => {
    const android = { gradlew: '', 'app/build.gradle': "plugins { id 'com.android.application' }" };
    expect(detectValidators(repo(android), cfg, () => false, 'linux').map(v => v.cmd)).toEqual(['./gradlew lint', './gradlew testDebugUnitTest']);
    expect(detectValidators(repo(android), cfg, () => false, 'win32').map(v => v.cmd)).toEqual(['gradlew.bat lint', 'gradlew.bat testDebugUnitTest']);
    const sub = { 'android/gradlew': '', 'android/app/build.gradle.kts': 'id("com.android.application")' };
    expect(detectValidators(repo(sub), cfg, () => false, 'linux').map(v => v.cmd)).toEqual(['cd android && ./gradlew lint', 'cd android && ./gradlew testDebugUnitTest']);
    expect(detectValidators(repo({ ...android, 'package.json': pkg({}) }), cfg, () => false, 'linux')).toEqual([]);
    expect(detectValidators(repo({ gradlew: '', 'app/build.gradle': 'java library' }), cfg, () => false, 'linux')).toEqual([]);
  });
  it('every detected validator says so', () => {
    expect(detectValidators(repo({ 'package.json': pkg({ test: 'x' }) }), cfg).every(v => v.source === 'detected')).toBe(true);
  });
  it('a broken package.json detects nothing from it', () => {
    expect(detectValidators(repo({ 'package.json': '{oops' }), cfg)).toEqual([]);
  });
});

describe('selectValidators', () => {
  const v = (name: string, kind: string, extra: Partial<Validator> = {}): Validator => ({ name, cmd: name, kind, source: 'detected', ...extra });
  const all = [
    v('typecheck', 'typecheck'), v('build', 'build'), v('web', 'other', { affects: ['web/**'] }),
    v('e2e', 'e2e', { affects: ['web/**'] }), v('e2e-all', 'e2e'), v('bench', 'bench'),
    v('a11y', 'a11y'), v('hw', 'hardware', { when: 'final' }), v('fast', 'custom', { when: 'always' }), v('late', 'test', { when: 'final' }),
  ];
  const names = (s: Scope) => selectValidators(all, s).map(x => x.name);
  it('affected: no build, e2e, bench or medium/final kinds; globs filter', () => {
    expect(names({ mode: 'affected', files: ['src/x.ts'] })).toEqual(['typecheck', 'fast']);
    expect(names({ mode: 'affected', files: ['web/page.tsx'] })).toEqual(['typecheck', 'web', 'fast']);
  });
  it('small: everything except e2e, bench and medium/final kinds', () => {
    expect(names({ mode: 'small' })).toEqual(['typecheck', 'build', 'web', 'fast']);
  });
  it('heavy: e2e only when its affects match the diff or it has none; no bench; when: medium kinds run', () => {
    expect(names({ mode: 'heavy', changed: ['src/x.ts'] })).toEqual(['typecheck', 'build', 'web', 'e2e-all', 'a11y', 'fast']);
    expect(names({ mode: 'heavy', changed: ['web/a.tsx'] })).toEqual(['typecheck', 'build', 'web', 'e2e', 'e2e-all', 'a11y', 'fast']);
    expect(names({ mode: 'heavy', changed: null })).toEqual(['typecheck', 'build', 'web', 'e2e', 'e2e-all', 'a11y', 'fast']);
  });
  it('final: everything', () => {
    expect(names({ mode: 'final' })).toEqual(all.map(x => x.name));
  });
  it('globs', () => {
    expect(globMatch('web/**', 'web/a/b.ts')).toBe(true);
    expect(globMatch('src/*.ts', 'src/a.ts')).toBe(true);
    expect(globMatch('src/*.ts', 'src/a/b.ts')).toBe(false);
  });
});

describe('runValidators', () => {
  const v = [{ name: 'test', cmd: 'npm test', kind: 'test' as const, source: 'detected' as const }];
  it('passes', () => {
    const r = runValidators(v, () => ({ code: 0, output: 'ok', ms: 5, timedOut: false }), 600);
    expect(r).toEqual([{ validator: 'test', ok: true, flaky: false, durationMs: 5, failures: [] }]);
  });
  it('a failure that passes on retry is flaky and does not count', () => {
    const codes = [1, 0];
    const r = runValidators(v, () => ({ code: codes.shift()!, output: 'FAIL x', ms: 1, timedOut: false }), 600);
    expect(r[0]).toMatchObject({ ok: true, flaky: true });
  });
  it('a failure twice is a failure with its lines', () => {
    const r = runValidators(v, () => ({ code: 1, output: 'line\nFAIL tests/a.test.ts > adds\nAssertionError: 1 !== 2\n', ms: 1, timedOut: false }), 600);
    expect(r[0]).toMatchObject({ ok: false, flaky: false });
    expect(r[0].failures).toEqual(['FAIL tests/a.test.ts > adds', 'AssertionError: 1 !== 2']);
  });
  it('a test runner that finds no tests passes as skipped, without a retry', () => {
    let calls = 0;
    const out = (output: string) => runValidators(v, () => { calls++; return { code: 1, output, ms: 2, timedOut: false }; }, 600)[0];
    expect(out('RUN v5\nNo test files found, exiting with code 1')).toMatchObject({ ok: true, skipped: 'no-tests' });
    expect(calls).toBe(1);
    const e2e = [{ name: 'e2e', cmd: 'npx playwright test', kind: 'e2e' as const, source: 'detected' as const }];
    expect(runValidators(e2e, () => ({ code: 1, output: 'Error: No tests found', ms: 1, timedOut: false }), 600)[0]).toMatchObject({ ok: true, skipped: 'no-tests' });
    // A build that says so is still a failure: only test runners skip.
    const build = [{ name: 'build', cmd: 'npm run build', kind: 'build' as const, source: 'detected' as const }];
    expect(runValidators(build, () => ({ code: 1, output: 'no tests found', ms: 1, timedOut: false }), 600)[0].ok).toBe(false);
  });
  it('marks the failures the base commit already had, and only those count', () => {
    const results = [
      { validator: 'build', ok: false, flaky: false, durationMs: 1, failures: ['x'] },
      { validator: 'test', ok: false, flaky: false, durationMs: 1, failures: ['y'] },
      { validator: 'lint', ok: true, flaky: false, durationMs: 1, failures: [] },
    ];
    const marked = markPreexisting(results, [{ validator: 'build', ok: false }, { validator: 'test', ok: true }]);
    expect(marked.map(r => r.preexisting ?? false)).toEqual([true, false, false]);
    expect(marked.filter(blocking).map(r => r.validator)).toEqual(['test']);
    expect(markPreexisting(results, 'junk')).toEqual(results);
  });
  it('a timeout is a failure named timeout and is not retried', () => {
    let calls = 0;
    const r = runValidators(v, () => { calls++; return { code: 1, output: '', ms: 600000, timedOut: true }; }, 600);
    expect(calls).toBe(1);
    expect(r[0].failures).toEqual(['timeout after 600 s']);
  });
});

describe('failureLines', () => {
  it('keeps the last 20 matching lines, clipped to 200 chars', () => {
    const out = Array.from({ length: 30 }, (_, i) => `Error ${i} ${'x'.repeat(300)}`).join('\n');
    const lines = failureLines(out);
    expect(lines).toHaveLength(20);
    expect(lines[0].startsWith('Error 10 ')).toBe(true);
    expect(lines[0].length).toBe(200);
  });
  it('falls back to the last 10 lines when nothing matches', () => {
    expect(failureLines(Array.from({ length: 15 }, (_, i) => `l${i}`).join('\n'))).toEqual(Array.from({ length: 10 }, (_, i) => `l${i + 5}`));
  });
});
