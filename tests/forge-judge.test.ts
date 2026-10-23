import { describe, it, expect, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { run } from '../src/forge/cli/run.js';
import { startRun, saveRun, parseRun, readRunText } from '../src/forge/run.js';
import { loadProposal, loadApproval, saveProposal } from '../src/forge/proposals.js';
import { appendEvent, readEvents } from '../src/forge/ledger.js';
import { proposalDigest } from '../src/lib/proposals.js';
import { stopContext, lastDecisions, unownedOf } from '../src/forge/cli/shared.js';
import { profileNames } from '../src/forge/profile.js';
import { useTempDirs } from './helpers/tmp.js';

const tmp = useTempDirs();
const T0 = new Date('2026-10-22T10:00:00.000Z');
let root: string;
let n = 0;
const io = () => ({ cwd: root, now: () => T0, env: {}, rand: () => (++n % 36) / 36 });
const add = (o: Record<string, unknown>, extra: string[] = []) => {
  writeFileSync(path.join(root, 'p.json'), JSON.stringify({ category: 'feature', risk: 'high', rationale: 'r', evidence: 'e', pillar: 'Juice', source: 'scout', ...o }));
  return JSON.parse(run(['proposals', 'add', '--file', 'p.json', '--author', 'session:main', ...extra], io()).stdout).id as string;
};
const verdicts = (...v: { id: string; verdict: string; why: string; changes?: string; loses?: string }[]) => {
  writeFileSync(path.join(root, 'v.json'), JSON.stringify({ verdicts: v.map(x => ({ ...x, digest: proposalDigest(x.id, loadProposal(root, x.id)!) })) }));
};
const judge = (id: string, extra: string[] = []) => run(['proposals', 'judge', id, '--critic', 'v.json', ...extra], io());
beforeEach(() => {
  root = tmp('judge-');
  saveRun(root, { ...startRun(T0, { hours: 1 }, 10, 'coord-1', 'en'), autonomous: { profile: 'product', name: 'g', runId: 'product-g', worktree: path.join(root, 'wt'), branch: 'forge/product-g', startBranch: 'main', protectedBranches: ['main'] } });
});

describe('proposals judge (6b-2)', () => {
  it('approves what the critic keeps, of any category, with the owner\'s mark by forge:auto and an approve decision', () => {
    const id = add({ title: 'Online leaderboard', category: 'deps' });
    verdicts({ id, verdict: 'keep', why: 'players compare scores' });
    const r = JSON.parse(judge(id, ['--session', 'main']).stdout);
    expect(r).toMatchObject({ id, outcome: 'approved', write: { status: 'auto_approved', decidedBy: 'forge:auto' }, approval: { collection: 'approvals', doc_id: id, data: { status: 'auto_approved', by: 'forge:auto' } } });
    expect(loadApproval(root, id)).toMatchObject({ status: 'auto_approved', by: 'forge:auto' });
    expect(r.publish[0].data.decision).toMatchObject({ point: 'approve', chosen: 'approve it', alternatives: [{ option: 'reject it', whyNot: 'players compare scores' }] });
    expect(judge(id).code).toBe(2);
  });
  it('rejects what it drops, with its reason', () => {
    const id = add({ title: 'Rename variables' });
    verdicts({ id, verdict: 'drop', why: 'moves nothing for the player' });
    expect(JSON.parse(judge(id).stdout)).toMatchObject({ outcome: 'rejected', write: { status: 'rejected', reason: 'moves nothing for the player' } });
  });
  it('an adapt asks for a v2, and the v2 is approved on that verdict while the original is replaced', () => {
    const orig = add({ title: 'Big shop' });
    verdicts({ id: orig, verdict: 'adapt', why: 'too big', changes: 'only cosmetic items' });
    expect(JSON.parse(judge(orig).stdout)).toMatchObject({ outcome: 'adapt', changes: 'only cosmetic items', write: null });
    const v2 = add({ title: 'Cosmetic shop', rationale: `r (v2 of ${orig})` }, ['--revises', orig]);
    const r = JSON.parse(judge(v2).stdout);
    expect(r).toMatchObject({ outcome: 'approved', original: { id: orig, write: { status: 'rejected', reason: `replaced by ${v2}` } } });
  });
  it('a v2 the critic keeps on its own verdict also replaces its original while that one is open', () => {
    const orig = add({ title: 'Big shop' });
    const v2 = add({ title: 'Cosmetic shop' }, ['--revises', orig]);
    verdicts({ id: v2, verdict: 'keep', why: 'small and fun' });
    expect(JSON.parse(judge(v2).stdout)).toMatchObject({
      outcome: 'approved', approval: { data: { status: 'auto_approved' } },
      original: { id: orig, write: { status: 'rejected', reason: `replaced by ${v2}` }, approval: { doc_id: orig, data: { status: 'rejected', by: 'forge:auto' } } },
    });
    expect([loadProposal(root, orig)?.status, loadApproval(root, orig)?.status]).toEqual(['rejected', 'rejected']);
    expect(lastDecisions(root)[orig]).toEqual({ status: 'rejected', ts: T0.toISOString() });
  });
  it('parks a person\'s idea that clashes, with why and what would be lost; it no longer holds the queue', () => {
    const id = add({ title: 'Online mode', source: 'user' });
    // A chat idea is the owner's: proposals add --from-chat (Task 5) logs owner: true; until then, the last add event says so.
    appendEvent(root, { ts: T0.toISOString(), kind: 'proposal', action: 'add', id, from: 'chat', owner: true });
    verdicts({ id, verdict: 'clash', why: 'the vision is a solo game', loses: 'the focus on solo play' });
    const r = JSON.parse(judge(id, ['--session', 'main']).stdout);
    expect(r).toMatchObject({ outcome: 'parked', write: { status: 'discussing', parked: { why: 'the vision is a solo game', loses: 'the focus on solo play' } }, approval: null });
    expect(r.publish[0].data.decision).toMatchObject({ point: 'idea', chosen: 'park it', alternatives: [{ option: 'integrate it', tradeoffs: 'the focus on solo play' }] });
    expect(stopContext(root, T0).pendingProposals).toBe(0);
  });
  it('an idea of someone who is not the owner waits for the owner\'s mark', () => {
    const id = add({ title: 'Dark theme', source: 'user' });
    appendEvent(root, { ts: T0.toISOString(), kind: 'proposal', action: 'add', id, from: 'note:n1', owner: false });
    verdicts({ id, verdict: 'keep', why: 'fine' });
    expect(JSON.parse(judge(id).stdout)).toMatchObject({ outcome: 'waits-owner', write: null, approval: null });
    expect(loadProposal(root, id)?.status).toBe('proposed');
  });
  it('refuses a verdict of another text, a missing verdict, and any judging outside an autonomous run', () => {
    const id = add({ title: 'Combo meter' });
    const doc = loadProposal(root, id)!;
    writeFileSync(path.join(root, 'v.json'), JSON.stringify({ verdicts: [{ id, digest: proposalDigest(id, { ...doc, title: 'Other' }), verdict: 'keep', why: 'x' }] }));
    expect(judge(id).code).toBe(2);
    writeFileSync(path.join(root, 'v.json'), JSON.stringify({ verdicts: [] }));
    expect(judge(id).code).toBe(2);
    saveRun(root, startRun(T0, { hours: 1 }, 10, 'coord-1'));
    verdicts({ id, verdict: 'keep', why: 'fine' });
    expect(judge(id).code).toBe(2);
    expect(loadProposal(root, id)?.status).toBe('proposed');
  });
});

describe('proposals judge: what it never approves', () => {
  it('a missing or malformed verdict approves nothing: exit 2, and nothing is written or logged', () => {
    const id = add({ title: 'Combo meter' });
    const digest = proposalDigest(id, loadProposal(root, id)!);
    const before = readEvents(root).length;
    const malformed = [
      'not json',
      JSON.stringify({ verdicts: [{ id, digest, verdict: 'keep' }] }),
      JSON.stringify({ verdicts: [{ id, digest: 'f'.repeat(63), verdict: 'keep', why: 'w' }] }),
      JSON.stringify({ verdicts: [{ id, digest, verdict: 'maybe', why: 'w' }] }),
      JSON.stringify({ verdicts: [{ id, digest, verdict: 'clash', why: 'w' }] }),
      // A repeated id counts its first entry (Task 3): a malformed first one is no verdict, whatever follows.
      JSON.stringify({ verdicts: [{ id, digest, verdict: 'keep' }, { id, digest, verdict: 'keep', why: 'w' }] }),
    ];
    for (const text of malformed) {
      writeFileSync(path.join(root, 'v.json'), text);
      expect(judge(id).code, text).toBe(2);
    }
    expect(run(['proposals', 'judge', id, '--critic', 'missing.json'], io()).code).toBe(2);
    expect(readEvents(root)).toHaveLength(before);
    expect(loadProposal(root, id)?.status).toBe('proposed');
    expect(loadApproval(root, id)).toBeNull();
  });
  it('the verdict must be of the text the proposal has now, also the original\'s adapt a v2 is judged on', () => {
    // A chat idea's add event carries no digest, so its edited text reaches the verdict's digest.
    const id = add({ title: 'Ghost replays', source: 'user' });
    appendEvent(root, { ts: T0.toISOString(), kind: 'proposal', action: 'add', id, from: 'chat', owner: true });
    verdicts({ id, verdict: 'keep', why: 'fun' });
    saveProposal(root, id, { ...loadProposal(root, id)!, rationale: 'changed after the critic read it' });
    expect(judge(id).code).toBe(2);
    const orig = add({ title: 'Big shop' });
    verdicts({ id: orig, verdict: 'adapt', why: 'too big', changes: 'only cosmetic items' });
    const v2 = add({ title: 'Cosmetic shop' }, ['--revises', orig]);
    saveProposal(root, orig, { ...loadProposal(root, orig)!, evidence: 'an editor changed it' });
    expect(judge(v2).code).toBe(2);
    expect([loadProposal(root, id)?.status, loadProposal(root, v2)?.status, loadProposal(root, orig)?.status]).toEqual(['proposed', 'proposed', 'proposed']);
    expect(readEvents(root).filter(e => e.action === 'judge' || e.kind === 'decision')).toEqual([]);
  });
  it('refuses a parked proposal, one with the owner\'s mark, and a v2 whose original is no longer open', () => {
    const idea = add({ title: 'Online mode', source: 'user' });
    appendEvent(root, { ts: T0.toISOString(), kind: 'proposal', action: 'add', id: idea, from: 'chat', owner: true });
    verdicts({ id: idea, verdict: 'clash', why: 'the vision is a solo game', loses: 'the focus on solo play' });
    expect(JSON.parse(judge(idea).stdout).outcome).toBe('parked');
    expect(judge(idea).code).toBe(2);
    const marked = add({ title: 'Combo meter' });
    run(['proposals', 'decide', marked, 'approve'], io());
    saveProposal(root, marked, { ...loadProposal(root, marked)!, status: 'proposed' });
    verdicts({ id: marked, verdict: 'drop', why: 'no' });
    expect(judge(marked).code).toBe(2);
    expect(loadApproval(root, marked)?.status).toBe('approved');
    const orig = add({ title: 'Big shop' });
    verdicts({ id: orig, verdict: 'adapt', why: 'too big', changes: 'only cosmetic items' });
    const v2 = add({ title: 'Cosmetic shop' }, ['--revises', orig]);
    run(['proposals', 'decide', orig, 'reject'], io());
    expect(judge(v2).code).toBe(2);
    expect(loadProposal(root, v2)?.status).toBe('proposed');
  });
  it('waits for the owner when it cannot tell whose the proposal is: no add event, or a text that changed since forge added it', () => {
    const pulled = 'p20261022090000zzzz';
    saveProposal(root, pulled, { ts: 't', category: 'feature', risk: 'low', title: 'Pulled idea', rationale: 'r', evidence: '', pillar: '', status: 'proposed', source: 'scout', author: 'user:x' });
    verdicts({ id: pulled, verdict: 'keep', why: 'fine' });
    expect(JSON.parse(judge(pulled).stdout)).toMatchObject({ outcome: 'waits-owner', write: null, approval: null });
    const own = add({ title: 'Combo meter' });
    saveProposal(root, own, { ...loadProposal(root, own)!, rationale: 'an editor rewrote it' });
    verdicts({ id: own, verdict: 'keep', why: 'fine' });
    expect(JSON.parse(judge(own).stdout)).toMatchObject({ outcome: 'waits-owner', write: null, approval: null });
    expect([loadProposal(root, pulled)?.status, loadProposal(root, own)?.status]).toEqual(['proposed', 'proposed']);
  });
  it('a new proposal never comes parked: only a judge parks', () => {
    const id = add({ title: 'Online mode', source: 'user', parked: { why: 'w', loses: 'l', at: T0.toISOString() } });
    expect(loadProposal(root, id)).not.toHaveProperty('parked');
    // Without an autonomous run the queue is this checkout's: the new proposal fills it.
    saveRun(root, startRun(T0, { hours: 1 }, 10, 'coord-1'));
    expect(stopContext(root, T0).pendingProposals).toBe(1);
  });
});

describe('proposals judge: the run around it', () => {
  const PLAN = '# keep me\nproject: demo\nlocale: en\nversion: "0.1"\nversions:\n  - id: "0.1"\n    phases: [F1]\ntracks:\n  - { id: backend, name: Backend, color: blue }\n'
    + 'phases:\n  - { id: F1, name: Base, plan_status: committed }\ntasks:\n  - { id: T001, title: a, track: backend, phase: F1, done_when: x }\n';
  it('policy approves nothing while an autonomous run is active (H-5)', () => {
    const id = add({ title: 'Tidy the parser helpers', category: 'quality', risk: 'low', path: 'src/parser.ts' });
    expect(JSON.parse(run(['proposals', 'policy', id], io()).stdout)).toMatchObject({ id, status: 'proposed', write: null, approval: null, reason: 'autonomous' });
    expect(loadApproval(root, id)).toBeNull();
    saveRun(root, startRun(T0, { hours: 1 }, 10, 'coord-1'));
    expect(JSON.parse(run(['proposals', 'policy', id], io()).stdout)).toMatchObject({ id, status: 'auto_approved' });
  });
  it('a judge and an unpark are the latest decision, so a judged approval becomes a task (M-2)', () => {
    const id = add({ title: 'Combo meter', path: 'src/combo.ts' });
    verdicts({ id, verdict: 'keep', why: 'it rewards skill' });
    expect(judge(id).code).toBe(0);
    expect(lastDecisions(root)[id]).toEqual({ status: 'auto_approved', ts: T0.toISOString() });
    writeFileSync(path.join(root, 'plan.yaml'), PLAN);
    const r = run(['proposals', 'to-task', id, '--plan', 'plan.yaml'], io());
    expect(r.code, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ id, taskId: 'T002' });
    appendEvent(root, { ts: '2026-10-22T11:00:00.000Z', kind: 'proposal', action: 'unpark', id: 'p20261022090000zzzz', status: 'approved' });
    expect(lastDecisions(root).p20261022090000zzzz).toEqual({ status: 'approved', ts: '2026-10-22T11:00:00.000Z' });
  });
  it('speaks the run\'s language: each outcome and its alternative in Spanish (L-13)', () => {
    saveRun(root, { ...startRun(T0, { hours: 1 }, 10, 'coord-1', 'es'), autonomous: parseRun(readRunText(root))!.autonomous! });
    const decision = (r: { stdout: string }) => JSON.parse(r.stdout).publish[0].data.decision;
    const keep = add({ title: 'Online leaderboard' });
    const drop = add({ title: 'Rename variables' });
    const idea = add({ title: 'Online mode', source: 'user' });
    appendEvent(root, { ts: T0.toISOString(), kind: 'proposal', action: 'add', id: idea, from: 'chat', owner: true });
    const orig = add({ title: 'Big shop' });
    verdicts({ id: keep, verdict: 'keep', why: 'a' }, { id: drop, verdict: 'drop', why: 'b' }, { id: idea, verdict: 'clash', why: 'c', loses: 'd' },
      { id: orig, verdict: 'adapt', why: 'e', changes: 'f' });
    expect(decision(judge(keep, ['--session', 'main']))).toMatchObject({ chosen: 'aprobarla', alternatives: [{ option: 'rechazarla', whyNot: 'a' }] });
    expect(decision(judge(drop, ['--session', 'main']))).toMatchObject({ chosen: 'rechazarla', alternatives: [{ option: 'aprobarla', whyNot: 'b' }] });
    expect(decision(judge(idea, ['--session', 'main']))).toMatchObject({ point: 'idea', chosen: 'aparcarla', alternatives: [{ option: 'integrarla', whyNot: 'c', tradeoffs: 'd' }] });
    const v2 = add({ title: 'Cosmetic shop' }, ['--revises', orig]);
    expect(JSON.parse(judge(v2).stdout)).toMatchObject({ outcome: 'approved', original: { id: orig, write: { status: 'rejected', reason: `sustituida por ${v2}` } } });
  });
});

