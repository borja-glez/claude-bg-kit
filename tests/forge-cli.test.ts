import { describe, it, expect, beforeEach } from 'vitest';
import { appendFileSync, mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, symlinkSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run as cli, defaultExec, defaultExecMany, type Io } from '../src/forge/cli/run.js';
import { startRun, saveRun } from '../src/forge/run.js';
import { appendEvent, readEvents } from '../src/forge/ledger.js';
import { readLocal } from '../src/forge/local.js';
import { saveProposal, loadProposals } from '../src/forge/proposals.js';
import type { ProposalDoc } from '../src/lib/proposals.js';
import { parsePlan } from '../src/lib/plan.js';
import { parseStatus } from '../src/forge/tree.js';

// infinite start binds Claude's session id (C1, K5-03). The tests run inside Claude Code, which sets
// CLAUDE_CODE_SESSION_ID: io.env is {} so nothing leaks from it, and the id comes as --session s1 unless a test gives its own.
const run = (argv: string[], io: Io) =>
  cli(argv[0] === 'infinite' && argv[1] === 'start' && !argv.includes('--session') ? [...argv, '--session', 's1'] : argv, io);

let root: string;
let io: Io;
// docs/waypoint/demo/plan.yaml with the given task lines.
const writePlan = (dir: string, tasks: string) => {
  mkdirSync(path.join(dir, 'docs', 'waypoint', 'demo'), { recursive: true });
  writeFileSync(path.join(dir, 'docs', 'waypoint', 'demo', 'plan.yaml'),
    `project: demo\nlocale: en\nversion: "0.1"\ntracks:\n  - { id: backend, name: Backend, color: blue }\nphases:\n  - { id: PX, name: Improvements }\ntasks:\n${tasks}`);
};
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'forge-cli-'));
  io = { cwd: root, now: () => new Date('2026-10-11T10:00:00.000Z'), env: {} };
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
    expect(out.invalid).toEqual(['security']);
    expect(out.incomplete).toEqual([]);
  });
  it('verdict reports incomplete reviewers (a draft with complete: false)', () => {
    const dir = path.join(root, 'reviews');
    mkdirSync(dir);
    writeFileSync(path.join(dir, 'correctness.json'), '{"verdict":"pass","confidence":1,"findings":[],"complete":true}');
    writeFileSync(path.join(dir, 'security.json'), '{"verdict":"abstain","confidence":0,"findings":[],"complete":false}');
    writeFileSync(path.join(root, 'validators.json'), '[]');
    const out = JSON.parse(run(['verdict', '--task', 't1', '--dir', 'reviews', '--validators', 'validators.json'], io).stdout);
    expect(out.incomplete).toEqual(['security']);
    expect(out.invalid).toEqual([]);
    expect(out.reviewers.map((x: { name: string; incomplete: boolean }) => [x.name, x.incomplete])).toEqual([['correctness', false], ['security', true]]);
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
  it('verify-result logs the verify result of verify.json, as verdict does, and closes a Small task', () => {
    run(['log', '--kind', 'triage', '--task', 't1', '--data', '{"path":"small","reasons":[]}'], io);
    run(['log', '--kind', 'agent', '--task', 't1', '--data', '{"agent":"forge-verify"}'], io);
    const dir = path.join(root, '.forge', 'work', 't1', 'reviews-1-1');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'verify.json'), JSON.stringify({ surfaces: ['web'], result: 'pass', reason: 'r', checks: [{ id: 1, surface: 'web', name: 'a', ok: true }, { id: 2, surface: 'web', name: 'b', ok: false }] }));
    const r = run(['verify-result', '--task', 't1', '--dir', '.forge/work/t1/reviews-1-1'], io);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ task: 't1', result: 'fail', passed: 1, total: 2 });
    expect(readEvents(root).at(-1)).toEqual({ ts: '2026-10-11T10:00:00.000Z', kind: 'verify', task: 't1', result: 'fail', passed: 1, total: 2, evidence: '.forge/work/t1/evidence/1-1', reason: 'r' });
    const status = JSON.parse(readFileSync(path.join(root, '.forge', 'status.json'), 'utf8'));
    expect(status).toMatchObject({ agent: null, doneAt: '2026-10-11T10:00:00.000Z', verify: { result: 'fail' } });
  });
  it('verify-result without verify.json, with an unusable one, or without --task/--dir exits 2 and logs nothing', () => {
    mkdirSync(path.join(root, 'r'));
    const missing = run(['verify-result', '--task', 't1', '--dir', 'r'], io);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toMatch(/verify\.json/);
    writeFileSync(path.join(root, 'r', 'verify.json'), '{"result":"maybe"}');
    const bad = run(['verify-result', '--task', 't1', '--dir', 'r'], io);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toMatch(/verify\.json/);
    expect(run(['verify-result', '--task', 't1'], io).code).toBe(2);
    expect(run(['verify-result', '--dir', 'r'], io).code).toBe(2);
    expect(readEvents(root)).toEqual([]);
  });
  it('the usage text lists verify-result', () => {
    expect(run(['nope'], io).stderr).toContain('verify-result');
  });
  it('round decides from the task verdict history and logs it', () => {
    for (const s of ['0.6', '0.6']) run(['log', '--kind', 'verdict', '--task', 't1', '--data', `{"action":"fix","score":${s},"signature":"v2:x"}`], io);
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
  it('round on Medium after three fix verdicts: the last attempt, on forge-impl-heavy', () => {
    run(['log', '--kind', 'agent', '--task', 't1-1', '--data', '{"agent":"forge-impl","role":"impl"}'], io);
    for (const sig of ['a', 'b', 'c']) run(['log', '--kind', 'verdict', '--task', 't1-1', '--data', `{"action":"fix","score":0.6,"signature":"${sig}"}`], io);
    const r = JSON.parse(run(['round', '--task', 't1-1', '--path', 'medium'], io).stdout);
    expect(r).toMatchObject({ round: 3, next: 'fresh-stronger', last: true, implementer: { role: 'impl-heavy', agent: 'forge-impl-heavy' } });
    expect(readEvents(root).at(-1)).toMatchObject({ kind: 'round', task: 't1-1', last: true, implementer: { role: 'impl-heavy', agent: 'forge-impl-heavy' } });
  });
  it('round on Large after three fix verdicts from forge-impl climbs one rung, to forge-impl-high', () => {
    run(['log', '--kind', 'agent', '--task', 't1-1', '--data', '{"agent":"forge-impl","role":"impl"}'], io);
    // Agents off the ladder (a reviewer, verify, fable) do not name the implementer.
    run(['log', '--kind', 'agent', '--task', 't1-1', '--data', '{"agent":"forge-review-correctness","role":"review-correctness"}'], io);
    run(['log', '--kind', 'agent', '--task', 't1-1', '--data', '{"agent":"forge-fable","role":"fable"}'], io);
    for (const sig of ['a', 'b', 'c']) run(['log', '--kind', 'verdict', '--task', 't1-1', '--data', `{"action":"fix","score":0.6,"signature":"${sig}"}`], io);
    const r = JSON.parse(run(['round', '--task', 't1-1', '--path', 'large'], io).stdout);
    expect(r).toMatchObject({ round: 3, next: 'fresh-stronger', last: false, tierUp: true, implementer: { role: 'impl-high', agent: 'forge-impl-high' } });
  });
  it('round after one fix resumes the same implementer, resolved with the profile', () => {
    run(['log', '--kind', 'agent', '--task', 't1-1', '--data', '{"agent":"forge-impl-high","role":"impl-high"}'], io);
    run(['log', '--kind', 'verdict', '--task', 't1-1', '--data', '{"action":"fix","score":0.6,"signature":"a"}'], io);
    expect(JSON.parse(run(['round', '--task', 't1-1', '--path', 'medium'], io).stdout))
      .toMatchObject({ round: 1, next: 'resume', last: false, implementer: { role: 'impl-high', agent: 'forge-impl-high' } });
    mkdirSync(path.join(root, '.forge'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'config.yaml'), 'profile: economy\n');
    expect(JSON.parse(run(['round', '--task', 't1-1', '--path', 'medium'], io).stdout).implementer).toEqual({ role: 'impl-high', agent: 'forge-impl' });
  });
  it('round with no implementer logged assumes the one triage gives (impl-high on a sensitive Medium); done names none', () => {
    run(['log', '--kind', 'triage', '--task', 't1', '--data', '{"path":"medium","sensitive":["auth"]}'], io);
    run(['log', '--kind', 'verdict', '--task', 't1-1', '--data', '{"action":"fix","score":0.6,"signature":"a"}'], io);
    expect(JSON.parse(run(['round', '--task', 't1-1', '--path', 'medium'], io).stdout).implementer).toEqual({ role: 'impl-high', agent: 'forge-impl-high' });
    run(['log', '--kind', 'verdict', '--task', 't1-1', '--data', '{"action":"accept","score":0.9,"signature":""}'], io);
    expect(JSON.parse(run(['round', '--task', 't1-1', '--path', 'medium'], io).stdout)).toMatchObject({ next: 'done', last: false, implementer: null });
  });
  it('round refuses a path other than medium or large', () => {
    expect(run(['round', '--task', 't1', '--path', 'small'], io).code).toBe(2);
  });
  it('agents prints the role map for the configured profile', () => {
    mkdirSync(path.join(root, '.forge'));
    writeFileSync(path.join(root, '.forge', 'config.yaml'), 'profile: economy\n');
    const map = JSON.parse(run(['agents'], io).stdout);
    expect(map.profile).toBe('economy');
    expect(map.agents['impl-heavy']).toBe('forge-impl-high');
    expect(map.agents['impl-high']).toBe('forge-impl');
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
  it('triage leaves the design, the plan and forge notes out of the symbol search', () => {
    io.git = args => {
      if (args.includes('ls-files')) return 'src/a.ts\nsrc/b.ts\nsrc/c.ts\nsrc/d.ts\nsrc/e.ts\n';
      if (args[0] === 'rev-list') return '12\n';
      if (args.includes('grep')) return 'src/a.ts\ndocs/waypoint/demo/design.md\ndocs/waypoint/demo/design/history/v1.md\ndocs/waypoint/demo/plan.yaml\ndocs/superpowers/plans/p.md\n.forge/work/x/brief-1.md\n';
      return '';
    };
    const out = JSON.parse(run(['triage', 'fix parseConfig'], io).stdout);
    expect(out.files).toEqual(['src/a.ts']);
    expect(out.path).toBe('trivial');
  });
  it('triage --autonomy auto records auto mode, and last returns it', () => {
    writeFileSync(path.join(root, 'task.txt'), 'fix parseConfig in src/config.ts');
    const r = run(['triage', '--task', 't1', '--text-file', 'task.txt', '--autonomy', 'auto'], io);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).autonomy).toBe('auto');
    expect(readEvents(root).at(-1)).toMatchObject({ kind: 'triage', task: 't1', autonomy: 'auto' });
    expect(JSON.parse(run(['last', '--task', 't1'], io).stdout).autonomy).toBe('auto');
    expect(JSON.parse(run(['last', '--task', 'other'], io).stdout).autonomy).toBeNull();
    expect(run(['triage', '--task', 't2', '--text-file', 'task.txt', '--autonomy', 'always'], io).code).toBe(2);
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
  it('triage prints the implementer for the size, resolved through the profile; --batch delegates a trivial task', () => {
    io.git = args => {
      // Five or more tracked files, or the repository counts as greenfield and every task is Large.
      if (args.includes('ls-files')) return 'src/a.ts\nsrc/b.ts\nsrc/c.ts\nsrc/d.ts\nsrc/e.ts\n';
      if (args[0] === 'rev-list') return '12\n';
      return '';
    };
    const one = JSON.parse(run(['triage', 'fix the typo in src/a.ts'], io).stdout);
    expect(one.path).toBe('trivial');
    expect(one.implementer).toEqual({ role: null, self: true, why: 'trivial: the session does it', agent: null });
    const batch = JSON.parse(run(['triage', 'fix the typo in src/a.ts', '--batch'], io).stdout);
    expect(batch.implementer).toMatchObject({ role: 'mech', self: false, agent: 'forge-mech' });
    mkdirSync(path.join(root, '.forge'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'config.yaml'), 'profile: quality\n');
    const quality = JSON.parse(run(['triage', 'rename helperOne in src/a.ts and src/b.ts'], io).stdout);
    expect(quality.path).toBe('small');
    expect(quality.implementer).toMatchObject({ role: 'mech', agent: 'forge-impl-light' });
    // The ledger event keeps its shape: implementer is output only.
    expect(readEvents(root).at(-1)).not.toHaveProperty('implementer');
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
  it('triage lists the catalog, announces validators not yet known, then remembers them', () => {
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'x' } }));
    const git = (args: string[]) => (args[0] === '-c' && args.includes('ls-files') ? 'a.ts\nb.ts\nc.ts\nd.ts\ne.ts\n' : args[0] === 'rev-list' ? '5\n' : '');
    const first = JSON.parse(run(['triage', 'fix a typo in a.ts'], { ...io, git }).stdout);
    expect(first.validators).toEqual(['test']);
    expect(first.catalog).toEqual([{ name: 'test', cmd: 'npm test', kind: 'test', source: 'detected' }]);
    expect(first.new).toEqual(['test']);
    expect(JSON.parse(run(['triage', 'fix a typo in a.ts'], { ...io, git }).stdout).new).toEqual([]);
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { 'test:e2e': 'y' } }));
    const third = JSON.parse(run(['triage', 'fix a typo in a.ts'], { ...io, git }).stdout);
    expect(third.new).toEqual(['test:e2e']);
    expect(readLocal(root).known).toEqual(['test:e2e']);
  });
  it('triage hands over the announcement line and the gate, in English by default', () => {
    io.git = args => (args.includes('ls-files') ? 'src/a.ts\nsrc/b.ts\nsrc/c.ts\nsrc/d.ts\nsrc/e.ts\n' : args[0] === 'rev-list' ? '12\n' : '');
    const trivial = JSON.parse(run(['triage', 'fix the typo in src/a.ts'], io).stdout);
    expect(trivial.announce).toBe('Trivial: one named file, short task; I do it myself. You can correct it.');
    expect(trivial.gate).toBeNull();
    const small = JSON.parse(run(['triage', 'add a dark mode toggle'], io).stdout);
    expect(small.announce).toBe('Small → forge-impl-light: no files located: the session should judge the scope. You can correct it.');
    const medium = JSON.parse(run(['triage', 'change the password check in src/a.ts'], io).stdout);
    expect(medium.announce).toBe('Medium → forge-impl-high: one named file, short task; sensitive zone: auth. I show you a short plan before launching it; you can correct it.');
    expect(medium.gate).toBe('plan');
    const large = JSON.parse(run(['triage', 'redesign the plugin architecture'], io).stdout);
    expect(large.announce).toBe('Large: architecture-scale wording; design and plan first. You can correct it.');
    expect(large.gate).toBeNull();
    // Output only: the ledger event keeps its shape.
    expect(readEvents(root).at(-1)).not.toHaveProperty('announce');
    expect(readEvents(root).at(-1)).not.toHaveProperty('gate');
  });
  it('triage prints who reviews also without a plan or --base, and logs it in the triage event', () => {
    io.git = args => (args.includes('ls-files') ? 'src/a.ts\nsrc/b.ts\nsrc/c.ts\nsrc/d.ts\nsrc/e.ts\n' : args[0] === 'rev-list' ? '12\n' : '');
    const medium = JSON.parse(run(['triage', '--task', 'm1', 'tidy up src/a.ts src/b.ts src/c.ts src/d.ts'], io).stdout);
    expect(medium.path).toBe('medium');
    expect(medium.sensitive).toEqual([]);
    expect(medium.review).toEqual({ light: false, flags: [],
      reviewers: [{ role: 'review-correctness', model: null, effort: 'high', agent: 'forge-review-correctness' }] });
    expect(medium).not.toHaveProperty('diff');
    expect(medium.gate).toBe('plan');
    expect(readEvents(root).at(-1)).toMatchObject({ kind: 'triage', task: 'm1', path: 'medium', review: medium.review });
    const auth = JSON.parse(run(['triage', 'change the password check in src/a.ts'], io).stdout);
    expect(auth.path).toBe('medium');
    expect(auth.review.reviewers).toEqual([
      { role: 'review-correctness', model: null, effort: 'xhigh', agent: 'forge-review-correctness' },
      { role: 'review-security', model: null, effort: 'xhigh', agent: 'forge-review-security' },
    ]);
    expect(auth.review.flags).toEqual(['--sensitive']);
    expect(readEvents(root).at(-1)).toMatchObject({ kind: 'triage', review: auth.review });
    // --delicate lifts correctness; it is a switch, not part of the task text.
    const delicate = JSON.parse(run(['triage', '--delicate', 'tidy up src/a.ts src/b.ts src/c.ts src/d.ts'], io).stdout);
    expect(delicate.review.reviewers[0]).toMatchObject({ role: 'review-correctness', effort: 'xhigh' });
    expect(delicate.reasons).toEqual(medium.reasons);
    // A small task gets the light review.
    expect(JSON.parse(run(['triage', 'add a dark mode toggle'], io).stdout).review)
      .toEqual({ light: true, flags: [], reviewers: [{ role: 'review-correctness', model: 'sonnet', effort: 'medium', agent: 'forge-review-correctness' }] });
    // The quality profile puts every reviewer on xhigh.
    mkdirSync(path.join(root, '.forge'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'config.yaml'), 'profile: quality\n');
    const quality = JSON.parse(run(['triage', 'tidy up src/a.ts src/b.ts src/c.ts src/d.ts'], io).stdout);
    expect(quality.review.reviewers.map((r: { effort: string }) => r.effort)).toEqual(['xhigh']);
  });
  it('triage --locale es announces in Spanish, with the reasons translated', () => {
    io.git = args => (args.includes('ls-files') ? 'src/a.ts\nsrc/b.ts\nsrc/c.ts\nsrc/d.ts\nsrc/e.ts\n' : args[0] === 'rev-list' ? '12\n' : '');
    expect(JSON.parse(run(['triage', '--locale', 'es', 'fix the typo in src/a.ts'], io).stdout).announce)
      .toBe('Trivial: un fichero nombrado, tarea corta; lo hago yo. Puedes corregirlo.');
    expect(JSON.parse(run(['triage', '--locale', 'es', 'añade un modo oscuro'], io).stdout).announce)
      .toBe('Small → forge-impl-light: no localizo ficheros: decide la sesión. Puedes corregirlo.');
    expect(JSON.parse(run(['triage', '--locale', 'es', 'cambia el mensaje de error del login a «Credenciales incorrectas»'], io).stdout).announce)
      .toBe('Medium → forge-impl-high: un cambio de texto entre comillas; zona sensible: auth. Antes de lanzarlo te enseño un plan corto; puedes corregirlo.');
    expect(JSON.parse(run(['triage', '--locale', 'es', 'Rediseña la arquitectura del plugin'], io).stdout).announce)
      .toBe('Large: la tarea habla de arquitectura; primero diseño y plan. Puedes corregirlo.');
    // The locale flag is not part of the task text.
    expect(readEvents(root).at(-1)!.reasons).not.toContain('es');
    expect(run(['triage', '--locale', 'fr', 'add a toggle'], io).code).toBe(2);
  });
  it('triage takes the locale from the plan when no flag is given, and --locale wins over it', () => {
    io.git = args => (args.includes('ls-files') ? 'src/a.ts\nsrc/b.ts\nsrc/c.ts\nsrc/d.ts\nsrc/e.ts\n' : args[0] === 'rev-list' ? '12\n' : '');
    mkdirSync(path.join(root, 'docs', 'waypoint', 'demo'), { recursive: true });
    writeFileSync(path.join(root, 'docs', 'waypoint', 'demo', 'plan.yaml'), PLAN_YAML.replace('project: shop', 'project: shop\nlocale: es'));
    expect(JSON.parse(run(['triage', 'add a dark mode toggle'], io).stdout).announce).toMatch(/^Small → forge-impl-light: no localizo ficheros/);
    expect(JSON.parse(run(['triage', '--locale', 'en', 'add a dark mode toggle'], io).stdout).announce).toMatch(/^Small → forge-impl-light: no files located/);
  });
  it('triage adds a line for new validators with their commands', () => {
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'x', lint: 'y' } }));
    const git = (args: string[]) => (args.includes('ls-files') ? 'a.ts\nb.ts\nc.ts\nd.ts\ne.ts\n' : args[0] === 'rev-list' ? '5\n' : '');
    const first = JSON.parse(run(['triage', '--locale', 'es', 'fix a typo in a.ts'], { ...io, git }).stdout);
    expect(first.announce.split('\n')).toEqual([
      'Trivial: un fichero nombrado, tarea corta; lo hago yo. Puedes corregirlo.',
      'Validadores nuevos: lint (`npm run lint`), test (`npm test`).',
    ]);
    expect(JSON.parse(run(['triage', 'fix a typo in a.ts'], { ...io, git }).stdout).announce).not.toContain('\n');
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'x', lint: 'y', typecheck: 'z' } }));
    expect(JSON.parse(run(['triage', 'fix a typo in a.ts'], { ...io, git }).stdout).announce.split('\n')[1]).toBe('New validators: typecheck (`npm run typecheck`).');
  });
  it('a logged triage raise carries its why into the announcement of the next triage', () => {
    io.git = args => (args.includes('ls-files') ? 'src/a.ts\nsrc/b.ts\nsrc/c.ts\nsrc/d.ts\nsrc/e.ts\n' : args[0] === 'rev-list' ? '12\n' : '');
    writeFileSync(path.join(root, 'raise.json'), JSON.stringify({ path: 'medium', why: '  touches the cart totals and its tests  ' }));
    expect(run(['log', '--kind', 'triage', '--task', 'rw', '--data-file', 'raise.json'], io).code).toBe(0);
    expect(readEvents(root).at(-1)).toMatchObject({ kind: 'triage', task: 'rw', path: 'medium', why: 'touches the cart totals and its tests' });
    const out = JSON.parse(run(['triage', '--task', 'rw', '--locale', 'es', 'add a dark mode toggle'], io).stdout);
    expect(out.path).toBe('medium');
    expect(out.announce).toBe('Medium → forge-impl: touches the cart totals and its tests. Antes de lanzarlo te enseño un plan corto; puedes corregirlo.');
    // The triage it just logged has no why: the raise's why still wins the next time.
    expect(JSON.parse(run(['triage', '--task', 'rw', 'add a dark mode toggle'], io).stdout).announce).toMatch(/^Medium → forge-impl: touches the cart totals and its tests\./);
    // Another task keeps the CLI reasons.
    expect(JSON.parse(run(['triage', '--task', 'other', 'add a dark mode toggle'], io).stdout).announce).toMatch(/no files located/);
    // A logged why is one line, without a trailing stop, before the length check.
    writeFileSync(path.join(root, 'multi.json'), JSON.stringify({ path: 'large', why: ' touches the cart totals.\n  and   tests.; ' }));
    expect(run(['log', '--kind', 'triage', '--task', 'rw2', '--data-file', 'multi.json'], io).code).toBe(0);
    expect(readEvents(root).at(-1)!.why).toBe('touches the cart totals. and tests');
    writeFileSync(path.join(root, 'spaced.json'), JSON.stringify({ path: 'large', why: `${'x   '.repeat(99)}y\n\n\n` }));
    expect(run(['log', '--kind', 'triage', '--task', 'rw2', '--data-file', 'spaced.json'], io).code).toBe(0);
    writeFileSync(path.join(root, 'long.json'), JSON.stringify({ path: 'large', why: 'x'.repeat(201) }));
    writeFileSync(path.join(root, 'num.json'), JSON.stringify({ path: 'large', why: 3 }));
    expect(run(['log', '--kind', 'triage', '--task', 'rw', '--data-file', 'long.json'], io).code).toBe(2);
    expect(run(['log', '--kind', 'triage', '--task', 'rw', '--data-file', 'num.json'], io).code).toBe(2);
  });
  it('triage --plan and --superpowers-plan also hand over the announcement and the gate', () => {
    io.git = args => (args.includes('ls-files') ? 'src/a.ts\nsrc/b.ts\nsrc/c.ts\nsrc/d.ts\nsrc/e.ts\n' : args[0] === 'rev-list' ? '12\n' : '');
    mkdirSync(path.join(root, 'docs', 'superpowers', 'plans'), { recursive: true });
    writeFileSync(path.join(root, 'docs', 'superpowers', 'plans', 'p.md'), '# Cart Plan\n\n**Goal:** a cart.\n\n### Task 1: Add the cart\n\n**Files:**\n- Create: `src/cart.ts`\n\n- [ ] **Step 1: write it**\n');
    const sp = JSON.parse(run(['triage', '--superpowers-plan', 'docs/superpowers/plans/p.md', '--locale', 'en'], io).stdout);
    expect(sp).toMatchObject({ path: 'medium', gate: 'plan' });
    expect(sp.announce).toMatch(/^Medium → forge-impl: .*superpowers plan: the Medium path, its tasks in order\. I show you a short plan/);
  });
  it('triage names .forge/.gitignore as untracked until it is committed', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'forge-untracked-'));
    const git = (...a: string[]) => execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a], { cwd: dir, encoding: 'utf8' });
    git('init', '-q');
    for (const f of ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts']) writeFileSync(path.join(dir, f), 'export {};\n');
    git('add', '.');
    git('commit', '-q', '-m', 'init');
    const dio: Io = { cwd: dir, now: io.now };
    const before = JSON.parse(run(['triage', 'fix the typo in a.ts'], dio).stdout);
    expect(existsSync(path.join(dir, '.forge', '.gitignore'))).toBe(true);
    expect(before.untracked).toEqual(['.forge/.gitignore']);
    expect(readEvents(dir).at(-1)).not.toHaveProperty('untracked');
    git('add', '.forge/.gitignore');
    git('commit', '-q', '-m', 'forge');
    expect(JSON.parse(run(['triage', 'fix the typo in a.ts'], dio).stdout)).not.toHaveProperty('untracked');
    // When git does not answer, nothing is claimed.
    expect(JSON.parse(run(['triage', 'fix the typo in a.ts'], { ...dio, git: () => null }).stdout)).not.toHaveProperty('untracked');
  });
  it('triage does not name .forge/.gitignore when the repository ignores .forge/', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'forge-ignored-'));
    const git = (...a: string[]) => execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a], { cwd: dir, encoding: 'utf8' });
    git('init', '-q');
    for (const f of ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts']) writeFileSync(path.join(dir, f), 'export {};\n');
    writeFileSync(path.join(dir, '.gitignore'), '.forge/\n');
    git('add', '.');
    git('commit', '-q', '-m', 'init');
    const out = JSON.parse(run(['triage', 'fix the typo in a.ts'], { cwd: dir, now: io.now }).stdout);
    expect(existsSync(path.join(dir, '.forge', '.gitignore'))).toBe(true);
    expect(out).not.toHaveProperty('untracked');
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
  it('validate --affected runs the tests related to the given files, logs them and exits 1 on a failure', () => {
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run', build: 'esbuild' } }));
    mkdirSync(path.join(root, 'src'));
    writeFileSync(path.join(root, 'src', 'a.ts'), 'a\n');
    const ran: string[] = [];
    io.exec = cmd => { ran.push(cmd); return { code: 1, output: 'FAIL x', ms: 3, timedOut: false }; };
    const r = run(['validate', '--affected', 'src/a.ts', '--task', 't1'], io);
    const q = process.platform === 'win32' ? '"src/a.ts"' : "'src/a.ts'";
    expect(ran).toEqual([`npx vitest related --run --passWithNoTests ${q}`]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout)).toEqual([{ validator: 'test', ok: false, flaky: false, durationMs: 3, failures: ['FAIL x'], failing: ['x'], failingKnown: true }]);
    expect(readEvents(root).at(-1)).toMatchObject({ kind: 'validate', task: 't1', ok: false, scope: 'affected' });
  });
  it('validate retries a failure only for a validator with a flaky history, unless validate.retry says otherwise (C-12)', () => {
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }));
    const ran: string[] = [];
    io.exec = cmd => { ran.push(cmd); return { code: 1, output: 'FAIL x', ms: 3, timedOut: false }; };
    appendEvent(root, { ts: '2026-10-05T00:00:00.000Z', kind: 'validate', task: 't0', ok: true, results: [{ validator: 'test', ok: true, flaky: true }] });
    expect(run(['validate', '--all', '--task', 't1'], io).code).toBe(1);
    expect(ran).toEqual(['npm test', 'npm test']);
    mkdirSync(path.join(root, '.forge'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'config.yaml'), 'validate:\n  retry: never\n');
    ran.length = 0;
    run(['validate', '--all', '--task', 't1'], io);
    expect(ran).toEqual(['npm test']);
  });
  it('validate --baseline does not count a failure the base commit already had; verdict leaves it out', () => {
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run', build: 'vite build' } }));
    io.exec = cmd => ({ code: cmd === 'npm run build' ? 1 : 0, output: 'error during build', ms: 1, timedOut: false });
    const before = run(['validate', '--all', '--path', 'medium', '--task', 't1-1', '--base-run'], io);
    expect(before.code).toBe(1);
    writeFileSync(path.join(root, 'baseline.json'), before.stdout);
    const after = run(['validate', '--all', '--path', 'medium', '--task', 't1-1', '--baseline', 'baseline.json'], io);
    expect(after.code).toBe(0);
    expect(JSON.parse(after.stdout).find((r: { validator: string }) => r.validator === 'build')).toMatchObject({ ok: false, preexisting: true });
    writeFileSync(path.join(root, 'validators.json'), after.stdout);
    mkdirSync(path.join(root, 'rev'));
    writeFileSync(path.join(root, 'rev', 'correctness.json'), JSON.stringify({ reviewer: 'correctness', verdict: 'accept', score: 0.95, findings: [] }));
    const v = JSON.parse(run(['verdict', '--task', 't1-1', '--dir', 'rev', '--validators', 'validators.json'], io).stdout);
    expect(v.action).toBe('accept');
    expect(v.reasons.join(' ')).toContain('already failing on the base commit, not counted: build');
    // Without --validators the verdict reads the change's validation, never the base run.
    const fallback = JSON.parse(run(['verdict', '--task', 't1-1', '--dir', 'rev'], io).stdout);
    expect(fallback.action).toBe('accept');
    expect(run(['validate', '--all', '--baseline'], io).code).toBe(2);
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
  it('validate --path small skips e2e; --path medium --base runs e2e only when the diff matches', () => {
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'x', 'test:e2e': 'y' } }));
    mkdirSync(path.join(root, '.forge'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'config.yaml'), 'validators:\n  - name: test:e2e\n    cmd: e2e\n    kind: e2e\n    affects: ["web/**"]\n');
    const ran: string[] = [];
    const exec = (cmd: string) => { ran.push(cmd); return { code: 0, output: '', ms: 1, timedOut: false }; };
    const git = (args: string[]) => (args[0] === 'diff' ? 'web/a.tsx\n' : null);
    expect(run(['validate', '--all', '--path', 'small', '--task', 't'], { ...io, exec }).code).toBe(0);
    expect(ran).toEqual(['npm test']);
    ran.length = 0;
    expect(run(['validate', '--all', '--path', 'medium', '--base', 'abc', '--task', 't'], { ...io, exec, git }).code).toBe(0);
    expect(ran).toEqual(['npm test', 'e2e']);
    ran.length = 0;
    expect(run(['validate', '--all', '--path', 'medium', '--base', 'abc', '--task', 't'], { ...io, exec, git: () => 'src/x.ts\n' }).code).toBe(0);
    expect(ran).toEqual(['npm test']);
    ran.length = 0;
    expect(run(['validate', '--final', '--task', 't'], { ...io, exec }).code).toBe(0);
    expect(ran).toEqual(['npm test', 'e2e']);
  });
  it('validate --path must be a known path', () => {
    expect(run(['validate', '--all', '--path', 'huge'], io).code).toBe(2);
  });
  it('--cwd runs a command in another directory without moving the caller', () => {
    const other = mkdtempSync(path.join(tmpdir(), 'forge-cwd-'));
    writeFileSync(path.join(other, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }));
    const r = run(['validate', '--all', '--cwd', other], { ...io, exec: undefined, git: undefined });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual([expect.objectContaining({ validator: 'test', ok: true })]);
    // forge's own state stays with the caller: the event lands in the caller's ledger, not the other directory's.
    expect(readEvents(root).at(-1)).toMatchObject({ kind: 'validate' });
    expect(existsSync(path.join(other, '.forge', 'ledger.jsonl'))).toBe(false);
    expect(run(['validate', '--all', '--cwd', path.join(other, 'nope')], io).code).toBe(2);
  });
  it('--cwd keeps file flags relative to the caller: a baseline in the caller marks preexisting failures', () => {
    const other = mkdtempSync(path.join(tmpdir(), 'forge-cwd-'));
    writeFileSync(path.join(other, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(1)"' } }));
    mkdirSync(path.join(root, '.forge', 'work', 'T'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'work', 'T', 'baseline-1.json'), JSON.stringify([{ validator: 'test', ok: false, flaky: false, failures: ['> test', '> node -e "process.exit(1)"'] }]));
    const r = run(['validate', '--all', '--cwd', other, '--baseline', '.forge/work/T/baseline-1.json'], { ...io, exec: undefined, git: undefined });
    expect(r.stderr).toBe('');
    expect(JSON.parse(r.stdout)).toEqual([expect.objectContaining({ validator: 'test', ok: false, preexisting: true })]);
    expect(r.code).toBe(0);
  });
  it('--cwd must be a directory', () => {
    writeFileSync(path.join(root, 'file.txt'), 'x');
    const r = run(['validate', '--all', '--cwd', path.join(root, 'file.txt')], io);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/not a directory/);
  });
});

