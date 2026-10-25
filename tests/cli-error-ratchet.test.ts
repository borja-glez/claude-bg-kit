import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { baselineEntries, errorMessages, isActionable, scanCliErrors } from '../scripts/cli-errors.mjs';

const ROOT = process.cwd();
const BASELINE = 'tests/fixtures/cli-error-baseline.json';
// A7: how many exit-2 errors of the forge CLI did not say what to do at 2e9ae79. The list only shrinks: fixing one removes
// its entry and lowers this number by one. It never goes up: a new error says what to do.
const BASELINE_MAX = 148;
/** a minus b, as multisets. */
const minus = (a: string[], b: string[]) => { const left = [...b]; return a.filter(x => { const i = left.indexOf(x); if (i < 0) return true; left.splice(i, 1); return false; }); };

describe('the forge CLI error ratchet (A7)', () => {
  it('every exit-2 error says what to do, or is one of the baseline, which only shrinks', () => {
    const now = baselineEntries(ROOT);
    const base = JSON.parse(readFileSync(BASELINE, 'utf8')) as string[];
    expect(minus(now, base), 'new errors that do not say what to do: name the command, the flag or the step that fixes it').toEqual([]);
    expect(minus(base, now), `these say what to do now, or are gone: remove them from ${BASELINE} and lower BASELINE_MAX`).toEqual([]);
    expect(base.length).toBeLessThanOrEqual(BASELINE_MAX);
  });
  it('reads every UsageError and ConfigError of src/forge', () => {
    expect(scanCliErrors(ROOT).length).toBeGreaterThan(450);
  });
  it('an error says what to do when it names a flag, a command, an order or what is required', () => {
    for (const ok of ['brief: --prior-file needs a file', 'infinite start: a run is already active (forge stop, or forge infinite status)',
      'local set: .forge/verify/x.md changed since verify-plan showed it: run verify-plan again', 'usage: forge <triage|brief> ...',
      'swarm start: x has work not on y; use another id', 'config get: `x` is not a config key']) expect(isActionable(ok), ok).toBe(true);
    for (const bad of ['swarm close: no execution', 'proposals to-task: ${} not found', 'review-prep: cannot diff ${}..HEAD',
      'config get: ${} is not a config key', '<dynamic: dirtyMsg>', 'stop: nothing here']) expect(isActionable(bad), bad).toBe(false);
  });
  it('takes each message from the source: literals, templates, both sides of a condition, a const of the file, the stderr of an exit 2', () => {
    const src = [
      "const USAGE = 'usage: forge x <a|b>';",
      "throw new UsageError('x: --a needs a value');",
      'throw new UsageError(`x: ${name} not found`);',
      "throw new UsageError(ok ? 'x: one' : `x: two ${n}`);",
      'throw new UsageError(USAGE);',
      'throw new ConfigError(msg);',
      "return { code: 2, stdout: '', stderr: `${USAGE}\\n` };",
      "return { code: 1, stdout: '', stderr: 'not an exit 2\\n' };",
      "return fail(2, 'x: --b needs a value');",
      'throw new Error("not a usage error");',
    ].join('\n');
    expect(errorMessages(src)).toEqual(['x: --a needs a value', 'x: ${} not found', 'x: one', 'x: two ${}', 'usage: forge x <a|b>', '<dynamic: msg>', 'usage: forge x <a|b>', 'x: --b needs a value']);
  });
});
