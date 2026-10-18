import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMANDS } from '../src/forge/cli/commands/index.js';

const cli = fileURLToPath(new URL('../src/forge/cli/', import.meta.url));
const source = (f: string) => readFileSync(path.join(cli, f), 'utf8');
// Commands that share one body share its module.
const SHARED: Record<string, string> = {
  'review-prep': 'review', 'review-close': 'review', prep: 'review', shadow: 'review', 'roadmap-doc': 'roadmap', 'roadmap-run': 'roadmap',
};

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
});
