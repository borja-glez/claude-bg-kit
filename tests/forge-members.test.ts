import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { normalizeMember, readMember, writeMember, listMembers, memberFile } from '../src/forge/members.js';

const T = '2026-10-12T12:00:00.000Z';
describe('members', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(path.join(tmpdir(), 'forge-members-')); });
  afterEach(() => rmSync(root, { recursive: true, force: true }));
  it('normalizes and drops junk', () => {
    expect(normalizeMember({ sessionId: 's2', role: 'manual', runId: 'r1', task: 'T009', name: 'me', since: T }))
      .toEqual({ sessionId: 's2', role: 'manual', runId: 'r1', task: 'T009', name: 'me', since: T });
    expect(normalizeMember({ sessionId: 's2', role: 'coordinator', runId: 'r1', since: T })).toBeNull();
    expect(normalizeMember({ sessionId: '../x', role: 'manual', runId: 'r1', since: T })).toBeNull();
    expect(normalizeMember({ sessionId: 's2', role: 'manual', runId: 'r1', task: 'nope!', since: T })?.task).toBeNull();
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
});
