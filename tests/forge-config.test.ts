import { describe, it, expect } from 'vitest';
import { parseConfig, agentFor, ROLES, ConfigError, NAME } from '../src/forge/config.js';

describe('forge config', () => {
  it('defaults: detect on, nothing excluded, verify limits, evidence upload', () => {
    expect(parseConfig(null)).toEqual({
      profile: 'balanced', detect: true, exclude: [], verify: { limits: { checks: 8, shots: 10, minutes: 10 } },
      evidence: 'upload', validatorTimeoutSec: 600, swarm: { parallel: 3, launcher: 'bg' },
    });
  });
  it('swarm: parallel 3 by default, an optional mode and the launcher', () => {
    expect(parseConfig(null).swarm).toEqual({ parallel: 3, launcher: 'bg' });
    expect(parseConfig('swarm:\n  mode: sessions\n  parallel: 2\n').swarm).toEqual({ parallel: 2, mode: 'sessions', launcher: 'bg' });
    expect(() => parseConfig('swarm:\n  mode: threads\n')).toThrow(ConfigError);
    expect(() => parseConfig('swarm:\n  launcher: tmux\n')).toThrow(ConfigError);
  });
  it('swarm.setup: an optional command of at most 500 characters', () => {
    expect(parseConfig('swarm:\n  setup: uv sync\n').swarm).toEqual({ parallel: 3, launcher: 'bg', setup: 'uv sync' });
    expect(() => parseConfig(`swarm:\n  setup: ${'x'.repeat(501)}\n`)).toThrow(ConfigError);
    expect(() => parseConfig('swarm:\n  setup: ""\n')).toThrow(ConfigError);
    expect(() => parseConfig('swarm:\n  setup: 3\n')).toThrow(ConfigError);
  });
  it('kind is free text with the name pattern, when is optional', () => {
    const c = parseConfig('validators:\n  - name: a11y\n    cmd: npm run a11y\n    kind: a11y\n    when: final\n');
    expect(c.validators).toEqual([{ name: 'a11y', cmd: 'npm run a11y', kind: 'a11y', when: 'final' }]);
    expect(() => parseConfig('validators:\n  - name: x\n    cmd: y\n    kind: "has space"\n')).toThrow(ConfigError);
    expect(() => parseConfig('validators:\n  - name: x\n    cmd: y\n    when: sometimes\n')).toThrow(/when/);
  });
  it('detect, exclude, evidence and verify.limits', () => {
    const c = parseConfig('detect: false\nexclude: [build]\nevidence: local\nverify:\n  limits: { checks: 3 }\n');
    expect(c).toMatchObject({ detect: false, exclude: ['build'], evidence: 'local', verify: { limits: { checks: 3, shots: 10, minutes: 10 } } });
    expect(() => parseConfig('verify:\n  limits: { checks: 21 }\n')).toThrow(/checks/);
    expect(() => parseConfig('verify:\n  limits: { shots: 31 }\n')).toThrow(/shots/);
    expect(() => parseConfig('verify:\n  limits: { minutes: 61 }\n')).toThrow(/minutes/);
    expect(() => parseConfig('evidence: cloud\n')).toThrow(/evidence/);
    expect(() => parseConfig('verify:\n  surfaces: []\n')).toThrow(ConfigError); // surfaces live in .forge/verify/, not here
  });
  it('the verify role follows the profile', () => {
    expect(ROLES).toContain('verify');
    expect(agentFor('verify', 'balanced')).toBe('forge-verify');
    expect(agentFor('verify', 'economy')).toBe('forge-verify');
    expect(agentFor('verify', 'quality')).toBe('forge-verify-heavy');
  });
  it('NAME is the shared name pattern', () => {
    expect(NAME.test('test:e2e')).toBe(true);
    expect(NAME.test('a b')).toBe(false);
  });
});
