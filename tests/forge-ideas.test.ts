import { describe, it, expect, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { run } from '../src/forge/cli/run.js';
import { startRun, saveRun } from '../src/forge/run.js';
import { readEvents } from '../src/forge/ledger.js';
import { loadProposal, saveProposal, loadApproval } from '../src/forge/proposals.js';
import { proposalDigest } from '../src/lib/proposals.js';
import { lastDecisions } from '../src/forge/cli/shared.js';
import { profileNames } from '../src/forge/profile.js';
import { convertedFrom, roadmapOwner } from '../src/forge/ideas.js';
import { useTempDirs } from './helpers/tmp.js';

const tmp = useTempDirs();
const T0 = new Date('2026-10-22T10:00:00.000Z');
let root: string, db: string;
let n = 0;
const io = () => ({ cwd: root, now: () => T0, env: {}, rand: () => (++n % 36) / 36 });
const cli = (args: string[]) => run(['proposals', ...args], io());
const write = (dir: string, id: string, doc: unknown) => { mkdirSync(path.join(db, dir), { recursive: true }); writeFileSync(path.join(db, dir, `${id}.json`), JSON.stringify(doc)); };
const note = (id: string, o: Record<string, unknown> = {}) => write('notes', id, { ts: T0.toISOString(), type: 'idea', author: 'user:u1', text: 'a combo meter', ...o });
const OWNER = { user: 'user:u1', decidedAt: T0.toISOString() };
const pull = (rules: number, owner: unknown = OWNER) => {
  write('approvals', 'owner', owner);
  write('meta', 'page', { rules });
  return JSON.parse(cli(['pull', '--dir', path.join(db, 'proposals'), '--approvals', path.join(db, 'approvals'), '--page', path.join(db, 'meta', 'page.json'), '--roadmap', 'g']).stdout);
};
const idea = { category: 'feature', risk: 'medium', title: 'Combo meter', rationale: 'chains reward skill', pillar: 'Juice' };
const dark = { ...idea, title: 'Dark theme', rationale: 'easier on the eyes' };
const file = (name: string, doc: unknown) => { writeFileSync(path.join(root, name), JSON.stringify(doc)); return name; };
const added = (args: string[]) => {
  const r = cli(['add', ...args]);
  expect(r.code, r.stderr).toBe(0);
  return JSON.parse(r.stdout).id as string;
};
const lastAdd = (id: string) => readEvents(root).filter(e => e.kind === 'proposal' && e.action === 'add' && e.id === id).at(-1);
// An autonomous run whose worktree is root itself, where `judge` runs (Task 4).
const autonomous = (worktree: string) => ({ profile: 'product' as const, name: 'g', runId: 'product-g', worktree, branch: 'forge/product-g', startBranch: 'main', protectedBranches: ['main'] });
const autonomousRun = (worktree = root, locale = 'en') => saveRun(root, { ...startRun(T0, { hours: 1 }, 10, 'coord-1', locale), autonomous: autonomous(worktree) });
const verdicts = (...v: { id: string; verdict: string; why: string; loses?: string }[]) =>
  file('v.json', { verdicts: v.map(x => ({ ...x, digest: proposalDigest(x.id, loadProposal(root, x.id)!) })) });
const judge = (id: string) => JSON.parse(cli(['judge', id, '--critic', 'v.json']).stdout);
beforeEach(() => {
  root = tmp('ideas-');
  db = path.join(root, '.waypoint', 'g', 'dbcache');
  mkdirSync(path.join(db, 'proposals'), { recursive: true });
  writeFileSync(path.join(root, 'idea.json'), JSON.stringify(idea));
});

describe('the roadmap owner (6b-2)', () => {
  it('pull learns it from approvals/owner only with the owner rule, and forgets it without', () => {
    expect(pull(0).owner).toBeNull();
    expect(roadmapOwner(root)).toBeNull();
    expect(pull(99).owner).toBe('user:u1');
    expect(roadmapOwner(root)).toBe('user:u1');
    expect(pull(1).owner).toBeNull();
    expect(roadmapOwner(root)).toBeNull();
  });
  it('an owner document that is not a user and an ISO time names nobody', () => {
    for (const bad of [{ user: 'session:main', decidedAt: T0.toISOString() }, { user: 'user:u1' }, { user: 'user:a/b', decidedAt: T0.toISOString() },
      { user: 'user:u1', decidedAt: 'yesterday' }, 'user:u1']) {
      expect(pull(99, bad).owner, JSON.stringify(bad)).toBeNull();
      expect(roadmapOwner(root)).toBeNull();
    }
    // Positive control: the page's own document names the owner.
    expect(pull(99).owner).toBe('user:u1');
  });
});

describe('ideas into proposals (6b-2)', () => {
  it('lists the idea notes without a proposal that nobody turned into one, marking the owner\'s', () => {
    pull(99);
    note('n1'); note('n2', { author: 'user:u2', text: 'dark theme' }); note('n3', { proposalId: 'p20261022100000abcd' });
    note('n4', { type: 'question' }); note('n5', { author: 'session:main' });
    expect(JSON.parse(cli(['ideas', '--db', db]).stdout)).toEqual({ owner: 'user:u1', ideas: [
      { note: 'n1', author: 'user:u1', text: 'a combo meter', ts: T0.toISOString(), owner: true },
      { note: 'n2', author: 'user:u2', text: 'dark theme', ts: T0.toISOString(), owner: false },
    ] });
  });
  it('orders the ideas by their time, and a tie by note id, not by file name (L-11)', () => {
    note('b', { ts: '2026-10-22T09:00:00.000Z' }); note('a-b'); note('a');
    // The listing reads a-b.json before a.json: the tie between a and a-b is broken by their ids.
    expect(JSON.parse(cli(['ideas', '--db', db]).stdout)).toMatchObject({ owner: null, ideas: [{ note: 'b', owner: false }, { note: 'a' }, { note: 'a-b' }] });
  });
  it('add --from-note makes one user proposal of the note, logs whose idea it is and prints the link', () => {
    pull(99);
    note('n1');
    const r = JSON.parse(cli(['add', '--file', 'idea.json', '--from-note', 'n1', '--db', db]).stdout);
    expect(r.doc).toMatchObject({ source: 'user', author: 'user:u1', evidence: 'Idea by user:u1 (note n1)' });
    expect(r.link).toEqual({ op: 'update', collection: 'notes', doc_id: 'n1', data: { proposalId: r.id } });
    // The carry: its add event has the digest of its text, as forge's own adds do.
    expect(lastAdd(r.id)).toMatchObject({ id: r.id, from: 'note:n1', owner: true, digest: proposalDigest(r.id, loadProposal(root, r.id)!) });
    const again = cli(['add', '--file', 'idea.json', '--from-note', 'n1', '--db', db]);
    expect(again.code).toBe(3);
    expect(again.stderr).toContain(r.id);
    expect(JSON.parse(cli(['ideas', '--db', db]).stdout).ideas).toEqual([]);
    expect(JSON.parse(cli(['policy', r.id]).stdout)).toMatchObject({ status: 'proposed', reason: 'origin' });
  });
  it('the default evidence speaks the run\'s language, and a proposal that brings its own keeps it', () => {
    autonomousRun(root, 'es');
    note('n1'); note('n2', { text: 'dark theme' });
    expect(JSON.parse(cli(['add', '--file', 'idea.json', '--from-note', 'n1', '--db', db]).stdout).doc.evidence).toBe('Idea de user:u1 (nota n1)');
    expect(JSON.parse(cli(['add', '--file', file('dark.json', { ...dark, evidence: 'the player asked twice' }), '--from-note', 'n2', '--db', db]).stdout).doc.evidence)
      .toBe('the player asked twice');
  });
  it('add --from-chat is the owner\'s idea, and no idea goes through the policy', () => {
    pull(99);
    writeFileSync(path.join(root, 'small.json'), JSON.stringify({ category: 'quality', risk: 'low', title: 'Tidy the menu code', rationale: 'r', path: 'src/menu.ts' }));
    const r = JSON.parse(cli(['add', '--file', 'small.json', '--from-chat']).stdout);
    expect(readEvents(root).filter(e => e.kind === 'proposal' && e.action === 'add').at(-1)).toMatchObject({ id: r.id, from: 'chat', owner: true });
    expect(r.doc.author).toBe('user:u1');
    expect(JSON.parse(cli(['policy', r.id]).stdout)).toMatchObject({ status: 'proposed', reason: 'origin' });
    // Positive control: the same kind of proposal, added by forge, is auto-approved by the policy.
    const own = added(['--file', file('tidy.json', { category: 'quality', risk: 'low', title: 'Tidy the parser helpers', rationale: 'r', path: 'src/parser.ts', source: 'scout', pillar: 'p', evidence: 'e' })]);
    expect(JSON.parse(cli(['policy', own]).stdout)).toMatchObject({ status: 'auto_approved' });
  });
  it('a chat idea with no owner known is still the owner\'s, by name', () => {
    expect(JSON.parse(cli(['add', '--file', 'idea.json', '--from-chat']).stdout).doc).toMatchObject({ source: 'user', author: 'owner' });
  });
  it('a note that is no idea, is forge\'s own, or already has its proposal, is exit 2', () => {
    note('q', { type: 'question' }); note('p', { proposalId: 'p20261022100000abcd' }); note('s', { author: 'session:main' });
    expect(cli(['add', '--file', 'idea.json', '--from-note', 'q', '--db', db]).code).toBe(2);
    expect(cli(['add', '--file', 'idea.json', '--from-note', 'p', '--db', db]).code).toBe(2);
    expect(cli(['add', '--file', 'idea.json', '--from-note', 's', '--db', db]).code).toBe(2);
    expect(cli(['add', '--file', 'idea.json', '--from-note', 'missing', '--db', db]).code).toBe(2);
    expect(cli(['add', '--file', 'idea.json', '--from-note', 'constructor', '--db', db]).code).toBe(2);
    expect(readEvents(root)).toEqual([]);
    // Positive control: a person's idea without a proposal is added.
    note('ok');
    expect(cli(['add', '--file', 'idea.json', '--from-note', 'ok', '--db', db]).code).toBe(0);
  });
  it('--from-note and --from-chat exclude each other; --from-note needs a note id and --db, and is never a v2', () => {
    note('n1');
    for (const args of [
      ['--from-note', 'n1', '--db', db, '--from-chat'], ['--from-note', 'n1'], ['--from-note', '--db', db], ['--from-note', 'a/b', '--db', db],
      ['--from-note', 'n1', '--db', db, '--revises', 'p20261022100000abcd'],
    ]) expect(cli(['add', '--file', 'idea.json', ...args]).code, args.join(' ')).toBe(2);
    expect(readEvents(root)).toEqual([]);
    // Positive control: the note with its database is added.
    expect(cli(['add', '--file', 'idea.json', '--from-note', 'n1', '--db', db]).code).toBe(0);
  });
  it('a chat idea close to an open proposal is exit 3 with the open one\'s id (L-6)', () => {
    const open = added(['--file', file('scout.json', { ...idea, source: 'scout', evidence: 'e' })]);
    const r = cli(['add', '--file', file('chat.json', { ...idea, rationale: 'chains reward skill, as the person said' }), '--from-chat']);
    expect(r.code).toBe(3);
    expect(r.stderr).toContain(open);
    // Positive control: a chat idea that says something else is added.
    expect(cli(['add', '--file', file('dark.json', dark), '--from-chat']).code).toBe(0);
  });
});

describe('a person\'s idea before the judge (6b-2)', () => {
  beforeEach(() => autonomousRun());
  it('with no approvals/owner, add --from-note then judge gives waits-owner (L-6)', () => {
    note('n1');
    const id = added(['--file', 'idea.json', '--from-note', 'n1', '--db', db]);
    expect(lastAdd(id)).toMatchObject({ from: 'note:n1', owner: false });
    verdicts({ id, verdict: 'keep', why: 'fits the vision' });
    expect(judge(id)).toMatchObject({ outcome: 'waits-owner', write: null, approval: null });
    expect([loadProposal(root, id)?.status, loadApproval(root, id)]).toEqual(['proposed', null]);
    // Positive control: once the page told forge who the owner is, the owner's next note idea is approved on the same verdict.
    pull(99);
    note('n2', { text: 'dark theme' });
    const own = added(['--file', file('dark.json', dark), '--from-note', 'n2', '--db', db]);
    verdicts({ id: own, verdict: 'keep', why: 'fits the vision' });
    expect(judge(own)).toMatchObject({ outcome: 'approved' });
  });
  it('an idea edited after forge added it waits for the owner, as its add event has the digest of its text', () => {
    pull(99);
    const id = added(['--file', 'idea.json', '--from-chat']);
    expect(lastAdd(id)).toMatchObject({ from: 'chat', owner: true, digest: proposalDigest(id, loadProposal(root, id)!) });
    saveProposal(root, id, { ...loadProposal(root, id)!, rationale: 'an editor rewrote it' });
    verdicts({ id, verdict: 'keep', why: 'fits' });
    expect(judge(id)).toMatchObject({ outcome: 'waits-owner' });
    // Positive control: the owner's chat idea, unedited, is approved.
    const fine = added(['--file', file('dark.json', dark), '--from-chat']);
    verdicts({ id: fine, verdict: 'keep', why: 'fits' });
    expect(judge(fine)).toMatchObject({ outcome: 'approved' });
  });
  it('a v2 of a person\'s idea logs its original\'s from and owner, whatever its flags say (L-15)', () => {
    pull(99);
    note('n2', { author: 'user:u2', text: 'dark theme' });
    const theirs = added(['--file', file('dark.json', dark), '--from-note', 'n2', '--db', db]);
    const v2 = added(['--file', file('v2.json', { ...dark, title: 'Dark menu', rationale: 'only the menu' }), '--revises', theirs, '--from-chat']);
    expect(lastAdd(v2)).toMatchObject({ revises: theirs, from: 'note:n2', owner: false });
    // The note is still the original's: it became one proposal.
    expect(convertedFrom(root, 'n2')).toBe(theirs);
    verdicts({ id: v2, verdict: 'keep', why: 'fits' });
    expect(judge(v2)).toMatchObject({ outcome: 'waits-owner' });
    // Positive control: the v2 of the owner's chat idea is the owner's, and replaces it once kept.
    const mine = added(['--file', 'idea.json', '--from-chat']);
    const m2 = added(['--file', file('m2.json', { ...idea, title: 'Combo counter', source: 'user' }), '--revises', mine]);
    expect(lastAdd(m2)).toMatchObject({ revises: mine, from: 'chat', owner: true });
    verdicts({ id: m2, verdict: 'keep', why: 'fits' });
    expect(judge(m2)).toMatchObject({ outcome: 'approved', original: { id: mine } });
  });
});

describe('proposals unpark (6b-2)', () => {
  const parked = (id: string, title = 'Online mode') => saveProposal(root, id, { ts: T0.toISOString(), category: 'feature', risk: 'high', title, rationale: 'r', evidence: 'e', pillar: '',
    status: 'discussing', source: 'user', author: 'user:u1', parked: { why: 'solo game', loses: 'solo focus', at: T0.toISOString() } });
  const decisions = () => readEvents(root).filter(e => e.kind === 'decision');
  // The run's worktree is elsewhere: unpark needs no active run around it, only the parked mark.
  beforeEach(() => autonomousRun(path.join(root, 'wt')));
  it('insisting integrates it with the owner\'s mark and a decision that is the person\'s', () => {
    parked('p20261022100000aaaa');
    const r = JSON.parse(cli(['unpark', 'p20261022100000aaaa', '--insist', '--session', 'main']).stdout);
    // L-7: the roadmap's parked mark is deleted.
    expect(r).toMatchObject({ outcome: 'integrated', write: { status: 'approved', decidedBy: 'forge:decide', parked: { __delete__: true } } });
    expect(r.approval).toMatchObject({ op: 'set', collection: 'approvals', doc_id: 'p20261022100000aaaa', data: { status: 'approved', by: 'forge:decide' } });
    expect(loadApproval(root, 'p20261022100000aaaa')).toMatchObject({ status: 'approved', by: 'forge:decide' });
    expect(r.publish[0].data.decision).toMatchObject({ point: 'idea', auto: false });
    expect(loadProposal(root, 'p20261022100000aaaa')).not.toHaveProperty('parked');
    expect(decisions()).toMatchObject([{ point: 'idea', by: 'user', what: 'Online mode', tradeoffs: 'solo focus', runId: 'product-g' }]);
    expect(r.decision).toBe(1);
    // M-2: the unpark is the proposal's latest decision.
    expect(readEvents(root).filter(e => e.action === 'unpark')).toMatchObject([{ id: 'p20261022100000aaaa', status: 'approved' }]);
    expect(lastDecisions(root).p20261022100000aaaa).toEqual({ status: 'approved', ts: T0.toISOString() });
  });
  it('withdrawing rejects it; one that is not parked is exit 2', () => {
    parked('p20261022100000bbbb');
    expect(JSON.parse(cli(['unpark', 'p20261022100000bbbb', '--withdraw']).stdout)).toMatchObject({ outcome: 'withdrawn', write: { status: 'rejected', reason: 'withdrawn by the person' } });
    expect(loadApproval(root, 'p20261022100000bbbb')).toMatchObject({ status: 'rejected', by: 'forge:decide' });
    expect(cli(['unpark', 'p20261022100000bbbb', '--insist']).code).toBe(2);
  });
  it('speaks the run\'s language, and answers with no run at all', () => {
    autonomousRun(path.join(root, 'wt'), 'es');
    parked('p20261022100000cccc');
    expect(JSON.parse(cli(['unpark', 'p20261022100000cccc', '--withdraw']).stdout)).toMatchObject({ write: { reason: 'retirada por la persona' } });
    saveRun(root, { ...startRun(T0, { hours: 1 }, 10, 'coord-1', 'en'), active: false });
    parked('p20261022100000dddd', 'Split screen');
    expect(JSON.parse(cli(['unpark', 'p20261022100000dddd', '--insist']).stdout)).toMatchObject({ outcome: 'integrated' });
    expect(decisions().at(-1)).not.toHaveProperty('runId');
  });
  it('a decision the record refuses writes nothing (T6B2-DECISION-FIRST)', () => {
    parked('p20261022100000eeee', String.fromCharCode(0x202e));
    const r = cli(['unpark', 'p20261022100000eeee', '--insist']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/what/);
    expect(loadProposal(root, 'p20261022100000eeee')).toMatchObject({ status: 'discussing', parked: { why: 'solo game' } });
    expect([loadApproval(root, 'p20261022100000eeee'), readEvents(root)]).toEqual([null, []]);
    // Positive control: a parked idea with a title is integrated.
    parked('p20261022100000ffff');
    expect(cli(['unpark', 'p20261022100000ffff', '--insist']).code).toBe(0);
  });
  it('takes one answer: --insist or --withdraw, of a proposal id', () => {
    parked('p20261022100000gggg');
    for (const args of [['p20261022100000gggg'], ['p20261022100000gggg', '--insist', '--withdraw'], ['--insist'], ['p20261022100000zzzz', '--insist'],
      ['p20261022100000gggg', '--insist', '--session']]) expect(cli(['unpark', ...args]).code, args.join(' ')).toBe(2);
    expect(readEvents(root)).toEqual([]);
    expect(cli(['unpark', 'p20261022100000gggg', '--withdraw']).code).toBe(0);
  });
});

describe('ideas and unpark in a profile worktree (T6B2-ROOTS)', () => {
  it('the owner, the proposal, its mark and its events stay in the worktree; the person\'s decision goes to the main checkout', () => {
    const main = tmp('ideas-main-');
    const g = (...a: string[]) => execFileSync('git', a, { cwd: main, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    g('init', '-q', '-b', 'main');
    g('config', 'user.email', 'a@b.c'); g('config', 'user.name', 't'); g('config', 'core.autocrlf', 'false');
    writeFileSync(path.join(main, 'a.txt'), 'a'); g('add', 'a.txt'); g('commit', '-qm', 'a');
    expect(run(['infinite', 'prepare', '--profile', 'product', '--name', 'g'], { ...io(), cwd: main }).code).toBe(0);
    // From here on the helpers work in the profile's worktree.
    root = profileNames(main, 'product', 'g').worktree;
    db = path.join(root, '.waypoint', 'g', 'dbcache');
    mkdirSync(path.join(db, 'proposals'), { recursive: true });
    expect(run(['infinite', 'start', '--profile', 'product', '--name', 'g', '--hours', '2', '--session', 'coord-1'], io()).code).toBe(0);
    expect(pull(99).owner).toBe('user:u1');
    expect([roadmapOwner(root), roadmapOwner(main)]).toEqual(['user:u1', null]);
    note('n1');
    const id = added(['--file', file('idea.json', idea), '--from-note', 'n1', '--db', db]);
    verdicts({ id, verdict: 'clash', why: 'the vision is a solo game', loses: 'the focus on solo play' });
    expect(judge(id)).toMatchObject({ outcome: 'parked' });
    const r = JSON.parse(cli(['unpark', id, '--insist', '--session', 'main']).stdout);
    expect(r.outcome).toBe('integrated');
    expect([loadProposal(root, id)?.status, loadApproval(root, id)?.status, loadProposal(main, id), loadApproval(main, id)]).toEqual(['approved', 'approved', null, null]);
    const all = readEvents(main).filter(e => e.kind === 'decision');
    expect(all.at(-1)).toMatchObject({ point: 'idea', by: 'user', what: 'Combo meter', runId: 'product-g' });
    expect(all.length).toBe(r.decision);
    expect(readEvents(root).filter(e => e.kind === 'decision')).toEqual([]);
    expect(readEvents(root).filter(e => e.kind === 'proposal').map(e => [e.action, e.id])).toEqual([['add', id], ['judge', id], ['unpark', id]]);
  });
});
