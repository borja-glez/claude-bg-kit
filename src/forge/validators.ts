import { existsSync } from 'node:fs';
import path from 'node:path';
import type { ExecResult } from './cli/run.js';
import type { ForgeConfig, When } from './config.js';
import type { LedgerEvent } from './ledger.js';
import { isBookkeeping } from './triage.js';

export interface Validator { name: string; cmd: string; kind: string; affects?: string[]; when?: When; cache?: boolean; affectedCmd?: string; source: 'manual' | 'detected' }
// A flaky result (failed, then passed on the retry) is ok: true; its first failures are kept for the record.
// skipped: a test runner that found no tests to run passes (there is nothing to check yet, which is not a failure of the
// change). preexisting: it failed the same way before the change (see markPreexisting), so it does not count against it.
// failing: the tests (or type errors) the output names as failing, when failingTests could read them (failingKnown);
// newFailing: those the baseline did not already have.
// cached: it came from the tree cache (validate-cache.ts), with the clock of the run that produced it.
export interface ValidatorResult {
  validator: string; ok: boolean; flaky: boolean; durationMs: number; failures: string[];
  failing?: string[]; failingKnown?: boolean; newFailing?: string[]; skipped?: 'no-tests' | 'not-affected'; preexisting?: boolean; cached?: boolean;
}
// list(dir) lists the entries of a directory relative to the repo root (the root itself when omitted).
export interface RepoReader { exists: (rel: string) => boolean; read: (rel: string) => string | null; list: (dir?: string) => string[] }
/** Several commands at once (cli/run.ts defaultExecMany): one result per command, in the same order. */
export type ExecMany = (cmds: string[], timeoutSec: number, concurrency: number) => ExecResult[];
/** How runValidators runs a list (C-12): the parallel batch and its width, and which failures run again. */
export interface RunOptions { execMany?: ExecMany; concurrency: number; retry: (v: Validator) => boolean }

const NPM_ORDER: [script: string, kind: Validator['kind']][] = [['typecheck', 'typecheck'], ['type-check', 'typecheck'], ['lint', 'lint'], ['test', 'test'], ['build', 'build']];
const PLACEHOLDER_TEST = /no test specified/i;

