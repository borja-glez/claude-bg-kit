import { describe, it, expect } from 'vitest';
import { claudeSessionId, noClaudeSession } from '../src/lib/claude-session.js';

describe('claudeSessionId (C1)', () => {
  const env = { CLAUDE_CODE_SESSION_ID: 'env-1' };
  it('takes a valid flag first', () => {
    expect(claudeSessionId('flag-1', env)).toBe('flag-1');
  });
  it('falls back to the environment for a missing or unusable flag', () => {
    for (const bad of [undefined, null, '', '${CLAUDE_SESSION_ID}', 'a:b', 'x'.repeat(121), '..']) expect(claudeSessionId(bad, env)).toBe('env-1');
  });
  it('is null when neither is usable', () => {
    expect(claudeSessionId(undefined, {})).toBeNull();
    expect(claudeSessionId('a:b', { CLAUDE_CODE_SESSION_ID: '' })).toBeNull();
    expect(claudeSessionId(null, { CLAUDE_CODE_SESSION_ID: 'a b' })).toBeNull();
  });
  it('never reads process.env when it is given an env', () => {
    const saved = process.env.CLAUDE_CODE_SESSION_ID;
    process.env.CLAUDE_CODE_SESSION_ID = 'from-process';
    try {
      expect(claudeSessionId(undefined, {})).toBeNull();
      expect(claudeSessionId(undefined)).toBe('from-process');
    } finally {
      if (saved === undefined) delete process.env.CLAUDE_CODE_SESSION_ID; else process.env.CLAUDE_CODE_SESSION_ID = saved;
    }
  });
  it('says how to give the id', () => {
    expect(noClaudeSession('swarm start', '--hook-session'))
      .toBe('swarm start: no Claude session id: pass --hook-session <id> or run it from Claude Code (CLAUDE_CODE_SESSION_ID)');
  });
});
