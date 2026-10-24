import { describe, it, expect, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { run } from '../src/forge/cli/run.js';
import { startRun, saveRun, parseRun, readRunText } from '../src/forge/run.js';
import { loadProposal, loadApproval, saveProposal, removeApproval } from '../src/forge/proposals.js';
import { appendEvent, readEvents } from '../src/forge/ledger.js';
import { proposalDigest } from '../src/lib/proposals.js';
import { parsePlan } from '../src/lib/plan.js';
import { stopContext, lastDecisions, unownedOf } from '../src/forge/cli/shared.js';
import { profileNames } from '../src/forge/profile.js';
import { explorePassed } from '../src/forge/saturation.js';
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
const verdicts = (...v: { id: string; verdict: string; why: string; changes?: string; loses?: string; placement?: Record<string, unknown> }[]) => {
  writeFileSync(path.join(root, 'v.json'), JSON.stringify({ verdicts: v.map(x => ({ ...x, digest: proposalDigest(x.id, loadProposal(root, x.id)!) })) }));
};
const judge = (id: string, extra: string[] = []) => run(['proposals', 'judge', id, '--critic', 'v.json', ...extra], io());
const outcome = (id: string) => JSON.parse(judge(id).stdout).outcome as string;
// A chat idea is the owner's: `proposals add --from-chat` logs owner: true. These tests write that add event by hand, as the
// last one judge reads; tests/forge-ideas.test.ts runs the command itself.
const fromChat = (id: string) => appendEvent(root, { ts: T0.toISOString(), kind: 'proposal', action: 'add', id, from: 'chat', owner: true });
const decisions = () => readEvents(root).filter(e => e.kind === 'decision');
const judged = () => readEvents(root).filter(e => e.kind === 'proposal' && e.action === 'judge');
// Fix 1, m-1: judge runs only inside the run's worktree. These tests judge in `root`, so the run's worktree is `root` itself,
// and stopContext then counts root's own proposals (m-3).
const autonomous = (worktree: string) => ({ profile: 'product' as const, name: 'g', runId: 'product-g', worktree, branch: 'forge/product-g', startBranch: 'main', protectedBranches: ['main'] });
const autonomousRun = (worktree = root, locale = 'en') => saveRun(root, { ...startRun(T0, { hours: 1 }, 10, 'coord-1', locale), autonomous: autonomous(worktree) });
beforeEach(() => {
  root = tmp('judge-');
  autonomousRun();
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
  it('an adapt asks for a v2, which is approved only on its own keep, and then the original is replaced (T6B2-V2-OWN-VERDICT)', () => {
    const orig = add({ title: 'Big shop' });
    verdicts({ id: orig, verdict: 'adapt', why: 'too big', changes: 'only cosmetic items' });
    expect(JSON.parse(judge(orig).stdout)).toMatchObject({ outcome: 'adapt', changes: 'only cosmetic items', write: null });
    const v2 = add({ title: 'Cosmetic shop', rationale: `r (v2 of ${orig})` }, ['--revises', orig]);
    // The original's adapt only lets the run write the v2: with no verdict of its own, the v2 waits for the next batch.
    expect(judge(v2).code).toBe(2);
    expect([loadProposal(root, v2)?.status, loadProposal(root, orig)?.status, decisions()]).toEqual(['proposed', 'proposed', []]);
    verdicts({ id: v2, verdict: 'keep', why: 'small and fun' });
    expect(JSON.parse(judge(v2).stdout)).toMatchObject({
      outcome: 'approved', approval: { data: { status: 'auto_approved' } },
      original: { id: orig, write: { status: 'rejected', reason: `replaced by ${v2}` }, approval: { doc_id: orig, data: { status: 'rejected', by: 'forge:auto' } } },
    });
    expect([loadProposal(root, orig)?.status, loadApproval(root, orig)?.status]).toEqual(['rejected', 'rejected']);
    expect(lastDecisions(root)[orig]).toEqual({ status: 'rejected', ts: T0.toISOString() });
  });
  it('parks a person\'s idea that clashes, with why and what would be lost; it no longer holds the queue', () => {
    add({ title: 'Combo meter' });
    const id = add({ title: 'Online mode', source: 'user' });
    fromChat(id);
    // m-3: the run's worktree is root, so stopContext counts its proposals: both are pending before the judge.
    expect(stopContext(root, T0).pendingProposals).toBe(2);
    verdicts({ id, verdict: 'clash', why: 'the vision is a solo game', loses: 'the focus on solo play' });
    const r = JSON.parse(judge(id, ['--session', 'main']).stdout);
    expect(r).toMatchObject({ outcome: 'parked', write: { status: 'discussing', parked: { why: 'the vision is a solo game', loses: 'the focus on solo play' } }, approval: null });
    expect(r.publish[0].data.decision).toMatchObject({ point: 'idea', chosen: 'park it', alternatives: [{ option: 'integrate it', tradeoffs: 'the focus on solo play' }] });
    expect(stopContext(root, T0).pendingProposals).toBe(1);
  });
  it('a park decides nothing: neither its write nor the proposal carry decidedBy or decidedAt, the park time is parked.at (final fix, m-3)', () => {
    const id = add({ title: 'Online mode', source: 'user' });
    fromChat(id);
    verdicts({ id, verdict: 'clash', why: 'the vision is a solo game', loses: 'the focus on solo play' });
    const r = JSON.parse(judge(id).stdout);
    expect(r.write).toEqual({ status: 'discussing', parked: { why: 'the vision is a solo game', loses: 'the focus on solo play', at: T0.toISOString() } });
    expect(loadProposal(root, id)).toMatchObject({ status: 'discussing', parked: { at: T0.toISOString() } });
    expect(loadProposal(root, id)).not.toHaveProperty('decidedBy');
    expect(loadProposal(root, id)).not.toHaveProperty('decidedAt');
    // Positive control: a rejection is decided, by forge on its own, at its time.
    const drop = add({ title: 'Rename variables' });
    verdicts({ id: drop, verdict: 'drop', why: 'moves nothing for the player' });
    expect(JSON.parse(judge(drop).stdout).write).toMatchObject({ status: 'rejected', decidedBy: 'forge:auto', decidedAt: T0.toISOString() });
  });
  it('an idea of someone who is not the owner waits for the owner\'s mark', () => {
    const id = add({ title: 'Dark theme', source: 'user' });
    appendEvent(root, { ts: T0.toISOString(), kind: 'proposal', action: 'add', id, from: 'note:n1', owner: false });
    verdicts({ id, verdict: 'keep', why: 'fine' });
    expect(JSON.parse(judge(id).stdout)).toMatchObject({ outcome: 'waits-owner', write: null, approval: null });
    expect(loadProposal(root, id)?.status).toBe('proposed');
    // Positive control: the owner's own note idea is approved.
    const own = add({ title: 'Light theme', source: 'user' });
    appendEvent(root, { ts: T0.toISOString(), kind: 'proposal', action: 'add', id: own, from: 'note:n2', owner: true });
    verdicts({ id: own, verdict: 'keep', why: 'fine' });
    expect(outcome(own)).toBe('approved');
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
    // Positive control: the same proposal and verdict, in an autonomous run, is approved.
    autonomousRun();
    expect(outcome(id)).toBe('approved');
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
    // Positive control: a well formed verdict of the same text is approved.
    writeFileSync(path.join(root, 'v.json'), JSON.stringify({ verdicts: [{ id, digest, verdict: 'keep', why: 'w' }] }));
    expect(outcome(id)).toBe('approved');
  });
  it('a why that cleans to nothing is no verdict, and a decision the record refuses writes nothing (I-1, T6B2-DECISION-FIRST)', () => {
    const bidi = String.fromCharCode(0x202e);
    const c1 = String.fromCharCode(0x85);
    const id = add({ title: 'Combo meter' });
    for (const why of [bidi, c1, ` ${bidi} ${c1} `]) {
      verdicts({ id, verdict: 'keep', why });
      expect(judge(id).code, JSON.stringify(why)).toBe(2);
    }
    // A title the decision record cleans to nothing: the decision is checked before anything is written.
    const odd = add({ title: bidi });
    verdicts({ id: odd, verdict: 'keep', why: 'fine' });
    const r = judge(odd);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/what/);
    expect([loadProposal(root, id)?.status, loadProposal(root, odd)?.status, loadApproval(root, id), loadApproval(root, odd)]).toEqual(['proposed', 'proposed', null, null]);
    expect([decisions(), judged()]).toEqual([[], []]);
    // Positive control: the same proposal with a why that keeps some text is approved, its decision recorded with that text.
    verdicts({ id, verdict: 'keep', why: `fine ${bidi}` });
    expect(outcome(id)).toBe('approved');
    expect(decisions()).toMatchObject([{ point: 'approve', why: 'fine' }]);
    expect(judged()).toHaveLength(1);
  });
  it('the verdict must be of the text the proposal has now, a v2\'s included', () => {
    // The hand-written chat add event carries no digest (`add --from-chat` logs one), so here the verdict's digest is the one
    // that catches the edited text.
    const id = add({ title: 'Ghost replays', source: 'user' });
    fromChat(id);
    verdicts({ id, verdict: 'keep', why: 'fun' });
    saveProposal(root, id, { ...loadProposal(root, id)!, rationale: 'changed after the critic read it' });
    expect(judge(id).code).toBe(2);
    const orig = add({ title: 'Big shop' });
    const v2 = add({ title: 'Cosmetic shop' }, ['--revises', orig]);
    const doc = loadProposal(root, v2)!;
    writeFileSync(path.join(root, 'v.json'), JSON.stringify({ verdicts: [{ id: v2, digest: proposalDigest(v2, { ...doc, evidence: 'other' }), verdict: 'keep', why: 'x' }] }));
    expect(judge(v2).code).toBe(2);
    expect([loadProposal(root, id)?.status, loadProposal(root, v2)?.status, loadProposal(root, orig)?.status]).toEqual(['proposed', 'proposed', 'proposed']);
    expect([decisions(), judged()]).toEqual([[], []]);
    // Positive control: verdicts of the texts they have now are judged.
    verdicts({ id, verdict: 'keep', why: 'fun' }, { id: v2, verdict: 'keep', why: 'small' });
    expect([outcome(id), outcome(v2)]).toEqual(['approved', 'approved']);
  });
  it('refuses a parked proposal and one with the owner\'s mark; each is judged once that fact is gone', () => {
    const idea = add({ title: 'Online mode', source: 'user' });
    fromChat(idea);
    verdicts({ id: idea, verdict: 'clash', why: 'the vision is a solo game', loses: 'the focus on solo play' });
    expect(outcome(idea)).toBe('parked');
    expect(judge(idea).code).toBe(2);
    // Positive control: an idea under discussion that is not parked is judged.
    const talk = add({ title: 'Ghost replays', source: 'user' });
    fromChat(talk);
    run(['proposals', 'decide', talk, 'discuss'], io());
    verdicts({ id: talk, verdict: 'keep', why: 'fun' });
    expect(outcome(talk)).toBe('approved');
    const marked = add({ title: 'Combo meter' });
    run(['proposals', 'decide', marked, 'approve'], io());
    saveProposal(root, marked, { ...loadProposal(root, marked)!, status: 'proposed' });
    verdicts({ id: marked, verdict: 'drop', why: 'no' });
    expect(judge(marked).code).toBe(2);
    expect(loadApproval(root, marked)?.status).toBe('approved');
    // Positive control: without the mark it is judged.
    removeApproval(root, marked);
    expect(outcome(marked)).toBe('rejected');
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
    // Positive control: a proposal forge added, unedited, is approved.
    const fine = add({ title: 'Ghost replays' });
    verdicts({ id: fine, verdict: 'keep', why: 'fine' });
    expect(outcome(fine)).toBe('approved');
  });
  it('a new proposal never comes parked: only a judge parks', () => {
    const id = add({ title: 'Online mode', source: 'user', parked: { why: 'w', loses: 'l', at: T0.toISOString() } });
    expect(loadProposal(root, id)).not.toHaveProperty('parked');
    expect(stopContext(root, T0).pendingProposals).toBe(1);
  });
});