// True when `name` resolves to an executable on PATH. On Windows, the WindowsApps directory is skipped:
// its python/python3 entries are usually Microsoft Store stubs that only print an install hint.
export function onPath(name: string): boolean {
  const win = process.platform === 'win32';
  const exts = win ? ['', ...(process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)] : [''];
  return (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
    .filter(dir => !(win && /[\\/]WindowsApps[\\/]?$/i.test(dir)))
    .some(dir => exts.some(ext => { try { return existsSync(path.join(dir, name + ext)); } catch { return false; } }));
}

function pythonFor(repo: RepoReader, which: (name: string) => boolean): string {
  if (repo.exists('.venv/Scripts/python.exe')) return '.venv\\Scripts\\python.exe';
  if (repo.exists('.venv/bin/python')) return '.venv/bin/python';
  return which('python3') ? 'python3' : 'python';
}

function usesPytest(repo: RepoReader): boolean {
  const pyproject = repo.read('pyproject.toml');
  if (pyproject !== null && /pytest/.test(pyproject)) return true;
  if (repo.exists('pytest.ini') || repo.exists('tox.ini') || repo.exists('conftest.py')) return true;
  const setupCfg = repo.read('setup.cfg');
  if (setupCfg !== null && /^\[tool:pytest\]/m.test(setupCfg)) return true;
  return repo.list('tests').some(f => /^test_[^/\\]*\.py$/i.test(f));
}

// One root solution (.sln/.slnx) wins, else one root project (.csproj); several of either: none.
function dotnetTarget(rootEntries: string[]): string | null {
  const root = rootEntries.filter(f => !f.includes('/'));
  const solutions = root.filter(f => /\.slnx?$/i.test(f));
  if (solutions.length) return solutions.length === 1 ? solutions[0] : null;
  const projects = root.filter(f => /\.csproj$/i.test(f));
  return projects.length === 1 ? projects[0] : null;
}

const E2E_SCRIPTS = ['e2e', 'test:e2e', 'test:integration'];
const CONFIGS = (base: string) => ['ts', 'js', 'mjs', 'cjs'].map(e => `${base}.${e}`);

/** The related-tests command (C-02) of a package.json test script run by vitest or jest, with the package manager's runner. */
function relatedCmd(body: string, runner: string): { affectedCmd?: string } {
  const x = runner === 'pnpm' ? 'pnpm exec' : runner === 'yarn' ? 'yarn' : runner === 'bun' ? 'bunx' : 'npx';
  if (/\bvitest\b/.test(body)) return { affectedCmd: `${x} vitest related --run --passWithNoTests {files}` };
  if (/\bjest\b/.test(body)) return { affectedCmd: `${x} jest --findRelatedTests --passWithNoTests {files}` };
  return {};
}

// FC3: what makes a root a Gradle build: the wrapper first (with it, the command is the wrapper), then a build or
// settings script.
const GRADLE_ROOT = ['gradlew', 'gradlew.bat', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'];
// Where a build adds checks to `check`: its root scripts, its version catalog and its convention builds.
const GRADLE_SCRIPTS = ['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts', 'gradle/libs.versions.toml',
  'buildSrc/build.gradle', 'buildSrc/build.gradle.kts', 'build-logic/build.gradle', 'build-logic/build.gradle.kts'];
// A verification plugin that hangs a task on `check`, or the build naming `check` itself (tasks.named("check"), check { … }).
const GRADLE_CHECK = /\b(?:checkstyle|pmd|spotbugs|spotless|detekt|ktlint|kotlinter|errorprone|codenarc)\b|["']check["']|\btasks\.check\b|^\s*check\s*(?:\{|\.dependsOn)/im;
/** Whether `gradle check` does more than the tests: one of GRADLE_SCRIPTS names a check. */
const gradleChecks = (repo: RepoReader): boolean => GRADLE_SCRIPTS.some(f => GRADLE_CHECK.test(repo.read(f) ?? ''));

function detected(repo: RepoReader, which: (name: string) => boolean, platform: NodeJS.Platform): Validator[] {
  const out: Validator[] = [];
  const push = (v: Omit<Validator, 'source'>) => out.push({ ...v, source: 'detected' });
  const pkgText = repo.read('package.json');
  let scripts: Record<string, unknown> = {};
  let runner = 'npm';
  if (pkgText !== null) {
    try { scripts = (JSON.parse(pkgText)?.scripts ?? {}) as Record<string, unknown>; } catch { scripts = {}; }
    runner = repo.exists('bun.lock') || repo.exists('bun.lockb') ? 'bun' : repo.exists('pnpm-lock.yaml') ? 'pnpm' : repo.exists('yarn.lock') ? 'yarn' : 'npm';
    for (const [script, kind] of NPM_ORDER) {
      const body = scripts[script];
      if (typeof body !== 'string' || !body.trim()) continue;
      if (script === 'test' && PLACEHOLDER_TEST.test(body)) continue;
      if (kind === 'typecheck' && out.some(v => v.kind === 'typecheck')) continue;
      const cmd = script === 'test' ? `${runner} test` : runner === 'yarn' ? `yarn ${script}` : `${runner} run ${script}`;
      push({ name: script, cmd, kind, ...(script === 'test' ? relatedCmd(body, runner) : {}) });
    }
  }
  const run = (s: string) => (runner === 'yarn' ? `yarn ${s}` : `${runner} run ${s}`);
  const has = (s: string) => typeof scripts[s] === 'string' && (scripts[s] as string).trim() !== '';
  const e2eScripts = E2E_SCRIPTS.filter(has);
  for (const s of e2eScripts) push({ name: s, cmd: run(s), kind: 'e2e' });
  if (!e2eScripts.length) {
    if (CONFIGS('playwright.config').some(f => repo.exists(f))) push({ name: 'playwright', cmd: 'npx playwright test', kind: 'e2e' });
    if (CONFIGS('cypress.config').some(f => repo.exists(f))) push({ name: 'cypress', cmd: 'npx cypress run', kind: 'e2e' });
    if (['.detoxrc', '.detoxrc.js', '.detoxrc.json', 'detox.config.js'].some(f => repo.exists(f))) push({ name: 'detox', cmd: 'npx detox test', kind: 'e2e' });
  }
  if (has('bench')) push({ name: 'bench', cmd: run('bench'), kind: 'bench' });
  if (usesPytest(repo)) {
    const py = pythonFor(repo, which);
    push({ name: 'pytest', cmd: `${py} -m pytest -q`, kind: 'test', affectedCmd: `${py} -m pytest -q {tests}` });
  }
  if (repo.exists('Cargo.toml')) push({ name: 'cargo-test', cmd: 'cargo test', kind: 'test' });
  if (repo.exists('go.mod')) { push({ name: 'go-vet', cmd: 'go vet ./...', kind: 'lint' }); push({ name: 'go-test', cmd: 'go test ./...', kind: 'test', affectedCmd: 'go test {packages}' }); }
  const dotnet = dotnetTarget(repo.list());
  if (dotnet) push({ name: 'dotnet-test', cmd: `dotnet test ${/\s/.test(dotnet) ? `"${dotnet}"` : dotnet}`, kind: 'test' });
  if (repo.exists('pubspec.yaml')) { push({ name: 'flutter-analyze', cmd: 'flutter analyze', kind: 'lint' }); push({ name: 'flutter-test', cmd: 'flutter test', kind: 'test' }); }
  const gw = repo.exists('gradlew') ? '' : repo.exists('android/gradlew') ? 'android/' : null;
  const androidApp = gw !== null && ['app/build.gradle', 'app/build.gradle.kts'].some(f => /com\.android\.application/.test(repo.read(gw + f) ?? ''));
  if (pkgText === null && androidApp && !repo.exists('pubspec.yaml')) {
    const g = `${gw ? 'cd android && ' : ''}${platform === 'win32' ? 'gradlew.bat' : './gradlew'}`;
    push({ name: 'gradle-lint', cmd: `${g} lint`, kind: 'lint' });
    push({ name: 'gradle-test', cmd: `${g} testDebugUnitTest`, kind: 'test' });
  }
  // FC3: a JVM build at the root. Gradle (not an android app, which has its own above): its tests, and `check` without
  // them when the build adds checks to it (gradleChecks). Maven: its tests. The wrapper when there is one.
  if (!androidApp && GRADLE_ROOT.some(f => repo.exists(f))) {
    const g = GRADLE_ROOT.slice(0, 2).some(f => repo.exists(f)) ? (platform === 'win32' ? 'gradlew.bat' : './gradlew') : 'gradle';
    push({ name: 'gradle-test', cmd: `${g} test`, kind: 'test' });
    if (gradleChecks(repo)) push({ name: 'gradle-check', cmd: `${g} check -x test`, kind: 'lint' });
  }
  if (['mvnw', 'mvnw.cmd', 'pom.xml'].some(f => repo.exists(f))) {
    const m = repo.exists('mvnw') || repo.exists('mvnw.cmd') ? (platform === 'win32' ? 'mvnw.cmd' : './mvnw') : 'mvn';
    push({ name: 'maven-test', cmd: `${m} -q test`, kind: 'test' });
  }
  const make = repo.read('GNUmakefile') ?? repo.read('makefile') ?? repo.read('Makefile');
  if (make !== null && /^test\s*:(?!=)/m.test(make) && !out.some(v => v.kind === 'test')) push({ name: 'make-test', cmd: 'make test', kind: 'test' });
  return out;
}

/** FC3: what validate and prep say when no validator is detected nor listed. */
export const NO_VALIDATORS = 'no validators detected: add tests or list validators in .forge/config.yaml';

// Manual validators (the config) and, unless detect is false, detected ones minus `exclude`. A manual validator
// replaces a detected one of the same name in place; the other manual ones follow. A detected validator that runs
// the same command as a manual one (whitespace collapsed) is dropped: the manual one already runs it.
const sameCmd = (cmd: string) => cmd.replace(/\s+/g, ' ').trim();
export function detectValidators(repo: RepoReader, config: ForgeConfig, which: (name: string) => boolean = onPath, platform: NodeJS.Platform = process.platform): Validator[] {
  const manual = (config.validators ?? []).map(({ affected_cmd, ...v }) => ({ ...v, ...(affected_cmd ? { affectedCmd: affected_cmd } : {}), kind: v.kind ?? 'other', source: 'manual' as const }));
  if (!config.detect) return manual;
  const byName = new Map(manual.map(v => [v.name, v]));
  const manualCmds = new Set(manual.map(v => sameCmd(v.cmd)));
  const merged = detected(repo, which, platform)
    .filter(v => !config.exclude.includes(v.name) && (byName.has(v.name) || !manualCmds.has(sameCmd(v.cmd))))
    .map(v => byName.get(v.name) ?? v);
  const used = new Set(merged.map(v => v.name));
  return [...merged, ...manual.filter(v => !used.has(v.name))];
}

export function globMatch(glob: string, file: string): boolean {
  const re = glob.split('**').map(part => part.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*');
  return new RegExp(`^${re}$`).test(file.replace(/\\/g, '/'));
}

// Which validators a run executes. `when` decides first; otherwise known kinds have their own rule and
// unknown kinds behave as when: medium. --affected keeps only validators whose `affects` match (or have none).
export type Scope = { mode: 'affected'; files: string[] } | { mode: 'small' } | { mode: 'heavy'; changed: string[] | null } | { mode: 'final' };
const KNOWN = new Set(['test', 'lint', 'typecheck', 'other', 'build', 'e2e', 'bench']);
const covers = (v: Validator, files: string[]) => !v.affects?.length || files.some(f => v.affects!.some(g => globMatch(g, f)));

function runsIn(v: Validator, scope: Scope): boolean {
  const when = v.when ?? (KNOWN.has(v.kind) ? undefined : 'medium');
  const m = scope.mode;
  if (when === 'always') return true;
  if (when === 'medium') return m === 'heavy' || m === 'final';
  if (when === 'final') return m === 'final';
  if (v.kind === 'build') return m !== 'affected';
  if (v.kind === 'bench') return m === 'final';
  if (v.kind === 'e2e') return m === 'final' || (m === 'heavy' && (scope.changed === null || covers(v, scope.changed)));
  return true;
}

export function selectValidators(all: Validator[], scope: Scope): Validator[] {
  return all.filter(v => runsIn(v, scope) && (scope.mode !== 'affected' || covers(v, scope.files)));
}

// --affected (C-02): the paths a related-tests command takes. A path outside this set never reaches a shell, nor one
// starting with - (a runner would read it as an option).
const SAFE_PATH = /^(?!-)[A-Za-z0-9_@+.,=/\\ ()-]{1,300}$/;
export const MAX_AFFECTED = 100;
export const isPytestModule = (f: string) => /(^|\/)test_[^/]*\.py$/.test(f) || /_test\.py$/.test(f);
export const isTestFile = (f: string) => /(^|\/)tests?\//.test(f) || /\.(test|spec)\.[^/]+$/.test(f) || isPytestModule(f);
// pytest given a file that is not a test module (a conftest, a helper, a fixture) collects nothing or fails (exit 4 or 5).
export const runsPytest = (cmd: string) => /\bpytest\b/.test(cmd);
export type AffectedRun = { mode: 'cmd'; cmd: string } | { mode: 'skip'; why: string } | { mode: 'full'; why: string };

/**
 * What a test validator runs for `--affected` (C-02): its affectedCmd with {files} (the changed files), {tests} (the
 * changed test files; for pytest only its test modules, test_*.py and *_test.py) or {packages} (the ./dirs of the
 * changed .go files), each path quoted ("…" on win32, '…' elsewhere). Bookkeeping and missing paths are left out. More
 * than 100 paths, or one outside SAFE_PATH: the whole validator (`full`). No affectedCmd, or a placeholder with nothing
 * to put in it: `skip`.
 */
export function resolveAffected(v: Validator, files: string[], platform: NodeJS.Platform, exists: (rel: string) => boolean): AffectedRun {
  if (!v.affectedCmd) return { mode: 'skip', why: 'it has no related-tests command' };
  const live = [...new Set(files.map(f => f.replace(/\\/g, '/').replace(/^\.\//, '')))].filter(f => f && !isBookkeeping(f) && exists(f));
  if (live.length > MAX_AFFECTED) return { mode: 'full', why: `more than ${MAX_AFFECTED} changed files` };
  const unsafe = live.find(f => !SAFE_PATH.test(f));
  if (unsafe !== undefined) return { mode: 'full', why: `the path ${JSON.stringify(unsafe.slice(0, 80))} cannot go into a shell command` };
  const quote = (f: string) => (platform === 'win32' ? `"${f}"` : `'${f}'`);
  const lists: Record<'files' | 'tests' | 'packages', string[]> = {
    files: live,
    tests: live.filter(runsPytest(v.affectedCmd) ? isPytestModule : isTestFile),
    packages: [...new Set(live.filter(f => f.endsWith('.go')).map(f => { const d = path.posix.dirname(f); return d === '.' ? '.' : `./${d}`; }))],
  };
  let empty = false;
  const cmd = v.affectedCmd.replace(/\{(files|tests|packages)\}/g, (_, k: 'files' | 'tests' | 'packages') => {
    if (!lists[k].length) empty = true;
    return lists[k].map(quote).join(' ');
  });
  return empty ? { mode: 'skip', why: 'no changed file relates to its tests' } : { mode: 'cmd', cmd };
}

/** An --affected run of a selected list: test validators go through resolveAffected; typecheck, lint and other run as they are. */
export function planAffected(list: Validator[], files: string[], platform: NodeJS.Platform, exists: (rel: string) => boolean): { run: Validator[]; skipped: Map<string, ValidatorResult>; notes: string[] } {
  const run: Validator[] = [];
  const skipped = new Map<string, ValidatorResult>();
  const notes: string[] = [];
  for (const v of list) {
    if (v.kind !== 'test') { run.push(v); continue; }
    const a = resolveAffected(v, files, platform, exists);
    if (a.mode === 'cmd') run.push({ ...v, cmd: a.cmd });
    else if (a.mode === 'full') { run.push(v); notes.push(`${v.name}: ${a.why}; it runs in full`); }
    else {
      skipped.set(v.name, { validator: v.name, ok: true, flaky: false, durationMs: 0, failures: [], failing: [], failingKnown: true, skipped: 'not-affected' });
      notes.push(`${v.name}: ${a.why}; review-prep runs it in full`);
    }
  }
  return { run, skipped, notes };
}

// The marks of a crash of the process (a segfault, a core dump, V8 out of heap, a fatal error), shared by FAILURE,
// RUNNER_ERROR and failingTests' crash check. In FAILURE, `fatal error:` is redundant (`error` matches it already).
const CRASH = 'segmentation fault|core dumped|javascript heap out of memory|fatal error:';
const CRASH_RE = new RegExp(CRASH, 'i');
const FAILURE = new RegExp(`(fail|error|✗|×|assert|panic|exception|${CRASH})`, 'i');
export function failureLines(output: string): string[] {
  const lines = output.split(/\r?\n/).map(l => l.trimEnd()).filter(l => l.trim());
  const hits = lines.filter(l => FAILURE.test(l));
  return (hits.length ? hits.slice(-20) : lines.slice(-10)).map(l => l.slice(0, 200));
}

// D-06: the failing tests of a run's whole output (before failureLines cuts it), so a baseline excuses only the tests
// that already failed, not the whole validator.
const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;]*[A-Za-z]`, 'g');
const MAX_FAILING = 200;
const DURATION = /\s+[([]?\d+(?:\.\d+)?\s?m?s[)\]]?$/;
/** The length failingTests cuts a failing test's name to. */
export const FAILING_NAME_MAX = 300;
/** A failing test's name as failingTests keeps it: no trailing duration, one space between words, cut to FAILING_NAME_MAX. */
export const tidy = (s: string) => s.replace(DURATION, '').replace(/\s+/g, ' ').trim().slice(0, FAILING_NAME_MAX);
// One test per line: pytest (FAILED <id>, and ERROR <file>::<test> for a setup or fixture error), go (--- FAIL: <Test>),
// cargo (test <x> ... FAILED), dotnet (Failed <x>).
const TEST_LINE = [/^\s*FAILED\s+(\S+)/, /^\s*ERROR\s+(\S+::\S+)/, /^\s*--- FAIL:\s+(\S+)/, /^test\s+(\S+)\s+\.\.\.\s+FAILED/, /^\s*Failed\s+(\S+)\s+\[[^\]]+\]\s*$/];
// Only test runners print these lines; a build's "Failed to compile." is not a test name.
const TEST_KINDS = new Set(['test', 'e2e', 'other']);
// A runner-level error that names no test, or a crash of the process (a segfault, a core dump, V8 out of heap, a fatal
// error): the names alone cannot say the run is the same as the base's.
const RUNNER_ERROR = new RegExp(String.raw`unhandled (?:errors?|rejections?)|test suite failed to run|error collecting|errors? during collection|^\s*Interrupted:|${CRASH}`, 'im');
const VITEST_FAIL = /^\s*FAIL\s+(.+)$/;
const VITEST_MARK = /^\s*[×✗]\s+(.+)$/;
const JEST = /^\s*●\s+(.+)$/;
// file(line,col): error TSnnnn: message, the position left out (an edit above the error moves it).
const TSC = /^(.+?)\(\d+,\d+\):\s+error\s+(TS\d+):\s*(.*)$/;
// Any tsc error: one TSC cannot read (no location, as TS2688 or TS18003, or the --pretty form) names nothing.
const TSC_ANY = /\berror TS\d+:/;

/**
 * The names a run's output gives its failures, and whether they are all of them (known). Unknown: lint and build (a
 * bundler's own errors name nothing the patterns read), a tsc error without a location, a crash of the process (any
 * kind), a runner-level error of a test kind, or more than MAX_FAILING names (one left out could be new).
 */
export function failingTests(output: string, kind: string): { names: string[]; known: boolean } {
  if (kind === 'lint') return { names: [], known: false };
  const lines = output.replace(ANSI, '').split(/\r?\n/);
  const found = new Set<string>();
  let capped = false;
  let unread = false;
  const add = (s: string) => {
    const t = tidy(s);
    if (!t || found.has(t)) return;
    if (found.size < MAX_FAILING) found.add(t); else capped = true;
  };
  for (const l of lines) {
    const t = TSC.exec(l);
    if (t) add(`${t[1].replace(/\\/g, '/')}: ${t[2]} ${t[3]}`);
    else if (TSC_ANY.test(l)) unread = true;
  }
  if (TEST_KINDS.has(kind)) {
    const fails = lines.map(l => VITEST_FAIL.exec(l)?.[1]).filter((s): s is string => !!s);
    for (const s of fails) add(s);
    // vitest's per-case marks only when no FAIL line names the cases (it prints both forms).
    if (!fails.length) for (const l of lines) { const m = VITEST_MARK.exec(l); if (m) add(m[1]); }
    for (const l of lines) { const m = JEST.exec(l); if (m && !/^Console\b/.test(m[1])) add(m[1]); }
    for (const l of lines) for (const re of TEST_LINE) { const m = re.exec(l); if (m) { add(m[1]); break; } }
  }
  // A crash makes the read unknown whatever the kind (a typecheck that ran out of heap beside the base's tsc error);
  // the other runner-level errors only for the test kinds.
  const text = lines.join('\n');
  const known = kind !== 'build' && found.size > 0 && !capped && !unread && !CRASH_RE.test(text) && !(TEST_KINDS.has(kind) && RUNNER_ERROR.test(text));
  return { names: [...found], known };
}

/** A failing validator as a `say` or a rollback names it: with the tests the baseline did not have, when there are any. */
export function failingLabel(r: Pick<ValidatorResult, 'validator' | 'newFailing'>, locale: 'es' | 'en' = 'en'): string {
  const fresh = r.newFailing ?? [];
  if (!fresh.length) return r.validator;
  const list = fresh.slice(0, 3).join('; ') + (fresh.length > 3 ? ` (+${fresh.length - 3})` : '');
  return `${r.validator} (${locale === 'es' ? 'nuevos en rojo' : 'new failing'}: ${list})`;
}

/**
 * The ledger's `validate` event (C4): the call's clock (`durationMs`), whether every result came from the tree cache
 * (`cached`), the scope (affected, small, heavy or final) and, per result, its own clock, `cached`, the failing tests
 * (always, [] when it passed or they could not be read: failingKnown) and the new ones. `extra` carries `baseline: true`
 * and `integrate`.
 */
export function validateEvent(ts: string, task: string | undefined, results: ValidatorResult[], durationMs: number, scope: Scope['mode'], extra: Record<string, unknown> = {}): LedgerEvent {
  return {
    ts, kind: 'validate', ...(task ? { task } : {}), ...extra, ok: results.every(r => !blocking(r)), scope, durationMs,
    cached: results.length > 0 && results.every(r => r.cached === true),
    results: results.map(r => ({
      validator: r.validator, ok: r.ok, flaky: r.flaky, durationMs: r.durationMs, cached: r.cached === true,
      failing: r.failing ?? [], failingKnown: r.failingKnown ?? false,
      ...(r.newFailing?.length ? { newFailing: r.newFailing } : {}), ...(r.skipped ? { skipped: r.skipped } : {}),
      ...(r.preexisting ? { preexisting: true } : {}), ...(r.ok ? {} : { failures: r.failures }),
    })),
  };
}

// vitest, jest, mocha and Playwright when the project has no test files yet.
export const NO_TESTS = /\b(no test files found|no tests found)\b/i;
const RUNS_TESTS = new Set(['test', 'e2e']);

// Without options: one at a time, every failure retried, as forge 0.16 ran them.
const SERIAL_RUN: RunOptions = { concurrency: 1, retry: () => true };
// build rewrites files the others read; e2e and bench want the machine to themselves.
const SERIAL_KINDS = new Set(['build', 'e2e', 'bench']);

/** The result of one validator from its first run, running it again only when `retry` says so. */
function settle(v: Validator, first: ExecResult, exec: (cmd: string, timeoutSec: number) => ExecResult, timeoutSec: number, retry: boolean): ValidatorResult {
  const timeout = { failures: [`timeout after ${timeoutSec} s`], failing: [], failingKnown: false };
  if (first.code === 0 && !first.timedOut) return { validator: v.name, ok: true, flaky: false, durationMs: first.ms, failures: [], failing: [], failingKnown: true };
  if (first.timedOut) return { validator: v.name, ok: false, flaky: false, durationMs: first.ms, ...timeout };
  if (RUNS_TESTS.has(v.kind) && NO_TESTS.test(first.output)) return { validator: v.name, ok: true, flaky: false, durationMs: first.ms, failures: failureLines(first.output), failing: [], failingKnown: true, skipped: 'no-tests' };
  if (!retry) {
    const f = failingTests(first.output, v.kind);
    return { validator: v.name, ok: false, flaky: false, durationMs: first.ms, failures: failureLines(first.output), failing: f.names, failingKnown: f.known };
  }
  const second = exec(v.cmd, timeoutSec);
  if (second.code === 0 && !second.timedOut) return { validator: v.name, ok: true, flaky: true, durationMs: first.ms + second.ms, failures: failureLines(first.output), failing: [], failingKnown: true };
  if (second.timedOut) return { validator: v.name, ok: false, flaky: false, durationMs: first.ms + second.ms, ...timeout };
  const f = failingTests(second.output, v.kind);
  return { validator: v.name, ok: false, flaky: false, durationMs: first.ms + second.ms, failures: failureLines(second.output), failing: f.names, failingKnown: f.known };
}

/**
 * Runs a list of validators (C-12). With execMany and a concurrency over 1, typecheck, lint, test and other kinds run
 * first in one parallel batch; then, one at a time in the list's order, build, e2e and bench, and the retries. A
 * failure runs again only when `retry` says so (a flaky history). The results keep the list's order.
 */
export function runValidators(list: Validator[], exec: (cmd: string, timeoutSec: number) => ExecResult, timeoutSec: number, opts: RunOptions = SERIAL_RUN): ValidatorResult[] {
  const firsts = new Map<number, ExecResult>();
  const batch = list.flatMap((v, i) => (SERIAL_KINDS.has(v.kind) ? [] : [i]));
  if (opts.execMany && opts.concurrency > 1 && batch.length > 1) {
    const rs = opts.execMany(batch.map(i => list[i].cmd), timeoutSec, opts.concurrency);
    batch.forEach((i, k) => { if (rs[k]) firsts.set(i, rs[k]); });
  }
  return list.map((v, i) => settle(v, firsts.get(i) ?? exec(v.cmd, timeoutSec), exec, timeoutSec, opts.retry(v)));
}

/** The validators with a flaky result (failed, then passed on its retry) in the ledger's last `days` days. */
export function flakyHistory(events: LedgerEvent[], now: Date, days = 30): Set<string> {
  const from = now.getTime() - days * 86400000;
  const out = new Set<string>();
  for (const e of events) {
    if (e.kind !== 'validate' || !Array.isArray(e.results) || !(Date.parse(e.ts) >= from)) continue;
    for (const r of e.results as unknown[]) {
      const x = r as { validator?: unknown; flaky?: unknown } | null;
      if (x && typeof x.validator === 'string' && x.flaky === true) out.add(x.validator);
    }
  }
  return out;
}

/** The validators a baseline had failing (D7); null when it names none (not an array, or no entry with a `validator`: `[]` is what review writes with no baseline). */
export function baselineFailing(baseline: unknown): ReadonlySet<string> | null {
  const named = (Array.isArray(baseline) ? baseline : []).filter((b): b is { validator: string; ok?: unknown } => !!b && typeof b === 'object' && typeof (b as { validator?: unknown }).validator === 'string');
  return named.length ? new Set(named.filter(b => b.ok === false).map(b => b.validator)) : null;
}

/**
 * How the config runs validators (validate.parallel, validate.retry), the retry rule read from the ledger. With a
 * baseline (D7), `flaky` also retries once a test validator that fails now and did not fail there; a deterministic kind
 * (typecheck, lint, build) is not retried, so a pass on the retry is the only way a new flaky enters the history.
 */
export function runOptions(config: Pick<ForgeConfig, 'validate'>, events: LedgerEvent[], now: Date, execMany?: ExecMany, baseline: ReadonlySet<string> | null = null): RunOptions {
  const policy = config.validate.retry;
  const flaky = policy === 'flaky' ? flakyHistory(events, now) : new Set<string>();
  const fresh = (v: Validator) => baseline !== null && !baseline.has(v.name) && RUNS_TESTS.has(v.kind);
  return { ...(execMany ? { execMany } : {}), concurrency: config.validate.parallel, retry: v => policy === 'always' || (policy === 'flaky' && (flaky.has(v.name) || fresh(v))) };
}

/**
 * Marks the failures a baseline already had (D-06): the same validator failed on the base commit, before the change, and
 * every test it fails now already failed there (a build that needs a file a later task creates, a suite broken
 * upstream). When either side could not name its failing tests (failingKnown), every failure line, normalized, must
 * already be there; a run with no failure line at all only matches a base with none either. A timeout is never
 * preexisting. A validator with tests the base did not fail gets `newFailing` and still counts. The baseline is the JSON
 * `forge validate` printed on the base commit (a forge 0.16 one has only lines).
 */
const normLine = (l: string) => l.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
const isTimeout = (r: ValidatorResult) => r.failures.some(f => /^timeout after \d+ s$/.test(f));
// The validators a baseline had failing, by name, with what it recorded of each; read with one tolerance for both readers.
function baselineFailures(baseline: unknown): Map<string, { failing: string[]; known: boolean; failures: string[] }> {
  const strs = (a: unknown) => (Array.isArray(a) ? a.filter((s): s is string => typeof s === 'string') : []);
  const before = new Map<string, { failing: string[]; known: boolean; failures: string[] }>();
  for (const b of Array.isArray(baseline) ? baseline : []) {
    if (!b || typeof b !== 'object') continue;
    const x = b as Record<string, unknown>;
    if (typeof x.validator !== 'string' || x.ok !== false) continue;
    before.set(x.validator, { failing: strs(x.failing), known: x.failingKnown === true, failures: strs(x.failures) });
  }
  return before;
}
/** The `failing` names the baseline gives `validator` when it failed there with every name read (failingKnown); [] otherwise. */
export function baseFailingNames(baseline: unknown, validator: string): string[] {
  const b = baselineFailures(baseline).get(validator);
  return b && b.known ? b.failing : [];
}
export function markPreexisting(results: ValidatorResult[], baseline: unknown): ValidatorResult[] {
  const before = baselineFailures(baseline);
  return results.map(r => {
    const b = r.ok ? undefined : before.get(r.validator);
    if (!b || isTimeout(r)) return r;
    if (r.failingKnown === true && b.known) {
      const was = new Set(b.failing);
      const fresh = (r.failing ?? []).filter(t => !was.has(t));
      return fresh.length ? { ...r, newFailing: fresh } : { ...r, preexisting: true };
    }
    const was = new Set(b.failures.map(normLine));
    const same = r.failures.length ? r.failures.every(l => was.has(normLine(l))) : !b.failures.length;
    return same ? { ...r, preexisting: true } : r;
  });
}

/** A result that counts against the change: a failure the base did not already have. */
export const blocking = (r: { ok?: unknown; preexisting?: unknown }): boolean => r.ok !== true && r.preexisting !== true;