describe('forge infinite', () => {
  const runFile = () => path.join(root, '.forge', 'run.json');
  const readRun = () => JSON.parse(readFileSync(runFile(), 'utf8'));
  // The run is bound to s1 at start: a hook input without a session id is that session's, unless the test names another.
  const hook = (stdin: string) => {
    let input = stdin;
    try {
      const o: unknown = JSON.parse(stdin);
      if (o && typeof o === 'object' && !Array.isArray(o) && !('session_id' in o)) input = JSON.stringify({ ...o, session_id: 's1' });
    } catch { /* garbage stays garbage */ }
    return run(['hook', 'stop'], { ...io, stdin: input });
  };
  const touchStop = () => { mkdirSync(path.join(root, '.forge'), { recursive: true }); writeFileSync(path.join(root, '.forge', 'stop'), 'x\n'); };
  const ended = (reason: string) => ({ decision: 'block', reason: `the forge infinite run ended (${reason}): do step 4 of /forge:infinite (turn off meta/infinite and report), then stop. Tell the user in their own language.` });
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
    run(['infinite', 'start', '--cycles', '3', '--session', 'dead'], io);
    expect(JSON.parse(hook('{"session_id":"dead"}').stdout).decision).toBe('block');
    expect(run(['infinite', 'start', '--cycles', '2'], io).code).toBe(2);
    expect(run(['stop'], io).code).toBe(0);
    const r = run(['infinite', 'start', '--cycles', '2', '--session', 'new'], io);
    expect(r.code).toBe(0);
    expect(readRun()).toMatchObject({ active: true, budget: { cycles: 2 }, sessionId: 'new', cycle: 0 });
    expect(existsSync(path.join(root, '.forge', 'stop'))).toBe(false);
  });
  it('infinite start replaces an active run whose stop reason is due', () => {
    run(['infinite', 'start', '--hours', '1', '--session', 'dead'], io);
    expect(JSON.parse(hook('{"session_id":"dead"}').stdout).decision).toBe('block');
    const later = { ...io, now: () => new Date(Date.parse('2026-10-11T10:00:00.000Z') + 2 * 3600_000) };
    expect(run(['infinite', 'start', '--cycles', '1'], later).code).toBe(0);
    expect(readRun()).toMatchObject({ active: true, budget: { cycles: 1 }, sessionId: 's1' });
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
  it('hook stop blocks only the session the run was bound to at start (K5-03)', () => {
    run(['infinite', 'start', '--cycles', '9'], io);
    expect(readRun().sessionId).toBe('s1');
    const before = readFileSync(runFile(), 'utf8');
    expect(hook('{"session_id":"s2"}').stdout).toBe('');
    expect(run(['hook', 'stop'], { ...io, stdin: '{}' }).stdout).toBe('');
    expect(readFileSync(runFile(), 'utf8')).toBe(before);
    expect(JSON.parse(hook('{"session_id":"s1"}').stdout).decision).toBe('block');
    run(['cycle', '--progress', 'yes'], io);
    touchStop();
    expect(hook('{"session_id":"s2"}').stdout).toBe('');
    expect(readRun().active).toBe(true);
    expect(JSON.parse(hook('{"session_id":"s1"}').stdout)).toEqual(ended('stop-file'));
    const other = mkdtempSync(path.join(tmpdir(), 'forge-cli-'));
    expect(run(['infinite', 'start', '--cycles', '1', '--session'], { ...io, cwd: other }).code).toBe(2);
    expect(run(['infinite', 'start', '--cycles', '1', '--session', 'abc'], { ...io, cwd: other }).code).toBe(0);
    expect(run(['hook', 'stop'], { ...io, cwd: other, stdin: '{"session_id":"zzz"}' }).stdout).toBe('');
    expect(JSON.parse(run(['hook', 'stop'], { ...io, cwd: other, stdin: '{"session_id":"abc"}' }).stdout).decision).toBe('block');
  });
  it('infinite start binds the --session id, else CLAUDE_CODE_SESSION_ID, else exits 2 (C1, K5-03)', () => {
    const r = cli(['infinite', 'start', '--cycles', '3'], io);
    expect(r.code).toBe(2);
    expect(r.stderr).toBe('infinite start: no Claude session id: pass --session <id> or run it from Claude Code (CLAUDE_CODE_SESSION_ID)\n');
    expect(existsSync(runFile())).toBe(false);
    expect(cli(['infinite', 'start', '--cycles', '3', '--session', '${CLAUDE_SESSION_ID}'], { ...io, env: { CLAUDE_CODE_SESSION_ID: 'env-s' } }).code).toBe(0);
    expect(readRun().sessionId).toBe('env-s');
  });
  it('infinite start replaces an active run left without a session, and still refuses an active bound one (K5-03)', () => {
    saveRun(root, startRun(new Date('2026-10-11T09:00:00.000Z'), { cycles: 3 }));
    expect(readRun()).toMatchObject({ active: true, sessionId: null });
    expect(run(['infinite', 'start', '--cycles', '2'], io).code).toBe(0);
    expect(readRun()).toMatchObject({ active: true, budget: { cycles: 2 }, sessionId: 's1', cycle: 0 });
    expect(run(['infinite', 'start', '--cycles', '2', '--session', 's9'], io).code).toBe(2);
  });
  it('infinite start --locale keeps the person language; the hook, cycle and status repeat it', () => {
    expect(run(['infinite', 'start', '--cycles', '3', '--locale', 'spanish'], io).code).toBe(2);
    expect(run(['infinite', 'start', '--cycles', '3', '--locale'], io).code).toBe(2);
    expect(existsSync(runFile())).toBe(false);
    // A plan without locale says nothing about the language: the run's locale decides.
    mkdirSync(path.join(root, 'docs', 'waypoint', 'demo'), { recursive: true });
    writeFileSync(path.join(root, 'docs', 'waypoint', 'demo', 'plan.yaml'), 'project: demo\nversion: "0.1"\ntracks: [{ id: a, name: A, color: blue }]\nphases: [{ id: F1, name: One }]\ntasks:\n  - { id: T001, title: x, track: a, phase: F1, done_when: y }\n');
    expect(run(['infinite', 'start', '--cycles', '3', '--locale', 'es'], io).code).toBe(0);
    expect(readRun().locale).toBe('es');
    const says = ' Tell the user in Spanish (es), the language they write in.';
    expect(JSON.parse(hook('{}').stdout).reason).toMatch(new RegExp(`${says.replace(/[()]/g, '\\$&')}$`));
    expect(JSON.parse(run(['cycle', '--progress', 'yes'], io).stdout)).toMatchObject({ cycle: 1, locale: 'es', reply: says.trim() });
    expect(JSON.parse(run(['infinite', 'status'], io).stdout)).toMatchObject({ valid: true, reply: says.trim() });
  });
  it('a plan without locale no longer makes the hook say English', () => {
    mkdirSync(path.join(root, 'docs', 'waypoint', 'demo'), { recursive: true });
    writeFileSync(path.join(root, 'docs', 'waypoint', 'demo', 'plan.yaml'), 'project: demo\nversion: "0.1"\ntracks: [{ id: a, name: A, color: blue }]\nphases: [{ id: F1, name: One }]\ntasks:\n  - { id: T001, title: x, track: a, phase: F1, done_when: y }\n');
    run(['infinite', 'start', '--cycles', '3'], io);
    const reason = JSON.parse(hook('{}').stdout).reason as string;
    expect(reason).not.toContain('English');
    expect(reason).toMatch(/Tell the user in their own language\.$/);
    expect(JSON.parse(run(['infinite', 'status'], io).stdout).reply).toBeNull();
  });
});

