import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { hintOn, inForgeWorktree, looksLikeCoding, routeReminder, routingRule, ROUTE_HINT } from '../src/forge/route-hooks.js';
import { parseConfig } from '../src/forge/config.js';
import { listRoutes, readRoute, writeRoute } from '../src/forge/route.js';
import { writeMember } from '../src/forge/members.js';
import { saveRun, startRun } from '../src/forge/run.js';
import { run, type Io } from '../src/forge/cli/run.js';
import { useTempDirs } from './helpers/tmp.js';
import { seedExecution } from './helpers/execution.js';
const tmp = useTempDirs();

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
  it('reminds the hand-over of a brainstorming that ends without a file, on both mixed routes (A1)', () => {
    const r = { task: 't1', chosen: 'superpowers-design' as const, by: 'user' as const, stage: 'designing' as const, ts: NOW.toISOString() };
    for (const doc of [r, { ...r, chosen: 'superpowers-plan' as const, stage: 'planning' as const }]) {
      const text = routeReminder(doc, NOW.getTime())!;
      expect(text, doc.chosen).toContain('.forge/work/t1/task.txt');
      expect(text, doc.chosen).toMatch(/invoke forge:run$/);
      expect(text, doc.chosen).not.toMatch(/Bounded|continue/);
      // forge:run never closes a route: the reminder names the command that does, with the route's session.
      expect(text, doc.chosen).toContain('FORGE route stage --stage handed-off');
      expect(text, doc.chosen).not.toContain('undefined');
      expect(routeReminder({ ...doc, session: 'S1' }, NOW.getTime()), doc.chosen).toContain('FORGE route stage --stage handed-off --session S1');
    }
  });
});

