import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMANDS } from '../src/forge/cli/commands/index.js';

const cli = fileURLToPath(new URL('../src/forge/cli/', import.meta.url));
const source = (f: string) => readFileSync(path.join(cli, f), 'utf8');
// Commands that share one body share its module.
const SHARED: Record<string, string> = {
  'review-prep': 'review', 'review-close': 'review', prep: 'review', shadow: 'review', 'roadmap-doc': 'roadmap', 'roadmap-run': 'roadmap',
};
const walk = (dir: string): string[] => readdirSync(dir).flatMap(n => {
  const p = path.join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
/** The lines over 200 characters of these files, as `file:line (length)`; a usage string is read whole and stays. */
const longLines = (files: string[]) => files.flatMap(f => readFileSync(f, 'utf8').split(/\r?\n/)
  .map((l, i) => ({ l, at: `${path.relative(cli, f).split(path.sep).join('/')}:${i + 1} (${l.length})` }))
  .filter(x => x.l.length > 200 && !x.l.includes("'usage: forge "))
  .map(x => x.at));

describe('one module per forge command (I-12)', () => {
  it('every command of USAGE has its module in src/forge/cli/commands/ and is a key of COMMANDS', () => {
    const names = /usage: forge <([a-z|-]+)>/.exec(source('run.ts'))?.[1].split('|') ?? [];
    expect(names.length).toBeGreaterThan(30);
    expect(Object.keys(COMMANDS).sort()).toEqual([...names].sort());
    for (const n of names) expect(existsSync(path.join(cli, 'commands', `${SHARED[n] ?? n}.ts`)), n).toBe(true);
  });
  it('run.ts only dispatches: under 15 KB', () => {
    expect(statSync(path.join(cli, 'run.ts')).size).toBeLessThan(15 * 1024);
  });
  it('no line of the split modules is over 200 characters, but a usage string', () => {
    const files = [...['run.ts', 'context.ts', 'exec.ts', 'shared.ts'].map(f => path.join(cli, f)), ...walk(path.join(cli, 'commands'))];
    expect(longLines(files)).toEqual([]);
  });
});
