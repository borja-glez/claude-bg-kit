import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFile, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { buildSync } from 'esbuild';
import { samePath } from '../src/lib/worktree.js';
import { appendEvent, appendPhase, readEvents, readStatus, forgeDir, ledgerRoot } from '../src/forge/ledger.js';
import { parseConfig, agentFor, ConfigError } from '../src/forge/config.js';

let root: string;
beforeEach(() => { root = mkdtempSync(path.join(tmpdir(), 'forge-')); });

describe('ledger', () => {
  it('creates .forge with a gitignore that keeps config.yaml and verify/*.md', () => {
    const dir = forgeDir(root);
    expect(readFileSync(path.join(dir, '.gitignore'), 'utf8')).toBe('*\n!.gitignore\n!config.yaml\n!verify/\n!verify/*.md\n');
  });
  it('appends and reads events in order', () => {
    appendEvent(root, { ts: '2026-10-11T10:00:00.000Z', kind: 'triage', task: 't1', path: 'small' });
    appendEvent(root, { ts: '2026-10-11T10:01:00.000Z', kind: 'phase', task: 't1', phase: 'implement' });
    expect(readEvents(root).map(e => e.kind)).toEqual(['triage', 'phase']);
  });
  it('appendPhase skips the phase a task is already in and appends any other (C4)', () => {
    expect(appendPhase(root, { ts: '1', kind: 'phase', task: 'A', phase: 'validate', brief: 1, round: 1 })).toBe(true);
    expect(appendPhase(root, { ts: '2', kind: 'phase', task: 'A', phase: 'validate', brief: 1, round: 1 })).toBe(false);
    expect(appendPhase(root, { ts: '3', kind: 'phase', task: 'B', phase: 'validate' })).toBe(true);
    expect(appendPhase(root, { ts: '4', kind: 'phase', task: 'A', phase: 'review', brief: 1, round: 1 })).toBe(true);
    expect(appendPhase(root, { ts: '5', kind: 'phase', task: 'A', phase: 'validate', brief: 1, round: 2 })).toBe(true);
    expect(readEvents(root).map(e => `${e.task}:${e.phase}`)).toEqual(['A:validate', 'B:validate', 'A:review', 'A:validate']);
  });
  it("appendPhase logs another brief's same phase; a phase without a brief (swarm task) still counts as the same", () => {
    expect(appendPhase(root, { ts: '1', kind: 'phase', task: 'A', phase: 'validate', brief: 1, round: 1 })).toBe(true);
    expect(appendPhase(root, { ts: '2', kind: 'phase', task: 'A', phase: 'validate', brief: 2, round: 1 })).toBe(true);
    expect(appendPhase(root, { ts: '3', kind: 'phase', task: 'A', phase: 'validate' })).toBe(false);
    expect(appendPhase(root, { ts: '4', kind: 'phase', task: 'A', phase: 'review' })).toBe(true);
    expect(appendPhase(root, { ts: '5', kind: 'phase', task: 'A', phase: 'review', brief: 2, round: 1 })).toBe(false);
    expect(readEvents(root).map(e => `${e.phase}:${e.brief ?? '-'}`)).toEqual(['validate:1', 'validate:2', 'review:-']);
  });
  it('appendPhase dedupes within the project the phase belongs to; an unsafe project counts as none, never as a new one (D-08)', () => {
    appendEvent(root, { ts: '1', kind: 'triage', task: 'A', project: 'shop' });
    expect(appendPhase(root, { ts: '2', kind: 'phase', task: 'A', phase: 'implement' })).toBe(true);
    expect(appendPhase(root, { ts: '3', kind: 'phase', task: 'A', phase: 'implement', project: '../x' })).toBe(false);
    expect(appendPhase(root, { ts: '4', kind: 'phase', task: 'A', phase: 'implement', project: 'shop' })).toBe(false);
    expect(appendPhase(root, { ts: '5', kind: 'phase', task: 'A', phase: 'implement', project: 'web' })).toBe(true);
    expect(appendPhase(root, { ts: '6', kind: 'phase', task: 'A', phase: 'implement', project: 'web' })).toBe(false);
    expect(readEvents(root).filter(e => e.kind === 'phase').map(e => e.ts)).toEqual(['2', '5']);
  });
  it('skips a half-written line and keeps appending after it', () => {
    appendEvent(root, { ts: 'a', kind: 'triage', task: 't1' });
    appendFileSync(path.join(root, '.forge', 'ledger.jsonl'), '{"ts":"b","kind":"pha');
    appendEvent(root, { ts: 'c', kind: 'verdict', task: 't1' });
    expect(readEvents(root).map(e => e.ts)).toEqual(['a', 'c']);
  });
  it('skips lines with an unknown kind', () => {
    appendFileSync(path.join(forgeDir(root), 'ledger.jsonl'), '{"ts":"x","kind":"bogus"}\n');
    expect(readEvents(root)).toEqual([]);
  });
  it('skips events whose task is present but not a string', () => {
    appendFileSync(path.join(forgeDir(root), 'ledger.jsonl'), '{"ts":"x","kind":"phase","task":7}\n{"ts":"y","kind":"phase","task":null}\n{"ts":"z","kind":"phase"}\n');
    expect(readEvents(root).map(e => e.ts)).toEqual(['z']);
  });
  it('appends on its own line after a file that ends without a newline', () => {
    appendFileSync(path.join(forgeDir(root), 'ledger.jsonl'), '{"ts":"a","kind":"phase"}');
    appendEvent(root, { ts: 'b', kind: 'phase' });
    expect(readFileSync(path.join(root, '.forge', 'ledger.jsonl'), 'utf8')).toBe('{"ts":"a","kind":"phase"}\n{"ts":"b","kind":"phase"}\n');
  });
});

