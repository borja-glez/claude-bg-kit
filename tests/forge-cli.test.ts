import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run, defaultExec, type Io } from '../src/forge/cli/run.js';
import { readEvents } from '../src/forge/ledger.js';
import { saveProposal, loadProposals } from '../src/forge/proposals.js';
import type { ProposalDoc } from '../src/lib/proposals.js';
import { parsePlan } from '../src/lib/plan.js';

let root: string;
let io: Io;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'forge-cli-'));
  io = { cwd: root, now: () => new Date('2026-10-11T10:00:00.000Z') };
});

describe('forge CLI', () => {
  it('log appends an event with the given kind, task and data', () => {
    const r = run(['log', '--kind', 'phase', '--task', 't1', '--data', '{"phase":"implement"}'], io);
    expect(r.code).toBe(0);
    expect(readEvents(root)).toEqual([{ ts: '2026-10-11T10:00:00.000Z', kind: 'phase', task: 't1', phase: 'implement' }]);
  });
  it('log refuses an unknown kind and non-object data', () => {
    expect(run(['log', '--kind', 'nope'], io).code).toBe(2);
    expect(run(['log', '--kind', 'phase', '--data', '[1]'], io).code).toBe(2);
  });
  it('log reads the JSON object from --data-file with the same validation', () => {
    writeFileSync(path.join(root, 'd.json'), '{"phase":"review","brief":2}');
    writeFileSync(path.join(root, 'bad.json'), '[1]');
    expect(run(['log', '--kind', 'phase', '--task', 't1', '--data-file', 'd.json'], io).code).toBe(0);
    expect(readEvents(root).at(-1)).toMatchObject({ kind: 'phase', task: 't1', phase: 'review', brief: 2 });
    expect(run(['log', '--kind', 'phase', '--data-file', 'bad.json'], io).code).toBe(2);
    expect(run(['log', '--kind', 'phase', '--data-file', 'missing.json'], io).code).toBe(2);
    expect(run(['log', '--kind', 'phase', '--data', '{}', '--data-file', 'd.json'], io).code).toBe(2);
  });
  it('verdict reads the reviews in a folder, the validator results, and logs the action', () => {
    const dir = path.join(root, 'reviews');
    mkdirSync(dir);
    writeFileSync(path.join(dir, 'correctness.json'), '{"verdict":"pass","confidence":1,"findings":[]}');
    writeFileSync(path.join(dir, 'security.json'), 'not json');
    writeFileSync(path.join(root, 'validators.json'), JSON.stringify([{ validator: 'test', ok: true, flaky: false, durationMs: 1, failures: [] }]));
    const r = run(['verdict', '--task', 't1', '--dir', 'reviews', '--validators', 'validators.json', '--sensitive'], io);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out).toMatchObject({ action: 'accept', score: 1 });
    expect(out.reviewers.map((x: { name: string; verdict: string }) => [x.name, x.verdict])).toEqual([['correctness', 'pass'], ['security', 'abstain']]);
    expect(readEvents(root).at(-1)).toMatchObject({ kind: 'verdict', task: 't1', dir: 'reviews', action: 'accept', score: 1 });
  });
  it('verdict reports invalid reviewers', () => {
    const dir = path.join(root, 'reviews');
    mkdirSync(dir);
    writeFileSync(path.join(dir, 'correctness.json'), '{"verdict":"pass","confidence":"0.9","findings":[]}');
    writeFileSync(path.join(dir, 'security.json'), 'I could not finish the review.');
    writeFileSync(path.join(root, 'validators.json'), '[]');
    const out = JSON.parse(run(['verdict', '--task', 't1', '--dir', 'reviews', '--validators', 'validators.json'], io).stdout);
    expect(out.reviewers.map((x: { name: string; invalid: boolean }) => [x.name, x.invalid])).toEqual([['correctness', false], ['security', true]]);
  });
  it('verdict without --validators and no validate event says no validation was recorded', () => {
    const dir = path.join(root, 'r');
    mkdirSync(dir);
    writeFileSync(path.join(dir, 'correctness.json'), '{"verdict":"pass","confidence":1,"findings":[]}');
    const out = JSON.parse(run(['verdict', '--task', 't1', '--dir', 'r'], io).stdout);
    expect(out.action).toBe('fix');
    expect(out.reasons).toContain('no validation recorded');
    run(['log', '--kind', 'validate', '--task', 't1', '--data', '{"ok":true}'], io);
    expect(JSON.parse(run(['verdict', '--task', 't1', '--dir', 'r'], io).stdout).reasons).not.toContain('no validation recorded');
  });
  it('a verdict re-run on the same review dir counts once (resuming does not stall the loop)', () => {
    const dir = path.join(root, 'reviews-1-1');
    mkdirSync(dir);
    writeFileSync(path.join(dir, 'correctness.json'), '{"verdict":"fail","confidence":1,"findings":[{"severity":"important","file":"a.ts","problem":"bug"}]}');
    writeFileSync(path.join(root, 'v.json'), '[]');
    for (let i = 0; i < 2; i++) expect(run(['verdict', '--task', 't1-1', '--dir', 'reviews-1-1', '--validators', 'v.json'], io).code).toBe(0);
    const r = JSON.parse(run(['round', '--task', 't1-1', '--path', 'medium'], io).stdout);
    expect(r).toMatchObject({ round: 1, next: 'resume' });
  });
  it('verdict without --validators treats validators as passing only if the ledger says so', () => {
    run(['log', '--kind', 'validate', '--task', 't1', '--data', '{"ok":false}'], io);
    const dir = path.join(root, 'r');
    mkdirSync(dir);
    writeFileSync(path.join(dir, 'correctness.json'), '{"verdict":"pass","confidence":1,"findings":[]}');
    expect(JSON.parse(run(['verdict', '--task', 't1', '--dir', 'r'], io).stdout).action).toBe('fix');
  });
  it('round decides from the task verdict history and logs it', () => {
    for (const s of ['0.6', '0.6']) run(['log', '--kind', 'verdict', '--task', 't1', '--data', `{"action":"fix","score":${s},"signature":"x"}`], io);
    const r = JSON.parse(run(['round', '--task', 't1', '--path', 'medium'], io).stdout);
    expect(r.next).toBe('stalled');
    expect(readEvents(root).at(-1)).toMatchObject({ kind: 'round', task: 't1', next: 'stalled' });
  });
  it('verdict with no reviews in the folder is a usage error', () => {
    mkdirSync(path.join(root, 'empty'));
    expect(run(['verdict', '--task', 't1', '--dir', 'empty'], io).code).toBe(2);
    expect(run(['verdict', '--task', 't1', '--dir', 'missing'], io).code).toBe(2);
  });
  it('round honours --path large (cap 4)', () => {
    for (const sig of ['a', 'b', 'c', 'd']) run(['log', '--kind', 'verdict', '--task', 't1', '--data', `{"action":"fix","score":0.6,"signature":"${sig}"}`], io);
    expect(JSON.parse(run(['round', '--task', 't1', '--path', 'large'], io).stdout)).toMatchObject({ cap: 4, next: 'fresh-stronger', tierUp: true });
  });
  it('round refuses a path other than medium or large', () => {
    expect(run(['round', '--task', 't1', '--path', 'small'], io).code).toBe(2);
  });
  it('agents prints the role map for the configured profile', () => {
    mkdirSync(path.join(root, '.forge'));
    writeFileSync(path.join(root, '.forge', 'config.yaml'), 'profile: economy\n');
    const map = JSON.parse(run(['agents'], io).stdout);
    expect(map.profile).toBe('economy');
    expect(map.agents['impl-heavy']).toBe('forge-impl');
  });
  it('last summarizes one task from the ledger', () => {
    run(['log', '--kind', 'triage', '--task', 't1', '--data', '{"path":"medium"}'], io);
    run(['log', '--kind', 'phase', '--task', 't1', '--data', '{"phase":"review"}'], io);
    run(['log', '--kind', 'phase', '--task', 't2', '--data', '{"phase":"implement"}'], io);
    const s = JSON.parse(run(['last', '--task', 't1'], io).stdout);
    expect(s).toMatchObject({ task: 't1', path: 'medium', phase: { kind: 'phase', phase: 'review' }, events: 2 });
  });
  it('last returns the whole last phase event, brief included', () => {
    run(['log', '--kind', 'phase', '--task', 't1', '--data', '{"phase":"implement","brief":1}'], io);
    run(['log', '--kind', 'phase', '--task', 't1', '--data', '{"phase":"review","brief":2}'], io);
    expect(JSON.parse(run(['last', '--task', 't1'], io).stdout).phase).toEqual({ ts: '2026-10-11T10:00:00.000Z', kind: 'phase', task: 't1', phase: 'review', brief: 2 });
  });
  it('last without --task is a usage error', () => {
    expect(run(['last'], io).code).toBe(2);
  });
  it('log --data cannot override ts or kind', () => {
    run(['log', '--kind', 'phase', '--task', 't1', '--data', '{"ts":"forged","kind":"verdict","phase":"x"}'], io);
    expect(readEvents(root).at(-1)).toEqual({ ts: '2026-10-11T10:00:00.000Z', kind: 'phase', task: 't1', phase: 'x' });
  });
  it('a broken config.yaml is a clear error, exit 2', () => {
    mkdirSync(path.join(root, '.forge'));
    writeFileSync(path.join(root, '.forge', 'config.yaml'), 'profile: turbo\n');
    const r = run(['agents'], io);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('config.yaml');
  });
  it('triage reads the repo through git without a shell and logs the result', () => {
    const calls: string[][] = [];
    io.git = args => {
      calls.push(args);
      if (args.includes('ls-files')) return 'src/a.ts\nsrc/b.ts\nsrc/c.ts\nsrc/d.ts\nsrc/e.ts\n';
      if (args[0] === 'rev-list') return '12\n';
      if (args.includes('grep')) return 'src/a.ts\n';
      return '';
    };
    const task = 'fix `$HOME` handling in parseConfig; rm -rf "x"';
    const r = run(['triage', task], io);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.path).toBe('trivial');
    // The backticked `$HOME` is grepped too, as a fixed string and without a shell.
    expect(calls).toContainEqual(['-c', 'core.quotePath=false', 'ls-files']);
    expect(calls.filter(c => c.includes('grep'))).toEqual(expect.arrayContaining([
      ['-c', 'core.quotePath=false', 'grep', '-l', '-I', '--fixed-strings', '-w', '-e', 'parseConfig'],
      ['-c', 'core.quotePath=false', 'grep', '-l', '-I', '--fixed-strings', '-w', '-e', '$HOME'],
    ]));
    expect(readEvents(root).at(-1)).toMatchObject({ kind: 'triage', path: 'trivial' });
  });
  it('triage reads the task text from --text-file', () => {
    io.git = () => '';
    writeFileSync(path.join(root, 'task.txt'), 'rename `foo` to bar; $(rm -rf x)\n');
    const r = run(['triage', '--task', 't1', '--text-file', 'task.txt'], io);
    expect(r.code).toBe(0);
    expect(readEvents(root).at(-1)).toMatchObject({ kind: 'triage', task: 't1' });
    expect(run(['triage', '--text-file', 'nope.txt'], io).code).toBe(2);
  });
  it('triage --task takes the id out of the task text and logs it', () => {
    const grepped: string[] = [];
    io.git = args => { if (args.includes('grep')) grepped.push(args.at(-1)!); return args.includes('ls-files') ? 'a\nb\nc\nd\ne\n' : '3\n'; };
    const r = run(['triage', '--task', 'myTaskId', 'rename', 'fooBar'], io);
    expect(r.code).toBe(0);
    expect(grepped).toEqual(['fooBar']);
    expect(readEvents(root).at(-1)).toMatchObject({ kind: 'triage', task: 'myTaskId' });
  });
  it('triage of the same task never lowers the path an earlier triage reached', () => {
    run(['log', '--kind', 'triage', '--task', 'rt', '--data', '{"path":"large"}'], io);
    const out = JSON.parse(run(['triage', '--task', 'rt', 'add a dark mode toggle'], io).stdout);
    expect(out.path).toBe('large');
    expect(out.reasons.join(' ')).toMatch(/ratchet/);
    expect(JSON.parse(run(['triage', '--task', 'other', 'add a dark mode toggle'], io).stdout).path).not.toBe('large');
  });
  it('triage with git failing is not greenfield and says git is unavailable', () => {
    io.git = () => null;
    const out = JSON.parse(run(['triage', 'add a dark mode toggle'], io).stdout);
    expect(out).toMatchObject({ greenfield: false, path: 'small' });
    expect(out.reasons).toContain('git unavailable');
  });
  it('triage on a repository without commits (rev-list fails) is greenfield', () => {
    io.git = args => (args.includes('ls-files') ? '' : null);
    expect(JSON.parse(run(['triage', 'build a todo app'], io).stdout)).toMatchObject({ greenfield: true, path: 'large' });
  });
  it('triage needs the task text', () => {
    expect(run(['triage'], io).code).toBe(2);
  });
  it('a flag without a value is a usage error', () => {
    expect(run(['last', '--task', '--data', 'x'], io).code).toBe(2);
  });
  it('unknown command prints usage, exit 2', () => {
    expect(run(['bogus'], io).code).toBe(2);
  });
  it('validate runs the selected validators, logs them and exits 1 on a failure', () => {
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run', build: 'esbuild' } }));
    const ran: string[] = [];
    io.exec = cmd => { ran.push(cmd); return { code: cmd === 'npm test' ? 1 : 0, output: 'FAIL x', ms: 3, timedOut: false }; };
    const r = run(['validate', '--affected', 'src/a.ts', '--task', 't1'], io);
    expect(ran).toEqual(['npm test', 'npm test']);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout)).toEqual([{ validator: 'test', ok: false, flaky: false, durationMs: 6, failures: ['FAIL x'] }]);
    expect(readEvents(root).at(-1)).toMatchObject({ kind: 'validate', task: 't1', ok: false });
  });
  it('validate with no validators prints [] and says so', () => {
    const r = run(['validate', '--all'], io);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual([]);
    expect(r.stderr).toContain('no validators');
  });
  it('validate says so when no validator covers the affected paths', () => {
    mkdirSync(path.join(root, '.forge'));
    writeFileSync(path.join(root, '.forge', 'config.yaml'), 'validators:\n  - name: e2e\n    cmd: npm run e2e\n    affects: ["web/**"]\n');
    io.exec = () => { throw new Error('must not run'); };
    const r = run(['validate', '--affected', 'src/a.ts'], io);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual([]);
    expect(r.stderr).toBe('no validators cover the affected paths\n');
  });
});

