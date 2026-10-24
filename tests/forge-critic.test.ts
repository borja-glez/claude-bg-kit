import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readVerdicts, proposalBatch, CRITIC_TEXT_MAX } from '../src/forge/critic.js';
import { run } from '../src/forge/cli/run.js';
import { proposalDigest, type ProposalDoc } from '../src/lib/proposals.js';
import { saveApproval, saveProposal } from '../src/forge/proposals.js';
import { appendEvent } from '../src/forge/ledger.js';
import { useTempDirs } from './helpers/tmp.js';

const tmp = useTempDirs();
const ID = 'p20261022100000abcd';
const D = 'a'.repeat(64);

describe('readVerdicts', () => {
  it('keeps each well formed verdict once, and drops the rest', () => {
    const text = JSON.stringify({ verdicts: [
      { id: ID, digest: D, verdict: 'keep', why: 'serves the core loop' },
      { id: ID, digest: D, verdict: 'drop', why: 'second one for the same id' },
      { id: 'p20261022100000zzzz', digest: D, verdict: 'adapt', why: 'too broad' },
      { id: 'p20261022100000yyyy', digest: D, verdict: 'clash', why: 'multiplayer is out of the vision' },
      { id: 'p20261022100000xxxx', digest: 'short', verdict: 'keep', why: 'x' }, { id: '../x', digest: D, verdict: 'keep', why: 'x' },
      { id: 'p20261022100000wwww', digest: D, verdict: 'maybe', why: 'x' }, { id: 'p20261022100000vvvv', digest: D, verdict: 'keep', why: ' ' },
    ] });
    expect(readVerdicts(text)).toEqual([{ id: ID, digest: D, verdict: 'keep', why: 'serves the core loop' }]);
  });
  it('keeps adapt with its changes and clash with what would be lost, clipped', () => {
    const v = readVerdicts(JSON.stringify({ verdicts: [{ id: ID, digest: D, verdict: 'adapt', why: 'w', changes: 'x'.repeat(2000) }] }));
    expect(v[0].changes).toHaveLength(CRITIC_TEXT_MAX);
    expect(readVerdicts(JSON.stringify({ verdicts: [{ id: ID, digest: D, verdict: 'clash', why: 'w', loses: 'the solo focus' }] }))[0]).toMatchObject({ verdict: 'clash', loses: 'the solo focus' });
  });
  it('counts the first entry of an id even when it is malformed, so a contradicting critic never passes', () => {
    const text = JSON.stringify({ verdicts: [{ id: ID, digest: D, verdict: 'drop', why: ' ' }, { id: ID, digest: D, verdict: 'keep', why: 'fine' }] });
    expect(readVerdicts(text)).toEqual([]);
  });
  it('ignores extra keys, cleans control characters, takes only lowercase hex digests and cuts by code points', () => {
    const ctl = String.fromCharCode(7);
    const v = readVerdicts(JSON.stringify({ verdicts: [{ id: ID, digest: D, verdict: 'keep', why: `a${ctl}b`, extra: 1 }] }));
    expect(v).toEqual([{ id: ID, digest: D, verdict: 'keep', why: 'a b' }]);
    expect(readVerdicts(JSON.stringify({ verdicts: [{ id: ID, digest: 'A'.repeat(64), verdict: 'keep', why: 'x' }] }))).toEqual([]);
    const long = readVerdicts(JSON.stringify({ verdicts: [{ id: ID, digest: D, verdict: 'keep', why: '\u{1F600}'.repeat(1500) }] }));
    expect(Array.from(long[0].why)).toHaveLength(CRITIC_TEXT_MAX);
    expect(long[0].why.endsWith('\u{1F600}')).toBe(true);
  });
  it('cleans as the decision record does: a why of only bidi or C1 characters is empty, so it is no verdict (6b-2 Task 4 fix 1, I-1)', () => {
    const bidi = String.fromCharCode(0x202e);
    const c1 = String.fromCharCode(0x85);
    for (const why of [bidi, c1, ` ${String.fromCharCode(0x2066)} ${c1} `]) {
      expect(readVerdicts(JSON.stringify({ verdicts: [{ id: ID, digest: D, verdict: 'keep', why }] })), JSON.stringify(why)).toEqual([]);
    }
    expect(readVerdicts(JSON.stringify({ verdicts: [{ id: ID, digest: D, verdict: 'keep', why: `a${bidi}b${c1}c` }] }))[0].why).toBe('a b c');
  });
  it('keeps a placement only when it reads whole (6b-3)', () => {
    const p = { phase: 'F2', doneWhen: 'un pago de prueba aprobado', dependsOn: ['T004'], estimate: '45m' };
    expect(readVerdicts(JSON.stringify({ verdicts: [{ id: ID, digest: D, verdict: 'keep', why: 'w', placement: p }] }))[0].placement).toEqual(p);
    expect(readVerdicts(JSON.stringify({ verdicts: [{ id: ID, digest: D, verdict: 'keep', why: 'w', placement: { ...p, dependsOn: ['../x'] } }] }))[0]).not.toHaveProperty('placement');
  });
  it('only a keep carries its placement, cleaned, with an estimate that reads as minutes and a list of dependencies (L-4, L-5)', () => {
    const p = { phase: 'F2', doneWhen: 'a test payment is approved', dependsOn: [], estimate: '2h' };
    const one = (o: Record<string, unknown>) => readVerdicts(JSON.stringify({ verdicts: [{ id: ID, digest: D, why: 'w', ...o }] }))[0];
    expect(one({ verdict: 'keep', placement: p }).placement).toEqual(p);
    expect(one({ verdict: 'keep', placement: { ...p, doneWhen: `a test${String.fromCharCode(7)}payment is approved` } }).placement).toEqual(p);
    expect(one({ verdict: 'adapt', changes: 'smaller', placement: p })).not.toHaveProperty('placement');
    expect(one({ verdict: 'drop', placement: p })).not.toHaveProperty('placement');
    for (const bad of [{ ...p, estimate: 'a while' }, { ...p, phase: '../F2' }, { ...p, doneWhen: ' ' }, { ...p, dependsOn: 'T004' }, { phase: 'F2', doneWhen: 'x', estimate: '2h' }, 'F2']) {
      const v = one({ verdict: 'keep', placement: bad });
      expect(v, JSON.stringify(bad)).toMatchObject({ verdict: 'keep' });
      expect(v, JSON.stringify(bad)).not.toHaveProperty('placement');
    }
  });
  it('is empty for text that is not a verdicts file', () => {
    expect(readVerdicts('[]')).toEqual([]);
    expect(readVerdicts('3')).toEqual([]);
    expect(readVerdicts('nope')).toEqual([]);
    expect(readVerdicts('{"verdicts": 3}')).toEqual([]);
  });
});

