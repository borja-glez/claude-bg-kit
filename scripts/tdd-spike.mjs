#!/usr/bin/env node
// tdd-spike: measures what running only the new tests on BASE adds to a round (A9, tdd: verified).
//
// For each scenario (vitest, pytest, bgkit) it builds a throwaway git repo with a BASE commit and a HEAD
// commit (the "task"), then runs the check mechanism three times: a detached worktree at BASE with the
// repo's dependency folders linked in, the HEAD version of each changed test file written over it, the
// test command on those files, and the cleanup. It times each step and judges the mechanism: the tests that
// must fail on BASE show up in a failure line, the one that tests nothing new does not, the links
// survive the cleanup and git forgets the worktree.
//
// Threshold (spec A9): the median adds at most max(30 s, 25 % of the round's validation).
// Exit codes: 0 every scenario passes; 3 a scenario is over the threshold; 4 the mechanism fails in
// one (it wins over 3); 2 it could not measure (no git, no Python, no network to install pytest).
//
// The only thing it writes outside the repo is its throwaway repos, in
// mkdtempSync(path.join(os.tmpdir(), 'tdd-spike-')); it deletes them at the end unless --keep.
//
// Usage: node scripts/tdd-spike.mjs [--keep] [--only vitest|pytest|bgkit]
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const WIN = process.platform === 'win32';
const RULE = "max(30 s, 25 % of the round's validation)";
const THRESHOLD_MS = 30000;
const PASSES = 3;
const OPTS = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, maxBuffer: 256 * 1024 * 1024 };

class SetupError extends Error {}

const args = process.argv.slice(2);
const keep = args.includes('--keep');
const onlyAt = args.indexOf('--only');
const only = onlyAt >= 0 ? args[onlyAt + 1] : null;
if (only !== null && !['vitest', 'pytest', 'bgkit'].includes(only)) {
  process.stderr.write('usage: node scripts/tdd-spike.mjs [--keep] [--only vitest|pytest|bgkit]\n');
  process.exit(2);
}

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', CI: '1' };