describe('forge infinite', () => {
  const runFile = () => path.join(root, '.forge', 'run.json');
  const readRun = () => JSON.parse(readFileSync(runFile(), 'utf8'));
  const hook = (stdin: string) => run(['hook', 'stop'], { ...io, stdin });
  const touchStop = () => { mkdirSync(path.join(root, '.forge'), { recursive: true }); writeFileSync(path.join(root, '.forge', 'stop'), 'x\n'); };
  const ended = (reason: string) => ({ decision: 'block', reason: `the forge infinite run ended (${reason}): do step 4 of /forge:infinite (turn off meta/infinite and report), then stop` });
  it('infinite start writes run.json and refuses a second start', () => {
    expect(run(['infinite', 'start', '--cycles', '3'], io).code).toBe(0);
    expect(readRun()).toMatchObject({ mode: 'infinite', active: true, budget: { cycles: 3 }, cycle: 0, queueMax: 10, blocksSinceCycle: 0 });
    expect(run(['infinite', 'start', '--cycles', '3'], io).code).toBe(2);
  });
  it('infinite start requires a budget', () => {
    const r = run(['infinite', 'start'], io);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('budget');
    expect(run(['infinite', 'start', '--queue-max', '3'], io).code).toBe(2);
    expect(existsSync(runFile())).toBe(false);
    expect(run(['infinite', 'start', '--hours', '2'], io).code).toBe(0);
  });
  it('infinite start refuses bad budgets and removes a stale stop file', () => {
    expect(run(['infinite', 'start', '--cycles', '-1'], io).code).toBe(2);
    expect(run(['infinite', 'start', '--hours', 'x'], io).code).toBe(2);
    expect(run(['infinite', 'start', '--cycles', '2', '--queue-max', '0'], io).code).toBe(2);
    expect(run(['stop'], io).code).toBe(0);
    expect(existsSync(path.join(root, '.forge', 'stop'))).toBe(true);
    expect(run(['infinite', 'start', '--hours', '1.5', '--queue-max', '4'], io).code).toBe(0);
    expect(existsSync(path.join(root, '.forge', 'stop'))).toBe(false);
    expect(readRun()).toMatchObject({ budget: { hours: 1.5 }, queueMax: 4 });
  });
  it('infinite status reports the run, a corrupt file and the computed stop reason', () => {
    expect(JSON.parse(run(['infinite', 'status'], io).stdout)).toMatchObject({ present: false, valid: false, run: null, stopReason: null });
    run(['infinite', 'start', '--cycles', '3'], io);
    expect(JSON.parse(run(['infinite', 'status'], io).stdout)).toMatchObject({ present: true, valid: true, run: { active: true }, stopReason: null });
    touchStop();
    expect(JSON.parse(run(['infinite', 'status'], io).stdout).stopReason).toBe('stop-file');
    writeFileSync(runFile(), '{"mode":"infinite","budget":{"cycles":-3}}');
    expect(JSON.parse(run(['infinite', 'status'], io).stdout)).toMatchObject({ present: true, valid: false, run: null });
    expect(hook('{}').stdout).toBe('');
    expect(run(['infinite', 'start', '--cycles', '1'], io).code).toBe(0);
  });
  it('forge stop closes the run itself, logs it and keeps the stop file', () => {
    run(['infinite', 'start', '--cycles', '3'], io);
    expect(run(['stop'], io).code).toBe(0);
    expect(readRun()).toMatchObject({ active: false, stoppedReason: 'stopped' });
    expect(existsSync(path.join(root, '.forge', 'stop'))).toBe(true);
    expect(readEvents(root).at(-1)).toMatchObject({ kind: 'cycle', action: 'stopped', reason: 'stopped' });
    // The bound session, if alive, then exits without a block; a second stop logs nothing more.
    expect(hook('{}').stdout).toBe('');
    run(['stop'], io);
    expect(readEvents(root).filter(e => e.action === 'stopped')).toHaveLength(1);
  });
  it('a run whose bound session died can be stopped and replaced', () => {
    run(['infinite', 'start', '--cycles', '3'], io);
    expect(JSON.parse(hook('{"session_id":"dead"}').stdout).decision).toBe('block');
    expect(run(['infinite', 'start', '--cycles', '2'], io).code).toBe(2);
    expect(run(['stop'], io).code).toBe(0);
    const r = run(['infinite', 'start', '--cycles', '2', '--session', 'new'], io);
    expect(r.code).toBe(0);
    expect(readRun()).toMatchObject({ active: true, budget: { cycles: 2 }, sessionId: 'new', cycle: 0 });
    expect(existsSync(path.join(root, '.forge', 'stop'))).toBe(false);
  });
  it('infinite start replaces an active run whose stop reason is due', () => {
    run(['infinite', 'start', '--hours', '1'], io);
    expect(JSON.parse(hook('{"session_id":"dead"}').stdout).decision).toBe('block');
    const later = { ...io, now: () => new Date(Date.parse('2026-10-11T10:00:00.000Z') + 2 * 3600_000) };
    expect(run(['infinite', 'start', '--cycles', '1'], later).code).toBe(0);
    expect(readRun()).toMatchObject({ active: true, budget: { cycles: 1 }, sessionId: null });
    // A stale stop file also makes an active run replaceable, and the new start removes it.
    touchStop();
    expect(run(['infinite', 'start', '--cycles', '4'], io).code).toBe(0);
    expect(existsSync(path.join(root, '.forge', 'stop'))).toBe(false);
  });
  it('hook stop blocks an active run; when .forge/stop appears it ends the run and blocks once to close it', () => {
    run(['infinite', 'start', '--cycles', '3'], io);
    const r = hook('{"stop_hook_active":false}');
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.decision).toBe('block');
    expect(out.reason).toContain('forge infinite mode is active (cycle 1 of 3)');
    expect(readRun()).toMatchObject({ lastBlockEvents: 0, blocksSinceCycle: 1 });
    expect(hook('{"stop_hook_active":true}').stdout).toBe('');
    touchStop();
    expect(JSON.parse(hook('{"stop_hook_active":true}').stdout)).toEqual(ended('stop-file'));
    expect(readEvents(root).at(-1)).toMatchObject({ kind: 'cycle', action: 'stopped', reason: 'stop-file' });
    expect(readRun()).toMatchObject({ active: false, stoppedReason: 'stop-file' });
    expect(hook('{"stop_hook_active":true}').stdout).toBe('');
    expect(hook('{"stop_hook_active":false}').stdout).toBe('');
    expect(readEvents(root).filter(e => e.action === 'stopped')).toHaveLength(1);
  });
  it('hook stop prints nothing for garbage stdin or no run', () => {
    expect(hook('{"stop_hook_active":false}')).toEqual({ code: 0, stdout: '', stderr: '' });
    run(['infinite', 'start', '--cycles', '3'], io);
    for (const s of ['', 'garbage', '[1]', 'null']) expect(hook(s)).toEqual({ code: 0, stdout: '', stderr: '' });
    expect(readRun().lastBlockEvents).toBeNull();
    expect(run(['hook', 'other'], { ...io, stdin: '{}' })).toEqual({ code: 0, stdout: '', stderr: '' });
  });
  it('hook stop prints nothing when run.json cannot be written (fail-open)', () => {
    run(['infinite', 'start', '--cycles', '3'], io);
    const text = readFileSync(runFile(), 'utf8');
    // A directory where the temp file would go makes saveRun throw.
    mkdirSync(`${runFile()}.${process.pid}.tmp`);
    expect(hook('{}')).toEqual({ code: 0, stdout: '', stderr: '' });
    expect(readFileSync(runFile(), 'utf8')).toBe(text);
  });
  it('cycle records the cycle in run.json and the ledger; 3 without progress end the run', () => {
    expect(run(['cycle', '--progress', 'no'], io).code).toBe(2);
    run(['infinite', 'start', '--cycles', '9'], io);
    expect(run(['cycle', '--progress', 'maybe'], io).code).toBe(2);
    writeFileSync(path.join(root, 'err.txt'), 'tests broke\n');
    for (let i = 0; i < 3; i++) expect(run(['cycle', '--progress', 'no', ...(i === 0 ? ['--error-file', 'err.txt'] : [])], io).code).toBe(0);
    expect(readRun()).toMatchObject({ cycle: 3, noProgress: 3 });
    expect(readEvents(root).filter(e => e.kind === 'cycle')).toHaveLength(3);
    expect(readEvents(root).find(e => e.kind === 'cycle')).toMatchObject({ cycle: 1, progress: false, error: 'tests broke' });
    expect(JSON.parse(hook('{"stop_hook_active":false}').stdout)).toEqual(ended('no-progress'));
    expect(readRun()).toMatchObject({ active: false, stoppedReason: 'no-progress' });
  });
  it('2 blocks without a recorded cycle end the run with no-cycle; a cycle resets the count', () => {
    run(['infinite', 'start', '--cycles', '9'], io);
    expect(JSON.parse(hook('{}').stdout).decision).toBe('block');
    run(['cycle', '--progress', 'yes'], io);
    expect(readRun().blocksSinceCycle).toBe(0);
    expect(JSON.parse(hook('{}').stdout).decision).toBe('block');
    run(['log', '--kind', 'phase', '--task', 't'], io);
    expect(JSON.parse(hook('{"stop_hook_active":true}').stdout).decision).toBe('block');
    expect(readRun().blocksSinceCycle).toBe(2);
    run(['log', '--kind', 'phase', '--task', 't'], io);
    expect(JSON.parse(hook('{"stop_hook_active":true}').stdout)).toEqual(ended('no-cycle'));
    expect(hook('{}').stdout).toBe('');
  });
  it('hook stop counts every approved proposal not done, with or without a task, against the pending queue', () => {
    run(['infinite', 'start', '--cycles', '9', '--queue-max', '2'], io);
    const doc = (status: ProposalDoc['status'], taskId?: string): ProposalDoc => ({ ts: '2026-10-11T09:00:00.000Z', category: 'quality', risk: 'low', title: 't', rationale: '', evidence: '', pillar: '', status, source: 'scout', author: 's', ...(taskId ? { taskId } : {}) });
    saveProposal(root, 'p20261011090000aaaa', doc('proposed'));
    saveProposal(root, 'p20261011090000aaab', doc('discussing'));
    saveProposal(root, 'p20261011090000aaac', doc('approved'));
    expect(JSON.parse(hook('{}').stdout).decision).toBe('block');
    run(['cycle', '--progress', 'yes'], io);
    saveProposal(root, 'p20261011090000aaac', doc('auto_approved', 'T002'));
    expect(JSON.parse(hook('{}').stdout).reason).toContain('forge infinite mode is active');
    run(['cycle', '--progress', 'yes'], io);
    saveProposal(root, 'p20261011090000aaac', doc('done', 'T002'));
    expect(JSON.parse(hook('{}').stdout)).toEqual(ended('queue-full'));
    expect(readRun().stoppedReason).toBe('queue-full');
  });
  it('hook stop binds the run to one session; infinite start --session binds up front', () => {
    run(['infinite', 'start', '--cycles', '9'], io);
    expect(JSON.parse(hook('{"session_id":"s1"}').stdout).decision).toBe('block');
    expect(readRun().sessionId).toBe('s1');
    const before = readFileSync(runFile(), 'utf8');
    expect(hook('{"session_id":"s2"}').stdout).toBe('');
    expect(hook('{}').stdout).toBe('');
    expect(readFileSync(runFile(), 'utf8')).toBe(before);
    run(['cycle', '--progress', 'yes'], io);
    expect(JSON.parse(hook('{"session_id":"s1"}').stdout).decision).toBe('block');
    touchStop();
    expect(hook('{"session_id":"s2"}').stdout).toBe('');
    expect(readRun().active).toBe(true);
    expect(JSON.parse(hook('{"session_id":"s1"}').stdout)).toEqual(ended('stop-file'));
    expect(run(['infinite', 'start', '--cycles', '1', '--session'], { ...io, cwd: mkdtempSync(path.join(tmpdir(), 'forge-cli-')) }).code).toBe(2);
    const other = mkdtempSync(path.join(tmpdir(), 'forge-cli-'));
    expect(run(['infinite', 'start', '--cycles', '1', '--session', 'abc'], { ...io, cwd: other }).code).toBe(0);
    expect(run(['hook', 'stop'], { ...io, cwd: other, stdin: '{"session_id":"zzz"}' }).stdout).toBe('');
    expect(JSON.parse(run(['hook', 'stop'], { ...io, cwd: other, stdin: '{"session_id":"abc"}' }).stdout).decision).toBe('block');
  });
});

