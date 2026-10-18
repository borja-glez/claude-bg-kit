import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { run } from '../src/cli/run.js';
import { run as forge } from '../src/forge/cli/run.js';
import { useTempDirs } from './helpers/tmp.js';
const tmp = useTempDirs();

const SOURCES = ['startup', 'resume', 'clear', 'compact', 'fork'] as const;
const REASONS = ['clear', 'resume', 'logout', 'prompt_input_exit', 'other'] as const;
const NOW = new Date('2026-10-15T12:00:00.000Z');
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/hooks/${name}.json`, import.meta.url), 'utf8')) as Record<string, unknown>;
let dir: string;
const wp = (...p: string[]) => path.join(dir, '.waypoint', 'demo-shop', ...p);
const io = (stdin: Record<string, unknown>) => ({ cwd: dir, now: () => NOW, assetsDir: dir, env: {}, stdin: JSON.stringify({ ...stdin, cwd: dir }) });
const bindA = (over: Record<string, unknown> = {}) => {
  mkdirSync(wp(), { recursive: true });
  writeFileSync(wp('bound.json'), JSON.stringify({ sid: 'main', claude: 'A', pid: null, via: 'work', since: '2026-10-15T11:00:00.000Z', seenAt: '2026-10-15T11:59:00.000Z', endedAt: null, endReason: null, ...over }));
};
const context = (r: { stdout: string }) => JSON.parse(r.stdout).hookSpecificOutput.additionalContext as string;

beforeEach(() => {
  dir = tmp('wp-contract-');
  mkdirSync(path.join(dir, 'docs', 'waypoint', 'demo-shop'), { recursive: true });
  copyFileSync(new URL('./fixtures/plan.yaml', import.meta.url), path.join(dir, 'docs', 'waypoint', 'demo-shop', 'plan.yaml'));
});

describe("the engine's hook inputs reach the hooks (K5-11)", () => {
  it('the fixtures carry the five sources and the five reasons the engine declares', () => {
    for (const s of SOURCES) expect(fixture(`session-start-${s}`)).toMatchObject({ hook_event_name: 'SessionStart', source: s });
    for (const r of REASONS) expect(fixture(`session-end-${r}`)).toMatchObject({ hook_event_name: 'SessionEnd', reason: r });
  });
  it('session-end of each reason closes the binding of its session with that reason', () => {
    for (const r of REASONS) {
      bindA();
      expect(run(['hook', 'session-end'], io({ ...fixture(`session-end-${r}`), session_id: 'A' }))).toEqual({ code: 0, stdout: '', stderr: '' });
      expect(JSON.parse(readFileSync(wp('bound.json'), 'utf8'))).toMatchObject({ endedAt: NOW.toISOString(), endReason: r });
    }
  });
  it('session-start of each source tells another session who is bound, without the task to continue; a fork says so', () => {
    for (const s of SOURCES) {
      bindA();
      const ctx = context(run(['hook', 'session-start'], io({ ...fixture(`session-start-${s}`), session_id: 'B' })));
      expect(ctx, s).toContain('Another session (seat main, seen 1 min ago)');
      expect(ctx, s).not.toContain('continue');
      expect(ctx.includes('fork'), s).toBe(s === 'fork');
    }
  });
  it('session-start of resume and compact reopens the owner binding; resume says how long it was away', () => {
    for (const s of ['resume', 'compact'] as const) {
      bindA({ endedAt: '2026-10-15T10:00:00.000Z', endReason: 'resume' });
      const ctx = context(run(['hook', 'session-start'], io({ ...fixture(`session-start-${s}`), session_id: 'A' })));
      expect(JSON.parse(readFileSync(wp('bound.json'), 'utf8'))).toMatchObject({ endedAt: null, endReason: null, seenAt: NOW.toISOString() });
      expect(ctx.startsWith('Resumed after 1 h. '), s).toBe(s === 'resume');
    }
  });
  it("forge's live and route-session hooks take every source without failing", () => {
    for (const s of SOURCES) {
      for (const which of ['live', 'route-session']) {
        const r = forge(['hook', which], { cwd: dir, now: () => NOW, env: {}, stdin: JSON.stringify({ ...fixture(`session-start-${s}`), cwd: dir }) });
        expect(r.code, `${which} ${s}`).toBe(0);
        if (r.stdout.trim()) expect(JSON.parse(r.stdout).hookSpecificOutput.hookEventName, `${which} ${s}`).toBe('SessionStart');
      }
    }
  });
});
