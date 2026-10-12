import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run, type Io } from '../src/forge/cli/run.js';
import { readSwarm, saveSwarm } from '../src/forge/swarm.js';

const PLAN = `project: shop
locale: es
version: "1"
artifacts: {}
versions: []
tracks:
  - { id: a, name: A, color: blue }
  - { id: b, name: B, color: mauve }
phases:
  - { id: p1, name: P1, plan_status: committed }
tasks:
  - { id: A1, title: A1, track: a, phase: p1, done_when: x, depends_on: [], zones: [src/a/**] }
  - { id: B1, title: B1, track: b, phase: p1, done_when: x, depends_on: [A1], zones: [src/b/**] }
`;

let root: string;
let io: Io;
let gitCalls: string[][];
// The fake repository is always the main checkout.
const mainCheckout = (args: string[]): string | undefined =>
  args[1] === '--show-toplevel' ? `${root}\n` : args[0] === 'worktree' ? `worktree ${root}\nbranch refs/heads/main\n` : undefined;
const NOW = new Date('2026-10-11T12:00:00.000Z');
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'forge-swarm-'));
  gitCalls = [];
  io = {
    cwd: root, now: () => NOW, sleep: () => undefined,
    git: args => { gitCalls.push(args); return mainCheckout(args) ?? (args[0] === 'rev-parse' ? 'main\n' : args[0] === 'rev-list' ? '0\n' : null); },
  };
  writeFileSync(path.join(root, 'plan.yaml'), PLAN);
});
const out = (r: { stdout: string }) => JSON.parse(r.stdout);
const writeDocs = (dir: string, docs: Record<string, unknown>) => {
  mkdirSync(path.join(root, dir), { recursive: true });
  for (const [id, d] of Object.entries(docs)) writeFileSync(path.join(root, dir, `${id}.json`), JSON.stringify(d));
};