describe('forge hook route-session and route-prompt', () => {
  let root: string;
  let cfg: string;
  beforeEach(() => {
    root = tmp('forge-route-hook-');
    cfg = tmp('forge-route-hook-cfg-');
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
    seedExecution(root, {
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
    root = tmp('forge-route-sess-hook-');
    cfg = tmp('forge-route-sess-cfg-');
  });
  const io = (stdin: unknown, at = NOW): Io => ({ cwd: root, now: () => at, stdin: JSON.stringify(stdin), env: { CLAUDE_CONFIG_DIR: cfg } });
  const ctx = (r: { stdout: string }) => (r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext as string : '');
  const PROMPT = { session_id: 'S1', prompt: 'Add coupon support to the cart with validation' };
  it('see an infinite run saved in the main checkout from a session in a subdirectory, as runRootOf does (final review 6)', () => {
    execFileSync('git', ['init', '-q'], { cwd: root });
    const sub = path.join(root, 'pkg');
    mkdirSync(sub, { recursive: true });
    const at = (stdin: unknown): Io => ({ ...io(stdin), cwd: sub });
    expect(run(['hook', 'route-prompt'], at(PROMPT)).stdout).not.toBe('');
    // infinite start saves the run in the main checkout (K2-01).
    saveRun(root, { ...startRun(NOW, { cycles: 2 }), sessionId: 'S1' });
    expect(run(['hook', 'route-prompt'], at(PROMPT)).stdout).toBe('');
    expect(run(['hook', 'route-session'], at({ session_id: 'S1', source: 'startup' })).stdout).toBe('');
    expect(run(['hook', 'route-prompt'], at({ ...PROMPT, session_id: 'S2' })).stdout).not.toBe('');
  });
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
  it('a status file untouched for longer than an open task lasts is not read: its task, open as it says, no longer silences the hint (M6)', () => {
    mkdirSync(path.join(root, '.forge', 'status'), { recursive: true });
    const file = path.join(root, '.forge', 'status', 'cart.json');
    writeFileSync(file, JSON.stringify({
      ts: NOW.toISOString(), task: 'cart', path: 'medium', phase: 'implement', agent: null, validators: [], verdict: null, round: null, cap: null, brief: 1,
      accepted: [], verify: null, taskStartedAt: NOW.toISOString(), stageSince: NOW.toISOString(), stages: {}, doneAt: null, lastAt: NOW.toISOString(),
      session: 'S1', runId: null, project: null,
    }));
    utimesSync(file, new Date(NOW.getTime() - 60_000), new Date(NOW.getTime() - 60_000));
    expect(run(['hook', 'route-prompt'], io(PROMPT)).stdout).toBe('');
    // Its content still says open and recent, but its mtime is 25 hours old: the file is skipped unread.
    utimesSync(file, new Date(NOW.getTime() - 25 * 3600_000), new Date(NOW.getTime() - 25 * 3600_000));
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
    run(['hook', 'live'], io({ session_id: 'OLD', hook_event_name: 'SessionEnd', reason: 'clear' }, new Date(NOW.getTime() - 60_000)));
    expect(readRoute(root, 'OLD')).toMatchObject({ endReason: 'clear', endedAt: new Date(NOW.getTime() - 60_000).toISOString() });
    const after = ctx(run(['hook', 'route-session'], io({ session_id: 'NEW', source: 'clear' })));
    expect(after).toContain('<FORGE-ROUTING>');
    expect(after).toContain('before /clear this conversation routed task t1 as "superpowers-design" and it is half done (designing)');
    expect(after).toContain('--from-spec');
    expect(after).not.toContain('continue');
    expect(ctx(run(['hook', 'route-session'], io({ session_id: 'NEW2', source: 'startup' })))).not.toContain('before /clear');
    expect(ctx(run(['hook', 'route-session'], io({ session_id: 'NEW3', source: 'clear' }, new Date(NOW.getTime() + 2 * 60_000))))).not.toContain('before /clear');
    // The route stays the earlier session's: a reminder, never a copy.
    expect(readRoute(root, 'NEW')).toBeNull();
  });
  it('the carried line names the earlier session and the command that closes its route once handed off', () => {
    writeRoute(root, { task: 't1', chosen: 'superpowers-design', by: 'user', stage: 'designing', ts: NOW.toISOString(), session: 'OLD' });
    const fork = ctx(run(['hook', 'route-session'], io({ session_id: 'FORK', source: 'fork' })));
    expect(fork).toContain('OLD');
    expect(fork).toContain('FORGE route stage --stage handed-off --session OLD');
    run(['hook', 'live'], io({ session_id: 'OLD', hook_event_name: 'SessionEnd', reason: 'clear' }, new Date(NOW.getTime() - 30_000)));
    const after = ctx(run(['hook', 'route-session'], io({ session_id: 'NEW', source: 'clear' })));
    expect(after).toContain('FORGE route stage --stage handed-off --session OLD');
    expect(after).not.toContain('continue');
    // The new conversation runs it: the earlier route is closed, and nothing is carried again.
    expect(JSON.parse(run(['route', 'stage', '--stage', 'handed-off', '--session', 'OLD'], { cwd: root, now: () => NOW, env: { CLAUDE_CODE_SESSION_ID: 'NEW' } }).stdout))
      .toMatchObject({ updated: true, session: 'OLD', stage: 'handed-off' });
    expect(ctx(run(['hook', 'route-session'], io({ session_id: 'NEW2', source: 'clear' })))).not.toContain('before /clear');
  });
  it('the latest end wins, by the reason SessionEnd gives; a fork with two open routes, or a /clear after a logout, names none (K1-13)', () => {
    const at = (min: number) => new Date(NOW.getTime() + min * 60_000);
    writeRoute(root, { task: 't1', chosen: 'superpowers-plan', by: 'user', stage: 'planning', ts: NOW.toISOString(), session: 'A' });
    writeRoute(root, { task: 't2', chosen: 'superpowers-design', by: 'user', stage: 'designing', ts: NOW.toISOString(), session: 'B' });
    expect(ctx(run(['hook', 'route-session'], io({ session_id: 'FORK', source: 'fork' })))).not.toContain('original conversation');
    run(['hook', 'live'], io({ session_id: 'A', hook_event_name: 'SessionEnd', reason: 'clear' }, at(-1)));
    run(['hook', 'live'], io({ session_id: 'A', hook_event_name: 'SessionEnd', reason: 'logout' }, at(0)));
    expect(readRoute(root, 'A')).toMatchObject({ endReason: 'logout', endedAt: at(0).toISOString() });
    run(['hook', 'live'], io({ session_id: 'B', hook_event_name: 'SessionEnd', reason: 'something-new' }, at(0)));
    expect(readRoute(root, 'B')).toMatchObject({ endReason: 'other' });
    expect(ctx(run(['hook', 'route-session'], io({ session_id: 'NEW', source: 'clear' })))).not.toContain('before /clear');
  });
  it('a /clear carries only a route ended by /clear in the last 2 minutes, the newest when several are (K1-04, K1-13)', () => {
    const at = (min: number) => new Date(NOW.getTime() + min * 60_000);
    writeRoute(root, { task: 't1', chosen: 'superpowers-design', by: 'user', stage: 'designing', ts: NOW.toISOString(), session: 'A' });
    writeRoute(root, { task: 't2', chosen: 'superpowers-plan', by: 'user', stage: 'planning', ts: NOW.toISOString(), session: 'B' });
    // Ended by /clear 3 minutes ago: another conversation's /clear now is not this one's.
    run(['hook', 'live'], io({ session_id: 'A', hook_event_name: 'SessionEnd', reason: 'clear' }, at(-3)));
    expect(ctx(run(['hook', 'route-session'], io({ session_id: 'NEW', source: 'clear' })))).not.toContain('before /clear');
    run(['hook', 'live'], io({ session_id: 'A', hook_event_name: 'SessionEnd', reason: 'clear' }, at(-1.5)));
    run(['hook', 'live'], io({ session_id: 'B', hook_event_name: 'SessionEnd', reason: 'clear' }, at(-0.5)));
    const carried = ctx(run(['hook', 'route-session'], io({ session_id: 'NEW2', source: 'clear' })));
    expect(carried).toContain('routed task t2');
    expect(carried).not.toContain('routed task t1');
  });
  it('exit, claude --resume and /clear: the route of the resumed conversation is carried (K1-13)', () => {
    const at = (min: number) => new Date(NOW.getTime() + min * 60_000);
    writeRoute(root, { task: 't1', chosen: 'superpowers-design', by: 'user', stage: 'designing', ts: NOW.toISOString(), session: 'S1' });
    run(['hook', 'live'], io({ session_id: 'S1', hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' }, at(-30)));
    expect(readRoute(root, 'S1')).toMatchObject({ endReason: 'prompt_input_exit' });
    // claude --resume keeps the session id: its SessionStart reopens the route.
    run(['hook', 'live'], io({ session_id: 'S1', hook_event_name: 'SessionStart', source: 'resume' }, at(-20)));
    expect(readRoute(root, 'S1')).not.toHaveProperty('endedAt');
    expect(readRoute(root, 'S1')).not.toHaveProperty('endReason');
    run(['hook', 'live'], io({ session_id: 'S1', hook_event_name: 'SessionEnd', reason: 'clear' }, at(-1)));
    const after = ctx(run(['hook', 'route-session'], io({ session_id: 'NEW', source: 'clear' })));
    expect(after).toContain('before /clear this conversation routed task t1');
    expect(after).toContain('--session S1');
  });
  it('exit, claude --resume and a fork: the fork names the route of the resumed conversation (K1-13)', () => {
    const at = (min: number) => new Date(NOW.getTime() + min * 60_000);
    writeRoute(root, { task: 't1', chosen: 'superpowers-plan', by: 'user', stage: 'planning', ts: NOW.toISOString(), session: 'S1' });
    run(['hook', 'live'], io({ session_id: 'S1', hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' }, at(-30)));
    // Ended and not resumed: a fork names nothing.
    expect(ctx(run(['hook', 'route-session'], io({ session_id: 'FORK0', source: 'fork' })))).not.toContain('original conversation');
    run(['hook', 'live'], io({ session_id: 'S1', hook_event_name: 'SessionStart', source: 'resume' }, at(-20)));
    const fork = ctx(run(['hook', 'route-session'], io({ session_id: 'FORK', source: 'fork' })));
    expect(fork).toContain('the original conversation routed task t1 as "superpowers-plan" and it is half done (planning)');
    expect(fork).toContain('--session S1');
    // Another SessionStart of the same session leaves a route without an end as it was.
    const before = readFileSync(path.join(root, '.forge', 'route', 'S1.json'), 'utf8');
    run(['hook', 'live'], io({ session_id: 'S1', hook_event_name: 'SessionStart', source: 'compact' }, at(-10)));
    expect(readFileSync(path.join(root, '.forge', 'route', 'S1.json'), 'utf8')).toBe(before);
  });
  it('listRoutes reads the newest routes first: 55 older routes never hide a fresh one (K1-13)', () => {
    const old = new Date('2020-01-01T00:00:00.000Z');
    for (let i = 0; i < 55; i++) {
      const s = `a${String(i).padStart(3, '0')}`;
      writeRoute(root, { task: 't1', chosen: 'forge', by: 'user', stage: 'done', ts: NOW.toISOString(), session: s });
      utimesSync(path.join(root, '.forge', 'route', `${s}.json`), old, old);
    }
    writeRoute(root, { task: 'fresh', chosen: 'superpowers-design', by: 'user', stage: 'designing', ts: NOW.toISOString(), session: 'zzz' });
    run(['hook', 'live'], io({ session_id: 'zzz', hook_event_name: 'SessionEnd', reason: 'clear' }, new Date(NOW.getTime() - 60_000)));
    const routes = listRoutes(root);
    expect(routes).toHaveLength(50);
    expect(routes[0]).toMatchObject({ session: 'zzz' });
    expect(ctx(run(['hook', 'route-session'], io({ session_id: 'NEW', source: 'clear' })))).toContain('routed task fresh');
  });
  it('the carried line keeps the hand-over without a file, then the command that closes the route (A1)', () => {
    writeRoute(root, { task: 't1', chosen: 'superpowers-plan', by: 'user', stage: 'planning', ts: NOW.toISOString(), session: 'OLD' });
    const fork = ctx(run(['hook', 'route-session'], io({ session_id: 'FORK', source: 'fork' })));
    expect(fork).toContain('FORGE route stage --stage handed-off --session OLD and invoke forge:run. Once handed off, close that route with FORGE route stage --stage handed-off --session OLD');
    expect(fork).not.toContain('continue');
  });
  it('a route forge:run left open is reminded with the command that closes it; once run, the reminder stops (A1)', () => {
    writeRoute(root, { task: 't1', chosen: 'superpowers-design', by: 'user', stage: 'designing', ts: NOW.toISOString(), session: 'S1' });
    const s1 = { cwd: root, now: () => NOW, env: { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: 'S1' } };
    // forge:run with the decisions as the task text: the hook is quiet while the task is open, and forge:run moves no route.
    expect(run(['triage', '--task', 't1', 'Add coupon support to the cart with validation'], s1).code).toBe(0);
    expect(run(['hook', 'route-prompt'], io(PROMPT)).stdout).toBe('');
    expect(run(['log', '--kind', 'phase', '--task', 't1', '--data', '{"phase":"done"}'], s1).code).toBe(0);
    expect(ctx(run(['hook', 'route-prompt'], io(PROMPT)))).toContain('FORGE route stage --stage handed-off --session S1');
    expect(JSON.parse(run(['route', 'stage', '--stage', 'handed-off', '--session', 'S1'], s1).stdout)).toMatchObject({ updated: true, stage: 'handed-off' });
    expect(run(['hook', 'route-prompt'], io(PROMPT)).stdout).toBe('');
  });
});

describe('route-prompt reads every forge task of the session (K1-12 with C5)', () => {
  it("a task of this session keeps the hint away although another session's task changed later and is the alias", () => {
    const dir = tmp('forge-k112-');
    const cfg = tmp('forge-k112-cfg-');
    const at = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
    const status = (task: string, session: string, lastAt: string, doneAt: string | null = null) => ({
      ts: lastAt, task, path: 'medium', phase: 'implement', agent: null, validators: [], verdict: null, round: null, cap: null, brief: 1,
      accepted: [], verify: null, taskStartedAt: at(60), stageSince: lastAt, stages: {}, doneAt, lastAt, session, runId: null, project: null,
      reviewers: [], reviews: null,
    });
    mkdirSync(path.join(dir, '.forge', 'status'), { recursive: true });
    const put = (s: { task: string }) => writeFileSync(path.join(dir, '.forge', 'status', `${s.task}.json`), JSON.stringify(s));
    put(status('T001', 'S1', at(30)));
    const other = status('T002', 'S2', at(5));
    put(other);
    writeFileSync(path.join(dir, '.forge', 'status.json'), JSON.stringify(other));
    const prompt = (session: string) => run(['hook', 'route-prompt'], {
      cwd: dir, now: () => NOW, stdin: JSON.stringify({ session_id: session, prompt: 'Add coupon support to the cart with validation' }), env: { CLAUDE_CONFIG_DIR: cfg },
    });
    expect(prompt('S1').stdout).toBe('');
    expect(context(prompt('S3'))?.additionalContext).toBe(ROUTE_HINT);
    put(status('T001', 'S1', at(30), at(10)));
    expect(context(prompt('S1'))?.additionalContext).toBe(ROUTE_HINT);
  });
});

describe('the hint of route-prompt (K1-03)', () => {
  it('leaves out agent messages, questions and interrogatives, never a polite request or a user story (Review Focus 4)', () => {
    for (const p of ['¿Por qué falla el test del carrito al añadir un cupón caducado?', 'How does the cart work when a coupon is added twice?',
      '<teammate-message teammate_id="reviewer">fix the rounding of the cart total in src/cart.js</teammate-message>',
      'Qué pasa si añado un cupón al carrito dos veces seguidas', 'Why does adding a coupon to the cart change the total twice',
      'The cart adds the coupon twice, should we fix it?']) expect(looksLikeCoding(p), p).toBe(false);
    for (const p of ['¿Puedes añadir un cupón de descuento al carrito de la tienda?', 'Can you add coupon support to the cart with validation?',
      'Como usuario, quiero que el carrito acepte cupones: añade la validación del código', 'Añade un descuento por cupón al carrito de la tienda']) {
      expect(looksLikeCoding(p), p).toBe(true);
    }
  });
  it('keeps the hint of a polite request after a lead or in plural, of an order with a tag question and of a JSX prompt', () => {
    for (const p of ['Hola, ¿puedes añadir un cupón de descuento al carrito de la tienda?', '¿Me puedes añadir un cupón de descuento al carrito?',
      '¿Podéis añadir un cupón de descuento al carrito?', 'Please can you add coupon support to the cart with validation?',
      'Could we add coupon support to the cart?', 'Can we add coupon support to the cart?',
      'Añade un cupón de descuento al carrito de la tienda, ¿vale?', 'Arregla el bug del carrito con cupones. ¿Por qué falla?',
      '¿PUEDES AÑADIR UN CUPÓN DE DESCUENTO AL CARRITO DE LA TIENDA?',
      '<Button> add a loading state to the Button component with props']) expect(looksLikeCoding(p), p).toBe(true);
    for (const p of ['¿Qué hace esta función de añadir cupones al carrito?', 'Why does the cart fail when we add a coupon?',
      '¿Cómo funciona el carrito cuando se añade un cupón?', 'What is the coupon API we add to the cart?',
      'El carrito va lento al añadir cupones, ¿no?', '<system-reminder>fix the rounding of the cart total in src/cart.js</system-reminder>',
      '<task-notification>fix the rounding of the cart total in src/cart.js</task-notification>']) expect(looksLikeCoding(p), p).toBe(false);
  });
  it('leaves out an <agent-message>, as K1-03 lists it (M9)', () => {
    expect(looksLikeCoding('<agent-message from="planner">fix the rounding of the cart total in src/cart.js</agent-message>')).toBe(false);
    expect(looksLikeCoding('fix the rounding of the cart total in src/cart.js')).toBe(true);
  });
  it('a broken .forge/config.yaml keeps route-prompt silent, the hint and the reminder alike (M8)', () => {
    const root = tmp('forge-hint-bad-');
    const said = () => run(['hook', 'route-prompt'], {
      cwd: root, now: () => NOW, env: {}, stdin: JSON.stringify({ session_id: 'S1', prompt: 'Add coupon support to the cart with validation' }),
    });
    expect(JSON.parse(said().stdout).hookSpecificOutput.additionalContext).toBe(ROUTE_HINT);
    mkdirSync(path.join(root, '.forge'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'config.yaml'), 'route:\n  hint: maybe\n');
    expect(said()).toMatchObject({ code: 0, stdout: '' });
    writeRoute(root, { task: 't1', chosen: 'superpowers-design', by: 'user', stage: 'designing', ts: NOW.toISOString(), session: 'S1' });
    expect(said()).toMatchObject({ code: 0, stdout: '' });
  });
  it('runs in linear time on a long prompt', () => {
    const t0 = performance.now();
    for (const p of ['hola, '.repeat(40000), '¿'.repeat(200000), 'a '.repeat(100000) + '?']) looksLikeCoding(p);
    expect(performance.now() - t0).toBeLessThan(200);
  });
  it('route.hint: false and true through the hook', () => {
    const root = tmp('forge-hint2-');
    const said = () => {
      const r = run(['hook', 'route-prompt'], { cwd: root, now: () => NOW, env: {}, stdin: JSON.stringify({ session_id: 'S1', prompt: '¿Puedes añadir soporte de cupones al carrito con validación?' }) });
      return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext as string : '';
    };
    mkdirSync(path.join(root, '.forge'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'config.yaml'), 'route:\n  hint: false\n');
    expect(said()).toBe('');
    writeFileSync(path.join(root, '.forge', 'config.yaml'), 'route:\n  hint: true\n');
    expect(said()).toBe(ROUTE_HINT);
  });
  it('route.hint: off and FORGE_ROUTE_HINT=off turn the hint off, never the reminder of a route half done', () => {
    const root = tmp('forge-hint-');
    const io = (env: Record<string, string> = {}): Io => ({
      cwd: root, now: () => NOW, env, stdin: JSON.stringify({ session_id: 'S1', prompt: 'Add coupon support to the cart with validation' }),
    });
    const said = (i: Io) => {
      const r = run(['hook', 'route-prompt'], i);
      return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext as string : '';
    };
    expect(hintOn({}, parseConfig(null))).toBe(true);
    expect(said(io())).toBe(ROUTE_HINT);
    expect(said(io({ FORGE_ROUTE_HINT: 'off' }))).toBe('');
    mkdirSync(path.join(root, '.forge'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'config.yaml'), 'route:\n  hint: off\n');
    expect(said(io())).toBe('');
    writeRoute(root, { task: 't1', chosen: 'superpowers-design', by: 'user', stage: 'designing', ts: NOW.toISOString(), session: 'S1' });
    expect(said(io())).toContain('hand off with forge:run --from-spec');
    expect(said(io({ FORGE_ROUTE_HINT: 'off' }))).toContain('hand off with forge:run --from-spec');
  });
});
