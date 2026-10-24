import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { run } from '../src/forge/cli/run.js';
import { startRun, saveRun } from '../src/forge/run.js';
import { loadApproval, loadProposal, saveApproval, saveProposal } from '../src/forge/proposals.js';
import { appendEvent, readEvents } from '../src/forge/ledger.js';
import { IDEA_MERGED } from '../src/forge/ideas.js';
import { proposalDigest, type ProposalDoc } from '../src/lib/proposals.js';
import { lastDecisions } from '../src/forge/cli/shared.js';
import { useTempDirs } from './helpers/tmp.js';

const tmp = useTempDirs();
const T0 = new Date('2026-10-22T10:00:00.000Z');
const T1 = new Date('2026-10-22T11:30:00.000Z');
const AT = T0.toISOString();
// T004 to T007 were retired by a re-plan; T001 is still a task of the plan.
const PLAN = `project: g\nlocale: en\nversion: "0.1"\ntracks:\n  - { id: core, name: Core, color: blue }\nphases:\n  - { id: F1, name: Base }\ntasks:\n`
  + '  - { id: T001, title: a, track: core, phase: F1, done_when: x }\nretired: [T004, T005, T006, T007]\n';
const P = { run: 'p20261022100000aaaa', user: 'p20261022100000bbbb', live: 'p20261022100000cccc', none: 'p20261022100000dddd', rejected: 'p20261022100000eeee',
  chat: 'p20261022100000ffff' };
let root: string;
const doc = (over: Partial<ProposalDoc> = {}): ProposalDoc => ({ ts: AT, category: 'feature', risk: 'low', title: 'An idea', rationale: 'r', evidence: 'e', pillar: 'fun',
  status: 'auto_approved', source: 'scout', author: 'session', decidedBy: 'forge:auto', decidedAt: AT, ...over });
const put = (id: string, d: ProposalDoc) => {
  saveProposal(root, id, d);
  saveApproval(root, id, { status: d.status === 'rejected' ? 'rejected' : 'auto_approved', decidedAt: AT, by: 'forge:auto', digest: proposalDigest(id, d) });
};
const autonomous = (profile: 'product' | 'spike') =>
  ({ profile, name: 'g', runId: `${profile}-g`, worktree: path.join(root, 'wt'), branch: `forge/${profile}-g`, startBranch: 'main', protectedBranches: ['main'] });
/** Fix 3: retire runs only while a product run is active, as `infinite phase` does. */
const productRun = (locale: string | null = null, over: { active?: boolean; profile?: 'product' | 'spike' } = {}) =>
  saveRun(root, { ...startRun(T0, { hours: 1 }, 10, 'c1', locale), ...(over.active === false ? { active: false } : {}), autonomous: autonomous(over.profile ?? 'product') });
const retireAt = (now: Date, id: string, ...args: string[]) =>
  run(['proposals', 'retire', id, ...(args.length ? args : ['--plan', 'plan.yaml', '--why-file', 'why.txt'])], { cwd: root, now: () => now, env: {} });
const retire = (id: string, ...args: string[]) => retireAt(T0, id, ...args);
const proposalFile = (id: string) => readFileSync(path.join(root, '.forge', 'proposals', `${id}.json`), 'utf8');
const retireEvents = () => readEvents(root).filter(e => e.kind === 'proposal' && e.action === 'retire');

beforeEach(() => {
  root = tmp('retire-');
  writeFileSync(path.join(root, 'plan.yaml'), PLAN);
  writeFileSync(path.join(root, 'why.txt'), '  the provider\nsends it now  \n');
  productRun();
  put(P.run, doc({ taskId: 'T004' }));
  put(P.user, doc({ source: 'user', author: 'borja', taskId: 'T005' }));
  put(P.live, doc({ taskId: 'T001' }));
  put(P.none, doc());
  put(P.rejected, doc({ status: 'rejected', reason: 'no', taskId: 'T006' }));
  // A person's idea known from the ledger only: it came from this conversation.
  put(P.chat, doc({ taskId: 'T007' }));
  appendEvent(root, { ts: AT, kind: 'proposal', action: 'add', id: P.chat, from: 'chat', owner: true });
});

