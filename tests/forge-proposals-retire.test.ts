import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { run } from '../src/forge/cli/run.js';
import { startRun, saveRun } from '../src/forge/run.js';
import { loadApproval, loadProposal, saveApproval, saveProposal } from '../src/forge/proposals.js';
import { appendEvent, readEvents } from '../src/forge/ledger.js';
import { proposalDigest, type ProposalDoc } from '../src/lib/proposals.js';
import { useTempDirs } from './helpers/tmp.js';

const tmp = useTempDirs();
const T0 = new Date('2026-10-22T10:00:00.000Z');
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
const retire = (id: string, ...args: string[]) =>
  run(['proposals', 'retire', id, ...(args.length ? args : ['--plan', 'plan.yaml', '--why-file', 'why.txt'])], { cwd: root, now: () => T0, env: {} });
const proposalFile = (id: string) => readFileSync(path.join(root, '.forge', 'proposals', `${id}.json`), 'utf8');
const retireEvents = () => readEvents(root).filter(e => e.kind === 'proposal' && e.action === 'retire');

beforeEach(() => {
  root = tmp('retire-');
  writeFileSync(path.join(root, 'plan.yaml'), PLAN);
  writeFileSync(path.join(root, 'why.txt'), '  the provider\nsends it now  \n');
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
    expect(JSON.parse(r.stdout)).toEqual({
      id: P.run,
      write: { status: 'rejected', decidedBy: 'forge:auto', decidedAt: AT, reason },
      approval: { op: 'set', collection: 'approvals', doc_id: P.run, data: { status: 'rejected', decidedAt: AT, by: 'forge:auto', digest: proposalDigest(P.run, doc({ taskId: 'T004' })) } },
    });
    expect(loadProposal(root, P.run)).toMatchObject({ status: 'rejected', decidedBy: 'forge:auto', decidedAt: AT, reason, taskId: 'T004' });
    expect(loadApproval(root, P.run)).toEqual({ status: 'rejected', decidedAt: AT, by: 'forge:auto', digest: proposalDigest(P.run, doc()) });
    expect(retireEvents()).toEqual([{ ts: AT, kind: 'proposal', action: 'retire', id: P.run, taskId: 'T004' }]);
    // Rejected now, it is not rejected twice.
    expect(retire(P.run).code).toBe(2);
    expect(retireEvents()).toHaveLength(1);
  });
  it('cleans and clips the why as judge\'s reasons, and says it in the run\'s language', () => {
    writeFileSync(path.join(root, 'why.txt'), `${'x'.repeat(1200)}\n`);
    const long = JSON.parse(retire(P.run).stdout) as { write: { reason: string } };
    expect(long.write.reason).toBe(`retired by replan: ${'x'.repeat(1000)}`);
    saveRun(root, { ...startRun(T0, { hours: 1 }, 10, 'c1', 'es') });
    put(P.live, doc({ taskId: 'T005' }));
    writeFileSync(path.join(root, 'why.txt'), 'ya no hace falta');
    expect((JSON.parse(retire(P.live).stdout) as { write: { reason: string } }).write.reason).toBe('retirada por el replan: ya no hace falta');
  });
  it('refuses, writing nothing, a person\'s idea, one that is not approved, and one whose task the plan did not retire', () => {
    for (const [id, word] of [[P.user, "person's idea"], [P.chat, "person's idea"], [P.rejected, 'rejected'], [P.live, 'T001'], [P.none, 'retired']] as const) {
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
