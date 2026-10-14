import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run, type Io } from '../src/forge/cli/run.js';
import { addCase, buildCase, startShadow } from '../src/forge/shadow.js';

let root: string;
let io: Io;
const state = () => JSON.parse(readFileSync(path.join(root, '.forge', 'shadow.json'), 'utf8'));

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'forge-shadow-cli-'));
  io = { cwd: root, now: () => new Date('2026-10-14T10:00:00.000Z') };
});

describe('forge shadow', () => {
  it('start opens the test with 10 briefs by default', () => {
    const r = run(['shadow', 'start'], io);
    expect(r.stderr).toBe('');
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ remaining: 10, cases: 0 });
    expect(state()).toEqual({ remaining: 10, cases: [] });
  });

  it('start --tasks <N> opens it with N briefs', () => {
    expect(run(['shadow', 'start', '--tasks', '3'], io).code).toBe(0);
    expect(state().remaining).toBe(3);
  });

  it('start again keeps the cases already collected; --reset clears them', () => {
    startShadow(root, 2);
    addCase(root, buildCase('T1-1', 'security', [], [{ severity: 'important', problem: 'x' }]));
    const again = run(['shadow', 'start', '--tasks', '6'], io);
    expect(again.code).toBe(0);
    expect(JSON.parse(again.stdout)).toEqual({ remaining: 6, cases: 1 });
    expect(state().cases).toHaveLength(1);
    const reset = run(['shadow', 'start', '--reset'], io);
    expect(reset.code).toBe(0);
    expect(JSON.parse(reset.stdout)).toEqual({ remaining: 10, cases: 0 });
    expect(state()).toEqual({ remaining: 10, cases: [] });
  });

  it('a --tasks that is not a positive integer is a usage error', () => {
    for (const bad of ['abc', '2.5', '0', '-1', '3x']) {
      const r = run(['shadow', 'start', '--tasks', bad], io);
      expect(r.code).toBe(2);
      expect(r.stderr).toMatch(/--tasks/);
    }
    const missing = run(['shadow', 'start', '--tasks'], io);
    expect(missing.code).toBe(2);
  });

  it('stop closes the test and keeps its cases', () => {
    startShadow(root, 5);
    addCase(root, buildCase('T1-1', 'security', [], [{ severity: 'important', problem: 'x' }]));
    const r = run(['shadow', 'stop'], io);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ remaining: 0, cases: 1 });
    expect(state().remaining).toBe(0);
    expect(state().cases).toHaveLength(1);
  });

  it('stop without a test open says so', () => {
    const r = run(['shadow', 'stop'], io);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ remaining: 0, cases: 0 });
  });

  it('report prints the per-reviewer report for the person, in es by default and in en', () => {
    startShadow(root, 4);
    addCase(root, buildCase('T1-1', 'security', [], [{ severity: 'critical', file: 'a.ts', line: 3, problem: 'sql injection' }]));
    const es = run(['shadow', 'report'], io);
    expect(es.code).toBe(0);
    expect(es.stdout).toContain('Prueba en sombra: abierta, quedan 4 briefs');
    expect(es.stdout).toContain('security: no cumple');
    expect(es.stdout).toContain('críticos perdidos: 1');
    expect(es.stdout).toContain('[critical] a.ts:3 sql injection');
    const en = run(['shadow', 'report', '--locale', 'en'], io);
    expect(en.stdout).toContain('Shadow test: open, 4 briefs left');
    expect(en.stdout).toContain('security: fails');
  });

  it('report with no test open says so', () => {
    const r = run(['shadow', 'report', '--locale', 'en'], io);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Shadow test: not started');
    expect(r.stdout).toContain('No shadow cases.');
  });

  it('an unknown subcommand or locale is a usage error', () => {
    expect(run(['shadow'], io).code).toBe(2);
    expect(run(['shadow', 'go'], io).code).toBe(2);
    expect(run(['shadow', 'report', '--locale', 'fr'], io).code).toBe(2);
  });
});