describe('proposals judge in a profile worktree (T6B2-ROOTS)', () => {
  it('judges in the worktree: the decision goes to the main checkout\'s ledger, the proposal and its mark stay in the worktree', () => {
    const main = tmp('judge-main-');
    const g = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    g(main, 'init', '-q', '-b', 'main');
    g(main, 'config', 'user.email', 'a@b.c'); g(main, 'config', 'user.name', 't'); g(main, 'config', 'core.autocrlf', 'false');
    writeFileSync(path.join(main, 'a.txt'), 'a'); g(main, 'add', 'a.txt'); g(main, 'commit', '-qm', 'a');
    const cli = (cwd: string, args: string[]) => run(args, { cwd, now: () => T0, env: {}, rand: () => (++n % 36) / 36 });
    expect(cli(main, ['infinite', 'prepare', '--profile', 'product', '--name', 'g']).code).toBe(0);
    const wt = profileNames(main, 'product', 'g').worktree;
    expect(cli(wt, ['infinite', 'start', '--profile', 'product', '--name', 'g', '--hours', '2', '--session', 'coord-1']).code).toBe(0);
    const addIn = (o: Record<string, unknown>) => {
      writeFileSync(path.join(wt, 'p.json'), JSON.stringify({ category: 'feature', risk: 'high', rationale: 'r', evidence: 'e', pillar: 'Juice', source: 'scout', ...o }));
      return JSON.parse(cli(wt, ['proposals', 'add', '--file', 'p.json', '--author', 'session:main']).stdout).id as string;
    };
    const id = addIn({ title: 'Online leaderboard' });
    const idea = addIn({ title: 'Online mode', source: 'user' });
    appendEvent(wt, { ts: T0.toISOString(), kind: 'proposal', action: 'add', id: idea, from: 'chat', owner: true });
    expect(stopContext(main, T0).pendingProposals).toBe(2);
    const digest = (pid: string) => proposalDigest(pid, loadProposal(wt, pid)!);
    writeFileSync(path.join(wt, 'v.json'), JSON.stringify({ verdicts: [
      { id, digest: digest(id), verdict: 'keep', why: 'players compare scores' },
      { id: idea, digest: digest(idea), verdict: 'clash', why: 'the vision is a solo game', loses: 'the focus on solo play' },
    ] }));
    const approved = JSON.parse(cli(wt, ['proposals', 'judge', id, '--critic', 'v.json']).stdout);
    const parked = JSON.parse(cli(wt, ['proposals', 'judge', idea, '--critic', 'v.json']).stdout);
    expect([approved.outcome, parked.outcome]).toEqual(['approved', 'parked']);
    expect(loadProposal(wt, id)?.status).toBe('auto_approved');
    expect(loadApproval(wt, id)).toMatchObject({ status: 'auto_approved', by: 'forge:auto' });
    expect([loadProposal(main, id), loadApproval(main, id), loadProposal(main, idea)]).toEqual([null, null, null]);
    const decisions = readEvents(main).filter(e => e.kind === 'decision');
    expect(decisions.filter(e => e.point === 'approve' || e.point === 'idea')).toMatchObject([
      { point: 'approve', what: 'Online leaderboard', runId: 'product-g' }, { point: 'idea', what: 'Online mode', runId: 'product-g' },
    ]);
    expect([decisions.length - 1, decisions.length]).toEqual([approved.decision, parked.decision]);
    expect(readEvents(wt).filter(e => e.kind === 'decision')).toEqual([]);
    expect(readEvents(wt).filter(e => e.action === 'judge').map(e => [e.id, e.status])).toEqual([[id, 'auto_approved'], [idea, 'discussing']]);
    // stopContext and unownedOf count the worktree's proposals: the parked idea waits apart, the approval has its mark.
    expect(stopContext(main, T0)).toMatchObject({ pendingProposals: 0, approvedPending: 1 });
    expect(unownedOf(main, T0)).toBe(0);
    saveProposal(wt, 'p20261022090000zzzz', { ...loadProposal(wt, id)!, title: 'Approved by hand, no mark', status: 'approved' });
    expect(unownedOf(main, T0)).toBe(1);
  });
});
