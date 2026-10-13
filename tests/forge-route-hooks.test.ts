import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { looksLikeCoding, routeReminder, routingRule, ROUTE_HINT } from '../src/forge/route-hooks.js';
import { writeRoute } from '../src/forge/route.js';
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
    writeRoute(root, { task: 't1', chosen: 'superpowers-design', by: 'user', stage: 'designing', ts: NOW.toISOString() });
    expect(context(hook('route-prompt', { session_id: 'S1', prompt: 'hello there' })).additionalContext).toContain('--from-spec');
    writeFileSync(path.join(root, '.forge', 'route.json'), '{"task":');
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
  // The person's local.yaml, under the git common dir.
  const personal = (text: string) => {
    execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'ignore' });
    mkdirSync(path.join(root, '.git', 'forge'), { recursive: true });
    writeFileSync(path.join(root, '.git', 'forge', 'local.yaml'), text);
  };
  it('stays silent with workflow: off, which keeps forge out of the routing', () => {
    personal('workflow: off\n');
    expect(hook('route-prompt', PROMPT).stdout).toBe('');
    expect(hook('route-session', { session_id: 'S1' }).stdout).toBe('');
  });
  it('a workflow in the working tree\'s .forge/local.yaml (a commit could ship one) is not read', () => {
    execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'ignore' });
    mkdirSync(path.join(root, '.forge'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'local.yaml'), 'workflow: off\n');
    expect(context(hook('route-prompt', PROMPT)).additionalContext).toBe(ROUTE_HINT);
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
