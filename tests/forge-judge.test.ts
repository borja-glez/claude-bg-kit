import { describe, it, expect, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { run } from '../src/forge/cli/run.js';
import { startRun, saveRun, parseRun, readRunText } from '../src/forge/run.js';
import { loadProposal, loadApproval, saveProposal, removeApproval } from '../src/forge/proposals.js';
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