describe('forge swarm', () => {
  it('start creates the state with the base branch and the config parallel', () => {
    const s = out(run(['swarm', 'start', '--project', 'shop', '--session', 'main', '--merge'], io));
    expect(s).toMatchObject({ active: true, parallel: 5, mergeAuthorized: true, project: 'shop', base: 'main', coordinator: 'main' });
    expect(readSwarm(root)?.base).toBe('main');
  });
  it('start takes --parallel over the config and refuses a swarm of 1', () => {
    expect(out(run(['swarm', 'start', '--project', 'shop', '--session', 'main', '--parallel', '3'], io)).parallel).toBe(3);
    expect(run(['swarm', 'start', '--project', 'shop', '--session', 'x', '--parallel', '1'], { ...io, cwd: mkdtempSync(path.join(tmpdir(), 'fs-')) }).code).toBe(2);
  });
  it('start resumes a swarm of the same coordinator, keeping its fronts', () => {
    run(['swarm', 'start', '--project', 'shop', '--session', 'main'], io);
    const s = readSwarm(root)!;
    saveSwarm(root, { ...s, fronts: { a: { ...s.fronts.a, status: 'conflict', session: null, launchedAt: null, currentTask: null, heartbeatAt: null, done: 0, total: 1, waitingFor: null, detail: 'x' } } });
    const again = out(run(['swarm', 'start', '--project', 'shop', '--session', 'main', '--merge'], io));
    expect(again.fronts.a.status).toBe('conflict');
    expect(again.mergeAuthorized).toBe(true);
  });
  it('start refuses while another coordinator ticked in the last 30 minutes, and takes over an older one', () => {
    run(['swarm', 'start', '--project', 'shop', '--session', 'main'], io);
    saveSwarm(root, { ...readSwarm(root)!, lastTickAt: new Date(NOW.getTime() - 10 * 60000).toISOString() });
    expect(run(['swarm', 'start', '--project', 'shop', '--session', 'other'], io).code).toBe(2);
    saveSwarm(root, { ...readSwarm(root)!, lastTickAt: new Date(NOW.getTime() - 40 * 60000).toISOString() });
    expect(out(run(['swarm', 'start', '--project', 'shop', '--session', 'other'], io)).coordinator).toBe('other');
  });
  it('tick refuses without the db listings or the agents file', () => {
    run(['swarm', 'start', '--project', 'shop', '--session', 'main'], io);
    expect(run(['swarm', 'tick', '--plan', 'plan.yaml', '--db', 'db', '--agents', 'agents.json'], io).code).toBe(2);
  });
  it('tick reads plan, db and agents, saves the state and prints the actions', () => {
    run(['swarm', 'start', '--project', 'shop', '--session', 'main', '--merge'], io);
    writeDocs('db/state', {});
    writeDocs('db/sessions', {});
    writeFileSync(path.join(root, 'agents.json'), '["wp-shop-zzz"]');
    const r = out(run(['swarm', 'tick', '--plan', 'plan.yaml', '--db', 'db', '--agents', 'agents.json'], io));
    expect(r.actions).toEqual([{ type: 'launch', track: 'a' }, { type: 'wait', seconds: 240 }]);
    expect(r).toMatchObject({ progress: true, live: 0, parallel: 5 });
    expect(readSwarm(root)!.fronts.b.status).toBe('waiting');
    expect(gitCalls).toContainEqual(['rev-list', '--count', 'main..track/a']);
  });
  it('tick asks git which done commits are in the base branch', () => {
    run(['swarm', 'start', '--project', 'shop', '--session', 'main', '--merge'], io);
    writeDocs('db/state', { A1: { status: 'done', commits: [{ sha: 'abc', ts: NOW.toISOString(), title: 'A1', add: 1, del: 0 }] } });
    writeDocs('db/sessions', {});
    writeFileSync(path.join(root, 'agents.json'), '[]');
    io.git = args => { gitCalls.push(args); return mainCheckout(args) ?? (args[0] === 'merge-base' ? '' : args[0] === 'rev-list' ? '0\n' : null); };
    const r = out(run(['swarm', 'tick', '--plan', 'plan.yaml', '--db', 'db', '--agents', 'agents.json'], io));
    expect(gitCalls).toContainEqual(['merge-base', '--is-ancestor', 'abc', 'main']);
    expect(r.actions[0]).toEqual({ type: 'launch', track: 'b' });
  });
  it('mark sets launch-failed with its detail and retry clears it', () => {
    run(['swarm', 'start', '--project', 'shop', '--session', 'main'], io);
    writeFileSync(path.join(root, 'why.txt'), 'Workspace not trusted');
    expect(run(['swarm', 'mark', 'a', '--status', 'launch-failed', '--detail-file', 'why.txt'], io).code).toBe(0);
    expect(readSwarm(root)!.fronts.a).toMatchObject({ status: 'launch-failed', detail: 'Workspace not trusted' });
    expect(readSwarm(root)!.notice).toMatchObject({ kind: 'launch-failed', track: 'a' });
    expect(run(['swarm', 'mark', 'a', '--status', 'running'], io).code).toBe(2);
    run(['swarm', 'retry', 'a'], io);
    expect(readSwarm(root)!.fronts.a).toMatchObject({ status: 'queued', detail: null, launchedAt: null });
    expect(readSwarm(root)!.notice).toBeNull();
  });
  it('retry reactivates a swarm that stalled, keeping the other fronts, but not one the user stopped', () => {
    run(['swarm', 'start', '--project', 'shop', '--session', 'main'], io);
    const s = readSwarm(root)!;
    const front = (status: 'conflict' | 'integrated') => ({ ...s.fronts.a, status, session: null, launchedAt: null, currentTask: null, heartbeatAt: null, done: 1, total: 1, waitingFor: null, detail: status === 'conflict' ? 'merge conflict' : null });
    saveSwarm(root, { ...s, active: false, stopReason: 'stalled', stallReason: 'conflict: a', fronts: { a: front('conflict'), b: front('integrated') } });
    expect(run(['swarm', 'retry', 'a'], io).code).toBe(0);
    expect(readSwarm(root)).toMatchObject({ active: true, stopReason: null, stallReason: null });
    expect(readSwarm(root)!.fronts.a.status).toBe('queued');
    expect(readSwarm(root)!.fronts.b.status).toBe('integrated');
    saveSwarm(root, { ...readSwarm(root)!, active: false, stopReason: 'stopped', fronts: { a: front('conflict') } });
    run(['swarm', 'retry', 'a'], io);
    expect(readSwarm(root)).toMatchObject({ active: false, stopReason: 'stopped' });
    expect(readSwarm(root)!.fronts.a.status).toBe('queued');
  });
  it('sleep sets sleepUntil while sleeping and clears it after', () => {
    run(['swarm', 'start', '--project', 'shop', '--session', 'main'], io);
    let during: string | null = null;
    io.sleep = ms => { during = readSwarm(root)!.sleepUntil; expect(ms).toBe(240000); };
    expect(run(['swarm', 'sleep', '240'], io).code).toBe(0);
    expect(during).toBe('2026-10-11T12:04:00.000Z');
    expect(readSwarm(root)!.sleepUntil).toBeNull();
    expect(run(['swarm', 'sleep', '0'], io).code).toBe(2);
    expect(run(['swarm', 'sleep', '901'], io).code).toBe(2);
  });
  it('sleep --mark writes sleepUntil and returns at once without sleeping', () => {
    run(['swarm', 'start', '--project', 'shop', '--session', 'main'], io);
    let slept = false;
    io.sleep = () => { slept = true; };
    expect(run(['swarm', 'sleep', '240', '--mark'], io).code).toBe(0);
    expect(slept).toBe(false);
    expect(readSwarm(root)!.sleepUntil).toBe('2026-10-11T12:04:00.000Z');
    expect(run(['swarm', 'sleep', '0', '--mark'], io).code).toBe(2);
  });
  it('swarm stop and forge stop end the swarm', () => {
    run(['swarm', 'start', '--project', 'shop', '--session', 'main'], io);
    run(['swarm', 'stop', '--reason', 'budget'], io);
    expect(readSwarm(root)).toMatchObject({ active: false, stopReason: 'budget' });
    run(['swarm', 'start', '--project', 'shop', '--session', 'main'], io);
    run(['stop'], io);
    expect(readSwarm(root)).toMatchObject({ active: false, stopReason: 'stopped' });
    expect(existsSync(path.join(root, '.forge', 'stop'))).toBe(true);
  });
  it('status reports presence and state', () => {
    expect(out(run(['swarm', 'status'], io))).toEqual({ present: false, state: null });
    run(['swarm', 'start', '--project', 'shop', '--session', 'main'], io);
    expect(out(run(['swarm', 'status'], io)).state.project).toBe('shop');
    expect(readFileSync(path.join(root, '.forge', 'swarm.json'), 'utf8')).toContain('"fronts"');
  });
  it('the hook blocks for an active swarm and stays quiet while it sleeps', () => {
    run(['swarm', 'start', '--project', 'shop', '--session', 'main'], io);
    const hook = () => run(['hook', 'stop'], { ...io, stdin: JSON.stringify({ session_id: 's1' }) }).stdout;
    expect(hook()).toContain('forge swarm is active');
    saveSwarm(root, { ...readSwarm(root)!, sleepUntil: '2026-10-11T12:04:00.000Z' });
    expect(hook()).toBe('');
  });
});
