import { describe, it, expect, beforeEach } from 'vitest';
import { writeFileSync, mkdirSync, existsSync, utimesSync } from 'node:fs';
import path from 'node:path';
import { normalizeMember, readMember, writeMember, listMembers, memberFile, isMemberId, findMemberByHook, memberForHook } from '../src/forge/members.js';
import { MEMBERS_MAX, newestMemberFiles } from '../src/lib/member-doc.js';
import { useTempDirs } from './helpers/tmp.js';
const tmp = useTempDirs();

const T = '2026-10-12T12:00:00.000Z';
describe('members', () => {
  let root: string;
  beforeEach(() => { root = tmp('forge-members-'); });
  it('normalizes and drops junk', () => {
    expect(normalizeMember({ sessionId: 's2', role: 'manual', runId: 'r1', task: 'T009', name: 'me', since: T }))
      .toEqual({ sessionId: 's2', role: 'manual', runId: 'r1', task: 'T009', name: 'me', since: T, hookSession: null });
    expect(normalizeMember({ sessionId: 's2', role: 'manual', runId: 'r1', since: T, hookSession: '0f3c-uuid' })?.hookSession).toBe('0f3c-uuid');
    expect(normalizeMember({ sessionId: 's2', role: 'manual', runId: 'r1', since: T, hookSession: 'a:b' })?.hookSession).toBeNull();
    expect(normalizeMember({ sessionId: 's2', role: 'coordinator', runId: 'r1', since: T })).toBeNull();
    expect(normalizeMember({ sessionId: '../x', role: 'manual', runId: 'r1', since: T })).toBeNull();
    expect(normalizeMember({ sessionId: 's2', role: 'manual', runId: 'r1', task: 'nope!', since: T })?.task).toBeNull();
  });
  it('readMember rejects a file whose sessionId differs from the requested one', () => {
    writeMember(root, { sessionId: 's2', role: 'manual', runId: 'r1', task: null, name: null, since: T });
    writeFileSync(memberFile(root, 's5'), JSON.stringify({ sessionId: 's2', role: 'manual', runId: 'r1', since: T }));
    expect(readMember(root, 's5')).toBeNull();
    expect(readMember(root, 's2')).not.toBeNull();
  });
  it('writes, reads and lists only the members of a run', () => {
    writeMember(root, { sessionId: 's2', role: 'executor', runId: 'r1', task: 'T002', name: 'wp-shop-T002', since: T });
    writeMember(root, { sessionId: 's3', role: 'manual', runId: 'old', task: null, name: null, since: T });
    mkdirSync(path.join(root, '.forge', 'members'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'members', 'junk.json'), '{oops');
    expect(readMember(root, 's2')?.task).toBe('T002');
    expect(readMember(root, 'missing')).toBeNull();
    expect(listMembers(root, 'r1').map(m => m.sessionId)).toEqual(['s2']);
    expect(memberFile(root, 's2')).toBe(path.join(root, '.forge', 'members', 's2.json'));
  });
  it('member ids follow one rule, and writeMember refuses any other', () => {
    expect(isMemberId('s2.a-b_c')).toBe(true);
    for (const bad of ['a:b', 'a@b', 'a+b', 'a~b', '../x', '', 'x'.repeat(121)]) expect(isMemberId(bad)).toBe(false);
    expect(() => writeMember(root, { sessionId: 'a:b', role: 'manual', runId: 'r1', task: null, name: null, since: T })).toThrow();
    expect(existsSync(path.join(root, '.forge', 'members'))).toBe(false);
    expect(() => writeMember(root, { sessionId: 's2', role: 'manual', runId: 'r1', task: null, name: null, since: T, hookSession: 'a:b' })).toThrow();
  });
  it('a hook finds a member by its recorded hook id, else by a direct lookup when the ids are equal', () => {
    writeMember(root, { sessionId: 't9', role: 'executor', runId: 'r1', task: 'T1', name: null, since: T, hookSession: 'hook-uuid' });
    writeMember(root, { sessionId: 's3', role: 'manual', runId: 'r1', task: null, name: null, since: T });
    writeMember(root, { sessionId: 's4', role: 'manual', runId: 'r1', task: null, name: null, since: T, hookSession: 'other' });
    expect(findMemberByHook(root, 'hook-uuid', 'r1')?.sessionId).toBe('t9');
    expect(findMemberByHook(root, 'hook-uuid', 'r2')).toBeNull();
    expect(findMemberByHook(root, 't9', 'r1')).toBeNull();
    expect(memberForHook(root, 'hook-uuid', 'r1')?.sessionId).toBe('t9');
    expect(memberForHook(root, 's3', 'r1')?.sessionId).toBe('s3');
    expect(memberForHook(root, 's3', 'r2')).toBeNull();
    expect(memberForHook(root, 's4', 'r1')).toBeNull();
    expect(memberForHook(root, '../x', 'r1')).toBeNull();
  });
  it("forge reads the member files the band and waypoint's hooks read: the 50 newest (2b carry)", () => {
    // m0 joined with one id for both (no hook id): a direct lookup by that id would still find it past the newest 50.
    for (let i = 0; i < 55; i++) {
      writeMember(root, { sessionId: `m${i}`, role: 'manual', runId: 'r1', task: null, name: null, since: T, hookSession: i === 0 ? null : `h${i}` });
      const at = new Date(Date.parse(T) + i * 1000);
      utimesSync(memberFile(root, `m${i}`), at, at);
    }
    expect(memberForHook(root, 'h54', 'r1')?.sessionId).toBe('m54');
    expect(memberForHook(root, 'h5', 'r1')?.sessionId).toBe('m5');
    for (const old of ['h4', 'h1', 'm0']) expect(memberForHook(root, old, 'r1'), old).toBeNull();
    const listed = listMembers(root, 'r1').map(m => m.sessionId);
    expect(listed).toHaveLength(MEMBERS_MAX);
    expect(listed).toContain('m54');
    expect(listed).not.toContain('m4');
    expect(findMemberByHook(root, 'h4', 'r1')).toBeNull();
  });
  it('a member file over 8 KiB is no member, for every reader', () => {
    writeMember(root, { sessionId: 's3', role: 'manual', runId: 'r1', task: null, name: null, since: T, hookSession: 'hook-3' });
    expect(memberForHook(root, 'hook-3', 'r1')?.sessionId).toBe('s3');
    // Still valid JSON, padded past FORGE_DOC_MAX_BYTES.
    writeFileSync(memberFile(root, 's3'), JSON.stringify({ sessionId: 's3', role: 'manual', runId: 'r1', task: null, name: null, since: T, hookSession: 'hook-3', pad: 'x'.repeat(8 * 1024) }));
    expect(memberForHook(root, 'hook-3', 'r1')).toBeNull();
    expect(memberForHook(root, 's3', 'r1')).toBeNull();
    expect(readMember(root, 's3')).toBeNull();
    expect(listMembers(root, 'r1')).toEqual([]);
  });
});

describe('newestMemberFiles: which member files the band and waypoint\'s hooks read (one rule)', () => {
  const f = (name: string, mtimeMs: number, size = 100) => ({ name, mtimeMs, size });
  it('the MEMBERS_MAX newest .json files of a safe name and at most 8 KiB, the newest first, by name on a tie', () => {
    const files = [f('b.json', 5), f('a.json', 5), f('old.json', 1), f('big.json', 9, 8 * 1024 + 1), f('edge.json', 8, 8 * 1024), f('notes.txt', 9), f('a b.json', 9), f('..json', 9)];
    expect(newestMemberFiles(files).map(x => x.name)).toEqual(['edge.json', 'a.json', 'b.json', 'old.json']);
    const many = Array.from({ length: 60 }, (_, i) => f(`m${i}.json`, i));
    const picked = newestMemberFiles(many).map(x => x.name);
    expect(picked).toHaveLength(MEMBERS_MAX);
    expect(picked[0]).toBe('m59.json');
    expect(picked).not.toContain('m9.json');
  });
});
