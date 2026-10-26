import { describe, it, expect } from 'vitest';
import { detectValidators, selectValidators, runValidators, failureLines, failingTests, failingLabel, globMatch, markPreexisting, blocking, flakyHistory, baselineFailing, runOptions, resolveAffected, planAffected, type RepoReader, type Validator, type Scope } from '../src/forge/validators.js';
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
    // FC3: a gradle build that is not an android app is a JVM one.
    expect(detectValidators(repo({ gradlew: '', 'app/build.gradle': 'java library' }), cfg, () => false, 'linux').map(v => v.cmd)).toEqual(['./gradlew test']);
  });
  const jvm = (files: Record<string, string>, platform: NodeJS.Platform = 'linux') =>
    detectValidators(repo(files), cfg, () => false, platform).map(v => [v.name, v.cmd, v.kind]);
  it('FC3: gradle outside android, from the wrapper or a build script at the root; gradlew.bat on Windows, gradle without a wrapper', () => {
    for (const f of ['gradlew', 'gradlew.bat', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts']) {
      expect(jvm({ [f]: '' }).map(v => v[0]), f).toEqual(['gradle-test']);
    }
    const wrapper = { gradlew: '', 'gradlew.bat': '', 'settings.gradle.kts': 'rootProject.name = "shop"', 'build.gradle.kts': 'plugins { java }' };
    expect(jvm(wrapper)).toEqual([['gradle-test', './gradlew test', 'test']]);
    expect(jvm(wrapper, 'win32')).toEqual([['gradle-test', 'gradlew.bat test', 'test']]);
    expect(jvm({ 'build.gradle': "apply plugin: 'java'" })).toEqual([['gradle-test', 'gradle test', 'test']]);
    expect(jvm({ 'build.gradle': "apply plugin: 'java'" }, 'win32')).toEqual([['gradle-test', 'gradle test', 'test']]);
    // A build script below the root is a module of something else (an android/ folder, a sample): nothing.
    expect(jvm({ 'samples/build.gradle': '' })).toEqual([]);
  });
  it('FC3: gradle check, without the tests the test validator runs, when the build adds checks to it', () => {
    const both = (cmd: string) => [['gradle-test', `${cmd} test`, 'test'], ['gradle-check', `${cmd} check -x test`, 'lint']];
    expect(jvm({ gradlew: '', 'build.gradle.kts': 'plugins {\n  java\n  checkstyle\n}' })).toEqual(both('./gradlew'));
    expect(jvm({ gradlew: '', 'build.gradle': "plugins { id 'com.diffplug.spotless' version '7.0.2' }" }, 'win32')).toEqual(both('gradlew.bat'));
    expect(jvm({ gradlew: '', 'build.gradle.kts': 'tasks.named("check") { dependsOn(archTest) }' })).toEqual(both('./gradlew'));
    // The version catalog or a convention build names the plugin when the root script only applies a convention.
    expect(jvm({ gradlew: '', 'build.gradle.kts': 'plugins { id("shop.java") }', 'gradle/libs.versions.toml': '[plugins]\nspotbugs = { id = "com.github.spotbugs", version = "6.1.0" }\n' })).toEqual(both('./gradlew'));
    expect(jvm({ gradlew: '', 'build-logic/build.gradle.kts': 'dependencies { implementation(libs.detekt.gradle) }' })).toEqual(both('./gradlew'));
    expect(jvm({ gradlew: '', 'build.gradle.kts': 'plugins { java }' })).toEqual([['gradle-test', './gradlew test', 'test']]);
  });
  it('FC3: maven, from the wrapper or a pom.xml; mvnw.cmd on Windows, mvn without a wrapper', () => {
    expect(jvm({ 'pom.xml': '<project/>' })).toEqual([['maven-test', 'mvn -q test', 'test']]);
    expect(jvm({ 'pom.xml': '<project/>' }, 'win32')).toEqual([['maven-test', 'mvn -q test', 'test']]);
    expect(jvm({ 'pom.xml': '<project/>', mvnw: '', 'mvnw.cmd': '' })).toEqual([['maven-test', './mvnw -q test', 'test']]);
    expect(jvm({ mvnw: '' })).toEqual([['maven-test', './mvnw -q test', 'test']]);
    expect(jvm({ 'pom.xml': '<project/>', mvnw: '', 'mvnw.cmd': '' }, 'win32')).toEqual([['maven-test', 'mvnw.cmd -q test', 'test']]);
    // A make test target is not added beside them.
    expect(jvm({ 'pom.xml': '<project/>', Makefile: 'test:\n\tmvn test\n' }).map(v => v[0])).toEqual(['maven-test']);
  });
  it('FC3: an android app keeps its own gradle validators, never the JVM ones', () => {
    const android = { gradlew: '', 'gradlew.bat': '', 'build.gradle': 'plugins { id "checkstyle" }', 'app/build.gradle': "plugins { id 'com.android.application' }" };
    expect(jvm(android).map(v => v[0])).toEqual(['gradle-lint', 'gradle-test']);
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
    expect(r).toEqual([{ validator: 'test', ok: true, flaky: false, durationMs: 5, failures: [], failing: [], failingKnown: true }]);
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
    expect(r[0]).toMatchObject({ failing: ['tests/a.test.ts > adds'], failingKnown: true });
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
    const marked = markPreexisting(results, [{ validator: 'build', ok: false, failures: ['x'] }, { validator: 'test', ok: true }]);
    expect(marked.map(r => r.preexisting ?? false)).toEqual([true, false, false]);
    expect(marked.filter(blocking).map(r => r.validator)).toEqual(['test']);
    expect(markPreexisting(results, 'junk')).toEqual(results);
  });
  it('a timeout is a failure named timeout and is not retried', () => {
    let calls = 0;
    const r = runValidators(v, () => { calls++; return { code: 1, output: '', ms: 600000, timedOut: true }; }, 600);
    expect(calls).toBe(1);
    expect(r[0].failures).toEqual(['timeout after 600 s']);
    expect(r[0]).toMatchObject({ failing: [], failingKnown: false });
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

describe('failingTests (D-06)', () => {
  it('reads the failing tests of vitest, jest, pytest, go, cargo, dotnet and tsc, without durations', () => {
    expect(failingTests(' FAIL  tests/a.test.ts > cart > adds\n   × adds 12ms\n', 'test')).toEqual({ names: ['tests/a.test.ts > cart > adds'], known: true });
    expect(failingTests(' ❯ tests/a.test.ts (2)\n   × adds 5ms\n   ✗ removes 1.2s\n', 'test')).toEqual({ names: ['adds', 'removes'], known: true });
    expect(failingTests('  ● cart › adds\n\n  ● Console\n', 'test')).toEqual({ names: ['cart › adds'], known: true });
    expect(failingTests('FAILED tests/test_cart.py::test_adds - AssertionError: x\n', 'test')).toEqual({ names: ['tests/test_cart.py::test_adds'], known: true });
    expect(failingTests('--- FAIL: TestAdds (0.00s)\n', 'test')).toEqual({ names: ['TestAdds'], known: true });
    expect(failingTests('test cart::adds ... FAILED\n', 'test')).toEqual({ names: ['cart::adds'], known: true });
    expect(failingTests('  Failed Shop.Tests.Adds [12 ms]\n', 'test')).toEqual({ names: ['Shop.Tests.Adds'], known: true });
    expect(failingTests("src\\a.ts(3,5): error TS2322: Type 'string' is not assignable to type 'number'.\n", 'typecheck'))
      .toEqual({ names: ["src/a.ts: TS2322 Type 'string' is not assignable to type 'number'."], known: true });
  });
  it('strips colour codes, keeps at most 200 names, and says when it read nothing', () => {
    const esc = String.fromCharCode(27);
    expect(failingTests(`${esc}[31m FAIL ${esc}[39m tests/a.test.ts > adds\n`, 'test').names).toEqual(['tests/a.test.ts > adds']);
    const many = (n: number) => Array.from({ length: n }, (_, i) => `--- FAIL: Test${i} (0.00s)`).join('\n');
    expect(failingTests(many(300), 'test').names).toHaveLength(200);
    // A name left out past the cap could be a new one: the read is unknown; exactly 200 left nothing out.
    expect(failingTests(many(300), 'test').known).toBe(false);
    expect(failingTests(many(200) + '\n--- FAIL: Test0 (0.00s)', 'test')).toMatchObject({ known: true });
    expect(failingTests('Error: boom\n', 'test')).toEqual({ names: [], known: false });
    expect(failingTests(' FAIL  tests/a.test.ts > adds\n', 'lint')).toEqual({ names: [], known: false });
    expect(failingTests(' FAIL  tests/a.test.ts > adds\n', 'typecheck')).toEqual({ names: [], known: false });
    // Only test kinds read test names: a build's "Failed to compile." is not one, nor is a dotnet line without a duration.
    expect(failingTests('Failed to compile.\n', 'build')).toEqual({ names: [], known: false });
    expect(failingTests('Failed to compile.\n', 'test')).toEqual({ names: [], known: false });
    expect(failingTests('  Failed Shop.Tests.Adds\n', 'test')).toEqual({ names: [], known: false });
    // A runner-level error that names no test makes the read unknown.
    expect(failingTests(' FAIL  a.test.ts > one\n⎯⎯⎯⎯ Unhandled Errors ⎯⎯⎯⎯\n', 'test')).toEqual({ names: ['a.test.ts > one'], known: false });
    expect(failingTests('FAILED t.py::a - x\nERROR collecting t2.py\n', 'test').known).toBe(false);
    expect(failingTests(' FAIL  a.test.ts\n● Test suite failed to run\n', 'test').known).toBe(false);
  });
  it('a pytest setup or fixture error names its test (ERROR <id>)', () => {
    expect(failingTests('FAILED tests/test_a.py::test_x - assert 0\nERROR tests/test_b.py::test_y - Exception: fixture boom\n1 failed, 2 passed, 1 error in 0.11s\n', 'test'))
      .toEqual({ names: ['tests/test_a.py::test_x', 'tests/test_b.py::test_y'], known: true });
  });
  it('a tsc error without a location makes the read unknown; a build is never read by names', () => {
    const located = "src/a.ts(3,5): error TS2322: Type 'string' is not assignable to type 'number'.\n";
    const name = "src/a.ts: TS2322 Type 'string' is not assignable to type 'number'.";
    expect(failingTests(located + "error TS2688: Cannot find type definition file for 'node'.\n", 'typecheck')).toEqual({ names: [name], known: false });
    expect(failingTests(located + "error TS18003: No inputs were found in config file 'tsconfig.json'.\n", 'typecheck').known).toBe(false);
    expect(failingTests(located, 'typecheck').known).toBe(true);
    expect(failingTests(located, 'build')).toEqual({ names: [name], known: false });
  });
});

describe('markPreexisting by test (D-06)', () => {
  const red = (failing: string[], failures = ['x']) => ({ validator: 'test', ok: false, flaky: false, durationMs: 1, failures, failing, failingKnown: failing.length > 0 });
  it('a validator red on the base is preexisting only when every failing test already failed; the new ones are named', () => {
    const base = [{ validator: 'test', ok: false, failing: ['a > one'], failingKnown: true, failures: ['FAIL a > one'] }];
    expect(markPreexisting([red(['a > one'])], base)[0]).toMatchObject({ preexisting: true });
    const more = markPreexisting([red(['a > one', 'a > two'])], base)[0];
    expect(more.preexisting).toBeUndefined();
    expect(more.newFailing).toEqual(['a > two']);
    expect(blocking(more)).toBe(true);
    expect(failingLabel(more)).toBe('test (new failing: a > two)');
    expect(failingLabel(more, 'es')).toBe('test (nuevos en rojo: a > two)');
    expect(failingLabel({ validator: 'lint' })).toBe('lint');
  });
  it('without test names it compares the failure lines, digits and spacing aside, as with a baseline of forge 0.16', () => {
    const old = [{ validator: 'build', ok: false, failures: ['error in 3 files  (12ms)'] }];
    const res = (failures: string[]) => [{ validator: 'build', ok: false, flaky: false, durationMs: 1, failures, failing: [], failingKnown: false }];
    expect(markPreexisting(res(['Error in 4 files (9ms)']), old)[0].preexisting).toBe(true);
    expect(markPreexisting(res(['error in 4 files (9ms)', 'Cannot find module x']), old)[0].preexisting).toBeUndefined();
  });
  it('a build red on the base with another Failed to … is not excused; neither is a new runner-level error', () => {
    const build = [{ validator: 'build', ok: false, failures: ['Failed to compile.'] }];
    const out = runValidators([{ name: 'build', cmd: 'b', kind: 'build', source: 'detected' }], () => ({ code: 1, output: 'Failed to build the page\n', ms: 1, timedOut: false }), 60);
    expect(markPreexisting(out, build)[0].preexisting).toBeUndefined();
    const base = [{ validator: 'test', ok: false, failing: ['a > one'], failingKnown: true, failures: ['FAIL a > one'] }];
    const now = runValidators([{ name: 'test', cmd: 't', kind: 'test', source: 'detected' }], () => ({ code: 1, output: ' FAIL  a > one\n⎯⎯ Unhandled Errors ⎯⎯\nUnhandled Error\n', ms: 1, timedOut: false }), 60);
    expect(now[0]).toMatchObject({ failing: ['a > one'], failingKnown: false });
    expect(markPreexisting(now, base)[0].preexisting).toBeUndefined();
  });
  it('a timeout is never preexisting', () => {
    const base = [{ validator: 'test', ok: false, failures: ['timeout after 600 s'] }];
    const timeout = { validator: 'test', ok: false, flaky: false, durationMs: 1, failures: ['timeout after 600 s'], failing: [], failingKnown: false };
    expect(markPreexisting([timeout], base)[0].preexisting).toBeUndefined();
  });
  // The base and the change, each run through runValidators with its own output.
  const redRun = (name: string, kind: string, output: string) =>
    runValidators([{ name, cmd: name, kind, source: 'detected' }], () => ({ code: 1, output, ms: 1, timedOut: false }), 60);
  const newFailure = (name: string, kind: string, base: string, now: string) => markPreexisting(redRun(name, kind, now), redRun(name, kind, base))[0];
  it('a new pytest setup error beside a failure the base had is new', () => {
    const m = newFailure('pytest', 'test', 'FAILED tests/test_a.py::test_x - assert 0\n1 failed, 3 passed in 0.10s\n',
      'FAILED tests/test_a.py::test_x - assert 0\nERROR tests/test_b.py::test_y - Exception: fixture boom\n1 failed, 2 passed, 1 error in 0.11s\n');
    expect(m.newFailing).toEqual(['tests/test_b.py::test_y']);
    expect(blocking(m)).toBe(true);
  });
  it('a new tsc error without a location, or a bundler error after a known tsc one, is not excused', () => {
    const located = "src/a.ts(3,5): error TS2322: Type 'string' is not assignable to type 'number'.\n";
    for (const extra of ["error TS2688: Cannot find type definition file for 'node'.\n", "error TS18003: No inputs were found in config file 'tsconfig.json'.\n"]) {
      expect(blocking(newFailure('typecheck', 'typecheck', located, located + extra)), extra).toBe(true);
    }
    expect(blocking(newFailure('build', 'build', located, `${located}✘ [ERROR] Could not resolve "./b"\n\n    src/c.ts:1:17:\n`))).toBe(true);
    expect(blocking(newFailure('build', 'build', located, located))).toBe(false);
  });
  it('a new failing test past the 200 names a run keeps is not excused', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => `--- FAIL: Test${i} (0.00s)`).join('\n');
    expect(blocking(newFailure('go-test', 'test', many(250), `${many(250)}\n--- FAIL: TestBrandNew (0.00s)\n`))).toBe(true);
  });
  it('a run that prints nothing is excused only by a base that printed nothing either', () => {
    const silent = { validator: 'test', ok: false, flaky: false, durationMs: 1, failures: [], failing: [], failingKnown: false };
    expect(markPreexisting([silent], [{ validator: 'test', ok: false, failures: ['FAIL a > one'] }])[0].preexisting).toBeUndefined();
    expect(markPreexisting([silent], [{ validator: 'test', ok: false, failures: [] }])[0].preexisting).toBe(true);
  });
  it('a crash of the process beside a test the base already failed makes the read unknown, so it is never excused (1a)', () => {
    const crashes = [
      'Segmentation fault (core dumped)', 'zsh: segmentation fault  npx vitest run', 'Aborted (core dumped)',
      'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory',
      '<--- Last few GCs --->\nFATAL ERROR: Ineffective mark-compacts near heap limit',
    ];
    for (const crash of crashes) expect(failingTests(` FAIL  a.test.ts > one\n${crash}\n`, 'test'), crash).toEqual({ names: ['a.test.ts > one'], known: false });
    // Without a crash the same output still reads its names.
    expect(failingTests(' FAIL  a.test.ts > one\n', 'test')).toEqual({ names: ['a.test.ts > one'], known: true });
    const base = [{ validator: 'test', ok: false, failing: ['a > one'], failingKnown: true, failures: ['FAIL a > one'] }];
    const now = runValidators([{ name: 'test', cmd: 't', kind: 'test', source: 'detected' }],
      () => ({ code: 139, output: ' FAIL  a > one\nSegmentation fault (core dumped)\n', ms: 1, timedOut: false }), 60);
    expect(now[0]).toMatchObject({ failing: ['a > one'], failingKnown: false });
    expect(markPreexisting(now, base)[0].preexisting).toBeUndefined();
  });
  it('a crash beside a tsc error the base already had is never excused either: the crash marks count for every kind', () => {
    const located = "src/a.ts(3,5): error TS2322: Type 'string' is not assignable to type 'number'.\n";
    const name = "src/a.ts: TS2322 Type 'string' is not assignable to type 'number'.";
    const oom = 'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory\n';
    expect(failingTests(located + oom, 'typecheck')).toEqual({ names: [name], known: false });
    expect(failingTests(`${located}Segmentation fault (core dumped)\n`, 'typecheck').known).toBe(false);
    expect(failingTests(located, 'typecheck').known).toBe(true);
    expect(blocking(newFailure('typecheck', 'typecheck', located, located + oom))).toBe(true);
  });
  it('failureLines keeps a crash line, also as the last of more than 20 failure lines', () => {
    expect(failureLines('ok\nSegmentation fault (core dumped)\n')).toEqual(['Segmentation fault (core dumped)']);
    const hits = Array.from({ length: 25 }, (_, i) => ` FAIL  a.test.ts > case ${i}`);
    const lines = failureLines([...hits, 'Aborted (core dumped)', 'done in 3s'].join('\n'));
    expect(lines).toHaveLength(20);
    expect(lines.at(-1)).toBe('Aborted (core dumped)');
  });
});

describe('validators in parallel, retried only with a flaky history (C-12)', () => {
  const v = (name: string, kind: string): Validator => ({ name, cmd: name, kind, source: 'detected' });
  const ok = { code: 0, output: '', ms: 2, timedOut: false };
  const list = [v('typecheck', 'typecheck'), v('build', 'build'), v('lint', 'lint'), v('test', 'test'), v('e2e', 'e2e'), v('a11y', 'other')];
  it('runs typecheck, lint, test and other in one parallel batch, then build and e2e one at a time; results keep the list order', () => {
    const batches: [string[], number][] = [];
    const ran: string[] = [];
    const r = runValidators(list, cmd => { ran.push(cmd); return ok; }, 600, {
      concurrency: 3, retry: () => false, execMany: (cmds, _t, c) => { batches.push([cmds, c]); return cmds.map(() => ok); },
    });
    expect(batches).toEqual([[['typecheck', 'lint', 'test', 'a11y'], 3]]);
    expect(ran).toEqual(['build', 'e2e']);
    expect(r.map(x => x.validator)).toEqual(list.map(x => x.name));
  });
  it('with concurrency 1 or without execMany, one at a time in the list order, as before', () => {
    const noBatch = () => { throw new Error('no batch with concurrency 1'); };
    for (const opts of [{ concurrency: 1, retry: () => false, execMany: noBatch }, { concurrency: 3, retry: () => false }]) {
      const ran: string[] = [];
      runValidators(list, cmd => { ran.push(cmd); return ok; }, 600, opts);
      expect(ran).toEqual(list.map(x => x.name));
    }
  });
  it('retries a failure only when retry says so; a retried pass is flaky', () => {
    const one = [v('test', 'test')];
    let calls = 0;
    const r = runValidators(one, () => { calls++; return { code: 1, output: 'FAIL x', ms: 1, timedOut: false }; }, 600, { concurrency: 1, retry: () => false });
    expect(calls).toBe(1);
    expect(r[0]).toMatchObject({ ok: false, flaky: false, failing: ['x'] });
    const codes = [1, 0];
    calls = 0;
    const again = runValidators(one, () => { calls++; return { code: codes.shift()!, output: 'FAIL x', ms: 1, timedOut: false }; }, 600, { concurrency: 1, retry: x => x.name === 'test' });
    expect(calls).toBe(2);
    expect(again[0]).toMatchObject({ ok: true, flaky: true });
  });
  it('flakyHistory keeps the validators with a flaky result in the last 30 days; runOptions applies validate.retry', () => {
    const now = new Date('2026-10-15T12:00:00.000Z');
    const events = [
      { ts: '2026-10-01T00:00:00.000Z', kind: 'validate' as const, results: [{ validator: 'test', ok: true, flaky: true }, { validator: 'lint', ok: true, flaky: false }] },
      { ts: '2026-08-01T00:00:00.000Z', kind: 'validate' as const, results: [{ validator: 'e2e', ok: true, flaky: true }] },
      { ts: '2026-10-02T00:00:00.000Z', kind: 'verdict' as const, results: [{ validator: 'build', flaky: true }] },
      { ts: 'junk', kind: 'validate' as const, results: [{ validator: 'build', flaky: true }] },
    ];
    expect([...flakyHistory(events, now)]).toEqual(['test']);
    const cfg = (retry: string) => parseConfig(`validate:\n  parallel: 2\n  retry: ${retry}\n`);
    const t = v('test', 'test'), l = v('lint', 'lint');
    const flaky = runOptions(cfg('flaky'), events, now);
    expect([flaky.concurrency, flaky.retry(t), flaky.retry(l)]).toEqual([2, true, false]);
    expect([runOptions(cfg('always'), [], now).retry(l), runOptions(cfg('never'), events, now).retry(t)]).toEqual([true, false]);
    const many = () => [];
    expect(runOptions(cfg('flaky'), [], now, many).execMany).toBe(many);
  });
  it('with a baseline, flaky retries once a test failure the base did not have; deterministic kinds are not retried; without a baseline, or with an empty one, as before (D7, M6)', () => {
    const now = new Date('2026-10-15T12:00:00.000Z');
    const cfg = (retry: string) => parseConfig(`validate:\n  retry: ${retry}\n`);
    const t = v('test', 'test'), b = v('build', 'build'), lint = v('lint', 'lint'), e = v('e2e', 'e2e'), ty = v('typecheck', 'typecheck');
    const base = baselineFailing([{ validator: 'build', ok: false }, { validator: 'test', ok: true }]);
    expect([...base!]).toEqual(['build']);
    for (const none of [[], 'x', null, [5]]) expect(baselineFailing(none), JSON.stringify(none)).toBeNull();
    const o = runOptions(cfg('flaky'), [], now, undefined, base);
    expect([o.retry(t), o.retry(e), o.retry(b), o.retry(lint), o.retry(ty)]).toEqual([true, true, false, false, false]);
    expect(runOptions(cfg('flaky'), [], now).retry(t)).toBe(false);
    expect(runOptions(cfg('never'), [], now, undefined, base).retry(t)).toBe(false);
    expect(runOptions(cfg('always'), [], now, undefined, base).retry(b)).toBe(true);
    // A test validator the base already failed is not retried: the failure is not new.
    expect(runOptions(cfg('flaky'), [], now, undefined, baselineFailing([{ validator: 'test', ok: false }])).retry(t)).toBe(false);
  });
});

describe('--affected runs the related tests (C-02)', () => {
  const pkg = (scripts: Record<string, string>) => JSON.stringify({ scripts });
  const testOf = (files: Record<string, string>) => detectValidators(repo(files), cfg, () => false).find(v => v.kind === 'test');
  it('detects the related-tests command of vitest, jest, pytest and go, with the package manager runner', () => {
    expect(testOf({ 'package.json': pkg({ test: 'vitest run' }) })?.affectedCmd).toBe('npx vitest related --run --passWithNoTests {files}');
    expect(testOf({ 'package.json': pkg({ test: 'vitest' }), 'pnpm-lock.yaml': '' })?.affectedCmd).toBe('pnpm exec vitest related --run --passWithNoTests {files}');
    expect(testOf({ 'package.json': pkg({ test: 'jest --ci' }), 'yarn.lock': '' })?.affectedCmd).toBe('yarn jest --findRelatedTests --passWithNoTests {files}');
    expect(testOf({ 'package.json': pkg({ test: 'jest' }), 'bun.lock': '' })?.affectedCmd).toBe('bunx jest --findRelatedTests --passWithNoTests {files}');
    expect(testOf({ 'package.json': pkg({ test: 'mocha' }) })?.affectedCmd).toBeUndefined();
    expect(testOf({ 'pytest.ini': '' })?.affectedCmd).toBe('python -m pytest -q {tests}');
    expect(testOf({ 'go.mod': '' })?.affectedCmd).toBe('go test {packages}');
    const manual = detectValidators(repo({}), parseConfig('detect: false\nvalidators:\n  - name: unit\n    cmd: make test\n    kind: test\n    affected_cmd: make test-files {files}\n'));
    expect(manual).toEqual([{ name: 'unit', cmd: 'make test', kind: 'test', affectedCmd: 'make test-files {files}', source: 'manual' }]);
  });
  it('resolves {files}, {tests} and {packages}, quoted for the shell, without bookkeeping or missing paths', () => {
    const v = (affectedCmd: string): Validator => ({ name: 'unit', cmd: 'all', kind: 'test', affectedCmd, source: 'manual' });
    const exists = (f: string) => !f.startsWith('gone/');
    const files = ['src/a.ts', 'src/con espacio.ts', 'tests/a.test.ts', 'docs/waypoint/p/plan.yaml', 'gone/x.ts', 'pkg/b.go', 'b_test.py'];
    expect(resolveAffected(v('vt {files}'), files, 'linux', exists)).toEqual({ mode: 'cmd', cmd: "vt 'src/a.ts' 'src/con espacio.ts' 'tests/a.test.ts' 'pkg/b.go' 'b_test.py'" });
    expect(resolveAffected(v('vt {files}'), ['src/a.ts', 'src/con espacio.ts'], 'win32', exists)).toEqual({ mode: 'cmd', cmd: 'vt "src/a.ts" "src/con espacio.ts"' });
    expect(resolveAffected(v('py {tests}'), files, 'linux', exists)).toEqual({ mode: 'cmd', cmd: "py 'tests/a.test.ts' 'b_test.py'" });
    expect(resolveAffected(v('go test {packages}'), [...files, 'main.go'], 'linux', exists)).toEqual({ mode: 'cmd', cmd: "go test './pkg' '.'" });
  });
  it('runs the validator in full for a path no shell may see or too many files, and skips it with nothing related', () => {
    const v = (affectedCmd?: string): Validator => ({ name: 'unit', cmd: 'all', kind: 'test', ...(affectedCmd ? { affectedCmd } : {}), source: 'manual' });
    const all = () => true;
    for (const bad of ['src/año.ts', "src/it's.ts", 'src/$x.ts', 'src/a;b.ts', 'src/a&b.ts', 'src/`x`.ts', 'src/100%.ts', 'src/a|b.ts', '--root=..', '-x.ts', './-x.ts']) {
      expect(resolveAffected(v('vt {files}'), ['src/a.ts', bad], 'linux', all).mode, bad).toBe('full');
    }
    // A runner reads a leading - as an option; inside a path it is only a name.
    expect(resolveAffected(v('vt {files}'), ['src/-x.ts', 'a-b.ts'], 'linux', all)).toEqual({ mode: 'cmd', cmd: "vt 'src/-x.ts' 'a-b.ts'" });
    expect(resolveAffected(v('vt {files}'), Array.from({ length: 101 }, (_, i) => `src/f${i}.ts`), 'linux', all).mode).toBe('full');
    expect(resolveAffected(v('vt {files}'), Array.from({ length: 100 }, (_, i) => `src/f${i}.ts`), 'linux', all).mode).toBe('cmd');
    expect(resolveAffected(v('py {tests}'), ['src/a.py'], 'linux', all).mode).toBe('skip');
    expect(resolveAffected(v('vt {files}'), ['.forge/work/x.json'], 'linux', all).mode).toBe('skip');
    expect(resolveAffected(v(), ['src/a.ts'], 'linux', all).mode).toBe('skip');
  });
  it("pytest's {tests} takes only test modules (test_*.py, *_test.py): a conftest, a helper or a fixture alone skips it", () => {
    const pytest = detectValidators(repo({ 'pytest.ini': '' }), cfg, () => false).find(v => v.name === 'pytest')!;
    const all = () => true;
    expect(resolveAffected(pytest, ['tests/conftest.py', 'tests/fixtures/data.json', 'tests/helpers.py', 'tests/test_a.py', 'pkg/b_test.py', 'tests/a.test.ts'], 'linux', all))
      .toEqual({ mode: 'cmd', cmd: "python -m pytest -q 'tests/test_a.py' 'pkg/b_test.py'" });
    expect(resolveAffected(pytest, ['tests/conftest.py', 'tests/fixtures/data.json'], 'linux', all).mode).toBe('skip');
    const manual = { name: 'unit', cmd: 'pytest', kind: 'test', affectedCmd: 'uv run pytest {tests}', source: 'manual' as const };
    expect(resolveAffected(manual, ['tests/conftest.py', 'tests/test_a.py'], 'linux', all)).toEqual({ mode: 'cmd', cmd: "uv run pytest 'tests/test_a.py'" });
  });
  it('planAffected keeps typecheck as it is, runs the related tests, and skips a test with nothing to run', () => {
    const list: Validator[] = [
      { name: 'typecheck', cmd: 'tsc', kind: 'typecheck', source: 'detected' },
      { name: 'test', cmd: 'npm test', kind: 'test', affectedCmd: 'npx vitest related --run --passWithNoTests {files}', source: 'detected' },
      { name: 'pytest', cmd: 'python -m pytest -q', kind: 'test', affectedCmd: 'python -m pytest -q {tests}', source: 'detected' },
    ];
    const p = planAffected(list, ['src/a.ts'], 'linux', () => true);
    expect(p.run.map(x => x.cmd)).toEqual(['tsc', "npx vitest related --run --passWithNoTests 'src/a.ts'"]);
    expect([...p.skipped.values()]).toEqual([{ validator: 'pytest', ok: true, flaky: false, durationMs: 0, failures: [], failing: [], failingKnown: true, skipped: 'not-affected' }]);
    expect(p.notes).toEqual(['pytest: no changed file relates to its tests; review-prep runs it in full']);
  });
});
