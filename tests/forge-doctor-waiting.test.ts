import { describe, it, expect, vi } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DoctorCtx } from '../src/forge/doctor.js';
import { useTempDirs } from './helpers/tmp.js';

// openSync can be made to fail on demand, to cover a transcript that exists but cannot be opened.
const hooks = vi.hoisted(() => ({ failOpen: false }));
vi.mock('node:fs', async importActual => {
  const actual = await importActual<typeof import('node:fs')>();
  return { ...actual, openSync: ((...a: Parameters<typeof actual.openSync>) => {
    if (hooks.failOpen) throw new Error('EACCES: cannot open');
    return actual.openSync(...a);
  }) as typeof actual.openSync };
});

const { WAITING_CHECK, agentTranscript, transcriptCall } = await import('../src/forge/waiting-calls.js');
const tmp = useTempDirs();

describe('forge doctor · waiting calls read a transcript through transcript-file.ts (A6, single reader)', () => {
  const NOW = Date.parse('2026-10-24T10:00:00.000Z');
  const call = JSON.stringify({ type: 'assistant', timestamp: '2026-10-24T09:45:00.000Z', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } }] } });
  it('a path that is not a regular .jsonl file, or that cannot be opened, is unreadable', () => {
    const dir = tmp('doctor-tail-');
    const asDir = path.join(dir, 'agent-a1.jsonl');
    mkdirSync(asDir);
    const notJsonl = path.join(dir, 'agent-a1.txt');
    writeFileSync(notJsonl, call + '\n');
    for (const f of [asDir, path.join(dir, 'missing.jsonl'), notJsonl]) expect(transcriptCall(f, NOW), f).toBe('unreadable');
    const ok = path.join(dir, 'agent-a2.jsonl');
    writeFileSync(ok, call + '\n');
    expect(transcriptCall(ok, NOW)).toEqual({ tool: 'Bash', waitedSec: 900, head: 'npm test' });
    hooks.failOpen = true;
    try { expect(transcriptCall(ok, NOW)).toBe('unreadable'); } finally { hooks.failOpen = false; }
    writeFileSync(ok, '');
    expect(transcriptCall(ok, NOW)).toBeNull();
  });
  it('agentTranscript gives an absolute path from a relative config dir (CLAUDE_CONFIG_DIR as typed), so the reader takes it', () => {
    const cfg = tmp('doctor-rel-cfg-');
    const f = path.join(cfg, 'projects', 'p', 's1', 'subagents', 'agent-a1.jsonl');
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, call + '\n');
    // From the config dir's parent, so that the relative path is one on every drive layout.
    const was = process.cwd();
    process.chdir(path.dirname(cfg));
    try {
      const got = agentTranscript(path.basename(cfg), 's1', 'a1');
      expect(got).toBe(f);
      expect(transcriptCall(got!, NOW)).toEqual({ tool: 'Bash', waitedSec: 900, head: 'npm test' });
    } finally { process.chdir(was); }
  });
  it('waiting-calls.ts opens no file itself: transcript-file.ts is the one transcript reader', () => {
    const src = readFileSync(new URL('../src/forge/waiting-calls.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/\b(?:openSync|readSync|fstatSync|closeSync)\b/);
    expect(src).toMatch(/import \{[^}]*\bmeasureJsonl\b[^}]*\breadTail\b[^}]*\} from '\.\/transcript-file\.js'/);
  });
});

describe('forge doctor · waiting calls, paths around the happy one', () => {
  const NOW = new Date('2026-10-24T10:00:00.000Z');
  const use = (id: string, timestamp: string) => JSON.stringify({ type: 'assistant', timestamp, message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command: 'npm test' } }] } });
  const setup = (live: Record<string, unknown>, liveBytesPad = 0, callAt = '2026-10-24T09:45:00.000Z') => {
    const root = tmp('doctor-wait2-');
    const cfg = path.join(root, 'cfg');
    mkdirSync(path.join(root, '.forge', 'live'), { recursive: true });
    const doc = { sessionId: 's1', role: 'coordinator', runId: null, task: null, event: 'SubagentStart', ts: '2026-10-24T09:40:00.000Z',
      agents: [{ id: 'a1', type: 'forge:forge-impl', since: '2026-10-24T09:40:00.000Z' }], ended: false, ...live };
    writeFileSync(path.join(root, '.forge', 'live', 's1.json'), JSON.stringify(doc) + ' '.repeat(liveBytesPad));
    const f = path.join(cfg, 'projects', 'p', 's1', 'subagents', 'agent-a1.jsonl');
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, use('t1', callAt) + '\n');
    const ctx: DoctorCtx = { main: root, cwd: root, configDir: cfg, scriptPath: path.join(root, 'forge.cjs'), now: NOW, locale: 'en', env: {} };
    return () => WAITING_CHECK.run(ctx) as { status: string; data?: { waiting: unknown[] } };
  };

  it('reports the call when everything is in order (control)', () => {
    expect(setup({})().data?.waiting).toHaveLength(1);
  });
  it('a transcript that exists but cannot be opened makes the check unverified', () => {
    const check = setup({});
    hooks.failOpen = true;
    try { expect(check().status).toBe('unverified'); } finally { hooks.failOpen = false; }
  });
  it('a live file that is ended, too old, over size or not normalizable is skipped', () => {
    expect(setup({ ended: true })().data?.waiting).toEqual([]);
    expect(setup({ ts: '2026-10-23T09:00:00.000Z' })().data?.waiting).toEqual([]);
    expect(setup({}, 9 * 1024)().data?.waiting).toEqual([]);
    expect(setup({ role: 'nobody' })().data?.waiting).toEqual([]);
  });
  it('an agent whose since is old but whose call has waited under 10 minutes is not reported', () => {
    expect(setup({}, 0, '2026-10-24T09:55:00.000Z')().data?.waiting).toEqual([]);
  });
});
