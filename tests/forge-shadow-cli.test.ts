import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { run, type Io } from '../src/forge/cli/run.js';
import { addCase, buildCase, startShadow } from '../src/forge/shadow.js';
import { useTempDirs } from './helpers/tmp.js';
const tmp = useTempDirs();

let root: string;
let io: Io;
const state = () => JSON.parse(readFileSync(path.join(root, '.forge', 'shadow.json'), 'utf8'));

beforeEach(() => {
  root = tmp('forge-shadow-cli-');
  io = { cwd: root, now: () => new Date('2026-10-14T10:00:00.000Z'), env: {} };
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

  it('collect saves the case of a twin that came back after review-close, and lists one still out as pending (C-11)', () => {
    startShadow(root, 3);
    const dir = path.join(root, '.forge', 'work', 'T1', 'reviews-1-1');
    mkdirSync(path.join(dir, 'shadow'), { recursive: true });
    writeFileSync(path.join(dir, 'review-plan.json'), JSON.stringify({ task: 'T1-1', round: 1, spawn: [
      { agent: 'forge-review-security', role: 'review-security', effort: 'high', mode: 'full', inputs: {} },
      { agent: 'forge-review-security', role: 'review-security', effort: 'xhigh', mode: 'full', twin: true, inputs: {} },
      { agent: 'forge-review-perf', role: 'review-perf', effort: 'high', mode: 'full', inputs: {} },
      { agent: 'forge-review-perf', role: 'review-perf', effort: 'xhigh', mode: 'full', twin: true, inputs: {} },
    ] }));
    writeFileSync(path.join(dir, 'security.json'), JSON.stringify({ verdict: 'pass', confidence: 0.9, findings: [] }));
    writeFileSync(path.join(dir, 'perf.json'), JSON.stringify({ verdict: 'pass', confidence: 0.9, findings: [] }));
    writeFileSync(path.join(dir, 'shadow', 'security.json'), JSON.stringify({ verdict: 'fail', confidence: 0.9, findings: [{ severity: 'critical', file: 'a.ts', line: 3, problem: 'path traversal' }] }));
    const r = run(['shadow', 'collect', '--task', 'T1-1', '--dir', '.forge/work/T1/reviews-1-1'], io);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ shadow: ['security'], shadowSkipped: [], shadowPending: [{ reviewer: 'perf', file: '.forge/work/T1/reviews-1-1/shadow/perf.json' }] });
    expect(state().cases).toEqual([expect.objectContaining({ task: 'T1-1', reviewer: 'security', missedCritical: [expect.objectContaining({ problem: 'path traversal' })] })]);
    // Collecting again replaces the case of that review.
    run(['shadow', 'collect', '--task', 'T1-1', '--dir', '.forge/work/T1/reviews-1-1'], io);
    expect(state().cases).toHaveLength(1);
    expect(run(['shadow', 'collect', '--task', 'T1-1', '--dir', 'nowhere'], io).code).toBe(2);
    expect(run(['shadow', 'collect', '--dir', '.forge/work/T1/reviews-1-1'], io).code).toBe(2);
    expect(run(['shadow', 'collect', '--task', 'T1', '--dir', '.forge/work/T1/reviews-1-1'], io).code).toBe(2);
  });

  it('collect refuses a dir that is not a review dir of that brief under .forge/work, and saves nothing', () => {
    startShadow(root, 3);
    const mk = (rel: string, task: string) => {
      const d = path.join(root, rel);
      mkdirSync(path.join(d, 'shadow'), { recursive: true });
      writeFileSync(path.join(d, 'review-plan.json'), JSON.stringify({ task, round: 1, spawn: [{ role: 'review-security', twin: true }] }));
      writeFileSync(path.join(d, 'security.json'), JSON.stringify({ verdict: 'pass', confidence: 0.9, findings: [] }));
      writeFileSync(path.join(d, 'shadow', 'security.json'), JSON.stringify({ verdict: 'pass', confidence: 0.9, findings: [] }));
    };
    mk('outside/reviews-1-1', 'T1-1');
    mk('.forge/work/T1/reviews-2-1', 'T1-2');
    mk('.forge/work/T1/reviews-1-1', 'T9-1');
    expect(run(['shadow', 'collect', '--task', 'T1-1', '--dir', '..'], io).code).toBe(2);
    expect(run(['shadow', 'collect', '--task', 'T1-1', '--dir', path.join(root, 'outside', 'reviews-1-1')], io).code).toBe(2);
    expect(run(['shadow', 'collect', '--task', 'T1-1', '--dir', '.forge/work/T1/reviews-2-1'], io).code).toBe(2);
    expect(run(['shadow', 'collect', '--task', 'T1-1', '--dir', '.forge/work/T1/reviews-1-1'], io).code).toBe(2);
    expect(state().cases).toEqual([]);
  });
});
