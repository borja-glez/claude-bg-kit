import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { liveFile, liveLock, LIVE_LOCK_STALE_MS, LIVE_LOCK_WAIT_MS } from '../src/forge/live.js';
import { seedExecution } from './helpers/execution.js';
import { useTempDirs } from './helpers/tmp.js';

const tmp = useTempDirs();

// FC2: `forge hook live` reads the session's signal, adds or removes an agent and writes it back. Claude Code starts the
// hooks of several SubagentStart at once, one process each: the real CLI, bundled from the sources (there is no
// TypeScript runner here), as plugins/forge/dist/forge.cjs is built.
let forge: string;
beforeAll(async () => {
  forge = path.join(tmp('forge-live-cli-'), 'forge.cjs');
  await build({
    entryPoints: [fileURLToPath(new URL('../src/forge/cli/main.ts', import.meta.url))],
    define: { __WAYPOINT_VERSION__: JSON.stringify('0.0.0-test') },
    bundle: true, platform: 'node', format: 'cjs', target: 'node20', outfile: forge, logLevel: 'silent',
  });
}, 60_000);

const T = new Date().toISOString();
let root: string;
beforeEach(() => {
  root = tmp('forge-live-race-');
  const git = (...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8' });
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 'a@b.c'); git('config', 'user.name', 't');
  writeFileSync(path.join(root, 'x.txt'), 'x'); git('add', '.'); git('commit', '-qm', 'init');
  seedExecution(root, {
    runId: 'r1', kind: 'plan', mode: 'subagents', parallel: 3, project: 'shop', base: 'main', branch: 'forge/run-shop', mergeOnFinish: false,
    coordinator: 'main', hookSession: 's1', active: true, stopReason: null, stallReason: null, startedAt: T, lastStepAt: null, lastBlockStep: null,
    sleepUntil: null, tasks: {},
  } as Parameters<typeof seedExecution>[1]);
});

const hook = (input: object) => new Promise<{ code: number | null; stderr: string; ms: number }>(resolve => {
  const t0 = Date.now();
  const p = spawn(process.execPath, [forge, 'hook', 'live'], { cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root }, stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
  let stderr = '';
  p.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
  p.on('close', code => resolve({ code, stderr, ms: Date.now() - t0 }));
  p.stdin.end(JSON.stringify({ session_id: 's1', cwd: root, ...input }));
});
const agents = (): string[] => (JSON.parse(readFileSync(liveFile(root, 's1'), 'utf8')) as { agents: { id: string }[] }).agents.map(a => a.id).sort();
const liveDir = () => path.join(root, '.forge', 'live');
// A pid that existed and is gone: its process already exited.
const deadPid = () => spawnSync(process.execPath, ['-e', '']).pid!;

describe('FC2: the live signal with real processes at once', () => {
  it('8 SubagentStart hooks at once keep all 8 agents, three times over, and leave no lock behind', async () => {
    for (let trial = 0; trial < 3; trial++) {
      rmSync(liveFile(root, 's1'), { force: true });
      const ids = Array.from({ length: 8 }, (_, i) => `a${trial}-${i}`);
      const r = await Promise.all(ids.map(id => hook({ hook_event_name: 'SubagentStart', agent_id: id, agent_type: 'forge:forge-impl' })));
      expect(r.map(x => [x.code, x.stderr])).toEqual(ids.map(() => [0, '']));
      expect(agents()).toEqual([...ids].sort());
      expect(readdirSync(liveDir())).toEqual(['s1.json']);
    }
  }, 120_000);
  it('8 SubagentStop hooks at once leave no agent', async () => {
    const ids = Array.from({ length: 8 }, (_, i) => `b${i}`);
    for (const id of ids) await hook({ hook_event_name: 'SubagentStart', agent_id: id, agent_type: 'forge:forge-review-correctness' });
    expect(agents()).toEqual(ids);
    await Promise.all(ids.map(id => hook({ hook_event_name: 'SubagentStop', agent_id: id })));
    expect(agents()).toEqual([]);
    expect(readdirSync(liveDir())).toEqual(['s1.json']);
  }, 120_000);
  it('a lock left by a dead process is taken over at once, and removed', async () => {
    mkdirSync(liveDir(), { recursive: true });
    writeFileSync(liveLock(liveFile(root, 's1')), JSON.stringify({ pid: deadPid(), at: new Date().toISOString() }));
    const r = await hook({ hook_event_name: 'SubagentStart', agent_id: 'd1', agent_type: 'x' });
    expect(r.code).toBe(0);
    expect(r.ms).toBeLessThan(LIVE_LOCK_WAIT_MS);
    expect(agents()).toEqual(['d1']);
    expect(existsSync(liveLock(liveFile(root, 's1')))).toBe(false);
  }, 60_000);
  it('a lock a live process has held past LIVE_LOCK_STALE_MS is taken over at once, and removed', async () => {
    mkdirSync(liveDir(), { recursive: true });
    writeFileSync(liveLock(liveFile(root, 's1')), JSON.stringify({ pid: process.pid, at: new Date(Date.now() - LIVE_LOCK_STALE_MS - 1000).toISOString() }));
    const r = await hook({ hook_event_name: 'SubagentStart', agent_id: 'o1', agent_type: 'x' });
    expect(r.code).toBe(0);
    expect(r.ms).toBeLessThan(LIVE_LOCK_WAIT_MS);
    expect(agents()).toEqual(['o1']);
    expect(readdirSync(liveDir())).toEqual(['s1.json']);
  }, 60_000);
  it('a lock a live process holds never holds the hook past its wait: it writes without the lock (fail-open)', async () => {
    mkdirSync(liveDir(), { recursive: true });
    const held = JSON.stringify({ pid: process.pid, at: new Date().toISOString() });
    writeFileSync(liveLock(liveFile(root, 's1')), held);
    const r = await hook({ hook_event_name: 'SubagentStart', agent_id: 'h1', agent_type: 'x' });
    expect(r.code).toBe(0);
    expect(r.ms).toBeGreaterThanOrEqual(LIVE_LOCK_WAIT_MS - 100);
    expect(r.ms).toBeLessThan(LIVE_LOCK_WAIT_MS + 5000);
    expect(agents()).toEqual(['h1']);
    // Not its lock: it stays for its holder.
    expect(readFileSync(liveLock(liveFile(root, 's1')), 'utf8')).toBe(held);
  }, 60_000);
});
