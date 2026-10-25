// A6: a subagent's transcript that is there but cannot be read. node:fs is mocked in this file only, so opening that one
// file can be refused the way a file another process holds, or one without read access, refuses it.
import { describe, it, expect, vi } from 'vitest';
import { statSync } from 'node:fs';
import { run } from '../src/forge/cli/run.js';
import { DIAG_NOW, writeDiagnoseFixture } from './fixtures/diagnose.js';
import { useTempDirs } from './helpers/tmp.js';

const refuse = vi.hoisted(() => ({ suffix: null as string | null }));
vi.mock('node:fs', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs')>();
  const openSync = ((file: import('node:fs').PathLike, flags?: import('node:fs').OpenMode, mode?: import('node:fs').Mode) => {
    if (refuse.suffix !== null && String(file).endsWith(refuse.suffix)) {
      throw Object.assign(new Error(`EACCES: permission denied, open '${String(file)}'`), { code: 'EACCES', syscall: 'open' });
    }
    return fs.openSync(file, flags ?? 'r', mode);
  }) as typeof fs.openSync;
  return { ...fs, openSync, default: { ...fs, openSync } };
});

const tmp = useTempDirs();

describe('forge diagnose with a subagent transcript it cannot read (A6)', () => {
  it('its sources row says unreadable with the measured size, and coverage says which agent was not read and cites its Agent call', () => {
    const root = tmp('diag-unread-');
    const cfg = tmp('diag-unread-cfg-');
    const { transcript: t, subagent: sub } = writeDiagnoseFixture(root, cfg);
    refuse.suffix = 'agent-a1.jsonl';
    try {
      const r = run(['diagnose', '--task', 'fix-login'], { cwd: root, now: () => new Date(DIAG_NOW), env: { CLAUDE_CONFIG_DIR: cfg } });
      expect(r.code).toBe(0);
      const out = JSON.parse(r.stdout);
      expect(out.sources.find((s: { file: string }) => s.file === sub)).toEqual({ file: sub, kind: 'subagent', bytes: statSync(sub).size, error: 'unreadable' });
      expect(out.coverage).toContain(`could not read transcript of agent a1 (${t}:10)`);
      expect(out.coverage.filter((c: string) => /\ba1\b/.test(c))).toHaveLength(1);
      expect(out.usage.transcripts.map((u: { agentId: string | null }) => u.agentId)).toEqual([null]);
    } finally {
      refuse.suffix = null;
    }
  });
});
