import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { run, type Io } from '../src/cli/run.js';

describe('two conversations on one checkout (spec §1, criteria 1 to 3)', () => {
  it('B inherits nothing of A; after /clear, C is offered the task and takes it only when it asks', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'wp-scenario-'));
    const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd: dir, encoding: 'utf8' }).trim();
    const PLAN = 'docs/waypoint/demo-shop/plan.yaml';
    mkdirSync(path.join(dir, 'docs', 'waypoint', 'demo-shop'), { recursive: true });
    copyFileSync(new URL('./fixtures/plan.yaml', import.meta.url), path.join(dir, PLAN));
    git('init', '-q'); git('add', '.'); git('commit', '-q', '-m', 'init');
    let now = Date.parse('2026-10-15T12:00:00.000Z');
    const io = (stdin?: unknown): Io => ({ cwd: dir, now: () => new Date(now), rand: () => 0, assetsDir: dir, env: {}, ...(stdin === undefined ? {} : { stdin: JSON.stringify(stdin) }) });
    const hook = (sub: string, stdin: Record<string, unknown>) => run(['hook', sub], io({ cwd: dir, ...stdin }));
    const context = (r: { stdout: string }) => (r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext as string : '');
    const wp = (...p: string[]) => path.join(dir, '.waypoint', 'demo-shop', ...p);
    const bind = (claude: string, ...flags: string[]) => run(['bind', PLAN, '--via', 'work', '--claude', claude, ...flags], io());

    // A joins: bound to the checkout's seat, with T002 in progress.
    expect(JSON.parse(bind('A').stdout)).toMatchObject({ took: 'new', sid: 'main' });
    mkdirSync(wp('dbcache', 'state'), { recursive: true });
    writeFileSync(wp('dbcache', 'state', 'T002.json'), JSON.stringify({ status: 'in_progress', owner: 'main' }));
    expect(context(hook('session-start', { session_id: 'A', source: 'startup' }))).toContain('Current task: T002 API de pedidos');

    // B opens next to it: one fact at start, its commit is not A's, its Stop never blocks, and it cannot take the seat.
    now += 60_000;
    const b = context(hook('session-start', { session_id: 'B', source: 'startup' }));
    expect(b).toContain('Another session (seat main');
    for (const w of ['Current task', 'continue', 'Use /waypoint:work']) expect(b).not.toContain(w);
    writeFileSync(path.join(dir, 'b.txt'), 'b'); git('add', 'b.txt'); git('commit', '-q', '-m', 'B');
    hook('post-commit', { session_id: 'B', tool_input: { command: 'git commit -m B' } });
    expect(existsSync(wp('pending-commits.jsonl'))).toBe(false);
    writeFileSync(wp('queue.jsonl'), '{"op":"set"}\n');
    expect(hook('stop', { session_id: 'B' }).stdout).toBe('');
    expect(JSON.parse(hook('stop', { session_id: 'A' }).stdout).decision).toBe('block');
    expect(bind('B').code).toBe(3);

    // A runs /clear: its binding ends; the new conversation C is offered T002 and takes nothing by itself.
    hook('session-end', { session_id: 'A', reason: 'clear' });
    const c = context(hook('session-start', { session_id: 'C', source: 'clear' }));
    expect(c).toContain('T002 "API de pedidos" of project demo-shop was left in progress by an earlier conversation (seat main, ended by /clear just now)');
    expect(c).not.toContain('Current task');
    expect(JSON.parse(readFileSync(wp('bound.json'), 'utf8')).claude).toBe('A');
    expect(bind('C').code).toBe(4);
    expect(JSON.parse(bind('C', '--resume').stdout)).toMatchObject({ took: 'previous', sid: 'main' });
    expect(context(hook('session-start', { session_id: 'C', source: 'startup' }))).toContain('Current task: T002 API de pedidos');
    expect(context(hook('session-start', { session_id: 'A', source: 'resume' }))).toContain('Another session (seat main');
  });
});
