import { describe, it, expect, beforeEach } from 'vitest';
import { appendFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { run } from '../src/forge/cli/run.js';
import { startRun, saveRun, endRun, type RunState } from '../src/forge/run.js';
import { appendBlocked, blockedDecision, blockedFile, notedFile, type BlockedRecord } from '../src/forge/autonomous.js';
import { LIMITS } from '../src/lib/decisions.js';
import { useTempDirs } from './helpers/tmp.js';

const tmp = useTempDirs();
const T0 = new Date('2026-10-22T10:00:00.000Z');
let main: string;
const cli = (args: string[]) => run(['blocked', ...args], { cwd: main, now: () => T0, env: {} });
const rec = (rule: string, target: string, m: number): BlockedRecord => ({ ts: new Date(T0.getTime() + m * 60_000).toISOString(), rule, tool: 'Bash', target,
  reason: `forge autonomy · ${rule}: ${target} is not allowed. Instead: record it as not done`, session: 'coord-1' });
const state = (locale: string): RunState => ({ ...startRun(T0, { hours: 1 }, 10, 'coord-1', locale), autonomous: {
  profile: 'spike', name: 'x', runId: 'spike-x', worktree: path.join(main, '.claude', 'worktrees', 'spike-x'), branch: 'forge/spike-x', startBranch: 'main', protectedBranches: ['main'] } });
const autonomous = (locale: string) => saveRun(main, state(locale));
beforeEach(() => { main = tmp('blocked-'); mkdirSync(path.join(main, '.claude', 'worktrees', 'spike-x'), { recursive: true }); });

describe('forge blocked', () => {
  it('lists what the guard denied and how much is still to note', () => {
    autonomous('es');
    appendBlocked(main, 'spike-x', rec('git', 'git push', 0));
    expect(JSON.parse(cli(['list']).stdout)).toMatchObject({ runId: 'spike-x', blocked: [{ rule: 'git', target: 'git push' }], pending: 1 });
  });
  it('note turns each pending denial into one blocked decision with its note, in the run\'s language, and only once', () => {
    autonomous('es');
    appendBlocked(main, 'spike-x', rec('git', 'git push', 0));
    appendBlocked(main, 'spike-x', rec('network', 'npm publish', 1));
    const r = JSON.parse(cli(['note', '--session', 'main']).stdout);
    expect(r).toMatchObject({ noted: 2, decisions: [1, 2] });
    expect(r.publish).toHaveLength(2);
    expect(r.publish[0]).toMatchObject({ op: 'set', collection: 'notes', data: { type: 'decision', ts: rec('git', 'git push', 0).ts,
      decision: { point: 'blocked', what: 'Bash: git push', chosen: 'no se hizo', alternatives: [{ option: 'hacerlo', whyNot: expect.stringMatching(/^forge autonomy · git: /) }], auto: true } } });
    expect(JSON.parse(cli(['note', '--session', 'main']).stdout)).toMatchObject({ noted: 0, decisions: [], publish: [] });
    expect(JSON.parse(cli(['list']).stdout).pending).toBe(0);
  });
  it('speaks English for a run in English, and prints no writes without --session', () => {
    autonomous('en');
    appendBlocked(main, 'spike-x', rec('git', 'git push', 0));
    const r = JSON.parse(cli(['note']).stdout);
    expect(r).not.toHaveProperty('publish');
    expect(JSON.parse(run(['decision', 'show', String(r.decisions[0])], { cwd: main, now: () => T0, env: {} }).stdout)).toMatchObject({ point: 'blocked', chosen: 'not done', runId: 'spike-x' });
  });
  it('is exit 2 without an autonomous run', () => {
    saveRun(main, startRun(T0, { hours: 1 }, 10, 'coord-1'));
    expect(cli(['list']).code).toBe(2);
    expect(cli(['note']).code).toBe(2);
  });
  it('notes every denial past the list\'s cap of 1000 lines (M8)', () => {
    autonomous('en');
    for (let i = 0; i < 1005; i++) appendBlocked(main, 'spike-x', rec('git', `git push origin b${i}`, i));
    expect(JSON.parse(cli(['note']).stdout).noted).toBe(1005);
    expect(JSON.parse(cli(['note']).stdout).noted).toBe(0);
  });
  it('a blocked decision carries no secret, whoever wrote the record (M7)', () => {
    const d = blockedDecision({ ...rec('database', 'psql postgres://u:hunter2@db.example.com/x -c "drop table t"', 0), session: null }, false);
    expect(JSON.stringify(d)).not.toContain('hunter2');
    const r = blockedDecision({ ...rec('network', 'curl x', 0), reason: 'forge autonomy · network: PGPASSWORD=hunter3 psql is not allowed' }, false);
    expect(JSON.stringify(r)).not.toContain('hunter3');
  });
  it('has the undo shape and cuts what to the limit', () => {
    expect(blockedDecision(rec('git', 'git push', 0), true)).toMatchObject({ by: 'auto', undo: { type: 'none', reason: 'no se hizo nada' } });
    expect(blockedDecision(rec('git', 'git push', 0), false)).toMatchObject({ undo: { type: 'none', reason: 'nothing was done' } });
    expect((blockedDecision(rec('git', 'x'.repeat(500), 0), false).what as string).length).toBe(LIMITS.what);
  });
  it('a bad record never stops the denials after it from being noted (T10-POISON)', () => {
    autonomous('en');
    appendBlocked(main, 'spike-x', { ...rec('git', 'git push', 0), reason: '' });
    // a line the hook did not write: appendBlocked itself would refuse a target that is not text
    appendFileSync(blockedFile(main, 'spike-x'), JSON.stringify({ ...rec('git', 'x', 1), target: 42, tool: '' }) + '\n');
    appendBlocked(main, 'spike-x', rec('network', 'npm publish', 2));
    const r = JSON.parse(cli(['note']).stdout);
    expect(r.noted + r.skipped.length).toBe(3);
    expect(r.decisions).toHaveLength(r.noted);
    expect(JSON.parse(cli(['list']).stdout).pending).toBe(0);
    expect(JSON.parse(cli(['note']).stdout)).toMatchObject({ noted: 0, decisions: [], skipped: [] });
    expect(blockedDecision({ ...rec('git', 'x', 0), reason: '', tool: '' }, false)).toMatchObject({ what: 'unknown: x', why: 'forge autonomy · git: no reason was recorded' });
  });
  it('a note interrupted before markNoted reuses the same decisions the next time', () => {
    autonomous('en');
    appendBlocked(main, 'spike-x', rec('git', 'git push', 0));
    const first = JSON.parse(cli(['note']).stdout);
    rmSync(notedFile(main, 'spike-x'));
    expect(JSON.parse(cli(['note']).stdout)).toMatchObject({ noted: 1, decisions: first.decisions });
    expect(JSON.parse(run(['decision', 'list', '--all'], { cwd: main, now: () => T0, env: {} }).stdout)).toHaveLength(1);
  });
  it('a failure that is not a bad record leaves the denial pending for the next note (T10-NARROW-CATCH)', () => {
    autonomous('en');
    appendBlocked(main, 'spike-x', rec('git', 'git push', 0));
    // a directory where the ledger goes: addDecision throws a plain error (no DecisionInputError), as a busy ledger would
    const ledger = path.join(main, '.forge', 'ledger.jsonl');
    mkdirSync(ledger, { recursive: true });
    const failed = cli(['note']);
    expect(failed.code).toBe(1);
    expect(JSON.parse(cli(['list']).stdout).pending).toBe(1);
    rmSync(ledger, { recursive: true });
    expect(JSON.parse(cli(['note']).stdout)).toMatchObject({ noted: 1, decisions: [1], skipped: [] });
    expect(JSON.parse(cli(['list']).stdout).pending).toBe(0);
  });
  it('a record after a torn last line starts on a line of its own (T10-TORN-LINE)', () => {
    autonomous('en');
    appendBlocked(main, 'spike-x', rec('git', 'git push', 0));
    appendFileSync(blockedFile(main, 'spike-x'), '{"ts":"2026-10-22T10:01:00.000Z","rule":"git","to');
    appendBlocked(main, 'spike-x', rec('network', 'npm publish', 2));
    expect(readFileSync(blockedFile(main, 'spike-x'), 'utf8').split('\n').filter(Boolean)).toHaveLength(3);
    expect(JSON.parse(cli(['list']).stdout).blocked.map((b: BlockedRecord) => b.target)).toEqual(['git push', 'npm publish']);
  });
  it('list and note work on a run that is no longer active', () => {
    saveRun(main, endRun(state('en'), 'done'));
    appendBlocked(main, 'spike-x', rec('git', 'git push', 0));
    expect(JSON.parse(cli(['list']).stdout).pending).toBe(1);
    expect(JSON.parse(cli(['note']).stdout).noted).toBe(1);
  });
});