function sh(file, argv, cwd) {
  const r = spawnSync(file, argv, { ...OPTS, cwd, env });
  if (r.error) throw new SetupError(`${file}: ${r.error.message}`);
  return r;
}
function git(cwd, argv) {
  const r = sh('git', argv, cwd);
  if (r.status !== 0) throw new SetupError(`git ${argv.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}
function commit(cwd, message) {
  git(cwd, ['add', '-A']);
  git(cwd, ['-c', 'user.email=spike@example.invalid', '-c', 'user.name=spike', 'commit', '-q', '-m', message]);
}
function put(root, rel, content) {
  const file = path.join(root, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}
const linkType = WIN ? 'junction' : 'dir';
const isLink = p => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } };
const exists = p => { try { lstatSync(p); return true; } catch { return false; } };

// ---- scenarios -------------------------------------------------------------------------------

const range = n => Array.from({ length: n }, (_, i) => i);

function initRepo(root) {
  mkdirSync(root, { recursive: true });
  git(root, ['init', '-q', '-b', 'main']);
}

function buildVitest(tmp) {
  const root = path.join(tmp, 'vitest');
  initRepo(root);
  put(root, 'package.json', '{"type":"module","scripts":{"test":"vitest run"}}\n');
  put(root, '.gitignore', 'node_modules/\n');
  const its = i => range(10).map(j => `it('m${i} fn ${j}', () => expect(m${i}.f${j}()).toBe(${i * 10 + j}));\n`).join('');
  const head = i => `import { it, expect } from 'vitest';\nimport * as m${i} from '../src/m${i}.js';\n\n`;
  for (const i of range(40)) {
    put(root, `src/m${i}.js`, range(10).map(j => `export const f${j} = () => ${i * 10 + j};\n`).join(''));
    put(root, `tests/m${i}.test.js`, head(i) + its(i));
  }
  commit(root, 'base');
  const base = git(root, ['rev-parse', 'HEAD']).trim();
  put(root, 'src/m0.js', readFileSync(path.join(root, 'src/m0.js'), 'utf8') + 'export const added = () => 42;\n');
  put(root, 'tests/m0.test.js', head(0) + its(0)
    + "it('added returns 42', () => expect(m0.added()).toBe(42));\n"
    + "it('m0 still answers', () => expect(m0.f0()).toBe(0));\n");
  put(root, 'src/fresh.js', 'export const fresh = () => 1;\n');
  put(root, 'tests/fresh.test.js', "import { it, expect } from 'vitest';\nimport { fresh } from '../src/fresh.js';\n\nit('fresh answers', () => expect(fresh()).toBe(1));\n");
  commit(root, 'head');
  const files = ['tests/m0.test.js', 'tests/fresh.test.js'];
  const quoted = files.map(f => `"${f}"`).join(' ');
  return {
    name: 'vitest', runner: 'vitest', root, base, files,
    deps: [{ name: 'node_modules', marker: 'vitest/package.json', src: path.join(WT, 'node_modules') }],
    forms: true,
    cmd: form => form === 'run' ? `npx vitest run ${quoted}` : `npx vitest related --run --passWithNoTests ${quoted}`,
    validationCmd: 'npx vitest run',
    red: ['added returns 42', 'fresh'], passes: ['m0 still answers'],
  };
}

function buildPytest(tmp) {
  const root = path.join(tmp, 'pytest');
  initRepo(root);
  const py = WIN ? 'python' : 'python3';
  const venvPy = WIN ? path.join(root, '.venv', 'Scripts', 'python.exe') : path.join(root, '.venv', 'bin', 'python');
  let r = sh(py, ['-m', 'venv', '.venv'], root);
  if (r.status !== 0) throw new SetupError(`python -m venv failed: ${r.stderr}`);
  r = sh(venvPy, ['-m', 'pip', 'install', '--quiet', '--disable-pip-version-check', 'pytest'], root);
  if (r.status !== 0) throw new SetupError(`pip install pytest failed: ${r.stderr}`);
  put(root, '.gitignore', '.venv/\n__pycache__/\n.pytest_cache/\n');
  put(root, 'pyproject.toml', '[tool.pytest.ini_options]\npythonpath = ["."]\n');
  put(root, 'pkg/__init__.py', '');
  const tests = i => range(10).map(j => `\n\ndef test_f${j}():\n    assert m${i}.f${j}() == ${i * 10 + j}\n`).join('');
  const head = i => `import pkg.m${i} as m${i}`;
  for (const i of range(40)) {
    put(root, `pkg/m${i}.py`, range(10).map(j => `def f${j}():\n    return ${i * 10 + j}\n`).join('\n\n'));
    put(root, `tests/test_m${i}.py`, head(i) + tests(i));
  }
  commit(root, 'base');
  const base = git(root, ['rev-parse', 'HEAD']).trim();
  put(root, 'pkg/m0.py', readFileSync(path.join(root, 'pkg/m0.py'), 'utf8') + '\n\ndef added():\n    return 42\n');
  put(root, 'tests/test_m0.py', head(0) + tests(0)
    + '\n\ndef test_added():\n    assert m0.added() == 42\n'
    + '\n\ndef test_m0_still_answers():\n    assert m0.f0() == 0\n');
  put(root, 'pkg/fresh.py', 'def fresh():\n    return 1\n');
  put(root, 'tests/test_fresh.py', 'from pkg.fresh import fresh\n\n\ndef test_fresh():\n    assert fresh() == 1\n');
  commit(root, 'head');
  const files = ['tests/test_m0.py', 'tests/test_fresh.py'];
  const venvRel = WIN ? '.venv\\Scripts\\python.exe' : '.venv/bin/python';
  return {
    name: 'pytest', runner: 'pytest', root, base, files,
    deps: [{ name: '.venv', marker: 'pyvenv.cfg', src: path.join(root, '.venv') }],
    forms: false,
    cmd: () => `${venvRel} -m pytest -q ${files.map(f => `"${f}"`).join(' ')} --continue-on-collection-errors`,
    validationCmd: `${venvRel} -m pytest -q`,
    red: ['test_added', 'test_fresh'], passes: ['test_m0_still_answers'],
    expectedPassed: 11,
  };
}

function buildBgkit(tmp) {
  const root = path.join(tmp, 'bgkit');
  git(tmp, ['clone', '--quiet', '--local', '--no-hardlinks', WT, root]);
  const base = git(root, ['rev-parse', 'HEAD']).trim();
  const triage = path.join(root, 'src/forge/triage.ts');
  put(root, 'src/forge/triage.ts', readFileSync(triage, 'utf8') + 'export const spikeAnswer = (): number => 42;\n');
  const testFile = path.join(root, 'tests/forge-triage.test.ts');
  const text = readFileSync(testFile, 'utf8');
  if (!text.includes('isMechanical, ')) throw new SetupError('tests/forge-triage.test.ts no longer imports isMechanical: update the spike');
  put(root, 'tests/forge-triage.test.ts', text.replace('isMechanical, ', 'isMechanical, spikeAnswer, ')
    + "\nit('spike: spikeAnswer is 42', () => expect(spikeAnswer()).toBe(42));\n"
    + "it('spike: isMechanical still reads a bump', () => expect(isMechanical('bump the version')).toBe(true));\n");
  commit(root, 'head');
  const files = ['tests/forge-triage.test.ts'];
  const quoted = files.map(f => `"${f}"`).join(' ');
  return {
    name: 'bgkit', runner: 'vitest', root, base, files,
    deps: [{ name: 'node_modules', marker: 'vitest/package.json', src: path.join(WT, 'node_modules') }],
    forms: true,
    cmd: form => form === 'run' ? `npx vitest run ${quoted}` : `npx vitest related --run --passWithNoTests ${quoted}`,
    validationCmd: 'npx vitest run',
    red: ['spikeAnswer'], passes: ['isMechanical still reads a bump'],
  };
}

// ---- the mechanism ---------------------------------------------------------------------------

const worktreeNames = (repo, needle) => git(repo, ['worktree', 'list', '--porcelain']).split(/\r?\n/).some(l => l.startsWith('worktree ') && l.includes(needle));

function runTests(cmd, cwd) {
  const r = spawnSync(cmd, { shell: true, cwd, encoding: 'utf8', timeout: 600000, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, maxBuffer: OPTS.maxBuffer, env });
  if (r.error && r.error.code !== 'ETIMEDOUT') throw new SetupError(`${cmd}: ${r.error.message}`);
  return `${r.stdout ?? ''}\n${r.stderr ?? ''}`.replace(ANSI, '');
}

// One pass: add, link, overlay, run, cleanup. Returns the output and the checks the cleanup proves.
function pass(sc, form) {
  const passTmp = mkdtempSync(path.join(os.tmpdir(), 'tdd-spike-'));
  const baseDir = path.join(passTmp, 'base');
  const hooks = path.join(passTmp, 'no-hooks');
  mkdirSync(hooks);
  const stepsMs = {};
  let mark = performance.now();
  const lap = key => { const now = performance.now(); stepsMs[key] = Math.round(now - mark); mark = now; };
  const links = [];
  let out = '';
  let linksIntact = false;
  let entryGone = false;
  let added = false;
  try {
    git(sc.root, ['-c', `core.hooksPath=${hooks}`, 'worktree', 'add', '--detach', '--quiet', baseDir, sc.base]);
    added = true;
    lap('add');
    for (const dep of sc.deps) {
      const dst = path.join(baseDir, dep.name);
      symlinkSync(realpathSync(dep.src), dst, linkType);
      links.push({ dst, real: realpathSync(dep.src), marker: dep.marker });
    }
    lap('link');
    for (const f of sc.files) {
      const blob = execFileSync('git', ['cat-file', 'blob', `HEAD:${f}`], { cwd: sc.root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, maxBuffer: OPTS.maxBuffer });
      put(baseDir, f, blob);
    }
    lap('overlay');
    out = runTests(sc.cmd(form), baseDir);
    lap('run');
  } finally {
    // T5's order: unlink; lstat confirms no link; read gitdir; worktree remove --force; rmSync; the own entry; never prune.
    let gitdir = null;
    let unlinked = true;
    for (const l of links) {
      try { unlinkSync(l.dst); } catch { /* checked below */ }
      if (exists(l.dst)) unlinked = false;
    }
    linksIntact = unlinked && links.every(l => existsSync(path.join(l.real, l.marker)));
    if (unlinked) {
      if (added) {
        try { gitdir = /^gitdir:\s*(.+)$/m.exec(readFileSync(path.join(baseDir, '.git'), 'utf8'))?.[1].trim() ?? null; } catch { /* no .git file */ }
        try { git(sc.root, ['worktree', 'remove', '--force', baseDir]); } catch { /* the rmSync below and the entry check cover it */ }
      }
      rmSync(passTmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      if (gitdir && existsSync(gitdir)) rmSync(gitdir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      entryGone = !worktreeNames(sc.root, path.basename(passTmp));
    }
    lap('cleanup');
  }
  return { stepsMs, totalMs: Object.values(stepsMs).reduce((a, b) => a + b, 0), out, linksIntact, entryGone };
}

const failLines = out => out.split(/\r?\n/).filter(l => /^\s*(FAIL|FAILED|ERROR)\b|^\s*[×✗]/.test(l));

function judge(sc, p, form) {
  const lines = failLines(p.out);
  const red = sc.red.filter(n => lines.some(l => l.includes(n)));
  const passedOnBase = sc.passes.filter(n => !lines.some(l => l.includes(n)));
  const notes = lines.map(l => `base output: ${l.trim()}`);
  const passedCount = Number(/(\d+) passed/.exec(p.out)?.[1] ?? 0);
  const ran = passedCount > 0;
  if (!ran) notes.push('no passing test in the output of BASE: the run did not reach the tests');
  if (sc.expectedPassed !== undefined) {
    const judged = passedCount === sc.expectedPassed;
    notes.push(judged
      ? `--continue-on-collection-errors judged test_m0_still_answers next to test_fresh.py, which does not load (${passedCount} passed)`
      : `--continue-on-collection-errors did NOT judge test_m0_still_answers next to test_fresh.py (${passedCount} passed, expected ${sc.expectedPassed})`);
  }
  const ok = red.length === sc.red.length && passedOnBase.length === sc.passes.length && ran
    && p.linksIntact && p.entryGone && (!sc.forms || form !== null);
  return { red, passedOnBase, linksIntact: p.linksIntact, entryGone: p.entryGone, ok, notes };
}

function measure(sc) {
  const scenario = { name: sc.name, runner: sc.runner, form: null, cmd: '', files: sc.files, runsMs: [], medianMs: 0, stepsMs: { add: 0, link: 0, overlay: 0, run: 0, cleanup: 0 }, validationMs: null, limitMs: THRESHOLD_MS, pass: false, mechanism: null, notes: [] };
  let form = null;
  let probe = null;
  if (sc.forms) {
    // Decide the form once, untimed: `related` if a named test file runs itself, `run` if it took `vitest run`.
    const seen = (p) => sc.files.some(f => p.out.includes(path.basename(f)));
    probe = pass(sc, 'related');
    if (seen(probe)) form = 'related';
    else {
      probe = pass(sc, 'run');
      if (seen(probe)) { form = 'run'; scenario.notes.push('vitest related did not run the named test files; vitest run did'); }
    }
  }
  scenario.form = form;
  scenario.cmd = sc.cmd(form);
  if (sc.forms && form === null) {
    scenario.mechanism = judge(sc, probe, null);
    scenario.notes.push('neither vitest related nor vitest run executed the named test files');
    scenario.notes.push(...scenario.mechanism.notes);
    return scenario;
  }
  const passes = range(PASSES).map(() => pass(sc, form));
  const sorted = [...passes].sort((a, b) => a.totalMs - b.totalMs);
  const median = sorted[Math.floor(PASSES / 2)];
  scenario.runsMs = passes.map(p => p.totalMs);
  scenario.medianMs = median.totalMs;
  scenario.stepsMs = median.stepsMs;
  const mech = judge(sc, median, form);
  mech.linksIntact = passes.every(p => p.linksIntact);
  mech.entryGone = passes.every(p => p.entryGone);
  mech.ok = mech.ok && mech.linksIntact && mech.entryGone;
  scenario.mechanism = mech;
  scenario.notes.push(...mech.notes);
  if (scenario.medianMs > THRESHOLD_MS) {
    const t0 = performance.now();
    runTests(sc.validationCmd, sc.root);
    scenario.validationMs = Math.round(performance.now() - t0);
  }
  scenario.limitMs = Math.max(THRESHOLD_MS, 0.25 * (scenario.validationMs ?? 0));
  scenario.pass = scenario.medianMs <= scenario.limitMs;
  return scenario;
}

// ---- main ------------------------------------------------------------------------------------

function dropLinks(root, deps) {
  for (const d of deps) {
    const p = path.join(root, d.name);
    if (isLink(p)) { try { unlinkSync(p); } catch { /* left for rmSync */ } }
  }
}

const tmp = mkdtempSync(path.join(os.tmpdir(), 'tdd-spike-'));
const built = [];
const scenarios = [];
let setupError = null;
try {
  const git0 = spawnSync('git', ['--version'], OPTS);
  if (git0.error || git0.status !== 0) throw new SetupError('git is not available');
  const builders = [['vitest', buildVitest], ['pytest', buildPytest], ['bgkit', buildBgkit]];
  for (const [name, build] of builders) {
    if (only && only !== name) continue;
    const sc = build(tmp);
    built.push(sc);
    for (const d of sc.deps) {
      const dst = path.join(sc.root, d.name);
      if (!exists(dst)) symlinkSync(realpathSync(d.src), dst, linkType);
    }
    scenarios.push(measure(sc));
  }
} catch (e) {
  if (!(e instanceof SetupError)) throw e;
  setupError = e;
} finally {
  if (keep) process.stderr.write(`kept: ${tmp}\n`);
  else {
    for (const sc of built) dropLinks(sc.root, sc.deps);
    rmSync(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

if (setupError) {
  process.stderr.write(`tdd-spike: could not measure: ${setupError.message}\n`);
  process.exit(2);
}
const depsOk = existsSync(path.join(WT, 'node_modules', 'vitest', 'package.json'));
if (!depsOk) process.stderr.write('tdd-spike: WT/node_modules/vitest/package.json is gone\n');
const mechanismOk = depsOk && scenarios.every(s => s.mechanism.ok);
const timeOk = scenarios.every(s => s.pass);
process.stdout.write(`${JSON.stringify({ pass: mechanismOk && timeOk, rule: RULE, scenarios }, null, 2)}\n`);
process.exit(!mechanismOk ? 4 : !timeOk ? 3 : 0);