describe('status.json', () => {
  const status = () => JSON.parse(readFileSync(path.join(root, '.forge', 'status.json'), 'utf8'));
  it('follows a triage, phase, agent, validate, verdict and round sequence', () => {
    appendEvent(root, { ts: '2026-10-11T10:00:00.000Z', kind: 'triage', task: 'hash', path: 'medium' });
    expect(status()).toMatchObject({ task: 'hash', path: 'medium', phase: '', agent: null, ts: '2026-10-11T10:00:00.000Z' });
    appendEvent(root, { ts: '2026-10-11T10:01:00.000Z', kind: 'phase', task: 'hash', phase: 'review' });
    appendEvent(root, { ts: '2026-10-11T10:02:00.000Z', kind: 'agent', task: 'hash', agent: 'forge-review-security' });
    appendEvent(root, { ts: '2026-10-11T10:03:00.000Z', kind: 'validate', task: 'hash-1', results: [{ validator: 'test', ok: true, flaky: false }] });
    appendEvent(root, { ts: '2026-10-11T10:04:00.000Z', kind: 'verdict', task: 'hash-1', action: 'accept', score: 0.97 });
    appendEvent(root, { ts: '2026-10-11T10:05:00.000Z', kind: 'round', task: 'hash-1', round: 0, cap: 3 });
    appendEvent(root, { ts: '2026-10-11T10:06:00.000Z', kind: 'verdict', task: 'other-1', action: 'reject', score: 0.1 });
    expect(status()).toEqual({
      ts: '2026-10-11T10:01:00.000Z', task: 'hash', path: 'medium', phase: 'review', agent: 'forge-review-security',
      validators: [{ name: 'test', ok: true }], verdict: { action: 'accept', score: 0.97 }, round: 0, cap: 3,
      brief: 1, accepted: [1], verify: null,
      taskStartedAt: '2026-10-11T10:00:00.000Z', stageSince: '2026-10-11T10:01:00.000Z', stages: { triage: 60 }, doneAt: null, lastAt: '2026-10-11T10:05:00.000Z',
    });
    expect(readStatus(root)).toEqual(status());
  });
  it('replaces a corrupt status.json on the next task event, and the append never fails because of it', () => {
    forgeDir(root);
    writeFileSync(path.join(root, '.forge', 'status.json'), '{"task":');
    appendEvent(root, { ts: 'a', kind: 'agent', task: 'x', agent: 'y' });
    expect(readEvents(root)).toHaveLength(1);
    appendEvent(root, { ts: 'b', kind: 'phase', task: 'x', phase: 'implement' });
    expect(status()).toMatchObject({ task: 'x', phase: 'implement', agent: null });
  });
});

