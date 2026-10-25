import { describe, it, expect } from 'vitest';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { parseConfig, ConfigError } from '../src/forge/config.js';
import { TDD_VERIFIED_LINE, BUG_LINE } from '../src/forge/brief.js';
import { readEvents } from '../src/forge/ledger.js';
import { isBugTask } from '../src/forge/triage.js';
import { run, type Io } from '../src/forge/cli/run.js';
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