describe('defaultExec', () => {
  it('runs a passing command and captures its output', () => {
    const r = defaultExec(root)(`node -e "console.log('hello')"`, 30);
    expect(r).toMatchObject({ code: 0, timedOut: false });
    expect(r.output).toContain('hello');
  });
  it('reports a failing command with its stdout and stderr', () => {
    const r = defaultExec(root)(`node -e "console.log('out');console.error('boom');process.exit(3)"`, 30);
    expect(r).toMatchObject({ code: 3, timedOut: false });
    expect(r.output).toContain('out');
    expect(r.output).toContain('boom');
  });
  it('times out a hanging command, returns promptly and kills its whole process tree', async () => {
    const marker = path.join(root, 'marker');
    writeFileSync(path.join(root, 'grandchild.js'), `setTimeout(() => require('fs').writeFileSync(${JSON.stringify(marker)}, 'alive'), 3000);\n`);
    writeFileSync(path.join(root, 'child.js'), `require('child_process').spawn(process.execPath, [${JSON.stringify(path.join(root, 'grandchild.js'))}], { stdio: 'ignore' });\nsetTimeout(() => {}, 10000);\n`);
    const t0 = Date.now();
    const r = defaultExec(root)('node child.js', 1);
    expect(r.timedOut).toBe(true);
    expect(Date.now() - t0).toBeLessThan(4000);
    await new Promise(res => setTimeout(res, 3500));
    expect(existsSync(marker)).toBe(false);
  }, 15000);
  it('a command that starts with a dash goes to the shell, not to node', () => {
    const r = defaultExec(root)('--help', 30);
    expect(r.code).not.toBe(0);
    expect(r.output).not.toMatch(/Usage: node/);
  });
  it('a command whose own exit code is 124 is not a timeout', () => {
    const r = defaultExec(root)(`node -e "process.exit(124)"`, 30);
    expect(r).toMatchObject({ code: 124, timedOut: false });
  });
  it('explains a spawn error such as a missing working directory', () => {
    const r = defaultExec(path.join(root, 'does-not-exist'))(`node -e "0"`, 30);
    expect(r.code).not.toBe(0);
    expect(r.timedOut).toBe(false);
    expect(r.output).toMatch(/ENOENT/);
  });
  it('truncates a flood of output to the last 4 MiB', () => {
    const r = defaultExec(root)(`node -e "process.stdout.write('x'.repeat(5*1024*1024)+'END')"`, 30);
    expect(r.code).toBe(0);
    expect(r.output.startsWith('[output truncated]\n')).toBe(true);
    expect(r.output.endsWith('END')).toBe(true);
    expect(r.output.length).toBe('[output truncated]\n'.length + 4 * 1024 * 1024);
  });
});