describe('config', () => {
  it('defaults when there is no file', () => {
    expect(parseConfig(null)).toEqual({
      profile: 'balanced', detect: true, exclude: [], verify: { limits: { checks: 8, shots: 10, minutes: 10 } },
      evidence: 'upload', validatorTimeoutSec: 600, validate: { cache: true, parallel: 3, retry: 'flaky' }, review: { express: true, personDocs: ['README.md', 'README.*.md', '**/README.md', '**/README.*.md', 'CHANGELOG.md', '**/CHANGELOG.md'] }, swarm: { parallel: 3, launcher: 'bg', member: { effort: 'medium' }, validateJobs: 2 }, tdd: 'off',
      generated: [],
    });
  });
  it('reads validators and profile', () => {
    const c = parseConfig('profile: economy\nvalidators:\n  - name: unit\n    cmd: npm test\n    kind: test\n');
    expect(c.profile).toBe('economy');
    expect(c.validators).toEqual([{ name: 'unit', cmd: 'npm test', kind: 'test' }]);
  });
  it('rejects an unknown profile', () => {
    expect(() => parseConfig('profile: turbo\n')).toThrow(ConfigError);
  });
  it('malformed YAML is a ConfigError', () => {
    expect(() => parseConfig('profile: [economy\nvalidators: {\n')).toThrow(ConfigError);
  });
  it('an empty validators list is kept (it means none)', () => {
    expect(parseConfig('validators: []\n').validators).toEqual([]);
  });
  it('maps roles to agents per profile', () => {
    expect(agentFor('impl-heavy', 'balanced')).toBe('forge-impl-heavy');
    expect(agentFor('impl-heavy', 'economy')).toBe('forge-impl-high');
    expect(agentFor('impl', 'economy')).toBe('forge-impl-light');
    expect(agentFor('impl', 'quality')).toBe('forge-impl-heavy');
    expect(agentFor('impl-light', 'quality')).toBe('forge-impl');
    expect(agentFor('mech', 'quality')).toBe('forge-impl-light');
    expect(agentFor('review-security', 'economy')).toBe('forge-review-security');
  });
});

describe('parseConfig swarm', () => {
  it('defaults parallel to 3', () => {
    expect(parseConfig('profile: economy\n').swarm).toEqual({ parallel: 3, launcher: 'bg', member: { effort: 'medium' }, validateJobs: 2 });
  });
  it('reads parallel from 1 to 10', () => {
    expect(parseConfig('swarm:\n  parallel: 1\n').swarm.parallel).toBe(1);
    expect(parseConfig('swarm:\n  parallel: 10\n').swarm.parallel).toBe(10);
  });
  it('rejects parallel outside 1-10, non-integers and unknown swarm keys', () => {
    expect(() => parseConfig('swarm:\n  parallel: 0\n')).toThrow(ConfigError);
    expect(() => parseConfig('swarm:\n  parallel: 11\n')).toThrow(ConfigError);
    expect(() => parseConfig('swarm:\n  parallel: 2.5\n')).toThrow(ConfigError);
    expect(() => parseConfig('swarm:\n  max: 3\n')).toThrow(ConfigError);
  });
});

