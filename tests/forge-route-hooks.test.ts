import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inForgeWorktree, looksLikeCoding, routeReminder, routingRule, ROUTE_HINT } from '../src/forge/route-hooks.js';
import { readRoute, writeRoute } from '../src/forge/route.js';
import { saveExecution } from '../src/forge/execution.js';
import { writeMember } from '../src/forge/members.js';
import { saveRun, startRun } from '../src/forge/run.js';
import { run, type Io } from '../src/forge/cli/run.js';

const NOW = new Date('2026-10-13T10:00:00.000Z');
const context = (r: { stdout: string }) => (r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : null);

describe('looksLikeCoding', () => {
  it('needs six words, a coding verb and no method named; never a slash command', () => {
    expect(looksLikeCoding('Añade un descuento por cupón al carrito de la tienda')).toBe(true);
    expect(looksLikeCoding('CREA una página de perfil para los usuarios registrados')).toBe(true);
    expect(looksLikeCoding('Add coupon support to the cart with validation')).toBe(true);
    expect(looksLikeCoding('fix the bug')).toBe(false);
    expect(looksLikeCoding('/forge:run Add coupon support to the cart please')).toBe(false);
    expect(looksLikeCoding('Add coupon support to the cart with forge please')).toBe(false);
    expect(looksLikeCoding('Añade cupones al carrito usando superpowers para el diseño')).toBe(false);
    expect(looksLikeCoding('What does the cart module do with the coupons today')).toBe(false);
  });
});

describe('routingRule and routeReminder', () => {
  it("names superpowers' process skills only when it is installed", () => {
    expect(routingRule(true)).toContain('superpowers:brainstorming');
    expect(routingRule(false)).not.toContain('superpowers:brainstorming');
    expect(routingRule(false)).toMatch(/^<FORGE-ROUTING>[\s\S]*invoke the forge:route skill[\s\S]*<\/FORGE-ROUTING>$/);
  });
  it('reminds a half-done route for 24 hours, by what the user chose', () => {
    const r = { task: 't1', chosen: 'superpowers-design' as const, by: 'user' as const, stage: 'designing' as const, ts: NOW.toISOString() };
    expect(routeReminder(r, NOW.getTime())).toContain('hand off with forge:run --from-spec');
    expect(routeReminder({ ...r, chosen: 'superpowers-plan', stage: 'planning', plan: 'docs/p.md' }, NOW.getTime())).toContain('forge:run --superpowers-plan docs/p.md');
    expect(routeReminder(r, NOW.getTime() + 25 * 3600_000)).toBeNull();
    expect(routeReminder({ ...r, stage: 'handed-off' }, NOW.getTime())).toBeNull();
    expect(routeReminder(null, NOW.getTime())).toBeNull();
  });
});

