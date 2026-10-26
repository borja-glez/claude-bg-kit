import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { appendEvent, readEvents } from '../src/forge/ledger.js';
import { seedExecution } from './helpers/execution.js';
import { useTempDirs } from './helpers/tmp.js';

const tmp = useTempDirs();

// FX1 m1: Claude Code starts the hooks of several SubagentStart at once, one process each. The deviation check reads the
// ledger, picks the task a deviation goes to and appends it: under a file lock, so each one goes to a task of its own. The
// real CLI, bundled from the sources as plugins/forge/dist/forge.cjs is built.
let forge: string;
beforeAll(async () => {
  forge = path.join(tmp('forge-deviation-cli-'), 'forge.cjs');
  await build({
    entryPoints: [fileURLToPath(new URL('../src/forge/cli/main.ts', import.meta.url))],
    define: { __WAYPOINT_VERSION__: JSON.stringify('0.0.0-test') },
    bundle: true, platform: 'node', format: 'cjs', target: 'node20', outfile: forge, logLevel: 'silent',
  });
}, 60_000);

const T = new Date(Date.now() - 60_000).toISOString();
const TASKS = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8'];

function seed(): string {
  const root = tmp('forge-deviation-race-');
  const git = (...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8' });
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 'a@b.c'); git('config', 'user.name', 't');
  writeFileSync(path.join(root, 'x.txt'), 'x'); git('add', '.'); git('commit', '-qm', 'init');
  const task = { status: 'running', stage: 'implement', round: 0, worktree: '/w', branch: 'task/T', executor: 'subagents', attempts: 0, agent: 'forge-impl-light', startedAt: T, stageSince: T, updatedAt: T, detail: null };
  seedExecution(root, {
    runId: 'r1', kind: 'plan', mode: 'subagents', parallel: 8, project: 'shop', base: 'main', branch: 'forge/run-shop', mergeOnFinish: false,
    coordinator: 'main', hookSession: 's1', active: true, stopReason: null, stallReason: null, startedAt: T, lastStepAt: null, lastBlockStep: null,
    sleepUntil: null, tasks: Object.fromEntries(TASKS.map(t => [t, task])),
  } as Parameters<typeof seedExecution>[1]);
  for (const t of TASKS) {
    appendEvent(root, { ts: T, kind: 'phase', task: t, phase: 'implement', brief: 1, base: 'b', project: 'shop' });
    appendEvent(root, { ts: T, kind: 'agent', task: `${t}-1`, agent: 'forge-impl-light', role: 'impl-light', by: 'step', project: 'shop' });
  }
  return root;
}

const hook = (root: string, agentId: string) => new Promise<{ code: number | null; stdout: string; stderr: string }>(resolve => {
  const p = spawn(process.execPath, [forge, 'hook', 'live'], { cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let stdout = '', stderr = '';
  p.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
  p.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
  p.on('close', code => resolve({ code, stdout, stderr }));
  p.stdin.end(JSON.stringify({ session_id: 's1', cwd: root, hook_event_name: 'SubagentStart', agent_id: agentId, agent_type: 'forge:forge-impl' }));
});

describe('FX1 m1: the deviation check with real processes at once', () => {
  it('eight forge-impl started at once where the step named forge-impl-light: eight deviations, one per task, five times over', async () => {
    for (let trial = 0; trial < 5; trial++) {
      const root = seed();
      const ids = TASKS.map((_, i) => `a${trial}-${i}`);
      const r = await Promise.all(ids.map(id => hook(root, id)));
      expect(r.map(x => [x.code, x.stdout, x.stderr])).toEqual(ids.map(() => [0, '', '']));
      const d = readEvents(root).filter(e => e.kind === 'deviation');
      expect(d.map(e => e.task).sort(), `trial ${trial}`).toEqual(TASKS.map(t => `${t}-1`));
      expect(d.map(e => e.agentId).sort()).toEqual([...ids].sort());
      expect(existsSync(path.join(root, '.forge', 'deviation.lock'))).toBe(false);
    }
  }, 120_000);
});