const PLAN_YAML = `project: shop
version: "0.1"
tracks: [{ id: backend, name: Backend, color: blue }]
phases: [{ id: F1, name: Base }]
tasks:
  - id: T001
    title: Login with password
    track: backend
    phase: F1
    done_when: users can log in
    zones: ["src/auth/**"]
`;
it('brief prints the plan task, exit 2 for an unknown task or a broken plan', () => {
  writeFileSync(path.join(root, 'plan.yaml'), PLAN_YAML);
  const r = run(['brief', '--plan', 'plan.yaml', '--task', 'T001'], io);
  expect(r.code).toBe(0);
  expect(r.stdout).toContain('# T001: Login with password');
  const missing = run(['brief', '--plan', 'plan.yaml', '--task', 'T999'], io);
  expect(missing.code).toBe(2);
  expect(missing.stderr).toContain('T999');
  writeFileSync(path.join(root, 'bad.yaml'), 'project: [');
  const bad = run(['brief', '--plan', 'bad.yaml', '--task', 'T001'], io);
  expect(bad.code).toBe(2);
  expect(bad.stderr).toContain('YAML');
});
it('triage --plan without a value is a usage error, not free text', () => {
  expect(run(['triage', '--plan'], io).code).toBe(2);
  expect(run(['triage', '--plan', '--task', 'T001'], io).code).toBe(2);
});
it('triage --plan counts zone files and zone sensitivity in the decision', () => {
  writeFileSync(path.join(root, 'plan.yaml'), PLAN_YAML.replace('Login with password', 'Rename helper').replace('users can log in', 'helper renamed'));
  io.git = args => (args.includes('ls-files') ? 'src/auth/a.ts\nsrc/auth/b.ts\nsrc/app.ts\nx\ny\nz\n' : args.includes('rev-list') ? '7\n' : '');
  const out = JSON.parse(run(['triage', '--plan', 'plan.yaml', '--task', 'T001'], io).stdout);
  expect(out.sensitive).toContain('auth');
  expect(['medium', 'large']).toContain(out.path);
});
it('triage --plan uses the task text and its zones, and logs under the task id', () => {
  writeFileSync(path.join(root, 'plan.yaml'), PLAN_YAML);
  io.git = args => {
    if (args.includes('ls-files')) return 'src/auth/login.ts\nsrc/auth/session.ts\nsrc/app.ts\nREADME.md\npackage.json\n';
    if (args.includes('rev-list')) return '7\n';
    return '';
  };
  const out = JSON.parse(run(['triage', '--plan', 'plan.yaml', '--task', 'T001'], io).stdout);
  expect(out.files).toEqual(['src/auth/login.ts', 'src/auth/session.ts']);
  expect(out.sensitive).toContain('auth');
  expect(readEvents(root).at(-1)).toMatchObject({ kind: 'triage', task: 'T001' });
});
it('triage --plan with zones that match nothing still answers', () => {
  writeFileSync(path.join(root, 'plan.yaml'), PLAN_YAML.replace('src/auth/**', 'src/new/**'));
  io.git = args => (args.includes('ls-files') ? 'src/app.ts\na\nb\nc\nd\n' : args.includes('rev-list') ? '7\n' : '');
  const r = run(['triage', '--plan', 'plan.yaml', '--task', 'T001'], io);
  expect(r.code).toBe(0);
  const out = JSON.parse(r.stdout);
  expect(out.files).toEqual([]);
  expect(out.sensitive).toContain('auth');
  expect(out.reasons.join(' ')).toMatch(/zones match no tracked file/);
});