describe('forge hook route-session and route-prompt', () => {
  let root: string;
  let cfg: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'forge-route-hook-'));
    cfg = mkdtempSync(path.join(tmpdir(), 'forge-route-hook-cfg-'));
  });
  const io = (stdin: string): Io => ({ cwd: root, now: () => NOW, stdin, env: { CLAUDE_CONFIG_DIR: cfg } });
  const hook = (which: string, input: unknown) => run(['hook', which], io(typeof input === 'string' ? input : JSON.stringify(input)));
  const PROMPT = { session_id: 'S1', prompt: 'Add coupon support to the cart with validation' };

  it('route-session puts the routing rule in a new session', () => {
    const out = context(hook('route-session', { session_id: 'S1', hook_event_name: 'SessionStart', source: 'startup' }));
    expect(out).toMatchObject({ hookEventName: 'SessionStart' });
    expect(out.additionalContext).toContain('invoke the forge:route skill');
  });
  it('route-prompt hints at forge:route for coding work, and reminds a pending route first', () => {
    expect(context(hook('route-prompt', PROMPT))).toEqual({ hookEventName: 'UserPromptSubmit', additionalContext: ROUTE_HINT });
    expect(hook('route-prompt', { session_id: 'S1', prompt: 'hello there' }).stdout).toBe('');
    writeRoute(root, { task: 't1', chosen: 'superpowers-design', by: 'user', stage: 'designing', ts: NOW.toISOString(), session: 'S1' });
    expect(context(hook('route-prompt', { session_id: 'S1', prompt: 'hello there' })).additionalContext).toContain('--from-spec');
    writeFileSync(path.join(root, '.forge', 'route', 'S1.json'), '{"task":');
    expect(context(hook('route-prompt', PROMPT)).additionalContext).toBe(ROUTE_HINT);
  });
  it("a route belongs to the session that chose it: it reminds only that one, which gets no hint while the route is fresh", () => {
    writeRoute(root, { task: 't1', chosen: 'superpowers-design', by: 'user', stage: 'designing', ts: NOW.toISOString(), session: 'S1' });
    expect(context(hook('route-prompt', { session_id: 'S1', prompt: 'hello there' })).additionalContext).toContain('--from-spec');
    expect(hook('route-prompt', { session_id: 'S2', prompt: 'hello there' }).stdout).toBe('');
    expect(context(hook('route-prompt', { ...PROMPT, session_id: 'S2' })).additionalContext).toBe(ROUTE_HINT);
    writeRoute(root, { task: 't1', chosen: 'superpowers', by: 'user', stage: 'handed-off', ts: NOW.toISOString(), session: 'S1' });
    expect(hook('route-prompt', PROMPT).stdout).toBe('');
    writeRoute(root, { task: 't1', chosen: 'none', by: 'user', stage: 'handed-off', ts: new Date(NOW.getTime() - 25 * 3600_000).toISOString(), session: 'S1' });
    expect(context(hook('route-prompt', PROMPT)).additionalContext).toBe(ROUTE_HINT);
    writeRoute(root, { task: 't1', chosen: 'forge', by: 'user', stage: 'done', ts: NOW.toISOString(), session: 'S1' });
    expect(context(hook('route-prompt', PROMPT)).additionalContext).toBe(ROUTE_HINT);
  });
  // The person's .forge/local.yaml.
  const personal = (text: string) => {
    mkdirSync(path.join(root, '.forge'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'local.yaml'), text);
  };
  it('stays silent with workflow: off, which keeps forge out of the routing', () => {
    personal('workflow: off\n');
    expect(hook('route-prompt', PROMPT).stdout).toBe('');
    expect(hook('route-session', { session_id: 'S1' }).stdout).toBe('');
  });
  it('stays silent with workflow: superpowers, where forge already drives the session, and on bad input', () => {
    personal('workflow: superpowers\n');
    expect(hook('route-prompt', PROMPT).stdout).toBe('');
    expect(hook('route-session', { session_id: 'S1' }).stdout).toBe('');
    // An invalid local value is ignored, so forge routes again.
    personal('workflow: maybe\n');
    expect(hook('route-prompt', PROMPT).stdout).not.toBe('');
    saveExecution(root, {
      runId: 'r1', kind: 'plan', mode: 'subagents', parallel: 3, project: 'shop', base: 'main', branch: 'forge/run-shop', mergeOnFinish: false,
      coordinator: 'main', hookSession: 'S1', active: true, stopReason: null, stallReason: null, startedAt: NOW.toISOString(), lastStepAt: null,
      lastBlockStep: null, sleepUntil: null, tasks: {},
    });
    expect(hook('route-prompt', PROMPT).stdout).toBe('');
    writeMember(root, { sessionId: 'M1', role: 'executor', runId: 'r1', task: 'T1', name: null, since: NOW.toISOString(), hookSession: 'S2' });
    expect(hook('route-prompt', { ...PROMPT, session_id: 'S2' }).stdout).toBe('');
    expect(hook('route-prompt', { ...PROMPT, session_id: 'S3' }).stdout).not.toBe('');
    saveRun(root, { ...startRun(NOW, { cycles: 2 }), sessionId: 'S3' });
    expect(hook('route-prompt', { ...PROMPT, session_id: 'S3' }).stdout).toBe('');
    for (const bad of ['', 'garbage', '[1]', 'null']) expect(hook('route-prompt', bad)).toMatchObject({ code: 0, stdout: '' });
    // A broken config.yaml never breaks a session.
    writeFileSync(path.join(root, '.forge', 'config.yaml'), 'workflow: maybe\n');
    expect(hook('route-session', { session_id: 'S4' })).toMatchObject({ code: 0, stdout: '' });
  });
});