describe('proposals batch', () => {
  it('writes each proposal with the digest of its text, and lists the missing ones', () => {
    const root = tmp('batch-');
    writeFileSync(path.join(root, 'p.json'), JSON.stringify({ category: 'feature', risk: 'medium', title: 'Combo meter', rationale: 'r', evidence: 'e', pillar: 'Juice', source: 'scout' }));
    const id = JSON.parse(run(['proposals', 'add', '--file', 'p.json', '--author', 'session:main'], { cwd: root, now: () => new Date('2026-10-22T10:00:00Z'), env: {}, rand: () => 0.5 }).stdout).id;
    const r = JSON.parse(run(['proposals', 'batch', id, 'p20261022100000none', '--out', 'b.json'], { cwd: root, now: () => new Date(), env: {} }).stdout);
    expect(r).toMatchObject({ count: 1, missing: ['p20261022100000none'] });
    const b = JSON.parse(readFileSync(path.join(root, 'b.json'), 'utf8'));
    expect(b.proposals[0]).toMatchObject({ id, digest: proposalDigest(id, b.proposals[0].doc) });
    expect(proposalBatch(root, [id]).proposals).toHaveLength(1);
    expect(run(['proposals', 'batch', '../x', '--out', 'b.json'], { cwd: root, now: () => new Date(), env: {} }).code).toBe(2);
  });
  it('lists a repeated id once, reads an id after --out, and refuses another flag', () => {
    const root = tmp('batch-ids-');
    const r = run(['proposals', 'batch', '--out', 'b.json', 'p20261022100000none', 'p20261022100000none'], { cwd: root, now: () => new Date(), env: {} });
    expect(JSON.parse(r.stdout)).toMatchObject({ count: 0, missing: ['p20261022100000none'] });
    expect(run(['proposals', 'batch', 'p20261022100000none', '--out', 'b.json', '--x'], { cwd: root, now: () => new Date(), env: {} }).code).toBe(2);
    expect(run(['proposals', 'batch', '--out', 'b.json', '../y'], { cwd: root, now: () => new Date(), env: {} }).code).toBe(2);
  });
  it('creates the folder of --out', () => {
    const root = tmp('batch-dir-');
    const r = run(['proposals', 'batch', 'p20261022100000none', '--out', 'deep/er/b.json'], { cwd: root, now: () => new Date(), env: {} });
    expect(r.code).toBe(0);
    expect(JSON.parse(readFileSync(path.join(root, 'deep', 'er', 'b.json'), 'utf8'))).toMatchObject({ proposals: [] });
  });
  it('--pending takes every open proposal no judge decided and no owner marked, but the ideas that wait for the owner (6b-2 Task 7 fix 1)', () => {
    const root = tmp('batch-pending-');
    const io = { cwd: root, now: () => new Date('2026-10-22T12:00:00Z'), env: {} };
    const ts = '2026-10-22T10:00:00.000Z';
    const add = (id: string, title: string, doc: Record<string, unknown> = {}, event: Record<string, unknown> | null = {}) => {
      saveProposal(root, id, { ts, category: 'feature', risk: 'low', title, rationale: title, evidence: 'e', pillar: 'p', status: 'proposed', source: 'scout', author: 'session:main', ...doc } as ProposalDoc);
      if (event) appendEvent(root, { ts, kind: 'proposal', action: 'add', id, ...event });
    };
    const P = (s: string) => `p20261022100000${s}`;
    add(P('scou'), 'scout one');
    add(P('judg'), 'judged one');
    appendEvent(root, { ts, kind: 'proposal', action: 'judge', id: P('judg'), status: 'proposed' });
    add(P('mark'), 'marked one');
    saveApproval(root, P('mark'), { status: 'approved', decidedAt: ts, by: 'forge:decide', digest: 'd'.repeat(64) });
    add(P('park'), 'parked one', { status: 'discussing', parked: { why: 'w', loses: 'l', at: ts } });
    add(P('disc'), 'discussed one', { status: 'discussing' });
    add(P('rejd'), 'rejected one', { status: 'rejected' });
    // As `add --from-chat` writes it while no owner is known (its author is then `owner`).
    add(P('chat'), 'owner chat idea', { source: 'user', author: 'owner' }, { from: 'chat', owner: true, author: 'owner', source: 'user' });
    add(P('note'), 'someone else idea', { source: 'user', author: 'user:x' }, { from: 'note:n1', owner: false, author: 'user:x', source: 'user' });
    add(P('page'), 'written on the page', { source: 'user', author: 'user:x' }, null);
    add(P('verf'), 'verify defect', { source: 'verify' }, { from: 'verify:T1' });
    const r = run(['proposals', 'batch', '--pending', '--out', 'c/batch.json'], io);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ count: 4, ids: [P('chat'), P('disc'), P('scou'), P('verf')], missing: [] });
    expect(JSON.parse(readFileSync(path.join(root, 'c', 'batch.json'), 'utf8')).proposals.map((p: { id: string }) => p.id)).toEqual([P('chat'), P('disc'), P('scou'), P('verf')]);
    // with nothing pending it still answers, with an empty batch; ids with --pending are refused
    const empty = tmp('batch-pending-none-');
    expect(JSON.parse(run(['proposals', 'batch', '--pending', '--out', 'b.json'], { ...io, cwd: empty }).stdout)).toMatchObject({ count: 0, ids: [] });
    expect(run(['proposals', 'batch', '--pending', P('scou'), '--out', 'b.json'], io).code).toBe(2);
  });
});
