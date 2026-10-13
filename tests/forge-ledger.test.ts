import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { appendEvent, readEvents, readStatus, forgeDir } from '../src/forge/ledger.js';
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
      evidence: 'upload', validatorTimeoutSec: 600, swarm: { parallel: 3, launcher: 'bg' }, tdd: 'off',
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
    expect(agentFor('impl-heavy', 'economy')).toBe('forge-impl');
    expect(agentFor('impl', 'economy')).toBe('forge-impl-light');
    expect(agentFor('impl', 'quality')).toBe('forge-impl-heavy');
    expect(agentFor('impl-light', 'quality')).toBe('forge-impl');
    expect(agentFor('mech', 'quality')).toBe('forge-impl-light');
    expect(agentFor('review-security', 'economy')).toBe('forge-review-security');
  });
});

describe('parseConfig swarm', () => {
  it('defaults parallel to 3', () => {
    expect(parseConfig('profile: economy\n').swarm).toEqual({ parallel: 3, launcher: 'bg' });
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