describe('route hooks by session (K1-09, K1-12, K1-13)', () => {
  let root: string;
  let cfg: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'forge-route-sess-hook-'));
    cfg = mkdtempSync(path.join(tmpdir(), 'forge-route-sess-cfg-'));
  });
  const io = (stdin: unknown, at = NOW): Io => ({ cwd: root, now: () => at, stdin: JSON.stringify(stdin), env: { CLAUDE_CONFIG_DIR: cfg } });
  const ctx = (r: { stdout: string }) => (r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext as string : '');
  const PROMPT = { session_id: 'S1', prompt: 'Add coupon support to the cart with validation' };
  it('route-session and route-prompt stay silent in a task or run worktree of forge (K1-09)', () => {
    for (const name of ['task-T001', 'run']) {
      const dir = path.join(root, '.claude', 'worktrees', name);
      mkdirSync(dir, { recursive: true });
      expect(run(['hook', 'route-session'], { ...io({ session_id: 'S1', source: 'startup' }), cwd: dir }).stdout).toBe('');
      expect(run(['hook', 'route-prompt'], { ...io(PROMPT), cwd: dir }).stdout).toBe('');
    }
    expect(ctx(run(['hook', 'route-session'], io({ session_id: 'S1', source: 'startup' })))).toContain('<FORGE-ROUTING>');
  });
  it('inForgeWorktree tells forge worktrees by whole path segments, with either separator (K1-09)', () => {
    for (const p of ['C:\\repo\\.claude\\worktrees\\task-T001', 'C:\\repo\\.claude\\worktrees\\task-T001\\src\\lib', 'C:\\repo\\.claude\\worktrees\\run',
      'C:\\repo\\.claude\\worktrees\\run\\src', 'C:/repo/.claude\\worktrees/task-notes-x', '/repo/.claude/worktrees/task-T001', '/repo/.claude/worktrees/run/']) {
      expect(inForgeWorktree(p), p).toBe(true);
    }
    for (const p of ['C:\\repo\\worktrees\\task-notes-x', '/repo/notes/task-notes-x', 'C:\\repo\\.claude\\worktrees\\audit', '/repo/.claude/worktrees/runner',
      '/repo/.claude/worktrees/my-task-T1', '/repo/.claude/worktrees/task-', '/repo/.claude/worktrees-old/task-T1', '/repo/x.claude/worktrees/task-T1',
      'C:\\repo\\.claude\\worktrees', '/repo/.claude/task-T1']) {
      expect(inForgeWorktree(p), p).toBe(false);
    }
  });
  it('route-prompt gives no hint while this session has a forge task open (K1-12)', () => {
    mkdirSync(path.join(root, '.forge'), { recursive: true });
    const status = (over: object = {}) => writeFileSync(path.join(root, '.forge', 'status.json'), JSON.stringify({
      ts: NOW.toISOString(), task: 'cart', path: 'medium', phase: 'implement', agent: null, validators: [], verdict: null, round: null, cap: null, brief: 1,
      accepted: [], verify: null, taskStartedAt: NOW.toISOString(), stageSince: NOW.toISOString(), stages: {}, doneAt: null, lastAt: NOW.toISOString(),
      session: 'S1', runId: null, project: null, ...over,
    }));
    status();
    expect(run(['hook', 'route-prompt'], io(PROMPT)).stdout).toBe('');
    expect(ctx(run(['hook', 'route-prompt'], io({ ...PROMPT, session_id: 'S2' })))).toBe(ROUTE_HINT);
    status({ doneAt: NOW.toISOString() });
    expect(ctx(run(['hook', 'route-prompt'], io(PROMPT)))).toBe(ROUTE_HINT);
    status({ lastAt: new Date(NOW.getTime() - 25 * 3600_000).toISOString() });
    expect(ctx(run(['hook', 'route-prompt'], io(PROMPT)))).toBe(ROUTE_HINT);
  });
  it('the open task is the one forge writes for this session in the main checkout: its triage silences the hint, its done ends that (K1-12)', () => {
    const s1 = { cwd: root, now: () => NOW, env: { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: 'S1' } };
    expect(run(['triage', '--task', 'cart', 'Add coupon support to the cart with validation'], s1).code).toBe(0);
    expect(run(['hook', 'route-prompt'], io(PROMPT)).stdout).toBe('');
    expect(ctx(run(['hook', 'route-prompt'], io({ ...PROMPT, session_id: 'S2' })))).toBe(ROUTE_HINT);
    expect(run(['log', '--kind', 'phase', '--task', 'cart', '--data', '{"phase":"done"}'], s1).code).toBe(0);
    expect(ctx(run(['hook', 'route-prompt'], io(PROMPT)))).toBe(ROUTE_HINT);
  });
  it('after /clear, and in a fork, route-session names the route the earlier conversation left half done (K1-13)', () => {
    writeRoute(root, { task: 't1', chosen: 'superpowers-design', by: 'user', stage: 'designing', ts: NOW.toISOString(), session: 'OLD' });
    // A fork while the original conversation is open.
    expect(ctx(run(['hook', 'route-session'], io({ session_id: 'FORK', source: 'fork' })))).toContain('the original conversation routed task t1 as "superpowers-design" and it is half done (designing)');
    // /clear ends the original conversation: forge's live hook records it in its route.
    run(['hook', 'live'], io({ session_id: 'OLD', hook_event_name: 'SessionEnd', reason: 'clear' }, new Date(NOW.getTime() - 2 * 60_000)));
    expect(readRoute(root, 'OLD')).toMatchObject({ endReason: 'clear', endedAt: new Date(NOW.getTime() - 2 * 60_000).toISOString() });
    const after = ctx(run(['hook', 'route-session'], io({ session_id: 'NEW', source: 'clear' })));
    expect(after).toContain('<FORGE-ROUTING>');
    expect(after).toContain('before /clear this conversation routed task t1 as "superpowers-design" and it is half done (designing)');
    expect(after).toContain('--from-spec');
    expect(after).not.toContain('continue');
    expect(ctx(run(['hook', 'route-session'], io({ session_id: 'NEW2', source: 'startup' })))).not.toContain('before /clear');
    expect(ctx(run(['hook', 'route-session'], io({ session_id: 'NEW3', source: 'clear' }, new Date(NOW.getTime() + 9 * 60_000))))).not.toContain('before /clear');
    // The route stays the earlier session's: a reminder, never a copy.
    expect(readRoute(root, 'NEW')).toBeNull();
  });
  it('a route ends once, by the reason SessionEnd gives; a fork with two open routes, or a /clear after a logout, names none (K1-13)', () => {
    const at = (min: number) => new Date(NOW.getTime() + min * 60_000);
    writeRoute(root, { task: 't1', chosen: 'superpowers-plan', by: 'user', stage: 'planning', ts: NOW.toISOString(), session: 'A' });
    writeRoute(root, { task: 't2', chosen: 'superpowers-design', by: 'user', stage: 'designing', ts: NOW.toISOString(), session: 'B' });
    expect(ctx(run(['hook', 'route-session'], io({ session_id: 'FORK', source: 'fork' })))).not.toContain('original conversation');
    run(['hook', 'live'], io({ session_id: 'A', hook_event_name: 'SessionEnd', reason: 'logout' }, at(-1)));
    run(['hook', 'live'], io({ session_id: 'A', hook_event_name: 'SessionEnd', reason: 'clear' }, at(0)));
    expect(readRoute(root, 'A')).toMatchObject({ endReason: 'logout', endedAt: at(-1).toISOString() });
    run(['hook', 'live'], io({ session_id: 'B', hook_event_name: 'SessionEnd', reason: 'something-new' }, at(0)));
    expect(readRoute(root, 'B')).toMatchObject({ endReason: 'other' });
    expect(ctx(run(['hook', 'route-session'], io({ session_id: 'NEW', source: 'clear' })))).not.toContain('before /clear');
  });
});