describe('forge waypoint-cli', () => {
  const touch = (f: string) => { mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, ''); };
  it('finds waypoint next to forge in the dev layout', () => {
    const base = mkdtempSync(path.join(tmpdir(), 'forge-wp-'));
    touch(path.join(base, 'plugins', 'forge', 'dist', 'forge.cjs'));
    touch(path.join(base, 'plugins', 'waypoint', 'dist', 'waypoint.cjs'));
    const r = run(['waypoint-cli'], { cwd: base, now: () => new Date(), scriptPath: path.join(base, 'plugins', 'forge', 'dist', 'forge.cjs') });
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe(path.join(base, 'plugins', 'waypoint', 'dist', 'waypoint.cjs'));
  });
  it('finds the highest waypoint version in the cache layout', () => {
    const base = mkdtempSync(path.join(tmpdir(), 'forge-wp-'));
    touch(path.join(base, 'forge', '0.2.0', 'dist', 'forge.cjs'));
    for (const v of ['0.7.0', '0.10.0', '0.9.1']) touch(path.join(base, 'waypoint', v, 'dist', 'waypoint.cjs'));
    const r = run(['waypoint-cli'], { cwd: base, now: () => new Date(), scriptPath: path.join(base, 'forge', '0.2.0', 'dist', 'forge.cjs') });
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe(path.join(base, 'waypoint', '0.10.0', 'dist', 'waypoint.cjs'));
  });
  it('exits 2 when waypoint is not found', () => {
    const base = mkdtempSync(path.join(tmpdir(), 'forge-wp-'));
    touch(path.join(base, 'forge', '0.2.0', 'dist', 'forge.cjs'));
    const r = run(['waypoint-cli'], { cwd: base, now: () => new Date(), scriptPath: path.join(base, 'forge', '0.2.0', 'dist', 'forge.cjs') });
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/waypoint\.cjs not found/);
  });
  describe('proposals', () => {
    const prop = { category: 'quality', risk: 'low', title: 'Cut dead code', rationale: 'r', evidence: 'e', pillar: 'quality', source: 'scout' };
    const add = (over: Record<string, unknown> = {}) => {
      writeFileSync(path.join(root, 'p.json'), JSON.stringify({ ...prop, ...over }));
      return run(['proposals', 'add', '--file', 'p.json'], io);
    };
    it('add prints an id and writes the local copy as proposed', () => {
      const r = add();
      expect(r.code).toBe(0);
      const { id, doc } = JSON.parse(r.stdout);
      expect(id).toMatch(/^p\d{14}[0-9a-z]{4}$/);
      expect(doc).toMatchObject({ status: 'proposed', author: 'session', ts: '2026-10-11T10:00:00.000Z' });
      expect(existsSync(path.join(root, '.forge', 'proposals', `${id}.json`))).toBe(true);
      expect(readEvents(root).at(-1)).toMatchObject({ kind: 'proposal', action: 'add', id });
    });
    it('add refuses a scout proposal without pillar or evidence', () => {
      expect(add({ pillar: '' }).code).toBe(2);
      expect(add({ evidence: '  ' }).code).toBe(2);
      expect(add({ source: 'user', pillar: '', evidence: '' }).code).toBe(0);
    });
    it('add refuses an invalid category', () => {
      expect(add({ category: 'nope' }).code).toBe(2);
    });
    it('decide returns the write payload, then refuses a second decision', () => {
      const { id } = JSON.parse(add().stdout);
      const r = run(['proposals', 'decide', id, 'approve', '--by', 'user:me'], io);
      expect(r.code).toBe(0);
      expect(JSON.parse(r.stdout)).toEqual({ id, status: 'approved', write: { status: 'approved', decidedBy: 'user:me', decidedAt: '2026-10-11T10:00:00.000Z' } });
      expect(readEvents(root).at(-1)).toMatchObject({ kind: 'proposal', action: 'decide', id, status: 'approved' });
      const again = run(['proposals', 'decide', id, 'reject', '--by', 'user:me'], io);
      expect(again.code).toBe(2);
      expect(again.stderr).toContain('already decided');
    });
    it('decide reads the reason from a file and rejects bad ids', () => {
      const { id } = JSON.parse(add().stdout);
      writeFileSync(path.join(root, 'r.txt'), 'not now');
      const r = run(['proposals', 'decide', id, 'reject', '--reason-file', 'r.txt'], io);
      expect(JSON.parse(r.stdout).write).toEqual({ status: 'rejected', decidedBy: 'user', decidedAt: '2026-10-11T10:00:00.000Z', reason: 'not now' });
      expect(run(['proposals', 'decide', '../x', 'approve'], io).code).toBe(2);
      expect(run(['proposals', 'decide', 'p20261011100000zzzz', 'approve'], io).code).toBe(2);
    });
    it('list filters by status', () => {
      const { id } = JSON.parse(add().stdout);
      run(['proposals', 'decide', id, 'approve'], io);
      expect(JSON.parse(run(['proposals', 'list', '--status', 'approved'], io).stdout)).toHaveLength(1);
      expect(JSON.parse(run(['proposals', 'list', '--status', 'proposed'], io).stdout)).toHaveLength(0);
      expect(JSON.parse(run(['proposals', 'list'], io).stdout)[0]).toMatchObject({ id, status: 'approved' });
    });
    it('pull refreshes the local copy from db docs', () => {
      saveProposal(root, 'p20261011100000aaaa', { ...prop, ts: '', status: 'proposed', author: 'session' } as ProposalDoc);
      const dir = path.join(root, 'cache');
      mkdirSync(dir);
      writeFileSync(path.join(dir, 'p20261011100000aaaa.json'), JSON.stringify({ ...prop, ts: '', status: 'rejected', author: 'session', decidedBy: 'user:me', decidedAt: 'T' }));
      const r = run(['proposals', 'pull', '--dir', 'cache'], io);
      expect(r.code).toBe(0);
      expect(r.stdout.trim()).toBe('1');
      expect(loadProposals(root)[0]).toMatchObject({ id: 'p20261011100000aaaa', status: 'rejected', decidedBy: 'user:me' });
    });
    it('pull skips files whose name is not a proposal id or whose doc is invalid', () => {
      const dir = path.join(root, 'cache');
      mkdirSync(dir);
      writeFileSync(path.join(dir, 'p1.json'), JSON.stringify({ ...prop, ts: '', status: 'rejected', author: 'session' }));
      writeFileSync(path.join(dir, 'p20261011100000bbbb.json'), 'not json');
      writeFileSync(path.join(dir, 'p20261011100000cccc.json'), JSON.stringify({ title: 'x' }));
      expect(run(['proposals', 'pull', '--dir', 'cache'], io).stdout.trim()).toBe('0');
      expect(loadProposals(root)).toEqual([]);
    });
    it('add forces status proposed and drops decision fields', () => {
      const { doc } = JSON.parse(add({ status: 'approved', decidedBy: 'x', reason: 'y' }).stdout);
      expect(doc.status).toBe('proposed');
      expect(doc.decidedBy).toBeUndefined();
      expect(doc.reason).toBeUndefined();
    });
    it('discuss moves to discussing and the proposal can still be decided', () => {
      const { id } = JSON.parse(add().stdout);
      expect(JSON.parse(run(['proposals', 'decide', id, 'discuss'], io).stdout).write.status).toBe('discussing');
      expect(run(['proposals', 'decide', id, 'approve'], io).code).toBe(0);
    });
    it('list is newest first', () => {
      const a = JSON.parse(add({ ts: '2026-10-01T00:00:00.000Z', title: 'old' }).stdout).id;
      io.rand = () => 0.9;
      const b = JSON.parse(add({ ts: '2026-10-05T00:00:00.000Z', title: 'new' }).stdout).id;
      expect(JSON.parse(run(['proposals', 'list'], io).stdout).map((x: { id: string }) => x.id)).toEqual([b, a]);
    });
    it('add refuses a proposal similar to a rejected one without new evidence (exit 3), allows new evidence', () => {
      const first = JSON.parse(add({ title: 'Remove dead code from parser', rationale: 'unused helpers clutter parser', evidence: 'grep: 4 unused helpers' }).stdout).id;
      run(['proposals', 'decide', first, 'reject'], io);
      io.rand = () => 0.9;
      const r = add({ title: 'Remove dead code from parser', rationale: 'unused helpers clutter parser', evidence: 'unused helpers' });
      expect(r.code).toBe(3);
      expect(r.stderr).toContain(first);
      expect(add({ title: 'Remove dead code from parser', rationale: 'unused helpers clutter parser', evidence: 'coverage: 9 dead exports' }).code).toBe(0);
    });
    it('add refuses a proposal similar to an open one whatever its evidence (exit 3)', () => {
      const base = { title: 'Remove dead code from parser', rationale: 'unused helpers clutter parser', evidence: 'grep: 4 unused helpers' };
      const first = JSON.parse(add(base).stdout).id;
      for (const status of ['proposed', 'discussing', 'approved', 'auto_approved'] as const) {
        const doc = loadProposals(root).find(p => p.id === first)!;
        const { id: _id, ...rest } = doc;
        saveProposal(root, first, { ...rest, status });
        io.rand = () => 0.5;
        const r = add({ ...base, evidence: `brand new evidence for ${status}` });
        expect(r.code).toBe(3);
        expect(r.stderr).toContain(`similar to open proposal ${first}`);
      }
      expect(loadProposals(root)).toHaveLength(1);
      // Done or rejected ones are not open; a different idea is fine.
      const { id: _i, ...rest } = loadProposals(root)[0];
      saveProposal(root, first, { ...rest, status: 'done' });
      io.rand = () => 0.6;
      expect(add({ ...base, evidence: 'coverage: 9 dead exports' }).code).toBe(0);
      io.rand = () => 0.7;
      expect(add({ title: 'Cache price lookups', rationale: 'checkout is slow' }).code).toBe(0);
    });
    it('add --revises exempts only the proposal it revises from the open check', () => {
      const base = { title: 'Remove dead code from parser', rationale: 'unused helpers clutter parser' };
      const first = JSON.parse(add(base).stdout).id;
      io.rand = () => 0.9;
      writeFileSync(path.join(root, 'v2.json'), JSON.stringify({ ...prop, ...base, rationale: `${base.rationale} (v2 of ${first})` }));
      expect(run(['proposals', 'add', '--file', 'v2.json', '--revises', 'nope'], io).code).toBe(2);
      expect(run(['proposals', 'add', '--file', 'v2.json', '--revises'], io).code).toBe(2);
      expect(run(['proposals', 'add', '--file', 'v2.json', '--revises', 'p20261011100000zzzz'], io).code).toBe(3);
      const v2 = run(['proposals', 'add', '--file', 'v2.json', '--revises', first], io);
      expect(v2.code).toBe(0);
      // A third copy now collides with the v2, which is open too.
      io.rand = () => 0.1;
      expect(run(['proposals', 'add', '--file', 'v2.json', '--revises', first], io).code).toBe(3);
    });
    it('policy auto-approves a low-risk quality proposal and leaves others alone', () => {
      const a = JSON.parse(add().stdout).id;
      const r = JSON.parse(run(['proposals', 'policy', a], io).stdout);
      expect(r).toMatchObject({ id: a, status: 'auto_approved', write: { status: 'auto_approved', decidedBy: 'forge:policy' } });
      expect(loadProposals(root)[0]).toMatchObject({ status: 'auto_approved', decidedBy: 'forge:policy' });
      expect(readEvents(root).at(-1)).toMatchObject({ kind: 'proposal', action: 'policy', id: a, status: 'auto_approved' });
      io.rand = () => 0.9;
      const b = JSON.parse(add({ category: 'feature', title: 'Brand new thing' }).stdout).id;
      expect(JSON.parse(run(['proposals', 'policy', b], io).stdout)).toEqual({ id: b, status: 'proposed', write: null });
      expect(run(['proposals', 'policy', 'nope'], io).code).toBe(2);
    });
    describe('to-task', () => {
      const planYaml = '# keep me\nproject: demo\nlocale: en\nversion: "0.1"\nversions:\n  - id: "0.1"\n    phases: [F1]\ntracks:\n  - { id: backend, name: Backend, color: blue }\nphases:\n  - { id: F1, name: Base, plan_status: committed }\ntasks:\n  # first task\n  - { id: T001, title: a, track: backend, phase: F1, done_when: x }\n';
      const approved = (over: Record<string, unknown> = {}) => {
        const id = JSON.parse(add(over).stdout).id;
        run(['proposals', 'decide', id, 'approve'], io);
        return id;
      };
      beforeEach(() => writeFileSync(path.join(root, 'plan.yaml'), planYaml));
      it('appends the task and PX, keeps comments, sets taskId', () => {
        const id = approved({ path: 'src/**' });
        const r = run(['proposals', 'to-task', id, '--plan', 'plan.yaml'], io);
        expect(r.code).toBe(0);
        expect(JSON.parse(r.stdout)).toEqual({ id, taskId: 'T002', write: { taskId: 'T002' } });
        const text = readFileSync(path.join(root, 'plan.yaml'), 'utf8');
        expect(text).toContain('# keep me');
        expect(text).toContain('# first task');
        expect(loadProposals(root)[0].taskId).toBe('T002');
        expect(run(['proposals', 'to-task', id, '--plan', 'plan.yaml'], io).code).toBe(2);
      });
      it('keeps a hostile title as a string and the plan parses', () => {
        const title = 'x"\n  - id: EVIL\n# {oops}: [';
        const id = approved({ title });
        expect(run(['proposals', 'to-task', id, '--plan', 'plan.yaml'], io).code).toBe(0);
        const plan = parsePlan(readFileSync(path.join(root, 'plan.yaml'), 'utf8'));
        expect(plan.tasks.map(t => t.id)).toEqual(['T001', 'T002']);
        expect(plan.tasks[1].title).toBe(title);
      });
      it('refuses a rejected proposal', () => {
        const id = JSON.parse(add().stdout).id;
        run(['proposals', 'decide', id, 'reject'], io);
        expect(run(['proposals', 'to-task', id, '--plan', 'plan.yaml'], io).code).toBe(2);
        expect(readFileSync(path.join(root, 'plan.yaml'), 'utf8')).toBe(planYaml);
      });
      it('refuses proposed, rejected, unknown track (file untouched)', () => {
        const p = JSON.parse(add().stdout).id;
        expect(run(['proposals', 'to-task', p, '--plan', 'plan.yaml'], io).code).toBe(2);
        io.rand = () => 0.9;
        const ok = approved({ title: 'Something else entirely' });
        const r = run(['proposals', 'to-task', ok, '--plan', 'plan.yaml', '--track', 'nope'], io);
        expect(r.code).toBe(2);
        expect(readFileSync(path.join(root, 'plan.yaml'), 'utf8')).toBe(planYaml);
        expect(loadProposals(root).find(x => x.id === ok)!.taskId).toBeUndefined();
      });
    });
    it('hook stop counts a tasked approved proposal as pending (no queue-full while approved work remains)', () => {
      run(['infinite', 'start', '--cycles', '9', '--queue-max', '1'], io);
      const doc = { ts: '', category: 'quality', risk: 'low', title: 't', rationale: '', evidence: '', pillar: '', status: 'approved', source: 'scout', author: 's' } as ProposalDoc;
      saveProposal(root, 'p20261011090000aaac', { ...doc, taskId: 'T002' });
      saveProposal(root, 'p20261011090000aaad', { ...doc, status: 'proposed' });
      expect(JSON.parse(run(['hook', 'stop'], { ...io, stdin: '{}' }).stdout).reason).toContain('forge infinite mode is active');
      expect(JSON.parse(readFileSync(path.join(root, '.forge', 'run.json'), 'utf8')).active).toBe(true);
    });
    it('decide --from checks the given doc and writes or logs nothing', () => {
      const id = 'p20261011100000dddd';
      writeFileSync(path.join(root, 'db.json'), JSON.stringify({ ...prop, ts: 't', status: 'proposed', author: 'session' }));
      const r = run(['proposals', 'decide', id, 'reject', '--from', 'db.json', '--by', 'user:me'], io);
      expect(r.code).toBe(0);
      expect(JSON.parse(r.stdout)).toEqual({ id, status: 'rejected', write: { status: 'rejected', decidedBy: 'user:me', decidedAt: '2026-10-11T10:00:00.000Z' } });
      expect(loadProposals(root)).toEqual([]);
      expect(readEvents(root)).toEqual([]);
      expect(run(['proposals', 'decide', id, 'reject', '--from', 'missing.json'], io).code).toBe(2);
    });
    it('decide --from ignores the local mirror, and a refusal writes or logs nothing', () => {
      const id = 'p20261011100000dddd';
      saveProposal(root, id, { ...prop, ts: 't', status: 'proposed', author: 'session' } as ProposalDoc);
      writeFileSync(path.join(root, 'db2.json'), JSON.stringify({ ...prop, ts: 't', status: 'approved', author: 'session', decidedBy: 'o', decidedAt: 'a' }));
      const again = run(['proposals', 'decide', id, 'reject', '--from', 'db2.json'], io);
      expect(again.code).toBe(2);
      expect(again.stderr).toContain('already decided');
      expect(loadProposals(root)[0]).toMatchObject({ id, status: 'proposed' });
      expect(readEvents(root)).toEqual([]);
    });
    it('write.reason comes only from the reason file, never a stale one', () => {
      writeFileSync(path.join(root, 'db.json'), JSON.stringify({ ...prop, ts: 't', status: 'discussing', author: 'session', reason: 'old' }));
      const r = run(['proposals', 'decide', 'p20261011100000eeee', 'approve', '--from', 'db.json'], io);
      expect(JSON.parse(r.stdout).write.reason).toBeUndefined();
    });
    it('save stores the db doc as the mirror and logs the decision once', () => {
      const id = 'p20261011100000ffff';
      saveProposal(root, id, { ...prop, ts: 't', status: 'proposed', author: 'session' } as ProposalDoc);
      mkdirSync(path.join(root, 'w'));
      writeFileSync(path.join(root, 'w', `${id}.db.json`), JSON.stringify({ ...prop, ts: 't', status: 'approved', author: 'session', decidedBy: 'user', decidedAt: 'a' }));
      const r = run(['proposals', 'save', '--from', `w/${id}.db.json`], io);
      expect(r.code).toBe(0);
      expect(JSON.parse(r.stdout)).toEqual({ id, status: 'approved', previous: 'proposed', logged: true });
      expect(loadProposals(root)[0]).toMatchObject({ id, status: 'approved', decidedBy: 'user' });
      expect(readEvents(root)).toEqual([{ ts: '2026-10-11T10:00:00.000Z', kind: 'proposal', action: 'decide', id, status: 'approved' }]);
      const again = run(['proposals', 'save', '--from', `w/${id}.db.json`], io);
      expect(JSON.parse(again.stdout).logged).toBe(false);
      expect(readEvents(root)).toHaveLength(1);
    });
    it('save with an unchanged status logs nothing; --id overrides the file name; bad input is refused', () => {
      const id = 'p20261011100000gggg';
      saveProposal(root, id, { ...prop, ts: 't', status: 'rejected', author: 'session' } as ProposalDoc);
      writeFileSync(path.join(root, 'doc.json'), JSON.stringify({ ...prop, ts: 't', status: 'rejected', author: 'session', decidedBy: 'other' }));
      const r = run(['proposals', 'save', '--from', 'doc.json', '--id', id], io);
      expect(r.code).toBe(0);
      expect(JSON.parse(r.stdout).logged).toBe(false);
      expect(loadProposals(root)[0]).toMatchObject({ id, decidedBy: 'other' });
      expect(readEvents(root)).toEqual([]);
      expect(run(['proposals', 'save', '--from', 'doc.json'], io).code).toBe(2);
      expect(run(['proposals', 'save', '--from', 'doc.json', '--id', '../x'], io).code).toBe(2);
      writeFileSync(path.join(root, 'bad.json'), '{"title":"x"}');
      expect(run(['proposals', 'save', '--from', 'bad.json', '--id', id], io).code).toBe(2);
      expect(run(['proposals', 'save', '--id', id], io).code).toBe(2);
    });
    it('pull of a missing dir prints 0 and exits 0', () => {
      const r = run(['proposals', 'pull', '--dir', 'nope'], io);
      expect(r.code).toBe(0);
      expect(r.stdout.trim()).toBe('0');
    });
    it('add --author wins over the author in the file', () => {
      writeFileSync(path.join(root, 'p.json'), JSON.stringify({ ...prop, author: 'file' }));
      const r = run(['proposals', 'add', '--file', 'p.json', '--author', 'session:abc'], io);
      expect(JSON.parse(r.stdout).doc.author).toBe('session:abc');
      expect(JSON.parse(add({ author: 'file', title: 'Split the parser module' }).stdout).doc.author).toBe('file');
    });
  });
});