describe('forge tree', () => {
  const git = (...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const repo = () => {
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@t'); git('config', 'user.name', 't'); git('config', 'core.autocrlf', 'false');
    writeFileSync(path.join(root, '.gitignore'), '.forge/\nbuild/\n');
    writeFileSync(path.join(root, 'a.txt'), 'a\n');
    writeFileSync(path.join(root, 'b.txt'), 'b\n');
    git('add', '.'); git('commit', '-q', '-m', 'init');
    return git('rev-parse', 'HEAD').trim();
  };
  const check = (base: string) => JSON.parse(run(['tree', 'check', '--task', 'T1', '--base', base], io).stdout);
  it('parseStatus splits untracked from changed and skips the source of a rename', () => {
    expect(parseStatus(' M a.txt\0R  new.txt\0old.txt\0?? n e w.txt\0A  added.txt\0')).toEqual({ untracked: ['n e w.txt'], modified: ['a.txt', 'new.txt', 'added.txt'] });
    // A work-tree rename (Y = R) is followed by its source too, even one named like an entry.
    expect(parseStatus(' R moved.txt\0?? x\0 C copy.txt\0src.txt\0')).toEqual({ untracked: [], modified: ['moved.txt', 'copy.txt'] });
  });
  it('lists the task commits, the files that appeared and the ones changed after the snapshot; never ignored ones', () => {
    const base = repo();
    writeFileSync(path.join(root, 'before.txt'), 'there before\n');
    writeFileSync(path.join(root, 'b.txt'), 'b dirty before\n');
    expect(run(['tree', 'snapshot', '--task', 'T1'], io).code).toBe(0);
    const snap = JSON.parse(readFileSync(path.join(root, '.forge', 'work', 'T1', 'tree-start.json'), 'utf8'));
    expect(snap.head).toBe(base);
    // The task commits c.txt; the person creates mine.txt and edits a.txt; a build output is ignored.
    writeFileSync(path.join(root, 'c.txt'), 'c\n');
    git('add', 'c.txt'); git('commit', '-q', '-m', 'task');
    mkdirSync(path.join(root, 'conf'));
    writeFileSync(path.join(root, 'conf', 'mine.txt'), 'by hand\n');
    writeFileSync(path.join(root, 'a.txt'), 'edited by hand\n');
    mkdirSync(path.join(root, 'build'));
    writeFileSync(path.join(root, 'build', 'out.js'), 'x\n');
    const out = check(base);
    expect(out.task).toEqual(['c.txt']);
    expect(out.appeared).toEqual(['conf/mine.txt']);
    expect(out.changed).toEqual(['a.txt']);
    expect(out.snapshot).toMatchObject({ head: base });
    expect(JSON.stringify(out)).not.toContain('build/');
    expect(JSON.stringify(out)).not.toContain('before.txt');
    // A hand edit of a file the task committed is never hidden behind the task's commits.
    writeFileSync(path.join(root, 'c.txt'), 'c tweaked by hand\n');
    expect(check(base).changed).toEqual(['a.txt', 'c.txt']);
  });
  it('a second snapshot keeps the first (a file that appeared in between is still listed); --force replaces it', () => {
    const base = repo();
    const first = run(['tree', 'snapshot', '--task', 'T1'], io);
    expect(first.code).toBe(0);
    writeFileSync(path.join(root, 'hand.txt'), 'by hand\n');
    const again = run(['tree', 'snapshot', '--task', 'T1'], io);
    expect(again.code).toBe(0);
    expect(again.stdout).toContain('already taken');
    expect(check(base).appeared).toEqual(['hand.txt']);
    expect(run(['tree', 'snapshot', '--task', 'T1', '--force'], io).code).toBe(0);
    expect(check(base).appeared).toEqual([]);
  });
  it('the snapshot never lists the .forge/.gitignore it creates', () => {
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@t'); git('config', 'user.name', 't'); git('config', 'core.autocrlf', 'false');
    writeFileSync(path.join(root, 'a.txt'), 'a\n');
    git('add', '.'); git('commit', '-q', '-m', 'init');
    const base = git('rev-parse', 'HEAD').trim();
    run(['tree', 'snapshot', '--task', 'T1'], io);
    expect(check(base).appeared).toEqual([]);
  });
  it('a snapshot of another tree or another task counts as none; the task excludes deletions; a base off the snapshot warns', () => {
    const base = repo();
    const wt = path.join(root, 'wt');
    git('worktree', 'add', '-q', '-b', 'side', wt);
    expect(run(['tree', 'snapshot', '--task', 'T1', '--cwd', wt], io).code).toBe(0);
    expect(JSON.parse(readFileSync(path.join(root, '.forge', 'work', 'T1', 'tree-start.json'), 'utf8'))).toMatchObject({ task: 'T1' });
    expect(JSON.parse(run(['tree', 'check', '--task', 'T1', '--base', base, '--cwd', wt], io).stdout).snapshot).not.toBeNull();
    expect(check(base).snapshot).toBeNull();
    mkdirSync(path.join(root, '.forge', 'work', 'T2'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'work', 'T2', 'tree-start.json'), readFileSync(path.join(root, '.forge', 'work', 'T1', 'tree-start.json')));
    expect(JSON.parse(run(['tree', 'check', '--task', 'T2', '--base', base, '--cwd', wt], io).stdout).snapshot).toBeNull();
    // In the main checkout: the task deletes b.txt and adds c.txt.
    run(['tree', 'snapshot', '--task', 'T3'], io);
    git('rm', '-q', 'b.txt');
    writeFileSync(path.join(root, 'c.txt'), 'c\n');
    git('add', 'c.txt'); git('commit', '-q', '-m', 'task');
    const t3 = JSON.parse(run(['tree', 'check', '--task', 'T3', '--base', base], io).stdout);
    expect(t3.task).toEqual(['c.txt']);
    expect(t3).not.toHaveProperty('warning');
    const later = git('rev-parse', 'HEAD').trim();
    expect(JSON.parse(run(['tree', 'check', '--task', 'T3', '--base', later], io).stdout).warning).toContain('not an ancestor');
  });
  it('without a snapshot lists every untracked and modified path (fail safe)', () => {
    const base = repo();
    writeFileSync(path.join(root, 'new.txt'), 'n\n');
    writeFileSync(path.join(root, 'a.txt'), 'changed\n');
    const out = check(base);
    expect(out).toMatchObject({ snapshot: null, task: [], appeared: ['new.txt'], changed: ['a.txt'] });
  });
  it('caps each list and counts the rest; refuses a bad task or base', () => {
    const base = repo();
    run(['tree', 'snapshot', '--task', 'T1'], io);
    for (let i = 0; i < 205; i++) writeFileSync(path.join(root, `n${String(i).padStart(3, '0')}.txt`), 'x\n');
    const out = check(base);
    expect(out.appeared).toHaveLength(200);
    expect(out.more).toMatchObject({ appeared: 5 });
    expect(run(['tree', 'snapshot'], io).code).toBe(2);
    expect(run(['tree', 'snapshot', '--task', '../x'], io).code).toBe(2);
    expect(run(['tree', 'check', '--task', 'T1'], io).code).toBe(2);
    expect(run(['tree', 'check', '--task', 'T1', '--base', 'nope'], io).code).toBe(2);
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
it("brief adds the threat model of the project's config (K4-02)", () => {
  writeFileSync(path.join(root, 'plan.yaml'), PLAN_YAML);
  mkdirSync(path.join(root, '.forge'), { recursive: true });
  writeFileSync(path.join(root, '.forge', 'config.yaml'), 'threatModel:\n  protects: ["the person\'s files"]\n');
  const r = run(['brief', '--plan', 'plan.yaml', '--task', 'T001'], io);
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("## Threat model\n\n- Protects: the person's files\n");
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
it('triage --plan of a task the plan marks delicate gives impl-high and correctness at xhigh (J-14)', () => {
  const plan = PLAN_YAML.replace('Login with password', 'Tidy the parser').replace('users can log in', 'parser tidied').replace('src/auth/**', 'src/parser/**');
  writeFileSync(path.join(root, 'plan.yaml'), plan.replace('    zones: ["src/parser/**"]\n', '    zones: ["src/parser/**"]\n    delicate: true\n'));
  io.git = args => (args.includes('ls-files') ? 'src/parser/a.ts\nsrc/parser/b.ts\nsrc/parser/c.ts\nsrc/parser/d.ts\nsrc/app.ts\n' : args.includes('rev-list') ? '7\n' : '');
  const out = JSON.parse(run(['triage', '--plan', 'plan.yaml', '--task', 'T001'], io).stdout);
  expect(out.path).toBe('medium');
  expect(out.implementer).toMatchObject({ role: 'impl-high', agent: 'forge-impl-high', why: 'delicate plan task' });
  const effort = (o: { review: { reviewers: { role: string; effort: string }[] } }) => o.review.reviewers.find(r => r.role === 'review-correctness')!.effort;
  expect(effort(out)).toBe('xhigh');
  writeFileSync(path.join(root, 'plan.yaml'), plan);
  const plain = JSON.parse(run(['triage', '--plan', 'plan.yaml', '--task', 'T001'], io).stdout);
  expect(plain.implementer.role).toBe('impl');
  expect(effort(plain)).toBe('high');
});
it('triage --plan with zones that match nothing still answers', () => {
  // A zone on a sensitive path counts even when no tracked file matches it yet.
  writeFileSync(path.join(root, 'plan.yaml'), PLAN_YAML.replace('src/auth/**', 'src/auth/new/**'));
  io.git = args => (args.includes('ls-files') ? 'src/app.ts\na\nb\nc\nd\n' : args.includes('rev-list') ? '7\n' : '');
  const r = run(['triage', '--plan', 'plan.yaml', '--task', 'T001'], io);
  expect(r.code).toBe(0);
  const out = JSON.parse(r.stdout);
  expect(out.files).toEqual([]);
  expect(out.sensitive).toContain('auth');
  expect(out.reasons.join(' ')).toMatch(/zones match no tracked file/);
  // The announcement translates the CLI reason; a plan's triage also carries the gate.
  const es = JSON.parse(run(['triage', '--plan', 'plan.yaml', '--task', 'T001', '--locale', 'es'], io).stdout);
  expect(es.announce).toContain('las zonas no casan con ningún fichero versionado (¿ficheros nuevos?)');
  expect(es.gate).toBe(es.path === 'medium' ? 'plan' : null);
});
it('triage --plan takes the locale from that plan before the first project under docs/waypoint', () => {
  mkdirSync(path.join(root, 'docs', 'waypoint', 'aaa'), { recursive: true });
  writeFileSync(path.join(root, 'docs', 'waypoint', 'aaa', 'plan.yaml'), PLAN_YAML.replace('project: shop', 'project: aaa\nlocale: en'));
  writeFileSync(path.join(root, 'plan.yaml'), PLAN_YAML.replace('project: shop', 'project: shop\nlocale: es').replace('src/auth/**', 'src/auth/new/**'));
  io.git = args => (args.includes('ls-files') ? 'src/app.ts\na\nb\nc\nd\n' : args.includes('rev-list') ? '7\n' : '');
  expect(JSON.parse(run(['triage', '--plan', 'plan.yaml', '--task', 'T001'], io).stdout).announce).toContain('zona sensible: auth');
  expect(JSON.parse(run(['triage', '--plan', 'plan.yaml', '--task', 'T001', '--locale', 'en'], io).stdout).announce).toContain('sensitive zone: auth');
});
describe('triage --base', () => {
  // A plan task with no sensitive zone and no perf wording.
  const FOOTER_YAML = PLAN_YAML.replace('Login with password', 'Add a footer link').replace('users can log in', 'the footer shows the link').replace('src/auth/**', 'src/ui/**');
  const DIFF = ['-c', 'core.quotePath=false', 'diff', '--numstat', '--no-renames', 'abc123..HEAD'];
  let diffCalls: string[][];
  const fakeGit = (numstat: string | null) => {
    diffCalls = [];
    io.git = args => {
      if (args.includes('ls-files')) return 'src/ui/footer.ts\nsrc/app.ts\na\nb\nc\n';
      if (args.includes('rev-list')) return '7\n';
      if (args.includes('--numstat')) { diffCalls.push(args); return numstat; }
      return '';
    };
  };
  const triageBase = (...extra: string[]) => run(['triage', '--plan', 'plan.yaml', '--task', 'T001', '--base', 'abc123', ...extra], io);
  it('a small diff on a plain task: one light review on sonnet, no gate', () => {
    writeFileSync(path.join(root, 'plan.yaml'), FOOTER_YAML);
    fakeGit('10\t2\tsrc/ui/footer.ts\n3\t1\tsrc/ui/footer.test.ts\n');
    const r = triageBase();
    expect(r.code).toBe(0);
    expect(diffCalls).toEqual([DIFF]);
    const out = JSON.parse(r.stdout);
    expect(out.path).toBe('small');
    expect(out.diff).toEqual({ base: 'abc123', files: ['src/ui/footer.ts', 'src/ui/footer.test.ts'], lines: 16, path: 'small' });
    expect(out.review).toEqual({ light: true, flags: [], reviewers: [{ role: 'review-correctness', model: 'sonnet', effort: 'medium', agent: 'forge-review-correctness' }] });
    expect(out.gate).toBeNull();
    expect(out.announce).toMatch(/^Real size: 2 file\(s\), 16 line\(s\) → Small: one light review/);
    expect(readEvents(root).at(-1)).toMatchObject({ kind: 'triage', task: 'T001', path: 'small', diff: { base: 'abc123', files: 2, lines: 16 } });
  });
  it('five changed files raise a plain task to medium, reviewed by correctness alone', () => {
    writeFileSync(path.join(root, 'plan.yaml'), FOOTER_YAML);
    fakeGit([1, 2, 3, 4, 5].map(i => `1\t1\tsrc/ui/f${i}.ts`).join('\n'));
    const out = JSON.parse(triageBase().stdout);
    expect(out.path).toBe('medium');
    expect(out.review.reviewers.map((x: { role: string }) => x.role)).toEqual(['review-correctness']);
    expect(out.review.flags).toEqual([]);
    expect(out.reasons).toContain('diff: 5 file(s), 10 line(s)');
    // The ratchet: a later plain triage of the task keeps the diff-raised path, and has no diff; it still says who reviews.
    const plain = JSON.parse(run(['triage', '--plan', 'plan.yaml', '--task', 'T001'], io).stdout);
    expect(plain.path).toBe('medium');
    expect(plain.review.reviewers.map((x: { role: string }) => x.role)).toEqual(['review-correctness']);
    expect(plain).not.toHaveProperty('diff');
    expect(readEvents(root).at(-1)).not.toHaveProperty('diff');
  });
  it('a diff touching src/auth adds the security review and --sensitive', () => {
    writeFileSync(path.join(root, 'plan.yaml'), FOOTER_YAML);
    fakeGit('4\t0\tsrc/auth/guard.ts\n');
    const out = JSON.parse(triageBase().stdout);
    expect(out.path).toBe('medium');
    expect(out.sensitive).toContain('auth');
    expect(out.review.reviewers.map((x: { role: string }) => x.role)).toEqual(['review-correctness', 'review-security']);
    expect(out.review.flags).toEqual(['--sensitive']);
    expect(out.reasons).toContain('diff touches a sensitive zone: auth');
  });
  it('the real diff alone sizes the task: a plan-time Large from wide zones does not floor it', () => {
    writeFileSync(path.join(root, 'plan.yaml'), FOOTER_YAML);
    const ui = Array.from({ length: 15 }, (_, i) => `src/ui/c${i}.ts`);
    io.git = args => {
      if (args.includes('ls-files')) return [...ui, 'src/app.ts'].join('\n');
      if (args.includes('rev-list')) return '7\n';
      if (args.includes('--numstat')) return '20\t5\tsrc/ui/c1.ts\n4\t1\tsrc/ui/c2.ts\n';
      return '';
    };
    expect(JSON.parse(run(['triage', '--plan', 'plan.yaml', '--task', 'T001'], io).stdout).path).toBe('large');
    const out = JSON.parse(triageBase().stdout);
    expect(out.path).toBe('small');
    expect(out.review.light).toBe(true);
    expect(out.reasons[0]).toMatch(/^diff: 2 file\(s\)/);
    expect(out.reasons.join(' ')).not.toMatch(/ratchet|files located/);
  });
  it('a sensitive plan zone keeps a one-file diff at medium, with the security review; wording outside the title does not', () => {
    writeFileSync(path.join(root, 'plan.yaml'), FOOTER_YAML.replace('Add a footer link', 'Change the footer check').replace('src/ui/**', 'src/auth/**'));
    fakeGit('3\t1\tsrc/ui/footer.ts\n');
    const out = JSON.parse(triageBase().stdout);
    expect(out.path).toBe('medium');
    expect(out.review.reviewers.map((x: { role: string }) => x.role)).toEqual(['review-correctness', 'review-security']);
    expect(out.reasons).toEqual(['diff: 1 file(s), 4 line(s)', 'sensitive zone: auth']);
    writeFileSync(path.join(root, 'plan.yaml'), FOOTER_YAML.replace('the footer shows the link', 'the password check passes'));
    expect(JSON.parse(triageBase().stdout).sensitive).toEqual([]);
  });
  describe('a plan task titled «Login con Google» on src/server/**', () => {
    const LOGIN_YAML = FOOTER_YAML.replace('Add a footer link', 'Login con Google').replace('src/ui/**', 'src/server/**');
    const roleList = (out: { review: { reviewers: { role: string }[] } }) => out.review.reviewers.map(x => x.role);
    it('takes auth from its title: impl-high and the security reviewer', () => {
      writeFileSync(path.join(root, 'plan.yaml'), LOGIN_YAML);
      io.git = args => (args.includes('ls-files') ? 'src/server/users.ts\nsrc/app.ts\na\nb\nc\n' : args.includes('rev-list') ? '7\n' : '');
      const r = run(['triage', '--plan', 'plan.yaml', '--task', 'T001'], io);
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('"sensitive": [\n    "auth"\n  ]');
      const out = JSON.parse(r.stdout);
      expect(out.sensitive).toEqual(['auth']);
      expect(out.implementer.role).toBe('impl-high');
      expect(roleList(out)).toContain('review-security');
    });
    it('with --base and a diff on src/server/users.ts alone it stays Medium with security', () => {
      writeFileSync(path.join(root, 'plan.yaml'), LOGIN_YAML);
      fakeGit('12\t2\tsrc/server/users.ts\n');
      const out = JSON.parse(triageBase().stdout);
      expect(out.path).toBe('medium');
      expect(out.sensitive).toEqual(['auth']);
      expect(roleList(out)).toEqual(['review-correctness', 'review-security']);
    });
  });
  it('across sizings the size only goes up: an earlier --base medium keeps a later one-file diff at medium', () => {
    writeFileSync(path.join(root, 'plan.yaml'), FOOTER_YAML);
    fakeGit([1, 2, 3, 4, 5].map(i => `1\t1\tsrc/ui/f${i}.ts`).join('\n'));
    expect(JSON.parse(triageBase().stdout).path).toBe('medium');
    fakeGit('1\t1\tsrc/ui/footer.ts\n');
    const out = JSON.parse(triageBase().stdout);
    expect(out.path).toBe('medium');
    expect(out.reasons).toContain('ratchet: kept medium from an earlier triage of this task');
  });
  it('the ratchet of a plan task keeps to its plan project', () => {
    writeFileSync(path.join(root, 'plan.yaml'), FOOTER_YAML);
    writeFileSync(path.join(root, 'other.yaml'), PLAN_YAML.replace('project: shop', 'project: other').replace('Login with password', 'Redesign the plugin architecture'));
    fakeGit('');
    expect(JSON.parse(run(['triage', '--plan', 'other.yaml', '--task', 'T001'], io).stdout).path).toBe('large');
    expect(readEvents(root).at(-1)).toMatchObject({ kind: 'triage', task: 'T001', project: 'other' });
    // A raise logged after the triage of other.yaml takes the project `other`: it does not count for shop's T001.
    run(['log', '--kind', 'triage', '--task', 'T001', '--data', '{"path":"large"}'], io);
    const out = JSON.parse(run(['triage', '--plan', 'plan.yaml', '--task', 'T001'], io).stdout);
    expect(out.path).not.toBe('large');
    expect(out.reasons.join(' ')).not.toMatch(/ratchet/);
    expect(readEvents(root).at(-1)).toMatchObject({ kind: 'triage', task: 'T001', project: 'shop' });
  });
  it('a plan task ignores the greenfield rule, and still reports greenfield', () => {
    writeFileSync(path.join(root, 'plan.yaml'), FOOTER_YAML);
    io.git = args => (args.includes('ls-files') ? 'src/ui/footer.ts\nREADME.md\n' : args.includes('rev-list') ? '1\n' : '');
    const out = JSON.parse(run(['triage', '--plan', 'plan.yaml', '--task', 'T001'], io).stdout);
    expect(out.greenfield).toBe(true);
    expect(out.path).not.toBe('large');
    expect(out.reasons).not.toContain('greenfield repository');
  });
  it('--base needs a commit and --task, and a diff git refuses is a usage error', () => {
    writeFileSync(path.join(root, 'plan.yaml'), FOOTER_YAML);
    fakeGit('');
    expect(run(['triage', 'add a footer link', '--base', 'abc123'], io)).toMatchObject({ code: 2, stderr: expect.stringContaining('triage: --base needs --task') });
    expect(run(['triage', '--plan', 'plan.yaml', '--task', 'T001', '--base'], io)).toMatchObject({ code: 2, stderr: expect.stringContaining('triage: --base needs a commit') });
    expect(triageBase().code).toBe(0);
    expect(run(['triage', '--plan', 'plan.yaml', '--task', 'T001', '--base', '-x'], io)).toMatchObject({ code: 2, stderr: expect.stringContaining('triage: --base needs a commit') });
    fakeGit(null);
    expect(triageBase()).toMatchObject({ code: 2, stderr: expect.stringContaining('triage: cannot diff abc123..HEAD') });
  });
});

describe('triage --plan: a mention in the text does not decide it (tasks of docs/waypoint/forge-cost/plan.yaml)', () => {
  // T007, T013, T017, T018 and T021 with their real title, includes, done_when and zones.
  const COST_YAML = `project: forge-cost
locale: es
version: "0.1"
tracks: [{ id: escalera, name: Escalera, color: blue }]
phases: [{ id: F4, name: Revision }]
tasks:
  - id: T021
    title: «Sesión» sola no marca la zona auth
    track: escalera
    phase: F4
    includes: >-
      src/forge/triage.ts: la zona auth deja de saltar por la palabra session(s) o sesión/sesiones sola, que en forge y
      waypoint casi siempre nombra una sesión de Claude Code (sesión coordinadora, sesiones miembro) y mandaba tareas sin
      autenticación a impl-heavy y al revisor de seguridad. Cuenta solo con contexto de autenticación: session token,
      session cookie, session id/hijack/fixation, login session, sesión de usuario, iniciar/cerrar sesión, cookie de
      sesión, token de sesión. Las demás palabras de auth (login, password, token, jwt, oauth, permission, crypto, secret…)
      y la detección por ruta no cambian. Tests en tests/forge-triage.test.ts con frases de este plan («la sesión
      coordinadora», «sesiones miembro», «each run member session») que ya no dan auth y frases de autenticación
      («cerrar sesión», «session cookie», «iniciar sesión con Google») que sí.
    done_when: >-
      npm run typecheck y npx vitest run tests/forge-triage.test.ts en verde; FORGE triage del texto de T003 de este plan
      no da sensitive auth.
    zones: ["src/forge/triage.ts", "tests/forge-triage.test.ts"]
  - id: T007
    title: Esfuerzo de los revisores y review en todo triage
    track: escalera
    phase: F4
    includes: >-
      reviewFor (src/forge/triage.ts) rellena effort: correctness high, xhigh con zona sensible, con delicate o en la
      revisión final de Large (final); security high, xhigh si la zona sensible es auth; perf medium; la revisión ligera
      sigue en Sonnet medium. Con el perfil quality, todos en xhigh; balanced y economy usan la tabla, provisional hasta la
      prueba en sombra. src/forge/cli/run.ts: FORGE triage imprime review (revisores con agent, model y effort, y flags)
      también sin --base, para una Medium fuera de una ejecución; --delicate llega a reviewFor; el evento triage del ledger
      guarda review para que review-prep lo lea. No toques los bundles: los regenera T018.
    done_when: >-
      Tests en verde: forge-triage con cada fila de la tabla, delicate, final y el perfil quality; forge-cli con una Medium
      sin plan ni --base que imprime review con correctness en high, una Medium en zona auth con correctness y security en
      xhigh, y el evento triage con review.
    zones: ["src/forge/triage.ts", "src/forge/cli/run.ts", "tests/forge-triage.test.ts", "tests/forge-cli.test.ts"]
  - id: T013
    title: Revisores en high con modo delta, y forge:run revisa con review-prep y review-close
    track: escalera
    phase: F4
    includes: >-
      forge-review-correctness, forge-review-security y forge-review-perf pasan a effort high; su texto describe el modo
      delta (reciben el brief, el diff completo como contexto, el diff del arreglo y solo sus propios hallazgos anteriores;
      comprueban que están arreglados y que el arreglo no rompe nada) y el origin de cada hallazgo (previous, fix,
      untouched). forge:run, Medium pasos 3 a 6: FORGE review-prep en lugar de validar y sacar el diff; lanzar exactamente
      su spawn pasando model y effort al Agent tool (gemelos incluidos, con su carpeta shadow/); FORGE review-close en lugar
      de verdict y round, relanzar el revisor que salga en missing y seguir next e implementer; los deferred van en el
      informe final para que la persona decida; verify-plan sigue aparte. task-steps.md: una tarea de plan revisa igual; la
      revisión final de Large sigue completa (correctness en xhigh con final) y su arreglo en impl-heavy.
    done_when: >-
      tests/plugin.test.ts en verde: los tres revisores en opus y high con el modo delta y los tres orígenes; Medium y
      task-steps.md nombran review-prep, review-close, el model y el effort de spawn, missing y deferred, y ya no llaman a
      verdict ni a round por separado; la revisión final de Large sigue completa.
    zones: ["plugins/forge/agents/forge-review-*.md", "plugins/forge/skills/run/**", "tests/plugin.test.ts"]
  - id: T017
    title: Versiones, CHANGELOG y README
    track: escalera
    phase: F4
    includes: >-
      forge 0.15.0 (con la dependencia waypoint ^0.19.0), waypoint 0.19.0 (flags nuevos en launch) y lens 0.11.3 en sus
      plugin.json, las insignias y líneas de dependencia de los README y los tests de versiones de tests/plugin.test.ts.
      Una entrada de CHANGELOG.md por plugin. README.md y README.es.md de la raíz y de forge, waypoint y lens cuentan lo que
      cambia para la persona: swarm.member y waypoint launch --effort/--model, forge:member, el peldaño impl-high y los
      perfiles, el esfuerzo de los revisores, las rondas delta y los deferred, FORGE shadow, FORGE prep e impl-high en lens.
    done_when: >-
      tests/plugin.test.ts en verde con las versiones nuevas y con una prueba que busca en los README en español y en
      inglés swarm.member, forge:member, impl-high, deferred y shadow; CHANGELOG.md tiene las entradas de forge 0.15.0,
      waypoint 0.19.0 y lens 0.11.3.
    zones: ["plugins/*/.claude-plugin/plugin.json", "CHANGELOG.md", "README.md", "README.es.md", "plugins/*/README*.md", "tests/plugin.test.ts"]
  - id: T018
    title: Bundles regenerados y prueba en sombra abierta
    track: escalera
    phase: F4
    includes: >-
      npm run build y commit de lo que genera: plugins/forge/dist, plugins/waypoint/dist,
      plugins/waypoint/assets/*.template.html, plugins/waypoint/hooks/register.js, plugins/waypoint/types,
      plugins/lens/hooks y plugins/lens/types; ninguna otra tarea los edita. Con el bundle nuevo, node
      plugins/forge/dist/forge.cjs shadow start --tasks 10 en este repositorio: el diseño abre la prueba al acabar la fase
      4, y va aquí porque necesita el bundle regenerado.
    done_when: >-
      npm run typecheck, npm test y npm run build en verde y, tras el build, git no ve cambios en plugins/; node
      plugins/forge/dist/forge.cjs shadow report muestra la prueba abierta con 10 briefs pendientes y ningún caso.
    zones: ["plugins/forge/dist/**", "plugins/waypoint/dist/**", "plugins/waypoint/assets/*.template.html", "plugins/waypoint/hooks/register.js", "plugins/waypoint/types/**", "plugins/lens/hooks/*.js", "plugins/lens/types/**", ".forge/shadow.json"]
  - id: T100
    title: Ajusta el formulario
    track: escalera
    phase: F4
    includes: El formulario valida antes de enviar.
    done_when: el formulario valida
    zones: ["src/auth/**"]
`;
  const TRACKED = ['src/forge/triage.ts', 'src/forge/cli/run.ts', 'tests/forge-triage.test.ts', 'tests/forge-cli.test.ts', 'tests/plugin.test.ts',
    'plugins/forge/.claude-plugin/plugin.json', 'CHANGELOG.md', 'README.md', 'README.es.md', 'plugins/forge/README.md', 'src/auth/login.ts'];
  const triagePlan = (id: string) => {
    writeFileSync(path.join(root, 'plan.yaml'), COST_YAML);
    io.git = args => (args.includes('ls-files') ? `${TRACKED.join('\n')}\n` : args.includes('rev-list') ? '7\n' : '');
    const r = run(['triage', '--plan', 'plan.yaml', '--task', id], io);
    expect(r.code).toBe(0);
    return JSON.parse(r.stdout);
  };
  const roles = (out: { review: { reviewers: { role: string }[] } }) => out.review.reviewers.map(x => x.role);
  it('T007: «auth», «perf» and «No toques los bundles» in its text give no zone, no perf review, no impl-high, no mech', () => {
    const out = triagePlan('T007');
    expect(out.sensitive).toEqual([]);
    expect(roles(out)).toEqual(['review-correctness']);
    expect(out.review.flags).toEqual([]);
    expect(out.implementer.role).not.toBe('impl-high');
    expect(out.implementer.role).not.toBe('mech');
  });
  it('T017: «con la dependencia waypoint ^0.19.0» gives no deps zone', () => {
    const out = triagePlan('T017');
    expect(out.sensitive).toEqual([]);
    expect(roles(out)).toEqual(['review-correctness']);
    expect(out.implementer.role).not.toBe('impl-high');
  });
  it('T021: its title «Sesión» sola no marca la zona auth gives auth through the bare word «auth»', () => {
    const out = triagePlan('T021');
    expect(out.sensitive).toEqual(['auth']);
    expect(roles(out)).toEqual(['review-correctness', 'review-security']);
    expect(out.implementer.role).toBe('impl-high');
  });
  it('T013: its title gives no perf review although its text names forge-review-perf', () => {
    const out = triagePlan('T013');
    expect(roles(out)).not.toContain('review-perf');
    expect(out.review.flags).not.toContain('--perf');
  });
  it('T018: its title «Bundles regenerados y prueba en sombra abierta» is mechanical work', () => {
    const out = triagePlan('T018');
    expect(out.sensitive).toEqual([]);
    expect(out.path).toBe('small');
    expect(out.implementer.role).toBe('mech');
  });
  it('a plan zone on src/auth/** with a tracked file there still gives auth', () => {
    const out = triagePlan('T100');
    expect(out.sensitive).toEqual(['auth']);
    expect(roles(out)).toContain('review-security');
  });
});

describe('a raise logged with log --kind triage counts for a plan task', () => {
  // T1 is mechanical work: its plan triage gives small.
  const RAISE_YAML = (project: string) => `project: ${project}
locale: es
version: "0.1"
tracks: [{ id: a, name: A, color: blue }]
phases: [{ id: F1, name: One }]
tasks:
  - id: T1
    title: Bundles regenerados y prueba en sombra abierta
    track: a
    phase: F1
    includes: npm run build y commit de lo que genera.
    done_when: git no ve cambios en plugins/
    zones: ["plugins/forge/dist/**", "plugins/waypoint/dist/**", "plugins/waypoint/types/**", "plugins/lens/types/**"]
`;
  const WHY = 'añade comportamiento nuevo con sus tests';
  const triageT1 = (plan = 'plan.yaml') => {
    const r = run(['triage', '--plan', plan, '--task', 'T1'], io);
    expect(r.code).toBe(0);
    return JSON.parse(r.stdout);
  };
  const raise = (data: Record<string, unknown> = { path: 'medium', why: WHY }) => {
    writeFileSync(path.join(root, 'raise.json'), JSON.stringify(data));
    expect(run(['log', '--kind', 'triage', '--task', 'T1', '--data-file', 'raise.json'], io).code).toBe(0);
    return readEvents(root).at(-1)!;
  };
  const activeExecution = (project: string, kind: 'plan' | 'ephemeral' = 'plan', active = true, started = ['T1']) => {
    mkdirSync(path.join(root, '.forge'), { recursive: true });
    const at = '2026-10-11T09:00:00.000Z';
    writeFileSync(path.join(root, '.forge', 'execution.json'), JSON.stringify({
      runId: 'run1', kind, mode: 'subagents', parallel: 1, project, base: 'main', branch: `forge/run-${project}`, mergeOnFinish: false,
      coordinator: 'coord1', hookSession: null, active, stopReason: null, stallReason: null, startedAt: at, lastStepAt: null,
      lastBlockStep: null, sleepUntil: null,
      tasks: Object.fromEntries(started.map(id => [id, { status: 'running', stage: 'implement', round: 0, worktree: '', branch: `task/${id}`, executor: 'subagents', attempts: 0, agent: null, startedAt: at, stageSince: at, updatedAt: at, detail: null }])),
    }));
  };
  beforeEach(() => {
    writeFileSync(path.join(root, 'plan.yaml'), RAISE_YAML('cost'));
    writeFileSync(path.join(root, 'other.yaml'), RAISE_YAML('other'));
    io.git = args => (args.includes('ls-files') ? 'src/app.ts\nREADME.md\npackage.json\n' : args.includes('rev-list') ? '7\n' : '');
  });
  it('after the plan triage, the raise takes its project and the next triage keeps medium with forge-impl and the why', () => {
    expect(triageT1().path).toBe('small');
    expect(raise()).toMatchObject({ kind: 'triage', task: 'T1', path: 'medium', why: WHY, project: 'cost' });
    const out = triageT1();
    expect(out.path).toBe('medium');
    expect(out.implementer.agent).toBe('forge-impl');
    expect(out.announce).toContain(WHY);
    expect(out.reasons).toContain('ratchet: kept medium from an earlier triage of this task');
  });
  it('a raise logged during an active plan execution with T1 among its tasks takes the execution project', () => {
    activeExecution('cost');
    expect(raise()).toMatchObject({ project: 'cost' });
    expect(triageT1().path).toBe('medium');
  });
  it('a raise for a task of the execution plan not started yet takes the execution project; an unreadable plan does not', () => {
    activeExecution('cost', 'plan', true, []);
    expect(raise()).not.toHaveProperty('project');
    mkdirSync(path.join(root, 'docs', 'waypoint', 'cost'), { recursive: true });
    writeFileSync(path.join(root, 'docs', 'waypoint', 'cost', 'plan.yaml'), 'tasks: [not a plan');
    expect(raise()).not.toHaveProperty('project');
    writeFileSync(path.join(root, 'docs', 'waypoint', 'cost', 'plan.yaml'), RAISE_YAML('cost'));
    expect(raise()).toMatchObject({ project: 'cost' });
    expect(triageT1().path).toBe('medium');
  });
  it('the active plan execution comes before the latest triage of the task', () => {
    triageT1('other.yaml');
    activeExecution('cost');
    expect(raise()).toMatchObject({ project: 'cost' });
  });
  it('an ephemeral or stopped execution does not stamp; a project given in the data is kept', () => {
    activeExecution('cost', 'ephemeral');
    expect(raise()).not.toHaveProperty('project');
    activeExecution('cost', 'plan', false);
    expect(raise()).not.toHaveProperty('project');
    activeExecution('cost');
    expect(raise({ path: 'medium', project: 'given' })).toMatchObject({ project: 'given' });
  });
  it('a raise outside any plan has no project, and other kinds are not stamped', () => {
    expect(raise()).not.toHaveProperty('project');
    triageT1();
    expect(run(['log', '--kind', 'phase', '--task', 'T1', '--data', '{"phase":"implement"}'], io).code).toBe(0);
    expect(readEvents(root).at(-1)).not.toHaveProperty('project');
  });
  it('a raise stamped for project A does not lift T1 of project B', () => {
    triageT1('other.yaml');
    expect(raise()).toMatchObject({ project: 'other' });
    const out = triageT1();
    expect(out.path).toBe('small');
    expect(out.reasons.join(' ')).not.toMatch(/ratchet/);
  });
  it('--base: a raise logged before the implementation sets no floor for the diff sizing', () => {
    triageT1();
    raise();
    io.git = args => (args.includes('ls-files') ? 'src/app.ts\nREADME.md\npackage.json\n' : args.includes('rev-list') ? '7\n'
      : args.includes('--numstat') ? '3\t1\tplugins/forge/dist/forge.cjs\n' : '');
    const r = run(['triage', '--plan', 'plan.yaml', '--task', 'T1', '--base', 'abc123'], io);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.path).toBe('small');
    expect(out.reasons.join(' ')).not.toMatch(/ratchet/);
  });
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
      expect(again.stderr).toContain(`${id} is already decided (approved by user:me at 2026-10-11T10:00:00.000Z); use --reopen after the person confirms`);
    });
    it('decide --reopen moves a decided proposal, keeps its history and removes the stale reason', () => {
      const { id } = JSON.parse(add().stdout);
      writeFileSync(path.join(root, 'r.txt'), 'not now');
      run(['proposals', 'decide', id, 'reject', '--by', 'user:x', '--reason-file', 'r.txt'], io);
      const r = run(['proposals', 'decide', id, 'approve', '--reopen', '--by', 'user:y'], io);
      expect(r.code).toBe(0);
      const at = '2026-10-11T10:00:00.000Z';
      const history = [{ status: 'rejected', decidedBy: 'user:x', decidedAt: at, reason: 'not now', reopenedBy: 'user:y', reopenedAt: at }];
      expect(JSON.parse(r.stdout)).toEqual({ id, status: 'approved', previous: 'rejected', write: { status: 'approved', decidedBy: 'user:y', decidedAt: at, history, reason: { __delete__: true } } });
      const mirror = loadProposals(root)[0];
      expect(mirror).toMatchObject({ status: 'approved', decidedBy: 'user:y', history });
      expect(mirror.reason).toBeUndefined();
      expect(readEvents(root).at(-1)).toEqual({ ts: at, kind: 'proposal', action: 'reopen', id, from: 'rejected', to: 'approved' });
      writeFileSync(path.join(root, 'r2.txt'), 'too risky after all');
      const back = JSON.parse(run(['proposals', 'decide', id, 'reject', '--reopen', '--reason-file', 'r2.txt'], io).stdout);
      expect(back.write).toMatchObject({ status: 'rejected', decidedBy: 'user', reason: 'too risky after all' });
      expect(back.write.history).toHaveLength(2);
    });
    it('decide --reopen --from works on the db doc and writes or logs nothing', () => {
      const id = 'p20261011100000hhhh';
      writeFileSync(path.join(root, 'db.json'), JSON.stringify({ ...prop, ts: 't', status: 'approved', author: 'session', decidedBy: 'o', decidedAt: 'a' }));
      const r = run(['proposals', 'decide', id, 'reject', '--reopen', '--from', 'db.json', '--by', 'user:me'], io);
      expect(r.code).toBe(0);
      expect(JSON.parse(r.stdout)).toEqual({ id, status: 'rejected', previous: 'approved', write: { status: 'rejected', decidedBy: 'user:me', decidedAt: '2026-10-11T10:00:00.000Z',
        history: [{ status: 'approved', decidedBy: 'o', decidedAt: 'a', reopenedBy: 'user:me', reopenedAt: '2026-10-11T10:00:00.000Z' }] } });
      expect(loadProposals(root)).toEqual([]);
      expect(readEvents(root)).toEqual([]);
    });
    it('decide --reopen refuses done, a proposal with a task, the same status, discuss and an open proposal', () => {
      const refuse = (status: string, action: string, over: Record<string, unknown> = {}) => {
        writeFileSync(path.join(root, 'db.json'), JSON.stringify({ ...prop, ts: 't', status, author: 'session', ...over }));
        const r = run(['proposals', 'decide', 'p20261011100000iiii', action, '--reopen', '--from', 'db.json'], io);
        expect(r.code).toBe(2);
        return r.stderr;
      };
      expect(refuse('done', 'reject')).toContain('is done');
      expect(refuse('approved', 'reject', { taskId: 'T008' })).toContain('task T008');
      expect(refuse('rejected', 'reject')).toContain('already rejected');
      expect(refuse('rejected', 'discuss')).toContain('approve or reject');
      expect(refuse('proposed', 'approve')).toContain('without --reopen');
      const { id } = JSON.parse(add().stdout);
      run(['proposals', 'decide', id, 'approve'], io);
      expect(run(['proposals', 'decide', id, 'approve', '--reopen'], io).code).toBe(2);
      expect(loadProposals(root)[0].history).toBeUndefined();
    });
    it('decide on a done proposal says it cannot be reopened, without the --reopen hint', () => {
      writeFileSync(path.join(root, 'db.json'), JSON.stringify({ ...prop, ts: 't', status: 'done', author: 'session', decidedBy: 'user', decidedAt: 'T1' }));
      const r = run(['proposals', 'decide', 'p20261011100000nnnn', 'reject', '--from', 'db.json'], io);
      expect(r.code).toBe(2);
      expect(r.stderr).toContain('p20261011100000nnnn is done and cannot be reopened');
      expect(r.stderr).not.toContain('--reopen');
    });
    it('a local taskId whose task was dropped from the plan does not block save + decide --reopen', () => {
      const id = 'p20261011100000qqqq';
      const db = { ...prop, ts: 't', status: 'approved', author: 'session', decidedBy: 'user', decidedAt: 'T1' };
      saveProposal(root, id, { ...db, taskId: 'T008' } as ProposalDoc);
      writePlan(root, '  - { id: T001, title: a, track: backend, phase: PX, done_when: x }\n');
      writeFileSync(path.join(root, `${id}.db.json`), JSON.stringify(db));
      expect(run(['proposals', 'save', '--from', `${id}.db.json`], io).code).toBe(0);
      expect(loadProposals(root)[0].taskId).toBeUndefined();
      saveProposal(root, id, { ...db, taskId: 'T008' } as ProposalDoc);
      const r = run(['proposals', 'decide', id, 'reject', '--reopen', '--from', `${id}.db.json`], io);
      expect(r.code).toBe(0);
      expect(JSON.parse(r.stdout).status).toBe('rejected');
    });
    it('decide --reopen with a --plan that cannot be read or parsed is a usage error', () => {
      const id = 'p20261011100000rrrr';
      writeFileSync(path.join(root, 'db.json'), JSON.stringify({ ...prop, ts: 't', status: 'approved', author: 'session' }));
      const missing = run(['proposals', 'decide', id, 'reject', '--reopen', '--from', 'db.json', '--plan', 'nope.yaml'], io);
      expect(missing.code).toBe(2);
      expect(missing.stderr).toContain('nope.yaml');
      writeFileSync(path.join(root, 'bad.yaml'), 'project: [');
      expect(run(['proposals', 'decide', id, 'reject', '--reopen', '--from', 'db.json', '--plan', 'bad.yaml'], io).code).toBe(2);
      mkdirSync(path.join(root, 'docs', 'waypoint', 'broken'), { recursive: true });
      writeFileSync(path.join(root, 'docs', 'waypoint', 'broken', 'plan.yaml'), 'project: [');
      expect(run(['proposals', 'decide', id, 'reject', '--reopen', '--from', 'db.json'], io).code).toBe(0);
    });
    it('decide --reopen --from refuses when the local mirror or a plan task holds the proposal', () => {
      const id = 'p20261011100000oooo';
      const db = { ...prop, ts: 't', status: 'approved', author: 'session', decidedBy: 'user', decidedAt: 'T1' };
      writeFileSync(path.join(root, 'db.json'), JSON.stringify(db));
      saveProposal(root, id, { ...db, taskId: 'T008' } as ProposalDoc);
      writePlan(root, '  - { id: T008, title: a, track: backend, phase: PX, done_when: x }\n');
      const mirror = run(['proposals', 'decide', id, 'reject', '--reopen', '--from', 'db.json'], io);
      expect(mirror.code).toBe(2);
      expect(mirror.stderr).toContain('task T008');
      saveProposal(root, id, db as ProposalDoc);
      const planYaml = (marker: string) => `project: demo\nlocale: es\nversion: "0.1"\ntracks:\n  - { id: backend, name: Backend, color: blue }\nphases:\n  - { id: PX, name: Mejoras }\ntasks:\n  - { id: T009, title: a, track: backend, phase: PX, done_when: x, includes: ${JSON.stringify(`why\n\n${marker}`)} }\n`;
      mkdirSync(path.join(root, 'docs', 'waypoint', 'demo'), { recursive: true });
      writeFileSync(path.join(root, 'docs', 'waypoint', 'demo', 'plan.yaml'), planYaml(`(propuesta ${id})`));
      const plan = run(['proposals', 'decide', id, 'reject', '--reopen', '--from', 'db.json'], io);
      expect(plan.code).toBe(2);
      expect(plan.stderr).toContain('task T009');
      writeFileSync(path.join(root, 'other.yaml'), planYaml(`(proposal ${id})`));
      writeFileSync(path.join(root, 'docs', 'waypoint', 'demo', 'plan.yaml'), planYaml('(propuesta p20261011100000zzzz)'));
      expect(run(['proposals', 'decide', id, 'reject', '--reopen', '--from', 'db.json', '--plan', 'other.yaml'], io).code).toBe(2);
      expect(run(['proposals', 'decide', id, 'reject', '--reopen', '--from', 'db.json'], io).code).toBe(0);
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
        // The title is one line (whitespace runs collapse); its quotes, # and brackets stay a plain string.
        expect(plan.tasks[1].title).toBe('x" - id: EVIL # {oops}: [');
      });
      it('a long multi-line rationale reaches plan.yaml whole and parses back intact', () => {
        const rationale = `${'Primera línea larga del motivo, con «comillas» y: dos puntos. '.repeat(8)}\n- un punto\n- otro: con # almohadilla\n\nY un final por fecha`;
        const id = approved({ rationale, evidence: 'grep: 3' });
        expect(run(['proposals', 'to-task', id, '--plan', 'plan.yaml'], io).code).toBe(0);
        const plan = parsePlan(readFileSync(path.join(root, 'plan.yaml'), 'utf8'));
        expect(plan.tasks[1].includes).toBe(`${rationale}\n\nEvidence: grep: 3\n\n(proposal ${id})`);
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
      expect(JSON.parse(run(['hook', 'stop'], { ...io, stdin: '{"session_id":"s1"}' }).stdout).reason).toContain('forge infinite mode is active');
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
    it('save of a decided proposal with another status logs a reopen, and warns when it carries no new history', () => {
      const id = 'p20261011100000jjjj';
      const db = { ...prop, ts: 't', author: 'session' };
      saveProposal(root, id, { ...db, status: 'rejected', decidedBy: 'user:x', decidedAt: 'T1' } as ProposalDoc);
      writeFileSync(path.join(root, 'doc.json'), JSON.stringify({ ...db, status: 'approved', decidedBy: 'user:y', decidedAt: 'T2' }));
      const r = run(['proposals', 'save', '--from', 'doc.json', '--id', id], io);
      expect(r.code).toBe(0);
      expect(JSON.parse(r.stdout)).toEqual({ id, status: 'approved', previous: 'rejected', logged: true });
      expect(r.stderr).toContain('not made through proposals decide --reopen');
      expect(readEvents(root).at(-1)).toEqual({ ts: '2026-10-11T10:00:00.000Z', kind: 'proposal', action: 'reopen', id, from: 'rejected', to: 'approved' });
      const history = [{ status: 'approved', decidedBy: 'user:y', decidedAt: 'T2', reopenedBy: 'user:z', reopenedAt: 'T3' }];
      writeFileSync(path.join(root, 'doc.json'), JSON.stringify({ ...db, status: 'rejected', decidedBy: 'user:z', decidedAt: 'T3', history }));
      const ok = run(['proposals', 'save', '--from', 'doc.json', '--id', id], io);
      expect(ok.stderr).toBe('');
      expect(readEvents(root).at(-1)).toMatchObject({ action: 'reopen', from: 'approved', to: 'rejected' });
      expect(loadProposals(root)[0].history).toEqual(history);
    });
    it('save of approved → done is the normal lifecycle: a plain decide log and no warning', () => {
      const id = 'p20261011100000kkkk';
      const db = { ...prop, ts: 't', author: 'session' };
      saveProposal(root, id, { ...db, status: 'approved', decidedBy: 'user', decidedAt: 'T1' } as ProposalDoc);
      writeFileSync(path.join(root, 'doc.json'), JSON.stringify({ ...db, status: 'done', decidedBy: 'user', decidedAt: 'T1', taskId: 'T008' }));
      const r = run(['proposals', 'save', '--from', 'doc.json', '--id', id], io);
      expect(r.code).toBe(0);
      expect(r.stderr).toBe('');
      expect(readEvents(root)).toEqual([{ ts: '2026-10-11T10:00:00.000Z', kind: 'proposal', action: 'decide', id, status: 'done' }]);
    });
    it('save counts a chain of reopens over a stale mirror as tracked, and an invented entry as not', () => {
      const id = 'p20261011100000llll';
      const db = { ...prop, ts: 't', author: 'session' };
      saveProposal(root, id, { ...db, status: 'auto_approved', decidedBy: 'forge:policy', decidedAt: 'T1' } as ProposalDoc);
      const chain = [
        { status: 'auto_approved', decidedBy: 'forge:policy', decidedAt: 'T1', reopenedBy: 'user:a', reopenedAt: 'T2' },
        { status: 'rejected', decidedBy: 'user:a', decidedAt: 'T2', reopenedBy: 'user:b', reopenedAt: 'T3' },
      ];
      writeFileSync(path.join(root, 'doc.json'), JSON.stringify({ ...db, status: 'approved', decidedBy: 'user:b', decidedAt: 'T3', history: chain }));
      expect(run(['proposals', 'save', '--from', 'doc.json', '--id', id], io).stderr).toBe('');
      const invented = [{ status: 'approved', decidedBy: 'someone', decidedAt: 'X', reopenedBy: 'user:c', reopenedAt: 'T4' }];
      writeFileSync(path.join(root, 'doc.json'), JSON.stringify({ ...db, status: 'rejected', decidedBy: 'user:c', decidedAt: 'T4', history: [...chain, ...invented] }));
      expect(run(['proposals', 'save', '--from', 'doc.json', '--id', id], io).stderr).toContain('not made through proposals decide --reopen');
    });
    it('save keeps a local taskId the roadmap doc does not have yet', () => {
      const id = 'p20261011100000mmmm';
      const db = { ...prop, ts: 't', author: 'session', status: 'approved', decidedBy: 'user', decidedAt: 'T1' };
      saveProposal(root, id, { ...db, taskId: 'T008' } as ProposalDoc);
      writePlan(root, '  - { id: T008, title: a, track: backend, phase: PX, done_when: x }\n');
      writeFileSync(path.join(root, 'doc.json'), JSON.stringify(db));
      expect(run(['proposals', 'save', '--from', 'doc.json', '--id', id], io).code).toBe(0);
      expect(loadProposals(root)[0].taskId).toBe('T008');
      writeFileSync(path.join(root, 'doc.json'), JSON.stringify({ ...db, taskId: 'T009' }));
      run(['proposals', 'save', '--from', 'doc.json', '--id', id], io);
      expect(loadProposals(root)[0].taskId).toBe('T009');
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

describe('defaultExecMany (C-12)', () => {
  it('runs the commands at once, each with its own output, code and timeout, and survives one that cannot start', () => {
    const t0 = Date.now();
    const r = defaultExecMany(root)([
      'node -e "console.log(\'one\')"', 'node -e "setTimeout(()=>{},30000)"', 'node -e "console.log(\'three\');process.exit(3)"', 'forge-no-such-command-xyz',
    ], 2, 4);
    expect(r).toHaveLength(4);
    expect(r[0]).toMatchObject({ code: 0, timedOut: false });
    expect(r[0].output).toContain('one');
    expect(r[1].timedOut).toBe(true);
    expect(r[2]).toMatchObject({ code: 3, timedOut: false });
    expect(r[2].output).toContain('three');
    expect(r[3].code).not.toBe(0);
    expect(r[3].timedOut).toBe(false);
    expect(Date.now() - t0).toBeLessThan(15000);
  }, 30000);
});

describe('validate and the tree cache (C6)', () => {
  let repo: string;
  let ran: string[];
  let vio: Io;
  beforeEach(() => {
    repo = mkdtempSync(path.join(tmpdir(), 'forge-vcache-'));
    const g = (...a: string[]) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' });
    g('init', '-q'); g('config', 'user.email', 'a@b.c'); g('config', 'user.name', 't');
    writeFileSync(path.join(repo, 'a.txt'), 'a\n');
    g('add', 'a.txt'); g('commit', '-qm', 'init');
    mkdirSync(path.join(repo, '.forge'));
    writeFileSync(path.join(repo, '.forge', 'config.yaml'), 'detect: false\nvalidators:\n  - name: unit\n    cmd: unit-cmd\n    kind: test\n  - name: style\n    cmd: lint-cmd\n    kind: lint\n  - name: e2e\n    cmd: e2e-cmd\n    kind: e2e\n');
    ran = [];
    vio = { cwd: repo, now: () => new Date('2026-10-11T10:00:00.000Z'), env: {}, exec: cmd => { ran.push(cmd); return { code: 0, output: '', ms: 7, timedOut: false }; } };
  });
  it('a heavy run reads and writes it, e2e aside; --no-cache skips it; --final writes and never reads; each event says so', () => {
    expect(run(['validate', '--all', '--path', 'medium', '--task', 't'], vio).code).toBe(0);
    expect(ran).toEqual(['unit-cmd', 'lint-cmd', 'e2e-cmd']);
    ran.length = 0;
    const again = JSON.parse(run(['validate', '--all', '--path', 'medium', '--task', 't'], vio).stdout);
    expect(ran).toEqual(['e2e-cmd']);
    expect(again.map((r: { validator: string; cached?: boolean; durationMs: number }) => [r.validator, r.cached ?? false, r.durationMs])).toEqual([['unit', true, 7], ['style', true, 7], ['e2e', false, 7]]);
    ran.length = 0;
    run(['validate', '--all', '--path', 'medium', '--no-cache'], vio);
    expect(ran).toEqual(['unit-cmd', 'lint-cmd', 'e2e-cmd']);
    ran.length = 0;
    run(['validate', '--final'], vio);
    expect(ran).toEqual(['unit-cmd', 'lint-cmd', 'e2e-cmd']);
    ran.length = 0;
    run(['validate', '--all', '--path', 'small'], vio);
    expect(ran).toEqual([]);
    const events = readEvents(repo).filter(e => e.kind === 'validate');
    expect(events.map(e => [e.scope, e.cached])).toEqual([['heavy', false], ['heavy', false], ['heavy', false], ['final', false], ['small', true]]);
    for (const e of events) expect(typeof e.durationMs).toBe('number');
  });
  it('an --affected pass never reads nor writes it; validate.cache: false turns it off', () => {
    run(['validate', '--affected', 'a.txt'], vio);
    run(['validate', '--affected', 'a.txt'], vio);
    expect(ran.filter(c => c === 'lint-cmd')).toHaveLength(2);
    expect(existsSync(path.join(repo, '.forge', 'cache', 'validate'))).toBe(false);
    expect(readEvents(repo).filter(e => e.kind === 'validate').at(-1)).toMatchObject({ scope: 'affected', cached: false });
    writeFileSync(path.join(repo, '.forge', 'config.yaml'), 'validate:\n  cache: false\ndetect: false\nvalidators:\n  - name: style\n    cmd: lint-cmd\n    kind: lint\n');
    ran.length = 0;
    run(['validate', '--all'], vio);
    run(['validate', '--all'], vio);
    expect(ran).toEqual(['lint-cmd', 'lint-cmd']);
  });
  it('--out writes the results to a file as well; --out needs one', () => {
    const r = run(['validate', '--all', '--out', '.forge/work/t/validators.json'], vio);
    expect(JSON.parse(readFileSync(path.join(repo, '.forge', 'work', 't', 'validators.json'), 'utf8'))).toEqual(JSON.parse(r.stdout));
    expect(run(['validate', '--all', '--out'], vio).code).toBe(2);
    expect(run(['validate', '--all', '--out', '--task', 't'], vio).code).toBe(2);
  });
  it('from a subdirectory, a change outside it is still seen: the result is not served from the cache', () => {
    mkdirSync(path.join(repo, 'sub'));
    writeFileSync(path.join(repo, 'sub', 'b.txt'), 'b\n');
    execFileSync('git', ['add', 'sub/b.txt'], { cwd: repo });
    execFileSync('git', ['commit', '-qm', 'sub'], { cwd: repo });
    const sub = path.join(repo, 'sub');
    const inSub: Io = { ...vio, cwd: sub };
    // forge reads its config from the subdirectory it runs in
    mkdirSync(path.join(sub, '.forge'));
    writeFileSync(path.join(sub, '.forge', 'config.yaml'), 'detect: false\nvalidators:\n  - name: style\n    cmd: lint-cmd\n    kind: lint\n');
    appendFileSync(path.join(repo, '.git', 'info', 'exclude'), 'sub/.forge/\n'); // forge's own state in sub is not a change
    run(['validate', '--all', '--path', 'medium'], inSub);
    expect(ran).toEqual(['lint-cmd']);
    ran.length = 0;
    run(['validate', '--all', '--path', 'medium'], inSub);
    expect(ran).toEqual([]);
    writeFileSync(path.join(repo, 'a.txt'), 'changed outside sub\n');
    ran.length = 0;
    run(['validate', '--all', '--path', 'medium'], inSub);
    expect(ran).toEqual(['lint-cmd']);
  });
  it('two subdirectories with the same command on the same tree: the red one is not served the green one\'s result', () => {
    // The real exec (--cwd swaps it in): each project's check fails when a `fail` file sits next to it.
    for (const d of ['sub-a', 'sub-b']) {
      mkdirSync(path.join(repo, d, '.forge'), { recursive: true });
      writeFileSync(path.join(repo, d, 'check.js'), "process.exit(require('fs').existsSync('fail') ? 1 : 0)\n");
      writeFileSync(path.join(repo, d, '.forge', 'config.yaml'), 'detect: false\nvalidators:\n  - name: check\n    cmd: node check.js\n    kind: test\n');
    }
    writeFileSync(path.join(repo, 'sub-b', 'fail'), 'x\n');
    execFileSync('git', ['-c', 'core.autocrlf=false', 'add', '-A'], { cwd: repo });
    execFileSync('git', ['commit', '-qm', 'two projects'], { cwd: repo });
    const rio: Io = { cwd: repo, now: vio.now, env: {} };
    const check = (dir: string) => {
      const r = run(['validate', '--all', '--cwd', dir], rio);
      const [res] = JSON.parse(r.stdout) as { validator: string; ok: boolean; cached?: boolean }[];
      return [r.code, res.validator, res.ok, res.cached ?? false];
    };
    expect(check('sub-a')).toEqual([0, 'check', true, false]);
    expect(check('sub-b')).toEqual([1, 'check', false, false]);
    expect(check('sub-a')).toEqual([0, 'check', true, true]);
    expect(check('sub-b')).toEqual([1, 'check', false, true]);
  }, 30000);
});

describe('validate --affected (C-02)', () => {
  let repo: string;
  let ran: string[];
  let aio: Io;
  const q = (f: string) => (process.platform === 'win32' ? `"${f}"` : `'${f}'`);
  beforeEach(() => {
    repo = mkdtempSync(path.join(tmpdir(), 'forge-affected-'));
    const g = (...a: string[]) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' });
    g('init', '-q'); g('config', 'user.email', 'a@b.c'); g('config', 'user.name', 't');
    mkdirSync(path.join(repo, 'src'));
    writeFileSync(path.join(repo, 'src', 'a.ts'), 'a\n');
    writeFileSync(path.join(repo, 'src', 'b.ts'), 'b\n');
    g('add', '-A'); g('commit', '-qm', 'init');
    mkdirSync(path.join(repo, '.forge'));
    writeFileSync(path.join(repo, '.forge', 'config.yaml'), 'detect: false\nvalidators:\n  - name: unit\n    cmd: unit-all\n    kind: test\n    affected_cmd: unit-related {files}\n  - name: style\n    cmd: lint-all\n    kind: lint\n  - name: pack\n    cmd: build-all\n    kind: build\n');
    ran = [];
    aio = { cwd: repo, now: () => new Date('2026-10-11T10:00:00.000Z'), env: {}, exec: cmd => { ran.push(cmd); return { code: 0, output: '', ms: 1, timedOut: false }; } };
  });
  it('without a list it takes the files changed since --base (uncommitted ones included) and the untracked ones', () => {
    writeFileSync(path.join(repo, 'src', 'a.ts'), 'a2\n');
    writeFileSync(path.join(repo, 'src', 'new file.test.ts'), 'n\n');
    const r = run(['validate', '--affected', '--base', 'HEAD', '--task', 't-1'], aio);
    expect(r.code).toBe(0);
    expect(ran).toEqual([`unit-related ${q('src/a.ts')} ${q('src/new file.test.ts')}`, 'lint-all']);
    expect(readEvents(repo).filter(e => e.kind === 'validate').at(-1)).toMatchObject({ task: 't-1', scope: 'affected', cached: false });
  });
  it('a path no shell may see makes the test run in full, with a note; a test without a related-tests command is skipped', () => {
    writeFileSync(path.join(repo, 'src', 'año.ts'), 'x\n');
    const r = run(['validate', '--affected', '--base', 'HEAD'], aio);
    expect(ran).toEqual(['unit-all', 'lint-all']);
    expect(r.stderr).toContain('unit: ');
    expect(r.stderr).toContain('runs in full');
    writeFileSync(path.join(repo, '.forge', 'config.yaml'), 'detect: false\nvalidators:\n  - name: unit\n    cmd: unit-all\n    kind: test\n');
    ran.length = 0;
    const s = run(['validate', '--affected', 'src/a.ts'], aio);
    expect(s.code).toBe(0);
    expect(ran).toEqual([]);
    expect(JSON.parse(s.stdout)).toEqual([expect.objectContaining({ validator: 'unit', ok: true, skipped: 'not-affected' })]);
    expect(s.stderr).toContain('review-prep runs it in full');
  });
  it('in a project in a subdirectory, the changed tracked files are its own paths, as the untracked ones are', () => {
    const sub = path.join(repo, 'pkg');
    mkdirSync(path.join(sub, 'src'), { recursive: true });
    mkdirSync(path.join(sub, '.forge'));
    writeFileSync(path.join(sub, 'src', 'c.ts'), 'c\n');
    writeFileSync(path.join(sub, '.forge', 'config.yaml'), 'detect: false\nvalidators:\n  - name: unit\n    cmd: unit-all\n    kind: test\n    affected_cmd: unit-related {files}\n');
    execFileSync('git', ['-c', 'core.autocrlf=false', 'add', '-A'], { cwd: repo });
    execFileSync('git', ['commit', '-qm', 'pkg'], { cwd: repo });
    writeFileSync(path.join(sub, 'src', 'c.ts'), 'c2\n');
    writeFileSync(path.join(sub, 'src', 'd.ts'), 'd\n');
    writeFileSync(path.join(repo, 'src', 'a.ts'), 'outside the project\n');
    expect(run(['validate', '--affected', '--base', 'HEAD'], { ...aio, cwd: sub }).code).toBe(0);
    expect(ran).toEqual([`unit-related ${q('src/c.ts')} ${q('src/d.ts')}`]);
  });
});

describe('forge stats (C-09)', () => {
  it('prints the clock of the accepted briefs as JSON or as a table, and refuses two windows or a bad one', () => {
    appendEvent(root, { ts: '2026-10-01T09:00:00.000Z', kind: 'triage', task: 'A', path: 'medium' });
    appendEvent(root, { ts: '2026-10-01T09:00:00.000Z', kind: 'phase', task: 'A', phase: 'implement', brief: 1 });
    appendEvent(root, { ts: '2026-10-01T09:10:00.000Z', kind: 'phase', task: 'A', phase: 'review', brief: 1, round: 1 });
    appendEvent(root, { ts: '2026-10-01T09:15:00.000Z', kind: 'verdict', task: 'A-1', dir: 'd', action: 'accept' });
    const r = run(['stats', '--json'], io);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ briefs: 1, firstPass: 1, byPath: { medium: { briefs: 1 } }, byBrief: [{ task: 'A-1', totalMs: 15 * 60000 }] });
    expect(JSON.parse(run(['stats', '--days', '7', '--json'], io).stdout).briefs).toBe(0);
    expect(JSON.parse(run(['stats', '--since', '2026-09-30', '--json'], io).stdout).briefs).toBe(1);
    expect(run(['stats', '--locale', 'es'], io).stdout).toContain('| medium | 1 | 15.0 | 10.0 |');
    for (const bad of [['--days', '7', '--since', '2026-10-01'], ['--days', 'x'], ['--days', '0'], ['--since', 'yesterday'], ['--locale', 'fr']]) {
      expect(run(['stats', ...bad], io).code).toBe(2);
    }
  });

  it('verify-close applies the learned notes, cleans up, records the result once and lists the shots (measure 10)', () => {
    mkdirSync(path.join(root, '.forge', 'verify'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'verify', 'web.md'), '---\naffects: ["web/**"]\n---\n# Web\n\nOpen the app.\n');
    const dir = path.join(root, '.forge', 'work', 'T1', 'reviews-1-1');
    const ev = path.join(root, '.forge', 'work', 'T1', 'evidence', '1-1');
    mkdirSync(dir, { recursive: true });
    mkdirSync(ev, { recursive: true });
    writeFileSync(path.join(ev, '01-home.png'), Buffer.alloc(10));
    writeFileSync(path.join(ev, '02-cart.png'), Buffer.alloc(2 * 1024 * 1024 + 1));
    // A pid that existed and is gone: nothing to stop.
    const dead = spawnSync(process.execPath, ['-e', '']).pid!;
    writeFileSync(path.join(ev, 'pids.json'), JSON.stringify([dead]));
    writeFileSync(path.join(dir, 'verify.json'), JSON.stringify({
      surfaces: ['web'], result: 'pass',
      checks: [
        { id: 1, surface: 'web', name: 'home', main: true, ok: true, expected: 'a', observed: 'a', shot: '01-home.png' },
        { id: 2, surface: 'web', name: 'cart', main: false, ok: true, expected: 'b', observed: 'b', shot: '02-cart.png' },
        { id: 3, surface: 'web', name: 'escape', main: false, ok: true, expected: 'c', observed: 'c', shot: '../../../../outside.png' },
      ],
      learned: [{ surface: 'web', note: 'the dev server takes 5 s to start' }], proposals: [{ surface: 'web', change: 'add the port' }],
    }));
    mkdirSync(path.join(root, 'db', 'state'), { recursive: true });
    writeFileSync(path.join(root, 'db', 'state', 'T1.json'), JSON.stringify({ status: 'in_progress', evidence: { shots: [{ id: 'a1', url: 'u' }, { id: 'a2' }, { url: 'x' }] } }));
    const args = ['verify-close', '--task', 'T1-1', '--dir', '.forge/work/T1/reviews-1-1', '--evidence', '.forge/work/T1/evidence/1-1', '--db', 'db', '--locale', 'en'];
    const out = JSON.parse(run(args, io).stdout);
    expect(out).toMatchObject({
      task: 'T1-1', result: 'pass', passed: 3, total: 3, learned: { web: 1 }, commit: ['.forge/verify/web.md'],
      proposals: [{ surface: 'web', change: 'add the port' }], cleanup: { killed: [], gone: [dead] }, evidence: { mode: 'upload', previous: ['a1', 'a2'] },
    });
    expect(out.evidence.shots.map((s: { check: string; oversize: boolean; file: string }) => [s.check, s.oversize, s.file]))
      .toEqual([['home', false, '.forge/work/T1/evidence/1-1/01-home.png'], ['cart', true, '.forge/work/T1/evidence/1-1/02-cart.png']]);
    expect(readFileSync(path.join(root, '.forge', 'verify', 'web.md'), 'utf8')).toContain('the dev server takes 5 s to start');
    expect(out.say).toContain('Verification pass');
    expect(readEvents(root).filter(e => e.kind === 'verify')).toHaveLength(1);
    run(args, io);
    expect(readEvents(root).filter(e => e.kind === 'verify')).toHaveLength(1);
    expect(run(['verify-close', '--task', 'T1-1', '--dir', 'nope', '--evidence', 'nope'], io).code).toBe(2);
  });

  it('verify-close never lists a shot that resolves outside the evidence dir (absolute path, symlink)', () => {
    const dir = path.join(root, '.forge', 'work', 'T2', 'reviews-1-1');
    const ev = path.join(root, '.forge', 'work', 'T2', 'evidence', '1-1');
    const outside = path.join(root, 'elsewhere');
    mkdirSync(dir, { recursive: true });
    mkdirSync(ev, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(path.join(outside, 'secret.png'), Buffer.alloc(5));
    writeFileSync(path.join(ev, 'ok.png'), Buffer.alloc(5));
    // A file symlink needs a privilege on Windows (and some CI): without it that case is skipped, the others stay.
    let fileLink = true;
    try { symlinkSync(path.join(outside, 'secret.png'), path.join(ev, 'link.png'), 'file'); } catch (e) {
      if (!['EPERM', 'EACCES'].includes((e as NodeJS.ErrnoException).code ?? '')) throw e;
      fileLink = false;
    }
    symlinkSync(outside, path.join(ev, 'dir'), 'junction');
    const check = (id: number, shot: string) => ({ id, surface: 'web', name: `c${id}`, main: id === 1, ok: true, expected: 'a', observed: 'a', shot });
    writeFileSync(path.join(dir, 'verify.json'), JSON.stringify({
      surfaces: ['web'], result: 'pass',
      checks: [check(1, 'ok.png'), check(2, path.join(outside, 'secret.png')), ...(fileLink ? [check(3, 'link.png')] : []), check(4, 'dir/secret.png'), check(5, '../1-1/ok.png')],
    }));
    const out = JSON.parse(run(['verify-close', '--task', 'T2-1', '--dir', '.forge/work/T2/reviews-1-1', '--evidence', '.forge/work/T2/evidence/1-1', '--locale', 'en'], io).stdout);
    expect(out.evidence.shots.map((s: { check: string }) => s.check)).toEqual(['c1', 'c5']);
  });

  it('verify-close with --cwd writes the learned notes into that worktree and records their digests in the main checkout', () => {
    const body = '---\naffects: ["web/**"]\n---\n# Web\n\nOpen the app.\n';
    const wt = path.join(root, 'wt');
    for (const base of [root, wt]) {
      mkdirSync(path.join(base, '.forge', 'verify'), { recursive: true });
      writeFileSync(path.join(base, '.forge', 'verify', 'web.md'), body);
    }
    expect(run(['local', 'set', 'surfaces.web', 'allowed'], io).code).toBe(0);
    const dir = path.join(root, '.forge', 'work', 'T3', 'reviews-1-1');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'verify.json'), JSON.stringify({
      surfaces: ['web'], result: 'pass',
      checks: [{ id: 1, surface: 'web', name: 'home', main: true, ok: true, expected: 'a', observed: 'a' }],
      learned: [{ surface: 'web', note: 'port 3000' }],
    }));
    const r = run(['verify-close', '--task', 'T3-1', '--dir', '.forge/work/T3/reviews-1-1', '--evidence', '.forge/work/T3/evidence/1-1', '--cwd', 'wt', '--locale', 'en'], io);
    expect(JSON.parse(r.stdout)).toMatchObject({ learned: { web: 1 }, commit: ['.forge/verify/web.md'] });
    expect(readFileSync(path.join(wt, '.forge', 'verify', 'web.md'), 'utf8')).toContain('port 3000');
    expect(readFileSync(path.join(root, '.forge', 'verify', 'web.md'), 'utf8')).toBe(body);
    expect(readFileSync(path.join(root, '.forge', 'learned.jsonl'), 'utf8')).toContain('"surface":"web"');
    expect(existsSync(path.join(wt, '.forge', 'learned.jsonl'))).toBe(false);
  });

  it('setup installs the dependencies of a directory as swarm does: the lockfile, or swarm.setup in --cwd (J-17)', () => {
    writeFileSync(path.join(root, 'package.json'), '{}');
    writeFileSync(path.join(root, 'package-lock.json'), '{}');
    const cmds: string[] = [];
    const exec = (cmd: string) => { cmds.push(cmd); return { code: 0, output: 'added 3 packages\n', ms: 1, timedOut: false }; };
    expect(JSON.parse(run(['setup'], { ...io, exec }).stdout)).toEqual({ setup: { cmd: 'npm ci', ok: true, tail: ['added 3 packages'] } });
    expect(cmds).toEqual(['npm ci']);
    mkdirSync(path.join(root, '.forge'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'config.yaml'), `swarm:\n  setup: node -e "require('fs').writeFileSync('setup-ran','1')"\n`);
    mkdirSync(path.join(root, 'wt'));
    expect(JSON.parse(run(['setup', '--cwd', 'wt'], io).stdout).setup).toMatchObject({ ok: true });
    expect(existsSync(path.join(root, 'wt', 'setup-ran'))).toBe(true);
    writeFileSync(path.join(root, '.forge', 'config.yaml'), 'validators: []\n');
    mkdirSync(path.join(root, 'empty'));
    expect(JSON.parse(run(['setup', '--cwd', 'empty'], io).stdout)).toEqual({ setup: null });
  });
});