// 6b-3 M-8, T6B3-RETIRE-CLI: the proposal a re-plan's retire left without its task is rejected through the CLI.
describe('proposals retire (6b-3)', () => {
  it('rejects an approved proposal whose task the plan retired, with judge\'s writes and the run\'s mark of its text', () => {
    const r = retire(P.run);
    expect(r.stderr).toBe('');
    expect(r.code).toBe(0);
    const reason = 'retired by replan: the provider sends it now';
    const digest = proposalDigest(P.run, doc());
    expect(JSON.parse(r.stdout)).toEqual({
      id: P.run,
      write: { status: 'rejected', decidedBy: 'forge:auto', decidedAt: AT, reason },
      approval: { op: 'set', collection: 'approvals', doc_id: P.run, data: { status: 'rejected', decidedAt: AT, by: 'forge:auto', digest } },
    });
    expect(loadProposal(root, P.run)).toMatchObject({ status: 'rejected', decidedBy: 'forge:auto', decidedAt: AT, reason, taskId: 'T004' });
    expect(loadApproval(root, P.run)).toEqual({ status: 'rejected', decidedAt: AT, by: 'forge:auto', digest });
    // Fix 3: the event keeps what the writes said, so a resumed retire prints them again; final fix T7-c: its status too.
    expect(retireEvents()).toEqual([{ ts: AT, kind: 'proposal', action: 'retire', id: P.run, taskId: 'T004', status: 'rejected', reason, digest }]);
    // Final fix T7-c: the retire is the proposal's latest decision.
    expect(lastDecisions(root)[P.run]).toEqual({ status: 'rejected', ts: AT });
  });
  // Fix 3, T6B3-RETIRE-IDEMPOTENT: a stop after the local rejection and before the store took it.
  it('a retire run again after a stop prints the same writes, and writes nothing more', () => {
    const first = retire(P.run);
    expect(first.code).toBe(0);
    const file = proposalFile(P.run);
    const mark = loadApproval(root, P.run);
    const again = retireAt(T1, P.run);
    expect(again.stderr).toBe('');
    expect(again.code).toBe(0);
    expect(JSON.parse(again.stdout)).toEqual(JSON.parse(first.stdout));
    expect(proposalFile(P.run)).toBe(file);
    expect(loadApproval(root, P.run)).toEqual(mark);
    expect(retireEvents()).toHaveLength(1);
  });
  // Final fix T7-O2: «rejected already» has its own exit code, 4, which no other case uses: phase-close.md keys on it.
  it('any other rejected proposal exits 4, writing nothing: one rejected without a retire, or rejected again with another reason', () => {
    const r = retire(P.rejected);
    expect(r.code).toBe(4);
    expect(r.stderr).toContain('rejected');
    expect(retire(P.run).code).toBe(0);
    // The owner rejected it again on the page, with their own reason: that rejection is theirs.
    saveProposal(root, P.run, doc({ status: 'rejected', decidedBy: 'page', reason: 'not this year', taskId: 'T004' }));
    const file = proposalFile(P.run);
    const owner = retireAt(T1, P.run);
    expect(owner.code).toBe(4);
    expect(owner.stderr).toContain('rejected');
    expect(proposalFile(P.run)).toBe(file);
    expect(retireEvents()).toHaveLength(1);
  });
  // Final fix T7-R1 (probes I2, I3, I5): a resume repeats only the exact state the retire left; any change since is no resume.
  it('a resume needs the state the retire left: the same text, its time, its mark and the task still retired; otherwise it exits 4, writing nothing', () => {
    const cases: [string, () => void][] = [
      ['I2 the text edited since', () => saveProposal(root, P.run, { ...loadProposal(root, P.run)!, title: 'Edited by the person' })],
      ['I3 the owner\'s mark since', () => saveApproval(root, P.run, { ...loadApproval(root, P.run)!, by: 'page', decidedAt: T1.toISOString() })],
      ['I5 the re-plan reverted', () => writeFileSync(path.join(root, 'plan.yaml'), PLAN.replace('retired: [T004, T005, T006, T007]\n', '')
        .replace('  - { id: T001, title: a, track: core, phase: F1, done_when: x }\n', '  - { id: T001, title: a, track: core, phase: F1, done_when: x }\n  - { id: T004, title: b, track: core, phase: F1, done_when: y }\n'))],
      ['the decision time changed', () => saveProposal(root, P.run, { ...loadProposal(root, P.run)!, decidedAt: T1.toISOString() })],
    ];
    for (const [label, change] of cases) {
      root = tmp('retire-resume-');
      writeFileSync(path.join(root, 'plan.yaml'), PLAN);
      writeFileSync(path.join(root, 'why.txt'), 'no longer needed');
      productRun();
      put(P.run, doc({ taskId: 'T004' }));
      expect(retire(P.run).code, label).toBe(0);
      change();
      const file = proposalFile(P.run);
      const mark = loadApproval(root, P.run);
      const r = retireAt(T1, P.run);
      expect(r.code, label).toBe(4);
      expect(r.stdout, label).toBe('');
      expect(proposalFile(P.run), label).toBe(file);
      expect(loadApproval(root, P.run), label).toEqual(mark);
      expect(retireEvents(), label).toHaveLength(1);
    }
  });
  it('runs only inside an active product run, as infinite phase does: none, a stopped one and a spike run are refused', () => {
    const before = proposalFile(P.run);
    const mark = loadApproval(root, P.run);
    const setups: [string, () => void, string][] = [
      ['no run', () => rmSync(path.join(root, '.forge', 'run.json')), 'no autonomous run is active'],
      ['a stopped run', () => productRun(null, { active: false }), 'no autonomous run is active'],
      ['a spike run', () => productRun(null, { profile: 'spike' }), 'spike'],
    ];
    for (const [label, setup, word] of setups) {
      setup();
      const r = retire(P.run);
      expect(r.code, label).toBe(2);
      expect(r.stderr, label).toContain(word);
      expect(proposalFile(P.run), label).toBe(before);
      expect(loadApproval(root, P.run), label).toEqual(mark);
    }
    expect(retireEvents()).toEqual([]);
  });
  it('cleans and clips the why as judge\'s reasons, and says it in the run\'s language', () => {
    writeFileSync(path.join(root, 'why.txt'), `${'x'.repeat(1200)}\n`);
    const long = JSON.parse(retire(P.run).stdout) as { write: { reason: string } };
    expect(long.write.reason).toBe(`retired by replan: ${'x'.repeat(1000)}`);
    productRun('es');
    put(P.live, doc({ taskId: 'T005' }));
    writeFileSync(path.join(root, 'why.txt'), 'ya no hace falta');
    expect((JSON.parse(retire(P.live).stdout) as { write: { reason: string } }).write.reason).toBe('retirada por el replan: ya no hace falta');
  });
  it('refuses, writing nothing, a person\'s idea, one that is not approved, and one whose task the plan did not retire', () => {
    put(P.rejected, doc({ status: 'proposed', decidedBy: undefined, decidedAt: undefined, taskId: 'T006' }));
    for (const [id, word] of [[P.user, "person's idea"], [P.chat, "person's idea"], [P.rejected, 'proposed'], [P.live, 'T001'], [P.none, 'retired']] as const) {
      const before = proposalFile(id);
      const mark = loadApproval(root, id);
      const r = retire(id);
      expect(r.code, id).toBe(2);
      expect(r.stderr, id).toContain(word);
      expect(proposalFile(id), id).toBe(before);
      expect(loadApproval(root, id), id).toEqual(mark);
    }
    expect(retireEvents()).toEqual([]);
  });
  // Fix 2, T6B3-RETIRE-HELD: replan-check's rule. Only the run's own proposal is the run's to reject: the owner's mark, a person's
  // merged note, a run mark of another text, or no mark holds it, and nothing is written.
  it('refuses, writing nothing, a proposal the run does not own: the owner\'s mark, a merged note, a mark of another text, no mark', () => {
    const ID = 'p20261022100000gggg';
    const cases: [string, () => void, string][] = [
      ['P1 the owner\'s page mark', () => {
        const d = doc({ status: 'approved', decidedBy: 'page', taskId: 'T004' });
        saveProposal(root, ID, d);
        saveApproval(root, ID, { status: 'approved', decidedAt: AT, by: 'page', digest: proposalDigest(ID, d) });
      }, "owner's mark"],
      ['P2 a person\'s note merged into it', () => {
        put(ID, doc({ taskId: 'T004' }));
        appendEvent(root, { ts: AT, kind: 'proposal', action: IDEA_MERGED, id: ID, from: 'note:n1' });
      }, 'merged'],
      ['P3 a run mark of another text', () => {
        saveProposal(root, ID, doc({ taskId: 'T004' }));
        saveApproval(root, ID, { status: 'auto_approved', decidedAt: AT, by: 'forge:auto', digest: proposalDigest(ID, doc({ title: 'Another text' })) });
      }, 'no longer matches'],
      ['P4 no mark', () => { saveProposal(root, ID, doc({ taskId: 'T004' })); }, 'no mark'],
    ];
    for (const [label, setup, word] of cases) {
      root = tmp('retire-held-');
      writeFileSync(path.join(root, 'plan.yaml'), PLAN);
      writeFileSync(path.join(root, 'why.txt'), 'no longer needed');
      productRun();
      setup();
      const before = proposalFile(ID);
      const mark = loadApproval(root, ID);
      const r = retire(ID);
      expect(r.code, label).toBe(2);
      expect(r.stderr, label).toContain(word);
      expect(proposalFile(ID), label).toBe(before);
      expect(loadApproval(root, ID), label).toEqual(mark);
      expect(retireEvents(), label).toEqual([]);
    }
  });
  it('needs a proposal id it has, --plan, a why that says something, and a plan that parses', () => {
    expect(retire('p20261022100000zzzz').code, 'unknown').toBe(2);
    expect(retire('nope').code, 'not an id').toBe(2);
    expect(retire(P.run, '--plan', 'plan.yaml').code, 'no --why-file').toBe(2);
    expect(retire(P.run, '--why-file', 'why.txt').code, 'no --plan').toBe(2);
    writeFileSync(path.join(root, 'why.txt'), ' \n\t');
    expect(retire(P.run).code, 'an empty why').toBe(2);
    writeFileSync(path.join(root, 'why.txt'), 'w');
    writeFileSync(path.join(root, 'broken.yaml'), 'project: g\nphases: [\n');
    expect(retire(P.run, '--plan', 'broken.yaml', '--why-file', 'why.txt').code, 'a broken plan').toBe(2);
    expect(loadProposal(root, P.run)?.status).toBe('auto_approved');
    expect(retireEvents()).toEqual([]);
  });
});