describe('the ledger of a forge task worktree (D-10)', () => {
  it('an event appended in <main>/.claude/worktrees/task-T1 goes to the main ledger; its status.json stays in the worktree', () => {
    const main = mkdtempSync(path.join(tmpdir(), 'forge-ledger-main-'));
    const g = (...a: string[]) => execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', ...a], { cwd: main, encoding: 'utf8' });
    g('init', '-q', '-b', 'main'); writeFileSync(path.join(main, '.gitignore'), '.forge/\n.claude/\n'); g('add', '.'); g('commit', '-qm', 'init');
    const wt = path.join(main, '.claude', 'worktrees', 'task-T1');
    g('worktree', 'add', '-q', '-b', 'task/T1', wt);
    expect(samePath(ledgerRoot(wt), main)).toBe(true);
    // What the member wrote before this version stays readable, before the main ledger's events.
    forgeDir(wt);
    appendFileSync(path.join(wt, '.forge', 'ledger.jsonl'), JSON.stringify({ ts: '2026-10-16T09:00:00.000Z', kind: 'triage', task: 'T1', path: 'large' }) + '\n');
    appendEvent(wt, { ts: '2026-10-16T10:00:00.000Z', kind: 'phase', task: 'T1', phase: 'implement' });
    expect(readFileSync(path.join(main, '.forge', 'ledger.jsonl'), 'utf8')).toContain('"phase":"implement"');
    expect(readFileSync(path.join(wt, '.forge', 'ledger.jsonl'), 'utf8')).not.toContain('"phase":"implement"');
    expect(readStatus(wt)).toMatchObject({ task: 'T1', phase: 'implement' });
    expect(readStatus(main)).toBeNull();
    expect(readEvents(wt).map(e => e.kind)).toEqual(['triage', 'phase']);
    expect(readEvents(main).map(e => e.kind)).toEqual(['phase']);
    // A folder that only looks like a task worktree keeps its own ledger.
    const fake = path.join(main, 'task-T9');
    mkdirSync(fake);
    expect(ledgerRoot(fake)).toBe(fake);
  });

  // A main checkout with a forge task worktree at <main>/.claude/worktrees/task-T1.
  const memberWorktree = () => {
    const main = mkdtempSync(path.join(tmpdir(), 'forge-ledger-two-'));
    const g = (...a: string[]) => execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', ...a], { cwd: main, encoding: 'utf8' });
    g('init', '-q', '-b', 'main'); writeFileSync(path.join(main, '.gitignore'), '.forge/\n.claude/\n'); g('add', '.'); g('commit', '-qm', 'init');
    const wt = path.join(main, '.claude', 'worktrees', 'task-T1');
    g('worktree', 'add', '-q', '-b', 'task/T1', wt);
    return { main, wt };
  };

  it('an event both ledgers hold counts once, and work the worktree logged before is not logged again', () => {
    const { main, wt } = memberWorktree();
    const old = [
      { ts: '2026-10-16T09:00:00.000Z', kind: 'triage', task: 'T1', path: 'large', project: 'shop' },
      { ts: '2026-10-16T09:01:00.000Z', kind: 'phase', task: 'T1', phase: 'implement', brief: 1 },
    ].map(e => JSON.stringify(e) + '\n').join('');
    appendFileSync(path.join(forgeDir(wt), 'ledger.jsonl'), old);
    // The same lines in the main ledger too (copied there by hand, or by a later version), the first with CRLF.
    appendFileSync(path.join(forgeDir(main), 'ledger.jsonl'), old.replace('\n', '\r\n'));
    expect(readEvents(wt).map(e => `${e.kind}:${e.ts}`)).toEqual(['triage:2026-10-16T09:00:00.000Z', 'phase:2026-10-16T09:01:00.000Z']);
    expect(readEvents(main)).toHaveLength(2);
    // The same phase of the same brief again, now from the worktree: already logged, so neither ledger gains it.
    const before = readFileSync(path.join(main, '.forge', 'ledger.jsonl'), 'utf8');
    expect(appendPhase(wt, { ts: '2026-10-16T10:00:00.000Z', kind: 'phase', task: 'T1', phase: 'implement', brief: 1 })).toBe(false);
    expect(readFileSync(path.join(main, '.forge', 'ledger.jsonl'), 'utf8')).toBe(before);
    expect(appendPhase(wt, { ts: '2026-10-16T10:05:00.000Z', kind: 'phase', task: 'T1', phase: 'review', brief: 1 })).toBe(true);
    expect(readEvents(wt).filter(e => e.kind === 'phase').map(e => e.phase)).toEqual(['implement', 'review']);
    // A line the main ledger holds twice is two events; one of them is the worktree's.
    appendFileSync(path.join(main, '.forge', 'ledger.jsonl'), old.split('\n')[0] + '\n');
    expect(readEvents(wt).filter(e => e.kind === 'triage')).toHaveLength(2);
    expect(readFileSync(path.join(wt, '.forge', 'ledger.jsonl'), 'utf8')).toBe(old);
  });

  it('a member and the coordinator appending at the same time leave whole lines, each event once', async () => {
    const { main, wt } = memberWorktree();
    // appendEvent run by separate node processes, as a member and the coordinator run it: ledger.ts bundled for node.
    const bundle = path.join(mkdtempSync(path.join(tmpdir(), 'forge-ledger-bundle-')), 'ledger.cjs');
    buildSync({ entryPoints: [fileURLToPath(new URL('../src/forge/ledger.ts', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'silent' });
    const N = 150;
    const code = `const { appendEvent } = require(${JSON.stringify(bundle)});
const pad = 'x'.repeat(3000);
for (let i = 0; i < ${N}; i++) appendEvent(process.env.FORGE_ROOT, { ts: new Date().toISOString(), kind: 'agent', task: 'T1', agent: process.env.FORGE_WHO, i, pad });`;
    const writers: [string, string][] = [['member-1', wt], ['member-2', wt], ['coordinator-1', main], ['coordinator-2', main]];
    await Promise.all(writers.map(([who, root]) =>
      promisify(execFile)(process.execPath, ['-e', code], { env: { ...process.env, FORGE_ROOT: root, FORGE_WHO: who } })));
    const lines = readFileSync(path.join(main, '.forge', 'ledger.jsonl'), 'utf8').split('\n').filter(l => l.trim());
    expect(lines).toHaveLength(writers.length * N);
    const events = lines.map(l => JSON.parse(l) as { agent: string; i: number; pad: string });
    expect(events.every(e => e.pad.length === 3000)).toBe(true);
    for (const [who] of writers) expect(events.filter(e => e.agent === who).map(e => e.i)).toEqual([...Array(N).keys()]);
    expect(readEvents(wt)).toHaveLength(writers.length * N);
    expect(readEvents(main)).toHaveLength(writers.length * N);
  }, 60_000);
});