describe('a v2 keeps its original\'s standing (I-2)', () => {
  it('a v2 of a parked idea waits with it: parked, and nothing written (P3)', () => {
    const idea = add({ title: 'Online mode', source: 'user' });
    fromChat(idea);
    verdicts({ id: idea, verdict: 'clash', why: 'the vision is a solo game', loses: 'the focus on solo play' });
    expect(outcome(idea)).toBe('parked');
    const before = [decisions().length, judged().length];
    const v2 = add({ title: 'Local versus mode', source: 'user' }, ['--revises', idea]);
    verdicts({ id: v2, verdict: 'keep', why: 'fits the vision' });
    expect(JSON.parse(judge(v2).stdout)).toMatchObject({ outcome: 'parked', write: null, approval: null });
    expect([loadProposal(root, v2)?.status, loadApproval(root, v2), loadProposal(root, idea)?.status, !!loadProposal(root, idea)?.parked])
      .toEqual(['proposed', null, 'discussing', true]);
    expect([decisions().length, judged().length]).toEqual(before);
    // Positive control: the v2 of an idea that is not parked, kept, is approved and replaces it.
    const open = add({ title: 'Ghost replays', source: 'user' });
    fromChat(open);
    const w2 = add({ title: 'Ghost races', source: 'user' }, ['--revises', open]);
    verdicts({ id: w2, verdict: 'keep', why: 'fits' });
    expect(JSON.parse(judge(w2).stdout)).toMatchObject({ outcome: 'approved', original: { id: open } });
  });
  it('a v2 of an original that waits for the owner waits too, and the original is left as it is (P4, P4c)', () => {
    const note = add({ title: 'Dark theme', source: 'user' });
    appendEvent(root, { ts: T0.toISOString(), kind: 'proposal', action: 'add', id: note, from: 'note:n1', owner: false });
    const v2 = add({ title: 'Dark menu', source: 'user' }, ['--revises', note]);
    const pulled = 'p20261022090000zzzz';
    saveProposal(root, pulled, { ts: 't', category: 'feature', risk: 'low', title: 'Pulled idea', rationale: 'r', evidence: '', pillar: '', status: 'proposed', source: 'scout', author: 'user:x' });
    const w3 = add({ title: 'Smaller pulled idea' }, ['--revises', pulled]);
    verdicts({ id: v2, verdict: 'keep', why: 'fine' }, { id: w3, verdict: 'keep', why: 'fine' });
    for (const [v, o] of [[v2, note], [w3, pulled]]) {
      expect(JSON.parse(judge(v).stdout), v).toMatchObject({ outcome: 'waits-owner', write: null, approval: null });
      expect([loadProposal(root, v)?.status, loadProposal(root, o)?.status, loadApproval(root, o)], v).toEqual(['proposed', 'proposed', null]);
    }
    expect([decisions(), judged()]).toEqual([[], []]);
    // Positive control: the owner's own note idea lets its v2 through, and the v2 replaces it.
    const mine = add({ title: 'Light theme', source: 'user' });
    appendEvent(root, { ts: T0.toISOString(), kind: 'proposal', action: 'add', id: mine, from: 'note:n2', owner: true });
    const m2 = add({ title: 'Light menu', source: 'user' }, ['--revises', mine]);
    verdicts({ id: m2, verdict: 'keep', why: 'fine' });
    expect(JSON.parse(judge(m2).stdout)).toMatchObject({ outcome: 'approved', original: { id: mine } });
  });
  it('a v2 of an original the owner decided since, or that is gone, waits for the owner', () => {
    const orig = add({ title: 'Big shop' });
    const v2 = add({ title: 'Cosmetic shop' }, ['--revises', orig]);
    run(['proposals', 'decide', orig, 'reject'], io());
    const gone = add({ title: 'Combo meter' });
    const g2 = add({ title: 'Combo counter' }, ['--revises', gone]);
    rmSync(path.join(root, '.forge', 'proposals', `${gone}.json`));
    verdicts({ id: v2, verdict: 'keep', why: 'fine' }, { id: g2, verdict: 'keep', why: 'fine' });
    expect([outcome(v2), outcome(g2)]).toEqual(['waits-owner', 'waits-owner']);
    expect([loadProposal(root, v2)?.status, loadProposal(root, orig)?.status, loadApproval(root, orig)?.status]).toEqual(['proposed', 'rejected', 'rejected']);
    // Positive control: with the original open again and no mark, the same v2 is approved and replaces it.
    removeApproval(root, orig);
    saveProposal(root, orig, { ...loadProposal(root, orig)!, status: 'proposed' });
    expect(JSON.parse(judge(v2).stdout)).toMatchObject({ outcome: 'approved', original: { id: orig } });
  });
  it('add --revises takes any proposal, as the attended flow does, and judge alone keeps the v2 to its original\'s standing (T6B2-REVISES-REVERT)', () => {
    const done = add({ title: 'Combo meter' });
    run(['proposals', 'decide', done, 'reject'], io());
    const ofDecided = add({ title: 'Cosmetic shop' }, ['--revises', done]);
    const ofMissing = add({ title: 'Ghost replays' }, ['--revises', 'p20261022090000zzzz']);
    verdicts({ id: ofDecided, verdict: 'keep', why: 'fine' }, { id: ofMissing, verdict: 'keep', why: 'fine' });
    expect([outcome(ofDecided), outcome(ofMissing)]).toEqual(['waits-owner', 'waits-owner']);
    expect([loadProposal(root, ofDecided)?.status, loadProposal(root, ofMissing)?.status, decisions()]).toEqual(['proposed', 'proposed', []]);
  });
  it('a v2 the critic drops takes its adapted original with it: rejected, with its reason and mark, the decision first (T6B2-PENDING-V2)', () => {
    const orig = add({ title: 'Big shop' });
    verdicts({ id: orig, verdict: 'adapt', why: 'too big', changes: 'only cosmetic items' });
    expect(outcome(orig)).toBe('adapt');
    const v2 = add({ title: 'Cosmetic shop', rationale: `r (v2 of ${orig})` }, ['--revises', orig]);
    verdicts({ id: v2, verdict: 'drop', why: 'still moves nothing for the player' });
    expect(JSON.parse(judge(v2).stdout)).toMatchObject({
      outcome: 'rejected', write: { status: 'rejected', reason: 'still moves nothing for the player' },
      original: { id: orig, write: { status: 'rejected', reason: 'its v2 was dropped' }, approval: { doc_id: orig, data: { status: 'rejected', by: 'forge:auto' } } },
    });
    expect([loadProposal(root, orig)?.status, loadProposal(root, orig)?.reason, loadApproval(root, orig)?.status]).toEqual(['rejected', 'its v2 was dropped', 'rejected']);
    expect(decisions()).toHaveLength(1);
    expect(judged().map(e => [e.id, e.status])).toEqual([[v2, 'rejected'], [orig, 'rejected']]);
    // In Spanish, the original's reason too.
    autonomousRun(root, 'es');
    const o2 = add({ title: 'Ranking global' });
    const w2 = add({ title: 'Ranking semanal', rationale: `r (v2 of ${o2})` }, ['--revises', o2]);
    verdicts({ id: w2, verdict: 'drop', why: 'no aporta' });
    expect(JSON.parse(judge(w2).stdout).original).toMatchObject({ id: o2, write: { reason: 'su v2 se descartó' } });
  });
  it('--pending leaves out an original while its v2 is open, and what judge answers without the verdict (T6B2-PENDING-V2, N3)', () => {
    const pending = () => JSON.parse(run(['proposals', 'batch', '--pending', '--out', 'b.json'], io()).stdout).ids as string[];
    const orig = add({ title: 'Big shop' });
    const v2 = add({ title: 'Cosmetic shop', rationale: `r (v2 of ${orig})` }, ['--revises', orig]);
    // no add event in this ledger (pulled from the roadmap), and a text edited since forge added it: both wait for the owner
    const pulled = 'p20261022090000pull';
    saveProposal(root, pulled, { ...loadProposal(root, orig)!, title: 'Pulled one', rationale: 'from the page' });
    const edited = add({ title: 'Combo meter' });
    saveProposal(root, edited, { ...loadProposal(root, edited)!, title: 'Combo meter, edited on the page' });
    // a v2 of a parked idea waits with it
    const idea = add({ title: 'Online mode', source: 'user' });
    fromChat(idea);
    verdicts({ id: idea, verdict: 'clash', why: 'the vision is a solo game', loses: 'the focus on solo play' });
    expect(outcome(idea)).toBe('parked');
    const ofParked = add({ title: 'Local co-op', rationale: `r (v2 of ${idea})`, source: 'user' }, ['--revises', idea]);
    const free = add({ title: 'Daily challenge' });
    expect(pending().sort()).toEqual([v2, free].sort());
    expect(pending()).not.toContain(ofParked);
    // Once the v2 is decided, the original is no longer held by it.
    verdicts({ id: v2, verdict: 'keep', why: 'small and fun' });
    expect(outcome(v2)).toBe('approved');
    expect(pending()).toEqual([free]);
  });
  it('the whole revises chain is held: --pending leaves out every proposal with an open descendant, and a v3 decided rejects every open ancestor with it, the decision first (final fix, M2)', () => {
    const pending = () => JSON.parse(run(['proposals', 'batch', '--pending', '--out', 'b.json'], io()).stdout).ids as string[];
    // An adapt of an adapt: O ← v2 ← v3, all three open.
    const o = add({ title: 'Big shop' });
    const v2 = add({ title: 'Cosmetic shop', rationale: `r (v2 of ${o})` }, ['--revises', o]);
    const v3 = add({ title: 'Hat stand', rationale: `r (v2 of ${v2})` }, ['--revises', v2]);
    expect(pending()).toEqual([v3]);
    verdicts({ id: v3, verdict: 'keep', why: 'small and fun' });
    expect(JSON.parse(judge(v3).stdout)).toMatchObject({
      outcome: 'approved',
      original: { id: v2, write: { status: 'rejected', reason: `replaced by ${v3}` }, approval: { doc_id: v2, data: { status: 'rejected', by: 'forge:auto' } } },
      ancestors: [{ id: o, write: { status: 'rejected', reason: `replaced by ${v3}` }, approval: { doc_id: o, data: { status: 'rejected', by: 'forge:auto' } } }],
    });
    expect([o, v2, v3].map(id => [loadProposal(root, id)?.status, loadApproval(root, id)?.status]))
      .toEqual([['rejected', 'rejected'], ['rejected', 'rejected'], ['auto_approved', 'auto_approved']]);
    // The review's M2: O is not batched again beside the approved v3.
    expect(pending()).toEqual([]);
    expect(decisions()).toHaveLength(1);
    expect(judged().map(e => [e.id, e.status])).toEqual([[v3, 'auto_approved'], [v2, 'rejected'], [o, 'rejected']]);
    // A v3 the critic drops takes its v2 and their original with it.
    const p = add({ title: 'Global ranking' });
    const p2 = add({ title: 'Weekly ranking', rationale: `r (v2 of ${p})` }, ['--revises', p]);
    const p3 = add({ title: 'Friends table', rationale: `r (v2 of ${p2})` }, ['--revises', p2]);
    expect(pending()).toEqual([p3]);
    verdicts({ id: p3, verdict: 'drop', why: 'still moves nothing for the player' });
    expect(JSON.parse(judge(p3).stdout)).toMatchObject({
      outcome: 'rejected', original: { id: p2, write: { reason: 'its v2 was dropped' } }, ancestors: [{ id: p, write: { status: 'rejected', reason: 'its v2 was dropped' } }],
    });
    expect([p, p2, p3].map(id => loadApproval(root, id)?.status)).toEqual(['rejected', 'rejected', 'rejected']);
    expect(pending()).toEqual([]);
    expect(decisions()).toHaveLength(2);
    // Positive control: a v2 with no earlier version prints no ancestors.
    const q = add({ title: 'Daily quest' });
    const q2 = add({ title: 'Weekly quest', rationale: `r (v2 of ${q})` }, ['--revises', q]);
    verdicts({ id: q2, verdict: 'keep', why: 'fine' });
    expect(JSON.parse(judge(q2).stdout)).not.toHaveProperty('ancestors');
  });
  it('a v3 keeps the standing of its whole chain: one of a v2 whose original waits for the owner waits too, and --pending leaves it out (final fix, M2)', () => {
    const pending = () => JSON.parse(run(['proposals', 'batch', '--pending', '--out', 'b.json'], io()).stdout).ids as string[];
    const pulled = 'p20261022090000pull';
    saveProposal(root, pulled, { ts: 't', category: 'feature', risk: 'low', title: 'Pulled idea', rationale: 'r', evidence: '', pillar: '', status: 'proposed', source: 'scout', author: 'user:x' });
    const w2 = add({ title: 'Smaller pulled idea', rationale: `r (v2 of ${pulled})` }, ['--revises', pulled]);
    const w3 = add({ title: 'Tiny one', rationale: `r (v2 of ${w2})` }, ['--revises', w2]);
    expect(pending()).toEqual([]);
    verdicts({ id: w3, verdict: 'keep', why: 'fine' });
    expect(JSON.parse(judge(w3).stdout)).toMatchObject({ outcome: 'waits-owner', write: null, approval: null });
    expect([pulled, w2, w3].map(id => [loadProposal(root, id)?.status, loadApproval(root, id)])).toEqual([['proposed', null], ['proposed', null], ['proposed', null]]);
    expect([decisions(), judged()]).toEqual([[], []]);
    // And a v3 of a v2 of a parked idea waits with it, parked.
    const idea = add({ title: 'Online mode', source: 'user' });
    fromChat(idea);
    verdicts({ id: idea, verdict: 'clash', why: 'the vision is a solo game', loses: 'the focus on solo play' });
    expect(outcome(idea)).toBe('parked');
    const i2 = add({ title: 'Local versus mode', source: 'user' }, ['--revises', idea]);
    const i3 = add({ title: 'Split screen duel', source: 'user' }, ['--revises', i2]);
    verdicts({ id: i3, verdict: 'keep', why: 'fits the vision' });
    expect(JSON.parse(judge(i3).stdout)).toMatchObject({ outcome: 'parked', write: null, approval: null });
    // Positive control: with the pulled original added by this checkout (its add event), the same chain is judged.
    appendEvent(root, { ts: T0.toISOString(), kind: 'proposal', action: 'add', id: pulled, digest: proposalDigest(pulled, loadProposal(root, pulled)!) });
    expect(pending()).toEqual([w3]);
    verdicts({ id: w3, verdict: 'keep', why: 'fine' });
    expect(JSON.parse(judge(w3).stdout)).toMatchObject({ outcome: 'approved', original: { id: w2 }, ancestors: [{ id: pulled }] });
  });
  it("a v2 from someone's comment on forge's proposal, added as source: user with the comment's author, waits for the owner (T6B2-COMMENT-V2)", () => {
    const orig = add({ title: 'Big shop' });
    writeFileSync(path.join(root, 'v2.json'), JSON.stringify({ category: 'feature', risk: 'high', title: 'Cosmetic shop', rationale: `r (v2 of ${orig})`, evidence: 'e', pillar: 'Juice', source: 'user' }));
    const v2 = JSON.parse(run(['proposals', 'add', '--file', 'v2.json', '--revises', orig, '--author', 'user:editor'], io()).stdout).id as string;
    expect(loadProposal(root, v2)).toMatchObject({ source: 'user', author: 'user:editor' });
    // --pending leaves it out, and its original too while it is open (T6B2-PENDING-V2); judge, given a keep, says it waits.
    expect(JSON.parse(run(['proposals', 'batch', '--pending', '--out', 'b.json'], io()).stdout).ids).toEqual([]);
    verdicts({ id: v2, verdict: 'keep', why: 'small and fun' });
    expect(JSON.parse(judge(v2).stdout)).toMatchObject({ outcome: 'waits-owner', write: null, approval: null });
    expect([loadProposal(root, v2)?.status, loadProposal(root, orig)?.status, decisions()]).toEqual(['proposed', 'proposed', []]);
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
  it('judges only inside the run\'s worktree, and names it (m-1)', () => {
    const wt = path.join(root, 'wt');
    autonomousRun(wt);
    const id = add({ title: 'Combo meter' });
    verdicts({ id, verdict: 'keep', why: 'fine' });
    const r = judge(id);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(wt);
    expect([loadProposal(root, id)?.status, decisions()]).toEqual(['proposed', []]);
    // Positive control: with root as the run's worktree, the same call is judged.
    autonomousRun();
    expect(outcome(id)).toBe('approved');
  });
  it('a judge and an unpark are the latest decision, so a judged approval becomes a task (M-2)', () => {
    const id = add({ title: 'Combo meter', path: 'src/combo.ts' });
    // 6b-3: in a product run the task goes where the keep placed it, and to-task reads the state listing (B-1, M-11).
    verdicts({ id, verdict: 'keep', why: 'it rewards skill', placement: { phase: 'F1', doneWhen: 'a chain of three hits doubles the score', dependsOn: [], estimate: '1h' } });
    expect(judge(id).code).toBe(0);
    expect(lastDecisions(root)[id]).toEqual({ status: 'auto_approved', ts: T0.toISOString() });
    writeFileSync(path.join(root, 'plan.yaml'), PLAN);
    mkdirSync(path.join(root, 'db', 'state'), { recursive: true });
    const r = run(['proposals', 'to-task', id, '--plan', 'plan.yaml', '--db', 'db'], io());
    expect(r.code, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ id, taskId: 'T002' });
    appendEvent(root, { ts: '2026-10-22T11:00:00.000Z', kind: 'proposal', action: 'unpark', id: 'p20261022090000zzzz', status: 'approved' });
    expect(lastDecisions(root).p20261022090000zzzz).toEqual({ status: 'approved', ts: '2026-10-22T11:00:00.000Z' });
  });
  it('speaks the run\'s language: each outcome and its alternative in Spanish (L-13)', () => {
    autonomousRun(root, 'es');
    expect(parseRun(readRunText(root))?.locale).toBe('es');
    const decision = (r: { stdout: string }) => JSON.parse(r.stdout).publish[0].data.decision;
    const keep = add({ title: 'Online leaderboard' });
    const drop = add({ title: 'Rename variables' });
    const idea = add({ title: 'Online mode', source: 'user' });
    fromChat(idea);
    const orig = add({ title: 'Big shop' });
    verdicts({ id: keep, verdict: 'keep', why: 'a' }, { id: drop, verdict: 'drop', why: 'b' }, { id: idea, verdict: 'clash', why: 'c', loses: 'd' });
    expect(decision(judge(keep, ['--session', 'main']))).toMatchObject({ chosen: 'aprobarla', alternatives: [{ option: 'rechazarla', whyNot: 'a' }] });
    expect(decision(judge(drop, ['--session', 'main']))).toMatchObject({ chosen: 'rechazarla', alternatives: [{ option: 'aprobarla', whyNot: 'b' }] });
    expect(decision(judge(idea, ['--session', 'main']))).toMatchObject({ point: 'idea', chosen: 'aparcarla', alternatives: [{ option: 'integrarla', whyNot: 'c', tradeoffs: 'd' }] });
    const v2 = add({ title: 'Cosmetic shop' }, ['--revises', orig]);
    verdicts({ id: v2, verdict: 'keep', why: 'e' });
    expect(JSON.parse(judge(v2).stdout)).toMatchObject({ outcome: 'approved', original: { id: orig, write: { status: 'rejected', reason: `sustituida por ${v2}` } } });
  });
});

describe('a keep places its task, and to-task takes that placement (6b-3, B-1)', () => {
  const PLAN = '# keep me\nproject: demo\nlocale: en\nversion: "0.1"\nversions:\n  - id: "0.1"\n    phases: [F1, F2]\ntracks:\n  - { id: backend, name: Backend, color: blue }\n'
    + 'phases:\n  - { id: F1, name: Base, plan_status: committed }\n  - { id: F2, name: Polish, plan_status: committed }\n'
    + 'tasks:\n  - { id: T001, title: a, track: backend, phase: F1, done_when: x }\n';
  const placement = { phase: 'F2', doneWhen: 'the combo meter doubles the score in the match test', dependsOn: ['T001'], estimate: '45m' };
  const planText = () => readFileSync(path.join(root, 'plan.yaml'), 'utf8');
  const lastTask = () => parsePlan(planText()).tasks.at(-1);
  const toTask = (id: string, extra: string[] = []) => run(['proposals', 'to-task', id, '--plan', 'plan.yaml', '--db', 'db', ...extra], io());
  const flags = (phase: string, estimate = '2h') => ['--phase', phase, '--done-when-file', 'dw.txt', '--estimate', estimate];
  beforeEach(() => {
    writeFileSync(path.join(root, 'plan.yaml'), PLAN);
    writeFileSync(path.join(root, 'dw.txt'), 'a ghost run replays the best lap in the race test');
    mkdirSync(path.join(root, 'db', 'state'), { recursive: true });
  });
  it('judge writes a keep\'s placement into its judge event and prints it; to-task takes it, and the flags override it', () => {
    const id = add({ title: 'Combo meter' });
    verdicts({ id, verdict: 'keep', why: 'it rewards skill', placement });
    expect(JSON.parse(judge(id).stdout)).toMatchObject({ outcome: 'approved', placement });
    expect(judged().at(-1)).toMatchObject({ id, status: 'auto_approved', placement });
    const r = toTask(id);
    expect(r.code, r.stderr).toBe(0);
    expect(lastTask()).toMatchObject({ phase: 'F2', done_when: placement.doneWhen, depends_on: ['T001'], estimate_min: 45 });
    const other = add({ title: 'Ghost replays' });
    verdicts({ id: other, verdict: 'keep', why: 'fun to race', placement });
    expect(judge(other).code).toBe(0);
    expect(toTask(other, flags('F1')).code).toBe(0);
    expect(lastTask()).toMatchObject({ phase: 'F1', done_when: 'a ghost run replays the best lap in the race test', depends_on: [], estimate_min: 120 });
  });
  it('only a keep logs a placement: a drop logs none (L-4)', () => {
    const id = add({ title: 'Rename variables' });
    verdicts({ id, verdict: 'drop', why: 'moves nothing for the player', placement });
    expect(JSON.parse(judge(id).stdout)).not.toHaveProperty('placement');
    expect(judged().at(-1)).not.toHaveProperty('placement');
  });
  it('an approval without a verdict placement, or with one the plan no longer takes, is placed by the session through the flags, and the CLI checks it', () => {
    const id = add({ title: 'Combo meter' });
    verdicts({ id, verdict: 'keep', why: 'it rewards skill' });
    expect(JSON.parse(judge(id).stdout)).not.toHaveProperty('placement');
    expect(judged().at(-1)).not.toHaveProperty('placement');
    const none = toTask(id);
    expect(none.code).toBe(2);
    expect(none.stderr).toContain('--phase');
    // The verdict placed it in F1, whose only task is done by now.
    const late = add({ title: 'Ghost replays' });
    verdicts({ id: late, verdict: 'keep', why: 'fun to race', placement: { ...placement, phase: 'F1', dependsOn: [] } });
    expect(judge(late).code).toBe(0);
    writeFileSync(path.join(root, 'db', 'state', 'T001.json'), JSON.stringify({ status: 'done' }));
    const stale = toTask(late);
    expect(stale.code).toBe(2);
    expect(stale.stderr).toContain('F1');
    // The session's own placement is checked too: the improvements phase and a done phase are refused (L-6).
    expect(toTask(late, flags('PX')).code).toBe(2);
    expect(toTask(late, flags('F1')).code).toBe(2);
    expect(planText()).toBe(PLAN);
    expect([loadProposal(root, id)?.taskId, loadProposal(root, late)?.taskId]).toEqual([undefined, undefined]);
    expect(toTask(late, flags('F2')).code).toBe(0);
    expect(toTask(id, flags('F2', '30m')).code).toBe(0);
    expect(parsePlan(planText()).tasks.map(t => [t.id, t.phase, t.estimate_min])).toEqual([['T001', 'F1', undefined], ['T002', 'F2', 120], ['T003', 'F2', 30]]);
  });
  // Final fix F-I1 (probe P-LASTPHASE): after the last phase closes, nothing can be placed until a re-plan adds a phase.
  it('once every phase with tasks is done and none is empty, to-task says that no phase of the plan is open, with or without flags', () => {
    const closed = PLAN + '  - { id: T002, title: b, track: backend, phase: F2, done_when: y }\n';
    writeFileSync(path.join(root, 'plan.yaml'), closed);
    for (const t of ['T001', 'T002']) writeFileSync(path.join(root, 'db', 'state', `${t}.json`), JSON.stringify({ status: 'done' }));
    const id = add({ title: 'Combo meter' });
    verdicts({ id, verdict: 'keep', why: 'it rewards skill', placement });
    expect(outcome(id)).toBe('approved');
    for (const extra of [[], flags('F1'), flags('F2'), flags('PX')]) {
      const r = toTask(id, extra);
      expect(r.code, extra.join(' ')).toBe(2);
      expect(r.stderr, extra.join(' ')).toContain('no phase of the plan is open');
    }
    expect(planText()).toBe(closed);
    expect(loadProposal(root, id)?.taskId).toBeUndefined();
    // Positive control: once a re-plan adds a phase, the keep's done phase is refused as before, and the new phase takes it.
    const opened = closed.replace('  - { id: F2, name: Polish, plan_status: committed }\n', '  - { id: F2, name: Polish, plan_status: committed }\n  - { id: F3, name: Next, plan_status: committed }\n');
    writeFileSync(path.join(root, 'plan.yaml'), opened);
    const keep = toTask(id);
    expect(keep.code).toBe(2);
    expect(keep.stderr).toContain('phase F2 is done');
    expect(keep.stderr).not.toContain('no phase of the plan is open');
    expect(toTask(id, flags('F3')).code).toBe(0);
    expect(lastTask()).toMatchObject({ phase: 'F3' });
  });
  // Final fix T2-b: the keep's placement counts only for the text the critic judged (its event's digest).
  it('to-task takes a judge event\'s placement only while the event\'s digest is the proposal\'s present one', () => {
    const id = add({ title: 'Combo meter' });
    verdicts({ id, verdict: 'keep', why: 'it rewards skill' });
    expect(outcome(id)).toBe('approved');
    const event = (digest: string) => appendEvent(root, { ts: T0.toISOString(), kind: 'proposal', action: 'judge', id, status: 'auto_approved', verdict: 'keep', digest, placement });
    event('a'.repeat(64));
    const other = toTask(id);
    expect(other.code).toBe(2);
    expect(other.stderr).toContain('--phase');
    expect(planText()).toBe(PLAN);
    event(proposalDigest(id, loadProposal(root, id)!));
    const r = toTask(id);
    expect(r.code, r.stderr).toBe(0);
    expect(lastTask()).toMatchObject({ phase: 'F2', done_when: placement.doneWhen, depends_on: ['T001'], estimate_min: 45 });
  });
  // Final fix T2-c: the Task 2 review's probe paths (P1, P2, P4), as tests.
  it('an idea the person insisted on needs the session\'s placement in a product run, and takes it (P1)', () => {
    const id = 'p20261022100000aaaa';
    saveProposal(root, id, { ts: T0.toISOString(), category: 'feature', risk: 'high', title: 'Online mode', rationale: 'r', evidence: 'e', pillar: '',
      status: 'discussing', source: 'user', author: 'user:u1', parked: { why: 'solo game', loses: 'solo focus', at: T0.toISOString() } });
    const u = run(['proposals', 'unpark', id, '--insist', '--from-chat'], io());
    expect(u.code, u.stderr).toBe(0);
    const none = toTask(id);
    expect(none.code).toBe(2);
    expect(none.stderr).toContain('--phase');
    const placed = toTask(id, flags('F2', '45m'));
    expect(placed.code, placed.stderr).toBe(0);
    expect(lastTask()).toMatchObject({ phase: 'F2', done_when: 'a ghost run replays the best lap in the race test', estimate_min: 45, depends_on: [] });
  });
  it('a v2\'s own keep places it with no flags, and the v1 it replaced takes no task (P2)', () => {
    const v1 = add({ title: 'Big shop' });
    verdicts({ id: v1, verdict: 'adapt', why: 'too big', changes: 'only cosmetic items' });
    expect(outcome(v1)).toBe('adapt');
    const v2 = add({ title: 'Cosmetic shop', rationale: 'only cosmetic items' }, ['--revises', v1]);
    const own = { phase: 'F2', doneWhen: 'the shop sells a hat in the store test', dependsOn: ['T001'], estimate: '2h' };
    verdicts({ id: v2, verdict: 'keep', why: 'fits', placement: own });
    expect(JSON.parse(judge(v2).stdout)).toMatchObject({ outcome: 'approved', placement: own, original: { id: v1 } });
    const r = toTask(v2);
    expect(r.code, r.stderr).toBe(0);
    expect(lastTask()).toMatchObject({ phase: 'F2', done_when: own.doneWhen, depends_on: ['T001'], estimate_min: 120 });
    expect(toTask(v1).code).toBe(2);
  });
  it('a placement edited in the ledger places nothing: the session must place it (P4)', () => {
    const id = add({ title: 'Combo meter' });
    verdicts({ id, verdict: 'keep', why: 'it rewards skill' });
    expect(outcome(id)).toBe('approved');
    appendEvent(root, { ts: T0.toISOString(), kind: 'proposal', action: 'judge', id, status: 'auto_approved', verdict: 'keep',
      digest: proposalDigest(id, loadProposal(root, id)!), placement: { ...placement, phase: '../F2' } });
    const r = toTask(id);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('--phase');
    expect(planText()).toBe(PLAN);
  });
});

describe('the adapt chain ends (6b-3, H-3)', () => {
  it('add --revises exempts the whole revises chain from the open check: a v3 close to its open root is added', () => {
    const shop = (rationale: string) => ({ title: 'Big cosmetic shop', rationale });
    const o = add(shop('sell hats and skins in a shop'));
    const v2 = add(shop('sell hats and skins in a small shop'), ['--revises', o]);
    writeFileSync(path.join(root, 'p.json'), JSON.stringify({ category: 'feature', risk: 'high', evidence: 'e', pillar: 'Juice', source: 'scout', ...shop('sell hats and skins in a tiny shop') }));
    // Not a version of that chain, it is like an open proposal.
    expect(run(['proposals', 'add', '--file', 'p.json'], io()).code).toBe(3);
    const v3 = run(['proposals', 'add', '--file', 'p.json', '--revises', v2], io());
    expect(v3.code, v3.stderr).toBe(0);
    expect(readEvents(root).filter(e => e.action === 'add').at(-1)).toMatchObject({ id: JSON.parse(v3.stdout).id, revises: v2 });
  });
  it('a chain gets at most two adapts: the critic\'s adapt of a v3 is judged as drop, and rejects the chain with it, the decision first', () => {
    const o = add({ title: 'Big shop' });
    verdicts({ id: o, verdict: 'adapt', why: 'too big', changes: 'only cosmetic items' });
    expect(outcome(o)).toBe('adapt');
    const v2 = add({ title: 'Cosmetic shop', rationale: `r (v2 of ${o})` }, ['--revises', o]);
    verdicts({ id: v2, verdict: 'adapt', why: 'still too big', changes: 'only hats' });
    // Positive control: the second adapt of the chain is still an adapt.
    expect(outcome(v2)).toBe('adapt');
    const v3 = add({ title: 'Hat stand', rationale: `r (v2 of ${v2})` }, ['--revises', v2]);
    verdicts({ id: v3, verdict: 'adapt', why: 'hats need a menu first', changes: 'a menu' });
    const r = JSON.parse(judge(v3).stdout);
    expect(r).toMatchObject({
      outcome: 'rejected', write: { status: 'rejected' }, original: { id: v2, write: { status: 'rejected' } }, ancestors: [{ id: o, write: { status: 'rejected' } }],
    });
    expect(r.write.reason).toContain('hats need a menu first');
    expect(r).not.toHaveProperty('changes');
    expect([o, v2, v3].map(id => [loadProposal(root, id)?.status, loadApproval(root, id)?.status]))
      .toEqual([['rejected', 'rejected'], ['rejected', 'rejected'], ['rejected', 'rejected']]);
    expect(decisions()).toMatchObject([{ point: 'approve', what: 'Hat stand', chosen: 'reject it' }]);
    expect(judged().map(e => [e.id, e.status, e.verdict])).toEqual([[v3, 'rejected', 'drop'], [v2, 'rejected', undefined], [o, 'rejected', undefined]]);
    expect(JSON.parse(run(['proposals', 'batch', '--pending', '--out', 'b.json'], io()).stdout).ids).toEqual([]);
  });
  // Final fix T2-c (probe P3): the exemption of --revises is its own chain's, never another open proposal's.
  it('--revises exempts its own chain only: a v2 close to an unrelated open proposal is still refused, naming it', () => {
    const other = add({ title: 'Big cosmetic shop', rationale: 'sell hats and skins in a shop' });
    const root1 = add({ title: 'Online leaderboard', rationale: 'players compare scores' });
    writeFileSync(path.join(root, 'p.json'), JSON.stringify({ category: 'feature', risk: 'high', title: 'Big cosmetic shop', rationale: 'sell hats and skins in a shop', evidence: 'e', pillar: 'Juice', source: 'scout' }));
    const r = run(['proposals', 'add', '--file', 'p.json', '--revises', root1], io());
    expect(r.code).toBe(3);
    expect(r.stderr).toContain(other);
  });
  // Final fix F-I2 (probe P-ADAPT-WEDGE): an adapt whose v2 could not be added no longer comes back every cycle.
  const pending = () => JSON.parse(run(['proposals', 'batch', '--pending', '--out', 'b.json'], io()).stdout).ids as string[];
  const adapts = () => readEvents(root).filter(e => e.kind === 'proposal' && e.action === 'adapt');
  /** The cycle ends (`FORGE cycle`): the next judge is of a later cycle, by a fresh critic. */
  const nextCycle = () => expect(run(['cycle', '--progress', 'no'], io()).code).toBe(0);
  it('an adapt is logged and changes nothing; adapted again in a later cycle with no v2 added since, the same text is dropped, the decision first, and nothing passed', () => {
    const orig = add({ title: 'Big shop with many items' });
    // A proposal rejected earlier says what the v2 will say, with the same evidence: the v2's add is refused (exit 3).
    const rej = add({ title: 'Cosmetic shop with few items' });
    saveProposal(root, rej, { ...loadProposal(root, rej)!, status: 'rejected', decidedBy: 'forge:auto', decidedAt: T0.toISOString(), reason: 'no' });
    verdicts({ id: orig, verdict: 'adapt', why: 'too big', changes: 'cosmetic only' });
    expect(outcome(orig)).toBe('adapt');
    expect(adapts()).toEqual([{ ts: T0.toISOString(), kind: 'proposal', action: 'adapt', id: orig, digest: proposalDigest(orig, loadProposal(root, orig)!), runCycle: `${T0.toISOString()}#0` }]);
    expect([loadProposal(root, orig)?.status, loadApproval(root, orig), decisions(), judged()]).toEqual(['proposed', null, [], []]);
    writeFileSync(path.join(root, 'p.json'), JSON.stringify({ category: 'feature', risk: 'high', title: 'Cosmetic shop with few items', rationale: 'r', evidence: 'e', pillar: 'Juice', source: 'scout' }));
    expect(run(['proposals', 'add', '--file', 'p.json', '--revises', orig], io()).code).toBe(3);
    // A session that resumes its batch in the same cycle judges the same adapt again: that adapt, logged once, never a drop.
    expect(outcome(orig)).toBe('adapt');
    expect([adapts().length, decisions()]).toEqual([1, []]);
    // The next cycle batches it again, and the critic adapts the same text again: judged as a drop.
    nextCycle();
    expect(pending()).toContain(orig);
    verdicts({ id: orig, verdict: 'adapt', why: 'still too big', changes: 'cosmetic only' });
    const r = JSON.parse(judge(orig).stdout);
    expect(r).toMatchObject({ outcome: 'rejected', write: { status: 'rejected', reason: 'adapted twice; its v2 could not be added' }, approval: { data: { status: 'rejected', by: 'forge:auto' } } });
    expect(r).not.toHaveProperty('changes');
    expect(decisions()).toMatchObject([{ point: 'approve', what: 'Big shop with many items', chosen: 'reject it', why: 'adapted twice; its v2 could not be added' }]);
    expect(judged().map(e => [e.id, e.status, e.verdict])).toEqual([[orig, 'rejected', 'drop']]);
    expect(pending()).not.toContain(orig);
    // The adapt event is no pass of the round.
    expect(explorePassed(root, root, T0.toISOString())).toBe(0);
  });
  it('a second adapt is still an adapt when a v2 was added since the first, or the text changed since; in Spanish the drop says why', () => {
    const o = add({ title: 'Big shop' });
    verdicts({ id: o, verdict: 'adapt', why: 'too big', changes: 'only cosmetic items' });
    expect(outcome(o)).toBe('adapt');
    add({ title: 'Cosmetic shop', rationale: `r (v2 of ${o})` }, ['--revises', o]);
    const e = add({ title: 'Daily quest' });
    verdicts({ id: e, verdict: 'adapt', why: 'too vague', changes: 'one quest a day' });
    expect(outcome(e)).toBe('adapt');
    saveProposal(root, e, { ...loadProposal(root, e)!, rationale: 'rewritten by hand' });
    appendEvent(root, { ts: T0.toISOString(), kind: 'proposal', action: 'add', id: e, digest: proposalDigest(e, loadProposal(root, e)!) });
    nextCycle();
    verdicts({ id: o, verdict: 'adapt', why: 'still too big', changes: 'only hats' }, { id: e, verdict: 'adapt', why: 'still too vague', changes: 'one quest a day' });
    expect([outcome(o), outcome(e)]).toEqual(['adapt', 'adapt']);
    expect(decisions()).toEqual([]);
    autonomousRun(root, 'es');
    const s = add({ title: 'Ranking global' });
    verdicts({ id: s, verdict: 'adapt', why: 'demasiado grande', changes: 'solo amigos' });
    expect(outcome(s)).toBe('adapt');
    nextCycle();
    expect(JSON.parse(judge(s).stdout).write).toMatchObject({ status: 'rejected', reason: 'adaptada dos veces; su v2 no se pudo añadir' });
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
    // m-1: from the main checkout the run's worktree is named, and nothing is judged.
    const fromMain = cli(main, ['proposals', 'judge', id, '--critic', path.join(wt, 'v.json')]);
    expect(fromMain.code).toBe(2);
    expect(fromMain.stderr).toContain(wt);
    const approved = JSON.parse(cli(wt, ['proposals', 'judge', id, '--critic', 'v.json']).stdout);
    const parked = JSON.parse(cli(wt, ['proposals', 'judge', idea, '--critic', 'v.json']).stdout);
    expect([approved.outcome, parked.outcome]).toEqual(['approved', 'parked']);
    expect(loadProposal(wt, id)?.status).toBe('auto_approved');
    expect(loadApproval(wt, id)).toMatchObject({ status: 'auto_approved', by: 'forge:auto' });
    expect([loadProposal(main, id), loadApproval(main, id), loadProposal(main, idea)]).toEqual([null, null, null]);
    const all = readEvents(main).filter(e => e.kind === 'decision');
    expect(all.filter(e => e.point === 'approve' || e.point === 'idea')).toMatchObject([
      { point: 'approve', what: 'Online leaderboard', runId: 'product-g' }, { point: 'idea', what: 'Online mode', runId: 'product-g' },
    ]);
    expect([all.length - 1, all.length]).toEqual([approved.decision, parked.decision]);
    expect(readEvents(wt).filter(e => e.kind === 'decision')).toEqual([]);
    expect(readEvents(wt).filter(e => e.action === 'judge').map(e => [e.id, e.status])).toEqual([[id, 'auto_approved'], [idea, 'discussing']]);
    // stopContext and unownedOf count the worktree's proposals: the parked idea waits apart, the approval has its mark.
    expect(stopContext(main, T0)).toMatchObject({ pendingProposals: 0, approvedPending: 1 });
    expect(unownedOf(main, T0)).toBe(0);
    saveProposal(wt, 'p20261022090000zzzz', { ...loadProposal(wt, id)!, title: 'Approved by hand, no mark', status: 'approved' });
    expect(unownedOf(main, T0)).toBe(1);
  });
});
