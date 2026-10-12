import { existsSync } from 'node:fs';
import path from 'node:path';
import type { ExecResult } from './cli/run.js';
import type { ForgeConfig } from './config.js';

export interface Validator { name: string; cmd: string; kind: string; affects?: string[] }
// A flaky result (failed, then passed on the retry) is ok: true; its first failures are kept for the record.
export interface ValidatorResult { validator: string; ok: boolean; flaky: boolean; durationMs: number; failures: string[] }
// list(dir) lists the entries of a directory relative to the repo root (the root itself when omitted).
export interface RepoReader { exists: (rel: string) => boolean; read: (rel: string) => string | null; list: (dir?: string) => string[] }

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

export function detectValidators(repo: RepoReader, config: ForgeConfig, which: (name: string) => boolean = onPath): Validator[] {
  // Validators listed in the config replace detection; an empty list means none.
  if (config.validators) return config.validators.map(v => ({ ...v, kind: v.kind ?? 'other' }));
  const out: Validator[] = [];
  const pkgText = repo.read('package.json');
  if (pkgText !== null) {
    let scripts: Record<string, unknown> = {};
    try { scripts = (JSON.parse(pkgText)?.scripts ?? {}) as Record<string, unknown>; } catch { scripts = {}; }
    const runner = repo.exists('bun.lock') || repo.exists('bun.lockb') ? 'bun' : repo.exists('pnpm-lock.yaml') ? 'pnpm' : repo.exists('yarn.lock') ? 'yarn' : 'npm';
    for (const [script, kind] of NPM_ORDER) {
      const body = scripts[script];
      if (typeof body !== 'string' || !body.trim()) continue;
      if (script === 'test' && PLACEHOLDER_TEST.test(body)) continue;
      if (kind === 'typecheck' && out.some(v => v.kind === 'typecheck')) continue;
      const cmd = script === 'test' ? `${runner} test` : runner === 'yarn' ? `yarn ${script}` : `${runner} run ${script}`;
      out.push({ name: script, cmd, kind });
    }
  }
  if (usesPytest(repo)) out.push({ name: 'pytest', cmd: `${pythonFor(repo, which)} -m pytest -q`, kind: 'test' });
  if (repo.exists('Cargo.toml')) out.push({ name: 'cargo-test', cmd: 'cargo test', kind: 'test' });
  if (repo.exists('go.mod')) out.push({ name: 'go-vet', cmd: 'go vet ./...', kind: 'lint' }, { name: 'go-test', cmd: 'go test ./...', kind: 'test' });
  const dotnet = dotnetTarget(repo.list());
  if (dotnet) out.push({ name: 'dotnet-test', cmd: `dotnet test ${/\s/.test(dotnet) ? `"${dotnet}"` : dotnet}`, kind: 'test' });
  const make = repo.read('GNUmakefile') ?? repo.read('makefile') ?? repo.read('Makefile');
  if (make !== null && /^test\s*:(?!=)/m.test(make) && !out.some(v => v.kind === 'test')) out.push({ name: 'make-test', cmd: 'make test', kind: 'test' });
  return out;
}

export function globMatch(glob: string, file: string): boolean {
  const re = glob.split('**').map(part => part.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*');
  return new RegExp(`^${re}$`).test(file.replace(/\\/g, '/'));
}

// null = all; a list = the validators that cover those paths (never build).
export function selectValidators(all: Validator[], affected: string[] | null): Validator[] {
  if (affected === null) return all;
  return all.filter(v => v.kind !== 'build' && (!v.affects?.length || affected.some(f => v.affects!.some(g => globMatch(g, f)))));
}

const FAILURE = /(fail|error|✗|×|assert|panic|exception)/i;
export function failureLines(output: string): string[] {
  const lines = output.split(/\r?\n/).map(l => l.trimEnd()).filter(l => l.trim());
  const hits = lines.filter(l => FAILURE.test(l));
  return (hits.length ? hits.slice(-20) : lines.slice(-10)).map(l => l.slice(0, 200));
}

export function runValidators(list: Validator[], exec: (cmd: string, timeoutSec: number) => ExecResult, timeoutSec: number): ValidatorResult[] {
  return list.map(v => {
    const first = exec(v.cmd, timeoutSec);
    if (first.code === 0 && !first.timedOut) return { validator: v.name, ok: true, flaky: false, durationMs: first.ms, failures: [] };
    if (first.timedOut) return { validator: v.name, ok: false, flaky: false, durationMs: first.ms, failures: [`timeout after ${timeoutSec} s`] };
    const second = exec(v.cmd, timeoutSec);
    if (second.code === 0 && !second.timedOut) return { validator: v.name, ok: true, flaky: true, durationMs: first.ms + second.ms, failures: failureLines(first.output) };
    return { validator: v.name, ok: false, flaky: false, durationMs: first.ms + second.ms, failures: second.timedOut ? [`timeout after ${timeoutSec} s`] : failureLines(second.output) };
  });
}
