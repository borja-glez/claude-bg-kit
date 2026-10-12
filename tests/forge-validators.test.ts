import { describe, it, expect } from 'vitest';
import { detectValidators, selectValidators, runValidators, failureLines, globMatch, type RepoReader } from '../src/forge/validators.js';
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
  it('an empty validators list in the config means none, without detection', () => {
    const c = parseConfig('validators: []\n');
    expect(detectValidators(repo({ 'package.json': JSON.stringify({ scripts: { test: 'x' } }) }), c)).toEqual([]);
  });
  it('config validators replace detection', () => {
    const c = parseConfig('validators:\n  - name: e2e\n    cmd: npm run e2e\n');
    expect(detectValidators(repo({ 'package.json': JSON.stringify({ scripts: { test: 'x' } }) }), c)).toEqual([{ name: 'e2e', cmd: 'npm run e2e', kind: 'other' }]);
  });
  it('a broken package.json detects nothing from it', () => {
    expect(detectValidators(repo({ 'package.json': '{oops' }), cfg)).toEqual([]);
  });
});

describe('selectValidators', () => {
  const all = [
    { name: 'typecheck', cmd: 'a', kind: 'typecheck' as const },
    { name: 'build', cmd: 'b', kind: 'build' as const },
    { name: 'e2e', cmd: 'c', kind: 'other' as const, affects: ['web/**'] },
  ];
  it('--all runs everything', () => { expect(selectValidators(all, null)).toHaveLength(3); });
  it('affected skips build and validators whose globs miss', () => {
    expect(selectValidators(all, ['src/x.ts']).map(v => v.name)).toEqual(['typecheck']);
    expect(selectValidators(all, ['web/page.tsx']).map(v => v.name)).toEqual(['typecheck', 'e2e']);
  });
  it('globs', () => {
    expect(globMatch('web/**', 'web/a/b.ts')).toBe(true);
    expect(globMatch('src/*.ts', 'src/a.ts')).toBe(true);
    expect(globMatch('src/*.ts', 'src/a/b.ts')).toBe(false);
  });
});

describe('runValidators', () => {
  const v = [{ name: 'test', cmd: 'npm test', kind: 'test' as const }];
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
