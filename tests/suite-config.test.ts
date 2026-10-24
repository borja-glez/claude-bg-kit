import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import config, { SLOW } from '../vitest.config.js';
import { walk } from './helpers/files.js';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
type Project = { test: { name: string; include?: string[]; exclude?: string[] } };

describe('the suite (I-16)', () => {
  it('two projects: slow holds forge-swarm-integrate and the files over 5 s, unit the rest; each test file in exactly one', () => {
    const projects = (config.test?.projects ?? []) as unknown as Project[];
    expect(projects.map(p => p.test.name)).toEqual(['unit', 'slow']);
    const [unit, slow] = projects;
    expect(SLOW).toContain('tests/forge-swarm-integrate.test.ts');
    expect(new Set(SLOW).size).toBe(SLOW.length);
    expect(slow.test.include).toEqual(SLOW);
    expect(unit.test.include).toEqual(['tests/**/*.test.ts']);
    expect(unit.test.exclude).toEqual(expect.arrayContaining(SLOW));
    const files = readdirSync(new URL('.', import.meta.url)).filter(f => f.endsWith('.test.ts')).map(f => `tests/${f}`);
    for (const f of SLOW) expect(files, f).toContain(f);
    expect(config.test?.globalSetup).toEqual(['tests/setup/temp-root.ts']);
  });
  it('npm test runs both projects and npm run test:unit only unit', () => {
    const scripts = JSON.parse(read('package.json')).scripts as Record<string, string>;
    expect(scripts.test).toBe('vitest run');
    expect(scripts['test:unit']).toBe('vitest run --project unit');
  });
  it('the e2e project runs only with npm run test:e2e: its own config, files that end in .e2e.ts, one file at a time (A8)', async () => {
    const { default: e2e } = await import('../vitest.e2e.config.js');
    const t = e2e.test as { name?: string; include?: string[]; fileParallelism?: boolean; globalSetup?: string[]; projects?: unknown };
    expect(t.name).toBe('e2e');
    expect(t.include).toEqual(['tests/e2e/**/*.e2e.ts']);
    expect(t.fileParallelism).toBe(false);
    expect(t.globalSetup).toEqual(['tests/setup/temp-root.ts', 'tests/e2e/harness/announce.ts']);
    expect(t.projects).toBeUndefined();
    const scripts = JSON.parse(read('package.json')).scripts as Record<string, string>;
    expect(scripts['test:e2e']).toBe('vitest run --config vitest.e2e.config.ts');
    expect(scripts.test).toBe('vitest run');
    // a .test.ts under tests/e2e would also run in unit, and so in npm test and in CI
    expect(walk(fileURLToPath(new URL('./e2e', import.meta.url))).filter(f => f.endsWith('.test.ts'))).toEqual([]);
  });
});
